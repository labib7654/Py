"use strict";

const cfg = require("./config");
const db  = require("./db");
const { isDev } = require("./helpers");

function getRole(userId) {
  userId = parseInt(userId);
  if (userId === cfg.DEVELOPER_ID) return cfg.ROLES.DEVELOPER;
  const u = db.getUser(userId);
  return u ? u.role : cfg.ROLES.USER;
}

function isAtLeast(userId, ...roles) {
  return roles.includes(getRole(userId));
}

async function touch(from) {
  if (!from) return null;
  const id   = parseInt(from.id);
  const role = id === cfg.DEVELOPER_ID ? cfg.ROLES.DEVELOPER : (db.getUser(id)?.role || cfg.ROLES.USER);
  db.upsertUser(id, { name: from.first_name || "مستخدم", username: from.username || null, role });
  return db.getUser(id);
}

module.exports = { getRole, isAtLeast, touch };
