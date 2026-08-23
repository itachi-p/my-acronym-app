import { neon } from "@neondatabase/serverless";
import type { Acronym } from "./types";

// @neondatabase/serverless のHTTPドライバを使用。
// node-postgres(pg)はサーバーレス環境(Vercel等)でコネクションが
// 枯渇するため使わない方針。
//
// fetchOptions.cache: "no-store" が必須。このドライバは内部でPOSTの
// fetch()を発行するが、これがNext.jsのData Cache(サーバー内部の
// fetchキャッシュ)の対象になり得る。実際に本番で、SQL文のテキストが
// 一切変化しない検索クエリ(searchAcronyms)だけが、DBには対象行が
// 存在するのに空配列を返し続ける事象が発生した。原因はSQL文が
// クエリキャッシュのキーとなり、対象行がまだ存在しなかった頃の
// 空レスポンスがキャッシュされたまま返り続けていたこと(クエリの
// 空白を1文字変えるだけでキャッシュキーが変わり正しい結果に戻る
// ことで再現・特定した)。ルート側のdynamic="force-dynamic"だけでは
// このモジュール内部のfetchキャッシュは無効化されなかったため、
// ここで明示的にno-storeを指定する。
const sql = neon(process.env.DATABASE_URL!, {
  fetchOptions: { cache: "no-store" },
});

type QueryError = { message: string; code?: string };

function toQueryError(err: unknown): QueryError {
  if (err && typeof err === "object" && "message" in err) {
    const code = "code" in err && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;

    return { message: String((err as { message: unknown }).message), code };
  }

  return { message: String(err) };
}

// acronymは入力表記のまま保存されるため大文字小文字が揺れる。
// 検索は lower(acronym) に対する前方一致で大文字小文字を無視する
// (idx_acronyms_acronym_prefix はlower(acronym)に張られている)。
//
// 完全一致(例: "BS")を、より長い前方一致(例: "BSJ")より必ず先に
// 並べる。理由: 1つの略語に複数解釈を許すようになったことで、
// 短い人気の略語ほど完全一致の行数が増えやすく、LIMITと前方一致が
// 組み合わさると、より長い派生略語の行が完全一致の行を押し出して
// 検索結果から溢れてしまう(実際に本番で"BS"検索時、完全一致7件+
// "BSJ"3件で計10件がLIMITぎりぎりになり発生した事象)。
// また ORDER BY acronym だけでは同じacronym同士の並び順が
// 保証されないため、そちらも full_spelling をタイブレークに追加する。
export async function searchAcronyms(query: string) {
  const lowerQuery = query.toLowerCase();

  try {
    const data = (await sql`
      SELECT * FROM acronyms
      WHERE lower(acronym) LIKE ${lowerQuery + "%"}
      ORDER BY (lower(acronym) <> ${lowerQuery}), acronym, full_spelling
      LIMIT 20
    `) as unknown as Acronym[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

// 複数解釈(同一acronym・異なるfull_spelling)を一括INSERTする。
// lower(acronym), lower(full_spelling)の大文字小文字を無視した
// UNIQUEインデックスに抵触した行はON CONFLICT DO NOTHINGでスキップし、
// エラーにはしない。ON CONFLICTのターゲットはacronyms_acronym_full_spelling_ci_unique
// インデックスの式と一致させる必要がある(schema.sql参照)。
// RETURNING * は実際にINSERTされた行のみを返すため、既存行は
// 戻り値に含まれない。
export interface IndexKeyCount {
  key: string;
  count: number;
}

// 逆引きインデックスの「先頭キー」導出式。集計クエリ(getAcronymIndexCounts)と
// 一覧クエリ(getAcronymsByIndexKey)の両方がこの定数だけを参照する。
// 式を2箇所に書き写さないこと(書き写すとバッジの件数と実件数が食い違い、
// かつ例外が出ないため発見できなくなる)。
//
// トリム対象: POSIX標準の空白類([:space:] = 半角スペース/タブ/改行(\n\r)/
// 改ページ/垂直タブ)に加え、全角スペース(U+3000)とNBSP(U+00A0)。この2文字は
// 正規表現エスケープ(　等)の解釈違いに依存させないよう chr() で
// コードポイント指定する。
// 登録経路(POST /api/acronym, POST /api/acronym/manual)は既にJSのtrim()で
// 前後空白を除去しているが、それ以前に投入された既存データの保証はないため、
// クエリ側でも独立して除去する。
const TRIM_PATTERN_SQL =
  "('^[[:space:]' || chr(12288) || chr(160) || ']+|[[:space:]' || chr(12288) || chr(160) || ']+$')";
const TRIMMED_ACRONYM_SQL = `regexp_replace(acronym, ${TRIM_PATTERN_SQL}, '', 'g')`;

// 分類ルール:
// - acronymがNULL、またはトリム後が空文字 → SQL上のNULL(呼び出し側で除外する)
// - トリム後の先頭1文字を大文字化してA-Zなら、その1文字を単独キーとする
// - 先頭1文字が0-9なら'0-9'に集約する
// - それ以外(記号・全角文字・絵文字等)は'#'に集約する
export const ACRONYM_INDEX_KEY_EXPR = `
  CASE
    WHEN acronym IS NULL THEN NULL
    WHEN ${TRIMMED_ACRONYM_SQL} = '' THEN NULL
    WHEN upper(left(${TRIMMED_ACRONYM_SQL}, 1)) ~ '^[A-Z]$' THEN upper(left(${TRIMMED_ACRONYM_SQL}, 1))
    WHEN left(${TRIMMED_ACRONYM_SQL}, 1) ~ '^[0-9]$' THEN '0-9'
    ELSE '#'
  END
`;

// キー別の件数集計。0件のキーはGROUP BYの性質上そもそも出現しない。
// 表示順はSQLのORDER BYに依存させず呼び出し側(lib/reverse-index.ts)で
// 固定する。countはbigintのままだとドライバが文字列で返すため::intで
// 数値にキャストする。
export async function getAcronymIndexCounts() {
  try {
    const data = (await sql.query(
      `SELECT ${ACRONYM_INDEX_KEY_EXPR} AS key, COUNT(*)::int AS count
       FROM acronyms
       WHERE ${ACRONYM_INDEX_KEY_EXPR} IS NOT NULL
       GROUP BY key`
    )) as unknown as IndexKeyCount[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

// 指定キーに属するレコード一覧。LIKEではなくACRONYM_INDEX_KEY_EXPRとの
// 等値比較で絞り込む(LIKEはパラメータ中の'%'や'_'がワイルドカードとして
// 解釈されるうえ、集計側の式と別の絞り込みロジックになり乖離しうるため)。
// 並び順はアクロニムの大文字化・トリム後の昇順。同値時のタイブレーカーは
// full_spelling、最終的にid(主キー)で順序を完全に固定する。
export async function getAcronymsByIndexKey(key: string) {
  try {
    const data = (await sql.query(
      `SELECT *
       FROM acronyms
       WHERE ${ACRONYM_INDEX_KEY_EXPR} = $1
       ORDER BY upper(${TRIMMED_ACRONYM_SQL}), full_spelling, id`,
      [key]
    )) as unknown as Acronym[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

export async function insertAcronyms(
  rows: Omit<Acronym, "id" | "created_at">[]
) {
  if (rows.length === 0) {
    return { data: [], error: null };
  }

  try {
    const params: unknown[] = [];
    const valuesSql = rows
      .map((row, i) => {
        const base = i * 5;
        params.push(
          row.acronym,
          row.full_spelling,
          row.japanese_translation,
          row.category,
          row.description
        );

        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      })
      .join(", ");

    const inserted = (await sql.query(
      `INSERT INTO acronyms (acronym, full_spelling, japanese_translation, category, description)
       VALUES ${valuesSql}
       ON CONFLICT (lower(acronym), lower(full_spelling)) DO NOTHING
       RETURNING *`,
      params
    )) as unknown as Acronym[];

    return { data: inserted, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}
