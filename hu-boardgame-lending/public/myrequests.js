'use strict';
layout('requests');
const R = { list: null, q: '', tab: 'all', kind: 'all' };
const KINDS = [['all', 'ทั้งหมด'], ['game', 'บอร์ดเกม'], ['equipment', 'อุปกรณ์']];
const RTABS = [['all', 'ทั้งหมด'], ['pending', 'รอดำเนินการ'], ['approved', 'อนุมัติแล้ว / กำลังยืม'], ['rejected', 'ปฏิเสธ'], ['cancelled', 'ยกเลิก']];

/* ---------- logic ---------- */
async function search(q, silent) {
  R.q = q.replace(/\D/g, ''); if (!R.q) return;
  localStorage.setItem('hu_borrower', R.q);
  if (!silent) { $('#list').innerHTML = skel(3, 'sk-row'); $('#summary').innerHTML = skel(4, 'sk-stat'); }
  try {
    const enc = encodeURIComponent(R.q);
    const [g, e] = await Promise.all([api('/requests?student=' + enc), api('/equipment-requests?student=' + enc)]);
    R.list = [...tagKind(g, 'game'), ...tagKind(e, 'equipment')].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    render();
  }
  catch { if (silent) return; R.list = null; $('#summary').innerHTML = ''; $('#tabs').innerHTML = ''; $('#kinds').innerHTML = ''; $('#list').innerHTML = errorState(); }
}

/* ยกเลิกได้เฉพาะคำขอที่ยัง "รอเจ้าหน้าที่ดำเนินการ" — เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น */
async function cancelRequest(r) {
  const ok = await confirmDialog({ title: 'ต้องการยกเลิกคำขอนี้หรือไม่?', ok: 'ยืนยันการยกเลิก', danger: true,
    body: kv([['รหัสคำขอ', reqCode(r)], [isEq(r) ? 'อุปกรณ์' : 'เกม', esc(r.game_name)], [isEq(r) ? 'รายการ' : 'ชุด', esc(r.copy_label)], ['วันที่ส่งคำขอ', fmt(r.created_at)]]) });
  if (!ok) return;
  try { await api(`/${isEq(r) ? 'equipment-requests' : 'requests'}/${r.id}/cancel`, { method: 'POST', body: { student_id: R.q } }); toast('ยกเลิกคำขอเรียบร้อยแล้ว', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
  search(R.q, true);
}

function detail(r) {
  const d = openDialog(`<div class="dlg-body"><div class="dlg-head"><div><h2>รายละเอียดคำขอ</h2><p class="muted">${reqCode(r)}</p></div>${closeBtn}</div>
    ${kv([['รหัสคำขอ', reqCode(r)], [isEq(r) ? 'อุปกรณ์' : 'เกม', esc(r.game_name)], [isEq(r) ? 'รายการ' : 'ชุดเกม', esc(r.copy_label)], ['รหัสนักศึกษา', esc(r.student_id)], ['ชั้นปี', esc(r.year_level)], ['คณะ', esc(r.faculty)], ['สาขา', esc(r.major)], ['วันที่ส่งคำขอ', fmt(r.created_at)], ['สถานะปัจจุบัน', reqBadge(r)], ['หมายเหตุจากเจ้าหน้าที่', r.staff_note ? esc(r.staff_note) : '<span class="muted">ไม่มี</span>']])}
    ${r.status === 'pending' ? '<p class="notice">คำขอนี้ยังรอเจ้าหน้าที่ดำเนินการ — ยังไม่ถือว่ายืมสำเร็จ</p>' : ''}
    ${r.status === 'approved' ? '<p class="notice">เจ้าหน้าที่ดำเนินการยืมให้แล้ว ดูกำหนดคืนได้ที่หน้า “การยืมของฉัน”</p>' : ''}
    <div class="dlg-actions">${r.status === 'pending' ? '<button class="btn btn-outline" style="color:var(--danger)" data-cancel>ยกเลิกคำขอ</button>' : ''}${r.status === 'approved' ? `<a class="btn btn-primary" href="/myloans.html?q=${encodeURIComponent(r.student_id)}">ไปที่การยืมของฉัน</a>` : ''}<button class="btn btn-outline" data-close>ปิด</button></div></div>`);
  const c = $('[data-cancel]', d); if (c) c.onclick = () => { d.close(); cancelRequest(r); };
}

/* ---------- rendering ---------- */
function reqCard(r) {
  const cls = r.status === 'pending' ? 'soon' : r.status === 'rejected' ? 'overdue' : r.status === 'cancelled' ? 'returned' : '';
  return `<article class="loan ${cls}" aria-label="${esc(r.game_name)}"><div>
    <h3>${isEq(r) ? esc(r.copy_label || r.game_name) : `${esc(r.game_name)} <small>· ${esc(r.copy_label)}</small>`} ${kindTag(r)}</h3>
    <div class="meta"><span>รหัสคำขอ ${reqCode(r)}</span><span>ส่งเมื่อ ${fmt(r.created_at)}</span></div>
    ${r.staff_note ? `<p style="margin-top:6px">หมายเหตุจากเจ้าหน้าที่: ${esc(r.staff_note)}</p>` : ''}</div>
    <div class="side">${reqBadge(r)}<button class="btn btn-outline btn-sm" data-detail="${r.kind}:${r.id}">ดูรายละเอียด</button>${r.status === 'pending' ? `<button class="btn btn-outline btn-sm" style="color:var(--danger)" data-cancel="${r.kind}:${r.id}">ยกเลิกคำขอ</button>` : ''}</div></article>`;
}
function render() {
  const L = R.list.filter((r) => R.kind === 'all' || r.kind === R.kind), c = (s) => L.filter((r) => r.status === s).length;
  $('#kinds').innerHTML = KINDS.map(([k, t]) => `<button class="tab" data-kind="${k}" aria-pressed="${R.kind === k}">${t}</button>`).join('');
  const cell = (cls, n, t) => `<div class="card stat ${cls}"><div class="n">${n}</div><div class="l">${t}</div></div>`;
  $('#summary').innerHTML = cell('warn', c('pending'), 'รอเจ้าหน้าที่ดำเนินการ') + cell('ok', c('approved'), 'อนุมัติแล้ว') + cell('danger', c('rejected'), 'ถูกปฏิเสธ') + cell('', c('cancelled'), 'ยกเลิก');
  $('#tabs').innerHTML = RTABS.map(([k, t]) => `<button class="tab" data-tab="${k}" aria-pressed="${R.tab === k}">${t}</button>`).join('');
  const rows = L.filter((r) => R.tab === 'all' || r.status === R.tab);
  $('#list').innerHTML = rows.length ? `<div class="card loans-box" role="region" aria-label="รายการคำขอของฉัน" tabindex="0">${rows.map(reqCard).join('')}</div>`
    : L.length ? emptyState('ไม่มีคำขอในหมวดนี้', 'ลองเลือกหมวดอื่น')
    : emptyState('ยังไม่มีคำขอยืม', 'เมื่อคุณส่งคำขอยืมบอร์ดเกมหรืออุปกรณ์ รายการจะแสดงที่นี่', '<a class="btn btn-primary" href="/#catalog">ดูบอร์ดเกม</a> <a class="btn btn-outline" href="/equipment.html">ดูอุปกรณ์</a>');
}
function initial() {
  $('#summary').innerHTML = ''; $('#tabs').innerHTML = ''; $('#kinds').innerHTML = '';
  $('#list').innerHTML = emptyState('ค้นหาคำขอของคุณ', 'กรอกรหัสนักศึกษาด้านบน เพื่อดูคำขอยืมที่ส่งไปและผลการดำเนินการ', '<a class="btn btn-outline" href="/#catalog">ดูบอร์ดเกม</a>');
}

/* ---------- events ---------- */
$('#q').addEventListener('input', (e) => { const v = e.target.value.replace(/\D/g, ''); if (v !== e.target.value) e.target.value = v; });
$('#sf').addEventListener('submit', (e) => { e.preventDefault(); R.tab = 'all'; $('#q').value.trim() ? search($('#q').value) : initial(); });
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) return search(R.q);
  const t = e.target.closest('[data-tab]'); if (t) { R.tab = t.dataset.tab; return render(); }
  const kd = e.target.closest('[data-kind]'); if (kd) { R.kind = kd.dataset.kind; return render(); }
  const pick = (v) => { const [k, id] = v.split(':'); return R.list.find((r) => r.kind === k && r.id === Number(id)); };
  const dt = e.target.closest('[data-detail]'); if (dt) return detail(pick(dt.dataset.detail));
  const cn = e.target.closest('[data-cancel]'); if (cn && cn.dataset.cancel) cancelRequest(pick(cn.dataset.cancel));
});
liveUpdate(() => { if (R.q && !$('dialog[open]')) search(R.q, true); });  /* เจ้าหน้าที่อนุมัติ/ปฏิเสธ แล้วหน้านี้เปลี่ยนเอง */
const pre = (new URLSearchParams(location.search).get('q') || localStorage.getItem('hu_borrower') || '').replace(/\D/g, '');
$('#q').value = pre; pre ? search(pre) : initial();
