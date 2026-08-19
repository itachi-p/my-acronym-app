# アクロニム辞書アプリ 診断レポート

調査日: 2026-08-19
調査方法: コード精読 / `git log` / devサーバーを起動しての実APIレスポンス確認 / Supabase MCPでの読み取り専用SQL。**本レポート作成にあたりコード変更・DB変更は一切行っていない。**

以下、**断定**と**推測**は明記して分離している。

---

## 0. TL;DR（最重要2点）

- **症状1（検索が0件になる）の原因は「正規表現の破損」ではない。断定。** 実際にdevサーバーを起動し `/api/search?q=CE` を叩いたところ、DBが `{"error":"permission denied for table acronyms"}` を返していた。原因はコードではなく **Supabase側で `service_role` ロールに `acronyms` テーブルへの `SELECT`/`INSERT` 権限（GRANT）が付与されていない**ことにある（`information_schema.role_table_grants` で確認済み、断定）。フロント側 (`app/page.tsx`) はAPIがエラーオブジェクトを返しても `Array.isArray(data)` が `false` になるだけで無言で空配列にフォールバックするため、ユーザーには「検索が何もヒットしない」ように見える。
- **症状2（AI調査+INSERTが動かない）は、GoogleクォータではなくGEMINI_API_KEY未設定が直接原因。断定。** `.env.local` は `#GEMINI_API_KEY`（コメントアウト済み）、`GROQ_API_KEY`（値あり・未使用）という状態で、コード（`app/api/acronym/route.ts`）は今も `GoogleGenerativeAI` / `GEMINI_API_KEY` しか参照していない。実際に `POST /api/acronym` を叩くと `{"error":"GEMINI_API_KEYが設定されていません"}` が即座に返る。Groqへの切替はコード上ゼロ（`grep`で0件、`groq`系パッケージも未インストール）。さらに **Groq切替後もこのままでは同じGRANT不足によりINSERTも失敗する**（後述）。

---

## 1. リポジトリ構造と実装状況

Next.js 14.2.35 (App Router) + TypeScript + Supabase + `@google/generative-ai`。ファイル数は少なく、実質7ファイルのみ:

```
app/
  page.tsx              … 検索UI（クライアントコンポーネント）
  layout.tsx            … PWAメタデータ
  api/search/route.ts   … GET /api/search（DB検索）
  api/acronym/route.ts  … POST /api/acronym（Gemini調査+INSERT）
lib/
  supabase-server.ts    … Supabaseクライアント + search/find/insertヘルパ
  types.ts              … Acronym型・カテゴリ定義
schema.sql               … テーブル定義（Supabase SQLエディタに手動投入する前提）
```

`node_modules` は導入済みで `npm run dev` は正常起動する（断定・実行確認済み）。

---

## 2. 「いつ検索が壊れたか」の特定

**コード上、検索ロジックを壊したコミットは存在しない（断定）。** 現在のHEAD（`905e270`）時点の検索ロジック（`ilike` 前方一致 + 2文字以上でデバウンス発火）はロジックとして正しく、`git log` を全履歴たどっても `app/page.tsx` に正規表現ベースのフィルタが実装されたことは一度もない（`grep -rnE "RegExp|test\(|match\("` はヒットなし。ユーザーの「正規表現が壊れた」仮説は明確に誤り）。

検索まわりの実コミットは2つだけで、意味のある挙動変化はここに集約される:

| commit | 内容 |
|---|---|
| `af6a141`（08-03 01:09） | 検索を `ilike前方一致+limit10` → `eq完全一致+maybeSingle` に変更。同時に `lib/supabase-server.ts` を大幅簡素化（後述の環境チェック/詳細エラーハンドリング機能を全削除）。**同時に `schema.sql` を丸ごと `DROP TABLE CASCADE` で再構築**（列 `reading` 削除、UNIQUE制約・大文字CHECK制約を追加） |
| `905e270`（08-03 01:18・9分後） | `eq完全一致` を `ilike前方一致` に**差し戻し**（コミットメッセージ通り）。API側のレスポンス整形も配列前提に修正 |

つまりコードの検索ロジックは9分間だけ「完全一致」になった後、正しい形に戻されている。**この2コミットの間にDB側の権限状態が壊れたのかは、git履歴からは判別不可能（未検証）。** GRANT欠落はSupabase SQLエディタでのDDL実行という、gitに記録されない操作によって生じるためである。

**最有力の推測（未検証）**: `af6a141` の `schema.sql`（`DROP POLICY` → `DROP TABLE ... CASCADE` → `CREATE TABLE` という「作り直し」パターン）がSupabase側で実行されたタイミングで、旧テーブルに付いていたGRANTが失われ、新テーブルには再付与されなかった。Supabaseダッシュボードのテーブルエディタでテーブルを作ると自動的に `anon`/`authenticated`/`service_role` にGRANTが張られるが、SQLエディタで生のDDLを流した場合はその自動付与が起きないため、これは典型的な事故パターンである。ただし実行ログが残っていないため確定はできない。

---

## 3. 検索フローの実コード追跡と症状1の原因

```
app/page.tsx: handleChange
  → value.length を見ずに常に q=value.toUpperCase() をセット
  → 300msデバウンス後 search(q) 実行
    → search(): value.length < 2 なら即 return（ここで2文字未満は弾く）
    → fetch(`/api/search?q=${q}`)
app/api/search/route.ts
  → query.trim().toUpperCase()、2文字未満なら [] を返す
  → searchAcronyms(query) 呼び出し
lib/supabase-server.ts: searchAcronyms
  → supabase.from("acronyms").select("*").ilike("acronym", `${q}%`).order("acronym").limit(10)
```

ロジック自体（2文字条件・大文字化・前方一致）に矛盾や重複した正規表現フィルタは存在しない（断定）。

**実機検証結果（devサーバー起動 → curl、断定）:**

```
GET /api/search?q=CE  → {"error":"permission denied for table acronyms"}
GET /api/search?q=C   → []  （1文字なのでAPI側で早期return、正常）
```

Supabase MCPで対象プロジェクトの `information_schema.role_table_grants` を直接確認したところ、`public.acronyms` に対する権限は以下の通りだった（断定・SQL実行結果）:

| grantee | 付与されている権限 |
|---|---|
| `postgres`（テーブル所有者） | SELECT, INSERT, UPDATE, DELETE, TRIGGER, TRUNCATE, REFERENCES |
| `service_role`（アプリが使用） | TRIGGER, TRUNCATE, REFERENCES のみ（**SELECT/INSERT/UPDATE/DELETEなし**） |
| `anon` | 同上（SELECTなし） |
| `authenticated` | 同上（SELECTなし） |

`schema.sql` のRLSポリシー（`Allow public read access` / `USING (true)`）は正しく存在するが、**RLSポリシーはテーブルレベルのGRANTが先にないと評価対象にすらならない**ため、`permission denied for table` というPostgres標準の権限エラーが先に返っている。これはRLSの不備ではなく、GRANT文が一度も実行されていない（または再構築時に失われた）ことによる、より根本的な権限不足である。

フロント側の隠蔽経路（断定・コード上明白）:
```ts
// app/page.tsx
const data = await res.json();          // { error: "..." }
setResults(Array.isArray(data) ? data : []); // isArray=false → []
```
APIがエラーを返してもUIは常に「0件」として表示するため、ユーザーからは「検索が何もヒットしない」としか見えず、実際のエラー内容（権限エラー）はブラウザのネットワークタブを見ない限り不可視である。これが「以前は動いていたのにヒットしなくなった」という体感の直接的な原因。

**作業ツリーの未コミット変更について**: `lib/supabase-server.ts` の1行差分（`return supabase...` → `return await supabase...`）は動作上ノーオペレーション（`await`を呼び出し元で既にawaitしているため意味的差異なし）で、この症状には無関係（断定）。

---

## 4. AI調査＋INSERTフローの追跡と、Google依存の残存範囲

```
app/page.tsx: handleAiGenerate
  → POST /api/acronym { acronym: query }
app/api/acronym/route.ts
  → GEMINI_API_KEY を読む → 無ければ即500応答
  → new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: GEMINI_MODEL ?? "gemini-2.0-flash", ... })
  → model.generateContent(...) → JSON抽出(parseGeminiJson) → normalizeCategory
  → createSupabaseClient()（このファイル内でその場限定で再定義、lib/supabase-server.tsとは別実装）
  → supabase.from("acronyms").insert(insertData).select().single()
```

**実機検証結果（断定）:**
```
POST /api/acronym {"acronym":"XYZ"}
→ {"error":"GEMINI_API_KEY が設定されていません"}
```

`.env.local` の状態（値は伏せてキー名と有無のみ確認・断定）:
- `#GEMINI_API_KEY` … コメントアウト済み（未設定扱い）
- `#GEMINI_MODEL` … コメントアウト済み
- `GROQ_API_KEY` … 値あり（設定済み）
- `#GROQ_MODEL` … コメントアウト済み

Google依存の残存範囲（断定・grep結果）: `app/api/acronym/route.ts` 全体（`@google/generative-ai` import、`SYSTEM_PROMPT`、`parseGeminiJson`、モデル呼び出し、環境変数参照）。`groq` という文字列はコードベース全体で0件ヒット（`package.json`/`package-lock.json`含む）。**Groq移行はアカウント登録のみで、コードは一切着手されていない**（ユーザーの認識と一致、断定）。

**追加の重要な発見（断定・未検証の警告込み）**: 仮にGroqへの切替を実装してGEMINI_API_KEYの壁を越えたとしても、**INSERT自体が3節と同じ理由で失敗する**。`service_role` には `INSERT` 権限も付与されていないため（3節の権限表参照）、Groq側から正常なJSONが返ってきても最後の `supabase.from("acronyms").insert(...)` で `permission denied for table acronyms` になる。つまり症状1と症状2は別々の問題ではなく、**「GEMINI_API_KEY未設定」で早期リターンしているせいで、その先にあるもう一つのバグ（GRANT不足）がまだ露見していないだけ**という関係である。Groq移行時にこの点を見落とすと「Groqには切り替えたのにまだ保存できない」という新たなハマりどころになる。

Groq切替に必要な変更範囲（実装は次回、洗い出しのみ）:
- `app/api/acronym/route.ts`: `@google/generative-ai` 依存を撤去し、Groq SDK（未インストール）または `fetch` でGroqのOpenAI互換Chat Completions APIを呼ぶ実装に置換。`SYSTEM_PROMPT`とJSON強制の方式（Groqは `response_format: { type: "json_object" }` 相当）を再設計。`parseGeminiJson` の関数名・エラーメッセージも含め全面書き換えが必要。
- 環境変数: `GEMINI_API_KEY`/`GEMINI_MODEL` 参照を `GROQ_API_KEY`/`GROQ_MODEL` に置換。
- `package.json`: Groq用パッケージ追加（or fetch実装なら不要）。
- DB側: 上記のGRANT不足を別途修正しないと、切替後も保存だけ失敗し続ける。

---

## 5. 環境変数の食い違い（値は出力せず、名前のみ）

| 変数名 | `.env.local` | `.env.local.example` | コードでの参照 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ○ | ○ | ○（`lib/supabase-server.ts`, `app/api/acronym/route.ts`） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ○ | ○ | **なし**（どこからも参照されていない死に変数） |
| `SUPABASE_SERVICE_ROLE_KEY` | ○ | **なし** | ○（両ファイル） |
| `GEMINI_API_KEY` | コメントアウト（未設定） | ○ | ○（`app/api/acronym/route.ts`、必須） |
| `GEMINI_MODEL` | コメントアウト | なし | ○（フォールバック値あり、任意） |
| `GROQ_API_KEY` | ○（値あり） | なし | **なし**（未使用） |
| `GROQ_MODEL` | コメントアウト | なし | なし |

指摘点（断定）:
- `.env.local.example` はアプリ起動に必須の `SUPABASE_SERVICE_ROLE_KEY` を欠いており、初見でセットアップする際に確実に詰まる。
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` は両envファイルに存在するが、現行コードのどこからも読まれていない（過去バージョンの `createServerSupabaseClient`（`ee0fd9a`/`9644c3a` 時点）が使っていた名残 — 4節参照）。
- `GEMINI_API_KEY` を切ったまま `GROQ_API_KEY` だけ足した状態が、まさに症状2の直接原因（4節参照）。

---

## 6. 型定義・DBスキーマ・APIルート間の不整合

- **カテゴリ一覧が3箇所に独立して重複定義されている（断定）**:
  - `lib/types.ts`: `CATEGORIES`（フロントのタブ用、`"すべて"`込み7要素）
  - `app/api/acronym/route.ts`: `VALID_CATEGORIES`（Gemini出力の正規化用、`"すべて"`抜き6要素）
  - `schema.sql`: `category text NOT NULL`（**CHECK制約なし**。以前の版（`af6a141`より前）には `CHECK (category IN (...))` があったが、schema.sql再構築時に削除され、現在DBはカテゴリ文字列を一切検証していない）

  3箇所が手動同期前提になっており、どれか1箇所にカテゴリを追加・変更してもコンパイルエラーにも実行時エラーにもならず、静かに「フィルタタブに出ない」「AIが常に『その他』に丸める」といった不具合を生む構造。

- `lib/types.ts` の `Acronym` 型は現行の `schema.sql`（`reading` 列なし）と一致している（断定・問題なし）。ただし旧スキーマ（`af6a141` 以前）にあった `reading` 列は型定義側には元々存在せず、型と旧DBスキーマの間には過去に不整合があった可能性がある（未検証・現状は解消済み）。

- **Supabaseクライアント初期化・アクセスロジックの二重実装（断定）**:
  - `lib/supabase-server.ts`: `supabase`（モジュールレベルのシングルトン、`!`非nullアサーション使用）+ `searchAcronyms`/`findAcronym`/`insertAcronym`
  - `app/api/acronym/route.ts`: 独自の `createSupabaseClient()`（env欠落時に例外throw、独立したクライアントを都度生成）+ インラインの `.from("acronyms").insert(...)`

  `insertAcronym`（`lib/supabase-server.ts`）は**どこからも呼ばれていない未使用エクスポート**である。INSERT系の処理は本来ここに書かれていたはずだが、`app/api/acronym/route.ts` はそれを使わず独自に再実装している。

---

## 7. 「複数AIが別前提でパッチを当てた痕跡」

具体的に指摘できるものは以下（断定）:

1. **未使用のまま残った旧経路**: `lib/supabase-server.ts` の `findAcronym` / `insertAcronym` はどこからも呼ばれていない。`app/api/acronym/route.ts` が独自にSupabaseクライアントを再生成しINSERTを再実装している時点で、この2関数を書いたセッションとAPIルートを書いたセッションが互いの実装を認識していなかったことが分かる。
2. **同一目的の重複実装、しかもエラーハンドリング方針が真逆**: `lib/supabase-server.ts` 側は「結果オブジェクト（`{success, error}`）を返す」設計だった時期があり（`9644c3a` 時点の `insertAcronymServer`）、一方 `app/api/acronym/route.ts` は「例外をthrowして上位try/catchで拾う」設計。同じ責務に対して異なる流儀のコードが同居している。
3. **「作って→大幅に作り直す」の激しい往復**: `9644c3a`（Supabase統合強化・RLS検出付きの詳細エラーハンドリングを追加）→ `af6a141`（その9分後、9644c3aで足した機能をほぼ全削除し3関数だけの最小構成に戻す）→ `905e270`（9分後、検索条件をさらに差し戻す）。同日1時間以内に「肉付け→大胆な単純化→部分的な差し戻し」が発生しており、単一の一貫した設計判断のもとで進んだとは考えにくい変化パターン。
4. **`schema.sql` の「Rebuild」コメント**: `af6a141` で `schema.sql` 冒頭に `-- Acronyms table (Rebuild)` という注記とともに `DROP POLICY` → `DROP TABLE CASCADE` → `CREATE TABLE` という「一から作り直す」パターンが突然出現している。これは「既存のALTERで直せず、詰まって作り直した」典型的な痕跡であり、そのタイミングでGRANTが失われたという3節の推測と整合する。
5. **Gemini前提のコードとGroqの環境変数が同居**: 4節・5節の通り、コードは完全にGemini専用のまま、`.env.local`だけがGroq前提に切り替わっている。これはツール（Cursor/ChatGPT/Geminiなど）を跨いだ作業の途中で、"設定"と"実装"が別セッションで別々に進み、同期されなかったことの直接証拠。
6. **命名規則の断絶**: `insertAcronymServer`（旧版）→ `insertAcronym`（現行、`lib/supabase-server.ts`）→ `createSupabaseClient`+インラインinsert（`app/api/acronym/route.ts`、命名規則も関数分割方針も別物）と、同じ操作に対する命名・粒度が版ごとにバラバラ。

---

## 8. 判断材料

### A. 現行コードを直して完成させる場合の作業項目と依存順序

1. **[最優先・DB] `service_role`（必要なら`anon`/`authenticated`も）に `acronyms` テーブルの GRANT を付与する。** これをやらない限り検索もINSERTも直らない。他の全作業の前提。
2. **[DB] `schema.sql` にGRANT文を追記し、将来同じ事故が起きないよう再現可能にする。**
3. **[コード] `app/api/acronym/route.ts` をGroq実装に置換**（4節の変更範囲）。GEMINI関連コード・依存を削除。
4. **[コード] `lib/supabase-server.ts` と `app/api/acronym/route.ts` のSupabaseクライアント初期化を一本化**（未使用の `insertAcronym`/`findAcronym` を実際に使うか削除するか決める）。
5. **[コード] カテゴリ定義を単一ソース化**（`lib/types.ts` の `CATEGORIES` を `app/api/acronym/route.ts` からimportして使う、DB側に `CHECK` 制約を復活）。
6. **[環境] `.env.local.example` を実態に合わせて更新**（`SUPABASE_SERVICE_ROLE_KEY`追加、`GROQ_API_KEY`追加、`NEXT_PUBLIC_SUPABASE_ANON_KEY`は未使用なら削除）。
7. **[任意・リスク] Supabaseプロジェクトの共用問題への対処**（後述）。

1→3の順は必須（1をやらないと3のテスト自体ができない）。それ以外は並行可能。

### B. ゼロから作り直す場合に再利用できる資産／捨てる部分

再利用できる（設計として妥当・書き直す理由がない）:
- UI（`app/page.tsx`）のロジックそのもの（デバウンス検索、カテゴリタブ、詳細カード表示）は素直で問題のある実装ではない。
- `schema.sql` のテーブル定義（GRANT文以外）・型定義（`lib/types.ts`）は現在の要件と一致しており妥当。
- Next.js App Router + Supabase という技術選定自体に問題はない。

捨てる/書き直す部分:
- `app/api/acronym/route.ts` のGemini依存部分（どのみちGroqで全面書き換えが必要）。
- `lib/supabase-server.ts` と `app/api/acronym/route.ts` の二重Supabaseクライアント実装（統合が必要）。
- `schema.sql` のGRANT欠落（作り直しても同じ罠を踏む危険があるため、次回は明示的にGRANT文を含める必要がある）。

### C. AとBどちらを推すか

**Aを推す。**

理由（コードの荒れ具合の実測に基づく）: 実装ファイルは実質7つしかなく、規模がそもそも小さい。かつ2週間の放置で生まれた「荒れ」は、7節で列挙した通り**局所的**である — Gemini→Groqの未完了移行、Supabaseクライアントの二重実装、カテゴリ定義の3箇所重複、未使用エクスポート2つ。いずれもファイル単位で見れば1〜2ファイルの書き換えで解消でき、UI層（`app/page.tsx`）・型定義（`lib/types.ts`）・DBテーブル定義本体には実質的な破綻がない。

さらに重要なのは、**症状の"真因"が実装の破綻ではなくDB側のGRANT設定漏れだった**という点である。これはコードを書き直しても再発しうる種類のミス（AI生成のSQLがGRANT文を含めない、という同じパターンを踏襲しやすい）であり、「作り直せば消える」問題ではない。今回特定した「service_roleにGRANTがない」という事実さえ押さえて `schema.sql` に反映すれば、現行コードはそのまま機能する状態に近いところまで来ている。作り直しは、この程度の荒れに対しては投じる労力に見合わない。

---

## 付記（本調査で行ったこと・行っていないこと）

- コード変更: **一切なし**（`git status`/`git diff`は本セッション開始前の未コミット差分のまま）。
- 実行した操作: `npm run dev`（読み取り検証目的で一時起動、調査後に停止）、`curl`によるAPI呼び出し（`GET /api/search`、`POST /api/acronym`）、Supabase MCPでの読み取り専用SQL（`information_schema.role_table_grants` 等）・`list_tables`・`get_advisors`。**GRANT文の実行やスキーマ変更、レコードのINSERT/UPDATE/DELETEは一切行っていない。**
- **追加の懸念点（未検証・要ユーザー確認）**: `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` が指すSupabaseプロジェクトは、`list_projects` で確認する限り `heiwa-sns` という名称の、`acronyms` 以外に `users`/`posts`/`likes`/`interest_tags` など無関係なSNSアプリのテーブル群を持つプロジェクトだった。このアクロニム辞書アプリ専用のプロジェクトではなく、既存の別アプリのSupabaseプロジェクトに間借りしている状態。意図的な選択であれば問題ないが、無料枠クォータやセキュリティアドバイザリ（`get_advisors`で検出された`heiwa-sns`側の警告群）が両アプリで共有される点はリスクとして認識しておくべき。専用プロジェクトへの分離を検討する価値がある（これは提案であり、本セッションでは何も変更していない）。
