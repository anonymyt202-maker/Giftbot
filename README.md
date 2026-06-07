# 🎁 Gift Bot — To'liq versiya

Hammasi **bitta `bot.js`** da. `sendgift.py` shart emas.

## O'rnatish

```bash
npm install
node bot.js
```

## .env

```env
BOT_TOKEN=...
ADMIN_ID=...          # sizning Telegram ID ingiz
API_ID=...            # my.telegram.org
API_HASH=...          # my.telegram.org
CARD_NUMBER=5614681256483730
STARS_TO_UZS=140
```

## Telegram hisob ulash (gift yuborish uchun)

1. `/admin` → 📱 TG hisob: 🔴
2. Telefon raqam kiriting (+998...)
3. Telegram kodni kiriting
4. (2FA bo'lsa) parolni kiriting
5. ✅ Ulandi — sessiya saqlanadi

## Admin komandalar

| Komanda | Izoh |
|---------|------|
| `/admin` | Admin panel |
| `/addstars ID miqdor` | Stars qo'shish |
| `/adduzs ID miqdor` | UZS qo'shish |
| `/stars miqdor` | Referral mukofotini o'zgartirish |

## Admin panel tugmalari

- 📱 TG hisob ulash / uzish
- 📊 Statistika
- 📢 Broadcast
- 🎁 Gift qo'shish → `Nom|Stars|TelegramGiftID`
- 🗑 Gift o'chirish (tanlama)
- 📺 Kanal qo'shish
- ❌ Kanal o'chirish (tanlama)
- 📨 UZS so'rovlarni tasdiqlash/rad etish
- 👤 Foydalanuvchi qidirish → stars/uzs qo'shish

## Gift qo'shish

Admin panel → 🎁 Gift qo'shish → kiriting:
```
Atirgul|100|5168043015958052
```
`Nom | Stars narxi | Telegram Gift ID`

## Railway deploy

```
Railway Variables:
BOT_TOKEN=...
ADMIN_ID=...
API_ID=...
API_HASH=...
CARD_NUMBER=...
STARS_TO_UZS=140
```

Start command: `node bot.js`
