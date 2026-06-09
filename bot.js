'use strict';
// ═══════════════════════════════════════════════════════════════
//  GIFT BOT v5
//  - Gift: GramJS orqali (invoice YO'Q), izohli/izohsiz
//  - Bir martalik claim link
//  - Stars ↔ UZS convert
//  - UZS depozit: karta + chek
//  - Stars depozit: XTR invoice
//  - Gift narxi edit qilish
//  - Premium emoji qo'llab-quvvatlash (gift nomida)
//  - User bot bilan chat ochmagan bo'lsa ogohlantirish
//  - /getusers, /getgifts buyruqlari (Railway uchun)
//  - O'yinlar | Referral | Admin panel
// ═══════════════════════════════════════════════════════════════
require('dotenv').config();
const { Telegraf }       = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { Api }            = require('telegram');
const axios              = require('axios');
const fs                 = require('fs').promises;
const path               = require('path');

// ─── CONFIG ────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const ADMIN_ID     = Number(process.env.ADMIN_ID    || 0);
const API_ID       = Number(process.env.API_ID      || 0);
const API_HASH     =        process.env.API_HASH     || '';
const CARD_NUMBER  =        process.env.CARD_NUMBER  || '5614681256483730';
const STARS_TO_UZS = Number(process.env.STARS_TO_UZS || 140);

const DB = {
    users   : path.join(__dirname, 'users.json'),
    gifts   : path.join(__dirname, 'gifts.json'),
    deposits: path.join(__dirname, 'deposits.json'),
    channels: path.join(__dirname, 'channels.json'),
    session : path.join(__dirname, 'tg_session.json'),
    claims  : path.join(__dirname, 'used_claims.json'),
};

let REFERRAL_REWARD = 2;
const REFERRAL_PCT  = 2;
const DAILY_MS      = 864e5;
const SLOT_JP       = 64;
const SLOT_LEM      = 1;
const THREE_SAME    = new Set([1, 22, 43, 64]);

const bot = new Telegraf(BOT_TOKEN);
const ST  = {};

// ─── GRAMJS ────────────────────────────────────────────────────
let tgClient    = null;
let tgConnected = false;

async function sessionLoad() {
    try { return (JSON.parse(await fs.readFile(DB.session, 'utf-8'))).session || ''; }
    catch { return ''; }
}
async function sessionSave(s) {
    await fs.writeFile(DB.session, JSON.stringify({ session: s }, null, 2));
}
async function tgInit(str = '') {
    try {
        tgClient = new TelegramClient(new StringSession(str), API_ID, API_HASH,
            { connectionRetries: 5, useWSS: false });
        await tgClient.connect();
        if (await tgClient.isUserAuthorized()) {
            tgConnected = true;
            await sessionSave(tgClient.session.save());
            const me = await tgClient.getMe();
            console.log(`✅ TG hisob: @${me.username}`);
            return true;
        }
    } catch (e) { console.error('tgInit:', e.message); }
    tgConnected = false;
    return false;
}

// Gift yuborish: izohli yoki izohsiz
async function sendGiftGramJS(toUserId, tgGiftId, anonymous = false, message = null) {
    if (!tgClient || !tgConnected) return { ok: false, error: 'TG hisob ulanmagan' };
    try {
        let peer;
        try {
            peer = await tgClient.getInputEntity(Number(toUserId));
        } catch {
            return { ok: false, error: `Foydalanuvchi (${toUserId}) topilmadi. iltimos @it_d_user ga xabar yuborib qo'ying va qayta gift sotib oling.` };
        }

        // Izoh ob'ekti
        let msgObj = null;
        if (message && message.trim()) {
            msgObj = new Api.TextWithEntities({
                text    : message.trim(),
                entities: [],
            });
        }

        const invoice = new Api.InputInvoiceStarGift({
            peer,
            giftId        : BigInt(String(tgGiftId)),
            hideName      : anonymous,
            includeUpgrade: false,
            message       : msgObj,
        });

        const form = await tgClient.invoke(new Api.payments.GetPaymentForm({ invoice }));
        await tgClient.invoke(new Api.payments.SendStarsForm({ formId: form.formId, invoice }));

        console.log(`✅ Gift: giftId=${tgGiftId} → userId=${toUserId}`);
        return { ok: true, error: null };
    } catch (e) {
        console.error('sendGiftGramJS:', e.message);
        // USER_NOT_FOUND yoki PEER_ID_INVALID — bot bilan chatga kirmagan
        if (e.message.includes('USER_NOT_FOUND') || e.message.includes('PEER_ID_INVALID') || e.message.includes('USER_PRIVACY')) {
            return { ok: false, error: 'user_not_started' };
        }
        if (e.message.includes('BALANCE_TOO_LOW')) {
            return { ok: false, error: 'balance_too_low' };
        }
        return { ok: false, error: e.message };
    }
}

async function computeSrp(pwdInfo, password) {
    const { computeCheck } = require('telegram/Password');
    return computeCheck(pwdInfo, password);
}

// ─── UTIL ──────────────────────────────────────────────────────
const rj   = async (fp, fb) => { try { return JSON.parse(await fs.readFile(fp, 'utf-8')); } catch { return fb; } };
const wj   = async (fp, v)  => fs.writeFile(fp, JSON.stringify(v, null, 2));
const esc  = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fUzs = n => Number(n || 0).toLocaleString('uz-UZ') + ' UZS';
const tmeUrl = u => {
    const t = String(u || '').trim();
    if (!t) return '';
    if (t.startsWith('https://t.me/')) return t;
    if (t.startsWith('t.me/'))  return `https://t.me/${t.slice(5)}`;
    if (t.startsWith('@'))      return `https://t.me/${t.slice(1)}`;
    if (/^[A-Za-z0-9_]{5,32}$/.test(t)) return `https://t.me/${t}`;
    return t;
};
const remStr = ms => { const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4); return `${h} soat ${m} daqiqa`; };
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// ─── DATABASE ──────────────────────────────────────────────────
const getUsers     = () => rj(DB.users,    []);
const saveUsers    = u  => wj(DB.users,    u);
const getGifts     = () => rj(DB.gifts,    []);
const saveGifts    = g  => wj(DB.gifts,    g);
const getDeposits  = () => rj(DB.deposits, []);
const saveDeposits = d  => wj(DB.deposits, d);
const getChannels  = () => rj(DB.channels, []);
const saveChannels = c  => wj(DB.channels, c);
const getClaims    = () => rj(DB.claims,   {});
const saveClaims   = c  => wj(DB.claims,   c);

async function getUser(id) {
    const u = await getUsers();
    return u.find(x => Number(x.userId) === Number(id)) || null;
}
async function upsertUser(id, patch) {
    const u = await getUsers(), i = u.findIndex(x => Number(x.userId) === Number(id));
    if (i === -1) return false;
    u[i] = { ...u[i], ...patch }; await saveUsers(u); return true;
}
async function addUser(id, username) {
    const u = await getUsers();
    if (u.find(x => Number(x.userId) === Number(id))) return false;
    u.push({
        userId: Number(id), username,
        stars: 0, uzs: 0,
        invitedBy: null, referralRewarded: false,
        lastDailyBonusAt: null, lastSlotsAt: null,
        joinedAt: new Date().toISOString(),
    });
    await saveUsers(u); return true;
}
async function addStars(id, n) {
    const u = await getUsers(), i = u.findIndex(x => Number(x.userId) === Number(id));
    if (i === -1) return false;
    u[i].stars = Math.max(0, Number(u[i].stars || 0) + Number(n || 0));
    await saveUsers(u); return true;
}
async function deductStars(id, n) {
    const u = await getUsers(), i = u.findIndex(x => Number(x.userId) === Number(id));
    if (i === -1) return false;
    const cur = Number(u[i].stars || 0); if (cur < n) return false;
    u[i].stars = cur - Number(n); await saveUsers(u); return true;
}
async function getStars(id) { const u = await getUser(id); return Number(u?.stars || 0); }
async function addUzs(id, n) {
    const u = await getUsers(), i = u.findIndex(x => Number(x.userId) === Number(id));
    if (i === -1) return false;
    u[i].uzs = Math.max(0, Number(u[i].uzs || 0) + Number(n || 0));
    await saveUsers(u); return true;
}
async function deductUzs(id, n) {
    const u = await getUsers(), i = u.findIndex(x => Number(x.userId) === Number(id));
    if (i === -1) return false;
    const cur = Number(u[i].uzs || 0); if (cur < n) return false;
    u[i].uzs = cur - Number(n); await saveUsers(u); return true;
}
async function getUzs(id) { const u = await getUser(id); return Number(u?.uzs || 0); }

// Claim link: bir martalik
// claimKey = "giftId_senderId" => { usedBy: userId, usedAt: iso }
async function isClaimUsed(claimKey) {
    const claims = await getClaims();
    return !!claims[claimKey];
}
async function markClaimUsed(claimKey, userId) {
    const claims = await getClaims();
    claims[claimKey] = { usedBy: Number(userId), usedAt: new Date().toISOString() };
    await saveClaims(claims);
}

async function initDB() {
    for (const [fp, fb] of [
        [DB.users, []], [DB.gifts, []], [DB.deposits, []],
        [DB.channels, []], [DB.claims, {}],
    ]) {
        try { await fs.access(fp); } catch { await wj(fp, fb); }
    }
}

// ─── OBUNA ─────────────────────────────────────────────────────
async function isSubscribed(userId) {
    try {
        const chs = await getChannels(); if (!chs.length) return true;
        for (const ch of chs) {
            const handle = String(ch).startsWith('@') ? ch : `@${ch}`;
            try {
                const m = await bot.telegram.getChatMember(handle, userId);
                if (!['member','administrator','creator','restricted'].includes(m.status)) return false;
            } catch { return false; }
        }
        return true;
    } catch { return true; }
}
async function subsKb() {
    const chs  = await getChannels();
    const rows = chs.filter(Boolean).map(ch => [{ text:`📢 ${ch}`, url: tmeUrl(ch) }]);
    rows.push([{ text:'✅ Tekshirish', callback_data:'check_subs' }]);
    return rows;
}

// ─── REFERRAL ──────────────────────────────────────────────────
async function grantReferral(userId) {
    const u = await getUsers(), i = u.findIndex(x => Number(x.userId) === Number(userId));
    if (i === -1 || !u[i].invitedBy || u[i].referralRewarded) return false;
    u[i].referralRewarded = true; await saveUsers(u);
    await addStars(u[i].invitedBy, REFERRAL_REWARD);
    try { await bot.telegram.sendMessage(u[i].invitedBy, `🎉 Referal: <b>+${REFERRAL_REWARD} ⭐</b>`, { parse_mode:'HTML' }); } catch {}
    return true;
}
async function setReferrer(userId, refId) {
    const u = await getUsers(), i = u.findIndex(x => Number(x.userId) === Number(userId));
    if (i === -1 || u[i].invitedBy) return;
    u[i].invitedBy = Number(refId); await saveUsers(u);
}

// ─── NOTIFY ADMIN ──────────────────────────────────────────────
async function notifyAdmin(text) {
    try { await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode:'HTML' }); } catch {}
}

// ─── KLAVIATURALAR ─────────────────────────────────────────────
const KB = {
    main: () => ({ reply_markup: { inline_keyboard: [
        [{ text:'🎁 Gift sotib olish', callback_data:'buy_gift' }],
        [{ text:'💼 Hisobim', callback_data:'balance' }, { text:'👥 Referal', callback_data:'referral' }],
        [{ text:'🎮 O\'yinlar', callback_data:'games' }],
    ]}}),

    balance: () => ({ reply_markup: { inline_keyboard: [
        [{ text:'💵 Pul kiritish (UZS)', callback_data:'dep_uzs'        }],
        [{ text:'⭐ Stars kiritish',     callback_data:'dep_stars'       }],
        [{ text:'🔄 Stars → UZS',        callback_data:'conv_stars_uzs'  }],
        [{ text:'🔄 UZS → Stars',        callback_data:'conv_uzs_stars'  }],
        [{ text:'⬅️ Bosh menyu',         callback_data:'main'            }],
    ]}}),

    games: () => ({ reply_markup: { inline_keyboard: [
        [{ text:'🎲 Zar',callback_data:'game_dice'},{text:'⚽ Futbol',callback_data:'game_football'},{text:'🏀 Basketbol',callback_data:'game_basketball'}],
        [{ text:'🎯 Darts',callback_data:'game_darts'},{text:'🎰 Slotlar',callback_data:'game_slots'}],
        [{ text:'📥 Stars kiritish',callback_data:'dep_stars'},{text:'💸 Yechish',callback_data:'withdraw'}],
        [{ text:'🎁 Kunlik bonus',callback_data:'daily'}],
        [{ text:'⬅️ Bosh menyu',callback_data:'main'}],
    ]}}),

    bet: g => ({ reply_markup: { inline_keyboard: [
        [{text:'1 ⭐',callback_data:`bet_${g}_1`},{text:'5 ⭐',callback_data:`bet_${g}_5`},{text:'10 ⭐',callback_data:`bet_${g}_10`}],
        [{text:'25 ⭐',callback_data:`bet_${g}_25`},{text:'50 ⭐',callback_data:`bet_${g}_50`},{text:'100 ⭐',callback_data:`bet_${g}_100`}],
        [{text:'✏️ Boshqa',callback_data:`bet_${g}_custom`},{text:'⬅️ Orqaga',callback_data:'games'}],
    ]}}),

    admin: () => {
        const st = tgConnected ? '🟢 Ulangan' : '🔴 Ulanmagan';
        return { reply_markup: { inline_keyboard: [
            [{ text:`📱 TG hisob: ${st}`, callback_data:'adm_tg' }],
            [{ text:'📊 Statistika',      callback_data:'adm_stats'    }, { text:'📢 Broadcast',      callback_data:'adm_bc'      }],
            [{ text:'🎁 Gift qo\'shish',  callback_data:'adm_addgift'  }, { text:'🗑 Gift o\'chirish',  callback_data:'adm_rmgift'  }],
            [{ text:'✏️ Gift narxi edit', callback_data:'adm_editgift' }],
            [{ text:'📺 Kanal qo\'shish', callback_data:'adm_addch'    }, { text:'❌ Kanal o\'chirish', callback_data:'adm_rmch'    }],
            [{ text:'📨 UZS so\'rovlar',  callback_data:'adm_deps'     }, { text:'👤 Foydalanuvchi',   callback_data:'adm_users'   }],
            [{ text:'📥 /getusers — JSON yuklab olish', callback_data:'adm_dl_users' }],
            [{ text:'📥 /getgifts — JSON yuklab olish', callback_data:'adm_dl_gifts' }],
            [{ text:'⬅️ Bosh menyu',      callback_data:'main'         }],
        ]}};
    },
};

// ─── STARS INVOICE (faqat depozit uchun) ───────────────────────
async function sendStarsInvoice(ctx, amount) {
    const userId = ctx.from.id;
    await ctx.replyWithInvoice({
        title          : `⭐ ${amount} Stars kiritish`,
        description    : `Hisobingizga ${amount} Telegram Stars qo'shiladi`,
        payload        : JSON.stringify({ action:'stars_dep', amount, user_id: userId }),
        provider_token : '',
        currency       : 'XTR',
        prices         : [{ label:`${amount} Stars`, amount }],
        start_parameter: 'stars_dep',
        need_name: false, need_phone_number: false, need_email: false, need_shipping_address: false,
    });
}

// ─── GIFT SOTIB OLISH (to'g'ridan GramJS) ──────────────────────
async function processBuyGift(ctx, gift, opts = {}) {
    const userId   = ctx.from.id;
    const price    = Number(gift.price);
    const payWith  = opts.payWith || 'stars';
    const targetId = opts.friendId || userId;

    // Balans tekshirish
    if (payWith === 'stars') {
        const bal = await getStars(userId);
        if (bal < price) {
            return ctx.reply(
                `❌ <b>Stars yetarli emas!</b>\n\n💰 Narx: <b>${price} ⭐</b>\n💎 Sizda: <b>${bal} ⭐</b>\n📉 Yetishmaydi: <b>${price - bal} ⭐</b>`,
                { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
                    [{ text:'⭐ Stars kiritish', callback_data:'dep_stars' }],
                    [{ text:'⬅️ Orqaga', callback_data:'buy_gift' }],
                ]}}
            );
        }
    } else {
        const uzsPrice = price * STARS_TO_UZS;
        const bal = await getUzs(userId);
        if (bal < uzsPrice) {
            return ctx.reply(
                `❌ <b>UZS yetarli emas!</b>\n\n💰 Narx: <b>${fUzs(uzsPrice)}</b>\n💵 Sizda: <b>${fUzs(bal)}</b>\n📉 Yetishmaydi: <b>${fUzs(uzsPrice - bal)}</b>`,
                { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
                    [{ text:'💵 Pul kiritish', callback_data:'dep_uzs' }],
                    [{ text:'⬅️ Orqaga', callback_data:'buy_gift' }],
                ]}}
            );
        }
    }

    if (!tgConnected) {
        return ctx.reply(
            `❌ <b>Telegram hisob ulanmagan!</b>\n\nAdmin TG hisobni ulashi kerak.`,
            { parse_mode:'HTML', ...KB.main() }
        );
    }

    // Havola orqali do'stga
    if (opts.viaLink) {
        if (payWith === 'stars') await deductStars(userId, price);
        else await deductUzs(userId, price * STARS_TO_UZS);
        const bi   = await bot.telegram.getMe();
        const ap   = opts.anonymous ? 'anon' : 'pub';
        const link = `https://t.me/${bi.username}?start=claim_${gift.id}_${userId}_${ap}`;
        await notifyAdmin(`🎁 <b>Gift havola yaratildi</b>\nGift: ${gift.name}\nUser: <code>${userId}</code>`);
        return ctx.reply(
            `✅ <b>Havola tayyor!</b>\n\n🎁 <b>${gift.name}</b>\n\n🔗 Do'stingizga yuboring:\n${link}\n\n⚠️ Bu havola <b>bir marta</b> ishlatilishi mumkin!`,
            { parse_mode:'HTML', ...KB.main() }
        );
    }

    // Tasdiqlash oynasi
    const payDesc = payWith === 'stars'
        ? `⭐ <b>${price} Stars</b>`
        : `💵 <b>${fUzs(price * STARS_TO_UZS)}</b>`;
    const toDesc = opts.friendId ? `👤 Do'stga: <code>${opts.friendId}</code>` : `👤 O'zingizga`;
    const msgDesc = opts.message ? `\n💬 Izoh: <i>${esc(opts.message)}</i>` : '';

    ST[userId] = { ...ST[userId], pendingGift: { gift, opts } };

    await ctx.reply(
        `🎁 <b>Tasdiqlash</b>\n\n` +
        `🎀 Gift: <b>${gift.name}</b>\n` +
        `💰 To'lov: ${payDesc}\n` +
        `${toDesc}\n` +
        `🕵️ Anonim: ${opts.anonymous ? 'Ha' : 'Yo\'q'}` +
        msgDesc,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
            [{ text:'✅ Tasdiqlash', callback_data:'gconfirm_yes' }],
            [{ text:'❌ Bekor',      callback_data:'gconfirm_no'  }],
        ]}}
    );
}

// ─── O'YIN LOGIKASI ────────────────────────────────────────────
const calcDice = (v,b) => { if(v===6)return{win:b*2,msg:'🎉 6 tushdi! 2×!'}; if(v===5)return{win:Math.floor(b*1.5),msg:'🎊 5 tushdi! 1.5×!'}; if(v===4)return{win:b,msg:'🙂 4 tushdi. Qaytarildi.'}; if(v===3)return{win:Math.floor(b*0.5),msg:'😕 3 tushdi. Yarmi.'}; return{win:0,msg:`😢 ${v} tushdi. Yutqazdingiz!`}; };
const calcFoot = (v,b) => v>=3?{win:Math.floor(b*1.44),msg:'⚽ GOL! 1.44×!'}:{win:0,msg:'❌ Yutqazdingiz.'};
const calcBall = (v,b) => v>=4?{win:Math.floor(b*1.5),msg:'🏀 HIT! 1.5×!'}:{win:0,msg:'❌ Yutqazdingiz.'};
const calcDart = (v,b) => { if(v===6)return{win:b*2,msg:'🎯 MARKAZ! 2×!'}; if(v>=4)return{win:Math.floor(b*1.5),msg:'🎯 Yaqin! 1.5×!'}; return{win:0,msg:'❌ Yutqazdingiz.'}; };
const calcSlot = (v,b) => { if(v===SLOT_JP)return{win:b*5,bonus:0,msg:'🎰 777 JACKPOT! 5×! 🎉'}; if(v===SLOT_LEM)return{win:b*2,bonus:10,msg:'🍋🍋🍋 2× + 10⭐!'}; if(THREE_SAME.has(v))return{win:b*2,bonus:0,msg:'🎰 3 bir xil! 2×!'}; return{win:0,bonus:0,msg:'❌ Yutqazdingiz.'}; };
const GAMES = {
    dice      :{ name:'🎲 Zar',      emoji:'🎲', calc:calcDice, rule:'6→2× | 5→1.5× | 4→qaytarildi | 3→0.5× | 1-2→lost' },
    football  :{ name:'⚽ Futbol',   emoji:'⚽', calc:calcFoot, rule:'3-5→1.44× | 1-2→lost' },
    basketball:{ name:'🏀 Basketbol',emoji:'🏀', calc:calcBall, rule:'4-5→1.5× | 1-3→lost' },
    darts     :{ name:'🎯 Darts',    emoji:'🎯', calc:calcDart, rule:'6→2× | 4-5→1.5× | 1-3→lost' },
    slots     :{ name:'🎰 Slotlar',  emoji:'🎰', calc:calcSlot, rule:'777→5× | 🍋→2×+10⭐ | 3bir→2× | lost' },
};
async function playGame(ctx, game, bet) {
    const userId = ctx.from.id, stars = await getStars(userId);
    if (stars < bet) return ctx.reply(`❌ Yetarli emas! Sizda: ${stars} ⭐`, KB.games());
    if (game === 'slots') {
        const u = await getUser(userId), last = u?.lastSlotsAt ? new Date(u.lastSlotsAt).getTime() : 0, ela = Date.now() - last;
        if (ela < DAILY_MS) return ctx.reply(`⏰ Kunlik slotlar!\nKeyingi: <b>${remStr(DAILY_MS-ela)}</b>`, { parse_mode:'HTML', ...KB.games() });
        await upsertUser(userId, { lastSlotsAt: new Date().toISOString() });
    }
    await deductStars(userId, bet);
    const gi = GAMES[game];
    await ctx.reply(`🎮 <b>${gi.name}</b>\n💰 Tikish: ${bet} ⭐\n⏳ Natijani kuting...`, { parse_mode:'HTML' });
    const dm = await ctx.replyWithDice({ emoji: gi.emoji }), value = dm.dice.value;
    const res = gi.calc(value, bet), win = res.win||0, bonus = res.bonus||0, total = win+bonus;
    if (total > 0) await addStars(userId, total);
    const nb = await getStars(userId), net = total - bet;
    await sleep(3500);
    await ctx.reply(
        `🎮 <b>${gi.name} natijasi</b>\n\n🎲 Zar: <b>${value}</b>\n${res.msg}\n\n` +
        `💰 Tikish: ${bet} ⭐\n`+(win>0?`🏆 Yutish: +${win} ⭐\n`:'')+
        (bonus>0?`🎁 Bonus: +${bonus} ⭐\n`:'')+
        `📊 O'zgarish: <b>${net>=0?'+':''}${net} ⭐</b>\n💎 Balans: <b>${nb} ⭐</b>`,
        { parse_mode:'HTML', ...KB.games() }
    );
}

// ═══════════════════════════════════════════════════════════════
//  HANDLERS
// ═══════════════════════════════════════════════════════════════

// ─── /start ────────────────────────────────────────────────────
bot.start(async ctx => {
    try {
        const userId   = ctx.from.id;
        const username = ctx.from.username ? `@${ctx.from.username}` : 'no_username';
        const args     = ctx.startPayload || '';
        const isNew    = await addUser(userId, username);
        if (!ST[userId]) ST[userId] = {};

        const ok = await isSubscribed(userId);
        if (!ok) {
            if (args && /^\d+$/.test(args)) await setReferrer(userId, Number(args));
            return ctx.reply('📢 Botdan foydalanish uchun kanallarga obuna bo\'ling!',
                { reply_markup: { inline_keyboard: await subsKb() } });
        }
        if (args && /^\d+$/.test(args) && Number(args) !== userId) await setReferrer(userId, Number(args));

        // ── Claim link: claim_GIFTID_SENDERID_anon|pub ──
        if (args.startsWith('claim_')) {
            const parts     = args.split('_');
            const giftId    = parts[1];
            const senderId  = Number(parts[2]);
            const anon      = parts[3] === 'anon';
            const claimKey  = `${giftId}_${senderId}`;

            // Bir martalik tekshirish
            const used = await isClaimUsed(claimKey);
            if (used) {
                return ctx.reply(
                    `⛔ <b>Bu havola allaqachon ishlatilgan!</b>\n\nHar bir havola faqat bir marta ishlatilishi mumkin.`,
                    { parse_mode:'HTML', ...KB.main() }
                );
            }

            const gifts = await getGifts();
            const gift  = gifts.find(g => String(g.id) === giftId);
            if (!gift) return ctx.reply('❌ Gift topilmadi!');

            const sender = await getUser(senderId);
            const sName  = anon ? '🕵️ Anonim' : (sender?.username || `User #${senderId}`);

            await ctx.reply(
                `🎁 <b>Sizga sovg'a!</b>\nKim: <b>${sName}</b>\nGift: <b>${gift.name}</b>\n\n⏳ Yuborilmoqda...`,
                { parse_mode:'HTML' }
            );

            const res = await sendGiftGramJS(userId, gift.telegramId || gift.id, anon);

            if (res.ok) {
                // Linkni bir marta ishlatilgan deb belgilash
                await markClaimUsed(claimKey, userId);
                await ctx.reply(
                    `✅ <b>Gift yuborildi!</b>\n🎁 ${gift.name}\n💝 ${sName} tomonidan`,
                    { parse_mode:'HTML', ...KB.main() }
                );
            } else if (res.error === 'user_not_started') {
                return ctx.reply(
                    `❌ <b>Xato!</b>\n\nGift yuborish uchun siz avval bot bilan chat ochgan bo'lishingiz kerak.\n\nBot bilan bir marta /start bosing, so'ng havolani qaytadan oching.`,
                    { parse_mode:'HTML' }
                );
            } else {
                return ctx.reply(`❌ Xato: ${res.error}`, KB.main());
            }
            return;
        }

        if (isNew) await notifyAdmin(
            `👤 <b>Yangi foydalanuvchi!</b>\n\n🆔 <code>${userId}</code>\n📛 ${esc(username)}\nIsm: ${esc(ctx.from.first_name||'')} ${esc(ctx.from.last_name||'')}\n📅 ${new Date().toLocaleString('uz-UZ')}`
        );
        await grantReferral(userId);
        const s = await getStars(userId), u = await getUzs(userId);
        await ctx.reply(
            `🎁 <b>Sovg'alar Dunyosi</b>\n\n💼 <b>Hisobingiz:</b>\n   ⭐ Stars: <b>${s}</b>\n   💵 UZS: <b>${fUzs(u)}</b>`,
            { parse_mode:'HTML', ...KB.main() }
        );
    } catch(e) { console.error('/start:', e); }
});

// ─── Obuna ─────────────────────────────────────────────────────
bot.action('check_subs', async ctx => {
    await ctx.answerCbQuery();
    if (!await isSubscribed(ctx.from.id)) return ctx.reply('❌ Hali obuna bo\'lmagansiz!', { reply_markup:{ inline_keyboard: await subsKb() } });
    await grantReferral(ctx.from.id);
    await ctx.reply('✅ <b>Xush kelibsiz!</b>', { parse_mode:'HTML', ...KB.main() });
});

// ─── Bosh menyu ────────────────────────────────────────────────
bot.action('main', async ctx => {
    await ctx.answerCbQuery();
    const s = await getStars(ctx.from.id), u = await getUzs(ctx.from.id);
    await ctx.reply(`🎁 <b>Sovg'alar Dunyosi</b>\n\n⭐ ${s} Stars\n💵 ${fUzs(u)}`, { parse_mode:'HTML', ...KB.main() });
});

// ─── Hisobim ───────────────────────────────────────────────────
bot.action('balance', async ctx => {
    await ctx.answerCbQuery();
    const s = await getStars(ctx.from.id), u = await getUzs(ctx.from.id);
    await ctx.reply(`💼 <b>Hisobim</b>\n\n⭐ Stars: <b>${s}</b>\n💵 UZS: <b>${fUzs(u)}</b>`, { parse_mode:'HTML', ...KB.balance() });
});

// ─── UZS depozit ───────────────────────────────────────────────
bot.action('dep_uzs', async ctx => {
    await ctx.answerCbQuery();
    ST[ctx.from.id] = { ...ST[ctx.from.id], step:'uzs_amount' };
    await ctx.reply(
        `💵 <b>Pul kiritish (UZS)</b>\n\n🏦 Karta:\n<code>${CARD_NUMBER}</code>\n\n📝 Qancha so'm yubormoqchisiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Orqaga', callback_data:'balance' }]] } }
    );
});

// ─── Stars depozit ─────────────────────────────────────────────
bot.action('dep_stars', async ctx => {
    await ctx.answerCbQuery();
    ST[ctx.from.id] = { ...ST[ctx.from.id], step:'stars_amount' };
    const s = await getStars(ctx.from.id), u = await getUzs(ctx.from.id);
    await ctx.reply(
        `⭐ <b>Stars kiritish</b>\n\n💼 Balans:\n   ⭐ ${s} Stars\n   💵 ${fUzs(u)}\n\nQancha Stars kiritmoqchisiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Orqaga', callback_data:'balance' }]] } }
    );
});

// ─── Stars → UZS ───────────────────────────────────────────────
bot.action('conv_stars_uzs', async ctx => {
    await ctx.answerCbQuery();
    const s = await getStars(ctx.from.id);
    if (s <= 0) return ctx.reply('❌ Sizda Stars yo\'q!', KB.balance());
    ST[ctx.from.id] = { ...ST[ctx.from.id], step:'conv_stars_uzs' };
    await ctx.reply(
        `🔄 <b>Stars → UZS</b>\n\n⭐ Sizda: <b>${s} Stars</b>\n💱 Kurs: 1 ⭐ = ${STARS_TO_UZS} UZS\n\nQancha Stars konvert qilasiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Bekor', callback_data:'balance' }]] } }
    );
});

// ─── UZS → Stars ───────────────────────────────────────────────
bot.action('conv_uzs_stars', async ctx => {
    await ctx.answerCbQuery();
    const u = await getUzs(ctx.from.id);
    if (u <= 0) return ctx.reply('❌ Sizda UZS yo\'q!', KB.balance());
    ST[ctx.from.id] = { ...ST[ctx.from.id], step:'conv_uzs_stars' };
    await ctx.reply(
        `🔄 <b>UZS → Stars</b>\n\n💵 Sizda: <b>${fUzs(u)}</b>\n💱 Kurs: ${STARS_TO_UZS} UZS = 1 ⭐\n📊 Max: <b>${Math.floor(u/STARS_TO_UZS)} ⭐</b>\n\nQancha Stars olmoqchisiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Bekor', callback_data:'balance' }]] } }
    );
});

// ─── Gift shop ─────────────────────────────────────────────────
bot.action('buy_gift', async ctx => {
    await ctx.answerCbQuery();
    const gifts = await getGifts();
    if (!gifts.length) return ctx.reply('⚠️ Hozircha gift yo\'q.', KB.main());
    const rows = gifts.map(g => [{
        text         : `${g.name} — ${g.price}⭐  (${fUzs(Number(g.price)*STARS_TO_UZS)})`,
        callback_data: `pick_${g.id}`,
    }]);
    rows.push([{ text:'⬅️ Bosh menyu', callback_data:'main' }]);
    await ctx.reply('🎁 <b>Sovg\'ani tanlang:</b>', { parse_mode:'HTML', reply_markup:{ inline_keyboard:rows } });
});

bot.action(/^pick_(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id, giftId = ctx.match[1];
    const gifts  = await getGifts(), gift = gifts.find(g => String(g.id) === giftId);
    if (!gift) return ctx.reply('❌ Gift topilmadi!');
    const s = await getStars(userId), u = await getUzs(userId);
    const uzsPrice = Number(gift.price) * STARS_TO_UZS;
    ST[userId] = { ...ST[userId], selGift: gift };
    await ctx.reply(
        `🎁 <b>${gift.name}</b>\n\n` +
        `💰 Narx: <b>${gift.price} ⭐</b>  |  <b>${fUzs(uzsPrice)}</b>\n\n` +
        `💼 Sizda:\n   ⭐ ${s} Stars ${s>=gift.price?'✅':'❌'}\n   💵 ${fUzs(u)} ${u>=uzsPrice?'✅':'❌'}\n\n` +
        `Qaysi balans bilan to'laysiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
            [{ text:`⭐ Stars bilan (${gift.price} ⭐)`, callback_data:'gpay_stars' }],
            [{ text:`💵 UZS bilan (${fUzs(uzsPrice)})`,  callback_data:'gpay_uzs'   }],
            [{ text:'⬅️ Orqaga', callback_data:'buy_gift' }],
        ]}}
    );
});

async function askDelivery(ctx) {
    const st = ST[ctx.from.id];
    if (!st?.selGift) return ctx.reply('❌ Qaytadan tanlang.', KB.main());
    await ctx.reply(
        `🎁 <b>${st.selGift.name}</b>\n\nQanday yubormoqchisiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
            [{ text:'👤 O\'zimga',              callback_data:'gdlv_self'    }],
            [{ text:'🎁 Do\'stga (username)',    callback_data:'gdlv_friend'  }],
            [{ text:'🔗 Havola orqali',          callback_data:'gdlv_link'    }],
            [{ text:'⬅️ Orqaga', callback_data:`pick_${st.selGift.id}` }],
        ]}}
    );
}

bot.action('gpay_stars', async ctx => { await ctx.answerCbQuery(); ST[ctx.from.id].payWith='stars'; await askDelivery(ctx); });
bot.action('gpay_uzs',   async ctx => { await ctx.answerCbQuery(); ST[ctx.from.id].payWith='uzs';   await askDelivery(ctx); });

// Yetkazish
bot.action('gdlv_self',   async ctx => { await ctx.answerCbQuery(); await askComment(ctx, 'self');   });
bot.action('gdlv_friend', async ctx => { await ctx.answerCbQuery(); const st=ST[ctx.from.id]; if(!st?.selGift)return; st.step='friend_username'; await ctx.reply('👤 Do\'stingiz @username ni yozing:'); });
bot.action('gdlv_link',   async ctx => { await ctx.answerCbQuery(); ST[ctx.from.id].viaLink=true; await askComment(ctx, 'link'); });

// Izoh tanlash
async function askComment(ctx, mode) {
    ST[ctx.from.id]._commentMode = mode;
    await ctx.reply('💬 <b>Izoh qo\'shmoqchimisiz?</b>', { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
        [{ text:'🔇 Izohsiz',    callback_data:'gcmt_no'  }],
        [{ text:'💬 Izoh bilan', callback_data:'gcmt_yes' }],
    ]}});
}

bot.action('gcmt_no', async ctx => {
    await ctx.answerCbQuery();
    const st = ST[ctx.from.id];
    if (!st?.selGift) return ctx.reply('❌ Xato!', KB.main());
    st.message = null;
    await askAnon(ctx, st._commentMode || 'self');
});
bot.action('gcmt_yes', async ctx => {
    await ctx.answerCbQuery();
    const st = ST[ctx.from.id];
    if (!st?.selGift) return ctx.reply('❌ Xato!', KB.main());
    st.step = 'gift_message';
    await ctx.reply('✍️ Izohingizni yozing (max 255 harf):');
});

async function askAnon(ctx, mode) {
    const p = { self:'a', link:'al', friend:'af' }[mode] || 'a';
    await ctx.reply('👤 <b>Kimdan yuborilsin?</b>', { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
        [{ text:'🕵️ Anonim',  callback_data:`${p}_yes` }],
        [{ text:'👤 Ommaviy', callback_data:`${p}_no`  }],
    ]}});
}

// Anonim tanlash
bot.action(/^a_(yes|no)$/,  async ctx => { await ctx.answerCbQuery(); const st=ST[ctx.from.id]; if(!st?.selGift)return ctx.reply('❌ Xato!',KB.main()); await processBuyGift(ctx, st.selGift, { payWith:st.payWith||'stars', anonymous:ctx.match[1]==='yes', message:st.message||null }); });
bot.action(/^al_(yes|no)$/, async ctx => { await ctx.answerCbQuery(); const st=ST[ctx.from.id]; if(!st?.selGift)return ctx.reply('❌ Xato!',KB.main()); await processBuyGift(ctx, st.selGift, { payWith:st.payWith||'stars', anonymous:ctx.match[1]==='yes', message:st.message||null, viaLink:true }); });
bot.action(/^af_(yes|no)$/, async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, anon=ctx.match[1]==='yes', st=ST[userId];
    if (!st?.selGift||!st?.friendUsername) return ctx.reply('❌ Xato!', KB.main());
    let friendId;
    try { const c=await bot.telegram.getChat(`@${st.friendUsername}`); friendId=c.id; }
    catch { return ctx.reply(`❌ @${st.friendUsername} topilmadi.`); }
    await processBuyGift(ctx, st.selGift, { payWith:st.payWith||'stars', anonymous:anon, message:st.message||null, friendId });
});

// ─── Gift tasdiqlash ───────────────────────────────────────────
bot.action('gconfirm_yes', async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id, st = ST[userId];
    if (!st?.pendingGift) return ctx.reply('❌ Qaytadan boshlang.', KB.main());
    const { gift, opts } = st.pendingGift;
    delete st.pendingGift;

    const price    = Number(gift.price);
    const payWith  = opts.payWith || 'stars';
    const targetId = opts.friendId || userId;

    // Pulni ayirish
    let deducted = false;
    if (payWith === 'stars') deducted = await deductStars(userId, price);
    else                     deducted = await deductUzs(userId, price * STARS_TO_UZS);

    if (!deducted) return ctx.reply('❌ Balans yetarli emas!', KB.balance());

    await ctx.reply('⏳ Gift yuborilmoqda...');

    const res = await sendGiftGramJS(targetId, gift.telegramId || gift.id, opts.anonymous || false, opts.message || null);

    if (res.ok) {
        const s = await getStars(userId), u = await getUzs(userId);
        await ctx.reply(
            `✅ <b>Gift muvaffaqiyatli yuborildi!</b>\n\n` +
            `🎁 ${gift.name}\n` +
            `👤 ${opts.friendId ? `Do'stga` : 'O\'zingizga'}\n` +
            `🕵️ Anonim: ${opts.anonymous ? 'Ha' : 'Yo\'q'}\n` +
            (opts.message ? `💬 Izoh: ${esc(opts.message)}\n` : '') +
            `\n💼 Qolgan balans:\n   ⭐ ${s} Stars\n   💵 ${fUzs(u)}`,
            { parse_mode:'HTML', ...KB.main() }
        );
        await notifyAdmin(`🎁 <b>Gift yuborildi</b>\nGift: ${gift.name}\nUser: <code>${userId}</code> → Target: <code>${targetId}</code>`);
    } else {
        // To'lovni qaytarish
        if (payWith === 'stars') await addStars(userId, price);
        else await addUzs(userId, price * STARS_TO_UZS);

        let errMsg = `❌ <b>Gift yuborishda xato!</b>\n\n`;
        if (res.error === 'user_not_started') {
            errMsg += `Foydalanuvchi bot bilan chat ochmagan.\n\nUlarga botni birinchi bo'lib ochishlarini so'rang.`;
        } else if (res.error === 'balance_too_low') {
            errMsg += `Ulangan hisobda Stars yetarli emas.\nAdmin hisobni to'ldirishi kerak.`;
        } else {
            errMsg += `📋 Xato: <code>${esc(res.error||'noma\'lum')}</code>`;
        }
        errMsg += `\n\n💰 To'lovingiz qaytarildi.`;
        await ctx.reply(errMsg, { parse_mode:'HTML', ...KB.main() });
        await notifyAdmin(`❌ <b>Gift xato</b>\nGift: ${gift.name}\nUser: <code>${userId}</code>\nXato: ${res.error}`);
    }
});

bot.action('gconfirm_no', async ctx => {
    await ctx.answerCbQuery();
    delete ST[ctx.from.id]?.pendingGift;
    await ctx.reply('❌ Bekor qilindi.', KB.main());
});

// ─── Referal ───────────────────────────────────────────────────
bot.action('referral', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, s=await getStars(userId), u=await getUzs(userId);
    const bi=await bot.telegram.getMe(), link=`https://t.me/${bi.username}?start=${userId}`;
    await ctx.reply(
        `👥 <b>Referal tizim</b>\n\n⭐ Stars: ${s}\n💵 UZS: ${fUzs(u)}\n🎁 Har do'st: ${REFERRAL_REWARD} ⭐\n\n🔗 Sizning havola:\n${link}`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Bosh menyu', callback_data:'main' }]] }}
    );
});

// ─── O'yinlar ──────────────────────────────────────────────────
bot.action('games', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(`🎮 <b>O'yinlar</b>\n\n💎 Balans: <b>${await getStars(ctx.from.id)} ⭐</b>`, { parse_mode:'HTML', ...KB.games() });
});
bot.action(/^game_(dice|football|basketball|darts|slots)$/, async ctx => {
    await ctx.answerCbQuery();
    const game=ctx.match[1], userId=ctx.from.id;
    if (game==='slots') {
        const u=await getUser(userId), last=u?.lastSlotsAt?new Date(u.lastSlotsAt).getTime():0, ela=Date.now()-last;
        if (ela<DAILY_MS) return ctx.reply(`⏰ Kunlik slotlar!\nKeyingi: <b>${remStr(DAILY_MS-ela)}</b>`,{parse_mode:'HTML',...KB.games()});
    }
    const gi=GAMES[game], s=await getStars(userId);
    await ctx.reply(`${gi.name}\n\n📋 ${gi.rule}\n\n💎 Balans: ${s} ⭐\n\nTikish miqdori:`,{parse_mode:'HTML',...KB.bet(game)});
});
bot.action(/^bet_(dice|football|basketball|darts|slots)_(\d+|custom)$/, async ctx => {
    await ctx.answerCbQuery();
    const game=ctx.match[1], betStr=ctx.match[2], userId=ctx.from.id;
    if (betStr==='custom') { ST[userId]={...ST[userId],step:'custom_bet',curGame:game}; return ctx.reply('✏️ Tikish miqdorini kiriting:'); }
    await playGame(ctx, game, Number(betStr));
});
bot.action('daily', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, user=await getUser(userId);
    if (!user) return ctx.reply('❌ Xato!');
    const last=user.lastDailyBonusAt?new Date(user.lastDailyBonusAt).getTime():0, ela=Date.now()-last;
    if (ela<DAILY_MS) return ctx.reply(`⏰ Bonus olindi!\nKeyingi: <b>${remStr(DAILY_MS-ela)}</b>`,{parse_mode:'HTML',...KB.games()});
    try {
        const bi=await bot.telegram.getMe(), chat=await bot.telegram.getChat(userId);
        if (!(chat.bio||'').toLowerCase().includes(`t.me/${bi.username}`.toLowerCase()))
            return ctx.reply(`❌ Bio ga havolani qo'ying:\n<code>https://t.me/${bi.username}?start=${userId}</code>`,{parse_mode:'HTML',...KB.games()});
    } catch { return ctx.reply('❌ Bio tekshirishda xato.', KB.games()); }
    const bonus=Math.floor(Math.random()*2)+1;
    await addStars(userId,bonus); await upsertUser(userId,{lastDailyBonusAt:new Date().toISOString()});
    await ctx.reply(`🎁 <b>Kunlik bonus!</b>\n\n⭐ +${bonus} Stars\n💎 ${await getStars(userId)} ⭐`,{parse_mode:'HTML',...KB.games()});
});
bot.action('withdraw', async ctx => {
    await ctx.answerCbQuery();
    const s=await getStars(ctx.from.id);
    await ctx.reply(`💸 <b>Yechish</b>\n\n💎 Balans: <b>${s} ⭐</b>`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[
        [{text:'15 ⭐',callback_data:'wd_15'},{text:'25 ⭐',callback_data:'wd_25'},{text:'50 ⭐',callback_data:'wd_50'}],
        [{text:'⬅️ Orqaga',callback_data:'games'}],
    ]}});
});
bot.action(/^wd_(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const amount=Number(ctx.match[1]), userId=ctx.from.id, s=await getStars(userId);
    if (s<amount) return ctx.reply(`❌ Yetarli emas! Sizda: ${s} ⭐`,KB.games());
    await deductStars(userId,amount);
    await notifyAdmin(`💸 <b>Yechish</b>\n👤 ${ctx.from.username?'@'+ctx.from.username:'—'} (<code>${userId}</code>)\n⭐ ${amount} Stars`);
    await ctx.reply(`✅ <b>${amount} ⭐</b> yechish so'rovi yuborildi!`,{parse_mode:'HTML',...KB.games()});
});

// ─── Payment ───────────────────────────────────────────────────
bot.on('pre_checkout_query', async ctx => {
    try { await ctx.answerPreCheckoutQuery(true); } catch(e) { console.error('precheckout:', e); }
});
bot.on('successful_payment', async ctx => {
    try {
        const pay=ctx.message.successful_payment, payload=JSON.parse(pay.invoice_payload), userId=ctx.from.id;
        if (payload.action !== 'stars_dep') return;
        const amount=Number(payload.amount);
        await addStars(userId, amount);
        const u=await getUser(userId);
        if (u?.invitedBy) {
            const rb=Math.floor(amount*REFERRAL_PCT/100);
            if (rb>0) { await addStars(u.invitedBy,rb); try{await bot.telegram.sendMessage(u.invitedBy,`💰 Referalingiz Stars kiritdi!\n⭐ +${rb} Stars`,{parse_mode:'HTML'});}catch{} }
        }
        await notifyAdmin(`⭐ <b>Stars depozit</b>\n👤 <code>${userId}</code>\n💰 +${amount} Stars`);
        await ctx.reply(`✅ <b>Stars qo'shildi!</b>\n\n⭐ +${amount}\n💎 Balans: <b>${await getStars(userId)} ⭐</b>`,{parse_mode:'HTML',...KB.main()});
    } catch(e) { console.error('payment:', e); }
});

// ─── Photo (UZS chek) ──────────────────────────────────────────
bot.on('photo', async ctx => {
    try {
        const userId=ctx.from.id, st=ST[userId]||{};
        if (st.step!=='uzs_check') return;
        const amount=st.uzsAmount||0, username=ctx.from.username?`@${ctx.from.username}`:'no_username';
        delete st.step; delete st.uzsAmount;
        const deps=await getDeposits(), depId=`dep_${Date.now()}_${userId}`;
        deps.push({id:depId,userId,username,amount,status:'pending',createdAt:new Date().toLocaleString('uz-UZ')});
        await saveDeposits(deps);
        await bot.telegram.sendPhoto(ADMIN_ID, ctx.message.photo[ctx.message.photo.length-1].file_id, {
            caption:`💵 <b>UZS Depozit</b>\n\n👤 ${username} (<code>${userId}</code>)\n💰 ${fUzs(amount)}\n🆔 <code>${depId}</code>`,
            parse_mode:'HTML',
            reply_markup:{inline_keyboard:[[{text:'✅ Tasdiqlash',callback_data:`dep_ok_${depId}`},{text:'❌ Rad etish',callback_data:`dep_no_${depId}`}]]},
        });
        await ctx.reply(`✅ <b>Chek qabul qilindi!</b>\n\n💵 ${fUzs(amount)}\n⏳ Admin tekshirib qo'shadi.`,{parse_mode:'HTML',...KB.balance()});
    } catch(e) { console.error('photo:', e); }
});

// ─── ADMIN ─────────────────────────────────────────────────────
bot.action('adm_panel', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id!==ADMIN_ID) return;
    await ctx.reply('⚙️ <b>Admin Panel</b>',{parse_mode:'HTML',...KB.admin()});
});

// TG hisob
bot.action('adm_tg', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id!==ADMIN_ID) return;
    if (tgConnected) {
        try {
            const me=await tgClient.getMe();
            return ctx.reply(`✅ <b>Ulangan</b>\n\n👤 @${me.username}\n📱 ${me.firstName}`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[
                [{text:'🔌 Uzish',callback_data:'adm_tg_logout'}],
                [{text:'⬅️ Admin',callback_data:'adm_panel'}],
            ]}});
        } catch {}
    }
    ST[ADMIN_ID]={...ST[ADMIN_ID],tgStep:'phone'};
    await ctx.reply(`📱 <b>TG hisob ulash</b>\n\nTelefon raqam kiriting:\n<code>+998901234567</code>`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'❌ Bekor',callback_data:'adm_tg_cancel'}]]}});
});
bot.action('adm_tg_cancel', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const st=ST[ADMIN_ID]||{}; delete st.tgStep; delete st.tgPhone; delete st.tgHash;
    if (tgClient){try{await tgClient.disconnect();}catch{} tgClient=null; tgConnected=false;}
    await ctx.reply('❌ Bekor.',KB.admin());
});
bot.action('adm_tg_logout', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    try{if(tgClient){await tgClient.invoke(new Api.auth.LogOut({}));await tgClient.disconnect();}}catch{}
    tgClient=null; tgConnected=false; await sessionSave('');
    await ctx.reply('🔌 Hisob uzildi.',KB.admin());
});

// Statistika
bot.action('adm_stats', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const users=await getUsers(), gifts=await getGifts();
    const ts=users.reduce((s,u)=>s+Number(u.stars||0),0), tu=users.reduce((s,u)=>s+Number(u.uzs||0),0);
    await ctx.reply(`📊 <b>Statistika</b>\n\n👤 Users: <b>${users.length}</b>\n🎁 Gifts: <b>${gifts.length}</b>\n⭐ Jami Stars: <b>${ts}</b>\n💵 Jami UZS: <b>${fUzs(tu)}</b>\n📱 TG: ${tgConnected?'🟢':'🔴'}`,{parse_mode:'HTML',...KB.admin()});
});

// Broadcast
bot.action('adm_bc', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    ST[ADMIN_ID]={...ST[ADMIN_ID],step:'broadcast'};
    await ctx.reply('📢 Broadcast matnini yuboring:\n\nMatn\nTugma | https://link');
});

// Gift qo'shish
bot.action('adm_addgift', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    ST[ADMIN_ID]={...ST[ADMIN_ID],step:'add_gift'};
    await ctx.reply(
        `🎁 <b>Gift qo'shish</b>\n\nFormatda yozing:\n<code>Nom|Stars|TelegramGiftID</code>\n\nMisol:\n<code>Ayiq🧸|15|5168043015958052</code>\n\n⚠️ Nom qismida emoji ham ishlatsa bo'ladi (shu jumladan premium emojilar ham)`,
        {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'❌ Bekor',callback_data:'adm_panel'}]]}}
    );
});

// Gift narxi edit
bot.action('adm_editgift', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const gifts=await getGifts();
    if (!gifts.length) return ctx.reply('📭 Gift yo\'q.',KB.admin());
    const rows=gifts.map(g=>[{text:`✏️ ${g.name} (${g.price}⭐)`,callback_data:`editg_${g.id}`}]);
    rows.push([{text:'⬅️ Orqaga',callback_data:'adm_panel'}]);
    await ctx.reply('✏️ <b>Qaysi giftni edit qilasiz?</b>',{parse_mode:'HTML',reply_markup:{inline_keyboard:rows}});
});
bot.action(/^editg_(.+)$/, async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const gifts=await getGifts(), gift=gifts.find(g=>String(g.id)===ctx.match[1]);
    if (!gift) return ctx.reply('❌ Topilmadi!');
    ST[ADMIN_ID]={...ST[ADMIN_ID],step:'edit_gift_price',editGiftId:gift.id};
    await ctx.reply(
        `✏️ <b>${gift.name}</b>\n\nJoriy narx: <b>${gift.price} ⭐</b>\n\nYangi Stars narxini kiriting:`,
        {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'❌ Bekor',callback_data:'adm_editgift'}]]}}
    );
});

// Gift o'chirish
bot.action('adm_rmgift', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const gifts=await getGifts();
    if (!gifts.length) return ctx.reply('📭 Gift yo\'q.',KB.admin());
    const rows=gifts.map(g=>[{text:`🗑 ${g.name} (${g.price}⭐)`,callback_data:`rmg_${g.id}`}]);
    rows.push([{text:'⬅️ Orqaga',callback_data:'adm_panel'}]);
    await ctx.reply('🗑 <b>O\'chirmoqchi bo\'lgan giftni tanlang:</b>',{parse_mode:'HTML',reply_markup:{inline_keyboard:rows}});
});
bot.action(/^rmg_(.+)$/, async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const gifts=await getGifts(), idx=gifts.findIndex(g=>String(g.id)===ctx.match[1]);
    if (idx===-1) return ctx.reply('❌ Topilmadi!');
    const name=gifts[idx].name; gifts.splice(idx,1); await saveGifts(gifts);
    await ctx.reply(`✅ "${name}" o'chirildi.`,KB.admin());
});

// Kanal
bot.action('adm_addch', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    ST[ADMIN_ID]={...ST[ADMIN_ID],step:'add_channel'};
    await ctx.reply('📺 Kanal username:\n<code>@mychannel</code>',{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'❌ Bekor',callback_data:'adm_panel'}]]}});
});
bot.action('adm_rmch', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const chs=await getChannels();
    if (!chs.length) return ctx.reply('📭 Kanal yo\'q.',KB.admin());
    const rows=chs.map(ch=>[{text:`❌ ${ch}`,callback_data:`rmch_${ch.replace('@','')}`}]);
    rows.push([{text:'⬅️ Orqaga',callback_data:'adm_panel'}]);
    await ctx.reply('❌ O\'chirmoqchi bo\'lgan kanalni tanlang:',{reply_markup:{inline_keyboard:rows}});
});
bot.action(/^rmch_(.+)$/, async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const chs=await getChannels(), ch=`@${ctx.match[1]}`, idx=chs.indexOf(ch);
    if (idx===-1) return ctx.reply('❌ Topilmadi!');
    chs.splice(idx,1); await saveChannels(chs);
    await ctx.reply(`✅ ${ch} o'chirildi.`,KB.admin());
});

// Foydalanuvchi
bot.action('adm_users', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    ST[ADMIN_ID]={...ST[ADMIN_ID],step:'find_user'};
    await ctx.reply('👤 Foydalanuvchi ID sini kiriting:',{reply_markup:{inline_keyboard:[[{text:'⬅️ Orqaga',callback_data:'adm_panel'}]]}});
});

// UZS so'rovlar
bot.action('adm_deps', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const pending=(await getDeposits()).filter(d=>d.status==='pending');
    if (!pending.length) return ctx.reply('📭 So\'rov yo\'q.',KB.admin());
    for (const dep of pending.slice(0,10)) {
        await ctx.reply(`💵 <b>UZS Depozit</b>\n\n👤 ${dep.username} (<code>${dep.userId}</code>)\n💰 ${fUzs(dep.amount)}\n📅 ${dep.createdAt}`,
            {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ Tasdiqlash',callback_data:`dep_ok_${dep.id}`},{text:'❌ Rad etish',callback_data:`dep_no_${dep.id}`}]]}});
    }
});
bot.action(/^dep_ok_(.+)$/, async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const deps=await getDeposits(), idx=deps.findIndex(d=>d.id===ctx.match[1]);
    if (idx===-1) return ctx.reply('❌ Topilmadi!');
    const dep=deps[idx]; deps[idx].status='approved'; await saveDeposits(deps);
    await addUzs(dep.userId,dep.amount);
    try{await bot.telegram.sendMessage(dep.userId,`✅ <b>UZS qo'shildi!</b>\n\n💵 +${fUzs(dep.amount)}\n💰 Balans: ${fUzs(await getUzs(dep.userId))}`,{parse_mode:'HTML'});}catch{}
    await ctx.reply(`✅ ${dep.userId} ga ${fUzs(dep.amount)} qo'shildi.`);
});
bot.action(/^dep_no_(.+)$/, async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const deps=await getDeposits(), idx=deps.findIndex(d=>d.id===ctx.match[1]);
    if (idx===-1) return ctx.reply('❌ Topilmadi!');
    deps[idx].status='rejected'; await saveDeposits(deps);
    try{await bot.telegram.sendMessage(deps[idx].userId,'❌ <b>UZS depozit rad etildi.</b>',{parse_mode:'HTML'});}catch{}
    await ctx.reply('❌ Rad etildi.');
});

// /getusers va /getgifts download (Railway uchun)
bot.action('adm_dl_users', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    try {
        const data=await fs.readFile(DB.users);
        await ctx.replyWithDocument({ source:data, filename:'users.json' }, { caption:'📥 users.json' });
    } catch { await ctx.reply('❌ Fayl topilmadi.'); }
});
bot.action('adm_dl_gifts', async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    try {
        const data=await fs.readFile(DB.gifts);
        await ctx.replyWithDocument({ source:data, filename:'gifts.json' }, { caption:'📥 gifts.json' });
    } catch { await ctx.reply('❌ Fayl topilmadi.'); }
});

// Admin inline stars/uzs qo'shish
bot.action(/^admu_(s|u)_(\d+)$/, async ctx => {
    await ctx.answerCbQuery(); if (ctx.from.id!==ADMIN_ID) return;
    const type=ctx.match[1], targetId=ctx.match[2];
    ST[ADMIN_ID]={...ST[ADMIN_ID],step:`add${type}_${targetId}`};
    await ctx.reply(`Qancha ${type==='s'?'Stars ⭐':'UZS 💵'} qo'shmoqchisiz?`);
});

// ─── TEXT HANDLER ──────────────────────────────────────────────
bot.on('text', async ctx => {
    try {
        const userId=ctx.from.id, text=(ctx.message.text||'').trim();
        const st=ST[userId]||{};

        // ══ ADMIN TG LOGIN ══════════════════════════════════
        if (userId===ADMIN_ID) {
            if (st.tgStep==='phone') {
                if (!text.startsWith('+')) { await ctx.reply('❌ +998... formatida:'); return; }
                st.tgPhone=text; st.tgStep='code';
                try {
                    tgClient=new TelegramClient(new StringSession(''),API_ID,API_HASH,{connectionRetries:5,useWSS:false});
                    await tgClient.connect();
                    const res=await tgClient.sendCode({apiId:API_ID,apiHash:API_HASH},text);
                    st.tgHash=res.phoneCodeHash;
                    await ctx.reply('📲 Telegram kodni kiriting:',{reply_markup:{inline_keyboard:[[{text:'❌ Bekor',callback_data:'adm_tg_cancel'}]]}});
                } catch(e) { await ctx.reply(`❌ ${e.message}`); delete st.tgStep; tgClient=null; }
                return;
            }
            if (st.tgStep==='code') {
                try {
                    await tgClient.invoke(new Api.auth.SignIn({phoneNumber:st.tgPhone,phoneCodeHash:st.tgHash,phoneCode:text.replace(/\s/g,'')}));
                    tgConnected=true; await sessionSave(tgClient.session.save());
                    const me=await tgClient.getMe(); delete st.tgStep; delete st.tgPhone; delete st.tgHash;
                    await ctx.reply(`✅ <b>Ulandi!</b>\n\n👤 @${me.username}`,{parse_mode:'HTML',...KB.admin()});
                } catch(e) {
                    if (e.message.includes('SESSION_PASSWORD_NEEDED')) { st.tgStep='password'; await ctx.reply('🔐 2FA paroli:',{reply_markup:{inline_keyboard:[[{text:'❌ Bekor',callback_data:'adm_tg_cancel'}]]}}); }
                    else { await ctx.reply(`❌ Kod xato: ${e.message}`); delete st.tgStep; }
                }
                return;
            }
            if (st.tgStep==='password') {
                try {
                    const pwdInfo=await tgClient.invoke(new Api.account.GetPassword());
                    await tgClient.invoke(new Api.auth.CheckPassword({password:await computeSrp(pwdInfo,text)}));
                    tgConnected=true; await sessionSave(tgClient.session.save());
                    const me=await tgClient.getMe(); delete st.tgStep;
                    await ctx.reply(`✅ <b>Ulandi!</b>\n👤 @${me.username}`,{parse_mode:'HTML',...KB.admin()});
                } catch(e) { await ctx.reply(`❌ Parol xato: ${e.message}`); }
                return;
            }
            if (st.step==='find_user') {
                delete st.step; const u=await getUser(Number(text));
                if (!u) return ctx.reply('❌ Topilmadi!',KB.admin());
                await ctx.reply(`👤 <b>Foydalanuvchi</b>\n🆔 <code>${u.userId}</code>\n📛 ${u.username}\n⭐ ${u.stars}\n💵 ${fUzs(u.uzs)}`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[
                    [{text:'+Stars',callback_data:`admu_s_${u.userId}`},{text:'+UZS',callback_data:`admu_u_${u.userId}`}],
                    [{text:'⬅️ Admin',callback_data:'adm_panel'}],
                ]}});
                return;
            }
            if (st.step==='add_gift') {
                delete st.step;
                // "|" bo'yicha split — nom qismida emoji bo'lishi mumkin
                const pipeIdx1 = text.indexOf('|'), pipeIdx2 = text.indexOf('|', pipeIdx1+1);
                if (pipeIdx1===-1||pipeIdx2===-1) return ctx.reply('❌ Format: Nom|Stars|TgGiftID');
                const name   = text.slice(0, pipeIdx1).trim();
                const price  = parseInt(text.slice(pipeIdx1+1, pipeIdx2).trim(), 10);
                const tgId   = text.slice(pipeIdx2+1).trim();
                if (!name||isNaN(price)||price<=0) return ctx.reply('❌ Format: Nom|Stars|TgGiftID');
                const gifts=await getGifts(), ng={id:String(Date.now()),name,price,telegramId:tgId||null};
                gifts.push(ng); await saveGifts(gifts);
                await ctx.reply(`✅ Gift qo'shildi!\n🎁 ${ng.name}\n💰 ${ng.price}⭐ (${fUzs(ng.price*STARS_TO_UZS)})\n🆔 TG ID: ${tgId||'—'}`,{parse_mode:'HTML',...KB.admin()});
                return;
            }
            if (st.step==='edit_gift_price' && st.editGiftId) {
                const newPrice=parseInt(text,10);
                if (isNaN(newPrice)||newPrice<=0) { await ctx.reply('❌ To\'g\'ri raqam kiriting:'); return; }
                delete st.step;
                const gifts=await getGifts(), idx=gifts.findIndex(g=>String(g.id)===st.editGiftId);
                delete st.editGiftId;
                if (idx===-1) return ctx.reply('❌ Gift topilmadi!');
                const oldPrice=gifts[idx].price; gifts[idx].price=newPrice; await saveGifts(gifts);
                await ctx.reply(`✅ <b>${gifts[idx].name}</b>\n\n${oldPrice} ⭐ → <b>${newPrice} ⭐</b>\n💵 ${fUzs(newPrice*STARS_TO_UZS)}`,{parse_mode:'HTML',...KB.admin()});
                return;
            }
            if (st.step==='add_channel') {
                delete st.step;
                const ch=text.startsWith('@')?text:`@${text}`;
                const chs=await getChannels(); if(!chs.includes(ch))chs.push(ch);
                await saveChannels(chs); await ctx.reply(`✅ ${ch} qo'shildi.`,KB.admin()); return;
            }
            if (st.step==='broadcast') {
                delete st.step;
                const lines=text.split('\n').map(s=>s.trim()).filter(Boolean), msgLines=[], buttons=[];
                for (const line of lines) { if(line.includes('|')){const[l,u]=line.split('|');buttons.push([{text:l.trim(),url:tmeUrl(u.trim())}]);}else msgLines.push(line); }
                const msg=msgLines.join('\n')||' ', users=await getUsers(); let ok=0,fail=0;
                await ctx.reply(`📢 Yuborilmoqda... (${users.length} ta)`);
                for (const u of users) {
                    try{await bot.telegram.sendMessage(u.userId,msg,{parse_mode:'HTML',reply_markup:buttons.length?{inline_keyboard:buttons}:undefined});ok++;}catch{fail++;}
                    await sleep(35);
                }
                await ctx.reply(`✅ Tugadi!\n✔️ ${ok}\n❌ ${fail}`,KB.admin()); return;
            }
            if (st.step?.startsWith('adds_')) { const tid=Number(st.step.split('_')[1]); delete st.step; const r=await addStars(tid,Number(text)); await ctx.reply(r?`✅ +${text}⭐ → ${tid}`:'❌ Topilmadi!',KB.admin()); return; }
            if (st.step?.startsWith('addu_')) { const tid=Number(st.step.split('_')[1]); delete st.step; const r=await addUzs(tid,Number(text.replace(/\s/g,''))); await ctx.reply(r?`✅ +${fUzs(Number(text))} → ${tid}`:'❌ Topilmadi!',KB.admin()); return; }

            // Komandalar
            if (text==='/admin') return ctx.reply('⚙️ <b>Admin</b>',{parse_mode:'HTML',...KB.admin()});
            if (text.startsWith('/addstars ')){const[,i,a]=text.split(/\s+/);const r=await addStars(Number(i),Number(a));await ctx.reply(r?`✅ +${a}⭐ → ${i}`:'❌ Topilmadi!');return;}
            if (text.startsWith('/adduzs ')  ){const[,i,a]=text.split(/\s+/);const r=await addUzs(Number(i),Number(a));await ctx.reply(r?`✅ +${fUzs(Number(a))} → ${i}`:'❌ Topilmadi!');return;}
            if (text.startsWith('/stars ')   ){const n=parseInt(text.split(' ')[1],10);if(!isNaN(n)&&n>0){REFERRAL_REWARD=n;await ctx.reply(`✅ Referral: ${n} ⭐`);}return;}
            if (text==='/getusers'){try{const d=await fs.readFile(DB.users);await ctx.replyWithDocument({source:d,filename:'users.json'},{caption:'📥 users.json'});}catch{await ctx.reply('❌ Fayl yo\'q.');}return;}
            if (text==='/getgifts'){try{const d=await fs.readFile(DB.gifts);await ctx.replyWithDocument({source:d,filename:'gifts.json'},{caption:'📥 gifts.json'});}catch{await ctx.reply('❌ Fayl yo\'q.');}return;}
        }

        // ══ USER STEPLAR ════════════════════════════════════
        if (st.step==='uzs_amount') {
            const amount=parseInt(text.replace(/[\s,]/g,''),10);
            if (isNaN(amount)||amount<=0){await ctx.reply('❌ To\'g\'ri miqdor kiriting:');return;}
            delete st.step; st.uzsAmount=amount; st.step='uzs_check';
            await ctx.reply(`💵 <b>To'lov</b>\n\n💰 Miqdor: <b>${fUzs(amount)}</b>\n🏦 Karta: <code>${CARD_NUMBER}</code>\n\n✅ Kartaga ${fUzs(amount)} o'tkazing.\n📸 Chekini yuboring:`,{parse_mode:'HTML'});
            return;
        }
        if (st.step==='stars_amount') {
            const amount=parseInt(text,10);
            if (isNaN(amount)||amount<1){await ctx.reply('❌ 1 dan katta raqam:');return;}
            delete st.step; await sendStarsInvoice(ctx,amount); return;
        }
        if (st.step==='conv_stars_uzs') {
            const amount=parseInt(text,10), stars=await getStars(userId);
            if (isNaN(amount)||amount<=0){await ctx.reply('❌ To\'g\'ri raqam:');return;}
            if (amount>stars){await ctx.reply(`❌ Yetarli emas! Sizda: ${stars} ⭐`);return;}
            delete st.step;
            await deductStars(userId,amount); await addUzs(userId,amount*STARS_TO_UZS);
            await ctx.reply(`✅ <b>Konvert!</b>\n\n⭐ -${amount} Stars\n💵 +${fUzs(amount*STARS_TO_UZS)}\n\n⭐ ${await getStars(userId)} Stars\n💵 ${fUzs(await getUzs(userId))}`,{parse_mode:'HTML',...KB.balance()});
            return;
        }
        if (st.step==='conv_uzs_stars') {
            const amount=parseInt(text,10), uzsB=await getUzs(userId);
            if (isNaN(amount)||amount<=0){await ctx.reply('❌ To\'g\'ri raqam:');return;}
            const uzsNeed=amount*STARS_TO_UZS;
            if (uzsNeed>uzsB){await ctx.reply(`❌ Yetarli emas! ${fUzs(uzsNeed)} kerak, sizda: ${fUzs(uzsB)}`);return;}
            delete st.step;
            await deductUzs(userId,uzsNeed); await addStars(userId,amount);
            await ctx.reply(`✅ <b>Konvert!</b>\n\n💵 -${fUzs(uzsNeed)}\n⭐ +${amount} Stars\n\n⭐ ${await getStars(userId)} Stars\n💵 ${fUzs(await getUzs(userId))}`,{parse_mode:'HTML',...KB.balance()});
            return;
        }
        if (st.step==='custom_bet'&&st.curGame) {
            const bet=parseInt(text,10); if(isNaN(bet)||bet<=0){await ctx.reply('❌ Musbat raqam:');return;}
            delete st.step; delete st.curGame; await playGame(ctx,st.curGame,bet); return;
        }
        if (st.step==='friend_username'&&st.selGift) {
            if (text.startsWith('/')) return;
            delete st.step; st.friendUsername=text.startsWith('@')?text.slice(1):text;
            await askComment(ctx,'friend'); return;
        }
        if (st.step==='gift_message'&&st.selGift) {
            if (text.startsWith('/')) return;
            delete st.step; st.message=text.slice(0,255);
            await askAnon(ctx, st._commentMode||'self'); return;
        }
    } catch(e) { console.error('text handler:', e); }
});

// ─── INIT ──────────────────────────────────────────────────────
async function main() {
    await initDB();
    const saved=await sessionLoad();
    if (saved) { console.log('📡 Sessiya topildi...'); await tgInit(saved); }
    else console.log('⚠️  TG hisob ulanmagan. /admin → 📱 TG hisob');
    await bot.launch();
    const me=await bot.telegram.getMe();
    console.log('─'.repeat(45));
    console.log(`✅ Bot: @${me.username}`);
    console.log(`👤 Admin: ${ADMIN_ID}`);
    console.log(`💳 Karta: ${CARD_NUMBER}`);
    console.log(`💱 1⭐ = ${STARS_TO_UZS} UZS`);
    console.log(`📱 TG hisob: ${tgConnected?'🟢 Ulangan':'🔴 Ulanmagan'}`);
    console.log('─'.repeat(45));
}

main().catch(e=>{console.error('FATAL:',e);process.exit(1);});
bot.catch((e,ctx)=>console.error(`[${ctx?.updateType}]`,e.message));
process.once('SIGINT', ()=>bot.stop('SIGINT'));
process.once('SIGTERM',()=>bot.stop('SIGTERM'));
