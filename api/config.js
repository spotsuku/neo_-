/**
 * Vercel Serverless Function
 * 環境変数をクライアントに安全に渡す
 * GET /api/config → { supabaseUrl, supabaseAnonKey }
 */
export default function handler(req, res) {
  // CORS設定（同一オリジンのみ）
  const origin = req.headers.origin || '';
  const allowed = [
    'https://neobudget-liard.vercel.app',
    'http://localhost:3000',
    'http://localhost:5500',
  ];

  if (allowed.includes(origin) || origin.endsWith('.vercel.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'private, no-store'); // キャッシュさせない

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Environment variables not configured' });
  }

  return res.status(200).json({ supabaseUrl, supabaseAnonKey });
}
