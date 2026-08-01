export const CATEGORIES = [
  "すべて",
  "ビジネス・経営",
  "金融・株式",
  "政治・行政",
  "軍事・安全保障",
  "IT・テクノロジー",
  "その他",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type AcronymCategory = Exclude<Category, "すべて">;

export interface Acronym {
  id: string;
  acronym: string;
  full_spelling: string;
  reading: string;
  japanese_translation: string;
  category: AcronymCategory;
  description: string;
  created_at: string;
}

export interface GeminiAcronymResponse {
  acronym: string;
  full_spelling: string;
  reading: string;
  japanese_translation: string;
  category: AcronymCategory;
  description: string;
}
