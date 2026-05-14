"use strict";

const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const path = require("path");
const fs = require("fs");

// Ensure data directory exists
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const adapter = new FileSync(path.join(dataDir, "db.json"));
const db = low(adapter);

// Default database structure
db.defaults({
  users: [],
  channels: [],
  groups: [],
  logs: [],
  settings: {
    maintenance: false,
    welcomeMessage: "مرحباً بك في بوت إدارة القنوات",
  },
}).write();

// ========== USERS ==========

function getUser(userId) {
  userId = parseInt(userId);
  return db.get("users").find({ userId }).value() || null;
}

function setUser(userId, data) {
  userId = parseInt(userId);
  const existing = db.get("users").find({ userId }).value();
  if (existing) {
    db.get("users")
      .find({ userId })
      .assign({ ...data, updatedAt: new Date().toISOString() })
      .write();
  } else {
    db.get("users")
      .push({
        userId,
        firstName: data.firstName || "مستخدم",
        username: data.username || null,
        role: data.role || "user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      })
      .write();
  }
  return getUser(userId);
}

function getAllUsers() {
  return db.get("users").value() || [];
}

function deleteUser(userId) {
  userId = parseInt(userId);
  db.get("users").remove({ userId }).write();
}

// ========== CHANNELS ==========

function getChannel(channelId) {
  channelId = parseInt(channelId) || channelId;
  return (
    db.get("channels").find({ channelId }).value() ||
    db.get("channels").find({ username: channelId }).value() ||
    null
  );
}

function setChannel(channelId, data) {
  channelId = parseInt(channelId) || channelId;
  const existing = db.get("channels").find({ channelId }).value();
  if (existing) {
    db.get("channels")
      .find({ channelId })
      .assign({ ...data, updatedAt: new Date().toISOString() })
      .write();
  } else {
    db.get("channels")
      .push({
        channelId,
        title: data.title || "قناة",
        username: data.username || null,
        ownerId: data.ownerId || null,
        adminIds: data.adminIds || [],
        membersCount: data.membersCount || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      })
      .write();
  }
  return getChannel(channelId);
}

function getAllChannels() {
  return db.get("channels").value() || [];
}

function deleteChannel(channelId) {
  channelId = parseInt(channelId) || channelId;
  db.get("channels").remove({ channelId }).write();
}

// ========== GROUPS ==========

function getGroup(groupId) {
  groupId = parseInt(groupId) || groupId;
  return db.get("groups").find({ groupId }).value() || null;
}

function setGroup(groupId, data) {
  groupId = parseInt(groupId) || groupId;
  const existing = db.get("groups").find({ groupId }).value();
  if (existing) {
    db.get("groups")
      .find({ groupId })
      .assign({ ...data, updatedAt: new Date().toISOString() })
      .write();
  } else {
    db.get("groups")
      .push({
        groupId,
        title: data.title || "مجموعة",
        ownerId: data.ownerId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      })
      .write();
  }
  return getGroup(groupId);
}

function getAllGroups() {
  return db.get("groups").value() || [];
}

function deleteGroup(groupId) {
  groupId = parseInt(groupId) || groupId;
  db.get("groups").remove({ groupId }).write();
}

// ========== SETTINGS ==========

function getSettings() {
  return (
    db.get("settings").value() || {
      maintenance: false,
      welcomeMessage: "مرحباً بك في بوت إدارة القنوات",
    }
  );
}

function updateSettings(data) {
  db.set("settings", { ...getSettings(), ...data }).write();
  return getSettings();
}

// ========== LOGS ==========

function addLog(data) {
  db.get("logs")
    .push({
      ...data,
      timestamp: new Date().toISOString(),
    })
    .write();

  // Keep only last 500 logs to save space
  const logs = db.get("logs").value();
  if (logs.length > 500) {
    db.set("logs", logs.slice(logs.length - 500)).write();
  }
}

function getLogs(limit = 20) {
  const logs = db.get("logs").value() || [];
  return logs.slice(-limit).reverse();
}

function clearLogs() {
  db.set("logs", []).write();
}

module.exports = {
  // Users
  getUser,
  setUser,
  getAllUsers,
  deleteUser,
  // Channels
  getChannel,
  setChannel,
  getAllChannels,
  deleteChannel,
  // Groups
  getGroup,
  setGroup,
  getAllGroups,
  deleteGroup,
  // Settings
  getSettings,
  updateSettings,
  // Logs
  addLog,
  getLogs,
  clearLogs,
};
