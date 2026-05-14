"use strict";

const config = require("./config");
const database = require("./database");

function getUserRole(userId) {
  userId = parseInt(userId);
  if (userId === parseInt(config.DEVELOPER_ID)) return config.ROLES.DEVELOPER;
  const user = database.getUser(userId);
  return user ? user.role : config.ROLES.USER;
}

function hasRole(userId, ...roles) {
  return roles.includes(getUserRole(userId));
}

async function registerUser(from) {
  if (!from) return null;
  const userId = parseInt(from.id);
  const existing = database.getUser(userId);
  const data = {
    userId,
    firstName: from.first_name || "مستخدم",
    username: from.username || null,
  };
  if (!existing) {
    data.role = userId === parseInt(config.DEVELOPER_ID)
      ? config.ROLES.DEVELOPER
      : config.ROLES.USER;
    database.setUser(userId, data);
    database.addLog({ action: "new_user", userId });
  } else {
    database.setUser(userId, { firstName: data.firstName, username: data.username });
  }
  return database.getUser(userId);
}

module.exports = { getUserRole, hasRole, registerUser };
