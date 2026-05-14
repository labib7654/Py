"use strict";

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const cfg = require("./config");
const db  = require("./db");
const mw  = require("./middleware");
const { register } = require("./handlers");

/* ── Express ─────────────────────────────────────────────────────── */
const app = express();
app.use(express.json());

app.get("/",       (_, res) => res.json({ status: "ok", uptime: process.uptime() }));
app.get("/health", (_, res) => res.json({ users: db.allUsers().length, channels: db.allChannels().length, groups: db.allGroups().length }));
app.get("/ping",   (_, res) => res.send("pong"));

/* ── Bot ─────────────────────────────────────────────────────────── */
const bot = new TelegramBot(cfg.BOT_TOKEN, { polling: false });
register(bot);

/* ── Webhook path ────────────────────────────────────────────────── */
const WPATH = `/wh/${cfg.BOT_TOKEN}`;

async function start() {
  // Always clear old webhook first
  try { await bot.deleteWebhook({ drop_pending_updates: true }); } catch (_) {}

  if (cfg.RENDER_URL) {
    /* ── WEBHOOK MODE — works on Render (buttons work 100%) ──────── */
    const webhookUrl = cfg.RENDER_URL.replace(/\/$/, "") + WPATH;

    app.post(WPATH, (req, res) => {
      res.sendStatus(200);
      bot.processUpdate(req.body);
    });

    await bot.setWebhook(webhookUrl);
    console.log(`[BOT] Webhook → ${webhookUrl}`);

  } else {
    /* ── POLLING MODE — fallback for local dev or missing RENDER_URL */
    bot.on("polling_error", err => console.error("[POLL]", err.code, err.message));
    await bot.startPolling();
    console.log("[BOT] Polling started.");
  }
}

/* ── Start server ────────────────────────────────────────────────── */
app.listen(cfg.PORT, "0.0.0.0", async () => {
  console.log(`[SERVER] Port ${cfg.PORT} | env: ${cfg.NODE_ENV}`);

  await start();

  // Ensure developer record exists
  const dev = db.getUser(cfg.DEVELOPER_ID);
  if (!dev || dev.role !== "developer")
    db.upsertUser(cfg.DEVELOPER_ID, { name: "المطوّر", role: "developer" });

  db.addLog({ action: "bot_started" });

  // Notify developer on startup
  try {
    const me = await bot.getMe();
    console.log(`[BOT] @${me.username} (${me.id})`);
    await bot.sendMessage(
      cfg.DEVELOPER_ID,
      `✅ *البوت اشتغل!*\n\n👤 @${me.username}\n📡 الوضع: ${cfg.RENDER_URL ? "Webhook ✅" : "Polling 🔄"}`,
      { parse_mode: "Markdown" }
    );
  } catch (e) { console.warn("[BOT] Could not notify developer:", e.message); }
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT",  () => process.exit(0));
process.on("uncaughtException",  e => console.error("[ERR]", e.message));
process.on("unhandledRejection", e => console.error("[REJ]", e));
