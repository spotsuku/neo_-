// ══════════════════════════════════════════════════
// users.js — ユーザー管理（管理者向け：承認・招待・削除・ロール変更・ログイン履歴）
// ══════════════════════════════════════════════════

// ── ユーザー一覧表示（管理者専用） ──
async function renderUsers() {
  if (!isAdmin()) {
    document.getElementById('users-tbody').innerHTML = '<tr><td colspan="6" style="color:var(--t3);text-align:center;padding:20px">管理者のみアクセスできます</td></tr>';
    return;
  }
  // 管理者用RPC関数で全ユーザーを取得（SELECTポリシーは自分のみのため）
  const {data: profiles, error} = await _sb.rpc('get_all_profiles');
  if (error) { console.error(error); return; }

  // pending_signups（メール未確認申請）も取得
  const {data: pendingSignups} = await _sb.from('pending_signups').select('*').order('requested_at');
  const pendingRows = (pendingSignups||[]).map(p => `
    <tr style="background:rgba(245,158,11,.05);border-left:3px solid var(--yellow)">
      <td style="font-weight:500">
        <span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--yellow);padding:1px 6px;border-radius:4px;margin-right:6px">申請中</span>
        ${p.display_name || '—'}
      </td>
      <td style="font-size:11px">${p.email}</td>
      <td style="font-size:10px;color:var(--t3)">未登録</td>
      <td style="font-size:11px">${new Date(p.requested_at).toLocaleDateString('ja-JP')}</td>
      <td>
        <button class="btn btn-xs btn-p" onclick="approvePendingSignup('${p.email}','${p.display_name||''}','${p.id}')">✅ 承認・作成</button>
      </td>
      <td><button class="btn btn-xs" style="background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.3)" onclick="deletePendingSignup('${p.id}')">削除</button></td>
    </tr>`).join('');

  const pending = (profiles||[]).filter(p => p.approved === false);
  const approved = (profiles||[]).filter(p => p.approved !== false);

  // 承認待ちがいれば上部に通知
  const pendingBanner = pending.length > 0
    ? `<tr><td colspan="6" style="background:rgba(245,158,11,.1);border-left:3px solid var(--yellow);padding:10px 14px;font-size:11px;font-weight:700;color:var(--yellow)">
        ⏳ 承認待ちのユーザーが ${pending.length}名 います
       </td></tr>`
    : '';

  document.getElementById('users-tbody').innerHTML = pendingRows + pendingBanner + (profiles||[]).map(p => {
    const isPending = p.approved === false;
    return `<tr style="${isPending ? 'background:rgba(245,158,11,.05)' : ''}">
      <td style="font-weight:500">
        ${isPending ? '<span style="font-size:9px;background:rgba(245,158,11,.15);color:var(--yellow);padding:1px 6px;border-radius:4px;margin-right:6px">承認待</span>' : ''}
        ${p.display_name || '—'}
      </td>
      <td style="font-size:11px">${p.email}</td>
      <td>
        <select onchange="changeRole('${p.id}',this.value)"
          style="background:var(--s2);border:1px solid var(--b2);border-radius:4px;color:var(--t1);font-size:10px;padding:3px 6px;font-family:var(--mono)">
          <option value="member" ${p.role==='member'?'selected':''}>メンバー</option>
          <option value="admin"  ${p.role==='admin' ?'selected':''}>管理者</option>
        </select>
      </td>
      <td>${new Date(p.created_at).toLocaleDateString('ja-JP')}</td>
      <td>
        ${isPending
          ? `<button class="btn btn-xs btn-p" onclick="approveUser('${p.id}','${p.email}')">✅ 承認</button>`
          : '<span style="font-size:10px;color:var(--green)">✓ 承認済</span>'
        }
      </td>
      <td><button class="btn btn-xs" style="background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.3)" onclick="deleteUser('${p.id}','${p.email}')">削除</button></td>
    </tr>`;
  }).join('');
}

// ── pending_signupsからユーザーを承認（管理者がパスワードを設定してアカウント作成） ──
async function approvePendingSignup(email, name, pendingId) {
  const pass = prompt(`${email} のパスワードを設定してください（8文字以上）:`);
  if (!pass || pass.length < 8) { alert('パスワードは8文字以上で設定してください'); return; }

  // 管理者セッションを保存
  const {data: {session: adminSession}} = await _sb.auth.getSession();
  window._suppressAuthEvent = true;

  const {data: signUpData, error: signUpErr} = await _sb.auth.signUp({
    email, password: pass,
    options: { data: { display_name: name } }
  });

  // 管理者セッションを即座に復元
  if (adminSession) {
    await _sb.auth.setSession({
      access_token: adminSession.access_token,
      refresh_token: adminSession.refresh_token,
    });
  }
  window._suppressAuthEvent = false;

  if (signUpErr) {
    alert('作成失敗: ' + signUpErr.message + '\n\nしばらく待ってから再試行してください。');
    return;
  }

  // 既にauth.usersに存在する場合
  if (signUpData.user && (!signUpData.user.identities || signUpData.user.identities.length === 0)) {
    alert('このユーザーは既にアカウントが存在します。');
    return;
  }

  const userId = signUpData.user?.id;
  if (!userId) {
    alert('ユーザーIDが取得できませんでした。');
    return;
  }

  // メール確認を即座に完了（RPC関数でauth.usersを更新）
  await _sb.rpc('admin_confirm_user', { target_email: email });

  // profilesに登録
  const {error: profErr} = await _sb.from('profiles').upsert({
    id: userId, email, display_name: name,
    role: 'member', approved: true,
  }, { onConflict: 'id' });

  if (profErr) {
    console.error('profiles登録エラー:', profErr);
    alert('⚠️ プロフィール登録に失敗しました。\nエラー: ' + profErr.message);
    return;
  }

  // pending_signupsから削除
  await _sb.from('pending_signups').delete().eq('id', pendingId);
  alert(`✅ ${email} を承認しました。\nパスワード: ${pass}\n\n本人にお知らせください。`);
  renderUsers();
}

// ── 申請削除 ──
async function deletePendingSignup(id) {
  if (!confirm('この申請を削除しますか？')) return;
  await _sb.from('pending_signups').delete().eq('id', id);
  renderUsers();
}

// ── ユーザー承認 ──
async function approveUser(userId, email) {
  if (!isAdmin()) return;
  const {error} = await _sb.from('profiles').update({approved: true}).eq('id', userId);
  if (error) { alert('承認失敗: ' + error.message); return; }
  alert(`✅ ${email} を承認しました。このユーザーはログインできるようになります。`);
  renderUsers();
}

// ── ロール変更 ──
async function changeRole(userId, newRole) {
  if (!isAdmin()) return;
  const {error} = await _sb.from('profiles').update({role: newRole}).eq('id', userId);
  if (error) alert('更新失敗: ' + error.message);
}

// ── ユーザー削除 ──
async function deleteUser(userId, email) {
  if (!isAdmin()) return;
  // 自分自身の削除を防止
  if (userId === _currentUser?.id) {
    alert('⚠️ 自分自身は削除できません。');
    return;
  }
  if (!confirm(`${email} を削除しますか？\n\nprofilesから削除します。\nauth.usersはSupabaseダッシュボードから手動削除してください。`)) return;

  const {error: profErr} = await _sb.from('profiles').delete().eq('id', userId);
  if (profErr) {
    alert('削除失敗: ' + profErr.message + '\n\nSupabaseダッシュボードのSQL Editorで削除してください:\nDELETE FROM profiles WHERE id = \'' + userId + '\';\nDELETE FROM auth.users WHERE id = \'' + userId + '\';');
  } else {
    alert(`✅ ${email} をprofilesから削除しました。\n\n※ auth.usersからも削除する場合は、SupabaseダッシュボードのAuthentication→Usersから手動削除してください。`);
  }
  renderUsers();
}

// ── 招待パネル ──
function openInvitePanel() { openOv('ov-invite'); }

async function doInviteUser() {
  if (!isAdmin()) return;
  const email = document.getElementById('inv-email').value.trim();
  const name  = document.getElementById('inv-name').value.trim();
  const role  = document.getElementById('inv-role').value;
  const pass  = document.getElementById('inv-pass').value;
  if (!email || !pass) { alert('メールアドレスとパスワードを入力してください'); return; }

  const btn = document.querySelector('#ov-invite .btn-p');
  if (btn) { btn.textContent = '作成中...'; btn.disabled = true; }

  try {
    // 管理者セッションを保存（signUpでセッションが上書きされるため）
    const {data: {session: adminSession}} = await _sb.auth.getSession();
    window._suppressAuthEvent = true;

    const {data, error} = await _sb.auth.signUp({
      email, password: pass,
      options: { data: { display_name: name } }
    });

    // 管理者セッションを即座に復元
    if (adminSession) {
      await _sb.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    }
    window._suppressAuthEvent = false;

    if (error) {
      alert('作成失敗: ' + error.message);
      return;
    }

    // メール確認を即座に完了（RPC関数でauth.usersを更新）
    await _sb.rpc('admin_confirm_user', { target_email: email });

    // profilesに登録
    if (data.user) {
      await _sb.from('profiles').upsert({
        id: data.user.id,
        email: email,
        display_name: name,
        role: role,
        approved: true,
      });
    }

    alert(`✅ ${name}（${email}）を${role==='admin'?'管理者':'メンバー'}として作成しました

パスワード: ${pass}

本人にパスワード変更を促してください。`);
    closeOv('ov-invite');
    renderUsers();
  } finally {
    if (btn) { btn.textContent = '作成する'; btn.disabled = false; }
  }
}

// ── ログイン履歴 ──
async function renderHistory() {
  let query = _sb.from('login_history').select('*').order('logged_in_at', {ascending: false}).limit(100);
  if (!isAdmin()) query = query.eq('user_id', _currentUser?.id);
  const {data, error} = await query;
  if (error) { console.error(error); return; }
  document.getElementById('history-tbody').innerHTML = (data||[]).map(h => `
    <tr>
      <td>${new Date(h.logged_in_at).toLocaleString('ja-JP')}</td>
      <td>${isAdmin() ? (h.email?.split('@')[0] || '—') : '自分'}</td>
      <td>${h.email || '—'}</td>
    </tr>`).join('');
}
