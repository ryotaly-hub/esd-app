/* esd-app — 入力項目とドロップダウンの選択肢
 * 画面のフォームは GET /api/options でこの定義を受け取って作る。
 * 選択肢の label が画面に出る文字、text がプロンプトに入る文字。 */

const opts = (labels, toText = l => l) => labels.map(label => ({ label, text: toText(label) }));
const none = (text, toText) => l => (l === 'なし' ? text : toText(l));

const FLOORS_ABOVE_MAX = 30;
const FLOORS_BELOW_MAX = 5;

// 建物概要
const BUILDING = [
  {
    key: 'building_type', label: '建物用途', required: true,
    options: opts(['オフィスビル', 'マンション', '商業施設', '工場', '倉庫', '病院・クリニック', '学校', 'ホテル', '戸建住宅']),
  },
  {
    key: 'structure', label: '構造',
    options: opts(['鉄骨造', '鉄筋コンクリート造', '鉄骨鉄筋コンクリート造', '木造']),
  },
  {
    key: 'floors_above', label: '地上階数',
    options: Array.from({ length: FLOORS_ABOVE_MAX }, (_, i) => ({ label: i === 0 ? '1階（平屋）' : `${i + 1}階`, value: String(i + 1) })),
  },
  {
    key: 'floors_below', label: '地下階数',
    options: [{ label: 'なし', value: '0' }, ...Array.from({ length: FLOORS_BELOW_MAX }, (_, i) => ({ label: `${i + 1}階`, value: String(i + 1) }))],
  },
  { key: 'floor_area', label: '延床面積（㎡）', required: true, type: 'number', min: 1, max: 1000000 },
];

// 電気設備の4カテゴリ。各カテゴリの選択内容をつなげて、プロンプトの {key} に入れる。
const EQUIPMENT = [
  {
    key: 'power_system_input', label: '1. 受変電・幹線',
    items: [
      { key: 'receiving', label: '受電方式', options: opts(['低圧（単相3線 100/200V）', '低圧（単相3線＋三相3線 200V）', '高圧 6.6kV', '特別高圧 22kV以上'], l => `${l}受電`) },
      { key: 'cubicle', label: 'キュービクル', options: opts(['なし', '100kVA', '200kVA', '300kVA', '500kVA', '750kVA', '1000kVA'], none('キュービクルなし', l => `キュービクル1台（${l}）`)) },
      { key: 'main_feeder', label: '主幹線', options: opts(['CVT 38sq', 'CVT 60sq', 'CVT 100sq', 'CVT 150sq', 'CVT 200sq', 'CVT 325sq'], l => `主幹線${l.replace(' ', '')}`) },
    ],
  },
  {
    key: 'general_power_lighting', label: '2. 一般電源・照明',
    items: [
      { key: 'lighting', label: '照明', options: opts(['全館LEDベースライト', 'LEDベースライト＋ダウンライト', 'LEDダウンライト主体', 'LED高天井照明（工場・倉庫向け）']) },
      { key: 'oa_outlets', label: 'OAタップ（フロアコンセント）', options: opts(['なし', '10箇所', '20箇所', '50箇所', '100箇所', '200箇所'], none('OAフロアコンセントなし', l => `フロアコンセントOAタップ${l}`)) },
      { key: 'power_panels', label: '空調動力盤', options: opts(['なし', '1面', '2面', '3面', '5面', '10面'], none('空調動力盤なし', l => `空調動力盤${l}`)) },
    ],
  },
  {
    key: 'elv_system', label: '3. 弱電・通信 (ELV)',
    items: [
      { key: 'lan', label: 'LAN配線', options: opts(['なし', 'Cat6 30口', 'Cat6 60口', 'Cat6A 30口', 'Cat6A 60口', 'Cat6A 120口', 'Cat6A 240口'], none('LAN配線なし', l => l.replace(' ', ' LAN配線 '))) },
      { key: 'mdf_idf', label: 'MDF/IDF', options: opts(['MDFのみ', 'MDF/IDF各1箇所', 'MDF1箇所＋IDF各階'], l => (l === 'MDFのみ' ? 'MDF1箇所（IDFなし）' : l)) },
      { key: 'cameras', label: '監視カメラ', options: opts(['なし', '4台', '8台', '16台', '32台'], none('監視カメラなし', l => `監視カメラ${l}`)) },
      { key: 'access_control', label: '入退室管理', options: opts(['なし', '2箇所', '4箇所', '8箇所', '16箇所'], none('入退室管理なし', l => `入退室管理${l}`)) },
    ],
  },
  {
    key: 'fire_safety', label: '4. 防災・安全',
    items: [
      { key: 'fire_alarm', label: '自動火災報知設備', options: opts(['なし', 'P型1級', 'P型2級', 'R型'], none('自動火災報知設備なし', l => `${l}火災報知設備`)) },
      { key: 'exit_lights', label: '誘導灯（C級）', options: opts(['なし', '5台', '10台', '15台', '30台', '50台'], none('誘導灯なし', l => `誘導灯C級${l}`)) },
      { key: 'emergency_lights', label: '非常用照明（電池内蔵型）', options: opts(['なし', '10台', '20台', '40台', '80台'], none('非常用照明なし', l => `非常用照明（電池内蔵型）${l}`)) },
    ],
  },
];

// 選択肢の値（value があればそれ、無ければ label）
const optionValue = o => o.value ?? o.label;

// 画面に渡す形（text はサーバーだけで使うので省く）
function publicOptions() {
  const strip = f => ({ ...f, options: f.options?.map(o => ({ label: o.label, value: optionValue(o) })) });
  return {
    building: BUILDING.map(strip),
    equipment: EQUIPMENT.map(c => ({ key: c.key, label: c.label, items: c.items.map(strip) })),
  };
}

// 定義済みの項目・選択肢にある値だけを残す（それ以外は未選択として扱う）
function sanitizeValues(values) {
  const out = {};
  const pick = f => {
    const v = String(values?.[f.key] ?? '').trim();
    if (f.type === 'number') {
      const n = Number(v);
      out[f.key] = v !== '' && Number.isFinite(n) && n >= f.min && n <= f.max ? String(n) : '';
    } else {
      out[f.key] = f.options.some(o => optionValue(o) === v) ? v : '';
    }
  };
  BUILDING.forEach(pick);
  EQUIPMENT.forEach(c => c.items.forEach(pick));
  return out;
}

function missingRequired(values) {
  return BUILDING.filter(f => f.required && !values[f.key]).map(f => f.label);
}

// 地上・地下の階数を「地上4階・地下1階建て」の形にする
function formatFloors(values) {
  const above = Number(values.floors_above) || 0;
  const below = Number(values.floors_below) || 0;
  if (!above) return '';
  if (!below) return above === 1 ? '平屋建て' : `地上${above}階建て`;
  return `地上${above}階・地下${below}階建て`;
}

// カテゴリの選択内容を「6.6kV受電、キュービクル1台（300kVA）、…」の形にする。何も選ばれていなければ ''。
function formatCategory(category, values) {
  const parts = [];
  let missing = 0;
  for (const item of category.items) {
    const o = item.options.find(o => optionValue(o) === values[item.key]);
    if (o) parts.push(o.text);
    else missing++;
  }
  if (!parts.length) return '';
  return missing ? `${parts.join('、')}（その他は標準的な仕様で補完）` : parts.join('、');
}

module.exports = {
  BUILDING, EQUIPMENT, FLOORS_ABOVE_MAX, FLOORS_BELOW_MAX,
  publicOptions, sanitizeValues, missingRequired, formatFloors, formatCategory,
};
