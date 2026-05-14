const config = require("./config");
const database = require("./database");
const { formatDate, formatNumber, chunkArray } = require("./helpers");
const { requireDeveloper } = require("./middleware");

// Developer main panel
async function showDevPanel(bot, msg) {
  await requireDeveloper(bot, msg, async () => {
    const settings = database.getSettings();
    const allUsers = database.getAllUsers();
    const allChannels = database.getAllChannels();
    const allGroups = database.getAllGroups();

    const stats = {
      total: allUsers.length,
      owners: allUsers.filter((u) => u.role === "owner").length,
      admins: allUsers.filter((u) => u.role === "admin").length,
      banned: allUsers.filter((u) => u.role === "banned").length,
    };

    const text =
      `*لوحة تحكم المطور*\n\n` +
      `*الحالة:* ${settings.maintenance ? "صيانة" : "يعمل"}\n\n` +
      `*الاحصائيات:*\n` +
      `- اجمالي المستخدمين: ${formatNumber(stats.total)}\n` +
      `- ملاك القروبات: ${formatNumber(stats.owners)}\n` +
      `- المشرفين: ${formatNumber(stats.admins)}\n` +
      `- المحظورين: ${formatNumber(stats.banned)}\n` +
      `- القنوات المسجلة: ${formatNumber(allChannels.length)}\n` +
      `- المجموعات المسجلة: ${formatNumber(allGroups.length)}\n`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "ادارة المستخدمين", callback_data: "dev_users" },
            { text: "ادارة القنوات", callback_data: "dev_channels" },
          ],
          [
            { text: "الاعدادات العامة", callback_data: "dev_settings" },
            { text: "السجلات", callback_data: "dev_logs" },
          ],
          [
            { text: settings.maintenance ? "ايقاف الصيانة" : "وضع الصيانة", callback_data: "dev_toggle_maintenance" },
            { text: "ارسال رسالة جماعية", callback_data: "dev_broadcast" },
          ],
          [
            { text: "اضافة مشرف", callback_data: "dev_add_admin" },
            { text: "اضافة مالك قروب", callback_data: "dev_add_owner" },
          ],
          [{ text: "تحديث الاحصائيات", callback_data: "dev_refresh" }],
        ],
      },
    };

    await bot.sendMessage(msg.chat.id, text, {
      parse_mode: "Markdown",
      ...keyboard,
    });
  });
}

// Show users list
async function showDevUsers(bot, chatId, page = 0) {
  const allUsers = database.getAllUsers();
  const pageSize = 10;
  const totalPages = Math.ceil(allUsers.length / pageSize);
  const pageUsers = allUsers.slice(page * pageSize, (page + 1) * pageSize);

  let text = `*قائمة المستخدمين* (صفحة ${page + 1}/${totalPages || 1})\n\n`;

  pageUsers.forEach((user, idx) => {
    const roleName = config.ROLE_LABELS[user.role] || user.role;
    text +=
      `${page * pageSize + idx + 1}. ${user.firstName}` +
      (user.username ? ` (@${user.username})` : "") +
      ` - ID: \`${user.userId}\`\n` +
      `   الرتبة: ${roleName}\n\n`;
  });

  if (allUsers.length === 0) {
    text += "لا يوجد مستخدمون مسجلون بعد.";
  }

  const navButtons = [];
  if (page > 0) navButtons.push({ text: "< السابق", callback_data: `dev_users_page_${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: "التالي >", callback_data: `dev_users_page_${page + 1}` });

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        ...(navButtons.length > 0 ? [navButtons] : []),
        [
          { text: "حظر مستخدم", callback_data: "dev_ban_user" },
          { text: "رفع رتبة", callback_data: "dev_promote_user" },
        ],
        [{ text: "رجوع للوحة المطور", callback_data: "dev_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

// Show channels management
async function showDevChannels(bot, chatId) {
  const channels = database.getAllChannels();

  let text = `*ادارة القنوات*\n\nعدد القنوات: ${channels.length}\n\n`;

  if (channels.length > 0) {
    channels.slice(0, 10).forEach((ch, idx) => {
      text +=
        `${idx + 1}. ${ch.title || "قناة"}\n` +
        `   ID: \`${ch.channelId}\`\n` +
        `   المالك: \`${ch.ownerId}\`\n\n`;
    });
  } else {
    text += "لا توجد قنوات مسجلة.";
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "حذف قناة", callback_data: "dev_delete_channel" },
          { text: "تفاصيل قناة", callback_data: "dev_channel_info" },
        ],
        [{ text: "رجوع للوحة المطور", callback_data: "dev_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

// Show settings panel
async function showDevSettings(bot, chatId) {
  const settings = database.getSettings();

  const text =
    `*الاعدادات العامة*\n\n` +
    `رسالة الترحيب:\n${settings.welcomeMessage}\n\n` +
    `وضع الصيانة: ${settings.maintenance ? "مفعل" : "معطل"}\n`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "تغيير رسالة الترحيب", callback_data: "dev_set_welcome" }],
        [{ text: settings.maintenance ? "ايقاف الصيانة" : "تفعيل الصيانة", callback_data: "dev_toggle_maintenance" }],
        [{ text: "رجوع للوحة المطور", callback_data: "dev_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

// Show logs
async function showDevLogs(bot, chatId) {
  const logs = database.getLogs(15);

  let text = `*آخر السجلات*\n\n`;

  if (logs.length === 0) {
    text += "لا توجد سجلات.";
  } else {
    logs.forEach((log) => {
      text +=
        `[${new Date(log.timestamp).toLocaleString("ar")}]\n` +
        `${log.action} - المستخدم: ${log.userId}\n\n`;
    });
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "مسح السجلات", callback_data: "dev_clear_logs" }],
        [{ text: "رجوع للوحة المطور", callback_data: "dev_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

module.exports = {
  showDevPanel,
  showDevUsers,
  showDevChannels,
  showDevSettings,
  showDevLogs,
};
