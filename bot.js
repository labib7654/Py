const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");

let botInstance = null;

function createBot() {
  if (botInstance) return botInstance;

  const options =
    config.NODE_ENV === "production"
      ? { polling: true }
      : { polling: true };

  botInstance = new TelegramBot(config.BOT_TOKEN, options);

  botInstance.on("polling_error", (error) => {
    console.error("[BOT] Polling error:", error.code, error.message);
    if (error.code === "ETELEGRAM") {
      console.error("[BOT] Telegram API error:", error.response?.body);
    }
  });

  botInstance.on("error", (error) => {
    console.error("[BOT] Error:", error.message);
  });

  console.log("[BOT] Bot instance created successfully.");
  return botInstance;
}

function getBot() {
  if (!botInstance) {
    throw new Error("Bot not initialized. Call createBot() first.");
  }
  return botInstance;
}

module.exports = { createBot, getBot };
