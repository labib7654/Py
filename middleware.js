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
  const role = getUserRole(userId);
  return roles.includes(role);
}

async function registerUser(msg) {
  if (!msg || !msg.from) return null;
  const from = msg.from;
  const userId = from.id;

  let user = database.getUser(userId);
  const data = {
    userId,
    firstName: from.first_name || "مستخدم",
    lastName: from.last_name || null,
    username: from.username || null,
  };

  if (!user) {
    data.role =
      userId === parseInt(config.DEVELOPER_ID)
        ? config.ROLES.DEVELOPER
        : config.ROLES.USER;
    database.setUser(userId, data);
    database.addLog({ action: "new_user", userId });
  } else {
    database.setUser(userId, {
      firstName: data.firstName,
      lastName: data.lastName,
      username: data.username,
    });
  }

  return database.getUser(userId);
}

async function requireAuth(bot, msg, next) {
  if (!msg || !msg.from) return;

  const user = await registerUser(msg);
  const role = getUserRole(msg.from.id);

  if (role === config.ROLES.BANNED) {
    await bot.sendMessage(msg.chat.id, config.MESSAGES.BANNED);
    return;
  }

  const settings = database.getSettings();
  if (settings.maintenance && role !== config.ROLES.DEVELOPER) {
    await bot.sendMessage(
      msg.chat.id,
      "البوت في وضع الصيانة حالياً. يرجى المحاولة لاحقاً."
    );
    return;
  }

  await next(user);
}

async function requireOwner(bot, msg, next) {
  await requireAuth(bot, msg, async (user) => {
    await next(user);
  });
}

async function requireAdmin(bot, msg, next) {
  await requireAuth(bot, msg, async (user) => {
    const role = getUserRole(msg.from.id);
    const allowed = [config.ROLES.ADMIN, config.ROLES.DEVELOPER];
    if (!allowed.includes(role)) {
      await bot.sendMessage(msg.chat.id, config.MESSAGES.NO_PERMISSION);
      return;
    }
    await next(user);
  });
}

async function requireDeveloper(bot, msg, next) {
  await requireAuth(bot, msg, async (user) => {
    const role = getUserRole(msg.from.id);
    if (role !== config.ROLES.DEVELOPER) {
      await bot.sendMessage(msg.chat.id, config.MESSAGES.NO_PERMISSION);
      return;
    }
    await next(user);
  });
}

module.exports = {
  getUserRole,
  hasRole,
  registerUser,
  requireAuth,
  requireOwner,
  requireAdmin,
  requireDeveloper,
};
