# カテゴリのタグ方式移行案 (2026-08-24)

**ステータス: 提案段階。未確定。** このドキュメントは調査と移行案の
提示までを目的とする。アプリケーションコードの実装は別タスクで
行う。カテゴリ名・タグ体系・閾値の確定、移行SQLの実行判断は
すべて運用者が行うこと。

## 0. 前提（この提案の土台）

- `acronyms.category`（text + CHECK制約6値）は今回変更しない。
  削除タイミングは5-(e)(f)で提案するに留める
- `acronyms_acronym_full_spelling_ci_unique`（複合UNIQUE）は
  変更しない。この提案のどの選択肢もこのキーの構成に触れない
  （decisions.md 7章・19章）
- `tags`/`acronym_tags`は運用者により本番DBへ追加済み
  （現行6カテゴリと同名のタグ6件、既存130件全件にis_primaryタグ
  1件ずつ紐付け済み）。アプリケーションコードは未使用
- 現行UIのカテゴリ関連実装箇所（2026-08-24調査、ファイルパス・
  行番号）:
  - `lib/types.ts:1-26` — カテゴリ6値の唯一の定義箇所
    （`CATEGORIES`/`AcronymCategory`/`ACRONYM_CATEGORIES`/
    `CATEGORY_DISPLAY_NAMES`）
  - `app/page.tsx:369-381` — カテゴリタブの描画（`CATEGORIES.map`）
  - `app/page.tsx:312-314` — タブ選択によるクライアント側フィルタ
  - `app/page.tsx:395-397` — 検索結果カードのカテゴリバッジ
  - `app/page.tsx:465-478` — 手動登録フォームのカテゴリ`<select>`
  - `app/api/acronym/route.ts:63-65` — Groqプロンプトへの
    カテゴリ一覧埋め込み
  - `app/api/acronym/route.ts:70-76` — AI結果のカテゴリ正規化
    （不正値は黙って「その他」にフォールバック）
  - `app/api/acronym/manual/route.ts:30-39` — 手動登録の
    カテゴリバリデーション（不正値は400）
  - `lib/db-server.ts:149-185` — `insertAcronyms`のINSERT文
    （category列を直接書き込み）

## (a) 表示層と分類層の分離

**分類層**: `tags`/`acronym_tags`（既存）。タグは自由に追加できる。
1レコードに複数タグを付けられる（`acronym_tags`は
`(acronym_id, tag_id)`複合PK）。

**表示層**: UIのカテゴリボタンは現状どおり5〜7個程度に固定する。
`tags.display_group`で複数タグを1つの表示グループに集約し、
UIはこの`display_group`の一覧だけをボタンとして描画する。
タグを何十個追加しても、`display_group`が増えない限りUIの
ボタン数は変わらない。これにより、TODO.md「5. カテゴリの追加」
が抱えていたトレードオフ（細分化するとタブが増えてモバイルの
レイアウトが崩れる／プルダウン化を迫られる）を構造的に解消する。

### 具体的な変更点（実装時の見取り図。今回は変更しない）

- `lib/types.ts`: `CATEGORIES`/`AcronymCategory`の静的配列を廃止し、
  DBから取得した`Tag`型（`{ id, name, display_group, sort_order }`）
  に置き換える。`Acronym`型の`category: AcronymCategory`は
  `tags: Tag[]`（またはpropsとして`primaryTag`と`tags`を分離）に
  変わる
- `lib/db-server.ts`: `getTags()`（`is_active=true`を
  `sort_order`順で取得）・`getDisplayGroups()`
  （`tags.display_group`の重複除去一覧、`sort_order`順）を追加。
  `searchAcronyms`/`getAcronymsByIndexKey`は`acronym_tags`と
  `tags`をJOINしてタグ情報も返すよう変更。`insertAcronyms`は
  `acronyms`へのINSERTに加え、`acronym_tags`へのINSERT
  （どのタグを何件、`is_primary`をどれにするか）が必要になる
  ため、複数テーブルへの書き込みをまとめて行う形に変更
  （Neonのserverlessドライバでのトランザクションの扱いを
  実装時に確認すること）
- `app/page.tsx:369-381`（カテゴリタブ）: `CATEGORIES.map`を
  `displayGroups.map`に置き換え。`369-381`のスタイル・構造は
  流用できる
- `app/page.tsx:312-314`（フィルタ）: `item.category === category`を
  `item.tags.some(t => t.display_group === selectedGroup)`に
  変更（1レコードが複数タグ＝複数表示グループに属し得るため、
  完全一致ではなく所属判定になる。(c)参照）
- `app/page.tsx:395-397`（バッジ）: `CATEGORY_DISPLAY_NAMES[item.category]`
  を主タグ（`is_primary`）の表示名に置き換え
- `app/page.tsx:465-478`（手動登録フォーム）: カテゴリ`<select>`を
  タグ選択UIに置き換え。複数選択を許すか、主タグのみ選ばせて
  副タグは別途追加させるかは(c)で提案する運用ルールに従う
- `app/api/acronym/route.ts:63-65`（プロンプト）: 静的な
  `ACRONYM_CATEGORIES.join("\n")`を、DBから取得した現行タグ名の
  一覧（`is_active=true`のみ）に置き換える。タグが増減しても
  プロンプトの修正が不要になる
- `app/api/acronym/route.ts:70-76`（正規化）: `normalizeCategory`を
  タグ名→タグID解決に置き換え。未知のタグ名が返ってきた場合の
  フォールバック先（「その他」タグ）は現行の挙動を踏襲する
- `app/api/acronym/manual/route.ts:30-39`（バリデーション）:
  `ACRONYM_CATEGORIES.includes`を、DBから取得したタグ名集合に
  対する検証へ置き換える
- `app/reverse/*`: 先頭文字（`acronym`）でのインデックスであり
  カテゴリを見ていないため、変更不要

## (b) タグ体系の拡張候補

現行6分類（ビジネス・経営／金融・株式／政治・行政／
軍事・安全保障／IT・テクノロジー／その他）では、以下の領域が
「その他」に流入している可能性が高い。**候補として提示するのみ。
どれを初期投入するかは確定しない。**

- 医療・医薬
- 法律・司法
- 学術・科学（宇宙物理を含む）
- エネルギー・環境
- 教育
- 物流・製造
- 国際機関
- スポーツ・文化

実データに基づく判断は、運用者が「その他」18件の内訳を確認した
上で行うこと（本タスクではDBへの問い合わせを行っていないため、
この18件の実際の内訳は未確認）。

## (c) 複数タグ運用のルール（提案）

- **`is_primary`の用途**: 1レコードにつき常に1件
  （`acronym_tags_one_primary`の部分UNIQUEインデックスが既に
  この制約を保証している）。主タグを、結果一覧のバッジ・
  `/reverse`結果行など「1つだけ表示する」場面で使う。副タグは
  詳細表示でのみ列挙する
- **タブ（表示グループ）でのフィルタ範囲**: 主タグだけでなく
  **全タグ（主＋副）の`display_group`のいずれかに一致すれば
  そのタブに表示する**ことを推奨する。0-2で前提とされている
  「同じ略語がジャンル違いで複数の意味を持つ」ケースへの対応
  という設計意図（7章）を、タグ方式でも継承するため
  （例: ある略語がIT分野でも金融分野でも使われる場合、両方の
  タブから見つけられる方が現行のカテゴリ単一選択より改善になる）
- **1レコードあたりのタグ数上限**: 主タグ1＋副タグ最大2の
  **計3件まで**を提案する。上限を設けない場合、タグ付けが
  際限なく増えて「分類」としての意味が薄れる懸念がある
- **Groqへのタグ推定範囲**: **主タグのみをAIに推定させ、副タグは
  今回のAI自動登録経路では付与しない**ことを提案する。理由は
  13章の既存方針（AIの結果を無条件かつ複数同時に登録する設計の
  リスクを、件数を絞ることで抑えてきた）と一貫させるため。
  副タグは将来的に人間が手動登録時に追加するか、別途「その他」
  プールの棚卸し（(d)参照）で後付けする運用とする

## (d) 「その他」プールの運用ルール（提案）

- 既存タグに当てはまらないものは「その他」タグ（既存）に溜める
- **新タグへの昇格閾値 N = 4**: 「その他」内で同一テーマと
  判断できるレコードが4件以上たまったら、新タグとして切り出す
  候補にする。旧TODO.md「5. カテゴリの追加」が「各5〜6件では
  分ける根拠が薄い」としていたのは、当時は分類を増やすと
  **UIのボタンも増える**（display_groupという緩衝層が無かった）
  前提だったため。タグ方式ではタグを増やしてもUIのボタンは
  増えないため、昇格の閾値を旧方針より下げられる
- **タグの統合閾値 M = 3**: 付与件数が3件を割り込んだタグは、
  親の`display_group`内の別タグ、または「その他」への統合
  候補とする（あまりに少数のタグは分類として機能しない）
- **新しい表示グループ（UIボタン）を追加する閾値**: 上記の
  タグ昇格とは別に、`display_group`という**UIボタンの新設**は
  より高い基準を設ける。目安として、その表示グループに属する
  タグの合計件数が**全体の10%（現状130件基準で13件相当）**を
  超え、かつ**2つ以上の異なるタグ**で構成されている場合に検討する。
  タグの新設とUIボタンの新設は別の意思決定であることを明示する
  のが、この提案の核（(a)参照）

## (e) 移行SQL（提示のみ・実行しない）

以下はすべて**運用者がNeonコンソールで実行するためのSQL文の提示**
であり、Codeはこれを実行しない。

### 前提（既に完了済み・SQL不要）

`tags`/`acronym_tags`の作成と、既存130件へのis_primaryタグ
backfillは運用者により完了済み（0-5参照）。以下の検証クエリで
現状を確認できる。

```sql
-- (0) 検証: 全acronymsにis_primaryタグが1件ずつ紐付いているか
-- 期待される出力: 0件（0件でなければbackfill漏れがある）
SELECT a.id, a.acronym
FROM acronyms a
LEFT JOIN acronym_tags at
  ON at.acronym_id = a.id AND at.is_primary
WHERE at.acronym_id IS NULL;
```

### `acronyms.category`列とCHECK制約を外す手順

**実行タイミング**: アプリケーションコードが`acronyms.category`を
一切参照しなくなり（(f)の段階移行が完了し）、本番で一定期間
（目安1〜2週間、運用者判断）タグ経由の表示・検索が問題なく
稼働していることを確認した後に限る。

```sql
-- (1) 実行前の最終確認: category列とacronym_tagsのprimaryタグ名が
-- 食い違っているレコードが無いか（食い違いがあれば移行漏れの疑い）
-- 期待される出力: 0件
SELECT a.id, a.acronym, a.category, t.name AS primary_tag_name
FROM acronyms a
JOIN acronym_tags at ON at.acronym_id = a.id AND at.is_primary
JOIN tags t ON t.id = at.tag_id
WHERE a.category <> t.name;

-- (2) CHECK制約を外す
ALTER TABLE acronyms DROP CONSTRAINT acronyms_category_check;

-- (3) カラムを外す
ALTER TABLE acronyms DROP COLUMN category;

-- (4) 実行後の確認: schema-snapshot.txt相当のクエリ（STATUS.md参照）で
-- categoryカラム・acronyms_category_checkが消えていることを確認
```

### ロールバック手順

`DROP COLUMN`は破壊的操作のため、ロールバックは列の再作成と
`acronym_tags`からのbackfillになる。**この手順は、旧6カテゴリの
範囲を超えるタグを追加する前（＝タグ名の集合が旧6値のスーパー
セットである間）にのみ安全に機能する。** 新タグ追加後にロール
バックする場合は、CHECK制約の値リストを現行タグ名に合わせて
更新するか、CHECK制約なしで復元すること。

```sql
-- (R1) カラムを復元
ALTER TABLE acronyms ADD COLUMN category text;

-- (R2) acronym_tagsのprimaryタグ名からbackfill
UPDATE acronyms a
SET category = t.name
FROM acronym_tags at
JOIN tags t ON t.id = at.tag_id
WHERE at.acronym_id = a.id AND at.is_primary;

-- (R3) NOT NULL・CHECK制約を復元（値リストは実行時点のタグ名に
-- 合わせて調整すること。以下は旧6値の例）
ALTER TABLE acronyms ALTER COLUMN category SET NOT NULL;
ALTER TABLE acronyms ADD CONSTRAINT acronyms_category_check
  CHECK (category = ANY (ARRAY[
    'ビジネス・経営', '金融・株式', '政治・行政',
    '軍事・安全保障', 'IT・テクノロジー', 'その他'
  ]));
```

## (f) 段階移行の順序（アプリを止めない移行）

現状、`acronyms.category`と`tags`/`acronym_tags`が二重に存在する
（category列は生きたまま、タグ側は追加・backfill済みだが未使用）。
この二重状態を、ダウンタイムなしで解消する順序を提案する。

1. **[完了]** `tags`/`acronym_tags`の作成とbackfill（運用者実施済み）
2. **（次のタスク）読み取りをタグ経由に切り替える**: UI・検索・
   `/reverse`（対象外）がタグ/表示グループを参照するようアプリ
   コードを変更する。この時点でbackfillは1:1で完了しているため、
   従来のカテゴリ読み取りとの並行運用（dual-read）は不要で、
   読み取りは直接タグへ切り替えられる
3. **書き込みを二重化する**: `POST /api/acronym`・
   `POST /api/acronym/manual`の両方で、`acronyms.category`への
   書き込みは残したまま、`acronym_tags`（主タグ、必要なら副タグ）
   への書き込みを追加する。category列とタグが新規登録でも
   自動的に同期し続けるため、手動での再backfillが不要になる
4. **本番で一定期間（目安1〜2週間）稼働・監視する**: タグ経由の
   表示・フィルタ・検索が実運用で問題ないことを確認する
5. **category列への書き込みを止める**: 挿入経路から
   `category`への書き込みを外す（列自体はまだ残す。書き込みが
   止まった後もしばらく参照が残っていないか確認する猶予期間）
6. **列を削除する**: リポジトリ全体を`grep`し、`.category`・
   `AcronymCategory`・`CATEGORIES`への参照がコード上に残って
   いないことを確認してから、5-(e)のSQLを運用者が実行する

**ダウンタイムについて**: 上記の順序であれば、各ステップは
アプリケーションの再デプロイ（Vercelの通常デプロイ）のみで
完結し、DBへの破壊的変更（ステップ6）は他の全ステップが完了し
安定稼働を確認した後にのみ発生する。このためアプリを止める
必要は無いと考えられる。ただし、ステップ2〜3の実装が
`acronym_tags`への書き込みを含む複数テーブルへのINSERTになる
ため、実装時にNeonのserverlessドライバでのトランザクション境界
（1リクエスト内で`acronyms`と`acronym_tags`への書き込みを
アトミックに行えるか）を確認する必要がある。これは次の実装
タスクでの検証事項とし、本提案では要検討事項として明記するに
留める。
