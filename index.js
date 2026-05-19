const { Telegraf } = require('telegraf');
const express = require('express');
const { BOT_TOKEN } = require('./config');
const db = require('./db');
const {
  applyTelegramContentProtection,
} = require('./helpers');

const setupGroupHandlers = require('./handler_groups');
const setupOwnerHandlers = require('./handler_owner');
const setupVerifyActions = require('./verify_actions');
const setupVerifyCommands = require('./verify_commands');
const setupVerifyRegistration = require('./verify_registration');

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is missing');
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
const PORT = Number(process.env.PORT || 3000);

applyTelegramContentProtection(bot);

app.get('/', (_req, res) => res.status(200).send('ok'));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

setupGroupHandlers(bot);
setupOwnerHandlers(bot);
setupVerifyActions(bot);
setupVerifyCommands(bot);
setupVerifyRegistration(bot);

bot.catch((err, ctx) => {
  const chatId = ctx?.chat?.id || ctx?.update?.message?.chat?.id || 'unknown';
  console.error(`[bot] chat=${chatId}`, err);
});

async function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HTTP server listening on ${PORT}`);
  });
  await bot.launch();
  const stats = db.getStats();
  console.log(`Bot launched. groups=${stats.totalGroups} users=${stats.totalUsers}`);
}

if (require.main === module) {
  start().catch(err => {
    console.error('Failed to launch bot:', err);
    process.exit(1);
  });
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

module.exports = { bot, start };
