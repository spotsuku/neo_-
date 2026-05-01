/**
 * GET /api/mf/payables?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&per_page=100
 *   Authorization: Bearer <Supabase JWT>
 *
 *   MF クラウド債務支払の「受領請求書」一覧を取得する。
 *
 *   注意: クラウド債務支払 API のエンドポイントは公式ドキュメントが見つけにくいため、
 *         複数の候補を順番に試して最初に成功したものを採用する。
 *         確定したパスは MF_PAYABLES_PATH ENV で固定可能。
 */
import { applyCors, env, verifyUser, getValidAccessToken } from './_helpers.js';

// 試行するパスの候補（左から順に試す）
const CANDIDATE_PATHS = [
  '/api/v1/received_invoices',
  '/api/v2/received_invoices',
  '/v1/received_invoices',
  '/api/external/v1/received_invoices',
  '/api/v1/accounts_payable/received_invoices',
  '/api/v1/accounts-payable/received_invoices',
  '/accounts-payable/api/v1/received_invoices',
];

async function mfGet(base, path, accessToken) {
  const url = `${base}${path}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:        'application/json',
    },
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { ok: r.ok, status: r.status, json, text, url };
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')      return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user        = await verifyUser(req);
    const accessToken = await getValidAccessToken(user.id);
    const e           = env();

    const q = new URLSearchParams();
    if (req.query?.from)     q.set('from',     req.query.from);
    if (req.query?.to)       q.set('to',       req.query.to);
    if (req.query?.page)     q.set('page',     req.query.page);
    if (req.query?.per_page) q.set('per_page', req.query.per_page);
    const qs = q.toString() ? `?${q}` : '';

    // ENV で固定指定があればそれだけ試す。無ければ候補を順に試す
    const fixedPath = process.env.MF_PAYABLES_PATH;
    const tryPaths = fixedPath ? [fixedPath] : CANDIDATE_PATHS;

    const attempts = [];
    let success = null;
    for (const p of tryPaths) {
      const r = await mfGet(e.MF_API_BASE, p + qs, accessToken);
      attempts.push({ path: p, status: r.status });
      if (r.status === 401) {
        // 認証問題は再試行しても同じなので即座に返す
        return res.status(401).json({
          error: 'MF_UNAUTHORIZED',
          hint: 'スコープ不足の可能性。クラウド債務支払の正しいスコープで再連携してください',
          attempts,
        });
      }
      if (r.ok) { success = { ...r, path: p }; break; }
      // 404 以外（500等）も次へ進めない方が安全
      if (r.status !== 404) {
        return res.status(502).json({
          error: 'MF_API_ERROR', stage: 'fetch_payables',
          status: r.status, detail: r.text, url: r.url,
          attempts,
        });
      }
    }

    if (!success) {
      return res.status(404).json({
        error:    'MF_PATH_NOT_FOUND',
        hint:     'いずれの候補パスでも 404。MF_PAYABLES_PATH を ENV で正しい値に設定してください',
        api_base: e.MF_API_BASE,
        attempts,
      });
    }

    return res.status(200).json({
      data: success.json,
      used_path: success.path,
      api_base: e.MF_API_BASE,
      attempts,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[/api/mf/payables] error:', err && err.stack || err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error:   err.message || 'INTERNAL',
      code:    err.code,
      missing: err.missing,
      stage:   err.stage,
      hint:    err.hint,
    });
  }
}
