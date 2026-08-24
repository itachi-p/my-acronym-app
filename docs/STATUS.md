# 実装状態サマリ

最終更新: 2026-08-24

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
  reverse/page.tsx          逆引き（頭文字インデックス）画面。データ取得はServer Component
  reverse/ResultBrowser.tsx 逆引き結果の一覧→タップ展開UI（Client Component、2026-08-24）
  api/search/route.ts       GET /api/search?q= 検索
  api/acronym/route.ts      POST /api/acronym AI調査+一括登録
  api/acronym/manual/route.ts POST /api/acronym/manual 手動登録(1件)
lib/
  db-server.ts              Neon接続、検索/INSERT/逆引きクエリ
  reverse-index.ts          逆引き画面のキー正規化・並び替え・選択解決
  types.ts                  Acronym型、カテゴリ定義（現状の唯一のカテゴリ定義箇所）
public/
  manifest.json              PWAマニフェスト
  icons/icon-192.png, icon-512.png
docs/
  decisions.md               設計判断の経緯（why中心）
  TODO.md                    未着手タスク
  proposals/category-taxonomy.md  カテゴリのタグ方式移行案（未確定、提案段階）
db/
  schema.sql                 手書きDDL（Neon復元用、実行時には読まれない。tags/acronym_tagsは未反映で古い）
  schema-snapshot.txt        Neon本番DBからの機械出力スナップショット（生成物、手編集禁止。DBの正）
  seed.sql                   シードデータ
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

### 逆引き（頭文字インデックス）画面（2026-08-23実装、2026-08-24改訂）
- ルート: `GET /reverse`（`?key=`で選択キーを渡す。データ取得・
  検索パラメータの解決はServer Component、`useSearchParams`は未使用。
  状態はURLクエリパラメータのみ）
- 結果一覧は`app/reverse/ResultBrowser.tsx`（Client Component）が
  担当。略語名＋日本語訳のみのコンパクトな行を並べ、タップした
  1件だけをその場に展開するアコーディオン方式（常に開くのは最大
  1件）。登録件数が増えても縦スクロールが長くなりすぎないための
  変更（詳細: decisions.md 18章）。ページ自体がServer Componentの
  みという17章の記述は、この一覧部分に限りClient Componentへ変更
  されている（データ取得自体は従来どおりServer Componentが担う）
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

### カテゴリ / タグの実装状態（2026-08-24調査）

- アプリは現状**すべて`acronyms.category`（text + CHECK制約6値）
  だけを見て動作している**。カテゴリ6値の唯一の定義箇所は
  `lib/types.ts`の`CATEGORIES`配列（1-9行目）。`AcronymCategory`型・
  `ACRONYM_CATEGORIES`・`CATEGORY_DISPLAY_NAMES`はすべてここから
  導出され、UIのカテゴリタブ（`app/page.tsx:369-381`）、Groqへの
  プロンプト埋め込み（`app/api/acronym/route.ts:63-65`）、AI結果の
  正規化（同ファイル`normalizeCategory`, 70-76行目、不正値は
  黙って「その他」にフォールバック）、手動登録のバリデーション
  （`app/api/acronym/manual/route.ts:30`, 不正値は400エラー）が
  すべてこの1箇所を参照している。zod等のスキーマバリデーション
  ライブラリは未導入で、素のTS配列比較のみで検証している
- 本番DBには`tags`/`acronym_tags`テーブルが**運用者により追加済み**
  （現行6カテゴリと同名のタグ6件、既存130件全件にis_primaryタグ
  1件ずつ紐付け済み）。ただし**アプリケーションコードはこれらを
  一切参照していない**（追加のみで未使用）。移行案は
  `docs/proposals/category-taxonomy.md`を参照
- 検索（`GET /api/search`→`searchAcronyms`）はカテゴリで絞り込んで
  いない（`lower(acronym)`前方一致のみ）。カテゴリタブは取得済み
  `results`をクライアント側で絞り込むフィルタに過ぎないため、
  「その他」カテゴリのレコードも通常の略語検索・`/reverse`の
  どちらからも他カテゴリと同様に到達できる（検索結果を絞り込む
  経路としてのみカテゴリボタンが機能し、カテゴリボタン経由でしか
  到達できないレコードは存在しない）

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

## DBスキーマの同期（2026-08-24）

- `db/schema-snapshot.txt`が**DBの正**。Neon本番DB
  （プロジェクト my-acronym-app / branch: production / database:
  neondb）から機械的に出力したカラム・制約・インデックスの一覧で、
  **生成物のため人間もCodeも手編集しない**
- `db/schema.sql`は手書きのDDL（初期構築用）で、`tags`/
  `acronym_tags`テーブルが未反映のまま古くなっている
  （差分は下記「スナップショットとschema.sqlの差分」参照）。
  `schema.sql`を書き換えて追従させる作業は今回のスコープ外とし、
  差分の報告に留めている。書き換える場合は運用者の判断を仰ぐこと
- リポジトリと実DBの内容が食い違う場合は`schema-snapshot.txt`
  （＝実DB）を正とし、リポジトリ側を古いとみなすこと

### スナップショットとschema.sqlの差分（2026-08-24時点）

- `tags`テーブル全体が`schema.sql`に存在しない
  （id/name/display_group/sort_order/is_active/created_at）
- `acronym_tags`テーブル全体が`schema.sql`に存在しない
  （acronym_id/tag_id/is_primary/created_at、FK制約2件、
  PRIMARY KEY、部分UNIQUEインデックス`acronym_tags_one_primary`、
  `idx_acronym_tags_tag_id`）
- `acronyms`テーブル自体（カラム・`acronyms_category_check`・
  `acronyms_acronym_full_spelling_ci_unique`・
  `idx_acronyms_acronym_prefix`）は両者で一致しており差分なし

### スナップショットの再取得手順

DBを変更した際は、Neonコンソール（またはpsql）で以下3クエリを
この順に実行し、出力を結合して`db/schema-snapshot.txt`を上書きする
（現行ファイルもこの3クエリに相当する内容で構成されている）。

```sql
-- (1) カラム一覧
SELECT table_name || '.' || column_name || ' : ' || data_type ||
       ' NULL=' || is_nullable ||
       ' DEFAULT=' || COALESCE(column_default, '-') AS line
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, column_name;

-- (2) 制約一覧
SELECT conrelid::regclass::text || ' CONSTRAINT ' || conname ||
       ' : ' || pg_get_constraintdef(oid) AS line
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

-- (3) インデックス一覧
SELECT tablename || ' INDEX ' || indexname || ' : ' || indexdef AS line
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

（このリポジトリでは.envの値を要するDB接続をCode側からは
行わない方針のため、実行と`db/schema-snapshot.txt`への反映は
運用者が行うこと）

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
