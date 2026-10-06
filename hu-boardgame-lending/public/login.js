'use strict';

/* กลับไปหน้าที่ตั้งใจจะเข้า (อนุญาตเฉพาะหน้า .html ในเว็บเดียวกัน กัน open redirect) */
function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') || '';
  return /^\/[\w-]+\.html(#[\w-]*)?$/.test(n) ? n : '/admin.html';
}

/* ถ้า Login อยู่แล้ว ข้ามไปหน้าเจ้าหน้าที่เลย */
api('/session').then((s) => { if (s.loggedIn) location.replace(nextUrl()); }).catch(() => {});

$('#lf').addEventListener('submit', async (e) => {
  e.preventDefault();
  const u = $('#lu').value.trim(), p = $('#lp').value, err = $('#le'), btn = $('#lb');
  err.textContent = '';
  if (!u || !p) { err.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'; return; }
  btn.disabled = true;
  try {
    await api('/login', { method: 'POST', body: { username: u, password: p } });
    location.replace(nextUrl());
  } catch (er) {
    err.textContent = er.message;
    $('#lp').value = ''; $('#lp').focus();
    btn.disabled = false;
  }
});
