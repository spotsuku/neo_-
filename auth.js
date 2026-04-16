// ══════════════════════════════════════════════════
// auth.js — 認証コア（Googleログイン/ログアウト/セッション管理/権限）
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

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = '';
}

// ── Googleログイン ──
let _loginInProgress = false;
async function doGoogleLogin() {
  if (_loginInProgress) return;
  _loginInProgress = true;

  const btn = document.getElementById('login-google-btn');
  const loading = document.getElementById('login-loading');
  if (btn) btn.style.display = 'none';
  if (loading) loading.style.display = '';

  try {
    const { error } = await _sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: {
          hd: 'sportsnation.jp',
        },
      },
    });
    if (error) {
      showLoginError('Googleログインに失敗しました: ' + error.message);
      if (btn) btn.style.display = '';
      if (loading) loading.style.display = 'none';
    }
  } catch (e) {
    showLoginError('予期しないエラー: ' + e.message);
    if (btn) btn.style.display = '';
    if (loading) loading.style.display = 'none';
  } finally {
    _loginInProgress = false;
  }
}

// 後方互換
function doLogin() { doGoogleLogin(); }

// ── トークン自動リフレッシュ（手動管理） ──
let _refreshTimer = null;
function startTokenRefresh() {
  if (_refreshTimer) clearInterval(_refreshTimer);
  // 10分ごとにトークンをリフレッシュ（Supabase JWTのデフォルト有効期限は1時間）
  _refreshTimer = setInterval(async () => {
    try {
      const {error} = await _sb.auth.refreshSession();
      if (error) {
        console.warn('[tokenRefresh] リフレッシュ失敗:', error.message);
        clearInterval(_refreshTimer);
        _refreshTimer = null;
      }
    } catch(_) {}
  }, 10 * 60 * 1000);
}

// ── ログアウト ──
async function doLogout() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
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
    const displayName = user.user_metadata?.full_name || user.user_metadata?.display_name || user.email;
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
    // autoRefreshTokenを無効化し、セッション復元を手動で制御（422ループ防止）
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: true,
      }
    });

    // 既存セッション確認（期限切れセッションのエラーをハンドリング）
    try {
      const {data:{session}, error: sessErr} = await _sb.auth.getSession();
      if (sessErr) {
        console.warn('[initAuth] セッション取得エラー（期限切れの可能性）:', sessErr.message);
        // 422エラー時はlocalStorageのセッションも確実にクリア
        localStorage.removeItem(storageKey);
        try { await _sb.auth.signOut(); } catch(_) {}
        document.getElementById('login-screen').style.display = 'flex';
        slbl().textContent = '未ログイン';
        // セッション復旧済みの通知を表示
        showLoginError('セッションの有効期限が切れました。再度ログインしてください。');
      } else if (session?.user) {
        startTokenRefresh();
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
      showLoginError('セッションの復元に失敗しました。再度ログインしてください。');
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
