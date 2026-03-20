-- ユーザーのメール確認を即座に完了するRPC関数（管理者のみ）
-- auth.signUp()で作成されたユーザーのemail_confirmed_atを設定する
-- Supabase SQL Editor で実行してください

CREATE OR REPLACE FUNCTION public.admin_confirm_user(target_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 呼び出し元が管理者か確認
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- auth.usersのメール確認を完了
  UPDATE auth.users
  SET email_confirmed_at = now()
  WHERE email = target_email
    AND email_confirmed_at IS NULL;
END;
$$;
