// ============================================================
//  قاعدة البيانات — Supabase أو ملف محلي دائم (data.json)
//  النسخة المحدّثة: كليات + سجل النشاط + جدولة + بادجات
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const DATA_FILE    = path.join(__dirname, 'data.json');

let sb          = null;
let useSupabase = false;

// ── In-memory store ──────────────────────────────────────────
const _groups    = new Map();
const _users     = new Map();
const _auditLog  = []; // سجل النشاط (آخر 500 عملية)
const _scheduled = new Map(); // id → { timer, data }

// ════════════════════════════════════════════════════════════
//  حفظ وتحميل الملف المحلي
// ════════════════════════════════════════════════════════════

let _saveTimer = null;

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(_saveToFile, 800);
}

function _saveToFile() {
  try {
    const data = { groups: {}, users: {} };

    for (const [chatId, g] of _groups) {
      data.groups[String(chatId)] = {
        chatId, title: g.title, type: g.type,
        ownerId: g.ownerId, ownerUsername: g.ownerUsername,
        addedBy: g.addedBy, addedByUsername: g.addedByUsername,
        addedAt: g.addedAt,
        locked: g.locked, protectContent: g.protectContent,
        welcomeMessage: g.welcomeMessage, welcomeEnabled: g.welcomeEnabled,
        antiSpam: g.antiSpam, muteNewMembers: g.muteNewMembers,
        joinRequestsEnabled: g.joinRequestsEnabled,
        rules: g.rules, maxWarns: g.maxWarns,
        bannedWordsAction: g.bannedWordsAction,
        bannedWords: g.bannedWords,
        // ── جديد ──
        college: g.college || '',
        allowedColleges: g.allowedColleges || [],
        collegeFilterEnabled: g.collegeFilterEnabled || false,
        auditLogChannelId: g.auditLogChannelId || null,
        examModeEnabled: g.examModeEnabled || false,
        examStart: g.examStart || null,
        examEnd: g.examEnd || null,
        linkFilterEnabled: g.linkFilterEnabled || false,
        allowedDomains: g.allowedDomains || [],
        antiDuplicateEnabled: g.antiDuplicateEnabled || false,
        // ────────
        members:      Object.fromEntries([...g.members.entries()].map(([k, v]) => [String(k), v])),
        admins:       Object.fromEntries([...g.admins.entries()].map(([k, v]) => [String(k), v])),
        warns:        Object.fromEntries([...g.warns.entries()].map(([k, v]) => [String(k), v])),
        mutedUsers:   [...g.mutedUsers],
        bannedUsers:  [...g.bannedUsers],
        joinRequests: Object.fromEntries([...g.joinRequests.entries()].map(([k, v]) => [String(k), v])),
      };
    }

    for (const [userId, u] of _users) {
      data.users[String(userId)] = {
        userId: u.userId, username: u.username, firstName: u.firstName,
        globalBanned: u.globalBanned, bannedReason: u.bannedReason,
        bannedAt: u.bannedAt, firstSeen: u.firstSeen,
        groups: [...u.groups],
        // ── جديد ──
        college: u.college || '',
        studentId: u.studentId || '',
        verified: u.verified || false,
        badge: u.badge || 'new',
        msgCount: u.msgCount || 0,
        lastSeen: u.lastSeen || null,
      };
    }

    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('❌ فشل حفظ data.json:', e.message);
  }
}

function _loadFromFile() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const raw  = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);

    for (const [chatId, g] of Object.entries(data.groups || {})) {
      const group = _newGroupObj(g.chatId, g.title, g.type, g.addedBy, g.addedByUsername);
      Object.assign(group, {
        ownerId:              g.ownerId || null,
        ownerUsername:        g.ownerUsername || '',
        addedAt:              g.addedAt ? new Date(g.addedAt) : new Date(),
        locked:               g.locked || false,
        protectContent:       g.protectContent || false,
        welcomeMessage:       g.welcomeMessage || group.welcomeMessage,
        welcomeEnabled:       g.welcomeEnabled !== false,
        antiSpam:             g.antiSpam || false,
        muteNewMembers:       g.muteNewMembers || false,
        joinRequestsEnabled:  g.joinRequestsEnabled || false,
        rules:                g.rules || '',
        maxWarns:             g.maxWarns || 3,
        bannedWordsAction:    g.bannedWordsAction || 'warn',
        bannedWords:          g.bannedWords || [],
        // ── جديد ──
        college:              g.college || '',
        allowedColleges:      g.allowedColleges || [],
        collegeFilterEnabled: g.collegeFilterEnabled || false,
        auditLogChannelId:    g.auditLogChannelId || null,
        examModeEnabled:      g.examModeEnabled || false,
        examStart:            g.examStart || null,
        examEnd:              g.examEnd || null,
        linkFilterEnabled:    g.linkFilterEnabled || false,
        allowedDomains:       g.allowedDomains || [],
        antiDuplicateEnabled: g.antiDuplicateEnabled || false,
      });
      for (const [uid, m] of Object.entries(g.members      || {})) group.members.set(Number(uid), m);
      for (const [uid, a] of Object.entries(g.admins       || {})) group.admins.set(Number(uid), a);
      for (const [uid, w] of Object.entries(g.warns        || {})) group.warns.set(Number(uid), Array.isArray(w) ? w : [w]);
      for (const uid       of (g.mutedUsers  || []))                group.mutedUsers.add(Number(uid));
      for (const uid       of (g.bannedUsers || []))                group.bannedUsers.add(Number(uid));
      for (const [uid, r]  of Object.entries(g.joinRequests || {})) group.joinRequests.set(Number(uid), r);
      _groups.set(Number(chatId), group);
    }

    for (const [userId, u] of Object.entries(data.users || {})) {
      _users.set(Number(userId), {
        userId:       u.userId,
        username:     u.username      || '',
        firstName:    u.firstName     || '',
        globalBanned: u.globalBanned  || false,
        bannedReason: u.bannedReason  || '',
        bannedAt:     u.bannedAt      || null,
        firstSeen:    u.firstSeen ? new Date(u.firstSeen) : new Date(),
        groups:       new Set((u.groups || []).map(Number)),
        // ── جديد ──
        college:      u.college   || '',
        studentId:    u.studentId || '',
        verified:     u.verified  || false,
        badge:        u.badge     || 'new',
        msgCount:     u.msgCount  || 0,
        lastSeen:     u.lastSeen  || null,
      });
    }

    console.log(`✅ تم تحميل البيانات: ${_groups.size} مجموعة/قناة، ${_users.size} مستخدم`);
  } catch (e) {
    console.error('❌ فشل تحميل data.json:', e.message);
  }
}

// ── تهيئة DB ─────────────────────────────────────────────────
async function initDB() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    _loadFromFile();
    console.log('💾 التخزين: ملف محلي دائم (data.json)');
    return;
  }
  try {
    sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    await createTablesIfNeeded();
    useSupabase = true;
    console.log('✅ Supabase متصل وجاهز!');
  } catch (e) {
    console.error('❌ Supabase خطأ:', e.message, '— تم التبديل للملف المحلي');
    _loadFromFile();
  }
}

async function createTablesIfNeeded() {
  const { error } = await sb.from('groups').select('chat_id').limit(1);
  if (!error) return;
  console.error('❌ الجداول غير موجودة في Supabase!');
  console.error('📌 شغّل ملف schema.sql في Supabase SQL Editor');
  throw new Error('DB_TABLES_MISSING');
}

// ════════════════════════════════════════════════════════════
//  دوال المجموعات
// ════════════════════════════════════════════════════════════

async function getOrCreateGroup(chatId, title, type, addedBy, addedByUsername) {
  if (useSupabase) {
    await sb.from('groups')
      .upsert({ chat_id: chatId, title, type, added_by: addedBy, added_by_username: addedByUsername },
        { onConflict: 'chat_id', ignoreDuplicates: true });
    const { data: grp } = await sb.from('groups').select('*').eq('chat_id', chatId).single();
    return grp ? _toGroup(grp) : null;
  }
  if (!_groups.has(chatId)) {
    _groups.set(chatId, _newGroupObj(chatId, title, type, addedBy, addedByUsername));
    scheduleSave();
  }
  return _groups.get(chatId);
}

async function getGroup(chatId) {
  if (useSupabase) {
    const { data } = await sb.from('groups').select('*').eq('chat_id', chatId).single();
    if (!data) return null;
    const [adminsRes, mutedRes, bannedRes, bwordsRes] = await Promise.all([
      sb.from('admins').select('*').eq('chat_id', chatId),
      sb.from('muted_users').select('user_id').eq('chat_id', chatId),
      sb.from('banned_users').select('user_id').eq('chat_id', chatId),
      sb.from('banned_words').select('*').eq('chat_id', chatId),
    ]);
    return _toGroup(data, adminsRes.data, mutedRes.data, bannedRes.data, bwordsRes.data);
  }
  return _groups.get(chatId) || null;
}

async function updateGroup(chatId, fields) {
  if (useSupabase) {
    const dbFields = _groupFieldsToDb(fields);
    if (Object.keys(dbFields).length)
      await sb.from('groups').update(dbFields).eq('chat_id', chatId);
    return;
  }
  const g = _groups.get(chatId);
  if (g) { Object.assign(g, fields); scheduleSave(); }
}

async function deleteGroup(chatId) {
  if (useSupabase) {
    await Promise.all([
      sb.from('groups').delete().eq('chat_id', chatId),
      sb.from('admins').delete().eq('chat_id', chatId),
      sb.from('members').delete().eq('chat_id', chatId),
      sb.from('warns').delete().eq('chat_id', chatId),
      sb.from('muted_users').delete().eq('chat_id', chatId),
      sb.from('banned_users').delete().eq('chat_id', chatId),
      sb.from('banned_words').delete().eq('chat_id', chatId),
      sb.from('join_requests').delete().eq('chat_id', chatId),
    ]);
    return;
  }
  _groups.delete(chatId);
  scheduleSave();
}

async function allGroups() {
  if (useSupabase) {
    const { data } = await sb.from('groups').select('*');
    return (data || []).map(r => _toGroup(r));
  }
  return [..._groups.values()];
}

// ════════════════════════════════════════════════════════════
//  الأعضاء
// ════════════════════════════════════════════════════════════

async function trackMember(chatId, userId, username, firstName, role) {
  if (useSupabase) {
    await sb.from('members').upsert(
      { chat_id: chatId, user_id: userId, username: username || '', first_name: firstName || '', role },
      { onConflict: 'chat_id,user_id' }
    );
    return;
  }
  const g = _groups.get(chatId);
  if (g) {
    g.members.set(userId, { userId, username: username || '', firstName: firstName || '', role, joinedAt: new Date() });
    scheduleSave();
  }
}

async function getMembers(chatId) {
  if (useSupabase) {
    const { data } = await sb.from('members').select('*').eq('chat_id', chatId);
    return (data || []).map(m => ({
      userId: m.user_id, username: m.username || '', firstName: m.first_name || '',
      role: m.role, joinedAt: m.joined_at,
    }));
  }
  const g = _groups.get(chatId);
  if (!g) return [];
  return [...g.members.values()];
}

// ════════════════════════════════════════════════════════════
//  المشرفون
// ════════════════════════════════════════════════════════════

async function addAdmin(chatId, userId, username, promotedBy, promotedByUsername) {
  if (useSupabase) {
    await sb.from('admins').upsert(
      { chat_id: chatId, user_id: userId, username: username || '',
        promoted_by: promotedBy || 0, promoted_by_username: promotedByUsername || '' },
      { onConflict: 'chat_id,user_id' }
    );
    return;
  }
  const g = _groups.get(chatId);
  if (g) {
    g.admins.set(userId, { username: username || '', promotedBy, promotedByUsername, promotedAt: new Date() });
    scheduleSave();
  }
}

async function removeAdmin(chatId, userId) {
  if (useSupabase) {
    await sb.from('admins').delete().eq('chat_id', chatId).eq('user_id', userId);
    return;
  }
  const g = _groups.get(chatId);
  if (g) { g.admins.delete(userId); scheduleSave(); }
}

async function getAdmins(chatId) {
  if (useSupabase) {
    const { data } = await sb.from('admins').select('*').eq('chat_id', chatId);
    return (data || []).map(a => ({
      userId: a.user_id, username: a.username || '',
      promotedBy: a.promoted_by, promotedByUsername: a.promoted_by_username || '',
      promotedAt: a.promoted_at,
    }));
  }
  const g = _groups.get(chatId);
  if (!g) return [];
  return [...g.admins.entries()].map(([uid, a]) => ({ userId: uid, ...a }));
}

// ════════════════════════════════════════════════════════════
//  التحذيرات
// ════════════════════════════════════════════════════════════

async function addWarn(chatId, userId, reason, warnedBy) {
  if (useSupabase) {
    await sb.from('warns').insert({ chat_id: chatId, user_id: userId, reason: reason || '', warned_by: warnedBy || 0 });
    return;
  }
  const g = _groups.get(chatId);
  if (g) {
    const w = g.warns.get(userId) || [];
    w.push({ reason: reason || '', warnedBy, warnedAt: new Date() });
    g.warns.set(userId, w);
    scheduleSave();
  }
}

async function getWarns(chatId, userId) {
  if (useSupabase) {
    const { data } = await sb.from('warns').select('*').eq('chat_id', chatId).eq('user_id', userId);
    return data || [];
  }
  const g = _groups.get(chatId);
  return g ? (g.warns.get(userId) || []) : [];
}

async function clearWarns(chatId, userId) {
  if (useSupabase) {
    await sb.from('warns').delete().eq('chat_id', chatId).eq('user_id', userId);
    return;
  }
  const g = _groups.get(chatId);
  if (g) { g.warns.delete(userId); scheduleSave(); }
}

async function getWarnCount(chatId, userId) {
  const w = await getWarns(chatId, userId);
  return w.length;
}

// ════════════════════════════════════════════════════════════
//  الكتم والحظر
// ════════════════════════════════════════════════════════════

async function muteUser(chatId, userId) {
  if (useSupabase) {
    await sb.from('muted_users').upsert({ chat_id: chatId, user_id: userId }, { onConflict: 'chat_id,user_id', ignoreDuplicates: true });
    return;
  }
  const g = _groups.get(chatId);
  if (g) { g.mutedUsers.add(userId); scheduleSave(); }
}

async function unmuteUser(chatId, userId) {
  if (useSupabase) {
    await sb.from('muted_users').delete().eq('chat_id', chatId).eq('user_id', userId);
    return;
  }
  const g = _groups.get(chatId);
  if (g) { g.mutedUsers.delete(userId); scheduleSave(); }
}

async function isMuted(chatId, userId) {
  if (useSupabase) {
    const { data } = await sb.from('muted_users').select('user_id').eq('chat_id', chatId).eq('user_id', userId).single();
    return !!data;
  }
  const g = _groups.get(chatId);
  return g ? g.mutedUsers.has(userId) : false;
}

async function banUser(chatId, userId) {
  if (useSupabase) {
    await sb.from('banned_users').upsert({ chat_id: chatId, user_id: userId }, { onConflict: 'chat_id,user_id', ignoreDuplicates: true });
    return;
  }
  const g = _groups.get(chatId);
  if (g) { g.bannedUsers.add(userId); scheduleSave(); }
}

async function unbanUser(chatId, userId) {
  if (useSupabase) {
    await sb.from('banned_users').delete().eq('chat_id', chatId).eq('user_id', userId);
    return;
  }
  const g = _groups.get(chatId);
  if (g) { g.bannedUsers.delete(userId); scheduleSave(); }
}

async function isBanned(chatId, userId) {
  if (useSupabase) {
    const { data } = await sb.from('banned_users').select('user_id').eq('chat_id', chatId).eq('user_id', userId).single();
    return !!data;
  }
  const g = _groups.get(chatId);
  return g ? g.bannedUsers.has(userId) : false;
}

// ════════════════════════════════════════════════════════════
//  الكلمات المحظورة
// ════════════════════════════════════════════════════════════

async function addBannedWord(chatId, word, action, addedBy) {
  if (useSupabase) {
    await sb.from('banned_words').upsert(
      { chat_id: chatId, word, action: action || 'warn', added_by: addedBy || 0 },
      { onConflict: 'chat_id,word' }
    );
    return;
  }
  const g = _groups.get(chatId);
  if (g) {
    const existing = g.bannedWords.findIndex(bw => bw.word === word);
    if (existing >= 0) g.bannedWords[existing] = { word, action: action || 'warn', addedBy, addedAt: new Date() };
    else g.bannedWords.push({ word, action: action || 'warn', addedBy, addedAt: new Date() });
    scheduleSave();
  }
}

async function removeBannedWord(chatId, word) {
  if (useSupabase) {
    await sb.from('banned_words').delete().eq('chat_id', chatId).eq('word', word);
    return;
  }
  const g = _groups.get(chatId);
  if (g) { g.bannedWords = g.bannedWords.filter(bw => bw.word !== word); scheduleSave(); }
}

async function getBannedWords(chatId) {
  if (useSupabase) {
    const { data } = await sb.from('banned_words').select('*').eq('chat_id', chatId);
    return (data || []).map(bw => ({ word: bw.word, action: bw.action, addedBy: bw.added_by, addedAt: bw.added_at }));
  }
  const g = _groups.get(chatId);
  return g ? g.bannedWords : [];
}

// ════════════════════════════════════════════════════════════
//  طلبات الانضمام
// ════════════════════════════════════════════════════════════

async function addJoinRequest(chatId, userId, username, firstName, college) {
  if (useSupabase) {
    await sb.from('join_requests').upsert(
      { chat_id: chatId, user_id: userId, username: username || '',
        first_name: firstName || '', status: 'pending' },
      { onConflict: 'chat_id,user_id' }
    );
    return;
  }
  const g = _groups.get(chatId);
  if (g) {
    g.joinRequests.set(userId, {
      userId, username: username || '', firstName: firstName || '',
      college: college || '', requestedAt: new Date(), status: 'pending',
    });
    scheduleSave();
  }
}

async function updateJoinRequest(chatId, userId, status) {
  if (useSupabase) {
    await sb.from('join_requests').update({ status }).eq('chat_id', chatId).eq('user_id', userId);
    return;
  }
  const g = _groups.get(chatId);
  if (g) {
    const r = g.joinRequests.get(userId);
    if (r) { r.status = status; scheduleSave(); }
  }
}

async function getPendingJoinRequests(chatId) {
  if (useSupabase) {
    const { data } = await sb.from('join_requests').select('*').eq('chat_id', chatId).eq('status', 'pending');
    return (data || []).map(r => ({
      userId: r.user_id, username: r.username || '',
      firstName: r.first_name || '', requestedAt: r.requested_at, status: r.status,
    }));
  }
  const g = _groups.get(chatId);
  if (!g) return [];
  return [...g.joinRequests.values()].filter(r => r.status === 'pending');
}

// ════════════════════════════════════════════════════════════
//  المستخدمون
// ════════════════════════════════════════════════════════════

async function getOrCreateUser(userId, username, firstName) {
  if (useSupabase) {
    await sb.from('users').upsert(
      { user_id: userId, username: username || '', first_name: firstName || '' },
      { onConflict: 'user_id', ignoreDuplicates: true }
    );
    const { data } = await sb.from('users').select('*').eq('user_id', userId).single();
    return data ? _toUser(data) : null;
  }
  if (!_users.has(userId)) {
    _users.set(userId, {
      userId, username: username || '', firstName: firstName || '',
      globalBanned: false, bannedReason: '', bannedAt: null,
      firstSeen: new Date(), groups: new Set(),
      college: '', studentId: '', verified: false,
      badge: 'new', msgCount: 0, lastSeen: null,
    });
    scheduleSave();
  } else {
    const u = _users.get(userId);
    if ((username && u.username !== username) || (firstName && u.firstName !== firstName)) {
      u.username  = username  || u.username;
      u.firstName = firstName || u.firstName;
      scheduleSave();
    }
  }
  return _users.get(userId);
}

async function getUser(userId) {
  if (useSupabase) {
    const { data } = await sb.from('users').select('*').eq('user_id', userId).single();
    return data ? _toUser(data) : null;
  }
  return _users.get(userId) || null;
}

async function updateUser(userId, fields) {
  if (useSupabase) {
    const dbFields = {};
    if (fields.globalBanned !== undefined) dbFields.global_banned = fields.globalBanned;
    if (fields.bannedReason !== undefined) dbFields.banned_reason = fields.bannedReason;
    if (fields.bannedAt     !== undefined) dbFields.banned_at     = fields.bannedAt;
    if (fields.college      !== undefined) dbFields.college       = fields.college;
    if (fields.studentId    !== undefined) dbFields.student_id    = fields.studentId;
    if (fields.verified     !== undefined) dbFields.verified      = fields.verified;
    if (fields.badge        !== undefined) dbFields.badge         = fields.badge;
    if (fields.msgCount     !== undefined) dbFields.msg_count     = fields.msgCount;
    if (fields.lastSeen     !== undefined) dbFields.last_seen     = fields.lastSeen;
    if (Object.keys(dbFields).length) await sb.from('users').update(dbFields).eq('user_id', userId);
    return;
  }
  const u = _users.get(userId);
  if (u) { Object.assign(u, fields); scheduleSave(); }
}

async function allUsers() {
  if (useSupabase) {
    const { data } = await sb.from('users').select('*');
    return (data || []).map(_toUser);
  }
  return [..._users.values()];
}

async function addUserToGroup(userId, chatId) {
  if (useSupabase) {
    await sb.from('user_groups').upsert({ user_id: userId, chat_id: chatId }, { onConflict: 'user_id,chat_id', ignoreDuplicates: true });
    return;
  }
  const u = _users.get(userId);
  if (u && !u.groups.has(chatId)) { u.groups.add(chatId); scheduleSave(); }
}

// ════════════════════════════════════════════════════════════
//  ▶ سجل النشاط (Audit Log) — محلي فقط (آخر 500)
// ════════════════════════════════════════════════════════════

function addAuditLog(entry) {
  _auditLog.unshift({ ...entry, at: new Date().toISOString() });
  if (_auditLog.length > 500) _auditLog.pop();
}

function getAuditLog(chatId, limit = 20) {
  return _auditLog.filter(e => e.chatId === chatId).slice(0, limit);
}

// ════════════════════════════════════════════════════════════
//  ▶ جدولة الإجراءات (Scheduled Actions)
// ════════════════════════════════════════════════════════════

let _scheduledId = 1;

function scheduleAction(delayMs, data, callback) {
  const id = _scheduledId++;
  const timer = setTimeout(() => {
    _scheduled.delete(id);
    callback(data);
  }, delayMs);
  _scheduled.set(id, { timer, data, scheduledAt: new Date(), executeAt: new Date(Date.now() + delayMs) });
  return id;
}

function cancelScheduled(id) {
  const s = _scheduled.get(id);
  if (s) { clearTimeout(s.timer); _scheduled.delete(id); return true; }
  return false;
}

function listScheduled(chatId) {
  const result = [];
  for (const [id, s] of _scheduled) {
    if (!chatId || s.data?.chatId === chatId) result.push({ id, ...s });
  }
  return result;
}

// ════════════════════════════════════════════════════════════
//  ▶ بادجات الأعضاء
// ════════════════════════════════════════════════════════════

const BADGE_THRESHOLDS = {
  active:  50,  // 50+ رسالة → نشط
  regular: 10,  // 10+ رسالة → عادي
  new:     0,   // أقل → جديد
};

async function incrementMsgCount(userId) {
  const u = _users.get(userId);
  if (!u) return;
  u.msgCount  = (u.msgCount || 0) + 1;
  u.lastSeen  = new Date().toISOString();
  // تحديث البادج تلقائياً
  if (u.msgCount >= BADGE_THRESHOLDS.active)  u.badge = 'active';
  else if (u.msgCount >= BADGE_THRESHOLDS.regular) u.badge = 'regular';
  else u.badge = 'new';
  scheduleSave();
}

function getBadgeEmoji(badge) {
  return { active: '🌟', regular: '👤', new: '🆕', warned: '⚠️', vip: '💎' }[badge] || '👤';
}

// ════════════════════════════════════════════════════════════
//  إحصائيات
// ════════════════════════════════════════════════════════════

async function getStats() {
  if (useSupabase) {
    const [g, u, bu, a, w, jr] = await Promise.all([
      sb.from('groups').select('*', { count: 'exact', head: true }),
      sb.from('users').select('*', { count: 'exact', head: true }),
      sb.from('users').select('*', { count: 'exact', head: true }).eq('global_banned', true),
      sb.from('admins').select('*', { count: 'exact', head: true }),
      sb.from('warns').select('*', { count: 'exact', head: true }),
      sb.from('join_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    return {
      totalGroups: g.count || 0, totalUsers: u.count || 0,
      bannedUsers: bu.count || 0, totalAdmins: a.count || 0,
      totalWarns: w.count || 0, pendingReqs: jr.count || 0,
    };
  }
  const groups = [..._groups.values()];
  const users  = [..._users.values()];
  return {
    totalGroups: groups.length,
    totalUsers:  users.length,
    bannedUsers: users.filter(u => u.globalBanned).length,
    totalAdmins: groups.reduce((a, g) => a + g.admins.size, 0),
    totalWarns:  groups.reduce((a, g) => a + [...g.warns.values()].reduce((b, w) => b + w.length, 0), 0),
    pendingReqs: groups.reduce((a, g) => a + [...g.joinRequests.values()].filter(r => r.status === 'pending').length, 0),
  };
}

// ════════════════════════════════════════════════════════════
//  تحويل بيانات Supabase
// ════════════════════════════════════════════════════════════

function _toGroup(row, adminsArr, mutedArr, bannedArr, bwordsArr) {
  const admins     = new Map();
  (adminsArr || []).forEach(a => admins.set(a.user_id, {
    username: a.username, promotedBy: a.promoted_by,
    promotedByUsername: a.promoted_by_username, promotedAt: a.promoted_at,
  }));
  const mutedUsers  = new Set((mutedArr  || []).map(m => m.user_id));
  const bannedUsers = new Set((bannedArr || []).map(b => b.user_id));
  const bannedWords = (bwordsArr || []).map(bw => ({
    word: bw.word, action: bw.action, addedBy: bw.added_by, addedAt: bw.added_at,
  }));
  return {
    chatId: row.chat_id, title: row.title, type: row.type,
    ownerId: row.owner_id, ownerUsername: row.owner_username || '',
    addedBy: row.added_by, addedByUsername: row.added_by_username || '',
    addedAt: row.added_at,
    locked: row.locked || false, protectContent: row.protect_content || false,
    welcomeMessage: row.welcome_message || '👋 مرحباً {name} في {group}!',
    welcomeEnabled: row.welcome_enabled !== false,
    antiSpam: row.anti_spam || false, muteNewMembers: row.mute_new_members || false,
    joinRequestsEnabled: row.join_requests_enabled || false,
    rules: row.rules || '', maxWarns: row.max_warns || 3,
    bannedWordsAction: row.banned_words_action || 'warn',
    // ── جديد ──
    college:              row.college              || '',
    allowedColleges:      row.allowed_colleges     || [],
    collegeFilterEnabled: row.college_filter_enabled || false,
    auditLogChannelId:    row.audit_log_channel_id  || null,
    examModeEnabled:      row.exam_mode_enabled     || false,
    examStart:            row.exam_start            || null,
    examEnd:              row.exam_end              || null,
    linkFilterEnabled:    row.link_filter_enabled   || false,
    allowedDomains:       row.allowed_domains       || [],
    antiDuplicateEnabled: row.anti_duplicate_enabled || false,
    // ────────
    members: new Map(), admins, warns: new Map(),
    mutedUsers, bannedUsers, bannedWords, joinRequests: new Map(),
  };
}

function _toUser(row) {
  return {
    userId: row.user_id, username: row.username || '',
    firstName: row.first_name || '',
    globalBanned: row.global_banned || false,
    bannedReason: row.banned_reason || '',
    bannedAt: row.banned_at, firstSeen: row.first_seen,
    groups: new Set(),
    // ── جديد ──
    college:   row.college    || '',
    studentId: row.student_id || '',
    verified:  row.verified   || false,
    badge:     row.badge      || 'new',
    msgCount:  row.msg_count  || 0,
    lastSeen:  row.last_seen  || null,
  };
}

function _groupFieldsToDb(fields) {
  const map = {
    title: 'title', ownerId: 'owner_id', ownerUsername: 'owner_username',
    locked: 'locked', protectContent: 'protect_content',
    welcomeMessage: 'welcome_message', welcomeEnabled: 'welcome_enabled',
    antiSpam: 'anti_spam', muteNewMembers: 'mute_new_members',
    joinRequestsEnabled: 'join_requests_enabled', rules: 'rules',
    maxWarns: 'max_warns', bannedWordsAction: 'banned_words_action',
    // ── جديد ──
    college:              'college',
    allowedColleges:      'allowed_colleges',
    collegeFilterEnabled: 'college_filter_enabled',
    auditLogChannelId:    'audit_log_channel_id',
    examModeEnabled:      'exam_mode_enabled',
    examStart:            'exam_start',
    examEnd:              'exam_end',
    linkFilterEnabled:    'link_filter_enabled',
    allowedDomains:       'allowed_domains',
    antiDuplicateEnabled: 'anti_duplicate_enabled',
  };
  const dbResult = {};
  for (const [jsKey, dbKey] of Object.entries(map)) {
    if (fields[jsKey] !== undefined) dbResult[dbKey] = fields[jsKey];
  }
  return dbResult;
}

function _newGroupObj(chatId, title, type, addedBy, addedByUsername) {
  return {
    chatId, title, type, ownerId: null, ownerUsername: '',
    addedBy, addedByUsername, addedAt: new Date(),
    locked: false, protectContent: false,
    welcomeMessage: '👋 مرحباً {name} في {group}!', welcomeEnabled: true,
    antiSpam: false, muteNewMembers: false,
    mutedUsers: new Set(), bannedUsers: new Set(),
    joinRequestsEnabled: false, rules: '', maxWarns: 3,
    bannedWordsAction: 'warn', bannedWords: [],
    members: new Map(), admins: new Map(), warns: new Map(), joinRequests: new Map(),
    // ── جديد ──
    college: '', allowedColleges: [], collegeFilterEnabled: false,
    auditLogChannelId: null,
    examModeEnabled: false, examStart: null, examEnd: null,
    linkFilterEnabled: false, allowedDomains: [],
    antiDuplicateEnabled: false,
  };
}

module.exports = {
  initDB, useSupabase: () => useSupabase,
  getOrCreateGroup, getGroup, updateGroup, deleteGroup, allGroups,
  trackMember, getMembers,
  addAdmin, removeAdmin, getAdmins,
  addWarn, getWarns, clearWarns, getWarnCount,
  muteUser, unmuteUser, isMuted,
  banUser, unbanUser, isBanned,
  addBannedWord, removeBannedWord, getBannedWords,
  addJoinRequest, updateJoinRequest, getPendingJoinRequests,
  getOrCreateUser, getUser, updateUser, allUsers, addUserToGroup,
  getStats,
  // ── جديد ──
  addAuditLog, getAuditLog,
  scheduleAction, cancelScheduled, listScheduled,
  incrementMsgCount, getBadgeEmoji,
};
