-- ==========================================================
-- Supabase(旧: heiwa-sns プロジェクトに間借りしていたテーブル)から
-- Neonへの移行用データ。2026-08-19時点でSupabase側の public.acronyms を
-- 読み取り専用で確認した結果、全5件で、すべて schema.sql に元々あった
-- サンプルシードデータと同一内容だった（GRANT欠落によりアプリ経由の
-- INSERTは一度も成功していなかったため、ユーザー起因の実データは0件）。
--
-- Neon無料枠は90日非アクティブでプロジェクトが削除対象になるため、
-- 復元用にidとcreated_atも含めてこのファイルにコミットしておく。
-- Supabase側のテーブル・データはまだ削除していない。
-- ==========================================================

INSERT INTO acronyms
(id, acronym, full_spelling, japanese_translation, category, description, created_at)
VALUES

(
'8891b949-694f-4b64-9555-4810130c4023',
'API',
'Application Programming Interface',
'アプリケーション・プログラミング・インターフェース',
'IT・テクノロジー',
'ソフトウェア同士がデータや機能をやり取りするための仕組み。',
'2026-08-02 16:11:41.715661+00'
),

(
'ad2ca1a7-a9ed-41d7-99b2-3045afd2fed8',
'CEO',
'Chief Executive Officer',
'最高経営責任者',
'ビジネス・経営',
'企業の経営全体に責任を持つ最高責任者。',
'2026-08-02 16:11:41.715661+00'
),

(
'd37000de-f4fa-4489-a259-8acc6f962fd6',
'NATO',
'North Atlantic Treaty Organization',
'北大西洋条約機構',
'軍事・安全保障',
'欧州・北米を中心とする集団防衛を目的とした軍事同盟。',
'2026-08-02 16:11:41.715661+00'
),

(
'7ab688b5-3c41-4adb-a2ef-e0efc21b4f7f',
'FDIC',
'Federal Deposit Insurance Corporation',
'連邦預金保険公社',
'金融・株式',
'アメリカの預金保険制度を運営する政府系機関。',
'2026-08-02 16:11:41.715661+00'
),

(
'a93d6f70-dec4-44b8-bfbf-24f69da82fe0',
'GDP',
'Gross Domestic Product',
'国内総生産',
'政治・行政',
'一定期間内に国内で生産された付加価値の合計を表す経済指標。',
'2026-08-02 16:11:41.715661+00'
)

ON CONFLICT (id) DO NOTHING;
