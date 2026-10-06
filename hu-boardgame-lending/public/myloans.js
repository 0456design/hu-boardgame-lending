'use strict';
layout('loans');
const M = { loans: null, q: '', tab: 'all', kind: 'all' };
const KINDS = [['all', 'ทั้งหมด'], ['game', 'บอร์ดเกม'], ['equipment', 'อุปกรณ์']];
const TABS = [['all', 'ทั้งหมด'], ['active', 'กำลังยืม'], ['soon', 'ใกล้ครบกำหนด'], ['overdue', 'เกินกำหนด'], ['returned', 'คืนแล้ว']];

/* ---------- logic ---------- */
async function search(q, silent) {
  M.q = q.trim(); if (!M.q) return;
  localStorage.setItem('hu_borrower', M.q);
  if (!silent) { $('#list').innerHTML = skel(3, 'sk-row'); $('#summary').innerHTML = skel(4, 'sk-stat'); }
  try {
    const enc = encodeURIComponent(M.q), eqCode = /^eq[-#\s]*(\d+)$/i.exec(M.q);
    const both = async (g, e) => [...tagKind(await api(g), 'game'), ...tagKind(await api(e), 'equipment')];
    let r = eqCode ? [] : await both('/loans?borrower=' + enc, '/equipment-loans?borrower=' + enc);
    if (!r.length && eqCode) r = tagKind(await api('/equipment-loans?code=' + eqCode[1]), 'equipment');   // รหัสอุปกรณ์ เช่น EQ-12
    else if (!r.length && /^\d+$/.test(M.q)) r = await both('/loans?code=' + M.q, '/equipment-loans?code=' + M.q);
    r.sort((a, b) => String(b.borrowed_at).localeCompare(String(a.borrowed_at)));
    M.loans = r; render();
  } catch { if (silent) return; M.loans = null; $('#summary').innerHTML = ''; $('#tabs').innerHTML = ''; $('#kinds').innerHTML = ''; $('#list').innerHTML = errorState(); }
}
/* ผู้ใช้ "แจ้งคืน" ได้อย่างเดียว — ไม่เปลี่ยนสถานะการยืม การคืนเสร็จสมบูรณ์เมื่อเจ้าหน้าที่ตรวจสอบและรับคืนในระบบเจ้าหน้าที่เท่านั้น */
function notifyReturn(l) {
  openDialog(`<div class="dlg-body"><div class="dlg-head"><h2>${isEq(l) ? 'แจ้งคืนอุปกรณ์' : 'แจ้งคืนเกม'}</h2>${closeBtn}</div>
    ${kv(isEq(l) ? [['อุปกรณ์', esc(l.game_name)], ['รายการ', esc(l.copy_label)], ['กำหนดคืน', fmt(l.due_at)]] : [['เกม', esc(l.game_name)], ['ชุด', esc(l.copy_label)], ['กำหนดคืน', fmt(l.due_at)]])}
    <p class="notice"><b>${isEq(l) ? 'กรุณานำอุปกรณ์พร้อมอุปกรณ์เสริมทั้งหมดมาคืนกับเจ้าหน้าที่' : 'กรุณานำเกมพร้อมอุปกรณ์ทั้งหมดมาคืนกับเจ้าหน้าที่ห้องสมุด'} การคืนจะเสร็จสมบูรณ์เมื่อเจ้าหน้าที่ตรวจสอบและรับคืนแล้ว</b></p>
    <div class="dlg-actions"><button class="btn btn-primary" data-close>รับทราบ</button></div></div>`);
}

/* ---------- rendering ---------- */
function loanCard(l) {
  const s = loanState(l);
  return `<article class="loan ${s}" aria-label="${esc(itemTitle(l))}"><div>
    <h3>${isEq(l) ? esc(l.copy_label || l.game_name) : `${esc(l.game_name)} <small>· ${esc(l.copy_label)}</small>`} ${kindTag(l)}</h3>
    <div class="meta"><span>รหัสนักศึกษา: ${esc(l.borrower_name)}</span><span>รหัสการยืม ${loanCode(l)}</span><span>ยืมเมื่อ ${fmt(l.borrowed_at)}</span><span>กำหนดคืน ${fmt(l.due_at)}</span></div>
    <p style="margin-top:6px;font-weight:500">${icon('clock', 16)} ${remain(l)}</p></div>
    <div class="side">${loanBadge(l)}${l.returned_at ? '' : `<button class="btn btn-outline btn-sm" data-return="${l.kind}:${l.id}">${isEq(l) ? 'แจ้งคืนอุปกรณ์' : 'แจ้งคืนเกม'}</button>`}</div></article>`;
}
function render() {
  const box = $('.loans-box'), keep = box ? box.scrollTop : 0; // ไม่ให้รายการเด้งขึ้นบนสุดตอนอัปเดต
  const L = M.loans.filter((l) => M.kind === 'all' || l.kind === M.kind), c = (s) => L.filter((l) => loanState(l) === s).length;
  $('#kinds').innerHTML = KINDS.map(([k, t]) => `<button class="tab" data-kind="${k}" aria-pressed="${M.kind === k}">${t}</button>`).join('');
  const cell = (cls, n, t) => `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${t}</div></div>`;
  $('#summary').innerHTML = cell('', c('active') + c('soon') + c('overdue'), 'กำลังยืม') + cell('warn', c('soon'), 'ใกล้ครบกำหนด') + cell('danger', c('overdue'), 'เกินกำหนด') + cell('ok', c('returned'), 'คืนแล้ว');
  $('#tabs').innerHTML = TABS.map(([k, t]) => `<button class="tab" data-tab="${k}" aria-pressed="${M.tab === k}">${t}</button>`).join('');
  const rows = L.filter((l) => M.tab === 'all' || loanState(l) === M.tab);
  $('#list').innerHTML = rows.length ? `<div class="card loans-box" role="region" aria-label="รายการยืมของฉัน" tabindex="0">${rows.map(loanCard).join('')}</div>`
    : L.length ? emptyState('ไม่มีรายการในหมวดนี้', 'ลองเลือกหมวดอื่น')
    : emptyState('ยังไม่มีรายการยืม', 'รายการจะแสดงที่นี่เมื่อเจ้าหน้าที่ดำเนินการยืมให้แล้ว — ถ้าเพิ่งส่งคำขอ ให้ตรวจสอบสถานะที่ “คำขอของฉัน”', '<a class="btn btn-primary" href="/myrequests.html">ดูคำขอของฉัน</a>');
  if ($('.loans-box')) $('.loans-box').scrollTop = keep;
}
function initial() {
  $('#summary').innerHTML = ''; $('#tabs').innerHTML = ''; $('#kinds').innerHTML = '';
  $('#list').innerHTML = emptyState('ค้นหารายการยืมของคุณ', 'กรอกรหัสนักศึกษาด้านบน เพื่อดูเกมและอุปกรณ์ที่เจ้าหน้าที่ดำเนินการยืมให้แล้วและประวัติการคืน', '<a class="btn btn-outline" href="/#catalog">ดูบอร์ดเกม</a> <a class="btn btn-outline" href="/equipment.html">ดูอุปกรณ์</a>');
}

/* ---------- events ---------- */
$('#sf').addEventListener('submit', (e) => { e.preventDefault(); M.tab = 'all'; search($('#q').value); });
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) return search(M.q);
  const t = e.target.closest('[data-tab]'); if (t) { M.tab = t.dataset.tab; return render(); }
  const kd = e.target.closest('[data-kind]'); if (kd) { M.kind = kd.dataset.kind; return render(); }
  const r = e.target.closest('[data-return]');
  if (r) { const [k, id] = r.dataset.return.split(':'); const l = M.loans.find((x) => x.kind === k && x.id === Number(id)); if (l) notifyReturn(l); }
});
setInterval(() => M.loans && !$('dialog') && render(), 30000);
liveUpdate(() => { if (M.q && !$('dialog[open]')) search(M.q, true); });
const pre = new URLSearchParams(location.search).get('q') || localStorage.getItem('hu_borrower') || '';
$('#q').value = pre; pre ? search(pre) : initial();
