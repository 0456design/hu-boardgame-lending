'use strict';
layout('equipment');
const S = { items: [], f: { q: '', st: '' } };

/* ---------- สถานะบนการ์ด (ตรรกะเดียวกับหน้าบอร์ดเกม) ---------- */
function userStatus(e) {
  const i = gameInfo(e);
  if (i.available && i.borrowed) return { key: 'partial', kind: 'warn', text: '🟡 มีบางรายการถูกยืม' };
  if (i.available) return { key: 'available', kind: 'ok', text: 'พร้อมให้ขอยืม' };
  if (i.borrowed) return { key: 'full', kind: 'danger', text: 'ไม่มีรายการว่าง' };
  if (i.maintenance) return { key: 'maintenance', kind: 'muted', text: '⚙️ ซ่อมบำรุง' };
  return { key: 'full', kind: 'danger', text: 'ไม่มีรายการว่าง' };
}
const userStatusBadge = (e) => { const s = userStatus(e); return badge(s.kind, s.text); };
const copyBadge = (c) => c.status === 'available' ? badge('ok', 'พร้อมให้ขอยืม') : c.status === 'borrowed' ? badge('warn', 'กำลังถูกยืม') : badge('muted', 'ซ่อมบำรุง');
const copyText = (c) => c.status === 'available' ? 'พร้อมให้ขอยืม' : c.status === 'borrowed' ? 'กำลังถูกยืม' : 'ซ่อมบำรุง';

function matches(e) {
  const { q, st } = S.f;
  if (q && !e.name.toLowerCase().includes(q.toLowerCase())) return false;
  if (st && userStatus(e).key !== st) return false;
  return true;
}

/* ---------- rendering ---------- */
function renderStats() {
  const t = S.items.reduce((a, e) => { const i = gameInfo(e); a.av += i.available; a.bo += i.borrowed; a.mt += i.maintenance; return a; }, { av: 0, bo: 0, mt: 0 });
  const cell = (cls, n, l) => `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  $('#stats').innerHTML = cell('', S.items.length + ' ประเภท', 'อุปกรณ์ทั้งหมด') + cell('ok', t.av + ' รายการ', 'พร้อมให้ขอยืม') + cell('warn', t.bo + ' รายการ', 'กำลังถูกยืม') + cell('', t.mt + ' รายการ', 'ซ่อมบำรุง');
  const av = S.items.filter((e) => gameInfo(e).available).slice(0, 4);
  $('#now').innerHTML = av.length ? av.map((e) => `<div class="now-item"><span>${esc(e.name)}<br><small>ว่าง ${gameInfo(e).available}/${gameInfo(e).total} รายการ</small></span><button class="btn btn-outline btn-sm" data-act="borrow" data-id="${e.id}">ขอยืมอุปกรณ์</button></div>`).join('') : '<p class="muted">ขณะนี้ยังไม่มีอุปกรณ์ที่ว่าง</p>';
}
function cardHtml(e) {
  const i = gameInfo(e), can = i.available > 0;
  return `<article class="card game" aria-label="${esc(e.name)}">${eqArt(e)}<div class="body">
    <h3>${esc(e.name)}</h3><span class="cat cat-skill">อุปกรณ์</span><p class="desc">${esc(e.description || 'ยังไม่มีคำอธิบาย')}</p>
    <div class="meta"><span>${icon('check', 16)} ว่าง ${i.available}/${i.total} รายการ</span><span>จำนวน ${i.total} รายการ</span></div>
    <div>${userStatusBadge(e)}</div>
    <div class="acts"><button class="btn btn-outline" data-act="detail" data-id="${e.id}" aria-label="ดูรายละเอียด ${esc(e.name)}">ดูรายละเอียด</button>
    <button class="btn btn-primary" data-act="borrow" data-id="${e.id}" ${can ? '' : 'disabled'} aria-label="${can ? 'ขอยืมอุปกรณ์' : 'ไม่มีรายการว่าง'} ${esc(e.name)}">${can ? 'ขอยืมอุปกรณ์' : 'ไม่มีรายการว่าง'}</button></div></div></article>`;
}
function renderGrid() {
  const list = S.items.filter(matches), any = Object.values(S.f).some(Boolean);
  $('#count').textContent = `พบ ${list.length} จาก ${S.items.length} ประเภท`;
  $('#grid').innerHTML = list.length ? list.map(cardHtml).join('')
    : emptyState('ไม่พบอุปกรณ์ที่ตรงกับเงื่อนไข', 'ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง', any ? '<button class="btn btn-outline" data-reset>ล้างตัวกรอง</button>' : '');
}

/* ---------- detail ---------- */
function showDetail(e) {
  const i = gameInfo(e);
  const copies = e.copies.map((c) => `<li class="now-item"><span>${esc(c.label)} — ${copyText(c)}</span>${copyBadge(c)}</li>`).join('');
  const d = openDialog(`<div class="dlg-body"><div class="dlg-head"><div><h2>${esc(e.name)}</h2><span class="cat cat-skill">อุปกรณ์</span></div>${closeBtn}</div>
    ${eqArt(e)}<p>${esc(e.description || 'ยังไม่มีคำอธิบาย')}</p>
    ${kv([['รายการทั้งหมด', i.total + ' รายการ'], ['พร้อมให้ขอยืม', i.available + ' รายการ'], ['กำลังถูกยืม', i.borrowed + ' รายการ'], ['ซ่อมบำรุง', i.maintenance + ' รายการ'], ['สถานะ', userStatusBadge(e)]])}
    <div><h3>สถานะแต่ละรายการ</h3><ul style="list-style:none;padding:0;margin:0">${copies || '<li class="muted">ยังไม่มีรายการอุปกรณ์</li>'}</ul></div>
    ${i.available ? '' : `<p class="notice">${i.borrowed ? 'ทุกรายการกำลังถูกยืมอยู่ กรุณากลับมาตรวจสอบอีกครั้งภายหลัง' : 'อุปกรณ์นี้ยังไม่พร้อมให้บริการ'}</p>`}
    <div class="dlg-actions"><button class="btn btn-primary" data-borrow ${i.available ? '' : 'disabled'}>${i.available ? 'ขอยืมอุปกรณ์นี้' : 'ขณะนี้ไม่มีรายการว่าง'}</button></div></div>`);
  $('[data-borrow]', d).onclick = () => { d.close(); startBorrow(e); };
}

/* ---------- ขั้นตอนการยืม: 1 เลือกอุปกรณ์ → 2 ข้อมูลผู้ยืม → 3 ตรวจสอบ → 4 เสร็จสิ้น ----------
   ส่งได้แค่ "คำขอ" (รอเจ้าหน้าที่ดำเนินการ) — รายการจะเป็น "กำลังถูกยืม" เมื่อเจ้าหน้าที่อนุมัติเท่านั้น (เหมือนบอร์ดเกม) */
const STEPS = ['เลือกอุปกรณ์', 'ข้อมูลผู้ยืม', 'ตรวจสอบ', 'เสร็จสิ้น'];
function startBorrow(e) {
  const B = { e, step: 1, copyId: (e.copies.find((c) => c.status === 'available') || {}).id, name: (localStorage.getItem('hu_borrower') || '').replace(/\D/g, ''), year: '', major: '', faculty: '', err: '', busy: false, req: null };
  const dlg = openDialog('<div class="dlg-body" id="bw"></div>');
  const copy = () => e.copies.find((c) => c.id === B.copyId);
  const head = (t) => `<div class="dlg-head"><div><h2>${t}</h2></div>${closeBtn}</div>`;
  const NOTE = 'การส่งคำขอนี้ยังไม่ถือว่าเป็นการยืมสำเร็จ กรุณารอเจ้าหน้าที่ตรวจสอบและดำเนินการยืมให้';
  const views = {
    1: () => `${head('เลือกอุปกรณ์ที่ต้องการยืม')}${stepper(STEPS, 1)}
      ${eqArt(e)}
      <fieldset class="opts"><legend class="hint" style="margin-bottom:8px">${esc(e.name)} — เลือกได้เฉพาะรายการที่พร้อมให้ขอยืม</legend>${e.copies.map((c) => `<label class="opt"><span><input type="radio" name="copy" value="${c.id}" ${c.id === B.copyId ? 'checked' : ''} ${c.status === 'available' ? '' : 'disabled'}> ${esc(c.label)}</span>${copyBadge(c)}</label>`).join('')}</fieldset>
      ${B.err ? `<p class="err-text" role="alert">${esc(B.err)}</p>` : ''}
      <div class="dlg-actions"><button class="btn btn-outline" data-close>ยกเลิก</button><button class="btn btn-primary" data-next ${B.copyId ? '' : 'disabled'}>ถัดไป: ข้อมูลผู้ยืม</button></div>`,
    2: () => `${head('ข้อมูลผู้ยืม')}${stepper(STEPS, 2)}
      ${kv([['อุปกรณ์', esc(e.name)], ['รายการที่เลือก', copy() ? esc(copy().label) : '-'], ['สถานะ', copy() ? copyBadge(copy()) : '-']])}
      <div class="form-grid">
        <div class="field full"><label for="bn">รหัสนักศึกษา</label><input class="input" id="bn" value="${esc(B.name)}" inputmode="numeric" pattern="[0-9]*" maxlength="20" autocomplete="off" aria-describedby="bn-h" ${B.err && !B.name ? 'aria-invalid="true"' : ''}><span class="hint" id="bn-h">กรอกได้เฉพาะตัวเลข ใช้ติดตามคำขอและรายการยืมของคุณ</span></div>
        <div class="field"><label for="by">ชั้นปี</label><select class="select" id="by" ${B.err && !B.year ? 'aria-invalid="true"' : ''}><option value="">เลือกชั้นปี</option>${YEARS.map((y) => `<option ${B.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
        <div class="field full"><label for="bf">คณะ</label><select class="select" id="bf" ${B.err && !B.faculty ? 'aria-invalid="true"' : ''}><option value="">เลือกคณะ</option>${FACULTIES.map((f) => `<option value="${esc(f.name)}" ${B.faculty === f.name ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="field full"><label for="bm">สาขา</label><select class="select" id="bm" ${B.faculty ? '' : 'disabled'} ${B.err && !B.major ? 'aria-invalid="true"' : ''}>${majorOptions(B.faculty, B.major)}</select></div>
      </div>
      ${B.err ? `<p class="err-text" role="alert">${esc(B.err)}</p>` : ''}
      <div class="dlg-actions"><button class="btn btn-outline" data-back>ย้อนกลับ</button><button class="btn btn-primary" data-next>ตรวจสอบคำขอ</button></div>`,
    3: () => `${head('ตรวจสอบคำขอยืม')}${stepper(STEPS, 3)}
      ${kv([['อุปกรณ์', esc(e.name)], ['รายการ', esc(copy().label)], ['รหัสนักศึกษา', esc(B.name)], ['ชั้นปี', esc(B.year)], ['คณะ', esc(B.faculty)], ['สาขา', esc(B.major)], ['วันที่ส่งคำขอ', fmt(new Date())], ['สถานะ', badge('warn', '🟡 รอเจ้าหน้าที่ดำเนินการ')]])}
      ${B.err ? `<p class="notice err" role="alert">${esc(B.err)}</p>` : ''}
      <p class="notice"><b>${NOTE}</b></p>
      <div class="dlg-actions"><button class="btn btn-outline" data-back ${B.busy ? 'disabled' : ''}>ย้อนกลับ</button><button class="btn btn-primary" data-confirm ${B.busy ? 'disabled' : ''}>${B.busy ? 'กำลังส่ง…' : 'ส่งคำขอยืม'}</button></div>`,
    4: () => { const r = { ...B.req, kind: 'equipment' }; return `${head('ส่งคำขอยืมเรียบร้อยแล้ว')}${stepper(STEPS, 4)}
      <div class="success"><div class="ok-ic">${icon('check', 30)}</div><h3>ส่งคำขอยืมอุปกรณ์เรียบร้อยแล้ว</h3><p class="muted">รหัสคำขอ ${reqCode(r)}</p></div>
      ${kv([['อุปกรณ์', esc(r.game_name)], ['รายการ', esc(r.copy_label)], ['รหัสนักศึกษา', esc(r.student_id)], ['ชั้นปี', esc(r.year_level)], ['คณะ / สาขา', `${esc(r.faculty)} · ${esc(r.major)}`], ['วันที่ส่งคำขอ', fmt(r.created_at)], ['ระยะเวลายืม', '2 ชั่วโมง (นับจากที่เจ้าหน้าที่ดำเนินการยืมให้)'], ['สถานะ', badge('warn', 'รอเจ้าหน้าที่ดำเนินการ')]])}
      <p class="notice"><b>กรุณาติดต่อเจ้าหน้าที่เพื่อดำเนินการยืมอุปกรณ์ หลังจากเจ้าหน้าที่ตรวจสอบคำขอแล้ว รายการจะแสดงที่ “การยืมของฉัน”</b></p>
      <div class="dlg-actions"><button class="btn btn-outline" data-close>ปิด</button><a class="btn btn-primary" href="/myrequests.html?q=${encodeURIComponent(r.student_id)}">ดูคำขอของฉัน</a></div>`; },
  };
  const draw = () => { $('#bw', dlg).innerHTML = views[B.step](); const f = $('[data-confirm], [data-next], input:not([type=radio])', dlg); f && f.focus(); };
  dlg.addEventListener('change', (ev) => {
    if (ev.target.name === 'copy') B.copyId = Number(ev.target.value);
    if (ev.target.id === 'by') B.year = ev.target.value;
    if (ev.target.id === 'bf') { B.faculty = ev.target.value; B.major = ''; const bm = $('#bm', dlg); bm.innerHTML = majorOptions(B.faculty, ''); bm.disabled = !B.faculty; bm.removeAttribute('aria-invalid'); }
    if (ev.target.id === 'bm') B.major = ev.target.value;
  });
  dlg.addEventListener('beforeinput', (ev) => { if (ev.target.id === 'bn' && ev.data && /\D/.test(ev.data)) ev.preventDefault(); });
  dlg.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'bn') { const v = t.value.replace(/\D/g, ''); if (v !== t.value) t.value = v; B.name = v; }
  });
  dlg.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-back]')) { B.step -= 1; B.err = ''; draw(); }
    else if (ev.target.closest('[data-next]')) {
      if (B.step === 1) { if (!copy() || copy().status !== 'available') { B.err = 'กรุณาเลือกรายการที่พร้อมให้ขอยืม'; return draw(); } B.err = ''; B.step = 2; return draw(); }
      B.name = $('#bn', dlg).value.replace(/\D/g, ''); B.year = $('#by', dlg).value; B.faculty = $('#bf', dlg).value; B.major = $('#bm', dlg).value;
      const miss = [!B.name && 'รหัสนักศึกษา', !B.year && 'ชั้นปี', !B.faculty && 'คณะ', !B.major && 'สาขา'].filter(Boolean);
      if (miss.length) { B.err = `กรุณากรอก${miss.join(' ')}`; return draw(); }
      B.err = ''; localStorage.setItem('hu_borrower', B.name); B.step = 3; draw();
    } else if (ev.target.closest('[data-confirm]')) {
      B.busy = true; B.err = ''; draw();
      try { B.req = await api('/equipment-requests', { method: 'POST', body: { copy_id: B.copyId, student_id: B.name, year_level: B.year, faculty: B.faculty, major: B.major } }); B.step = 4; load(true); }
      catch (er) { B.err = er.message; }
      B.busy = false; draw();
    }
  });
  draw();
}

/* ---------- data + events ---------- */
async function load(silent) {
  if (!silent) { $('#grid').innerHTML = skel(3, 'sk-card'); $('#stats').innerHTML = skel(4, 'sk-stat'); }
  try { S.items = await api('/equipment'); renderStats(); renderGrid(); }
  catch { $('#grid').innerHTML = errorState(); $('#stats').innerHTML = ''; $('#count').textContent = ''; }
}
$('.search-big').insertAdjacentHTML('afterbegin', icon('search', 20));
$('#q').addEventListener('input', (e) => { S.f.q = e.target.value.trim(); renderGrid(); });
$('#f-st').addEventListener('input', (e) => { S.f.st = e.target.value; renderGrid(); });
/* เรียก reset ผ่าน prototype เพราะปุ่ม id="reset" ในฟอร์มไปบังเมธอด form.reset() */
const resetF = () => { HTMLFormElement.prototype.reset.call($('#filters')); Object.keys(S.f).forEach((k) => (S.f[k] = '')); renderGrid(); };
$('#reset').addEventListener('click', () => setTimeout(resetF));
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) return load();
  if (e.target.closest('[data-reset]')) return resetF();
  const b = e.target.closest('[data-act]'); if (!b) return;
  const it = S.items.find((x) => x.id === Number(b.dataset.id)); if (!it) return;
  b.dataset.act === 'detail' ? showDetail(it) : startBorrow(it);
});
load();
liveUpdate(() => { if (!$('dialog[open]')) load(true); });
