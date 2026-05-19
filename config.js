const parseIdList = (value) =>
  String(value || '')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n !== 0);

const DEVELOPER_ID = Number(process.env.DEVELOPER_ID || process.env.OWNER_ID || 0) || null;
const BOT_TOKEN    = process.env.BOT_TOKEN || '';
const BOT_ADMINS   = parseIdList(process.env.BOT_ADMINS);
const PORT         = Number(process.env.PORT) || 3000;

module.exports = {
  DEVELOPER_ID,
  BOT_TOKEN,
  BOT_ADMINS,
  PORT,
};
