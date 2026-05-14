"use strict";

const config = require("./config");
const database = require("./database");
const { requireAdmin, getUserRole } = require("./middleware");
const { formatNumber } = require("./helpers");

async function showAdminPanel(bot, msg) {
  await requireAdmin(bot, msg, async () => {
    const userId = msg.from.id;
    const allUsers = database.getAllUsers();
    const allChannels = database.getAllChannels();
    const settings = database.getSettings();

    const myChannels = allChannels.filter(
      (ch) => ch.adminIds && ch.adminIds.includes(userId)
    );

    const text =
      `*لوحة تحكم المشرف*\n\n` +
      `*إحصائيات النظام:*\n` +
      `- المستخدمين: ${formatNumber(allUsers.length)}\n` +
      `- القنوات الكلية: ${formatNumber(allChannels.length)}\n` +
      `- قنواتي: ${formatNumber(myChannels.length)}\n` +
      `- حالة البوت: ${settings.maintenance ? "🔴 صيانة" : "🟢 يعمل"}\n`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "📋 قائمة المستخدمين", callback_data: "admin_users" },
            { text: "📢 قنواتي", callback_data: "admin_channels" },
          ],
          [
            { text: "🚫 حظر مستخدم", callback_data: "admin_ban" },
            { text: "✅ رفع حظر", callback_data: "admin_unban" },
          ],
          [
            { text: "📨 ارسال رسالة للقناة", callback_data: "admin_send_msg" },
            { text: "➕ اضافة قناة", callback_data: "admin_add_channel" },
          ],
          [{ text: "🔄 تحديث", callback_data: "admin_refresh" }],
        ],
      },
    };

    await bot.sendMessage(msg.chat.id, text, {
      parse_mode: "Markdown",
      ...keyboard,
    });
  });
}

async function showAdminUsers(bot, chatId, page = 0) {
  const allUsers = database.getAllUsers();
  const pageSize = 10;
  const totalPages = Math.ceil(allUsers.length / pageSize) || 1;
  const pageUsers = allUsers.slice(page * pageSize, (page + 1) * pageSize);

  let text = `*قائمة المستخدمين* (صفحة ${page + 1}/${totalPages})\n\n`;

  if (pageUsers.length === 0) {
    text += "لا يوجد مستخدمون مسجلون بعد.";
  } else {
    pageUsers.forEach((user, idx) => {
      const roleName = config.ROLE_LABELS[user.role] || user.role;
      text +=
        `${page * pageSize + idx + 1}. ${user.firstName}` +
        (user.username ? ` (@${user.username})` : "") +
        ` - ID: \`${user.userId}\`\n` +
        `   الرتبة: ${roleName}\n\n`;
    });
  }

  const navButtons = [];
  if (page > 0)
    navButtons.push({ text: "< السابق", callback_data: `admin_users_page_${page - 1}` });
  if (page < totalPages - 1)
    navButtons.push({ text: "التالي >", callback_data: `admin_users_page_${page + 1}` });

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        ...(navButtons.length > 0 ? [navButtons] : []),
        [{ text: "🚫 حظر مستخدم", callback_data: "admin_ban" }],
        [{ text: "رجوع للوحة المشرف", callback_data: "admin_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

async function showAdminChannels(bot, chatId, userId) {
  const allChannels = database.getAllChannels();
  const role = getUserRole(userId);

  const myChannels =
    role === config.ROLES.DEVELOPER
      ? allChannels
      : allChannels.filter(
          (ch) =>
            ch.ownerId === userId ||
            (ch.adminIds && ch.adminIds.includes(userId))
        );

  let text = `*قنواتي*\n\nعدد القنوات: ${myChannels.length}\n\n`;

  if (myChannels.length === 0) {
    text += "لا توجد قنوات مضافة لك بعد.";
  } else {
    myChannels.slice(0, 15).forEach((ch, idx) => {
      text +=
        `${idx + 1}. *${ch.title || "قناة"}*\n` +
        `   ID: \`${ch.channelId}\`\n` +
        `   المالك: \`${ch.ownerId}\`\n\n`;
    });
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "➕ اضافة قناة", callback_data: "admin_add_channel" },
          { text: "📨 ارسال رسالة", callback_data: "admin_send_msg" },
        ],
        [{ text: "رجوع للوحة المشرف", callback_data: "admin_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

module.exports = {
  showAdminPanel,
  showAdminUsers,
  showAdminChannels,
};
