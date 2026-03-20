-- profiles テーブルにSELECT RLSポリシーを追加
-- 認証済みユーザーが自分のプロフィールを読み取れるようにする
-- 管理者は全ユーザーのプロフィールを読み取れる（ユーザー管理画面用）
-- Supabase SQL Editor で実行してください

-- ユーザーは自分のプロフィールを読み取れる
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );
