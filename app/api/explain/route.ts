import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { insertAcronymServer } from "@/lib/supabase-server";
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

function parseGeminiResponse(text: string): GeminiAcronymResponse | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as GeminiAcronymResponse;

    if (
      !parsed.acronym ||
      !parsed.full_spelling ||
      !parsed.reading ||
      !parsed.japanese_translation ||
      !parsed.category ||
      !parsed.description
    ) {
      return null;
    }

    if (!VALID_CATEGORIES.includes(parsed.category)) {
      parsed.category = "その他";
    }

    parsed.acronym = parsed.acronym.toUpperCase();

    return parsed;
  } catch {
    return null;
  }
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY が設定されていません" },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_PROMPT,
    });

    const result = await model.generateContent(
      `略語「${inputAcronym}」について説明してください。`
    );

    const responseText = result.response.text();
    const parsed = parseGeminiResponse(responseText);

    if (!parsed) {
      return NextResponse.json(
        { error: "AIからの応答を解析できませんでした", raw: responseText },
        { status: 500 }
      );
    }

    const saved = await insertAcronymServer({
      acronym: parsed.acronym,
      full_spelling: parsed.full_spelling,
      reading: parsed.reading,
      japanese_translation: parsed.japanese_translation,
      category: parsed.category,
      description: parsed.description,
    });

    if (!saved) {
      return NextResponse.json(
        { error: "Supabaseへの保存に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json(saved);
  } catch (error) {
    console.error("Explain API error:", error);
    return NextResponse.json(
      { error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
