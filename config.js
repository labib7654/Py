require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  DEVELOPER_ID: Number(process.env.DEVELOPER_ID || '0'),
  PORT: Number(process.env.PORT || 3000),
  RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL || '',
  WEBHOOK_PATH: '/webhook',
};
