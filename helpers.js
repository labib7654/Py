"use strict";

const config = require("./config");

function formatUser(user) {
  const name = user.first_name + (user.last_name ? " " + user.last_name : "");
  return `[${name}](tg://user?id=${user.id})`;
}

function getRoleBadge(role) {
  const badges = {
    developer: "[DEV]",
    owner: "[OWNER]",
    admin: "[ADMIN]",
    user: "[USER]",
    banned: "[BANNED]",
  };
  return badges[role] || "[USER]";
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNumber(num) {
  return num ? num.toLocaleString("ar-SA") : "0";
}

function isDeveloper(userId) {
  return parseInt(userId) === parseInt(config.DEVELOPER_ID);
}

function buildKeyboard(buttons, options = {}) {
  return {
    reply_markup: {
      inline_keyboard: buttons,
      ...options,
    },
  };
}

function buildReplyKeyboard(buttons, options = {}) {
  return {
    reply_markup: {
      keyboard: buttons,
      resize_keyboard: true,
      one_time_keyboard: false,
      ...options,
    },
  };
}

function escapeMarkdown(text) {
  if (!text) return "";
  return text.toString().replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}

function parseChannelId(input) {
  if (!input) return null;
  const str = input.toString().trim();
  if (str.startsWith("@")) return str;
  if (str.startsWith("-100")) return parseInt(str);
  if (/^-?\d+$/.test(str)) return parseInt(str);
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

module.exports = {
  formatUser,
  getRoleBadge,
  formatDate,
  formatNumber,
  isDeveloper,
  buildKeyboard,
  buildReplyKeyboard,
  escapeMarkdown,
  parseChannelId,
  delay,
  chunkArray,
};
