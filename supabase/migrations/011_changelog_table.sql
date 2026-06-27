-- ════════════════════════════════════════════════════════════════════
-- 011_changelog_table.sql
-- 変更履歴 (changelog) を S.changelog から専用テーブルへ
-- ════════════════════════════════════════════════════════════════════
-- これまで S.changelog (上限500件) として dashboard_data の jsonb 内に保持していた
-- 変更履歴を、独立テーブルで永久保持・検索可能に。
--
-- 安全性: 既存 S.changelog はそのまま残す（取り急ぎは並行運用）。
--         クライアントから順次新テーブルへ書き込みつつ、古い物は読み続けられる。
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dashboard_changelog (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year   integer     NOT NULL,
  type          text        NOT NULL,              -- 'session'|'event'|'budget'|'ledger'|'mkt'|'prod'|'other'
  description   text        NOT NULL,
  before_text   text,
  after_text    text,
  meta          jsonb,                             -- 任意の追加情報
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email    text,
  user_name     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_changelog_fy_created
  ON public.dashboard_changelog (fiscal_year, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_changelog_fy_type_created
  ON public.dashboard_changelog (fiscal_year, type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_changelog_user_created
  ON public.dashboard_changelog (user_id, created_at DESC);

ALTER TABLE public.dashboard_changelog ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーは全件 SELECT 可能
DROP POLICY IF EXISTS "changelog_select_authed" ON public.dashboard_changelog;
CREATE POLICY "changelog_select_authed"
  ON public.dashboard_changelog FOR SELECT
  TO authenticated USING (true);

-- INSERT: 認証ユーザー全員
DROP POLICY IF EXISTS "changelog_insert_authed" ON public.dashboard_changelog;
CREATE POLICY "changelog_insert_authed"
  ON public.dashboard_changelog FOR INSERT
  TO authenticated WITH CHECK (true);

-- DELETE: 管理者のみ
DROP POLICY IF EXISTS "changelog_delete_admin" ON public.dashboard_changelog;
CREATE POLICY "changelog_delete_admin"
  ON public.dashboard_changelog FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );


-- ────────────────────────────────────────────────────────────────
-- RPC: 履歴を追加する（サーバ側で確実にユーザー情報を記録）
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_change(
  p_fiscal_year integer,
  p_type        text,
  p_description text,
  p_before      text DEFAULT NULL,
  p_after       text DEFAULT NULL,
  p_meta        jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_email text;
  v_name  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  SELECT display_name INTO v_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.dashboard_changelog
    (fiscal_year, type, description, before_text, after_text, meta, user_id, user_email, user_name)
  VALUES
    (p_fiscal_year, COALESCE(p_type,'other'), COALESCE(p_description,''),
     p_before, p_after, p_meta, auth.uid(), v_email, v_name)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
