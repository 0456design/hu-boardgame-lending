// db.js — data layer, built on Node's built-in `node:sqlite` (Node 22+).
// No external packages required: works out of the box with `node server.js`.

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'data.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS games (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    image_url     TEXT,
    min_players   INTEGER,
    max_players   INTEGER,
    play_time     TEXT,
    description   TEXT
  );

  CREATE TABLE IF NOT EXISTS game_copies (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    label     TEXT,                     -- e.g. "ชุดที่ 1"
    status    TEXT NOT NULL DEFAULT 'available'  -- available | borrowed | maintenance
  );

  CREATE TABLE IF NOT EXISTS loans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    copy_id        INTEGER NOT NULL REFERENCES game_copies(id) ON DELETE CASCADE,
    borrower_name  TEXT NOT NULL,
    borrowed_at    TEXT NOT NULL,
    due_at         TEXT NOT NULL,
    returned_at    TEXT
  );
`);

// ---------- migration: ข้อมูลผู้ยืมเพิ่มเติม (ชั้นปี / สาขา / คณะ) ----------
{
  const cols = db.prepare(`PRAGMA table_info(loans)`).all().map((c) => c.name);
  for (const c of ['year_level', 'major', 'faculty']) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE loans ADD COLUMN ${c} TEXT`);
  }
}

// ---------- คำขอยืม (ผู้ใช้ส่งคำขอ -> เจ้าหน้าที่ตรวจสอบและดำเนินการยืมจริง) ----------
// คำขอ "ไม่ใช่" การยืม: การส่งคำขอไม่เปลี่ยนสถานะชุดเกม ชุดจะเป็น "กำลังถูกยืม" เมื่อเจ้าหน้าที่อนุมัติเท่านั้น
// เก็บชื่อเกม/ชุดไว้ในคำขอด้วย (snapshot) เพื่อให้ประวัติคำขอยังอ่านได้แม้เกม/ชุดถูกลบภายหลัง
db.exec(`
  CREATE TABLE IF NOT EXISTS loan_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id      INTEGER REFERENCES games(id) ON DELETE SET NULL,
    copy_id      INTEGER REFERENCES game_copies(id) ON DELETE SET NULL,
    game_name    TEXT NOT NULL,
    copy_label   TEXT,
    student_id   TEXT NOT NULL,
    year_level   TEXT NOT NULL,
    faculty      TEXT NOT NULL,
    major        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | cancelled
    staff_note   TEXT,
    loan_id      INTEGER REFERENCES loans(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loan_requests_student ON loan_requests(student_id);
  CREATE INDEX IF NOT EXISTS idx_loan_requests_status ON loan_requests(status);
`);

// ---------- อุปกรณ์ (โครงสร้างเดียวกับ games / game_copies) ----------
const equipmentTableExisted = !!db
  .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'equipment'`)
  .get();

db.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    description   TEXT
  );

  CREATE TABLE IF NOT EXISTS equipment_copies (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    label         TEXT,                     -- e.g. "โน๊ตบุ๊ค 1"
    status        TEXT NOT NULL DEFAULT 'available'  -- available | borrowed | maintenance
  );
`);

// ---------- อุปกรณ์: คำขอยืม + รายการยืมจริง (โครงสร้างเดียวกับ loan_requests / loans ของบอร์ดเกม) ----------
// แยกตารางจากบอร์ดเกม เพื่อไม่กระทบข้อมูลและกติกาเดิม (1 สิทธิ์/คน ของเกมกับของอุปกรณ์นับแยกกัน)
db.exec(`
  CREATE TABLE IF NOT EXISTS equipment_loans (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    copy_id        INTEGER REFERENCES equipment_copies(id) ON DELETE SET NULL,
    equipment_id   INTEGER,
    item_name      TEXT,
    copy_label     TEXT,
    borrower_name  TEXT NOT NULL,
    borrowed_at    TEXT NOT NULL,
    due_at         TEXT NOT NULL,
    returned_at    TEXT,
    year_level     TEXT,
    major          TEXT,
    faculty        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_equipment_loans_borrower ON equipment_loans(borrower_name);

  CREATE TABLE IF NOT EXISTS equipment_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id  INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
    copy_id       INTEGER REFERENCES equipment_copies(id) ON DELETE SET NULL,
    item_name     TEXT NOT NULL,
    copy_label    TEXT,
    student_id    TEXT NOT NULL,
    year_level    TEXT NOT NULL,
    faculty       TEXT NOT NULL,
    major         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | cancelled
    staff_note    TEXT,
    loan_id       INTEGER REFERENCES equipment_loans(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_equipment_requests_student ON equipment_requests(student_id);
  CREATE INDEX IF NOT EXISTS idx_equipment_requests_status ON equipment_requests(status);
`);

const LOAN_MINUTES = 120; // ยืมได้ 2 ชั่วโมงต่อครั้ง

// ---------- คะแนนความชอบบอร์ดเกม (1–5 ดาว) ----------
// 1 ผู้โหวต (voter_id) ต่อ 1 เกม -> โหวตซ้ำ = แก้คะแนนเดิม ไม่เพิ่มจำนวนโหวต
// voter_id ตอนนี้มาจากคุกกี้นิรนาม (ดู auth.js -> getVoterId) เปลี่ยนเป็น id ผู้ใช้จริงได้ภายหลังโดยไม่ต้องแก้ตารางนี้
db.exec(`
  CREATE TABLE IF NOT EXISTS game_ratings (
    game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    voter_id    TEXT NOT NULL,
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (game_id, voter_id)
  );
`);

// ---------- migration: เก็บประวัติการยืมและคะแนนโหวตระยะยาว ----------
// เดิม loans / game_ratings ผูกกับ games/game_copies แบบ ON DELETE CASCADE -> ลบเกมหรือชุดเมื่อไร ประวัติยืมและโหวตหายตามไปด้วย
// ตอนนี้: เก็บชื่อเกม/ชื่อชุดไว้ในแถว (snapshot) และเลิกผูกแบบลบต่อเนื่อง -> ลบเกมออกจากรายการได้ แต่สถิติและโหวตยังอยู่
{
  const loanCols = db.prepare(`PRAGMA table_info(loans)`).all().map((c) => c.name);
  if (!loanCols.includes('game_name')) {
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE loans_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          copy_id        INTEGER REFERENCES game_copies(id) ON DELETE SET NULL,
          game_id        INTEGER,
          game_name      TEXT,
          copy_label     TEXT,
          borrower_name  TEXT NOT NULL,
          borrowed_at    TEXT NOT NULL,
          due_at         TEXT NOT NULL,
          returned_at    TEXT,
          year_level     TEXT,
          major          TEXT,
          faculty        TEXT
        );
        INSERT INTO loans_new (id, copy_id, game_id, game_name, copy_label, borrower_name, borrowed_at, due_at, returned_at, year_level, major, faculty)
        SELECT l.id, l.copy_id, c.game_id, g.name, c.label, l.borrower_name, l.borrowed_at, l.due_at, l.returned_at, l.year_level, l.major, l.faculty
        FROM loans l
        LEFT JOIN game_copies c ON c.id = l.copy_id
        LEFT JOIN games g ON g.id = c.game_id;
        DROP TABLE loans;
        ALTER TABLE loans_new RENAME TO loans;
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    db.exec(`PRAGMA foreign_keys = ON`);
  }

  const ratingCols = db.prepare(`PRAGMA table_info(game_ratings)`).all().map((c) => c.name);
  if (!ratingCols.includes('game_name')) {
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec('BEGIN');
    try {
      db.exec(`
        CREATE TABLE game_ratings_new (
          game_id     INTEGER NOT NULL,
          game_name   TEXT,
          voter_id    TEXT NOT NULL,
          rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL,
          PRIMARY KEY (game_id, voter_id)
        );
        INSERT INTO game_ratings_new (game_id, game_name, voter_id, rating, created_at, updated_at)
        SELECT r.game_id, g.name, r.voter_id, r.rating, r.created_at, r.updated_at
        FROM game_ratings r LEFT JOIN games g ON g.id = r.game_id;
        DROP TABLE game_ratings;
        ALTER TABLE game_ratings_new RENAME TO game_ratings;
      `);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    db.exec(`PRAGMA foreign_keys = ON`);
  }
}

// เวลาเล่นโดยประมาณของเกมที่เดิมยังไม่มีข้อมูล (รูปแบบเดียวกับเกมอื่น เช่น "15-30 นาที")
const DEFAULT_PLAY_TIMES = {
  'Blocks 54 pcs': '15-30 นาที',
  'Ice Break': '15-30 นาที',
  'Midnight': '15-20 นาที',
};

// ---------- seed demo data on first run ----------
function seedIfEmpty() {
  const { count } = db.prepare(`SELECT COUNT(*) AS count FROM games`).get();
  if (count > 0) return;

  const insertGame = db.prepare(`
    INSERT INTO games (name, image_url, min_players, max_players, play_time, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertCopy = db.prepare(`
    INSERT INTO game_copies (game_id, label, status) VALUES (?, ?, 'available')
  `);

  const demo = [
    ['Stick Stack', '', 2, 8, '30 นาที', 'เกมความคล่องแคล่ว วางไม้สีต่างๆ ซ้อนบนหอคอยที่แกว่งไปมาโดยไม่ให้หล่น', 1],
    ['Exploding Kittens', '', 2, 5, '15 นาที', 'เกมการ์ดจับเวลาระเบิด หลีกเลี่ยงการ์ดแมวระเบิดไม่ให้ตกรอบ', 1],
    ['Midnight', '', null, null, DEFAULT_PLAY_TIMES['Midnight'], 'เกมปาร์ตี้ Midnight (รอเจ้าหน้าที่ยืนยันชื่อ/รายละเอียดที่ถูกต้อง)', 1],
    ['Dead Last', '', 6, 12, '45-60 นาที', 'เกมปาร์ตี้วางแผนและลงคะแนนลับเพื่อเอาตัวรอดเป็นคนสุดท้าย', 1],
    ['Dobble', '', 2, 8, '15 นาที', 'เกมการ์ดจับสัญลักษณ์ที่เหมือนกันบนสองใบให้เร็วที่สุด', 1],
    ['Drop It', '', 2, 4, '30 นาที', 'เกมหย่อนชิ้นส่วนรูปทรงต่างๆ ลงกระดานแนวตั้งให้ได้คะแนนสูงสุด', 1],
    ['Yogi', '', 3, 12, '15-20 นาที', 'เกมปาร์ตี้จับท่าตามการ์ด ใครทำท่าตามไม่ได้ตกรอบ', 1],
    ['Nekojima', '', 1, 5, '15-30 นาที', 'เกมไม้ทรงตัว ต่อเสาไฟฟ้าให้สายไม่แตะกันและไม่ล้ม', 1],
    ['Spyfall', '', 3, 8, '15 นาที', 'เกมปาร์ตี้สืบหาสายลับในกลุ่มด้วยการตั้งคำถามและสังเกต', 1],
    ['Katamino Family', '', 1, 2, '10-15 นาที', 'เกมปริศนาไม้ จัดเรียงชิ้นส่วนให้เต็มกระดาน เล่นเดี่ยวหรือแข่งคู่ได้', 1],
    ['ลิฟต์ป่วน ก๊วนอลเวง', '', 2, 4, '20-40 นาที', 'เกมการ์ด แย่งพาสมาชิกครอบครัวขึ้นลิฟต์ให้ได้มากที่สุด (In Front of the Elevators)', 1],
    ['Blocks 54 pcs', '', null, null, DEFAULT_PLAY_TIMES['Blocks 54 pcs'], 'ชุดตัวต่อบล็อก 54 ชิ้น', 1],
    ['Ice Break', '', null, null, DEFAULT_PLAY_TIMES['Ice Break'], 'เกมปาร์ตี้ Ice Break (รอเจ้าหน้าที่ยืนยันชื่อ/รายละเอียดที่ถูกต้อง)', 1],
    ['Unstable Unicorns', '', 2, 8, '30-45 นาที', 'เกมการ์ดสร้างกองทัพยูนิคอร์นและขัดขวางคู่แข่งด้วยการ์ดพิเศษ', 1],
  ];

  for (const [name, image_url, minP, maxP, time, desc, copies] of demo) {
    const { lastInsertRowid } = insertGame.run(name, image_url, minP, maxP, time, desc);
    for (let i = 1; i <= copies; i++) {
      insertCopy.run(lastInsertRowid, `ชุดที่ ${i}`);
    }
  }
}
seedIfEmpty();

// ---------- migration (ครั้งเดียว): เติมเวลาเล่นให้ 3 เกมที่ยังว่าง ----------
// ใช้ PRAGMA user_version เป็นตัวกันรันซ้ำ -> ถ้าเจ้าหน้าที่แก้/ลบเวลาทีหลัง ระบบจะไม่เขียนทับ
{
  const { user_version } = db.prepare(`PRAGMA user_version`).get();
  if (user_version < 1) {
    const fill = db.prepare(`UPDATE games SET play_time = ? WHERE name = ? AND (play_time IS NULL OR TRIM(play_time) = '')`);
    for (const [name, time] of Object.entries(DEFAULT_PLAY_TIMES)) fill.run(time, name);
    db.exec(`PRAGMA user_version = 1`);
  }
}

// ---------- copy labels ("ชุดที่ N", ตั้งให้อัตโนมัติ) ----------
function nextCopyLabel(gameId) {
  const rows = db.prepare(`SELECT label FROM game_copies WHERE game_id = ?`).all(gameId);
  let max = 0;
  for (const { label } of rows) {
    const m = /^ชุดที่ (\d+)$/.exec(label || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ชุดที่ ${Math.max(max, rows.length) + 1}`;
}

// ข้อมูลเก่าที่ไม่มีชื่อชุด (label ว่าง) -> เติมเป็น "ชุดที่ N" ให้อัตโนมัติ
function fillMissingLabels() {
  const games = db.prepare(`SELECT DISTINCT game_id FROM game_copies WHERE label IS NULL OR TRIM(label) = ''`).all();
  for (const { game_id } of games) {
    const missing = db
      .prepare(`SELECT id FROM game_copies WHERE game_id = ? AND (label IS NULL OR TRIM(label) = '') ORDER BY id`)
      .all(game_id);
    for (const { id } of missing) {
      db.prepare(`UPDATE game_copies SET label = ? WHERE id = ?`).run(nextCopyLabel(game_id), id);
    }
  }
}
fillMissingLabels();

// ---------- helpers ----------
function nowIso() {
  return new Date().toISOString();
}

function addMinutesIso(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

// ---------- games & copies ----------
function listGamesWithCopies(voterId) {
  const games = db.prepare(`SELECT * FROM games ORDER BY name`).all();
  const copiesStmt = db.prepare(`SELECT * FROM game_copies WHERE game_id = ? ORDER BY id`);

  const sums = new Map(
    db.prepare(`SELECT game_id, COUNT(*) AS n, SUM(rating) AS total FROM game_ratings GROUP BY game_id`)
      .all()
      .map((r) => [r.game_id, r])
  );
  const mine = new Map(
    voterId
      ? db.prepare(`SELECT game_id, rating FROM game_ratings WHERE voter_id = ?`).all(voterId).map((r) => [r.game_id, r.rating])
      : []
  );

  return games.map((g) => {
    const r = sums.get(g.id);
    return {
      ...g,
      copies: copiesStmt.all(g.id),
      rating_avg: r ? roundAvg(r.total, r.n) : 0,
      rating_count: r ? r.n : 0,
      my_rating: mine.get(g.id) || null,
    };
  });
}

// ---------- ratings ----------
// ปัดค่าเฉลี่ยเป็น 1 ตำแหน่งแบบ "ครึ่งปัดขึ้น" ด้วยจำนวนเต็ม (กันปัญหาทศนิยมลอยตัว เช่น 4.35 -> 4.4)
function roundAvg(total, n) {
  return n ? Math.floor((total * 20 + n) / (2 * n)) / 10 : 0;
}

function getRatingSummary(gameId, voterId) {
  const { n, total } = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(rating), 0) AS total FROM game_ratings WHERE game_id = ?`)
    .get(gameId);
  const mine = voterId
    ? db.prepare(`SELECT rating FROM game_ratings WHERE game_id = ? AND voter_id = ?`).get(gameId, voterId)
    : null;
  return { game_id: gameId, rating_avg: roundAvg(total, n), rating_count: n, my_rating: mine ? mine.rating : null };
}

// บันทึก/แก้คะแนนของผู้โหวตคนนี้ — คนเดิมโหวตซ้ำ = อัปเดตแถวเดิม (จำนวนโหวตไม่เพิ่ม)
function setRating(gameId, voterId, rating) {
  if (!getGame(gameId)) throw Object.assign(new Error('ไม่พบเกมนี้'), { status: 404 });
  if (!voterId) throw Object.assign(new Error('ไม่สามารถระบุผู้โหวตได้'), { status: 400 });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw Object.assign(new Error('คะแนนต้องเป็นจำนวนเต็ม 1–5'), { status: 400 });
  }
  const prev = db.prepare(`SELECT rating FROM game_ratings WHERE game_id = ? AND voter_id = ?`).get(gameId, voterId);
  const now = nowIso();
  db.prepare(`
    INSERT INTO game_ratings (game_id, game_name, voter_id, rating, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(game_id, voter_id) DO UPDATE SET rating = excluded.rating, game_name = excluded.game_name, updated_at = excluded.updated_at
  `).run(gameId, getGame(gameId).name, voterId, rating, now, now);
  return { ...getRatingSummary(gameId, voterId), previous_rating: prev ? prev.rating : null };
}

function getGame(gameId) {
  return db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
}

function setGameImage(gameId, imageUrl) {
  const game = getGame(gameId);
  if (!game) throw Object.assign(new Error('ไม่พบเกมนี้'), { status: 404 });
  db.prepare(`UPDATE games SET image_url = ? WHERE id = ?`).run(imageUrl || null, gameId);
  return getGame(gameId);
}

function toIntOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function addGame({ name, image_url, min_players, max_players, play_time, description, copies }) {
  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO games (name, image_url, min_players, max_players, play_time, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(name, image_url || null, toIntOrNull(min_players), toIntOrNull(max_players), play_time || null, description || null);

  // สร้างชุดตามจำนวนที่ระบุ ตั้งชื่ออัตโนมัติ: ชุดที่ 1, ชุดที่ 2, ...
  const n = Math.min(Math.max(toIntOrNull(copies) || 1, 1), 50);
  for (let i = 0; i < n; i++) addCopy(lastInsertRowid);

  return db.prepare(`SELECT * FROM games WHERE id = ?`).get(lastInsertRowid);
}

function updateGame(gameId, { name, min_players, max_players, play_time, description }) {
  const game = db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
  if (!game) throw Object.assign(new Error('ไม่พบเกมนี้'), { status: 404 });
  db.prepare(`
    UPDATE games
    SET name = ?, min_players = ?, max_players = ?, play_time = ?, description = ?
    WHERE id = ?
  `).run(name, toIntOrNull(min_players), toIntOrNull(max_players), play_time || null, description || null, gameId);
  return db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
}

function deleteGame(gameId) {
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM game_copies WHERE game_id = ? AND status = 'borrowed'`)
    .get(gameId);
  if (n > 0) {
    throw Object.assign(new Error('ลบไม่ได้ เพราะมีชุดที่กำลังถูกยืมอยู่ — ให้คืนก่อน'), { status: 409 });
  }
  db.prepare(`DELETE FROM games WHERE id = ?`).run(gameId);
}

function addCopy(gameId) {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO game_copies (game_id, label, status) VALUES (?, ?, 'available')`)
    .run(gameId, nextCopyLabel(gameId));
  return db.prepare(`SELECT * FROM game_copies WHERE id = ?`).get(lastInsertRowid);
}

function deleteCopy(copyId) {
  const copy = getCopy(copyId);
  if (!copy) throw Object.assign(new Error('ไม่พบชุดเกมนี้'), { status: 404 });
  if (copy.status === 'borrowed') {
    throw Object.assign(new Error('ลบไม่ได้ เพราะชุดนี้กำลังถูกยืมอยู่ — ให้คืนก่อน'), { status: 409 });
  }
  db.prepare(`DELETE FROM game_copies WHERE id = ?`).run(copyId);
}

function setCopyStatus(copyId, status) {
  db.prepare(`UPDATE game_copies SET status = ? WHERE id = ?`).run(status, copyId);
}

function getCopy(copyId) {
  return db.prepare(`SELECT * FROM game_copies WHERE id = ?`).get(copyId);
}

// ---------- equipment (อุปกรณ์) ----------
function seedEquipment() {
  const insertEq = db.prepare(`INSERT INTO equipment (name, description) VALUES (?, ?)`);
  const demo = [
    ['โน๊ตบุ๊ค', 4],
    ['กล้อง VR', 2],
    ['ปลั๊กไฟ', 5],
  ];
  for (const [name, n] of demo) {
    const { lastInsertRowid } = insertEq.run(name, null);
    for (let i = 0; i < n; i++) addEquipmentCopy(Number(lastInsertRowid));
  }
}

function nextEquipmentLabel(equipmentId) {
  const eq = db.prepare(`SELECT name FROM equipment WHERE id = ?`).get(equipmentId);
  const rows = db.prepare(`SELECT label FROM equipment_copies WHERE equipment_id = ?`).all(equipmentId);
  let max = 0;
  for (const { label } of rows) {
    const m = /(\d+)\s*$/.exec(label || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${eq.name} ${Math.max(max, rows.length) + 1}`;
}

function listEquipmentWithCopies() {
  const items = db.prepare(`SELECT * FROM equipment ORDER BY id`).all();
  const copiesStmt = db.prepare(`SELECT * FROM equipment_copies WHERE equipment_id = ? ORDER BY id`);
  return items.map((e) => ({ ...e, copies: copiesStmt.all(e.id) }));
}

function addEquipment({ name, description, copies }) {
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO equipment (name, description) VALUES (?, ?)`)
    .run(name, description || null);
  const n = Math.min(Math.max(toIntOrNull(copies) || 1, 1), 50);
  for (let i = 0; i < n; i++) addEquipmentCopy(Number(lastInsertRowid));
  return db.prepare(`SELECT * FROM equipment WHERE id = ?`).get(lastInsertRowid);
}

function updateEquipment(equipmentId, { name, description }) {
  const eq = db.prepare(`SELECT * FROM equipment WHERE id = ?`).get(equipmentId);
  if (!eq) throw Object.assign(new Error('ไม่พบอุปกรณ์นี้'), { status: 404 });
  db.prepare(`UPDATE equipment SET name = ?, description = ? WHERE id = ?`).run(name, description || null, equipmentId);
  // ถ้าเปลี่ยนชื่อ ให้ชื่อรายการย่อยเปลี่ยนตาม (เช่น "โน๊ตบุ๊ค 1" -> "แล็ปท็อป 1")
  if (eq.name !== name) {
    const rows = db.prepare(`SELECT id, label FROM equipment_copies WHERE equipment_id = ?`).all(equipmentId);
    for (const r of rows) {
      if (r.label && r.label.startsWith(eq.name)) {
        db.prepare(`UPDATE equipment_copies SET label = ? WHERE id = ?`).run(name + r.label.slice(eq.name.length), r.id);
      }
    }
  }
  return db.prepare(`SELECT * FROM equipment WHERE id = ?`).get(equipmentId);
}

function deleteEquipment(equipmentId) {
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM equipment_copies WHERE equipment_id = ? AND status = 'borrowed'`)
    .get(equipmentId);
  if (n > 0) {
    throw Object.assign(new Error('ลบไม่ได้ เพราะมีรายการที่กำลังถูกยืมอยู่ — ให้คืนก่อน'), { status: 409 });
  }
  db.prepare(`DELETE FROM equipment WHERE id = ?`).run(equipmentId);
}

function addEquipmentCopy(equipmentId) {
  const eq = db.prepare(`SELECT id FROM equipment WHERE id = ?`).get(equipmentId);
  if (!eq) throw Object.assign(new Error('ไม่พบอุปกรณ์นี้'), { status: 404 });
  const { lastInsertRowid } = db
    .prepare(`INSERT INTO equipment_copies (equipment_id, label, status) VALUES (?, ?, 'available')`)
    .run(equipmentId, nextEquipmentLabel(equipmentId));
  return getEquipmentCopy(Number(lastInsertRowid));
}

function getEquipmentCopy(copyId) {
  return db.prepare(`SELECT * FROM equipment_copies WHERE id = ?`).get(copyId);
}

function deleteEquipmentCopy(copyId) {
  const copy = getEquipmentCopy(copyId);
  if (!copy) throw Object.assign(new Error('ไม่พบรายการนี้'), { status: 404 });
  if (copy.status === 'borrowed') {
    throw Object.assign(new Error('ลบไม่ได้ เพราะรายการนี้กำลังถูกยืมอยู่ — ให้คืนก่อน'), { status: 409 });
  }
  db.prepare(`DELETE FROM equipment_copies WHERE id = ?`).run(copyId);
}

function setEquipmentCopyStatus(copyId, status) {
  if (!getEquipmentCopy(copyId)) throw Object.assign(new Error('ไม่พบรายการนี้'), { status: 404 });
  db.prepare(`UPDATE equipment_copies SET status = ? WHERE id = ?`).run(status, copyId);
  return getEquipmentCopy(copyId);
}

if (!equipmentTableExisted) seedEquipment();

// ---------- loans ----------
function findActiveLoanForBorrower(borrowerName) {
  return db
    .prepare(`SELECT * FROM loans WHERE borrower_name = ? COLLATE NOCASE AND returned_at IS NULL`)
    .get(borrowerName.trim());
}

function createLoan(copyId, borrowerName, info = {}) {
  const copy = getCopy(copyId);
  if (!copy) throw Object.assign(new Error('ไม่พบชุดเกมนี้'), { status: 404 });
  if (copy.status !== 'available') {
    throw Object.assign(new Error('ชุดเกมนี้ไม่ว่างในตอนนี้'), { status: 409 });
  }
  if (findActiveLoanForBorrower(borrowerName)) {
    throw Object.assign(
      new Error('คุณมีเกมที่ยังไม่คืนอยู่ 1 รายการแล้ว (ยืมได้ 1 สิทธิ์ต่อครั้ง)'),
      { status: 409 }
    );
  }

  const borrowed_at = nowIso();
  const due_at = addMinutesIso(borrowed_at, LOAN_MINUTES);

  const { lastInsertRowid } = db
    .prepare(`
      INSERT INTO loans (copy_id, game_id, game_name, copy_label, borrower_name, borrowed_at, due_at, year_level, major, faculty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      copyId,
      copy.game_id,
      (getGame(copy.game_id) || {}).name || null,
      copy.label || null,
      borrowerName.trim(),
      borrowed_at,
      due_at,
      info.year_level || null,
      info.major || null,
      info.faculty || null
    );

  setCopyStatus(copyId, 'borrowed');
  return db.prepare(`SELECT * FROM loans WHERE id = ?`).get(lastInsertRowid);
}

function returnLoan(loanId) {
  const loan = db.prepare(`SELECT * FROM loans WHERE id = ?`).get(loanId);
  if (!loan) throw Object.assign(new Error('ไม่พบรายการยืมนี้'), { status: 404 });
  if (loan.returned_at) throw Object.assign(new Error('รายการนี้ถูกคืนไปแล้ว'), { status: 409 });

  db.prepare(`UPDATE loans SET returned_at = ? WHERE id = ?`).run(nowIso(), loanId);
  setCopyStatus(loan.copy_id, 'available');
  return db.prepare(`SELECT * FROM loans WHERE id = ?`).get(loanId);
}

function listLoans({ activeOnly, borrowerName, loanId } = {}) {
  const clauses = [];
  const params = [];
  if (activeOnly) clauses.push('loans.returned_at IS NULL');
  if (borrowerName) {
    clauses.push('loans.borrower_name = ? COLLATE NOCASE');
    params.push(borrowerName.trim());
  }
  if (loanId) {
    clauses.push('loans.id = ?');
    params.push(loanId);
  }
  const sql = `
    SELECT loans.*,
      COALESCE(game_copies.label, loans.copy_label) AS copy_label,
      COALESCE(games.name, loans.game_name, '(เกมที่ถูกลบแล้ว)') AS game_name
    FROM loans
    LEFT JOIN game_copies ON game_copies.id = loans.copy_id
    LEFT JOIN games ON games.id = game_copies.game_id
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY loans.borrowed_at DESC
  `;
  return db.prepare(sql).all(...params);
}

// ---------- loan requests (คำขอยืม) ----------
const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
const httpErr = (msg, status) => Object.assign(new Error(msg), { status });

function getRequest(id) {
  return db.prepare(`SELECT * FROM loan_requests WHERE id = ?`).get(id);
}

// รายการคำขอ: ถ้าระบุ studentId = เฉพาะของคนนั้น (หน้า "คำขอของฉัน") ไม่ระบุ = ทั้งหมด (เจ้าหน้าที่)
function listRequests({ studentId, status } = {}) {
  const clauses = [], params = [];
  if (studentId) { clauses.push('r.student_id = ?'); params.push(String(studentId).trim()); }
  if (status && REQUEST_STATUSES.includes(status)) { clauses.push('r.status = ?'); params.push(status); }
  return db.prepare(`
    SELECT r.*, l.borrowed_at AS loan_borrowed_at, l.due_at AS loan_due_at, l.returned_at AS loan_returned_at
    FROM loan_requests r
    LEFT JOIN loans l ON l.id = r.loan_id
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY r.created_at DESC, r.id DESC
  `).all(...params);
}

function createRequest(copyId, studentId, info) {
  const copy = getCopy(copyId);
  if (!copy) throw httpErr('ไม่พบชุดเกมนี้', 404);
  if (copy.status !== 'available') throw httpErr('ชุดเกมนี้ไม่ว่างในตอนนี้ ไม่สามารถส่งคำขอยืมได้', 409);
  studentId = String(studentId).trim();
  if (findActiveLoanForBorrower(studentId)) {
    throw httpErr('คุณมีเกมที่ยังไม่คืนอยู่ 1 รายการแล้ว (ยืมได้ครั้งละ 1 เกม) จึงยังส่งคำขอใหม่ไม่ได้', 409);
  }
  const pending = db.prepare(`SELECT id FROM loan_requests WHERE student_id = ? AND status = 'pending'`).get(studentId);
  if (pending) {
    throw httpErr('คุณมีคำขอที่รอเจ้าหน้าที่ดำเนินการอยู่แล้ว กรุณารอผล หรือยกเลิกคำขอเดิมก่อนส่งคำขอใหม่', 409);
  }
  const game = getGame(copy.game_id);
  const now = nowIso();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO loan_requests (game_id, copy_id, game_name, copy_label, student_id, year_level, faculty, major, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(game.id, copy.id, game.name, copy.label, studentId, info.year_level, info.faculty, info.major, now, now);
  return getRequest(Number(lastInsertRowid));
}

// ผู้ใช้ยกเลิกคำขอของตัวเอง — ทำได้เฉพาะตอนที่ยัง "รอเจ้าหน้าที่ดำเนินการ"
function cancelRequestByStudent(id, studentId) {
  const r = getRequest(id);
  if (!r || r.student_id !== String(studentId || '').trim()) throw httpErr('ไม่พบคำขอนี้', 404);
  if (r.status !== 'pending') throw httpErr('เจ้าหน้าที่ดำเนินการกับคำขอนี้ไปแล้ว ไม่สามารถยกเลิกจากฝั่งผู้ใช้ได้', 409);
  db.prepare(`UPDATE loan_requests SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(nowIso(), id);
  return getRequest(id);
}

// เจ้าหน้าที่เปลี่ยนสถานะคำขอ
//  - approved: สร้างรายการยืมจริง (ชุดเกมเปลี่ยนเป็น "กำลังถูกยืม") ตอนนี้เท่านั้น
//    ถ้าชุดที่ขอไม่ว่างแล้ว เจ้าหน้าที่เลือกชุดอื่นของเกมเดียวกันที่ว่างได้ (copyId)
//  - rejected / cancelled: ปิดคำขอ พร้อมหมายเหตุ
//  - pending: เปิดคำขอที่ถูกปฏิเสธ/ยกเลิกกลับมาตรวจสอบใหม่ (คำขอที่อนุมัติแล้วย้อนไม่ได้ ต้องใช้ "รับคืน")
function setRequestStatus(id, status, { note, copyId } = {}) {
  if (!REQUEST_STATUSES.includes(status)) throw httpErr('สถานะไม่ถูกต้อง', 400);
  const r = getRequest(id);
  if (!r) throw httpErr('ไม่พบคำขอนี้', 404);
  const cleanNote = note ? String(note).trim().slice(0, 300) : null;
  const now = nowIso();

  if (status === 'approved') {
    if (r.status !== 'pending') throw httpErr('อนุมัติได้เฉพาะคำขอที่รอดำเนินการ', 409);
    const useCopyId = copyId ? Number(copyId) : r.copy_id;
    const copy = useCopyId ? getCopy(useCopyId) : null;
    if (!copy) throw httpErr('ชุดเกมที่ขอถูกลบไปแล้ว กรุณาเลือกชุดอื่น หรือปฏิเสธคำขอ', 409);
    if (r.game_id && copy.game_id !== r.game_id) throw httpErr('ชุดที่เลือกไม่ใช่ของเกมเดียวกับคำขอ', 400);
    db.exec('BEGIN');
    try {
      const loan = createLoan(copy.id, r.student_id, { year_level: r.year_level, major: r.major, faculty: r.faculty });
      db.prepare(`UPDATE loan_requests SET status = 'approved', copy_id = ?, copy_label = ?, loan_id = ?, staff_note = ?, updated_at = ? WHERE id = ?`)
        .run(copy.id, copy.label, loan.id, cleanNote, now, id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return getRequest(id);
  }

  if (status === 'pending') {
    if (r.status === 'pending') return r;
    if (r.status === 'approved') throw httpErr('คำขอที่อนุมัติแล้วเปลี่ยนกลับเป็นรอดำเนินการไม่ได้ (ถ้ายืมผิด ให้รับคืนในหน้า "การยืม–คืน")', 409);
    const dup = db.prepare(`SELECT id FROM loan_requests WHERE student_id = ? AND status = 'pending' AND id != ?`).get(r.student_id, id);
    if (dup) throw httpErr('ผู้ขอรายนี้มีคำขออื่นที่รอดำเนินการอยู่แล้ว', 409);
    db.prepare(`UPDATE loan_requests SET status = 'pending', updated_at = ? WHERE id = ?`).run(now, id);
    return getRequest(id);
  }

  // rejected | cancelled
  if (r.status === 'approved') throw httpErr('คำขอที่อนุมัติแล้วเปลี่ยนสถานะไม่ได้ (ถ้ายืมผิด ให้รับคืนในหน้า "การยืม–คืน")', 409);
  db.prepare(`UPDATE loan_requests SET status = ?, staff_note = ?, updated_at = ? WHERE id = ?`).run(status, cleanNote, now, id);
  return getRequest(id);
}

function countPendingRequests() {
  return db.prepare(`SELECT COUNT(*) AS n FROM loan_requests WHERE status = 'pending'`).get().n
    + db.prepare(`SELECT COUNT(*) AS n FROM equipment_requests WHERE status = 'pending'`).get().n;
}

// ================= อุปกรณ์: รายการยืม / คำขอยืม =================
// ใช้กติกาเดียวกับบอร์ดเกม: ผู้ใช้ "ขอยืม" -> เจ้าหน้าที่อนุมัติจึงเกิดการยืมจริง -> เจ้าหน้าที่รับคืน
// ผลลัพธ์ใส่ฟิลด์ game_name (= ชื่ออุปกรณ์) เพิ่ม เพื่อให้หน้าเว็บใช้ตัวแสดงผลชุดเดียวกับบอร์ดเกมได้
function findActiveEquipmentLoanForBorrower(borrowerName) {
  return db
    .prepare(`SELECT * FROM equipment_loans WHERE borrower_name = ? COLLATE NOCASE AND returned_at IS NULL`)
    .get(String(borrowerName).trim());
}

function createEquipmentLoan(copyId, borrowerName, info = {}) {
  const copy = getEquipmentCopy(copyId);
  if (!copy) throw httpErr('ไม่พบอุปกรณ์รายการนี้', 404);
  if (copy.status !== 'available') throw httpErr('อุปกรณ์รายการนี้ไม่ว่างในตอนนี้', 409);
  if (findActiveEquipmentLoanForBorrower(borrowerName)) {
    throw httpErr('คุณมีอุปกรณ์ที่ยังไม่คืนอยู่ 1 รายการแล้ว (ยืมอุปกรณ์ได้ครั้งละ 1 รายการ)', 409);
  }
  const eq = db.prepare(`SELECT * FROM equipment WHERE id = ?`).get(copy.equipment_id);
  const borrowed_at = nowIso();
  const due_at = addMinutesIso(borrowed_at, LOAN_MINUTES);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO equipment_loans (copy_id, equipment_id, item_name, copy_label, borrower_name, borrowed_at, due_at, year_level, major, faculty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(copyId, copy.equipment_id, eq ? eq.name : null, copy.label || null, String(borrowerName).trim(), borrowed_at, due_at,
    info.year_level || null, info.major || null, info.faculty || null);
  db.prepare(`UPDATE equipment_copies SET status = 'borrowed' WHERE id = ?`).run(copyId);
  return db.prepare(`SELECT * FROM equipment_loans WHERE id = ?`).get(Number(lastInsertRowid));
}

function returnEquipmentLoan(loanId) {
  const loan = db.prepare(`SELECT * FROM equipment_loans WHERE id = ?`).get(loanId);
  if (!loan) throw httpErr('ไม่พบรายการยืมนี้', 404);
  if (loan.returned_at) throw httpErr('รายการนี้ถูกคืนไปแล้ว', 409);
  db.prepare(`UPDATE equipment_loans SET returned_at = ? WHERE id = ?`).run(nowIso(), loanId);
  if (loan.copy_id) db.prepare(`UPDATE equipment_copies SET status = 'available' WHERE id = ?`).run(loan.copy_id);
  return db.prepare(`SELECT * FROM equipment_loans WHERE id = ?`).get(loanId);
}

function listEquipmentLoans({ activeOnly, borrowerName, loanId } = {}) {
  const clauses = [], params = [];
  if (activeOnly) clauses.push('l.returned_at IS NULL');
  if (borrowerName) { clauses.push('l.borrower_name = ? COLLATE NOCASE'); params.push(borrowerName.trim()); }
  if (loanId) { clauses.push('l.id = ?'); params.push(loanId); }
  return db.prepare(`
    SELECT l.*,
      COALESCE(c.label, l.copy_label) AS copy_label,
      COALESCE(e.name, l.item_name, '(อุปกรณ์ที่ถูกลบแล้ว)') AS game_name
    FROM equipment_loans l
    LEFT JOIN equipment_copies c ON c.id = l.copy_id
    LEFT JOIN equipment e ON e.id = c.equipment_id
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY l.borrowed_at DESC
  `).all(...params);
}

function getEquipmentRequest(id) {
  return db.prepare(`SELECT *, item_name AS game_name FROM equipment_requests WHERE id = ?`).get(id);
}

function listEquipmentRequests({ studentId, status } = {}) {
  const clauses = [], params = [];
  if (studentId) { clauses.push('r.student_id = ?'); params.push(String(studentId).trim()); }
  if (status && REQUEST_STATUSES.includes(status)) { clauses.push('r.status = ?'); params.push(status); }
  return db.prepare(`
    SELECT r.*, r.item_name AS game_name, l.borrowed_at AS loan_borrowed_at, l.due_at AS loan_due_at, l.returned_at AS loan_returned_at
    FROM equipment_requests r
    LEFT JOIN equipment_loans l ON l.id = r.loan_id
    ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
    ORDER BY r.created_at DESC, r.id DESC
  `).all(...params);
}

function createEquipmentRequest(copyId, studentId, info) {
  const copy = getEquipmentCopy(copyId);
  if (!copy) throw httpErr('ไม่พบอุปกรณ์รายการนี้', 404);
  if (copy.status !== 'available') throw httpErr('อุปกรณ์รายการนี้ไม่ว่างในตอนนี้ ไม่สามารถส่งคำขอยืมได้', 409);
  studentId = String(studentId).trim();
  if (findActiveEquipmentLoanForBorrower(studentId)) {
    throw httpErr('คุณมีอุปกรณ์ที่ยังไม่คืนอยู่ 1 รายการแล้ว (ยืมอุปกรณ์ได้ครั้งละ 1 รายการ) จึงยังส่งคำขอใหม่ไม่ได้', 409);
  }
  const pending = db.prepare(`SELECT id FROM equipment_requests WHERE student_id = ? AND status = 'pending'`).get(studentId);
  if (pending) {
    throw httpErr('คุณมีคำขอยืมอุปกรณ์ที่รอเจ้าหน้าที่ดำเนินการอยู่แล้ว กรุณารอผล หรือยกเลิกคำขอเดิมก่อนส่งคำขอใหม่', 409);
  }
  const eq = db.prepare(`SELECT * FROM equipment WHERE id = ?`).get(copy.equipment_id);
  const now = nowIso();
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO equipment_requests (equipment_id, copy_id, item_name, copy_label, student_id, year_level, faculty, major, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(eq.id, copy.id, eq.name, copy.label, studentId, info.year_level, info.faculty, info.major, now, now);
  return getEquipmentRequest(Number(lastInsertRowid));
}

function cancelEquipmentRequestByStudent(id, studentId) {
  const r = getEquipmentRequest(id);
  if (!r || r.student_id !== String(studentId || '').trim()) throw httpErr('ไม่พบคำขอนี้', 404);
  if (r.status !== 'pending') throw httpErr('เจ้าหน้าที่ดำเนินการกับคำขอนี้ไปแล้ว ไม่สามารถยกเลิกจากฝั่งผู้ใช้ได้', 409);
  db.prepare(`UPDATE equipment_requests SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(nowIso(), id);
  return getEquipmentRequest(id);
}

function setEquipmentRequestStatus(id, status, { note, copyId } = {}) {
  if (!REQUEST_STATUSES.includes(status)) throw httpErr('สถานะไม่ถูกต้อง', 400);
  const r = getEquipmentRequest(id);
  if (!r) throw httpErr('ไม่พบคำขอนี้', 404);
  const cleanNote = note ? String(note).trim().slice(0, 300) : null;
  const now = nowIso();

  if (status === 'approved') {
    if (r.status !== 'pending') throw httpErr('อนุมัติได้เฉพาะคำขอที่รอดำเนินการ', 409);
    const useCopyId = copyId ? Number(copyId) : r.copy_id;
    const copy = useCopyId ? getEquipmentCopy(useCopyId) : null;
    if (!copy) throw httpErr('อุปกรณ์ที่ขอถูกลบไปแล้ว กรุณาเลือกรายการอื่น หรือปฏิเสธคำขอ', 409);
    if (r.equipment_id && copy.equipment_id !== r.equipment_id) throw httpErr('รายการที่เลือกไม่ใช่อุปกรณ์ชนิดเดียวกับคำขอ', 400);
    db.exec('BEGIN');
    try {
      const loan = createEquipmentLoan(copy.id, r.student_id, { year_level: r.year_level, major: r.major, faculty: r.faculty });
      db.prepare(`UPDATE equipment_requests SET status = 'approved', copy_id = ?, copy_label = ?, loan_id = ?, staff_note = ?, updated_at = ? WHERE id = ?`)
        .run(copy.id, copy.label, loan.id, cleanNote, now, id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return getEquipmentRequest(id);
  }

  if (status === 'pending') {
    if (r.status === 'pending') return r;
    if (r.status === 'approved') throw httpErr('คำขอที่อนุมัติแล้วเปลี่ยนกลับเป็นรอดำเนินการไม่ได้ (ถ้ายืมผิด ให้รับคืนในหน้า \"การยืม–คืน\")', 409);
    const dup = db.prepare(`SELECT id FROM equipment_requests WHERE student_id = ? AND status = 'pending' AND id != ?`).get(r.student_id, id);
    if (dup) throw httpErr('ผู้ขอรายนี้มีคำขออื่นที่รอดำเนินการอยู่แล้ว', 409);
    db.prepare(`UPDATE equipment_requests SET status = 'pending', updated_at = ? WHERE id = ?`).run(now, id);
    return getEquipmentRequest(id);
  }

  if (r.status === 'approved') throw httpErr('คำขอที่อนุมัติแล้วเปลี่ยนสถานะไม่ได้ (ถ้ายืมผิด ให้รับคืนในหน้า \"การยืม–คืน\")', 409);
  db.prepare(`UPDATE equipment_requests SET status = ?, staff_note = ?, updated_at = ? WHERE id = ?`).run(status, cleanNote, now, id);
  return getEquipmentRequest(id);
}

// ---------- dashboard stats ----------
function getStats() {
  const copyCounts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM game_copies GROUP BY status`)
    .all()
    .reduce((acc, row) => ({ ...acc, [row.status]: row.n }), {});

  const { totalGames } = db.prepare(`SELECT COUNT(*) AS totalGames FROM games`).get();
  const { overdue } = db
    .prepare(`SELECT (SELECT COUNT(*) FROM loans WHERE returned_at IS NULL AND due_at < ?1)
                   + (SELECT COUNT(*) FROM equipment_loans WHERE returned_at IS NULL AND due_at < ?1) AS overdue`)
    .get(nowIso());
  const { borrowers } = db
    .prepare(`SELECT COUNT(DISTINCT borrower_name COLLATE NOCASE) AS borrowers
              FROM (SELECT borrower_name FROM loans UNION ALL SELECT borrower_name FROM equipment_loans)`)
    .get();

  return {
    totalGames,
    available: copyCounts.available || 0,
    borrowed: copyCounts.borrowed || 0,
    maintenance: copyCounts.maintenance || 0,
    overdue,
    borrowers,
    pendingRequests: countPendingRequests(),
  };
}

// ---------- period stats (รายวัน / สรุปรายเดือน / รายปี — แยกตามคณะและสาขา) ----------
// นับตามเวลาไทย (UTC+7) เพื่อให้ "วันที่" ตรงกับที่เจ้าหน้าที่เห็นจริง
const THAI_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const pad2 = (n) => String(n).padStart(2, '0');
const TZ_OFFSET_HOURS = 7;
const NO_FACULTY = 'ไม่ระบุคณะ';
const NO_MAJOR = 'ไม่ระบุสาขา';

function periodRange(type, year, month) {
  if (type === 'year') {
    return { start: `${year}-01-01`, end: `${year + 1}-01-01`, prevStart: `${year - 1}-01-01`, prevEnd: `${year}-01-01` };
  }
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  return {
    start: `${year}-${pad2(month)}-01`,
    end: `${nextY}-${pad2(nextM)}-01`,
    prevStart: `${prevY}-${pad2(prevM)}-01`,
    prevEnd: `${year}-${pad2(month)}-01`,
  };
}

// ดึงรายการยืมในช่วง [start, end) ตามเวลาไทย พร้อมวัน/เดือนท้องถิ่น และธงเกินกำหนด
function loansInRange(start, end) {
  const off = `'+${TZ_OFFSET_HOURS} hours'`;
  return db
    .prepare(`
      SELECT
        borrower_name,
        COALESCE(NULLIF(TRIM(faculty), ''), '${NO_FACULTY}') AS faculty,
        COALESCE(NULLIF(TRIM(major), ''), '${NO_MAJOR}') AS major,
        CAST(strftime('%Y', datetime(borrowed_at, ${off})) AS INTEGER) AS y,
        CAST(strftime('%m', datetime(borrowed_at, ${off})) AS INTEGER) AS m,
        CAST(strftime('%d', datetime(borrowed_at, ${off})) AS INTEGER) AS d,
        CASE WHEN (returned_at IS NOT NULL AND returned_at > due_at) OR (returned_at IS NULL AND due_at < ?) THEN 1 ELSE 0 END AS overdue
      FROM (
        SELECT borrower_name, faculty, major, borrowed_at, due_at, returned_at FROM loans
        UNION ALL
        SELECT borrower_name, faculty, major, borrowed_at, due_at, returned_at FROM equipment_loans
      )
      WHERE date(datetime(borrowed_at, ${off})) >= ? AND date(datetime(borrowed_at, ${off})) < ?
    `)
    .all(nowIso(), start, end);
}

// สรุปกลุ่มของรายการยืม: ยอดรวม + แยกคณะ -> สาขา (เรียงมาก -> น้อย)
function summarize(rows) {
  const names = new Set();
  let overdue = 0;
  const fac = new Map();
  for (const r of rows) {
    const key = r.borrower_name.trim().toLowerCase();
    names.add(key);
    overdue += r.overdue;
    let f = fac.get(r.faculty);
    if (!f) fac.set(r.faculty, (f = { faculty: r.faculty, total: 0, overdue: 0, names: new Set(), majors: new Map() }));
    f.total++; f.overdue += r.overdue; f.names.add(key);
    let m = f.majors.get(r.major);
    if (!m) f.majors.set(r.major, (m = { major: r.major, total: 0, overdue: 0, names: new Set() }));
    m.total++; m.overdue += r.overdue; m.names.add(key);
  }
  const byCount = (a, b) => b.total - a.total || String(a.faculty || a.major).localeCompare(String(b.faculty || b.major), 'th');
  const faculties = [...fac.values()]
    .map((f) => ({
      faculty: f.faculty, total: f.total, borrowers: f.names.size, overdue: f.overdue,
      majors: [...f.majors.values()].map((m) => ({ major: m.major, total: m.total, borrowers: m.names.size, overdue: m.overdue })).sort(byCount),
    }))
    .sort(byCount);
  const total = rows.length;
  return { total, borrowers: names.size, overdue, overdueRate: total ? Math.round((overdue / total) * 1000) / 10 : 0, faculties };
}

function getPeriodStats({ type, year, month }) {
  const nowTh = new Date(Date.now() + TZ_OFFSET_HOURS * 3600000);
  type = type === 'year' ? 'year' : 'month';
  year = Number(year) || nowTh.getUTCFullYear();
  month = Math.min(12, Math.max(1, Number(month) || nowTh.getUTCMonth() + 1));

  const { start, end, prevStart, prevEnd } = periodRange(type, year, month);
  const rows = loansInRange(start, end);
  const current = summarize(rows);
  const { total, borrowers, overdue, overdueRate } = summarize(loansInRange(prevStart, prevEnd));

  // รายละเอียดรายวัน (มุมมองเดือน) หรือรายเดือน (มุมมองปี) — แต่ละช่วงแยกคณะ/สาขาด้วย
  let detail, trend;
  if (type === 'month') {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    detail = Array.from({ length: daysInMonth }, (_, i) => {
      const dd = i + 1;
      const wd = new Date(Date.UTC(year, month - 1, dd)).getUTCDay();
      return { key: dd, label: String(dd), date: `${year}-${pad2(month)}-${pad2(dd)}`, weekday: wd, ...summarize(rows.filter((r) => r.d === dd)) };
    });
    trend = detail.map((x) => ({ label: x.label, count: x.total }));
  } else {
    detail = Array.from({ length: 12 }, (_, i) => ({
      key: i + 1, label: THAI_MONTH_SHORT[i], month: i + 1, ...summarize(rows.filter((r) => r.m === i + 1)),
    }));
    trend = detail.map((x) => ({ label: x.label, count: x.total }));
  }

  return { type, year, month, ...current, prev: { total, borrowers, overdue, overdueRate }, trend, detail };
}

// ---------- borrowers (derived "users" — there is no login/account system) ----------
function listBorrowers() {
  return db
    .prepare(`
      SELECT
        borrower_name AS name,
        COUNT(*) AS total_loans,
        SUM(CASE WHEN returned_at IS NULL THEN 1 ELSE 0 END) AS active_loans,
        MAX(borrowed_at) AS last_borrowed_at
      FROM (
        SELECT borrower_name, borrowed_at, returned_at FROM loans
        UNION ALL
        SELECT borrower_name, borrowed_at, returned_at FROM equipment_loans
      )
      GROUP BY borrower_name COLLATE NOCASE
      ORDER BY last_borrowed_at DESC
    `)
    .all();
}

module.exports = {
  listGamesWithCopies,
  setRating,
  getRatingSummary,
  getGame,
  setGameImage,
  listEquipmentWithCopies,
  addEquipment,
  updateEquipment,
  deleteEquipment,
  addEquipmentCopy,
  deleteEquipmentCopy,
  setEquipmentCopyStatus,
  addGame,
  updateGame,
  deleteGame,
  addCopy,
  deleteCopy,
  setCopyStatus,
  getCopy,
  createLoan,
  returnLoan,
  listRequests,
  getRequest,
  createRequest,
  cancelRequestByStudent,
  setRequestStatus,
  countPendingRequests,
  listLoans,
  createEquipmentLoan,
  returnEquipmentLoan,
  listEquipmentLoans,
  listEquipmentRequests,
  getEquipmentRequest,
  createEquipmentRequest,
  cancelEquipmentRequestByStudent,
  setEquipmentRequestStatus,
  getStats,
  getPeriodStats,
  listBorrowers,
  LOAN_MINUTES,
};
