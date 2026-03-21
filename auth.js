// ══════════════════════════════════════════════════
// auth.js — 認証コア（ログイン / ログアウト / セッション管理 / 権限）
// ※ 新規登録フロー廃止。ユーザー作成は管理者のみ（users.js / Edge Function経由）
// ══════════════════════════════════════════════════

// ── Supabase 設定 ──
// 本番: Vercel の /api/config から取得
// 開発: 下記フォールバック値を使用（anon key は RLS で保護済み）
let SUPABASE_URL      = 'https://hhifpqlbgyjdfbluigfo.supabase.co';
let SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoaWZwcWxiZ3lqZGZibHVpZ2ZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTkyNTksImV4cCI6MjA4ODk3NTI1OX0.hjycUEUf_Kr9iUDrs4GQZvqVWtcfi4Ij4mEfq-HM5c0';

async function initConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.supabaseUrl)     SUPABASE_URL      = cfg.supabaseUrl;
      if (cfg.supabaseAnonKey) SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
    }
  } catch (_) {
    // ローカル開発: フォールバック値を使用
  }
}

// ── グローバル状態 ──
let _sb           = null;   // Supabase クライアント
let _currentUser  = null;   // supabase User オブジェクト
let _currentRole  = null;   // 'admin' | 'member'
let _currentName  = '';
let _refreshTimer = null;

// ── ロールチェック（グローバル参照用） ──
const isAdmin  = () => _currentRole === 'admin';
const isLogged = () => !!_currentUser;

// ══════════════════════════════════════════════════
// 権限 UI 切り替え
// ══════════════════════════════════════════════════
function applyRoleUI() {
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  const nbUsers = document.getElementById('nb-users');
  if (nbUsers) nbUsers.style.display = isAdmin() ? '' : 'none';

  const uib      = document.getElementById('user-info-bar');
  const logoutBtn = document.getElementById('logout-btn');
  if (uib)      uib.style.display      = _currentUser ? '' : 'none';
  if (logoutBtn) logoutBtn.style.display = _currentUser ? '' : 'none';

  const nameEl = document.getElementById('user-display-name');
  if (nameEl) nameEl.textContent = _currentName || _currentUser?.email || '';

  const badgeEl = document.getElementById('user-role-badge');
  if (badgeEl) badgeEl.innerHTML = isAdmin()
    ? '<span style="font-size:8px;background:rgba(240,82,42,.2);color:#f0522a;padding:1px 6px;border-radius:4px;font-weight:700">管理者</span>'
    : '<span style="font-size:8px;background:rgba(79,142,247,.15);color:#4f8ef7;padding:1px 6px;border-radius:4px;font-weight:700">メンバー</span>';
}

// ══════════════════════════════════════════════════
// ログイン画面
// ══════════════════════════════════════════════════
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

function hideLoginScreen() {
  const el = document.getElementById('login-screen');
  if (el) el.style.display = 'none';
}

function showLoginScreen() {
  const el = document.getElementById('login-screen');
  if (el) el.style.display = 'flex';
  showLoginError('');
  // 入力フィールドをリセット
  const emailEl = document.getElementById('login-email');
  const passEl  = document.getElementById('login-pass');
  if (emailEl) emailEl.value = '';
  if (passEl)  passEl.value  = '';
}

// ══════════════════════════════════════════════════
// ログイン
// ══════════════════════════════════════════════════
let _loginInProgress = false;

async function doLogin() {
  if (_loginInProgress) return;

  const emailEl = document.getElementById('login-email');
  const passEl  = document.getElementById('login-pass');
  const btn     = document.getElementById('login-submit-btn');

  const email = emailEl?.value.trim() || '';
  const pass  = passEl?.value         || '';

  if (!email || !pass) {
    showLoginError('メールアドレスとパスワードを入力してください');
    return;
  }

  _loginInProgress = true;
  if (btn) { btn.textContent = 'ログイン中...'; btn.disabled = true; }

  try {
    // ① まずサインインを試みる
    const { data, error } = await _sb.auth.signInWithPassword({ email, password: pass });

    if (error) {
      showLoginError(_loginErrorMessage(error, email));
      return;
    }

    // ② 成功 → プロフィール取得・画面遷移
    startTokenRefresh();
    await onLogin(data.user);

  } catch (e) {
    showLoginError('予期しないエラーが発生しました: ' + e.message);
  } finally {
    _loginInProgress = false;
    if (btn) { btn.textContent = 'ログイン'; btn.disabled = false; }
  }
}

function _loginErrorMessage(error, email) {
  const msg = error.message || '';
  if (error.status === 429) {
    return 'リクエスト回数の制限に達しました。1分ほど待ってから再試行してください。';
  }
  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
    return 'メールアドレスまたはパスワードが正しくありません。';
  }
  if (msg.includes('Email not confirmed') || msg.includes('email_not_confirmed')) {
    return `メールアドレスが未確認です。\n管理者に確認をお願いしてください。`;
  }
  if (error.status === 422) {
    // セッション破損の可能性 → localStorage をクリア
    _clearStoredSession();
    return 'セッションエラーが発生しました。ページを再読み込みしてもう一度お試しください。';
  }
  return 'ログインに失敗しました: ' + msg;
}

// ══════════════════════════════════════════════════
// ログアウト
// ══════════════════════════════════════════════════
async function doLogout() {
  stopTokenRefresh();
  try { await _sb.auth.signOut(); } catch (_) {}
  _currentUser = null;
  _currentRole = null;
  _currentName = '';
  showLoginScreen();
  applyRoleUI();
}

// ══════════════════════════════════════════════════
// ログイン後処理
// ══════════════════════════════════════════════════
async function onLogin(user) {
  _currentUser = user;

  // プロフィール取得（RLS バイパス用 RPC）
  const { data: profRows, error: profErr } = await _sb.rpc('get_my_profile');
  if (profErr) console.warn('[onLogin] get_my_profile:', profErr.message);

  const prof = Array.isArray(profRows) && profRows.length > 0 ? profRows[0] : null;

  if (!prof) {
    // プロフィールが存在しない → 管理者が作成していないユーザー
    await _sb.auth.signOut();
    _currentUser = null;
    showLoginError('アカウントが見つかりません。管理者に問い合わせてください。');
    return;
  }

  if (prof.approved === false) {
    await _sb.auth.signOut();
    _currentUser = null;
    showLoginError('⏳ 管理者の承認待ちです。承認後にログインできます。');
    return;
  }

  _currentRole = prof.role || 'member';
  _currentName = prof.display_name || user.email;

  // ログイン履歴を記録（失敗しても続行）
  _sb.from('login_history')
    .insert({ user_id: user.id, email: user.email })
    .then(() => {})
    .catch(() => {});

  // 画面遷移
  hideLoginScreen();
  applyRoleUI();

  // データ読み込み → UI 描画
  await loadFromDB();
  migrateMktToProd();
  updateFYSelectorUI();
  renderPg(_curPg || 'ov');
}

// ══════════════════════════════════════════════════
// トークン自動リフレッシュ（手動管理）
// ══════════════════════════════════════════════════
function startTokenRefresh() {
  stopTokenRefresh();
  // 55分ごとにリフレッシュ（JWT 有効期限 1時間）
  _refreshTimer = setInterval(async () => {
    try {
      const { error } = await _sb.auth.refreshSession();
      if (error) {
        console.warn('[tokenRefresh] 失敗:', error.message);
        stopTokenRefresh();
      }
    } catch (_) {}
  }, 55 * 60 * 1000);
}

function stopTokenRefresh() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

// ══════════════════════════════════════════════════
// localStorage のセッションクリア
// ══════════════════════════════════════════════════
function _clearStoredSession() {
  try {
    const host = new URL(SUPABASE_URL).hostname.split('.')[0];
    const key  = `sb-${host}-auth-token`;
    localStorage.removeItem(key);
  } catch (_) {}
}

function _isSessionExpired() {
  try {
    const host = new URL(SUPABASE_URL).hostname.split('.')[0];
    const raw  = localStorage.getItem(`sb-${host}-auth-token`);
    if (!raw) return false;
    const stored = JSON.parse(raw);
    const exp = stored?.expires_at || stored?.currentSession?.expires_at;
    const now = Math.floor(Date.now() / 1000);
    return exp && exp < now;
  } catch (_) {
    return true; // パース失敗 = 破損とみなす
  }
}

// ══════════════════════════════════════════════════
// 初期化（ページ読み込み時）
// ══════════════════════════════════════════════════
function initAuth() {
  (async () => {
    // 設定取得
    await initConfig();

    // 期限切れ / 破損セッションを事前クリア（422 ループ防止）
    if (_isSessionExpired()) {
      console.log('[initAuth] 期限切れセッションをクリア');
      _clearStoredSession();
    }

    // Supabase クライアント生成
    // autoRefreshToken: false にして手動管理（Supabase 内部の自動リフレッシュが
    // 422 を引き起こすケースを回避）
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession:   true,
        detectSessionInUrl: false,
      },
    });

    // 既存セッション確認
    let session = null;
    try {
      const { data, error } = await _sb.auth.getSession();
      if (error) {
        console.warn('[initAuth] getSession エラー:', error.message);
        _clearStoredSession();
        showLoginScreen();
        slbl().textContent = '未ログイン';
        return;
      }
      session = data?.session;
    } catch (e) {
      console.warn('[initAuth] getSession 例外:', e.message);
      _clearStoredSession();
      showLoginScreen();
      slbl().textContent = '未ログイン';
      return;
    }

    if (session?.user) {
      // セッションが残っている → そのままログイン処理
      startTokenRefresh();
      await onLogin(session.user);
    } else {
      showLoginScreen();
      slbl().textContent = '未ログイン';
    }

    // 認証状態の変化を監視（SIGNED_OUT のみ対応）
    _sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        showLoginScreen();
        applyRoleUI();
      }
    });
  })();
}

// ── ヘルパー（index.html から参照） ──
function sdot() { return document.getElementById('sdot'); }
function slbl() { return document.getElementById('slbl'); }

// ページ読み込み時に初期化
initAuth();
