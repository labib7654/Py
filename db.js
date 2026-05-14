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
      admins: new Map(),       // userId → { username, promotedBy, promotedByUsername, promotedAt }
      warns: new Map(),        // userId → [{ reason, warnedBy, warnedAt }]
      welcomeMessage: '👋 مرحباً {name} في {group}!\nنتمنى لك وقتاً ممتعاً.',
      welcomeEnabled: true,
      antiSpam: false,
      muteNewMembers: false,
      mutedUsers: new Set(),
      bannedUsers: new Set(),
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
  return { totalGroups, totalUsers, bannedUsers, totalAdmins, totalWarns };
}

module.exports = {
  getGroup, getOrCreateGroup, deleteGroup, allGroups,
  getOrCreateUser, getUser, allUsers,
  getStats,
};
