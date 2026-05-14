"use strict";

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");
const database = require("./database");
const middleware = require("./middleware");
const { registerHandlers } = require("./commands");

const app = express();
app.use(express.json());

// ─── Health endpoints ─────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const s = database.getSettings();
  res.json({
    status: "ok",
    bot: "Telegram Community Manager Bot",
    maintenance: s.maintenance,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  const users = database.getAllUsers();
  const channels = database.getAllChannels();
  const groups = database.getAllGroups();
  res.json({
    status: "healthy",
    users: users.length,
    channels: channels.length,
    groups: groups.length,
    uptime: process.uptime(),
  });
});

app.get("/ping", (req, res) => res.send("pong"));

// ─── Bot setup ────────────────────────────────────────────────────────────────
const bot = new TelegramBot(config.BOT_TOKEN, { polling: false });
registerHandlers(bot);

// ─── Webhook vs Polling ───────────────────────────────────────────────────────
const WEBHOOK_PATH = `/webhook/${config.BOT_TOKEN}`;

async function setupWebhook() {
  const RENDER_URL = config.RENDER_URL;

  if (config.NODE_ENV === "production" && RENDER_URL) {
    // ── PRODUCTION: use Telegram Webhook ──────────────────────────────────────
    const webhookUrl = `${RENDER_URL.replace(/\/$/, "")}${WEBHOOK_PATH}`;

    // Receive updates from Telegram via POST
    app.post(WEBHOOK_PATH, (req, res) => {
      res.sendStatus(200); // always respond fast
      bot.processUpdate(req.body);
    });

    try {
      await bot.deleteWebhook({ drop_pending_updates: true });
      await bot.setWebhook(webhookUrl);
      console.log(`[BOT] Webhook set to: ${webhookUrl}`);
    } catch (e) {
      console.error("[BOT] Failed to set webhook:", e.message);
    }

  } else {
    // ── DEVELOPMENT: use polling ───────────────────────────────────────────────
    console.log("[BOT] Development mode — using polling.");
    await bot.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    await bot.startPolling();

    bot.on("polling_error", (error) => {
      console.error("[BOT] Polling error:", error.code, error.message);
    });
  }
}

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = config.PORT;

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[SERVER] Listening on port ${PORT}`);

  await setupWebhook();

  // Register developer in DB if needed
  const devUser = database.getUser(config.DEVELOPER_ID);
  if (!devUser) {
    database.setUser(config.DEVELOPER_ID, {
      userId: config.DEVELOPER_ID,
      firstName: "المطور",
      role: "developer",
    });
  } else if (devUser.role !== "developer") {
    database.setUser(config.DEVELOPER_ID, { role: "developer" });
  }

  database.addLog({ action: "bot_started", userId: config.DEVELOPER_ID });

  // Notify developer
  try {
    const me = await bot.getMe();
    console.log(`[BOT] Running as @${me.username} (${me.id})`);
    await bot.sendMessage(
      config.DEVELOPER_ID,
      `✅ البوت اشتغل بنجاح!\n\n` +
      `Username: @${me.username}\n` +
      `البيئة: ${config.NODE_ENV}\n` +
      `الوضع: ${config.NODE_ENV === "production" && config.RENDER_URL ? "Webhook" : "Polling"}`
    );
  } catch (e) {
    console.warn("[BOT] Could not notify developer:", e.message);
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on("SIGTERM", () => { console.log("[SERVER] SIGTERM — shutting down."); process.exit(0); });
process.on("SIGINT",  () => { console.log("[SERVER] SIGINT — shutting down.");  process.exit(0); });

process.on("uncaughtException", (err) => {
  console.error("[SERVER] Uncaught Exception:", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("[SERVER] Unhandled Rejection:", reason);
});
