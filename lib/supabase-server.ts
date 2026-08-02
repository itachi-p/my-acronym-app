import { createClient } from "@supabase/supabase-js";
import type { Acronym } from "./types";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function searchAcronyms(query: string) {
  const upperQuery = query.toUpperCase();
  return supabase
    .from("acronyms")
    .select("*")
    .eq("acronym", upperQuery)
    .maybeSingle();
}

export async function findAcronym(acronym: string) {
  return supabase
    .from("acronyms")
    .select("*")
    .eq("acronym", acronym.toUpperCase())
    .maybeSingle();
}

export async function insertAcronym(acronym: Omit<Acronym, "id" | "created_at">) {
  return supabase.from("acronyms").insert(acronym).select().single();
}
