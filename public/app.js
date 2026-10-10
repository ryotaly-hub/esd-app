if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

const STORAGE_INPUT = 'esd-app:input';
const STORAGE_RESULT = 'esd-app:result';
const STORAGE_DRAWING = 'esd-app:drawing';
const STORAGE_EDITS = 'esd-app:wiring-edits'; // 配線図面例で編集した機器の配置
const Drawing = window.EsdDrawing;

const $ = sel => document.querySelector(sel);
const form = $('#input-form');
const statusEl = $('#status');
let fieldKeys = []; // フォームの項目（GET /api/options から作る）

/* ---------- 保存（localStorage） ---------- */
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; /* 保存できなくても動かす */ }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* 保存できなくても動かす */ }
}

/* ---------- 入力フォーム ---------- */
function selectHtml(f, emptyLabel) {
  const options = f.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  const empty = emptyLabel == null ? '' : `<option value="">${esc(emptyLabel)}</option>`;
  return `<select name="${esc(f.key)}"${f.required ? ' required' : ''}>${empty}${options}</select>`;
}
const req = f => (f.required ? ' <span class="req">必須</span>' : '');

// 電気設備の4カテゴリの見出しに付けるアイコン（public/img/icon-*.png）
const CATEGORY_ICONS = {
  power_system_input: 'power',
  general_power_lighting: 'lighting',
  elv_system: 'network',
  fire_safety: 'fire',
};

// サーバーの定義からフォームを組み立てる
function buildForm({ building, equipment }) {
  const byKey = Object.fromEntries(building.map(f => [f.key, f]));
  // 建物名はファイル名と見積書にだけ使い、AI には送らない（自由な文をプロンプトに入れないため）
  const html = [`<label class="wide-field"><span class="label-text">建物名<small class="field-note">ファイル名・見積書に使います（AI には送りません）</small></span>
    <input name="building_name" type="text" maxlength="60" autocomplete="off" placeholder="例: ○○ビル新築工事"></label>`];
  for (const f of building) {
    if (f.key === 'floors_below') continue; // 地上と並べて出す
    if (f.key === 'floors_above') {
      html.push(`<div class="field"><span>階数</span><div class="floors">
        <label>地上 ${selectHtml(f, '選択')}</label>
        <label>地下 ${selectHtml(byKey.floors_below)}</label></div></div>`);
    } else if (f.type === 'number') {
      html.push(`<label><span class="label-text">${esc(f.label)}${req(f)}</span>
        <input name="${esc(f.key)}" type="number" min="${f.min}" max="${f.max}" step="1" inputmode="numeric"${f.required ? ' required' : ''} placeholder="例: 1200"></label>`);
    } else {
      html.push(`<label><span class="label-text">${esc(f.label)}${req(f)}</span> ${selectHtml(f, '選んでください')}</label>`);
    }
  }
  $('#building-fields').innerHTML = html.join('');

  $('#equipment-fields').innerHTML = equipment.map(c => `<fieldset>
      <legend>${CATEGORY_ICONS[c.key] ? `<img class="icon" src="img/icon-${CATEGORY_ICONS[c.key]}.png" alt="" width="36" height="36">` : ''}${esc(c.label)}</legend>
      <div class="grid">${c.items.map(f => `<label>${esc(f.label)} ${selectHtml(f, '未定（標準仕様で補完）')}</label>`).join('')}</div>
    </fieldset>`).join('');

  fieldKeys = [...building, ...equipment.flatMap(c => c.items)].map(f => f.key);
}

function getValues() {
  const values = {};
  for (const key of fieldKeys) values[key] = form.elements[key]?.value ?? '';
  return values;
}
function setValues(values) {
  for (const key of fieldKeys) {
    if (form.elements[key] && values?.[key] != null) form.elements[key].value = values[key];
  }
  if (values?.use_search != null) form.elements.use_search.checked = values.use_search;
  form.elements.building_name.value = String(values?.building_name ?? '').slice(0, 60);
}
const buildingName = () => form.elements.building_name.value.trim();
const useSearch = () => form.elements.use_search.checked;

async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `エラー (${r.status})`);
  return data;
}

// プロンプトはサーバーで組み立てる（画面ではプレビューを受け取るだけ）
let previewTimer;
function updatePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const { prompt } = await postJson('api/prompt', { values: getValues(), useSearch: useSearch(), drawings: Drawing.describe() });
      $('#prompt-preview').textContent = prompt;
    } catch (err) {
      $('#prompt-preview').textContent = `プレビューを取得できませんでした: ${err.message}`;
    }
  }, 250);
}

form.addEventListener('input', () => {
  updatePreview();
  save(STORAGE_INPUT, inputState());
});
const inputState = () => ({ ...getValues(), use_search: useSearch(), building_name: buildingName() });

$('#copy-prompt').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#prompt-preview').textContent);
    setStatus('プロンプトをコピーしました');
  } catch {
    setStatus('コピーできませんでした', true);
  }
});

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const button = $('#generate');
  button.disabled = true;
  const n = Drawing.get().length;
  setStatus(`${n ? `図面${n}枚の室を読み取ってから、` : ''}${useSearch() ? '価格を検索しながら' : ''}生成中…（${n || useSearch() ? '2〜3分' : '30秒ほど'}かかることがあります）`);
  try {
    const drawingImages = Drawing.get();
    const data = await postJson('api/generate', { values: getValues(), useSearch: useSearch(), drawings: Drawing.payload() });
    showResult(data.text, data.values, { sources: data.sources, drawingImages, rooms: data.rooms, generatedAt: new Date().toISOString() });
    setStatus(data.sources?.length ? `生成しました（Web の情報源 ${data.sources.length} 件を参照）` : '生成しました');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    button.disabled = false;
  }
});

// API を使わない場合の欄（プロンプトのコピーと回答の貼り付け）を開閉する
$('#no-api-toggle').addEventListener('click', e => {
  const open = $('#no-api').hidden;
  $('#no-api').hidden = !open;
  e.currentTarget.setAttribute('aria-expanded', String(open));
});

$('#paste-apply').addEventListener('click', () => {
  const text = $('#paste-text').value.trim();
  if (!text) return setStatus('回答を貼り付けてください', true);
  showResult(text, getValues(), { drawingImages: Drawing.get(), generatedAt: new Date().toISOString() });
  setStatus('貼り付けた回答を表示しました');
});

/* ---------- 回答の分解（Markdown ＋ 末尾の JSON） ---------- */
function splitResponse(text) {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/gi)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const data = JSON.parse(blocks[i][1]);
      if (Array.isArray(data?.categories)) {
        const m = blocks[i];
        return { markdown: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(), data };
      }
    } catch { /* 次の候補へ */ }
  }
  return { markdown: text, data: null };
}

const num = v => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,，円¥\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// 合計は AI の値をそのまま信じず、資材費＋労務費から計算し直す（どちらも無い行は subtotal を使う）
function normalizeEstimate(data, values) {
  const isSet = v => v != null && String(v).trim() !== '' && String(v).trim() !== '-';
  const categories = data.categories.map(c => {
    const hasSplit = isSet(c.material_cost) || isSet(c.labor_cost);
    const material = hasSplit ? num(c.material_cost) : null;
    const labor = hasSplit ? num(c.labor_cost) : null;
    return {
      name: String(c.name || 'その他'), mainItems: String(c.main_items || ''), quantity: String(c.quantity || ''),
      material, labor, amount: hasSplit ? material + labor : num(c.subtotal),
    };
  });
  const direct = categories.reduce((s, c) => s + c.amount, 0);
  let overheadRate = num(data.overhead_rate);
  if (overheadRate > 1) overheadRate /= 100; // 18 のように % で返ってきた場合
  if (!(overheadRate > 0)) overheadRate = 0.18;
  const overhead = Math.round(direct * overheadRate);
  const total = direct + overhead;
  const area = num(values.floor_area);
  return {
    categories, direct, overheadRate, overhead, total,
    perArea: area > 0 ? Math.round(total / area) : null,
    tax: Math.round(total * 0.1),
    notes: Array.isArray(data.notes) ? data.notes.map(String) : [],
  };
}

/* ---------- Markdown の簡易表示 ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
  .replace(/&lt;br\s*\/?&gt;/gi, '<br>');

function renderMarkdown(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const splitRow = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = Math.min(line.match(/^#+/)[0].length + 1, 6); // 画面の h1/h2 より下にする
      html.push(`<h${level}>${inline(line.replace(/^#+\s*/, ''))}</h${level}>`);
      i++;
    } else if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(line);
      const rows = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(splitRow(lines[i]));
      html.push('<div class="table-wrap"><table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
    } else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      for (; i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i]); i++) {
        const indent = lines[i].match(/^\s*/)[0].length;
        items.push(`<li${indent >= 2 ? ' class="nested"' : ''}>${inline(lines[i].replace(/^\s*([-*+]|\d+\.)\s/, ''))}</li>`);
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.join('')}</${tag}>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      html.push('<hr>');
      i++;
    } else if (line.trim() === '') {
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|\s*\||\s*([-*+]|\d+\.)\s)/.test(lines[i]); i++) {
        para.push(inline(lines[i].replace(/^>\s?/, '')));
      }
      html.push(`<p>${para.join('<br>')}</p>`);
    }
  }
  return html.join('\n');
}

// 大見出し（「1. 施工図面作成ガイド」など）ごとに、押すと開く欄（details）にまとめる。
// AI の回答は見出しの書き方が揃わない（「# 1.」と「## 2.」が混ざる、太字の行「**1. …**」で書くなど）ので、
// 番号の付いた見出しを 1 → 2 → 3 … の順にたどって区切る（同じ番号が複数あれば浅い階層の方）。
// 番号の見出しが2つ未満なら、2回以上出てくる一番上の階層の見出しで区切る。
const headingOf = line => {
  const m = line.match(/^(#{1,6})\s+(.*)$/);
  if (m) return { level: m[1].length, text: m[2].trim() };
  const b = line.match(/^\s*\*\*(\d+\s*[.．][^*]+)\*\*\s*$/); // 太字だけの行（「**1. 施工図面作成ガイド**」）
  return b ? { level: 7, text: b[1].trim() } : null;
};
const sectionNo = text => {
  const m = text.replace(/\*\*/g, '').match(/^(\d+)\s*[.．]\s*\S/);
  return m ? Number(m[1]) : null;
};
function sectionStarts(lines) {
  let inCode = false;
  const heads = [];
  lines.forEach((l, i) => {
    if (/^```/.test(l)) { inCode = !inCode; return; }
    const h = !inCode && headingOf(l);
    if (h) heads.push({ i, ...h, no: sectionNo(h.text) });
  });
  const picked = [];
  for (let n = 1, after = -1; ; n++) {
    const cands = heads.filter(h => h.no === n && h.i > after);
    if (!cands.length) break;
    const best = cands.reduce((a, b) => (b.level < a.level ? b : a));
    picked.push(best);
    after = best.i;
  }
  if (picked.length >= 2) return picked;
  const levels = [...new Set(heads.filter(h => h.level <= 6).map(h => h.level))].sort((a, b) => a - b);
  const level = levels.find(lv => heads.filter(h => h.level === lv).length >= 2);
  return level ? heads.filter(h => h.level === level) : [];
}
function renderSections(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const starts = sectionStarts(lines);
  if (!starts.length) return renderMarkdown(md);
  const intro = lines.slice(0, starts[0].i).join('\n').trim();
  return (intro ? renderMarkdown(intro) : '') + starts.map((h, k) => {
    const body = lines.slice(h.i + 1, starts[k + 1]?.i ?? lines.length).join('\n');
    return `<details class="md-section"><summary><span>${inline(h.text.replace(/^\*\*(.*)\*\*$/, '$1'))}</span></summary>
      <div class="md-body">${renderMarkdown(body)}</div></details>`;
  }).join('');
}

/* ---------- 見積の表示 ---------- */
function formatFloors(values) {
  const above = Number(values.floors_above) || 0;
  const below = Number(values.floors_below) || 0;
  if (!above) return '';
  if (!below) return above === 1 ? '平屋建て' : `地上${above}階建て`;
  return `地上${above}階・地下${below}階建て`;
}

const yen = n => `${Math.round(n).toLocaleString('ja-JP')} 円`;
const man = n => `${(n / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })} 万円`;

function renderEstimate(est, values) {
  // 見積書には建物概要だけ載せる（4カテゴリの自由記述は長くなるため）
  const overview = [
    ['建物用途', values.building_type],
    ['構造', values.structure],
    ['階数', formatFloors(values)],
    ['延床面積（㎡）', values.floor_area],
  ];
  $('#estimate-conditions').innerHTML = overview
    .filter(([, v]) => String(v ?? '').trim() !== '')
    .map(([label, v]) => `<div><dt>${esc(label)}</dt><dd>${esc(v)}</dd></div>`).join('');

  const pct = r => `${Math.round(r * 1000) / 10}%`;
  $('#totals').innerHTML = `
    <div class="total-main"><span>総合計（税抜）</span><strong>${yen(est.total)}</strong></div>
    <div><span>直接工事費合計</span><span>${yen(est.direct)}</span></div>
    <div><span>現場管理費・諸経費（${pct(est.overheadRate)}）</span><span>${yen(est.overhead)}</span></div>
    ${est.perArea != null ? `<div><span>1㎡あたりの電気設備工事単価目安</span><span>約 ${yen(est.perArea)} / ㎡</span></div>` : ''}
    <div class="sub"><span>参考: 消費税（10%）込み</span><span>${yen(est.total + est.tax)}</span></div>`;

  const cell = v => (v == null ? '-' : v.toLocaleString('ja-JP'));
  $('#estimate-table tbody').innerHTML = est.categories.map(c => `<tr>
      <td>${esc(c.name)}</td><td>${esc(c.mainItems)}</td><td>${esc(c.quantity)}</td>
      <td class="num">${cell(c.material)}</td><td class="num">${cell(c.labor)}</td>
      <td class="num">${cell(c.amount)}</td></tr>`).join('') +
    `<tr class="sum"><td colspan="5">直接工事費合計</td><td class="num">${cell(est.direct)}</td></tr>`;

  $('#estimate-notes').innerHTML = est.notes.map(n => `<li>${esc(n)}</li>`).join('');
  renderChart(est.categories, est.direct);
}

let lastChart = null;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => lastChart && !$('#estimate').hidden && renderChart(...lastChart), 150);
});

// 工種別の金額を横棒グラフで描く（1系列なので凡例なし。値は棒の先に表示、詳細はホバーで）
function renderChart(categories, subtotal, width) {
  const el = $('#chart');
  const rows = categories.map(c => ({ ...c, name: c.name.replace(/^\d+\.\s*/, '') })); // 分類の順のまま並べる
  // 画面幅に合わせて描く（viewBox で縮めると文字が小さくなりすぎるため）
  const W = width || Math.max(300, Math.round(el.clientWidth) || 640);
  const narrow = W < 480;
  const labelW = narrow ? 104 : 150, valueW = narrow ? 70 : 90, rowH = 34, barH = 20, top = 4;
  const plotW = W - labelW - valueW;
  const max = Math.max(...rows.map(r => r.amount), 1);
  const H = top + rows.length * rowH;
  const maxChars = narrow ? 7 : 10;
  const short = s => (s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s);

  const bars = rows.map((r, i) => {
    const y = top + i * rowH;
    const by = y + (rowH - barH) / 2;
    const w = Math.max(0, (r.amount / max) * plotW);
    const rad = Math.min(4, w, barH / 2);
    // 先端だけ角丸、基線側は四角
    const d = w <= 0 ? '' : `M${labelW},${by} h${w - rad} a${rad},${rad} 0 0 1 ${rad},${rad} v${barH - 2 * rad} a${rad},${rad} 0 0 1 ${-rad},${rad} h${-(w - rad)} z`;
    const share = subtotal ? Math.round((r.amount / subtotal) * 1000) / 10 : 0;
    return `<g class="bar" data-tip="${esc(`${r.name}\n${yen(r.amount)}（${share}%）`)}">
      <rect class="hit" x="0" y="${y}" width="${W}" height="${rowH}"></rect>
      <text class="label" x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="middle">${esc(short(r.name))}</text>
      ${d ? `<path class="mark" d="${d}"></path>` : ''}
      <text class="value" x="${labelW + w + 6}" y="${y + rowH / 2}" dominant-baseline="middle">${man(r.amount)}</text>
    </g>`;
  }).join('');

  lastChart = [categories, subtotal];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="工種別の金額（詳細は下の内訳表）">
    ${bars}
    <line class="baseline" x1="${labelW}" x2="${labelW}" y1="0" y2="${H}"></line>
  </svg>`;
}

const tooltip = $('#tooltip');
$('#chart').addEventListener('pointermove', e => {
  const g = e.target.closest('.bar');
  document.querySelectorAll('#chart .bar.active').forEach(b => b !== g && b.classList.remove('active'));
  if (!g) { tooltip.hidden = true; return; }
  g.classList.add('active');
  tooltip.textContent = g.dataset.tip;
  tooltip.hidden = false;
  const x = Math.min(e.clientX + 12, window.innerWidth - tooltip.offsetWidth - 8);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${e.clientY + 12}px`;
});
$('#chart').addEventListener('pointerleave', () => {
  tooltip.hidden = true;
  document.querySelectorAll('#chart .bar.active').forEach(b => b.classList.remove('active'));
});

/* ---------- 結果の表示・PDF ---------- */
// Web 検索で参照した情報源を一覧にする
function renderSources(sources) {
  const list = (sources || []).filter(s => /^https?:\/\//.test(s.uri));
  $('#sources').hidden = list.length === 0;
  $('#source-list').innerHTML = list
    .map(s => `<li><a href="${esc(s.uri)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('');
}

// 表示中の結果と、配線図面例の編集（ファイルに保存するときに使う）
let current = null;
let currentEdits = null;

// edits を渡したとき（ファイルを開いたとき）はその編集を使う。渡さないときは、復元なら保存済みの編集、新しい結果なら編集なし。
function showResult(text, values, { sources = [], drawingImages = [], rooms = [], generatedAt = null, restoring = false, edits } = {}) {
  const { markdown, data } = splitResponse(text);
  current = { text, values, sources, drawingImages, rooms, generatedAt };
  currentEdits = edits !== undefined ? edits : restoring ? load(STORAGE_EDITS) : null;
  $('#save-file').disabled = false;
  $('#save-file').removeAttribute('title');
  $('#result').hidden = false;
  $('#markdown').innerHTML = renderSections(markdown);

  const jsonError = $('#json-error');
  if (data) {
    $('#estimate').hidden = false; // 先に表示してからグラフの幅を測る
    const est = normalizeEstimate(data, values);
    renderEstimate(est, values);
    renderSources(sources);
    if (!restoring) { if (currentEdits) save(STORAGE_EDITS, currentEdits); else remove(STORAGE_EDITS); }
    Drawing.render(data.drawing, drawingImages, {
      rooms, overheadRate: est.overheadRate, yen,
      edits: currentEdits,
      onEdit: e => { currentEdits = e; if (e) save(STORAGE_EDITS, e); else remove(STORAGE_EDITS); },
    });
    jsonError.hidden = true;
  } else {
    $('#estimate').hidden = true;
    $('#wiring').hidden = true;
    jsonError.textContent = '回答の末尾に見積データ（JSON）が見つからなかったため、グラフと見積書は表示できません。もう一度生成してください。';
    jsonError.hidden = false;
  }
  if (restoring) return;
  // 図面の画像が大きくて保存しきれないときは、画像なしで保存する（次回は配線図面例を出さない）
  if (!save(STORAGE_RESULT, current)) save(STORAGE_RESULT, { text, values, sources, generatedAt });
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#print-pdf').addEventListener('click', () => {
  $('#print-meta').textContent = [buildingName() && `建物名: ${buildingName()}`, `作成日: ${new Date().toLocaleDateString('ja-JP')}`].filter(Boolean).join('　');
  window.print(); // 印刷画面で「PDFに保存」を選ぶ
});

// 印刷時は A4 の幅に合わせて描き直し、終わったら画面の幅に戻す
window.addEventListener('beforeprint', () => lastChart && renderChart(...lastChart.slice(0, 2), 680));
window.addEventListener('afterprint', () => lastChart && renderChart(...lastChart.slice(0, 2)));

/* ---------- 起動時 ---------- */
(async function start() {
  try {
    const r = await fetch('api/options');
    if (!r.ok) throw new Error(`エラー (${r.status})`);
    const options = await r.json();
    buildForm(options);
    Drawing.init(options.drawing, {
      saved: load(STORAGE_DRAWING),
      onChange: () => {
        updatePreview();
        if (!save(STORAGE_DRAWING, Drawing.get())) setStatus('図面が大きいため、次回のために保存できませんでした（このまま生成はできます）');
      },
      onError: msg => setStatus(msg, true),
    });
  } catch (err) {
    setStatus(`入力項目を読み込めませんでした: ${err.message}`, true);
    return;
  }
  setValues(load(STORAGE_INPUT));
  updatePreview();
  const last = load(STORAGE_RESULT);
  if (last?.text) showResult(last.text, last.values || {}, { sources: last.sources, drawingImages: last.drawingImages, rooms: last.rooms, generatedAt: last.generatedAt, restoring: true });
})();

/* ---------- ファイルに保存・ファイルを開く・リセット ---------- */
const FILE_FORMAT = 'esd-app-result';
const FILE_VERSION = 1;
// 冒頭と最下部の両方に出す（押したボタンの近くで分かるように）
const setFileStatus = (text, isError = false) => {
  for (const el of [$('#file-status'), $('#file-status-bottom')]) {
    el.textContent = text;
    el.classList.toggle('error', isError);
  }
};
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ファイル名は「電気設備設計_建物名_生成日.json」（ファイル名に使えない文字は除く）
function fileName() {
  const name = (buildingName() || '建物名未入力').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  const date = current?.generatedAt && !isNaN(new Date(current.generatedAt)) ? new Date(current.generatedAt) : new Date();
  return `電気設備設計_${name}_${ymd(date)}.json`;
}

// 「結果を保存」は冒頭と最下部の2か所（最下部は結果の欄の中なので、結果が無いときは出ない）
function saveFile() {
  if (!current) return;
  const file = {
    format: FILE_FORMAT, version: FILE_VERSION, savedAt: new Date().toISOString(),
    buildingName: buildingName(), input: inputState(), drawings: Drawing.get(),
    result: current, wiringEdits: currentEdits,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setFileStatus(`「${a.download}」を保存しました`);
}
$('#save-file').addEventListener('click', saveFile);
$('#save-file-bottom').addEventListener('click', saveFile);

// 保存したファイルを開き、入力・図面・結果・配線図面例の編集を元に戻す。
// ファイルの中身は信用しない（入力は選択肢のキーだけ、図面は画像の data URL だけ、文は画面で必ずエスケープ）。
$('#open-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    if (f.size > 30 * 1024 * 1024) throw new Error('ファイルが大きすぎます');
    let file;
    try { file = JSON.parse(await f.text()); } catch { throw new Error('このアプリで保存したファイルではありません'); }
    if (file?.format !== FILE_FORMAT || typeof file.result?.text !== 'string') throw new Error('このアプリで保存したファイルではありません');
    if (current && !confirm('今の入力と結果を、ファイルの内容に置き換えますか？（保存していない結果は消えます）')) return;

    const input = file.input && typeof file.input === 'object' ? file.input : {};
    const values = {};
    for (const key of fieldKeys) if (typeof input[key] === 'string') values[key] = input[key];
    form.reset();
    setValues({ ...values, use_search: input.use_search !== false, building_name: String(file.buildingName ?? input.building_name ?? '') });
    save(STORAGE_INPUT, inputState());
    Drawing.set(file.drawings);

    const r = file.result;
    const resValues = {};
    for (const key of fieldKeys) if (typeof r.values?.[key] === 'string') resValues[key] = r.values[key];
    const sources = (Array.isArray(r.sources) ? r.sources : [])
      .map(s => ({ uri: String(s?.uri || ''), title: String(s?.title || s?.uri || '') })).slice(0, 50);
    showResult(r.text.slice(0, 500000), resValues, {
      sources, drawingImages: Drawing.cleanList(r.drawingImages),
      rooms: Array.isArray(r.rooms) ? r.rooms : [], generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : null,
      edits: file.wiringEdits && typeof file.wiringEdits === 'object' ? file.wiringEdits : null,
    });
    updatePreview();
    setStatus('');
    setFileStatus(`「${f.name}」を開きました。入力を変えて生成し直したり、配線図面例を編集したりできます。`);
  } catch (err) {
    setFileStatus(`開けませんでした: ${err.message}`, true);
  }
});

// 入力・図面・結果をすべて消して、最初の状態に戻す
$('#reset-all').addEventListener('click', () => {
  if (!confirm('入力・図面・生成した結果をすべて消して、最初の状態に戻しますか？（保存していない結果は消えます）')) return;
  [STORAGE_INPUT, STORAGE_RESULT, STORAGE_DRAWING, STORAGE_EDITS].forEach(remove);
  form.reset();
  Drawing.set([]);
  Drawing.render(null, [], { yen });
  current = null;
  currentEdits = null;
  $('#result').hidden = true;
  $('#save-file').disabled = true;
  $('#save-file').title = '生成すると保存できます';
  $('#no-api').hidden = true;
  $('#no-api-toggle').setAttribute('aria-expanded', 'false');
  $('#paste-text').value = '';
  setStatus('');
  setFileStatus('リセットしました');
  updatePreview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
