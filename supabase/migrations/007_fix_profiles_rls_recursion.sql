-- profiles テーブルのRLSポリシー無限再帰を修正
-- SELECTポリシーがprofiles自身を参照して無限再帰が発生していた
-- Supabase SQL Editor で実行してください

-- 1. 再帰を起こすSELECTポリシーを削除
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;

-- 2. シンプルなSELECTポリシーに置き換え（自分のプロフィールのみ読み取り可能）
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 3. 管理者が全ユーザーのプロフィールを取得するためのRPC関数
CREATE OR REPLACE FUNCTION public.get_all_profiles()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles
  WHERE EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
  ORDER BY created_at;
$$;
