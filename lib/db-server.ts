import { neon } from "@neondatabase/serverless";
import type {
  Acronym,
  AcronymRelated,
  AcronymRelation,
  DisplayGroup,
  Homonym,
  Tag,
} from "./types";

// @neondatabase/serverless のHTTPドライバを使用。
// node-postgres(pg)はサーバーレス環境(Vercel等)でコネクションが
// 枯渇するため使わない方針。
//
// fetchOptions.cache: "no-store" が必須。このドライバは内部でPOSTの
// fetch()を発行するが、これがNext.jsのData Cache(サーバー内部の
// fetchキャッシュ)の対象になり得る。実際に本番で、SQL文のテキストが
// 一切変化しない検索クエリ(searchAcronyms)だけが、DBには対象行が
// 存在するのに空配列を返し続ける事象が発生した。原因はSQL文が
// クエリキャッシュのキーとなり、対象行がまだ存在しなかった頃の
// 空レスポンスがキャッシュされたまま返り続けていたこと(クエリの
// 空白を1文字変えるだけでキャッシュキーが変わり正しい結果に戻る
// ことで再現・特定した)。ルート側のdynamic="force-dynamic"だけでは
// このモジュール内部のfetchキャッシュは無効化されなかったため、
// ここで明示的にno-storeを指定する。
const sql = neon(process.env.DATABASE_URL!, {
  fetchOptions: { cache: "no-store" },
});

type QueryError = { message: string; code?: string };

function toQueryError(err: unknown): QueryError {
  if (err && typeof err === "object" && "message" in err) {
    const code = "code" in err && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : undefined;

    return { message: String((err as { message: unknown }).message), code };
  }

  return { message: String(err) };
}

// レコード1件分のタグ一覧をJSON配列として埋め込む相関サブクエリの式。
// acronymIdExprには参照先の行のid式("acronyms.id"や"ins.id"等)を渡す。
// 主タグを先頭、以降はsort_order順に並べる(表示順の唯一の基準)。
// json/jsonbはドライバ側で自動的にJS配列へパースされる
// (@neondatabase/serverless の型パーサがoid 114/3802にJSON.parseを
// 割り当てているため、呼び出し側でのJSON.parseは不要)。
function tagsJsonSubquery(acronymIdExpr: string): string {
  return `COALESCE((
    SELECT json_agg(
      json_build_object(
        'id', t.id,
        'name', t.name,
        'display_group', t.display_group,
        'sort_order', t.sort_order,
        'is_primary', at.is_primary
      )
      ORDER BY at.is_primary DESC, t.sort_order, t.name
    )
    FROM acronym_tags at
    JOIN tags t ON t.id = at.tag_id
    WHERE at.acronym_id = ${acronymIdExpr}
  ), '[]'::json)`;
}

const ACRONYM_COLUMNS =
  "id, acronym, full_spelling, japanese_translation, description, created_at";

// acronymは入力表記のまま保存されるため大文字小文字が揺れる。
// 検索は lower(acronym) に対する前方一致で大文字小文字を無視する
// (idx_acronyms_acronym_prefix はlower(acronym)に張られている)。
//
// 完全一致(例: "BS")を、より長い前方一致(例: "BSJ")より必ず先に
// 並べる。理由: 1つの略語に複数解釈を許すようになったことで、
// 短い人気の略語ほど完全一致の行数が増えやすく、LIMITと前方一致が
// 組み合わさると、より長い派生略語の行が完全一致の行を押し出して
// 検索結果から溢れてしまう(実際に本番で"BS"検索時、完全一致7件+
// "BSJ"3件で計10件がLIMITぎりぎりになり発生した事象)。
// また ORDER BY acronym だけでは同じacronym同士の並び順が
// 保証されないため、そちらも full_spelling をタイブレークに追加する。
//
// タグ情報を相関サブクエリでJSON配列として同時取得する
// (acronym_tags/tagsをJOINして行が複製されるのを避けるため)。
export async function searchAcronyms(query: string) {
  const lowerQuery = query.toLowerCase();

  try {
    const data = (await sql.query(
      `SELECT ${ACRONYM_COLUMNS}, ${tagsJsonSubquery("acronyms.id")} AS tags
       FROM acronyms
       WHERE lower(acronym) LIKE $1
       ORDER BY (lower(acronym) <> $2), acronym, full_spelling
       LIMIT 20`,
      [lowerQuery + "%", lowerQuery]
    )) as unknown as Acronym[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

// 表示グループ(UIボタン)の一覧。display_group単位で重複除去し、
// 各グループの最小sort_orderで並べる(ボタンの並び順もタグの
// sort_orderだけが基準になる)。is_active=falseのタグしか
// 持たないグループはボタンとして出さない。
export async function getDisplayGroups() {
  try {
    const data = (await sql`
      SELECT display_group AS name, MIN(sort_order)::int AS sort_order
      FROM tags
      WHERE is_active AND display_group IS NOT NULL
      GROUP BY display_group
      ORDER BY MIN(sort_order), display_group
    `) as unknown as DisplayGroup[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

// 有効なタグの一覧(sort_order順)。Groqへのプロンプト埋め込み・
// 手動登録フォームのタグ選択肢の両方がここを参照する
// (タグを増減してもコード変更が不要になるようにするための唯一の
// 取得口)。
export async function getActiveTags() {
  try {
    const data = (await sql`
      SELECT id, name, display_group, sort_order
      FROM tags
      WHERE is_active
      ORDER BY sort_order, name
    `) as unknown as Tag[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

export async function getAcronymById(id: string) {
  try {
    const rows = (await sql.query(
      `SELECT ${ACRONYM_COLUMNS}, ${tagsJsonSubquery("acronyms.id")} AS tags
       FROM acronyms
       WHERE id = $1`,
      [id]
    )) as unknown as Acronym[];

    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

// 関連用語(2系統)をまとめて取得する。
// - homonyms: 同義語衝突。同一acronym(大文字小文字を区別しない)を
//   持つ自分以外のレコードを動的に取得する(新規データ投入は不要)。
// - relations: 概念的関連。acronym_relationsで自分が
//   acronym_id_a/bのどちらかに含まれる行から、相手側レコードを取得する。
export async function getAcronymRelated(id: string) {
  try {
    const [homonymRows, relationRows] = await Promise.all([
      sql.query(
        `SELECT h.id, h.acronym, h.full_spelling, h.japanese_translation
         FROM acronyms self
         JOIN acronyms h
           ON lower(h.acronym) = lower(self.acronym) AND h.id <> self.id
         WHERE self.id = $1
         ORDER BY h.full_spelling`,
        [id]
      ),
      sql.query(
        `SELECT r.id, r.relation_note,
                other.id AS other_id,
                other.acronym AS other_acronym,
                other.full_spelling AS other_full_spelling,
                other.japanese_translation AS other_japanese_translation
         FROM acronym_relations r
         JOIN acronyms other
           ON other.id = CASE WHEN r.acronym_id_a = $1 THEN r.acronym_id_b ELSE r.acronym_id_a END
         WHERE r.acronym_id_a = $1 OR r.acronym_id_b = $1
         ORDER BY other.acronym`,
        [id]
      ),
    ]);

    const homonyms = homonymRows as unknown as Homonym[];

    const relations: AcronymRelation[] = (
      relationRows as unknown as Array<{
        id: string;
        relation_note: string | null;
        other_id: string;
        other_acronym: string;
        other_full_spelling: string;
        other_japanese_translation: string;
      }>
    ).map((row) => ({
      id: row.id,
      relation_note: row.relation_note,
      related: {
        id: row.other_id,
        acronym: row.other_acronym,
        full_spelling: row.other_full_spelling,
        japanese_translation: row.other_japanese_translation,
      },
    }));

    const data: AcronymRelated = { homonyms, relations };

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

export interface IndexKeyCount {
  key: string;
  count: number;
}

// 逆引きインデックスの「先頭キー」導出式。集計クエリ(getAcronymIndexCounts)と
// 一覧クエリ(getAcronymsByIndexKey)の両方がこの定数だけを参照する。
// 式を2箇所に書き写さないこと(書き写すとバッジの件数と実件数が食い違い、
// かつ例外が出ないため発見できなくなる)。
//
// トリム対象: POSIX標準の空白類([:space:] = 半角スペース/タブ/改行(\n\r)/
// 改ページ/垂直タブ)に加え、全角スペース(U+3000)とNBSP(U+00A0)。この2文字は
// 正規表現エスケープ(　等)の解釈違いに依存させないよう chr() で
// コードポイント指定する。
// 登録経路(POST /api/acronym, POST /api/acronym/manual)は既にJSのtrim()で
// 前後空白を除去しているが、それ以前に投入された既存データの保証はないため、
// クエリ側でも独立して除去する。
const TRIM_PATTERN_SQL =
  "('^[[:space:]' || chr(12288) || chr(160) || ']+|[[:space:]' || chr(12288) || chr(160) || ']+$')";
const TRIMMED_ACRONYM_SQL = `regexp_replace(acronym, ${TRIM_PATTERN_SQL}, '', 'g')`;

// 分類ルール:
// - acronymがNULL、またはトリム後が空文字 → SQL上のNULL(呼び出し側で除外する)
// - トリム後の先頭1文字を大文字化してA-Zなら、その1文字を単独キーとする
// - 先頭1文字が0-9なら'0-9'に集約する
// - それ以外(記号・全角文字・絵文字等)は'#'に集約する
export const ACRONYM_INDEX_KEY_EXPR = `
  CASE
    WHEN acronym IS NULL THEN NULL
    WHEN ${TRIMMED_ACRONYM_SQL} = '' THEN NULL
    WHEN upper(left(${TRIMMED_ACRONYM_SQL}, 1)) ~ '^[A-Z]$' THEN upper(left(${TRIMMED_ACRONYM_SQL}, 1))
    WHEN left(${TRIMMED_ACRONYM_SQL}, 1) ~ '^[0-9]$' THEN '0-9'
    ELSE '#'
  END
`;

// キー別の件数集計。0件のキーはGROUP BYの性質上そもそも出現しない。
// 表示順はSQLのORDER BYに依存させず呼び出し側(lib/reverse-index.ts)で
// 固定する。countはbigintのままだとドライバが文字列で返すため::intで
// 数値にキャストする。
export async function getAcronymIndexCounts() {
  try {
    const data = (await sql.query(
      `SELECT ${ACRONYM_INDEX_KEY_EXPR} AS key, COUNT(*)::int AS count
       FROM acronyms
       WHERE ${ACRONYM_INDEX_KEY_EXPR} IS NOT NULL
       GROUP BY key`
    )) as unknown as IndexKeyCount[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

// 指定キーに属するレコード一覧。LIKEではなくACRONYM_INDEX_KEY_EXPRとの
// 等値比較で絞り込む(LIKEはパラメータ中の'%'や'_'がワイルドカードとして
// 解釈されるうえ、集計側の式と別の絞り込みロジックになり乖離しうるため)。
// 並び順はアクロニムの大文字化・トリム後の昇順。同値時のタイブレーカーは
// full_spelling、最終的にid(主キー)で順序を完全に固定する。
export async function getAcronymsByIndexKey(key: string) {
  try {
    const data = (await sql.query(
      `SELECT ${ACRONYM_COLUMNS}, ${tagsJsonSubquery("acronyms.id")} AS tags
       FROM acronyms
       WHERE ${ACRONYM_INDEX_KEY_EXPR} = $1
       ORDER BY upper(${TRIMMED_ACRONYM_SQL}), full_spelling, id`,
      [key]
    )) as unknown as Acronym[];

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}

export interface AcronymInsertRow {
  acronym: string;
  full_spelling: string;
  japanese_translation: string;
  description: string;
  // tags[0]が主タグ、残りが副タグ。呼び出し側で既に検証・重複除去・
  // 上限適用(最大3件)済みであることを前提とする。
  tags: string[];
}

// 1件のacronym+タグ群を、CTEでまとめた単一SQL文でアトミックに書き込む。
// NeonのサーバーレスHTTPドライバは複数文にまたがるBEGIN/COMMIT
// トランザクションを素直に扱えないため、単一SQL文の中で
// acronyms/acronym_tags両方への書き込みを完結させる(decisions.md参照)。
//
// acronyms.category への書き込みは暫定措置(二重書き)。tags/acronym_tags
// への移行が完了しcategory列を削除するまでの間、主タグのdisplay_group
// をそのまま書き込み続けることで、category列を読む旧経路との整合を保つ。
// category列削除時にこの書き込みを止める。
//
// ON CONFLICT DO NOTHINGでacronyms側の挿入がスキップされた場合、
// insCTEが0行になり、それに依存するtag_insも0行になる(CROSS JOINで
// 空集合との結合は空集合になるため)。データ改変を伴うCTE(ins/tag_ins)は
// 最終SELECTから参照されていなくてもWITH句に含まれていれば必ず実行される
// (PostgreSQLの仕様: データ改変CTEは常に最後まで実行される)。
//
// 返り値のtagsは、挿入直後の acronym_tags を読み直す相関サブクエリ
// (tagsJsonSubquery)では作らない。同一WITH文内のサブステートメントは
// 全て同一スナップショットで実行されるため、tag_insが挿入した行は
// 同じ文の中で acronym_tags テーブルを読み直しても見えない
// (PostgreSQL 7.8.2: "they cannot see one another's effects on the
// target tables")。そのため、挿入に使ったtag_rows CTE自体をtagsへ
// 結合してJSONを組み立てる(RETURNINGと同様、同一文内で安全に
// 参照できる)。
async function insertOneAcronymWithTags(
  row: AcronymInsertRow
): Promise<Acronym[]> {
  const tagNames = Array.from(new Set(row.tags)).slice(0, 3);
  const primaryTagName = tagNames[0];

  const inserted = (await sql.query(
    `WITH primary_group AS (
       SELECT display_group FROM tags WHERE name = $4
     ),
     ins AS (
       INSERT INTO acronyms (acronym, full_spelling, japanese_translation, category, description)
       SELECT $1, $2, $3, primary_group.display_group, $5
       FROM primary_group
       ON CONFLICT (lower(acronym), lower(full_spelling)) DO NOTHING
       RETURNING id, acronym, full_spelling, japanese_translation, description, created_at
     ),
     tag_rows AS (
       SELECT t.id AS tag_id, t.name, t.display_group, t.sort_order,
              (t.name = $4) AS is_primary
       FROM tags t
       WHERE t.name = ANY($6::text[])
     ),
     tag_ins AS (
       INSERT INTO acronym_tags (acronym_id, tag_id, is_primary)
       SELECT ins.id, tag_rows.tag_id, tag_rows.is_primary
       FROM ins CROSS JOIN tag_rows
       RETURNING acronym_id
     )
     SELECT ins.id, ins.acronym, ins.full_spelling, ins.japanese_translation,
            ins.description, ins.created_at,
            COALESCE((
              SELECT json_agg(
                json_build_object(
                  'id', tag_rows.tag_id,
                  'name', tag_rows.name,
                  'display_group', tag_rows.display_group,
                  'sort_order', tag_rows.sort_order,
                  'is_primary', tag_rows.is_primary
                )
                ORDER BY tag_rows.is_primary DESC, tag_rows.sort_order, tag_rows.name
              )
              FROM tag_rows
            ), '[]'::json) AS tags
     FROM ins`,
    [
      row.acronym,
      row.full_spelling,
      row.japanese_translation,
      primaryTagName,
      row.description,
      tagNames,
    ]
  )) as unknown as Acronym[];

  return inserted;
}

// 複数解釈(同一acronym・異なるfull_spelling)を順に登録する。
// 各行は独立したCTE文でacronyms+acronym_tagsへ書き込むため、
// 行単位ではアトミックだが、複数行全体としての原子性(全行成功/
// 全行失敗)は保証されない(以前の単一INSERT文による一括書き込みからの
// 変更点。タグの対応関係を保ったまま複数行をまとめて書く単一SQL文が
// 組めなかったため。MAX_RESULTSが4件程度に抑えられていることもあり
// 許容している)。
// lower(acronym), lower(full_spelling)の大文字小文字を無視した
// UNIQUEインデックスに抵触した行はON CONFLICT DO NOTHINGでスキップし、
// エラーにはしない。RETURNING句は実際にINSERTされた行のみを返すため、
// 既存行は戻り値に含まれない。
export async function insertAcronyms(rows: AcronymInsertRow[]) {
  if (rows.length === 0) {
    return { data: [], error: null };
  }

  try {
    const data: Acronym[] = [];

    for (const row of rows) {
      const inserted = await insertOneAcronymWithTags(row);
      data.push(...inserted);
    }

    return { data, error: null };
  } catch (err) {
    return { data: null, error: toQueryError(err) };
  }
}
