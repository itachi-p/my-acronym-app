import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Acronym, AcronymTag, Tag } from "@/lib/types";
import { getActiveTags, insertAcronyms } from "@/lib/db-server";
import { normalizeAcronymCasing } from "@/lib/normalize-acronym";

const MAX_RESULTS = 4;
const MAX_TAGS_PER_RESULT = 3;
const FALLBACK_TAG_NAME = "その他";

// タグ一覧をDBから動的に取得してプロンプトへ埋め込む(ハードコード禁止。
// タグを増減してもこのファイルの変更が不要になることが本設計の主目的)。
function buildSystemPrompt(tagNames: string[]) {
  return `
あなたは英語略語（アクロニム）の専門家です。

必ずJSONのみを返してください。
Markdown記法や説明文は不要です。

同じ略語が分野によって異なる意味を持つことがあります。
与えられた略語について、確実に存在すると分かっている意味だけを
1〜2件、確信のあるものだけを配列で返してください。
件数を埋めるために確信のない解釈を追加しないでください。
1件しか確信が持てない場合は1件だけ返し、無理に2件目を探さないでください。
複数の意味を返す場合は、できるだけ異なるジャンル（タグ）に
またがる解釈を優先してください。

判定基準: その略語だけを見たとき、何の略か知らないと意味が
取れないかどうかを基準にしてください。展開しなくても文脈から
意味が推測できるものは対象外です。

以下に該当する解釈は返さないでください:
- 展開すれば意味が自明なもの
  （悪い例: Made in Taiwan、Long Play）
- 略語の展開になっていないもの（略語自体に単語を足しただけ、
  ブランド名・製品名の一部等）
  （悪い例: MIT License、TNT Express）
- 企業名・製品名・サービス名。ただし略語としての表記が一般に
  定着しているものは可（例: GCP = Google Cloud Platform は可）
- 実在や流通が確認できないもの

full_spellingは単一の正式名称のみとしてください。
「または」「/」「もしくは」等で複数の表記を併記しないでください。

同一の意味を表す表記ゆれ（例: Broadcast Satellite と
Broadcasting Satellite）を複数の候補として返さないでください。
1つの意味につき最も一般的な表記を1つだけ選んでください。

形式:

{
  "results": [
    {
      "full_spelling": "英語正式名称",
      "japanese_translation": "日本語訳",
      "tags": ["主タグ", "副タグ1", "副タグ2"],
      "description": "初心者向け説明"
    }
  ]
}

言語に関する指示（必ず守ること）:
- description と japanese_translation は必ず日本語で記述してください。英語で書かないでください。
- japanese_translation には、その分野で定着している定訳のみを1つ返してください。
  カタカナ音写や、英語・別訳の括弧書きでの併記はしないでください。
  （悪い例: 「シグイント（信号情報）」／良い例: 「信号情報」）

tagsは以下の一覧から、最も当てはまるものを1〜${MAX_TAGS_PER_RESULT}個、
配列で返してください。1つ目の要素は最もふさわしいタグ1つ（主タグ）と
してください。2つ目以降は任意です。確信がある場合のみ、補足的な
分類として追加してください（0〜2個程度、無理に埋めないでください）。
一覧に無い語は使わないでください。

${tagNames.join("\n")}
`;
}

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

function normalizeTags(rawTags: unknown, validTagNames: Set<string>): string[] {
  const list = Array.isArray(rawTags) ? rawTags : [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of list) {
    const name = typeof raw === "string" ? raw.trim() : "";

    if (!name || !validTagNames.has(name) || seen.has(name)) continue;

    seen.add(name);
    normalized.push(name);

    if (normalized.length >= MAX_TAGS_PER_RESULT) break;
  }

  return normalized.length > 0 ? normalized : [FALLBACK_TAG_NAME];
}

// クエリ文字列は常にstringなので、真とみなす値をここで明示的に決める
// ("1"/"true"、大文字小文字・前後空白は許容。それ以外はすべて偽)。
// bodyのdryRunはbooleanのtrueのみを真とみなす（詳細: decisions.md）。
const DRY_RUN_TRUE_QUERY_VALUES = new Set(["1", "true"]);

function isDryRunRequested(
  body: Record<string, unknown>,
  searchParams: URLSearchParams
): boolean {
  if (body.dryRun === true) {
    return true;
  }

  const queryValue = searchParams.get("dryRun");

  return (
    queryValue !== null &&
    DRY_RUN_TRUE_QUERY_VALUES.has(queryValue.trim().toLowerCase())
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // 大文字を1文字も含まない入力（bbs/seo等）のみ全大文字化する。
    // TOCfE/IoT/mRNAのような大小混在表記はそのままGroqに渡し、保存する
    // （normalizeAcronymCasing参照。decisions.md参照）。
    const dryRun = isDryRunRequested(body, request.nextUrl.searchParams);
    const acronym = normalizeAcronymCasing(String(body.acronym ?? "").trim());

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

    const { data: tagRows, error: tagsError } = await getActiveTags();

    if (tagsError || !tagRows || tagRows.length === 0) {
      console.error("[Tags Fetch Error]", tagsError);

      return NextResponse.json(
        {
          error: "タグ一覧の取得に失敗しました",
        },
        {
          status: 500,
        }
      );
    }

    const tagByName = new Map<string, Tag>(tagRows.map((t) => [t.name, t]));
    const validTagNames = new Set(tagByName.keys());
    const systemPrompt = buildSystemPrompt(tagRows.map((t) => t.name));

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
            { role: "system", content: systemPrompt },
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
          tags: normalizeTags(result.tags, validTagNames),
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

    // dryRun時はINSERT自体を発行しない（書き込み経路に到達させない）。
    // idとcreated_atは実DB行が存在しないため、それらを要求する
    // Acronym型の形を保つ目的でのみここで仮生成する（実在するIDではない）。
    if (dryRun) {
      const preview: (Acronym & { dryRun: true })[] = insertData.map((row) => ({
        id: randomUUID(),
        acronym: row.acronym,
        full_spelling: row.full_spelling,
        japanese_translation: row.japanese_translation,
        description: row.description,
        created_at: new Date().toISOString(),
        tags: row.tags
          .map((name, idx): AcronymTag | null => {
            const tag = tagByName.get(name);

            return tag ? { ...tag, is_primary: idx === 0 } : null;
          })
          .filter((tag): tag is AcronymTag => tag !== null),
        dryRun: true,
      }));

      return NextResponse.json(preview);
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
