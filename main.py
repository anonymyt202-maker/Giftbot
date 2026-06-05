import asyncio, logging, sys, os, json, aiosqlite, httpx
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()

from aiogram import Bot, Dispatcher, Router, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, StateFilter, Filter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton,
    ReplyKeyboardMarkup, KeyboardButton, CopyTextButton,
)

BOT_TOKEN        = os.environ.get("BOT_TOKEN", "8902679441:AAHT0r-V34Vkiq7AVHnfFzIXPneccHOOV5E")
ADMIN_ID         = int(os.environ.get("ADMIN_ID", "8512512542"))
HYPERPIN_API_URL = os.environ.get("HYPERPIN_API_URL", "https://hyperpin.top/api/v1")
HYPERPIN_API_KEY = os.environ.get("HYPERPIN_API_KEY", "")
SHOP_ID          = int(os.environ.get("SHOP_ID", "24"))
SHOP_KEY         = os.environ.get("SHOP_KEY", "sk_f37c8fa4298ab6ec43e91c20d2400a80")
SHOP_API         = os.environ.get("SHOP_API", "https://694bccc3c315b.myxvest1.ru/super/api.php")
DB_PATH          = os.environ.get("DB_PATH", "bot_data.db")

DEFAULT_STARS_PACKAGES = [
    {"stars": 50,   "price": 15000},
    {"stars": 100,  "price": 28000},
    {"stars": 250,  "price": 65000},
    {"stars": 500,  "price": 125000},
    {"stars": 1000, "price": 240000},
    {"stars": 2500, "price": 580000},
]

DEFAULT_PREMIUM_PACKAGES = [
    {"months": 1,  "label": "1 oy",  "price": 85000},
    {"months": 3,  "label": "3 oy",  "price": 240000},
    {"months": 6,  "label": "6 oy",  "price": 450000},
    {"months": 12, "label": "12 oy", "price": 850000},
]

DEFAULT_GIFT_PACKAGES = [
    {"gift_id": "gift_select:1:15",   "name": "🧸 Teddy Bear",  "stars_cost": 15,  "price": 3000},
    {"gift_id": "gift_select:0:15",   "name": "💖 Heart",       "stars_cost": 15,  "price": 3000},
    {"gift_id": "gift_select:0:25",   "name": "🎁 Gift Box",    "stars_cost": 25,  "price": 5000},
    {"gift_id": "gift_select:1:25",   "name": "🌹 Rose",        "stars_cost": 25,  "price": 5000},
    {"gift_id": "gift_select:0:50",   "name": "🎂 Cake",        "stars_cost": 50,  "price": 10000},
    {"gift_id": "gift_select:1:50",   "name": "💐 Flowers",     "stars_cost": 50,  "price": 10000},
    {"gift_id": "gift_select:2:50",   "name": "🚀 Rocket",      "stars_cost": 50,  "price": 10000},
    {"gift_id": "gift_select:3:50",   "name": "🍾 Champagne",   "stars_cost": 50,  "price": 10000},
    {"gift_id": "gift_select:0:100",  "name": "🏆 Trophy",      "stars_cost": 100, "price": 20000},
    {"gift_id": "gift_select:1:100",  "name": "💍 Ring",        "stars_cost": 100, "price": 20000},
    {"gift_id": "gift_select:2:100",  "name": "💎 Diamond",     "stars_cost": 100, "price": 20000},
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


# ─── Filters ──────────────────────────────────────────────────
class IsAdmin(Filter):
    async def __call__(self, msg: Message) -> bool:
        return msg.from_user.id == ADMIN_ID

admin_only = IsAdmin()


# ─── Database ─────────────────────────────────────────────────
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        for sql in [
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
            "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, order_id INTEGER, type TEXT, amount INTEGER, price REAL, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
            "CREATE TABLE IF NOT EXISTS forced_channels (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT, channel_title TEXT, channel_link TEXT)",
            "CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, username TEXT, full_name TEXT, balance INTEGER DEFAULT 0, joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
        ]:
            await db.execute(sql)
        await db.commit()

    defaults = {
        "stars_packages":   json.dumps(DEFAULT_STARS_PACKAGES),
        "premium_packages": json.dumps(DEFAULT_PREMIUM_PACKAGES),
        "gift_packages":    json.dumps(DEFAULT_GIFT_PACKAGES),
        "stars_enabled":    "1", "premium_enabled": "1", "gift_enabled": "1",
        "welcome_text":     "Assalomu alaykum! ⭐ Stars, 💎 Premium va 🎁 Gift xarid qilish uchun quyidagi bo'limni tanlang.",
    }
    async with aiosqlite.connect(DB_PATH) as db:
        for k, v in defaults.items():
            await db.execute("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)", (k, v))
        await db.commit()


async def get_setting(key, default=None):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM settings WHERE key=?", (key,)) as c:
            row = await c.fetchone()
            return row[0] if row else default

async def set_setting(key, value):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", (key, value))
        await db.commit()


# ─── Package CRUD (generik) ───────────────────────────────────
PACKAGE_NAMES = {
    "stars":   ("stars_packages",   DEFAULT_STARS_PACKAGES),
    "premium": ("premium_packages", DEFAULT_PREMIUM_PACKAGES),
    "gift":    ("gift_packages",    DEFAULT_GIFT_PACKAGES),
}

async def get_packages(pkg_type: str):
    key, default = PACKAGE_NAMES[pkg_type]
    raw = await get_setting(key)
    return json.loads(raw) if raw else default

async def set_packages(pkg_type: str, pkgs: list):
    key, _ = PACKAGE_NAMES[pkg_type]
    await set_setting(key, json.dumps(pkgs))

get_stars_packages   = lambda: get_packages("stars")
set_stars_packages   = lambda p: set_packages("stars", p)
get_premium_packages = lambda: get_packages("premium")
set_premium_packages = lambda p: set_packages("premium", p)
get_gift_packages    = lambda: get_packages("gift")
set_gift_packages    = lambda p: set_packages("gift", p)


async def get_forced_channels():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id,channel_id,channel_title,channel_link FROM forced_channels") as c:
            return [{"id": r[0], "channel_id": r[1], "title": r[2], "link": r[3]} for r in await c.fetchall()]

async def add_forced_channel(channel_id, title, link):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO forced_channels (channel_id,channel_title,channel_link) VALUES (?,?,?)", (channel_id, title, link))
        await db.commit()

async def remove_forced_channel(row_id):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM forced_channels WHERE id=?", (row_id,))
        await db.commit()

async def create_order(user_id, order_id, order_type, amount, price):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO orders (user_id,order_id,type,amount,price) VALUES (?,?,?,?,?)", (user_id, order_id, order_type, amount, price))
        await db.commit()

async def get_order(order_id):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id,user_id,order_id,type,amount,price,status FROM orders WHERE order_id=?", (order_id,)) as c:
            row = await c.fetchone()
            return {"id": row[0], "user_id": row[1], "order_id": row[2], "type": row[3], "amount": row[4], "price": row[5], "status": row[6]} if row else None

async def update_order_status(order_id, status):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE orders SET status=? WHERE order_id=?", (status, order_id))
        await db.commit()

async def get_user_orders(user_id, limit=10):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT order_id,type,amount,price,status,created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT ?", (user_id, limit)) as c:
            return [{"order_id": r[0], "type": r[1], "amount": r[2], "price": r[3], "status": r[4], "created_at": r[5]} for r in await c.fetchall()]

async def get_stats():
    async with aiosqlite.connect(DB_PATH) as db:
        paid    = (await (await db.execute("SELECT COUNT(*) FROM orders WHERE status IN ('paid','completed')")).fetchone())[0]
        pending = (await (await db.execute("SELECT COUNT(*) FROM orders WHERE status='pending'")).fetchone())[0]
        revenue = (await (await db.execute("SELECT SUM(price) FROM orders WHERE status IN ('paid','completed')")).fetchone())[0] or 0
        users   = (await (await db.execute("SELECT COUNT(*) FROM users")).fetchone())[0]
        new_today = (await (await db.execute("SELECT COUNT(*) FROM users WHERE joined_at >= date('now','-1 day')")).fetchone())[0]
        return {"paid": paid, "pending": pending, "revenue": revenue, "users": users, "new_today": new_today}


# ─── User CRUD ────────────────────────────────────────────────
async def register_user(user_id, username, full_name):
    async with aiosqlite.connect(DB_PATH) as db:
        existing = await (await db.execute("SELECT user_id FROM users WHERE user_id=?", (user_id,))).fetchone()
        if existing:
            await db.execute("UPDATE users SET username=?, full_name=? WHERE user_id=?", (username, full_name, user_id))
        else:
            await db.execute("INSERT INTO users (user_id,username,full_name) VALUES (?,?,?)", (user_id, username, full_name))
        await db.commit()
        return existing is None

async def get_user(user_id):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id,username,full_name,balance,joined_at FROM users WHERE user_id=?", (user_id,)) as c:
            row = await c.fetchone()
            return {"user_id": row[0], "username": row[1], "full_name": row[2], "balance": row[3], "joined_at": row[4]} if row else None

async def get_user_balance(user_id):
    u = await get_user(user_id)
    return u["balance"] if u else 0

async def deduct_balance(user_id, amount):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE users SET balance=MAX(0, balance-?) WHERE user_id=?", (amount, user_id))
        await db.commit()

async def get_all_user_ids():
    async with aiosqlite.connect(DB_PATH) as db:
        return [r[0] for r in await (await db.execute("SELECT user_id FROM users")).fetchall()]


# ─── Helpers ──────────────────────────────────────────────────
def fmt(n):
    try: return f"{int(float(n)):,}".replace(",", " ")
    except: return str(n)

def is_success(res):
    if not isinstance(res, dict): return False
    val = res.get("success") or res.get("ok")
    if val is None: return False
    if isinstance(val, bool): return val
    if isinstance(val, int): return val != 0
    if isinstance(val, str): return val.lower() in ("true", "1", "yes", "ok")
    return bool(val)

def order_status_emoji(status):
    return {"completed": "✅", "paid": "✅", "pending": "⏳", "expired": "⏰", "cancelled": "❌"}.get(status, "❓")

async def check_subscriptions(bot, user_id):
    channels = await get_forced_channels()
    not_sub = []
    for ch in channels:
        try:
            member = await bot.get_chat_member(ch["channel_id"], user_id)
            if member.status in ("left", "kicked", "banned"):
                not_sub.append(ch)
        except Exception:
            not_sub.append(ch)
    return not_sub

async def ensure_subscribed(bot, user_id, msg_obj):
    not_sub = await check_subscriptions(bot, user_id)
    if not_sub:
        await msg_obj.answer("⚠️ Avval kanallarga obuna bo'ling:", reply_markup=kb_channels(not_sub))
        return False
    return True

async def notify_admin(bot, title, details):
    try:
        await bot.send_message(ADMIN_ID, f"🚨 <b>{title}</b>\n\n{details}", parse_mode="HTML")
    except Exception as e:
        logger.error(f"Admin notify xato: {e}")


# ─── Shared HTTP client for Hyperpin ──────────────────────────
_hyperpin_client = None

async def get_hyperpin_client():
    global _hyperpin_client
    if not _hyperpin_client or _hyperpin_client.is_closed:
        _hyperpin_client = httpx.AsyncClient(timeout=30)
    return _hyperpin_client

async def hyperpin_call(method: str, path: str, json_data: dict = None, params: dict = None, retries=2):
    for attempt in range(retries + 1):
        try:
            client = await get_hyperpin_client()
            headers = {"X-API-Key": HYPERPIN_API_KEY}
            if json_data: headers["Content-Type"] = "application/json"
            res = await client.request(method, f"{HYPERPIN_API_URL}{path}", headers=headers, json=json_data, params=params)
            logger.info(f"HYPERPIN {path} [{attempt+1}]: {res.status_code}")
            data = res.json()
            if isinstance(data, dict) and (data.get("success") or "id" in data or "balance" in data):
                return {"success": True, **data}
            if isinstance(data, dict):
                return {"success": False, "error": data.get("error", "Noma'lum xato"), "code": "api_error"}
            return data
        except Exception as e:
            logger.warning(f"hyperpin_call {path} urinish {attempt+1} xato: {e}")
            if attempt < retries: await asyncio.sleep(2)
    return {"success": False, "error": "Barcha urinishlar muvaffaqiyatsiz", "code": "all_attempts_failed"}

hyperpin_buy_stars    = lambda username, quantity, **kw: hyperpin_call("POST", "/stars/buy",    {"username": username.lstrip('@'), "quantity": int(quantity), **{k: v for k, v in kw.items() if v}})
hyperpin_buy_premium  = lambda username, months, **kw:     hyperpin_call("POST", "/premium/buy",  {"username": username.lstrip('@'), "months": int(months), **{k: v for k, v in kw.items() if v}})
hyperpin_buy_gift     = lambda username, gift_id, stars_cost, **kw: hyperpin_call("POST", "/gift/buy", {"username": username.lstrip('@'), "gift_id": gift_id, "stars_cost": int(stars_cost), **{k: v for k, v in kw.items() if v}})
hyperpin_user_info    = lambda username:          hyperpin_call("POST", "/user-info", {"username": username.lstrip('@')})
hyperpin_stars_price  = lambda username, q=100:   hyperpin_call("GET",  "/stars/price",  params={"username": username.lstrip('@'), "quantity": int(q)})
hyperpin_premium_price= lambda username, m=3:     hyperpin_call("GET",  "/premium/price", params={"username": username.lstrip('@'), "months": int(m)})
hyperpin_get_order    = lambda oid:               hyperpin_call("GET",  f"/order/{oid}")
hyperpin_balance      = lambda:                   hyperpin_call("GET",  "/balance")
hyperpin_prices       = lambda:                   hyperpin_call("GET",  "/prices")
hyperpin_status       = lambda:                   hyperpin_call("GET",  "/status")
hyperpin_deposit      = lambda:                   hyperpin_call("GET",  "/account/deposit")
hyperpin_account_stats= lambda:                   hyperpin_call("GET",  "/account/stats")
hyperpin_rotate_key   = lambda:                   hyperpin_call("POST", "/account/rotate-key")
hyperpin_list_orders  = lambda limit=20, offset=0, status=None, type=None: hyperpin_call("GET", "/orders", params={"limit": limit, "offset": offset, **(status and {"status": status}), **(type and {"type": type})})


# ─── Payment (HUMO) ───────────────────────────────────────────
async def humo_create(user_id, amount):
    try:
        async with httpx.AsyncClient(timeout=15, verify=False) as client:
            res = await client.post(f"{SHOP_API}?action=create_order", json={"shop_id": SHOP_ID, "shop_key": SHOP_KEY, "amount": float(amount), "user_id": str(user_id)})
            return res.json()
    except Exception as e:
        logger.error(f"humo_create xato: {e}")
        return {"ok": False, "error": str(e)}

async def humo_check(order_id):
    try:
        async with httpx.AsyncClient(timeout=10, verify=False) as client:
            res = await client.get(SHOP_API, params={"action": "check", "order_id": order_id, "shop_id": SHOP_ID, "shop_key": SHOP_KEY})
            return res.json().get("data")
    except Exception as e:
        logger.error(f"humo_check xato: {e}")
        return None


# ─── Payment flow helper ──────────────────────────────────────
async def create_payment(uid, price, order_type, amount, state, msg_obj, extra_state: dict = None):
    wait = await msg_obj.answer("⏳ To'lov yaratilmoqda...")
    res = await humo_create(uid, price)
    if not res or not res.get("ok"):
        err = res.get("error", "Server xatosi") if res else "Javob yo'q"
        await wait.edit_text(f"❌ <b>Xato:</b> {err}\n\nQaytadan /start bosing.", parse_mode="HTML")
        await state.clear()
        return None
    d = res["data"]
    oid, fp, card = d["order_id"], int(d["amount"]), d["card_number"]
    await create_order(uid, oid, order_type, amount, fp)
    upd = {"order_id": oid, **(extra_state or {})}
    await state.update_data(**upd)
    extra = (f"\n\n⚠️ Farqlash uchun <b>+{d['extra_sum']} so'm</b> qo'shildi." if d.get("extra_sum", 0) > 0 else "")
    await wait.edit_text(
        f"💰 <b>To'lov</b>\n\n🏦 Karta: <code>{card}</code>\n💰 Summa: <b>{fmt(fp)} so'm</b>\n\n"
        f"📋 1️⃣ Karta raqamini nusxa oling\n2️⃣ Aniq summani o'tkazing\n3️⃣ «✅ To'lov qildim» bosing\n\n"
        f"⏳ Muddat: <b>10 daqiqa</b>{extra}",
        reply_markup=kb_payment(oid, card, fp), parse_mode="HTML"
    )
    return oid


# ─── Keyboards ────────────────────────────────────────────────
def kb_main(stars_on=True, premium_on=True, gift_on=True):
    rows = []
    if stars_on:   rows.append([KeyboardButton(text="⭐ Telegram Stars sotib olish")])
    if premium_on: rows.append([KeyboardButton(text="💎 Telegram Premium sotib olish")])
    if gift_on:    rows.append([KeyboardButton(text="🎁 Telegram Gift yuborish")])
    rows.append([KeyboardButton(text="📦 Buyurtmalarim"), KeyboardButton(text="👤 Profilim")])
    rows.append([KeyboardButton(text="ℹ️ Yordam")])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)

def kb_admin():
    return ReplyKeyboardMarkup(keyboard=[
        [KeyboardButton(text="📊 Statistika")],
        [KeyboardButton(text="⭐ Stars narxlari"), KeyboardButton(text="💎 Premium narxlari")],
        [KeyboardButton(text="🎁 Gift narxlari")],
        [KeyboardButton(text="📢 Majburiy obuna"), KeyboardButton(text="⚙️ Bot sozlamalari")],
        [KeyboardButton(text="📣 Xabar yuborish"), KeyboardButton(text="💰 Hyperpin")],
        [KeyboardButton(text="🔙 Asosiy menyu")],
    ], resize_keyboard=True)

def _pkg_btns(packages, prefix, name_key, value_key):
    return [[InlineKeyboardButton(text=f"{p[name_key]} — {fmt(p[value_key])} so'm", callback_data=f"{prefix}:{i}")] for i, p in enumerate(packages)]

def kb_stars(packages):    return InlineKeyboardMarkup(inline_keyboard=_pkg_btns(packages, "stars_buy", "stars", "price") + [[InlineKeyboardButton(text="✏️ O'zim yozaman", callback_data="stars_custom")], [InlineKeyboardButton(text="🔙 Orqaga", callback_data="back_main")]])
def kb_premium(packages):  return InlineKeyboardMarkup(inline_keyboard=_pkg_btns(packages, "premium_buy", "label", "price") + [[InlineKeyboardButton(text="🔙 Orqaga", callback_data="back_main")]])
def kb_gift(packages):     return InlineKeyboardMarkup(inline_keyboard=_pkg_btns(packages, "gift_buy", "name", "price") + [[InlineKeyboardButton(text="🔙 Orqaga", callback_data="back_main")]])

def kb_payment(order_id, card, amount):
    card_copy = card.replace(" ", "")
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"📋 {card}", copy_text=CopyTextButton(text=card_copy))],
        [InlineKeyboardButton(text=f"💰 {fmt(amount)} so'm", copy_text=CopyTextButton(text=str(amount)))],
        [InlineKeyboardButton(text="✅ To'lov qildim", callback_data=f"check_pay:{order_id}")],
        [InlineKeyboardButton(text="❌ Bekor qilish", callback_data=f"cancel_pay:{order_id}")],
    ])

def kb_channels(channels):
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"📢 {ch['title']}", url=ch["link"])] for ch in channels] + [[InlineKeyboardButton(text="✅ Obuna bo'ldim", callback_data="check_sub")]])


# ─── Admin keyboard generators ────────────────────────────────
def _admin_edit_kb(packages, prefix, name_key, value_key, add_cb, del_cb):
    rows = [[InlineKeyboardButton(text=f"{p[name_key]} → {fmt(p[value_key])} so'm", callback_data=f"edit_{prefix}:{i}")] for i, p in enumerate(packages)]
    rows.append([InlineKeyboardButton(text="➕ Yangi paket", callback_data=add_cb), InlineKeyboardButton(text="🗑 O'chirish", callback_data=del_cb)])
    rows.append([InlineKeyboardButton(text="🔙 Admin panel", callback_data="admin_back")])
    return InlineKeyboardMarkup(inline_keyboard=rows)

def _admin_del_kb(packages, prefix, label_key):
    rows = [[InlineKeyboardButton(text=f"❌ {p[label_key]}", callback_data=f"del_{prefix}:{i}")] for i, p in enumerate(packages)]
    rows.append([InlineKeyboardButton(text="🔙 Orqaga", callback_data="admin_back")])
    return InlineKeyboardMarkup(inline_keyboard=rows)

kb_admin_stars    = lambda p: _admin_edit_kb(p, "stars", "stars", "price", "add_stars_pkg", "del_stars_menu")
kb_del_stars      = lambda p: _admin_del_kb(p, "stars", "stars")
kb_admin_premium  = lambda p: _admin_edit_kb(p, "premium", "label", "price", "add_premium_pkg", "del_premium_menu")
kb_del_premium    = lambda p: _admin_del_kb(p, "premium", "label")
kb_admin_gifts    = lambda p: _admin_edit_kb(p, "gift", "name", "price", "add_gift_pkg", "del_gift_menu")
kb_del_gifts      = lambda p: _admin_del_kb(p, "gift", "name")

def kb_admin_channels(channels):
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=f"❌ {ch['title']}", callback_data=f"del_channel:{ch['id']}")] for ch in channels] + [[InlineKeyboardButton(text="➕ Kanal qo'shish", callback_data="add_channel")], [InlineKeyboardButton(text="🔙 Admin panel", callback_data="admin_back")]])


# ─── FSM States ───────────────────────────────────────────────
class ShopSt(StatesGroup):
    stars_recipient = State()
    stars_custom    = State()
    stars_pay       = State()
    premium_pay     = State()
    gift_recipient  = State()
    gift_pay        = State()

class AdminSt(StatesGroup):
    edit_price          = State()
    add_stars_value     = State()
    add_stars_price     = State()
    add_premium_value   = State()
    add_premium_label   = State()
    add_premium_price   = State()
    add_gift_id         = State()
    add_gift_name       = State()
    add_gift_stars      = State()
    add_gift_price      = State()
    add_ch_id           = State()
    add_ch_title        = State()
    add_ch_link         = State()
    edit_welcome        = State()
    broadcast           = State()


# ─── Routers ──────────────────────────────────────────────────
r_common = Router()
r_admin  = Router()
r_start  = Router()
r_shop   = Router()


# ─── /cancel ──────────────────────────────────────────────────
@r_common.message(Command("cancel"))
@r_common.message(StateFilter("*"), F.text.casefold() == "bekor")
async def cmd_cancel(msg: Message, state: FSMContext):
    cur = await state.get_state()
    await state.clear()
    await msg.answer("Bekor qilinadigan narsa yo'q. /start bosing." if cur is None else "❌ Bekor qilindi. /start bosing.")


# ─── /start ───────────────────────────────────────────────────
@r_start.message(Command("start"))
async def cmd_start(msg: Message, state: FSMContext, bot: Bot):
    await state.clear()
    uid = msg.from_user.id
    await register_user(uid, msg.from_user.username or "", msg.from_user.full_name or "")
    if uid == ADMIN_ID:
        await msg.answer("👋 Xush kelibsiz, Admin!\n\nAdmin panelga: /admin", reply_markup=kb_main())
        return
    not_sub = await check_subscriptions(bot, uid)
    if not_sub:
        await msg.answer("⚠️ <b>Botdan foydalanish uchun kanallarga obuna bo'ling:</b>", reply_markup=kb_channels(not_sub), parse_mode="HTML")
        return
    welcome = await get_setting("welcome_text", "Xush kelibsiz!")
    s = {"stars_enabled": await get_setting("stars_enabled", "1"), "premium_enabled": await get_setting("premium_enabled", "1"), "gift_enabled": await get_setting("gift_enabled", "1")}
    await msg.answer(f"👋 {welcome}", reply_markup=kb_main(s["stars_enabled"] == "1", s["premium_enabled"] == "1", s["gift_enabled"] == "1"), parse_mode="HTML")

@r_start.callback_query(F.data == "check_sub")
async def check_sub_cb(call: CallbackQuery, bot: Bot):
    not_sub = await check_subscriptions(bot, call.from_user.id)
    if not_sub:
        await call.answer("⚠️ Hali barcha kanallarga obuna bo'lmadingiz!", show_alert=True); return
    await call.message.delete()
    s = {"stars_enabled": await get_setting("stars_enabled", "1"), "premium_enabled": await get_setting("premium_enabled", "1"), "gift_enabled": await get_setting("gift_enabled", "1")}
    welcome = await get_setting("welcome_text", "Xush kelibsiz!")
    await call.message.answer(f"✅ Rahmat!\n\n👋 {welcome}", reply_markup=kb_main(s["stars_enabled"] == "1", s["premium_enabled"] == "1", s["gift_enabled"] == "1"), parse_mode="HTML")

@r_start.callback_query(F.data == "back_main")
async def back_main(call: CallbackQuery, state: FSMContext):
    await state.clear()
    try: await call.message.delete()
    except: pass

@r_start.message(F.text == "ℹ️ Yordam")
async def help_msg(msg: Message):
    await msg.answer("ℹ️ <b>Yordam</b>\n\nBu bot orqali Telegram Stars va Premium sotib olasiz.\n\n💳 <b>To'lov:</b> HUMO karta orqali avtomatik\n⭐ <b>Stars:</b> Hisob raqamiga tushadi\n💎 <b>Premium:</b> Avtomatik faollashtiriladi\n\n❓ Muammo bo'lsa: @admin_username bilan bog'laning", parse_mode="HTML")


# ─── Profil ───────────────────────────────────────────────────
@r_start.message(F.text == "👤 Profilim")
async def profile_msg(msg: Message):
    uid = msg.from_user.id
    user = await get_user(uid) or await register_user(uid, msg.from_user.username or "", msg.from_user.full_name or "") or await get_user(uid)
    orders = await get_user_orders(uid, limit=3)
    total_spent = sum(o["price"] for o in orders if o["status"] in ("paid", "completed"))
    joined = user["joined_at"][:10] if user and user.get("joined_at") else "—"
    await msg.answer(f"👤 <b>Profilingiz</b>\n\n🆔 ID: <code>{uid}</code>\n👤 Ism: {msg.from_user.full_name}\n📅 Ro'yxatdan o'tgan: {joined}\n\n💰 Balans: <b>{fmt(user['balance'])} so'm</b>" if user else "👤 Profil topilmadi.", parse_mode="HTML")


# ─── Buyurtmalar ──────────────────────────────────────────────
@r_shop.message(F.text == "📦 Buyurtmalarim")
async def my_orders(msg: Message):
    orders = await get_user_orders(msg.from_user.id, limit=10)
    if not orders:
        await msg.answer("📦 Sizda hali buyurtma yo'q."); return
    lines = ["📦 <b>So'nggi buyurtmalar:</b>\n"]
    for o in orders:
        e = order_status_emoji(o["status"])
        t = "⭐ Stars" if o["type"] == "stars" else "💎 Premium"
        a = f"{o['amount']} Stars" if o["type"] == "stars" else f"{o['amount']} oy"
        d = o["created_at"][:10] if o["created_at"] else "—"
        lines.append(f"{e} #{o['order_id']} | {t} | {a}\n   💰 {fmt(o['price'])} so'm | {d}\n")
    await msg.answer("\n".join(lines), parse_mode="HTML")


# ─── Common subscription guard ────────────────────────────────
async def _check_sub_and_enabled(bot, msg, setting_key, disabled_msg):
    if not await ensure_subscribed(bot, msg.from_user.id, msg): return False
    if (await get_setting(setting_key, "1")) != "1":
        await msg.answer(disabled_msg); return False
    return True


# ─── Stars buyurtma ───────────────────────────────────────────
@r_shop.message(F.text == "⭐ Telegram Stars sotib olish")
async def stars_menu(msg: Message, state: FSMContext, bot: Bot):
    if not await _check_sub_and_enabled(bot, msg, "stars_enabled", "⭐ Stars xizmati vaqtincha to'xtatilgan."): return
    await state.set_state(ShopSt.stars_recipient)
    await msg.answer("⭐ <b>Telegram Stars</b>\n\n👤 Qabul qiluvchining <b>@username</b> yoki <b>Telegram ID</b> sini kiriting:\n\n<i>Masalan: @username yoki 123456789</i>\n\nBekor qilish: /cancel", parse_mode="HTML")

@r_shop.message(ShopSt.stars_recipient)
async def stars_recipient_input(msg: Message, state: FSMContext):
    raw = msg.text.strip()
    tipus = None
    if raw.startswith("@"): tipus = raw
    elif raw.lstrip("-").isdigit(): tipus = raw
    if not tipus:
        await msg.answer("⚠️ Noto'g'ri format!\n@username yoki Telegram ID sini kiriting.", parse_mode="HTML"); return
    await state.update_data(recipient=tipus)
    await msg.answer(f"✅ Qabul qiluvchi: <b>{tipus}</b>\n\n⭐ <b>Paket tanlang:</b>", reply_markup=kb_stars(await get_stars_packages()), parse_mode="HTML")

@r_shop.callback_query(F.data.startswith("stars_buy:"))
async def stars_buy(call: CallbackQuery, state: FSMContext, bot: Bot):
    if not await ensure_subscribed(bot, call.from_user.id, call.message): return await call.answer()
    idx = int(call.data.split(":")[1]); pkgs = await get_stars_packages()
    if idx >= len(pkgs): await call.answer("Paket topilmadi!", show_alert=True); return
    p = pkgs[idx]; data = await state.get_data()
    await _start_stars_pay(call.message, call.from_user.id, p["stars"], p["price"], state, data.get("recipient", str(call.from_user.id)))
    await call.answer()

@r_shop.callback_query(F.data == "stars_custom")
async def stars_custom(call: CallbackQuery, state: FSMContext):
    await state.set_state(ShopSt.stars_custom)
    await call.message.answer("✏️ Nechta Stars xohlaysiz?\n\n<i>Minimal: 50 | Maksimal: 1 000 000</i>\n\nBekor qilish: /cancel", parse_mode="HTML"); await call.answer()

@r_shop.message(ShopSt.stars_custom)
async def stars_custom_input(msg: Message, state: FSMContext):
    raw = msg.text.strip().replace(" ", "")
    if not raw.isdigit() or not (50 <= int(raw) <= 1000000): await msg.answer("⚠️ 50 dan 1 000 000 gacha raqam kiriting."); return
    stars = int(raw); pkgs = await get_stars_packages()
    pps = (pkgs[0]["price"] / pkgs[0]["stars"]) if pkgs else 280
    data = await state.get_data()
    await _start_stars_pay(msg, msg.from_user.id, stars, int(stars * pps), state, data.get("recipient", str(msg.from_user.id)))

async def _start_stars_pay(msg_obj, uid, stars, price, state, recipient=None):
    oid = await create_payment(uid, price, "stars", stars, state, msg_obj, {"stars": stars, "recipient": recipient or str(uid)})
    if oid:
        await state.set_state(ShopSt.stars_pay)

# ─── Premium buyurtma ─────────────────────────────────────────
@r_shop.message(F.text == "💎 Telegram Premium sotib olish")
async def premium_menu(msg: Message, bot: Bot):
    if not await _check_sub_and_enabled(bot, msg, "premium_enabled", "💎 Premium xizmati vaqtincha to'xtatilgan."): return
    await msg.answer("💎 <b>Telegram Premium</b>\n\nMuddatni tanlang:", reply_markup=kb_premium(await get_premium_packages()), parse_mode="HTML")

@r_shop.callback_query(F.data.startswith("premium_buy:"))
async def premium_buy(call: CallbackQuery, state: FSMContext, bot: Bot):
    if not await ensure_subscribed(bot, call.from_user.id, call.message): return await call.answer()
    idx = int(call.data.split(":")[1]); pkgs = await get_premium_packages()
    if idx >= len(pkgs): await call.answer("Paket topilmadi!", show_alert=True); return
    p = pkgs[idx]
    oid = await create_payment(call.from_user.id, p["price"], "premium", p["months"], state, call.message, {"months": p["months"]})
    if oid: await state.set_state(ShopSt.premium_pay)
    await call.answer()


# ─── Gift buyurtma ────────────────────────────────────────────
@r_shop.message(F.text == "🎁 Telegram Gift yuborish")
async def gift_menu(msg: Message, state: FSMContext, bot: Bot):
    if not await _check_sub_and_enabled(bot, msg, "gift_enabled", "🎁 Gift xizmati vaqtincha to'xtatilgan."): return
    await state.set_state(ShopSt.gift_recipient)
    await msg.answer("🎁 <b>Telegram Gift</b>\n\n👤 Qabul qiluvchining <b>@username</b> sini kiriting:\n\n<i>Masalan: @username</i>\n\nBekor qilish: /cancel", parse_mode="HTML")

@r_shop.message(ShopSt.gift_recipient)
async def gift_recipient_input(msg: Message, state: FSMContext):
    raw = msg.text.strip()
    if not raw.startswith("@"):
        await msg.answer("⚠️ Noto'g'ri format!\n@username ko'rinishida kiriting.", parse_mode="HTML"); return
    await state.update_data(recipient=raw)
    await msg.answer(f"✅ Qabul qiluvchi: <b>{raw}</b>\n\n🎁 <b>Gift tanlang:</b>", reply_markup=kb_gift(await get_gift_packages()), parse_mode="HTML")

@r_shop.callback_query(F.data.startswith("gift_buy:"))
async def gift_buy(call: CallbackQuery, state: FSMContext, bot: Bot):
    if not await ensure_subscribed(bot, call.from_user.id, call.message): return await call.answer()
    idx = int(call.data.split(":")[1]); pkgs = await get_gift_packages()
    if idx >= len(pkgs): await call.answer("Gift topilmadi!", show_alert=True); return
    p = pkgs[idx]; data = await state.get_data()
    oid = await create_payment(call.from_user.id, p["price"], "gift", p["stars_cost"], state, call.message, {"gift_idx": idx, "recipient": data.get("recipient", str(call.from_user.id))})
    if oid: await state.set_state(ShopSt.gift_pay)
    await call.answer()


# ─── To'lovni tekshirish ──────────────────────────────────────
@r_shop.callback_query(F.data.startswith("check_pay:"))
async def check_pay(call: CallbackQuery, state: FSMContext, bot: Bot):
    oid = int(call.data.split(":")[1])
    d = await humo_check(oid)
    if not d:
        await call.answer("⚠️ Server javob bermadi. Qaytadan bosing.", show_alert=True); return
    status = d.get("status", ""); secs = int(d.get("seconds_left", 0))

    if status == "paid":
        order = await get_order(oid)
        if not order:
            await call.answer("Buyurtma topilmadi!", show_alert=True); return
        await update_order_status(oid, "paid")
        await call.message.edit_text("⏳ To'lov tasdiqlandi! Mahsulot yuborilmoqda...")

        if order["type"] == "stars":
            stars_amount = int(order["amount"])
            state_data = await state.get_data()
            recipient = state_data.get("recipient", str(call.from_user.username or call.from_user.id))
            username = recipient.lstrip('@')
            res = await hyperpin_buy_stars(username=username, quantity=stars_amount)
            logger.info(f"HYPERPIN STARS RESULT: {res} | username={username}")
            if is_success(res):
                await update_order_status(oid, "completed")
                await call.message.edit_text(f"✅ <b>Muvaffaqiyatli!</b>\n\n👤 Qabul qiluvchi: <b>@{username}</b>\n⭐ <b>{stars_amount} Telegram Stars</b> yuborildi!\n🧾 Buyurtma: <code>#{oid}</code>", parse_mode="HTML")
            else:
                err = res.get("error", "Noma'lum xato") if isinstance(res, dict) else str(res)
                code = res.get("code", "unknown") if isinstance(res, dict) else "unknown"
                logger.error(f"Stars yuborishda xato | order={oid} | username={username} | {res}")
                await call.message.edit_text(f"✅ To'lov qabul qilindi!\n⭐ Stars tez orada yuboriladi.\n🧾 Buyurtma: <code>#{oid}</code>", parse_mode="HTML")
                await notify_admin(bot, "Stars yuborilmadi!", f"💳 Xaridor: <code>{call.from_user.id}</code> @{call.from_user.username or 'yo\'q'}\n👤 Qabul: <b>@{username}</b>\n⭐ Miqdor: <b>{stars_amount} Stars</b>\n🧾 Order: <code>#{oid}</code>\n⚠️ Xato: <code>{err}</code>\n🔖 Code: <code>{code}</code>\n\nTo'lov qabul qilindi lekin stars yuborilmadi. Qo'lda yuboring!")

        elif order["type"] == "premium":
            months = int(order["amount"])
            username = call.from_user.username
            if not username:
                await call.message.edit_text("❌ <b>Xato!</b>\n\nPremium uchun Telegram username (@...) kerak.\nIltimos, profilingizda username o'rnating.", parse_mode="HTML"); return
            res = await hyperpin_buy_premium(username=username, months=months)
            if is_success(res):
                await update_order_status(oid, "completed")
                await call.message.edit_text(f"✅ <b>Muvaffaqiyatli!</b>\n\n👤 Qabul: <b>@{username}</b>\n💎 <b>Telegram Premium ({months} oy)</b> faollashtirildi!\n🧾 Buyurtma: <code>#{oid}</code>", parse_mode="HTML")
            else:
                err = res.get("error", "Noma'lum xato") if isinstance(res, dict) else str(res)
                code = res.get("code", "unknown") if isinstance(res, dict) else "unknown"
                logger.error(f"Premium xato | order={oid} | username={username} | {res}")
                await call.message.edit_text(f"✅ To'lov qabul qilindi!\n💎 Premium tez orada faollashtiriladi.\n🧾 Buyurtma: <code>#{oid}</code>", parse_mode="HTML")
                await notify_admin(bot, "Premium yuborilmadi!", f"👤 User: <code>{call.from_user.id}</code> @{call.from_user.username or 'yo\'q'}\n💎 Muddat: <b>{months} oy</b>\n🧾 Order: <code>#{oid}</code>\n⚠️ Xato: <code>{err}</code>\n🔖 Code: <code>{code}</code>")

        elif order["type"] == "gift":
            stars_cost = int(order["amount"]); sd = await state.get_data()
            recipient = sd.get("recipient", str(call.from_user.username or call.from_user.id))
            gift_idx = sd.get("gift_idx", 0); pkgs = await get_gift_packages()
            if gift_idx < len(pkgs):
                p = pkgs[gift_idx]; username = recipient.lstrip('@')
                res = await hyperpin_buy_gift(username=username, gift_id=p["gift_id"], stars_cost=stars_cost)
                logger.info(f"HYPERPIN GIFT: {res} | gift_id={p['gift_id']}")
                if is_success(res):
                    await update_order_status(oid, "completed")
                    await call.message.edit_text(f"✅ <b>Muvaffaqiyatli!</b>\n\n👤 Qabul: <b>@{username}</b>\n🎁 <b>{p['name']}</b> yuborildi!\n🧾 Buyurtma: <code>#{oid}</code>", parse_mode="HTML")
                else:
                    err = res.get("error", "Noma'lum xato") if isinstance(res, dict) else str(res)
                    code = res.get("code", "unknown") if isinstance(res, dict) else "unknown"
                    logger.error(f"Gift xato | order={oid} | {p['name']} | {res}")
                    await call.message.edit_text(f"✅ To'lov qabul qilindi!\n🎁 Gift tez orada yuboriladi.\n🧾 Buyurtma: <code>#{oid}</code>", parse_mode="HTML")
                    await notify_admin(bot, "Gift yuborilmadi!", f"💳 Xaridor: <code>{call.from_user.id}</code> @{call.from_user.username or 'yo\'q'}\n👤 Qabul: <b>@{username}</b>\n🎁 Gift: <b>{p['name']}</b> (ID: {p['gift_id']})\n🧾 Order: <code>#{oid}</code>\n⚠️ Xato: <code>{err}</code>\n🔖 Code: <code>{code}</code>\n\nTo'lov qabul qilindi lekin gift yuborilmadi. Qo'lda yuboring!")
            else:
                logger.error(f"Gift paket topilmadi idx={gift_idx}")
                await call.message.edit_text(f"✅ To'lov qabul qilindi!\n🎁 Gift tez orada yuboriladi.\n🧾 Buyurtma: <code>#{oid}</code>", parse_mode="HTML")
        await state.clear()

    elif status in ("expired", "cancelled") or secs <= 0:
        await update_order_status(oid, "expired")
        await call.answer("⏰ Muddat tugadi. Qaytadan urinib ko'ring.", show_alert=True)
        await call.message.edit_text("⏰ <b>To'lov muddati tugadi.</b>\n\nQaytadan /start bosing.", parse_mode="HTML", reply_markup=None)
        await state.clear()
    else:
        m, s = secs // 60, secs % 60
        await call.answer(f"⏳ Hali tasdiqlanmadi. ~{m} daqiqa {s} soniya qoldi." if m else f"⏳ Hali tasdiqlanmadi. ~{s} soniya qoldi.", show_alert=True)

@r_shop.callback_query(F.data.startswith("cancel_pay:"))
async def cancel_pay(call: CallbackQuery, state: FSMContext):
    await update_order_status(int(call.data.split(":")[1]), "cancelled")
    await state.clear()
    await call.message.edit_text("❌ To'lov bekor qilindi.")


# ─── Admin panel ──────────────────────────────────────────────
@r_admin.message(Command("admin"), admin_only)
async def admin_panel(msg: Message, state: FSMContext):
    await state.clear()
    await msg.answer("🔐 <b>Admin Panel</b>", reply_markup=kb_admin(), parse_mode="HTML")

@r_admin.message(F.text == "🔙 Asosiy menyu", admin_only)
async def admin_to_main(msg: Message, state: FSMContext):
    await state.clear()
    s = {"stars_enabled": await get_setting("stars_enabled", "1"), "premium_enabled": await get_setting("premium_enabled", "1"), "gift_enabled": await get_setting("gift_enabled", "1")}
    await msg.answer("Asosiy menyu:", reply_markup=kb_main(s["stars_enabled"] == "1", s["premium_enabled"] == "1", s["gift_enabled"] == "1"))

@r_admin.message(F.text == "📊 Statistika", admin_only)
async def admin_stats(msg: Message):
    s = await get_stats()
    await msg.answer(f"📊 <b>Statistika</b>\n\n👥 Jami: <b>{s['users']}</b>\n🆕 Bugun: <b>{s['new_today']}</b>\n\n✅ Muvaffaqiyatli: <b>{s['paid']}</b>\n⏳ Kutilayotgan: <b>{s['pending']}</b>\n💰 Daromad: <b>{fmt(s['revenue'])} so'm</b>", parse_mode="HTML")


async def _save_price(msg, state, pkg_type, value_key):
    raw = msg.text.strip().replace(" ", "")
    if not raw.isdigit(): await msg.answer("Faqat raqam!"); return
    data = await state.get_data()
    pkgs = await get_packages(data.get("pkg_type", pkg_type))
    pkgs[data["idx"]][value_key] = int(raw)
    await set_packages(data.get("pkg_type", pkg_type), pkgs)
    await state.clear()

@r_admin.message(AdminSt.edit_price, admin_only)
async def save_price_any(msg: Message, state: FSMContext):
    data = await state.get_data()
    pkg_type = data.get("pkg_type", "stars")
    await _save_price(msg, state, pkg_type, "price")
    pkgs = await get_packages(pkg_type)
    await msg.answer(f"✅ Narx yangilandi!", reply_markup={
        "stars": kb_admin_stars(pkgs),
        "premium": kb_admin_premium(pkgs),
        "gift": kb_admin_gifts(pkgs),
    }[pkg_type])


# ─── Admin: Stars ─────────────────────────────────────────────
@r_admin.message(F.text == "⭐ Stars narxlari", admin_only)
async def admin_stars_menu(msg: Message):
    await msg.answer("⭐ <b>Stars paketlari:</b>", reply_markup=kb_admin_stars(await get_stars_packages()), parse_mode="HTML")

@r_admin.callback_query(F.data.startswith("edit_stars:"))
async def edit_stars_cb(call, state):
    idx = int(call.data.split(":")[1]); pkgs = await get_stars_packages()
    await state.update_data(idx=idx, pkg_type="stars"); await state.set_state(AdminSt.edit_price)
    await call.message.answer(f"⭐ <b>{pkgs[idx]['stars']} Stars</b> — hozirgi: <b>{fmt(pkgs[idx]['price'])} so'm</b>\n\nYangi narx (so'm):", parse_mode="HTML"); await call.answer()

@r_admin.callback_query(F.data == "add_stars_pkg")
async def add_stars_start(call, state):
    await state.set_state(AdminSt.add_stars_value)
    await call.message.answer("⭐ Yangi paket uchun nechta Stars? (masalan: 300)"); await call.answer()

@r_admin.message(AdminSt.add_stars_value, admin_only)
async def add_stars_value(msg, state):
    raw = msg.text.strip().replace(" ", "")
    if not raw.isdigit(): await msg.answer("Faqat raqam!"); return
    await state.update_data(new_value=int(raw)); await state.set_state(AdminSt.add_stars_price)
    await msg.answer(f"💰 {raw} Stars uchun narx (so'm)?")

@r_admin.message(AdminSt.add_stars_price, admin_only)
async def add_stars_price(msg, state):
    raw = msg.text.strip().replace(" ", "")
    if not raw.isdigit(): await msg.answer("Faqat raqam!"); return
    data = await state.get_data()
    pkgs = await get_stars_packages()
    pkgs.append({"stars": data["new_value"], "price": int(raw)})
    pkgs.sort(key=lambda x: x["stars"])
    await set_stars_packages(pkgs); await state.clear()
    await msg.answer(f"✅ Yangi paket qo'shildi!", reply_markup=kb_admin_stars(pkgs))

@r_admin.callback_query(F.data == "del_stars_menu")
async def del_stars_menu(call):
    await call.message.edit_reply_markup(reply_markup=kb_del_stars(await get_stars_packages())); await call.answer()

@r_admin.callback_query(F.data.startswith("del_stars:"))
async def del_stars_pkg(call):
    idx = int(call.data.split(":")[1]); pkgs = await get_stars_packages()
    if len(pkgs) <= 1: await call.answer("Kamida 1 ta paket qolishi kerak!", show_alert=True); return
    removed = pkgs.pop(idx); await set_stars_packages(pkgs)
    await call.answer(f"✅ {removed['stars']} Stars o'chirildi.")
    await call.message.edit_reply_markup(reply_markup=kb_admin_stars(pkgs))


# ─── Admin: Premium ───────────────────────────────────────────
@r_admin.message(F.text == "💎 Premium narxlari", admin_only)
async def admin_premium_menu(msg):
    await msg.answer("💎 <b>Premium paketlari:</b>", reply_markup=kb_admin_premium(await get_premium_packages()), parse_mode="HTML")

@r_admin.callback_query(F.data.startswith("edit_premium:"))
async def edit_premium_cb(call, state):
    idx = int(call.data.split(":")[1]); pkgs = await get_premium_packages()
    await state.update_data(idx=idx, pkg_type="premium"); await state.set_state(AdminSt.edit_price)
    await call.message.answer(f"💎 <b>{pkgs[idx]['label']}</b> — hozirgi: <b>{fmt(pkgs[idx]['price'])} so'm</b>\n\nYangi narx (so'm):", parse_mode="HTML"); await call.answer()



@r_admin.callback_query(F.data == "add_premium_pkg")
async def add_premium_start(call, state):
    await state.set_state(AdminSt.add_premium_value)
    await call.message.answer("💎 Necha oy uchun paket? (masalan: 2)"); await call.answer()

@r_admin.message(AdminSt.add_premium_value, admin_only)
async def add_premium_value(msg, state):
    raw = msg.text.strip().replace(" ", "")
    if not raw.isdigit(): await msg.answer("Faqat raqam!"); return
    await state.update_data(new_value=int(raw)); await state.set_state(AdminSt.add_premium_label)
    await msg.answer(f"📝 {raw} oy uchun label kiriting (masalan: '2 oy'):")

@r_admin.message(AdminSt.add_premium_label, admin_only)
async def add_premium_label(msg, state):
    await state.update_data(new_label=msg.text.strip()); await state.set_state(AdminSt.add_premium_price)
    await msg.answer("💰 Narxi (so'm)?")

@r_admin.message(AdminSt.add_premium_price, admin_only)
async def add_premium_price_f(msg, state):
    raw = msg.text.strip().replace(" ", "")
    if not raw.isdigit(): await msg.answer("Faqat raqam!"); return
    data = await state.get_data(); pkgs = await get_premium_packages()
    pkgs.append({"months": data["new_value"], "label": data["new_label"], "price": int(raw)})
    pkgs.sort(key=lambda x: x["months"]); await set_premium_packages(pkgs); await state.clear()
    await msg.answer(f"✅ Yangi paket qo'shildi!", reply_markup=kb_admin_premium(pkgs))

@r_admin.callback_query(F.data == "del_premium_menu")
async def del_premium_menu(call):
    await call.message.edit_reply_markup(reply_markup=kb_del_premium(await get_premium_packages())); await call.answer()

@r_admin.callback_query(F.data.startswith("del_premium:"))
async def del_premium_pkg(call):
    idx = int(call.data.split(":")[1]); pkgs = await get_premium_packages()
    if len(pkgs) <= 1: await call.answer("Kamida 1 ta paket qolishi kerak!", show_alert=True); return
    removed = pkgs.pop(idx); await set_premium_packages(pkgs); await call.answer(f"✅ {removed['label']} o'chirildi.")
    await call.message.edit_reply_markup(reply_markup=kb_admin_premium(pkgs))


# ─── Admin: Gift ──────────────────────────────────────────────
@r_admin.message(F.text == "🎁 Gift narxlari", admin_only)
async def admin_gift_menu(msg):
    await msg.answer("🎁 <b>Gift paketlari:</b>", reply_markup=kb_admin_gifts(await get_gift_packages()), parse_mode="HTML")

@r_admin.callback_query(F.data.startswith("edit_gift:"))
async def edit_gift_cb(call, state):
    idx = int(call.data.split(":")[1]); pkgs = await get_gift_packages()
    await state.update_data(idx=idx, pkg_type="gift"); await state.set_state(AdminSt.edit_price)
    await call.message.answer(f"🎁 <b>{pkgs[idx]['name']}</b> — hozirgi: <b>{fmt(pkgs[idx]['price'])} so'm</b>\n\nYangi narx (so'm):", parse_mode="HTML"); await call.answer()



@r_admin.callback_query(F.data == "add_gift_pkg")
async def add_gift_start(call, state):
    await state.set_state(AdminSt.add_gift_id)
    await call.message.answer("🎁 Gift ID sini kiriting (masalan: gift_select:0:15):"); await call.answer()

@r_admin.message(AdminSt.add_gift_id, admin_only)
async def add_gift_id_input(msg, state):
    await state.update_data(new_gift_id=msg.text.strip()); await state.set_state(AdminSt.add_gift_name)
    await msg.answer("🎁 Gift nomini kiriting (masalan: 🎂 Cake):")

@r_admin.message(AdminSt.add_gift_name, admin_only)
async def add_gift_name_input(msg, state):
    await state.update_data(new_gift_name=msg.text.strip()); await state.set_state(AdminSt.add_gift_stars)
    await msg.answer("⭐ Gift stars_cost qiymatini kiriting (1-100):")

@r_admin.message(AdminSt.add_gift_stars, admin_only)
async def add_gift_stars_input(msg, state):
    raw = msg.text.strip()
    if not raw.isdigit() or not (1 <= int(raw) <= 100): await msg.answer("⚠️ 1 dan 100 gacha raqam kiriting."); return
    await state.update_data(new_stars_cost=int(raw)); await state.set_state(AdminSt.add_gift_price)
    await msg.answer("💰 Narxi (so'm)?")

@r_admin.message(AdminSt.add_gift_price, admin_only)
async def add_gift_price_input(msg, state):
    raw = msg.text.strip().replace(" ", "")
    if not raw.isdigit(): await msg.answer("Faqat raqam!"); return
    data = await state.get_data(); pkgs = await get_gift_packages()
    pkgs.append({"gift_id": data["new_gift_id"], "name": data["new_gift_name"], "stars_cost": data["new_stars_cost"], "price": int(raw)})
    pkgs.sort(key=lambda x: (isinstance(x["gift_id"], str), x["gift_id"])); await set_gift_packages(pkgs); await state.clear()
    await msg.answer(f"✅ Yangi gift qo'shildi!", reply_markup=kb_admin_gifts(pkgs))

@r_admin.callback_query(F.data == "del_gift_menu")
async def del_gift_menu_cb(call):
    await call.message.edit_reply_markup(reply_markup=kb_del_gifts(await get_gift_packages())); await call.answer()

@r_admin.callback_query(F.data.startswith("del_gift:"))
async def del_gift_pkg(call):
    idx = int(call.data.split(":")[1]); pkgs = await get_gift_packages()
    if len(pkgs) <= 1: await call.answer("Kamida 1 ta paket qolishi kerak!", show_alert=True); return
    removed = pkgs.pop(idx); await set_gift_packages(pkgs); await call.answer(f"✅ {removed['name']} o'chirildi.")
    await call.message.edit_reply_markup(reply_markup=kb_admin_gifts(pkgs))


# ─── Majburiy obuna (admin) ───────────────────────────────────
@r_admin.message(F.text == "📢 Majburiy obuna", admin_only)
async def admin_channels_menu(msg):
    channels = await get_forced_channels()
    text = "📢 <b>Majburiy obuna kanallari</b>\n\n" + ("\n".join(f"• {ch['title']} (<code>{ch['channel_id']}</code>)" for ch in channels) if channels else "Kanal yo'q.")
    await msg.answer(text, reply_markup=kb_admin_channels(channels), parse_mode="HTML")

@r_admin.callback_query(F.data == "add_channel")
async def add_channel_start(call, state):
    await state.set_state(AdminSt.add_ch_id)
    await call.message.answer("📢 Kanal ID sini kiriting\n(masalan: <code>-1001234567890</code>)\n\nBotni kanalingizga admin qilib qo'shing!", parse_mode="HTML"); await call.answer()

@r_admin.message(AdminSt.add_ch_id, admin_only)
async def add_ch_id_input(msg, state):
    await state.update_data(ch_id=msg.text.strip()); await state.set_state(AdminSt.add_ch_title)
    await msg.answer("Kanal nomini kiriting:")

@r_admin.message(AdminSt.add_ch_title, admin_only)
async def add_ch_title_input(msg, state):
    await state.update_data(ch_title=msg.text.strip()); await state.set_state(AdminSt.add_ch_link)
    await msg.answer("Kanal havolasini kiriting (https://t.me/...):")

@r_admin.message(AdminSt.add_ch_link, admin_only)
async def add_ch_link_input(msg, state):
    data = await state.get_data()
    await add_forced_channel(data["ch_id"], data["ch_title"], msg.text.strip())
    channels = await get_forced_channels(); await state.clear()
    await msg.answer(f"✅ Kanal qo'shildi: <b>{data['ch_title']}</b>", reply_markup=kb_admin_channels(channels), parse_mode="HTML")

@r_admin.callback_query(F.data.startswith("del_channel:"))
async def del_channel(call):
    await remove_forced_channel(int(call.data.split(":")[1]))
    channels = await get_forced_channels()
    await call.message.edit_reply_markup(reply_markup=kb_admin_channels(channels)); await call.answer("✅ O'chirildi.")


# ─── Bot sozlamalari ──────────────────────────────────────────
@r_admin.message(F.text == "⚙️ Bot sozlamalari", admin_only)
async def bot_settings(msg):
    s = {"stars_enabled": await get_setting("stars_enabled", "1"), "premium_enabled": await get_setting("premium_enabled", "1"), "gift_enabled": await get_setting("gift_enabled", "1")}
    welcome = await get_setting("welcome_text", "Xush kelibsiz!")
    sts = lambda v: "✅ Yoqiq" if v == "1" else "❌ O'chiq"
    await msg.answer(f"⚙️ <b>Bot sozlamalari</b>\n\n⭐ Stars: {sts(s['stars_enabled'])}\n💎 Premium: {sts(s['premium_enabled'])}\n🎁 Gift: {sts(s['gift_enabled'])}\n\n📝 Xush kelish matni:\n<i>{welcome}</i>",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=f"⭐ Stars: {sts(s['stars_enabled'])}", callback_data="toggle_stars")],
            [InlineKeyboardButton(text=f"💎 Premium: {sts(s['premium_enabled'])}", callback_data="toggle_premium")],
            [InlineKeyboardButton(text=f"🎁 Gift: {sts(s['gift_enabled'])}", callback_data="toggle_gift")],
            [InlineKeyboardButton(text="✏️ Xush kelish xabarini o'zgartirish", callback_data="edit_welcome")],
        ]), parse_mode="HTML")

async def _toggle(call, key, label):
    cur = await get_setting(key, "1"); new = "0" if cur == "1" else "1"
    await set_setting(key, new)
    await call.answer(f"{label} {'yoqildi ✅' if new == '1' else 'o\'chirildi ❌'}", show_alert=True)
    await call.message.delete()

@r_admin.callback_query(F.data == "toggle_stars")
async def toggle_stars(call):   await _toggle(call, "stars_enabled", "Stars")
@r_admin.callback_query(F.data == "toggle_premium")
async def toggle_premium(call): await _toggle(call, "premium_enabled", "Premium")
@r_admin.callback_query(F.data == "toggle_gift")
async def toggle_gift(call):    await _toggle(call, "gift_enabled", "Gift")

@r_admin.callback_query(F.data == "edit_welcome")
async def edit_welcome_start(call, state):
    await state.set_state(AdminSt.edit_welcome); await call.message.answer("✏️ Yangi xush kelish xabarini kiriting:"); await call.answer()

@r_admin.message(AdminSt.edit_welcome, admin_only)
async def save_welcome(msg, state):
    await set_setting("welcome_text", msg.text.strip()); await state.clear(); await msg.answer("✅ Xush kelish matni yangilandi!")

@r_admin.callback_query(F.data == "admin_back")
async def admin_back(call, state):
    await state.clear()
    try: await call.message.delete()
    except: pass
    await call.answer()


# ─── Broadcast ────────────────────────────────────────────────
@r_admin.message(F.text == "📣 Xabar yuborish", admin_only)
async def broadcast_start(msg, state):
    await state.set_state(AdminSt.broadcast)
    await msg.answer("📣 <b>Broadcast</b>\n\nBarcha foydalanuvchilarga yuboriladigan xabarni kiriting.\nHTML formatlash qo'llab-quvvatlanadi.\n\nBekor qilish: /cancel", parse_mode="HTML")

@r_admin.message(AdminSt.broadcast, admin_only)
async def do_broadcast(msg, state, bot: Bot):
    await state.clear()
    user_ids = await get_all_user_ids(); total = len(user_ids); sent = failed = 0
    status_msg = await msg.answer(f"📤 Yuborilmoqda... 0/{total}")
    for uid in user_ids:
        try: await bot.send_message(uid, msg.text, parse_mode="HTML"); sent += 1
        except: failed += 1
        if (sent + failed) % 20 == 0:
            try: await status_msg.edit_text(f"📤 Yuborilmoqda... {sent+failed}/{total}")
            except: pass
        await asyncio.sleep(0.05)
    await status_msg.edit_text(f"✅ <b>Broadcast yakunlandi!</b>\n\n📤 Yuborildi: <b>{sent}</b>\n❌ Muvaffaqiyatsiz: <b>{failed}</b>\n📊 Jami: <b>{total}</b>", parse_mode="HTML")


# ─── Hyperpin panel ───────────────────────────────────────────
@r_admin.message(F.text == "💰 Hyperpin", admin_only)
async def hyperpin_panel(msg):
    bal = await hyperpin_balance()
    stats = await hyperpin_account_stats()
    dep = await hyperpin_deposit()
    text = ""
    if bal.get("success"):
        text += f"💰 <b>Balans:</b> <code>{bal['balance']} TON</code>\n👤 <b>User:</b> @{bal.get('username', '?')}\n"
    else:
        text += f"❌ Balans xato: {bal.get('error', 'Noma\'lum')}\n"
    if isinstance(stats, dict) and not stats.get("error"):
        text += f"\n📊 <b>Statistika:</b>\n" + "\n".join(f"• {k}: {v}" for k, v in stats.items())
    if dep.get("address"):
        text += f"\n\n📥 <b>Deposit:</b> <code>{dep['address']}</code>"
    await msg.answer(text.strip(), parse_mode="HTML")


# ─── Self-ping & web server ────────────────────────────────────
from aiohttp import web
SELF_PORT = int(os.environ.get("BOT_PORT", 5000))

async def _health(request): return web.Response(text="OK")

async def run_webserver():
    app = web.Application()
    app.router.add_get("/", _health); app.router.add_get("/health", _health)
    runner = web.AppRunner(app); await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", SELF_PORT).start()
    logger.info(f"Web server port {SELF_PORT} da ishga tushdi.")

async def self_ping():
    await asyncio.sleep(30)
    while True:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"http://localhost:{SELF_PORT}/health")
                logger.info(f"Self-ping OK ({r.status_code})")
        except Exception as e: logger.warning(f"Self-ping xato: {e}")
        await asyncio.sleep(90)


# ─── Main ─────────────────────────────────────────────────────
async def main():
    logger.info("Bot ishga tushmoqda...")
    await init_db(); logger.info("DB tayyor.")
    bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher(storage=MemoryStorage())
    for r in (r_common, r_admin, r_start, r_shop):
        dp.include_router(r)
    await bot.delete_webhook(drop_pending_updates=True)
    logger.info("Polling boshlandi. Bot tayyor!")
    try:
        await asyncio.gather(
            dp.start_polling(bot, skip_updates=True, allowed_updates=dp.resolve_used_update_types()),
            run_webserver(), self_ping(),
        )
    finally:
        await bot.session.close(); logger.info("Bot to'xtatildi.")

if __name__ == "__main__":
    asyncio.run(main())
