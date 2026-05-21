const fs   = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
//  إعدادات GitHub — تُقرأ من Environment Variables فقط
//  GITHUB_TOKEN  = توكن GitHub الشخصي
//  GITHUB_REPO   = اسم_المستخدم/اسم_المستودع  مثال: labib7/bot-data
//  GITHUB_FILE   = مسار الملف في المستودع     مثال: data.json
// ═══════════════════════════════════════════════════════════════
const GITHUB_TOKEN = process.env.GITHUB_TOKEN  || '';
const GITHUB_REPO  = process.env.GITHUB_REPO   || '';
const GITHUB_FILE  = process.env.GITHUB_FILE   || 'data.json';

const USE_GITHUB = !!(GITHUB_TOKEN && GITHUB_REPO);

// ملف مؤقت محلي (يُستخدم كـ cache بين عمليات الحفظ)
const DATA_FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, 'data.json');

// ─── GitHub API helpers ────────────────────────────────────────

async function githubGet() {
  if (!USE_GITHUB) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
    );
    if (res.status === 404) return null;
    if (!res.ok) { console.error('GitHub GET error:', res.status); return null; }
    const json = await res.json();
    return { content: Buffer.from(json.content, 'base64').toString('utf-8'), sha: json.sha };
  } catch (e) {
    console.error('githubGet error:', e.message);
    return null;
  }
}

async function githubPut(content, sha) {
  if (!USE_GITHUB) return null;
  try {
    const body = {
      message: `💾 حفظ تلقائي ${new Date().toISOString()}`,
      content: Buffer.from(content, 'utf-8').toString('base64'),
    };
    if (sha) body.sha = sha;
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const t = await res.text();
      // إذا كان SHA قديم — نجلب SHA الجديد ونعيد المحاولة مرة واحدة
      if (res.status === 409 || res.status === 422) {
        console.warn('⚠️ SHA قديم — جاري جلب SHA الحالي وإعادة المحاولة...');
        const fresh = await githubGet();
        if (fresh) {
          _ghSha = fresh.sha;
          return githubPut(content, fresh.sha); // إعادة محاولة واحدة
        }
      }
      console.error('GitHub PUT error:', res.status, t);
      return null;
    }
    const json = await res.json();
    // نأخذ SHA الجديد مباشرة من response بدون request إضافي
    return json.content?.sha || null;
  } catch (e) {
    console.error('githubPut error:', e.message);
    return null;
  }
}

// sha الأخير — نحتاجه عند كل تحديث
let _ghSha = null;

// ─── Maps & Sets ───────────────────────────────────────────────

const groups      = new Map();
const channels    = new Map();
const users       = new Map();
const communities = new Map();
const botAdmins   = new Set();

// ── بيانات الذكاء الاصطناعي ────────────────────────────────────
let aiCfg = {
  enabled:       true,
  replyPrivate:  true,
  replyGroups:   [],
  monitorGroups: [],
  minAnswerLen:  15,
};
const aiQA = new Map(); // hash => { hash, q, a, ... }

function getAiCfg() { return aiCfg; }
function setAiCfg(updates) { aiCfg = { ...aiCfg, ...updates }; saveData(); }
function allAiQA() { return [...aiQA.values()]; }
function setAiQA(hash, entry) { aiQA.set(hash, entry); }
function getAiQA(hash) { return aiQA.get(hash); }
function hasAiQA(hash) { return aiQA.has(hash); }
function clearAiQA() { aiQA.clear(); saveData(); }

// ═══════════════════════════════════════════════════════════════
//  Groups
// ═══════════════════════════════════════════════════════════════

function getGroup(chatId) { return groups.get(chatId) || null; }

function getOrCreateGroup(chatId, title, type, addedBy, addedByUsername) {
  if (!groups.has(chatId)) {
    groups.set(chatId, {
      chatId, title, type,
      ownerId: null, ownerUsername: '',
      ownerVerified: false, ownerVerifiedAt: null,
      addedBy, addedByUsername, addedAt: new Date(),
      members:      new Map(),
      admins:       new Map(),
      warns:        new Map(),
      maxWarns:     3,
      welcomeMessage: '👋 مرحباً {name} في {group}!\nنتمنى لك وقتاً ممتعاً.',
      welcomeEnabled:      true,
      antiSpam:            false,
      muteNewMembers:      false,
      mutedUsers:          new Set(),
      bannedUsers:         new Set(),
      bannedWords:         [],
      specialistWords:     [],   // [{ word, specialistId, specialistUsername, addedBy, addedAt }]
      wordViolations:      new Map(),
      joinRequests:        new Map(),
      joinRequestsEnabled: false,
      autoApproveJoin:     false,   // قبول تلقائي بعد 5 دقائق
      rules:               '',
      communityId:         null,
      protectContent:      false,
      antiLinks:           false,
      antiBot:             false,
      logChannelId:        null,
      timedMutes:          new Map(),
      timedBans:           new Map(),
      joinRequestCooldown: new Map(),
      topics:       new Map(),
      topicSettings: {
        requireApprovalToJoin: false,
        autoLockOnCreate:      false,
        ownerBypassAll:        true,
      },
      perms: {
        canSendMessages:   true,
        canSendMedia:      true,
        canSendPolls:      true,
        canAddWebPreviews: true,
        canInviteUsers:    true,
        canPinMessages:    false,
        canManageTopics:   false,
      },
      auditLog: [],
    });
  }
  return groups.get(chatId);
}

function deleteGroup(chatId) { groups.delete(chatId); }
function allGroups()         { return [...groups.values()]; }

// ═══════════════════════════════════════════════════════════════
//  Channels
// ═══════════════════════════════════════════════════════════════

function getChannel(chatId) { return channels.get(chatId) || null; }
function getOrCreateChannel(chatId, title, username, addedBy, addedByUsername) {
  if (!channels.has(chatId)) {
    channels.set(chatId, {
      chatId, title,
      username:         username || '',
      addedBy,
      addedByUsername,
      addedAt:          new Date(),
      subscribers:      new Map(),
      ownerId:          null,
      ownerUsername:    '',
      protectContent:   false,   // ✅ حماية المحتوى
    });
  }
  return channels.get(chatId);
}
function deleteChannel(chatId) { channels.delete(chatId); }
function allChannels()         { return [...channels.values()]; }

// ═══════════════════════════════════════════════════════════════
//  Members
// ═══════════════════════════════════════════════════════════════

function trackMember(chatId, userId, username, firstName, role) {
  const g = groups.get(chatId);
  if (!g) return;
  if (!g.members.has(userId)) {
    g.members.set(userId, {
      userId,
      username:      username  || '',
      firstName:     firstName || String(userId),
      role:          role      || 'member',
      joinedAt:      new Date(),
      messageCount:  0,
      score:         0,
      lastMessageAt: null,
    });
    markDirty();
  } else {
    const m = g.members.get(userId);
    let changed = false;
    if (role      && m.role      !== role)      { m.role      = role;      changed = true; }
    if (username  && m.username  !== username)  { m.username  = username;  changed = true; }
    if (firstName && m.firstName !== firstName) { m.firstName = firstName; changed = true; }
    if (changed) markDirty();
  }
}

// ═══════════════════════════════════════════════════════════════
//  Users
// ═══════════════════════════════════════════════════════════════

function getOrCreateUser(userId, username, firstName) {
  if (!users.has(userId)) {
    users.set(userId, {
      userId,
      username:     username  || '',
      firstName:    firstName || '',
      lastName:     '',
      profileLink:  username ? `https://t.me/${username}` : `tg://user?id=${userId}`,
      globalBanned: false,
      bannedReason: '',
      bannedAt:     null,
      firstSeen:    new Date(),
      lastSeen:     new Date(),
      groups:       new Set(),
      channels:     new Set(),
      seenInChats:  {},
      contactedBot: false,
      lastContactAt: null,
    });
  }
  return users.get(userId);
}
function getUser(userId) { return users.get(userId) || null; }
function allUsers()      { return [...users.values()]; }

function getUserGroups(userId) {
  return [...groups.values()]
    .filter(g => g.ownerId === userId || g.admins.has(userId))
    .map(g => g.chatId);
}

function getUserChannels(userId) {
  return [...channels.values()]
    .filter(c => c.ownerId === userId || c.addedBy === userId)
    .map(c => c.chatId);
}

// ═══════════════════════════════════════════════════════════════
//  Communities
// ═══════════════════════════════════════════════════════════════

function getOrCreateCommunity(communityId, title) {
  if (!communities.has(communityId)) {
    communities.set(communityId, {
      communityId, title,
      subGroups:        new Set(),
      memberJoins:      new Map(),
      maxGroupJoins:    1,
      enabled:          true,
      autoBannedUsers:  new Map(),
    });
  }
  return communities.get(communityId);
}
function getCommunity(communityId) { return communities.get(communityId) || null; }
function allCommunities()          { return [...communities.values()]; }

function recordCommunityJoin(communityId, userId, chatId) {
  const c = communities.get(communityId);
  if (!c || !c.enabled) return false;
  if (!c.memberJoins.has(userId)) c.memberJoins.set(userId, new Set());
  const joined = c.memberJoins.get(userId);
  joined.add(chatId);
  return joined.size > c.maxGroupJoins;
}

// ═══════════════════════════════════════════════════════════════
//  Bot Admins
// ═══════════════════════════════════════════════════════════════

function isBotAdmin(userId)  { return botAdmins.has(userId); }
function allBotAdmins()      { return [...botAdmins]; }

function addBotAdmin(userId) {
  if (userId && !isNaN(userId)) { botAdmins.add(userId); saveData(); }
}
function removeBotAdmin(userId) { botAdmins.delete(userId); saveData(); }
function clearBotAdmins()       { botAdmins.clear(); saveData(); }

// ═══════════════════════════════════════════════════════════════
//  Word violations & Audit log
// ═══════════════════════════════════════════════════════════════

function recordWordViolation(chatId, userId, word) {
  const g = groups.get(chatId); if (!g) return 0;
  if (!g.wordViolations.has(userId)) g.wordViolations.set(userId, {});
  const vio = g.wordViolations.get(userId);
  vio[word] = (vio[word] || 0) + 1;
  markDirty();
  return vio[word];
}
function resetWordViolation(chatId, userId, word) {
  const g = groups.get(chatId); if (!g) return;
  const vio = g.wordViolations.get(userId);
  if (vio) delete vio[word];
}

function addAuditLog(chatId, entry) {
  const g = groups.get(chatId); if (!g) return;
  g.auditLog.unshift({ ...entry, at: new Date() });
  if (g.auditLog.length > 100) g.auditLog.length = 100;
  markDirty();
  saveData(); // الإجراءات مهمة — نحفظ فوراً
}

// ═══════════════════════════════════════════════════════════════
//  Stats
// ═══════════════════════════════════════════════════════════════

function getStats() {
  return {
    totalGroups:   groups.size,
    totalChannels: channels.size,
    totalUsers:    users.size,
    bannedUsers:   [...users.values()].filter(u => u.globalBanned).length,
    totalAdmins:   [...groups.values()].reduce((a, g) => a + g.admins.size, 0),
    totalWarns:    [...groups.values()].reduce((a, g) => a + [...g.warns.values()].reduce((b, w) => b + w.length, 0), 0),
    pendingReqs:   [...groups.values()].reduce((a, g) => a + [...g.joinRequests.values()].filter(r => r.status === 'pending').length, 0),
  };
}

// ═══════════════════════════════════════════════════════════════
//  بناء JSON للحفظ (مشترك بين المحلي و GitHub)
// ═══════════════════════════════════════════════════════════════

function buildJSON() {
  return JSON.stringify({
    savedAt: new Date().toISOString(),
    botAdmins: [...botAdmins],
    groups: Object.fromEntries(
      [...groups.entries()].map(([k, v]) => [k, {
        ...v,
        members:             Object.fromEntries(v.members),
        admins:              Object.fromEntries(v.admins),
        warns:               Object.fromEntries([...v.warns.entries()]),
        mutedUsers:          [...v.mutedUsers],
        bannedUsers:         [...v.bannedUsers],
        timedMutes:          Object.fromEntries(v.timedMutes),
        timedBans:           Object.fromEntries(v.timedBans),
        joinRequests:        Object.fromEntries(v.joinRequests),
        joinRequestCooldown: Object.fromEntries(v.joinRequestCooldown),
        wordViolations:      Object.fromEntries(v.wordViolations),
        topics: Object.fromEntries(
          [...v.topics.entries()].map(([tid, tv]) => [tid, {
            ...tv,
            approvedUsers: tv.approvedUsers ? [...tv.approvedUsers] : [],
            joinRequests: tv.joinRequests
              ? Object.fromEntries([...tv.joinRequests.entries()])
              : {},
            cooldowns: tv.cooldowns
              ? Object.fromEntries([...tv.cooldowns.entries()].map(([uk, uv]) => [uk, Number(uv)]))
              : {},
          }])
        ),
        verifySystem: v.verifySystem ? {
          ...v.verifySystem,
          pendingRequests: Object.fromEntries(v.verifySystem.pendingRequests || new Map()),
          approvedMembers: Object.fromEntries(v.verifySystem.approvedMembers || new Map()),
          rejectedMembers: Object.fromEntries(v.verifySystem.rejectedMembers || new Map()),
          cooldowns:       Object.fromEntries(
            [...(v.verifySystem.cooldowns || new Map()).entries()]
              .map(([uk, uv]) => [uk, Number(uv)])
          ),
        } : undefined,
      }])
    ),
    channels: Object.fromEntries(
      [...channels.entries()].map(([k, v]) => [k, {
        ...v,
        subscribers: Object.fromEntries(v.subscribers),
      }])
    ),
    users: Object.fromEntries(
      [...users.entries()].map(([k, v]) => [k, {
        ...v,
        groups:      [...v.groups],
        channels:    [...v.channels],
        bioBanInfo:  v.bioBanInfo  || null,
        seenInChats: v.seenInChats || {},
        profileLink: v.profileLink || '',
        lastName:    v.lastName    || '',
        contactedBot:  v.contactedBot  || false,
        lastContactAt: v.lastContactAt || null,
      }])
    ),
    communities: Object.fromEntries(
      [...communities.entries()].map(([k, v]) => [k, {
        ...v,
        subGroups:       [...v.subGroups],
        memberJoins:     Object.fromEntries(
          [...v.memberJoins.entries()].map(([uk, uv]) => [uk, [...uv]])
        ),
        autoBannedUsers: Object.fromEntries(v.autoBannedUsers || new Map()),
      }])
    ),
    aiCfg: aiCfg,
    aiQA: [...aiQA.values()],
    verifySessions: Object.fromEntries(_verifySessions),
  }, null, 2);
}

// ═══════════════════════════════════════════════════════════════
//  Persistence — saveData / loadData
// ═══════════════════════════════════════════════════════════════

// نظام الحفظ الذكي — يحفظ فور حدوث تغيير
// لو جاءت تغييرات متتالية ينتظر ثانية واحدة ثم يحفظ مرة واحدة فقط

let _saving      = false;
let _pendingSave = false;
let _saveTimer   = null;

async function _doSave() {
  if (_saving) { _pendingSave = true; return; }
  _saving = true;
  try {
    const json = buildJSON();

    // ① حفظ محلي فوري دائماً (cache)
    try {
      fs.writeFileSync(DATA_FILE, json, 'utf-8');
    } catch (e) {
      console.warn('⚠️ حفظ محلي فشل:', e.message);
    }

    // ② رفع لـ GitHub مع إعادة محاولة عند فشل SHA
    if (USE_GITHUB) {
      const newSha = await githubPut(json, _ghSha);
      if (newSha) {
        _ghSha = newSha; // نحدّث SHA مباشرة من response — بدون request إضافي
        console.log(`☁️ تم الحفظ على GitHub (SHA: ${newSha.slice(0,8)}...)`);
      } else {
        console.warn('⚠️ فشل الحفظ على GitHub — البيانات محفوظة محلياً فقط');
      }
    }
  } catch (e) {
    console.error('❌ خطأ في _doSave:', e.message);
  } finally {
    _saving = false;
    if (_pendingSave) { _pendingSave = false; setTimeout(_doSave, 500); }
  }
}

// الدالة الرئيسية — تحفظ بعد ثانية من آخر تغيير
function saveData() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; _doSave(); }, 1000);
}

function parseData(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('❌ JSON تالف — لا يمكن تحليل البيانات:', e.message);
    return false;
  }

  try {
    // ── botAdmins ──────────────────────────────────────────────
    if (data.botAdmins && Array.isArray(data.botAdmins)) {
      botAdmins.clear();
      data.botAdmins.forEach(id => botAdmins.add(Number(id)));
    }

    // ── AI data ───────────────────────────────────────────────
    if (data.aiCfg && typeof data.aiCfg === 'object') {
      aiCfg = { ...aiCfg, ...data.aiCfg };
    }
    if (data.aiQA && Array.isArray(data.aiQA)) {
      aiQA.clear();
      data.aiQA.forEach(e => e?.hash && aiQA.set(e.hash, e));
      console.log(`🧠 AI: تم تحميل ${aiQA.size} سؤال`);
    }

    // ── verifySessions ────────────────────────────────────────
    if (data.verifySessions && typeof data.verifySessions === 'object') {
      _verifySessions.clear();
      for (const [k, v] of Object.entries(data.verifySessions)) {
        _verifySessions.set(Number(k), v);
      }
      console.log(`🔐 تم تحميل ${_verifySessions.size} جلسة تحقق`);
    }

    // ── groups ────────────────────────────────────────────────
    for (const [k, v] of Object.entries(data.groups || {})) {
      const topicsMap = new Map();
      for (const [tid, tv] of Object.entries(v.topics || {})) {
        topicsMap.set(Number(tid), {
          ...tv,
          approvedUsers: new Set((tv.approvedUsers || []).map(Number)),
          joinRequests: new Map(
            Object.entries(tv.joinRequests || {}).map(([uk, uv]) => [Number(uk), uv])
          ),
          cooldowns: new Map(
            Object.entries(tv.cooldowns || {}).map(([uk, uv]) => [Number(uk), Number(uv)])
          ),
        });
      }

      // نضمن bannedWords مصفوفة صالحة
      const bannedWords = Array.isArray(v.bannedWords) ? v.bannedWords : [];

      // نضمن specialistWords مصفوفة صالحة
      const specialistWords = Array.isArray(v.specialistWords) ? v.specialistWords : [];

      // نضمن auditLog مصفوفة صالحة (حد 100 سجل)
      const auditLog = Array.isArray(v.auditLog) ? v.auditLog.slice(0, 100) : [];

      groups.set(Number(k), {
        ...v,
        chatId:              Number(k),
        ownerVerified:       v.ownerVerified  || false,
        ownerVerifiedAt:     v.ownerVerifiedAt || null,
        bannedWords,
        specialistWords,
        auditLog,
        // Maps — نتحقق أن المدخل object صالح
        members: new Map(
          Object.entries(v.members || {}).map(([uk, uv]) => [Number(uk), {
            ...uv,
            userId:       Number(uk),
            messageCount: Number(uv.messageCount) || 0,
            score:        Number(uv.score)        || 0,
          }])
        ),
        admins:              new Map(Object.entries(v.admins  || {}).map(([uk, uv]) => [Number(uk), uv])),
        warns:               new Map(Object.entries(v.warns   || {}).map(([uk, uv]) => [Number(uk), Array.isArray(uv) ? uv : []])),
        mutedUsers:          new Set((v.mutedUsers  || []).map(Number)),
        bannedUsers:         new Set((v.bannedUsers || []).map(Number)),
        timedMutes:          new Map(Object.entries(v.timedMutes  || {}).map(([uk, uv]) => [Number(uk), Number(uv)])),
        timedBans:           new Map(Object.entries(v.timedBans   || {}).map(([uk, uv]) => [Number(uk), Number(uv)])),
        joinRequests:        new Map(Object.entries(v.joinRequests || {}).map(([uk, uv]) => [Number(uk), uv])),
        joinRequestCooldown: new Map(Object.entries(v.joinRequestCooldown || {}).map(([uk, uv]) => [Number(uk), Number(uv)])),
        wordViolations:      new Map(Object.entries(v.wordViolations || {}).map(([uk, uv]) => [Number(uk), uv || {}])),
        topics:              topicsMap,
        topicSettings: v.topicSettings || {
          requireApprovalToJoin: false,
          autoLockOnCreate:      false,
          ownerBypassAll:        true,
        },
        verifySystem: v.verifySystem ? {
          ...v.verifySystem,
          pendingRequests: new Map(
            Object.entries(v.verifySystem.pendingRequests || {}).map(([uk, uv]) => [Number(uk), uv])
          ),
          approvedMembers: new Map(
            Object.entries(v.verifySystem.approvedMembers || {}).map(([uk, uv]) => [Number(uk), uv])
          ),
          rejectedMembers: new Map(
            Object.entries(v.verifySystem.rejectedMembers || {}).map(([uk, uv]) => [Number(uk), uv])
          ),
          cooldowns: new Map(
            Object.entries(v.verifySystem.cooldowns || {}).map(([uk, uv]) => [Number(uk), Number(uv)])
          ),
        } : undefined,
        perms: v.perms || {
          canSendMessages:   true,
          canSendMedia:      true,
          canSendPolls:      true,
          canAddWebPreviews: true,
          canInviteUsers:    true,
          canPinMessages:    false,
          canManageTopics:   false,
        },
      });
    }

    // ── channels ──────────────────────────────────────────────
    for (const [k, v] of Object.entries(data.channels || {})) {
      channels.set(Number(k), {
        ...v,
        chatId:         Number(k),
        subscribers:    new Map(Object.entries(v.subscribers || {}).map(([uk, uv]) => [Number(uk), uv])),
        protectContent: v.protectContent || false, // ✅ استعادة حالة الحماية
      });
    }

    // ── users ─────────────────────────────────────────────────
    for (const [k, v] of Object.entries(data.users || {})) {
      users.set(Number(k), {
        ...v,
        userId:       Number(k),
        lastSeen:     v.lastSeen || v.firstSeen || new Date(),
        groups:       new Set((v.groups   || []).map(Number)),
        channels:     new Set((v.channels || []).map(Number)),
        bioBanInfo:   v.bioBanInfo   || null,
        seenInChats:  v.seenInChats  || {},
        profileLink:  v.profileLink  || (v.username ? `https://t.me/${v.username}` : `tg://user?id=${Number(k)}`),
        lastName:     v.lastName     || '',
        contactedBot:  v.contactedBot  || false,
        lastContactAt: v.lastContactAt || null,
      });
    }

    // ── communities ───────────────────────────────────────────
    for (const [k, v] of Object.entries(data.communities || {})) {
      communities.set(Number(k), {
        ...v,
        communityId:     Number(k),
        subGroups:       new Set((v.subGroups || []).map(Number)),
        memberJoins:     new Map(
          Object.entries(v.memberJoins || {}).map(([uk, uv]) => [Number(uk), new Set((uv || []).map(Number))])
        ),
        autoBannedUsers: new Map(
          Object.entries(v.autoBannedUsers || {}).map(([uk, uv]) => [Number(uk), uv])
        ),
      });
    }

    console.log(
      `✅ تم استعادة البيانات: ${groups.size} مجموعة، ` +
      `${channels.size} قناة، ${users.size} مستخدم، ` +
      `${communities.size} مجتمع، ${botAdmins.size} مشرف بوت`
    );
    return true;
  } catch (e) {
    console.error('❌ خطأ في parseData:', e.message, e.stack);
    return false;
  }
}

async function loadData() {
  let loaded = false;

  // ① GitHub أولاً (المصدر الأساسي للبيانات)
  if (USE_GITHUB) {
    console.log('☁️ جاري تحميل البيانات من GitHub...');
    try {
      const gh = await githubGet();
      if (gh && gh.content && gh.content.trim()) {
        _ghSha = gh.sha;
        const ok = parseData(gh.content);
        if (ok) {
          loaded = true;
          // احفظ نسخة محلية كـ cache للطوارئ
          try { fs.writeFileSync(DATA_FILE, gh.content, 'utf-8'); } catch {}
          console.log(`☁️ تم تحميل البيانات من GitHub (SHA: ${gh.sha.slice(0,8)}...)`);
        } else {
          console.error('❌ بيانات GitHub تالفة — جاري تجاهلها');
        }
      } else {
        console.warn('⚠️ لا يوجد ملف بيانات على GitHub بعد');
      }
    } catch (e) {
      console.error('❌ فشل الاتصال بـ GitHub:', e.message);
    }
  }

  // ② fallback: الملف المحلي (cache)
  if (!loaded && fs.existsSync(DATA_FILE)) {
    console.log('📁 جاري التحميل من الملف المحلي (cache)...');
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      if (raw && raw.trim()) {
        const ok = parseData(raw);
        if (ok) {
          loaded = true;
          console.log('📁 تم التحميل من الملف المحلي');
        } else {
          console.error('❌ الملف المحلي تالف');
        }
      }
    } catch (e) {
      console.error('❌ خطأ في قراءة الملف المحلي:', e.message);
    }
  }

  if (!loaded) {
    console.warn('⚠️ لا توجد بيانات سابقة — يبدأ البوت نظيفاً');
  }
}

// ─── تنظيف الكتم/الحظر المنتهي كل دقيقة ──────────────────────
setInterval(() => {
  const now = Date.now();
  for (const g of groups.values()) {
    for (const [uid, expiry] of g.timedBans.entries())
      if (expiry <= now) g.timedBans.delete(uid);
    for (const [uid, expiry] of g.timedMutes.entries()) {
      if (expiry <= now) { g.timedMutes.delete(uid); g.mutedUsers.delete(uid); }
    }
  }
}, 60 * 1000);

// ─── تهيئة: تحميل البيانات + حفظ ذكي مستمر ──────────────────
let _readyResolve;
const _readyPromise = new Promise(res => { _readyResolve = res; });

// ═══════════════════════════════════════════════════════════════
//  Verify Sessions — persistent wizard sessions
// ═══════════════════════════════════════════════════════════════
const _verifySessions = new Map(); // userId → session

function getVerifySession(userId) {
  return _verifySessions.get(Number(userId)) || null;
}

function setVerifySession(userId, session) {
  _verifySessions.set(Number(userId), session);
  markDirty();
}

function deleteVerifySession(userId) {
  _verifySessions.delete(Number(userId));
  markDirty();
}

// عداد التغييرات — يزداد عند أي تعديل على البيانات
let _changeCount = 0;
function markDirty() { _changeCount++; }

loadData().then(() => {
  _readyResolve();

  // ① حفظ احتياطي كل دقيقتين إذا كان فيه تغييرات
  setInterval(() => {
    if (_changeCount > 0) {
      _changeCount = 0;
      _doSave().catch(e => console.error('auto-save error:', e.message));
    }
  }, 2 * 60 * 1000);

  // ② حفظ إجباري كل 10 دقائق بغض النظر (ضمان)
  setInterval(() => {
    _doSave().catch(e => console.error('forced-save error:', e.message));
  }, 10 * 60 * 1000);
});

// index.js يستدعي هذه الدالة وينتظرها قبل تشغيل البوت
function waitReady() { return _readyPromise; }

// حفظ عند الإغلاق — ضروري جداً
async function _shutdownSave() {
  console.log('🔄 جاري الحفظ النهائي قبل الإغلاق...');
  await _doSave();
  console.log('✅ تم الحفظ النهائي');
}

process.on('SIGINT',  () => _shutdownSave().finally(() => process.exit(0)));
process.on('SIGTERM', () => _shutdownSave().finally(() => process.exit(0)));
process.on('exit',    () => {
  // حفظ محلي متزامن كـ last resort عند أي خروج
  try { fs.writeFileSync(DATA_FILE, buildJSON(), 'utf-8'); } catch {}
});

// ─── تحذير إن لم يُضبط GitHub ────────────────────────────────
if (!USE_GITHUB) {
  console.warn('⚠️  GITHUB_TOKEN أو GITHUB_REPO غير موجود — البيانات ستُحفظ محلياً فقط وتُحذف عند الـ restart!');
} else {
  console.log(`✅ GitHub Storage مفعّل → ${GITHUB_REPO}/${GITHUB_FILE}`);
}

module.exports = {
  getGroup, getOrCreateGroup, deleteGroup, allGroups,
  getChannel, getOrCreateChannel, deleteChannel, allChannels,
  trackMember,
  getOrCreateUser, getUser, allUsers, getUserGroups, getUserChannels,
  getOrCreateCommunity, getCommunity, allCommunities, recordCommunityJoin,
  recordWordViolation, resetWordViolation,
  addAuditLog,
  getStats,
  saveData, markDirty,
  getVerifySession, setVerifySession, deleteVerifySession,
  isBotAdmin, addBotAdmin, removeBotAdmin, allBotAdmins, clearBotAdmins,
  getAiCfg, setAiCfg, allAiQA, getAiQA, setAiQA, hasAiQA, clearAiQA,
  waitReady,
};
