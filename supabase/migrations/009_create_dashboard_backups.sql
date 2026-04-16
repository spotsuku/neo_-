-- dashboard_backups: 自動バックアップテーブル
CREATE TABLE IF NOT EXISTS dashboard_backups (
  id BIGSERIAL PRIMARY KEY,
  fiscal_year_id INTEGER NOT NULL,
  data JSONB NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  label TEXT DEFAULT '自動バックアップ'
);

-- RLS有効化
ALTER TABLE dashboard_backups ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーはINSERTとSELECTが可能
CREATE POLICY "authenticated_insert_backups" ON dashboard_backups
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_select_backups" ON dashboard_backups
  FOR SELECT TO authenticated USING (true);

-- 古いバックアップを自動削除（各年度ごとに最新50件を保持）
-- 手動でSQLを実行するか、cron jobで定期的に実行
-- DELETE FROM dashboard_backups WHERE id NOT IN (
--   SELECT id FROM dashboard_backups ORDER BY created_at DESC LIMIT 50
-- );
