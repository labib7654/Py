"use strict";

const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");

let botInstance = null;

async function createBot() {
  if (botInstance) return botInstance;

  botInstance = new TelegramBot(config.BOT_TOKEN, { polling: false });

  botInstance.on("polling_error", (error) => {
    console.error("[BOT] Polling error:", error.code, error.message);

    if (error.code === "ETELEGRAM") {
      const body = error.response && error.response.body;
      console.error("[BOT] Telegram API error:", body);

      if (body && body.error_code === 409) {
        console.warn("[BOT] 409 Conflict — another instance is running. Restarting polling in 10s...");
        botInstance.stopPolling()
          .catch(() => {})
          .then(() => new Promise((r) => setTimeout(r, 10000)))
          .then(() => botInstance.startPolling())
          .catch((e) => console.error("[BOT] Failed to restart polling:", e.message));
      }
    }
  });

  botInstance.on("error", (error) => {
    console.error("[BOT] Error:", error.message);
  });

  try {
    await botInstance.deleteWebhook({ drop_pending_updates: true });
    console.log("[BOT] Webhook deleted and pending updates cleared.");
  } catch (e) {
    console.warn("[BOT] Could not delete webhook:", e.message);
  }

  await botInstance.startPolling();
  console.log("[BOT] Bot instance created and polling started.");
  return botInstance;
}

function getBot() {
  if (!botInstance) {
    throw new Error("Bot not initialized. Call createBot() first.");
  }
  return botInstance;
}

module.exports = { createBot, getBot };
