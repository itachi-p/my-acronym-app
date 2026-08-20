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

  return NextResponse.json(row, {
    headers: { "Cache-Control": "no-store" },
  });
}
