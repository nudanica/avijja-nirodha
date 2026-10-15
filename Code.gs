/**
 * ระบบเบื้องหลัง คลังองค์ธรรมเพราะอวิชชาดับ
 * - เก็บข้อเสนอ รหัสทีมงาน และรายชื่อแอดมินไว้ใน Google Sheets
 * - เมื่อแอดมินอนุมัติหรือแก้ไข จะบันทึก data/site.json ขึ้น GitHub
 *
 * ค่าที่ต้องตั้งใน Project Settings > Script properties (ครั้งเดียว):
 *   GITHUB_TOKEN     รหัสจาก GitHub (Contents: Read and write เฉพาะ repo นี้)
 *   GITHUB_REPO      เช่น nudanica/avijja-nirodha
 *   MAIN_ADMIN_CODE  รหัสผู้ดูแลหลัก ๖ หลัก ที่คุณตั้งเอง
 * ค่าที่ระบบสร้างเอง: SHEET_ID
 */

var DATA_PATH = 'data/site.json';
var BRANCH = 'main';

// ---------------- entry ----------------
function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    out = handle_(req);
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'avijja-nirodha' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  book_();
  var a = req.action;
  if (a === 'checkTeam') return { ok: checkTeam_(req.teamCode) };
  if (a === 'propose') return propose_(req);
  if (a === 'checkAdmin') { var ad = admin_(req.adminCode); return ad ? { ok: true, name: ad.name, isMain: ad.isMain } : { ok: false }; }

  var me = admin_(req.adminCode);
  if (!me) return { ok: false, error: 'not_admin' };

  if (a === 'getData') return { ok: true, data: readSite_().data };
  if (a === 'listPending') return { ok: true, items: listProposals_('pending') };
  if (a === 'decide') return decide_(me, req.id, !!req.approve);
  if (a === 'saveData') return saveData_(me, req.data, req.message);
  if (a === 'uploadImage') return uploadImage_(me, req.b64);

  if (!me.isMain) return { ok: false, error: 'not_main' };
  if (a === 'getSettings') return { ok: true, teamCode: prop_('TEAM_CODE') || '', admins: listAdmins_() };
  if (a === 'setTeamCode') return setTeamCode_(req.newCode);
  if (a === 'addAdmin') return addAdmin_(req.name);
  if (a === 'removeAdmin') return removeAdmin_(req.code);
  return { ok: false, error: 'unknown_action' };
}

// ---------------- properties / sheet ----------------
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }

function book_() {
  var id = prop_('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var ss = SpreadsheetApp.create('ข้อมูลทีมงาน คลังองค์ธรรมเพราะอวิชชาดับ');
  setProp_('SHEET_ID', ss.getId());
  var p = ss.getSheets()[0];
  p.setName('ข้อเสนอ');
  p.appendRow(['id', 'เวลาที่เสนอ', 'ประเภท', 'ห้อง', 'องค์ธรรมที่', 'ชื่อผู้เสนอ', 'ข้อความ', 'สถานะ', 'ผู้ตรวจ', 'เวลาที่ตรวจ']);
  var ad = ss.insertSheet('แอดมิน');
  ad.appendRow(['ชื่อ', 'รหัส', 'เพิ่มเมื่อ']);
  if (!prop_('TEAM_CODE')) setProp_('TEAM_CODE', randomDigits_(4));
  return ss;
}
function sheet_(name) { return book_().getSheetByName(name); }

function randomDigits_(n) {
  var s = '';
  for (var i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// ---------------- codes ----------------
function checkTeam_(code) {
  book_();
  var t = prop_('TEAM_CODE');
  return !!code && !!t && String(code) === String(t);
}

function admin_(code) {
  if (!code) return null;
  code = String(code);
  var main = prop_('MAIN_ADMIN_CODE');
  if (main && code === String(main)) return { name: 'ผู้ดูแลหลัก', isMain: true };
  var rows = sheet_('แอดมิน').getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) === code) return { name: String(rows[i][0]), isMain: false };
  }
  return null;
}

function listAdmins_() {
  var rows = sheet_('แอดมิน').getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) if (rows[i][1] !== '') out.push({ name: String(rows[i][0]), code: String(rows[i][1]) });
  return out;
}

function setTeamCode_(c) {
  c = String(c || '');
  if (!/^\d{4}$/.test(c)) return { ok: false, error: 'team_code_4_digits' };
  setProp_('TEAM_CODE', c);
  return { ok: true, teamCode: c };
}

function addAdmin_(name) {
  name = String(name || '').trim();
  if (!name) return { ok: false, error: 'name_required' };
  var sh = sheet_('แอดมิน');
  var used = {};
  listAdmins_().forEach(function (a) { used[a.code] = 1; });
  var code;
  do { code = randomDigits_(6); } while (used[code] || code === prop_('MAIN_ADMIN_CODE'));
  sh.appendRow([name, "'" + code, new Date()]);
  return { ok: true, admins: listAdmins_() };
}

function removeAdmin_(code) {
  var sh = sheet_('แอดมิน');
  var rows = sh.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) if (String(rows[i][1]) === String(code)) sh.deleteRow(i + 1);
  return { ok: true, admins: listAdmins_() };
}

// ---------------- proposals ----------------
function propose_(req) {
  if (!checkTeam_(req.teamCode)) return { ok: false, error: 'bad_team_code' };
  var text = String(req.text || '');
  var name = String(req.name || '').trim();
  if (!text.trim()) return { ok: false, error: 'text_required' };
  if (!name) return { ok: false, error: 'name_required' };
  var type = req.type === 'edit' ? 'edit' : 'add';
  var id = Utilities.getUuid().slice(0, 8);
  sheet_('ข้อเสนอ').appendRow([id, new Date(), type === 'edit' ? 'แก้ไข' : 'เพิ่มใหม่',
    Number(req.room) || 0, type === 'edit' ? (Number(req.note) || 0) : '', name, text, 'รอตรวจ', '', '']);
  return { ok: true, id: id };
}

function listProposals_(which) {
  var rows = sheet_('ข้อเสนอ').getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (which === 'pending' && r[7] !== 'รอตรวจ') continue;
    out.push({ id: String(r[0]), time: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      type: r[2] === 'แก้ไข' ? 'edit' : 'add', room: Number(r[3]), note: Number(r[4]) || 0,
      name: String(r[5]), text: String(r[6]) });
  }
  return out;
}

function decide_(me, id, approve) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_('ข้อเสนอ');
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== String(id)) continue;
      if (rows[i][7] !== 'รอตรวจ') return { ok: false, error: 'already_decided' };
      if (approve) {
        var p = { type: rows[i][2] === 'แก้ไข' ? 'edit' : 'add', room: Number(rows[i][3]), note: Number(rows[i][4]) || 0, text: String(rows[i][6]) };
        var site = readSite_();
        applyProposal(site.data, p);
        writeSite_(site, 'อนุมัติข้อเสนอของ ' + rows[i][5] + ' โดย ' + me.name);
      }
      sh.getRange(i + 1, 8, 1, 3).setValues([[approve ? 'อนุมัติ' : 'ไม่อนุมัติ', me.name, new Date()]]);
      return { ok: true };
    }
    return { ok: false, error: 'not_found' };
  } finally {
    lock.releaseLock();
  }
}

// Pure: changes the site data for one proposal. Text is stored exactly as sent.
function applyProposal(data, p) {
  var room = data.rooms[p.room - 1];
  if (!room) throw new Error('room_not_found');
  var t = String(p.text);
  var title = firstLine(t);
  if (p.type === 'edit') {
    var n = room.notes[p.note - 1];
    if (!n) throw new Error('note_not_found');
    n.text = t; n.title = title;
  } else {
    room.notes.push({ title: title, text: t });
  }
  return data;
}

function firstLine(t) {
  var lines = String(t).split('\n');
  for (var i = 0; i < lines.length; i++) if (lines[i].trim()) return lines[i].trim();
  return '';
}

// ---------------- admin direct edits ----------------
function saveData_(me, data, message) {
  if (!data || !data.rooms || !data.ratana) return { ok: false, error: 'bad_data' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var site = readSite_();
    site.data = data;
    writeSite_(site, (message || 'แก้ไข') + ' โดย ' + me.name);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function uploadImage_(me, b64) {
  if (!b64) return { ok: false, error: 'no_image' };
  var path = 'images/people/' + Date.now() + '.jpg';
  gh_('PUT', '/contents/' + path, { message: 'เพิ่มรูป โดย ' + me.name, content: b64, branch: BRANCH });
  return { ok: true, path: path };
}

// ---------------- GitHub ----------------
function gh_(method, path, body) {
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + prop_('GITHUB_REPO') + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('GITHUB_TOKEN'), Accept: 'application/vnd.github+json' },
    payload: body ? JSON.stringify(body) : null,
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) throw new Error('github_' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function readSite_() {
  var f = gh_('GET', '/contents/' + DATA_PATH + '?ref=' + BRANCH);
  var text = Utilities.newBlob(Utilities.base64Decode(f.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  return { sha: f.sha, data: JSON.parse(text) };
}

function writeSite_(site, message) {
  var json = JSON.stringify(site.data, null, 1);
  var b64 = Utilities.base64Encode(Utilities.newBlob(json, 'application/json').getBytes());
  gh_('PUT', '/contents/' + DATA_PATH, { message: message, content: b64, sha: site.sha, branch: BRANCH });
}

// ---------------- one-time check (run from the editor) ----------------
function setup() {
  var ss = book_();
  var site = readSite_();
  Logger.log('ตาราง: ' + ss.getUrl());
  Logger.log('รหัสทีมงาน: ' + prop_('TEAM_CODE'));
  Logger.log('อ่านข้อมูลเว็บได้: ' + site.data.rooms.length + ' ห้อง');
  if (!prop_('MAIN_ADMIN_CODE')) Logger.log('ยังไม่ได้ตั้ง MAIN_ADMIN_CODE');
}
