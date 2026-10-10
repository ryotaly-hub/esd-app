const express = require('express');
const { publicOptions, sanitizeValues, missingRequired } = require('../lib/fields');
const { renderPrompt } = require('../lib/prompt');
const { generate, detectRooms } = require('../lib/gemini');
const { SYSTEMS, DEVICE_TYPES, MAX_DRAWINGS, sanitizeDrawings } = require('../lib/drawing');

const router = express.Router();

// フォームの項目と選択肢
router.get('/options', (req, res) => {
  res.json({ ...publicOptions(), drawing: { systems: SYSTEMS, deviceTypes: DEVICE_TYPES, maxDrawings: MAX_DRAWINGS } });
});

// 入力値を埋め込んだプロンプト（画面のプレビュー用）
router.post('/prompt', (req, res) => {
  const values = sanitizeValues(req.body?.values);
  // プレビューでは画像は受け取らず、図面の説明（種類・階・実寸）だけを見る
  const drawings = sanitizeDrawings((req.body?.drawings || []).map(d => ({ ...d, mimeType: 'image/png', data: 'AA==' }))) || [];
  res.json({ prompt: renderPrompt(values, { useSearch: req.body?.useSearch === true, drawings }) });
});

// 施工図面作成ガイドと概算見積の生成
router.post('/generate', async (req, res) => {
  const values = sanitizeValues(req.body?.values);
  const missing = missingRequired(values);
  if (missing.length) {
    return res.status(400).json({ error: `${missing.join('・')}は必須です` });
  }
  const useSearch = req.body?.useSearch === true;
  const drawings = sanitizeDrawings(req.body?.drawings);
  if (!drawings) {
    return res.status(400).json({ error: `図面の画像を読み込めませんでした（PNG・JPEG・WebP、${MAX_DRAWINGS}枚・合計 4MB まで）` });
  }
  try {
    // 1段目: 図面ごとに室を検出する（並列）。1枚でも読み取れなければ、室の範囲も2段目で返させる方式にする。
    let detected = [];
    if (drawings.length) {
      const found = await Promise.all(drawings.map((d, i) => detectRooms(d, i + 1)));
      detected = found.every(Boolean) ? found.flat() : null;
    }
    // 2段目: 施工図面作成ガイド・見積・室ごとの機器の数
    const result = await generate(renderPrompt(values, { useSearch, drawings, detected }), { useSearch, drawings });
    res.json({ ...result, values, rooms: detected || [] });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
