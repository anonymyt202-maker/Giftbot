"""
🤖 Telegram Avto-javob Userbot (Python / Telethon)
====================================================
Bitta faylda: shaxsiy akkaunt (userbot) + boshqaruv bot.
✨ YANGI: Admin permission tizimi ✅

✨ Imkoniyatlar:
- 🔐 Admin ruxsat tizimi (bo'lajak userlar admin'dan ruxsat so'raydi)
- 🟢🔴 Online/Offline rejim
- 💬 Avto-javob (matni bot orqali tahrirlanadi)
- ⏱ Moslashuvchan cooldown (1,2,3,4,5,10,30 daqiqa, 1 soat) yoki 🔂 "faqat 1 marta"
- ✏️🗑 Xabar tahrirlash/o'chirishni kuzatish va owner'ga bildirishnoma
- 😀 Avto-reaksiya (🎲 random yoki ✍️ doimiy emoji)
- 💾 Sessiya va foydalanuvchilar holati saqlanadi (data/ papkasi)

🔐 LOGIN: Har bir user o'z akkauntini login qilishi kerak
📋 PERMISSION: Shunchaki /start bosdi → admin approve qilguniga qadar ishlamaydi
"""

import os
import json
import time
import random
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from telethon import TelegramClient, events, Button
from telethon.sessions import StringSession
from telethon.tl.functions.messages import SendReactionRequest
from telethon.tl.types import ReactionEmoji
from telethon.errors import (
    PhoneCodeInvalidError,
    PhoneCodeExpiredError,
    SessionPasswordNeededError,
    PasswordHashInvalidError,
    FloodWaitError,
)

# ============================================================
# ⚙️ .env o'qish
# ============================================================
load_dotenv()


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        print(f'❌ .env faylida "{name}" topilmadi! Iltimos to\'ldiring.')
        raise SystemExit(1)
    return value


API_ID = int(required_env("API_ID"))
API_HASH = required_env("API_HASH")
BOT_TOKEN = required_env("BOT_TOKEN")
OWNER_USERNAME = os.getenv("OWNER_USERNAME", "tgbop").strip().lstrip("@")
SESSION_STRING = os.getenv("SESSION_STRING", "").strip()

# ============================================================
# 💾 Ma'lumotlarni saqlash (JSON fayllar)
# ============================================================
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

SETTINGS_FILE = DATA_DIR / "settings.json"
USERS_FILE = DATA_DIR / "users.json"
CACHE_FILE = DATA_DIR / "cache.json"
SESSION_FILE = DATA_DIR / "session.txt"
PERMISSIONS_FILE = DATA_DIR / "permissions.json"

MAX_CACHE_SIZE = 800

RANDOM_REACTIONS = ["❤️", "🔥", "👍", "😁", "🎉", "🥰", "👏", "😍", "🤩", "💯"]

DEFAULT_SETTINGS = {
    "mode": "online",  # "online" | "offline"
    "autoReplyText": "Salom! 👋 Hozir band ekanman, tez orada javob beraman ⏳",
    "cooldownMode": "interval",  # "interval" | "once"
    "cooldownSeconds": 300,
    "autoReactEnabled": True,
    "reactionMode": "random",  # "random" | "fixed"
    "fixedReaction": "❤️",
    "ownerChatId": None,
}


def read_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return fallback
        return json.loads(text)
    except Exception as e:
        print(f"⚠️ {path.name} o'qishda xatolik: {e}")
        return fallback


def write_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_settings() -> dict:
    data = read_json(SETTINGS_FILE, {})
    return {**DEFAULT_SETTINGS, **data}


def save_settings(partial: dict) -> dict:
    current = get_settings()
    current.update(partial)
    write_json(SETTINGS_FILE, current)
    return current


def get_users() -> dict:
    return read_json(USERS_FILE, {})


def get_user_state(chat_id) -> dict:
    users = get_users()
    return users.get(str(chat_id), {"lastReplyAt": 0, "repliedThisCycle": False})


def set_user_state(chat_id, partial: dict):
    users = get_users()
    key = str(chat_id)
    state = users.get(key, {"lastReplyAt": 0, "repliedThisCycle": False})
    state.update(partial)
    users[key] = state
    write_json(USERS_FILE, users)


def reset_all_cycles():
    users = get_users()
    for key in users:
        users[key]["repliedThisCycle"] = False
    write_json(USERS_FILE, users)


# ============================================================
# 🔐 PERMISSION TIZIMI
# ============================================================
def get_permissions() -> dict:
    """Admin tomonidan tasdiqlangan userlar listini olish"""
    return read_json(PERMISSIONS_FILE, {})


def is_user_approved(user_id) -> bool:
    """Userga ruxsat bor-yo'qligini tekshirish"""
    perms = get_permissions()
    return perms.get(str(user_id), {}).get("approved", False)


def add_pending_approval(user_id: int, user_info: dict):
    """Yangi user'ni approval kutishiga qo'shish"""
    perms = get_permissions()
    perms[str(user_id)] = {
        "approved": False,
        "username": user_info.get("username", "noma'lum"),
        "first_name": user_info.get("first_name", ""),
        "last_name": user_info.get("last_name", ""),
        "request_time": time.time(),
    }
    write_json(PERMISSIONS_FILE, perms)


def approve_user(user_id: int):
    """Admin user'ni tasdiqlash"""
    perms = get_permissions()
    if str(user_id) in perms:
        perms[str(user_id)]["approved"] = True
        write_json(PERMISSIONS_FILE, perms)


def deny_user(user_id: int):
    """Admin user'ni rad etish"""
    perms = get_permissions()
    perms.pop(str(user_id), None)
    write_json(PERMISSIONS_FILE, perms)


def get_cache() -> dict:
    return read_json(CACHE_FILE, {})


def cache_message(msg_id, data: dict):
    cache = get_cache()
    cache[str(msg_id)] = {**data, "cachedAt": time.time()}
    if len(cache) > MAX_CACHE_SIZE:
        ordered = sorted(cache.keys(), key=lambda k: cache[k].get("cachedAt", 0))
        for k in ordered[: len(cache) - MAX_CACHE_SIZE]:
            del cache[k]
    write_json(CACHE_FILE, cache)


def get_cached_message(msg_id):
    return get_cache().get(str(msg_id))


def delete_cached_message(msg_id):
    cache = get_cache()
    cache.pop(str(msg_id), None)
    write_json(CACHE_FILE, cache)


def load_session_file() -> str:
    if SESSION_FILE.exists():
        return SESSION_FILE.read_text(encoding="utf-8").strip()
    return ""


def save_session_file(session_str: str):
    SESSION_FILE.write_text(session_str or "", encoding="utf-8")


def escape_html(text) -> str:
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_display_name(sender) -> str:
    if not sender:
        return "Noma'lum 🙈"
    username = getattr(sender, "username", None)
    if username:
        return f"@{username}"
    first = getattr(sender, "first_name", "") or ""
    last = getattr(sender, "last_name", "") or ""
    full = f"{first} {last}".strip()
    return full or f"ID:{getattr(sender, 'id', '?')}"


# ============================================================
# 🤖 Klientlar: boshqaruv bot + shaxsiy akkaunt
# ============================================================
bot_client = TelegramClient(StringSession(), API_ID, API_HASH)

_existing_session = SESSION_STRING or load_session_file()
user_client = TelegramClient(StringSession(_existing_session), API_ID, API_HASH)

pending_action: dict = {}  # user_id -> "reply_text" | "reaction_emoji"
owner_ready_event = asyncio.Event()
login_future: "asyncio.Future | None" = None


def is_owner(sender) -> bool:
    if not sender:
        return False
    settings = get_settings()
    owner_chat_id = settings.get("ownerChatId")
    if owner_chat_id and getattr(sender, "id", None) == owner_chat_id:
        return True
    sender_username = (getattr(sender, "username", None) or "").lower()
    if OWNER_USERNAME and sender_username == OWNER_USERNAME.lower():
        return True
    return False


async def notify_owner(html: str):
    settings = get_settings()
    owner_chat_id = settings.get("ownerChatId")
    if not owner_chat_id:
        print("ℹ️ Owner hali botga /start bosmagan, bildirishnoma yuborilmadi.")
        return
    try:
        await bot_client.send_message(owner_chat_id, html, parse_mode="html")
    except Exception as e:
        print(f"⚠️ Owner'ga xabar yuborishda xatolik: {e}")


async def ask_owner(prompt: str) -> str:
    """🔐 Login uchun savol yuboradi va owner'dan keladigan keyingi xabarni qaytaradi."""
    global login_future
    settings = get_settings()
    owner_chat_id = settings.get("ownerChatId")
    if not owner_chat_id:
        raise RuntimeError("Owner hali botga /start bosmagan")
    loop = asyncio.get_event_loop()
    login_future = loop.create_future()

    try:
        await notify_owner(prompt)
        timeout = 300  # 5 min
        result = await asyncio.wait_for(login_future, timeout=timeout)
        return result
    except asyncio.TimeoutError:
        raise RuntimeError(f"Javob kutish vaqti tugadi ({timeout}s)")
    finally:
        login_future = None


def main_menu() -> list:
    """Admin uchun asosiy menyusi"""
    return [
        [Button.text("🔐 Login", resize=True)],
        [Button.text("📱 Online/Offline", resize=True), Button.text("🔄 Yangilash", resize=True)],
        [Button.text("💬 Avto-javob matni", resize=True)],
        [Button.text("😀 Reaksiya", resize=True)],
        [Button.text("⏱ Cooldown", resize=True)],
        [Button.text("📋 Tasdiqlash kutilanayotganlar", resize=True)],
    ]


def user_menu() -> list:
    """Oddiy user uchun menyusi"""
    return [
        [Button.text("🔐 Login", resize=True)],
        [Button.text("📱 Online/Offline", resize=True), Button.text("🔄 Yangilash", resize=True)],
        [Button.text("💬 Avto-javob matni", resize=True)],
    ]


@bot_client.on(events.NewMessage(pattern="/start"))
async def start(event):
    sender = await event.get_sender()
    sender_id = sender.id
    
    if is_owner(sender):
        # Admin
        settings = get_settings()
        if not settings.get("ownerChatId"):
            save_settings({"ownerChatId": sender_id})
        
        await event.respond(
            "👋 Xush kelibsiz, Admin! 🎯\n\n"
            "Bu yerda o'zingizni Telegram akkauntini login qila olasiz va barcha imkoniyatlardan "
            "foydalanishingiz mumkin.\n\n"
            "⚠️ <b>Yangi userlar</b> uchun tasdiqlash kutilyapti? Tekshiring 👇",
            buttons=main_menu(),
            parse_mode="html"
        )
    else:
        # Oddiy user
        if is_user_approved(sender_id):
            # Tasdiqlangan user
            await event.respond(
                f"✅ Xush kelibsiz, {build_display_name(sender)}! 🎉\n\n"
                "Siz tasdiqlangan user ekansiz. O'zingizning akkauntini login qila olasiz:",
                buttons=user_menu()
            )
        else:
            # Tasdiqlash kutilmoqda yoki yangi user
            user_info = {
                "username": getattr(sender, "username", None) or "noma'lum",
                "first_name": getattr(sender, "first_name", "") or "",
                "last_name": getattr(sender, "last_name", "") or "",
            }
            add_pending_approval(sender_id, user_info)
            
            # Admin'ga bildirishnoma
            await notify_owner(
                f"🔔 <b>YANGI REQUEST!</b>\n\n"
                f"User: {escape_html(build_display_name(sender))}\n"
                f"ID: <code>{sender_id}</code>\n\n"
                f"Tasdiqlash uchun: /approve_{sender_id}\n"
                f"Rad etish uchun: /deny_{sender_id}"
            )
            
            await event.respond(
                "👋 Xush kelibsiz! 🎯\n\n"
                "Siz bu botni birinchi marta ishlatmoqchi. Admin'dan ruxsat so'raldi.\n"
                "Admin tasdiqlagunga qadar kutib turing... ⏳",
                parse_mode="html"
            )


@bot_client.on(events.NewMessage(pattern=r"/approve_(\d+)"))
async def approve_handler(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    # Regex'dan user_id'ni olamiz
    user_id = int(event.pattern_match.group(1))
    
    approve_user(user_id)
    
    try:
        await bot_client.send_message(
            user_id,
            "✅ TASDIQLANDINGIZ! 🎉\n\n"
            "Endi botni to'liq ishlatishingiz mumkin. /start bosing!"
        )
    except Exception as e:
        print(f"⚠️ User'ga bildirishnoma yuborishda xatolik: {e}")
    
    await event.respond(f"✅ User {user_id} tasdiqlandi!")


@bot_client.on(events.NewMessage(pattern=r"/deny_(\d+)"))
async def deny_handler(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    user_id = int(event.pattern_match.group(1))
    
    deny_user(user_id)
    
    try:
        await bot_client.send_message(
            user_id,
            "❌ Sizning so'rovingiz rad etildi.\n\n"
            "Admin'ga murojaat qiling."
        )
    except Exception as e:
        print(f"⚠️ User'ga bildirishnoma yuborishda xatolik: {e}")
    
    await event.respond(f"❌ User {user_id} rad etildi!")


# ============================================================
# Boshqa komandalar va tugmalar — faqat ADMIN uchun
# ============================================================

@bot_client.on(events.NewMessage(pattern=r"^(🔐 Login|/login)$"))
async def login_button(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    await event.respond("🔐 Login jarayoni boshlandi...")
    await login_flow()


@bot_client.on(events.NewMessage(pattern=r"^(📱 Online/Offline|/mode)$"))
async def mode_button(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    settings = get_settings()
    current = settings.get("mode", "online")
    new_mode = "offline" if current == "online" else "online"
    
    save_settings({"mode": new_mode})
    emoji = "🔴 OFFLINE" if new_mode == "offline" else "🟢 ONLINE"
    await event.respond(f"✅ Rejim o'zgartirildi: {emoji}", buttons=main_menu())


@bot_client.on(events.NewMessage(pattern=r"^(🔄 Yangilash|/refresh)$"))
async def refresh_button(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    settings = get_settings()
    mode_emoji = "🔴 OFFLINE" if settings.get("mode") == "offline" else "🟢 ONLINE"
    
    info = (
        f"📊 <b>Hozirgi sozlamalar:</b>\n\n"
        f"{mode_emoji} <b>Rejim:</b> {settings.get('mode')}\n"
        f"💬 <b>Avto-javob:</b> {escape_html(settings.get('autoReplyText', ''))}\n"
        f"😀 <b>Reaksiya:</b> {settings.get('reactionMode')} ({settings.get('fixedReaction')})\n"
        f"⏱ <b>Cooldown:</b> {settings.get('cooldownSeconds')} sek"
    )
    
    await event.respond(info, buttons=main_menu(), parse_mode="html")


@bot_client.on(events.NewMessage(pattern=r"^(💬 Avto-javob matni|/reply_text)$"))
async def reply_text_button(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    pending_action[sender.id] = "reply_text"
    await event.respond(
        "✍️ Yangi avto-javob matni yuboring:",
        parse_mode="html"
    )


@bot_client.on(events.NewMessage(pattern=r"^(😀 Reaksiya|/reaction)$"))
async def reaction_button(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    pending_action[sender.id] = "reaction_emoji"
    await event.respond("😀 Doimiy reaksiya emoji'sini yuboring yoki 'random' yozing:")


@bot_client.on(events.NewMessage(pattern=r"^(⏱ Cooldown|/cooldown)$"))
async def cooldown_button(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    await event.respond(
        "⏱ Cooldown rejimini tanlang:",
        buttons=[
            [Button.text("🔂 Har bir user uchun", resize=True)],
            [Button.text("⏱ 5 min", resize=True), Button.text("⏱ 10 min", resize=True)],
            [Button.text("⏱ 30 min", resize=True), Button.text("⏱ 1 soat", resize=True)],
        ]
    )


@bot_client.on(events.NewMessage(pattern=r"^(📋 Tasdiqlash kutilanayotganlar|/pending)$"))
async def pending_approvals(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    perms = get_permissions()
    pending = {k: v for k, v in perms.items() if not v.get("approved", False)}
    
    if not pending:
        await event.respond("✅ Tasdiqlash kutilayotganlari yo'q!")
        return
    
    text = "📋 <b>Tasdiqlash kutilayotganlar:</b>\n\n"
    for user_id, info in pending.items():
        username = info.get("username", "noma'lum")
        first = info.get("first_name", "")
        text += (
            f"👤 {escape_html(first)} (@{escape_html(username)})\n"
            f"ID: <code>{user_id}</code>\n"
            f"→ /approve_{user_id} yoki /deny_{user_id}\n\n"
        )
    
    await event.respond(text, parse_mode="html")


# Cooldown va Reaksiya tugmalaridan keying javobi
@bot_client.on(events.NewMessage(incoming=True))
async def handle_admin_input(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        return
    
    text = event.message.message or ""
    
    # Login kutuvchi
    global login_future
    if login_future is not None and not login_future.done():
        login_future.set_result(text)
        return
    
    # Pending action'lar
    state = pending_action.get(sender.id)
    if not state:
        return
    
    if state == "reply_text":
        save_settings({"autoReplyText": text})
        pending_action.pop(sender.id, None)
        await event.respond("✅ Avto-javob matni muvaffaqiyatli yangilandi! 🎉", buttons=main_menu())
    elif state == "reaction_emoji":
        if text.lower() == "random":
            save_settings({"reactionMode": "random"})
            await event.respond("✅ Random reaksiya o'rnatildi! 🎉", buttons=main_menu())
        else:
            save_settings({"reactionMode": "fixed", "fixedReaction": text})
            await event.respond(f"✅ Doimiy reaksiya o'rnatildi: {text} 🎉", buttons=main_menu())
        pending_action.pop(sender.id, None)


# ============================================================
# 🔐 Login oqimi — TERMINAL ISHLATILMAYDI, hammasi bot chatida
# ============================================================
async def login_flow():
    await wait_for_owner_ready()
    await notify_owner(
        "🔐 <b>Akkauntga ulanish boshlandi!</b>\n\n"
        "Quyidagi savollarga shaxsiy akkauntingiz ma'lumotlari bilan javob bering 👇"
    )

    phone = await ask_owner("📱 Telefon raqamingizni yuboring (masalan: +998901234567):")

    try:
        sent = await user_client.send_code_request(phone)
    except FloodWaitError as e:
        await notify_owner(f"⏳ Juda ko'p urinish qilindi. {e.seconds} soniyadan keyin botni qayta ishga tushiring.")
        raise

    phone_code_hash = sent.phone_code_hash
    signed_in = False

    for _ in range(5):
        code = await ask_owner("✉️ Telegramdan SMS/xabar orqali kelgan kodni yuboring:")
        try:
            await user_client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
            signed_in = True
            break
        except SessionPasswordNeededError:
            for _ in range(5):
                password = await ask_owner("🔑 Ikki bosqichli (2FA) parolingizni yuboring:")
                try:
                    await user_client.sign_in(password=password)
                    signed_in = True
                    break
                except PasswordHashInvalidError:
                    await notify_owner("❌ Parol noto'g'ri. Qaytadan urinib ko'ring 🔁")
            break
        except (PhoneCodeInvalidError, PhoneCodeExpiredError):
            await notify_owner("❌ Kod noto'g'ri yoki eskirgan. Qaytadan urinib ko'ring 🔁")
            continue

    if not signed_in:
        await notify_owner("❌ Login amalga oshmadi (bir necha marta noto'g'ri kiritildi). Botni qayta ishga tushiring.")
        raise RuntimeError("Login muvaffaqiyatsiz tugadi")

    session_str = user_client.session.save()
    save_session_file(session_str)

    me = await user_client.get_me()
    username_display = f"@{me.username}" if me.username else "username yo'q"
    print(f"✅ Akkaunt ulandi: {me.first_name or ''} ({username_display}) 🎉")

    await notify_owner(
        "✅ <b>Muvaffaqiyatli ulandi!</b> 🎉\n\n"
        "💾 Quyidagi qiymatni nusxalab, hosting platformangizning <b>Environment Variables</b> bo'limiga "
        "<b>SESSION_STRING</b> nomi bilan saqlab qo'ying — shunda qayta deploy qilinganda ham login so'ralmaydi:\n\n"
        f"<code>{escape_html(session_str)}</code>\n\n"
        "⚠️ Bu qiymatni hech kim bilan baham ko'rmang!"
    )


async def wait_for_owner_ready():
    await owner_ready_event.wait()


async def ensure_user_login():
    await user_client.connect()
    if await user_client.is_user_authorized():
        me = await user_client.get_me()
        save_session_file(user_client.session.save())
        username_display = f"@{me.username}" if me.username else "username yo'q"
        print(f"✅ Saqlangan sessiya orqali ulandi: {me.first_name or ''} ({username_display}) 🎉")
        return

    print("⏳ Sessiya topilmadi. Telegramda boshqaruv botiga /start yuborilishini kutmoqdamiz...")
    await login_flow()


# ============================================================
# 👤 Shaxsiy akkaunt — avto-javob / avto-reaksiya / kuzatuv
# ============================================================
def pick_reaction(settings: dict) -> str:
    if settings.get("reactionMode") == "fixed" and settings.get("fixedReaction"):
        return settings["fixedReaction"]
    return random.choice(RANDOM_REACTIONS)


async def send_auto_reaction(message):
    settings = get_settings()
    if not settings.get("autoReactEnabled", True):
        return
    try:
        emoji = pick_reaction(settings)
        await user_client(SendReactionRequest(
            peer=message.chat_id,
            msg_id=message.id,
            reaction=[ReactionEmoji(emoticon=emoji)],
        ))
    except Exception as e:
        print(f"⚠️ Avto-reaksiya yuborishda xatolik: {e}")


def should_auto_reply(settings: dict, chat_id) -> bool:
    if settings.get("mode") != "offline":
        return False
    state = get_user_state(chat_id)
    if settings.get("cooldownMode") == "once":
        return not state.get("repliedThisCycle", False)
    cooldown_ms = settings.get("cooldownSeconds", 300) * 1000
    now_ms = time.time() * 1000
    return now_ms - state.get("lastReplyAt", 0) >= cooldown_ms


@user_client.on(events.NewMessage(incoming=True))
async def on_user_new_message(event):
    message = event.message
    chat_id = str(event.chat_id)
    sender = await event.get_sender()
    sender_name = build_display_name(sender)

    cache_message(message.id, {
        "chatId": chat_id,
        "text": message.message or "",
        "senderId": str(sender.id) if sender else None,
        "senderName": sender_name,
        "isPrivate": event.is_private,
    })

    await send_auto_reaction(message)

    if not event.is_private:
        return

    settings = get_settings()
    if not should_auto_reply(settings, chat_id):
        return

    try:
        await user_client.send_message(message.chat_id, settings.get("autoReplyText", ""))
        set_user_state(chat_id, {"lastReplyAt": time.time() * 1000, "repliedThisCycle": True})
        print(f"🤖 Avto-javob yuborildi → {sender_name}")
    except Exception as e:
        print(f"⚠️ Avto-javob yuborishda xatolik: {e}")


@user_client.on(events.MessageEdited(incoming=True))
async def on_user_message_edited(event):
    message = event.message
    cached = get_cached_message(message.id) or {}
    sender = await event.get_sender()
    sender_name = build_display_name(sender)

    new_text = message.message or "(matnsiz xabar) 📎"
    old_text = cached.get("text") or "(eski matn topilmadi) ❔"

    await notify_owner(
        f"✏️ <b>{escape_html(sender_name)}</b> chatda xabarni tahrirladi!\n\n"
        f"🔻 <b>Oldingi xabar:</b>\n{escape_html(old_text)}\n\n"
        f"🔺 <b>Hozirgi xabar:</b>\n{escape_html(new_text)}"
    )

    cache_message(message.id, {
        "chatId": cached.get("chatId") or str(event.chat_id),
        "text": new_text,
        "senderId": str(sender.id) if sender else None,
        "senderName": sender_name,
        "isPrivate": event.is_private,
    })


@user_client.on(events.MessageDeleted)
async def on_user_message_deleted(event):
    for msg_id in event.deleted_ids:
        cached = get_cached_message(msg_id)
        if not cached:
            continue

        deleted_sender_name = cached.get("senderName") or "Noma'lum"
        deleted_text = cached.get("text") or "(matnsiz xabar) 📎"
        await notify_owner(
            f"🗑 <b>{escape_html(deleted_sender_name)}</b> chatda xabarni o'chirdi!\n\n"
            f"📝 <b>O'chirilgan xabar:</b>\n{escape_html(deleted_text)}"
        )
        delete_cached_message(msg_id)


# ============================================================
# 🚀 Ishga tushirish
# ============================================================
async def main():
    print("🚀 Loyiha ishga tushirilmoqda...\n")

    print("🤖 Boshqaruv bot ulanmoqda...")
    await bot_client.start(bot_token=BOT_TOKEN)
    owner_ready_event.set()
    print("✅ Boshqaruv bot ishga tushdi! Telegramda botingizga /start yozing.")

    await ensure_user_login()

    print("\n✅ Hammasi tayyor! Bot to'liq ishlayapti 🎉🤖\n")

    await asyncio.gather(
        bot_client.run_until_disconnected(),
        user_client.run_until_disconnected(),
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Bot to'xtatildi. Xayr!")
