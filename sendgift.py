"""
sendgift.py — Telegram account session orqali gift yuboruvchi server
Bot.js dan HTTP so'rov oladi va Telethon bilan gift yuboradi.

O'rnatish:
  pip install telethon python-dotenv aiohttp

Ishlatish:
  python sendgift.py
"""

import asyncio
import os
import json
import logging
from aiohttp import web
from telethon import TelegramClient
from telethon.tl.functions.payments import SendStarsFormRequest, GetPaymentFormRequest
from telethon.tl.functions.messages import SendMediaRequest
from telethon.tl.types import InputInvoiceStarGift, InputInvoiceSlug
from telethon.errors import SessionPasswordNeededError
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
log = logging.getLogger(__name__)

API_ID   = int(os.getenv('API_ID', '0'))
API_HASH = os.getenv('API_HASH', '')
PHONE    = os.getenv('PHONE', '')
SESSION  = os.getenv('SESSION_NAME', 'gift_sender')
HOST     = os.getenv('SENDGIFT_HOST', '127.0.0.1')
PORT     = int(os.getenv('SENDGIFT_PORT', '4242'))
SECRET   = os.getenv('SENDGIFT_SECRET', 'supersecretkey')

client: TelegramClient = None


async def ensure_client():
    global client
    if client and client.is_connected():
        return client
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        log.warning("Session mavjud emas. Yangi login kerak!")
        await client.send_code_request(PHONE)
        code = input("Telegram kodni kiriting: ")
        try:
            await client.sign_in(PHONE, code)
        except SessionPasswordNeededError:
            pw = input("2FA parolini kiriting: ")
            await client.sign_in(password=pw)
        log.info("Login muvaffaqiyatli!")
    return client


async def handle_send_gift(request: web.Request) -> web.Response:
    """
    POST /sendgift
    Body JSON:
    {
      "secret": "...",
      "gift_id": "telegram_gift_id_or_slug",
      "user_id": 123456789,
      "anonymous": false,
      "sender_name": "Botdan sovg'a"
    }
    """
    try:
        auth = request.headers.get('X-Secret', '')
        if auth != SECRET:
            return web.json_response({'ok': False, 'error': 'Unauthorized'}, status=401)

        data = await request.json()
        gift_id     = str(data.get('gift_id', ''))
        user_id     = int(data.get('user_id', 0))
        anonymous   = bool(data.get('anonymous', False))
        sender_name = str(data.get('sender_name', ''))

        if not gift_id or not user_id:
            return web.json_response({'ok': False, 'error': 'gift_id va user_id kerak'}, status=400)

        tg = await ensure_client()

        # Foydalanuvchi entitisini olish
        try:
            peer = await tg.get_entity(user_id)
        except Exception as e:
            log.error(f"Foydalanuvchi topilmadi: {user_id} — {e}")
            return web.json_response({'ok': False, 'error': f'User topilmadi: {e}'}, status=404)

        # Gift yuborish (Telethon InputInvoiceStarGift)
        try:
            invoice = InputInvoiceStarGift(
                peer=peer,
                gift_id=int(gift_id),
                hide_name=anonymous,
                include_upgrade=False,
                message=None
            )
            form = await tg(GetPaymentFormRequest(invoice=invoice))
            result = await tg(SendStarsFormRequest(
                form_id=form.form_id,
                invoice=invoice
            ))
            log.info(f"Gift yuborildi: {gift_id} → {user_id}")
            return web.json_response({'ok': True, 'result': str(result)})
        except Exception as e:
            log.error(f"Gift yuborishda xato: {e}")
            return web.json_response({'ok': False, 'error': str(e)}, status=500)

    except Exception as e:
        log.error(f"Handle xatosi: {e}")
        return web.json_response({'ok': False, 'error': str(e)}, status=500)


async def handle_health(request: web.Request) -> web.Response:
    tg = await ensure_client()
    me = await tg.get_me()
    return web.json_response({
        'ok': True,
        'account': f"@{me.username}",
        'name': f"{me.first_name or ''} {me.last_name or ''}".strip()
    })


async def main():
    log.info(f"SendGift server ishga tushmoqda: {HOST}:{PORT}")
    await ensure_client()
    me = await client.get_me()
    log.info(f"Hisob: @{me.username} | {me.first_name}")

    app = web.Application()
    app.router.add_post('/sendgift', handle_send_gift)
    app.router.add_get('/health', handle_health)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, HOST, PORT)
    await site.start()
    log.info(f"✅ SendGift server tayyor: http://{HOST}:{PORT}")
    await asyncio.Event().wait()


if __name__ == '__main__':
    asyncio.run(main())
