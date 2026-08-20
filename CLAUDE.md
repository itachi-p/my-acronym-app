# CLAUDE.md

このリポジトリで作業する際の指示。

## 応答言語

応答は日本語で行うこと。

## `neon()` を新たに生成する箇所を追加する場合

`fetchOptions: { cache: "no-store" }` を必ず指定すること。
`@neondatabase/serverless` は内部でPOSTの`fetch()`を発行してSQLを
実行するが、これがNext.jsのサーバー内部Data Cacheの対象になり得る。
これを指定しないと、クエリ文言が変わらない限り古いレスポンスが
キャッシュされ続け、DBの実際の状態と食い違う結果を返し続ける
事象が起きる（詳細: `docs/decisions.md` 14章）。

## DBへの変更操作

DBを変更するSQL（DDL/DML）は実行せず、SQL文の提示のみ行うこと。

## `.env` / `.env.local` の値を要する検証

`.env` / `.env.local` の値を要する検証は行わず、人間が実行する
コマンドを提示すること。
