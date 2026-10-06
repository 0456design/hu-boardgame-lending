'use strict';
layout('home');
const S = { games: [], f: { q: '', cat: '', pl: '', tm: '', st: '' } };

/* ---------- สถานะบนการ์ด (มุมมองผู้ใช้: "พร้อมให้ขอยืม" ไม่ใช่ "พร้อมให้ยืม") ----------
   available = มีชุดว่างทุกชุดที่ใช้งานได้ · partial = มีชุดว่างแต่บางชุดถูกยืม · full = ไม่มีชุดว่าง (ถูกยืมครบ) · maintenance = ไม่มีชุดที่ใช้งานได้ */
function userStatus(g) {
  const i = gameInfo(g);
  if (i.available && i.borrowed) return { key: 'partial', kind: 'warn', text: '🟡 มีบางชุดถูกยืม' };
  if (i.available) return { key: 'available', kind: 'ok', text: 'พร้อมให้ขอยืม' };
  if (i.borrowed) return { key: 'full', kind: 'danger', text: 'ไม่มีชุดว่าง' };
  if (i.maintenance) return { key: 'maintenance', kind: 'muted', text: '⚙️ ซ่อมบำรุง' };
  return { key: 'full', kind: 'danger', text: 'ไม่มีชุดว่าง' };
}
const userStatusBadge = (g) => { const s = userStatus(g); return badge(s.kind, s.text); };
const copyBadge = (c) => c.status === 'available' ? badge('ok', 'พร้อมให้ขอยืม') : c.status === 'borrowed' ? badge('warn', 'กำลังถูกยืม') : badge('muted', 'ซ่อมบำรุง');

/* ---------- filtering (logic) ---------- */
function matches(g) {
  const { q, cat, pl, tm, st } = S.f, i = gameInfo(g);
  if (q && !g.name.toLowerCase().includes(q.toLowerCase())) return false;
  if (cat && categorize(g) !== cat) return false;
  if (pl) {
    const n = Number(pl), lo = g.min_players || 1, hi = g.max_players || lo;
    const [a, b] = n === 2 ? [1, 2] : n === 4 ? [3, 4] : n === 6 ? [5, 6] : [7, 99];
    if (!g.min_players && !g.max_players) return false;
    if (hi < a || lo > b) return false;
  }
  if (tm) { const m = playMinutes(g); if (m == null) return false; if (tm === '999' ? m <= 45 : m > Number(tm)) return false; }
  if (st && userStatus(g).key !== st) return false;
  return true;
}

/* ---------- rendering ---------- */
function renderStats() {
  const t = S.games.reduce((a, g) => { const i = gameInfo(g); a.av += i.available; a.bo += i.borrowed; a.mt += i.maintenance; return a; }, { av: 0, bo: 0, mt: 0 });
  const cell = (cls, n, l) => `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  $('#stats').innerHTML = cell('', S.games.length + ' เกม', 'บอร์ดเกมทั้งหมด') + cell('ok', t.av + ' ชุด', 'พร้อมให้ขอยืม') + cell('warn', t.bo + ' ชุด', 'กำลังถูกยืม') + cell('', t.mt + ' ชุด', 'ซ่อมบำรุง');
  const av = S.games.filter((g) => gameInfo(g).available).slice(0, 4);
  $('#now').innerHTML = av.length ? av.map((g) => `<div class="now-item"><span>${esc(g.name)}<br><small>${players(g)} · ${esc(g.play_time || 'ไม่ระบุเวลา')}</small></span><button class="btn btn-outline btn-sm" data-act="borrow" data-id="${g.id}">ขอยืมเกม</button></div>`).join('') : '<p class="muted">ขณะนี้ยังไม่มีเกมที่ว่าง</p>';
}
/* ---------- rating (1–5 ดาว) ---------- */
function rateHtml(g, pop) {
  const n = g.rating_count || 0, my = g.my_rating || 0;
  const sum = n ? `<b>${Number(g.rating_avg).toFixed(1)}</b> / 5 ⭐ <span class="rc">(${n} โหวต)</span>` : '<span class="rc">ยังไม่มีโหวต</span>';
  /* เรียงดาว 5→1 ใน DOM แล้วกลับด้านด้วย CSS (row-reverse) เพื่อให้ hover ไฮไลต์ดาวไล่จาก 1 ถึงดาวที่ชี้ */
  const stars = [5, 4, 3, 2, 1].map((i) => `<button type="button" class="star ${my >= i ? 'on' : ''}" data-rate="${i}" data-id="${g.id}" aria-label="ให้ ${i} ดาว" aria-pressed="${my === i}">★</button>`).join('');
  return `<div class="rate ${my ? 'voted' : ''} ${pop ? 'pop' : ''}" data-rate-box="${g.id}">
    <div class="rate-sum" aria-label="คะแนนเฉลี่ย">${sum}</div>
    <div class="stars" role="group" aria-label="ให้คะแนน ${esc(g.name)}">${stars}</div>
    <div class="rate-my" aria-live="polite">${my ? `คุณให้ ${my} ⭐ แล้ว · กดดาวเพื่อเปลี่ยนคะแนน` : 'กดดาวเพื่อให้คะแนน'}</div></div>`;
}
const RATING_BUSY = new Set();
async function rateGame(id, n) {
  const g = S.games.find((x) => x.id === id);
  if (!g || RATING_BUSY.has(id)) return;
  RATING_BUSY.add(id);
  try {
    const r = await api(`/games/${id}/rating`, { method: 'POST', body: { rating: n } });
    Object.assign(g, { rating_avg: r.rating_avg, rating_count: r.rating_count, my_rating: r.my_rating });
    const box = $(`[data-rate-box="${id}"]`);           // อัปเดตเฉพาะส่วนคะแนนของการ์ดนี้ทันที (ไม่ต้อง refresh)
    if (box) box.outerHTML = rateHtml(g, true);
    toast(r.previous_rating === null ? `ให้คะแนน ${n} ดาวแล้ว` : r.previous_rating === n ? `คุณให้ ${n} ดาวอยู่แล้ว` : `เปลี่ยนคะแนนจาก ${r.previous_rating} เป็น ${n} ดาวแล้ว`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
  finally { RATING_BUSY.delete(id); }
}

function cardHtml(g) {
  const i = gameInfo(g), can = i.available > 0;
  return `<article class="card game" aria-label="${esc(g.name)}">${art(g)}<div class="body">
    <h3>${esc(g.name)}</h3>${catTag(g)}<p class="desc">${esc(g.description || 'ยังไม่มีคำอธิบาย')}</p>
    <div class="meta"><span>${icon('users', 16)} ${players(g)}</span><span>${icon('clock', 16)} ${esc(g.play_time || 'ไม่ระบุ')}</span><span>จำนวน ${i.total} ชุด</span></div>
    ${rateHtml(g)}
    <div>${userStatusBadge(g)}${i.available ? ` <small class="muted">ว่าง ${i.available}/${i.total} ชุด</small>` : ''}</div>
    <div class="acts"><button class="btn btn-outline" data-act="detail" data-id="${g.id}" aria-label="ดูรายละเอียด ${esc(g.name)}">ดูรายละเอียด</button>
    <button class="btn btn-primary" data-act="borrow" data-id="${g.id}" ${can ? '' : 'disabled'} aria-label="${can ? 'ขอยืมเกม' : 'ไม่มีชุดว่าง'} ${esc(g.name)}">${can ? 'ขอยืมเกม' : 'ไม่มีชุดว่าง'}</button></div></div></article>`;
}
function renderGrid() {
  const list = S.games.filter(matches), any = Object.values(S.f).some(Boolean);
  $('#count').textContent = `พบ ${list.length} จาก ${S.games.length} เกม`;
  $('#grid').innerHTML = list.length ? list.map(cardHtml).join('')
    : emptyState('ไม่พบบอร์ดเกมที่ตรงกับเงื่อนไข', 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง', any ? '<button class="btn btn-outline" data-reset>ล้างตัวกรอง</button>' : '');
}

/* ---------- game detail ---------- */
function showDetail(g) {
  const i = gameInfo(g);
  const copies = g.copies.map((c) => `<li class="now-item"><span>${esc(c.label)} — ${c.status === 'available' ? 'พร้อมให้ขอยืม' : c.status === 'borrowed' ? 'กำลังถูกยืม' : 'ซ่อมบำรุง'}</span>${copyBadge(c)}</li>`).join('');
  const score = g.rating_count ? `${Number(g.rating_avg).toFixed(1)} / 5 ⭐` : 'ยังไม่มีคะแนน';
  const d = openDialog(`<div class="dlg-body"><div class="dlg-head"><div><h2>${esc(g.name)}</h2>${catTag(g)}</div>${closeBtn}</div>
    ${art(g)}<p>${esc(g.description || 'ยังไม่มีคำอธิบาย')}</p>
    ${kv([['ผู้เล่น', players(g)], ['เวลาเล่น', esc(g.play_time || 'ไม่ระบุ')], ['คะแนนรีวิว', score], ['จำนวนโหวต', (g.rating_count || 0) + ' โหวต'], ['ชุดทั้งหมด', i.total + ' ชุด'], ['พร้อมให้ขอยืม', i.available + ' ชุด'], ['สถานะ', userStatusBadge(g)]])}
    <div><h3>สถานะแต่ละชุด</h3><ul style="list-style:none;padding:0;margin:0">${copies || '<li class="muted">ยังไม่มีชุดเกม</li>'}</ul></div>
    ${i.available ? '' : `<p class="notice">${i.borrowed ? 'ทุกชุดกำลังถูกยืมอยู่ กรุณากลับมาตรวจสอบอีกครั้งภายหลัง' : 'เกมนี้ยังไม่พร้อมให้บริการ'}</p>`}
    <div class="dlg-actions"><button class="btn btn-primary" data-borrow ${i.available ? '' : 'disabled'}>${i.available ? 'ขอยืมเกมนี้' : 'ขณะนี้ไม่มีชุดว่าง'}</button></div></div>`);
  $('[data-borrow]', d).onclick = () => { d.close(); startBorrow(g); };
}

/* ---------- ส่งคำขอยืม: กรอกข้อมูล -> ตรวจสอบคำขอ -> ส่งคำขอ -> หน้าสำเร็จ ----------
   ไม่มีการสร้างรายการยืมจากฝั่งผู้ใช้ — ส่งได้แค่ "คำขอ" (สถานะ: รอเจ้าหน้าที่ดำเนินการ) ชุดเกมยังไม่เปลี่ยนเป็น "กำลังถูกยืม" */
function startBorrow(g) {
  const B = { g, view: 'form', copyId: (g.copies.find((c) => c.status === 'available') || {}).id, name: (localStorage.getItem('hu_borrower') || '').replace(/\D/g, ''), year: '', major: '', faculty: '', err: '', busy: false, req: null };
  const dlg = openDialog('<div class="dlg-body" id="bw"></div>');
  const copy = () => g.copies.find((c) => c.id === B.copyId);
  const head = (t) => `<div class="dlg-head"><div><h2>${t}</h2></div>${closeBtn}</div>`;
  const NOTE = 'การส่งคำขอนี้ยังไม่ถือว่าเป็นการยืมสำเร็จ กรุณารอเจ้าหน้าที่ตรวจสอบและดำเนินการยืมให้';
  const avail = g.copies.filter((c) => c.status === 'available');
  const views = {
    form: () => `${head('ส่งคำขอยืม')}
      ${kv([['เกม', esc(g.name)], ['ชุดที่ต้องการ', copy() ? esc(copy().label) : '-'], ['สถานะ', copy() ? copyBadge(copy()) : '-']])}
      ${avail.length > 1 ? `<fieldset class="opts"><legend class="hint" style="margin-bottom:8px">เลือกชุดที่ต้องการ (แสดงเฉพาะชุดที่พร้อมให้ขอยืม)</legend>${avail.map((c) => `<label class="opt"><span><input type="radio" name="copy" value="${c.id}" ${c.id === B.copyId ? 'checked' : ''}> ${esc(c.label)}</span>${copyBadge(c)}</label>`).join('')}</fieldset>` : ''}
      <div class="form-grid">
        <div class="field full"><label for="bn">รหัสนักศึกษา</label><input class="input" id="bn" value="${esc(B.name)}" inputmode="numeric" pattern="[0-9]*" maxlength="20" autocomplete="off" aria-describedby="bn-h" ${B.err && !B.name ? 'aria-invalid="true"' : ''}><span class="hint" id="bn-h">กรอกได้เฉพาะตัวเลข ใช้ติดตามคำขอและรายการยืมของคุณ</span></div>
        <div class="field"><label for="by">ชั้นปี</label><select class="select" id="by" ${B.err && !B.year ? 'aria-invalid="true"' : ''}><option value="">เลือกชั้นปี</option>${YEARS.map((y) => `<option ${B.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="field full"><label for="bf">คณะ</label><select class="select" id="bf" ${B.err && !B.faculty ? 'aria-invalid="true"' : ''}><option value="">เลือกคณะ</option>${FACULTIES.map((f) => `<option value="${esc(f.name)}" ${B.faculty === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="field full"><label for="bm">สาขา</label><select class="select" id="bm" ${B.faculty ? '' : 'disabled'} ${B.err && !B.major ? 'aria-invalid="true"' : ''}>${majorOptions(B.faculty, B.major)}</select></div>
      </div>
      ${B.err ? `<p class="err-text" role="alert">${esc(B.err)}</p>` : ''}
      <div class="dlg-actions"><button class="btn btn-outline" data-close>ยกเลิก</button><button class="btn btn-primary" data-next ${B.copyId ? '' : 'disabled'}>ตรวจสอบคำขอ</button></div>`,
    review: () => `${head('ตรวจสอบคำขอยืม')}
      ${kv([['เกม', esc(g.name)], ['ชุดเกม', esc(copy().label)], ['รหัสนักศึกษา', esc(B.name)], ['ชั้นปี', esc(B.year)], ['คณะ', esc(B.faculty)], ['สาขา', esc(B.major)], ['วันที่ส่งคำขอ', fmt(new Date())], ['สถานะ', badge('warn', '🟡 รอเจ้าหน้าที่ดำเนินการ')]])}
      ${B.err ? `<p class="notice err" role="alert">${esc(B.err)}</p>` : ''}
      <p class="notice"><b>${NOTE}</b></p>
      <div class="dlg-actions"><button class="btn btn-outline" data-back ${B.busy ? 'disabled' : ''}>ย้อนกลับ</button><button class="btn btn-primary" data-confirm ${B.busy ? 'disabled' : ''}>${B.busy ? 'กำลังส่ง…' : 'ส่งคำขอยืม'}</button></div>`,
    done: () => `${head('ส่งคำขอยืมเรียบร้อยแล้ว')}
      <div class="success"><div class="ok-ic">${icon('check', 30)}</div><h3>ส่งคำขอยืมเรียบร้อยแล้ว</h3><p class="muted">รหัสคำขอ ${reqCode(B.req)}</p></div>
      ${kv([['เกม', esc(B.req.game_name)], ['ชุด', esc(B.req.copy_label)], ['รหัสนักศึกษา', esc(B.req.student_id)], ['วันที่ส่งคำขอ', fmt(B.req.created_at)], ['สถานะ', badge('warn', 'รอเจ้าหน้าที่ดำเนินการ')]])}
      <p class="notice"><b>กรุณาติดต่อเจ้าหน้าที่ห้องสมุดเพื่อดำเนินการยืมเกม หลังจากเจ้าหน้าที่ตรวจสอบคำขอแล้ว</b></p>
      <div class="dlg-actions"><button class="btn btn-outline" data-close>ปิด</button><a class="btn btn-primary" href="/myrequests.html?q=${encodeURIComponent(B.req.student_id)}">ดูคำขอของฉัน</a></div>`,
  };
  const draw = () => { $('#bw', dlg).innerHTML = views[B.view](); const f = $('[data-confirm], [data-next], input:not([type=radio])', dlg); f && f.focus(); };
  dlg.addEventListener('change', (e) => {
    if (e.target.name === 'copy') B.copyId = Number(e.target.value);
    if (e.target.id === 'by') B.year = e.target.value;
    if (e.target.id === 'bf') { /* เปลี่ยนคณะ -> ล้างสาขา แล้วแสดงเฉพาะสาขาของคณะนั้น */
      B.faculty = e.target.value; B.major = '';
      const bm = $('#bm', dlg); bm.innerHTML = majorOptions(B.faculty, ''); bm.disabled = !B.faculty; bm.removeAttribute('aria-invalid');
    }
    if (e.target.id === 'bm') B.major = e.target.value;
  });
  /* รหัสนักศึกษา: พิมพ์ได้เฉพาะตัวเลข (กันตั้งแต่ตอนพิมพ์ และกรองซ้ำตอนวาง/IME) */
  dlg.addEventListener('beforeinput', (e) => { if (e.target.id === 'bn' && e.data && /\D/.test(e.data)) e.preventDefault(); });
  dlg.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'bn') { const v = t.value.replace(/\D/g, ''); if (v !== t.value) t.value = v; B.name = v; }
  });
  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-back]')) { B.view = 'form'; B.err = ''; draw(); }
    else if (e.target.closest('[data-next]')) {
      B.name = $('#bn', dlg).value.replace(/\D/g, ''); B.year = $('#by', dlg).value; B.faculty = $('#bf', dlg).value; B.major = $('#bm', dlg).value;
      const miss = [!B.name && 'รหัสนักศึกษา', !B.year && 'ชั้นปี', !B.faculty && 'คณะ', !B.major && 'สาขา'].filter(Boolean);
      if (miss.length) { B.err = `กรุณากรอก${miss.join(' ')}`; return draw(); }
      B.err = ''; localStorage.setItem('hu_borrower', B.name);
      B.view = 'review'; draw();
    } else if (e.target.closest('[data-confirm]')) {
      B.busy = true; B.err = ''; draw();
      try { B.req = await api('/requests', { method: 'POST', body: { copy_id: B.copyId, student_id: B.name, year_level: B.year, faculty: B.faculty, major: B.major } }); B.view = 'done'; load(true); }
      catch (er) { B.err = er.message; }
      B.busy = false; draw();
    }
  });
  draw();
}

/* ---------- data + events ---------- */
async function load(silent) {
  if (!silent) { $('#grid').innerHTML = skel(6, 'sk-card'); $('#stats').innerHTML = skel(4, 'sk-stat'); }
  try { S.games = await api('/games'); renderStats(); renderGrid(); }
  catch { $('#grid').innerHTML = errorState(); $('#stats').innerHTML = ''; $('#count').textContent = ''; }
}
$('.search-big').insertAdjacentHTML('afterbegin', icon('search', 20));
CATEGORIES.forEach((c) => $('#f-cat').insertAdjacentHTML('beforeend', `<option>${c}</option>`));
const bind = { q: '#q', cat: '#f-cat', pl: '#f-pl', tm: '#f-tm', st: '#f-st' };
Object.entries(bind).forEach(([k, sel]) => $(sel).addEventListener('input', (e) => { S.f[k] = e.target.value.trim(); renderGrid(); }));
/* เรียก reset ผ่าน prototype เพราะปุ่ม id="reset" ในฟอร์มไปบังเมธอด form.reset() (ไม่งั้นเกิด "reset is not a function") */
const resetF = () => { HTMLFormElement.prototype.reset.call($('#filters')); Object.keys(S.f).forEach((k) => (S.f[k] = '')); renderGrid(); };
$('#reset').addEventListener('click', () => setTimeout(resetF));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) return load();
  if (e.target.closest('[data-reset]')) return resetF();
  const rt = e.target.closest('[data-rate]'); if (rt) return rateGame(Number(rt.dataset.id), Number(rt.dataset.rate));
  const b = e.target.closest('[data-act]'); if (!b) return;
  const g = S.games.find((x) => x.id === Number(b.dataset.id)); if (!g) return;
  b.dataset.act === 'detail' ? showDetail(g) : startBorrow(g);
});
load();
liveUpdate(() => load(true));
