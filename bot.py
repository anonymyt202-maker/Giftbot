"""
🤖 Telegram Avto-javob Userbot (Python / Telethon)
====================================================
Bitta faylda: shaxsiy akkaunt (userbot) + boshqaruv bot.

✨ Imkoniyatlar:
- 🟢🔴 Online/Offline rejim
- 💬 Avto-javob (matni bot orqali tahrirlanadi)
- ⏱ Moslashuvchan cooldown (1,2,3,4,5,10,30 daqiqa, 1 soat) yoki 🔂 "faqat 1 marta" (har bir user uchun alohida)
- ✏️🗑 Xabar tahrirlash/o'chirishni kuzatish va owner'ga bildirishnoma
- 😀 Avto-reaksiya (🎲 random yoki ✍️ doimiy emoji)
- 💾 Sessiya va foydalanuvchilar holati saqlanadi (data/ papkasi)

🔐 LOGIN: telefon/kod/2FA parol TERMINALDA SO'RALMAYDI — hammasi
boshqaruv bot chatida so'raladi, shu sababli hosting/deploy muhitida
ham muammosiz ishlaydi.
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
OWNER_USERNAME = os.getenv("OWNER_USERNAME", "").strip().lstrip("@")
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
    await bot_client.send_message(owner_chat_id, prompt)
    return await login_future


async def wait_for_owner_ready():
    if get_settings().get("ownerChatId"):
        return
    print("⏳ Owner hali /start bosmagan, kutilmoqda...")
    await owner_ready_event.wait()


# ============================================================
# 🎛 Boshqaruv bot — menyular
# ============================================================
COOLDOWN_OPTIONS = [
    ("1 daqiqa ⏱", 60), ("2 daqiqa ⏱", 120), ("3 daqiqa ⏱", 180), ("4 daqiqa ⏱", 240),
    ("5 daqiqa ⏱", 300), ("10 daqiqa ⏱", 600), ("30 daqiqa ⏱", 1800), ("1 soat ⏱", 3600),
]


def main_menu():
    s = get_settings()
    mode_label = "🟢 Online" if s.get("mode") == "online" else "🔴 Offline"
    return [
        [Button.inline(f"🔁 Rejim: {mode_label} (bosib o'zgartirish)", b"toggle_mode")],
        [Button.inline("✏️ Avto-javob matnini o'zgartirish", b"edit_reply")],
        [Button.inline("⏱ Kutish vaqti (cooldown)", b"cooldown_menu")],
        [Button.inline("😀 Reaksiya sozlamalari", b"reaction_menu")],
        [Button.inline("📊 Holatni ko'rish", b"status")],
    ]


def cooldown_menu():
    rows = []
    for i in range(0, len(COOLDOWN_OPTIONS), 2):
        row = []
        for label, seconds in COOLDOWN_OPTIONS[i:i + 2]:
            row.append(Button.inline(label, f"set_cooldown_{seconds}".encode()))
        rows.append(row)
    rows.append([Button.inline("🔂 Faqat 1 marta (online↔offline sikli)", b"set_cooldown_once")])
    rows.append([Button.inline("⬅️ Orqaga", b"back_main")])
    return rows


def reaction_menu():
    s = get_settings()
    react_label = "✅ Avto-reaksiya: Yoqilgan" if s.get("autoReactEnabled") else "❌ Avto-reaksiya: O'chirilgan"
    return [
        [Button.inline(react_label, b"toggle_react_enabled")],
        [Button.inline("🎲 Random reaksiya rejimi", b"set_reaction_random")],
        [Button.inline("✍️ Doimiy emoji belgilash", b"set_reaction_custom")],
        [Button.inline("⬅️ Orqaga", b"back_main")],
    ]


def status_text() -> str:
    s = get_settings()
    if s.get("cooldownMode") == "once":
        cooldown_label = "Faqat 1 marta (sikl uchun) 🔂"
    else:
        cooldown_label = f"{round(s.get('cooldownSeconds', 300) / 60)} daqiqa ⏱"
    reaction_label = s.get("fixedReaction") if s.get("reactionMode") == "fixed" else "🎲 Random"
    mode_label = "🟢 Online" if s.get("mode") == "online" else "🔴 Offline"
    react_state = "✅ Yoqilgan" if s.get("autoReactEnabled") else "❌ O'chirilgan"
    return (
        "📊 <b>Joriy sozlamalar</b>\n\n"
        f"🔁 Rejim: {mode_label}\n"
        f"💬 Avto-javob matni:\n<i>{escape_html(s.get('autoReplyText', ''))}</i>\n\n"
        f"⏱ Kutish vaqti: {cooldown_label}\n"
        f"😀 Avto-reaksiya: {react_state} ({reaction_label})"
    )


# ============================================================
# 🎛 Boshqaruv bot — handlerlar
# ============================================================
@bot_client.on(events.NewMessage(pattern=r"^/start$", incoming=True))
async def on_start(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.respond("⛔️ Bu bot faqat o'z egasiga xizmat qiladi.")
        return

    if not get_settings().get("ownerChatId"):
        save_settings({"ownerChatId": sender.id})
        owner_ready_event.set()  # 🔐 login oqimi shu yerda kutib turgan bo'lishi mumkin

    await event.respond(
        "👋 <b>Salom!</b> Men sizning shaxsiy akkauntingizni boshqaruvchi botman 🤖✨\n\n"
        "Quyidagi menyudan kerakli bo'limni tanlang 👇",
        buttons=main_menu(),
        parse_mode="html",
    )


@bot_client.on(events.CallbackQuery)
async def on_callback(event):
    sender = await event.get_sender()
    if not is_owner(sender):
        await event.answer("⛔️ Ruxsat yo'q", alert=True)
        return

    data = event.data.decode()
    settings = get_settings()

    try:
        if data == "toggle_mode":
            new_mode = "offline" if settings.get("mode") == "online" else "online"
            save_settings({"mode": new_mode})
            if new_mode == "offline":
                reset_all_cycles()  # 🔄 yangi offline sikli boshlanadi
            await event.edit(
                f"✅ Rejim o'zgartirildi: {'🟢 Online' if new_mode == 'online' else '🔴 Offline'}\n\n📋 Asosiy menyu:",
                buttons=main_menu(),
            )
        elif data == "edit_reply":
            pending_action[sender.id] = "reply_text"
            await event.respond("✏️ Yangi avto-javob matnini yuboring 📝👇")
        elif data == "cooldown_menu":
            await event.edit("⏱ Kutish vaqtini tanlang:", buttons=cooldown_menu())
        elif data.startswith("set_cooldown_"):
            value = data.replace("set_cooldown_", "")
            if value == "once":
                save_settings({"cooldownMode": "once"})
                reset_all_cycles()
            else:
                save_settings({"cooldownMode": "interval", "cooldownSeconds": int(value)})
            await event.edit("✅ Kutish vaqti yangilandi! 🎉\n\n📋 Asosiy menyu:", buttons=main_menu())
        elif data == "reaction_menu":
            await event.edit("😀 Reaksiya sozlamalari:", buttons=reaction_menu())
        elif data == "toggle_react_enabled":
            save_settings({"autoReactEnabled": not settings.get("autoReactEnabled", True)})
            await event.edit("😀 Reaksiya sozlamalari:", buttons=reaction_menu())
        elif data == "set_reaction_random":
            save_settings({"reactionMode": "random"})
            await event.answer("🎲 Random reaksiya rejimi tanlandi!")
            await event.edit("😀 Reaksiya sozlamalari:", buttons=reaction_menu())
        elif data == "set_reaction_custom":
            pending_action[sender.id] = "reaction_emoji"
            await event.respond("✍️ Doimiy ishlatiladigan emojini yuboring (masalan: ❤️):")
        elif data == "status":
            await event.edit(status_text(), buttons=main_menu(), parse_mode="html")
        elif data == "back_main":
            await event.edit("📋 Asosiy menyu:", buttons=main_menu())
    except Exception as e:
        print(f"⚠️ Callback xatoligi: {e}")

    try:
        await event.answer()
    except Exception:
        pass


@bot_client.on(events.NewMessage(incoming=True))
async def on_generic_message(event):
    if not event.is_private:
        return
    text = (event.raw_text or "").strip()
    if not text or text.startswith("/"):
        return

    sender = await event.get_sender()
    if not is_owner(sender):
        return

    # 1️⃣ Avval login oqimi (telefon/kod/parol) javob kutayotgan bo'lsa, shu xabar O'SHANGA boradi
    global login_future
    if login_future is not None and not login_future.done():
        login_future.set_result(text)
        return

    # 2️⃣ Aks holda — oddiy sozlama kutuvlari (avto-javob matni / reaksiya emoji)
    state = pending_action.get(sender.id)
    if not state:
        return

    if state == "reply_text":
        save_settings({"autoReplyText": text})
        pending_action.pop(sender.id, None)
        await event.respond("✅ Avto-javob matni muvaffaqiyatli yangilandi! 🎉", buttons=main_menu())
    elif state == "reaction_emoji":
        save_settings({"reactionMode": "fixed", "fixedReaction": text})
        pending_action.pop(sender.id, None)
        await event.respond(f"✅ Doimiy reaksiya o'rnatildi: {text} 🎉", buttons=main_menu())


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

    # ✅ Bir xil phone_code_hash bilan FAQAT kodni qaytadan so'raymiz (yangi SMS YUBORILMAYDI)
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

    # 🗂 Edit/delete kuzatish uchun keshga yozamiz
    cache_message(message.id, {
        "chatId": chat_id,
        "text": message.message or "",
        "senderId": str(sender.id) if sender else None,
        "senderName": sender_name,
        "isPrivate": event.is_private,
    })

    # 😀 Avto-reaksiya (shaxsiy va guruh xabarlariga)
    await send_auto_reaction(message)

    # 💬 Avto-javob faqat shaxsiy xabarlar uchun
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
            continue  # bizda bu xabar haqida ma'lumot yo'q

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
