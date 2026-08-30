import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { Acronym, AcronymTag, Tag } from "@/lib/types";
import {
  getActiveTags,
  insertOneAcronymWithTags,
  isNormalizedUniqueViolation,
  recordRejectedCandidates,
  toQueryError,
  type RejectedCandidateInsertRow,
} from "@/lib/db-server";
import { normalizeAcronymCasing } from "@/lib/normalize-acronym";
import { MAX_INSERT_PER_SEARCH, runMachineChecks } from "@/lib/candidate-filter";

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

このアプリの収録範囲（スコープ）:
- 主軸はビジネス・経営・金融・投資・会計です
- 周辺として、政治・行政・国際機関・軍事・安全保障・ITは、
  ビジネスや時事の文脈で登場する限り対象です
- AIを使ったアプリ開発（いわゆるVibeCoding）に関連する用語
  （例: LLM、RAG、MCP、エージェント、プロンプトエンジニアリング等）
  は対象です。また分野を問わず応用できる開発の原則・考え方
  （例: YAGNI、DRY、KISS）も対象です。ただし特定の言語・
  フレームワーク・ライブラリの内部実装にしか関わらない用語は
  対象外です
- 医療・学術は、社会現象や社会的議論と結びつく限り対象です
  （例: mRNA、HIVのように、報道で説明なく登場する語）
- 対象外: 専門医学用語（診断名・検査法など臨床/研究向けの内輪語）、
  専門心理学の術語、コーデック・ファイル形式・通信規格等の技術仕様
  （悪い例: MP1/MP2 = 音楽コーデック）、一企業内部の製品名・社内用語
- 判断の中心テスト: その語を知らないと、ビジネス・時事の文章の
  意味が取れないかどうか

同じ略語が分野によって異なる意味を持つことがあります。
与えられた略語について、確実に存在すると分かっている意味だけを
1〜2件、確信のあるものだけを配列で返してください。
件数を埋めるために確信のない解釈を追加しないでください。
1件しか確信が持てない場合は1件だけ返し、無理に2件目を探さないでください。
複数の意味を返す場合も、**すべて上記の収録範囲に該当する解釈のみ**
としてください。範囲外の解釈は、他に確信のある候補がなくても
追加しないでください（ジャンルを揃えるためだけに範囲外の意味を
混ぜない）。範囲内で複数の意味がある場合は、できるだけ異なる
ジャンル（タグ）にまたがる解釈を優先してください。

中心テスト: その略語を知らないと、実務・報道・専門文書で文意が
取れないかどうかを基準にしてください。知っていても雑学が増える
だけのもの（展開しなくても文脈から意味が推測できるもの含む）は
返さないでください。

以下に該当する解釈は返さないでください:
- 展開すれば意味が自明なもの
  （悪い例: Made in Taiwan、Long Play）
- 略語の展開になっていないもの（略語自体に単語を足しただけ、
  ブランド名・製品名の一部等）
  （悪い例: MIT License、TNT Express）
- 企業名・製品名・サービス名。ただし略語としての表記が一般に
  定着しているものは可（例: GCP = Google Cloud Platform は可）
- 実在や流通が確認できないもの
- 上記「収録範囲」に当てはまらないもの
  （悪い例: MP1/MP2の音楽コーデックとしての意味、専門医学用語）

採用基準（必ず守ること）:
- 略語が2文字以下のものは原則として対象外です。例外はBS、PL、
  LP、EV、pHのみです
- 学位はMBAのみ対象とし、他の学位は返さないでください
- 企業名・製品名は原則として対象外です
- 大学名は、文脈での説明なしにその略語だけで通用するものに限ります
- IT分野は、開発・運用の内輪だけで通じる用語を返さないでください。
  ただし他分野にも応用できる原則（例: YAGNI、DRY）や、上記
  「収録範囲」に明記したVibeCoding関連用語は対象です
- 廃止済みの機関・歴史用語は、歴史を理解する文脈で調べる需要が
  あるため対象に含めてください
- 該当する分野タグを1つも決められない場合は、その候補を返さないで
  ください
- 各候補について、収録範囲に合致するかどうかをscope_fitフィールド
  （"in"または"out"）として判定し、1行の理由をscope_reasonフィールド
  （日本語）に記入してください。範囲に合致しない場合はそもそも
  候補として返さないでください（scope_fit="out"はダブルチェック
  用のフィールドであり、範囲外と自分で判定した候補を返してよい
  という意味ではありません）

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
      "description": "初心者向け説明",
      "scope_fit": "in",
      "scope_reason": "収録範囲に合致すると判定した1行の理由"
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

// "in"/"out"以外(未指定・Groqが指示に従わなかった場合等)はundefinedのまま
// 返す。lib/candidate-filter.tsのcheckS1はundefinedを「範囲外と断定
// できない」として通過させる(fail-open)。プロンプト側の指示だけで
// 挙動を保証できない前提(A1と同じ設計、decisions.md参照)のため、
// フィールド欠落時に既存候補まで誤って弾かないための安全側の選択。
type ScopeFit = "in" | "out" | undefined;

function normalizeScopeFit(raw: unknown): ScopeFit {
  return raw === "in" || raw === "out" ? raw : undefined;
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

    const candidates = rawResults
      .slice(0, MAX_RESULTS)
      .map((item) => {
        const result = (item ?? {}) as Record<string, unknown>;

        return {
          acronym,
          full_spelling: String(result.full_spelling ?? "").trim(),
          japanese_translation: String(result.japanese_translation ?? "").trim(),
          tags: normalizeTags(result.tags, validTagNames),
          description: String(result.description ?? "").trim(),
          scope_fit: normalizeScopeFit(result.scope_fit),
          scope_reason: String(result.scope_reason ?? "").trim(),
        };
      })
      .filter((row) => row.full_spelling !== "");

    if (candidates.length === 0) {
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

    // 3-1: 機械判定(A1/D1/D2/D5)をINSERT前に実行する。Groqが採用基準に
    // 反する候補を返した場合でも、ここは必ず通す(3-2参照)。
    const rejected: RejectedCandidateInsertRow[] = [];
    const machineChecked: typeof candidates = [];

    for (const candidate of candidates) {
      const failure = runMachineChecks(candidate);

      if (failure) {
        rejected.push({
          acronym: candidate.acronym,
          full_spelling: candidate.full_spelling,
          japanese_translation: candidate.japanese_translation,
          reason_code: failure.reasonCode,
          reason_detail: failure.reasonDetail,
        });
      } else {
        machineChecked.push(candidate);
      }
    }

    // 3-3: 1回のINSERT上限。機械判定を通過した候補のうち、
    // 上限を超えた分はreason_code='LIMIT'で拒否記録する。
    const accepted = machineChecked.slice(0, MAX_INSERT_PER_SEARCH);
    const overLimit = machineChecked.slice(MAX_INSERT_PER_SEARCH);

    for (const candidate of overLimit) {
      rejected.push({
        acronym: candidate.acronym,
        full_spelling: candidate.full_spelling,
        japanese_translation: candidate.japanese_translation,
        reason_code: "LIMIT",
        reason_detail: `1回の登録上限(${MAX_INSERT_PER_SEARCH}件)を超過`,
      });
    }

    // dryRun時はINSERT自体もrejected_candidatesへのログも発行しない
    // （書き込み経路に到達させない。decisions.md 16章の方針を踏襲）。
    // idとcreated_atは実DB行が存在しないため、それらを要求する
    // Acronym型の形を保つ目的でのみここで仮生成する（実在するIDではない）。
    if (dryRun) {
      const preview: (Acronym & { dryRun: true })[] = accepted.map((row) => ({
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

      return NextResponse.json({
        results: preview,
        rejectedCount: rejected.length,
        rejectedReasonCodes: Array.from(new Set(rejected.map((r) => r.reason_code))),
      });
    }

    // D3(表記ゆれ正規化ユニーク制約違反)は候補単位で捕捉する。
    // insertAcronyms(複数行をまとめて呼ぶラッパー)は1行でも例外が
    // 出るとバッチ全体を中断してしまい、既に成功していた候補の
    // 情報も失われるため使わず、ここで候補ごとにtry/catchする。
    const inserted: Acronym[] = [];

    for (const candidate of accepted) {
      try {
        const rows = await insertOneAcronymWithTags(candidate);
        inserted.push(...rows);
      } catch (err) {
        const queryError = toQueryError(err);

        if (isNormalizedUniqueViolation(queryError)) {
          rejected.push({
            acronym: candidate.acronym,
            full_spelling: candidate.full_spelling,
            japanese_translation: candidate.japanese_translation,
            reason_code: "D3",
            reason_detail:
              "表記ゆれ正規化ユニーク制約(acronyms_normalized_unique)違反",
          });
          continue;
        }

        // D3以外の想定外のDBエラーは握りつぶさない。
        console.error("[DB Insert Error]", queryError);

        if (rejected.length > 0) {
          const { error: logError } = await recordRejectedCandidates(rejected);
          if (logError) console.error("[Rejected Candidates Log Error]", logError);
        }

        return NextResponse.json(
          {
            error: "DB保存に失敗しました",
            detail: queryError.message,
          },
          {
            status: 500,
          }
        );
      }
    }

    if (rejected.length > 0) {
      const { error: logError } = await recordRejectedCandidates(rejected);
      if (logError) console.error("[Rejected Candidates Log Error]", logError);
    }

    // insertedが0件でも、rejectedにA1/D1/D2/D3/D5/LIMITの記録があるなら
    // 「見つからなかった」のではなく「基準に合わず拒否された」ので、
    // 404(AI調査失敗)ではなく200+rejectedCountで返す(3-4のUI通知が
    // 拾えるようにするため)。rejectedReasonCodesはUI側がA1(短すぎる
    // 略語)とそれ以外を区別したメッセージを出し分けるために使う。
    return NextResponse.json({
      results: inserted,
      rejectedCount: rejected.length,
      rejectedReasonCodes: Array.from(new Set(rejected.map((r) => r.reason_code))),
    });
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
