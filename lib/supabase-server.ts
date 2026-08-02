import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Acronym } from "./types";

export type SupabaseEnvCheck = {
  ok: boolean;
  missing: string[];
};

export type InsertAcronymResult =
  | { success: true; data: Acronym }
  | {
      success: false;
      error: {
        message: string;
        code?: string;
        hint?: string;
        details?: string;
      };
    };

export function checkSupabaseEnv(): SupabaseEnvCheck {
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return { ok: missing.length === 0, missing };
}

export function createServerSupabaseClient(): SupabaseClient {
  const env = checkSupabaseEnv();
  if (!env.ok) {
    throw new Error(
      `Supabase env vars missing: ${env.missing.join(", ")}`
    );
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function insertAcronymServer(
  acronym: Omit<Acronym, "id" | "created_at">
): Promise<InsertAcronymResult> {
  let supabase: SupabaseClient;

  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Supabase] Client initialization failed:", message);
    return {
      success: false,
      error: { message: `Supabase client init failed: ${message}` },
    };
  }

  console.error("[Supabase] Inserting acronym:", acronym.acronym);

  const { data, error } = await supabase
    .from("acronyms")
    .insert(acronym)
    .select()
    .single();

  if (error) {
    console.error("[Supabase] INSERT failed:", {
      message: error.message,
      code: error.code,
      hint: error.hint,
      details: error.details,
    });

    const isRlsError =
      error.code === "42501" ||
      error.message.toLowerCase().includes("row-level security") ||
      error.message.toLowerCase().includes("policy");

    return {
      success: false,
      error: {
        message: isRlsError
          ? `RLS policy blocked INSERT: ${error.message}`
          : error.message,
        code: error.code,
        hint: isRlsError
          ? "Run the RLS policy SQL in schema.sql (see bottom section) in Supabase SQL Editor."
          : error.hint,
        details: error.details,
      },
    };
  }

  console.error("[Supabase] INSERT succeeded:", data?.id);
  return { success: true, data: data as Acronym };
}
