// ============================================================
//  handler_radar.js — رادار المستخدمين
//  يرصد كل شخص يرسل رسالة أو ينضم لأي قروب/قناة فيه البوت
//  ويحفظ بياناته الكاملة مع رابط حسابه
// ============================================================

const db = require('./db');

// ─── بناء رابط الحساب ────────────────────────────────────────
function buildProfileLink(user) {
  if (user.username) return `https://t.me/${user.username}`;
  return `tg://user?id=${user.userId}`;
}

// ─── تحديث بيانات المستخدم الكاملة وحفظها ──────────────────
function updateUserFull(from, chatId, chatType, chatTitle) {
  const user = db.getOrCreateUser(from.id, from.username || '', from.first_name || '');

  // تحديث البيانات إن تغيرت
  let dirty = false;
  if (from.username   && user.username   !== from.username)   { user.username   = from.username;   dirty = true; }
  if (from.first_name && user.firstName  !== from.first_name) { user.firstName  = from.first_name; dirty = true; }
  if (from.last_name  && user.lastName   !== from.last_name)  { user.lastName   = from.last_name;  dirty = true; }

  // حفظ رابط الحساب دائماً
  const profileLink = buildProfileLink({ userId: from.id, username: from.username });
  if (!user.profileLink || user.profileLink !== profileLink) {
    user.profileLink = profileLink;
    dirty = true;
  }

  // حفظ آخر ظهور
  user.lastSeen = new Date();

  // تسجيل المجموعة أو القناة
  if (chatType === 'channel') {
    user.channels.add(chatId);
  } else if (chatType !== 'private') {
    user.groups.add(chatId);

    // تحديث سجل النشاط بالمجموعات
    if (!user.seenInChats) user.seenInChats = {};
    if (!user.seenInChats[chatId]) {
      user.seenInChats[chatId] = {
        chatId,
        chatTitle: chatTitle || String(chatId),
        chatType,
        firstSeen: new Date().toISOString(),
        lastSeen:  new Date().toISOString(),
      };
      dirty = true;
    } else {
      user.seenInChats[chatId].lastSeen = new Date().toISOString();
      user.seenInChats[chatId].chatTitle = chatTitle || user.seenInChats[chatId].chatTitle;
    }
  }

  if (dirty) db.markDirty();
  return user;
}

// ─── تسجيل مشترك قناة ────────────────────────────────────────
function trackChannelSubscriber(u, chatId, chatTitle) {
  const user = db.getOrCreateUser(u.id, u.username || '', u.first_name || '');
  user.channels.add(chatId);
  if (!user.profileLink) user.profileLink = buildProfileLink({ userId: u.id, username: u.username });
  if (u.last_name && user.lastName !== u.last_name) user.lastName = u.last_name;
  user.lastSeen = new Date();
  db.markDirty();
}

module.exports = function setupRadar(bot) {

  // ══════════════════════════════════════════════════════════════
  //  رصد الرسائل في أي مجموعة أو سوبرقروب
  //  (هذا يكمّل messageTrackingMiddleware ويضيف بيانات إضافية)
  // ══════════════════════════════════════════════════════════════
  bot.on(['message', 'edited_message'], async (ctx, next) => {
    const msg  = ctx.message || ctx.editedMessage;
    const from = ctx.from;
    if (!from || from.is_bot) return next();
    if (!ctx.chat) return next();

    const { id: chatId, type: chatType, title: chatTitle } = ctx.chat;

    // نرصد المجموعات والسوبرقروبات فقط (الخاص يُعالج بالميدلوير العام)
    if (chatType === 'private') return next();
    if (chatType === 'channel') return next();

    updateUserFull(from, chatId, chatType, chatTitle);
    return next();
  });

  // ══════════════════════════════════════════════════════════════
  //  رصد منشورات القنوات (channel_post)
  // ══════════════════════════════════════════════════════════════
  bot.on('channel_post', async (ctx, next) => {
    // القنوات لا ترسل from — نتحقق من المشرفين
    // لكن نسجّل القناة نفسها إن لم تكن مسجّلة
    const chat = ctx.chat;
    if (!chat || chat.type !== 'channel') return next();
    // القناة مسجّلة عبر my_chat_member — لا داعي لإعادة التسجيل هنا
    return next();
  });

  // ══════════════════════════════════════════════════════════════
  //  رصد انضمام أعضاء جدد لأي قروب
  //  يعمل حتى لو البوت ليس مشرفاً (بشرط وجود chat_member في allowed_updates)
  // ══════════════════════════════════════════════════════════════
  bot.on('chat_member', async (ctx, next) => {
    const upd = ctx.chatMember;
    const { chat } = upd;
    const u    = upd.new_chat_member.user;
    const stat = upd.new_chat_member.status;

    if (u.is_bot) return next();

    // ── قناة: تسجيل المشتركين ──────────────────────────────────
    if (chat.type === 'channel') {
      if (stat === 'member' || stat === 'subscriber') {
        trackChannelSubscriber(u, chat.id, chat.title);
      }
      return next();
    }

    // ── مجموعة أو سوبرقروب ────────────────────────────────────
    if (stat === 'member' || stat === 'administrator' || stat === 'creator') {
      updateUserFull(u, chat.id, chat.type, chat.title);
      db.trackMember(chat.id, u.id, u.username || '', u.first_name || '', stat === 'creator' ? 'owner' : stat === 'administrator' ? 'admin' : 'member');
    }

    return next();
  });

  // ══════════════════════════════════════════════════════════════
  //  رصد رسائل الخاص مع البوت
  //  (كأن الشخص "تواصل" مع البوت)
  // ══════════════════════════════════════════════════════════════
  bot.on('message', async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot) return next();
    if (ctx.chat?.type !== 'private') return next();

    const user = db.getOrCreateUser(from.id, from.username || '', from.first_name || '');
    if (from.last_name  && user.lastName !== from.last_name)  user.lastName   = from.last_name;
    if (!user.profileLink) user.profileLink = buildProfileLink({ userId: from.id, username: from.username });
    user.lastSeen      = new Date();
    user.contactedBot  = true;
    user.lastContactAt = new Date();
    db.markDirty();

    return next();
  });

};
