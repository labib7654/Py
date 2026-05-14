"use strict";

const cfg = require("./config");

const isDev   = id => parseInt(id) === cfg.DEVELOPER_ID;
const fmtNum  = n  => (n || 0).toLocaleString("ar-SA");
const fmtDate = s  => s ? new Date(s).toLocaleDateString("ar-SA") : "غير معروف";

function parseChatId(raw) {
  if (!raw) return null;
  const s = raw.toString().trim();
  if (s.startsWith("@"))     return s;
  if (/^-?\d+$/.test(s))    return parseInt(s);
  return null;
}

function kb(rows) { return { reply_markup: { inline_keyboard: rows } }; }

module.exports = { isDev, fmtNum, fmtDate, parseChatId, kb };
