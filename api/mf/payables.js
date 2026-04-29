/**
 * GET /api/mf/payables?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&per_page=100
 *   Authorization: Bearer <Supabase JWT>
 *
 *   MF 債務支払い API から債務（買掛/支払予定）一覧を取得して返す。
 *   - 期限切れトークンは自動 refresh
 *   - レスポンス JSON はそのまま返す（クライアント側で S.ledger にマッピング）
 *
 * 注意: 実際のエンドポイントパスは MF API 契約により異なる場合があります。
 *       環境変数 MF_PAYABLES_PATH で上書き可能。
 */
import { applyCors, env, verifyUser, getValidAccessToken } from './_helpers.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')      return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user        = await verifyUser(req);
    const accessToken = await getValidAccessToken(user.id);
    const e           = env();

    const path = process.env.MF_PAYABLES_PATH || '/api/v1/payables';

    const q = new URLSearchParams();
    if (req.query?.from)     q.set('from',     req.query.from);
    if (req.query?.to)       q.set('to',       req.query.to);
    if (req.query?.page)     q.set('page',     req.query.page);
    if (req.query?.per_page) q.set('per_page', req.query.per_page);

    const url = `${e.MF_API_BASE}${path}${q.toString() ? `?${q}` : ''}`;
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept:        'application/json',
      },
    });

    if (r.status === 401) {
      // refresh 後でも 401 なら連携をやり直してもらう
      return res.status(401).json({ error: 'MF_UNAUTHORIZED', hint: 'Re-link required' });
    }
    if (!r.ok) {
      const txt = await r.text();
      return res.status(502).json({ error: 'MF_API_ERROR', status: r.status, detail: txt });
    }

    const data = await r.json();
    return res.status(200).json({ data, fetched_at: new Date().toISOString() });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      error:   err.message || 'INTERNAL',
      code:    err.code,
      missing: err.missing,
    });
  }
}
