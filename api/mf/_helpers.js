/**
 * MF 連携 API 共通ヘルパ
 * - Supabase 認証検証
 * - PKCE / state 生成
 * - Supabase service_role クライアント取得
 */
import crypto from 'node:crypto';

// ─────────────────────────────────────────────
// 環境変数
// ─────────────────────────────────────────────
export function env() {
  const required = {
    SUPABASE_URL:               process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY:  process.env.SUPABASE_SERVICE_ROLE_KEY,
    MF_CLIENT_ID:               process.env.MF_CLIENT_ID,
    MF_CLIENT_SECRET:           process.env.MF_CLIENT_SECRET,
    MF_AUTHORIZE_URL:           process.env.MF_AUTHORIZE_URL || 'https://api.biz.moneyforward.com/authorize',
    MF_TOKEN_URL:               process.env.MF_TOKEN_URL     || 'https://api.biz.moneyforward.com/token',
    MF_API_BASE:                process.env.MF_API_BASE      || 'https://api.biz.moneyforward.com',
    MF_REDIRECT_URI:            process.env.MF_REDIRECT_URI,
    MF_SCOPE:                   process.env.MF_SCOPE         || 'mfc/invoice/data.read mfc/invoice/payable.read',
  };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    const err = new Error('ENV_MISSING: ' + missing.join(', '));
    err.code = 'ENV_MISSING';
    err.missing = missing;
    throw err;
  }
  return required;
}

// ─────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────
export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (origin.endsWith('.vercel.app') || origin === 'http://localhost:3000' || origin === 'http://localhost:5500') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Cache-Control', 'private, no-store');
}

// ─────────────────────────────────────────────
// Supabase 認証検証（Authorization: Bearer <jwt>）
// 戻り値: { id, email } または例外
// ─────────────────────────────────────────────
export async function verifyUser(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    const e = new Error('NO_TOKEN');
    e.statusCode = 401;
    throw e;
  }
  const jwt = m[1];
  const e = env();
  const r = await fetch(`${e.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: e.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!r.ok) {
    const err = new Error('INVALID_TOKEN');
    err.statusCode = 401;
    throw err;
  }
  const u = await r.json();
  if (!u || !u.id) {
    const err = new Error('INVALID_TOKEN');
    err.statusCode = 401;
    throw err;
  }
  return { id: u.id, email: u.email, jwt };
}

// ─────────────────────────────────────────────
// Supabase REST 呼び出し（service_role）
// table 操作を fetch ベースで完結させる（外部依存なし）
// ─────────────────────────────────────────────
export async function sbRest(path, init = {}) {
  const e = env();
  const url = `${e.SUPABASE_URL}/rest/v1${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      apikey: e.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.prefer || 'return=representation',
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    const err = new Error(`SUPABASE_REST_${r.status}: ${txt}`);
    err.statusCode = r.status;
    throw err;
  }
  if (r.status === 204) return null;
  return r.json();
}

// ─────────────────────────────────────────────
// PKCE
// ─────────────────────────────────────────────
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function genPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}
export function genState() {
  return b64url(crypto.randomBytes(24));
}

// ─────────────────────────────────────────────
// アクセストークン取得（必要なら refresh）
// ─────────────────────────────────────────────
export async function getValidAccessToken(userId) {
  const rows = await sbRest(`/mf_oauth_tokens?user_id=eq.${userId}&select=*`);
  if (!rows || !rows.length) {
    const e = new Error('NOT_LINKED');
    e.statusCode = 412;
    throw e;
  }
  const tok = rows[0];
  const expMs = new Date(tok.expires_at).getTime();
  // 60秒の余裕を持って期限切れと判定
  if (expMs - Date.now() > 60_000) return tok.access_token;

  // refresh
  const e = env();
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: tok.refresh_token,
    client_id:     e.MF_CLIENT_ID,
    client_secret: e.MF_CLIENT_SECRET,
  });
  const r = await fetch(e.MF_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const txt = await r.text();
    const err = new Error(`MF_REFRESH_FAILED: ${txt}`);
    err.statusCode = 502;
    throw err;
  }
  const j = await r.json();
  const newAccess  = j.access_token;
  const newRefresh = j.refresh_token || tok.refresh_token;
  const newExp     = new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString();
  await sbRest(`/mf_oauth_tokens?user_id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token:  newAccess,
      refresh_token: newRefresh,
      expires_at:    newExp,
      token_type:    j.token_type || 'Bearer',
      scope:         j.scope || tok.scope,
    }),
  });
  return newAccess;
}
