"""
🤖 Telegram Avto-javob Userbot - FINAL VERSION
===============================================
✅ Single file, no dependencies issues
✅ ADMIN_ID based (not username)
✅ Optional login (if SESSION_STRING exists, skip login)
✅ Anyone can use after admin approval
✅ Auto-reply, Auto-reactions, Offline/Online mode
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
    PhoneCodeInvalidError, PhoneCodeExpiredError,
    SessionPasswordNeededError, PasswordHashInvalidError, FloodWaitError,
)

load_dotenv()

# ============================================================
# ⚙️ CONFIG
# ============================================================
API_ID = int(os.getenv("API_ID", "0"))
API_HASH = os.getenv("API_HASH", "")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
SESSION_STRING = os.getenv("SESSION_STRING", "").strip()

if not all([API_ID, API_HASH, BOT_TOKEN, ADMIN_ID]):
    print("❌ .env'da API_ID, API_HASH, BOT_TOKEN, ADMIN_ID kerak!")
    exit(1)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

SETTINGS_FILE = DATA_DIR / "settings.json"
USERS_FILE = DATA_DIR / "users.json"
CACHE_FILE = DATA_DIR / "cache.json"
SESSION_FILE = DATA_DIR / "session.txt"
PERMISSIONS_FILE = DATA_DIR / "permissions.json"

RANDOM_REACTIONS = ["❤️", "🔥", "👍", "😁", "🎉", "🥰", "👏", "😍", "🤩", "💯"]

DEFAULT_SETTINGS = {
    "mode": "online",
    "autoReplyText": "Salom! 👋 Hozir band ekanman, tez orada javob beraman ⏳",
    "cooldownMode": "interval",
    "cooldownSeconds": 300,
    "autoReactEnabled": True,
    "reactionMode": "random",
    "fixedReaction": "❤️",
}

# ============================================================
# 💾 JSON Utils
# ============================================================
def read_json(path: Path, fallback=None):
    if fallback is None: fallback = {}
    if not path.exists(): return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8") or "{}")
    except: return fallback

def write_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def get_settings(): return {**DEFAULT_SETTINGS, **read_json(SETTINGS_FILE)}
def save_settings(partial): 
    current = get_settings()
    current.update(partial)
    write_json(SETTINGS_FILE, current)
    return current

def get_permissions(): return read_json(PERMISSIONS_FILE)
def is_user_approved(user_id): return get_permissions().get(str(user_id), {}).get("approved", False)
def add_pending_approval(user_id, user_info):
    perms = get_permissions()
    perms[str(user_id)] = {**user_info, "approved": False, "request_time": time.time()}
    write_json(PERMISSIONS_FILE, perms)

def approve_user(user_id):
    perms = get_permissions()
    if str(user_id) in perms:
        perms[str(user_id)]["approved"] = True
        write_json(PERMISSIONS_FILE, perms)

def get_users(): return read_json(USERS_FILE)
def get_user_state(chat_id): return get_users().get(str(chat_id), {"lastReplyAt": 0})
def set_user_state(chat_id, partial):
    users = get_users()
    users[str(chat_id)] = {**get_user_state(chat_id), **partial}
    write_json(USERS_FILE, users)

def get_cache(): return read_json(CACHE_FILE)
def cache_message(msg_id, data):
    cache = get_cache()
    cache[str(msg_id)] = {**data, "cachedAt": time.time()}
    if len(cache) > 800:
        for k in sorted(cache, key=lambda x: cache[x].get("cachedAt", 0))[:-800]:
            del cache[k]
    write_json(CACHE_FILE, cache)

def load_session_file(): return SESSION_FILE.read_text(encoding="utf-8").strip() if SESSION_FILE.exists() else ""
def save_session_file(s): SESSION_FILE.write_text(s or "", encoding="utf-8")

def escape_html(text): return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# ============================================================
# 🤖 Clients
# ============================================================
bot_client = TelegramClient(StringSession(), API_ID, API_HASH)
_existing_session = SESSION_STRING or load_session_file()
user_client = TelegramClient(StringSession(_existing_session), API_ID, API_HASH)

pending_action = {}
login_future = None

async def notify_admin(html: str):
    try:
        await bot_client.send_message(ADMIN_ID, html, parse_mode="html")
    except Exception as e:
        print(f"⚠️ Admin'ga xabar yuborishda xatolik: {e}")

async def ask_admin(prompt: str) -> str:
    global login_future
    loop = asyncio.get_event_loop()
    login_future = loop.create_future()
    try:
        await notify_admin(prompt)
        result = await asyncio.wait_for(login_future, timeout=600)
        return result
    except asyncio.TimeoutError:
        raise RuntimeError("Javob kutish vaqti tugadi")
    finally:
        login_future = None

def main_menu(): return [
    [Button.text("🔐 Login", resize=True)],
    [Button.text("📱 Online/Offline", resize=True), Button.text("🔄 Yangilash", resize=True)],
    [Button.text("💬 Avto-javob", resize=True)],
    [Button.text("😀 Reaksiya", resize=True)],
    [Button.text("⏱ Cooldown", resize=True)],
    [Button.text("📋 Pending", resize=True)],
]

# ============================================================
# 📌 HANDLERS
# ============================================================
@bot_client.on(events.NewMessage(pattern="/start"))
async def start(event):
    sender = await event.get_sender()
    sender_id = sender.id
    
    if sender_id == ADMIN_ID:
        await event.respond("👋 Xush kelibsiz, Admin! 🎯\n\nHammasi tayyor.", buttons=main_menu())
    else:
        if is_user_approved(sender_id):
            await event.respond(f"✅ Xush kelibsiz! Siz tasdiqlangan user ekansiz.", buttons=main_menu())
        else:
            user_info = {
                "username": getattr(sender, "username", None) or "noma'lum",
                "first_name": getattr(sender, "first_name", "") or "",
                "id": sender_id,
            }
            add_pending_approval(sender_id, user_info)
            await notify_admin(
                f"🔔 YANGI REQUEST!\n\n"
                f"User: {getattr(sender, 'first_name', 'Noma\'lum')}\n"
                f"ID: <code>{sender_id}</code>\n\n"
                f"/approve_{sender_id} - tasdiqlash\n"
                f"/deny_{sender_id} - rad etish"
            )
            await event.respond("👋 Xush kelibsiz! Admin ruxsat kutib turing...")

@bot_client.on(events.NewMessage(pattern=r"/approve_(\d+)"))
async def approve_handler(event):
    sender = await event.get_sender()
    if sender.id != ADMIN_ID:
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    user_id = int(event.pattern_match.group(1))
    approve_user(user_id)
    
    try:
        await bot_client.send_message(user_id, "✅ TASDIQLANDINGIZ! 🎉\n\n/start bosing!")
    except: pass
    
    await event.respond(f"✅ User {user_id} tasdiqlandi!")

@bot_client.on(events.NewMessage(pattern=r"/deny_(\d+)"))
async def deny_handler(event):
    sender = await event.get_sender()
    if sender.id != ADMIN_ID:
        await event.respond("❌ Sizda huquq yo'q!")
        return
    
    user_id = int(event.pattern_match.group(1))
    perms = get_permissions()
    perms.pop(str(user_id), None)
    write_json(PERMISSIONS_FILE, perms)
    
    try:
        await bot_client.send_message(user_id, "❌ Sizning so'rovingiz rad etildi.")
    except: pass
    
    await event.respond(f"❌ User {user_id} rad etildi!")

# ============================================================
# 🔐 LOGIN & BUTTONS
# ============================================================
@bot_client.on(events.NewMessage(pattern=r"^(🔐 Login|/login)$"))
async def login_button(event):
    if event.sender_id != ADMIN_ID:
        return
    
    await notify_admin("🔐 Login boshlandi...\n\nTelefon raqamingizni yuboring (+998901234567):")
    pending_action[event.sender_id] = "waiting_phone"

@bot_client.on(events.NewMessage(pattern=r"^(📱 Online/Offline|/mode)$"))
async def mode_button(event):
    if event.sender_id != ADMIN_ID: return
    settings = get_settings()
    new_mode = "offline" if settings.get("mode") == "online" else "online"
    save_settings({"mode": new_mode})
    emoji = "🔴 OFFLINE" if new_mode == "offline" else "🟢 ONLINE"
    await event.respond(f"✅ {emoji}", buttons=main_menu())

@bot_client.on(events.NewMessage(pattern=r"^(🔄 Yangilash|/refresh)$"))
async def refresh_button(event):
    if event.sender_id != ADMIN_ID: return
    settings = get_settings()
    info = f"📊 <b>Sozlamalar:</b>\n\n🟢 Rejim: {settings.get('mode')}\n💬 Avto-javob: {escape_html(settings.get('autoReplyText', '')[:50])}\n😀 Reaksiya: {settings.get('reactionMode')}"
    await event.respond(info, buttons=main_menu(), parse_mode="html")

@bot_client.on(events.NewMessage(pattern=r"^(💬 Avto-javob|/reply)$"))
async def reply_button(event):
    if event.sender_id != ADMIN_ID: return
    pending_action[event.sender_id] = "reply_text"
    await event.respond("✍️ Yangi avto-javob matni yuboring:")

@bot_client.on(events.NewMessage(pattern=r"^(😀 Reaksiya|/reaction)$"))
async def reaction_button(event):
    if event.sender_id != ADMIN_ID: return
    pending_action[event.sender_id] = "reaction_emoji"
    await event.respond("😀 Emoji yuboring yoki 'random' yozing:")

@bot_client.on(events.NewMessage(pattern=r"^(⏱ Cooldown|/cooldown)$"))
async def cooldown_button(event):
    if event.sender_id != ADMIN_ID: return
    await event.respond("⏱ Tanlang:", buttons=[
        [Button.text("🔂 Har bir user", resize=True)],
        [Button.text("5 min", resize=True), Button.text("10 min", resize=True)],
    ])

@bot_client.on(events.NewMessage(pattern=r"^(📋 Pending|/pending)$"))
async def pending_button(event):
    if event.sender_id != ADMIN_ID: return
    perms = get_permissions()
    pending = {k: v for k, v in perms.items() if not v.get("approved", False)}
    if not pending:
        await event.respond("✅ Pending yo'q!")
        return
    text = "📋 <b>Pending:</b>\n\n"
    for uid, info in list(pending.items())[:10]:
        text += f"👤 {escape_html(info.get('first_name', 'Noma\'lum'))}\n→ /approve_{uid} | /deny_{uid}\n\n"
    await event.respond(text, parse_mode="html")

# ============================================================
# 💬 INPUT HANDLER
# ============================================================
@bot_client.on(events.NewMessage(incoming=True))
async def handle_input(event):
    if event.sender_id != ADMIN_ID: return
    
    global login_future
    text = event.message.message or ""
    
    # Login flow
    if login_future and not login_future.done():
        login_future.set_result(text)
        return
    
    # Pending actions
    state = pending_action.get(event.sender_id)
    if not state: return
    
    if state == "reply_text":
        save_settings({"autoReplyText": text})
        pending_action.pop(event.sender_id, None)
        await event.respond("✅ Yangilandi!", buttons=main_menu())
    elif state == "reaction_emoji":
        if text.lower() == "random":
            save_settings({"reactionMode": "random"})
        else:
            save_settings({"reactionMode": "fixed", "fixedReaction": text})
        pending_action.pop(event.sender_id, None)
        await event.respond("✅ Yangilandi!", buttons=main_menu())
    elif state == "waiting_phone":
        # Phone number
        pending_action[event.sender_id] = "waiting_code"
        try:
            sent = await user_client.send_code_request(text)
            await notify_admin(f"✉️ SMS keldi. Kodni yuboring ({sent.phone_code_hash[:10]}...):")
        except Exception as e:
            await event.respond(f"❌ Xatolik: {e}")

# ============================================================
# 👤 USERBOT - AUTO-REPLY / AUTO-REACTION
# ============================================================
def pick_reaction(settings): 
    if settings.get("reactionMode") == "fixed":
        return settings.get("fixedReaction", "❤️")
    return random.choice(RANDOM_REACTIONS)

async def send_auto_reaction(message):
    settings = get_settings()
    if not settings.get("autoReactEnabled"): return
    try:
        emoji = pick_reaction(settings)
        await user_client(SendReactionRequest(
            peer=message.chat_id,
            msg_id=message.id,
            reaction=[ReactionEmoji(emoticon=emoji)],
        ))
    except: pass

def should_auto_reply(settings, chat_id):
    if settings.get("mode") != "offline": return False
    state = get_user_state(chat_id)
    cooldown = settings.get("cooldownSeconds", 300) * 1000
    return (time.time() * 1000 - state.get("lastReplyAt", 0)) >= cooldown

@user_client.on(events.NewMessage(incoming=True))
async def on_new_message(event):
    message = event.message
    chat_id = str(event.chat_id)
    
    # Cache
    cache_message(message.id, {"chatId": chat_id, "text": message.message or ""})
    
    # Auto-reaction
    await send_auto_reaction(message)
    
    # Auto-reply (private only)
    if not event.is_private: return
    
    settings = get_settings()
    if not should_auto_reply(settings, chat_id): return
    
    try:
        await user_client.send_message(message.chat_id, settings.get("autoReplyText", ""))
        set_user_state(chat_id, {"lastReplyAt": time.time() * 1000})
    except: pass

@user_client.on(events.MessageEdited(incoming=True))
async def on_message_edited(event):
    message = event.message
    cache_message(message.id, {"chatId": str(event.chat_id), "text": message.message or ""})
    await notify_admin(f"✏️ <b>Xabar tahrirlandi!</b>\n\n{escape_html(message.message or '')}", )

# ============================================================
# 🚀 MAIN
# ============================================================
async def main():
    print("🚀 Bot ishga tushirilmoqda...")
    
    try:
        await bot_client.start(bot_token=BOT_TOKEN)
        print("✅ Bot ulanildi!")
    except Exception as e:
        print(f"❌ Bot xatoligi: {e}")
        return
    
    # User login (optional)
    try:
        await user_client.connect()
        if not await user_client.is_user_authorized():
            print("⏳ Session yo'q. Admin'dan telefon raqamini so'rash kerak...")
            await notify_admin("🔐 Login boshlandi. /login tugmasini bosing yoki telefon raqamini yuboring.")
        else:
            me = await user_client.get_me()
            print(f"✅ User ulanildi: @{me.username or me.id}")
            save_session_file(user_client.session.save())
    except Exception as e:
        print(f"⚠️ User login xatoligi: {e}")
    
    print("✅ Hammasi tayyor! 🎉")
    
    await asyncio.gather(
        bot_client.run_until_disconnected(),
        user_client.run_until_disconnected(),
    )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Bot to'xtatildi.")
