# メール確認の無効化手順

Supabaseダッシュボードで以下の操作を行ってください：

1. **Authentication** → **Providers** → **Email** を開く
2. **Confirm email** のトグルを **OFF** にする
3. **Save** をクリック

これにより、新規ユーザー登録時にメール確認が不要になり、
`doSignup()` で即座に `profiles` テーブルに `approved: false` で登録されます。
管理者がユーザー管理ページで承認するまでログインはできません。
