/**
 * GET /api/mf/status
 *   Authorization: Bearer <Supabase JWT>
 *   → { linked: bool, expires_at: ISO|null, env_ok: bool, missing: [] }
 *
 *   フロントが「MF連携済みか」「Vercel側ENVが揃っているか」を判定するための軽量エンドポイント。
 */
import { applyCors, verifyUser, sbRest, env } from './_helpers.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')      return res.status(405).json({ error: 'Method not allowed' });

  let env_ok = true, missing = [];
  try { env(); } catch (e) {
    if (e.code === 'ENV_MISSING') { env_ok = false; missing = e.missing || []; }
    else throw e;
  }

  try {
    const user = await verifyUser(req);
    let linked = false, expires_at = null;
    if (env_ok) {
      const rows = await sbRest(`/mf_oauth_tokens?user_id=eq.${user.id}&select=expires_at`);
      if (rows && rows.length) { linked = true; expires_at = rows[0].expires_at; }
    }
    return res.status(200).json({ linked, expires_at, env_ok, missing });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'INTERNAL', env_ok, missing });
  }
}
