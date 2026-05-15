// ============================================================
//  config.js — إعدادات البوت
// ============================================================

require('dotenv').config();

module.exports = {
  BOT_TOKEN:    process.env.BOT_TOKEN    || '',
  DEVELOPER_ID: Number(process.env.DEVELOPER_ID || '0'),
  PORT:         Number(process.env.PORT          || 3000),
};
