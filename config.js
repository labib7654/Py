require("dotenv").config();

module.exports = {
  BOT_TOKEN:    process.env.BOT_TOKEN    || "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y",
  DEVELOPER_ID: parseInt(process.env.DEVELOPER_ID, 10) || 7411444902,
  PORT:         parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV:     process.env.NODE_ENV || "development",
  RENDER_URL:   process.env.RENDER_EXTERNAL_URL || "",

  ROLES: {
    DEVELOPER: "developer",
    ADMIN:     "admin",
    USER:      "user",
    BANNED:    "banned",
  },

  ROLE_LABELS: {
    developer: "👑 مطوّر",
    admin:     "🛡 مشرف",
    user:      "👤 مستخدم",
    banned:    "🚫 محظور",
  },
};
