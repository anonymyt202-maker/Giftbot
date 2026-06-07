require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);
const STARS_TO_UZS = Number(process.env.STARS_TO_UZS || 140);
const SENDGIFT_URL = process.env.SENDGIFT_URL || 'http://127.0.0.1:4242';
const SENDGIFT_SECRET = process.env.SENDGIFT_SECRET || 'supersecretkey';

const GIFTS_FILE = path.join(__dirname, 'gifts.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

const bot = new Telegraf(BOT_TOKEN);
const userStates = {};

let config = { starsBuyPrice: 200, starsSellPrice: 130 };

async function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
async function safeWriteJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function formatUzs(amount) {
  return Number(amount || 0).toLocaleString('uz-UZ') + ' UZS';
}
function formatStars(amount) {
  return `${Number(amount || 0)} ⭐`;
}

async function initFiles() {
  try { await fs.access(CONFIG_FILE); } catch { await safeWriteJson(CONFIG_FILE, config); }
  try { await fs.access(USERS_FILE); } catch { await safeWriteJson(USERS_FILE, []); }
  try { await fs.access(GIFTS_FILE); } catch { await safeWriteJson(GIFTS_FILE, []); }
  const savedConfig = await safeReadJson(CONFIG_FILE, config);
  config = { ...config, ...savedConfig };
}
async function getUsers() { return safeReadJson(USERS_FILE, []); }
async function saveUsers(users) { await safeWriteJson(USERS_FILE, users); }
async function getGifts() { return safeReadJson(GIFTS_FILE, []); }
async function saveGifts(gifts) { await safeWriteJson(GIFTS_FILE, gifts); }

async function getUser(userId) {
  const users = await getUsers();
  return users.find(u => Number(u.userId) === Number(userId)) || null;
}
async function ensureUser(from) {
  const users = await getUsers();
  const idx = users.findIndex(u => Number(u.userId) === Number(from.id));
  if (idx !== -1) return users[idx];
  const user = {
    userId: Number(from.id),
    username: from.username || null,
    stars: 0,
    uzs: 0,
    invitedBy: null,
    joinedAt: new Date().toISOString()
  };
  users.push(user);
  await saveUsers(users);
  return user;
}
async function addStars(userId, amount) {
  const users = await getUsers();
  const idx = users.findIndex(u => Number(u.userId) === Number(userId));
  if (idx === -1) return false;
  users[idx].stars = Math.max(0, Number(users[idx].stars || 0) + Number(amount || 0));
  await saveUsers(users);
  return true;
}
async function deductStars(userId, amount) {
  const users = await getUsers();
  const idx = users.findIndex(u => Number(u.userId) === Number(userId));
  if (idx === -1) return false;
  const cur = Number(users[idx].stars || 0);
  if (cur < Number(amount || 0)) return false;
  users[idx].stars = cur - Number(amount || 0);
  await saveUsers(users);
  return true;
}
async function addUzs(userId, amount) {
  const users = await getUsers();
  const idx = users.findIndex(u => Number(u.userId) === Number(userId));
  if (idx === -1) return false;
  users[idx].uzs = Math.max(0, Number(users[idx].uzs || 0) + Number(amount || 0));
  await saveUsers(users);
  return true;
}

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎁 Giftlar', callback_data: 'gifts_menu' }],
        [
          { text: '💼 Hisobim', callback_data: 'balance_menu' },
          { text: '👥 Referal', callback_data: 'referral_menu' }
        ],
        [{ text: '🔐 Telegram akkaunt ulash', callback_data: 'connect_tg' }]
      ]
    }
  };
}
function balanceMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Stars → UZS', callback_data: 'convert_stars_uzs' }],
        [{ text: '⬅️ Bosh menyu', callback_data: 'main_menu' }]
      ]
    }
  };
}
function giftsMenu(gifts) {
  const rows = gifts.map(g => ([{ text: `${g.name} — ${g.price} ⭐`, callback_data: `gift_${g.id}` }]));
  rows.push([{ text: '⬅️ Bosh menyu', callback_data: 'main_menu' }]);
  return { reply_markup: { inline_keyboard: rows } };
}
function adminMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Statistika', callback_data: 'admin_stats' }],
        [{ text: '➕ Gift qo‘shish', callback_data: 'admin_addgift' }],
        [{ text: '🔐 Telegram akkaunt ulash', callback_data: 'connect_tg' }],
        [{ text: '⬅️ Bosh menyu', callback_data: 'main_menu' }]
      ]
    }
  };
}

async function tgHealth() {
  try {
    const resp = await axios.get(`${SENDGIFT_URL}/health`, {
      headers: { 'X-Secret': SENDGIFT_SECRET },
      timeout: 15000
    });
    return resp.data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
async function startAuth(phone) {
  const resp = await axios.post(`${SENDGIFT_URL}/auth/start`, { phone }, {
    headers: { 'X-Secret': SENDGIFT_SECRET, 'Content-Type': 'application/json' },
    timeout: 45000
  });
  return resp.data;
}
async function submitCode(code) {
  const resp = await axios.post(`${SENDGIFT_URL}/auth/code`, { code }, {
    headers: { 'X-Secret': SENDGIFT_SECRET, 'Content-Type': 'application/json' },
    timeout: 45000
  });
  return resp.data;
}
async function submitPassword(password) {
  const resp = await axios.post(`${SENDGIFT_URL}/auth/password`, { password }, {
    headers: { 'X-Secret': SENDGIFT_SECRET, 'Content-Type': 'application/json' },
    timeout: 45000
  });
  return resp.data;
}
async function sendGift(recipient, giftId, anonymous = false, message = '') {
  const resp = await axios.post(`${SENDGIFT_URL}/sendgift`, {
    recipient,
    gift_id: giftId,
    anonymous,
    message
  }, {
    headers: { 'X-Secret': SENDGIFT_SECRET, 'Content-Type': 'application/json' },
    timeout: 45000
  });
  return resp.data;
}

bot.start(async (ctx) => {
  await ensureUser(ctx.from);
  await ctx.reply(
    '🎁 Gift botga xush kelibsiz!',
    mainMenu()
  );
});

bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('❌ Faqat admin!');
  const status = await tgHealth();
  await ctx.reply(
    `⚙️ <b>Admin panel</b>\n\n` +
    `📡 TG servis: ${status.ok ? (status.authorized ? 'ulangan' : 'ulanish kutilyapti') : 'xato'}\n` +
    `💱 1 Stars = ${STARS_TO_UZS} UZS`,
    { parse_mode: 'HTML', ...adminMenu() }
  );
});

bot.action('main_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('🏠 Bosh menyu', mainMenu()).catch(() => {});
});
bot.action('balance_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const user = await ensureUser(ctx.from);
  await ctx.reply(
    `💼 <b>Hisobingiz</b>\n\n⭐ Stars: <b>${user.stars || 0}</b>\n💵 UZS: <b>${formatUzs(user.uzs || 0)}</b>`,
    { parse_mode: 'HTML', ...balanceMenu() }
  );
});
bot.action('referral_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply('👥 Referal tizimi tayyor. Keyingi bosqichda ulash mumkin.', mainMenu()).catch(() => {});
});
bot.action('gifts_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const gifts = await getGifts();
  if (!gifts.length) return ctx.reply('❌ Hozircha giftlar yo‘q.', mainMenu());
  await ctx.reply('🎁 Giftni tanlang:', giftsMenu(gifts)).catch(() => {});
});
bot.action('convert_stars_uzs', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const user = await ensureUser(ctx.from);
  const stars = Number(user.stars || 0);
  if (stars <= 0) return ctx.reply('❌ Sizda Stars yo‘q.', balanceMenu());
  const uzs = stars * STARS_TO_UZS;
  await deductStars(ctx.from.id, stars);
  await addUzs(ctx.from.id, uzs);
  await ctx.reply(`✅ ${stars} ⭐ -> ${formatUzs(uzs)} ga aylantirildi.`, balanceMenu()).catch(() => {});
});

bot.action(/^gift_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const giftId = String(ctx.match[1]);
  const gifts = await getGifts();
  const gift = gifts.find(g => String(g.id) === giftId);
  if (!gift) return ctx.reply('❌ Gift topilmadi.', mainMenu());
  userStates[ctx.from.id] = {
    step: 'gift_recipient',
    giftId: gift.id,
    giftName: gift.name,
    giftPrice: Number(gift.price || 0),
    giftTelegramId: gift.telegramId || null
  };
  return ctx.reply(
    `🎁 <b>${escapeHtml(gift.name)}</b>\n💰 Narx: <b>${gift.price} ⭐</b>\n\nQabul qiluvchi username yuboring.\nMasalan: @username\nO'zingizga yuborish uchun: <code>me</code>`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

bot.action('connect_tg', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('❌ Faqat admin ulashi mumkin.');
  }
  userStates[ctx.from.id] = { step: 'tg_phone' };
  return ctx.reply('📱 Telegram akkaunt telefon raqamini yuboring.\nMasalan: +998901234567', mainMenu());
});

bot.action('admin_stats', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.from.id !== ADMIN_ID) return;
  const users = await getUsers();
  const gifts = await getGifts();
  const status = await tgHealth();
  await ctx.reply(
    `📊 <b>Statistika</b>\n\n` +
    `👤 Foydalanuvchilar: <b>${users.length}</b>\n` +
    `🎁 Giftlar: <b>${gifts.length}</b>\n` +
    `📡 TG servis: <b>${status.ok ? 'OK' : 'XATO'}</b>`,
    { parse_mode: 'HTML', ...adminMenu() }
  ).catch(() => {});
});

bot.action('admin_addgift', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.from.id !== ADMIN_ID) return;
  userStates[ctx.from.id] = { step: 'addgift' };
  return ctx.reply('➕ Format: Nom|Stars|TelegramGiftID\nMisol: Rose|100|5168043015958052', adminMenu());
});

bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const text = (ctx.message.text || '').trim();
    const state = userStates[userId] || {};

    if (state.step === 'tg_phone') {
      const resp = await startAuth(text);
      if (!resp.ok) return ctx.reply(`❌ Login boshlanmadi: ${escapeHtml(resp.error || 'xato')}`);
      userStates[userId] = { step: 'tg_code' };
      return ctx.reply('📩 Kod yuborildi. Telegramdan kelgan kodni yozing.');
    }

    if (state.step === 'tg_code') {
      const resp = await submitCode(text.replace(/\s+/g, ''));
      if (!resp.ok) {
        if (resp.need_password) {
          userStates[userId] = { step: 'tg_password' };
          return ctx.reply('🔐 2FA parolini yuboring.');
        }
        return ctx.reply(`❌ Kod xato: ${escapeHtml(resp.error || 'xato')}`);
      }
      userStates[userId] = {};
      return ctx.reply('✅ Telegram akkaunt ulandi.', mainMenu());
    }

    if (state.step === 'tg_password') {
      const resp = await submitPassword(text);
      if (!resp.ok) return ctx.reply(`❌ Parol xato: ${escapeHtml(resp.error || 'xato')}`);
      userStates[userId] = {};
      return ctx.reply('✅ Telegram akkaunt ulandi.', mainMenu());
    }

    if (state.step === 'gift_recipient') {
      const recipient = text === 'me' ? (ctx.from.username ? `@${ctx.from.username}` : ctx.from.id) : text;
      const user = await ensureUser(ctx.from);
      const giftPrice = Number(state.giftPrice || 0);
      if ((user.stars || 0) < giftPrice) {
        userStates[userId] = {};
        return ctx.reply(`❌ Balans yetarli emas. Sizda ${user.stars || 0} ⭐ bor.`, mainMenu());
      }
      userStates[userId] = {
        ...state,
        step: 'gift_anonymous',
        recipient
      };
      return ctx.reply('Gift anonim bo‘lsinmi? "ha" yoki "yoq" deb yozing.');
    }

    if (state.step === 'gift_anonymous') {
      const yes = /^(ha|yes|y|1|true)$/i.test(text);
      const no = /^(yoq|no|n|0|false)$/i.test(text);
      if (!yes && !no) return ctx.reply('Iltimos "ha" yoki "yoq" deb yozing.');
      const anonymous = yes;
      const user = await ensureUser(ctx.from);
      const giftPrice = Number(state.giftPrice || 0);
      if ((user.stars || 0) < giftPrice) {
        userStates[userId] = {};
        return ctx.reply('❌ Balans yetarli emas.', mainMenu());
      }
      await deductStars(userId, giftPrice);

      const res = await sendGift(state.recipient, state.giftTelegramId || state.giftId, anonymous, '');
      if (!res.ok) {
        await addStars(userId, giftPrice);
        userStates[userId] = {};
        return ctx.reply(`❌ Gift yuborilmadi: ${escapeHtml(res.error || 'xato')}`, mainMenu());
      }

      userStates[userId] = {};
      return ctx.reply(
        `✅ <b>Gift yuborildi!</b>\n\n🎁 ${escapeHtml(state.giftName)}\n👤 Qabul qiluvchi: <code>${escapeHtml(state.recipient)}</code>`,
        { parse_mode: 'HTML', ...mainMenu() }
      );
    }

    if (state.step === 'addgift' && userId === ADMIN_ID) {
      const parts = text.split('|').map(s => s.trim());
      if (parts.length < 2) return ctx.reply('❌ Format: Nom|Stars|TelegramGiftID');
      const [name, starsRaw, telegramId] = parts;
      const price = parseInt(starsRaw, 10);
      if (!name || !Number.isFinite(price) || price <= 0) return ctx.reply('❌ Narx noto‘g‘ri.');
      const gifts = await getGifts();
      const gift = { id: String(Date.now()), name, price, telegramId: telegramId || null };
      gifts.push(gift);
      await saveGifts(gifts);
      userStates[userId] = {};
      return ctx.reply(`✅ Gift qo‘shildi: ${gift.name} (${gift.price} ⭐)`, adminMenu());
    }

  } catch (err) {
    console.error(err);
    try { await ctx.reply('❌ Xatolik yuz berdi.'); } catch {}
  }
});

bot.catch((err) => {
  console.error('Bot xatosi:', err);
});

async function main() {
  await initFiles();
  await bot.launch();
  const me = await bot.telegram.getMe();
  console.log(`✅ Bot ishga tushdi: @${me.username}`);
}

main().catch(err => {
  console.error('Main error:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
