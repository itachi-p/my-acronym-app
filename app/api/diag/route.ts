import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// TEMPORARY: 検索が0件を返す原因切り分け用の一時診断ルート。
// 確認終了後に削除すること（このファイル自体を削除するだけでよい）。
const sql = neon(process.env.DATABASE_URL!);

export const dynamic = "force-dynamic";

export async function GET() {
  const [row] = await sql`
    SELECT
      current_database() AS current_database,
      current_user AS current_user,
      (SELECT count(*) FROM acronyms) AS total,
      (SELECT count(*) FROM acronyms WHERE lower(acronym) LIKE 'npo%') AS npo_prefix,
      (SELECT max(created_at) FROM acronyms) AS newest
  `;

  // searchAcronyms(lib/db-server.ts)と同一構造のクエリを再現し、
  // パラメータ化クエリ自体に問題がないか切り分ける。
  const lowerQuery = "npo";
  const searchLike = (await sql`
    SELECT acronym, full_spelling, id, created_at FROM acronyms
    WHERE lower(acronym) LIKE ${lowerQuery + "%"}
    ORDER BY (lower(acronym) <> ${lowerQuery}), acronym, full_spelling
    LIMIT 20
  `) as unknown[];

  return NextResponse.json(
    { ...row, searchLikeCount: searchLike.length, searchLikeRows: searchLike },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
