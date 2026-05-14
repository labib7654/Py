"use strict";

const config = require("./config");
const database = require("./database");
const middleware = require("./middleware");
const { isDeveloper, formatNumber, parseChannelId, chunkArray, shortDate } = require("./helpers");

// ─── Multi-step state ─────────────────────────────────────────────────────────
const states = {};
function setState(uid, s) { states[uid] = s; }
function getState(uid) { return states[uid] || null; }
function clearState(uid) { delete states[uid]; }

// ─── Keyboard builders ────────────────────────────────────────────────────────
function kb(rows) { return { reply_markup: { inline_keyboard: rows } }; }

// ─── Main menu ────────────────────────────────────────────────────────────────
function mainMenuKeyboard(role) {
  const rows = [[{ text: "👤 لوحتي", callback_data: "menu_user" }]];
  if (role === config.ROLES.ADMIN || role === config.ROLES.DEVELOPER)
    rows.push([{ text: "🛡 لوحة المشرف", callback_data: "menu_admin" }]);
  if (role === config.ROLES.DEVELOPER)
    rows.push([{ text: "👑 لوحة المطور", callback_data: "menu_dev" }]);
  rows.push([{ text: "❓ مساعدة", callback_data: "menu_help" }]);
  return kb(rows);
}

// ─── Panels ───────────────────────────────────────────────────────────────────
async function sendMainMenu(bot, chatId, from) {
  const role = middleware.getUserRole(from.id);
  const user = database.getUser(from.id);
  const settings = database.getSettings();
  const text =
    `*${settings.welcomeMessage}*\n\n` +
    `مرحباً ${user ? user.firstName : from.first_name}!\n` +
    `رتبتك: ${config.ROLE_LABELS[role]}\n\n` +
    `اختر من القائمة:`;
  await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...mainMenuKeyboard(role) });
}

async function sendUserPanel(bot, chatId, userId) {
  const user = database.getUser(userId);
  const allCh = database.getAllChannels();
  const allGr = database.getAllGroups();
  const myCh = allCh.filter(c => c.ownerId === userId || (c.adminIds || []).includes(userId));
  const myGr = allGr.filter(g => g.ownerId === userId || (g.adminIds || []).includes(userId));
  const text =
    `*👤 لوحتي*\n\n` +
    `الاسم: ${user ? user.firstName : "مستخدم"}\n` +
    `الرتبة: ${config.ROLE_LABELS[middleware.getUserRole(userId)]}\n\n` +
    `📢 قنواتي: ${myCh.length}\n` +
    `👥 مجموعاتي: ${myGr.length}\n`;
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "📢 قنواتي", callback_data: "user_my_channels" }, { text: "👥 مجموعاتي", callback_data: "user_my_groups" }],
      [{ text: "➕ إضافة قناة", callback_data: "user_add_channel" }, { text: "➕ إضافة مجموعة", callback_data: "user_add_group" }],
      [{ text: "📨 إرسال لقناتي", callback_data: "user_send_channel" }, { text: "📊 إحصائياتي", callback_data: "user_stats" }],
      [{ text: "🔙 القائمة الرئيسية", callback_data: "menu_main" }],
    ]),
  });
}

async function sendAdminPanel(bot, chatId, userId) {
  const users = database.getAllUsers();
  const channels = database.getAllChannels();
  const groups = database.getAllGroups();
  const settings = database.getSettings();
  const text =
    `*🛡 لوحة المشرف*\n\n` +
    `👥 المستخدمون: ${formatNumber(users.length)}\n` +
    `📢 القنوات: ${formatNumber(channels.length)}\n` +
    `🏠 المجموعات: ${formatNumber(groups.length)}\n` +
    `⚙️ حالة البوت: ${settings.maintenance ? "🔴 صيانة" : "🟢 يعمل"}\n`;
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "👥 المستخدمون", callback_data: "admin_users" }, { text: "📢 القنوات", callback_data: "admin_channels" }],
      [{ text: "🚫 حظر", callback_data: "admin_ban" }, { text: "✅ رفع حظر", callback_data: "admin_unban" }],
      [{ text: "📨 إرسال رسالة", callback_data: "admin_broadcast_ch" }],
      [{ text: "🔙 القائمة الرئيسية", callback_data: "menu_main" }],
    ]),
  });
}

async function sendDevPanel(bot, chatId) {
  const users = database.getAllUsers();
  const channels = database.getAllChannels();
  const groups = database.getAllGroups();
  const settings = database.getSettings();
  const stats = {
    admins: users.filter(u => u.role === "admin").length,
    banned: users.filter(u => u.role === "banned").length,
  };
  const text =
    `*👑 لوحة المطور*\n\n` +
    `البيئة: \`${config.NODE_ENV}\`\n` +
    `حالة البوت: ${settings.maintenance ? "🔴 صيانة" : "🟢 يعمل"}\n\n` +
    `*إحصائيات:*\n` +
    `المستخدمون: ${formatNumber(users.length)}\n` +
    `المشرفون: ${formatNumber(stats.admins)}\n` +
    `المحظورون: ${formatNumber(stats.banned)}\n` +
    `القنوات: ${formatNumber(channels.length)}\n` +
    `المجموعات: ${formatNumber(groups.length)}\n`;
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "👥 إدارة المستخدمين", callback_data: "dev_users" }, { text: "📢 إدارة القنوات", callback_data: "dev_channels" }],
      [{ text: "🏠 إدارة المجموعات", callback_data: "dev_groups" }, { text: "📋 السجلات", callback_data: "dev_logs" }],
      [{ text: "⚙️ الإعدادات", callback_data: "dev_settings" }, { text: "📢 رسالة جماعية", callback_data: "dev_broadcast" }],
      [{ text: settings.maintenance ? "✅ إيقاف الصيانة" : "🔧 تفعيل الصيانة", callback_data: "dev_toggle_maintenance" }],
      [{ text: "🔙 القائمة الرئيسية", callback_data: "menu_main" }],
    ]),
  });
}

// ─── List builders ────────────────────────────────────────────────────────────
async function sendUsersList(bot, chatId, page = 0) {
  const all = database.getAllUsers();
  const size = 8;
  const total = Math.ceil(all.length / size) || 1;
  const slice = all.slice(page * size, (page + 1) * size);
  let text = `*👥 المستخدمون* (${page + 1}/${total})\n\n`;
  if (!slice.length) { text += "لا يوجد مستخدمون."; }
  else {
    slice.forEach((u, i) => {
      text += `${page * size + i + 1}. ${u.firstName}` +
        (u.username ? ` @${u.username}` : "") +
        ` \`${u.userId}\`\n` +
        `   ${config.ROLE_LABELS[u.role] || u.role}\n\n`;
    });
  }
  const nav = [];
  if (page > 0) nav.push({ text: "◀️ السابق", callback_data: `users_page_${page - 1}` });
  if (page < total - 1) nav.push({ text: "التالي ▶️", callback_data: `users_page_${page + 1}` });
  const rows = [];
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🔙 رجوع", callback_data: "admin_main" }]);
  await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...kb(rows) });
}

async function sendChannelsList(bot, chatId, backCb = "admin_main") {
  const all = database.getAllChannels();
  let text = `*📢 القنوات* (${all.length})\n\n`;
  if (!all.length) { text += "لا توجد قنوات مسجلة."; }
  else {
    all.slice(0, 15).forEach((c, i) => {
      text += `${i + 1}. *${c.title || "قناة"}*\n` +
        `   \`${c.channelId}\`` +
        (c.username ? ` | @${c.username}` : "") + "\n" +
        `   المالك: \`${c.ownerId || "غير محدد"}\`\n\n`;
    });
  }
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "➕ إضافة قناة", callback_data: "admin_add_channel" }, { text: "🗑 حذف قناة", callback_data: "admin_del_channel" }],
      [{ text: "🔙 رجوع", callback_data: backCb }],
    ]),
  });
}

async function sendGroupsList(bot, chatId, backCb = "dev_main") {
  const all = database.getAllGroups();
  let text = `*🏠 المجموعات* (${all.length})\n\n`;
  if (!all.length) { text += "لا توجد مجموعات مسجلة."; }
  else {
    all.slice(0, 15).forEach((g, i) => {
      text += `${i + 1}. *${g.title || "مجموعة"}*\n` +
        `   \`${g.groupId}\`\n` +
        `   المالك: \`${g.ownerId || "غير محدد"}\`\n\n`;
    });
  }
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "🗑 حذف مجموعة", callback_data: "dev_del_group" }],
      [{ text: "🔙 رجوع", callback_data: backCb }],
    ]),
  });
}

// ─── Register all bot handlers ─────────────────────────────────────────────────
function registerHandlers(bot) {

  // ── /start ──────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    if (!msg.from) return;
    await middleware.registerUser(msg.from);
    const role = middleware.getUserRole(msg.from.id);
    if (role === config.ROLES.BANNED)
      return bot.sendMessage(msg.chat.id, config.MESSAGES.BANNED);
    const settings = database.getSettings();
    if (settings.maintenance && role !== config.ROLES.DEVELOPER)
      return bot.sendMessage(msg.chat.id, config.MESSAGES.MAINTENANCE);
    await sendMainMenu(bot, msg.chat.id, msg.from);
  });

  // ── /myid ────────────────────────────────────────────────────────────────────
  bot.onText(/\/myid/, async (msg) => {
    await bot.sendMessage(msg.chat.id, `🆔 معرفك: \`${msg.from.id}\``, { parse_mode: "Markdown" });
  });

  // ── /stats ───────────────────────────────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    if (!middleware.hasRole(msg.from.id, config.ROLES.ADMIN, config.ROLES.DEVELOPER))
      return bot.sendMessage(msg.chat.id, config.MESSAGES.NO_PERMISSION);
    const u = database.getAllUsers();
    const c = database.getAllChannels();
    const g = database.getAllGroups();
    const s = database.getSettings();
    await bot.sendMessage(msg.chat.id,
      `*📊 الإحصائيات*\n\n` +
      `المستخدمون: ${u.length}\nالقنوات: ${c.length}\nالمجموعات: ${g.length}\n` +
      `البوت: ${s.maintenance ? "🔴 صيانة" : "🟢 يعمل"}`,
      { parse_mode: "Markdown" });
  });

  // ── /promote ─────────────────────────────────────────────────────────────────
  bot.onText(/\/promote (\d+) (\w+)/, async (msg, match) => {
    if (!isDeveloper(msg.from.id))
      return bot.sendMessage(msg.chat.id, config.MESSAGES.NO_PERMISSION);
    const targetId = parseInt(match[1]);
    const role = match[2];
    if (!Object.values(config.ROLES).includes(role))
      return bot.sendMessage(msg.chat.id, `رتبة غير صحيحة. المتاح: ${Object.values(config.ROLES).join(", ")}`);
    const user = database.getUser(targetId);
    if (!user) return bot.sendMessage(msg.chat.id, "المستخدم غير موجود.");
    database.setUser(targetId, { role });
    database.addLog({ action: `promote_${role}`, userId: msg.from.id, targetId });
    await bot.sendMessage(msg.chat.id, `✅ تم تعيين ${config.ROLE_LABELS[role]} للمستخدم \`${targetId}\``, { parse_mode: "Markdown" });
    try { await bot.sendMessage(targetId, `تم تغيير رتبتك إلى: ${config.ROLE_LABELS[role]}`); } catch (_) {}
  });

  // ── /ban & /unban ─────────────────────────────────────────────────────────────
  bot.onText(/\/ban (\d+)/, async (msg, match) => {
    if (!middleware.hasRole(msg.from.id, config.ROLES.ADMIN, config.ROLES.DEVELOPER))
      return bot.sendMessage(msg.chat.id, config.MESSAGES.NO_PERMISSION);
    const targetId = parseInt(match[1]);
    if (isDeveloper(targetId)) return bot.sendMessage(msg.chat.id, "لا يمكن حظر المطور.");
    database.setUser(targetId, { role: config.ROLES.BANNED });
    database.addLog({ action: "ban", userId: msg.from.id, targetId });
    await bot.sendMessage(msg.chat.id, `🚫 تم حظر \`${targetId}\``, { parse_mode: "Markdown" });
  });

  bot.onText(/\/unban (\d+)/, async (msg, match) => {
    if (!middleware.hasRole(msg.from.id, config.ROLES.ADMIN, config.ROLES.DEVELOPER))
      return bot.sendMessage(msg.chat.id, config.MESSAGES.NO_PERMISSION);
    const targetId = parseInt(match[1]);
    database.setUser(targetId, { role: config.ROLES.USER });
    database.addLog({ action: "unban", userId: msg.from.id, targetId });
    await bot.sendMessage(msg.chat.id, `✅ رُفع الحظر عن \`${targetId}\``, { parse_mode: "Markdown" });
  });

  // ── /addchannel ───────────────────────────────────────────────────────────────
  bot.onText(/\/addchannel (.+)/, async (msg, match) => {
    await middleware.registerUser(msg.from);
    const channelId = parseChannelId(match[1]);
    if (!channelId) return bot.sendMessage(msg.chat.id, "صيغة غير صحيحة. مثال: /addchannel @username");
    try {
      const chat = await bot.getChat(channelId);
      database.setChannel(chat.id, {
        title: chat.title, username: chat.username,
        channelId: chat.id, ownerId: msg.from.id,
        adminIds: [msg.from.id], membersCount: chat.members_count || 0,
      });
      database.addLog({ action: "add_channel", userId: msg.from.id, channelId: chat.id });
      await bot.sendMessage(msg.chat.id, `✅ تمت إضافة *${chat.title}*`, { parse_mode: "Markdown" });
    } catch (e) {
      await bot.sendMessage(msg.chat.id, `❌ فشل: ${e.message}\nتأكد أن البوت مشرف في القناة.`);
    }
  });

  // ── /removechannel ────────────────────────────────────────────────────────────
  bot.onText(/\/removechannel (.+)/, async (msg, match) => {
    await middleware.registerUser(msg.from);
    const channelId = parseChannelId(match[1]);
    const ch = database.getChannel(channelId);
    if (!ch) return bot.sendMessage(msg.chat.id, "القناة غير موجودة.");
    const role = middleware.getUserRole(msg.from.id);
    if (ch.ownerId !== msg.from.id && role !== config.ROLES.DEVELOPER)
      return bot.sendMessage(msg.chat.id, "لا يمكنك حذف قناة لا تملكها.");
    database.deleteChannel(channelId);
    database.addLog({ action: "remove_channel", userId: msg.from.id, channelId });
    await bot.sendMessage(msg.chat.id, "✅ تم حذف القناة.");
  });

  // ── /broadcast ────────────────────────────────────────────────────────────────
  bot.onText(/\/broadcast (.+)/s, async (msg, match) => {
    if (!middleware.hasRole(msg.from.id, config.ROLES.DEVELOPER))
      return bot.sendMessage(msg.chat.id, config.MESSAGES.NO_PERMISSION);
    const text = match[1];
    const users = database.getAllUsers();
    let sent = 0, failed = 0;
    await bot.sendMessage(msg.chat.id, `📢 جاري الإرسال لـ ${users.length} مستخدم...`);
    for (const u of users) {
      if (u.userId === msg.from.id) continue;
      try { await bot.sendMessage(u.userId, text); sent++; } catch (_) { failed++; }
      await new Promise(r => setTimeout(r, 50));
    }
    database.addLog({ action: "broadcast", userId: msg.from.id });
    await bot.sendMessage(msg.chat.id, `✅ تم!\nنجح: ${sent}\nفشل: ${failed}`);
  });

  // ── Text messages (state handling) ───────────────────────────────────────────
  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/") || !msg.from) return;
    await middleware.registerUser(msg.from);
    const userId = msg.from.id;
    const state = getState(userId);
    if (!state) return;
    await handleState(bot, msg, state, userId);
  });

  // ── Callback queries ──────────────────────────────────────────────────────────
  bot.on("callback_query", async (query) => {
    if (!query || !query.from) return;

    // Always answer immediately so spinner disappears
    try { await bot.answerCallbackQuery(query.id); } catch (_) {}

    const userId = query.from.id;
    const data = query.data || "";
    const msg = query.message;
    if (!msg || !msg.chat) return;
    const chatId = msg.chat.id;

    await middleware.registerUser(query.from);

    const role = middleware.getUserRole(userId);
    if (role === config.ROLES.BANNED)
      return bot.sendMessage(chatId, config.MESSAGES.BANNED);

    const settings = database.getSettings();
    if (settings.maintenance && role !== config.ROLES.DEVELOPER)
      return bot.sendMessage(chatId, config.MESSAGES.MAINTENANCE);

    try {
      await handleCallback(bot, chatId, userId, data, query.from, role);
    } catch (e) {
      console.error("[CALLBACK] Error:", e.message);
      try { await bot.sendMessage(chatId, config.MESSAGES.ERROR); } catch (_) {}
    }
  });
}

// ─── State handler ────────────────────────────────────────────────────────────
async function handleState(bot, msg, state, userId) {
  const chatId = msg.chat.id;

  switch (state.type) {

    case "await_channel_id": {
      const channelId = parseChannelId(msg.text);
      if (!channelId) { await bot.sendMessage(chatId, "❌ صيغة غير صحيحة. أرسل @username أو ID."); return; }
      try {
        const chat = await bot.getChat(channelId);
        database.setChannel(chat.id, {
          title: chat.title, username: chat.username,
          channelId: chat.id, ownerId: userId,
          adminIds: [userId], membersCount: chat.members_count || 0,
        });
        database.addLog({ action: "add_channel", userId, channelId: chat.id });
        clearState(userId);
        await bot.sendMessage(chatId, `✅ تمت إضافة *${chat.title}* بنجاح!`, { parse_mode: "Markdown" });
      } catch (e) {
        await bot.sendMessage(chatId, `❌ فشل: ${e.message}\nتأكد أن البوت مشرف في القناة.`);
      }
      break;
    }

    case "await_group_id": {
      const groupId = parseChannelId(msg.text);
      if (!groupId) { await bot.sendMessage(chatId, "❌ صيغة غير صحيحة."); return; }
      try {
        const chat = await bot.getChat(groupId);
        database.setGroup(chat.id, {
          title: chat.title, groupId: chat.id,
          ownerId: userId, adminIds: [userId], membersCount: chat.members_count || 0,
        });
        database.addLog({ action: "add_group", userId, groupId: chat.id });
        clearState(userId);
        await bot.sendMessage(chatId, `✅ تمت إضافة *${chat.title}* بنجاح!`, { parse_mode: "Markdown" });
      } catch (e) {
        await bot.sendMessage(chatId, `❌ فشل: ${e.message}\nتأكد أن البوت مشرف في المجموعة.`);
      }
      break;
    }

    case "await_ban_id": {
      const targetId = parseInt(msg.text);
      if (isNaN(targetId)) { await bot.sendMessage(chatId, "❌ أرسل ID صحيح."); return; }
      if (isDeveloper(targetId)) { await bot.sendMessage(chatId, "لا يمكن حظر المطور."); clearState(userId); return; }
      database.setUser(targetId, { role: config.ROLES.BANNED });
      database.addLog({ action: "ban", userId, targetId });
      clearState(userId);
      await bot.sendMessage(chatId, `🚫 تم حظر \`${targetId}\``, { parse_mode: "Markdown" });
      break;
    }

    case "await_unban_id": {
      const targetId = parseInt(msg.text);
      if (isNaN(targetId)) { await bot.sendMessage(chatId, "❌ أرسل ID صحيح."); return; }
      database.setUser(targetId, { role: config.ROLES.USER });
      database.addLog({ action: "unban", userId, targetId });
      clearState(userId);
      await bot.sendMessage(chatId, `✅ رُفع الحظر عن \`${targetId}\``, { parse_mode: "Markdown" });
      break;
    }

    case "await_promote_id": {
      const targetId = parseInt(msg.text);
      if (isNaN(targetId)) { await bot.sendMessage(chatId, "❌ أرسل ID صحيح."); return; }
      setState(userId, { type: "await_promote_role", targetId });
      await bot.sendMessage(chatId, "اختر الرتبة الجديدة:", kb([
        [{ text: "🛡 مشرف", callback_data: `set_role_admin_${targetId}` }, { text: "👤 مستخدم", callback_data: `set_role_user_${targetId}` }],
        [{ text: "🚫 محظور", callback_data: `set_role_banned_${targetId}` }],
      ]));
      break;
    }

    case "await_del_channel_id": {
      const channelId = parseChannelId(msg.text);
      if (!channelId) { await bot.sendMessage(chatId, "❌ صيغة غير صحيحة."); return; }
      const ch = database.getChannel(channelId);
      if (!ch) { clearState(userId); await bot.sendMessage(chatId, "القناة غير موجودة."); return; }
      database.deleteChannel(channelId);
      database.addLog({ action: "del_channel", userId, channelId });
      clearState(userId);
      await bot.sendMessage(chatId, "✅ تم حذف القناة.");
      break;
    }

    case "await_del_group_id": {
      const groupId = parseChannelId(msg.text);
      if (!groupId) { await bot.sendMessage(chatId, "❌ صيغة غير صحيحة."); return; }
      const gr = database.getGroup(groupId);
      if (!gr) { clearState(userId); await bot.sendMessage(chatId, "المجموعة غير موجودة."); return; }
      database.deleteGroup(groupId);
      database.addLog({ action: "del_group", userId, groupId });
      clearState(userId);
      await bot.sendMessage(chatId, "✅ تم حذف المجموعة.");
      break;
    }

    case "await_broadcast_text": {
      const users = database.getAllUsers();
      let sent = 0, failed = 0;
      clearState(userId);
      await bot.sendMessage(chatId, "📢 جاري الإرسال...");
      for (const u of users) {
        if (u.userId === userId) continue;
        try { await bot.sendMessage(u.userId, msg.text); sent++; } catch (_) { failed++; }
        await new Promise(r => setTimeout(r, 50));
      }
      database.addLog({ action: "broadcast", userId });
      await bot.sendMessage(chatId, `✅ تم!\nنجح: ${sent} | فشل: ${failed}`);
      break;
    }

    case "await_send_channel_msg": {
      const channelId = state.channelId;
      try {
        await bot.sendMessage(channelId, msg.text, { parse_mode: "Markdown" });
        database.addLog({ action: "send_to_channel", userId, channelId });
        clearState(userId);
        await bot.sendMessage(chatId, "✅ تم إرسال الرسالة للقناة!");
      } catch (e) {
        await bot.sendMessage(chatId, `❌ فشل الإرسال: ${e.message}`);
      }
      break;
    }

    case "await_welcome_msg": {
      database.updateSettings({ welcomeMessage: msg.text });
      clearState(userId);
      await bot.sendMessage(chatId, "✅ تم تحديث رسالة الترحيب.");
      break;
    }

    default:
      clearState(userId);
  }
}

// ─── Callback handler ─────────────────────────────────────────────────────────
async function handleCallback(bot, chatId, userId, data, from, role) {

  // ── Main menus ──────────────────────────────────────────────────────────────
  if (data === "menu_main")  { await sendMainMenu(bot, chatId, from); return; }
  if (data === "menu_user")  { await sendUserPanel(bot, chatId, userId); return; }

  if (data === "menu_admin") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER))
      return bot.sendMessage(chatId, config.MESSAGES.NO_PERMISSION);
    await sendAdminPanel(bot, chatId, userId); return;
  }

  if (data === "menu_dev") {
    if (!isDeveloper(userId)) return bot.sendMessage(chatId, config.MESSAGES.NO_PERMISSION);
    await sendDevPanel(bot, chatId); return;
  }

  if (data === "menu_help") {
    const helpText =
      `*❓ المساعدة*\n\n` +
      `الأوامر المتاحة:\n` +
      `/start — القائمة الرئيسية\n` +
      `/myid — معرفة ID الخاص بك\n` +
      `/addchannel @username — إضافة قناة\n` +
      `/removechannel @username — حذف قناة\n` +
      `/stats — إحصائيات (للمشرفين)\n` +
      `/ban <ID> — حظر مستخدم\n` +
      `/unban <ID> — رفع حظر\n` +
      `/promote <ID> <role> — تعيين رتبة\n` +
      `/broadcast <رسالة> — رسالة جماعية\n\n` +
      `*الرتب:* developer, admin, user, banned`;
    await bot.sendMessage(chatId, helpText, {
      parse_mode: "Markdown",
      ...kb([[{ text: "🔙 رجوع", callback_data: "menu_main" }]]),
    });
    return;
  }

  // ── User panel ──────────────────────────────────────────────────────────────
  if (data === "user_my_channels") {
    const all = database.getAllChannels();
    const mine = all.filter(c => c.ownerId === userId || (c.adminIds || []).includes(userId));
    let text = `*📢 قنواتي* (${mine.length})\n\n`;
    if (!mine.length) text += "لا توجد قنوات. أضف قناة أولاً.";
    else mine.forEach((c, i) => {
      text += `${i + 1}. *${c.title || "قناة"}*\n   \`${c.channelId}\`\n   الأعضاء: ${c.membersCount || "غير محدد"}\n\n`;
    });
    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "➕ إضافة قناة", callback_data: "user_add_channel" }, { text: "🗑 حذف قناة", callback_data: "user_del_channel" }],
        [{ text: "🔙 رجوع", callback_data: "menu_user" }],
      ]),
    });
    return;
  }

  if (data === "user_my_groups") {
    const all = database.getAllGroups();
    const mine = all.filter(g => g.ownerId === userId || (g.adminIds || []).includes(userId));
    let text = `*👥 مجموعاتي* (${mine.length})\n\n`;
    if (!mine.length) text += "لا توجد مجموعات. أضف مجموعة أولاً.";
    else mine.forEach((g, i) => {
      text += `${i + 1}. *${g.title || "مجموعة"}*\n   \`${g.groupId}\`\n   الأعضاء: ${g.membersCount || "غير محدد"}\n\n`;
    });
    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "➕ إضافة مجموعة", callback_data: "user_add_group" }, { text: "🗑 حذف مجموعة", callback_data: "user_del_group" }],
        [{ text: "🔙 رجوع", callback_data: "menu_user" }],
      ]),
    });
    return;
  }

  if (data === "user_add_channel") {
    setState(userId, { type: "await_channel_id" });
    await bot.sendMessage(chatId, "📢 أرسل معرف القناة أو username:\nمثال: @channelname أو -100xxxxxxxxx\n\n⚠️ تأكد أن البوت مشرف في القناة أولاً.",
      kb([[{ text: "❌ إلغاء", callback_data: "menu_user" }]]));
    return;
  }

  if (data === "user_add_group") {
    setState(userId, { type: "await_group_id" });
    await bot.sendMessage(chatId, "👥 أرسل معرف المجموعة:\nمثال: -100xxxxxxxxx\n\n⚠️ تأكد أن البوت مشرف في المجموعة أولاً.",
      kb([[{ text: "❌ إلغاء", callback_data: "menu_user" }]]));
    return;
  }

  if (data === "user_del_channel") {
    setState(userId, { type: "await_del_channel_id" });
    await bot.sendMessage(chatId, "أرسل ID القناة التي تريد حذفها:", kb([[{ text: "❌ إلغاء", callback_data: "menu_user" }]]));
    return;
  }

  if (data === "user_del_group") {
    setState(userId, { type: "await_del_group_id" });
    await bot.sendMessage(chatId, "أرسل ID المجموعة التي تريد حذفها:", kb([[{ text: "❌ إلغاء", callback_data: "menu_user" }]]));
    return;
  }

  if (data === "user_send_channel") {
    const all = database.getAllChannels();
    const mine = all.filter(c => c.ownerId === userId || (c.adminIds || []).includes(userId));
    if (!mine.length) { await bot.sendMessage(chatId, "لا توجد قنوات. أضف قناة أولاً."); return; }
    const rows = mine.map(c => [{ text: c.title || c.channelId.toString(), callback_data: `pick_ch_${c.channelId}` }]);
    rows.push([{ text: "🔙 رجوع", callback_data: "menu_user" }]);
    await bot.sendMessage(chatId, "اختر القناة:", kb(rows));
    return;
  }

  if (data.startsWith("pick_ch_")) {
    const channelId = data.replace("pick_ch_", "");
    setState(userId, { type: "await_send_channel_msg", channelId });
    await bot.sendMessage(chatId, "✍️ اكتب الرسالة التي تريد إرسالها للقناة:", kb([[{ text: "❌ إلغاء", callback_data: "menu_user" }]]));
    return;
  }

  if (data === "user_stats") {
    const u = database.getUser(userId);
    const allCh = database.getAllChannels();
    const allGr = database.getAllGroups();
    const myCh = allCh.filter(c => c.ownerId === userId);
    const myGr = allGr.filter(g => g.ownerId === userId);
    const totalMembers = myCh.reduce((s, c) => s + (c.membersCount || 0), 0);
    await bot.sendMessage(chatId,
      `*📊 إحصائياتي*\n\n` +
      `الاسم: ${u ? u.firstName : "مستخدم"}\n` +
      `ID: \`${userId}\`\n` +
      `تاريخ التسجيل: ${u ? shortDate(u.createdAt) : "غير معروف"}\n\n` +
      `قنواتي: ${myCh.length}\n` +
      `مجموعاتي: ${myGr.length}\n` +
      `إجمالي الأعضاء: ${formatNumber(totalMembers)}`,
      { parse_mode: "Markdown", ...kb([[{ text: "🔙 رجوع", callback_data: "menu_user" }]]) });
    return;
  }

  // ── Admin panel callbacks ────────────────────────────────────────────────────
  if (data === "admin_main") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER))
      return bot.sendMessage(chatId, config.MESSAGES.NO_PERMISSION);
    await sendAdminPanel(bot, chatId, userId); return;
  }

  if (data === "admin_users") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
    await sendUsersList(bot, chatId, 0); return;
  }

  if (data.startsWith("users_page_")) {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
    const page = parseInt(data.replace("users_page_", ""));
    await sendUsersList(bot, chatId, page); return;
  }

  if (data === "admin_channels") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
    await sendChannelsList(bot, chatId, "admin_main"); return;
  }

  if (data === "admin_add_channel") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
    setState(userId, { type: "await_channel_id" });
    await bot.sendMessage(chatId, "أرسل username أو ID القناة:", kb([[{ text: "❌ إلغاء", callback_data: "admin_main" }]]));
    return;
  }

  if (data === "admin_del_channel") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
    setState(userId, { type: "await_del_channel_id" });
    await bot.sendMessage(chatId, "أرسل ID القناة للحذف:", kb([[{ text: "❌ إلغاء", callback_data: "admin_channels" }]]));
    return;
  }

  if (data === "admin_ban") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
    setState(userId, { type: "await_ban_id" });
    await bot.sendMessage(chatId, "أرسل ID المستخدم الذي تريد حظره:", kb([[{ text: "❌ إلغاء", callback_data: "admin_main" }]]));
    return;
  }

  if (data === "admin_unban") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
    setState(userId, { type: "await_unban_id" });
    await bot.sendMessage(chatId, "أرسل ID المستخدم لرفع الحظر عنه:", kb([[{ text: "❌ إلغاء", callback_data: "admin_main" }]]));
    return;
  }

  if (data === "admin_broadcast_ch") {
    if (!middleware.hasRole(userId, config.ROLES.ADMIN, config.ROLES.DEVELOPER)) return;
    const all = database.getAllChannels();
    const mine = isDeveloper(userId)
      ? all
      : all.filter(c => (c.adminIds || []).includes(userId));
    if (!mine.length) { await bot.sendMessage(chatId, "لا توجد قنوات متاحة."); return; }
    const rows = mine.map(c => [{ text: c.title || c.channelId.toString(), callback_data: `pick_ch_${c.channelId}` }]);
    rows.push([{ text: "🔙 رجوع", callback_data: "admin_main" }]);
    await bot.sendMessage(chatId, "اختر القناة:", kb(rows));
    return;
  }

  // ── Dev panel callbacks ──────────────────────────────────────────────────────
  if (data === "dev_main") {
    if (!isDeveloper(userId)) return bot.sendMessage(chatId, config.MESSAGES.NO_PERMISSION);
    await sendDevPanel(bot, chatId); return;
  }

  if (data === "dev_users") {
    if (!isDeveloper(userId)) return;
    await sendUsersList(bot, chatId, 0); return;
  }

  if (data === "dev_channels") {
    if (!isDeveloper(userId)) return;
    await sendChannelsList(bot, chatId, "dev_main"); return;
  }

  if (data === "dev_groups") {
    if (!isDeveloper(userId)) return;
    await sendGroupsList(bot, chatId, "dev_main"); return;
  }

  if (data === "dev_del_group") {
    if (!isDeveloper(userId)) return;
    setState(userId, { type: "await_del_group_id" });
    await bot.sendMessage(chatId, "أرسل ID المجموعة للحذف:", kb([[{ text: "❌ إلغاء", callback_data: "dev_groups" }]]));
    return;
  }

  if (data === "dev_logs") {
    if (!isDeveloper(userId)) return;
    const logs = database.getLogs(15);
    let text = `*📋 آخر السجلات*\n\n`;
    if (!logs.length) text += "لا توجد سجلات.";
    else logs.forEach(l => {
      text += `[${new Date(l.timestamp).toLocaleString("ar")}]\n${l.action}` +
        (l.userId ? ` — \`${l.userId}\`` : "") + "\n\n";
    });
    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...kb([[{ text: "🗑 مسح السجلات", callback_data: "dev_clear_logs" }, { text: "🔙 رجوع", callback_data: "dev_main" }]]),
    });
    return;
  }

  if (data === "dev_clear_logs") {
    if (!isDeveloper(userId)) return;
    database.clearLogs();
    await bot.sendMessage(chatId, "✅ تم مسح السجلات.", kb([[{ text: "🔙 رجوع", callback_data: "dev_main" }]]));
    return;
  }

  if (data === "dev_settings") {
    if (!isDeveloper(userId)) return;
    const s = database.getSettings();
    await bot.sendMessage(chatId,
      `*⚙️ الإعدادات*\n\nرسالة الترحيب:\n_${s.welcomeMessage}_\n\nالصيانة: ${s.maintenance ? "مفعلة" : "معطلة"}`,
      {
        parse_mode: "Markdown",
        ...kb([
          [{ text: "✏️ تغيير رسالة الترحيب", callback_data: "dev_set_welcome" }],
          [{ text: s.maintenance ? "✅ إيقاف الصيانة" : "🔧 تفعيل الصيانة", callback_data: "dev_toggle_maintenance" }],
          [{ text: "🔙 رجوع", callback_data: "dev_main" }],
        ]),
      });
    return;
  }

  if (data === "dev_set_welcome") {
    if (!isDeveloper(userId)) return;
    setState(userId, { type: "await_welcome_msg" });
    await bot.sendMessage(chatId, "أرسل رسالة الترحيب الجديدة:", kb([[{ text: "❌ إلغاء", callback_data: "dev_settings" }]]));
    return;
  }

  if (data === "dev_toggle_maintenance") {
    if (!isDeveloper(userId)) return;
    const s = database.getSettings();
    database.updateSettings({ maintenance: !s.maintenance });
    await bot.sendMessage(chatId, `✅ ${!s.maintenance ? "تفعيل" : "إيقاف"} وضع الصيانة.`,
      kb([[{ text: "🔙 رجوع", callback_data: "dev_main" }]]));
    return;
  }

  if (data === "dev_broadcast") {
    if (!isDeveloper(userId)) return;
    setState(userId, { type: "await_broadcast_text" });
    await bot.sendMessage(chatId, "✍️ اكتب الرسالة الجماعية:", kb([[{ text: "❌ إلغاء", callback_data: "dev_main" }]]));
    return;
  }

  // ── Role setting ─────────────────────────────────────────────────────────────
  if (data.startsWith("set_role_")) {
    if (!isDeveloper(userId)) return;
    const parts = data.replace("set_role_", "").split("_");
    const targetId = parseInt(parts[parts.length - 1]);
    const newRole = parts.slice(0, -1).join("_");
    if (!Object.values(config.ROLES).includes(newRole)) return;
    database.setUser(targetId, { role: newRole });
    database.addLog({ action: `set_role_${newRole}`, userId, targetId });
    clearState(userId);
    await bot.sendMessage(chatId, `✅ تم تعيين ${config.ROLE_LABELS[newRole]} للمستخدم \`${targetId}\``, { parse_mode: "Markdown" });
    try { await bot.sendMessage(targetId, `تم تغيير رتبتك إلى: ${config.ROLE_LABELS[newRole]}`); } catch (_) {}
    return;
  }
}

module.exports = { registerHandlers };
