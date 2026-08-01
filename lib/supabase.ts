import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Acronym } from "./types";

let supabaseInstance: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set"
      );
    }

    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }

  return supabaseInstance;
}

export async function fetchAllAcronyms(): Promise<Acronym[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("acronyms")
    .select("*")
    .order("acronym", { ascending: true });

  if (error) {
    console.error("Failed to fetch acronyms:", error.message);
    return [];
  }

  return (data as Acronym[]) ?? [];
}

export async function insertAcronym(
  acronym: Omit<Acronym, "id" | "created_at">
): Promise<Acronym | null> {
  const supabase = getSupabase();

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
