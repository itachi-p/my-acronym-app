// UIの「すべて」タブ用センチネル。DBのdisplay_groupには存在しない。
export const ALL_DISPLAY_GROUP = "すべて";

export interface Tag {
  id: string;
  name: string;
  display_group: string;
  sort_order: number;
}

export interface AcronymTag extends Tag {
  is_primary: boolean;
}

export interface DisplayGroup {
  name: string;
  sort_order: number;
}

export interface Acronym {
  id: string;
  acronym: string;
  full_spelling: string;
  japanese_translation: string;
  description: string;
  created_at: string;
  tags: AcronymTag[];
}

export function getPrimaryTag(tags: AcronymTag[]): AcronymTag | undefined {
  return tags.find((tag) => tag.is_primary);
}

export interface Homonym {
  id: string;
  acronym: string;
  full_spelling: string;
  japanese_translation: string;
}

export interface AcronymRelation {
  id: string;
  relation_note: string | null;
  related: Homonym;
}

export interface AcronymRelated {
  homonyms: Homonym[];
  relations: AcronymRelation[];
}

// AIが返す1つの解釈。同一acronymが複数の意味を持つ場合、
// これの配列 ({ results: AiAcronymResult[] }) がAPIレスポンスになる。
// tags[0] が主タグ、残りが副タグ(0〜2件程度)。
export interface AiAcronymResult {
  full_spelling: string;
  japanese_translation: string;
  tags: string[];
  description: string;
}
