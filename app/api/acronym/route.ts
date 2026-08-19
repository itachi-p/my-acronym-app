import { NextRequest, NextResponse } from "next/server";
import { ACRONYM_CATEGORIES, type AcronymCategory } from "@/lib/types";
import { insertAcronyms } from "@/lib/db-server";

const MAX_RESULTS = 4;

const SYSTEM_PROMPT = `
あなたは英語略語（アクロニム）の専門家です。

必ずJSONのみを返してください。
Markdown記法や説明文は不要です。

同じ略語が分野によって異なる意味を持つことがあります。
与えられた略語について、確実に存在すると分かっている意味だけを
1〜${MAX_RESULTS}件、配列で返してください。
件数を無理に埋めようとせず、根拠が確実でない解釈は含めないでください。
複数の意味を返す場合は、できるだけ異なるジャンル（カテゴリ）に
またがる解釈を優先してください。

形式:

{
  "results": [
    {
      "full_spelling": "英語正式名称",
      "japanese_translation": "日本語訳",
      "category": "カテゴリ",
      "description": "初心者向け説明"
    }
  ]
}

言語に関する指示（必ず守ること）:
- description と japanese_translation は必ず日本語で記述してください。英語で書かないでください。
- japanese_translation には、その分野で定着している定訳のみを1つ返してください。
  カタカナ音写や、英語・別訳の括弧書きでの併記はしないでください。
  （悪い例: 「シグイント（信号情報）」／良い例: 「信号情報」）

categoryは以下から必ず1つ選択してください。

${ACRONYM_CATEGORIES.join("\n")}
`;

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

function normalizeCategory(category: string): AcronymCategory {
  if (ACRONYM_CATEGORIES.includes(category as AcronymCategory)) {
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

    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];

    const insertData = rawResults
      .slice(0, MAX_RESULTS)
      .map((item) => {
        const result = (item ?? {}) as Record<string, unknown>;

        return {
          acronym,
          full_spelling: String(result.full_spelling ?? "").trim(),
          japanese_translation: String(result.japanese_translation ?? "").trim(),
          category: normalizeCategory(String(result.category ?? "")),
          description: String(result.description ?? "").trim(),
        };
      })
      .filter((row) => row.full_spelling !== "");

    if (insertData.length === 0) {
      console.error("[Groq Empty Results]", content);

      return NextResponse.json(
        {
          error: "確実な意味が見つかりませんでした",
        },
        {
          status: 404,
        }
      );
    }

    const { data, error } = await insertAcronyms(insertData);

    if (error) {
      console.error("[DB Insert Error]", error);

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
