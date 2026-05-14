"use strict";

const cfg = require("./config");
const db  = require("./db");
const mw  = require("./middleware");
const { isDev, fmtNum, fmtDate, parseChatId, kb } = require("./helpers");

/* ══════════════════════════════════════════════════════
   STATES  (in-memory, per user)
═══════════════════════════════════════════════════════ */
const STATE = {};
const setState   = (id, s) => { STATE[id] = s; };
const getState   = id      => STATE[id] || null;
const clearState = id      => { delete STATE[id]; };

/* ══════════════════════════════════════════════════════
   KEYBOARD HELPERS
═══════════════════════════════════════════════════════ */
const BACK_MAIN  = [{ text: "🏠 القائمة الرئيسية", callback_data: "main" }];
const BACK_USER  = [{ text: "↩️ رجوع",             callback_data: "panel_user" }];
const BACK_ADMIN = [{ text: "↩️ رجوع",             callback_data: "panel_admin" }];
const BACK_DEV   = [{ text: "↩️ رجوع",             callback_data: "panel_dev" }];
const CANCEL     = role => [{ text: "❌ إلغاء", callback_data: `panel_${role}` }];

/* ══════════════════════════════════════════════════════
   PANELS
═══════════════════════════════════════════════════════ */
async function sendMain(bot, chatId, from) {
  const role     = mw.getRole(from.id);
  const settings = db.getSettings();
  const user     = db.getUser(parseInt(from.id));
  const name     = user?.name || from.first_name || "مستخدم";

  const rows = [
    [{ text: "👤 لوحتي", callback_data: "panel_user" }],
  ];
  if (role === cfg.ROLES.ADMIN || role === cfg.ROLES.DEVELOPER)
    rows.push([{ text: "🛡 لوحة المشرف", callback_data: "panel_admin" }]);
  if (role === cfg.ROLES.DEVELOPER)
    rows.push([{ text: "👑 لوحة المطوّر", callback_data: "panel_dev" }]);
  rows.push([{ text: "❓ مساعدة", callback_data: "help" }]);

  await bot.sendMessage(
    chatId,
    `*${settings.welcome}*\n\nأهلاً ${name}!\nرتبتك: ${cfg.ROLE_LABELS[role]}`,
    { parse_mode: "Markdown", ...kb(rows) }
  );
}

async function sendUserPanel(bot, chatId, userId) {
  const user = db.getUser(userId);
  const role = mw.getRole(userId);
  const myCh = db.allChannels().filter(c => c.ownerId === userId || c.admins?.includes(userId));
  const myGr = db.allGroups().filter(g => g.ownerId === userId  || g.admins?.includes(userId));

  await bot.sendMessage(chatId,
    `*👤 لوحتي*\n\n` +
    `الاسم: ${user?.name || "مستخدم"}\n` +
    `الرتبة: ${cfg.ROLE_LABELS[role]}\n\n` +
    `📢 قنواتي: ${myCh.length}\n` +
    `👥 مجموعاتي: ${myGr.length}`,
    {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "📢 قنواتي",      callback_data: "my_channels"  }, { text: "👥 مجموعاتي",    callback_data: "my_groups"    }],
        [{ text: "➕ إضافة قناة",  callback_data: "add_channel"  }, { text: "➕ إضافة مجموعة", callback_data: "add_group"    }],
        [{ text: "📤 إرسال لقناة", callback_data: "pick_send_ch" }, { text: "📊 إحصائياتي",   callback_data: "my_stats"     }],
        [BACK_MAIN[0]],
      ]),
    }
  );
}

async function sendAdminPanel(bot, chatId) {
  const users    = db.allUsers();
  const channels = db.allChannels();
  const groups   = db.allGroups();
  const settings = db.getSettings();

  await bot.sendMessage(chatId,
    `*🛡 لوحة المشرف*\n\n` +
    `👥 المستخدمون: ${fmtNum(users.length)}\n` +
    `📢 القنوات: ${fmtNum(channels.length)}\n` +
    `🏠 المجموعات: ${fmtNum(groups.length)}\n` +
    `⚙️ الحالة: ${settings.maintenance ? "🔴 صيانة" : "🟢 يعمل"}`,
    {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "👥 المستخدمون",   callback_data: "admin_users"      }, { text: "📢 القنوات",      callback_data: "admin_channels" }],
        [{ text: "🏠 المجموعات",    callback_data: "admin_groups"     }, { text: "📤 بث رسالة",    callback_data: "admin_bcast"    }],
        [{ text: "🚫 حظر مستخدم",  callback_data: "admin_ban"        }, { text: "✅ رفع حظر",      callback_data: "admin_unban"    }],
        [BACK_MAIN[0]],
      ]),
    }
  );
}

async function sendDevPanel(bot, chatId) {
  const users    = db.allUsers();
  const channels = db.allChannels();
  const groups   = db.allGroups();
  const settings = db.getSettings();

  await bot.sendMessage(chatId,
    `*👑 لوحة المطوّر*\n\n` +
    `البيئة: \`${cfg.NODE_ENV}\`\n` +
    `الوضع: ${cfg.RENDER_URL ? "Webhook ✅" : "Polling 🔄"}\n` +
    `الصيانة: ${settings.maintenance ? "🔴 مفعّلة" : "🟢 معطّلة"}\n\n` +
    `👥 المستخدمون: ${fmtNum(users.length)}\n` +
    `📢 القنوات: ${fmtNum(channels.length)}\n` +
    `🏠 المجموعات: ${fmtNum(groups.length)}\n` +
    `🔴 المحظورون: ${fmtNum(users.filter(u => u.role === "banned").length)}\n` +
    `🛡 المشرفون: ${fmtNum(users.filter(u => u.role === "admin").length)}`,
    {
      parse_mode: "Markdown",
      ...kb([
        [{ text: "👥 المستخدمون",         callback_data: "dev_users"        }, { text: "📢 القنوات",        callback_data: "dev_channels"  }],
        [{ text: "🏠 المجموعات",          callback_data: "dev_groups"       }, { text: "📋 السجلات",        callback_data: "dev_logs"      }],
        [{ text: "⚙️ الإعدادات",          callback_data: "dev_settings"     }, { text: "📢 رسالة جماعية",  callback_data: "dev_bcast"     }],
        [{ text: "🔧 تبديل الصيانة",      callback_data: "dev_toggle_maint" }, { text: "🗑 مسح السجلات",   callback_data: "dev_clear_logs"}],
        [{ text: "🔑 تعيين مشرف",         callback_data: "dev_set_admin"    }, { text: "❌ إزالة مشرف",   callback_data: "dev_rem_admin" }],
        [BACK_MAIN[0]],
      ]),
    }
  );
}

/* ══════════════════════════════════════════════════════
   CHANNEL / GROUP LIST VIEWS
═══════════════════════════════════════════════════════ */
async function viewChannels(bot, chatId, userId, backCb) {
  const isAdmin = mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER);
  const list    = isAdmin ? db.allChannels() : db.allChannels().filter(c => c.ownerId === userId || c.admins?.includes(userId));
  let text = `*📢 القنوات* (${list.length})\n\n`;
  if (!list.length) text += "لا توجد قنوات مسجّلة.";
  else list.slice(0, 20).forEach((c, i) => {
    text += `${i + 1}. *${c.title}*\n   \`${c.cid}\`` +
      (c.username ? ` | @${c.username}` : "") +
      `\n   المالك: \`${c.ownerId ?? "—"}\`\n\n`;
  });
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "➕ إضافة قناة", callback_data: "add_channel"  }, { text: "🗑 حذف قناة", callback_data: "del_channel" }],
      [{ text: "↩️ رجوع",       callback_data: backCb          }],
    ]),
  });
}

async function viewGroups(bot, chatId, userId, backCb) {
  const isAdmin = mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER);
  const list    = isAdmin ? db.allGroups() : db.allGroups().filter(g => g.ownerId === userId || g.admins?.includes(userId));
  let text = `*🏠 المجموعات / المجتمعات* (${list.length})\n\n`;
  if (!list.length) text += "لا توجد مجموعات مسجّلة.";
  else list.slice(0, 20).forEach((g, i) => {
    text += `${i + 1}. *${g.title}*\n   \`${g.gid}\`` +
      (g.username ? ` | @${g.username}` : "") +
      `\n   المالك: \`${g.ownerId ?? "—"}\`\n\n`;
  });
  await bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    ...kb([
      [{ text: "➕ إضافة مجموعة", callback_data: "add_group"  }, { text: "🗑 حذف مجموعة", callback_data: "del_group" }],
      [{ text: "↩️ رجوع",          callback_data: backCb        }],
    ]),
  });
}

async function viewUsers(bot, chatId, page, backCb) {
  const all  = db.allUsers();
  const size = 8;
  const pages = Math.ceil(all.length / size) || 1;
  page = Math.max(0, Math.min(page, pages - 1));
  const slice = all.slice(page * size, (page + 1) * size);

  let text = `*👥 المستخدمون* — صفحة ${page + 1} / ${pages}\n\n`;
  if (!slice.length) text += "لا يوجد مستخدمون.";
  else slice.forEach((u, i) => {
    text += `${page * size + i + 1}. ${u.name}` +
      (u.username ? ` @${u.username}` : "") +
      `  \`${u.id}\`\n   ${cfg.ROLE_LABELS[u.role] || u.role}\n\n`;
  });

  const nav = [];
  if (page > 0)          nav.push({ text: "◀️ السابق", callback_data: `upage_${page - 1}_${backCb}` });
  if (page < pages - 1)  nav.push({ text: "التالي ▶️", callback_data: `upage_${page + 1}_${backCb}` });
  const rows = [];
  if (nav.length) rows.push(nav);
  rows.push([{ text: "↩️ رجوع", callback_data: backCb }]);
  await bot.sendMessage(chatId, text, { parse_mode: "Markdown", ...kb(rows) });
}

/* ══════════════════════════════════════════════════════
   REGISTER ALL HANDLERS ON THE BOT INSTANCE
═══════════════════════════════════════════════════════ */
function register(bot) {

  /* ── /start ─────────────────────────────────────── */
  bot.onText(/\/start/, async msg => {
    if (!msg.from) return;
    await mw.touch(msg.from);
    const role     = mw.getRole(msg.from.id);
    const settings = db.getSettings();
    if (role === cfg.ROLES.BANNED)
      return bot.sendMessage(msg.chat.id, "🚫 أنت محظور من استخدام هذا البوت.");
    if (settings.maintenance && role !== cfg.ROLES.DEVELOPER)
      return bot.sendMessage(msg.chat.id, "🔧 البوت في وضع الصيانة. حاول لاحقاً.");
    await sendMain(bot, msg.chat.id, msg.from);
  });

  /* ── /myid ──────────────────────────────────────── */
  bot.onText(/\/myid/, async msg => {
    await bot.sendMessage(msg.chat.id, `🆔 معرّفك: \`${msg.from.id}\``, { parse_mode: "Markdown" });
  });

  /* ── /stats ─────────────────────────────────────── */
  bot.onText(/\/stats/, async msg => {
    if (!mw.isAtLeast(msg.from.id, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER))
      return bot.sendMessage(msg.chat.id, "⛔ ليس لديك صلاحية.");
    const s = db.getSettings();
    await bot.sendMessage(msg.chat.id,
      `📊 *الإحصائيات*\n\n` +
      `المستخدمون: ${db.allUsers().length}\n` +
      `القنوات: ${db.allChannels().length}\n` +
      `المجموعات: ${db.allGroups().length}\n` +
      `الحالة: ${s.maintenance ? "🔴 صيانة" : "🟢 يعمل"}`,
      { parse_mode: "Markdown" }
    );
  });

  /* ── /ban /unban ────────────────────────────────── */
  bot.onText(/\/ban (\d+)/, async (msg, m) => {
    if (!mw.isAtLeast(msg.from.id, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER))
      return bot.sendMessage(msg.chat.id, "⛔ ليس لديك صلاحية.");
    const tid = parseInt(m[1]);
    if (isDev(tid)) return bot.sendMessage(msg.chat.id, "لا يمكن حظر المطوّر.");
    db.upsertUser(tid, { role: cfg.ROLES.BANNED });
    db.addLog({ action: "ban", by: msg.from.id, target: tid });
    await bot.sendMessage(msg.chat.id, `🚫 تم حظر \`${tid}\``, { parse_mode: "Markdown" });
  });

  bot.onText(/\/unban (\d+)/, async (msg, m) => {
    if (!mw.isAtLeast(msg.from.id, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER))
      return bot.sendMessage(msg.chat.id, "⛔ ليس لديك صلاحية.");
    const tid = parseInt(m[1]);
    db.upsertUser(tid, { role: cfg.ROLES.USER });
    db.addLog({ action: "unban", by: msg.from.id, target: tid });
    await bot.sendMessage(msg.chat.id, `✅ رُفع الحظر عن \`${tid}\``, { parse_mode: "Markdown" });
  });

  /* ── /promote ────────────────────────────────────── */
  bot.onText(/\/promote (\d+) (\w+)/, async (msg, m) => {
    if (!isDev(msg.from.id)) return bot.sendMessage(msg.chat.id, "⛔ هذا الأمر للمطوّر فقط.");
    const tid  = parseInt(m[1]);
    const role = m[2];
    if (!Object.values(cfg.ROLES).includes(role))
      return bot.sendMessage(msg.chat.id, `رتبة غير صحيحة. المتاح:\n${Object.values(cfg.ROLES).join(", ")}`);
    db.upsertUser(tid, { role });
    db.addLog({ action: `promote_${role}`, by: msg.from.id, target: tid });
    await bot.sendMessage(msg.chat.id, `✅ تم تعيين ${cfg.ROLE_LABELS[role]} للمستخدم \`${tid}\``, { parse_mode: "Markdown" });
    try { await bot.sendMessage(tid, `تم تغيير رتبتك إلى: ${cfg.ROLE_LABELS[role]}`); } catch (_) {}
  });

  /* ── /addchannel  /removechannel ─────────────────── */
  bot.onText(/\/addchannel (.+)/, async (msg, m) => {
    await mw.touch(msg.from);
    const cid = parseChatId(m[1]);
    if (!cid) return bot.sendMessage(msg.chat.id, "صيغة خاطئة. مثال: /addchannel @myChannel");
    try {
      const chat = await bot.getChat(cid);
      db.upsertChannel(chat.id, { title: chat.title, username: chat.username, cid: chat.id, ownerId: msg.from.id, admins: [msg.from.id], members: chat.members_count || 0 });
      db.addLog({ action: "add_channel", by: msg.from.id, cid: chat.id });
      await bot.sendMessage(msg.chat.id, `✅ تمت إضافة *${chat.title}*`, { parse_mode: "Markdown" });
    } catch (e) { await bot.sendMessage(msg.chat.id, `❌ فشل: ${e.message}\nتأكد أن البوت مشرف في القناة.`); }
  });

  bot.onText(/\/removechannel (.+)/, async (msg, m) => {
    await mw.touch(msg.from);
    const cid = parseChatId(m[1]);
    const ch  = db.getChannel(cid);
    if (!ch) return bot.sendMessage(msg.chat.id, "القناة غير موجودة.");
    if (ch.ownerId !== msg.from.id && !isDev(msg.from.id))
      return bot.sendMessage(msg.chat.id, "لا يمكنك حذف قناة لا تملكها.");
    db.removeChannel(cid);
    db.addLog({ action: "remove_channel", by: msg.from.id, cid });
    await bot.sendMessage(msg.chat.id, "✅ تم حذف القناة.");
  });

  /* ── /broadcast ──────────────────────────────────── */
  bot.onText(/\/broadcast (.+)/s, async (msg, m) => {
    if (!isDev(msg.from.id)) return bot.sendMessage(msg.chat.id, "⛔ هذا الأمر للمطوّر فقط.");
    const users = db.allUsers();
    let sent = 0, failed = 0;
    await bot.sendMessage(msg.chat.id, `📢 جاري الإرسال لـ ${users.length} مستخدم...`);
    for (const u of users) {
      if (u.id === msg.from.id) continue;
      try { await bot.sendMessage(u.id, m[1]); sent++; } catch (_) { failed++; }
      await new Promise(r => setTimeout(r, 60));
    }
    db.addLog({ action: "broadcast", by: msg.from.id });
    await bot.sendMessage(msg.chat.id, `✅ انتهى!\nنجح: ${sent} | فشل: ${failed}`);
  });

  /* ── /help ───────────────────────────────────────── */
  bot.onText(/\/help/, async msg => {
    await mw.touch(msg.from);
    const role = mw.getRole(msg.from.id);
    let t =
      `*❓ المساعدة*\n\n` +
      `الأوامر الأساسية:\n` +
      `/start — القائمة الرئيسية\n` +
      `/myid — معرفة ID الخاص بك\n` +
      `/addchannel @id — إضافة قناة\n` +
      `/removechannel @id — حذف قناة\n`;
    if (mw.isAtLeast(msg.from.id, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER))
      t += `\n*أوامر المشرف:*\n/ban <ID> — حظر\n/unban <ID> — رفع حظر\n/stats — إحصائيات\n`;
    if (isDev(msg.from.id))
      t += `\n*أوامر المطوّر:*\n/promote <ID> <role> — تعيين رتبة\n/broadcast <رسالة> — رسالة جماعية\n`;
    await bot.sendMessage(msg.chat.id, t, { parse_mode: "Markdown", ...kb([[BACK_MAIN[0]]]) });
  });

  /* ── Text messages (state machine) ──────────────── */
  bot.on("message", async msg => {
    if (!msg.text || msg.text.startsWith("/") || !msg.from) return;
    await mw.touch(msg.from);
    const st = getState(msg.from.id);
    if (!st) return;
    await handleState(bot, msg, st);
  });

  /* ── Callback queries ────────────────────────────── */
  bot.on("callback_query", async query => {
    if (!query?.from) return;
    // Always answer instantly so the spinner stops
    bot.answerCallbackQuery(query.id).catch(() => {});

    const userId = query.from.id;
    const data   = query.data || "";
    const chatId = query.message?.chat?.id;
    if (!chatId) return;

    await mw.touch(query.from);
    const role     = mw.getRole(userId);
    const settings = db.getSettings();

    if (role === cfg.ROLES.BANNED)
      return bot.sendMessage(chatId, "🚫 أنت محظور.");
    if (settings.maintenance && role !== cfg.ROLES.DEVELOPER)
      return bot.sendMessage(chatId, "🔧 البوت في وضع الصيانة.");

    try {
      await route(bot, chatId, userId, data, query.from, role);
    } catch (e) {
      console.error("[CB]", e.message);
      bot.sendMessage(chatId, "❌ حدث خطأ. حاول مرة أخرى.").catch(() => {});
    }
  });
}

/* ══════════════════════════════════════════════════════
   STATE MACHINE
═══════════════════════════════════════════════════════ */
async function handleState(bot, msg, st) {
  const uid    = msg.from.id;
  const chatId = msg.chat.id;

  switch (st.type) {

    case "await_ch_id": {
      const cid = parseChatId(msg.text);
      if (!cid) { await bot.sendMessage(chatId, "❌ صيغة خاطئة. أرسل @username أو ID."); return; }
      try {
        const chat = await bot.getChat(cid);
        db.upsertChannel(chat.id, { title: chat.title, username: chat.username, cid: chat.id, ownerId: uid, admins: [uid], members: chat.members_count || 0 });
        db.addLog({ action: "add_channel", by: uid, cid: chat.id });
        clearState(uid);
        await bot.sendMessage(chatId, `✅ تمت إضافة *${chat.title}* بنجاح!`, { parse_mode: "Markdown" });
      } catch (e) { await bot.sendMessage(chatId, `❌ فشل: ${e.message}`); }
      break;
    }

    case "await_gr_id": {
      const gid = parseChatId(msg.text);
      if (!gid) { await bot.sendMessage(chatId, "❌ صيغة خاطئة."); return; }
      try {
        const chat = await bot.getChat(gid);
        db.upsertGroup(chat.id, { title: chat.title, username: chat.username, gid: chat.id, ownerId: uid, admins: [uid], members: chat.members_count || 0 });
        db.addLog({ action: "add_group", by: uid, gid: chat.id });
        clearState(uid);
        await bot.sendMessage(chatId, `✅ تمت إضافة *${chat.title}* بنجاح!`, { parse_mode: "Markdown" });
      } catch (e) { await bot.sendMessage(chatId, `❌ فشل: ${e.message}`); }
      break;
    }

    case "await_del_ch": {
      const cid = parseChatId(msg.text);
      if (!cid) { await bot.sendMessage(chatId, "❌ صيغة خاطئة."); return; }
      const ch = db.getChannel(cid);
      if (!ch) { clearState(uid); await bot.sendMessage(chatId, "القناة غير موجودة."); return; }
      if (ch.ownerId !== uid && !isDev(uid)) { clearState(uid); await bot.sendMessage(chatId, "لا يمكنك حذف قناة لا تملكها."); return; }
      db.removeChannel(cid);
      db.addLog({ action: "del_channel", by: uid, cid });
      clearState(uid);
      await bot.sendMessage(chatId, "✅ تم حذف القناة.");
      break;
    }

    case "await_del_gr": {
      const gid = parseChatId(msg.text);
      if (!gid) { await bot.sendMessage(chatId, "❌ صيغة خاطئة."); return; }
      const gr = db.getGroup(gid);
      if (!gr) { clearState(uid); await bot.sendMessage(chatId, "المجموعة غير موجودة."); return; }
      if (gr.ownerId !== uid && !isDev(uid)) { clearState(uid); await bot.sendMessage(chatId, "لا يمكنك حذف مجموعة لا تملكها."); return; }
      db.removeGroup(gid);
      db.addLog({ action: "del_group", by: uid, gid });
      clearState(uid);
      await bot.sendMessage(chatId, "✅ تم حذف المجموعة.");
      break;
    }

    case "await_ban_id": {
      const tid = parseInt(msg.text);
      if (isNaN(tid)) { await bot.sendMessage(chatId, "❌ أرسل ID صحيح."); return; }
      if (isDev(tid)) { clearState(uid); await bot.sendMessage(chatId, "لا يمكن حظر المطوّر."); return; }
      db.upsertUser(tid, { role: cfg.ROLES.BANNED });
      db.addLog({ action: "ban", by: uid, target: tid });
      clearState(uid);
      await bot.sendMessage(chatId, `🚫 تم حظر \`${tid}\``, { parse_mode: "Markdown" });
      break;
    }

    case "await_unban_id": {
      const tid = parseInt(msg.text);
      if (isNaN(tid)) { await bot.sendMessage(chatId, "❌ أرسل ID صحيح."); return; }
      db.upsertUser(tid, { role: cfg.ROLES.USER });
      db.addLog({ action: "unban", by: uid, target: tid });
      clearState(uid);
      await bot.sendMessage(chatId, `✅ رُفع الحظر عن \`${tid}\``, { parse_mode: "Markdown" });
      break;
    }

    case "await_promote_id": {
      const tid = parseInt(msg.text);
      if (isNaN(tid)) { await bot.sendMessage(chatId, "❌ أرسل ID صحيح."); return; }
      setState(uid, { type: "await_promote_role", tid });
      await bot.sendMessage(chatId, "اختر الرتبة:", kb([
        [{ text: "🛡 مشرف", callback_data: `setrole_admin_${tid}` }, { text: "👤 مستخدم", callback_data: `setrole_user_${tid}` }],
        [{ text: "🚫 محظور", callback_data: `setrole_banned_${tid}` }],
        [{ text: "❌ إلغاء", callback_data: "panel_dev" }],
      ]));
      break;
    }

    case "await_send_ch_msg": {
      const { cid } = st;
      try {
        await bot.sendMessage(cid, msg.text, { parse_mode: "Markdown" });
        db.addLog({ action: "msg_to_channel", by: uid, cid });
        clearState(uid);
        await bot.sendMessage(chatId, "✅ تم إرسال الرسالة للقناة!");
      } catch (e) { await bot.sendMessage(chatId, `❌ فشل: ${e.message}`); }
      break;
    }

    case "await_bcast": {
      const users = db.allUsers();
      let sent = 0, failed = 0;
      clearState(uid);
      await bot.sendMessage(chatId, "📢 جاري الإرسال...");
      for (const u of users) {
        if (u.id === uid) continue;
        try { await bot.sendMessage(u.id, msg.text, { parse_mode: "Markdown" }); sent++; } catch (_) { failed++; }
        await new Promise(r => setTimeout(r, 60));
      }
      db.addLog({ action: "broadcast", by: uid });
      await bot.sendMessage(chatId, `✅ انتهى!\nنجح: ${sent} | فشل: ${failed}`);
      break;
    }

    case "await_welcome": {
      db.patchSettings({ welcome: msg.text });
      clearState(uid);
      await bot.sendMessage(chatId, "✅ تم تحديث رسالة الترحيب.");
      break;
    }

    default: clearState(uid);
  }
}

/* ══════════════════════════════════════════════════════
   CALLBACK ROUTER
═══════════════════════════════════════════════════════ */
async function route(bot, chatId, userId, data, from, role) {

  /* ── Main & panels ─────────────────────────────── */
  if (data === "main")        { await sendMain(bot, chatId, from); return; }
  if (data === "panel_user")  { await sendUserPanel(bot, chatId, userId); return; }

  if (data === "panel_admin") {
    if (!mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER))
      return bot.sendMessage(chatId, "⛔ ليس لديك صلاحية.");
    await sendAdminPanel(bot, chatId); return;
  }

  if (data === "panel_dev") {
    if (!isDev(userId)) return bot.sendMessage(chatId, "⛔ ليس لديك صلاحية.");
    await sendDevPanel(bot, chatId); return;
  }

  if (data === "help") {
    const t =
      `*❓ المساعدة*\n\n/start — القائمة الرئيسية\n/myid — معرفك\n` +
      `/addchannel — إضافة قناة\n/removechannel — حذف قناة\n` +
      `/ban <ID> | /unban <ID>\n/promote <ID> <role>\n/broadcast <رسالة>`;
    await bot.sendMessage(chatId, t, { parse_mode: "Markdown", ...kb([[BACK_MAIN[0]]]) });
    return;
  }

  /* ── User panel actions ────────────────────────── */
  if (data === "my_channels")  { await viewChannels(bot, chatId, userId, "panel_user"); return; }
  if (data === "my_groups")    { await viewGroups(bot, chatId, userId, "panel_user"); return; }

  if (data === "add_channel")  { setState(userId, { type: "await_ch_id" }); await bot.sendMessage(chatId, "📢 أرسل username أو ID القناة:\nمثال: @channelname أو -100xxxxxxxx\n\n⚠️ تأكد أن البوت مشرف في القناة أولاً.", kb([[{ text: "❌ إلغاء", callback_data: "panel_user" }]])); return; }
  if (data === "add_group")    { setState(userId, { type: "await_gr_id" }); await bot.sendMessage(chatId, "🏠 أرسل ID المجموعة أو username:\nمثال: -100xxxxxxxx\n\n⚠️ تأكد أن البوت مشرف في المجموعة أولاً.", kb([[{ text: "❌ إلغاء", callback_data: "panel_user" }]])); return; }
  if (data === "del_channel")  { setState(userId, { type: "await_del_ch" }); await bot.sendMessage(chatId, "أرسل ID القناة التي تريد حذفها:", kb([[{ text: "❌ إلغاء", callback_data: "my_channels" }]])); return; }
  if (data === "del_group")    { setState(userId, { type: "await_del_gr" }); await bot.sendMessage(chatId, "أرسل ID المجموعة التي تريد حذفها:", kb([[{ text: "❌ إلغاء", callback_data: "my_groups"   }]])); return; }

  if (data === "pick_send_ch") {
    const mine = db.allChannels().filter(c => c.ownerId === userId || c.admins?.includes(userId));
    if (!mine.length) { await bot.sendMessage(chatId, "لا توجد قنوات. أضف قناة أولاً."); return; }
    const rows = mine.map(c => [{ text: c.title, callback_data: `send_ch_${c.cid}` }]);
    rows.push([BACK_USER[0]]);
    await bot.sendMessage(chatId, "اختر القناة التي تريد الإرسال إليها:", kb(rows));
    return;
  }

  if (data.startsWith("send_ch_")) {
    const cid = data.replace("send_ch_", "");
    setState(userId, { type: "await_send_ch_msg", cid });
    await bot.sendMessage(chatId, "✍️ اكتب الرسالة التي تريد إرسالها للقناة:", kb([[{ text: "❌ إلغاء", callback_data: "pick_send_ch" }]]));
    return;
  }

  if (data === "my_stats") {
    const u     = db.getUser(userId);
    const myCh  = db.allChannels().filter(c => c.ownerId === userId);
    const myGr  = db.allGroups().filter(g => g.ownerId === userId);
    const total = myCh.reduce((s, c) => s + (c.members || 0), 0);
    await bot.sendMessage(chatId,
      `*📊 إحصائياتي*\n\nالاسم: ${u?.name}\nID: \`${userId}\`\n` +
      `تاريخ الانضمام: ${fmtDate(u?.createdAt)}\n\n` +
      `قنواتي: ${myCh.length}\nمجموعاتي: ${myGr.length}\nإجمالي الأعضاء: ${fmtNum(total)}`,
      { parse_mode: "Markdown", ...kb([[BACK_USER[0]]]) }
    );
    return;
  }

  /* ── Admin panel actions ───────────────────────── */
  if (data === "admin_users") {
    if (!mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER)) return;
    await viewUsers(bot, chatId, 0, "panel_admin"); return;
  }

  if (data.startsWith("upage_")) {
    if (!mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER)) return;
    const parts = data.split("_");
    const page  = parseInt(parts[1]);
    const back  = parts.slice(2).join("_");
    await viewUsers(bot, chatId, page, back); return;
  }

  if (data === "admin_channels") {
    if (!mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER)) return;
    await viewChannels(bot, chatId, userId, "panel_admin"); return;
  }

  if (data === "admin_groups") {
    if (!mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER)) return;
    await viewGroups(bot, chatId, userId, "panel_admin"); return;
  }

  if (data === "admin_ban") {
    if (!mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER)) return;
    setState(userId, { type: "await_ban_id" });
    await bot.sendMessage(chatId, "أرسل ID المستخدم الذي تريد حظره:", kb([[{ text: "❌ إلغاء", callback_data: "panel_admin" }]]));
    return;
  }

  if (data === "admin_unban") {
    if (!mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER)) return;
    setState(userId, { type: "await_unban_id" });
    await bot.sendMessage(chatId, "أرسل ID المستخدم لرفع الحظر عنه:", kb([[{ text: "❌ إلغاء", callback_data: "panel_admin" }]]));
    return;
  }

  if (data === "admin_bcast") {
    if (!mw.isAtLeast(userId, cfg.ROLES.ADMIN, cfg.ROLES.DEVELOPER)) return;
    const all = db.allChannels().filter(c => isDev(userId) || c.admins?.includes(userId));
    if (!all.length) { await bot.sendMessage(chatId, "لا توجد قنوات متاحة."); return; }
    const rows = all.map(c => [{ text: c.title, callback_data: `send_ch_${c.cid}` }]);
    rows.push([BACK_ADMIN[0]]);
    await bot.sendMessage(chatId, "اختر القناة:", kb(rows));
    return;
  }

  /* ── Dev panel actions ─────────────────────────── */
  if (data === "dev_users")    { if (!isDev(userId)) return; await viewUsers(bot, chatId, 0, "panel_dev"); return; }
  if (data === "dev_channels") { if (!isDev(userId)) return; await viewChannels(bot, chatId, userId, "panel_dev"); return; }
  if (data === "dev_groups")   { if (!isDev(userId)) return; await viewGroups(bot, chatId, userId, "panel_dev"); return; }

  if (data === "dev_logs") {
    if (!isDev(userId)) return;
    const logs = db.getLogs(15);
    let t = `*📋 آخر السجلات*\n\n`;
    if (!logs.length) t += "لا توجد سجلات.";
    else logs.forEach(l => { t += `[${new Date(l.at).toLocaleString("ar")}]\n${l.action}` + (l.by ? ` — \`${l.by}\`` : "") + "\n\n"; });
    await bot.sendMessage(chatId, t, { parse_mode: "Markdown", ...kb([[{ text: "🗑 مسح", callback_data: "dev_clear_logs" }, BACK_DEV[0]]]) });
    return;
  }

  if (data === "dev_clear_logs") {
    if (!isDev(userId)) return;
    db.clearLogs();
    await bot.sendMessage(chatId, "✅ تم مسح السجلات.", kb([[BACK_DEV[0]]]));
    return;
  }

  if (data === "dev_settings") {
    if (!isDev(userId)) return;
    const s = db.getSettings();
    await bot.sendMessage(chatId,
      `*⚙️ الإعدادات*\n\nرسالة الترحيب:\n_${s.welcome}_\n\nالصيانة: ${s.maintenance ? "🔴 مفعّلة" : "🟢 معطّلة"}`,
      { parse_mode: "Markdown", ...kb([
        [{ text: "✏️ تغيير رسالة الترحيب", callback_data: "dev_set_welcome" }],
        [BACK_DEV[0]],
      ]) }
    );
    return;
  }

  if (data === "dev_set_welcome") {
    if (!isDev(userId)) return;
    setState(userId, { type: "await_welcome" });
    await bot.sendMessage(chatId, "أرسل رسالة الترحيب الجديدة:", kb([[{ text: "❌ إلغاء", callback_data: "dev_settings" }]]));
    return;
  }

  if (data === "dev_toggle_maint") {
    if (!isDev(userId)) return;
    const s = db.getSettings();
    db.patchSettings({ maintenance: !s.maintenance });
    await bot.sendMessage(chatId, `✅ ${!s.maintenance ? "تفعيل" : "إيقاف"} وضع الصيانة.`, kb([[BACK_DEV[0]]]));
    return;
  }

  if (data === "dev_bcast") {
    if (!isDev(userId)) return;
    setState(userId, { type: "await_bcast" });
    await bot.sendMessage(chatId, "✍️ اكتب الرسالة الجماعية:", kb([[{ text: "❌ إلغاء", callback_data: "panel_dev" }]]));
    return;
  }

  if (data === "dev_set_admin") {
    if (!isDev(userId)) return;
    setState(userId, { type: "await_promote_id" });
    await bot.sendMessage(chatId, "أرسل ID المستخدم الذي تريد تعيينه مشرفاً:", kb([[{ text: "❌ إلغاء", callback_data: "panel_dev" }]]));
    return;
  }

  if (data === "dev_rem_admin") {
    if (!isDev(userId)) return;
    setState(userId, { type: "await_ban_id" }); // reuse ban flow but for demotion
    setState(userId, { type: "await_unban_id" }); // actually demote, not ban — let user type ID
    setState(userId, { type: "await_promote_id" });
    await bot.sendMessage(chatId, "أرسل ID المشرف الذي تريد إزالته:", kb([[{ text: "❌ إلغاء", callback_data: "panel_dev" }]]));
    return;
  }

  /* ── Role setter (from promote flow) ──────────── */
  if (data.startsWith("setrole_")) {
    if (!isDev(userId)) return;
    const parts   = data.replace("setrole_", "").split("_");
    const newRole = parts[0];
    const tid     = parseInt(parts[1]);
    if (!Object.values(cfg.ROLES).includes(newRole)) return;
    db.upsertUser(tid, { role: newRole });
    db.addLog({ action: `setrole_${newRole}`, by: userId, target: tid });
    clearState(userId);
    await bot.sendMessage(chatId, `✅ تم تعيين ${cfg.ROLE_LABELS[newRole]} للمستخدم \`${tid}\``, { parse_mode: "Markdown" });
    try { await bot.sendMessage(tid, `تم تغيير رتبتك إلى: ${cfg.ROLE_LABELS[newRole]}`); } catch (_) {}
    return;
  }
}

module.exports = { register };
