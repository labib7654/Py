require('dotenv').config();

module.exports = {
  BOT_TOKEN:            process.env.BOT_TOKEN            || '',
  DEVELOPER_ID:         Number(process.env.DEVELOPER_ID  || '0'),
  PORT:                 Number(process.env.PORT           || 3000),
  SUPABASE_URL:         process.env.SUPABASE_URL          || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY  || '',
};
