// ══════════════════════════════════════════════════
// auth.js — 認証コア（ログイン/ログアウト/サインアップ/セッション管理/権限）
// ══════════════════════════════════════════════════

// Supabase設定：起動時に /api/config から取得（Vercel環境変数を安全に参照）
// 開発時フォールバックとして直接記載（anon keyはRLSで保護済み）
let SUPABASE_URL     = 'https://hhifpqlbgyjdfbluigfo.supabase.co';
let SUPABASE_ANON_KEY= 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoaWZwcWxiZ3lqZGZibHVpZ2ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTkyNTksImV4cCI6MjA4ODk3NTI1OX0.hjycUEUf_Kr9iUDrs4GQZvqVWtcfi4Ij4mEfq-HM5c0';

// /api/config が使えるVercel環境ではそちらを優先
async function initConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.supabaseUrl)     SUPABASE_URL      = cfg.supabaseUrl;
      if (cfg.supabaseAnonKey) SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
      console.log('[config] Loaded from /api/config');
    }
  } catch(e) {
    // ローカル開発時やAPIなし環境ではフォールバック値を使用
    console.log('[config] Using fallback (local dev)');
  }
}

// クライアントは initAuth() 内で initConfig() 完了後に生成
let _sb = null;

// ── 現在のログインユーザー ──
let _currentUser  = null;   // supabase Userオブジェクト
let _currentRole  = null;   // 'admin' | 'member'
let _currentName  = '';

// ── ロールチェック ──
const isAdmin  = () => _currentRole === 'admin';
const isLogged = () => !!_currentUser;

// ── 権限UIの切り替え ──
function applyRoleUI() {
  // 管理者専用ボタンの表示制御
  const adminEls = document.querySelectorAll('.admin-only');
  adminEls.forEach(el => el.style.display = isAdmin() ? '' : 'none');
  // ユーザー管理ナビ
  const nbUsers = document.getElementById('nb-users');
  if (nbUsers) nbUsers.style.display = isAdmin() ? '' : 'none';
  // サイドバーユーザー情報
  const uib = document.getElementById('user-info-bar');
  const logoutBtn = document.getElementById('logout-btn');
  if (uib) uib.style.display = _currentUser ? '' : 'none';
  if (logoutBtn) logoutBtn.style.display = _currentUser ? '' : 'none';
  if (document.getElementById('user-display-name'))
    document.getElementById('user-display-name').textContent = _currentName || _currentUser?.email || '';
  if (document.getElementById('user-role-badge'))
    document.getElementById('user-role-badge').innerHTML = isAdmin()
      ? '<span style="font-size:8px;background:rgba(240,82,42,.2);color:#f0522a;padding:1px 6px;border-radius:4px;font-weight:700">管理者</span>'
      : '<span style="font-size:8px;background:rgba(79,142,247,.15);color:#4f8ef7;padding:1px 6px;border-radius:4px;font-weight:700">メンバー</span>';
}

// ── ログインタブ切替 ──
function switchLoginTab(tab) {
  document.getElementById('form-login').style.display  = tab==='login'  ? '' : 'none';
  document.getElementById('form-signup').style.display = tab==='signup' ? '' : 'none';
  document.getElementById('tab-login').className  = 'tab' + (tab==='login'  ? ' on' : '');
  document.getElementById('tab-signup').className = 'tab' + (tab==='signup' ? ' on' : '');
  document.getElementById('login-error').style.display = 'none';
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = '';
}

// ── ログイン ──
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) { showLoginError('メールアドレスとパスワードを入力してください'); return; }
  const btn = document.getElementById('login-submit-btn');
  btn.textContent = 'ログイン中...'; btn.disabled = true;
  const {data, error} = await _sb.auth.signInWithPassword({email, password: pass});
  btn.textContent = 'ログイン'; btn.disabled = false;
  if (error) {
    // 422エラーの詳細な日本語メッセージ
    let msg = 'ログインに失敗しました。';
    const em = error.message || '';
    if (em.includes('Invalid login credentials')) {
      msg = 'メールアドレスまたはパスワードが正しくありません。';
    } else if (em.includes('Email not confirmed')) {
      msg = 'メールアドレスが未確認です。管理者にお問い合わせください。\n（管理者向け: Supabase SQL Editorで UPDATE auth.users SET email_confirmed_at=now() WHERE email=\'' + email + '\'; を実行してください）';
    } else if (error.status === 422 || em.includes('422')) {
      // 422は通常メール未確認またはセッション破損
      msg = '認証エラー（422）が発生しました。\n考えられる原因:\n・メールアドレスが未確認（管理者に確認してください）\n・セッション破損（ページを再読み込みしてください）';
      // セッションデータが残っている場合はクリアを試行
      try {
        const storageKey = 'sb-' + new URL(SUPABASE_URL).hostname.split('.')[0] + '-auth-token';
        localStorage.removeItem(storageKey);
      } catch(_) {}
    } else {
      msg += ' ' + em;
    }
    showLoginError(msg);
    return;
  }
  await onLogin(data.user);
}

// ── サインアップ（登録申請） ──
async function doSignup() {
  const name  = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  if (!name || !email) { showLoginError('表示名とメールアドレスを入力してください'); return; }
  const btn = document.getElementById('signup-submit-btn');
  btn.textContent = '処理中...'; btn.disabled = true;

  // auth.signUpは呼ばず、pending_signupsにのみ保存
  // （管理者の承認時に初めてauth.signUpを呼ぶ）
  const {error: pendErr} = await _sb.from('pending_signups').insert({
    email: email, display_name: name, requested_at: new Date().toISOString()
  });

  btn.textContent = '登録申請'; btn.disabled = false;
  if (pendErr) {
    // 重複メールの場合（既に申請済み）も成功扱い
    if (pendErr.code === '23505') {
      console.log('[doSignup] 既に申請済みのメールアドレス');
    } else {
      console.error('pending_signups書き込みエラー:', pendErr);
      showLoginError('登録に失敗しました。もう一度お試しください。');
      return;
    }
  }
  showLoginError('✅ 登録申請を受け付けました。管理者の承認後にログインできます。');
}

// ── ログアウト ──
async function doLogout() {
  await _sb.auth.signOut();
  _currentUser = null; _currentRole = null; _currentName = '';
  document.getElementById('login-screen').style.display = 'flex';
  applyRoleUI();
}

// ── ログイン後処理 ──
async function onLogin(user) {
  _currentUser = user;
  // プロフィール取得（RLSに依存しないRPC関数を使用）
  const {data: profRows, error: profErr} = await _sb.rpc('get_my_profile');
  const prof = profRows && profRows.length > 0 ? profRows[0] : null;
  if (profErr) console.warn('[onLogin] get_my_profile error:', profErr.message);
  // プロフィールが存在しない場合のみ新規作成
  if (!prof) {
    const displayName = user.user_metadata?.display_name || user.email;
    await _sb.from('profiles').insert({
      id: user.id,
      email: user.email,
      display_name: displayName,
      role: 'member',
      approved: true,
    });
    _currentRole = 'member';
    _currentName = displayName;
  } else if (prof.approved === false) {
    // 未承認ユーザーはログイン拒否
    await _sb.auth.signOut();
    _currentUser = null; _currentRole = null; _currentName = '';
    showLoginError('⏳ 管理者の承認待ちです。承認後にログインできます。');
    return;
  } else {
    _currentRole = prof.role || 'member';
    _currentName = prof.display_name || user.email;
  }
  // ログイン履歴を記録
  await _sb.from('login_history').insert({user_id: user.id, email: user.email});
  // ログイン画面を閉じる
  document.getElementById('login-screen').style.display = 'none';
  applyRoleUI();
  await loadFromDB();
  // DBロード完了後に現在のページを再描画（ファーストビューのデータ空対策）
  migrateMktToProd(); // マーケ費用をprodItemsに統合
  updateFYSelectorUI();
  renderPg(_curPg || 'ov');
}

// ── セッション初期化 & 監視 ──
function initAuth() {
  (async () => {
    // /api/config から設定を取得（Vercel環境のみ）
    await initConfig();

    // 設定未完了チェック
    if (SUPABASE_URL === '__PLACEHOLDER__') {
      document.getElementById('login-screen').innerHTML = `
        <div style="max-width:500px;padding:24px;text-align:center">
          <div style="font-family:var(--disp);font-size:22px;font-weight:800;color:var(--acc);margin-bottom:16px">⚙️ 初期設定が必要です</div>
          <div style="background:var(--s1);border:1px solid var(--b1);border-radius:10px;padding:20px;text-align:left">
            <p style="font-size:12px;color:var(--t2);margin-bottom:12px">ダッシュボードHTMLファイルの先頭にある以下の2行を設定してください：</p>
            <pre style="background:var(--s2);border-radius:6px;padding:12px;font-family:var(--mono);font-size:11px;color:#2dd4a0">const SUPABASE_URL = 'https://xxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJ...';</pre>
            <p style="font-size:11px;color:var(--t3);margin-top:12px">設定方法は同梱の「Supabase設定手順.html」を参照してください。</p>
          </div>
        </div>`;
      return;
    }

    // 期限切れセッションの自動リフレッシュによる422エラーを防止
    // Supabaseクライアント生成前に、staleなトークンをクリアする
    const storageKey = 'sb-' + new URL(SUPABASE_URL).hostname.split('.')[0] + '-auth-token';
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw);
        // expires_at はトップレベルまたは currentSession 内にある場合がある
        const exp = stored?.expires_at || stored?.currentSession?.expires_at;
        const now = Math.floor(Date.now() / 1000);
        // 期限切れ、またはリフレッシュトークンが存在しない場合はクリア
        if ((exp && exp < now) || (!stored?.refresh_token && !stored?.currentSession?.refresh_token)) {
          console.log('[initAuth] 無効なセッションをクリア');
          localStorage.removeItem(storageKey);
        }
      }
    } catch(_) {
      // パース失敗時はセッションデータが破損しているためクリア
      localStorage.removeItem(storageKey);
    }

    // Supabaseクライアントを設定取得後に生成
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 既存セッション確認（期限切れセッションのエラーをハンドリング）
    try {
      const {data:{session}, error: sessErr} = await _sb.auth.getSession();
      if (sessErr) {
        console.warn('[initAuth] セッション取得エラー（期限切れの可能性）:', sessErr.message);
        // 422エラー時はlocalStorageのセッションも確実にクリア
        localStorage.removeItem(storageKey);
        await _sb.auth.signOut();
        document.getElementById('login-screen').style.display = 'flex';
        slbl().textContent = '未ログイン';
      } else if (session?.user) {
        await onLogin(session.user);
      } else {
        document.getElementById('login-screen').style.display = 'flex';
        slbl().textContent = '未ログイン';
      }
    } catch(e) {
      console.warn('[initAuth] セッション復元に失敗:', e.message);
      // セッションデータを確実にクリアして422ループを防止
      localStorage.removeItem(storageKey);
      try { await _sb.auth.signOut(); } catch(_) { /* signOut失敗は無視 */ }
      document.getElementById('login-screen').style.display = 'flex';
      slbl().textContent = '未ログイン';
    }

    // セッション変化を監視
    _sb.auth.onAuthStateChange(async (event, session) => {
      if (window._suppressAuthEvent) return;
      if (event === 'SIGNED_OUT') {
        document.getElementById('login-screen').style.display = 'flex';
      }
      if (event === 'PASSWORD_RECOVERY') {
        // パスワードリセットリンクからのアクセス → 再設定フォームを表示
        const newPass = prompt('新しいパスワードを入力してください（8文字以上）:');
        if (newPass && newPass.length >= 8) {
          const {error} = await _sb.auth.updateUser({ password: newPass });
          if (error) {
            alert('パスワード更新に失敗しました: ' + error.message);
          } else {
            alert('✅ パスワードを更新しました。新しいパスワードでログインできます。');
          }
        } else {
          alert('パスワードは8文字以上で設定してください。\nページを再読み込みして再度お試しください。');
        }
      }
    });
  })();
}

// ページ読み込み時に初期化
initAuth();
