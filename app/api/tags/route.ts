import { NextResponse } from "next/server";
import { getActiveTags, getDisplayGroups } from "@/lib/db-server";

// タグ一覧・表示グループ一覧は登録内容の変化に追従する必要があるため
// app/api/search/route.ts と同じ方針でキャッシュを無効化する。
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [tagsResult, groupsResult] = await Promise.all([
      getActiveTags(),
      getDisplayGroups(),
    ]);

    if (tagsResult.error || !tagsResult.data) {
      console.error("[Tags API]", tagsResult.error);

      return NextResponse.json(
        { error: tagsResult.error?.message ?? "タグ一覧の取得に失敗しました" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (groupsResult.error || !groupsResult.data) {
      console.error("[Tags API]", groupsResult.error);

      return NextResponse.json(
        {
          error:
            groupsResult.error?.message ?? "表示グループの取得に失敗しました",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { tags: tagsResult.data, displayGroups: groupsResult.data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[Tags API] Unexpected", err);

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
