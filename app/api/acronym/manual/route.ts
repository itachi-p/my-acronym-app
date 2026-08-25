import { NextRequest, NextResponse } from "next/server";
import { getActiveTags, insertAcronyms } from "@/lib/db-server";
import { normalizeAcronymCasing } from "@/lib/normalize-acronym";

const MAX_TAGS = 3;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 大文字を1文字も含まない入力（bbs/seo等）のみ全大文字化する。
    // TOCfEのような大小混在表記はそのまま保存する
    // （normalizeAcronymCasing参照。decisions.md参照）。
    const acronym = normalizeAcronymCasing(String(body.acronym ?? "").trim());
    const full_spelling = String(body.full_spelling ?? "").trim();
    const japanese_translation = String(body.japanese_translation ?? "").trim();
    const description = String(body.description ?? "").trim();

    // tags[0]が主タグ、残りが副タグ。クライアントは主タグ選択+
    // 副タグ選択(任意)からこの配列を組み立てて送る。
    const rawTags = Array.isArray(body.tags) ? body.tags : [];
    const tags = Array.from(
      new Set(
        rawTags
          .map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
          .filter((t: string) => t !== "")
      )
    ).slice(0, MAX_TAGS) as string[];

    if (!acronym || !full_spelling || !japanese_translation || !description) {
      return NextResponse.json(
        {
          error: "すべての項目を入力してください",
        },
        {
          status: 400,
        }
      );
    }

    if (tags.length === 0) {
      return NextResponse.json(
        {
          error: "タグを1つ以上選択してください",
        },
        {
          status: 400,
        }
      );
    }

    const { data: tagRows, error: tagsError } = await getActiveTags();

    if (tagsError || !tagRows) {
      console.error("[Manual Tags Fetch Error]", tagsError);

      return NextResponse.json(
        {
          error: "タグ一覧の取得に失敗しました",
        },
        {
          status: 500,
        }
      );
    }

    const validTagNames = new Set(tagRows.map((t) => t.name));
    const invalidTag = tags.find((t) => !validTagNames.has(t));

    if (invalidTag) {
      return NextResponse.json(
        {
          error: `タグが不正です: ${invalidTag}`,
        },
        {
          status: 400,
        }
      );
    }

    const { data, error } = await insertAcronyms([
      {
        acronym,
        full_spelling,
        japanese_translation,
        description,
        tags,
      },
    ]);

    if (error) {
      console.error("[Manual Insert Error]", error);

      return NextResponse.json(
        {
          error: "DB保存に失敗しました",
          detail: error.message,
        },
        {
          status: 500,
        }
      );
    }

    // lower(acronym), lower(full_spelling)の大文字小文字を無視した
    // UNIQUEインデックスに抵触した場合、insertAcronymsはON CONFLICT
    // DO NOTHINGで黙ってスキップするため返り値が空配列になる。
    // 手動登録は人間による単発の意図的な操作なので、AIの一括登録と
    // 違って黙って無視せず、重複である旨を明示的にエラーで返す。
    if (!data || data.length === 0) {
      return NextResponse.json(
        {
          error: "同じ略語・正式名称の組み合わせは既に登録されています",
        },
        {
          status: 409,
        }
      );
    }

    return NextResponse.json(data[0]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    console.error("[Manual Acronym API Error]", error);

    return NextResponse.json(
      {
        error: "サーバーエラーが発生しました",
        detail: message,
      },
      {
        status: 500,
      }
    );
  }
}
