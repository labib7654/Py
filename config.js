require('dotenv').config();

module.exports = {
  BOT_TOKEN:    process.env.BOT_TOKEN    || '7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y',
  DEVELOPER_ID: Number(process.env.DEVELOPER_ID || '7411444902'),
  PORT: Number(process.env.PORT || 3000),
  RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL || '',
  WEBHOOK_PATH: '/webhook',
};
