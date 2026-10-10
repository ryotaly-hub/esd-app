/* esd-app — プロンプトテンプレートと埋め込み（サーバー側だけで使う） */
const { EQUIPMENT, formatFloors, formatCategory } = require('./fields');

const PROMPT_TEMPLATE = `# Role
あなたは建築設備業界（MEP）に精通したエキスパート「電気設備設計・施工監理エンジニア」です。

# Task
ユーザーから提供される「建物概要」および「Electrical System Designの4カテゴリ（受変電・幹線、一般電源・照明、弱電・通信、防災・安全）に関する入力データ」に基づき、以下の2つの成果物を出力してください。
1. **施工図面作成ガイド（CAD/BIM作図指示書）**
2. **概算の資材・施工見積書（現行の日本国内積算単価ベース）**

---

# Input Data（ユーザー入力情報）
- **建物用途**: {building_type}
- **規模**: {structure} {floor_count} / 延床面積 {floor_area} ㎡
- **1. 受変電・幹線**: {power_system_input}
- **2. 一般電源・照明**: {general_power_lighting}
- **3. 弱電・通信 (ELV)**: {elv_system}
- **4. 防災・安全**: {fire_safety}
{drawing_input}
---

# Output Format（出力形式）

## 1. 施工図面作成ガイド（CAD/BIM作図指示書）
以下の形式で、施工図（平面図・系統図）を作成する際の具体的指示をまとめてください。

### (1) 図面レイアウト・レイヤー構成
- 推奨スケール（1/50, 1/100など）および図面枚数・構成
- CAD/BIMプロット時の推奨レイヤー分け（色分け・線種指定）

### (2) 各カテゴリの作図ポイント・ルート指示
- **幹線・受変電**: パイプシャフト（PS）、ケーブルラックのプロット位置とクリアランス
- **照明・コンセント**: 天井プロット図、スラブ配管・壁埋込・OAフロア配線の指定
- **弱電・通信**: MDF/IDF位置、配管呼び径（PF管等）、LAN/カメラの配線ルート
- **防災・安全**: 消防法に基づく警戒区域の設定、感知器・誘導灯の配置ルール

### (3) プロット用標準シンボル凡例（凡例表）
- 主要機器・器具の平面図用JIS/標準シンボル表記の指示

---

## 2. 概算資材・施工見積書（日本国内積算単価ベース）
現在の日本の公有建築工事標準単価や物価資料（建設物価・積算資料等）に基づいたリアルな概算費用を出力してください。

### (1) カテゴリ別概算費用内訳
| 分類 | 主な部材・機器 | 数量/単位 | 資材費（円） | 施工・労務費（円） | 小計（円） |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 電力供給・幹線設備** | キュービクル、CVTケーブル、ラック等 | 1式 | ¥0,000,000 | ¥0,000,000 | ¥0,000,000 |
| **2. 一般電源・照明設備** | LED器具、スイッチ、コンセント、電線等 | 1式 | ¥0,000,000 | ¥0,000,000 | ¥0,000,000 |
| **3. 弱電・通信設備** | Cat6A配線、ラック、カメラ、配管等 | 1式 | ¥0,000,000 | ¥0,000,000 | ¥0,000,000 |
| **4. 防災・安全設備** | 自火報受信機、感知器、誘導灯等 | 1式 | ¥0,000,000 | ¥0,000,000 | ¥0,000,000 |
| **直接仮設・雑材料費** | 仮設電源、消耗品、施工用足場等 | 1式 | - | - | ¥0,000,000 |

### (2) 見積総括
- **直接工事費合計**: ¥00,000,000
- **現場管理費・諸経費（概算 15〜20%）**: ¥0,000,000
- **総合計（税抜）**: **¥00,000,000**
- **1㎡あたりの電気設備工事単価目安**: 約 ¥00,000 / ㎡

### (3) 見積条件・補足注意事項
- 採用した単価の前提条件（銅価格変動への懸念、夜間工事の有無、建物の階数補正など）

{drawing_section}---

# Instructions
- 専門的かつ現場で即座に使える精度で記述してください。
- 価格は現実的な日本国内の積算相場（人工単価：電工1人日あたり 22,000円〜28,000円程度、近年の資材高騰を考慮）に基づいて算出してください。
- 入力データに不足がある項目は、標準的な仕様を自動で補完して試算を行ってください。
{price_reference}- 出力はMarkdown表記に加えて、見積データをJSON形式でも末尾に出力してください。

# JSON Output（見積データ）
- 回答の最後に、\`\`\`json で始まるコードブロックを1つだけ置き、次の形式に従ってください。
- 金額は円単位の数値（税抜、カンマや¥記号なし）とし、Markdownの「カテゴリ別概算費用内訳」「見積総括」と同じ値にしてください。
- 資材費・労務費を分けない行（直接仮設・雑材料費など）は material_cost と labor_cost を null にし、subtotal だけを入れてください。
{drawing_json_rules}
\`\`\`json
{
  "currency": "JPY",
  "categories": [
    { "name": "1. 電力供給・幹線設備", "main_items": "キュービクル、CVTケーブル、ラック等", "quantity": "1式", "material_cost": 0, "labor_cost": 0, "subtotal": 0 },
    { "name": "2. 一般電源・照明設備", "main_items": "", "quantity": "1式", "material_cost": 0, "labor_cost": 0, "subtotal": 0 },
    { "name": "3. 弱電・通信設備", "main_items": "", "quantity": "1式", "material_cost": 0, "labor_cost": 0, "subtotal": 0 },
    { "name": "4. 防災・安全設備", "main_items": "", "quantity": "1式", "material_cost": 0, "labor_cost": 0, "subtotal": 0 },
    { "name": "直接仮設・雑材料費", "main_items": "", "quantity": "1式", "material_cost": null, "labor_cost": null, "subtotal": 0 }
  ],
  "overhead_rate": 0.18,
  "notes": ["見積条件・補足注意事項"]{drawing_json}
}
\`\`\``;

// ---------- 建物図面（平面図）があるときだけ入れる部分 ----------
const { DEVICE_TYPES, describeDrawing } = require('./drawing');
const { describeRooms } = require('./rooms');

const DRAWING_SECTION = `## 3. 配線図面例（添付平面図への機器配置・配線ルート）
添付の平面図（建物図面）を読み取り、図面の範囲について、上記1・2の方針に沿った配線計画を作成してください。複数の図面や、複数の階を1枚にまとめた図面がある場合は、階ごとに整理してください。

### (1) 図面の読み取り結果
- 階ごとの室名・おおよその寸法、分電盤・EPS・MDF/IDF の想定位置

### (2) 配線計画の要点
- 階・室ごとの機器の数とその根拠（照度・感知器の設置基準・コンセントの必要数など）、系統ごと（照明・コンセント/動力・弱電・防災）の配線ルートの考え方

### (3) 配線図面の概算価格
- 図面の範囲の機器数量・配線延長と、その概算価格（機器ごとの材工単価、配線1mあたりの材工単価）

`;

const DRAWING_JSON_RULES = `- "drawing" には、添付の平面図の上に配線図面例を描くための読み取り結果を入れてください。機器の細かい位置はアプリが室の範囲の中に自動で並べるので、室の範囲と室ごとの機器の数を正確に返すことが大切です。
- 座標は Gemini の物体検出と同じ形式です。box_2d は [ymin, xmin, ymax, xmax]、point は [y, x] で、どちらも各図面画像の左上を 0、右下を 1000 とする整数です。
- floors は階ごとに1つです。image はその階が描かれている図面の番号（図面1なら 1）です。1枚に複数の階がまとめて描かれている図面では、階ごとに別の要素にし、box_2d でその階の建物外形（外壁の外側）を囲んでください。1つの階だけの図面（「同じ平面の階が N フロア分」とある図面を含む）は、floors に1つだけ入れてください（階ごとに分けない）。box_2d は寸法線や余白を含めず、建物外形だけを囲んでください。
- width_m はその階の建物外形の横方向の実寸（m）です。ユーザーが実寸を指定した図面はその値を、それ以外は寸法線から読み取った値（読み取れなければ延床面積と階数から推定した値）を入れてください。
- panel は分電盤の位置（point）です。EPS・PS や廊下の壁際など、現実的な位置にしてください。
- rooms は室ごとに1つです。box_2d はその室の内側（壁の内側）を囲んでください。kind は room（居室・室）/ corridor（廊下・ホール）/ wc / stair（階段）/ ev（エレベーター）/ shaft（PS・EPS などのシャフト）のいずれかです。
- rooms の devices は、その室に置く機器の種類ごとの数です。種類は次のいずれかです: ${DEVICE_TYPES.filter(d => d.key !== 'panel').map(d => `${d.key}（${d.label}）`).join('、')}。分電盤は panel で表すので devices には入れないでください。機器が無い室は devices を {} にしてください。
- unit_prices は機器の種類ごと（panel を含む）の1個あたりの材料費・労務費（円）、wiring_unit_prices は系統（lighting / power / elv / fire）ごとの配線1mあたり（配管・電線・ケーブル込み）の材料費・労務費（円）です。配置に使わなかった種類も含め、すべての種類と系統を入れてください（画面で機器を追加したときにも使います）。
`;

const DEVICE_LIST = DEVICE_TYPES.filter(d => d.key !== 'panel').map(d => `${d.key}（${d.label}）`).join('、');
const PRICE_RULES = `- unit_prices は機器の種類ごと（panel を含む）の1個あたりの材料費・労務費（円）、wiring_unit_prices は系統（lighting / power / elv / fire）ごとの配線1mあたり（配管・電線・ケーブル込み）の材料費・労務費（円）です。配置に使わなかった種類も含め、すべての種類と系統を入れてください（画面で機器を追加したときにも使います）。
`;

const ROOM_ID_RULES = `- "drawing" には、配線図面例を描くための階・室ごとの機器の数を入れてください。室の位置は図面から読み取り済み（Input Data の「図面から読み取った室」）なので、機器の位置はアプリがその室の中に自動で並べます。
- floors は Input Data の「図面から読み取った室」の階ごとに1つです。image と name は一覧と同じにしてください。
- width_m はその階の建物外形の横方向の実寸（m）です。一覧に横幅があればその値を、無ければ寸法線から読み取った値（読み取れなければ延床面積と階数から推定した値）を入れてください。
- panel_room は分電盤を置く室の番号です（EPS・PS、なければ廊下など現実的な室）。
- rooms は機器を置く室ごとに1つで、id は一覧の番号です。devices はその室に置く機器の種類ごとの数で、種類は次のいずれかです: ${DEVICE_LIST}。機器が無い室は入れなくてかまいません。同じ室名で番号が分かれている室（L字形の室など）は、広さに応じて機器を分けてください。
${PRICE_RULES}`;

const ROOM_ID_JSON = `,
  "drawing": {
    "floors": [
      {
        "image": 1,
        "name": "1階",
        "width_m": 30,
        "panel_room": "1-1-6",
        "rooms": [
          { "id": "1-1-1", "devices": { "light": 12, "oa_outlet": 8, "lan": 8, "smoke_detector": 4 } },
          { "id": "1-1-5", "devices": { "light": 3, "exit_light": 1, "emergency_light": 2 } }
        ]
      }
    ],
    "unit_prices": { "panel": { "material": 0, "labor": 0 }, "light": { "material": 0, "labor": 0 } },
    "wiring_unit_prices": { "lighting": { "material": 0, "labor": 0 } }
  }`;

const DRAWING_JSON = `,
  "drawing": {
    "floors": [
      {
        "image": 1,
        "name": "1階",
        "box_2d": [120, 100, 940, 940],
        "width_m": 30,
        "panel": [700, 900],
        "rooms": [
          { "name": "事務室", "kind": "room", "box_2d": [140, 120, 800, 640], "devices": { "light": 12, "oa_outlet": 8, "lan": 8, "smoke_detector": 4 } },
          { "name": "廊下", "kind": "corridor", "box_2d": [820, 120, 920, 900], "devices": { "light": 3, "exit_light": 1, "emergency_light": 2 } }
        ]
      }
    ],
    "unit_prices": { "panel": { "material": 0, "labor": 0 }, "light": { "material": 0, "labor": 0 } },
    "wiring_unit_prices": { "lighting": { "material": 0, "labor": 0 } }
  }`;

const EMPTY_TEXT = '未入力（標準的な仕様で補完してください）';

// 外部データ（Web検索）で価格を確かめるときに Instructions に足す指示
const PRICE_SEARCH_INSTRUCTION = `- 主要な機器・部材（キュービクル、ケーブル、LED照明器具、LAN配線材、監視カメラ、火災報知設備など）の価格は、Google検索で現在の公開情報（メーカー希望小売価格、通販・卸の実勢価格、公共工事の公表単価など）を確認したうえで算出してください。
- 見積条件・補足注意事項に、価格を確認した情報源（サイト名）と確認した内容を簡潔に記載してください。
`;

// テンプレートの {key} を埋める。useSearch が true なら外部データで価格を確かめる指示を入れる。
// drawings は図面の一覧（{ kind, floorName, repeat, widthM, aspect }。無ければ []）。
// detected は1段目で検出した階・室（配列）。null は検出できなかった（AI に室の範囲も返させる）、
// undefined はまだ検出していない（プレビュー）。
function renderPrompt(values, { useSearch = false, drawings = [], detected } = {}) {
  const hasDrawing = drawings.length > 0;
  const roomList = !hasDrawing || detected === null ? ''
    : detected === undefined ? '- **図面から読み取った室**: （生成するときに図面から自動で読み取って、室の番号の一覧がここに入ります）\n'
      : `- **図面から読み取った室**（番号: 室名）:\n${describeRooms(detected, drawings)}\n`;
  const vars = {
    building_type: values.building_type || EMPTY_TEXT,
    structure: values.structure || '',
    floor_count: formatFloors(values),
    floor_area: values.floor_area || EMPTY_TEXT,
    price_reference: useSearch ? PRICE_SEARCH_INSTRUCTION : '',
    drawing_input: hasDrawing
      ? `- **建物図面**: 添付の平面図画像 ${drawings.length}枚（${drawings.map(describeDrawing).join(' / ')}）\n${roomList}` : '',
    drawing_section: hasDrawing ? DRAWING_SECTION : '',
    drawing_json_rules: !hasDrawing ? '' : detected === null ? DRAWING_JSON_RULES : ROOM_ID_RULES,
    drawing_json: !hasDrawing ? '' : detected === null ? DRAWING_JSON : ROOM_ID_JSON,
  };
  for (const c of EQUIPMENT) vars[c.key] = formatCategory(c, values) || EMPTY_TEXT;

  return PROMPT_TEMPLATE
    .replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match))
    // 構造・階数が空のときの余白を詰める
    .replace(/^(- \*\*規模\*\*:)\s*(.*?)\s*\/ /m, (m, head, body) => `${head} ${body ? body + ' ' : ''}/ `);
}

module.exports = { PROMPT_TEMPLATE, renderPrompt };
