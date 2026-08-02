-- Acronyms table for real-time search app
CREATE TABLE IF NOT EXISTS acronyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acronym TEXT NOT NULL,
  full_spelling TEXT NOT NULL,
  reading TEXT NOT NULL,
  japanese_translation TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'ビジネス・経営',
      '金融・株式',
      '政治・行政',
      '軍事・安全保障',
      'IT・テクノロジー',
      'その他'
    )
  ),
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint on acronym (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_acronyms_acronym_unique
  ON acronyms (UPPER(acronym));

-- Search performance index
CREATE INDEX IF NOT EXISTS idx_acronyms_acronym
  ON acronyms (acronym);

CREATE INDEX IF NOT EXISTS idx_acronyms_acronym_upper
  ON acronyms (UPPER(acronym));

CREATE INDEX IF NOT EXISTS idx_acronyms_category
  ON acronyms (category);

-- Enable Row Level Security
ALTER TABLE acronyms ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access"
  ON acronyms FOR SELECT
  USING (true);

-- Allow insert via anon key (for API route)
-- NOTE: If INSERT fails with RLS error (code 42501), run the block below
-- in Supabase SQL Editor to recreate policies safely.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'acronyms' AND policyname = 'Allow public insert'
  ) THEN
    CREATE POLICY "Allow public insert"
      ON acronyms FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- RLS troubleshooting (run separately if INSERT still fails)
-- ============================================================
-- Option A: Recreate INSERT policy (recommended)
-- DROP POLICY IF EXISTS "Allow public insert" ON acronyms;
-- CREATE POLICY "Allow public insert"
--   ON acronyms FOR INSERT
--   TO anon, authenticated
--   WITH CHECK (true);
--
-- Option B: Disable RLS entirely (development only, NOT for production)
-- ALTER TABLE acronyms DISABLE ROW LEVEL SECURITY;
--
-- Verify policies:
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies WHERE tablename = 'acronyms';

-- Sample seed data
INSERT INTO acronyms (acronym, full_spelling, reading, japanese_translation, category, description)
VALUES
  ('CEO', 'Chief Executive Officer', 'シーイーオー', '最高経営責任者', 'ビジネス・経営', '企業の最高位の経営者。会社全体の経営戦略の策定と実行の最終責任者。'),
  ('API', 'Application Programming Interface', 'エーピーアイ', 'アプリケーションプログラミングインターフェース', 'IT・テクノロジー', 'ソフトウェア同士が連携するための仕様・窓口。Webサービス連携の基盤。'),
  ('GDP', 'Gross Domestic Product', 'ジーディーピー', '国内総生産', '金融・株式', '一定期間に国内で生産された付加価値の総額。経済規模を示す指標。'),
  ('NATO', 'North Atlantic Treaty Organization', 'ナトー', '北大西洋条約機構', '軍事・安全保障', '北米とヨーロッパの加盟国による軍事同盟。集団防衛を目的とする。'),
  ('PWA', 'Progressive Web App', 'ピーダブリューエー', 'プログレッシブウェブアプリ', 'IT・テクノロジー', 'Web技術でネイティブアプリのような体験を提供するアプリケーション。')
ON CONFLICT DO NOTHING;

-- Note: Run this SQL in Supabase SQL Editor to set up the database.
