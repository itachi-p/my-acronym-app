import { neon } from "@neondatabase/serverless";
import type { Acronym } from "./types";

// @neondatabase/serverless のHTTPドライバを使用。
// node-postgres(pg)はサーバーレス環境(Vercel等)でコネクションが
// 枯渇するため使わない方針。
//
// sql はモジュール単位でシングルトン化せず、呼び出しごとに生成する。
// neon()クライアントはNeon側でコネクションをキャッシュ/使い回すため、
// ウォームなサーバーレス関数インスタンスで使い回されるシングルトンだと、
// 直近でコミットされた行を拾えない(古いスナップショットを握ったまま
// 返す)事象が本番で確認されたため。
function getSql() {
  return neon(process.env.DATABASE_URL!);
}

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
  const sql = getSql();
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
export async function insertAcronyms(
  rows: Omit<Acronym, "id" | "created_at">[]
) {
  if (rows.length === 0) {
    return { data: [], error: null };
  }

  const sql = getSql();

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
