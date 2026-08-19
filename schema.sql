-- ==========================================================
-- Acronyms table (Neon / plain Postgres)
-- Supabase固有機能(RLS/ポリシー/GRANT)は使用しないため削除。
-- Neonの接続ロール(接続文字列のユーザー)がテーブル所有者になり、
-- 所有者はデフォルトで自分のテーブルに対する全権限を持つため、
-- 明示的なGRANT文は不要。
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS acronyms (

    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    acronym text NOT NULL,

    full_spelling text NOT NULL,

    japanese_translation text NOT NULL,

    category text NOT NULL,

    description text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    -- (b) acronym + full_spelling の複合一意制約。
    -- 同一略語が領域ごとに異なる正式名称を持つケース
    -- (例: VSPRO = Vision/Strategy/Process/Resource/Organization という
    -- ビジネスフレームワークと、ITの別概念の両方)に対応するため、
    -- acronym単体ではなく(acronym, full_spelling)の組でユニークとする。
    -- categoryではなくfull_spellingを使うのは、同一カテゴリ内でも
    -- 正式名称が異なる別解釈がありうるため。
    -- このUNIQUE制約は(acronym, full_spelling)の複合B-treeインデックスを
    -- 自動生成する。先頭列がacronymなので、acronym単体での完全一致検索や
    -- ORDER BY acronymにもこのインデックスがそのまま使える。
    CONSTRAINT acronyms_acronym_full_spelling_unique
        UNIQUE (acronym, full_spelling),

    CONSTRAINT acronyms_uppercase_check
        CHECK (acronym = UPPER(acronym)),

    -- (c) category のCHECK制約。lib/types.ts の CATEGORIES（"すべて"を除く6件）と一致させること。
    CONSTRAINT acronyms_category_check
        CHECK (
            category IN (
                'ビジネス・経営',
                '金融・株式',
                '政治・行政',
                '軍事・安全保障',
                'IT・テクノロジー',
                'その他'
            )
        )

);

-- ==========================================================
-- (a) 前方一致検索用インデックス
-- ==========================================================
-- 検索クエリは常に `WHERE acronym LIKE 'XX%'` の形（前方一致）。
-- acronym は acronyms_uppercase_check により常に大文字で保存され、
-- アプリ側（app/page.tsx・APIルート）も検索語を送信前に必ず
-- toUpperCase() している。つまり検索時点で大文字・小文字の揺れは
-- 発生しないため、大文字小文字を無視するILIKEや lower(acronym) の
-- 式インデックスは不要で、素の acronym 列に対する
-- text_pattern_ops のB-treeインデックスで前方一致検索が最短距離で効く。
-- （デフォルトのtext_ops索引は等号・ORDER BY用で、LIKEの前方一致には
-- 使われないため text_pattern_ops が必須）
CREATE INDEX IF NOT EXISTS idx_acronyms_acronym_prefix
ON acronyms (acronym text_pattern_ops);

-- ==========================================================
-- Sample / seed data はこのファイルに含めない。
-- Supabase(旧環境)から移行した実データは docs/seed.sql にあり、
-- 元のid/created_atを保持したまま投入できる。このschema.sqlを
-- 適用した後、続けて docs/seed.sql を実行すること。
-- ==========================================================
