import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES, type AcronymCategory } from "@/lib/types";
import { findAcronym, insertAcronym } from "@/lib/db-server";

const VALID_CATEGORIES = CATEGORIES.filter(
  (category): category is AcronymCategory => category !== "すべて"
);

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

言語に関する指示（必ず守ること）:
- description と japanese_translation は必ず日本語で記述してください。英語で書かないでください。
- japanese_translation には、その分野で定着している定訳のみを1つ返してください。
  カタカナ音写や、英語・別訳の括弧書きでの併記はしないでください。
  （悪い例: 「シグイント（信号情報）」／良い例: 「信号情報」）

categoryは以下から必ず1つ選択してください。

${VALID_CATEGORIES.join("\n")}
`;

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

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

    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "GROQ_API_KEY が設定されていません",
        },
        {
          status: 500,
        }
      );
    }

    const model = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

    let content: string;

    try {
      const groqResponse = await fetch(GROQ_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `略語「${acronym}」について説明してください` },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!groqResponse.ok) {
        const detail = await groqResponse.text();

        console.error("[Groq Error]", groqResponse.status, detail);

        return NextResponse.json(
          {
            error: "Groq API 呼び出しに失敗しました",
            detail,
          },
          {
            status: 500,
          }
        );
      }

      const groqJson = await groqResponse.json();
      content = groqJson.choices?.[0]?.message?.content ?? "";
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      console.error("[Groq Error]", message);

      return NextResponse.json(
        {
          error: "Groq API 呼び出しに失敗しました",
          detail: message,
        },
        {
          status: 500,
        }
      );
    }

    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("[Groq Parse Error]", content);

      return NextResponse.json(
        {
          error: "Groqの応答解析に失敗しました",
          raw: content,
        },
        {
          status: 500,
        }
      );
    }

    const insertData = {
      acronym: String(parsed.acronym ?? acronym).trim().toUpperCase(),
      full_spelling: String(parsed.full_spelling ?? ""),
      japanese_translation: String(parsed.japanese_translation ?? ""),
      category: normalizeCategory(String(parsed.category ?? "")),
      description: String(parsed.description ?? ""),
    };

    const { data, error } = await insertAcronym(insertData);

    if (error) {
      console.error("[DB Insert Error]", error);

      // 同じ略語が既に存在する場合
      // DB側のUNIQUE制約によるエラー
      if (error.code === "23505") {
        const { data: existing, error: findError } = await findAcronym(
          insertData.acronym
        );

        if (!findError && existing) {
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
