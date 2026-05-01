/**
 * GET /api/mf/payables?from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&per_page=100&office_id=...
 *   Authorization: Bearer <Supabase JWT>
 *
 *   MF クラウド債務支払（クラウド経費 API 経由）から支払明細を取得する。
 *
 *   フロー:
 *     1. /api/external/v1/offices  で office 一覧を取得
 *     2. office_id を決定（query → env → 先頭の office）
 *     3. /api/external/v1/offices/{office_id}/ex_invoice_transactions を取得
 *
 *   ENV で挙動を上書き可能:
 *     MF_OFFICES_PATH    : default '/api/external/v1/offices'
 *     MF_PAYABLES_PATH   : default '/api/external/v1/offices/{office_id}/ex_invoice_transactions'
 *                         {office_id} がプレースホルダ
 *     MF_OFFICE_ID       : 単一固定の office_id（指定があれば offices 取得をスキップ）
 */
import { applyCors, env, verifyUser, getValidAccessToken } from './_helpers.js';

const DEFAULT_OFFICES_PATH  = '/api/external/v1/offices';
const DEFAULT_PAYABLES_PATH = '/api/external/v1/offices/{office_id}/ex_invoice_transactions';

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

    const officesPath  = process.env.MF_OFFICES_PATH  || DEFAULT_OFFICES_PATH;
    const payablesTmpl = process.env.MF_PAYABLES_PATH || DEFAULT_PAYABLES_PATH;

    // 1. office_id を決定する
    let officeId = req.query?.office_id || process.env.MF_OFFICE_ID || '';
    let officesData = null;
    if (!officeId) {
      const off = await mfGet(e.MF_API_BASE, officesPath, accessToken);
      if (off.status === 401) return res.status(401).json({ error: 'MF_UNAUTHORIZED', hint: 'Re-link required' });
      if (!off.ok) {
        return res.status(502).json({
          error: 'MF_API_ERROR', stage: 'fetch_offices',
          status: off.status, detail: off.text, url: off.url,
        });
      }
      officesData = off.json;
      // 配列 / { offices: [...] } / { data: [...] } の揺れを吸収
      const arr = Array.isArray(officesData) ? officesData
        : Array.isArray(officesData?.offices) ? officesData.offices
        : Array.isArray(officesData?.data)    ? officesData.data
        : [];
      if (!arr.length) {
        return res.status(404).json({
          error: 'MF_NO_OFFICE', hint: 'offices 配列が空です。事業者契約状態を確認してください',
          raw: officesData,
        });
      }
      officeId = String(arr[0].id || arr[0].office_id || arr[0].uid || '');
      if (!officeId) {
        return res.status(500).json({ error: 'MF_OFFICE_ID_MISSING', sample: arr[0] });
      }
    }

    // 2. 支払明細を取得
    const path = payablesTmpl.replace('{office_id}', encodeURIComponent(officeId));
    const q = new URLSearchParams();
    if (req.query?.from)     q.set('from',     req.query.from);
    if (req.query?.to)       q.set('to',       req.query.to);
    if (req.query?.page)     q.set('page',     req.query.page);
    if (req.query?.per_page) q.set('per_page', req.query.per_page);
    const fullPath = `${path}${q.toString() ? `?${q}` : ''}`;
    const r = await mfGet(e.MF_API_BASE, fullPath, accessToken);

    if (r.status === 401) return res.status(401).json({ error: 'MF_UNAUTHORIZED', hint: 'Re-link required' });
    if (!r.ok) {
      return res.status(502).json({
        error: 'MF_API_ERROR', stage: 'fetch_payables',
        status: r.status, detail: r.text, url: r.url,
        used_office_id: officeId,
      });
    }

    return res.status(200).json({
      data: r.json,
      office_id: officeId,
      offices_meta: officesData ? { count: Array.isArray(officesData.offices||officesData.data||officesData) ? (officesData.offices||officesData.data||officesData).length : 1 } : null,
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
