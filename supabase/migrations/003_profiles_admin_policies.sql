-- profiles テーブルに管理者用のDELETE/UPDATE RLSポリシーを追加
-- Supabase SQL Editor で実行してください

-- 管理者は全ユーザーのprofilesを削除できる
CREATE POLICY "Admins can delete profiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 管理者は全ユーザーのprofilesを更新できる（承認・ロール変更）
CREATE POLICY "Admins can update profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );
