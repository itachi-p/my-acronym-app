import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { searchAcronyms } from "@/lib/db-server";

// TEMPORARY: 検索が0件を返す原因切り分け用の一時診断ルート。
// 確認終了後に削除すること（このファイル自体を削除するだけでよい）。
const sql = neon(process.env.DATABASE_URL!);

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawQ = request.nextUrl.searchParams.get("q");
  const trimmedQ = rawQ?.trim() ?? "";
  const t0 = Date.now();
  const viaRealFn1 = trimmedQ.length >= 2 ? await searchAcronyms(trimmedQ) : null;
  const t1 = Date.now();
  const viaRealFn2 = trimmedQ.length >= 2 ? await searchAcronyms(trimmedQ) : null;
  const t2 = Date.now();

  const explainRows = (await sql`
    EXPLAIN (FORMAT JSON)
    SELECT * FROM acronyms
    WHERE lower(acronym) LIKE ${trimmedQ.toLowerCase() + "%"}
    ORDER BY (lower(acronym) <> ${trimmedQ.toLowerCase()}), acronym, full_spelling
    LIMIT 20
  `) as { "QUERY PLAN": unknown }[];

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

  // searchAcronymsとSELECT列まで完全一致させた版(ローカルsqlクライアント使用)。
  const searchLikeSelectStar = (await sql`
    SELECT * FROM acronyms
    WHERE lower(acronym) LIKE ${lowerQuery + "%"}
    ORDER BY (lower(acronym) <> ${lowerQuery}), acronym, full_spelling
    LIMIT 20
  `) as unknown[];

  return NextResponse.json(
    {
      ...row,
      searchLikeCount: searchLike.length,
      searchLikeRows: searchLike,
      searchLikeSelectStarCount: searchLikeSelectStar.length,
      rawQ,
      trimmedQ,
      rawQCharCodes: rawQ ? Array.from(rawQ).map((c) => c.charCodeAt(0)) : null,
      viaRealFn1Count: viaRealFn1?.data?.length ?? null,
      viaRealFn1Error: viaRealFn1?.error ?? null,
      viaRealFn2Count: viaRealFn2?.data?.length ?? null,
      viaRealFn2Error: viaRealFn2?.error ?? null,
      timingMsFn1: t1 - t0,
      timingMsFn2: t2 - t1,
      explainPlan: explainRows[0]?.["QUERY PLAN"] ?? null,
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}
