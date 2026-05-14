import os
import logging
import aiosqlite
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, KeyboardButton
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    filters, CallbackQueryHandler, ContextTypes, ConversationHandler
)

BOT_TOKEN = os.getenv("BOT_TOKEN", "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y")
ADMIN_ID  = int(os.getenv("ADMIN_ID", "7411444902"))
BOT_NAME  = os.getenv("BOT_NAME", "متجر فولو زون")
DB_PATH   = "shop.db"

logging.basicConfig(format="%(asctime)s - %(levelname)s - %(message)s", level=logging.INFO)

# ========== DB ==========
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, balance REAL DEFAULT 0.0
            );
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, emoji TEXT DEFAULT '📦', active INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER,
                name TEXT, description TEXT, price REAL, active INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, service_id INTEGER,
                quantity INTEGER, total_price REAL, link TEXT, status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS recharge_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
                amount REAL, proof TEXT, status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS payment_methods (
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, details TEXT, active INTEGER DEFAULT 1
            );
        """)
        await db.commit()

async def one(sql, p=()):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, p) as c:
            r = await c.fetchone()
            return dict(r) if r else None

async def all_(sql, p=()):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, p) as c:
            return [dict(r) for r in await c.fetchall()]

async def exe(sql, p=()):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(sql, p)
        await db.commit()

# ========== KEYBOARDS ==========
def kb_user():
    return ReplyKeyboardMarkup([
        [KeyboardButton("🛍️ الخدمات"), KeyboardButton("📦 طلباتي")],
        [KeyboardButton("💰 شحن الرصيد"), KeyboardButton("👤 حسابي")],
    ], resize_keyboard=True)

def kb_admin():
    return ReplyKeyboardMarkup([
        [KeyboardButton("👥 المستخدمين"), KeyboardButton("📊 الإحصائيات")],
        [KeyboardButton("📁 الأقسام"), KeyboardButton("🛒 الخدمات")],
        [KeyboardButton("💵 طلبات الشحن"), KeyboardButton("📋 إدارة الطلبات")],
        [KeyboardButton("💳 طرق الدفع"), KeyboardButton("📢 إذاعة")],
        [KeyboardButton("🏠 القائمة الرئيسية")],
    ], resize_keyboard=True)

def kb_cancel():
    return ReplyKeyboardMarkup([[KeyboardButton("❌ إلغاء")]], resize_keyboard=True)

def is_admin(uid): return uid == ADMIN_ID

# ========== STATES ==========
WL, WQ, CO = 1, 2, 3
WA, WP = 10, 11
ACN, ACE = 20, 21
ASC, ASN, ASD, ASP = 22, 23, 24, 25
APN, APD = 26, 27
BC = 30

# ========== START ==========
async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    if not await one("SELECT 1 FROM users WHERE user_id=?", (u.id,)):
        await exe("INSERT INTO users (user_id,username,full_name) VALUES (?,?,?)", (u.id, u.username, u.full_name))
    row = await one("SELECT balance FROM users WHERE user_id=?", (u.id,))
    kb  = kb_admin() if is_admin(u.id) else kb_user()
    await update.message.reply_text(
        f"👋 أهلاً في *{BOT_NAME}*!\n💰 رصيدك: *{row['balance']:.2f} $*",
        reply_markup=kb, parse_mode="Markdown")

# ========== حسابي ==========
async def account(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u   = update.effective_user
    row = await one("SELECT balance FROM users WHERE user_id=?", (u.id,))
    cnt = await one("SELECT COUNT(*) c FROM orders WHERE user_id=?", (u.id,))
    await update.message.reply_text(
        f"👤 *حسابي*\n🆔 `{u.id}`\n👤 {u.full_name}\n💰 *{row['balance']:.2f} $*\n📦 طلبات: {cnt['c']}",
        parse_mode="Markdown")

# ========== الخدمات ==========
async def services(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cats = await all_("SELECT * FROM categories WHERE active=1")
    if not cats:
        await update.message.reply_text("❌ لا توجد خدمات."); return
    btns = [[InlineKeyboardButton(f"{c['emoji']} {c['name']}", callback_data=f"cat_{c['id']}")] for c in cats]
    await update.message.reply_text("🛍️ *اختر القسم:*", reply_markup=InlineKeyboardMarkup(btns), parse_mode="Markdown")

async def cb_cat(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    svcs = await all_("SELECT * FROM services WHERE category_id=? AND active=1", (int(q.data.split("_")[1]),))
    if not svcs:
        await q.edit_message_text("❌ لا توجد خدمات في هذا القسم."); return
    btns = [[InlineKeyboardButton(f"{s['name']} — ${s['price']:.2f}", callback_data=f"svc_{s['id']}")] for s in svcs]
    btns.append([InlineKeyboardButton("🔙 رجوع", callback_data="bcats")])
    await q.edit_message_text("📋 *اختر الخدمة:*", reply_markup=InlineKeyboardMarkup(btns), parse_mode="Markdown")

async def cb_svc(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    s = await one("SELECT * FROM services WHERE id=?", (int(q.data.split("_")[1]),))
    btns = [[InlineKeyboardButton("✅ طلب الخدمة", callback_data=f"order_{s['id']}")],
            [InlineKeyboardButton("🔙 رجوع", callback_data="bcats")]]
    await q.edit_message_text(
        f"📌 *{s['name']}*\n📝 {s['description'] or '-'}\n💰 *${s['price']:.2f}*",
        reply_markup=InlineKeyboardMarkup(btns), parse_mode="Markdown")

async def cb_bcats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    cats = await all_("SELECT * FROM categories WHERE active=1")
    btns = [[InlineKeyboardButton(f"{c['emoji']} {c['name']}", callback_data=f"cat_{c['id']}")] for c in cats]
    await q.edit_message_text("🛍️ *اختر القسم:*", reply_markup=InlineKeyboardMarkup(btns), parse_mode="Markdown")

# ========== ORDER ==========
async def cb_order(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    ctx.user_data['svc'] = await one("SELECT * FROM services WHERE id=?", (int(q.data.split("_")[1]),))
    await q.message.reply_text("🔗 أرسل الرابط أو المعرف:", reply_markup=kb_cancel())
    return WL

async def got_link(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("❌ إلغاء.", reply_markup=kb_user()); return ConversationHandler.END
    ctx.user_data['link'] = update.message.text
    await update.message.reply_text(f"🔢 الكمية؟ (السعر: ${ctx.user_data['svc']['price']:.2f}/وحدة)", reply_markup=kb_cancel())
    return WQ

async def got_qty(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("❌ إلغاء.", reply_markup=kb_user()); return ConversationHandler.END
    try:
        qty = int(update.message.text); assert qty > 0
    except Exception:
        await update.message.reply_text("❌ رقم صحيح فقط."); return WQ
    s = ctx.user_data['svc']; total = s['price'] * qty
    ctx.user_data.update({'qty': qty, 'total': total})
    row = await one("SELECT balance FROM users WHERE user_id=?", (update.effective_user.id,))
    if row['balance'] < total:
        await update.message.reply_text(f"❌ رصيدك غير كافٍ!\nالمطلوب: ${total:.2f} | رصيدك: ${row['balance']:.2f}", reply_markup=kb_user())
        return ConversationHandler.END
    btns = [[InlineKeyboardButton("✅ تأكيد", callback_data=f"cf_{s['id']}"),
             InlineKeyboardButton("❌ إلغاء", callback_data="cx")]]
    await update.message.reply_text(
        f"📋 *تأكيد:*\n🛍️ {s['name']}\n🔗 `{ctx.user_data['link']}`\n🔢 {qty}\n💰 *${total:.2f}*",
        reply_markup=InlineKeyboardMarkup(btns), parse_mode="Markdown")
    return CO

async def cb_confirm(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    if q.data == "cx":
        await q.message.reply_text("❌ إلغاء.", reply_markup=kb_user()); return ConversationHandler.END
    uid = q.from_user.id; s = ctx.user_data['svc']
    total = ctx.user_data['total']; qty = ctx.user_data['qty']; link = ctx.user_data['link']
    await exe("UPDATE users SET balance=balance-? WHERE user_id=?", (total, uid))
    await exe("INSERT INTO orders (user_id,service_id,quantity,total_price,link) VALUES (?,?,?,?,?)",
              (uid, s['id'], qty, total, link))
    row = await one("SELECT balance FROM users WHERE user_id=?", (uid,))
    await q.message.reply_text(f"✅ *تم الطلب!*\n💰 رصيدك المتبقي: ${row['balance']:.2f}", reply_markup=kb_user(), parse_mode="Markdown")
    try:
        await ctx.bot.send_message(ADMIN_ID,
            f"🆕 *طلب جديد!*\n👤 {q.from_user.full_name} (`{uid}`)\n🛍️ {s['name']}\n🔗 `{link}`\n🔢 {qty} | 💰 ${total:.2f}",
            parse_mode="Markdown")
    except Exception: pass
    return ConversationHandler.END

# ========== طلباتي ==========
async def my_orders(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    rows = await all_(
        "SELECT o.*,s.name sn FROM orders o JOIN services s ON o.service_id=s.id WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 10",
        (update.effective_user.id,))
    if not rows:
        await update.message.reply_text("📭 لا توجد طلبات."); return
    em = {"pending":"⏳","completed":"✅","rejected":"❌"}
    txt = "📦 *طلباتك:*\n\n" + "".join(f"{em.get(o['status'],'❓')} #{o['id']} {o['sn']} — ${o['total_price']:.2f}\n" for o in rows)
    await update.message.reply_text(txt, parse_mode="Markdown")

# ========== شحن الرصيد ==========
async def recharge(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ms = await all_("SELECT * FROM payment_methods WHERE active=1")
    if not ms:
        await update.message.reply_text("❌ لا توجد طرق دفع."); return ConversationHandler.END
    txt = "💳 *طرق الدفع:*\n\n" + "".join(f"• *{m['name']}*\n{m['details']}\n\n" for m in ms)
    await update.message.reply_text(txt + "💵 أدخل المبلغ:", reply_markup=kb_cancel(), parse_mode="Markdown")
    return WA

async def got_amt(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("❌ إلغاء.", reply_markup=kb_user()); return ConversationHandler.END
    try:
        amt = float(update.message.text); assert amt > 0
    except Exception:
        await update.message.reply_text("❌ رقم صحيح."); return WA
    ctx.user_data['amt'] = amt
    await update.message.reply_text(f"📸 أرسل إثبات الدفع للمبلغ *${amt:.2f}*:", reply_markup=kb_cancel(), parse_mode="Markdown")
    return WP

async def got_proof(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("❌ إلغاء.", reply_markup=kb_user()); return ConversationHandler.END
    uid = update.effective_user.id; amt = ctx.user_data['amt']
    proof = update.message.photo[-1].file_id if update.message.photo else update.message.text
    await exe("INSERT INTO recharge_requests (user_id,amount,proof) VALUES (?,?,?)", (uid, amt, proof))
    row = await one("SELECT id FROM recharge_requests WHERE user_id=? ORDER BY id DESC LIMIT 1", (uid,))
    await update.message.reply_text("✅ *تم إرسال طلب الشحن!*", reply_markup=kb_user(), parse_mode="Markdown")
    try:
        btns = [[InlineKeyboardButton("✅ قبول", callback_data=f"appr_{row['id']}_{uid}_{amt}"),
                 InlineKeyboardButton("❌ رفض",  callback_data=f"rejr_{row['id']}")]]
        await ctx.bot.send_message(ADMIN_ID,
            f"💰 *طلب شحن!*\n👤 {update.effective_user.full_name} (`{uid}`)\n💵 ${amt:.2f}",
            reply_markup=InlineKeyboardMarkup(btns), parse_mode="Markdown")
    except Exception: pass
    return ConversationHandler.END

# ========== ADMIN ==========
async def adm_stats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    tu = (await one("SELECT COUNT(*) c FROM users"))['c']
    to = (await one("SELECT COUNT(*) c FROM orders"))['c']
    po = (await one("SELECT COUNT(*) c FROM orders WHERE status='pending'"))['c']
    rv = (await one("SELECT COALESCE(SUM(total_price),0) s FROM orders WHERE status='completed'"))['s']
    await update.message.reply_text(f"📊 *إحصائيات:*\n👥 {tu} مستخدم\n📦 {to} طلب\n⏳ {po} معلق\n💰 ${rv:.2f} إيرادات", parse_mode="Markdown")

async def adm_users(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    users = await all_("SELECT * FROM users LIMIT 20")
    txt = f"👥 *المستخدمين ({len(users)}):*\n\n" + "".join(f"• {u['full_name']} (`{u['user_id']}`) ${u['balance']:.2f}\n" for u in users)
    await update.message.reply_text(txt, parse_mode="Markdown")

async def adm_cats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    cats = await all_("SELECT * FROM categories WHERE active=1")
    txt = "📁 *الأقسام:*\n\n" + "".join(f"[{c['id']}] {c['emoji']} {c['name']}\n" for c in cats) if cats else "لا توجد أقسام."
    await update.message.reply_text(txt + "\n\n/addcat إضافة | /delcat [id] حذف", parse_mode="Markdown")

async def adm_svcs(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    cats = await all_("SELECT * FROM categories WHERE active=1")
    txt = "🛒 *الخدمات:*\n\n"
    for c in cats:
        ss = await all_("SELECT * FROM services WHERE category_id=? AND active=1", (c['id'],))
        if ss:
            txt += f"{c['emoji']} *{c['name']}:*\n" + "".join(f"  [{s['id']}] {s['name']} ${s['price']}\n" for s in ss) + "\n"
    await update.message.reply_text(txt + "\n/addsvc إضافة | /delsvc [id] حذف", parse_mode="Markdown")

async def adm_recharges(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    rows = await all_("SELECT r.*,u.full_name fn FROM recharge_requests r JOIN users u ON r.user_id=u.user_id WHERE r.status='pending'")
    if not rows:
        await update.message.reply_text("✅ لا توجد طلبات شحن معلقة."); return
    for r in rows:
        btns = [[InlineKeyboardButton("✅ قبول", callback_data=f"appr_{r['id']}_{r['user_id']}_{r['amount']}"),
                 InlineKeyboardButton("❌ رفض",  callback_data=f"rejr_{r['id']}")]]
        await update.message.reply_text(
            f"💰 *طلب #{r['id']}*\n👤 {r['fn']} (`{r['user_id']}`)\n💵 ${r['amount']:.2f}",
            reply_markup=InlineKeyboardMarkup(btns), parse_mode="Markdown")

async def adm_orders(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    rows = await all_(
        "SELECT o.*,s.name sn,u.full_name un FROM orders o JOIN services s ON o.service_id=s.id JOIN users u ON o.user_id=u.user_id ORDER BY o.created_at DESC LIMIT 10")
    if not rows:
        await update.message.reply_text("📭 لا توجد طلبات."); return
    em = {"pending":"⏳","completed":"✅","rejected":"❌"}
    for o in rows:
        kb = None
        if o['status'] == 'pending':
            btns = [[InlineKeyboardButton("✅ إكمال", callback_data=f"done_{o['id']}_{o['user_id']}"),
                     InlineKeyboardButton("❌ رفض",   callback_data=f"rej_{o['id']}_{o['user_id']}")]]
            kb = InlineKeyboardMarkup(btns)
        await update.message.reply_text(
            f"{em.get(o['status'],'❓')} *طلب #{o['id']}*\n👤 {o['un']}\n🛍️ {o['sn']}\n🔗 `{o['link']}`\n🔢 {o['quantity']} | 💰 ${o['total_price']:.2f}",
            reply_markup=kb, parse_mode="Markdown")

async def adm_pm(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    ms = await all_("SELECT * FROM payment_methods WHERE active=1")
    txt = "💳 *طرق الدفع:*\n\n" + "".join(f"[{m['id']}] *{m['name']}*\n{m['details']}\n\n" for m in ms) if ms else "لا توجد طرق دفع."
    await update.message.reply_text(txt + "\n/addpm إضافة | /delpm [id] حذف", parse_mode="Markdown")

# ========== CALLBACKS ADMIN ==========
async def cb_appr(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not is_admin(q.from_user.id): await q.answer("❌"); return
    await q.answer()
    p = q.data.split("_"); rid, uid, amt = int(p[1]), int(p[2]), float(p[3])
    await exe("UPDATE recharge_requests SET status='approved' WHERE id=?", (rid,))
    await exe("UPDATE users SET balance=balance+? WHERE user_id=?", (amt, uid))
    await q.edit_message_text(f"✅ تم قبول الشحن #{rid} — ${amt:.2f}")
    try: await ctx.bot.send_message(uid, f"✅ *تم شحن رصيدك ${amt:.2f}*", parse_mode="Markdown")
    except Exception: pass

async def cb_rejr(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not is_admin(q.from_user.id): await q.answer("❌"); return
    await q.answer()
    rid = int(q.data.split("_")[1])
    await exe("UPDATE recharge_requests SET status='rejected' WHERE id=?", (rid,))
    await q.edit_message_text(f"❌ تم رفض طلب الشحن #{rid}")

async def cb_done(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not is_admin(q.from_user.id): await q.answer("❌"); return
    await q.answer()
    p = q.data.split("_"); oid, uid = int(p[1]), int(p[2])
    await exe("UPDATE orders SET status='completed' WHERE id=?", (oid,))
    await q.edit_message_text(f"✅ تم إكمال الطلب #{oid}")
    try: await ctx.bot.send_message(uid, f"✅ *تم إكمال طلبك #{oid}*", parse_mode="Markdown")
    except Exception: pass

async def cb_rej(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not is_admin(q.from_user.id): await q.answer("❌"); return
    await q.answer()
    p = q.data.split("_"); oid, uid = int(p[1]), int(p[2])
    await exe("UPDATE orders SET status='rejected' WHERE id=?", (oid,))
    await q.edit_message_text(f"❌ تم رفض الطلب #{oid}")
    try: await ctx.bot.send_message(uid, f"❌ *تم رفض طلبك #{oid}*", parse_mode="Markdown")
    except Exception: pass

# ========== ADD/DEL COMMANDS ==========
async def addcat_s(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("📝 اسم القسم:", reply_markup=kb_cancel()); return ACN

async def addcat_n(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("إلغاء.", reply_markup=kb_admin()); return ConversationHandler.END
    ctx.user_data['cn'] = update.message.text
    await update.message.reply_text("😊 إيموجي:"); return ACE

async def addcat_e(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await exe("INSERT INTO categories (name,emoji) VALUES (?,?)", (ctx.user_data['cn'], update.message.text))
    await update.message.reply_text("✅ تم إضافة القسم!", reply_markup=kb_admin()); return ConversationHandler.END

async def delcat(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    try:
        await exe("UPDATE categories SET active=0 WHERE id=?", (int(ctx.args[0]),))
        await update.message.reply_text("✅ تم حذف القسم.")
    except Exception: await update.message.reply_text("❌ /delcat [id]")

async def addsvc_s(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return ConversationHandler.END
    cats = await all_("SELECT * FROM categories WHERE active=1")
    if not cats: await update.message.reply_text("❌ أضف قسماً أولاً."); return ConversationHandler.END
    ctx.user_data['cats'] = cats
    await update.message.reply_text("📁 رقم القسم:\n" + "".join(f"{c['id']}. {c['emoji']} {c['name']}\n" for c in cats), reply_markup=kb_cancel())
    return ASC

async def addsvc_c(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("إلغاء.", reply_markup=kb_admin()); return ConversationHandler.END
    try: ctx.user_data['sc'] = int(update.message.text)
    except Exception: await update.message.reply_text("❌ رقم فقط."); return ASC
    await update.message.reply_text("📝 اسم الخدمة:"); return ASN

async def addsvc_n(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data['sn'] = update.message.text
    await update.message.reply_text("📄 الوصف (أو - للتخطي):"); return ASD

async def addsvc_d(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data['sd'] = "" if update.message.text == "-" else update.message.text
    await update.message.reply_text("💰 السعر:"); return ASP

async def addsvc_p(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    try: price = float(update.message.text)
    except Exception: await update.message.reply_text("❌ رقم فقط."); return ASP
    await exe("INSERT INTO services (category_id,name,description,price) VALUES (?,?,?,?)",
              (ctx.user_data['sc'], ctx.user_data['sn'], ctx.user_data['sd'], price))
    await update.message.reply_text(f"✅ تم إضافة *{ctx.user_data['sn']}* بسعر ${price:.2f}!", reply_markup=kb_admin(), parse_mode="Markdown")
    return ConversationHandler.END

async def delsvc(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    try:
        await exe("UPDATE services SET active=0 WHERE id=?", (int(ctx.args[0]),))
        await update.message.reply_text("✅ تم حذف الخدمة.")
    except Exception: await update.message.reply_text("❌ /delsvc [id]")

async def addpm_s(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("📝 اسم طريقة الدفع:", reply_markup=kb_cancel()); return APN

async def addpm_n(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("إلغاء.", reply_markup=kb_admin()); return ConversationHandler.END
    ctx.user_data['pn'] = update.message.text
    await update.message.reply_text("📄 التفاصيل:"); return APD

async def addpm_d(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await exe("INSERT INTO payment_methods (name,details) VALUES (?,?)", (ctx.user_data['pn'], update.message.text))
    await update.message.reply_text("✅ تم إضافة طريقة الدفع!", reply_markup=kb_admin()); return ConversationHandler.END

async def delpm(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    try:
        await exe("UPDATE payment_methods SET active=0 WHERE id=?", (int(ctx.args[0]),))
        await update.message.reply_text("✅ تم الحذف.")
    except Exception: await update.message.reply_text("❌ /delpm [id]")

async def broadcast_s(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("📢 أرسل الرسالة:", reply_markup=kb_cancel()); return BC

async def broadcast_send(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("إلغاء.", reply_markup=kb_admin()); return ConversationHandler.END
    users = await all_("SELECT user_id FROM users")
    ok = 0
    for u in users:
        try: await ctx.bot.send_message(u['user_id'], f"📢 {update.message.text}"); ok += 1
        except Exception: pass
    await update.message.reply_text(f"✅ أُرسلت لـ {ok}/{len(users)}", reply_markup=kb_admin()); return ConversationHandler.END

async def back_main(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await start(update, ctx)

# ========== MAIN ==========
async def post_init(app):
    await init_db()

def main():
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()

    app.add_handler(ConversationHandler(
        entry_points=[CallbackQueryHandler(cb_order, pattern="^order_")],
        states={WL:[MessageHandler(filters.TEXT & ~filters.COMMAND, got_link)],
                WQ:[MessageHandler(filters.TEXT & ~filters.COMMAND, got_qty)],
                CO:[CallbackQueryHandler(cb_confirm, pattern="^(cf_|cx)")]},
        fallbacks=[CommandHandler("start", start)], per_message=False))

    app.add_handler(ConversationHandler(
        entry_points=[MessageHandler(filters.Regex("^💰 شحن الرصيد$"), recharge)],
        states={WA:[MessageHandler(filters.TEXT & ~filters.COMMAND, got_amt)],
                WP:[MessageHandler(filters.TEXT | filters.PHOTO, got_proof)]},
        fallbacks=[CommandHandler("start", start)], per_message=False))

    app.add_handler(ConversationHandler(
        entry_points=[CommandHandler("addcat", addcat_s)],
        states={ACN:[MessageHandler(filters.TEXT & ~filters.COMMAND, addcat_n)],
                ACE:[MessageHandler(filters.TEXT & ~filters.COMMAND, addcat_e)]},
        fallbacks=[CommandHandler("start", start)]))

    app.add_handler(ConversationHandler(
        entry_points=[CommandHandler("addsvc", addsvc_s)],
        states={ASC:[MessageHandler(filters.TEXT & ~filters.COMMAND, addsvc_c)],
                ASN:[MessageHandler(filters.TEXT & ~filters.COMMAND, addsvc_n)],
                ASD:[MessageHandler(filters.TEXT & ~filters.COMMAND, addsvc_d)],
                ASP:[MessageHandler(filters.TEXT & ~filters.COMMAND, addsvc_p)]},
        fallbacks=[CommandHandler("start", start)]))

    app.add_handler(ConversationHandler(
        entry_points=[CommandHandler("addpm", addpm_s)],
        states={APN:[MessageHandler(filters.TEXT & ~filters.COMMAND, addpm_n)],
                APD:[MessageHandler(filters.TEXT & ~filters.COMMAND, addpm_d)]},
        fallbacks=[CommandHandler("start", start)]))

    app.add_handler(ConversationHandler(
        entry_points=[MessageHandler(filters.Regex("^📢 إذاعة$"), broadcast_s)],
        states={BC:[MessageHandler(filters.TEXT & ~filters.COMMAND, broadcast_send)]},
        fallbacks=[CommandHandler("start", start)]))

    app.add_handler(CommandHandler("start",  start))
    app.add_handler(CommandHandler("delcat", delcat))
    app.add_handler(CommandHandler("delsvc", delsvc))
    app.add_handler(CommandHandler("delpm",  delpm))

    app.add_handler(CallbackQueryHandler(cb_cat,  pattern="^cat_"))
    app.add_handler(CallbackQueryHandler(cb_svc,  pattern="^svc_"))
    app.add_handler(CallbackQueryHandler(cb_bcats, pattern="^bcats$"))
    app.add_handler(CallbackQueryHandler(cb_appr, pattern="^appr_"))
    app.add_handler(CallbackQueryHandler(cb_rejr, pattern=r"^rejr_\d+$"))
    app.add_handler(CallbackQueryHandler(cb_done, pattern="^done_"))
    app.add_handler(CallbackQueryHandler(cb_rej,  pattern="^rej_"))

    app.add_handler(MessageHandler(filters.Regex("^🛍️ الخدمات$"),        services))
    app.add_handler(MessageHandler(filters.Regex("^📦 طلباتي$"),          my_orders))
    app.add_handler(MessageHandler(filters.Regex("^👤 حسابي$"),           account))
    app.add_handler(MessageHandler(filters.Regex("^📊 الإحصائيات$"),      adm_stats))
    app.add_handler(MessageHandler(filters.Regex("^👥 المستخدمين$"),      adm_users))
    app.add_handler(MessageHandler(filters.Regex("^📁 الأقسام$"),         adm_cats))
    app.add_handler(MessageHandler(filters.Regex("^🛒 الخدمات$"),         adm_svcs))
    app.add_handler(MessageHandler(filters.Regex("^💵 طلبات الشحن$"),     adm_recharges))
    app.add_handler(MessageHandler(filters.Regex("^📋 إدارة الطلبات$"),   adm_orders))
    app.add_handler(MessageHandler(filters.Regex("^💳 طرق الدفع$"),       adm_pm))
    app.add_handler(MessageHandler(filters.Regex("^🏠 القائمة الرئيسية$"), back_main))

    print("✅ البوت شغال!")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
