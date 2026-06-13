/**
 * NEO ACADEMIA — OpenAI 画像生成ヘルパ（ChatGPT/OpenAI でデザイン資産を作る）
 *
 * 役割: 02_visual_agent が作った画像プロンプトを OpenAI Images API (gpt-image-1) に投げ、
 *       高品質な PNG を design/output/images/ に保存する。版面(HTML/SVG)に流し込む素材用。
 *
 * 必要なもの:
 *   1) 環境変数 OPENAI_API_KEY（.env もしくは export）
 *   2) ネットワークegressで api.openai.com を許可（クラウド環境ではポリシー設定が必要）
 *
 * 使い方:
 *   # 単発
 *   node scripts/openai_image.mjs "教室で学ぶ社会人、明るい自然光" --size 1024x1536 --out cover.png
 *   # バッチ（prompts.json から）
 *   node scripts/openai_image.mjs --from design/output/prompts.json
 *
 * prompts.json の形式:
 *   [ { "id":"P_cover", "prompt":"...", "size":"1024x1536", "quality":"high" }, ... ]
 *
 * CLAUDE.md 規約準拠: 2xx でも空ボディを想定、非2xx は status+body を出して落とす。
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const API_KEY = process.env.OPENAI_API_KEY;
const ENDPOINT = "https://api.openai.com/v1/images/generations";
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const OUT_DIR = "design/output/images";

// NEO Design Bible のトーンをプロンプト末尾に必ず付与（配色・余白・文字なし）
const NEO_STYLE =
  "Editorial, minimalist, lots of clean white space. " +
  "Primary color deep navy #102A71 with subtle gold #D89B1D accents only. " +
  "Sophisticated, trustworthy, intellectual tone. High quality, sharp, print-ready. " +
  "Absolutely no text, no letters, no logos, no watermark in the image.";

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) a[t.slice(2)] = argv[i + 1]?.startsWith("--") ? true : argv[++i];
    else a._.push(t);
  }
  return a;
}

async function generateOne({ id, prompt, size = "1024x1536", quality = "high" }) {
  const fullPrompt = `${prompt}\n\n${NEO_STYLE}`;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: fullPrompt, n: 1, size, quality }),
  });

  // 規約: 2xx でも空ボディを想定し text() で受けてからパース
  const raw = await res.text();
  if (!res.ok) {
    console.error(`[openai] HTTP ${res.status} for "${id}"\n${raw}`);
    throw new Error(`OpenAI image generation failed (${res.status})`);
  }
  let json;
  try { json = raw ? JSON.parse(raw) : null; } catch { throw new Error(`unparseable response: ${raw.slice(0, 300)}`); }
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`no image data in response for "${id}"`);

  await mkdir(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${id}.png`);
  await writeFile(file, Buffer.from(b64, "base64"));
  console.log(`✓ ${file}`);
  return file;
}

async function main() {
  if (!API_KEY) {
    console.error("✗ OPENAI_API_KEY が未設定です。.env もしくは export で設定してください（.env.example 参照）。");
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));

  if (args.from) {
    const list = JSON.parse(await readFile(args.from, "utf8"));
    console.log(`バッチ生成: ${list.length} 件 (${args.from})`);
    for (const item of list) {
      try { await generateOne(item); }
      catch (e) { console.error(`  - ${item.id}: ${e.message}`); }
    }
    return;
  }

  const prompt = args._.join(" ").trim();
  if (!prompt) {
    console.error('使い方: node scripts/openai_image.mjs "<プロンプト>" [--size 1024x1536] [--quality high] [--out name.png]');
    process.exit(1);
  }
  const id = (args.out || `neo_${Date.now()}`).replace(/\.png$/i, "");
  await generateOne({ id, prompt, size: args.size, quality: args.quality });
}

main().catch((e) => { console.error(e); process.exit(1); });
