// ════════════════════════════════════════════════════════════
//  تعديل index.js — أضف هذه الأسطر
// ════════════════════════════════════════════════════════════

// 1. في أعلى الملف، أضف هذين الاستيرادين:
const setupVerifyRegistration = require('./verify_registration');
const setupVerifyActions       = require('./verify_actions');

// 2. داخل دالة main()، بعد setupBioVerify(bot) مباشرة، أضف:
setupVerifyRegistration(bot);  // نظام التحقق الجامعي (join_request)
setupVerifyActions(bot);       // قبول/رفض/تفاصيل

// ────────────────────────────────────────────────────────────
// ملاحظة: تأكد أن ALLOWED_UPDATES يحتوي على:
//   'chat_join_request'
// وهو موجود بالفعل في ملفك الحالي ✅
// ════════════════════════════════════════════════════════════
