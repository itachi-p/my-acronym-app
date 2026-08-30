import { test, expect } from "@playwright/test";
import { runMachineChecks, type CandidateInput } from "../candidate-filter";

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    acronym: "XYZ",
    full_spelling: "Example Full Spelling",
    japanese_translation: "例の日本語訳",
    scope_fit: "in",
    scope_reason: "経営・金融の主軸に合致",
    ...overrides,
  };
}

test.describe("S1: 収録範囲外", () => {
  test("scope_fit=outは3文字以上でもS1で棄却される", () => {
    const failure = runMachineChecks(
      candidate({
        acronym: "MP1",
        full_spelling: "MPEG-1 Audio Layer I",
        scope_fit: "out",
        scope_reason: "音楽コーデックでありビジネス・経営と無関係",
      })
    );

    expect(failure?.reasonCode).toBe("S1");
    expect(failure?.reasonDetail).toContain(
      "音楽コーデックでありビジネス・経営と無関係"
    );
  });

  test("scope_fit=inは登録可能(null)", () => {
    const failure = runMachineChecks(
      candidate({
        acronym: "ESG",
        full_spelling: "Environmental, Social and Governance",
        scope_fit: "in",
        scope_reason: "投資・経営の中核用語",
      })
    );

    expect(failure).toBeNull();
  });

  test("scope_fitが未指定(フィールド欠落)はfail-openで通過する", () => {
    const failure = runMachineChecks(
      candidate({ scope_fit: undefined, scope_reason: undefined })
    );

    expect(failure).toBeNull();
  });
});

test.describe("優先順位: D2 → 文字数(A1) → S1 → D5", () => {
  test("1文字略語はscope_fit=inでもA1で棄却される", () => {
    const failure = runMachineChecks(
      candidate({ acronym: "V", scope_fit: "in" })
    );

    expect(failure?.reasonCode).toBe("A1");
  });

  test("自己言及(D2)はscope_fit=outより優先して報告される", () => {
    const failure = runMachineChecks(
      candidate({
        acronym: "NAV",
        full_spelling: "NAV System",
        scope_fit: "out",
      })
    );

    expect(failure?.reasonCode).toBe("D2");
  });

  test("D2に該当しない場合、S1がD5より先に報告される", () => {
    const failure = runMachineChecks(
      candidate({
        acronym: "TDD",
        full_spelling: "Temporomandibular Disorder Diagnosis",
        japanese_translation: "",
        scope_fit: "out",
        scope_reason: "専門医学用語で社会問題と結びつかない",
      })
    );

    expect(failure?.reasonCode).toBe("S1");
  });
});

test.describe("既存の機械判定に回帰が無いこと", () => {
  test("D2(自己言及)は従来どおり検出される", () => {
    const failure = runMachineChecks(
      candidate({ acronym: "BIO", full_spelling: "Biology" })
    );

    expect(failure?.reasonCode).toBe("D2");
  });

  test("2文字の許可リスト(BS)はscope_fit未指定でも通過する", () => {
    const failure = runMachineChecks(
      candidate({
        acronym: "BS",
        full_spelling: "Broadcast Satellite",
        scope_fit: undefined,
      })
    );

    expect(failure).toBeNull();
  });

  test("2文字で許可リスト外はA1で棄却される(scope_fitに関わらず)", () => {
    const failure = runMachineChecks(
      candidate({ acronym: "CX", scope_fit: "in" })
    );

    expect(failure?.reasonCode).toBe("A1");
  });
});
