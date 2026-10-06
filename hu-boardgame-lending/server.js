// server.js — plain Node.js http server (no Express, no external deps).
// Run with: node server.js   then open http://localhost:3000

// ตรวจเวอร์ชัน Node ก่อนโหลดอย่างอื่น (ต้อง 22 ขึ้นไป เพราะใช้ node:sqlite ในตัว)
const MIN_NODE = 22;
if (Number(process.versions.node.split('.')[0]) < MIN_NODE) {
  console.error(`\n❌ Node.js เวอร์ชันที่ใช้อยู่คือ v${process.versions.node} แต่โปรเจกต์นี้ต้องใช้ v${MIN_NODE} ขึ้นไป`);
  console.error('   วิธีแก้: ติดตั้ง Node.js LTS ล่าสุดจาก https://nodejs.org แล้วปิด-เปิด VS Code ใหม่ จากนั้นพิมพ์ node -v เพื่อเช็กเวอร์ชัน\n');
  process.exit(1);
}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const db = require('./db');
const auth = require('./auth');
const FACULTIES = require('./public/faculties.js'); // รายชื่อคณะ/สาขา (ใช้ร่วมกับหน้าเว็บ)
const YEAR_LEVELS = ['ปี 1', 'ปี 2', 'ปี 3', 'ปี 4', 'ปี 5 ขึ้นไป'];

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const GAME_IMG_DIR = path.join(UPLOAD_ROOT, 'games');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
fs.mkdirSync(GAME_IMG_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => (chunks += c));
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (e) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// อ่านไฟล์แบบ binary (ใช้รับรูปที่อัปโหลด) พร้อมจำกัดขนาด
function readBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const tooBig = () => Object.assign(new Error('ไฟล์ใหญ่เกินไป (สูงสุด 5 MB)'), { status: 413 });
    if (Number(req.headers['content-length']) > maxBytes) return reject(tooBig());
    const chunks = [];
    let size = 0, over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { over = true; return; } // ทิ้งส่วนเกิน ไม่เก็บลงหน่วยความจำ
      chunks.push(c);
    });
    req.on('end', () => (over ? reject(tooBig()) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

// ตรวจชนิดไฟล์จากเนื้อไฟล์จริง (ไม่เชื่อ Content-Type / นามสกุลที่ส่งมา)
function detectImageExt(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return '.gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return null;
}

// ลบไฟล์รูปเดิมของเกม (เฉพาะไฟล์ที่อยู่ในโฟลเดอร์ uploads/games เท่านั้น)
function removeGameImageFile(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/games/')) return;
  const file = path.join(GAME_IMG_DIR, path.basename(imageUrl));
  if (path.dirname(file) !== GAME_IMG_DIR) return;
  fs.rm(file, { force: true }, () => {});
}

// ---------- สิทธิ์เจ้าหน้าที่ ----------
// API ที่ใช้เฉพาะหน้าเจ้าหน้าที่ ต้อง Login ก่อน (กันเรียกตรงโดยไม่ผ่านหน้าเว็บ)
// ส่วน API ที่หน้าผู้ใช้ทั่วไปใช้ (ดูเกม / ส่งคำขอยืม / ดูคำขอและรายการยืมของตัวเอง / ยกเลิกคำขอ / ให้คะแนน) เปิดให้ใช้ได้
function needsStaff(method, pathname, query) {
  if (/^\/api\/games\/\d+\/rating$/.test(pathname)) return false; // ให้คะแนน: ผู้ใช้ทั่วไป
  // อุปกรณ์: ผู้ใช้ดูรายการได้ / ส่งคำขอ / ดูและยกเลิกคำขอของตัวเอง ส่วนจัดการอุปกรณ์และอนุมัติ/รับคืน = เจ้าหน้าที่
  if (pathname === '/api/equipment' && method === 'GET') return false;
  if (pathname === '/api/equipment-requests') {
    if (method === 'POST') return false;
    if (method === 'GET') return !String(query.student || '').trim();
    return true;
  }
  if (/^\/api\/equipment-requests\/\d+\/cancel$/.test(pathname) && method === 'POST') return false;
  if (pathname.startsWith('/api/equipment-requests/')) return true;
  if (pathname === '/api/equipment-loans' && method === 'GET') {
    const hasBorrower = !!query.borrower;
    const hasCode = !!(query.code && Number(query.code));
    return !(hasBorrower || hasCode);
  }
  if (pathname.startsWith('/api/equipment-loans')) return true;
  if (pathname.startsWith('/api/equipment')) return true;
  if (pathname.startsWith('/api/stats')) return true;
  if (pathname === '/api/borrowers') return true;
  if (pathname.startsWith('/api/copies/')) return true;
  // ยืม/รับคืนจริง = เจ้าหน้าที่เท่านั้น (ผู้ใช้ทั่วไปทำได้แค่ "ส่งคำขอยืม")
  if (pathname === '/api/loans' && method === 'POST') return true;
  if (/^\/api\/loans\/\d+\/return$/.test(pathname)) return true;
  // คำขอยืม: ผู้ใช้ส่งคำขอ / ดูของตัวเอง (ต้องระบุรหัสนักศึกษา) / ยกเลิกของตัวเองได้ ส่วนที่เหลือ (ดูทั้งหมด/เปลี่ยนสถานะ) เจ้าหน้าที่เท่านั้น
  if (pathname === '/api/requests') {
    if (method === 'POST') return false;
    if (method === 'GET') return !String(query.student || '').trim();
    return true;
  }
  if (/^\/api\/requests\/\d+\/cancel$/.test(pathname) && method === 'POST') return false;
  if (pathname.startsWith('/api/requests/')) return true;
  if (pathname.startsWith('/api/games') && method !== 'GET') return true;
  if (pathname === '/api/loans' && method === 'GET') {
    // เงื่อนไขเดียวกับตัวกรองใน listLoans: ถ้าไม่มี borrower/code ที่ใช้ได้ = ดึงรายการทั้งหมด -> เฉพาะเจ้าหน้าที่
    const hasBorrower = !!query.borrower;
    const hasCode = !!(query.code && Number(query.code));
    return !(hasBorrower || hasCode);
  }
  return false;
}

function serveStatic(req, res, pathname, root = PUBLIC_DIR, extraHeaders = {}) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(root, filePath);

  // prevent path traversal outside the served dir
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('ไม่พบหน้านี้');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...extraHeaders });
    res.end(data);
  });
}

/* ---------- เรียลไทม์ (Server-Sent Events) ----------
   ทุกหน้าที่เปิดอยู่เชื่อมต่อที่ /api/events เมื่อข้อมูลเปลี่ยน เซิร์ฟเวอร์ส่งสัญญาณ "change" (ไม่มีข้อมูลแนบ)
   แล้วแต่ละหน้าโหลดข้อมูลใหม่เองผ่าน API ปกติ — ข้อมูลของเจ้าหน้าที่จึงไม่รั่วไปทางช่องนี้ */
const liveClients = new Set();
function broadcastChange() {
  for (const c of liveClients) c.write('event: change\ndata: {}\n\n');
}
setInterval(() => { for (const c of liveClients) c.write(': ping\n\n'); }, 25000).unref(); // กันการเชื่อมต่อหลุดเพราะเงียบนาน

const server = http.createServer(async (req, res) => {
  const { pathname, query } = url.parse(req.url, true);

  // การเปลี่ยนแปลงข้อมูลที่สำเร็จ (ยืม/คืน/ให้คะแนน/แก้ไขของเจ้าหน้าที่) -> แจ้งทุกหน้า
  if (req.method !== 'GET' && pathname.startsWith('/api/') && pathname !== '/api/login' && pathname !== '/api/logout') {
    res.on('finish', () => { if (res.statusCode < 300) broadcastChange(); });
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    liveClients.add(res);
    req.on('close', () => liveClients.delete(res));
    return;
  }

  try {
    // ---------- TEST LOGIN เจ้าหน้าที่ ----------
    if (pathname === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '';
      const wait = auth.lockedFor(ip);
      if (wait) return sendJson(res, 429, { error: `ลองผิดหลายครั้งเกินไป กรุณารอ ${wait} วินาทีแล้วลองใหม่` });
      const body = await readBody(req);
      if (!auth.checkCredentials(body.username, body.password)) {
        auth.recordFail(ip);
        return sendJson(res, 401, { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
      }
      auth.clearFails(ip);
      auth.loginSuccess(req, res);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      auth.logout(req, res);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/session' && req.method === 'GET') {
      return sendJson(res, 200, { loggedIn: auth.isStaff(req) });
    }

    // API ที่เป็นของเจ้าหน้าที่ -> ต้อง Login
    if (needsStaff(req.method, pathname, query) && !auth.isStaff(req)) {
      return sendJson(res, 401, { error: 'กรุณาเข้าสู่ระบบเจ้าหน้าที่' });
    }

    // ---------- API routes ----------
    if (pathname === '/api/games' && req.method === 'GET') {
      return sendJson(res, 200, db.listGamesWithCopies(auth.getVoterId(req, res)));
    }

    // ---- ให้คะแนนเกม 1–5 ดาว (1 คนต่อ 1 เกม: โหวตซ้ำ = แก้คะแนนเดิม) ----
    let rm;
    if ((rm = pathname.match(/^\/api\/games\/(\d+)\/rating$/)) && req.method === 'POST') {
      const body = await readBody(req);
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return sendJson(res, 400, { error: 'คะแนนต้องเป็นจำนวนเต็ม 1–5' });
      }
      return sendJson(res, 200, db.setRating(Number(rm[1]), auth.getVoterId(req, res), rating));
    }

    if (pathname === '/api/games' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name) return sendJson(res, 400, { error: 'ต้องระบุชื่อเกม' });
      const min = parseInt(body.min_players, 10);
      const max = parseInt(body.max_players, 10);
      if (min && max && min > max) {
        return sendJson(res, 400, { error: 'จำนวนผู้เล่นต่ำสุดต้องไม่มากกว่าสูงสุด' });
      }
      return sendJson(res, 201, db.addGame(body));
    }

    let m;
    if ((m = pathname.match(/^\/api\/games\/(\d+)$/)) && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.name || !String(body.name).trim()) return sendJson(res, 400, { error: 'ต้องระบุชื่อเกม' });
      const min = parseInt(body.min_players, 10);
      const max = parseInt(body.max_players, 10);
      if (min && max && min > max) {
        return sendJson(res, 400, { error: 'จำนวนผู้เล่นต่ำสุดต้องไม่มากกว่าสูงสุด' });
      }
      return sendJson(res, 200, db.updateGame(Number(m[1]), { ...body, name: String(body.name).trim() }));
    }

    if ((m = pathname.match(/^\/api\/games\/(\d+)$/)) && req.method === 'DELETE') {
      const old = db.getGame(Number(m[1]));
      db.deleteGame(Number(m[1]));
      if (old) removeGameImageFile(old.image_url);
      return sendJson(res, 200, { ok: true });
    }

    // ---- รูปภาพบอร์ดเกม: อัปโหลด (แทนรูปเดิม) / ลบ ----
    if ((m = pathname.match(/^\/api\/games\/(\d+)\/image$/)) && req.method === 'POST') {
      const id = Number(m[1]);
      const game = db.getGame(id);
      if (!game) return sendJson(res, 404, { error: 'ไม่พบเกมนี้' });
      const buf = await readBuffer(req, MAX_IMAGE_BYTES);
      const ext = detectImageExt(buf);
      if (!ext) return sendJson(res, 400, { error: 'รองรับเฉพาะไฟล์รูป JPG, PNG, WEBP หรือ GIF' });
      // ชื่อไฟล์ไม่ซ้ำทุกครั้ง -> เบราว์เซอร์ไม่ดึงรูปเก่าจากแคชมาแสดง
      const fileName = `game-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      fs.writeFileSync(path.join(GAME_IMG_DIR, fileName), buf);
      const updated = db.setGameImage(id, `/uploads/games/${fileName}`);
      removeGameImageFile(game.image_url); // ลบไฟล์เก่าทิ้ง
      return sendJson(res, 200, updated);
    }

    if ((m = pathname.match(/^\/api\/games\/(\d+)\/image$/)) && req.method === 'DELETE') {
      const id = Number(m[1]);
      const game = db.getGame(id);
      if (!game) return sendJson(res, 404, { error: 'ไม่พบเกมนี้' });
      const updated = db.setGameImage(id, null);
      removeGameImageFile(game.image_url);
      return sendJson(res, 200, updated);
    }

    // ---- อุปกรณ์ (โครงสร้างเดียวกับเกม) ----
    if (pathname === '/api/equipment' && req.method === 'GET') {
      return sendJson(res, 200, db.listEquipmentWithCopies());
    }
    if (pathname === '/api/equipment' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !String(body.name).trim()) return sendJson(res, 400, { error: 'ต้องระบุชื่ออุปกรณ์' });
      return sendJson(res, 201, db.addEquipment({ ...body, name: String(body.name).trim() }));
    }
    if ((m = pathname.match(/^\/api\/equipment\/(\d+)$/)) && req.method === 'PUT') {
      const body = await readBody(req);
      if (!body.name || !String(body.name).trim()) return sendJson(res, 400, { error: 'ต้องระบุชื่ออุปกรณ์' });
      return sendJson(res, 200, db.updateEquipment(Number(m[1]), { ...body, name: String(body.name).trim() }));
    }
    if ((m = pathname.match(/^\/api\/equipment\/(\d+)$/)) && req.method === 'DELETE') {
      db.deleteEquipment(Number(m[1]));
      return sendJson(res, 200, { ok: true });
    }
    if ((m = pathname.match(/^\/api\/equipment\/(\d+)\/copies$/)) && req.method === 'POST') {
      return sendJson(res, 201, db.addEquipmentCopy(Number(m[1])));
    }
    if ((m = pathname.match(/^\/api\/equipment-copies\/(\d+)$/)) && req.method === 'DELETE') {
      db.deleteEquipmentCopy(Number(m[1]));
      return sendJson(res, 200, { ok: true });
    }
    if ((m = pathname.match(/^\/api\/equipment-copies\/(\d+)$/)) && req.method === 'PATCH') {
      const body = await readBody(req);
      if (!['available', 'borrowed', 'maintenance'].includes(body.status)) {
        return sendJson(res, 400, { error: 'สถานะไม่ถูกต้อง' });
      }
      return sendJson(res, 200, db.setEquipmentCopyStatus(Number(m[1]), body.status));
    }

    if ((m = pathname.match(/^\/api\/games\/(\d+)\/copies$/)) && req.method === 'POST') {
      return sendJson(res, 201, db.addCopy(Number(m[1])));
    }

    if ((m = pathname.match(/^\/api\/copies\/(\d+)$/)) && req.method === 'DELETE') {
      db.deleteCopy(Number(m[1]));
      return sendJson(res, 200, { ok: true });
    }

    if ((m = pathname.match(/^\/api\/copies\/(\d+)$/)) && req.method === 'PATCH') {
      const body = await readBody(req);
      if (!['available', 'maintenance'].includes(body.status)) {
        return sendJson(res, 400, { error: 'สถานะไม่ถูกต้อง' });
      }
      db.setCopyStatus(Number(m[1]), body.status);
      return sendJson(res, 200, db.getCopy(Number(m[1])));
    }

    if (pathname === '/api/loans' && req.method === 'GET') {
      return sendJson(res, 200, db.listLoans({
        activeOnly: query.active === 'true',
        borrowerName: query.borrower || undefined,
        loanId: query.code ? Number(query.code) : undefined,
      }));
    }

    if (pathname === '/api/stats' && req.method === 'GET') {
      return sendJson(res, 200, db.getStats());
    }

    if (pathname === '/api/stats/period' && req.method === 'GET') {
      return sendJson(res, 200, db.getPeriodStats({
        type: query.type === 'year' ? 'year' : 'month',
        year: query.year,
        month: query.month,
      }));
    }

    if (pathname === '/api/borrowers' && req.method === 'GET') {
      return sendJson(res, 200, db.listBorrowers());
    }

    // ตรวจข้อมูลผู้ขอยืม (ใช้ร่วมกันระหว่าง "ส่งคำขอยืม" และ "เจ้าหน้าที่สร้างรายการยืมเอง")
    const validateBorrower = (body) => {
      const sid = String(body.borrower_name ?? body.student_id ?? '').trim();
      if (!sid) return { error: 'กรุณากรอกรหัสนักศึกษา' };
      if (!/^\d+$/.test(sid)) return { error: 'รหัสนักศึกษาต้องเป็นตัวเลขเท่านั้น' };
      if (sid.length > 20) return { error: 'รหัสนักศึกษายาวเกินไป' };
      const info = {};
      for (const [k, label] of [['year_level', 'ชั้นปี'], ['major', 'สาขา'], ['faculty', 'คณะ']]) {
        const v = String(body[k] ?? '').trim();
        if (!v) return { error: `กรุณาระบุ${label}` };
        info[k] = v.slice(0, 100);
      }
      if (!YEAR_LEVELS.includes(info.year_level)) return { error: 'กรุณาเลือกชั้นปีจากรายการ' };
      const fac = FACULTIES.find((f) => f.name === info.faculty);
      if (!fac || !fac.majors.includes(info.major)) {
        return { error: 'กรุณาเลือกคณะและสาขาจากรายการ (สาขาต้องอยู่ในคณะที่เลือก)' };
      }
      return { sid, info };
    };

    // ---- คำขอยืม (ผู้ใช้ทั่วไป) ----
    if (pathname === '/api/requests' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.copy_id) return sendJson(res, 400, { error: 'กรุณาเลือกชุดเกมที่ต้องการขอยืม' });
      const v = validateBorrower(body);
      if (v.error) return sendJson(res, 400, { error: v.error });
      return sendJson(res, 201, db.createRequest(Number(body.copy_id), v.sid, v.info));
    }
    if (pathname === '/api/requests' && req.method === 'GET') {
      // ผู้ใช้ต้องส่ง ?student=รหัส (ดูได้เฉพาะของรหัสนั้น) / เจ้าหน้าที่ที่ Login แล้วไม่ต้องส่ง = ดูทั้งหมด
      const student = String(query.student || '').trim();
      return sendJson(res, 200, db.listRequests({ studentId: student || undefined, status: query.status || undefined }));
    }
    if ((m = pathname.match(/^\/api\/requests\/(\d+)\/cancel$/)) && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, db.cancelRequestByStudent(Number(m[1]), body.student_id));
    }
    // ---- เจ้าหน้าที่เปลี่ยนสถานะคำขอ: pending | approved | rejected | cancelled ----
    if ((m = pathname.match(/^\/api\/requests\/(\d+)$/)) && req.method === 'PATCH') {
      const body = await readBody(req);
      return sendJson(res, 200, db.setRequestStatus(Number(m[1]), body.status, { note: body.note, copyId: body.copy_id }));
    }

    // ---- คำขอยืมอุปกรณ์ (ผู้ใช้ทั่วไป) — กติกาเดียวกับบอร์ดเกม ----
    if (pathname === '/api/equipment-requests' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.copy_id) return sendJson(res, 400, { error: 'กรุณาเลือกอุปกรณ์ที่ต้องการขอยืม' });
      const v = validateBorrower(body);
      if (v.error) return sendJson(res, 400, { error: v.error });
      return sendJson(res, 201, db.createEquipmentRequest(Number(body.copy_id), v.sid, v.info));
    }
    if (pathname === '/api/equipment-requests' && req.method === 'GET') {
      const student = String(query.student || '').trim();
      return sendJson(res, 200, db.listEquipmentRequests({ studentId: student || undefined, status: query.status || undefined }));
    }
    if ((m = pathname.match(/^\/api\/equipment-requests\/(\d+)\/cancel$/)) && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, db.cancelEquipmentRequestByStudent(Number(m[1]), body.student_id));
    }
    if ((m = pathname.match(/^\/api\/equipment-requests\/(\d+)$/)) && req.method === 'PATCH') {
      const body = await readBody(req);
      return sendJson(res, 200, db.setEquipmentRequestStatus(Number(m[1]), body.status, { note: body.note, copyId: body.copy_id }));
    }
    // ---- รายการยืมอุปกรณ์ / รับคืน (รับคืน = เจ้าหน้าที่เท่านั้น) ----
    if (pathname === '/api/equipment-loans' && req.method === 'GET') {
      return sendJson(res, 200, db.listEquipmentLoans({
        activeOnly: query.active === 'true',
        borrowerName: query.borrower || undefined,
        loanId: query.code ? Number(query.code) : undefined,
      }));
    }
    if ((m = pathname.match(/^\/api\/equipment-loans\/(\d+)\/return$/)) && req.method === 'POST') {
      return sendJson(res, 200, db.returnEquipmentLoan(Number(m[1])));
    }

    // ---- สร้างรายการยืมโดยตรง / รับคืน: เจ้าหน้าที่เท่านั้น (ดู needsStaff) ----
    if (pathname === '/api/loans' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.copy_id) return sendJson(res, 400, { error: 'ต้องระบุชุดเกมและรหัสนักศึกษา' });
      const v = validateBorrower(body);
      if (v.error) return sendJson(res, 400, { error: v.error });
      return sendJson(res, 201, db.createLoan(Number(body.copy_id), v.sid, v.info));
    }

    if ((m = pathname.match(/^\/api\/loans\/(\d+)\/return$/)) && req.method === 'POST') {
      const loan = db.returnLoan(Number(m[1]));
      return sendJson(res, 200, loan);
    }

    // ---------- static files (frontend) ----------
    if (req.method === 'GET') {
      if (pathname.startsWith('/uploads/')) return serveStatic(req, res, pathname.slice('/uploads'.length), UPLOAD_ROOT);

      // หน้าเจ้าหน้าที่: ยังไม่ Login -> พาไปหน้า Login (ไฟล์ admin.js ไม่ให้โหลดถ้ายังไม่ Login)
      if (pathname === '/admin.html' || pathname === '/admin.js') {
        const noStore = { 'Cache-Control': 'no-store' };
        if (!auth.isStaff(req)) {
          if (pathname === '/admin.html') {
            res.writeHead(302, { Location: '/login.html?next=/admin.html', ...noStore });
            return res.end();
          }
          res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', ...noStore });
          return res.end('กรุณาเข้าสู่ระบบเจ้าหน้าที่');
        }
        return serveStatic(req, res, pathname, PUBLIC_DIR, noStore);
      }
      return serveStatic(req, res, pathname);
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, err.status || 500, { error: err.message || 'internal error' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ พอร์ต ${PORT} ถูกใช้งานอยู่แล้ว (อาจมี node server.js เปิดค้างอยู่ในอีก Terminal)`);
    console.error('   วิธีแก้: กด Ctrl+C ใน Terminal ที่เปิดค้างไว้ หรือรันด้วยพอร์ตอื่น เช่น');
    console.error('   PowerShell:  $env:PORT=3001; node server.js     |   Mac/Linux:  PORT=3001 node server.js\n');
  } else {
    console.error('\n❌ เริ่มเซิร์ฟเวอร์ไม่สำเร็จ:', err.message, '\n');
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`ระบบยืม-คืนบอร์ดเกม พร้อมใช้งานที่ http://localhost:${PORT}`);
  console.log(`หน้าแอดมิน: http://localhost:${PORT}/admin.html`);
  console.log('👉 เปิดเบราว์เซอร์ แล้วพิมพ์ที่อยู่ข้างบนด้วยตัวเอง (โปรแกรมไม่เปิดเว็บให้อัตโนมัติ) | หยุดเซิร์ฟเวอร์: กด Ctrl+C');
});
