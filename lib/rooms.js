/* esd-app — 平面図の室の検出（配線図面例の1段目）
 * 図面1枚ごとに、Gemini に「階の建物外形」と「室の範囲」だけを物体検出の形式（box_2d）で返させる。
 * 見積と同じ依頼で読み取らせるより位置の精度が高い。検出した室には番号（id）を付け、
 * 2段目（見積の依頼）では、その番号ごとに機器の数だけを決めさせる。 */

const ROOM_KINDS = ['room', 'corridor', 'wc', 'stair', 'ev', 'shaft'];

function detectionPrompt(drawing) {
  const what = drawing.kind === 'combined'
    ? 'この画像には複数の階の平面図が1枚にまとめて描かれています。階ごとに分けて検出してください。'
    : `この画像は1つの階（${drawing.floorName || '階の指定なし'}）の平面図です。floors には1つだけ入れてください。`;
  return `あなたは建築図面を読み取る専門家です。添付の平面図から、建物の外形と室を検出してください。
${what}

- floors の box_2d は、その階の建物外形（外壁の外側）を囲む矩形です。寸法線・図面名・余白は含めないでください。
- name は図面に書かれた階の名前（例: 1階）です。書かれていなければ推定してください。
- width_m は、寸法線から読み取れるその階の建物外形の横方向の実寸（m）です。読み取れなければ null にしてください。
- rooms はその階のすべての室（居室・廊下・ホール・WC・階段・EV・PS/EPS・倉庫など）です。box_2d は室の内側（壁の内側）をできるだけ正確に囲んでください。
- L字形など長方形でない室は、長方形2つ以上に分け、同じ name で返してください。
- kind は ${ROOM_KINDS.join(' / ')} のいずれかです（room: 居室・室、corridor: 廊下・ホール、shaft: PS・EPS などのシャフト）。
- box_2d は [ymin, xmin, ymax, xmax] で、画像の左上を 0、右下を 1000 とする整数です。

次の形式の JSON だけを返してください。
{"floors":[{"name":"1階","box_2d":[0,0,0,0],"width_m":30,"rooms":[{"name":"事務室","kind":"room","box_2d":[0,0,0,0]}]}]}`;
}

const isBox = b => Array.isArray(b) && b.length === 4 && b.every(v => Number.isFinite(Number(v)));

// 検出結果（JSON の文字列）を確かめて、室に番号を付ける。使えなければ null。
function parseDetection(text, imageNo, drawing) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  let floors = (Array.isArray(data?.floors) ? data.floors : [])
    .filter(f => isBox(f.box_2d))
    .map((f, fi) => ({
      image: imageNo,
      name: drawing.kind === 'single' && drawing.floorName ? drawing.floorName : String(f.name || `図面${imageNo}`).slice(0, 20),
      box_2d: f.box_2d.map(Number),
      width_m: Number(f.width_m) > 0 ? Number(f.width_m) : null,
      rooms: (Array.isArray(f.rooms) ? f.rooms : [])
        .filter(r => isBox(r.box_2d))
        .slice(0, 80)
        .map((r, ri) => ({
          id: `${imageNo}-${fi + 1}-${ri + 1}`,
          name: String(r.name || '室').slice(0, 30),
          kind: ROOM_KINDS.includes(r.kind) ? r.kind : 'room',
          box_2d: r.box_2d.map(Number),
        })),
    }))
    .filter(f => f.rooms.length);
  if (drawing.kind === 'single') floors = floors.slice(0, 1);
  return floors.length ? floors : null;
}

// 2段目のプロンプトに入れる室の一覧（番号・室名・種類・おおよその寸法）
function describeRooms(floors, drawings) {
  return floors.map(f => {
    const d = drawings[f.image - 1];
    const widthM = d?.widthM || f.width_m;
    const [oy0, ox0, oy1, ox1] = f.box_2d;
    const outW = Math.max(ox1 - ox0, 1);
    const size = r => {
      if (!widthM) return '';
      const [y0, x0, y1, x1] = r.box_2d;
      // 縦の縮尺は画像の縦横比で変わるので、横の縮尺から概算する（画像の縦横比は 2段目では不明なため目安）
      const w = (x1 - x0) / outW * widthM;
      const h = (y1 - y0) / outW * widthM * (d?.aspect || 1);
      return `、約${w.toFixed(1)}m×${h.toFixed(1)}m（約${Math.round(w * h)}㎡）`;
    };
    const head = `- 図面${f.image}「${f.name}」${widthM ? `（建物外形の横幅 約${widthM} m）` : ''}`;
    return [head, ...f.rooms.map(r => `  - ${r.id}: ${r.name}（${r.kind}${size(r)}）`)].join('\n');
  }).join('\n');
}

module.exports = { ROOM_KINDS, detectionPrompt, parseDetection, describeRooms };
