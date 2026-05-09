-- マネーフォワード債務支払い OAuth2 連携用テーブル
-- mf_oauth_tokens : ユーザー毎の access/refresh トークン（service_role のみ操作）
-- mf_oauth_states : PKCE フロー一時保管（state → user_id, code_verifier, 10分TTL）
-- Supabase SQL Editor で実行してください

-- ─────────────────────────────────────────────
-- 1. mf_oauth_tokens
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mf_oauth_tokens (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token   text        NOT NULL,
  refresh_token  text        NOT NULL,
  token_type     text        NOT NULL DEFAULT 'Bearer',
  scope          text,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mf_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- クライアント（authenticated）からは「自分が連携済みかどうかだけ」確認可能
-- access/refresh token 自体はクライアントから読めない（service_role のみ）
DROP POLICY IF EXISTS "mf_tokens_no_client_select" ON public.mf_oauth_tokens;
CREATE POLICY "mf_tokens_no_client_select"
  ON public.mf_oauth_tokens FOR SELECT
  TO authenticated
  USING (false);

-- 連携状況のみ確認できる RPC（行が存在するか + expires_at だけ返す）
CREATE OR REPLACE FUNCTION public.mf_is_linked()
RETURNS TABLE(linked boolean, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS(SELECT 1 FROM public.mf_oauth_tokens WHERE user_id = auth.uid()) AS linked,
    (SELECT expires_at FROM public.mf_oauth_tokens WHERE user_id = auth.uid()) AS expires_at;
$$;

-- 連携解除用 RPC（自分のレコードだけ削除）
CREATE OR REPLACE FUNCTION public.mf_unlink()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.mf_oauth_tokens WHERE user_id = auth.uid();
$$;

-- ─────────────────────────────────────────────
-- 2. mf_oauth_states (PKCE 一時保管)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mf_oauth_states (
  state          text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier  text NOT NULL,
  redirect_uri   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mf_oauth_states_created
  ON public.mf_oauth_states (created_at);

ALTER TABLE public.mf_oauth_states ENABLE ROW LEVEL SECURITY;
-- service_role 以外からのアクセスは一切許可しない（ポリシー無し = deny all）

-- ─────────────────────────────────────────────
-- 3. updated_at 自動更新トリガー
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mf_oauth_tokens_touch ON public.mf_oauth_tokens;
CREATE TRIGGER mf_oauth_tokens_touch
  BEFORE UPDATE ON public.mf_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
