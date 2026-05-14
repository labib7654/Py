const config = require("./config");
const database = require("./database");
const { requireOwner, getUserRole } = require("./middleware");
const { formatDate } = require("./helpers");

// Show owner/user panel
async function showUserPanel(bot, msg) {
  await requireOwner(bot, msg, async () => {
    const userId = msg.from.id;
    const user = database.getUser(userId);
    const role = getUserRole(userId);
    const settings = database.getSettings();

    const allChannels = database.getAllChannels();
    const myChannels = allChannels.filter(
      (ch) => ch.ownerId === userId || (ch.adminIds && ch.adminIds.includes(userId))
    );

    const text =
      `*لوحة مالك القروب*\n\n` +
      `مرحباً ${user.firstName}!\n` +
      `رتبتك: ${config.ROLE_LABELS[role]}\n\n` +
      `*قنواتك:* ${myChannels.length} قناة\n\n` +
      `*الرسائل المتاحة:*\n` +
      `- اضافة/حذف قنواتك\n` +
      `- ارسال رسائل للقنوات\n` +
      `- ادارة اعضاء قنواتك\n`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "قنواتي", callback_data: "owner_my_channels" },
            { text: "اضافة قناة", callback_data: "owner_add_channel" },
          ],
          [
            { text: "ارسال رسالة", callback_data: "owner_send_msg" },
            { text: "احصائياتي", callback_data: "owner_stats" },
          ],
          [
            { text: "اعدادات القروب", callback_data: "owner_group_settings" },
            { text: "طلب مساعدة", callback_data: "owner_support" },
          ],
        ],
      },
    };

    await bot.sendMessage(msg.chat.id, text, {
      parse_mode: "Markdown",
      ...keyboard,
    });
  });
}

// Show owner's channels
async function showOwnerChannels(bot, chatId, userId) {
  const allChannels = database.getAllChannels();
  const myChannels = allChannels.filter((ch) => ch.ownerId === userId);

  let text = `*قنواتك*\n\nعدد القنوات: ${myChannels.length}\n\n`;

  if (myChannels.length === 0) {
    text += "لم تقم باضافة اي قناة بعد.\n\nاضغط على زر اضافة قناة لتسجيل قناتك.";
  } else {
    myChannels.forEach((ch, idx) => {
      text +=
        `${idx + 1}. *${ch.title || "قناة"}*\n` +
        `   ID: \`${ch.channelId}\`\n` +
        `   الاعضاء: ${ch.membersCount || "غير محدد"}\n` +
        `   اضيفت: ${ch.createdAt ? new Date(ch.createdAt).toLocaleDateString("ar") : "غير معروف"}\n\n`;
    });
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "اضافة قناة", callback_data: "owner_add_channel" },
          { text: "حذف قناة", callback_data: "owner_delete_channel" },
        ],
        [{ text: "رجوع", callback_data: "owner_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

// Show owner stats
async function showOwnerStats(bot, chatId, userId) {
  const allChannels = database.getAllChannels();
  const myChannels = allChannels.filter((ch) => ch.ownerId === userId);

  let totalMembers = 0;
  myChannels.forEach((ch) => {
    totalMembers += ch.membersCount || 0;
  });

  const user = database.getUser(userId);

  const text =
    `*احصائياتك*\n\n` +
    `الاسم: ${user.firstName}\n` +
    `ID: \`${userId}\`\n` +
    `تاريخ التسجيل: ${user.createdAt ? new Date(user.createdAt).toLocaleDateString("ar") : "غير معروف"}\n\n` +
    `عدد قنواتك: ${myChannels.length}\n` +
    `اجمالي الاعضاء: ${totalMembers}\n`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "رجوع للوحة المالك", callback_data: "owner_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

// Owner group settings
async function showGroupSettings(bot, chatId, userId) {
  const myGroups = database
    .getAllGroups()
    .filter((g) => g.ownerId === userId);

  let text = `*اعدادات القروب*\n\nقروباتك: ${myGroups.length}\n\n`;

  if (myGroups.length === 0) {
    text += "لم تسجل اي قروب بعد.";
  } else {
    myGroups.forEach((g, idx) => {
      text += `${idx + 1}. ${g.title || "قروب"} - ID: \`${g.groupId}\`\n`;
    });
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "تسجيل قروب", callback_data: "owner_register_group" }],
        [{ text: "رجوع", callback_data: "owner_main" }],
      ],
    },
  };

  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...keyboard,
  });
}

module.exports = {
  showUserPanel,
  showOwnerChannels,
  showOwnerStats,
  showGroupSettings,
};
