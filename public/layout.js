/* esd-app — 配線図面例の自動配置
 * AI が返した「階の外形・室の範囲（box_2d）・室ごとの機器の数・分電盤の位置」から、
 * 機器を室の内側へ規則的に並べ、分電盤から廊下を通って各室へ向かう配線ルートを作る。
 * 機器は必ず認識した室の内側に入るので、背景の平面図とずれない。
 * 画面（drawing.js）と Node のテスト（test.sh）の両方で使う。 */
(function (root) {
  // 機器の置き方
  const CEILING = ['light', 'downlight', 'emergency_light', 'smoke_detector', 'heat_detector']; // 天井に格子状
  const FLOOR = ['oa_outlet'];                     // 床に格子状
  const NEXT_TO_OA = ['lan'];                      // OAタップの横（無ければ床に格子状）
  const ALONG_WALL = ['outlet', 'power_outlet'];   // 壁沿いに等間隔
  const AT_ENTRY = ['switch', 'card_reader', 'exit_light']; // 入口側の壁
  const AT_CORNER = ['camera'];                    // 室の隅
  const MAX_PER_TYPE = 200;
  const SYSTEM_ORDER = ['lighting', 'power', 'elv', 'fire'];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : NaN);

  // box_2d（[ymin, xmin, ymax, xmax]、0〜1000）を画像の px の矩形にする
  function toRect(box, W, H) {
    if (!Array.isArray(box) || box.length < 4) return null;
    const [a, b, c, d] = box.map(v => clamp(num(v), 0, 1000));
    if ([a, b, c, d].some(Number.isNaN)) return null;
    const r = { x0: Math.min(b, d) / 1000 * W, y0: Math.min(a, c) / 1000 * H, x1: Math.max(b, d) / 1000 * W, y1: Math.max(a, c) / 1000 * H };
    return r.x1 - r.x0 >= 4 && r.y1 - r.y0 >= 4 ? r : null;
  }
  // point（[y, x]、0〜1000）を px の点にする
  function toPoint(p, W, H) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const y = num(p[0]), x = num(p[1]);
    return Number.isNaN(x) || Number.isNaN(y) ? null : [clamp(x, 0, 1000) / 1000 * W, clamp(y, 0, 1000) / 1000 * H];
  }
  const width = r => r.x1 - r.x0;
  const height = r => r.y1 - r.y0;
  const center = r => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
  const inset = (r, d) => {
    const dx = Math.min(d, width(r) * 0.45), dy = Math.min(d, height(r) * 0.45);
    return { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 - dx, y1: r.y1 - dy };
  };
  const inside = (p, r) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
  const clampInto = (p, r) => [clamp(p[0], r.x0, r.x1), clamp(p[1], r.y0, r.y1)];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const distToRect = (p, r) => dist(p, clampInto(p, r));

  // n 個を矩形の中に格子状に並べる（最後の行は均等に広げる）
  function grid(n, r) {
    if (n <= 0) return [];
    const w = Math.max(width(r), 1), h = Math.max(height(r), 1);
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * w / h))));
    const rows = Math.ceil(n / cols);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols);
      const inRow = row === rows - 1 ? n - row * cols : cols;
      const col = i - row * cols;
      pts.push([r.x0 + (col + 0.5) * w / inRow, r.y0 + (row + 0.5) * h / rows]);
    }
    return pts;
  }

  // 室の4辺のうち、分電盤に一番近い辺を入口側とする
  function entrySide(r, panel) {
    const sides = {
      top: dist(panel, [clamp(panel[0], r.x0, r.x1), r.y0]),
      bottom: dist(panel, [clamp(panel[0], r.x0, r.x1), r.y1]),
      left: dist(panel, [r.x0, clamp(panel[1], r.y0, r.y1)]),
      right: dist(panel, [r.x1, clamp(panel[1], r.y0, r.y1)]),
    };
    return Object.keys(sides).reduce((a, b) => (sides[b] < sides[a] ? b : a));
  }
  // 辺の上の位置 t（0〜1）を点にする
  function onSide(r, side, t) {
    if (side === 'top') return [r.x0 + t * width(r), r.y0];
    if (side === 'bottom') return [r.x0 + t * width(r), r.y1];
    if (side === 'left') return [r.x0, r.y0 + t * height(r)];
    return [r.x1, r.y0 + t * height(r)];
  }
  // 矩形の周に沿った位置 t（0〜1、入口側の辺から時計回り）を点にする
  function onPerimeter(r, side, t) {
    const order = { top: ['top', 'right', 'bottom', 'left'], right: ['right', 'bottom', 'left', 'top'], bottom: ['bottom', 'left', 'top', 'right'], left: ['left', 'top', 'right', 'bottom'] }[side];
    const lens = order.map(sd => (sd === 'top' || sd === 'bottom' ? width(r) : height(r)));
    let d = t * lens.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 4; i++) {
      if (d <= lens[i] || i === 3) {
        const u = clamp(d / lens[i], 0, 1);
        // 時計回りになるよう、下辺と左辺は逆向きにたどる
        return onSide(r, order[i], order[i] === 'bottom' || order[i] === 'left' ? 1 - u : u);
      }
      d -= lens[i];
    }
    return center(r);
  }

  // 1つの室に機器を並べる。placed は他の機器と重ならないようにするための一覧。
  function placeRoom(room, panel, s, typeInfo) {
    const r = room.rect;
    const pad = Math.min(Math.max(s * 1.4, Math.min(width(r), height(r)) * 0.12), Math.min(width(r), height(r)) * 0.3);
    const inner = inset(r, pad);
    const wallLine = inset(r, s * 0.9);
    const side = entrySide(r, panel);
    const minGap = s * 2.1;
    const out = [];

    const free = p => out.every(d => dist(d.p, p) >= minGap);
    // 他の機器と重なるときは、近くの空いている位置へずらす（室の内側から出さない）
    function put(type, p, area = inner) {
      let best = clampInto(p, area);
      if (!free(best)) {
        search: for (let k = 1; k <= 3; k++) {
          for (let a = 0; a < 8; a++) {
            const q = clampInto([p[0] + Math.cos(a * Math.PI / 4) * minGap * k, p[1] + Math.sin(a * Math.PI / 4) * minGap * k], area);
            if (free(q)) { best = q; break search; }
          }
        }
      }
      out.push({ type, system: typeInfo[type].system, p: best, room: room.name, ri: room.index });
    }

    const count = t => Math.min(MAX_PER_TYPE, Math.max(0, Math.round(num(room.devices?.[t]) || 0)));

    for (const t of CEILING) grid(count(t), inner).forEach(p => put(t, p));
    const oa = grid(count('oa_outlet'), inset(inner, s));
    oa.forEach(p => put('oa_outlet', p));
    for (const t of NEXT_TO_OA) {
      const n = count(t);
      const spots = oa.slice(0, n).map(p => [p[0] + s * 2.2, p[1]]);
      grid(n - spots.length, inset(inner, s * 2)).forEach(p => spots.push(p));
      spots.forEach(p => put(t, p));
    }
    for (const t of ALONG_WALL) {
      const n = count(t);
      for (let i = 0; i < n; i++) put(t, onPerimeter(wallLine, side, (i + 0.5) / n), wallLine);
    }
    AT_ENTRY.forEach((t, k) => {
      const n = count(t);
      for (let i = 0; i < n; i++) {
        // スイッチは辺の端寄り、カードリーダーはその隣、誘導灯は中央
        const base = t === 'exit_light' ? 0.5 : 0.12 + k * 0.1;
        put(t, onSide(wallLine, side, clamp(base + i * 0.18, 0.05, 0.95)), wallLine);
      }
    });
    for (const t of AT_CORNER) {
      const corners = [[inner.x0, inner.y0], [inner.x1, inner.y0], [inner.x1, inner.y1], [inner.x0, inner.y1]]
        .sort((a, b) => dist(b, panel) - dist(a, panel)); // 入口から遠い隅から
      for (let i = 0; i < count(t); i++) put(t, corners[i % 4]);
    }
    return out;
  }

  // 室の入口（分電盤に一番近い辺の中央。壁から少し内側）
  const entryOf = (r, panel, s) => onSide(inset(r, s * 0.9), entrySide(r, panel), 0.5);

  // 折れ線の重複点・一直線上の中間点を除く
  function simplify(pts) {
    const out = [];
    for (const p of pts) {
      const q = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
      const last = out[out.length - 1];
      if (last && last[0] === q[0] && last[1] === q[1]) continue;
      if (out.length >= 2) {
        const a = out[out.length - 2];
        if ((a[0] === last[0] && last[0] === q[0]) || (a[1] === last[1] && last[1] === q[1])) out.pop();
      }
      out.push(q);
    }
    return out;
  }

  // 分電盤から室の入口までの幹線。廊下があれば廊下の中心線を通る（縦横の直線だけ）。
  function trunk(panel, entry, corridors, room) {
    const c = room.kind === 'corridor' ? null : corridors
      .filter(x => x !== room)
      .sort((a, b) => distToRect(entry, a.rect) - distToRect(entry, b.rect))[0];
    if (!c) return [panel, [entry[0], panel[1]], entry];
    const r = c.rect;
    if (width(r) >= height(r)) {
      const cy = (r.y0 + r.y1) / 2;
      const px = clamp(panel[0], r.x0, r.x1), ex = clamp(entry[0], r.x0, r.x1);
      return [panel, [panel[0], cy], [px, cy], [ex, cy], [ex, entry[1]], entry];
    }
    const cx = (r.x0 + r.x1) / 2;
    const py = clamp(panel[1], r.y0, r.y1), ey = clamp(entry[1], r.y0, r.y1);
    return [panel, [cx, panel[1]], [cx, py], [cx, ey], [entry[0], ey], entry];
  }

  // 幹線全体を縦横に offset だけずらし、両端は縦横の折れ目で元の点（分電盤・入口）につなぐ
  function shift(pts, o) {
    const moved = pts.map(p => [p[0] + o, p[1] + o]);
    const a = pts[0], b = pts[pts.length - 1];
    return [a, [a[0] + o, a[1]], ...moved, [b[0], b[1] + o], b];
  }

  // 室の中の同じ系統の機器を、入口から近い順に行ごとに折り返してつなぐ
  function chain(entry, devices, s) {
    if (!devices.length) return [];
    const rows = [];
    for (const d of [...devices].sort((a, b) => a.p[1] - b.p[1])) {
      const row = rows.find(rw => Math.abs(rw.y - d.p[1]) < s * 1.5);
      if (row) row.items.push(d); else rows.push({ y: d.p[1], items: [d] });
    }
    let order = rows.flatMap((rw, i) => rw.items.sort((a, b) => (i % 2 ? b.p[0] - a.p[0] : a.p[0] - b.p[0])));
    if (dist(entry, order[order.length - 1].p) < dist(entry, order[0].p)) order = order.reverse();
    const pts = [entry];
    for (const d of order) {
      const cur = pts[pts.length - 1];
      pts.push([d.p[0], cur[1]], d.p);
    }
    return pts;
  }

  const polylineLength = pts => pts.slice(1).reduce((sum, p, i) => sum + dist(p, pts[i]), 0);

  // 点がどの室にあるか（rooms の番号）。室の内側なら一番小さい室、少し外なら近い室、離れていれば -1。
  function assignRoom(p, rooms, s) {
    const area = r => width(r.rect) * height(r.rect);
    const hit = rooms.map((r, i) => i).filter(i => inside(p, rooms[i].rect)).sort((a, b) => area(rooms[a]) - area(rooms[b]));
    if (hit.length) return hit[0];
    let best = -1, bestD = s * 3;
    rooms.forEach((r, i) => { const d = distToRect(p, r.rect); if (d < bestD) { best = i; bestD = d; } });
    return best;
  }

  // 機器の位置から配線ルートと系統ごとの配線長を作る（自動配置のあとも、画面で機器を動かしたあとも使う）。
  // 機器は ri（rooms の番号、室の外は -1）を持つ。室の中の機器は廊下を通って入口から、室の外の機器は分電盤から直接つなぐ。
  function routeFloor(geo, devices, s, widthM) {
    const { outline, rooms } = geo;
    const corridors = rooms.filter(r => r.kind === 'corridor');
    const panelDevice = devices.find(d => d.type === 'panel');
    const panel = panelDevice ? panelDevice.p : [outline.x1 - s * 2, outline.y1 - s * 2];
    const byRoom = rooms.map(() => []);
    const loose = [];
    for (const d of devices) {
      if (d === panelDevice) continue;
      if (d.ri >= 0 && byRoom[d.ri]) byRoom[d.ri].push(d); else loose.push(d);
    }
    const routes = [];
    rooms.forEach((room, i) => {
      if (!byRoom[i].length) return;
      const entry = entryOf(room.rect, panel, s);
      SYSTEM_ORDER.forEach((sys, k) => {
        const mine = byRoom[i].filter(d => d.system === sys);
        if (!mine.length) return;
        const offset = (k - 1.5) * s * 0.55; // 系統ごとに幹線を少しずらして重ならないようにする
        const tr = shift(trunk(panel, entry, corridors, room), offset);
        routes.push({ system: sys, room: room.name, points: simplify([...tr, ...chain(entry, mine, s).slice(1)]) });
      });
    });
    SYSTEM_ORDER.forEach(sys => {
      const mine = loose.filter(d => d.system === sys);
      if (mine.length) routes.push({ system: sys, room: '', points: simplify(chain(panel, mine, s)) });
    });
    const mPerPx = widthM ? widthM / width(outline) : null;
    return {
      routes, mPerPx,
      lengthBySystem: Object.fromEntries(SYSTEM_ORDER.map(sys => [sys, mPerPx ? routes.filter(r => r.system === sys).reduce((sum, r) => sum + polylineLength(r.points), 0) * mPerPx : 0])),
    };
  }

  // 複数の階をまとめた図から1つの階を切り出す範囲（外形に余白を付け、上は階の名前の分を広めにとる。
  // 下は図面名（「1階平面図」など）が半端に入らないよう狭くする）
  function cropRect(outline, image, s) {
    const pad = Math.max(s * 3, Math.max(image.width, image.height) * 0.025);
    return {
      x0: Math.max(0, outline.x0 - pad), y0: Math.max(0, outline.y0 - pad - s * 2),
      x1: Math.min(image.width, outline.x1 + pad), y1: Math.min(image.height, outline.y1 + s * 1.5),
    };
  }

  // 1つの階を配置する。image は { width, height }（px）、s は記号の大きさ（px）。
  function layoutFloor(floor, image, s, deviceTypes, userWidthM) {
    const W = image.width, H = image.height;
    const typeInfo = Object.fromEntries(deviceTypes.map(d => [d.key, d]));
    const outline = toRect(floor.box_2d, W, H) || { x0: 0, y0: 0, x1: W, y1: H };
    const rooms = (Array.isArray(floor.rooms) ? floor.rooms : [])
      .map(r => ({ id: String(r.id || ''), name: String(r.name || ''), kind: String(r.kind || 'room'), rect: toRect(r.box_2d, W, H), devices: r.devices || {} }))
      .filter(r => r.rect)
      .map(r => ({ ...r, rect: { x0: Math.max(r.rect.x0, outline.x0), y0: Math.max(r.rect.y0, outline.y0), x1: Math.min(r.rect.x1, outline.x1), y1: Math.min(r.rect.y1, outline.y1) } }))
      .filter(r => width(r.rect) >= 4 && height(r.rect) >= 4)
      .map((r, index) => ({ ...r, index }));
    const corridors = rooms.filter(r => r.kind === 'corridor');

    // 分電盤: AI が選んだ室の中心 → AI の位置（外形の内側へ寄せる）→ シャフトの中心 → 廊下の中心 → 外形の右下
    const panelRoom = floor.panel_room && rooms.find(r => r.id === String(floor.panel_room));
    let panel = panelRoom ? center(panelRoom.rect) : toPoint(floor.panel, W, H);
    if (panel) panel = clampInto(panel, outline);
    else {
      const shaft = rooms.find(r => r.kind === 'shaft') || corridors[0];
      panel = shaft ? center(shaft.rect) : [outline.x1 - s * 2, outline.y1 - s * 2];
    }

    const devices = [{ type: 'panel', system: typeInfo.panel?.system || 'power', p: panel, room: '', ri: -1 }];
    for (const room of rooms) devices.push(...placeRoom(room, panel, s, typeInfo));

    const widthM = userWidthM || (num(floor.width_m) > 0 ? num(floor.width_m) : null);
    return { name: String(floor.name || ''), outline, rooms, devices, widthM, ...routeFloor({ outline, rooms }, devices, s, widthM) };
  }

  const api = { layoutFloor, routeFloor, assignRoom, cropRect, toRect, toPoint, grid, inside };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EsdLayout = api;
})(typeof self !== 'undefined' ? self : this);
