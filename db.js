"use strict";

const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "data", "db.json");

const DEFAULTS = {
  users:    [],
  channels: [],
  groups:   [],
  logs:     [],
  settings: { maintenance: false, welcome: "مرحباً بك! 👋" },
};

/* ── helpers ── */
function read() {
  try {
    if (!fs.existsSync(FILE)) return write(JSON.parse(JSON.stringify(DEFAULTS)));
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  return data;
}
const now = () => new Date().toISOString();

/* ── USERS ── */
function getUser(id) {
  id = parseInt(id);
  return read().users.find(u => u.id === id) || null;
}
function upsertUser(id, fields) {
  id = parseInt(id);
  const db  = read();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx >= 0) { db.users[idx] = { ...db.users[idx], ...fields, id, updatedAt: now() }; }
  else          { db.users.push({ id, name: "مستخدم", username: null, role: "user", createdAt: now(), updatedAt: now(), ...fields }); }
  write(db);
  return getUser(id);
}
function allUsers()        { return read().users; }
function removeUser(id)    { id = parseInt(id); const db = read(); db.users = db.users.filter(u => u.id !== id); write(db); }

/* ── CHANNELS ── */
function _cid(v) { return parseInt(v) || v; }
function getChannel(cid) {
  cid = _cid(cid);
  const db = read();
  return db.channels.find(c => c.cid === cid || c.username === cid) || null;
}
function upsertChannel(cid, fields) {
  cid = _cid(cid);
  const db  = read();
  const idx = db.channels.findIndex(c => c.cid === cid);
  if (idx >= 0) { db.channels[idx] = { ...db.channels[idx], ...fields, cid, updatedAt: now() }; }
  else          { db.channels.push({ cid, title: "قناة", username: null, ownerId: null, admins: [], members: 0, createdAt: now(), updatedAt: now(), ...fields }); }
  write(db);
}
function allChannels()      { return read().channels; }
function removeChannel(cid) { cid = _cid(cid); const db = read(); db.channels = db.channels.filter(c => c.cid !== cid); write(db); }

/* ── GROUPS ── */
function getGroup(gid) {
  gid = parseInt(gid) || gid;
  return read().groups.find(g => g.gid === gid) || null;
}
function upsertGroup(gid, fields) {
  gid = parseInt(gid) || gid;
  const db  = read();
  const idx = db.groups.findIndex(g => g.gid === gid);
  if (idx >= 0) { db.groups[idx] = { ...db.groups[idx], ...fields, gid, updatedAt: now() }; }
  else          { db.groups.push({ gid, title: "مجموعة", username: null, ownerId: null, admins: [], members: 0, createdAt: now(), updatedAt: now(), ...fields }); }
  write(db);
}
function allGroups()      { return read().groups; }
function removeGroup(gid) { gid = parseInt(gid) || gid; const db = read(); db.groups = db.groups.filter(g => g.gid !== gid); write(db); }

/* ── SETTINGS ── */
function getSettings()   { return read().settings; }
function patchSettings(p){ const db = read(); db.settings = { ...db.settings, ...p }; write(db); return db.settings; }

/* ── LOGS ── */
function addLog(entry) {
  const db = read();
  db.logs.push({ ...entry, at: now() });
  if (db.logs.length > 500) db.logs = db.logs.slice(-500);
  write(db);
}
function getLogs(n = 20) { return read().logs.slice(-n).reverse(); }
function clearLogs()     { const db = read(); db.logs = []; write(db); }

module.exports = {
  getUser, upsertUser, allUsers, removeUser,
  getChannel, upsertChannel, allChannels, removeChannel,
  getGroup, upsertGroup, allGroups, removeGroup,
  getSettings, patchSettings,
  addLog, getLogs, clearLogs,
};
