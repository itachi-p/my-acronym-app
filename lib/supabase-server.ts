import { createClient } from "@supabase/supabase-js";
import type { Acronym } from "./types";

export function createServerSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(supabaseUrl, supabaseAnonKey);
}

export async function insertAcronymServer(
  acronym: Omit<Acronym, "id" | "created_at">
): Promise<Acronym | null> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("acronyms")
    .insert(acronym)
    .select()
    .single();

  if (error) {
    console.error("Failed to insert acronym:", error.message);
    return null;
  }

  return data as Acronym;
}
