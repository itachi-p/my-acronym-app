import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import {
  checkSupabaseEnv,
  insertAcronymServer,
} from "@/lib/supabase-server";
import type { AcronymCategory, GeminiAcronymResponse } from "@/lib/types";

const VALID_CATEGORIES: AcronymCategory[] = [
  "ビジネス・経営",
  "金融・株式",
  "政治・行政",
  "軍事・安全保障",
  "IT・テクノロジー",
  "その他",
];

const SYSTEM_PROMPT = `あなたは英語略語（アクロニム）の専門家です。
ユーザーが入力した略語について、以下のJSONフォーマットで厳密に回答してください。
JSON以外のテキストは一切出力しないでください。

{
  "acronym": "大文字略語",
  "full_spelling": "英語正式名称",
  "reading": "カタカナ読み",
  "japanese_translation": "日本語訳",
  "category": "「ビジネス・経営」「金融・株式」「政治・行政」「軍事・安全保障」「IT・テクノロジー」「その他」のいずれか1つを厳密に選択",
  "description": "初心者にもわかりやすい概要解説（100文字程度）"
}`;

function maskSecret(value: string | undefined): string {
  if (!value) return "(not set)";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`;
}

function checkEnvVars(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!process.env.GEMINI_API_KEY?.trim()) {
    missing.push("GEMINI_API_KEY");
  }

  const supabaseEnv = checkSupabaseEnv();
  missing.push(...supabaseEnv.missing);

  return { ok: missing.length === 0, missing };
}

/** Strip markdown fences and extract JSON object from Gemini response text */
function extractJsonString(text: string): string | null {
  let cleaned = text.trim();

  // Remove ```json ... ``` or ``` ... ``` wrappers
  cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\r?\n?/m, "");
  cleaned = cleaned.replace(/\r?\n?```\s*$/m, "");
  cleaned = cleaned.trim();

  // If still wrapped, take inner content between first { and last }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return cleaned.slice(start, end + 1);
}

function parseGeminiResponse(
  text: string
): { ok: true; data: GeminiAcronymResponse } | { ok: false; reason: string } {
  const jsonString = extractJsonString(text);

  if (!jsonString) {
    return { ok: false, reason: "No JSON object found in response" };
  }

  let parsed: GeminiAcronymResponse;
  try {
    parsed = JSON.parse(jsonString) as GeminiAcronymResponse;
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error("[Gemini] JSON.parse failed:", msg);
    console.error("[Gemini] Extracted JSON string:", jsonString);
    return { ok: false, reason: `JSON.parse error: ${msg}` };
  }

  if (
    !parsed.acronym ||
    !parsed.full_spelling ||
    !parsed.reading ||
    !parsed.japanese_translation ||
    !parsed.category ||
    !parsed.description
  ) {
    console.error("[Gemini] Missing required fields in parsed JSON:", parsed);
    return { ok: false, reason: "Missing required fields in parsed JSON" };
  }

  if (!VALID_CATEGORIES.includes(parsed.category)) {
    console.error(
      `[Gemini] Invalid category "${parsed.category}", falling back to "その他"`
    );
    parsed.category = "その他";
  }

  parsed.acronym = parsed.acronym.toUpperCase();

  return { ok: true, data: parsed };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const inputAcronym = (body.acronym as string)?.trim().toUpperCase();

    if (!inputAcronym) {
      return NextResponse.json(
        { error: "略語を入力してください" },
        { status: 400 }
      );
    }

    // --- Environment variable check ---
    const envCheck = checkEnvVars();
    console.error("[Explain] Env check:", {
      GEMINI_API_KEY: maskSecret(process.env.GEMINI_API_KEY),
      NEXT_PUBLIC_SUPABASE_URL: maskSecret(
        process.env.NEXT_PUBLIC_SUPABASE_URL
      ),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: maskSecret(
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ),
      allPresent: envCheck.ok,
      missing: envCheck.missing,
    });

    if (!envCheck.ok) {
      console.error(
        "[Explain] Missing environment variables:",
        envCheck.missing.join(", ")
      );
      return NextResponse.json(
        {
          error: `環境変数が未設定です: ${envCheck.missing.join(", ")}`,
          missing: envCheck.missing,
        },
        { status: 500 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY!;

    // --- Gemini API call ---
    console.error(`[Gemini] Calling API for acronym: ${inputAcronym}`);

    let responseText: string;
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction: SYSTEM_PROMPT,
      });

      const result = await model.generateContent(
        `略語「${inputAcronym}」について説明してください。`
      );

      responseText = result.response.text();
      console.error(
        "[Gemini] Raw response (first 500 chars):",
        responseText.slice(0, 500)
      );
    } catch (geminiErr) {
      console.error("[Gemini] API call failed:", geminiErr);
      const message =
        geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
      return NextResponse.json(
        { error: `Gemini API 呼び出しに失敗しました: ${message}` },
        { status: 500 }
      );
    }

    // --- Parse Gemini response ---
    const parseResult = parseGeminiResponse(responseText);

    if (!parseResult.ok) {
      console.error("[Gemini] Parse failed:", parseResult.reason);
      console.error("[Gemini] Full raw response:", responseText);
      return NextResponse.json(
        {
          error: "AIからの応答を解析できませんでした",
          reason: parseResult.reason,
          raw: responseText,
        },
        { status: 500 }
      );
    }

    const parsed = parseResult.data;
    console.error("[Gemini] Parsed successfully:", parsed.acronym);

    // --- Supabase INSERT ---
    const insertResult = await insertAcronymServer({
      acronym: parsed.acronym,
      full_spelling: parsed.full_spelling,
      reading: parsed.reading,
      japanese_translation: parsed.japanese_translation,
      category: parsed.category,
      description: parsed.description,
    });

    if (!insertResult.success) {
      const { error: supaError } = insertResult;
      console.error("[Explain] Supabase save failed:", supaError);

      const isRls = supaError.message.includes("RLS policy");

      return NextResponse.json(
        {
          error: isRls
            ? "Supabase RLSポリシーにより保存が拒否されました"
            : "Supabaseへの保存に失敗しました",
          supabase: {
            message: supaError.message,
            code: supaError.code,
            hint: supaError.hint,
            details: supaError.details,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json(insertResult.data);
  } catch (error) {
    console.error("[Explain] Unexpected error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "サーバーエラーが発生しました", detail: message },
      { status: 500 }
    );
  }
}
