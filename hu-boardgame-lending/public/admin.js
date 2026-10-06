'use strict';
const now0 = new Date();
const A = {
  games: [], equipment: [], loans: [], requests: [], rt: 'pending', rq: '', stats: null, eq: '', es: '', borrowers: [], gq: '', gs: '', lq: '', lt: 'all',
  statsType: 'month', statsYear: now0.getFullYear(), statsMonth: now0.getMonth() + 1, periodStats: null, periodStatsKey: '', periodStatsError: false,
};
const VIEWS = { dashboard: ['dash', 'ภาพรวมระบบ'], requests: ['inbox', 'คำขอยืม'], games: ['dice', 'บอร์ดเกม'], equipment: ['laptop', 'อุปกรณ์'], loans: ['swap', 'การยืม–คืน'], borrowers: ['users', 'ผู้ยืม'], stats: ['bars', 'สถิติ'] };
const THAI_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const view = () => (VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard');
const table = (cols, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td data-label="${cols[i]}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const head = (t, p, extra = '') => `<header class="page-head"><div><h1>${t}</h1><p>${p}</p></div>${extra}</header>`;
const kpi = (cls, n, l) => `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div></div>`;

/* ---------- data ---------- */
async function loadAll(silent) {
  if (!silent) $('#view').innerHTML = head('กำลังโหลด…', '') + `<div class="kpis">${skel(5, 'sk-stat')}</div><div style="margin-top:16px">${skel(4, 'sk-row')}</div>`;
  try {
    const [games, equipment, loans, stats, borrowers, requests, eqLoans, eqRequests] = await Promise.all([api('/games'), api('/equipment'), api('/loans'), api('/stats'), api('/borrowers'), api('/requests'), api('/equipment-loans'), api('/equipment-requests')]);
    Object.assign(A, { games, equipment, stats, borrowers });
    // บอร์ดเกม + อุปกรณ์ รวมเป็นรายการเดียว (แยกด้วย kind) เรียงใหม่ → เก่า
    A.loans = [...tagKind(loans, 'game'), ...tagKind(eqLoans, 'equipment')].sort((a, b) => String(b.borrowed_at).localeCompare(String(a.borrowed_at)));
    A.requests = [...tagKind(requests, 'game'), ...tagKind(eqRequests, 'equipment')].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    render();
  }
  catch { if (!silent) $('#view').innerHTML = errorState(); }
}
/* อัปเดตอัตโนมัติเมื่อมีการเปลี่ยนแปลง (เช่น เจ้าหน้าที่อีกคนรับคืนเกม) — ไม่แทรกตอนกำลังพิมพ์/เลือกในช่องค้นหา */
const typingInView = () => { const a = document.activeElement; return !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && !!a.closest('#view'); };
let liveDirty = false;
async function liveRefresh() {
  if (typingInView()) { liveDirty = true; return; }
  liveDirty = false;
  await loadAll(true);
  if (view() === 'stats') loadPeriodStats();
}
document.addEventListener('focusout', () => setTimeout(() => { if (liveDirty && !typingInView()) liveRefresh(); }, 50));
async function act(fn, okMsg) { try { await fn(); toast(okMsg, 'ok'); await loadAll(); } catch (e) { toast(e.message, 'err'); } }

/* ---------- views ---------- */
function dashboard() {
  const s = A.stats, act = A.loans.filter((l) => !l.returned_at);
  const over = act.filter((l) => loanState(l) === 'overdue'), soon = act.filter((l) => loanState(l) === 'soon');
  const maint = A.games.flatMap((g) => g.copies.filter((c) => c.status === 'maintenance').map((c) => ({ g, c })));
  const row = (a, b, c) => `<div class="todo"><span>${a}<br><small>${b}</small></span>${c}</div>`;
  const pend = A.requests.filter((r) => r.status === 'pending');
  const todo = [...pend.slice(0, 5).map((r) => row('คำขอยืม: ' + esc(r.game_name) + ' · ' + esc(r.copy_label) + ' ' + kindTag(r), `${esc(r.student_id)} · ส่งเมื่อ ${fmt(r.created_at)}`, `<button class="btn btn-primary btn-sm" data-rq="open:${r.id}:${r.kind}">ตรวจสอบ</button>`)),
    ...over.map((l) => row(esc(l.game_name) + ' · ' + esc(l.copy_label) + ' ' + kindTag(l), `${esc(l.borrower_name)} · ${remain(l)}`, `<button class="btn btn-danger btn-sm" data-ret="${l.kind}:${l.id}">รับคืน</button>`)),
    ...soon.map((l) => row(esc(l.game_name) + ' · ' + esc(l.copy_label) + ' ' + kindTag(l), `${esc(l.borrower_name)} · ${remain(l)}`, badge('warn', 'ใกล้ครบกำหนด'))),
    ...maint.map(({ g, c }) => row(esc(g.name) + ' · ' + esc(c.label), 'อยู่ระหว่างซ่อมบำรุง', `<button class="btn btn-outline btn-sm" data-cs="${c.id}:available">เปิดให้ยืม</button>`))];
  return head('ภาพรวมระบบ', 'สรุปสถานะบอร์ดเกม อุปกรณ์ และรายการยืมล่าสุด') +
    `<section class="kpis" aria-label="ตัวชี้วัดหลัก">${kpi('', s.totalGames, 'บอร์ดเกมทั้งหมด')}${kpi('ok', s.available, 'ชุดที่พร้อมให้ยืม')}${kpi('warn', s.borrowed, 'กำลังถูกยืม')}${kpi('danger', s.overdue, 'เกินกำหนด')}${kpi('', s.borrowers, 'ผู้ยืมทั้งหมด')}</section>
    <div class="two"><section class="card" aria-labelledby="h-todo"><h2 id="h-todo">รายการที่ต้องดำเนินการ</h2>${todo.length ? todo.join('') : emptyState('ไม่มีรายการค้าง', 'ทุกอย่างเรียบร้อยดี')}</section>
    <section class="card" aria-labelledby="h-rec"><h2 id="h-rec">การยืมล่าสุด</h2>${A.loans.slice(0, 6).map((l) => row(esc(itemTitle(l)) + ' ' + kindTag(l), `${esc(l.borrower_name)} · ${fmt(l.borrowed_at)}`, loanBadge(l))).join('') || emptyState('ยังไม่มีรายการยืม', '')}</section></div>`;
}
function gamesView() {
  const list = A.games.filter((g) => (!A.gq || g.name.toLowerCase().includes(A.gq.toLowerCase())) && (!A.gs || gameInfo(g)[A.gs] > 0));
  const rows = list.map((g) => { const i = gameInfo(g); return [`<b>${esc(g.name)}</b>`, catTag(g), i.total, i.available, i.borrowed, i.maintenance, gameStatus(g),
    `<div class="acts"><button class="btn btn-outline btn-sm" data-g="view:${g.id}">ดู</button><button class="btn btn-outline btn-sm" data-g="edit:${g.id}">แก้ไข</button><button class="btn btn-outline btn-sm" data-g="img:${g.id}">รูปภาพ</button><button class="btn btn-outline btn-sm" data-g="copy:${g.id}">เพิ่มชุด</button><button class="btn btn-outline btn-sm" style="color:var(--danger)" data-g="del:${g.id}">ลบ</button></div>`]; });
  return head('บอร์ดเกม', 'จัดการรายชื่อเกมและชุดเกมทั้งหมด', '<button class="btn btn-primary" data-g="new:0">+ เพิ่มบอร์ดเกม</button>') +
    `<div class="toolbar"><label class="sr" for="gq">ค้นหาเกม</label><input class="input" id="gq" type="search" placeholder="ค้นหาชื่อเกม" value="${esc(A.gq)}"><label class="sr" for="gs">สถานะ</label><select class="select" id="gs"><option value="">ทุกสถานะ</option><option value="available" ${A.gs === 'available' ? 'selected' : ''}>มีชุดพร้อมให้ยืม</option><option value="borrowed" ${A.gs === 'borrowed' ? 'selected' : ''}>มีชุดถูกยืม</option><option value="maintenance" ${A.gs === 'maintenance' ? 'selected' : ''}>มีชุดซ่อมบำรุง</option></select></div>` +
    (rows.length ? table(['เกม', 'ประเภท', 'จำนวนชุด', 'พร้อมให้ยืม', 'ถูกยืม', 'ซ่อมบำรุง', 'สถานะ', ''], rows) : `<div class="card">${emptyState('ไม่พบบอร์ดเกม', 'ลองเปลี่ยนคำค้นหา หรือเพิ่มเกมใหม่')}</div>`);
}
function equipmentView() {
  const list = A.equipment.filter((e) => (!A.eq || e.name.toLowerCase().includes(A.eq.toLowerCase())) && (!A.es || gameInfo(e)[A.es] > 0));
  const rows = list.map((e) => { const i = gameInfo(e); return [`<b>${esc(e.name)}</b>`, i.total, i.available, i.borrowed, i.maintenance, gameStatus(e),
    `<div class="acts"><button class="btn btn-outline btn-sm" data-e="view:${e.id}">ดู</button><button class="btn btn-outline btn-sm" data-e="edit:${e.id}">แก้ไข</button><button class="btn btn-outline btn-sm" data-e="copy:${e.id}">เพิ่มรายการ</button><button class="btn btn-outline btn-sm" style="color:var(--danger)" data-e="del:${e.id}">ลบ</button></div>`]; });
  return head('อุปกรณ์', 'จัดการรายการอุปกรณ์และสถานะแต่ละรายการ', '<button class="btn btn-primary" data-e="new:0">+ เพิ่มอุปกรณ์</button>') +
    `<div class="toolbar"><label class="sr" for="eqq">ค้นหาอุปกรณ์</label><input class="input" id="eqq" type="search" placeholder="ค้นหาชื่ออุปกรณ์" value="${esc(A.eq)}"><label class="sr" for="eqs">สถานะ</label><select class="select" id="eqs"><option value="">ทุกสถานะ</option><option value="available" ${A.es === 'available' ? 'selected' : ''}>มีรายการพร้อมให้ยืม</option><option value="borrowed" ${A.es === 'borrowed' ? 'selected' : ''}>มีรายการถูกยืม</option><option value="maintenance" ${A.es === 'maintenance' ? 'selected' : ''}>มีรายการซ่อมบำรุง</option></select></div>` +
    (rows.length ? table(['อุปกรณ์', 'จำนวน', 'พร้อมให้ยืม', 'ถูกยืม', 'ซ่อมบำรุง', 'สถานะ', ''], rows) : `<div class="card">${emptyState('ไม่พบอุปกรณ์', 'ลองเปลี่ยนคำค้นหา หรือเพิ่มอุปกรณ์ใหม่')}</div>`);
}
function loansView() {
  const list = A.loans.filter((l) => (A.lt === 'all' || loanState(l) === A.lt) && (!A.lq || `${l.borrower_name} ${l.game_name} ${l.copy_label || ''} ${loanCode(l)}`.toLowerCase().includes(A.lq.toLowerCase())));
  const rows = list.map((l) => [loanCode(l), `${esc(l.game_name)} ${kindTag(l)}`, esc(l.copy_label), esc(l.borrower_name), fmt(l.borrowed_at), fmt(l.due_at), loanBadge(l), l.returned_at ? '' : `<button class="btn btn-primary btn-sm" data-ret="${l.kind}:${l.id}">รับคืน</button>`]);
  return head('การยืม–คืน', 'ติดตามรายการยืมบอร์ดเกมและอุปกรณ์ทั้งหมด และบันทึกการคืน') +
    `<div class="toolbar"><label class="sr" for="lq">ค้นหา</label><input class="input" id="lq" type="search" placeholder="ค้นหาผู้ยืม เกม หรือรหัส" value="${esc(A.lq)}"><div class="tabs" role="group" aria-label="กรองสถานะ">${[['all', 'ทั้งหมด'], ['active', 'กำลังยืม'], ['soon', 'ใกล้ครบกำหนด'], ['overdue', 'เกินกำหนด'], ['returned', 'คืนแล้ว']].map(([k, t]) => `<button class="tab" data-lt="${k}" aria-pressed="${A.lt === k}">${t}</button>`).join('')}</div></div>` +
    (rows.length ? table(['รหัสการยืม', 'เกม / อุปกรณ์', 'ชุด / รายการ', 'ผู้ยืม', 'วันที่ยืม', 'กำหนดคืน', 'สถานะ', ''], rows) : `<div class="card">${emptyState('ไม่พบรายการยืม', 'ยังไม่มีรายการที่ตรงกับเงื่อนไข')}</div>`);
}
/* ---------- คำขอยืม (จากผู้ใช้) ---------- */
const RQ_TABS = [['pending', 'รอดำเนินการ'], ['approved', 'อนุมัติแล้ว'], ['rejected', 'ปฏิเสธ'], ['cancelled', 'ยกเลิก'], ['all', 'ทั้งหมด']];
function requestsView() {
  const q = A.rq.toLowerCase();
  const list = A.requests.filter((r) => (A.rt === 'all' || r.status === A.rt) && (!q || `${r.student_id} ${r.game_name} ${reqCode(r)} ${r.faculty} ${r.major}`.toLowerCase().includes(q)));
  const cnt = (k) => (k === 'all' ? A.requests.length : A.requests.filter((r) => r.status === k).length);
  const acts = (r) => r.status === 'pending'
    ? `<button class="btn btn-primary btn-sm" data-rq="approve:${r.id}:${r.kind}" title="อนุมัติ / ดำเนินการยืม">อนุมัติ</button><button class="btn btn-outline btn-sm" style="color:var(--danger)" data-rq="reject:${r.id}:${r.kind}">ปฏิเสธ</button><button class="btn btn-outline btn-sm" data-rq="cancel:${r.id}:${r.kind}">ยกเลิก</button>`
    : r.status === 'approved' ? ''
    : `<button class="btn btn-outline btn-sm" data-rq="reopen:${r.id}:${r.kind}">เปิดเป็นรอดำเนินการ</button>`;
  const rows = list.map((r) => [reqCode(r), `<b>${esc(r.game_name)}</b> ${kindTag(r)}`, esc(r.copy_label), esc(r.student_id), `${esc(r.year_level)}<br><small>${esc(r.faculty)} · ${esc(r.major)}</small>`, fmt(r.created_at), reqBadge(r) + (r.staff_note ? `<br><small>${esc(r.staff_note)}</small>` : ''),
    `<div class="acts"><button class="btn btn-outline btn-sm" data-rq="view:${r.id}:${r.kind}">ดู</button>${acts(r)}</div>`]);
  return head('คำขอยืม', 'คำขอยืมบอร์ดเกมและอุปกรณ์ที่ผู้ใช้ส่งมา — การยืมจะเกิดขึ้นจริงเมื่อเจ้าหน้าที่กด “อนุมัติ / ดำเนินการยืม” เท่านั้น') +
    `<div class="toolbar"><label class="sr" for="rq">ค้นหา</label><input class="input" id="rq" type="search" placeholder="ค้นหารหัสนักศึกษา เกม หรือรหัสคำขอ" value="${esc(A.rq)}"><div class="tabs" role="group" aria-label="กรองสถานะคำขอ">${RQ_TABS.map(([k, t]) => `<button class="tab" data-rt="${k}" aria-pressed="${A.rt === k}">${t} (${cnt(k)})</button>`).join('')}</div></div>` +
    (rows.length ? table(['รหัสคำขอ', 'เกม / อุปกรณ์', 'ชุด / รายการ', 'รหัสนักศึกษา', 'ชั้นปี / คณะ / สาขา', 'วันที่ส่ง', 'สถานะ', ''], rows) : `<div class="card">${emptyState('ไม่มีคำขอ', A.rt === 'pending' ? 'ยังไม่มีคำขอที่รอดำเนินการ' : 'ไม่มีคำขอที่ตรงกับเงื่อนไข')}</div>`);
}
function requestDialog(r, mode) {
  const eq = isEq(r);
  const info = kv([['รหัสคำขอ', reqCode(r)], [eq ? 'อุปกรณ์' : 'เกม', esc(r.game_name)], [eq ? 'รายการที่ขอ' : 'ชุดที่ขอ', esc(r.copy_label || '-')], ['รหัสนักศึกษา', esc(r.student_id)], ['ชั้นปี', esc(r.year_level)], ['คณะ', esc(r.faculty)], ['สาขา', esc(r.major)], ['วันที่ส่งคำขอ', fmt(r.created_at)], ['สถานะ', reqBadge(r)], ['หมายเหตุ', r.staff_note ? esc(r.staff_note) : '<span class="muted">ไม่มี</span>']]);
  if (mode === 'view') { openDialog(`<div class="dlg-body"><div class="dlg-head"><h2>รายละเอียดคำขอ</h2>${closeBtn}</div>${info}<div class="dlg-actions"><button class="btn btn-outline" data-close>ปิด</button></div></div>`); return; }
  const game = eq ? A.equipment.find((g) => g.id === r.equipment_id) : A.games.find((g) => g.id === r.game_id), free = game ? game.copies.filter((c) => c.status === 'available') : [];
  const T = { approve: ['อนุมัติ / ดำเนินการยืม', 'approved', 'ยืนยันการยืม', 'ดำเนินการยืมเรียบร้อยแล้ว'], reject: ['ปฏิเสธคำขอ', 'rejected', 'ปฏิเสธคำขอ', 'ปฏิเสธคำขอแล้ว'], cancel: ['ยกเลิกคำขอ', 'cancelled', 'ยกเลิกคำขอ', 'ยกเลิกคำขอแล้ว'], reopen: ['เปิดคำขอกลับเป็นรอดำเนินการ', 'pending', 'เปิดเป็นรอดำเนินการ', 'เปิดคำขอกลับเป็นรอดำเนินการแล้ว'] }[mode];
  const pick = mode === 'approve' ? (free.length ? `<div class="field"><label for="rcopy">${eq ? 'รายการที่จะให้ยืม' : 'ชุดที่จะให้ยืม'}</label><select class="select" id="rcopy">${free.map((c) => `<option value="${c.id}" ${c.id === r.copy_id ? 'selected' : ''}>${esc(c.label)}${c.id === r.copy_id ? ' (ที่ผู้ใช้ขอ)' : ''}</option>`).join('')}</select><span class="hint">${eq ? 'รายการ' : 'ชุด'}จะเปลี่ยนเป็น “กำลังถูกยืม” ทันที และกำหนดคืนภายใน 2 ชั่วโมงนับจากตอนนี้${r.copy_id && !free.some((c) => c.id === r.copy_id) ? ` · ${eq ? 'รายการ' : 'ชุด'}ที่ผู้ใช้ขอไม่ว่างแล้ว จึงเลือกอีกรายการของ${eq ? 'อุปกรณ์ชนิดเดียวกัน' : 'เกมเดียวกัน'}ได้` : ''}</span></div>` : `<p class="notice err">ขณะนี้ไม่มี${eq ? 'รายการ' : 'ชุด'}ว่างของ${eq ? 'อุปกรณ์' : 'เกม'}นี้ จึงอนุมัติไม่ได้ — ปฏิเสธคำขอ หรือรอให้มี${eq ? 'รายการ' : 'ชุด'}ว่าง</p>`) : '';
  const noteField = mode === 'reopen' ? '' : `<div class="field"><label for="rnote">หมายเหตุถึงผู้ขอ${mode === 'approve' ? ' (ไม่บังคับ)' : ''}</label><textarea id="rnote" rows="2" maxlength="300" placeholder="${mode === 'reject' ? 'เช่น เหตุผลที่ปฏิเสธ' : ''}"></textarea></div>`;
  const d = openDialog(`<div class="dlg-body"><div class="dlg-head"><h2>${T[0]}</h2>${closeBtn}</div>${info}${pick}${noteField}<p class="err-text" id="rerr" role="alert"></p>
    <div class="dlg-actions"><button class="btn btn-outline" data-close>ปิด</button><button class="btn ${mode === 'reject' ? 'btn-danger' : 'btn-primary'}" data-rqgo ${mode === 'approve' && !free.length ? 'disabled' : ''}>${T[2]}</button></div></div>`);
  $('[data-rqgo]', d).onclick = async () => {
    const body = { status: T[1], note: $('#rnote', d)?.value.trim() || undefined, copy_id: $('#rcopy', d)?.value };
    try { await api((eq ? '/equipment-requests/' : '/requests/') + r.id, { method: 'PATCH', body }); d.close(); toast(T[3], 'ok'); await loadAll(); }
    catch (e) { $('#rerr', d).textContent = e.message; }
  };
}

function borrowersView() {
  const rows = A.borrowers.map((b) => [`<b>${esc(b.name)}</b>`, b.total_loans + ' ครั้ง', b.active_loans ? badge('info', 'กำลังยืม') : badge('muted', 'ไม่มีรายการค้าง'), fmt(b.last_borrowed_at)]);
  return head('ผู้ยืม', 'สรุปจากชื่อที่ระบุในประวัติการยืม (ยังไม่มีระบบสมาชิก)') + (rows.length ? table(['ผู้ยืม', 'ยืมแล้ว', 'สถานะ', 'ยืมล่าสุด'], rows) : `<div class="card">${emptyState('ยังไม่มีผู้ยืม', 'รายชื่อจะแสดงเมื่อมีการยืมเกม')}</div>`);
}
/* ---------- stats (monthly / yearly) ---------- */
const apiType = () => (A.statsType === 'year' ? 'year' : 'month');
const statsKey = () => `${apiType()}:${A.statsYear}:${A.statsMonth}`;
async function loadPeriodStats() {
  const key = statsKey();
  try { A.periodStats = await api(`/stats/period?type=${apiType()}&year=${A.statsYear}&month=${A.statsMonth}`); A.periodStatsError = false; }
  catch { A.periodStatsError = true; }
  A.periodStatsKey = key;
  if (view() === 'stats') render();
}
function atPresentPeriod() {
  if (A.statsYear > now0.getFullYear()) return true;
  if (A.statsType === 'year') return A.statsYear >= now0.getFullYear();
  return A.statsYear === now0.getFullYear() && A.statsMonth >= now0.getMonth() + 1;
}
function shiftPeriod(dir) {
  if (A.statsType !== 'year') {
    A.statsMonth += dir;
    if (A.statsMonth < 1) { A.statsMonth = 12; A.statsYear--; }
    if (A.statsMonth > 12) { A.statsMonth = 1; A.statsYear++; }
  } else A.statsYear += dir;
  render();
}
function periodLabel() { return A.statsType === 'year' ? `ปี ${A.statsYear + 543}` : `${THAI_MONTH_FULL[A.statsMonth - 1]} ${A.statsYear + 543}`; }
function deltaTag(curr, prev, invert) {
  if (!prev && !curr) return '<span class="muted" style="font-size:.78rem">ไม่มีข้อมูลเทียบ</span>';
  if (!prev) return `<span style="font-size:.78rem;font-weight:600;color:${invert ? 'var(--danger)' : 'var(--ok)'}">▲ ใหม่จากช่วงก่อน</span>`;
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return '<span class="muted" style="font-size:.78rem">เท่ากับช่วงก่อน</span>';
  const up = pct > 0, good = invert ? !up : up;
  return `<span style="font-size:.78rem;font-weight:600;color:${good ? 'var(--ok)' : 'var(--danger)'}">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span> <span class="muted" style="font-size:.78rem">จากช่วงก่อน</span>`;
}
const statCard = (cls, n, l, deltaHtml) => `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${l}</div><div style="margin-top:6px">${deltaHtml}</div></div>`;
function barChart(trend) {
  const max = Math.max(1, ...trend.map((t) => t.count));
  const W = 760, H = 220, padL = 10, padR = 10, padT = 10, padB = 28, innerW = W - padL - padR, innerH = H - padT - padB;
  const n = trend.length, gap = n > 20 ? 2 : 6, bw = Math.max(2, (innerW - gap * (n - 1)) / n);
  const bars = trend.map((t, i) => {
    const h = (t.count / max) * innerH, x = padL + i * (bw + gap), y = padT + innerH - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="2" fill="var(--primary)"><title>${esc(t.label)}: ${t.count} ครั้ง</title></rect>`;
  }).join('');
  const step = n <= 12 ? 1 : Math.ceil(n / 8);
  const labels = trend.map((t, i) => {
    if (i % step !== 0 && i !== n - 1) return '';
    const x = padL + i * (bw + gap) + bw / 2;
    return `<text x="${x.toFixed(1)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="var(--muted)">${esc(t.label)}</text>`;
  }).join('');
  return max === 1 && !trend.some((t) => t.count) ? ''
    : `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="กราฟจำนวนการยืมตามช่วงเวลา">${bars}${labels}</svg>`;
}
function periodBar() {
  return `<div class="toolbar" style="justify-content:space-between">
    <div class="tabs" role="group" aria-label="มุมมองสถิติ">
      <button class="tab" data-stats-type="day" aria-pressed="${A.statsType === 'day'}">รายวัน</button>
      <button class="tab" data-stats-type="month" aria-pressed="${A.statsType === 'month'}">สรุปรายเดือน</button>
      <button class="tab" data-stats-type="year" aria-pressed="${A.statsType === 'year'}">รายปี</button>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <button class="icon-btn" data-stats-nav="-1" aria-label="ช่วงก่อนหน้า">${icon('chevronLeft', 20)}</button>
      <strong style="min-width:150px;text-align:center">${periodLabel()}</strong>
      <button class="icon-btn" data-stats-nav="1" aria-label="ช่วงถัดไป" ${atPresentPeriod() ? 'disabled' : ''}>${icon('chevronRight', 20)}</button>
    </div></div>`;
}
const WEEKDAY_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const pctOf = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);
// ตารางแยกคณะ -> สาขา (แถวสาขาย่อหน้าอยู่ใต้คณะ)
function facultyTable(faculties, total) {
  if (!faculties.length) return '';
  const cell = (label, n, b, o, share, isFac) => `<tr class="${isFac ? 'brk-fac' : 'brk-maj'}">
      <td data-label="${isFac ? 'คณะ' : 'สาขา'}">${isFac ? '<b>' + esc(label) + '</b>' : esc(label)}</td>
      <td data-label="ครั้งที่ยืม">${n}</td>
      <td data-label="สัดส่วน"><span class="brk-bar" aria-hidden="true"><i style="width:${Math.min(100, share)}%"></i></span> ${share}%</td>
      <td data-label="ผู้ยืม">${b}</td>
      <td data-label="เกินกำหนด">${o}</td></tr>`;
  const rows = faculties.map((f) => cell(f.faculty, f.total, f.borrowers, f.overdue, pctOf(f.total, total), true)
    + f.majors.map((m) => cell(m.major, m.total, m.borrowers, m.overdue, pctOf(m.total, total), false)).join('')).join('');
  return `<div class="table-wrap"><table class="table brk"><thead><tr><th scope="col">คณะ / สาขา</th><th scope="col">ครั้งที่ยืม</th><th scope="col">สัดส่วน</th><th scope="col">ผู้ยืม (ไม่ซ้ำคน)</th><th scope="col">เกินกำหนด</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
// รายการรายวัน / รายเดือน แบบกดขยายดูรายละเอียดคณะและสาขา
function detailList(s) {
  const isDay = A.statsType !== 'year';
  const name = (d) => (isDay ? `วันที่ ${d.key} <span class="muted">(${WEEKDAY_TH[d.weekday]})</span>` : THAI_MONTH_FULL[d.month - 1]);
  const items = s.detail.map((d) => {
    const sum = `<span class="dt-name">${name(d)}</span><span class="dt-n"><b>${d.total}</b> ครั้ง</span><span class="dt-m">ผู้ยืม ${d.borrowers}</span><span class="dt-m ${d.overdue ? 'dt-bad' : ''}">เกินกำหนด ${d.overdue}</span>`;
    return d.total
      ? `<details class="dt"><summary>${sum}</summary><div class="dt-body">${facultyTable(d.faculties, d.total)}</div></details>`
      : `<div class="dt dt-empty"><div class="dt-row">${sum}</div></div>`;
  }).join('');
  return `<section class="card" style="padding:var(--s5);margin-top:var(--s4)" aria-labelledby="h-detail">
      <h2 id="h-detail" style="margin-bottom:4px">รายละเอียด${isDay ? 'รายวัน' : 'รายเดือน'} — ${periodLabel()}</h2>
      <p class="muted" style="margin:0 0 12px;font-size:.88rem">กดที่${isDay ? 'วัน' : 'เดือน'}เพื่อดูแยกตามคณะและสาขา</p>
      <div class="dt-list">${items}</div></section>`;
}
function statsView() {
  const isDay = A.statsType === 'day';
  const h = head('สถิติ', 'สรุปข้อมูลการยืม–คืนรายวัน รายเดือน หรือรายปี แยกตามคณะและสาขา (ข้อมูลเก็บถาวร ไม่หายแม้ลบเกมออกจากระบบ)');
  if (A.periodStatsKey !== statsKey()) {
    loadPeriodStats();
    return h + periodBar() + `<div class="kpis">${skel(4, 'sk-stat')}</div><div class="card" style="margin-top:16px;padding:var(--s5)">${skel(1, 'sk-card')}</div>`;
  }
  if (A.periodStatsError) return h + periodBar() + `<div class="card">${errorState()}</div>`;
  const s = A.periodStats;
  const chart = barChart(s.trend);
  const kpis = `<section class="kpis kpis-4" aria-label="สรุปสถิติ">
      ${statCard('', s.total, 'ครั้งที่ยืม', deltaTag(s.total, s.prev.total))}
      ${statCard('', s.borrowers, 'ผู้ยืม (ไม่ซ้ำคน)', deltaTag(s.borrowers, s.prev.borrowers))}
      ${statCard('danger', s.overdue, 'เกินกำหนดคืน', deltaTag(s.overdue, s.prev.overdue, true))}
      ${statCard('warn', s.overdueRate + '%', 'อัตราเกินกำหนด', deltaTag(s.overdueRate, s.prev.overdueRate, true))}
    </section>`;
  const trend = `<section class="card" style="padding:var(--s5);margin-top:var(--s4)" aria-labelledby="h-trend">
      <h2 id="h-trend" style="margin-bottom:12px">แนวโน้มการยืม${A.statsType === 'year' ? 'รายเดือน' : 'รายวัน'}</h2>
      ${chart || emptyState('ยังไม่มีข้อมูลในช่วงนี้', 'ลองเลือกช่วงเวลาอื่น')}
    </section>`;
  const byFac = `<section style="margin-top:var(--s4)" aria-labelledby="h-fac">
      <h2 id="h-fac" style="margin-bottom:12px">สรุปแยกตามคณะและสาขา — ${periodLabel()}</h2>
      ${s.faculties.length ? facultyTable(s.faculties, s.total) : `<div class="card">${emptyState('ยังไม่มีข้อมูลในช่วงนี้', 'ลองเลือกช่วงเวลาอื่น')}</div>`}
    </section>`;
  return h + periodBar() + kpis + (isDay ? detailList(s) : trend + byFac + (A.statsType === 'year' ? detailList(s) : ''));
}
function render() {
  const v = view();
  const pendN = A.requests.filter((r) => r.status === 'pending').length;
  $('#snav').innerHTML = Object.entries(VIEWS).map(([k, [ic, t]]) => `<a href="#${k}" ${k === v ? 'aria-current="page"' : ''}>${icon(ic)} ${t}${k === 'requests' && pendN ? ` <span class="badge b-warn" style="margin-left:auto" aria-label="รอดำเนินการ ${pendN} รายการ">${pendN}</span>` : ''}</a>`).join('');
  $('#view').innerHTML = { dashboard, requests: requestsView, games: gamesView, equipment: equipmentView, loans: loansView, borrowers: borrowersView, stats: statsView }[v]();
  document.title = VIEWS[v][1] + ' | ระบบจัดการ';
}

/* ---------- dialogs ---------- */
function gameForm(g) {
  const v = (k) => esc(g?.[k] ?? '');
  const d = openDialog(`<form class="dlg-body" novalidate><div class="dlg-head"><h2>${g ? 'แก้ไขบอร์ดเกม' : 'เพิ่มบอร์ดเกม'}</h2>${closeBtn}</div>
    <div class="form-grid"><div class="field full"><label for="n">ชื่อเกม *</label><input class="input" id="n" value="${v('name')}" required></div>
    <div class="field"><label for="mn">ผู้เล่นขั้นต่ำ</label><input class="input" id="mn" type="number" min="1" value="${v('min_players')}"></div><div class="field"><label for="mx">ผู้เล่นสูงสุด</label><input class="input" id="mx" type="number" min="1" value="${v('max_players')}"></div>
    <div class="field ${g ? 'full' : ''}"><label for="pt">เวลาเล่น</label><input class="input" id="pt" placeholder="เช่น 30 นาที" value="${v('play_time')}"></div>${g ? '' : '<div class="field"><label for="cp">จำนวนชุด</label><input class="input" id="cp" type="number" min="1" max="50" value="1"></div>'}
    <div class="field full"><label for="ds">คำอธิบาย</label><textarea id="ds" rows="3">${v('description')}</textarea></div></div><p class="err-text" id="fe" role="alert"></p>
    <div class="dlg-actions"><button type="button" class="btn btn-outline" data-close>ยกเลิก</button><button class="btn btn-primary">บันทึก</button></div></form>`);
  d.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    const b = { name: $('#n', d).value.trim(), min_players: $('#mn', d).value, max_players: $('#mx', d).value, play_time: $('#pt', d).value.trim(), description: $('#ds', d).value.trim(), copies: $('#cp', d)?.value };
    if (!b.name) return ($('#fe', d).textContent = 'กรุณากรอกชื่อเกม');
    if (+b.min_players && +b.max_players && +b.min_players > +b.max_players) return ($('#fe', d).textContent = 'ผู้เล่นขั้นต่ำต้องไม่มากกว่าสูงสุด');
    d.close(); act(() => api(g ? '/games/' + g.id : '/games', { method: g ? 'PUT' : 'POST', body: b }), 'บันทึกข้อมูลเรียบร้อยแล้ว');
  };
}
function copiesDialog(g, kind = 'game') {
  const eq = kind === 'equipment', noun = eq ? 'รายการ' : 'ชุดเกม';
  const API = eq ? { copy: '/equipment-copies/', add: `/equipment/${g.id}/copies` } : { copy: '/copies/', add: `/games/${g.id}/copies` };
  const opt = (c, v, t) => `<option value="${v}" ${c.status === v ? 'selected' : ''}>${t}</option>`;
  const d = openDialog(`<div class="dlg-body"><div class="dlg-head"><h2>${esc(g.name)}</h2>${closeBtn}</div><p class="muted">${esc(g.description || '')}</p>
    <ul style="list-style:none;padding:0;margin:0">${g.copies.map((c) => `<li class="todo"><span>${esc(c.label)}</span><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${!eq && c.status === 'borrowed' ? badge('warn', 'กำลังถูกยืม') : `<label class="sr" for="c${c.id}">สถานะ ${esc(c.label)}</label><select class="select" id="c${c.id}" data-cs2="${c.id}" style="width:auto;min-height:36px">${opt(c, 'available', 'พร้อมให้ยืม')}${eq ? opt(c, 'borrowed', 'กำลังถูกยืม') : ''}${opt(c, 'maintenance', 'ซ่อมบำรุง')}</select><button class="btn btn-outline btn-sm" data-cd="${c.id}" style="color:var(--danger)">ลบ${eq ? 'รายการ' : 'ชุด'}</button>`}</span></li>`).join('') || `<li class="muted">ยังไม่มี${noun}</li>`}</ul>
    <div class="dlg-actions"><button class="btn btn-outline" data-addcopy>+ เพิ่ม${eq ? 'รายการ' : 'ชุด'}</button><button class="btn btn-primary" data-close>เสร็จสิ้น</button></div></div>`);
  d.addEventListener('change', (e) => { const id = e.target.dataset.cs2; if (id) { d.close(); act(() => api(API.copy + id, { method: 'PATCH', body: { status: e.target.value } }), `อัปเดตสถานะ${eq ? 'รายการ' : 'ชุด'}แล้ว`); } });
  d.addEventListener('click', async (e) => {
    if (e.target.closest('[data-addcopy]')) { d.close(); act(() => api(API.add, { method: 'POST' }), `เพิ่ม${noun}แล้ว`); }
    const cd = e.target.closest('[data-cd]');
    if (cd) { d.close(); if (await confirmDialog({ title: `ลบ${noun}นี้?`, body: 'การลบไม่สามารถย้อนกลับได้', ok: eq ? 'ลบรายการ' : 'ลบชุด', danger: true })) act(() => api(API.copy + cd.dataset.cd, { method: 'DELETE' }), `ลบ${noun}แล้ว`); }
  });
}

/* ---------- equipment form (เหมือนฟอร์มบอร์ดเกม เปลี่ยนเฉพาะเนื้อหา) ---------- */
function equipmentForm(e) {
  const v = (k) => esc(e?.[k] ?? '');
  const d = openDialog(`<form class="dlg-body" novalidate><div class="dlg-head"><h2>${e ? 'แก้ไขอุปกรณ์' : 'เพิ่มอุปกรณ์'}</h2>${closeBtn}</div>
    <div class="form-grid"><div class="field ${e ? 'full' : ''}"><label for="en">ชื่ออุปกรณ์ *</label><input class="input" id="en" value="${v('name')}" required></div>${e ? '' : '<div class="field"><label for="ec">จำนวน</label><input class="input" id="ec" type="number" min="1" max="50" value="1"></div>'}
    <div class="field full"><label for="ed">คำอธิบาย</label><textarea id="ed" rows="3">${v('description')}</textarea></div></div><p class="err-text" id="fe" role="alert"></p>
    <div class="dlg-actions"><button type="button" class="btn btn-outline" data-close>ยกเลิก</button><button class="btn btn-primary">บันทึก</button></div></form>`);
  d.querySelector('form').onsubmit = (ev) => {
    ev.preventDefault();
    const b = { name: $('#en', d).value.trim(), description: $('#ed', d).value.trim(), copies: $('#ec', d)?.value };
    if (!b.name) return ($('#fe', d).textContent = 'กรุณากรอกชื่ออุปกรณ์');
    d.close(); act(() => api(e ? '/equipment/' + e.id : '/equipment', { method: e ? 'PUT' : 'POST', body: b }), 'บันทึกข้อมูลเรียบร้อยแล้ว');
  };
}

/* ---------- เปลี่ยนรูปบอร์ดเกม: ลบไฟล์เดิม → เลือกไฟล์ใหม่ → อัปโหลด ---------- */
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], IMG_MAX = 5 * 1024 * 1024;
async function uploadFile(path, file) {
  let res;
  try { res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }); }
  catch { throw new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/login.html?next=/admin.html'; }
  if (!res.ok) throw new Error(data.error || 'อัปโหลดไม่สำเร็จ กรุณาลองอีกครั้ง');
  return data;
}
function imageDialog(gid) {
  const d = openDialog('<div class="dlg-body" id="imgw"></div>');
  let file = null, preview = '', err = '', busy = false;
  const cur = () => A.games.find((x) => x.id === gid);
  const clearPending = () => { if (preview) URL.revokeObjectURL(preview); file = null; preview = ''; };
  const refresh = async () => { A.games = await api('/games'); render(); };
  const draw = () => {
    const g = cur(); if (!g) return d.close();
    $('#imgw', d).innerHTML = `<div class="dlg-head"><div><h2>รูปภาพ: ${esc(g.name)}</h2></div>${closeBtn}</div>
      ${file ? `<div class="art"><img src="${preview}" alt="ตัวอย่างรูปใหม่"></div><p class="hint">ตัวอย่างรูปใหม่: ${esc(file.name)} — ยังไม่ได้บันทึก</p>` : `${art(g)}<p class="hint">${g.image_url ? 'รูปที่แสดงอยู่ในเว็บไซต์ตอนนี้' : 'ยังไม่มีรูปภาพ — หน้าเว็บจะแสดงตัวอักษรย่อของเกมแทน'}</p>`}
      <div class="field"><label for="imgf">เลือกไฟล์รูปใหม่</label><input class="input" id="imgf" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><span class="hint">รองรับ JPG, PNG, WEBP, GIF ขนาดไม่เกิน 5 MB</span><span class="err-text" role="alert">${esc(err)}</span></div>
      <div class="dlg-actions"><button class="btn btn-outline" style="color:var(--danger)" data-imgdel ${g.image_url && !busy ? '' : 'disabled'}>ลบรูปเดิม</button><button class="btn btn-primary" data-imgsave ${file && !busy ? '' : 'disabled'}>บันทึกรูปใหม่</button><button class="btn btn-outline" data-close>ปิด</button></div>`;
  };
  d.addEventListener('close', clearPending);
  d.addEventListener('change', (e) => {
    if (e.target.id !== 'imgf') return;
    const f = e.target.files[0]; clearPending(); err = '';
    if (f && !IMG_TYPES.includes(f.type)) err = 'รองรับเฉพาะไฟล์รูป JPG, PNG, WEBP หรือ GIF';
    else if (f && f.size > IMG_MAX) err = 'ไฟล์ใหญ่เกินไป (สูงสุด 5 MB)';
    else if (f) { file = f; preview = URL.createObjectURL(f); }
    draw();
  });
  d.addEventListener('click', async (e) => {
    if (e.target.closest('[data-imgsave]') && file) {
      busy = true; err = ''; draw();
      try { await uploadFile(`/games/${gid}/image`, file); clearPending(); await refresh(); toast('เปลี่ยนรูปภาพเรียบร้อยแล้ว', 'ok'); }
      catch (er) { err = er.message; }
      busy = false; draw();
    } else if (e.target.closest('[data-imgdel]')) {
      const g = cur();
      if (!(await confirmDialog({ title: 'ลบรูปเดิม?', body: `ไฟล์รูปของ “${esc(g.name)}” จะถูกลบ และหน้าเว็บจะแสดงตัวอักษรย่อแทนจนกว่าจะใส่รูปใหม่`, ok: 'ลบรูป', danger: true }))) return;
      busy = true; err = ''; draw();
      try { await api(`/games/${gid}/image`, { method: 'DELETE' }); await refresh(); toast('ลบรูปเดิมแล้ว', 'ok'); }
      catch (er) { err = er.message; }
      busy = false; draw();
    }
  });
  draw();
}

/* ---------- ออกจากระบบ: ต้องยืนยันก่อนเสมอ (ใช้กล่องยืนยันของระบบ ไม่ใช่หน้าต่างเริ่มต้นของเบราว์เซอร์) ---------- */
let loggingOut = false;
async function confirmLogout() {
  if (loggingOut || $('dialog[open]')) return;          // กันเปิดซ้อน / กดรัว
  const ok = await confirmDialog({ title: 'ต้องการออกจากระบบหรือไม่?', ok: 'ออกจากระบบ', danger: true,
    body: '<p class="muted">คุณกำลังจะออกจากระบบเจ้าหน้าที่ หากต้องการจัดการระบบอีกครั้งจะต้องเข้าสู่ระบบใหม่</p>' });
  if (!ok) { const b = $('#logout'); b && b.focus(); return; }   // ยกเลิก -> ปิดกล่อง อยู่หน้าเดิม
  loggingOut = true;
  try { await api('/logout', { method: 'POST' }); } catch {}
  location.href = '/login.html';
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  if (e.target.closest('#logout')) { return confirmLogout(); }
  if (e.target.closest('[data-retry]')) return view() === 'stats' ? loadPeriodStats() : loadAll();
  const st = e.target.closest('[data-stats-type]'); if (st) { A.statsType = st.dataset.statsType; return render(); }
  const sn = e.target.closest('[data-stats-nav]'); if (sn) return shiftPeriod(Number(sn.dataset.statsNav));
  const rt = e.target.closest('[data-rt]'); if (rt) { A.rt = rt.dataset.rt; return render(); }
  const rb = e.target.closest('[data-rq]');
  if (rb) { const [op, id, kind] = rb.dataset.rq.split(':'), r = A.requests.find((x) => x.id === +id && x.kind === kind); if (!r) return; if (op === 'open') { location.hash = '#requests'; A.rt = 'pending'; render(); } else requestDialog(r, op); return; }
  const lt = e.target.closest('[data-lt]'); if (lt) { A.lt = lt.dataset.lt; return render(); }
  const cs = e.target.closest('[data-cs]'); if (cs) { const [id, st] = cs.dataset.cs.split(':'); return act(() => api('/copies/' + id, { method: 'PATCH', body: { status: st } }), 'อัปเดตสถานะชุดแล้ว'); }
  const r = e.target.closest('[data-ret]');
  if (r) { const [k, lid] = r.dataset.ret.split(':'), l = A.loans.find((x) => x.kind === k && x.id === +lid), eq = isEq(l);
    if (await confirmDialog({ title: 'ยืนยันการรับคืน?', ok: 'ยืนยันการคืน', body: kv([[eq ? 'อุปกรณ์' : 'เกม', esc(l.game_name)], [eq ? 'รายการ' : 'ชุด', esc(l.copy_label)], ['ผู้ยืม', esc(l.borrower_name)], ['กำหนดคืน', fmt(l.due_at)]]) })) act(() => api(`/${eq ? 'equipment-loans' : 'loans'}/${l.id}/return`, { method: 'POST' }), eq ? 'คืนอุปกรณ์เรียบร้อยแล้ว' : 'คืนบอร์ดเกมเรียบร้อยแล้ว'); return; }
  const eb = e.target.closest('[data-e]');
  if (eb) {
    const [op, id] = eb.dataset.e.split(':'), q = A.equipment.find((x) => x.id === +id);
    if (op === 'new') equipmentForm(null); else if (op === 'edit') equipmentForm(q); else if (op === 'view') copiesDialog(q, 'equipment');
    else if (op === 'copy') act(() => api(`/equipment/${q.id}/copies`, { method: 'POST' }), 'เพิ่มรายการแล้ว');
    else if (op === 'del' && await confirmDialog({ title: `ลบอุปกรณ์ “${esc(q.name)}”?`, body: 'รายการทั้งหมดของอุปกรณ์นี้จะถูกลบด้วย และไม่สามารถย้อนกลับได้', ok: 'ลบอุปกรณ์', danger: true })) act(() => api('/equipment/' + q.id, { method: 'DELETE' }), 'ลบอุปกรณ์แล้ว');
    return;
  }
  const gb = e.target.closest('[data-g]'); if (!gb) return;
  const [op, id] = gb.dataset.g.split(':'), g = A.games.find((x) => x.id === +id);
  if (op === 'new') gameForm(null); else if (op === 'edit') gameForm(g); else if (op === 'view') copiesDialog(g); else if (op === 'img') imageDialog(g.id);
  else if (op === 'copy') act(() => api(`/games/${g.id}/copies`, { method: 'POST' }), 'เพิ่มชุดเกมแล้ว');
  else if (op === 'del' && await confirmDialog({ title: `ลบเกม “${esc(g.name)}”?`, body: 'ชุดเกมทั้งหมดของเกมนี้จะถูกลบด้วย และไม่สามารถย้อนกลับได้', ok: 'ลบเกม', danger: true })) act(() => api('/games/' + g.id, { method: 'DELETE' }), 'ลบเกมแล้ว');
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'gq') { A.gq = e.target.value; const p = e.target.selectionStart; render(); const n = $('#gq'); n.focus(); n.setSelectionRange(p, p); }
  if (e.target.id === 'rq') { A.rq = e.target.value; const p = e.target.selectionStart; render(); const n = $('#rq'); n.focus(); n.setSelectionRange(p, p); }
  if (e.target.id === 'lq') { A.lq = e.target.value; const p = e.target.selectionStart; render(); const n = $('#lq'); n.focus(); n.setSelectionRange(p, p); }
  if (e.target.id === 'gs') { A.gs = e.target.value; render(); $('#gs').focus(); }
  if (e.target.id === 'eqq') { A.eq = e.target.value; const p = e.target.selectionStart; render(); const n = $('#eqq'); n.focus(); n.setSelectionRange(p, p); }
  if (e.target.id === 'eqs') { A.es = e.target.value; render(); $('#eqs').focus(); }
});
window.addEventListener('hashchange', () => A.stats && render());
loadAll();
liveUpdate(liveRefresh);
