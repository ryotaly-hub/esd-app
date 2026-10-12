#!/bin/bash
# APIの自動テスト。偽の Gemini サーバーとアプリを起動し、curlでエンドポイントを叩いて期待値と比較する。
# 本物の Gemini には接続しない（GEMINI_API_BASE を偽サーバーに向ける）。
set -u

PORT=3100
MOCK_PORT=3999
BASE_URL="http://localhost:$PORT"
PASS=0
FAIL=0

lsof -ti:$PORT -ti:$MOCK_PORT | xargs kill -9 2>/dev/null
sleep 0.5

# 偽の Gemini API。受け取ったリクエストを保存し、グラウンディング付きの応答を返す。
MOCK_REQ="/tmp/${PWD##*/}_mock_request.json"
rm -f "$MOCK_REQ"
MOCK_REQ="$MOCK_REQ" node -e '
const http = require("http");
http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    // 室の検出（1段目）の依頼には検出結果を返す。.fail ファイルがあれば読めない応答にする。
    if (body.includes("responseMimeType")) {
      require("fs").appendFileSync(process.env.MOCK_REQ + ".detect", "x");
      const ok = !require("fs").existsSync(process.env.MOCK_REQ + ".fail");
      const det = { floors: [{ name: "1階", box_2d: [100, 100, 900, 900], width_m: 30, rooms: [
        { name: "事務室", kind: "room", box_2d: [110, 110, 600, 600] }, { name: "廊下", kind: "corridor", box_2d: [700, 110, 890, 890] }] }] };
      return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: ok ? JSON.stringify(det) : "読めませんでした" }] } }] }));
    }
    require("fs").writeFileSync(process.env.MOCK_REQ, body);
    res.end(JSON.stringify({ candidates: [{
      content: { parts: [{ text: "# 回答\n```json\n{\"categories\":[]}\n```" }] },
      groundingMetadata: {
        webSearchQueries: ["キュービクル 300kVA 価格"],
        groundingChunks: [{ web: { uri: "https://example.com/a", title: "example.com" } }, { web: { uri: "https://example.com/a", title: "example.com" } }]
      }
    }] }));
  });
}).listen('"$MOCK_PORT"');
' &
MOCK_PID=$!

PORT=$PORT API_KEY=test-key GEMINI_API_BASE="http://localhost:$MOCK_PORT" node index.js > /tmp/${PWD##*/}_test_server.log 2>&1 &
SERVER_PID=$!

# 合言葉（ACCESS_PASSWORD）付きのアプリ（Basic 認証の確認用）
AUTH_PORT=$((PORT + 1))
lsof -ti:$AUTH_PORT | xargs kill -9 2>/dev/null
PORT=$AUTH_PORT API_KEY=test-key ACCESS_PASSWORD=secret-word GEMINI_API_BASE="http://localhost:$MOCK_PORT" node index.js > /tmp/${PWD##*/}_test_auth_server.log 2>&1 &
AUTH_PID=$!

cleanup() {
  kill "$SERVER_PID" "$MOCK_PID" "$AUTH_PID" 2>/dev/null
}
trap cleanup EXIT

sleep 1

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" == "$actual" ]; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (expected: $expected, actual: $actual)"
    FAIL=$((FAIL + 1))
  fi
}

post() {
  curl -s -X POST -H 'Content-Type: application/json' -d "$2" "$BASE_URL$1"
}

# --- 画面 ---
assert_eq "GET / status" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/")"
assert_eq "GET /app.js status" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/app.js")"

# --- GET /api/options ---
opts=$(curl -s "$BASE_URL/api/options")
assert_eq "options: 建物概要の項目数" "5" "$(echo "$opts" | jq '.building | length')"
assert_eq "options: 電気設備のカテゴリ数" "4" "$(echo "$opts" | jq '.equipment | length')"
assert_eq "options: プロンプト用の text を画面に渡さない" "0" "$(echo "$opts" | jq '[.. | objects | select(has("text"))] | length')"

# --- POST /api/prompt ---
VALUES='{"building_type":"オフィスビル","structure":"鉄骨造","floors_above":"4","floors_below":"0","floor_area":"1200","receiving":"高圧 6.6kV","cubicle":"300kVA","main_feeder":"CVT 100sq","fire_alarm":"P型1級","exit_lights":"15台","emergency_lights":"20台"}'
prompt=$(post /api/prompt "{\"values\":$VALUES}" | jq -r .prompt)
assert_eq "prompt: 規模" "- **規模**: 鉄骨造 地上4階建て / 延床面積 1200 ㎡" "$(echo "$prompt" | grep '規模')"
assert_eq "prompt: 受変電・幹線" "- **1. 受変電・幹線**: 高圧 6.6kV受電、キュービクル1台（300kVA）、主幹線CVT100sq" "$(echo "$prompt" | grep '^- \*\*1. 受変電')"
assert_eq "prompt: 防災・安全" "- **4. 防災・安全**: P型1級火災報知設備、誘導灯C級15台、非常用照明（電池内蔵型）20台" "$(echo "$prompt" | grep '^- \*\*4. 防災')"
prompt_none=$(post /api/prompt '{"values":{"building_type":"オフィスビル","floor_area":"500","fire_alarm":"なし"}}' | jq -r '.prompt')
assert_eq "prompt: 自動火災報知設備なし" "1" "$(echo "$prompt_none" | grep '^- \*\*4. 防災' | grep -c '自動火災報知設備なし')"
assert_eq "prompt: 未選択カテゴリ" "- **3. 弱電・通信 (ELV)**: 未入力（標準的な仕様で補完してください）" "$(echo "$prompt" | grep '^- \*\*3. 弱電')"
assert_eq "prompt: JSON出力の指示" "1" "$(echo "$prompt" | grep -c '出力はMarkdown表記に加えて、見積データをJSON形式でも末尾に出力してください')"
assert_eq "prompt: 検索なしでは検索の指示なし" "0" "$(echo "$prompt" | grep -c 'Google検索')"
prompt=$(post /api/prompt "{\"values\":$VALUES,\"useSearch\":true}" | jq -r .prompt)
assert_eq "prompt: 検索ありでは検索の指示あり" "1" "$(echo "$prompt" | grep -c 'Google検索で現在の公開情報')"
prompt=$(post /api/prompt '{"values":{"building_type":"<script>","cubicle":"9999kVA"}}' | jq -r .prompt)
assert_eq "prompt: 選択肢に無い値は捨てる" "0" "$(echo "$prompt" | grep -c '<script>\|9999kVA')"

# --- POST /api/generate ---
res=$(curl -s -w "\n%{http_code}" -X POST -H 'Content-Type: application/json' -d '{"values":{"building_type":"工場"}}' "$BASE_URL/api/generate")
assert_eq "generate: 必須不足は 400" "400" "$(echo "$res" | tail -n 1)"
assert_eq "generate: 必須不足のメッセージ" "延床面積（㎡）は必須です" "$(echo "$res" | sed '$d' | jq -r .error)"

gen=$(post /api/generate "{\"values\":$VALUES,\"useSearch\":true}")
assert_eq "generate: 本文" "# 回答" "$(echo "$gen" | jq -r .text | head -n 1)"
assert_eq "generate: 情報源（重複除去）" "1" "$(echo "$gen" | jq '.sources | length')"
assert_eq "generate: 検索クエリ" "キュービクル 300kVA 価格" "$(echo "$gen" | jq -r '.queries[0]')"
assert_eq "generate: Gemini に google_search ツールを渡す" '[{"google_search":{}}]' "$(jq -c .tools "$MOCK_REQ")"
post /api/generate "{\"values\":$VALUES}" > /dev/null
assert_eq "generate: 検索なしではツールを渡さない" "null" "$(jq -c .tools "$MOCK_REQ")"

# --- 建物図面（平面図） ---
assert_eq "options: 機器の種類" "14" "$(echo "$opts" | jq '.drawing.deviceTypes | length')"
assert_eq "options: 系統" "lighting,power,elv,fire" "$(echo "$opts" | jq -r '[.drawing.systems[].key] | join(",")')"
prompt=$(post /api/prompt "{\"values\":$VALUES}" | jq -r .prompt)
assert_eq "prompt: 図面なしでは配線図面の指示なし" "0" "$(echo "$prompt" | grep -c '配線図面例')"
DESC='[{"kind":"single","floorName":"1階","repeat":1,"widthM":30},{"kind":"single","floorName":"2〜4階","repeat":3},{"kind":"combined"}]'
prompt=$(post /api/prompt "{\"values\":$VALUES,\"drawings\":$DESC}" | jq -r .prompt)
assert_eq "prompt: 複数図面の説明" "- **建物図面**: 添付の平面図画像 3枚（図面1: 1階の平面図、1フロアの横方向の実寸 約30 m / 図面2: 2〜4階の平面図（同じ平面の階が 3 フロア分） / 図面3: 複数の階を1枚にまとめた平面図）" "$(echo "$prompt" | grep '^- \*\*建物図面')"
assert_eq "prompt: 配線図面例の出力指示" "1" "$(echo "$prompt" | grep -c '^## 3. 配線図面例')"
assert_eq "prompt: プレビューでは室の一覧は生成時に入る" "1" "$(echo "$prompt" | grep -c '生成するときに図面から自動で読み取って')"
assert_eq "prompt: 室の番号で機器の数を返させる" "1" "$(echo "$prompt" | grep -c '^- panel_room は分電盤を置く室の番号')"

PNG=$(printf '\x89PNG\r\n\x1a\n' | base64)
rm -f "$MOCK_REQ.detect" "$MOCK_REQ.fail"
gen=$(post /api/generate "{\"values\":$VALUES,\"drawings\":[{\"mimeType\":\"image/png\",\"data\":\"$PNG\",\"floorName\":\"1階\"},{\"mimeType\":\"image/png\",\"data\":\"$PNG\",\"kind\":\"combined\"}]}")
assert_eq "generate: 図面ごとに室を検出（2回）" "2" "$(wc -c < "$MOCK_REQ.detect" | tr -d ' ')"
assert_eq "generate: 検出した室を番号付きで返す" "1-1-1,1-1-2,2-1-1,2-1-2" "$(echo "$gen" | jq -r '[.rooms[].rooms[].id] | join(",")')"
assert_eq "generate: 1つの階の図面は入力した階の名前" "1階" "$(echo "$gen" | jq -r '.rooms[0].name')"
assert_eq "generate: 検出した室の一覧をプロンプトに入れる" "1" "$(jq -r '.contents[0].parts[4].text' "$MOCK_REQ" | grep -c '^  - 2-1-1: 事務室（room')"
assert_eq "generate: 図面を番号付きで添付" "【図面1】,image/png,【図面2】,image/png" "$(jq -r '[.contents[0].parts[0:4][] | (.text // .inline_data.mime_type)] | join(",")' "$MOCK_REQ")"
assert_eq "generate: 図面の後にプロンプト" "1" "$(jq -r '.contents[0].parts[4].text' "$MOCK_REQ" | grep -c '^## 3. 配線図面例')"
touch "$MOCK_REQ.fail"
gen=$(post /api/generate "{\"values\":$VALUES,\"drawings\":[{\"mimeType\":\"image/png\",\"data\":\"$PNG\"}]}")
assert_eq "generate: 検出できないときは室の範囲も返させる" "1" "$(jq -r '.contents[0].parts[2].text' "$MOCK_REQ" | grep -c 'box_2d は \[ymin, xmin, ymax, xmax\]')"
assert_eq "generate: 検出できないときは rooms が空" "0" "$(echo "$gen" | jq '.rooms | length')"
rm -f "$MOCK_REQ.fail"
res=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"values\":$VALUES,\"drawings\":[{\"mimeType\":\"text/html\",\"data\":\"PGgxPg==\"}]}" "$BASE_URL/api/generate")
assert_eq "generate: 画像でない図面は 400" "400" "$res"

# --- 配線図面例の自動配置（public/layout.js） ---
layout=$(node -e '
const L = require("./public/layout.js");
const types = JSON.parse(process.argv[1]).drawing.deviceTypes;
const floor = { box_2d: [100, 100, 900, 900], width_m: 30, panel: [850, 880], rooms: [
  { name: "事務室", kind: "room", box_2d: [120, 120, 700, 600], devices: { light: 12, oa_outlet: 6, lan: 6, outlet: 4, switch: 2, smoke_detector: 4, camera: 2, exit_light: 1 } },
  { name: "会議室", kind: "room", box_2d: [120, 620, 500, 880], devices: { light: 4, downlight: 2, outlet: 2, switch: 1, heat_detector: 1, card_reader: 1 } },
  { name: "廊下", kind: "corridor", box_2d: [720, 120, 880, 880], devices: { light: 3, emergency_light: 2, exit_light: 1 } },
  { name: "外れた室", kind: "room", box_2d: [950, 950, 990, 990], devices: { light: 1 } } ] };
const f = L.layoutFloor(floor, { width: 1000, height: 1000 }, 8, types, null);
const rooms = Object.fromEntries(f.rooms.map(r => [r.name, r.rect]));
const outside = f.devices.filter(d => d.room && !L.inside(d.p, rooms[d.room]));
const orth = f.routes.every(r => r.points.slice(1).every((p, i) => p[0] === r.points[i][0] || p[1] === r.points[i][1]));
console.log([f.devices.length, outside.length, orth, f.rooms.length, f.lengthBySystem.lighting > 0].join(","));
' "$opts")
assert_eq "layout: 機器数（分電盤＋室の機器、外形の外の室は除く）" "55" "$(echo "$layout" | cut -d, -f1)"
assert_eq "layout: 室の外に出た機器" "0" "$(echo "$layout" | cut -d, -f2)"
assert_eq "layout: 配線は縦横の直線だけ" "true" "$(echo "$layout" | cut -d, -f3)"
assert_eq "layout: 外形の外の室は捨てる" "3" "$(echo "$layout" | cut -d, -f4)"
assert_eq "layout: 実寸から配線長を計算" "true" "$(echo "$layout" | cut -d, -f5)"

# --- 画面で機器を動かした・足したあとの配線（routeFloor）と、まとめた図の切り出し範囲（cropRect） ---
edited=$(node -e '
const L = require("./public/layout.js");
const types = JSON.parse(process.argv[1]).drawing.deviceTypes;
const floor = { box_2d: [100, 100, 900, 900], panel: [850, 880], rooms: [
  { name: "事務室", kind: "room", box_2d: [120, 120, 700, 600], devices: { light: 6, outlet: 2 } },
  { name: "会議室", kind: "room", box_2d: [120, 620, 500, 880], devices: { light: 2 } },
  { name: "廊下", kind: "corridor", box_2d: [720, 120, 880, 880], devices: { light: 2 } } ] };
const f = L.layoutFloor(floor, { width: 1000, height: 1000 }, 8, types, 30);
const sys = Object.fromEntries(types.map(t => [t.key, t.system]));
const light = f.devices.find(d => d.type === "light");
light.p = [700, 300]; light.ri = L.assignRoom(light.p, f.rooms, 8);          // 事務室 → 会議室へ移動
const far = [910, 600];
f.devices.push({ type: "power_outlet", system: sys.power_outlet, p: far, ri: L.assignRoom(far, f.rooms, 8) }); // どの室からも離れた所に追加
const r = L.routeFloor(f, f.devices, 8, 30);
const onSeg = (p, a, b) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 0.5
  && p[0] >= Math.min(a[0], b[0]) - 0.1 && p[0] <= Math.max(a[0], b[0]) + 0.1 && p[1] >= Math.min(a[1], b[1]) - 0.1 && p[1] <= Math.max(a[1], b[1]) + 0.1;
const connected = f.devices.every(d => d.type === "panel" || r.routes.some(rt => rt.system === d.system && rt.points.slice(1).some((p, i) => onSeg(d.p, rt.points[i], p))));
const orth = r.routes.every(rt => rt.points.slice(1).every((p, i) => p[0] === rt.points[i][0] || p[1] === rt.points[i][1]));
const c = L.cropRect(f.outline, { width: 1000, height: 1000 }, 8);
console.log([f.rooms[light.ri].name, f.devices[f.devices.length - 1].ri, connected, orth, [c.x0, c.y0, c.x1, c.y1].join(" ")].join(","));
' "$opts")
assert_eq "edit: 動かした機器は移動先の室に入る" "会議室" "$(echo "$edited" | cut -d, -f1)"
assert_eq "edit: 室から離れた機器は室なし（-1）" "-1" "$(echo "$edited" | cut -d, -f2)"
assert_eq "edit: すべての機器が配線につながる" "true" "$(echo "$edited" | cut -d, -f3)"
assert_eq "edit: 引き直した配線も縦横の直線だけ" "true" "$(echo "$edited" | cut -d, -f4)"
assert_eq "crop: 階の外形に余白を付けて切り出す" "75 59 925 912" "$(echo "$edited" | cut -d, -f5)"

# --- 画面で配線ルートを動かしたとき（insertPins / moveSegment と routeFloor の overrides） ---
moved=$(node -e '
const L = require("./public/layout.js");
const types = JSON.parse(process.argv[1]).drawing.deviceTypes;
const floor = { box_2d: [100, 100, 900, 900], panel: [850, 880], rooms: [
  { name: "事務室", kind: "room", box_2d: [120, 120, 700, 600], devices: { light: 6, outlet: 2 } },
  { name: "廊下", kind: "corridor", box_2d: [720, 120, 880, 880], devices: { light: 2 } } ] };
const f = L.layoutFloor(floor, { width: 1000, height: 1000 }, 8, types, 30);
f.devices.forEach(d => { d.p = d.p.map(v => Math.round(v * 10) / 10); }); // 画面と同じく 0.1px 単位にそろえる
Object.assign(f, L.routeFloor(f, f.devices, 8, 30));
const rt = f.routes.find(r => r.system === "lighting" && r.room === "事務室");
const pins = f.devices.map(d => d.p);
const base = L.insertPins(rt.points, pins);
const i = L.nearestSegment(base, rt.points[2]);
const pts = L.moveSegment(base, i, 25, pins);
const onSeg = (p, a, b) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 0.5
  && p[0] >= Math.min(a[0], b[0]) - 0.2 && p[0] <= Math.max(a[0], b[0]) + 0.2 && p[1] >= Math.min(a[1], b[1]) - 0.2 && p[1] <= Math.max(a[1], b[1]) + 0.2;
const mine = f.devices.filter(d => d.system === "lighting" && d.room === "事務室");
const connected = mine.every(d => pts.slice(1).some((p, k) => onSeg(d.p, pts[k], p)));
const orth = pts.slice(1).every((p, k) => p[0] === pts[k][0] || p[1] === pts[k][1]);
const ends = String(pts[0]) === String(rt.points[0]) && String(pts[pts.length - 1]) === String(rt.points[rt.points.length - 1]);
const ov = { [rt.key]: { sig: rt.sig, points: pts } };
const kept = L.routeFloor(f, f.devices, 8, 30, ov).routes.find(r => r.key === rt.key);
const dev = mine[0]; dev.p = [dev.p[0] + 20, dev.p[1]];                      // 同じ室・系統の機器を動かす
const dropped = L.routeFloor(f, f.devices, 8, 30, ov).routes.find(r => r.key === rt.key);
console.log([String(pts) !== String(rt.points), connected, orth, ends, kept.edited && String(kept.points) === String(pts), dropped.edited].join(","));
' "$opts")
assert_eq "route: 区間を動かすとルートが変わる" "true" "$(echo "$moved" | cut -d, -f1)"
assert_eq "route: 動かしても機器から線が外れない" "true" "$(echo "$moved" | cut -d, -f2)"
assert_eq "route: 動かしても縦横の直線だけ" "true" "$(echo "$moved" | cut -d, -f3)"
assert_eq "route: 分電盤側と末端は動かない" "true" "$(echo "$moved" | cut -d, -f4)"
assert_eq "route: 手で直したルートを使う" "true" "$(echo "$moved" | cut -d, -f5)"
assert_eq "route: 機器を動かすと自動のルートに戻る" "false" "$(echo "$moved" | cut -d, -f6)"

# --- 合言葉（Basic 認証） ---
AUTH_URL="http://localhost:$AUTH_PORT"
assert_eq "auth: 合言葉なしは 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$AUTH_URL/")"
assert_eq "auth: API も合言葉なしは 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$AUTH_URL/api/options")"
assert_eq "auth: 合言葉が違うと 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -u user:wrong "$AUTH_URL/")"
assert_eq "auth: 合言葉が合えば 200（ユーザー名は何でもよい）" "200" "$(curl -s -o /dev/null -w '%{http_code}' -u anyone:secret-word "$AUTH_URL/api/options")"
assert_eq "auth: manifest は合言葉なしで取れる" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$AUTH_URL/manifest.webmanifest")"
assert_eq "auth: 合言葉が無い設定なら認証なし" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/")"

# --- 存在しないルート ---
assert_eq "GET /api/not-found status" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/not-found")"

echo ""
echo "結果: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
