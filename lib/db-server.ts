import { neon } from "@neondatabase/serverless";
import type { Acronym } from "./types";

// @neondatabase/serverless のHTTPドライバを使用。
// node-postgres(pg)はサーバーレス環境(Vercel等)でコネクションが
// 枯渇するため使わない方針。
const sql = neon(process.env.DATABASE_URL!);

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

export async function searchAcronyms(query: string) {
  const upperQuery = query.toUpperCase();

  try {
    const data = (await sql`
      SELECT * FROM acronyms
      WHERE acronym LIKE ${upperQuery + "%"}
      ORDER BY acronym
      LIMIT 10
    `) as unknown as Acronym[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

// 複数解釈(同一acronym・異なるfull_spelling)を一括INSERTする。
// (acronym, full_spelling)の複合UNIQUE制約に抵触した行は
// ON CONFLICT DO NOTHINGでスキップし、エラーにはしない。
// RETURNING * は実際にINSERTされた行のみを返すため、既存行は
// 戻り値に含まれない。
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
       ON CONFLICT (acronym, full_spelling) DO NOTHING
       RETURNING *`,
      params
    )) as unknown as Acronym[];

    return { data: inserted, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}
