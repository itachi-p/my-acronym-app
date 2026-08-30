import { defineConfig } from "@playwright/test";

// lib/以下の純粋関数(DB・Groq APIを叩かない判定ロジック等)向けの
// テスト設定。playwright.config.ts(e2e/、webServerでnext devを自動
// 起動しDB到達性を要求する)とは別configに分離し、ブラウザ起動も
// APIキーもDB接続も不要にする(candidate-filter.tsの機械判定は
// 純粋関数のため、ページ操作もサーバー起動も要らない)。
export default defineConfig({
  testDir: "./lib/__tests__",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
});
