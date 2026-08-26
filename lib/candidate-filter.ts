// AI(Groq)登録候補のINSERT前フィルタリング。
// 機械判定(A1/D1/D2/D5)はここに集約する。D3(表記ゆれ正規化ユニーク
// 制約違反)はDB INSERT時のエラー捕捉でのみ検出できるため、ここには
// 含めない(呼び出し側=app/api/acronym/route.tsが担当)。
// LIMIT(1回のINSERT上限超過)も判定ロジックではなく件数の話なので
// ここでは定数のみ提供し、判定自体は呼び出し側で行う。
//
// この判定はAIによる自動登録の経路(app/api/acronym/route.ts)にのみ
// 適用する。手動登録(app/api/acronym/manual/route.ts)はこのモジュールを
// importしておらず、意図的に適用対象外(人間が意図して入力する経路の
// 暴走抑制は不要なため)。

export type RejectionReasonCode = "A1" | "D1" | "D2" | "D3" | "D5" | "LIMIT";

export interface CandidateInput {
  acronym: string;
  full_spelling: string;
  japanese_translation: string;
}

export interface MachineCheckFailure {
  reasonCode: RejectionReasonCode;
  reasonDetail: string;
}

// 許可リスト。A1/D1/D2の例外はすべてここにまとめる
// (後から追加する場合はこのオブジェクトだけを編集すればよい)。
export const CANDIDATE_ALLOWLIST = {
  // A1(短すぎる略語: 2文字以下)の例外となるacronym(大文字小文字を
  // 区別しない。判定側で候補のacronymを大文字化して比較する)。
  shortAcronyms: new Set<string>(["BS", "PL", "LP", "EV", "PH"]),

  // D1(名称不確実: full_spellingに「または」「/」を含む複数候補の併記)の
  // 例外となるacronym。PPAP = 「Password attached zip / Password /
  // Anti-virus / Protocol」はスラッシュ併記そのものが正式形であるため。
  d1MultiFormAcronyms: new Set<string>(["PPAP"]),

  // D2(自己言及: full_spellingがacronymをそのまま含む)の例外となる
  // full_spelling(完全一致)。「MIT License」はacronym「MIT」を含むが
  // 実在する正式な用語であるため。
  d2SelfReferenceFullSpellings: new Set<string>(["MIT License"]),
} as const;

const SHORT_ACRONYM_MAX_LENGTH = 2;

// A1: 短すぎる略語。2文字以下はGroqへのプロンプトでも対象外と
// 指示しているが(app/api/acronym/route.ts)、プロンプト指示だけでは
// Groqが従わなかった場合に挙動が再現しない(同じ略語で検索しても
// 拒否されたりされなかったりする)。ここで機械判定として決定的に
// 弾くことで、Groqの遵守に依存しない一貫した挙動にする。
function checkA1(candidate: CandidateInput): MachineCheckFailure | null {
  if (
    CANDIDATE_ALLOWLIST.shortAcronyms.has(candidate.acronym.toUpperCase())
  ) {
    return null;
  }

  if (candidate.acronym.length <= SHORT_ACRONYM_MAX_LENGTH) {
    return {
      reasonCode: "A1",
      reasonDetail: `略語が${SHORT_ACRONYM_MAX_LENGTH}文字以下: ${candidate.acronym}`,
    };
  }

  return null;
}

// 1回の検索でDBへ実際にINSERTする候補数の上限(既定3件)。
// Groqが返す生候補数の上限(MAX_RESULTS、app/api/acronym/route.ts)とは
// 別の値。機械判定を通過した候補がこれを超えた分はreason_code='LIMIT'で
// rejected_candidatesに記録し、INSERTしない。
export const MAX_INSERT_PER_SEARCH = 3;

// D1: 名称不確実。full_spellingに「または」「/」を含む複数候補の併記。
function checkD1(candidate: CandidateInput): MachineCheckFailure | null {
  if (CANDIDATE_ALLOWLIST.d1MultiFormAcronyms.has(candidate.acronym)) {
    return null;
  }

  if (
    candidate.full_spelling.includes("または") ||
    candidate.full_spelling.includes("/")
  ) {
    return {
      reasonCode: "D1",
      reasonDetail: `full_spellingに複数候補の併記(「または」または「/」)を含む: ${candidate.full_spelling}`,
    };
  }

  return null;
}

// D2: 自己言及。full_spellingがacronymをそのまま含む
// (略語の展開になっていない=単語を足しただけ・ブランド名の一部等)。
function checkD2(candidate: CandidateInput): MachineCheckFailure | null {
  if (
    CANDIDATE_ALLOWLIST.d2SelfReferenceFullSpellings.has(
      candidate.full_spelling
    )
  ) {
    return null;
  }

  if (
    candidate.full_spelling
      .toLowerCase()
      .includes(candidate.acronym.toLowerCase())
  ) {
    return {
      reasonCode: "D2",
      reasonDetail: `full_spellingがacronym「${candidate.acronym}」を自己言及的に含む: ${candidate.full_spelling}`,
    };
  }

  return null;
}

// D5: 訳が無意味。japanese_translationがacronymと同一、または空。
function checkD5(candidate: CandidateInput): MachineCheckFailure | null {
  const translation = candidate.japanese_translation.trim();

  if (translation === "") {
    return { reasonCode: "D5", reasonDetail: "japanese_translationが空" };
  }

  if (translation === candidate.acronym) {
    return {
      reasonCode: "D5",
      reasonDetail: `japanese_translationがacronymと同一: ${translation}`,
    };
  }

  return null;
}

// A1→D1→D2→D5の順に機械判定を行い、最初に該当したものを返す
// (複数該当しても記録する理由は1つに絞る)。該当なしはnull。
export function runMachineChecks(
  candidate: CandidateInput
): MachineCheckFailure | null {
  return (
    checkA1(candidate) ?? checkD1(candidate) ?? checkD2(candidate) ?? checkD5(candidate)
  );
}
