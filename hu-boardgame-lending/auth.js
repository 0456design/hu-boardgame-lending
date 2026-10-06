// auth.js — TEST LOGIN สำหรับเจ้าหน้าที่ + ตัวระบุผู้โหวต (ยังไม่ใช่ระบบสมาชิกจริง)
//
// ภายหลังถ้าจะเปลี่ยนเป็นระบบผู้ใช้จริง/ฐานข้อมูล ให้แก้เฉพาะไฟล์นี้:
//   - checkCredentials()  -> เปลี่ยนไปตรวจกับตารางผู้ใช้
//   - getVoterId()        -> เปลี่ยนไปใช้ id ของผู้ใช้ที่ล็อกอินแทนคุกกี้นิรนาม
// ส่วนอื่น (server.js / db.js / หน้าเว็บ) ไม่ต้องแก้

const crypto = require('node:crypto');

// ---- บัญชีเจ้าหน้าที่ (ไม่แสดงในหน้าเว็บใดๆ) ----
// เปลี่ยนโดยไม่ต้องแก้โค้ดได้ด้วย env:  STAFF_ACCOUNTS="user1:รหัส1,user2:รหัส2"
const DEFAULT_ACCOUNTS = [
  { username: 'hucom1', password: '12345' },
  { username: 'hucom2', password: '54321' },
];
function loadAccounts() {
  const raw = (process.env.STAFF_ACCOUNTS || '').trim();
  if (!raw) return DEFAULT_ACCOUNTS;
  const list = raw.split(',').map((pair) => {
    const i = pair.indexOf(':');
    return i > 0 ? { username: pair.slice(0, i).trim(), password: pair.slice(i + 1) } : null;
  }).filter((a) => a && a.username && a.password);
  return list.length ? list : DEFAULT_ACCOUNTS;
}
const ACCOUNTS = loadAccounts();

const STAFF_COOKIE = 'hu_staff';
const VOTER_COOKIE = 'hu_voter';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // ล็อกอินค้างได้ 8 ชั่วโมง
const VOTER_MAX_AGE_SEC = 60 * 60 * 24 * 365 * 5;

const sessions = new Map(); // token -> หมดอายุเมื่อ (ms)

/* ---------- cookies ---------- */
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return !!req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function serializeCookie(name, value, { maxAgeSec, secure }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

function appendSetCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : [cookie]);
}

/* ---------- staff login ---------- */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkCredentials(username, password) {
  // เทียบกับทุกบัญชีเสมอ (ไม่หยุดทันทีเมื่อเจอ) เพื่อไม่ให้เวลาตอบสนองบอกใบ้ว่าชื่อผู้ใช้ถูกหรือไม่
  let ok = false;
  for (const a of ACCOUNTS) {
    const match = safeEqual(username, a.username) && safeEqual(password, a.password);
    ok = ok || match;
  }
  return ok;
}

function purgeExpired() {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
}

function loginSuccess(req, res) {
  purgeExpired();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  appendSetCookie(res, serializeCookie(STAFF_COOKIE, token, { maxAgeSec: SESSION_TTL_MS / 1000, secure: isSecure(req) }));
}

function isStaff(req) {
  const token = parseCookies(req)[STAFF_COOKIE];
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function logout(req, res) {
  const token = parseCookies(req)[STAFF_COOKIE];
  if (token) sessions.delete(token);
  appendSetCookie(res, serializeCookie(STAFF_COOKIE, '', { maxAgeSec: 0, secure: isSecure(req) }));
}

/* ---------- กันเดารหัสผ่านแบบรัวๆ: ผิด 5 ครั้ง รอ 60 วินาที ---------- */
const fails = new Map(); // ip -> { n, until }
function lockedFor(ip) {
  const f = fails.get(ip);
  if (!f || !f.until) return 0;
  const left = Math.ceil((f.until - Date.now()) / 1000);
  if (left <= 0) { fails.delete(ip); return 0; }
  return left;
}
function recordFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) f.until = Date.now() + 60 * 1000;
  fails.set(ip, f);
}
function clearFails(ip) { fails.delete(ip); }

/* ---------- ตัวระบุผู้โหวต (ไม่มีระบบสมาชิก -> ใช้คุกกี้นิรนามต่อเบราว์เซอร์) ---------- */
function getVoterId(req, res) {
  const cur = parseCookies(req)[VOTER_COOKIE];
  if (cur && /^[a-f0-9]{32}$/.test(cur)) return cur;
  const id = crypto.randomBytes(16).toString('hex');
  appendSetCookie(res, serializeCookie(VOTER_COOKIE, id, { maxAgeSec: VOTER_MAX_AGE_SEC, secure: isSecure(req) }));
  return id;
}

module.exports = { checkCredentials, loginSuccess, isStaff, logout, lockedFor, recordFail, clearFails, getVoterId };
