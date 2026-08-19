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

export async function findAcronym(acronym: string) {
  try {
    const rows = (await sql`
      SELECT * FROM acronyms
      WHERE acronym = ${acronym.toUpperCase()}
      LIMIT 1
    `) as unknown as Acronym[];

    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

export async function insertAcronym(acronym: Omit<Acronym, "id" | "created_at">) {
  try {
    const rows = (await sql`
      INSERT INTO acronyms (acronym, full_spelling, japanese_translation, category, description)
      VALUES (
        ${acronym.acronym},
        ${acronym.full_spelling},
        ${acronym.japanese_translation},
        ${acronym.category},
        ${acronym.description}
      )
      RETURNING *
    `) as unknown as Acronym[];

    return { data: rows[0], error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}
