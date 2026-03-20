-- 自分のプロフィールを安全に取得するRPC関数
-- SECURITY DEFINER でRLSをバイパスし、自分のプロフィールのみ返す
-- Supabase SQL Editor で実行してください

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE(role text, display_name text, approved boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role, display_name, approved
  FROM public.profiles
  WHERE id = auth.uid();
$$;
