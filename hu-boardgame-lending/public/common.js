'use strict';
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOAN_MIN = 120, SOON_MIN = 30;
const ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z"/>',
  dash: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/>',
  swap: '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>',
  bars: '<path d="M3 3v18h18"/><rect x="7" y="13" width="3" height="5"/><rect x="12" y="9" width="3" height="9"/><rect x="17" y="5" width="3" height="13"/>',
  laptop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/>',
  vr: '<path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3.5l-1.5-2.5h-4L8.5 17H5a2 2 0 0 1-2-2Z"/><circle cx="8" cy="12" r="1.2"/><circle cx="16" cy="12" r="1.2"/>',
  plug: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M7 11v2M12 11v2M17 11v2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
};
const icon = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const badge = (k, t) => `<span class="badge b-${k}">${esc(t)}</span>`;

/* ---------- API (human-readable errors) ---------- */
async function api(path, opt = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { method: opt.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  } catch { throw new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && location.pathname === '/admin.html') { location.href = '/login.html?next=/admin.html'; }
  if (!res.ok) throw Object.assign(new Error(data.error || 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง'), { status: res.status });
  return data;
}

/* ---------- domain logic ---------- */
function gameInfo(g) {
  const n = (s) => g.copies.filter((c) => c.status === s).length;
  return { total: g.copies.length, available: n('available'), borrowed: n('borrowed'), maintenance: n('maintenance') };
}
function gameStatus(g) {
  const i = gameInfo(g);
  if (i.available) return badge('ok', `พร้อมให้ยืม ${i.available} ชุด`);
  if (i.borrowed) return badge('warn', 'ถูกยืมครบทุกชุด');
  if (i.maintenance) return badge('muted', 'ซ่อมบำรุง');
  return badge('muted', 'ยังไม่มีชุดเกม');
}
function categorize(g) {
  const t = `${g.name} ${g.description || ''}`;
  if (/ปริศนา|ตัวต่อ|บล็อก|Blocks/i.test(t)) return 'เกมปริศนา';
  if (/ทรงตัว|คล่องแคล่ว|หอคอย|หย่อน/.test(t)) return 'เกมทักษะ';
  if (/ปาร์ตี้|จับท่า|สายลับ/.test(t)) return 'เกมปาร์ตี้';
  if (/การ์ด/.test(t)) return 'เกมการ์ด';
  return 'เกมทั่วไป';
}
const CATEGORIES = ['เกมการ์ด', 'เกมปาร์ตี้', 'เกมทักษะ', 'เกมปริศนา', 'เกมทั่วไป'];
const CATEGORY_SLUG = { 'เกมการ์ด': 'card', 'เกมปาร์ตี้': 'party', 'เกมทักษะ': 'skill', 'เกมปริศนา': 'puzzle', 'เกมทั่วไป': 'general' };
const catTag = (g) => { const c = categorize(g); return `<span class="cat cat-${CATEGORY_SLUG[c] || 'general'}">${c}</span>`; };
const players = (g) => (!g.min_players && !g.max_players ? 'ไม่ระบุ' : !g.max_players || g.min_players === g.max_players ? `${g.min_players || g.max_players} คน` : `${g.min_players || 1}–${g.max_players} คน`);
const playMinutes = (g) => { const m = String(g.play_time || '').match(/\d+/g); return m ? Math.max(...m.map(Number)) : null; };
function art(g) {
  if (g.image_url) return `<div class="art"><img src="${esc(g.image_url)}" alt="" loading="lazy"></div>`;
  const hue = [205, 165, 25, 280, 340, 95, 45, 190][[...g.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 8];
  const ini = [...g.name.replace(/[^\p{L}\p{N} ]/gu, '')].slice(0, 2).join('').toUpperCase();
  return `<div class="art" aria-hidden="true" style="background:linear-gradient(135deg,hsl(${hue} 85% 94%),hsl(${hue} 75% 84%));color:hsl(${hue} 60% 32%)">${esc(ini)}</div>`;
}
/* loan state: active | soon | overdue | returned */
function loanState(l) {
  if (l.returned_at) return 'returned';
  const left = new Date(l.due_at) - Date.now();
  return left < 0 ? 'overdue' : left <= SOON_MIN * 60000 ? 'soon' : 'active';
}
function dur(ms) { const m = Math.max(1, Math.round(Math.abs(ms) / 60000)); return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`; }
const remain = (l) => (l.returned_at ? 'คืนแล้ว' : new Date(l.due_at) < Date.now() ? `เกินกำหนด ${dur(new Date(l.due_at) - Date.now())}` : `เหลือ ${dur(new Date(l.due_at) - Date.now())}`);
const LOAN_BADGE = { active: ['info', 'กำลังยืม'], soon: ['warn', 'ใกล้ครบกำหนด'], overdue: ['danger', 'เกินกำหนด'], returned: ['ok', 'คืนแล้ว'] };
const loanBadge = (l) => badge(...LOAN_BADGE[loanState(l)]);
/* ---------- คำขอยืม: pending | approved | rejected | cancelled ---------- */
const REQ_STATUS = {
  pending: ['warn', ' รอเจ้าหน้าที่ดำเนินการ'],
  approved: ['ok', 'เจ้าหน้าที่ดำเนินการยืมให้แล้ว'],
  rejected: ['danger', 'คำขอถูกปฏิเสธ'],
  cancelled: ['muted', ' คำขอถูกยกเลิก'],
};
const reqBadge = (r) => badge(...(REQ_STATUS[r.status] || ['muted', r.status]));
const reqCode = (r) => (r.kind === 'equipment' ? 'EQR-' : 'REQ-') + String(r.id).padStart(4, '0');
const fmt = (iso) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' น.';

/* ---------- บอร์ดเกม + อุปกรณ์ ใช้ตัวแสดงผลชุดเดียวกัน ---------- */
const tagKind = (list, kind) => list.map((x) => ({ ...x, kind }));
const isEq = (x) => x && x.kind === 'equipment';
const kindTag = (x) => `<span class="cat ${isEq(x) ? 'cat-skill' : 'cat-party'}">${isEq(x) ? 'อุปกรณ์' : 'บอร์ดเกม'}</span>`;
const loanCode = (l) => (isEq(l) ? 'EQ-' : '#') + l.id;
/* ชื่อที่แสดงบนการ์ด: อุปกรณ์ใช้ชื่อรายการ (เช่น โน๊ตบุ๊ค 1) บอร์ดเกมใช้ชื่อเกม */
const itemTitle = (x) => (isEq(x) ? x.copy_label || x.game_name : x.game_name);
const YEARS = ['ปี 1', 'ปี 2', 'ปี 3', 'ปี 4', 'ปี 5 ขึ้นไป'];
/* ตัวเลือก "สาขา" ของคณะที่เลือก (ถ้ายังไม่เลือกคณะ จะเป็นช่องที่ปิดไว้) — ใช้ร่วมกันทั้งฟอร์มยืมบอร์ดเกมและอุปกรณ์ */
function majorOptions(facultyName, selected) {
  const f = FACULTIES.find((x) => x.name === facultyName);
  if (!f) return '<option value="">เลือกคณะก่อน</option>';
  return `<option value="">เลือกสาขา</option>${f.majors.map((m) => `<option value="${esc(m)}" ${m === selected ? 'selected' : ''}>${esc(m)}</option>`).join('')}`;
}
/* ตัวบอกขั้นตอน: cur = ขั้นปัจจุบัน (1-based) · ขั้นสุดท้ายเมื่อถึงแล้วถือว่าเสร็จทุกขั้น */
function stepper(labels, cur) {
  const last = labels.length;
  return `<ol class="stepper" aria-label="ขั้นตอนการยืม">${labels.map((t, i) => {
    const n = i + 1, done = n < cur || cur === last, now = n === cur;
    return `<li class="${done ? 'done' : ''} ${now ? 'current' : ''}"${now ? ' aria-current="step"' : ''}><span class="st-n">${done ? icon('check', 16) : n}</span><span class="st-l">${t}</span></li>`;
  }).join('')}</ol><p class="step-now">ขั้นตอนที่ ${cur} จาก ${last}: ${labels[cur - 1]}</p>`;
}
/* รูป/ไอคอนอุปกรณ์ (ยังไม่มีไฟล์รูป -> ใช้ไอคอนบนพื้นไล่สี สไตล์เดียวกับรูปบอร์ดเกมที่ไม่มีภาพ) */
function eqKind(e) {
  const t = String(e.name || '');
  if (/โน้ต|โน๊ต|แล็ปท็อป|laptop|notebook/i.test(t)) return 'laptop';
  if (/vr|เสมือน/i.test(t)) return 'vr';
  if (/ปลั๊ก|plug|power/i.test(t)) return 'plug';
  return 'box';
}
function eqArt(e) {
  const k = eqKind(e), hue = { laptop: 215, vr: 280, plug: 38, box: 165 }[k];
  return `<div class="art" aria-hidden="true" style="background:linear-gradient(135deg,hsl(${hue} 85% 94%),hsl(${hue} 75% 84%));color:hsl(${hue} 60% 32%)">${icon(k, 64)}</div>`;
}

/* ---------- UI: states ---------- */
const skel = (n, cls) => Array.from({ length: n }, () => `<div class="skeleton ${cls}"></div>`).join('');
const emptyState = (title, text, action = '') => `<div class="state">${icon('inbox', 44)}<h3>${title}</h3><p>${text}</p>${action}</div>`;
const errorState = () => `<div class="state error" role="alert">${icon('alert', 44)}<h3>ไม่สามารถโหลดข้อมูลได้ในขณะนี้</h3><p>กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง</p><button class="btn btn-primary" data-retry>ลองอีกครั้ง</button></div>`;

/* ---------- UI: toast, dialogs ---------- */
function toast(msg, kind = '') {
  let box = $('#toasts');
  if (!box) { box = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toasts' })); box.setAttribute('aria-live', 'polite'); }
  const t = Object.assign(document.createElement('div'), { className: 'toast ' + kind, textContent: msg });
  box.append(t); setTimeout(() => t.remove(), 4000);
}
function openDialog(html) {
  const d = document.createElement('dialog');
  d.className = 'dlg'; d.innerHTML = html; document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.showModal(); return d;
}
const closeBtn = `<button type="button" class="icon-btn" data-close aria-label="ปิด">${icon('x', 20)}</button>`;
function confirmDialog({ title, body, ok = 'ยืนยัน', danger = false }) {
  return new Promise((res) => {
    const d = openDialog(`<form method="dialog" class="dlg-body"><h2>${title}</h2><div>${body}</div><div class="dlg-actions"><button class="btn btn-outline" value="no">ยกเลิก</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${ok}</button></div></form>`);
    d.addEventListener('close', () => res(d.returnValue === 'yes'));
  });
}
const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
document.addEventListener('click', (e) => { const c = e.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });

/* ---------- layout (header / footer) ---------- */
function layout(active) {
  const links = [['home', '/', 'หน้าแรก'], ['games', '/#catalog', 'บอร์ดเกม'], ['equipment', '/equipment.html', 'อุปกรณ์'], ['requests', '/myrequests.html', 'คำขอของฉัน'], ['loans', '/myloans.html', 'การยืมของฉัน']];
  $('#site-header').innerHTML = `<header class="site-header"><div class="container bar">
    <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="40" height="40"><span><strong>ระบบยืม–คืนบอร์ดเกมและอุปกรณ์</strong><small>มหาวิทยาลัยหาดใหญ่</small></span></a>
    <button class="menu-btn" aria-label="เปิดเมนู" aria-expanded="false" aria-controls="nav">${icon('menu', 22)}</button>
    <nav id="nav" class="nav" aria-label="เมนูหลัก">${links.map(([k, h, t]) => `<a href="${h}"${k === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}<a class="nav-staff" href="/admin.html">เจ้าหน้าที่</a></nav></div></header>`;
  const btn = $('.menu-btn'), nav = $('#nav');
  btn.onclick = () => btn.setAttribute('aria-expanded', nav.classList.toggle('open'));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  $('#site-footer').innerHTML = `<footer class="site-footer"><div class="container"><div class="foot">
    <div><strong>มหาวิทยาลัยหาดใหญ่</strong><p class="muted">ระบบยืม–คืนบอร์ดเกม<br>สำหรับการเรียนรู้และกิจกรรมของนักศึกษา</p></div>
    <div><h3>เมนู</h3><a href="/">หน้าแรก</a><a href="/#catalog">บอร์ดเกม</a><a href="/equipment.html">อุปกรณ์</a><a href="/myrequests.html">คำขอของฉัน</a><a href="/myloans.html">การยืมของฉัน</a></div>
    <div><h3>ข้อมูลระบบ</h3><p class="muted">ส่งคำขอยืมออนไลน์ แล้วรอเจ้าหน้าที่ดำเนินการ<br>ยืมได้ครั้งละ 1 เกม และ 1 อุปกรณ์ · ระยะเวลา 2 ชั่วโมง</p><a href="/admin.html">สำหรับเจ้าหน้าที่</a></div>
  </div><p class="copy">© มหาวิทยาลัยหาดใหญ่ · ระบบยืม–คืนบอร์ดเกม</p></div></footer>`;
}

/* ---------- อัปเดตหน้าอัตโนมัติ (เรียลไทม์) ----------
   onChange จะถูกเรียกเมื่อเซิร์ฟเวอร์แจ้งว่าข้อมูลเปลี่ยน, เมื่อเชื่อมต่อใหม่หลังหลุด, และเมื่อกลับมาเปิดแท็บนี้ */
function liveUpdate(onChange) {
  if (!('EventSource' in window)) return;
  let timer = null, opened = false;
  const fire = () => { clearTimeout(timer); timer = setTimeout(onChange, 200); };
  const es = new EventSource('/api/events');
  es.addEventListener('change', fire);
  es.addEventListener('open', () => { if (opened) fire(); opened = true; }); // เชื่อมต่อใหม่ = อาจพลาดข้อมูลช่วงที่หลุด
  document.addEventListener('visibilitychange', () => { if (!document.hidden) fire(); });
}
