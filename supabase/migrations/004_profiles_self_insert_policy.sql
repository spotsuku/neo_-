-- ユーザーが自分のプロフィールを作成できるポリシー
-- onLogin時にprofileが存在しない場合の自動作成に必要
-- Supabase SQL Editor で実行してください

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);
