/**
 * GET /api/mf/callback?code=...&state=...
 *   MF が認可後にリダイレクトしてくる先。
 *   1. state から user_id, code_verifier を取り出す（10分以内のものだけ有効）
 *   2. code を access/refresh token に交換
 *   3. mf_oauth_tokens に upsert
 *   4. 元アプリへリダイレクト（?mf=ok / ?mf=error&reason=...）
 */
import { applyCors, env, sbRest } from './_helpers.js';

const STATE_TTL_MS = 10 * 60 * 1000;

function back(res, qs) {
  const base = process.env.APP_BASE_URL || '/';
  const sep  = base.includes('?') ? '&' : '?';
  res.writeHead(302, { Location: `${base}${sep}${qs}` });
  res.end();
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')      return res.status(405).json({ error: 'Method not allowed' });

  const { code, state, error: oauthErr } = req.query || {};
  if (oauthErr)        return back(res, `mf=error&reason=${encodeURIComponent(oauthErr)}`);
  if (!code || !state) return back(res, 'mf=error&reason=missing_params');

  try {
    const e = env();

    // 1. state 検証
    const rows = await sbRest(`/mf_oauth_states?state=eq.${encodeURIComponent(state)}&select=*`);
    if (!rows || !rows.length) return back(res, 'mf=error&reason=invalid_state');
    const st = rows[0];
    const age = Date.now() - new Date(st.created_at).getTime();
    if (age > STATE_TTL_MS) {
      await sbRest(`/mf_oauth_states?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return back(res, 'mf=error&reason=state_expired');
    }

    // 2. code → token 交換
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  st.redirect_uri,
      client_id:     e.MF_CLIENT_ID,
      client_secret: e.MF_CLIENT_SECRET,
      code_verifier: st.code_verifier,
    });
    const tr = await fetch(e.MF_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tr.ok) {
      const txt = await tr.text();
      console.error('MF token exchange failed:', tr.status, txt);
      return back(res, `mf=error&reason=token_exchange_${tr.status}`);
    }
    const tok = await tr.json();
    const expires_at = new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString();

    // 3. upsert（user_id PK）
    await sbRest('/mf_oauth_tokens?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id:       st.user_id,
        access_token:  tok.access_token,
        refresh_token: tok.refresh_token,
        token_type:    tok.token_type || 'Bearer',
        scope:         tok.scope || e.MF_SCOPE,
        expires_at,
      }),
    });

    // 4. 使い終わった state を削除
    await sbRest(`/mf_oauth_states?state=eq.${encodeURIComponent(state)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });

    return back(res, 'mf=ok');
  } catch (err) {
    console.error('MF callback error:', err);
    return back(res, `mf=error&reason=${encodeURIComponent(err.message || 'internal')}`);
  }
}
