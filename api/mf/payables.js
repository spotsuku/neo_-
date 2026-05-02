/**
 * GET /api/mf/payables?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&per_page=100
 *   Authorization: Bearer <Supabase JWT>
 *
 *   MF クラウド債務支払の受領請求書を取得する。
 *
 *   実際の MF Web アプリが叩いているエンドポイント:
 *     POST https://payable.moneyforward.com/api/js/received_invoice/v1/received_invoices/search
 *
 *   注意: /api/js/ プレフィックスは MF Web 内部APIの可能性があり、
 *         OAuth Bearer トークンで通るか要検証。通らない場合は別の認証方式が必要。
 */
import { applyCors, env, verifyUser, getValidAccessToken } from './_helpers.js';

const DEFAULT_API_BASE = 'https://payable.moneyforward.com';
const DEFAULT_PATH     = '/api/js/received_invoice/v1/received_invoices/search';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')      return res.status(405).json({ error: 'Method not allowed' });

  try {
    const user        = await verifyUser(req);
    const accessToken = await getValidAccessToken(user.id);

    // ENV で上書き可能（payable は OAuth と別ホスト）
    const apiBase = process.env.MF_PAYABLE_API_BASE || DEFAULT_API_BASE;
    const path    = process.env.MF_PAYABLES_PATH    || DEFAULT_PATH;

    // 検索条件はクエリ → リクエストボディに変換
    const searchBody = {
      page:     parseInt(req.query?.page || '1') || 1,
      per_page: parseInt(req.query?.per_page || '50') || 50,
    };
    if (req.query?.from) searchBody.from = req.query.from;
    if (req.query?.to)   searchBody.to   = req.query.to;

    const url = `${apiBase}${path}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body: JSON.stringify(searchBody),
    });

    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) {}

    if (r.status === 401) {
      return res.status(401).json({
        error: 'MF_UNAUTHORIZED',
        hint:  '/api/js/ は MF 内部APIの可能性。Bearer トークンが受け付けられていません。CSRF やセッション Cookie が必要かも',
        url,
        detail: text,
      });
    }
    if (!r.ok) {
      return res.status(502).json({
        error:  'MF_API_ERROR', stage: 'fetch_payables',
        status: r.status,
        detail: text,
        url,
        sent_body: searchBody,
      });
    }

    return res.status(200).json({
      data:       json,
      url,
      sent_body:  searchBody,
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
