"""
🤖 Telegram Avto-javob Userbot - FINAL FIX v2.0
================================================
✅ Only admin private chat
✅ No auto-update issues
✅ Only user messages (not bot's own)
✅ Only private chats (no groups)
✅ Single file, production ready
"""

import os, json, time, random, asyncio
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient, events, Button
from telethon.sessions import StringSession
from telethon.tl.functions.messages import SendReactionRequest
from telethon.tl.types import ReactionEmoji
from telethon.errors import *

load_dotenv()

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
PERMISSIONS_FILE = DATA_DIR / "permissions.json"
SESSION_FILE = DATA_DIR / "session.txt"

RANDOM_REACTIONS = ["❤️", "🔥", "👍", "😁", "🎉", "🥰", "👏", "😍", "🤩", "💯"]
DEFAULT_SETTINGS = {
    "mode": "online",
    "autoReplyText": "Salom! 👋 Hozir band ekanman ⏳",
    "autoReactEnabled": True,
    "reactionMode": "random",
    "fixedReaction": "❤️",
}

def read_json(p, f=None): return json.loads(p.read_text(encoding="utf-8")) if p.exists() else (f or {})
def write_json(p, d): p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")

def get_settings(): return {**DEFAULT_SETTINGS, **read_json(SETTINGS_FILE)}
def save_settings(p): 
    c = get_settings()
    c.update(p)
    write_json(SETTINGS_FILE, c)

def get_permissions(): return read_json(PERMISSIONS_FILE)
def is_user_approved(u): return get_permissions().get(str(u), {}).get("approved", False)
def add_pending_approval(uid, info):
    p = get_permissions()
    p[str(uid)] = {**info, "approved": False, "request_time": time.time()}
    write_json(PERMISSIONS_FILE, p)

def approve_user(uid):
    p = get_permissions()
    if str(uid) in p:
        p[str(uid)]["approved"] = True
        write_json(PERMISSIONS_FILE, p)

def get_users(): return read_json(USERS_FILE)
def get_user_state(cid): return get_users().get(str(cid), {"lastReplyAt": 0})
def set_user_state(cid, p):
    u = get_users()
    u[str(cid)] = {**get_user_state(cid), **p}
    write_json(USERS_FILE, u)

def escape_html(t): return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

bot_client = TelegramClient(StringSession(), API_ID, API_HASH)
_s = SESSION_STRING or (SESSION_FILE.read_text(encoding="utf-8").strip() if SESSION_FILE.exists() else "")
user_client = TelegramClient(StringSession(_s), API_ID, API_HASH)

pending_action = {}
login_future = None

async def notify_admin(h):
    try: await bot_client.send_message(ADMIN_ID, h, parse_mode="html")
    except Exception as e: print(f"⚠️ {e}")

def main_menu(): return [
    [Button.text("🔐 Login", resize=True)],
    [Button.text("📱 Online/Offline", resize=True), Button.text("🔄 Yangilash", resize=True)],
    [Button.text("💬 Avto-javob", resize=True)],
    [Button.text("😀 Reaksiya", resize=True)],
    [Button.text("📋 Pending", resize=True)],
]

# ============================================================
# HANDLERS
# ============================================================

@bot_client.on(events.NewMessage(pattern="/start"))
async def start(event):
    sender = await event.get_sender()
    sid = sender.id
    
    if sid == ADMIN_ID:
        await event.respond("👋 Xush kelibsiz, Admin! 🎯", buttons=main_menu())
    elif is_user_approved(sid):
        await event.respond("✅ Xush kelibsiz!", buttons=main_menu())
    else:
        add_pending_approval(sid, {
            "username": getattr(sender, "username", None) or "noma'lum",
            "first_name": getattr(sender, "first_name", "") or "",
            "id": sid,
        })
        await notify_admin(
            f"🔔 YANGI REQUEST!\n\n"
            f"User: {getattr(sender, 'first_name', 'Noma\'lum')}\n"
            f"ID: <code>{sid}</code>\n\n"
            f"/approve_{sid} | /deny_{sid}"
        )
        await event.respond("👋 Admin ruxsat kutib turing...")

@bot_client.on(events.NewMessage(pattern=r"/approve_(\d+)"))
async def approve_h(event):
    if event.sender_id != ADMIN_ID: return
    uid = int(event.pattern_match.group(1))
    approve_user(uid)
    try: await bot_client.send_message(uid, "✅ TASDIQLANDINGIZ! /start bosing!")
    except: pass
    await event.respond(f"✅ {uid} tasdiqlandi!")

@bot_client.on(events.NewMessage(pattern=r"/deny_(\d+)"))
async def deny_h(event):
    if event.sender_id != ADMIN_ID: return
    uid = int(event.pattern_match.group(1))
    p = get_permissions()
    p.pop(str(uid), None)
    write_json(PERMISSIONS_FILE, p)
    try: await bot_client.send_message(uid, "❌ Rad etildi.")
    except: pass
    await event.respond(f"❌ {uid} rad etildi!")

@bot_client.on(events.NewMessage(pattern=r"^(🔐 Login|/login)$", func=lambda e: e.is_private and e.sender_id == ADMIN_ID))
async def login_b(event):
    pending_action[event.sender_id] = "waiting_phone"
    await event.respond("📱 Telefon raqamingizni yuboring (+998901234567):")

@bot_client.on(events.NewMessage(pattern=r"^(📱 Online/Offline|/mode)$", func=lambda e: e.is_private and e.sender_id == ADMIN_ID))
async def mode_b(event):
    s = get_settings()
    nm = "offline" if s.get("mode") == "online" else "online"
    save_settings({"mode": nm})
    e = "🔴 OFFLINE" if nm == "offline" else "🟢 ONLINE"
    await event.respond(f"✅ {e}", buttons=main_menu())

@bot_client.on(events.NewMessage(pattern=r"^(🔄 Yangilash|/refresh)$", func=lambda e: e.is_private and e.sender_id == ADMIN_ID))
async def refresh_b(event):
    s = get_settings()
    i = f"📊 <b>Sozlamalar:</b>\n\n🟢 Rejim: {s.get('mode')}\n💬 Avto: {escape_html(s.get('autoReplyText', '')[:40])}\n😀 Reaksiya: {s.get('reactionMode')}"
    await event.respond(i, buttons=main_menu(), parse_mode="html")

@bot_client.on(events.NewMessage(pattern=r"^(💬 Avto-javob|/reply)$", func=lambda e: e.is_private and e.sender_id == ADMIN_ID))
async def reply_b(event):
    pending_action[event.sender_id] = "reply_text"
    await event.respond("✍️ Yangi matni yuboring (faqat MATN):")

@bot_client.on(events.NewMessage(pattern=r"^(😀 Reaksiya|/reaction)$", func=lambda e: e.is_private and e.sender_id == ADMIN_ID))
async def reaction_b(event):
    pending_action[event.sender_id] = "reaction_emoji"
    await event.respond("😀 Emoji yuboring (masalan: ❤️) yoki 'random':")

@bot_client.on(events.NewMessage(pattern=r"^(📋 Pending|/pending)$", func=lambda e: e.is_private and e.sender_id == ADMIN_ID))
async def pending_b(event):
    pm = get_permissions()
    pd = {k: v for k, v in pm.items() if not v.get("approved", False)}
    if not pd:
        await event.respond("✅ Pending yo'q!")
        return
    t = "📋 <b>Pending:</b>\n\n"
    for u, i in list(pd.items())[:10]:
        t += f"👤 {escape_html(i.get('first_name', 'N'))}\n→ /approve_{u} | /deny_{u}\n\n"
    await event.respond(t, parse_mode="html")

# ============================================================
# INPUT HANDLER - ONLY ADMIN, PRIVATE CHAT, REAL TEXT
# ============================================================

@bot_client.on(events.NewMessage(incoming=True, func=lambda e: e.is_private and e.sender_id == ADMIN_ID))
async def handle_input(event):
    """FAQAT admin, private chat, real text (not button)"""
    global login_future
    
    t = event.message.message or ""
    
    # Emoji bilan boshlangannalarni ignore qil (button)
    if not t or t.startswith(("🔐", "📱", "🔄", "💬", "😀", "⏱", "📋", "/")):
        return
    
    # Login
    if login_future and not login_future.done():
        login_future.set_result(t)
        return
    
    # PENDING ACTION TEKSHIR VA CLEAR QIL
    st = pending_action.get(event.sender_id)
    if not st: return
    
    pending_action.pop(event.sender_id, None)  # CLEAR FIRST!
    
    if st == "reply_text":
        if t.strip():
            save_settings({"autoReplyText": t})
            await event.respond("✅ Yangilandi! ✨", buttons=main_menu())
        else:
            await event.respond("⚠️ Matn bo'sh!", buttons=main_menu())
            
    elif st == "reaction_emoji":
        if t.lower() == "random":
            save_settings({"reactionMode": "random"})
            await event.respond("✅ Random reaksiya! 🎲", buttons=main_menu())
        elif len(t) <= 2:
            save_settings({"reactionMode": "fixed", "fixedReaction": t})
            await event.respond(f"✅ Reaksiya: {t} ✨", buttons=main_menu())
        else:
            await event.respond("⚠️ Faqat emoji!", buttons=main_menu())

# ============================================================
# USERBOT - ONLY PRIVATE, ONLY INCOMING (NOT BOT'S OWN)
# ============================================================

async def send_auto_reaction(msg):
    s = get_settings()
    if not s.get("autoReactEnabled"): return
    try:
        e = s.get("fixedReaction", "❤️") if s.get("reactionMode") == "fixed" else random.choice(RANDOM_REACTIONS)
        await user_client(SendReactionRequest(peer=msg.chat_id, msg_id=msg.id, reaction=[ReactionEmoji(emoticon=e)]))
    except: pass

def should_auto_reply(s, cid):
    if s.get("mode") != "offline": return False
    st = get_user_state(cid)
    return (time.time() * 1000 - st.get("lastReplyAt", 0)) >= 300000

@user_client.on(events.NewMessage(incoming=True, func=lambda e: e.is_private))
async def on_msg(event):
    """Faqat PRIVATE CHAT va INCOMING (boshqa odamlar)"""
    msg = event.message
    
    # Auto-reaction
    await send_auto_reaction(msg)
    
    # Auto-reply
    s = get_settings()
    if not should_auto_reply(s, str(event.chat_id)): return
    
    try:
        await user_client.send_message(msg.chat_id, s.get("autoReplyText", ""))
        set_user_state(str(event.chat_id), {"lastReplyAt": time.time() * 1000})
    except: pass

@user_client.on(events.MessageEdited(incoming=True, func=lambda e: e.is_private))
async def on_edit(event):
    """Faqat boshqa odamlar tahrirlagan xabarlar"""
    msg = event.message
    try:
        sender = await event.get_sender()
        sn = getattr(sender, "first_name", "N")
    except:
        sn = "?"
    await notify_admin(f"✏️ <b>{escape_html(sn)}</b> tahrirladi:\n\n{escape_html(msg.message or '')[:150]}")

# ============================================================
# MAIN
# ============================================================

async def main():
    print("🚀 Bot ishga tushirilmoqda...")
    
    try:
        await bot_client.start(bot_token=BOT_TOKEN)
        print("✅ Bot ulanildi!")
    except Exception as e:
        print(f"❌ {e}")
        return
    
    try:
        await user_client.connect()
        if await user_client.is_user_authorized():
            me = await user_client.get_me()
            print(f"✅ User ulanildi: @{me.username or me.id}")
    except: pass
    
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
