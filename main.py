import os, asyncio, logging
import aiosqlite
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, KeyboardButton
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    filters, CallbackQueryHandler, ContextTypes,
    ConversationHandler
)

# ===================== CONFIG =====================
BOT_TOKEN = os.getenv("BOT_TOKEN", "7243808108:AAFxlT-1HQ6twyVewzWqgdEgXd0EK_j4o5Y")
ADMIN_ID  = int(os.getenv("ADMIN_ID", "7411444902"))
BOT_NAME  = os.getenv("BOT_NAME", "متجر فولو زون")
DB_PATH   = "shop.db"

logging.basicConfig(format="%(asctime)s - %(levelname)s - %(message)s", level=logging.INFO)

# ===================== DATABASE =====================
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY, username TEXT,
                full_name TEXT, balance REAL DEFAULT 0.0,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL, emoji TEXT DEFAULT '📦', active INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER, name TEXT NOT NULL,
                description TEXT, price REAL NOT NULL, active INTEGER DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER, service_id INTEGER,
                quantity INTEGER DEFAULT 1, total_price REAL,
                link TEXT, status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS recharge_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER, amount REAL, proof TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS payment_methods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL, details TEXT NOT NULL, active INTEGER DEFAULT 1
            );
        """)
        await db.commit()

async def db_exec(sql, params=()):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(sql, params)
        await db.commit()

async def fetchone(sql, params=()):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, params) as cur:
            r = await cur.fetchone()
            return dict(r) if r else None

async def fetchall(sql, params=()):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(sql, params) as cur:
            return [dict(r) for r in await cur.fetchall()]

# ===================== KEYBOARDS =====================
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

def kb_cats(cats):
    return InlineKeyboardMarkup(
        [[InlineKeyboardButton(f"{c['emoji']} {c['name']}", callback_data=f"cat_{c['id']}")] for c in cats])

def kb_svcs(svcs):
    btns = [[InlineKeyboardButton(f"{s['name']} — ${s['price']:.2f}", callback_data=f"svc_{s['id']}")] for s in svcs]
    btns.append([InlineKeyboardButton("🔙 رجوع", callback_data="back_cats")])
    return InlineKeyboardMarkup(btns)

def kb_svc_detail(svc_id):
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ طلب الخدمة", callback_data=f"order_{svc_id}")],
        [InlineKeyboardButton("🔙 رجوع", callback_data="back_cats")],
    ])

def kb_cancel():
    return ReplyKeyboardMarkup([[KeyboardButton("❌ إلغاء")]], resize_keyboard=True)

def kb_confirm(svc_id):
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ تأكيد", callback_data=f"confirm_{svc_id}"),
        InlineKeyboardButton("❌ إلغاء", callback_data="cancel_order"),
    ]])

def kb_recharge(req_id, user_id, amount):
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ قبول", callback_data=f"appr_{req_id}_{user_id}_{amount}"),
        InlineKeyboardButton("❌ رفض",  callback_data=f"rejr_{req_id}"),
    ]])

def kb_order_manage(order_id, user_id):
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ إكمال", callback_data=f"done_{order_id}_{user_id}"),
        InlineKeyboardButton("❌ رفض",   callback_data=f"rej_{order_id}_{user_id}"),
    ]])

# ===================== STATES =====================
WAIT_LINK, WAIT_QTY, CONFIRM_ORD   = range(3)
WAIT_AMT, WAIT_PROOF               = range(10, 12)
ADD_CAT_NAME, ADD_CAT_EMOJI        = range(20, 22)
ADD_SVC_CAT, ADD_SVC_NAME, ADD_SVC_DESC, ADD_SVC_PRICE = range(22, 26)
ADD_PM_NAME, ADD_PM_DETAIL         = range(26, 28)
BROADCAST                          = 30

def is_admin(uid): return uid == ADMIN_ID

# ===================== /start =====================
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u = update.effective_user
    exists = await fetchone("SELECT user_id FROM users WHERE user_id=?", (u.id,))
    if not exists:
        await db_exec("INSERT INTO users (user_id,username,full_name) VALUES (?,?,?)",
                      (u.id, u.username, u.full_name))
    row = await fetchone("SELECT balance FROM users WHERE user_id=?", (u.id,))
    bal = row['balance'] if row else 0
    kb  = kb_admin() if is_admin(u.id) else kb_user()
    await update.message.reply_text(
        f"👋 أهلاً بك في *{BOT_NAME}*!\n\n💰 رصيدك: *{bal:.2f} $*\n\nاختر من القائمة 👇",
        reply_markup=kb, parse_mode="Markdown")

# ===================== حسابي =====================
async def my_account(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    u   = update.effective_user
    row = await fetchone("SELECT balance FROM users WHERE user_id=?", (u.id,))
    cnt = await fetchone("SELECT COUNT(*) as c FROM orders WHERE user_id=?", (u.id,))
    await update.message.reply_text(
        f"👤 *حسابي*\n\n🆔 `{u.id}`\n👤 {u.full_name}\n"
        f"💰 الرصيد: *{row['balance']:.2f} $*\n📦 الطلبات: {cnt['c']}",
        parse_mode="Markdown")

# ===================== الخدمات =====================
async def services_menu(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cats = await fetchall("SELECT * FROM categories WHERE active=1")
    if not cats:
        await update.message.reply_text("❌ لا توجد خدمات حالياً."); return
    await update.message.reply_text("🛍️ *اختر القسم:*", reply_markup=kb_cats(cats), parse_mode="Markdown")

async def cb_cat(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    cat_id = int(q.data.split("_")[1])
    svcs   = await fetchall("SELECT * FROM services WHERE category_id=? AND active=1", (cat_id,))
    if not svcs:
        await q.edit_message_text("❌ لا توجد خدمات في هذا القسم."); return
    await q.edit_message_text("📋 *اختر الخدمة:*", reply_markup=kb_svcs(svcs), parse_mode="Markdown")

async def cb_svc(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    svc_id = int(q.data.split("_")[1])
    s      = await fetchone("SELECT * FROM services WHERE id=?", (svc_id,))
    ctx.user_data['sel_svc'] = s
    await q.edit_message_text(
        f"📌 *{s['name']}*\n\n📝 {s['description'] or 'لا يوجد وصف'}\n\n💰 السعر: *${s['price']:.2f}*",
        reply_markup=kb_svc_detail(svc_id), parse_mode="Markdown")

async def cb_back_cats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q    = update.callback_query; await q.answer()
    cats = await fetchall("SELECT * FROM categories WHERE active=1")
    await q.edit_message_text("🛍️ *اختر القسم:*", reply_markup=kb_cats(cats), parse_mode="Markdown")

# ===================== ORDER FLOW =====================
async def cb_order_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    svc_id = int(q.data.split("_")[1])
    s = await fetchone("SELECT * FROM services WHERE id=?", (svc_id,))
    ctx.user_data['order_svc'] = s
    await q.message.reply_text("🔗 *أرسل الرابط أو المعرف المطلوب:*",
                                reply_markup=kb_cancel(), parse_mode="Markdown")
    return WAIT_LINK

async def got_link(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("❌ تم الإلغاء.", reply_markup=kb_user())
        return ConversationHandler.END
    ctx.user_data['order_link'] = update.message.text
    s = ctx.user_data['order_svc']
    await update.message.reply_text(
        f"🔢 *كم الكمية؟*\n_(السعر: ${s['price']:.2f}/وحدة)_",
        reply_markup=kb_cancel(), parse_mode="Markdown")
    return WAIT_QTY

async def got_qty(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("❌ تم الإلغاء.", reply_markup=kb_user())
        return ConversationHandler.END
    try:
        qty = int(update.message.text)
        assert qty > 0
    except Exception:
        await update.message.reply_text("❌ أدخل رقماً صحيحاً.")
        return WAIT_QTY
    s     = ctx.user_data['order_svc']
    total = s['price'] * qty
    ctx.user_data.update({'order_qty': qty, 'order_total': total})
    u_row = await fetchone("SELECT balance FROM users WHERE user_id=?", (update.effective_user.id,))
    bal   = u_row['balance'] if u_row else 0
    txt   = (f"📋 *تأكيد الطلب:*\n\n🛍️ {s['name']}\n"
             f"🔗 `{ctx.user_data['order_link']}`\n🔢 الكمية: {qty}\n"
             f"💰 الإجمالي: *${total:.2f}*\n💳 رصيدك: *${bal:.2f}*\n\n")
    if bal < total:
        await update.message.reply_text(txt + "❌ رصيدك غير كافٍ!", reply_markup=kb_user(), parse_mode="Markdown")
        return ConversationHandler.END
    await update.message.reply_text(txt, reply_markup=kb_confirm(s['id']), parse_mode="Markdown")
    return CONFIRM_ORD

async def cb_confirm_order(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query; await q.answer()
    if q.data == "cancel_order":
        await q.message.reply_text("❌ تم الإلغاء.", reply_markup=kb_user())
        return ConversationHandler.END
    uid   = q.from_user.id
    s     = ctx.user_data['order_svc']
    total = ctx.user_data['order_total']
    qty   = ctx.user_data['order_qty']
    link  = ctx.user_data['order_link']
    await db_exec("UPDATE users SET balance=balance-? WHERE user_id=?", (total, uid))
    await db_exec("INSERT INTO orders (user_id,service_id,quantity,total_price,link) VALUES (?,?,?,?,?)",
                  (uid, s['id'], qty, total, link))
    u_row = await fetchone("SELECT balance FROM users WHERE user_id=?", (uid,))
    await q.message.reply_text(
        f"✅ *تم إرسال طلبك بنجاح!*\n\n💰 رصيدك المتبقي: ${u_row['balance']:.2f}",
        reply_markup=kb_user(), parse_mode="Markdown")
    try:
        await ctx.bot.send_message(ADMIN_ID,
            f"🆕 *طلب جديد!*\n👤 {q.from_user.full_name} (`{uid}`)\n"
            f"🛍️ {s['name']}\n🔗 `{link}`\n🔢 {qty}\n💰 ${total:.2f}", parse_mode="Markdown")
    except Exception:
        pass
    return ConversationHandler.END

# ===================== طلباتي =====================
async def my_orders(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    rows = await fetchall(
        "SELECT o.*,s.name as sname FROM orders o JOIN services s ON o.service_id=s.id "
        "WHERE o.user_id=? ORDER BY o.created_at DESC LIMIT 10",
        (update.effective_user.id,))
    if not rows:
        await update.message.reply_text("📭 لا توجد طلبات سابقة."); return
    em  = {"pending": "⏳", "completed": "✅", "rejected": "❌"}
    txt = "📦 *طلباتك الأخيرة:*\n\n"
    for o in rows:
        txt += f"{em.get(o['status'],'❓')} #{o['id']} {o['sname']} — ${o['total_price']:.2f}\n"
    await update.message.reply_text(txt, parse_mode="Markdown")

# ===================== شحن الرصيد =====================
async def recharge_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    methods = await fetchall("SELECT * FROM payment_methods WHERE active=1")
    if not methods:
        await update.message.reply_text("❌ لا توجد طرق دفع. تواصل مع الأدمن.")
        return ConversationHandler.END
    txt = "💳 *طرق الدفع المتاحة:*\n\n"
    for m in methods:
        txt += f"• *{m['name']}*\n{m['details']}\n\n"
    txt += "💵 *أدخل المبلغ المراد شحنه:*"
    await update.message.reply_text(txt, reply_markup=kb_cancel(), parse_mode="Markdown")
    return WAIT_AMT

async def got_amount(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("❌ إلغاء.", reply_markup=kb_user())
        return ConversationHandler.END
    try:
        amt = float(update.message.text)
        assert amt > 0
    except Exception:
        await update.message.reply_text("❌ أدخل رقماً صحيحاً.")
        return WAIT_AMT
    ctx.user_data['rech_amt'] = amt
    await update.message.reply_text(
        f"📸 أرسل صورة إثبات الدفع أو رقم العملية للمبلغ *${amt:.2f}*:",
        reply_markup=kb_cancel(), parse_mode="Markdown")
    return WAIT_PROOF

async def got_proof(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("❌ إلغاء.", reply_markup=kb_user())
        return ConversationHandler.END
    uid   = update.effective_user.id
    amt   = ctx.user_data['rech_amt']
    proof = update.message.photo[-1].file_id if update.message.photo else update.message.text
    await db_exec("INSERT INTO recharge_requests (user_id,amount,proof) VALUES (?,?,?)", (uid, amt, proof))
    row = await fetchone("SELECT id FROM recharge_requests WHERE user_id=? ORDER BY id DESC LIMIT 1", (uid,))
    await update.message.reply_text(
        "✅ *تم إرسال طلب الشحن!*\nسيتم مراجعته قريباً.",
        reply_markup=kb_user(), parse_mode="Markdown")
    try:
        await ctx.bot.send_message(ADMIN_ID,
            f"💰 *طلب شحن جديد!*\n👤 {update.effective_user.full_name} (`{uid}`)\n💵 ${amt:.2f}",
            reply_markup=kb_recharge(row['id'], uid, amt), parse_mode="Markdown")
    except Exception:
        pass
    return ConversationHandler.END

# ===================== ADMIN — إحصائيات =====================
async def adm_stats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    tu = (await fetchone("SELECT COUNT(*) as c FROM users"))['c']
    to = (await fetchone("SELECT COUNT(*) as c FROM orders"))['c']
    po = (await fetchone("SELECT COUNT(*) as c FROM orders WHERE status='pending'"))['c']
    rv = (await fetchone("SELECT COALESCE(SUM(total_price),0) as s FROM orders WHERE status='completed'"))['s']
    await update.message.reply_text(
        f"📊 *الإحصائيات:*\n\n👥 المستخدمين: {tu}\n📦 الطلبات: {to}\n⏳ معلقة: {po}\n💰 الإيرادات: ${rv:.2f}",
        parse_mode="Markdown")

async def adm_users(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    users = await fetchall("SELECT * FROM users LIMIT 20")
    txt   = f"👥 *المستخدمين ({len(users)}):*\n\n"
    for u in users:
        txt += f"• {u['full_name']} (`{u['user_id']}`) — ${u['balance']:.2f}\n"
    await update.message.reply_text(txt, parse_mode="Markdown")

# ===================== ADMIN — الأقسام =====================
async def adm_list_cats(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    cats = await fetchall("SELECT * FROM categories WHERE active=1")
    txt  = "📁 *الأقسام:*\n\n" + "".join(f"[{c['id']}] {c['emoji']} {c['name']}\n" for c in cats) if cats else "📁 لا توجد أقسام."
    await update.message.reply_text(txt + "\n\n/addcat إضافة | /delcat [id] حذف", parse_mode="Markdown")

async def adm_addcat_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("📝 أرسل اسم القسم:", reply_markup=kb_cancel())
    return ADD_CAT_NAME

async def adm_addcat_name(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("إلغاء.", reply_markup=kb_admin()); return ConversationHandler.END
    ctx.user_data['cat_name'] = update.message.text
    await update.message.reply_text("😊 أرسل إيموجي القسم (مثل: 📦):")
    return ADD_CAT_EMOJI

async def adm_addcat_emoji(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await db_exec("INSERT INTO categories (name,emoji) VALUES (?,?)",
                  (ctx.user_data['cat_name'], update.message.text))
    await update.message.reply_text("✅ تم إضافة القسم!", reply_markup=kb_admin())
    return ConversationHandler.END

async def adm_delcat(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    try:
        await db_exec("UPDATE categories SET active=0 WHERE id=?", (int(ctx.args[0]),))
        await update.message.reply_text("✅ تم حذف القسم.")
    except Exception:
        await update.message.reply_text("❌ استخدم: /delcat [id]")

# ===================== ADMIN — الخدمات =====================
async def adm_list_svcs(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    cats = await fetchall("SELECT * FROM categories WHERE active=1")
    txt  = "🛒 *الخدمات:*\n\n"
    for c in cats:
        svcs = await fetchall("SELECT * FROM services WHERE category_id=? AND active=1", (c['id'],))
        if svcs:
            txt += f"{c['emoji']} *{c['name']}:*\n"
            for s in svcs:
                txt += f"  [{s['id']}] {s['name']} — ${s['price']}\n"
            txt += "\n"
    await update.message.reply_text(txt + "\n/addsvc إضافة | /delsvc [id] حذف", parse_mode="Markdown")

async def adm_addsvc_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return ConversationHandler.END
    cats = await fetchall("SELECT * FROM categories WHERE active=1")
    if not cats:
        await update.message.reply_text("❌ أضف قسماً أولاً."); return ConversationHandler.END
    ctx.user_data['cats'] = cats
    txt = "📁 أرسل رقم القسم:\n\n" + "".join(f"{c['id']}. {c['emoji']} {c['name']}\n" for c in cats)
    await update.message.reply_text(txt, reply_markup=kb_cancel())
    return ADD_SVC_CAT

async def adm_addsvc_cat(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("إلغاء.", reply_markup=kb_admin()); return ConversationHandler.END
    try:
        ctx.user_data['svc_cat'] = int(update.message.text)
    except Exception:
        await update.message.reply_text("❌ أرسل الرقم فقط."); return ADD_SVC_CAT
    await update.message.reply_text("📝 اسم الخدمة:")
    return ADD_SVC_NAME

async def adm_addsvc_name(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data['svc_name'] = update.message.text
    await update.message.reply_text("📄 الوصف (أو أرسل - للتخطي):")
    return ADD_SVC_DESC

async def adm_addsvc_desc(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data['svc_desc'] = "" if update.message.text == "-" else update.message.text
    await update.message.reply_text("💰 السعر بالدولار:")
    return ADD_SVC_PRICE

async def adm_addsvc_price(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    try:
        price = float(update.message.text)
    except Exception:
        await update.message.reply_text("❌ أرسل رقماً."); return ADD_SVC_PRICE
    await db_exec("INSERT INTO services (category_id,name,description,price) VALUES (?,?,?,?)",
                  (ctx.user_data['svc_cat'], ctx.user_data['svc_name'], ctx.user_data['svc_desc'], price))
    await update.message.reply_text(
        f"✅ تم إضافة *{ctx.user_data['svc_name']}* بسعر ${price:.2f}!",
        reply_markup=kb_admin(), parse_mode="Markdown")
    return ConversationHandler.END

async def adm_delsvc(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    try:
        await db_exec("UPDATE services SET active=0 WHERE id=?", (int(ctx.args[0]),))
        await update.message.reply_text("✅ تم حذف الخدمة.")
    except Exception:
        await update.message.reply_text("❌ استخدم: /delsvc [id]")

# ===================== ADMIN — طرق الدفع =====================
async def adm_list_pm(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    methods = await fetchall("SELECT * FROM payment_methods WHERE active=1")
    txt = "💳 *طرق الدفع:*\n\n" + "".join(f"[{m['id']}] *{m['name']}*\n{m['details']}\n\n" for m in methods) if methods else "💳 لا توجد طرق دفع."
    await update.message.reply_text(txt + "\n/addpm إضافة | /delpm [id] حذف", parse_mode="Markdown")

async def adm_addpm_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("📝 اسم طريقة الدفع:", reply_markup=kb_cancel())
    return ADD_PM_NAME

async def adm_addpm_name(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("إلغاء.", reply_markup=kb_admin()); return ConversationHandler.END
    ctx.user_data['pm_name'] = update.message.text
    await update.message.reply_text("📄 التفاصيل (رقم حساب، اسم مستلم...):")
    return ADD_PM_DETAIL

async def adm_addpm_detail(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await db_exec("INSERT INTO payment_methods (name,details) VALUES (?,?)",
                  (ctx.user_data['pm_name'], update.message.text))
    await update.message.reply_text("✅ تم إضافة طريقة الدفع!", reply_markup=kb_admin())
    return ConversationHandler.END

async def adm_delpm(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    try:
        await db_exec("UPDATE payment_methods SET active=0 WHERE id=?", (int(ctx.args[0]),))
        await update.message.reply_text("✅ تم الحذف.")
    except Exception:
        await update.message.reply_text("❌ استخدم: /delpm [id]")

# ===================== ADMIN — طلبات الشحن =====================
async def adm_recharges(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    rows = await fetchall(
        "SELECT r.*,u.full_name FROM recharge_requests r "
        "JOIN users u ON r.user_id=u.user_id WHERE r.status='pending'")
    if not rows:
        await update.message.reply_text("✅ لا توجد طلبات معلقة."); return
    for r in rows:
        await update.message.reply_text(
            f"💰 *طلب #{r['id']}*\n👤 {r['full_name']} (`{r['user_id']}`)\n💵 ${r['amount']:.2f}\n📝 `{r['proof']}`",
            reply_markup=kb_recharge(r['id'], r['user_id'], r['amount']), parse_mode="Markdown")

async def cb_approve(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not is_admin(q.from_user.id): await q.answer("❌ غير مصرح."); return
    await q.answer()
    parts  = q.data.split("_")
    req_id = int(parts[1]); uid = int(parts[2]); amt = float(parts[3])
    await db_exec("UPDATE recharge_requests SET status='approved' WHERE id=?", (req_id,))
    await db_exec("UPDATE users SET balance=balance+? WHERE user_id=?", (amt, uid))
    await q.edit_message_text(f"✅ تم قبول الشحن #{req_id} — ${amt:.2f}")
    try:
        await ctx.bot.send_message(uid, f"✅ *تم شحن رصيدك!*\n💰 ${amt:.2f}", parse_mode="Markdown")
    except Exception:
        pass

async def cb_rejr(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not is_admin(q.from_user.id): await q.answer("❌ غير مصرح."); return
    await q.answer()
    req_id = int(q.data.split("_")[1])
    await db_exec("UPDATE recharge_requests SET status='rejected' WHERE id=?", (req_id,))
    await q.edit_message_text(f"❌ تم رفض طلب الشحن #{req_id}")

# ===================== ADMIN — إدارة الطلبات =====================
async def adm_orders(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return
    rows = await fetchall(
        "SELECT o.*,s.name as sname,u.full_name as uname FROM orders o "
        "JOIN services s ON o.service_id=s.id JOIN users u ON o.user_id=u.user_id "
        "ORDER BY o.created_at DESC LIMIT 10")
    if not rows:
        await update.message.reply_text("📭 لا توجد طلبات."); return
    em = {"pending": "⏳", "completed": "✅", "rejected": "❌"}
    for o in rows:
        txt = (f"{em.get(o['status'],'❓')} *طلب #{o['id']}*\n"
               f"👤 {o['uname']}\n🛍️ {o['sname']}\n"
               f"🔗 `{o['link']}`\n🔢 {o['quantity']} — 💰 ${o['total_price']:.2f}")
        kb  = kb_order_manage(o['id'], o['user_id']) if o['status'] == 'pending' else None
        await update.message.reply_text(txt, reply_markup=kb, parse_mode="Markdown")

async def cb_done_order(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not is_admin(q.from_user.id): await q.answer("❌"); return
    await q.answer()
    parts = q.data.split("_"); oid = int(parts[1]); uid = int(parts[2])
    await db_exec("UPDATE orders SET status='completed' WHERE id=?", (oid,))
    await q.edit_message_text(f"✅ تم إكمال الطلب #{oid}")
    try:
        await ctx.bot.send_message(uid, f"✅ *تم إكمال طلبك #{oid}!*", parse_mode="Markdown")
    except Exception:
        pass

async def cb_rej_order(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not is_admin(q.from_user.id): await q.answer("❌"); return
    await q.answer()
    parts = q.data.split("_"); oid = int(parts[1]); uid = int(parts[2])
    await db_exec("UPDATE orders SET status='rejected' WHERE id=?", (oid,))
    await q.edit_message_text(f"❌ تم رفض الطلب #{oid}")
    try:
        await ctx.bot.send_message(uid, f"❌ *تم رفض طلبك #{oid}.*", parse_mode="Markdown")
    except Exception:
        pass

# ===================== ADMIN — إذاعة =====================
async def adm_broadcast_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("📢 أرسل الرسالة التي تريد إذاعتها:", reply_markup=kb_cancel())
    return BROADCAST

async def adm_broadcast_send(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if update.message.text == "❌ إلغاء":
        await update.message.reply_text("إلغاء.", reply_markup=kb_admin())
        return ConversationHandler.END
    users = await fetchall("SELECT user_id FROM users")
    ok = 0
    for u in users:
        try:
            await ctx.bot.send_message(u['user_id'], f"📢 *إذاعة:*\n\n{update.message.text}", parse_mode="Markdown")
            ok += 1
        except Exception:
            pass
    await update.message.reply_text(f"✅ أُرسلت لـ {ok}/{len(users)} مستخدم.", reply_markup=kb_admin())
    return ConversationHandler.END

async def adm_back_main(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await cmd_start(update, ctx)

# ===================== MAIN =====================
def main():
    asyncio.get_event_loop().run_until_complete(init_db())
    app = Application.builder().token(BOT_TOKEN).build()

    # Conversations
    app.add_handler(ConversationHandler(
        entry_points=[CallbackQueryHandler(cb_order_start, pattern="^order_")],
        states={
            WAIT_LINK:    [MessageHandler(filters.TEXT & ~filters.COMMAND, got_link)],
            WAIT_QTY:     [MessageHandler(filters.TEXT & ~filters.COMMAND, got_qty)],
            CONFIRM_ORD:  [CallbackQueryHandler(cb_confirm_order, pattern="^(confirm_|cancel_order)")],
        },
        fallbacks=[CommandHandler("start", cmd_start)], per_message=False))

    app.add_handler(ConversationHandler(
        entry_points=[MessageHandler(filters.Regex("^💰 شحن الرصيد$"), recharge_start)],
        states={
            WAIT_AMT:   [MessageHandler(filters.TEXT & ~filters.COMMAND, got_amount)],
            WAIT_PROOF: [MessageHandler(filters.TEXT | filters.PHOTO, got_proof)],
        },
        fallbacks=[CommandHandler("start", cmd_start)], per_message=False))

    app.add_handler(ConversationHandler(
        entry_points=[CommandHandler("addcat", adm_addcat_start)],
        states={
            ADD_CAT_NAME:  [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_addcat_name)],
            ADD_CAT_EMOJI: [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_addcat_emoji)],
        },
        fallbacks=[CommandHandler("start", cmd_start)]))

    app.add_handler(ConversationHandler(
        entry_points=[CommandHandler("addsvc", adm_addsvc_start)],
        states={
            ADD_SVC_CAT:   [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_addsvc_cat)],
            ADD_SVC_NAME:  [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_addsvc_name)],
            ADD_SVC_DESC:  [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_addsvc_desc)],
            ADD_SVC_PRICE: [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_addsvc_price)],
        },
        fallbacks=[CommandHandler("start", cmd_start)]))

    app.add_handler(ConversationHandler(
        entry_points=[CommandHandler("addpm", adm_addpm_start)],
        states={
            ADD_PM_NAME:   [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_addpm_name)],
            ADD_PM_DETAIL: [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_addpm_detail)],
        },
        fallbacks=[CommandHandler("start", cmd_start)]))

    app.add_handler(ConversationHandler(
        entry_points=[MessageHandler(filters.Regex("^📢 إذاعة$"), adm_broadcast_start)],
        states={
            BROADCAST: [MessageHandler(filters.TEXT & ~filters.COMMAND, adm_broadcast_send)],
        },
        fallbacks=[CommandHandler("start", cmd_start)]))

    # Commands
    app.add_handler(CommandHandler("start",  cmd_start))
    app.add_handler(CommandHandler("delcat", adm_delcat))
    app.add_handler(CommandHandler("delsvc", adm_delsvc))
    app.add_handler(CommandHandler("delpm",  adm_delpm))

    # Callbacks
    app.add_handler(CallbackQueryHandler(cb_cat,        pattern="^cat_"))
    app.add_handler(CallbackQueryHandler(cb_svc,        pattern="^svc_"))
    app.add_handler(CallbackQueryHandler(cb_back_cats,  pattern="^back_cats$"))
    app.add_handler(CallbackQueryHandler(cb_approve,    pattern="^appr_"))
    app.add_handler(CallbackQueryHandler(cb_rejr,       pattern=r"^rejr_\d+$"))
    app.add_handler(CallbackQueryHandler(cb_done_order, pattern="^done_"))
    app.add_handler(CallbackQueryHandler(cb_rej_order,  pattern="^rej_"))

    # Messages
    app.add_handler(MessageHandler(filters.Regex("^🛍️ الخدمات$"),        services_menu))
    app.add_handler(MessageHandler(filters.Regex("^📦 طلباتي$"),          my_orders))
    app.add_handler(MessageHandler(filters.Regex("^👤 حسابي$"),           my_account))
    app.add_handler(MessageHandler(filters.Regex("^📊 الإحصائيات$"),      adm_stats))
    app.add_handler(MessageHandler(filters.Regex("^👥 المستخدمين$"),      adm_users))
    app.add_handler(MessageHandler(filters.Regex("^📁 الأقسام$"),         adm_list_cats))
    app.add_handler(MessageHandler(filters.Regex("^🛒 الخدمات$"),         adm_list_svcs))
    app.add_handler(MessageHandler(filters.Regex("^💵 طلبات الشحن$"),     adm_recharges))
    app.add_handler(MessageHandler(filters.Regex("^📋 إدارة الطلبات$"),   adm_orders))
    app.add_handler(MessageHandler(filters.Regex("^💳 طرق الدفع$"),       adm_list_pm))
    app.add_handler(MessageHandler(filters.Regex("^🏠 القائمة الرئيسية$"), adm_back_main))

    print("✅ البوت يعمل...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
