import { NextRequest, NextResponse } from "next/server";
import { searchAcronyms } from "@/lib/db-server";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim().toUpperCase() ?? "";

    if (query.length < 2) {
      return NextResponse.json([]);
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
        }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[Search] Unexpected", err);

    return NextResponse.json(
      {
        error: "Internal Server Error",
      },
      {
        status: 500,
      }
    );
  }
}
