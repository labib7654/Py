"use strict";

const express = require("express");
const config = require("./config");
const { createBot } = require("./bot");
const { registerCommands } = require("./commands");
const database = require("./database");
const { isDeveloper } = require("./helpers");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    bot: "Telegram Channel Manager Bot",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  const settings = database.getSettings();
  const allUsers = database.getAllUsers();
  const allChannels = database.getAllChannels();

  res.json({
    status: "healthy",
    maintenance: settings.maintenance,
    users: allUsers.length,
    channels: allChannels.length,
    uptime: process.uptime(),
  });
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

const PORT = config.PORT;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[SERVER] Express server running on port ${PORT}`);
});

// Self-ping every 14 minutes to prevent Render free tier from sleeping
if (config.NODE_ENV === "production") {
  const RENDER_URL =
    process.env.RENDER_EXTERNAL_URL || `https://localhost:${PORT}`;

  setInterval(() => {
    try {
      const pingUrl = RENDER_URL.replace(/\/$/, "") + "/ping";
      const isHttps = pingUrl.startsWith("https");
      const lib = isHttps ? require("https") : require("http");

      lib
        .get(pingUrl, (res) => {
          console.log(`[PING] Self-ping status: ${res.statusCode}`);
        })
        .on("error", (e) => {
          console.warn("[PING] Self-ping failed:", e.message);
        });
    } catch (e) {
      console.warn("[PING] Self-ping error:", e.message);
    }
  }, 14 * 60 * 1000);
}

async function main() {
  try {
    console.log("[MAIN] Starting Telegram Channel Manager Bot...");
    console.log(`[MAIN] Environment: ${config.NODE_ENV}`);
    console.log(`[MAIN] Developer ID: ${config.DEVELOPER_ID}`);

    const bot = await createBot();

    registerCommands(bot);

    const me = await bot.getMe();
    console.log(`[MAIN] Bot started: @${me.username} (${me.id})`);
    console.log("[MAIN] Bot is ready and listening for messages...");

    try {
      await bot.sendMessage(
        config.DEVELOPER_ID,
        `البوت تم تشغيله بنجاح!\n\nID: ${me.id}\nUsername: @${me.username}\nالبيئة: ${config.NODE_ENV}`
      );
    } catch (e) {
      console.log("[MAIN] Could not notify developer:", e.message);
    }

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
  } catch (error) {
    console.error("[MAIN] Fatal error:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  console.log("[MAIN] SIGTERM received. Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[MAIN] SIGINT received. Shutting down gracefully...");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("[MAIN] Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[MAIN] Unhandled Rejection at:", promise, "reason:", reason);
});

main();
