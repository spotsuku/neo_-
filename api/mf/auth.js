/**
 * GET /api/mf/auth
 *   Authorization: Bearer <Supabase JWT>
 *   → 認可URL（state付き）を返す。フロントは window.location でリダイレクト
 *
 * フロー:
 *   1. Supabase JWT 検証 → user_id 取得
 *   2. PKCE verifier/challenge と state を生成
 *   3. mf_oauth_states に { state, user_id, code_verifier, redirect_uri } を保存
 *   4. MF authorize URL を構築して返す
 */
import { applyCors, env, verifyUser, sbRest, genPkce, genState } from './_helpers.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')      return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user = await verifyUser(req);
    const e    = env();

    const { verifier, challenge, method } = genPkce();
    const state = genState();

    await sbRest('/mf_oauth_states', {
      method: 'POST',
      body: JSON.stringify({
        state,
        user_id:       user.id,
        code_verifier: verifier,
        redirect_uri:  e.MF_REDIRECT_URI,
      }),
      headers: { Prefer: 'return=minimal' },
    });

    const params = new URLSearchParams({
      response_type:         'code',
      client_id:             e.MF_CLIENT_ID,
      redirect_uri:          e.MF_REDIRECT_URI,
      scope:                 e.MF_SCOPE,
      state,
      code_challenge:        challenge,
      code_challenge_method: method,
    });
    const url = `${e.MF_AUTHORIZE_URL}?${params.toString()}`;
    return res.status(200).json({ url, state });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error:   err.message || 'INTERNAL',
      code:    err.code,
      missing: err.missing,
    });
  }
}
