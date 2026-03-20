// create-user Edge Function
// 管理者がpending_signupsからユーザーを承認・作成するためのEdge Function
// service_roleキーを使うため、クライアント側のセッション切替やレート制限を回避
//
// デプロイ: supabase functions deploy create-user
// 環境変数: SUPABASE_SERVICE_ROLE_KEY（自動設定済み）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders })
  }

  try {
    // 呼び出し元の認証チェック
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 呼び出し元ユーザーが管理者か確認
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller }, error: authErr } = await supabaseClient.auth.getUser()
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // リクエストボディ
    const { email, password, display_name, pending_id } = await req.json()
    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'email and password are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Service Role Keyでadmin APIを使用
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1. auth.usersにユーザー作成（admin APIはレート制限なし、メール確認不要）
    const { data: userData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name },
    })

    if (createErr) {
      // 既にユーザーが存在する場合
      if (createErr.message.includes('already') || createErr.message.includes('exists')) {
        // 既存ユーザーのパスワードを更新
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
        const existingUser = existingUsers?.users?.find(u => u.email === email)
        if (existingUser) {
          await supabaseAdmin.auth.admin.updateUser(existingUser.id, { password })
          // profilesを更新
          await supabaseAdmin.from('profiles').upsert({
            id: existingUser.id, email, display_name,
            role: 'member', approved: true,
          }, { onConflict: 'id' })
          // pending_signupsから削除
          if (pending_id) {
            await supabaseAdmin.from('pending_signups').delete().eq('id', pending_id)
          }
          return new Response(JSON.stringify({ success: true, userId: existingUser.id, existed: true }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = userData.user.id

    // 2. profilesに登録
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert({
      id: userId, email, display_name,
      role: 'member', approved: true,
    }, { onConflict: 'id' })

    if (profErr) {
      return new Response(JSON.stringify({ error: 'Profile creation failed: ' + profErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. pending_signupsから削除
    if (pending_id) {
      await supabaseAdmin.from('pending_signups').delete().eq('id', pending_id)
    }

    return new Response(JSON.stringify({ success: true, userId }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
