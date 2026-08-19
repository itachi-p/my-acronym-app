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

    -- (a) categoryのCHECK制約。lib/types.ts の CATEGORIES（"すべて"を除く6件）と一致させること。
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
-- (b) acronym + full_spelling の大文字小文字を無視した複合一意インデックス
-- ==========================================================
-- 入力の強制大文字化はしない（TOCfE = Theory of Constraints for
-- Education のように大小文字混在の略語が存在し、変換すると復元
-- できないため）。保存する acronym / full_spelling は入力表記の
-- ままとする。
--
-- 一方、重複判定（同一略語・同一正式名称の二重登録防止）は
-- 大文字小文字を区別したくない（"TOCfE" と "TOCFE" が別レコードに
-- なってしまうのは避けたい）。この2つの要求を両立するため、
-- 生の(acronym, full_spelling)列に対するUNIQUE制約ではなく、
-- lower(acronym), lower(full_spelling) を対象とするUNIQUEインデックス
-- にする。表記はそのまま保存され、重複判定のみ大小文字を無視する。
--
-- 式インデックスはCREATE TABLE内のUNIQUE制約としては書けないため、
-- テーブル定義の外でCREATE UNIQUE INDEXする。ON CONFLICTのターゲットも
-- このインデックスの式(lower(acronym), lower(full_spelling))に
-- 合わせること（lib/db-server.ts 参照）。
CREATE UNIQUE INDEX IF NOT EXISTS acronyms_acronym_full_spelling_ci_unique
ON acronyms (lower(acronym), lower(full_spelling));

-- ==========================================================
-- (c) 前方一致検索用インデックス（大文字小文字を無視）
-- ==========================================================
-- 検索は `WHERE lower(acronym) LIKE lower('xx') || '%'` の形
-- （前方一致・大文字小文字を無視）で行う。acronymは入力表記の
-- まま保存され大文字小文字が揺れるため、素のacronym列ではなく
-- lower(acronym) に対するtext_pattern_opsのB-treeインデックスを
-- 張る（デフォルトのtext_ops索引は等号・ORDER BY用で、LIKEの
-- 前方一致には使われないため text_pattern_ops が必須）。
CREATE INDEX IF NOT EXISTS idx_acronyms_acronym_prefix
ON acronyms (lower(acronym) text_pattern_ops);

-- ==========================================================
-- Sample / seed data はこのファイルに含めない。
-- Supabase(旧環境)から移行した実データは docs/seed.sql にあり、
-- 元のid/created_atを保持したまま投入できる。このschema.sqlを
-- 適用した後、続けて docs/seed.sql を実行すること。
-- ==========================================================
