import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const VALID_CATEGORIES = [
  "ビジネス・経営",
  "金融・株式",
  "政治・行政",
  "軍事・安全保障",
  "IT・テクノロジー",
  "その他",
] as const;

type AcronymCategory = (typeof VALID_CATEGORIES)[number];

const SYSTEM_PROMPT = `
あなたは英語略語（アクロニム）の専門家です。

必ずJSONのみを返してください。
Markdown記法や説明文は不要です。

形式:

{
  "acronym": "大文字略語",
  "full_spelling": "英語正式名称",
  "japanese_translation": "日本語訳",
  "category": "カテゴリ",
  "description": "初心者向け説明"
}

categoryは以下から必ず1つ選択してください。

ビジネス・経営
金融・株式
政治・行政
軍事・安全保障
IT・テクノロジー
その他
`;

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase environment variables are missing");
  }

  return createClient(url, key);
}

function parseGeminiJson(text: string) {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("Gemini response is not JSON");
  }

  return JSON.parse(cleaned.substring(start, end + 1));
}

function normalizeCategory(category: string): AcronymCategory {
  if (VALID_CATEGORIES.includes(category as AcronymCategory)) {
    return category as AcronymCategory;
  }

  return "その他";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const acronym = String(body.acronym ?? "").trim().toUpperCase();

    if (!acronym) {
      return NextResponse.json(
        {
          error: "略語を入力してください",
        },
        {
          status: 400,
        }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "GEMINI_API_KEY が設定されていません",
        },
        {
          status: 500,
        }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
      systemInstruction: SYSTEM_PROMPT,
    });

    let responseText = "";

    try {
      const result = await model.generateContent(
        `略語「${acronym}」について説明してください`
      );

      responseText = result.response.text();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.error("[Gemini Error]", {
        message,
        status: error instanceof Error ? undefined : undefined,
        statusText: undefined,
      });

      return NextResponse.json(
        {
          error: "Gemini API 呼び出しに失敗しました",
          detail: message,
        },
        {
          status: 500,
        }
      );
    }

    let parsed;

    try {
      parsed = parseGeminiJson(responseText);
    } catch {
      console.error("[Gemini Parse Error]", responseText);

      return NextResponse.json(
        {
          error: "Geminiの応答解析に失敗しました",
          raw: responseText,
        },
        {
          status: 500,
        }
      );
    }

    const insertData = {
      acronym: String(parsed.acronym).trim().toUpperCase(),
      full_spelling: String(parsed.full_spelling),
      japanese_translation: String(parsed.japanese_translation),
      category: normalizeCategory(String(parsed.category)),
      description: String(parsed.description),
    };

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("acronyms")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("[Supabase Insert Error]", error);

      // 同じ略語が既に存在する場合
      // DB側のUNIQUE制約によるエラー
      if (error.code === "23505") {
        const { data: existing, error: selectError } = await supabase
          .from("acronyms")
          .select("*")
          .eq("acronym", insertData.acronym)
          .single();

        if (!selectError) {
          return NextResponse.json(existing);
        }
      }

      return NextResponse.json(
        {
          error: "DB保存に失敗しました",
          detail: error.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    console.error("[Acronym API Error]", error);

    return NextResponse.json(
      {
        error: "サーバーエラーが発生しました",
        detail: message,
      },
      {
        status: 500,
      }
    );
  }
}
