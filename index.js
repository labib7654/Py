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

/* ── Webhook or Polling ──────────────────────────────────────────── */
const WPATH = `/wh/${cfg.BOT_TOKEN}`;

async function start() {
  // Always clear any old webhook / pending updates first
  try { await bot.deleteWebhook({ drop_pending_updates: true }); } catch (_) {}

  if (cfg.NODE_ENV === "production" && cfg.RENDER_URL) {
    /* ── PRODUCTION  →  Telegram sends updates to our URL ─────────────
       Buttons work 100% because there is no polling conflict.
       Render wakes up on every incoming Telegram request automatically.
    ────────────────────────────────────────────────────────────────── */
    const webhookUrl = cfg.RENDER_URL.replace(/\/$/, "") + WPATH;

    app.post(WPATH, (req, res) => {
      res.sendStatus(200);           // respond fast, always
      bot.processUpdate(req.body);   // handle the update
    });

    await bot.setWebhook(webhookUrl);
    console.log(`[BOT] Webhook → ${webhookUrl}`);

  } else {
    /* ── DEVELOPMENT  →  polling (local only) ───────────────────────── */
    bot.on("polling_error", err => console.error("[POLL]", err.code, err.message));
    await bot.startPolling();
    console.log("[BOT] Polling started (dev mode).");
  }
}

/* ── Start server ────────────────────────────────────────────────── */
app.listen(cfg.PORT, "0.0.0.0", async () => {
  console.log(`[SERVER] Port ${cfg.PORT} | env: ${cfg.NODE_ENV}`);

  await start();

  // Ensure developer record exists with correct role
  const dev = db.getUser(cfg.DEVELOPER_ID);
  if (!dev || dev.role !== "developer")
    db.upsertUser(cfg.DEVELOPER_ID, { name: "المطوّر", role: "developer" });

  db.addLog({ action: "bot_started" });

  // Notify developer
  try {
    const me = await bot.getMe();
    console.log(`[BOT] @${me.username} (${me.id})`);
    await bot.sendMessage(cfg.DEVELOPER_ID,
      `✅ *البوت اشتغل بنجاح!*\n\n` +
      `👤 @${me.username}\n` +
      `🌐 البيئة: ${cfg.NODE_ENV}\n` +
      `📡 الوضع: ${cfg.NODE_ENV === "production" && cfg.RENDER_URL ? "Webhook ✅" : "Polling 🔄"}`,
      { parse_mode: "Markdown" }
    );
  } catch (e) { console.warn("[BOT] Could not notify developer:", e.message); }
});

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT",  () => process.exit(0));
process.on("uncaughtException",  e => console.error("[ERR]", e.message));
process.on("unhandledRejection", e => console.error("[REJ]", e));
