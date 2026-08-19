import { NextRequest, NextResponse } from "next/server";
import { ACRONYM_CATEGORIES, type AcronymCategory } from "@/lib/types";
import { insertAcronyms } from "@/lib/db-server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const acronym = String(body.acronym ?? "").trim().toUpperCase();
    const full_spelling = String(body.full_spelling ?? "").trim();
    const japanese_translation = String(body.japanese_translation ?? "").trim();
    const category = String(body.category ?? "");
    const description = String(body.description ?? "").trim();

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

    if (!ACRONYM_CATEGORIES.includes(category as AcronymCategory)) {
      return NextResponse.json(
        {
          error: "カテゴリが不正です",
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
        category: category as AcronymCategory,
        description,
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

    // (acronym, full_spelling) の複合UNIQUE制約に抵触した場合、
    // insertAcronymsはON CONFLICT DO NOTHINGで黙ってスキップするため
    // 返り値が空配列になる。手動登録は人間による単発の意図的な操作
    // なので、AIの一括登録と違って黙って無視せず、重複である旨を
    // 明示的にエラーで返す。
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
