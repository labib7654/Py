require('dotenv').config();

module.exports = {
  BOT_TOKEN:    process.env.BOT_TOKEN    || '',
  DEVELOPER_ID: Number(process.env.DEVELOPER_ID || '0'),
  PORT:         Number(process.env.PORT          || 3000),
  BOT_ADMINS:   process.env.BOT_ADMINS   ? process.env.BOT_ADMINS.split(',').map(Number).filter(n => !isNaN(n)) : [],
};