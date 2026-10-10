/* esd-app — Gemini API の呼び出し
 * generate: 見積・施工図面作成ガイドの生成。drawings があれば平面図の画像を「図面1」「図面2」…のラベル付きで添付する。
 *   useSearch が true のときは Google 検索グラウンディングを使い、Web 上の最新の価格情報を参照させる。
 *   参照した情報源（グラウンディングの結果）も一緒に返す。
 * detectRooms: 平面図1枚から階の外形と室の範囲を検出する（配線図面例の1段目）。 */
const { detectionPrompt, parseDetection } = require('./rooms');

const API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com';
const model = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function fail(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function call(body) {
  if (!process.env.API_KEY) throw fail('API_KEY が設定されていません（.env を確認してください）', 500);
  let r;
  try {
    r = await fetch(`${API_BASE}/v1beta/models/${model()}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (e) {
    throw fail(`Gemini API に接続できませんでした: ${e.message}`);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(data?.error?.message || `Gemini API エラー (${r.status})`);
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) throw fail('応答が空でした');
  return { text, candidate };
}

const imagePart = d => ({ inline_data: { mime_type: d.mimeType, data: d.data } });

// drawings（[{ mimeType, data }]）は、プロンプトの前に図面の番号付きで添付する
async function generate(prompt, { useSearch = false, drawings = [] } = {}) {
  const parts = drawings.flatMap((d, i) => [{ text: `【図面${i + 1}】` }, imagePart(d)]);
  parts.push({ text: prompt });
  const body = { contents: [{ role: 'user', parts }] };
  if (useSearch) body.tools = [{ google_search: {} }];
  const { text, candidate } = await call(body);

  // 参照した Web ページ（同じ URL は1つにまとめる）
  const meta = candidate.groundingMetadata || {};
  const seen = new Set();
  const sources = (meta.groundingChunks || [])
    .map(c => c.web)
    .filter(w => w?.uri && !seen.has(w.uri) && seen.add(w.uri))
    .map(w => ({ title: w.title || w.uri, uri: w.uri }));

  return { text, model: model(), sources, queries: meta.webSearchQueries || [] };
}

// 平面図1枚の室を検出する。読み取れなかったときは null（呼び出し側で1段だけの方式に切り替える）。
async function detectRooms(drawing, imageNo) {
  try {
    const { text } = await call({
      contents: [{ role: 'user', parts: [imagePart(drawing), { text: detectionPrompt(drawing) }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    return parseDetection(text, imageNo, drawing);
  } catch (e) {
    if (e.status === 500) throw e; // API_KEY 未設定はそのまま伝える
    return null;
  }
}

module.exports = { generate, detectRooms };
