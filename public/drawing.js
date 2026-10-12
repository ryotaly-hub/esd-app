/* esd-app — 建物図面（平面図）の登録と配線図面例の描画
 * 図面は何枚でも（MAX まで）登録でき、1枚ごとに「1つの階」か「複数の階をまとめた図」かを選ぶ。
 * PDF は全ページを1枚ずつ登録する。画像は長辺 MAX_SIDE 以下の JPEG にしてからサーバーへ送る。
 * 配線図面は、AI が返した室の範囲と機器の数をもとに layout.js が機器と配線を並べ、平面図に SVG で重ねて描く。
 * 複数の階をまとめた図は階ごとに切り出して表示する。機器は画面で追加・移動・削除でき、そのたびに配線と概算を計算し直す。 */
(function () {
  const WIRING_ALLOWANCE = 1.2;   // 配線長の割増（立上り・引下げ・余長）
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const LEGEND_S = 7;              // 凡例の記号の大きさ（画面上の px）
  const PC_SYMBOL_SCALE = 1.5;     // PC の配線図面では、記号を画面上で凡例の何倍にするか
  const PHONE = window.matchMedia('(max-width: 560px)'); // スマホは記号の大きさを変えない
  const Layout = window.EsdLayout;

  // 系統ごとの色と線種（線種は色が見分けにくい場合や白黒印刷のための区別）
  const SYSTEM_STYLE = {
    lighting: { color: '#2a78d6', dash: '' },
    power:    { color: '#eb6834', dash: '10 5' },
    elv:      { color: '#1baf7a', dash: '3 4' },
    fire:     { color: '#eda100', dash: '12 4 3 4' },
  };
  // 階の名前の候補（自由に書き換えられる）
  const FLOOR_NAMES = ['地下2階', '地下1階', ...Array.from({ length: 30 }, (_, i) => `${i + 1}階`), '基準階', '屋上', '塔屋'];

  let defs = { systems: [], deviceTypes: [], maxDrawings: 8 }; // GET /api/options の drawing
  let entries = [];   // 登録した図面 { id, dataUrl, mimeType, width, height, name, kind, floorName, repeat, widthM }
  let onChange = () => {};
  let onError = () => {};

  const $ = sel => document.querySelector(sel);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const maxSide = () => (entries.length >= 3 ? 1600 : 2000); // 枚数が多いときは小さめにして送信量を抑える

  /* ---------- 図面の読み込み ---------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('PDF を読むための部品（pdf.js）を読み込めませんでした。ネットワークを確認してください'));
      document.head.appendChild(s);
    });
  }
  async function pdfjs() {
    if (!window.pdfjsLib) {
      await loadScript(`${PDFJS}pdf.min.js`);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
    }
    return window.pdfjsLib;
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = src;
    });
  }

  // 画像・canvas を長辺 maxSide() 以下の JPEG にする（白背景）
  function toJpeg(source, w, h, name) {
    const scale = Math.min(1, maxSide() / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.88), mimeType: 'image/jpeg', width: canvas.width, height: canvas.height, name };
  }

  async function readPdf(file) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 2000 / Math.max(base.width, base.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      out.push(toJpeg(canvas, canvas.width, canvas.height, doc.numPages > 1 ? `${file.name}（${n}ページ目）` : file.name));
    }
    return out;
  }

  async function readFile(file) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return readPdf(file);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(`${file.name}: PNG・JPEG・WebP の画像か PDF を選んでください`);
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return [toJpeg(img, img.naturalWidth, img.naturalHeight, file.name)];
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // 新しく登録した図面の階の名前の初期値（既にある階の次）
  function nextFloorName() {
    const used = entries.filter(e => e.kind === 'single').map(e => FLOOR_NAMES.indexOf(e.floorName)).filter(i => i >= 2 && i < 32);
    return FLOOR_NAMES[used.length ? Math.min(Math.max(...used) + 1, 31) : 2];
  }

  async function addFiles(files) {
    const pages = [];
    for (const f of files) pages.push(...await readFile(f));
    const room = defs.maxDrawings - entries.length;
    if (pages.length > room) onError(`図面は ${defs.maxDrawings} 枚まで登録できます（${pages.length - Math.max(room, 0)} 枚は登録しませんでした）`);
    for (const p of pages.slice(0, Math.max(room, 0))) {
      entries.push({ ...p, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind: 'single', floorName: nextFloorName(), repeat: 1, widthM: null });
    }
    renderList();
    onChange();
  }

  /* ---------- 登録した図面の一覧 ---------- */
  function renderList() {
    $('#drawing-count').textContent = entries.length ? `${entries.length} / ${defs.maxDrawings} 枚` : '';
    $('#drawing-list').innerHTML = entries.map((e, i) => `
      <li class="drawing-item" data-id="${e.id}">
        <img src="${e.dataUrl}" alt="図面${i + 1}">
        <div class="drawing-fields">
          <div class="drawing-title"><strong>図面${i + 1}</strong> <span>${esc(e.name)}</span></div>
          <div class="grid">
            <label>図面の内容
              <select data-k="kind">
                <option value="single"${e.kind === 'single' ? ' selected' : ''}>1つの階</option>
                <option value="combined"${e.kind === 'combined' ? ' selected' : ''}>複数の階をまとめた図</option>
              </select>
            </label>
            <label${e.kind === 'combined' ? ' hidden' : ''}>階の名前
              <input data-k="floorName" list="floor-names" value="${esc(e.floorName)}" maxlength="20" placeholder="例: 1階、2〜4階">
            </label>
            <label${e.kind === 'combined' ? ' hidden' : ''}>同じ図面の階数
              <input data-k="repeat" type="number" min="1" max="50" step="1" value="${e.repeat}">
            </label>
            <label>1フロアの横方向の実寸（m）
              <input data-k="widthM" type="number" min="1" max="1000" step="0.1" value="${e.widthM ?? ''}" placeholder="空欄なら寸法線から">
            </label>
          </div>
          ${e.kind === 'combined' ? '<p class="hint">階の区切りと階の名前は AI が図面から読み取ります。</p>' : ''}
        </div>
        <button type="button" class="secondary" data-remove>取り消す</button>
      </li>`).join('');
  }

  function init(drawingDefs, opts) {
    defs = { ...defs, ...drawingDefs };
    onChange = opts.onChange;
    onError = opts.onError;
    if (Array.isArray(opts.saved)) entries = opts.saved.filter(e => e?.dataUrl).slice(0, defs.maxDrawings);
    $('#floor-names').innerHTML = FLOOR_NAMES.map(n => `<option value="${n}">`).join('');
    renderList();

    $('#drawing-file').addEventListener('change', async e => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      try { await addFiles(files); } catch (err) { onError(err.message); }
    });
    $('#drawing-list').addEventListener('click', e => {
      if (!e.target.matches('[data-remove]')) return;
      const id = e.target.closest('.drawing-item').dataset.id;
      entries = entries.filter(x => x.id !== id);
      renderList();
      onChange();
    });
    $('#drawing-list').addEventListener('input', e => {
      const k = e.target.dataset.k;
      if (!k) return;
      const entry = entries.find(x => x.id === e.target.closest('.drawing-item').dataset.id);
      const v = e.target.value;
      if (k === 'repeat') entry.repeat = Math.min(50, Math.max(1, Math.round(num(v)) || 1));
      else if (k === 'widthM') entry.widthM = v !== '' && num(v) >= 1 && num(v) <= 1000 ? num(v) : null;
      else entry[k] = v;
      if (k === 'kind') renderList();
      onChange();
    });
  }

  // 今登録されている図面（保存・結果の表示用）
  const get = () => entries.map(e => ({ ...e }));

  // ファイルから読んだ図面を確かめて、知っている項目だけの形にする（使えなければ null）。
  // dataUrl は SVG の属性にそのまま入れるので、画像の data URL 以外は受け付けない。
  function cleanEntry(e) {
    const dataUrl = String(e?.dataUrl || '');
    const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/]+=*$/);
    const width = Number(e?.width), height = Number(e?.height);
    if (!m || !(width > 0 && width < 20000) || !(height > 0 && height < 20000)) return null;
    const widthM = Number(e.widthM);
    return {
      id: String(e.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`).slice(0, 40),
      dataUrl, mimeType: m[1], width, height, name: String(e.name || '').slice(0, 100),
      kind: e.kind === 'combined' ? 'combined' : 'single',
      floorName: String(e.floorName || '').slice(0, 20),
      repeat: Math.min(50, Math.max(1, Math.round(Number(e.repeat)) || 1)),
      widthM: widthM >= 1 && widthM <= 1000 ? widthM : null,
    };
  }
  const cleanList = list => (Array.isArray(list) ? list.map(cleanEntry).filter(Boolean).slice(0, defs.maxDrawings) : []);

  // 登録した図面の一覧を丸ごと置き換える（ファイルを開いたとき・リセットのとき）
  function set(list) {
    entries = cleanList(list);
    renderList();
    onChange();
  }
  // プロンプトのプレビュー用（画像を除いた説明だけ）
  const describe = () => entries.map(({ kind, floorName, repeat, widthM, width, height }) => ({ kind, floorName, repeat, widthM, aspect: height / width }));
  // サーバーへ送る形
  const payload = () => entries.map(e => ({ mimeType: e.mimeType, data: e.dataUrl.split(',')[1], kind: e.kind, floorName: e.floorName, repeat: e.repeat, widthM: e.widthM, aspect: e.height / e.width }));

  /* ---------- 配線図面例の描画 ---------- */
  // 機器の記号（JIS C 0303 の平面図記号を簡略化したもの）。s は大きさの基準。
  function symbol(type, x, y, s, color) {
    const st = `stroke="${color}" stroke-width="${s * 0.18}" fill="#fff"`;
    const fill = `fill="${color}"`;
    const text = (t, size = 0.9) => `<text x="${x}" y="${y}" font-size="${s * size}" text-anchor="middle" dominant-baseline="central" ${fill} font-weight="700">${t}</text>`;
    switch (type) {
      case 'panel':
        return `<rect x="${x - s * 1.4}" y="${y - s * 0.7}" width="${s * 2.8}" height="${s * 1.4}" ${st}/><path d="M${x - s * 1.4},${y + s * 0.7} L${x + s * 1.4},${y - s * 0.7} L${x + s * 1.4},${y + s * 0.7} Z" ${fill}/>`;
      case 'light':
        return `<rect x="${x - s * 1.5}" y="${y - s * 0.45}" width="${s * 3}" height="${s * 0.9}" ${st}/><circle cx="${x}" cy="${y}" r="${s * 0.3}" ${fill}/>`;
      case 'downlight':
        return `<circle cx="${x}" cy="${y}" r="${s * 0.8}" ${st}/><circle cx="${x}" cy="${y}" r="${s * 0.4}" ${st}/>`;
      case 'switch':
        return `<circle cx="${x}" cy="${y}" r="${s * 0.45}" ${fill}/>`;
      case 'outlet':
        return `<circle cx="${x}" cy="${y}" r="${s * 0.75}" ${st}/><path d="M${x},${y - s * 0.75} A${s * 0.75},${s * 0.75} 0 0 1 ${x},${y + s * 0.75} Z" ${fill}/>`;
      case 'oa_outlet':
        return `<rect x="${x - s}" y="${y - s}" width="${s * 2}" height="${s * 2}" ${st}/><path d="M${x},${y - s * 0.6} A${s * 0.6},${s * 0.6} 0 0 1 ${x},${y + s * 0.6} Z" ${fill}/>`;
      case 'power_outlet':
        return `<path d="M${x},${y - s} L${x + s},${y} L${x},${y + s} L${x - s},${y} Z" ${st}/>${text('M', 0.9)}`;
      case 'lan':
        return `<path d="M${x},${y - s * 0.9} L${x + s * 0.9},${y + s * 0.7} L${x - s * 0.9},${y + s * 0.7} Z" ${st}/>`;
      case 'camera':
        return `<rect x="${x - s}" y="${y - s * 0.55}" width="${s * 1.4}" height="${s * 1.1}" ${st}/><path d="M${x + s * 0.4},${y} L${x + s * 1.1},${y - s * 0.5} L${x + s * 1.1},${y + s * 0.5} Z" ${fill}/>`;
      case 'card_reader':
        return `<rect x="${x - s * 0.8}" y="${y - s * 0.8}" width="${s * 1.6}" height="${s * 1.6}" ${st}/><rect x="${x - s * 0.35}" y="${y - s * 0.35}" width="${s * 0.7}" height="${s * 0.7}" ${fill}/>`;
      case 'smoke_detector':
        return `<rect x="${x - s * 0.8}" y="${y - s * 0.8}" width="${s * 1.6}" height="${s * 1.6}" ${st}/>${text('S', 1.1)}`;
      case 'heat_detector':
        return `<rect x="${x - s * 0.8}" y="${y - s * 0.8}" width="${s * 1.6}" height="${s * 1.6}" ${st}/>${text('H', 1.1)}`;
      case 'exit_light':
        return `<rect x="${x - s * 1.2}" y="${y - s * 0.6}" width="${s * 2.4}" height="${s * 1.2}" ${st}/><rect x="${x - s * 0.5}" y="${y - s * 0.6}" width="${s}" height="${s * 1.2}" ${fill}/>`;
      case 'emergency_light':
        return `<circle cx="${x}" cy="${y}" r="${s * 0.75}" ${fill}/><circle cx="${x}" cy="${y}" r="${s * 0.25}" fill="#fff"/>`;
      default:
        return `<circle cx="${x}" cy="${y}" r="${s * 0.6}" ${st}/>`;
    }
  }

  // 凡例用の小さな記号
  function symbolSvg(type, system) {
    const color = SYSTEM_STYLE[system]?.color || '#555';
    return `<svg class="legend-symbol" viewBox="-20 -12 40 24" aria-hidden="true">${symbol(type, 0, 0, LEGEND_S, color)}</svg>`;
  }

  const dashOf = (style, w) => (style.dash ? ` stroke-dasharray="${style.dash.split(' ').map(v => v * w / 2).join(' ')}"` : '');

  // 1つの階の重ね書き（室の範囲・配線・機器・階の名前・選択の印）。編集のたびにここだけ描き直す。
  function overlayMarkup(fl, fi) {
    const { lf, s, view } = fl;
    const sym = fl.sym || s; // 記号を描く大きさ（PC では画面上で凡例の1.5倍になるよう updateSymbolSizes が決める）
    const strokeW = s * 0.2;
    const typeLabel = Object.fromEntries(defs.deviceTypes.map(t => [t.key, t.label]));
    const shown = key => (state.hidden.has(key) ? ' style="display:none"' : '');
    const roomLayer = lf.rooms.map(r =>
      `<rect x="${r.rect.x0}" y="${r.rect.y0}" width="${r.rect.x1 - r.rect.x0}" height="${r.rect.y1 - r.rect.y0}" fill="rgba(42,120,214,0.06)" stroke="#7a7f88" stroke-width="${strokeW * 0.6}" stroke-dasharray="${strokeW * 2} ${strokeW * 2}"><title>${esc(`${lf.name} ${r.name}`)}</title></rect>`).join('');
    const label = lf.name
      ? `<text x="${lf.outline.x0}" y="${Math.max(lf.outline.y0 - s * 0.8, view.y0 + s * 1.6)}" font-size="${s * 1.8}" font-weight="700" fill="#16181d" paint-order="stroke" stroke="#fff" stroke-width="${s * 0.5}">${esc(lf.name)}</text>` : '';

    const ptsAttr = pts => pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const groups = defs.systems.map(sys => {
      const style = SYSTEM_STYLE[sys.key];
      // route-hit は編集のときに配線をつかみやすくするための透明な太い線
      const lines = lf.routes.filter(r => r.system === sys.key).map(r =>
        `<polyline points="${ptsAttr(r.points)}" fill="none" stroke="${style.color}" stroke-width="${strokeW}" stroke-linejoin="round"${dashOf(style, strokeW)}><title>${esc(`${sys.label}（${lf.name}${r.room ? ` ${r.room}` : ''}）`)}</title></polyline>` +
        `<polyline class="route-hit" data-route="${esc(r.key)}" points="${ptsAttr(r.points)}" fill="none" stroke="transparent" stroke-width="${sym * 1.2}"/>`).join('');
      // hit は編集のときにつかみやすくするための透明な円
      const marks = lf.devices.map((d, di) => (d.system !== sys.key ? '' :
        `<g class="device" data-di="${di}"><title>${esc(`${typeLabel[d.type]}（${lf.name}${d.room ? ` ${d.room}` : ''}）`)}</title>${symbol(d.type, d.p[0], d.p[1], sym, style.color)}<circle class="hit" cx="${d.p[0]}" cy="${d.p[1]}" r="${sym * 1.7}" fill="transparent"/></g>`)).join('');
      return `<g class="layer" data-system="${sys.key}"${shown(sys.key)}>${lines}${marks}</g>`;
    }).join('');

    const sel = state.selected?.fi === fi ? lf.devices[state.selected.di] : null;
    const selRoute = state.selected?.fi === fi && state.selected.route ? lf.routes.find(r => r.key === state.selected.route) : null;
    const ring = sel ? `<circle class="sel-ring" cx="${sel.p[0]}" cy="${sel.p[1]}" r="${sym * 2.1}" fill="none" stroke="#1e9bf0" stroke-width="${sym * 0.28}" stroke-dasharray="${sym * 0.7} ${sym * 0.45}"/>`
      : selRoute ? `<polyline class="sel-ring" points="${ptsAttr(selRoute.points)}" fill="none" stroke="#1e9bf0" stroke-opacity="0.35" stroke-width="${sym * 0.9}" stroke-linejoin="round" pointer-events="none"/>` +
        // 動かせる角（端と機器の点を除く）に □ の取っ手を出す
        selRoute.points.slice(1, -1).filter(p => !lf.devices.some(d => Math.abs(d.p[0] - p[0]) <= 0.2 && Math.abs(d.p[1] - p[1]) <= 0.2)).map(p =>
          `<rect class="sel-ring corner-handle" data-route="${esc(selRoute.key)}" x="${p[0] - sym * 0.45}" y="${p[1] - sym * 0.45}" width="${sym * 0.9}" height="${sym * 0.9}" fill="#fff" stroke="#1e9bf0" stroke-width="${sym * 0.2}"/>`).join('') : '';
    return `<g class="layer" data-system="rooms"${shown('rooms')}>${roomLayer}</g>${groups}${label}${ring}`;
  }

  // 1つの階の図。複数の階をまとめた図は、viewBox でその階の範囲だけを切り出して見せる。
  function figureMarkup(fl, fi) {
    const { img, view: v } = fl;
    const w = v.x1 - v.x0, h = v.y1 - v.y0;
    return `<figure class="wiring-figure" data-fi="${fi}"><figcaption>${esc(fl.title)}</figcaption><div class="wiring-drawing">
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${v.x0} ${v.y0} ${w} ${h}" width="${Math.round(w)}" height="${Math.round(h)}" role="img" aria-label="配線図面例（平面図に機器と配線を重ねた図。数量は凡例と内訳の表）">
        <rect x="${v.x0}" y="${v.y0}" width="${w}" height="${h}" fill="#fff"/>
        <image href="${img.dataUrl}" xlink:href="${img.dataUrl}" x="0" y="0" width="${img.width}" height="${img.height}" opacity="0.7"/>
        <g class="overlay">${overlayMarkup(fl, fi)}</g>
      </svg></div></figure>`;
  }
  const drawOverlay = fi => {
    const g = document.querySelector(`#wiring-drawings figure[data-fi="${fi}"] .overlay`);
    if (g) g.innerHTML = overlayMarkup(state.floors[fi], fi);
  };

  // 機器の数・配線長・単価から概算を計算する（repeat は同じ図面の階数）
  function estimate(laid, drawing, overheadRate) {
    const price = (table, key) => ({ material: num(table?.[key]?.material), labor: num(table?.[key]?.labor) });
    const counts = {}, lengths = {};
    for (const f of laid) {
      for (const d of f.devices) counts[d.type] = (counts[d.type] || 0) + f.repeat;
      for (const [sys, len] of Object.entries(f.lengthBySystem)) lengths[sys] = (lengths[sys] || 0) + len * WIRING_ALLOWANCE * f.repeat;
    }
    const rows = [];
    for (const t of defs.deviceTypes) {
      if (!counts[t.key]) continue;
      const p = price(drawing.unit_prices, t.key);
      rows.push({ name: t.label, qty: counts[t.key], unit: t.unit, ...p, amount: Math.round(counts[t.key] * (p.material + p.labor)) });
    }
    for (const s of defs.systems) {
      if (!lengths[s.key]) continue;
      const p = price(drawing.wiring_unit_prices, s.key);
      const qty = Math.round(lengths[s.key] * 10) / 10;
      rows.push({ name: `${s.label} 配線（配管・電線込み）`, qty, unit: 'm', ...p, amount: Math.round(qty * (p.material + p.labor)) });
    }
    // 階ごとの金額（1フロア分）
    for (const f of laid) {
      let a = 0;
      for (const d of f.devices) { const p = price(drawing.unit_prices, d.type); a += p.material + p.labor; }
      for (const [sys, len] of Object.entries(f.lengthBySystem)) { const p = price(drawing.wiring_unit_prices, sys); a += Math.round(len * WIRING_ALLOWANCE * 10) / 10 * (p.material + p.labor); }
      f.amount = Math.round(a);
    }
    const direct = rows.reduce((sum, r) => sum + r.amount, 0);
    const overhead = Math.round(direct * overheadRate);
    return { rows, counts, direct, overhead, total: direct + overhead };
  }

  // 1段目で検出した室（rooms）に、2段目で AI が決めた室ごとの機器の数・分電盤の室・実寸を合わせる。
  // 検出結果が無いとき（貼り付けた回答など）は、AI の JSON に入っている室の範囲をそのまま使う。
  function mergeFloors(drawing, detected) {
    const aiFloors = Array.isArray(drawing?.floors) ? drawing.floors : [];
    if (!detected?.length) return aiFloors;
    const devicesById = {};
    const aiByPrefix = {};
    for (const f of aiFloors) {
      for (const r of Array.isArray(f.rooms) ? f.rooms : []) if (r?.id) devicesById[r.id] = r.devices || {};
      const ref = String(f.panel_room || f.rooms?.find(r => r?.id)?.id || '');
      if (ref) aiByPrefix[ref.split('-').slice(0, 2).join('-')] = f;
    }
    return detected.map(f => {
      const prefix = f.rooms[0]?.id.split('-').slice(0, 2).join('-');
      const ai = aiByPrefix[prefix] || {};
      return {
        image: f.image, name: f.name, box_2d: f.box_2d,
        width_m: num(ai.width_m) > 0 ? ai.width_m : f.width_m,
        panel_room: ai.panel_room,
        rooms: f.rooms.map(r => ({ ...r, devices: devicesById[r.id] || {} })),
      };
    });
  }

  /* ---------- 配線図面例の表示と編集 ---------- */
  const state = {
    floors: [],          // 表示中の階 { lf（layout.js の結果）, s, img, view（表示範囲）, key, title, auto（自動配置）, routeEdits（手で直した配線）, shortest（最短ルートで結ぶ系統）, edited }
    drawing: null, overheadRate: 0.18, yen: v => String(v), onEdit: () => {},
    hidden: new Set(['rooms']), // 非表示の系統（室の範囲は最初は隠す）
    editing: false, tool: 'select', selected: null, drag: null, history: [],
  };
  const MAX_HISTORY = 50;
  const typeOf = key => defs.deviceTypes.find(t => t.key === key);
  const shortLabel = t => t.label.replace(/（.*）$/, '');
  const copyDevices = list => list.map(d => ({ ...d, p: [...d.p] }));
  const clampInto = (p, r) => [Math.min(r.x1, Math.max(r.x0, p[0])), Math.min(r.y1, Math.max(r.y0, p[1]))];

  const round1 = v => Math.round(v * 10) / 10;
  // 機器を1つ作る（位置から室を決める。分電盤はどの室にも属さない）。位置は保存する値と同じく 0.1px 単位にそろえる
  // （そろえないと、開き直したときに自動のルートが変わり、手で直した配線が使えなくなる）。
  function makeDevice(fl, type, p) {
    p = p.map(round1);
    const ri = type === 'panel' ? -1 : Layout.assignRoom(p, fl.lf.rooms, fl.s);
    return { type, system: typeOf(type).system, p, room: ri >= 0 ? fl.lf.rooms[ri].name : '', ri };
  }
  // 配線を引き直す。手で直した配線は、元の自動のルートが変わったもの（機器・分電盤を動かした室と系統）を捨てる。
  function reroute(fl) {
    Object.assign(fl.lf, Layout.routeFloor(fl.lf, fl.lf.devices, fl.s, fl.lf.widthM, fl.routeEdits, fl.shortest));
    for (const key of Object.keys(fl.routeEdits)) if (!fl.lf.routes.some(r => r.key === key && r.edited)) delete fl.routeEdits[key];
  }

  // 保存しておいた編集（[種類, x, y] の一覧）を機器に戻す。使えなければ null。
  function restoreDevices(list, fl) {
    if (!Array.isArray(list)) return null;
    const out = list
      .filter(a => Array.isArray(a) && typeOf(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]))
      .slice(0, 3000)
      .map(([type, x, y]) => makeDevice(fl, type, [Math.min(fl.img.width, Math.max(0, x)), Math.min(fl.img.height, Math.max(0, y))]));
    if (!out.some(d => d.type === 'panel')) out.unshift(copyDevices(fl.auto.filter(d => d.type === 'panel'))[0]);
    return out.filter(Boolean);
  }
  // 保存しておいた手で直した配線（{ 系統|室の番号: { sig, points } }）を確かめて戻す
  function restoreRoutes(obj, fl) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const [key, v] of Object.entries(obj).slice(0, 500)) {
      if (!/^[a-z]+\|-?\d+$/.test(key) || typeof v?.sig !== 'string' || v.sig.length > 16 || !Array.isArray(v.points)) continue;
      const pts = v.points.slice(0, 2000).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(p => [round1(Math.min(fl.img.width, Math.max(0, p[0]))), round1(Math.min(fl.img.height, Math.max(0, p[1])))]);
      if (pts.length >= 2) out[key] = { sig: v.sig, points: pts };
    }
    return out;
  }

  // 配線図面例と、その概算を表示する。drawing は AI の JSON、images は生成時に登録されていた図面、rooms は1段目の検出結果、
  // edits は画面で編集した機器の配置（階ごと）、onEdit は編集したときに呼ぶ関数（保存用）。
  function render(drawing, images, { rooms = [], overheadRate = 0.18, yen, edits = null, onEdit = () => {} }) {
    const card = $('#wiring');
    Object.assign(state, { floors: [], drawing, overheadRate, yen, onEdit, selected: null, drag: null, history: [] });
    setEditing(false);
    const floorsIn = mergeFloors(drawing, rooms);
    if (!floorsIn.length || !images?.length) { card.hidden = true; return; }

    images.forEach((img, i) => {
      const s = Math.max(img.width, img.height) * 0.0105; // 記号の大きさ
      // 「1つの階」の図面は1フロア分だけ使い、同じ図面の階数で掛ける（AI が階を分けて返しても重複させない）
      const mine = floorsIn.filter(f => (Math.round(num(f.image)) || 1) === i + 1);
      (img.kind === 'single' ? mine.slice(0, 1) : mine).forEach((f, k) => {
        const lf = Layout.layoutFloor(f, img, s, defs.deviceTypes, img.widthM);
        lf.name = img.kind === 'single' && img.floorName ? img.floorName : lf.name || `図面${i + 1}`;
        lf.repeat = img.kind === 'single' ? img.repeat || 1 : 1;
        lf.image = i + 1;
        lf.devices.forEach(d => { d.p = d.p.map(round1); });
        const fl = {
          lf, s, img, key: `${i + 1}-${k + 1}`, routeEdits: {}, shortest: [], edited: false,
          // 複数の階をまとめた図は階ごとに切り出す
          view: img.kind === 'combined' ? Layout.cropRect(lf.outline, img, s) : { x0: 0, y0: 0, x1: img.width, y1: img.height },
          title: img.kind === 'combined'
            ? `図面${i + 1}：${lf.name}（まとめた図から切り出し）`
            : `図面${i + 1}：${lf.name}${lf.repeat > 1 ? `（同じ平面 ${lf.repeat} フロア分）` : ''}`,
        };
        reroute(fl); // 位置をそろえた機器で引き直す
        fl.auto = copyDevices(lf.devices);
        // 保存した編集は、機器の一覧（以前の形）か { devices, routes }
        const e = edits?.[fl.key];
        const saved = restoreDevices(Array.isArray(e) ? e : e?.devices, fl);
        if (saved) {
          lf.devices = saved;
          fl.routeEdits = restoreRoutes(e?.routes, fl);
          fl.shortest = Array.isArray(e?.shortest) ? Layout.SYSTEM_ORDER.filter(x => e.shortest.includes(x)) : [];
          fl.edited = true;
          reroute(fl);
        }
        state.floors.push(fl);
      });
    });
    if (!state.floors.length) { card.hidden = true; return; }
    card.hidden = false;
    $('#wiring-drawings').innerHTML = state.floors.map(figureMarkup).join('');
    updateSymbolSizes();
    renderPalette();
    refreshSummary();
  }

  // PC では、表示している図の幅から倍率を求め、記号が画面上で凡例の PC_SYMBOL_SCALE 倍になるようにする。
  // スマホ（と幅を測れないとき）は、画像の大きさに合わせた元の大きさ（fl.s）のまま。
  function updateSymbolSizes() {
    state.floors.forEach((fl, fi) => {
      const w = document.querySelector(`#wiring-drawings figure[data-fi="${fi}"] svg`)?.clientWidth;
      const sym = !PHONE.matches && w ? LEGEND_S * PC_SYMBOL_SCALE * (fl.view.x1 - fl.view.x0) / w : fl.s;
      if (Math.abs(sym - (fl.sym || 0)) < 0.01) return;
      fl.sym = sym;
      drawOverlay(fi);
    });
  }
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.floors.length && !state.drag) updateSymbolSizes(); }, 150);
  });

  // 凡例・階ごとの内訳・概算・表示切替の数を、今の機器と配線から作り直す
  function refreshSummary() {
    const laid = state.floors.map(f => f.lf);
    const { drawing, overheadRate, yen } = state;

    const totalOf = sys => laid.reduce((sum, f) => sum + f.devices.filter(d => d.system === sys).length * f.repeat, 0);
    $('#layer-toggles').innerHTML = defs.systems.map(sys => {
      const st = SYSTEM_STYLE[sys.key];
      return `<label class="layer-toggle"><input type="checkbox" data-system="${sys.key}"${state.hidden.has(sys.key) ? '' : ' checked'}>
        <svg viewBox="0 0 28 8" aria-hidden="true"><line x1="1" y1="4" x2="27" y2="4" stroke="${st.color}" stroke-width="3"${dashOf(st, 3)}/></svg>
        ${esc(sys.label)}（${totalOf(sys.key)}）</label>`;
    }).join('') + `<label class="layer-toggle"><input type="checkbox" data-system="rooms"${state.hidden.has('rooms') ? '' : ' checked'}>
      <svg viewBox="0 0 28 8" aria-hidden="true"><rect x="1" y="1" width="26" height="6" fill="none" stroke="#7a7f88" stroke-dasharray="3 2"/></svg>AI が認識した室の範囲</label>`;

    const est = estimate(laid, drawing, overheadRate);

    // 凡例（記号・名称・系統・数量）
    const sysLabel = Object.fromEntries(defs.systems.map(s => [s.key, s.label]));
    $('#wiring-legend tbody').innerHTML = defs.deviceTypes.map(t => (est.counts[t.key]
      ? `<tr><td>${symbolSvg(t.key, t.system)}</td><td>${esc(t.label)}</td><td>${esc(sysLabel[t.system])}</td><td class="num">${est.counts[t.key]} ${esc(t.unit)}</td></tr>` : '')).join('')
      || '<tr><td colspan="4">機器は配置されていません</td></tr>';

    // 階ごとの内訳
    const lenOf = f => Object.values(f.lengthBySystem).reduce((a, b) => a + b, 0) * WIRING_ALLOWANCE;
    $('#wiring-floors tbody').innerHTML = laid.map(f => `<tr><td>${esc(f.name)}</td><td>図面${f.image}</td><td class="num">${f.repeat}</td>
      <td class="num">${f.devices.length}</td><td class="num">${f.mPerPx ? `${(Math.round(lenOf(f) * 10) / 10).toLocaleString('ja-JP')} m` : '-'}</td>
      <td class="num">${f.amount.toLocaleString('ja-JP')}</td><td class="num">${(f.amount * f.repeat).toLocaleString('ja-JP')}</td></tr>`).join('');

    // 概算
    const cell = v => (v ? v.toLocaleString('ja-JP') : '-');
    $('#wiring-estimate tbody').innerHTML = est.rows.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${r.qty.toLocaleString('ja-JP')}</td><td>${esc(r.unit)}</td>
      <td class="num">${cell(r.material)}</td><td class="num">${cell(r.labor)}</td><td class="num">${r.amount.toLocaleString('ja-JP')}</td></tr>`).join('') +
      `<tr class="sum"><td colspan="5">直接工事費（図面の範囲）</td><td class="num">${est.direct.toLocaleString('ja-JP')}</td></tr>`;
    const floorCount = laid.reduce((a, f) => a + f.repeat, 0);
    $('#wiring-totals').innerHTML = `
      <div class="total-main"><span>配線図面の概算（税抜・${floorCount} フロア分）</span><strong>${yen(est.total)}</strong></div>
      <div><span>直接工事費</span><span>${yen(est.direct)}</span></div>
      <div><span>現場管理費・諸経費（${Math.round(overheadRate * 1000) / 10}%）</span><span>${yen(est.overhead)}</span></div>`;

    const noScale = laid.filter(f => !f.mPerPx).map(f => f.name);
    const noPrice = est.rows.filter(r => !r.material && !r.labor).map(r => r.name);
    $('#wiring-note').textContent = [
      `※ 機器の位置・配線ルートは、AI が読み取った室の範囲と機器の数をもとにアプリが並べた配置例です（「機器を編集する」で機器の追加・移動・削除と、配線ルートの変更ができます）。同じ系統の配線が重なった部分は1本として長さを数えます。配線長は、建物外形の横方向の実寸から縮尺を求め、図面上の長さ×${WIRING_ALLOWANCE}（立上り・余長）で計算しています。`,
      noScale.length ? `${noScale.join('・')} は実寸が分からないため配線の金額を含みません（図面の「1フロアの横方向の実寸」を入れて生成し直してください）。` : '',
      noPrice.length ? `${noPrice.join('・')} は AI の回答に単価が無いため 0 円で計算しています。` : '',
    ].join('');
  }

  // 編集した階の機器の配置を保存用の形（階ごとの [種類, x, y] の一覧）にして渡す
  function saveEdits() {
    const edits = {};
    for (const fl of state.floors) {
      if (!fl.edited) continue;
      const devices = fl.lf.devices.map(d => [d.type, round1(d.p[0]), round1(d.p[1])]);
      edits[fl.key] = Object.keys(fl.routeEdits).length || fl.shortest.length ? { devices, routes: fl.routeEdits, shortest: fl.shortest } : devices;
    }
    state.onEdit(Object.keys(edits).length ? edits : null);
  }

  // 編集を確定する（配線を引き直し、図・表・保存を更新する）
  function commit(fi) {
    reroute(state.floors[fi]);
    drawOverlay(fi);
    refreshSummary();
    saveEdits();
    updateEditBar();
  }
  function pushHistory(fi) {
    const fl = state.floors[fi];
    state.history.push({ fi, devices: copyDevices(fl.lf.devices), routeEdits: { ...fl.routeEdits }, shortest: [...fl.shortest], edited: fl.edited });
    if (state.history.length > MAX_HISTORY) state.history.shift();
    fl.edited = true;
  }

  function select(sel) {
    const before = state.selected?.fi;
    state.selected = sel;
    if (before != null) drawOverlay(before);
    if (sel && sel.fi !== before) drawOverlay(sel.fi);
    updateEditBar();
  }
  // 選んだ機器を削除する。配線を選んでいるときは、その配線を自動のルートに戻す。
  function removeSelected() {
    const sel = state.selected;
    const fl = sel && state.floors[sel.fi];
    if (sel?.route) {
      if (!fl.routeEdits[sel.route]) return;
      pushHistory(sel.fi);
      delete fl.routeEdits[sel.route];
      commit(sel.fi);
      return;
    }
    const d = fl?.lf.devices[sel.di];
    if (!d || d.type === 'panel') return;
    pushHistory(sel.fi);
    fl.lf.devices.splice(sel.di, 1);
    state.selected = null;
    commit(sel.fi);
  }
  function undo() {
    const h = state.history.pop();
    if (!h) return;
    if (h.multi) {
      for (const m of h.multi) {
        const fl = state.floors[m.fi];
        Object.assign(fl, { routeEdits: m.routeEdits, shortest: m.shortest, edited: m.edited });
        fl.lf.devices = m.devices;
      }
      state.selected = null;
      h.multi.forEach(m => { reroute(state.floors[m.fi]); drawOverlay(m.fi); });
      refreshSummary();
      saveEdits();
      updateEditBar();
      return;
    }
    const fl = state.floors[h.fi];
    fl.lf.devices = h.devices;
    fl.routeEdits = h.routeEdits;
    fl.shortest = h.shortest;
    fl.edited = h.edited;
    state.selected = null;
    commit(h.fi);
  }
  function resetAll() {
    if (!state.floors.some(f => f.edited)) return;
    if (!confirm('編集した機器の配置と配線ルートをすべて取り消して、自動配置に戻しますか？')) return;
    state.floors.forEach(fl => {
      fl.lf.devices = copyDevices(fl.auto);
      fl.routeEdits = {};
      fl.shortest = [];
      fl.edited = false;
      reroute(fl);
    });
    state.history = [];
    state.selected = null;
    state.floors.forEach((_, fi) => drawOverlay(fi));
    refreshSummary();
    saveEdits();
    updateEditBar();
  }

  // 「最短ルートで結ぶ」の対象（配線か機器を選んでいればその階のその系統、何も選んでいなければすべての階のすべての系統）
  function shortestTarget() {
    const sel = state.selected;
    const fl = sel && state.floors[sel.fi];
    const sys = sel?.route ? fl?.lf.routes.find(r => r.key === sel.route)?.system : fl?.lf.devices[sel.di]?.type !== 'panel' && fl?.lf.devices[sel.di]?.system;
    const list = sys ? [{ fi: sel.fi, systems: [sys] }] : state.floors.map((_, fi) => ({ fi, systems: [...Layout.SYSTEM_ORDER] }));
    const on = list.every(t => t.systems.every(x => state.floors[t.fi].shortest.includes(x)));
    return { list, on, label: sys ? `${defs.systems.find(x => x.key === sys)?.label || ''}・${fl.lf.name}` : 'すべての系統' };
  }
  // 最短ルートで結ぶ／標準のルート（室ごとに廊下を通る）に戻す。切り替えた系統の手直しした配線は捨てる。
  function toggleShortest() {
    const { list, on } = shortestTarget();
    state.history.push({ multi: list.map(t => { const fl = state.floors[t.fi]; return { fi: t.fi, devices: copyDevices(fl.lf.devices), routeEdits: { ...fl.routeEdits }, shortest: [...fl.shortest], edited: fl.edited }; }) });
    if (state.history.length > MAX_HISTORY) state.history.shift();
    for (const t of list) {
      const fl = state.floors[t.fi];
      fl.shortest = on ? fl.shortest.filter(x => !t.systems.includes(x)) : Layout.SYSTEM_ORDER.filter(x => fl.shortest.includes(x) || t.systems.includes(x));
      for (const key of Object.keys(fl.routeEdits)) if (t.systems.includes(key.split('|')[0])) delete fl.routeEdits[key];
      fl.edited = true;
      reroute(fl);
    }
    if (state.selected?.route) state.selected = null; // 配線の番号が変わるので選択を外す
    state.floors.forEach((_, fi) => drawOverlay(fi));
    refreshSummary();
    saveEdits();
    updateEditBar();
  }

  // 編集の道具（選択・移動 と、追加する機器の種類）
  function renderPalette() {
    const tool = (key, inner, title) => `<button type="button" class="tool" data-tool="${key}" aria-pressed="${state.tool === key}" title="${esc(title)}">${inner}</button>`;
    $('#edit-palette').innerHTML = `<div class="tool-group"><span class="tool-group-label">操作</span>${tool('select', '<span>選択・移動</span>', '機器や配線を選んでドラッグで移動')}</div>` +
      defs.systems.map(sys => `<div class="tool-group"><span class="tool-group-label">${esc(sys.label)}</span>${defs.deviceTypes
        .filter(t => t.system === sys.key && t.key !== 'panel') // 分電盤は各階1つ（移動だけできる）
        .map(t => tool(t.key, `${symbolSvg(t.key, t.system)}<span>${esc(shortLabel(t))}</span>`, `${t.label}を追加（図面をクリック）`)).join('')}</div>`).join('');
  }
  function setTool(key) {
    state.tool = key;
    $('#wiring').dataset.tool = key === 'select' ? 'select' : 'add';
    document.querySelectorAll('#edit-palette .tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === key)));
    updateEditBar();
  }
  function setEditing(on) {
    state.editing = on;
    $('#wiring').classList.toggle('editing', on);
    $('#edit-tools').hidden = !on;
    $('#edit-toggle').hidden = on; // 編集中は、編集エリアの下の「編集を反映する」で閉じる
    if (!on && state.selected) select(null);
    setTool('select');
  }
  function updateEditBar() {
    const sel = state.selected;
    const fl = sel && state.floors[sel.fi];
    const d = sel && !sel.route && fl?.lf.devices[sel.di];
    const r = sel?.route && fl?.lf.routes.find(x => x.key === sel.route);
    $('#edit-delete').textContent = r ? '選んだ配線を自動のルートに戻す' : '選んだ機器を削除';
    $('#edit-delete').disabled = r ? !r.edited : !d || d.type === 'panel';
    $('#edit-undo').disabled = !state.history.length;
    $('#edit-reset').disabled = !state.floors.some(f => f.edited);
    const st = shortestTarget();
    $('#edit-shortest').textContent = st.on ? `標準のルートに戻す（${st.label}）` : `最短ルートで結ぶ（${st.label}）`;
    $('#edit-shortest').disabled = !state.floors.length;
    const t = state.tool !== 'select' && typeOf(state.tool);
    $('#edit-status').textContent = t
      ? `「${t.label}」を追加します。図面の置きたい場所をクリックしてください（Esc で選択・移動に戻る）。`
      : r
        ? `選択中: ${defs.systems.find(x => x.key === r.system)?.label || ''}の配線（${fl.lf.name}${r.room ? ` ${r.room}` : ''}）。線をドラッグするとその区間を平行に、□の角をドラッグすると曲がる位置を動かせます。同じ系統の配線や機器の近くに寄せると吸着し、重なった部分は1本として長さを数えます${r.edited ? '（Delete キーで自動のルートに戻す）' : ''}。機器や分電盤を動かすと、その配線は自動のルートに戻ります。`
        : d
        ? `選択中: ${typeOf(d.type).label}（${state.floors[sel.fi].lf.name}${d.room ? ` ${d.room}` : ''}）${d.type === 'panel' ? '。分電盤は移動だけできます。' : '。ドラッグで移動、Delete キーで削除できます。'}`
        : '機器や配線をクリックして選び、ドラッグで移動できます（配線は線で区間を平行に、角で曲がる位置を動かす）。「最短ルートで結ぶ」で、同じ系統の機器を分電盤から短くまとめた配線にできます。追加するときは下の一覧から機器を選んでください。';
  }

  // 配線を動かすときの吸着先: 同じ系統のほかの配線の線（横の線は y、縦の線は x）と、同じ系統の機器・分電盤の位置
  function snapTargets(fl, rt) {
    const xs = [], ys = [];
    for (const r of fl.lf.routes) {
      if (r.system !== rt.system || r.key === rt.key) continue;
      r.points.slice(1).forEach((b, i) => {
        const a = r.points[i];
        if (a[1] === b[1]) ys.push({ v: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) });
        else xs.push({ v: a[0], lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]) });
      });
    }
    for (const dv of fl.lf.devices) {
      if (dv.system !== rt.system && dv.type !== 'panel') continue;
      ys.push({ v: dv.p[1], lo: dv.p[0], hi: dv.p[0] });
      xs.push({ v: dv.p[0], lo: dv.p[1], hi: dv.p[1] });
    }
    return { xs, ys };
  }
  // v に一番近い吸着先（[lo, hi] の範囲で重なるもの、tol 以内）があればその値、無ければ v のまま
  function snapTo(v, list, lo, hi, tol) {
    let best = v, bestD = tol;
    for (const c of list) {
      const dd = Math.abs(c.v - v);
      if (dd <= bestD && c.hi >= lo - tol && c.lo <= hi + tol) { best = c.v; bestD = dd; }
    }
    return best;
  }

  // 画面上の位置を SVG の座標（元の画像の px）にする
  function svgPoint(svg, e) {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  const area = $('#wiring-drawings');
  area.addEventListener('pointerdown', e => {
    if (!state.editing || e.button > 0) return;
    const fig = e.target.closest('figure[data-fi]');
    const svg = fig?.querySelector('svg');
    if (!svg) return;
    const fi = Number(fig.dataset.fi);
    const fl = state.floors[fi];
    const pt = clampInto(svgPoint(svg, e), fl.view);
    e.preventDefault();
    if (state.tool === 'select') {
      const g = e.target.closest('.device');
      const line = !g && e.target.closest('.route-hit, .corner-handle');
      if (line) {
        // 配線をつかんだ: 途中の機器の点で区間を分ける。角の近くなら角を、そうでなければ一番近い区間を動かす
        const rt = fl.lf.routes.find(r => r.key === line.dataset.route);
        if (!rt) return;
        const pins = fl.lf.devices.map(x => x.p);
        const base = Layout.insertPins(rt.points, pins);
        const near = (fl.sym || fl.s) * 0.9;
        const pinned = p => pins.some(q => Math.abs(q[0] - p[0]) <= 0.2 && Math.abs(q[1] - p[1]) <= 0.2);
        let j = -1;
        base.forEach((p, k) => { if (k > 0 && k < base.length - 1 && !pinned(p) && Math.hypot(p[0] - pt[0], p[1] - pt[1]) <= near && (j < 0 || Math.hypot(p[0] - pt[0], p[1] - pt[1]) < Math.hypot(base[j][0] - pt[0], base[j][1] - pt[1]))) j = k; });
        const i = j < 0 ? Layout.nearestSegment(base, pt) : -1;
        select({ fi, route: rt.key });
        if (j < 0 && i < 0) return;
        state.drag = { fi, route: rt.key, system: rt.system, sig: rt.sig, base, i, j, pins, svg, start: pt, moved: false, frame: 0, targets: snapTargets(fl, rt) };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (!g) { select(null); return; }
      const di = Number(g.dataset.di);
      select({ fi, di });
      state.drag = { fi, di, svg, start: pt, orig: [...fl.lf.devices[di].p], moved: false, frame: 0 };
      svg.setPointerCapture(e.pointerId);
    } else {
      pushHistory(fi);
      fl.lf.devices.push(makeDevice(fl, state.tool, pt));
      state.selected = { fi, di: fl.lf.devices.length - 1 };
      commit(fi);
    }
  });
  area.addEventListener('pointermove', e => {
    const d = state.drag;
    if (!d) return;
    const fl = state.floors[d.fi];
    const pt = svgPoint(d.svg, e);
    const dx = pt[0] - d.start[0], dy = pt[1] - d.start[1];
    if (!d.moved) {
      if (Math.hypot(dx, dy) < fl.s * 0.3) return; // クリックしただけのときは動かさない
      pushHistory(d.fi);
      d.moved = true;
    }
    if (d.route) {
      const tol = (fl.sym || fl.s) * 0.9;
      const lim = (v, axis) => (axis ? Math.min(fl.view.y1, Math.max(fl.view.y0, v)) : Math.min(fl.view.x1, Math.max(fl.view.x0, v)));
      if (d.j >= 0) {
        // 角を動かす。縦横それぞれ、近くの同じ系統の線・機器の位置に吸着する
        const c = d.base[d.j], a = d.base[d.j - 1], b = d.base[d.j + 1];
        const hn = a[1] === c[1] ? a : b, vn = a[0] === c[0] ? a : b; // 角から横に続く点・縦に続く点
        let x = lim(c[0] + dx, 0), y = lim(c[1] + dy, 1);
        x = snapTo(x, d.targets.xs, Math.min(y, vn[1]), Math.max(y, vn[1]), tol);
        y = snapTo(y, d.targets.ys, Math.min(x, hn[0]), Math.max(x, hn[0]), tol);
        fl.routeEdits[d.route] = { sig: d.sig, points: Layout.moveCorner(d.base, d.j, round1(x - c[0]), round1(y - c[1]), d.pins) };
      } else {
        // 横の線は上下に、縦の線は左右に動かす（表示範囲の外には出さない）。近くの同じ系統の線・機器の位置に吸着する
        const a = d.base[d.i], b = d.base[d.i + 1];
        const axis = a[1] === b[1] ? 1 : 0;
        const along = axis ? 0 : 1;
        const v = snapTo(lim(a[axis] + (axis ? dy : dx), axis), axis ? d.targets.ys : d.targets.xs, Math.min(a[along], b[along]), Math.max(a[along], b[along]), tol);
        fl.routeEdits[d.route] = { sig: d.sig, points: Layout.moveSegment(d.base, d.i, round1(v - a[axis]), d.pins) };
      }
    } else {
      const dev = fl.lf.devices[d.di];
      Object.assign(dev, makeDevice(fl, dev.type, clampInto([d.orig[0] + dx, d.orig[1] + dy], fl.view)));
    }
    // 動かしている間も配線を引き直して見せる（1フレームに1回）
    if (!d.frame) d.frame = requestAnimationFrame(() => { d.frame = 0; reroute(fl); drawOverlay(d.fi); });
  });
  const endDrag = () => {
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    if (d.frame) cancelAnimationFrame(d.frame);
    if (d.moved) commit(d.fi);
  };
  area.addEventListener('pointerup', endDrag);
  area.addEventListener('pointercancel', endDrag);

  document.addEventListener('keydown', e => {
    if (!state.editing || e.target.closest?.('input, select, textarea')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) { e.preventDefault(); removeSelected(); }
    else if (e.key === 'Escape') { setTool('select'); select(null); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });
  $('#edit-toggle').addEventListener('click', () => setEditing(true));
  // 編集はその都度図と概算に反映済みなので、ここでは編集モードを閉じて図面の先頭に戻る
  $('#edit-done').addEventListener('click', () => { setEditing(false); $('#wiring-drawings').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#edit-palette').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('#edit-delete').addEventListener('click', removeSelected);
  $('#edit-undo').addEventListener('click', undo);
  $('#edit-reset').addEventListener('click', resetAll);
  $('#edit-shortest').addEventListener('click', toggleShortest);
  $('#layer-toggles').addEventListener('change', e => {
    const key = e.target.dataset.system;
    if (!key) return;
    if (e.target.checked) state.hidden.delete(key); else state.hidden.add(key);
    document.querySelectorAll(`#wiring-drawings .layer[data-system="${key}"]`).forEach(g => { g.style.display = e.target.checked ? '' : 'none'; });
  });

  // 表示中の配線図面を PNG で保存する（非表示にした系統と、編集用の印は含めない）
  async function download() {
    const figs = [...document.querySelectorAll('#wiring-drawings figure[data-fi]')];
    for (const fig of figs) {
      const svg = fig.querySelector('svg');
      const clone = svg.cloneNode(true);
      clone.querySelectorAll('.sel-ring, .hit, .route-hit, .corner-handle').forEach(n => n.remove());
      const xml = new XMLSerializer().serializeToString(clone);
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(svg.viewBox.baseVal.width);
      canvas.height = Math.round(svg.viewBox.baseVal.height);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const name = state.floors[Number(fig.dataset.fi)]?.lf.name.replace(/[\\/:*?"<>|]/g, '') || '';
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `配線図面例_${new Date().toISOString().slice(0, 10)}${figs.length > 1 ? `_${fig.dataset.fi * 1 + 1}_${name}` : ''}.png`;
      a.click();
    }
  }
  $('#download-drawing').addEventListener('click', () => download().catch(err => alert(`保存できませんでした: ${err.message}`)));

  window.EsdDrawing = { init, get, set, cleanList, describe, payload, render };
})();
