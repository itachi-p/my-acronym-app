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

export const CATEGORY_DISPLAY_NAMES: Record<Category, string> = {
  "すべて": "すべて",
  "ビジネス・経営": "経営",
  "金融・株式": "金融",
  "政治・行政": "政治",
  "軍事・安全保障": "軍事",
  "IT・テクノロジー": "IT",
  "その他": "その他",
};

export interface Acronym {
  id: string;
  acronym: string;
  full_spelling: string;
  japanese_translation: string;
  category: AcronymCategory;
  description: string;
  created_at: string;
}

// AIが返す1つの解釈。同一acronymが複数の意味を持つ場合、
// これの配列 ({ results: AiAcronymResult[] }) がAPIレスポンスになる。
export interface AiAcronymResult {
  full_spelling: string;
  japanese_translation: string;
  category: AcronymCategory;
  description: string;
}
