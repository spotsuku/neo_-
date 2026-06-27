-- ════════════════════════════════════════════════════════════════════
-- 010_dashboard_safety.sql
-- ダッシュボードのデータ安全性を強化するための既存テーブル整備＋新規テーブル
-- ════════════════════════════════════════════════════════════════════
-- 目的:
--   1) これまで暗黙的に作っていた dashboard_data / login_history を SQL で正式管理
--   2) optimistic locking のため dashboard_data に version 列を追加
--   3) スナップショット履歴 (Google Sheets 的) を Supabase 側に永続化
--   4) すべて RLS で守る
--
-- 安全性:
--   - すべて CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
--   - 既存データは一切破壊しない
--   - Supabase SQL Editor で実行
-- ════════════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
-- 1) dashboard_data : 既に暗黙的に存在する想定。明示的に定義する
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboard_data (
  id          integer PRIMARY KEY,            -- fiscal_year - 2024 (例: 2026年度→2)
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  version     bigint      NOT NULL DEFAULT 1, -- optimistic locking
  updated_by  uuid        REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 既存テーブルに version / created_at 列が無ければ追加
ALTER TABLE public.dashboard_data
  ADD COLUMN IF NOT EXISTS version    bigint      NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_dashboard_data_updated_at
  ON public.dashboard_data (updated_at DESC);

ALTER TABLE public.dashboard_data ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザー全員が読み書き可能（既存挙動を維持）
-- ※ 将来「年度ごとに権限」を絞る場合はここを書き換える
DROP POLICY IF EXISTS "dashboard_data_select_authed" ON public.dashboard_data;
CREATE POLICY "dashboard_data_select_authed"
  ON public.dashboard_data FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "dashboard_data_insert_authed" ON public.dashboard_data;
CREATE POLICY "dashboard_data_insert_authed"
  ON public.dashboard_data FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "dashboard_data_update_authed" ON public.dashboard_data;
CREATE POLICY "dashboard_data_update_authed"
  ON public.dashboard_data FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

-- DELETE は管理者のみ（管理者判定は profiles.role を参照）
DROP POLICY IF EXISTS "dashboard_data_delete_admin" ON public.dashboard_data;
CREATE POLICY "dashboard_data_delete_admin"
  ON public.dashboard_data FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );


-- ────────────────────────────────────────────────────────────────
-- 2) dashboard_snapshots : 履歴を Supabase に永続化（端末横断）
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboard_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year   integer     NOT NULL,           -- 例: 2026
  kind          text        NOT NULL DEFAULT 'auto', -- 'auto' | 'manual' | 'pre-restore' | 'pre-import'
  label         text        NOT NULL DEFAULT '',
  data          jsonb       NOT NULL,           -- スナップショット時点の S 全体
  data_size     integer     GENERATED ALWAYS AS (octet_length(data::text)) STORED,
  created_by    uuid        REFERENCES auth.users(id),
  created_by_email text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_fy_created
  ON public.dashboard_snapshots (fiscal_year, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_snapshots_kind
  ON public.dashboard_snapshots (fiscal_year, kind, created_at DESC);

ALTER TABLE public.dashboard_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "snapshots_select_authed" ON public.dashboard_snapshots;
CREATE POLICY "snapshots_select_authed"
  ON public.dashboard_snapshots FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "snapshots_insert_authed" ON public.dashboard_snapshots;
CREATE POLICY "snapshots_insert_authed"
  ON public.dashboard_snapshots FOR INSERT
  TO authenticated WITH CHECK (true);

-- DELETE は管理者のみ（古いスナップショットの整理用）
DROP POLICY IF EXISTS "snapshots_delete_admin" ON public.dashboard_snapshots;
CREATE POLICY "snapshots_delete_admin"
  ON public.dashboard_snapshots FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );


-- ────────────────────────────────────────────────────────────────
-- 3) login_history : これまで暗黙的に書き込んでいたものを正式定義
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.login_history (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  email         text,
  display_name  text,
  user_agent    text,
  logged_in_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_time
  ON public.login_history (user_id, logged_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_history_time
  ON public.login_history (logged_in_at DESC);

ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;

-- 全員 INSERT 可能、SELECT は管理者のみ（個人ログを他人が見ない）
DROP POLICY IF EXISTS "login_history_insert_authed" ON public.login_history;
CREATE POLICY "login_history_insert_authed"
  ON public.login_history FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "login_history_select_admin_or_self" ON public.login_history;
CREATE POLICY "login_history_select_admin_or_self"
  ON public.login_history FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );


-- ────────────────────────────────────────────────────────────────
-- 4) ヘルパ関数: スナップショットを保存する RPC
--    （クライアントから直接 insert もできるが、サーバ側でユーザ情報を確実に記録するため）
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_snapshot(
  p_fiscal_year integer,
  p_label       text,
  p_kind        text,
  p_data        jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    uuid;
  v_email text;
BEGIN
  -- 認証済みユーザー必須
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.dashboard_snapshots
    (fiscal_year, kind, label, data, created_by, created_by_email)
  VALUES
    (p_fiscal_year, COALESCE(p_kind, 'auto'), COALESCE(p_label, ''), p_data, auth.uid(), v_email)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- ────────────────────────────────────────────────────────────────
-- 5) ヘルパ関数: 古いスナップショットを削減（自動間引き）
--    各年度につき auto 種別を最新 200 件残して、それ以前を削除
--    manual / pre-restore / pre-import は保持
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prune_snapshots(p_fiscal_year integer, p_keep integer DEFAULT 200)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY fiscal_year ORDER BY created_at DESC) AS rn
      FROM public.dashboard_snapshots
     WHERE fiscal_year = p_fiscal_year AND kind = 'auto'
  )
  DELETE FROM public.dashboard_snapshots ds
    USING ranked r
   WHERE ds.id = r.id AND r.rn > p_keep;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
