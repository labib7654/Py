"use strict";

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(process.cwd(), "data", "db.json");

const defaultData = {
  users: [],
  channels: [],
  groups: [],
  logs: [],
  settings: {
    maintenance: false,
    welcomeMessage: "مرحباً بك في بوت إدارة المجتمعات",
  },
};

function ensureDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir();
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
      return JSON.parse(JSON.stringify(defaultData));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    console.error("[DB] Load error:", e.message);
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function save(data) {
  try {
    ensureDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[DB] Save error:", e.message);
  }
}

// ===== USERS =====

function getUser(userId) {
  userId = parseInt(userId);
  const db = load();
  return db.users.find((u) => u.userId === userId) || null;
}

function setUser(userId, data) {
  userId = parseInt(userId);
  const db = load();
  const idx = db.users.findIndex((u) => u.userId === userId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    db.users[idx] = { ...db.users[idx], ...data, userId, updatedAt: now };
  } else {
    db.users.push({
      userId,
      firstName: data.firstName || "مستخدم",
      username: data.username || null,
      role: data.role || "user",
      createdAt: now,
      updatedAt: now,
      ...data,
    });
  }
  save(db);
  return getUser(userId);
}

function getAllUsers() {
  return load().users || [];
}

function deleteUser(userId) {
  userId = parseInt(userId);
  const db = load();
  db.users = db.users.filter((u) => u.userId !== userId);
  save(db);
}

// ===== CHANNELS =====

function getChannel(channelId) {
  const db = load();
  const id = parseInt(channelId) || channelId;
  return (
    db.channels.find((c) => c.channelId === id) ||
    db.channels.find((c) => c.username === channelId) ||
    null
  );
}

function setChannel(channelId, data) {
  const db = load();
  const id = parseInt(channelId) || channelId;
  const idx = db.channels.findIndex((c) => c.channelId === id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    db.channels[idx] = { ...db.channels[idx], ...data, channelId: id, updatedAt: now };
  } else {
    db.channels.push({
      channelId: id,
      title: data.title || "قناة",
      username: data.username || null,
      ownerId: data.ownerId || null,
      adminIds: data.adminIds || [],
      membersCount: data.membersCount || 0,
      createdAt: now,
      updatedAt: now,
      ...data,
    });
  }
  save(db);
  return getChannel(id);
}

function getAllChannels() {
  return load().channels || [];
}

function deleteChannel(channelId) {
  const db = load();
  const id = parseInt(channelId) || channelId;
  db.channels = db.channels.filter(
    (c) => c.channelId !== id && c.username !== channelId
  );
  save(db);
}

// ===== GROUPS =====

function getGroup(groupId) {
  const db = load();
  const id = parseInt(groupId) || groupId;
  return db.groups.find((g) => g.groupId === id) || null;
}

function setGroup(groupId, data) {
  const db = load();
  const id = parseInt(groupId) || groupId;
  const idx = db.groups.findIndex((g) => g.groupId === id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    db.groups[idx] = { ...db.groups[idx], ...data, groupId: id, updatedAt: now };
  } else {
    db.groups.push({
      groupId: id,
      title: data.title || "مجموعة",
      ownerId: data.ownerId || null,
      adminIds: data.adminIds || [],
      membersCount: data.membersCount || 0,
      createdAt: now,
      updatedAt: now,
      ...data,
    });
  }
  save(db);
  return getGroup(id);
}

function getAllGroups() {
  return load().groups || [];
}

function deleteGroup(groupId) {
  const db = load();
  const id = parseInt(groupId) || groupId;
  db.groups = db.groups.filter((g) => g.groupId !== id);
  save(db);
}

// ===== SETTINGS =====

function getSettings() {
  return load().settings || defaultData.settings;
}

function updateSettings(data) {
  const db = load();
  db.settings = { ...db.settings, ...data };
  save(db);
  return db.settings;
}

// ===== LOGS =====

function addLog(entry) {
  const db = load();
  db.logs.push({ ...entry, timestamp: new Date().toISOString() });
  if (db.logs.length > 500) db.logs = db.logs.slice(-500);
  save(db);
}

function getLogs(limit = 20) {
  const logs = load().logs || [];
  return logs.slice(-limit).reverse();
}

function clearLogs() {
  const db = load();
  db.logs = [];
  save(db);
}

module.exports = {
  getUser, setUser, getAllUsers, deleteUser,
  getChannel, setChannel, getAllChannels, deleteChannel,
  getGroup, setGroup, getAllGroups, deleteGroup,
  getSettings, updateSettings,
  addLog, getLogs, clearLogs,
};
