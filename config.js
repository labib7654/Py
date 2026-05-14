require("dotenv").config();

const config = {
  BOT_TOKEN: process.env.BOT_TOKEN || "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y",
  DEVELOPER_ID: parseInt(process.env.DEVELOPER_ID) || 7411444902,
  PORT: parseInt(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || "development",

  // Roles
  ROLES: {
    DEVELOPER: "developer",
    OWNER: "owner",
    ADMIN: "admin",
    USER: "user",
    BANNED: "banned",
  },

  // Role labels in Arabic
  ROLE_LABELS: {
    developer: "مطور البوت",
    owner: "مالك قروب",
    admin: "مشرف",
    user: "مستخدم",
    banned: "محظور",
  },

  // Bot messages
  MESSAGES: {
    WELCOME: "مرحباً بك في بوت إدارة القنوات",
    NO_PERMISSION: "عذراً، ليس لديك صلاحية للوصول لهذا القسم.",
    BANNED: "تم حظرك من استخدام هذا البوت.",
    ERROR: "حدث خطأ ما، يرجى المحاولة لاحقاً.",
  },
};

module.exports = config;
