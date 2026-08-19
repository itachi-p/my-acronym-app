import { NextRequest, NextResponse } from "next/server";
import { searchAcronyms } from "@/lib/db-server";

// 検索結果は常に最新のDB状態を返す必要がある。
// AI登録直後に同じクエリで再検索すると、登録前に得た空配列の
// レスポンスがブラウザ/CDN等の中間キャッシュに残っていて
// それが返ってしまう事象が本番で発生したため、明示的に
// キャッシュを無効化する。
// - `dynamic = "force-dynamic"`: Next.jsのFull Route Cache/
//   静的最適化を明示的に無効化する（request.nextUrl使用により
//   実質的には既に動的評価されるが、意図を明示し将来の変更で
//   静的化されることを防ぐ）
// - `Cache-Control: no-store`: Next.js自身のキャッシュとは別に、
//   ブラウザやVercelのCDN/エッジなど、HTTPのCache-Controlヘッダを
//   見る中間層すべてに対してキャッシュ禁止を明示する
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

    if (query.length < 2) {
      return NextResponse.json([], {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const { data, error } = await searchAcronyms(query);

    if (error) {
      console.error("[Search]", error);

      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    return NextResponse.json(data ?? [], {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[Search] Unexpected", err);

    return NextResponse.json(
      {
        error: "Internal Server Error",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
