"use strict";

const express = require("express");
const config = require("./config");
const { createBot } = require("./bot");
const { registerCommands } = require("./commands");
const database = require("./database");
const { isDeveloper } = require("./helpers");

// Initialize express server (required for Render free tier - keeps service alive)
const app = express();
app.use(express.json());

// Health check endpoint
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

// Ping endpoint to prevent sleep on Render free tier
app.get("/ping", (req, res) => {
  res.send("pong");
});

// Start express server
const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`[SERVER] Express server running on port ${PORT}`);
});

// Self-ping to prevent Render free tier from sleeping
if (config.NODE_ENV === "production") {
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

  setInterval(async () => {
    try {
      const http = require("http");
      const url = new URL("/ping", RENDER_URL);
      http.get(url.toString(), (res) => {
        console.log(`[PING] Self-ping status: ${res.statusCode}`);
      }).on("error", () => {});
    } catch (e) {}
  }, 14 * 60 * 1000); // Every 14 minutes
}

// Initialize bot
async function main() {
  try {
    console.log("[MAIN] Starting Telegram Channel Manager Bot...");
    console.log(`[MAIN] Environment: ${config.NODE_ENV}`);
    console.log(`[MAIN] Developer ID: ${config.DEVELOPER_ID}`);

    // Create bot instance
    const bot = createBot();

    // Register all commands and callbacks
    registerCommands(bot);

    // Get bot info
    const me = await bot.getMe();
    console.log(`[MAIN] Bot started: @${me.username} (${me.id})`);
    console.log("[MAIN] Bot is ready and listening for messages...");

    // Notify developer
    try {
      await bot.sendMessage(
        config.DEVELOPER_ID,
        `البوت تم تشغيله بنجاح!\n\nID: ${me.id}\nUsername: @${me.username}\nالبيئة: ${config.NODE_ENV}`
      );
    } catch (e) {
      console.log("[MAIN] Could not notify developer:", e.message);
    }

    // Register developer if not already
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

// Handle graceful shutdown
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

// Start the bot
main();
