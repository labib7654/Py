// ============================================================
//  قاعدة البيانات في الذاكرة
// ============================================================

const groups = new Map();
const users  = new Map();

// ── مجموعة ──────────────────────────────────────────────────
function getGroup(chatId) {
  return groups.get(chatId) || null;
}

function getOrCreateGroup(chatId, title, type, addedBy, addedByUsername) {
  if (!groups.has(chatId)) {
    groups.set(chatId, {
      chatId,
      title,
      type,
      ownerId: null,
      ownerUsername: '',
      addedBy,
      addedByUsername,
      addedAt: new Date(),

      // الأعضاء المتتبعون
      members: new Map(),       // userId → { username, firstName, role, joinedAt }

      // المشرفون مع بيانات الترقية
      admins: new Map(),        // userId → { username, promotedBy, promotedByUsername, promotedAt }

      // نظام التحذيرات
      warns: new Map(),         // userId → [{ reason, warnedBy, warnedAt }]
      maxWarns: 3,

      // رسالة الترحيب
      welcomeMessage: '👋 مرحباً {name} في {group}!\nنتمنى لك وقتاً ممتعاً.',
      welcomeEnabled: true,

      // الإعدادات العامة
      antiSpam: false,
      muteNewMembers: false,
      mutedUsers: new Set(),
      bannedUsers: new Set(),

      // نظام الكلمات المحظورة
      bannedWords: [],          // [{ word, action:'warn'|'mute'|'kick'|'ban', addedBy, addedAt }]
      bannedWordsAction: 'warn',// الإجراء الافتراضي

      // طلبات الانضمام
      joinRequests: new Map(),  // userId → { username, firstName, requestedAt, status }
      joinRequestsEnabled: false,

      // القواعد
      rules: '',
    });
  }
  return groups.get(chatId);
}

function deleteGroup(chatId) {
  groups.delete(chatId);
}

function allGroups() {
  return [...groups.values()];
}

// ── تتبع الأعضاء ─────────────────────────────────────────────
function trackMember(chatId, userId, username, firstName, role) {
  const group = groups.get(chatId);
  if (!group) return;
  group.members.set(userId, {
    userId,
    username: username || '',
    firstName: firstName || String(userId),
    role: role || 'member',   // 'owner' | 'admin' | 'member'
    joinedAt: new Date(),
  });
}

// ── مستخدم ──────────────────────────────────────────────────
function getOrCreateUser(userId, username, firstName) {
  if (!users.has(userId)) {
    users.set(userId, {
      userId,
      username: username || '',
      firstName: firstName || '',
      globalBanned: false,
      bannedReason: '',
      bannedAt: null,
      firstSeen: new Date(),
      groups: new Set(),
    });
  }
  return users.get(userId);
}

function getUser(userId) {
  return users.get(userId) || null;
}

function allUsers() {
  return [...users.values()];
}

// ── إحصائيات ─────────────────────────────────────────────────
function getStats() {
  const totalGroups  = groups.size;
  const totalUsers   = users.size;
  const bannedUsers  = [...users.values()].filter(u => u.globalBanned).length;
  const totalAdmins  = [...groups.values()].reduce((a, g) => a + g.admins.size, 0);
  const totalWarns   = [...groups.values()].reduce((a, g) => {
    return a + [...g.warns.values()].reduce((b, w) => b + w.length, 0);
  }, 0);
  const pendingReqs  = [...groups.values()].reduce((a, g) => {
    return a + [...g.joinRequests.values()].filter(r => r.status === 'pending').length;
  }, 0);
  return { totalGroups, totalUsers, bannedUsers, totalAdmins, totalWarns, pendingReqs };
}

module.exports = {
  getGroup, getOrCreateGroup, deleteGroup, allGroups,
  trackMember,
  getOrCreateUser, getUser, allUsers,
  getStats,
};
