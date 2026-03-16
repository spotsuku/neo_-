-- pending_signups: メール確認有効時の新規登録申請を保持するテーブル
-- Supabase SQL Editor で実行してください

CREATE TABLE IF NOT EXISTS public.pending_signups (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  display_name TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS有効化
ALTER TABLE public.pending_signups ENABLE ROW LEVEL SECURITY;

-- 誰でもINSERTできる（未ログインユーザーが登録申請するため）
CREATE POLICY "Anyone can insert pending_signups"
  ON public.pending_signups FOR INSERT
  WITH CHECK (true);

-- SELECTは認証済みユーザーのみ（管理者がrenderUsersで取得）
CREATE POLICY "Authenticated users can read pending_signups"
  ON public.pending_signups FOR SELECT
  TO authenticated
  USING (true);

-- DELETEは認証済みユーザーのみ（管理者が承認・削除時に使用）
CREATE POLICY "Authenticated users can delete pending_signups"
  ON public.pending_signups FOR DELETE
  TO authenticated
  USING (true);
