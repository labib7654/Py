/**
 * ═══════════════════════════════════════════════════════════════
 *  db_topics_patch.js — التعديلات المطلوبة على db.js
 *  هذا الملف يشرح ويحتوي على الأجزاء التي يجب تعديلها في db.js
 *  لدعم نظام إدارة المواضيع الجديد.
 * ═══════════════════════════════════════════════════════════════
 *
 *  الخطوات:
 *  1. في buildJSON()  — تحديث تسلسل المواضيع (topics serialization)
 *  2. في parseData()  — تحديث استرجاع المواضيع (topics deserialization)
 *  3. في getOrCreateGroup() — إضافة حقول جديدة للموضوع
 *
 *  انسخ كل قطعة واستبدلها في مكانها في db.js
 * ═══════════════════════════════════════════════════════════════
 */

// ════════════════════════════════════════════════════════════════
// [1] في buildJSON() — استبدل قسم topics بهذا الكود:
// ════════════════════════════════════════════════════════════════
/*
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
*/

// ════════════════════════════════════════════════════════════════
// [2] في parseData() — استبدل قسم topics بهذا الكود:
// ════════════════════════════════════════════════════════════════
/*
  // داخل حلقة for (const [k, v] of Object.entries(data.groups || {}))
  // بدل هذا السطر:
  //   const topicsMap = new Map();
  //   for (const [tid, tv] of Object.entries(v.topics || {})) {
  //     topicsMap.set(Number(tid), {
  //       ...tv,
  //       approvedUsers: new Set((tv.approvedUsers || []).map(Number)),
  //     });
  //   }
  // استبدله بهذا:

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
*/

// ════════════════════════════════════════════════════════════════
// [3] في index.js — أضف هذا السطر لتحميل الـ handler:
// ════════════════════════════════════════════════════════════════
/*
  // بعد سطر:
  //   require('./handler_groups')(bot);
  // أضف:
  require('./handler_topics')(bot);

  // ملاحظة مهمة: handler_topics يجب أن يُسجَّل قبل أي handler آخر
  // لأنه يحتوي على فلتر رسائل يجب أن يعمل أولاً
*/

// ════════════════════════════════════════════════════════════════
// [4] في handler_owner.js — احذف handler المواضيع القديم:
// ════════════════════════════════════════════════════════════════
/*
  احذف أو علّق (comment out) هذه الـ actions من handler_owner.js:
  - bot.action(/^topics_panel_(-?\d+)$/, ...)
  - bot.action(/^toggle_topicreq_(-?\d+)$/, ...)

  لأن handler_topics.js يوفر نسخة محسّنة منهم.
*/

// ════════════════════════════════════════════════════════════════
// [5] في handler_groups.js — تحديث فلتر رسائل المواضيع القديم:
// ════════════════════════════════════════════════════════════════
/*
  علّق أو احذف هذا الجزء من handler_groups.js (السطور 376-429):

  // ── فحص رسائل المواضيع المقفلة ───────────────────────────────────────
  bot.on('message', async (ctx, next) => { ... });

  // ── قبول/رفض طلب دخول موضوع ──────────────────────────────────────────
  bot.action(/^topic_allow_.../, ...);
  bot.action(/^topic_deny_.../, ...);

  لأن handler_topics.js يستبدل هذه الوظائف بنظام أكثر تفصيلاً.
*/

module.exports = {
  // قسم topics المحدّث لـ buildJSON
  serializeTopic: (tv) => ({
    ...tv,
    approvedUsers: tv.approvedUsers ? [...tv.approvedUsers] : [],
    joinRequests:  tv.joinRequests
      ? Object.fromEntries([...tv.joinRequests.entries()])
      : {},
    cooldowns: tv.cooldowns
      ? Object.fromEntries([...tv.cooldowns.entries()].map(([uk, uv]) => [uk, Number(uv)]))
      : {},
  }),

  // قسم topics المحدّث لـ parseData
  deserializeTopic: (tv) => ({
    ...tv,
    approvedUsers: new Set((tv.approvedUsers || []).map(Number)),
    joinRequests: new Map(
      Object.entries(tv.joinRequests || {}).map(([uk, uv]) => [Number(uk), uv])
    ),
    cooldowns: new Map(
      Object.entries(tv.cooldowns || {}).map(([uk, uv]) => [Number(uk), Number(uv)])
    ),
  }),
};
