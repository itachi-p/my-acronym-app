-- ==========================================================
-- Acronyms table (Rebuild)
-- ==========================================================

-- Drop old policies
DROP POLICY IF EXISTS "Allow public read access" ON public.acronyms;
DROP POLICY IF EXISTS "Allow public insert" ON public.acronyms;

-- Drop old table
DROP TABLE IF EXISTS public.acronyms CASCADE;

-- UUID extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================================
-- Table
-- ==========================================================

CREATE TABLE public.acronyms (

    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    acronym text NOT NULL,

    full_spelling text NOT NULL,

    japanese_translation text NOT NULL,

    category text NOT NULL,

    description text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT acronyms_acronym_unique
        UNIQUE(acronym),

    CONSTRAINT acronyms_uppercase_check
        CHECK (acronym = UPPER(acronym))

);

-- ==========================================================
-- Index
-- ==========================================================

CREATE INDEX idx_acronyms_acronym
ON public.acronyms(acronym);

-- ==========================================================
-- RLS
-- ==========================================================

ALTER TABLE public.acronyms
ENABLE ROW LEVEL SECURITY;

-- Everyone can SELECT

CREATE POLICY "Allow public read access"
ON public.acronyms
FOR SELECT
TO public
USING (true);

-- ==========================================================
-- Sample Data
-- ==========================================================

INSERT INTO public.acronyms
(
    acronym,
    full_spelling,
    japanese_translation,
    category,
    description
)
VALUES

(
'API',
'Application Programming Interface',
'アプリケーション・プログラミング・インターフェース',
'IT・テクノロジー',
'ソフトウェア同士がデータや機能をやり取りするための仕組み。'
),

(
'CEO',
'Chief Executive Officer',
'最高経営責任者',
'ビジネス・経営',
'企業の経営全体に責任を持つ最高責任者。'
),

(
'NATO',
'North Atlantic Treaty Organization',
'北大西洋条約機構',
'軍事・安全保障',
'欧州・北米を中心とする集団防衛を目的とした軍事同盟。'
),

(
'FDIC',
'Federal Deposit Insurance Corporation',
'連邦預金保険公社',
'金融・株式',
'アメリカの預金保険制度を運営する政府系機関。'
),

(
'GDP',
'Gross Domestic Product',
'国内総生産',
'政治・行政',
'一定期間内に国内で生産された付加価値の合計を表す経済指標。'
);