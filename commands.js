const config = require("./config");
const database = require("./database");
const middleware = require("./middleware");
const devPanel = require("./devPanel");
const adminPanel = require("./adminPanel");
const userPanel = require("./userPanel");
const { isDeveloper, formatUser, parseChannelId } = require("./helpers");

// State manager for multi-step operations
const userStates = {};

function setUserState(userId, state) {
  userStates[userId] = state;
}

function getUserState(userId) {
  return userStates[userId] || null;
}

function clearUserState(userId) {
  delete userStates[userId];
}

// Register all commands
function registerCommands(bot) {

  // /start command
  bot.onText(/\/start/, async (msg) => {
    await middleware.requireAuth(bot, msg, async (user) => {
      const userId = msg.from.id;
      const role = middleware.getUserRole(userId);
      const settings = database.getSettings();

      const welcomeText =
        `*${settings.welcomeMessage}*\n\n` +
        `مرحباً ${user.firstName}!\n` +
        `رتبتك: ${config.ROLE_LABELS[role]}\n\n` +
        `اختر من القائمة ادناه:`;

      const buttons = [];

      // All users see general buttons
      buttons.push([{ text: "لوحة المستخدم", callback_data: "owner_main" }]);

      // Admins see admin panel
      if (role === config.ROLES.ADMIN || role === config.ROLES.DEVELOPER) {
        buttons.push([{ text: "لوحة المشرف", callback_data: "admin_main" }]);
      }

      // Developer sees dev panel
      if (role === config.ROLES.DEVELOPER) {
        buttons.push([{ text: "لوحة المطور", callback_data: "dev_main" }]);
      }

      buttons.push([{ text: "مساعدة", callback_data: "help" }]);

      await bot.sendMessage(msg.chat.id, welcomeText, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: buttons },
      });
    });
  });

  // /dev command - shortcut to dev panel
  bot.onText(/\/dev/, async (msg) => {
    await devPanel.showDevPanel(bot, msg);
  });

  // /admin command - shortcut to admin panel
  bot.onText(/\/admin/, async (msg) => {
    await adminPanel.showAdminPanel(bot, msg);
  });

  // /panel command - user panel
  bot.onText(/\/panel/, async (msg) => {
    await userPanel.showUserPanel(bot, msg);
  });

  // /promote command - dev only
  bot.onText(/\/promote (\d+) (\w+)/, async (msg, match) => {
    await middleware.requireDeveloper(bot, msg, async () => {
      const targetId = parseInt(match[1]);
      const role = match[2];

      if (!Object.values(config.ROLES).includes(role)) {
        await bot.sendMessage(
          msg.chat.id,
          `الرتبة غير صحيحة. الرتب المتاحة:\n${Object.values(config.ROLES).join(", ")}`
        );
        return;
      }

      const user = database.getUser(targetId);
      if (!user) {
        await bot.sendMessage(msg.chat.id, "المستخدم غير موجود في قاعدة البيانات.");
        return;
      }

      database.setUser(targetId, { role });
      database.addLog({ action: `promote_to_${role}`, userId: msg.from.id, targetId });

      await bot.sendMessage(
        msg.chat.id,
        `تم تعيين رتبة *${config.ROLE_LABELS[role]}* للمستخدم \`${targetId}\``,
        { parse_mode: "Markdown" }
      );

      try {
        await bot.sendMessage(
          targetId,
          `تم تغيير رتبتك الى: *${config.ROLE_LABELS[role]}*`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
    });
  });

  // /ban command
  bot.onText(/\/ban (\d+)/, async (msg, match) => {
    await middleware.requireAdmin(bot, msg, async () => {
      const targetId = parseInt(match[1]);

      if (isDeveloper(targetId)) {
        await bot.sendMessage(msg.chat.id, "لا يمكن حظر المطور!");
        return;
      }

      const user = database.getUser(targetId);
      if (!user) {
        await bot.sendMessage(msg.chat.id, "المستخدم غير موجود.");
        return;
      }

      database.setUser(targetId, { role: config.ROLES.BANNED });
      database.addLog({ action: "ban_user", userId: msg.from.id, targetId });

      await bot.sendMessage(
        msg.chat.id,
        `تم حظر المستخدم \`${targetId}\` بنجاح.`,
        { parse_mode: "Markdown" }
      );
    });
  });

  // /unban command
  bot.onText(/\/unban (\d+)/, async (msg, match) => {
    await middleware.requireAdmin(bot, msg, async () => {
      const targetId = parseInt(match[1]);

      database.setUser(targetId, { role: config.ROLES.USER });
      database.addLog({ action: "unban_user", userId: msg.from.id, targetId });

      await bot.sendMessage(
        msg.chat.id,
        `تم رفع الحظر عن المستخدم \`${targetId}\`.`,
        { parse_mode: "Markdown" }
      );
    });
  });

  // /addchannel command
  bot.onText(/\/addchannel (.+)/, async (msg, match) => {
    await middleware.requireOwner(bot, msg, async () => {
      const channelId = parseChannelId(match[1]);
      if (!channelId) {
        await bot.sendMessage(
          msg.chat.id,
          "صيغة غير صحيحة. مثال: /addchannel @channel_username"
        );
        return;
      }

      try {
        const chat = await bot.getChat(channelId);
        const userId = msg.from.id;

        database.setChannel(chat.id, {
          username: chat.username,
          channelId: chat.id,
          ownerId: userId,
          adminIds: [userId],
          membersCount: chat.members_count || 0,
        });

        database.addLog({ action: "add_channel", userId, channelId: chat.id });

        await bot.sendMessage(
          msg.chat.id,
          `تم اضافة القناة *${chat.title}* بنجاح!`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        await bot.sendMessage(
          msg.chat.id,
          `فشل في اضافة القناة: ${err.message}\n\nتأكد من ان البوت مشرف في القناة.`
        );
      }
    });
  });

  // /removechannel command
  bot.onText(/\/removechannel (.+)/, async (msg, match) => {
    await middleware.requireOwner(bot, msg, async () => {
      const channelId = parseChannelId(match[1]);
      const userId = msg.from.id;

      const channel = database.getChannel(channelId);
      if (!channel) {
        await bot.sendMessage(msg.chat.id, "القناة غير موجودة في قاعدة البيانات.");
        return;
      }

      const role = middleware.getUserRole(userId);
      if (channel.ownerId !== userId && role !== config.ROLES.DEVELOPER) {
        await bot.sendMessage(msg.chat.id, "لا يمكنك حذف قناة لا تملكها.");
        return;
      }

      database.deleteChannel(channelId);
      database.addLog({ action: "remove_channel", userId, channelId });

      await bot.sendMessage(msg.chat.id, "تم حذف القناة من قاعدة البيانات.");
    });
  });

  // /broadcast command - dev only
  bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    await middleware.requireDeveloper(bot, msg, async () => {
      const text = match[1];
      const allUsers = database.getAllUsers();

      let sent = 0;
      let failed = 0;

      await bot.sendMessage(
        msg.chat.id,
        `جاري ارسال الرسالة لـ ${allUsers.length} مستخدم...`
      );

      for (const user of allUsers) {
        if (user.userId === msg.from.id) continue;
        try {
          await bot.sendMessage(user.userId, text, { parse_mode: "Markdown" });
          sent++;
          await new Promise((r) => setTimeout(r, 50));
        } catch (e) {
          failed++;
        }
      }

      database.addLog({ action: "broadcast", userId: msg.from.id });

      await bot.sendMessage(
        msg.chat.id,
        `تم الارسال!\nنجح: ${sent}\nفشل: ${failed}`
      );
    });
  });

  // /stats command
  bot.onText(/\/stats/, async (msg) => {
    await middleware.requireAuth(bot, msg, async (user) => {
      const userId = msg.from.id;
      const role = middleware.getUserRole(userId);

      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) {
        await bot.sendMessage(msg.chat.id, "ليس لديك صلاحية لعرض الاحصائيات.");
        return;
      }

      const allUsers = database.getAllUsers();
      const allChannels = database.getAllChannels();
      const settings = database.getSettings();

      const text =
        `*الاحصائيات العامة*\n\n` +
        `المستخدمين: ${allUsers.length}\n` +
        `القنوات: ${allChannels.length}\n` +
        `حالة البوت: ${settings.maintenance ? "صيانة" : "يعمل"}\n`;

      await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
    });
  });

  // /myid command
  bot.onText(/\/myid/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      `ID الخاص بك: \`${msg.from.id}\``,
      { parse_mode: "Markdown" }
    );
  });

  // /help command
  bot.onText(/\/help/, async (msg) => {
    await middleware.requireAuth(bot, msg, async (user) => {
      const userId = msg.from.id;
      const role = middleware.getUserRole(userId);

      let text =
        `*الاوامر المتاحة*\n\n` +
        `/start - بدء تشغيل البوت\n` +
        `/panel - لوحة التحكم\n` +
        `/myid - معرفة ID الخاص بك\n` +
        `/addchannel <id> - اضافة قناة\n` +
        `/help - قائمة الاوامر\n`;

      if (role === config.ROLES.ADMIN || role === config.ROLES.DEVELOPER) {
        text +=
          `\n*اوامر المشرف:*\n` +
          `/admin - لوحة المشرف\n` +
          `/ban <id> - حظر مستخدم\n` +
          `/unban <id> - رفع حظر\n` +
          `/stats - الاحصائيات\n`;
      }

      if (role === config.ROLES.DEVELOPER) {
        text +=
          `\n*اوامر المطور:*\n` +
          `/dev - لوحة المطور\n` +
          `/promote <id> <role> - تغيير رتبة\n` +
          `/broadcast <msg> - رسالة جماعية\n`;
      }

      await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
    });
  });

  // Handle text messages for states
  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;

    const userId = msg.from?.id;
    if (!userId) return;

    const state = getUserState(userId);
    if (!state) return;

    await handleUserState(bot, msg, state, userId);
  });

  // Register callback handlers
  registerCallbacks(bot, userStates, setUserState, clearUserState);
}

// Handle user states (multi-step operations)
async function handleUserState(bot, msg, state, userId) {
  const { clearUserState } = require("./commands");
  const chatId = msg.chat.id;

  switch (state.type) {
    case "awaiting_channel_id": {
      const channelId = parseChannelId(msg.text);
      if (!channelId) {
        await bot.sendMessage(chatId, "يرجى ادخال ID القناة بشكل صحيح.");
        return;
      }
      try {
        const chat = await bot.getChat(channelId);
        database.setChannel(chat.id, {

          username: chat.username,
          channelId: chat.id,
          ownerId: userId,
          adminIds: [userId],
          membersCount: chat.members_count || 0,
        });
        database.addLog({ action: "add_channel_via_state", userId, channelId: chat.id });
        delete userStates[userId];
        await bot.sendMessage(chatId, `تم اضافة القناة *${chat.title}* بنجاح!`, {
          parse_mode: "Markdown",
        });
      } catch (e) {
        await bot.sendMessage(chatId, `فشل في اضافة القناة. تأكد من ان البوت مشرف فيها.\n${e.message}`);
      }
      break;
    }

    case "awaiting_broadcast_msg": {
      const allUsers = database.getAllUsers();
      let sent = 0, failed = 0;
      delete userStates[userId];
      await bot.sendMessage(chatId, `جاري ارسال الرسالة...`);
      for (const u of allUsers) {
        if (u.userId === userId) continue;
        try {
          await bot.sendMessage(u.userId, msg.text, { parse_mode: "Markdown" });
          sent++;
          await new Promise((r) => setTimeout(r, 50));
        } catch (e) { failed++; }
      }
      await bot.sendMessage(chatId, `تم! نجح: ${sent}, فشل: ${failed}`);
      break;
    }

    case "awaiting_welcome_msg": {
      database.updateSettings({ welcomeMessage: msg.text });
      delete userStates[userId];
      await bot.sendMessage(chatId, "تم تحديث رسالة الترحيب بنجاح!");
      break;
    }

    case "awaiting_ban_id": {
      const targetId = parseInt(msg.text);
      if (isNaN(targetId)) {
        await bot.sendMessage(chatId, "يرجى ادخال ID صحيح.");
        return;
      }
      if (isDeveloper(targetId)) {
        await bot.sendMessage(chatId, "لا يمكن حظر المطور!");
        delete userStates[userId];
        return;
      }
      database.setUser(targetId, { role: config.ROLES.BANNED });
      database.addLog({ action: "ban_user", userId, targetId });
      delete userStates[userId];
      await bot.sendMessage(chatId, `تم حظر المستخدم \`${targetId}\`.`, { parse_mode: "Markdown" });
      break;
    }

    case "awaiting_promote_id": {
      const targetId = parseInt(msg.text);
      if (isNaN(targetId)) {
        await bot.sendMessage(chatId, "يرجى ادخال ID صحيح.");
        return;
      }
      userStates[userId] = { type: "awaiting_promote_role", targetId };
      await bot.sendMessage(chatId, "اختر الرتبة:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "مالك قروب", callback_data: `set_role_owner_${targetId}` },
              { text: "مشرف", callback_data: `set_role_admin_${targetId}` },
            ],
            [
              { text: "مستخدم عادي", callback_data: `set_role_user_${targetId}` },
              { text: "محظور", callback_data: `set_role_banned_${targetId}` },
            ],
          ],
        },
      });
      break;
    }

    case "awaiting_send_channel_msg": {
      const channelToSend = state.channelId;
      try {
        await bot.sendMessage(channelToSend, msg.text, { parse_mode: "Markdown" });
        database.addLog({ action: "send_msg_to_channel", userId, channelId: channelToSend });
        delete userStates[userId];
        await bot.sendMessage(chatId, "تم ارسال الرسالة للقناة بنجاح!");
      } catch (e) {
        await bot.sendMessage(chatId, `فشل الارسال: ${e.message}`);
      }
      break;
    }

    default:
      delete userStates[userId];
  }
}

// Register callback query handlers
function registerCallbacks(bot, userStates, setUserState, clearUserState) {
  bot.on("callback_query", async (query) => {
    const msg = query.message;
    const userId = query.from.id;
    const data = query.data;
    const chatId = msg.chat.id;

    await bot.answerCallbackQuery(query.id).catch(() => {});

    await middleware.registerUser({ from: query.from, chat: msg.chat });

    const role = middleware.getUserRole(userId);
    const isBanned = role === config.ROLES.BANNED;

    if (isBanned) {
      await bot.sendMessage(chatId, config.MESSAGES.BANNED);
      return;
    }

    // --- DEV PANEL ---
    if (data === "dev_main") {
      if (!isDeveloper(userId)) {
        await bot.sendMessage(chatId, config.MESSAGES.NO_PERMISSION);
        return;
      }
      await devPanel.showDevPanel(bot, { chat: msg.chat, from: query.from });
      return;
    }

    if (data === "dev_users") {
      if (!isDeveloper(userId)) return;
      await devPanel.showDevUsers(bot, chatId, 0);
      return;
    }

    if (data.startsWith("dev_users_page_")) {
      if (!isDeveloper(userId)) return;
      const page = parseInt(data.replace("dev_users_page_", ""));
      await devPanel.showDevUsers(bot, chatId, page);
      return;
    }

    if (data === "dev_channels") {
      if (!isDeveloper(userId)) return;
      await devPanel.showDevChannels(bot, chatId);
      return;
    }

    if (data === "dev_settings") {
      if (!isDeveloper(userId)) return;
      await devPanel.showDevSettings(bot, chatId);
      return;
    }

    if (data === "dev_logs") {
      if (!isDeveloper(userId)) return;
      await devPanel.showDevLogs(bot, chatId);
      return;
    }

    if (data === "dev_clear_logs") {
      if (!isDeveloper(userId)) return;
      const db = require("./database");
      db.updateSettings({});
      await bot.sendMessage(chatId, "تم مسح السجلات.");
      return;
    }

    if (data === "dev_toggle_maintenance") {
      if (!isDeveloper(userId)) return;
      const settings = database.getSettings();
      database.updateSettings({ maintenance: !settings.maintenance });
      await bot.sendMessage(
        chatId,
        `تم ${!settings.maintenance ? "تفعيل" : "ايقاف"} وضع الصيانة.`
      );
      return;
    }

    if (data === "dev_refresh") {
      if (!isDeveloper(userId)) return;
      await devPanel.showDevPanel(bot, { chat: msg.chat, from: query.from });
      return;
    }

    if (data === "dev_broadcast") {
      if (!isDeveloper(userId)) return;
      userStates[userId] = { type: "awaiting_broadcast_msg" };
      await bot.sendMessage(chatId, "اكتب الرسالة التي تريد ارسالها لجميع المستخدمين:");
      return;
    }

    if (data === "dev_set_welcome") {
      if (!isDeveloper(userId)) return;
      userStates[userId] = { type: "awaiting_welcome_msg" };
      await bot.sendMessage(chatId, "اكتب رسالة الترحيب الجديدة:");
      return;
    }

    if (data === "dev_add_admin") {
      if (!isDeveloper(userId)) return;
      userStates[userId] = { type: "awaiting_promote_id", targetRole: "admin" };
      await bot.sendMessage(chatId, "ارسل ID المستخدم الذي تريد ترقيته:");
      return;
    }

    if (data === "dev_add_owner") {
      if (!isDeveloper(userId)) return;
      userStates[userId] = { type: "awaiting_promote_id", targetRole: "owner" };
      await bot.sendMessage(chatId, "ارسل ID المستخدم الذي تريد تعيينه كمالك قروب:");
      return;
    }

    if (data === "dev_ban_user") {
      if (!isDeveloper(userId)) return;
      userStates[userId] = { type: "awaiting_ban_id" };
      await bot.sendMessage(chatId, "ارسل ID المستخدم الذي تريد حظره:");
      return;
    }

    if (data === "dev_promote_user") {
      if (!isDeveloper(userId)) return;
      userStates[userId] = { type: "awaiting_promote_id" };
      await bot.sendMessage(chatId, "ارسل ID المستخدم:");
      return;
    }

    // Role setting callback
    if (data.startsWith("set_role_")) {
      if (!isDeveloper(userId)) return;
      const parts = data.replace("set_role_", "").split("_");
      const targetId = parseInt(parts[parts.length - 1]);
      const newRole = parts.slice(0, -1).join("_");

      database.setUser(targetId, { role: newRole });
      database.addLog({ action: `set_role_${newRole}`, userId, targetId });
      delete userStates[userId];

      await bot.sendMessage(
        chatId,
        `تم تعيين رتبة *${config.ROLE_LABELS[newRole] || newRole}* للمستخدم \`${targetId}\``,
        { parse_mode: "Markdown" }
      );

      try {
        await bot.sendMessage(
          targetId,
          `تم تغيير رتبتك الى: *${config.ROLE_LABELS[newRole] || newRole}*`,
          { parse_mode: "Markdown" }
        );
      } catch (e) {}
      return;
    }

    // --- ADMIN PANEL ---
    if (data === "admin_main") {
      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) {
        await bot.sendMessage(chatId, config.MESSAGES.NO_PERMISSION);
        return;
      }
      await adminPanel.showAdminPanel(bot, { chat: msg.chat, from: query.from });
      return;
    }

    if (data === "admin_channels") {
      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await adminPanel.showAdminChannels(bot, chatId, userId);
      return;
    }

    if (data === "admin_users") {
      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await adminPanel.showAdminUsers(bot, chatId);
      return;
    }

    if (data === "admin_add_channel") {
      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.OWNER, config.ROLES.DEVELOPER)) return;
      userStates[userId] = { type: "awaiting_channel_id" };
      await bot.sendMessage(chatId, "ارسل ID او username القناة (مثال: @channelname او -100xxxxxxxxx):");
      return;
    }

    if (data === "admin_ban") {
      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      userStates[userId] = { type: "awaiting_ban_id" };
      await bot.sendMessage(chatId, "ارسل ID المستخدم الذي تريد حظره:");
      return;
    }

    if (data === "admin_unban") {
      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await bot.sendMessage(chatId, "ارسل ID المستخدم لرفع الحظر (استخدم /unban <id>):");
      return;
    }

    if (data === "admin_send_msg") {
      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      const allChannels = database.getAllChannels();
      const myChannels = isDeveloper(userId)
        ? allChannels
        : allChannels.filter((ch) => ch.adminIds && ch.adminIds.includes(userId));

      if (myChannels.length === 0) {
        await bot.sendMessage(chatId, "لا توجد قنوات متاحة لك.");
        return;
      }

      const buttons = myChannels.map((ch) => [
        { text: ch.title || ch.channelId.toString(), callback_data: `select_channel_${ch.channelId}` },
      ]);
      buttons.push([{ text: "رجوع", callback_data: "admin_main" }]);

      await bot.sendMessage(chatId, "اختر القناة لارسال الرسالة اليها:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return;
    }

    if (data.startsWith("select_channel_")) {
      const channelId = data.replace("select_channel_", "");
      userStates[userId] = { type: "awaiting_send_channel_msg", channelId };
      await bot.sendMessage(chatId, "اكتب الرسالة التي تريد ارسالها للقناة:");
      return;
    }

    if (data === "admin_refresh") {
      if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await adminPanel.showAdminPanel(bot, { chat: msg.chat, from: query.from });
      return;
    }

    // --- OWNER/USER PANEL ---
    if (data === "owner_main") {
      if (!middleware.hasRole(userId, config.ROLES.OWNER, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) {
        await bot.sendMessage(chatId, config.MESSAGES.NO_PERMISSION);
        return;
      }
      await userPanel.showUserPanel(bot, { chat: msg.chat, from: query.from });
      return;
    }

    if (data === "owner_my_channels") {
      if (!middleware.hasRole(userId, config.ROLES.OWNER, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await userPanel.showOwnerChannels(bot, chatId, userId);
      return;
    }

    if (data === "owner_add_channel") {
      if (!middleware.hasRole(userId, config.ROLES.OWNER, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      userStates[userId] = { type: "awaiting_channel_id" };
      await bot.sendMessage(chatId, "ارسل ID او username القناة:\n(مثال: @channelname او -100xxxxxxxxx)\n\n*تأكد من ان البوت مشرف في القناة اولاً*", {
        parse_mode: "Markdown",
      });
      return;
    }

    if (data === "owner_delete_channel") {
      if (!middleware.hasRole(userId, config.ROLES.OWNER, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await bot.sendMessage(chatId, "استخدم الامر:\n`/removechannel <channel_id>`", {
        parse_mode: "Markdown",
      });
      return;
    }

    if (data === "owner_send_msg") {
      if (!middleware.hasRole(userId, config.ROLES.OWNER, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      const allChannels = database.getAllChannels();
      const myChannels = allChannels.filter(
        (ch) => ch.ownerId === userId || (ch.adminIds && ch.adminIds.includes(userId))
      );

      if (myChannels.length === 0) {
        await bot.sendMessage(chatId, "لا توجد قنوات مضافة. اضف قناة اولاً.");
        return;
      }

      const buttons = myChannels.map((ch) => [
        { text: ch.title || ch.channelId.toString(), callback_data: `select_channel_${ch.channelId}` },
      ]);
      buttons.push([{ text: "رجوع", callback_data: "owner_main" }]);

      await bot.sendMessage(chatId, "اختر القناة:", {
        reply_markup: { inline_keyboard: buttons },
      });
      return;
    }

    if (data === "owner_stats") {
      if (!middleware.hasRole(userId, config.ROLES.OWNER, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await userPanel.showOwnerStats(bot, chatId, userId);
      return;
    }

    if (data === "owner_group_settings") {
      if (!middleware.hasRole(userId, config.ROLES.OWNER, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await userPanel.showGroupSettings(bot, chatId, userId);
      return;
    }

    if (data === "owner_register_group") {
      if (!middleware.hasRole(userId, config.ROLES.OWNER, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
      await bot.sendMessage(
        chatId,
        "اضف البوت لقروبك واعطه صلاحيات المشرف، ثم ارسل ID القروب هنا.\n\n" +
        "يمكنك معرفة ID القروب باستخدام @username_to_id_bot"
      );
      return;
    }

    if (data === "owner_support") {
      await bot.sendMessage(
        chatId,
        `للدعم والمساعدة تواصل مع المطور:\nID: \`${config.DEVELOPER_ID}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (data === "help") {
      await bot.sendMessage(
        chatId,
        `*المساعدة*\n\n` +
        `هذا بوت لادارة القنوات والمجموعات.\n\n` +
        `*الاوامر:*\n` +
        `/start - بدء البوت\n` +
        `/panel - لوحة التحكم\n` +
        `/addchannel - اضافة قناة\n` +
        `/myid - معرفة ID الخاص بك\n` +
        `/help - المساعدة\n`,
        { parse_mode: "Markdown" }
      );
      return;
    }
  });
}

module.exports = {
  registerCommands,
  userStates,
};
