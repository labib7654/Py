"use strict";

const config = require("./config");

function isDeveloper(userId) {
  return parseInt(userId) === parseInt(config.DEVELOPER_ID);
}

function formatNumber(num) {
  return (num || 0).toLocaleString("ar-SA");
}

function parseChannelId(input) {
  if (!input) return null;
  const str = input.toString().trim();
  if (str.startsWith("@")) return str;
  if (/^-?\d+$/.test(str)) return parseInt(str);
  return null;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function shortDate(iso) {
  if (!iso) return "غير معروف";
  return new Date(iso).toLocaleDateString("ar-SA");
}

module.exports = { isDeveloper, formatNumber, parseChannelId, chunkArray, shortDate };
