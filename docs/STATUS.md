# 実装状態サマリ

最終更新: 2026-08-23

このファイルの目的: 別セッション・別ツール（他のAIエージェント含む）が
このリポジトリで作業を再開する際、既存実装を把握せずに重複実装や
既存機能の破壊を行うことを防ぐこと。詳細な設計判断の経緯は
`decisions.md`、未着手項目は `TODO.md` を参照。

## スタック

- Next.js 14.2.35（App Router）、React 18、TypeScript、Tailwind CSS 3
- DB: Neon Postgres（`@neondatabase/serverless` のHTTPドライバ経由）
- AI: Groq（`openai/gpt-oss-120b`、`GROQ_API_KEY`必須）
- デプロイ: Vercel（リージョン: Singapore固定）

## ディレクトリ構成（主要ファイル）

```
app/
  layout.tsx              ルートレイアウト。manifest参照・メタタグ
  page.tsx                 検索UI・AI調査・手動登録。/reverseへの導線リンクあり
  reverse/page.tsx          逆引き（頭文字インデックス）画面。Server Componentのみ
  api/search/route.ts       GET /api/search?q= 検索
  api/acronym/route.ts      POST /api/acronym AI調査+一括登録
  api/acronym/manual/route.ts POST /api/acronym/manual 手動登録(1件)
lib/
  db-server.ts              Neon接続、検索/INSERT/逆引きクエリ
  reverse-index.ts          逆引き画面のキー正規化・並び替え・選択解決
  types.ts                  Acronym型、カテゴリ定義
public/
  manifest.json              PWAマニフェスト
  icons/icon-192.png, icon-512.png
docs/
  decisions.md               設計判断の経緯（why中心）
  TODO.md                    未着手タスク
db/
  schema.sql / seed.sql      DBスキーマ・シードデータ（Neon復元用、実行時には読まれない）
```

## 機能別の実装状態

### 検索
- `app/page.tsx` の `handleChange` から300msデバウンスで
  `GET /api/search?q=` を呼ぶ。**クエリ長2文字未満は検索しない**
  （`search()`関数内でガード、APIの`search/route.ts`側でも同様に
  2文字未満は空配列を返すガードが二重にある）
- 検索は `lower(acronym)` の前方一致（`lib/db-server.ts`
  `searchAcronyms`）。完全一致を前方一致より必ず先に並べる
  （`ORDER BY (lower(acronym) <> query), acronym, full_spelling`）
- `GET /api/search` は `dynamic = "force-dynamic"` +
  `Cache-Control: no-store` を明示しているが、これらは
  ブラウザ・CDN等リクエストの外側のキャッシュにしか効かない
  （理由: decisions.md 7章）。`@neondatabase/serverless` が
  内部で発行する`fetch()`はNext.jsのサーバー内部Data Cacheの
  対象になり得るため、`lib/db-server.ts` の `neon()` に
  `fetchOptions: { cache: "no-store" }` を別途指定している
  （理由: decisions.md 14章）
- カテゴリタブ（`すべて`/`ビジネス・経営`/...）はクライアント側で
  `results` を絞り込むフィルタ。新しい検索語を打ち始めると
  `すべて` にリセットされる

### Enterキー（2026-08-19実装）
- 検索欄は`<form>`に包まれておらず、`onKeyDown={handleSearchKeyDown}`
  で個別にハンドリング（`app/page.tsx`）
- **結果0件のときのみ**、EnterでAI調査+登録（`handleAiGenerate`）を
  実行する。発火条件はAIボタンの表示条件と完全に一致させている
  （`query.length >= 2 && !loading && !searchError &&
  results.length === 0 && !aiLoading`）
- 結果が1件以上ある状態でのEnterは**何もしない**（誤操作によるAI調査を防ぐ）
- IME変換確定のEnterは無視する（`onCompositionStart`/`onCompositionEnd`
  のrefフラグ + `e.nativeEvent.isComposing` の両方を見ている）
- 手動登録フォーム（`manualFormOpen`時に出る別の`<form
  onSubmit={handleManualSubmit}>`）のEnter挙動は変更していない。
  検索欄のEnterとは独立
- 詳細: decisions.md 11章

### AI調査+登録（`POST /api/acronym`）
- Groqに略語を渡し、`{ results: [...] }` 形式で1〜4件の解釈を
  取得。トップレベルをオブジェクトにしているのはGroqの
  `response_format: json_object` の制約による
- 一括INSERTは `ON CONFLICT (lower(acronym), lower(full_spelling))
  DO NOTHING`。既存行は戻り値に含まれない（`RETURNING *`）
- 登録直後は `GET /api/search` を再度叩かず、POSTのレスポンス
  （実際に登録された行）をそのままUIに反映する
  （理由: キャッシュによる空配列問題、decisions.md 7章）
- 結果0件（`results.length===0`）のときのみUIにボタン表示。
  Enterキーもこの条件と揃えている
- **`dryRun`対応（2026-08-21）**: bodyの`{ "dryRun": true }`、
  またはクエリの`?dryRun=1`/`?dryRun=true`のいずれかが真のとき、
  Groq呼び出し・結果整形は通常通り行うが、DBへのINSERTを一切
  行わない。読み取りは元々このエンドポイントに存在しない
  （重複判定はDBのUNIQUE制約 + `ON CONFLICT DO NOTHING`）。
  レスポンスは通常時と同じ配列形状で、各要素に`dryRun: true`が
  追加される。`id`/`created_at`は実DB行が無いためその場で仮生成
  した値（実在するIDではない）。`dryRun`未指定・偽の場合の挙動は
  完全に従来通り。`SYSTEM_PROMPT`検証時に本番DBを汚さず繰り返す
  ための機能。詳細: decisions.md 16章

### 手動登録（`POST /api/acronym/manual`）
- AI一括登録とは別エンドポイント。1件のみ登録
- `(lower(acronym), lower(full_spelling))` が重複する場合、
  AI側の黙ったスキップと異なり**409を明示的に返す**
  （人間の意図的な単発操作のため）
- UI導線は検索語が2文字以上の間、`results.length`に関わらず
  常時表示（「✍️ 手動で登録」/「✍️ 別の意味を手動で追加」）

### 大文字小文字の扱い（2026-08-19改訂）
- `lib/normalize-acronym.ts` の `normalizeAcronymCasing` で、入力に
  大文字が1文字も含まれない場合のみ全大文字化する（bbs→BBS）。
  1文字でも大文字を含む場合はそのまま保存・AIへ渡す
  （TOCfE/IoT/mRNAのような大小混在表記を保持するため）
- AI調査（`POST /api/acronym`）・手動登録
  （`POST /api/acronym/manual`）の両経路がこの関数を通る。
  AI調査側はGroqへ渡す前・DB保存前の両方に適用（`acronym`変数を
  正規化後、Groqプロンプトと`insertAcronyms`双方に使い回している）
- 一意性・検索・重複判定はすべて `lower()` を通した比較
  （UNIQUEインデックス、検索LIKE句とも）。この部分は今回変更していない
- 詳細: decisions.md 12章

### `?q=` ディープリンク起動
- `app/page.tsx` の起動時`useEffect`で `window.location.search`
  から `q` を読む
- `q`なし: 通常通り入力欄へフォーカスするのみ（挙動変更なし）
- `q`あり: `setQuery(q)` の上で即座に検索を実行。1件ヒットなら
  詳細（`selected`）を自動オープン
- 外部入口（ショートカット・共有シート・ブックマーク等）の
  **共通の受け口**として設計。入口ごとの個別実装は不要
  （decisions.md 9章）

### 結果表示
- 検索結果一覧はカード形式。クリックで詳細をポップアップ
  （オーバーレイ）表示。背景タップまたは✕で閉じる
- 詳細にはWikipedia検索リンク・Google検索リンクを表示。
  リンクURLはDBに保存せず、`full_spelling`/`acronym`から
  都度クライアント側で組み立てる（decisions.md 6章）

### 逆引き（頭文字インデックス）画面（2026-08-23実装）
- ルート: `GET /reverse`（`?key=`で選択キーを渡す。Server Component
  のみ、`useSearchParams`は未使用。状態はURLクエリパラメータのみ）
- キー分類式`ACRONYM_INDEX_KEY_EXPR`（`lib/db-server.ts`）が
  唯一の定義箇所。集計（`getAcronymIndexCounts`）・一覧
  （`getAcronymsByIndexKey`）の両クエリがこれだけを参照する
- 分類ルール: 前後空白（半角・全角U+3000・NBSP U+00A0・タブ・改行）
  を除去後の先頭1文字を大文字化し、A-Zは単独キー、0-9は`'0-9'`
  に集約、それ以外（記号・全角文字・空文字化するレコード等）は
  `'#'`に集約。NULL/空文字は集計・一覧の両方から除外
- 一覧の絞り込みはLIKEではなく`ACRONYM_INDEX_KEY_EXPR`との等値比較
  （3章参照）。並び順はアクロニムの大文字化・トリム後の昇順＋
  `full_spelling`・`id`のタイブレーカー
- インデックスバーの表示順（'0-9'→'A'〜'Z'→'#'）はSQLの
  `ORDER BY`ではなく`lib/reverse-index.ts`の`sortIndexKeyCounts`
  がアプリ側で固定する（DB collation非依存）
- キー選択の妥当性判定・レコード集合の解決は
  `lib/reverse-index.ts`の`resolveIndexSelection`1箇所に閉じ込め。
  不正・未指定キーは404にせず「上のキーを選んでください」表示
- 集計クエリと一覧クエリは並列に取得（キーの妥当性確定前から
  一覧クエリも投げておき、確定後に描画へ使うか判断する）。
  一覧部分は`<Suspense key={selectedKey}>`で包み、キー切替時に
  再サスペンドするようにしている
- 各レコードの「詳細を見る」は独立した詳細ルートではなく、既存の
  `?q=`ディープリンク機構（`app/page.tsx`、9章）へのリンク
  （`/?q=<acronym>`）を再利用している（詳細: decisions.md 17章）
- 2文字目以降での絞り込み・あいまい検索・ページネーションは
  未実装（YAGNI、TODO.md参照）

## PWA化の状態

- `public/manifest.json` あり: name/short_name/icons(192・512)/
  start_url("/")/display("standalone")/theme_color/background_color/
  lang("ja") すべて設定済み
- `app/layout.tsx` で `metadata.manifest` 参照、
  `metadata.appleWebApp`（capable/statusBarStyle/title）設定済み、
  `<link rel="apple-touch-icon">` も明示
- **Service Workerは未実装**（`sw.js`等のファイルなし、
  `next-pwa`/`workbox`等の依存もなし、登録コードもなし）。
  マニフェスト・アイコン・メタタグは揃っているが、
  **オフラインキャッシュは一切機能しない**
- `manifest.json` に `share_target` はない。
  iOS Safariでは`share_target`自体が機能しないため意図的に未実装
  （TODO.md「アプリ外からの入口整備」参照）

## 既知の制約

- Neon無料プランは90日非アクティブでプロジェクト削除対象。
  `db/seed.sql`・`db/schema.sql`から復元可能な状態を維持すること
- Neon無料枠は5分非アクティブでコンピュートがスケールゼロし、
  コールドスタートで500ms〜2秒かかることがある（速度目的の移行ではない）

## 未着手（詳細はTODO.md）

- 検索結果が期待と違った場合の、AI側への再調査導線
- アプリ外からの入口整備（ホームウィジェットは技術的に不可能と判明。
  ?q=方式／API直接呼び出し方式の使い分けを計画中）

## 直近コミット（2026-08-19時点、新しい順）

```
8153cd1 fix(ui): revert search input to full-width
468b4c5 chore(pwa): replace placeholder icon with ferret mascot artwork
4313e99 feat(ui): support ?q= deep-link launch and popup-style result view
dc07b07 fix(search): prioritize exact acronym matches, reset stale category filter
40cab3a feat(acronym): preserve input casing, match uniqueness case-insensitively
f957b88 docs: sync TODO, decision log, and seed.sql with today's changes
0789c72 feat(acronym): add manual registration for AI-unreachable meanings
09d1b04 docs: add TODO for manual registration and re-lookup flow
ca3fda4 feat(acronym): support multiple genre-crossing meanings per acronym
fc86568 docs: refresh seed.sql with current Neon data (12 rows)
ba40d42 chore(vercel): pin deployment region to Singapore
14e29a1 feat(ai): enforce Japanese translation format and derive links client-side
```

（このコミット一覧はスナップショットであり、更新の都度メンテナンスは
しない。最新の履歴は `git log` を直接参照すること）
