// 入力に大文字が1文字も含まれない場合のみ全大文字化する。
// 1文字でも大文字を含む場合（TOCfE/IoT/eSIM/mRNA/pHなど）は
// 入力表記のまま保持する（decisions.md参照）。
export function normalizeAcronymCasing(acronym: string): string {
  return /[A-Z]/.test(acronym) ? acronym : acronym.toUpperCase();
}
