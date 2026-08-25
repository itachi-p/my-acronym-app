# 実装状態サマリ

最終更新: 2026-08-26

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
                            (2026-08-26: useSearchParamsで反応的に。Suspense境界必須)
  reverse/page.tsx          逆引き（頭文字インデックス）画面。データ取得はServer Component
  reverse/ResultBrowser.tsx 逆引き結果の一覧→タップ展開UI（Client Component、2026-08-24）
  api/search/route.ts       GET /api/search?q= 検索（タグ同梱、2026-08-26）
  api/acronym/route.ts      POST /api/acronym AI調査+一括登録（複数タグ対応、2026-08-26）
  api/acronym/manual/route.ts POST /api/acronym/manual 手動登録(1件、複数タグ対応)
  api/acronym/[id]/route.ts    GET 単一レコード取得（タグ同梱。関連リンク遷移用、2026-08-26新設）
  api/acronym/[id]/related/route.ts GET ホモニム+概念的関連の取得（2026-08-26新設）
  api/tags/route.ts         GET タグ一覧+表示グループ一覧（2026-08-26新設）
components/
  AcronymDetail.tsx          TagPills（複数タグ表示）・RelatedTerms（関連用語）。
                            page.tsx / reverse/ResultBrowser.tsx で共有（2026-08-26新設）
lib/
  db-server.ts              Neon接続、検索/INSERT/逆引き/タグ/関連用語クエリ
  reverse-index.ts          逆引き画面のキー正規化・並び替え・選択解決
  types.ts                  Acronym/Tag/AcronymTag/DisplayGroup/Homonym/AcronymRelation型
public/
  manifest.json              PWAマニフェスト
  icons/icon-192.png, icon-512.png
docs/
  decisions.md               設計判断の経緯（why中心）
  TODO.md                    未着手タスク
  proposals/category-taxonomy.md  カテゴリのタグ方式移行案（提案段階のまま。実装は本移行で反映済み）
db/
  schema.sql                 手書きDDL（Neon復元用、実行時には読まれない。tags/acronym_tags/acronym_relationsは未反映で古い）
  schema-snapshot.txt        Neon本番DBからの機械出力スナップショット（生成物、手編集禁止。DBの正。
                            2026-08-26時点でも取得済みなのはcategory列削除前の状態。再取得は運用者作業）
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

### `?q=` / `?id=` ディープリンク起動（2026-08-26: `?id=`追加）
- `app/page.tsx` の実体は`HomeContent`（`Suspense`配下）に分離し、
  `next/navigation`の`useSearchParams()`で`q`/`id`を**反応的に**
  監視する（`window.location.search`の1回読みから変更）。理由:
  ホモニム・概念的関連リンク（`/?id=<uuid>`）は同一ルートへの
  クライアント遷移のため、マウント時1回きりの読み取りだと2件目
  以降のリンククリックに反応できなかった
- `id`あり: `GET /api/acronym/[id]`で1件取得し、詳細
  （`selected`）を開く。検索欄・検索結果はリセットしない
  （関連リンクからの遷移で背後の検索状態を保つため）
- `id`なし・`q`あり: `setQuery(q)` の上で即座に検索を実行。
  1件ヒットなら詳細を自動オープン（従来通り）
- 両方なし: 通常通り入力欄へフォーカスするのみ（挙動変更なし）
- 外部入口（ショートカット・共有シート・ブックマーク等）の
  **共通の受け口**として設計。入口ごとの個別実装は不要
  （decisions.md 9章）

### 結果表示
- 検索結果一覧はカード形式。クリックで詳細をポップアップ
  （オーバーレイ）表示。背景タップまたは✕で閉じる
- 詳細にはWikipedia検索リンク・Google検索リンクを表示。
  リンクURLはDBに保存せず、`full_spelling`/`acronym`から
  都度クライアント側で組み立てる（decisions.md 6章）
- 2026-08-26: `components/AcronymDetail.tsx`の`TagPills`
  （複数タグ表示）・`RelatedTerms`（ホモニム・概念的関連）を追加。
  `app/reverse/ResultBrowser.tsx`の`DetailPanel`とも共有

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

### カテゴリ / タグの実装状態（2026-08-26改訂: タグ方式へ移行完了）

- **分類の読み書きは`tags`/`acronym_tags`へ移行済み**。`acronyms.category`
  （text、CHECK制約は運用者により削除済み）は**legacyとして残るが
  読み取りには一切使わず**、新規登録時に主タグの`display_group`を
  書き込む**二重書き**（暫定措置、`lib/db-server.ts`
  `insertOneAcronymWithTags`のコメント参照）のみ行う
- タグは19件の原子タグ（`tags.name`）で構成され、`tags.display_group`
  により7個の表示グループ（UIボタン）に集約される。ボタン数・並び順
  は`sort_order`から動的に決まり、コード上のハードコードは無い
  （`lib/db-server.ts` `getActiveTags`/`getDisplayGroups`、
  `app/api/tags/route.ts`経由でクライアントへ配信）
- 1レコードは主タグ1件（`is_primary=true`、部分UNIQUEインデックスで
  1件に制限）+ 副タグ0〜2件程度を持てる。表示グループでの絞り込みは
  **主タグ・副タグどちらか一方が一致すればヒット**する
  （`app/page.tsx`の`filtered`、`item.tags.some(t => t.display_group === selectedGroup)`）
- 検索（`GET /api/search`→`searchAcronyms`）・逆引き
  （`getAcronymsByIndexKey`）は`acronym_tags`/`tags`を相関サブクエリで
  JOINし、各レコードに`tags: AcronymTag[]`をJSON配列として同梱する
  （`lib/db-server.ts`の`tagsJsonSubquery`。行を複製しないよう
  相関サブクエリ+`json_agg`を使用し、素朴なJOINは使っていない）
- Groqへのプロンプト（`app/api/acronym/route.ts` `buildSystemPrompt`）
  にはタグ名一覧を`getActiveTags()`から動的に埋め込む
  （ハードコード配列は廃止）。返り値`tags: string[]`は
  `normalizeTags`で検証し、1つ目を主タグ・以降を副タグ（最大3件）
  として扱う。既知タグに一致しない場合は「その他」1件にフォール
  バックする。手動登録（`POST /api/acronym/manual`）も同じタグ
  一覧に対して検証し、不正なタグ名は400エラーで拒否する
  （AI経路の黙示フォールバックとは非対称。手動登録は元々この
  非対称方針だった）
- `insertAcronyms`（`lib/db-server.ts`）は1件ごとにCTE
  （`WITH ins AS (INSERT INTO acronyms ...), tag_ins AS (INSERT INTO acronym_tags ...)`）
  で`acronyms`と`acronym_tags`を単一SQL文でアトミックに書き込む。
  Neonのサーバーレスドライバが複数文BEGIN/COMMITを扱えないための
  対応（decisions.md参照）。複数解釈（AI一括登録で最大4件）は
  この単一行CTEを順に呼ぶため、**行単位ではアトミックだが複数行
  全体としての原子性は無い**（decisions.md参照）
- 詳細表示は`components/AcronymDetail.tsx`の`TagPills`
  （主タグ・副タグをピル表示、主タグは塗りつぶしで区別、
  flex-wrapで折り返し）と`RelatedTerms`
  （`GET /api/acronym/[id]/related`を叩いてホモニム・概念的関連を
  表示、両方0件ならセクション非表示）を`app/page.tsx`の
  `DetailCard`と`app/reverse/ResultBrowser.tsx`の`DetailPanel`の
  両方で共有する
- ホモニム（同一acronymの別意味、大文字小文字非区別）はデータ投入
  無しで動的クエリのみで機能する。概念的関連は`acronym_relations`
  （現状MAD⇔SIOPの1組のみ）に基づき、`related.id`への
  `/?id=<uuid>`リンクとして表示する。`?id=`は`app/page.tsx`が
  `useSearchParams`で反応的に監視し、`GET /api/acronym/[id]`から
  1件を取得して詳細ポップアップを開く（`?q=`によるディープリンクとは
  独立した経路。`useSearchParams`使用のためpage.tsxの実体は
  `Suspense`配下の`HomeContent`に分離した）

### レスポンシブ対応（2026-08-26実施）

- 対象幅: 375px（iPhone SE/mini相当）・390px（iPhone標準相当）・
  768px（タブレット縦）・1280px（PC）。対象画面: トップ（入力検索）・
  検索結果一覧・逆引き辞書画面（インデックス選択・結果一覧）・
  詳細表示（タグピル・関連用語含む）・手動登録フォーム
- 検証方法: Playwrightでdevサーバーを4幅にリサイズし、
  `document.documentElement.scrollWidth`に加えて
  `overflow-x:auto/scroll`を持つ要素自身の`scrollWidth`/
  `clientWidth`差分も走査するアドホックスクリプトで横スクロール
  発生箇所を客観的に特定した（`document`直下のscrollWidthだけでは
  「要素自身がoverflow-x-autoで自己完結してスクロールする」ケースを
  検出できないと判明したため、両方をチェックする方式にした）。
  タグ3個・関連用語4件・長い正式名称（実DBの`SWIFT`・
  `USA PATRIOT Act`）は実データ・API応答モックの両方でワースト
  ケースを再現して検証した
- **発見した不具合は1箇所のみ**: トップ画面のカテゴリ（表示グループ）
  ボタン行が`overflow-x-auto`（`flex-wrap`なし）だったため、
  検証した4幅すべてで内部横スクロールが発生していた（1280pxでも
  発生。ボタン行は`max-w-lg`コンテナ内にあり実効幅が頭打ちになる
  ため）。`app/reverse/page.tsx`の`IndexBar`は元々`flex flex-wrap`
  実装済みで対象外だった
- 修正: `flex flex-wrap gap-2`へ変更（グリッド列数のハードコードは
  使わない。理由はdecisions.md 21章）。加えてタップ領域が小さかった
  インタラクティブ要素（カテゴリボタン・`/reverse`インデックスキー・
  関連用語ボタン・副タグ選択ボタン・閉じるボタン）のpaddingを拡大し、
  長文フィールド（正式名称・日本語訳・概要・詳細表示の見出し）に
  `break-words`（flexコンテキストでは`min-w-0`も）を防御的に追加した
  （現行の実データでは折り返し自体は元々発生していたため不具合は
  見つからなかったが、空白を含まない連続文字列への予防措置）
- `overflow-x: hidden`によるドキュメントレベルでの隠蔽は使っていない
  （原因箇所を直接修正する方針を徹底）
- 例外: `app/reverse/ResultBrowser.tsx`のアコーディオン行acronym
  表示`div`のみ、`e2e/reverse-lookup.spec.ts`が
  `div[class="font-bold text-indigo-700 dark:text-indigo-300"]`
  で完全一致セレクタとして依存しているため、`break-words`を
  追加していない（詳細はdecisions.md 21章）

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

## DBスキーマの同期（2026-08-24、2026-08-26追記）

- **2026-08-26時点で`db/schema-snapshot.txt`は古い**。タグ方式移行
  （本ドキュメント上部「カテゴリ / タグの実装状態」参照）に伴い、
  運用者により本番DBで以下が変更済みだが、スナップショットは
  未反映（このタスクでは.envを要するDB接続を行わないため、
  Codeからの再取得は不可。再取得は運用者作業。手順は下記
  「スナップショットの再取得手順」参照）:
  - `acronyms_category_check`（旧6値のCHECK制約）が削除されている
  - `acronym_relations`テーブル（概念的関連。id/acronym_id_a/
    acronym_id_b/relation_note/created_at、順不同重複防止の
    UNIQUEインデックス付き）が追加されている
  - `tags`は19件（旧: 6件想定）、`acronym_tags`は全101件に
    backfill済み
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
