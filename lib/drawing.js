/* esd-app — 配線図面例の定義（系統・機器の種類・図面データの受け取り）
 * AI には平面図の上での機器の位置と配線ルートを 0〜1000 の座標で返させ、画面がそれを平面図に重ねて描く。 */

// 配線の系統（画面の色分け・表示切替の単位）
const SYSTEMS = [
  { key: 'lighting', label: '照明' },
  { key: 'power', label: 'コンセント・動力' },
  { key: 'elv', label: '弱電・通信' },
  { key: 'fire', label: '防災' },
];

// 平面図に置く機器。unit は数量の単位。
const DEVICE_TYPES = [
  { key: 'panel', label: '分電盤', system: 'power', unit: '面' },
  { key: 'light', label: '照明器具（LEDベースライト）', system: 'lighting', unit: '台' },
  { key: 'downlight', label: 'ダウンライト', system: 'lighting', unit: '台' },
  { key: 'switch', label: 'スイッチ', system: 'lighting', unit: '個' },
  { key: 'outlet', label: 'コンセント（壁付）', system: 'power', unit: '個' },
  { key: 'oa_outlet', label: 'OAフロアコンセント', system: 'power', unit: '個' },
  { key: 'power_outlet', label: '動力（空調機など）', system: 'power', unit: '箇所' },
  { key: 'lan', label: '情報コンセント（LAN）', system: 'elv', unit: '個' },
  { key: 'camera', label: '監視カメラ', system: 'elv', unit: '台' },
  { key: 'card_reader', label: '入退室管理（カードリーダー）', system: 'elv', unit: '箇所' },
  { key: 'smoke_detector', label: '煙感知器', system: 'fire', unit: '個' },
  { key: 'heat_detector', label: '熱感知器', system: 'fire', unit: '個' },
  { key: 'exit_light', label: '誘導灯', system: 'fire', unit: '台' },
  { key: 'emergency_light', label: '非常用照明', system: 'fire', unit: '台' },
];

const MAX_DRAWINGS = 8;                       // 一度に送れる図面の枚数
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;     // 図面の合計サイズ（画面側で縮小してから送る）。base64 で約4/3倍になっても Vercel の上限 4.5MB に収まるように
const DRAWING_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// 図面1フロア分の横方向の実寸（m）。範囲外・未入力は null。
function sanitizeWidth(v) {
  const n = Number(v);
  return v !== '' && v != null && Number.isFinite(n) && n >= 1 && n <= 1000 ? n : null;
}

// 画面から届いた図面の一覧を確かめる。図面が無ければ []、不正なものがあれば null。
// 1枚ごとに kind（single: 1つの階 / combined: 複数の階をまとめた図）、階の名前、同じ図面の階数、実寸を持つ。
function sanitizeDrawings(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > MAX_DRAWINGS) return null;
  let total = 0;
  const out = [];
  for (const d of list) {
    const mimeType = String(d?.mimeType || '');
    const data = String(d?.data || '');
    if (!DRAWING_TYPES.includes(mimeType) || !/^[A-Za-z0-9+/]+=*$/.test(data)) return null;
    total += data.length * 0.75;
    const kind = d.kind === 'combined' ? 'combined' : 'single';
    const repeat = Math.min(50, Math.max(1, Math.round(Number(d.repeat)) || 1));
    out.push({
      mimeType, data, kind,
      floorName: kind === 'single' ? String(d.floorName || '').slice(0, 20) : '',
      repeat: kind === 'single' ? repeat : 1,
      widthM: sanitizeWidth(d.widthM),
      aspect: Number(d.aspect) > 0.1 && Number(d.aspect) < 10 ? Number(d.aspect) : 1, // 画像の縦÷横（室の寸法の目安に使う）
    });
  }
  return total > MAX_TOTAL_BYTES ? null : out;
}

// プロンプト用の図面の説明（「図面1: 1階」「図面2: 複数の階をまとめた図」など）
function describeDrawing(d, i) {
  const head = `図面${i + 1}`;
  const width = d.widthM ? `、1フロアの横方向の実寸 約${d.widthM} m` : '';
  if (d.kind === 'combined') return `${head}: 複数の階を1枚にまとめた平面図${width}`;
  const name = d.floorName || '階の指定なし';
  return `${head}: ${name}の平面図${d.repeat > 1 ? `（同じ平面の階が ${d.repeat} フロア分）` : ''}${width}`;
}

module.exports = { SYSTEMS, DEVICE_TYPES, DRAWING_TYPES, MAX_DRAWINGS, MAX_TOTAL_BYTES, sanitizeDrawings, sanitizeWidth, describeDrawing };
