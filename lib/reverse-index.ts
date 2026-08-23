import type { IndexKeyCount } from "./db-server";

// 表示順: '0-9' → 'A'〜'Z' → '#'。DB/ロケールのcollationに依存させず
// アプリ側で固定する。
const KEY_ORDER = [
  "0-9",
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  "#",
];

export function sortIndexKeyCounts(counts: IndexKeyCount[]): IndexKeyCount[] {
  return [...counts].sort(
    (a, b) => KEY_ORDER.indexOf(a.key) - KEY_ORDER.indexOf(b.key)
  );
}

// searchParamsの値は string | string[] | undefined。配列(パラメータの
// 重複指定)時は先頭要素を採用する。大文字化しておくことで、キーは
// 元々ケース非依存(A-Zの単独キー、'0-9'、'#')なので小文字入力
// (例: ?key=a)も対応するキーとして解決できる。
export function normalizeIndexKeyParam(
  raw: string | string[] | undefined
): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return first?.toUpperCase();
}

// キー選択から表示レコード集合を解決する処理をこの1箇所に閉じ込める。
// 将来2文字目以降での絞り込みに拡張する際の変更点をここに局所化するため
// (今回その機能自体は実装しない)。
// 妥当性は集計クエリで得られたキー集合への所属チェックのみで行う。
// 未指定・不正なキーはnullを返し、呼び出し側は404にせず未選択/該当なし
// 状態として扱う。
export function resolveIndexSelection(
  normalizedKey: string | undefined,
  availableKeys: string[]
): string | null {
  if (!normalizedKey) return null;
  return availableKeys.includes(normalizedKey) ? normalizedKey : null;
}
