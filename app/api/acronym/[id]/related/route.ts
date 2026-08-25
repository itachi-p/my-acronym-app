import { NextRequest, NextResponse } from "next/server";
import { getAcronymRelated } from "@/lib/db-server";

// 詳細表示を開いた時点で、ホモニム(同義語衝突)と概念的関連の両方を
// まとめて返す単一エンドポイント。タグ自体は一覧・検索の時点で
// 各レコードに同梱済みのため、ここでは含めない。
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    if (!UUID_RE.test(params.id)) {
      return NextResponse.json(
        { error: "不正なIDです" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { data, error } = await getAcronymRelated(params.id);

    if (error || !data) {
      console.error("[Acronym Related]", error);

      return NextResponse.json(
        { error: error?.message ?? "取得に失敗しました" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[Acronym Related] Unexpected", err);

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
