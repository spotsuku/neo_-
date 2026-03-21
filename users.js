// ══════════════════════════════════════════════════
// users.js — ユーザー管理（管理者向け）
// ユーザー作成は Edge Function (create-user) 経由のみ
// signUp / pending_signups フローは廃止
// ══════════════════════════════════════════════════

// ── ユーザー一覧 ──
async function renderUsers() {
  if (!isAdmin()) {
    document.getElementById('users-tbody').innerHTML =
      '<tr><td colspan="6" style="color:var(--t3);text-align:center;padding:20px">管理者のみアクセスできます</td></tr>';
    return;
  }

  const { data: profiles, error } = await _sb.rpc('get_all_profiles');
  if (error) {
    console.error('[renderUsers]', error);
    document.getElementById('users-tbody').innerHTML =
      `<tr><td colspan="6" style="color:var(--red);padding:16px">読み込みエラー: ${error.message}</td></tr>`;
    return;
  }

  if (!profiles || profiles.length === 0) {
    document.getElementById('users-tbody').innerHTML =
      '<tr><td colspan="6" style="color:var(--t3);text-align:center;padding:20px">ユーザーがいません</td></tr>';
    return;
  }

  document.getElementById('users-tbody').innerHTML = profiles.map(p => {
    const isSelf    = p.id === _currentUser?.id;
    const isApproved = p.approved !== false;
    return `<tr>
      <td style="font-weight:500">
        ${!isApproved ? '<span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--yellow);padding:1px 6px;border-radius:4px;margin-right:6px">承認待</span>' : ''}
        ${p.display_name || '—'}
        ${isSelf ? '<span style="font-size:9px;color:var(--t3);margin-left:4px">（自分）</span>' : ''}
      </td>
      <td style="font-size:11px">${p.email}</td>
      <td>
        <select onchange="changeRole('${p.id}', this.value)" ${isSelf ? 'disabled' : ''}
          style="background:var(--s2);border:1px solid var(--b2);border-radius:4px;
                 color:var(--t1);font-size:10px;padding:3px 6px;font-family:var(--mono)">
          <option value="member" ${p.role === 'member' ? 'selected' : ''}>メンバー</option>
          <option value="admin"  ${p.role === 'admin'  ? 'selected' : ''}>管理者</option>
        </select>
      </td>
      <td style="font-size:11px">${new Date(p.created_at).toLocaleDateString('ja-JP')}</td>
      <td>
        ${isApproved
          ? '<span style="font-size:10px;color:var(--green)">✓ 承認済</span>'
          : `<button class="btn btn-xs btn-p" onclick="approveUser('${p.id}')">✅ 承認</button>`
        }
      </td>
      <td>
        ${isSelf ? '' : `<button class="btn btn-xs btn-red" onclick="deleteUser('${p.id}', '${p.email}')">削除</button>`}
      </td>
    </tr>`;
  }).join('');
}

// ── ロール変更 ──
async function changeRole(userId, newRole) {
  if (!isAdmin()) return;
  const { error } = await _sb.from('profiles').update({ role: newRole }).eq('id', userId);
  if (error) {
    alert('ロール変更に失敗しました: ' + error.message);
  }
}

// ── ユーザー承認 ──
async function approveUser(userId) {
  if (!isAdmin()) return;
  const { error } = await _sb.from('profiles').update({ approved: true }).eq('id', userId);
  if (error) {
    alert('承認に失敗しました: ' + error.message);
    return;
  }
  await renderUsers();
}

// ── ユーザー削除 ──
async function deleteUser(userId, email) {
  if (!isAdmin()) return;
  if (userId === _currentUser?.id) {
    alert('自分自身は削除できません。');
    return;
  }
  if (!confirm(`「${email}」を削除しますか？\n\nprofiles から削除します。\nauth.users は Supabase ダッシュボードから手動削除してください。`)) return;

  // ① Edge Function で auth.users から削除を試みる
  try {
    const { data: { session } } = await _sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ userId }),
    });
    const result = await res.json();
    if (!result.success) {
      console.warn('[deleteUser] Edge Function:', result.error);
    }
  } catch (e) {
    console.warn('[deleteUser] Edge Function 失敗（profiles のみ削除）:', e.message);
  }

  // ② profiles から削除
  const { error } = await _sb.from('profiles').delete().eq('id', userId);
  if (error) {
    alert('削除に失敗しました: ' + error.message);
    return;
  }

  alert(`✅ ${email} を削除しました。`);
  await renderUsers();
}

// ══════════════════════════════════════════════════
// ユーザー招待（管理者のみ）
// Edge Function (create-user) 経由で作成
// ══════════════════════════════════════════════════
function openInvitePanel() {
  // フォームをリセット
  ['inv-email', 'inv-name', 'inv-pass'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const roleEl = document.getElementById('inv-role');
  if (roleEl) roleEl.value = 'member';
  document.getElementById('invite-error').style.display = 'none';
  openOv('ov-invite');
}

function showInviteError(msg) {
  const el = document.getElementById('invite-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

async function doInviteUser() {
  if (!isAdmin()) return;

  const email = document.getElementById('inv-email')?.value.trim() || '';
  const name  = document.getElementById('inv-name')?.value.trim()  || '';
  const role  = document.getElementById('inv-role')?.value          || 'member';
  const pass  = document.getElementById('inv-pass')?.value          || '';

  if (!email || !pass) {
    showInviteError('メールアドレスとパスワードを入力してください');
    return;
  }
  if (pass.length < 8) {
    showInviteError('パスワードは8文字以上で設定してください');
    return;
  }

  const btn = document.querySelector('#ov-invite .btn-p');
  if (btn) { btn.textContent = '作成中...'; btn.disabled = true; }
  showInviteError('');

  try {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) {
      showInviteError('セッションが切れています。再ログインしてください。');
      return;
    }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email,
        password:     pass,
        display_name: name,
        role,
      }),
    });

    const result = await res.json();

    if (!result.success) {
      showInviteError('作成失敗: ' + (result.error || '不明なエラー'));
      return;
    }

    alert(
      `✅ ユーザーを作成しました\n\n` +
      `名前: ${name || email}\n` +
      `メール: ${email}\n` +
      `ロール: ${role === 'admin' ? '管理者' : 'メンバー'}\n` +
      `パスワード: ${pass}\n\n` +
      `本人にパスワード変更をお願いしてください。`
    );
    closeOv('ov-invite');
    await renderUsers();

  } catch (e) {
    showInviteError('予期しないエラー: ' + e.message);
  } finally {
    if (btn) { btn.textContent = '作成する'; btn.disabled = false; }
  }
}

// ══════════════════════════════════════════════════
// ログイン履歴
// ══════════════════════════════════════════════════
async function renderHistory() {
  let query = _sb
    .from('login_history')
    .select('*')
    .order('logged_in_at', { ascending: false })
    .limit(200);

  // メンバーは自分の履歴のみ
  if (!isAdmin()) {
    query = query.eq('user_id', _currentUser?.id);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[renderHistory]', error);
    return;
  }

  const tbody = document.getElementById('history-tbody');
  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--t3);text-align:center;padding:20px">履歴がありません</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(h => `
    <tr>
      <td style="font-family:var(--mono);font-size:11px">
        ${new Date(h.logged_in_at).toLocaleString('ja-JP')}
      </td>
      <td>${isAdmin() ? (h.email?.split('@')[0] || '—') : '自分'}</td>
      <td style="font-size:11px">${h.email || '—'}</td>
    </tr>`).join('');
}
