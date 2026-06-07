// ============================================================
//  GIFT BOT — TO'LIQ VERSIYA (hammasi bitta bot.js da)
//  Telegraf + GramJS | UZS hamyon | Stars | Gift | O'yinlar
// ============================================================
'use strict';
require('dotenv').config();

const { Telegraf }     = require('telegraf');
const { TelegramClient}= require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api }          = require('telegram');
const axios            = require('axios');
const fs               = require('fs').promises;
const path             = require('path');

// ─────────────────────────────────────────────
//  SOZLAMALAR
// ─────────────────────────────────────────────
const BOT_TOKEN    = process.env.BOT_TOKEN    || '';
const ADMIN_ID     = Number(process.env.ADMIN_ID    || 0);
const API_ID       = Number(process.env.API_ID      || 0);
const API_HASH     =        process.env.API_HASH     || '';
const CARD_NUMBER  =        process.env.CARD_NUMBER  || '5614681256483730';
const STARS_TO_UZS = Number(process.env.STARS_TO_UZS || 140);   // 1 ⭐ = 140 UZS

const DB = {
    users   : path.join(__dirname,'users.json'),
    gifts   : path.join(__dirname,'gifts.json'),
    deposits: path.join(__dirname,'deposits.json'),
    channels: path.join(__dirname,'channels.json'),
    session : path.join(__dirname,'tg_session.json'),
};

const REFERRAL_PCT      = 2;      // har depozitdan referal foizi %
const DAILY_COOLDOWN_MS = 864e5;  // 24 soat
let   REFERRAL_REWARD   = 2;      // do'st uchun mukofot (stars)

// O'yinlar
const SLOT_JACKPOT   = 64;
const SLOT_LEMONS    = 1;
const THREE_SAME     = new Set([1,22,43,64]);

// ─────────────────────────────────────────────
//  BOT
// ─────────────────────────────────────────────
const bot        = new Telegraf(BOT_TOKEN);
const ST         = {};           // userStates: { [userId]: {...} }

// ─────────────────────────────────────────────
//  GRAMJS — TELEGRAM HISOB (SENDGIFT)
// ─────────────────────────────────────────────
let tgClient    = null;
let tgConnected = false;

async function sessionLoad() {
    try { return (JSON.parse(await fs.readFile(DB.session,'utf-8'))).session || ''; }
    catch { return ''; }
}
async function sessionSave(s) {
    await fs.writeFile(DB.session, JSON.stringify({ session: s }, null, 2));
}
async function tgInit(sessionStr = '') {
    try {
        tgClient = new TelegramClient(new StringSession(sessionStr), API_ID, API_HASH,
            { connectionRetries: 5, useWSS: false });
        await tgClient.connect();
        if (await tgClient.isUserAuthorized()) {
            tgConnected = true;
            await sessionSave(tgClient.session.save());
            const me = await tgClient.getMe();
            console.log(`✅ TG hisob: @${me.username}`);
            return true;
        }
    } catch(e) { console.error('tgInit:', e.message); }
    tgConnected = false;
    return false;
}

// GramJS orqali gift yuborish
async function giftViaGramJS(toUserId, giftId, anonymous = false) {
    if (!tgClient || !tgConnected) return false;
    try {
        const peer = await tgClient.getInputEntity(Number(toUserId));
        const form = await tgClient.invoke(new Api.payments.GetPaymentForm({
            invoice: new Api.InputInvoiceStarGift({
                peer,
                giftId: BigInt(String(giftId)),
                hideName: anonymous,
                includeUpgrade: false,
            })
        }));
        await tgClient.invoke(new Api.payments.SendStarsForm({
            formId: form.formId,
            invoice: new Api.InputInvoiceStarGift({
                peer,
                giftId: BigInt(String(giftId)),
                hideName: anonymous,
                includeUpgrade: false,
            })
        }));
        return true;
    } catch(e) {
        console.error('GramJS gift:', e.message);
        return false;
    }
}

// Bot API orqali gift (fallback)
async function giftViaBotApi(userId, giftId, comment = null) {
    try {
        const body = { user_id: Number(userId), gift_id: String(giftId) };
        if (comment) { body.text = comment; body.text_parse_mode = 'HTML'; }
        const r = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendGift`, body);
        return !!r.data?.ok;
    } catch { return false; }
}

// Avval GramJS, keyin Bot API
async function sendGift(userId, giftId, anonymous = false, comment = null) {
    if (tgConnected) {
        const ok = await giftViaGramJS(userId, giftId, anonymous);
        if (ok) return true;
    }
    return giftViaBotApi(userId, giftId, comment);
}

// 2FA parol hisoblash
async function computeSrp(pwdInfo, password) {
    const { computeCheck } = require('telegram/Password');
    return computeCheck(pwdInfo, password);
}

// ─────────────────────────────────────────────
//  UTIL
// ─────────────────────────────────────────────
const rj = async (fp, fb) => { try { return JSON.parse(await fs.readFile(fp,'utf-8')); } catch { return fb; } };
const wj = async (fp, v)  => fs.writeFile(fp, JSON.stringify(v, null, 2));
const esc = t => String(t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const uzs = n => Number(n||0).toLocaleString('uz-UZ') + ' UZS';
const tme = u => { const t=String(u||'').trim(); if(!t)return''; if(t.startsWith('https://t.me/'))return t; if(t.startsWith('t.me/'))return`https://t.me/${t.slice(5)}`; if(t.startsWith('@'))return`https://t.me/${t.slice(1)}`; if(/^[A-Za-z0-9_]{5,32}$/.test(t))return`https://t.me/${t}`; return t; };
const remaining = ms => { const h=Math.floor(ms/36e5),m=Math.floor((ms%36e5)/6e4); return `${h} soat ${m} daqiqa`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────
//  DATABASE
// ─────────────────────────────────────────────
const getUsers    = ()       => rj(DB.users,    []);
const saveUsers   = u        => wj(DB.users,    u);
const getGifts    = ()       => rj(DB.gifts,    []);
const saveGifts   = g        => wj(DB.gifts,    g);
const getDeposits = ()       => rj(DB.deposits, []);
const saveDeposits= d        => wj(DB.deposits, d);
const getChannels = ()       => rj(DB.channels, []);
const saveChannels= c        => wj(DB.channels, c);

async function getUser(id) {
    const u = await getUsers();
    return u.find(x => Number(x.userId) === Number(id)) || null;
}
async function upsertUser(id, patch) {
    const u = await getUsers(), i = u.findIndex(x => Number(x.userId) === Number(id));
    if (i === -1) return false;
    u[i] = { ...u[i], ...patch };
    await saveUsers(u); return true;
}
async function addUser(id, username) {
    const u = await getUsers();
    if (u.find(x => Number(x.userId) === Number(id))) return false;
    u.push({ userId:Number(id), username, stars:0, uzs:0, invitedBy:null,
             referralRewarded:false, lastDailyBonusAt:null, lastSlotsAt:null,
             joinedAt:new Date().toISOString() });
    await saveUsers(u); return true;
}

// Stars
async function addStars(id, n) {
    const u=await getUsers(), i=u.findIndex(x=>Number(x.userId)===Number(id));
    if(i===-1)return false; u[i].stars=Math.max(0,Number(u[i].stars||0)+Number(n||0));
    await saveUsers(u); return true;
}
async function deductStars(id, n) {
    const u=await getUsers(), i=u.findIndex(x=>Number(x.userId)===Number(id));
    if(i===-1)return false; const cur=Number(u[i].stars||0); if(cur<n)return false;
    u[i].stars=cur-Number(n); await saveUsers(u); return true;
}
async function getStars(id) { const u=await getUser(id); return Number(u?.stars||0); }

// UZS
async function addUzs(id, n) {
    const u=await getUsers(), i=u.findIndex(x=>Number(x.userId)===Number(id));
    if(i===-1)return false; u[i].uzs=Math.max(0,Number(u[i].uzs||0)+Number(n||0));
    await saveUsers(u); return true;
}
async function deductUzs(id, n) {
    const u=await getUsers(), i=u.findIndex(x=>Number(x.userId)===Number(id));
    if(i===-1)return false; const cur=Number(u[i].uzs||0); if(cur<n)return false;
    u[i].uzs=cur-Number(n); await saveUsers(u); return true;
}
async function getUzs(id) { const u=await getUser(id); return Number(u?.uzs||0); }

// DB init
async function initDB() {
    for(const [fp, fb] of [[DB.users,[]],[DB.gifts,[]],[DB.deposits,[]],[DB.channels,[]]]) {
        try { await fs.access(fp); } catch { await wj(fp, fb); }
    }
}

// ─────────────────────────────────────────────
//  OBUNA TEKSHIRISH
// ─────────────────────────────────────────────
async function isSubscribed(userId) {
    try {
        const chs = await getChannels();
        if (!chs.length) return true;
        for (const ch of chs) {
            const uname = String(ch).trim();
            if (!uname) continue;
            const handle = uname.startsWith('@') ? uname : `@${uname}`;
            try {
                const m = await bot.telegram.getChatMember(handle, userId);
                if (!['member','administrator','creator','restricted'].includes(m.status)) return false;
            } catch { return false; }
        }
        return true;
    } catch { return true; }
}
async function subsKeyboard() {
    const chs = await getChannels();
    const rows = chs.filter(Boolean).map(ch => [{ text:`📢 ${ch}`, url: tme(ch) }]);
    rows.push([{ text:'✅ Tekshirish', callback_data:'check_subs' }]);
    return rows;
}

// ─────────────────────────────────────────────
//  REFERRAL
// ─────────────────────────────────────────────
async function grantReferral(userId) {
    const u=await getUsers(), i=u.findIndex(x=>Number(x.userId)===Number(userId));
    if(i===-1||!u[i].invitedBy||u[i].referralRewarded)return false;
    u[i].referralRewarded=true; await saveUsers(u);
    await addStars(u[i].invitedBy, REFERRAL_REWARD);
    try { await bot.telegram.sendMessage(u[i].invitedBy, `🎉 Referal orqali <b>+${REFERRAL_REWARD} ⭐</b> ishladingiz!`, {parse_mode:'HTML'}); } catch{}
    return true;
}
async function setReferrer(userId, refId) {
    const u=await getUsers(), i=u.findIndex(x=>Number(x.userId)===Number(userId));
    if(i===-1||u[i].invitedBy)return;
    u[i].invitedBy=Number(refId); await saveUsers(u);
}

// ─────────────────────────────────────────────
//  KLAVIATURALAR
// ─────────────────────────────────────────────
const KB = {
    main: () => ({ reply_markup:{ inline_keyboard:[
        [{ text:'🎁 Gift sotib olish', callback_data:'buy_gift' }],
        [{ text:'💼 Hisobim', callback_data:'balance' }, { text:'👥 Referal', callback_data:'referral' }],
        [{ text:'🎮 O\'yinlar', callback_data:'games' }],
    ]}}),

    balance: () => ({ reply_markup:{ inline_keyboard:[
        [{ text:'💵 Pul kiritish (UZS)', callback_data:'dep_uzs' }],
        [{ text:'⭐ Stars kiritish',     callback_data:'dep_stars' }],
        [{ text:'🔄 Stars → UZS',        callback_data:'convert' }],
        [{ text:'⬅️ Bosh menyu',         callback_data:'main' }],
    ]}}),

    games: () => ({ reply_markup:{ inline_keyboard:[
        [{ text:'🎲 Zar',callback_data:'game_dice' }, { text:'⚽ Futbol',callback_data:'game_football' }, { text:'🏀 Basketbol',callback_data:'game_basketball' }],
        [{ text:'🎯 Darts',callback_data:'game_darts' }, { text:'🎰 Slotlar',callback_data:'game_slots' }],
        [{ text:'📥 Stars kiritish',callback_data:'dep_stars' }, { text:'💸 Yechish',callback_data:'withdraw' }],
        [{ text:'🎁 Kunlik bonus',callback_data:'daily' }],
        [{ text:'⬅️ Bosh menyu',callback_data:'main' }],
    ]}}),

    bet: game => ({ reply_markup:{ inline_keyboard:[
        [{ text:'1 ⭐',callback_data:`bet_${game}_1` }, { text:'5 ⭐',callback_data:`bet_${game}_5` }, { text:'10 ⭐',callback_data:`bet_${game}_10` }],
        [{ text:'25 ⭐',callback_data:`bet_${game}_25` }, { text:'50 ⭐',callback_data:`bet_${game}_50` }, { text:'100 ⭐',callback_data:`bet_${game}_100` }],
        [{ text:'✏️ Boshqa',callback_data:`bet_${game}_custom` }, { text:'⬅️ Orqaga',callback_data:'games' }],
    ]}}),

    admin: () => {
        const st = tgConnected ? '🟢 Ulangan' : '🔴 Ulanmagan';
        return { reply_markup:{ inline_keyboard:[
            [{ text:`📱 TG hisob: ${st}`, callback_data:'adm_tg' }],
            [{ text:'📊 Statistika', callback_data:'adm_stats' }, { text:'📢 Broadcast', callback_data:'adm_bc' }],
            [{ text:'🎁 Gift qo\'shish', callback_data:'adm_addgift' }, { text:'🗑 Gift o\'chirish', callback_data:'adm_rmgift' }],
            [{ text:'📺 Kanal qo\'shish', callback_data:'adm_addch' }, { text:'❌ Kanal o\'chirish', callback_data:'adm_rmch' }],
            [{ text:'📨 UZS so\'rovlar', callback_data:'adm_deps' }],
            [{ text:'👤 Foydalanuvchilar', callback_data:'adm_users' }],
            [{ text:'⬅️ Bosh menyu', callback_data:'main' }],
        ]}};
    },
};

// ─────────────────────────────────────────────
//  BALANS XABARI
// ─────────────────────────────────────────────
async function sendBalance(ctx, userId) {
    const s = await getStars(userId), u = await getUzs(userId);
    await ctx.reply(
        `💼 <b>Hisobim</b>\n\n` +
        `⭐ Stars: <b>${s}</b>\n` +
        `💵 UZS: <b>${uzs(u)}</b>`,
        { parse_mode:'HTML', ...KB.balance() }
    );
}

// ─────────────────────────────────────────────
//  INVOICE HELPER
// ─────────────────────────────────────────────
async function sendStarsInvoice(ctx, amount, userId) {
    await ctx.replyWithInvoice({
        title       : `⭐ ${amount} Stars kiritish`,
        description : `Hisobingizga ${amount} Stars qo'shiladi`,
        payload     : JSON.stringify({ action:'stars_dep', amount, user_id:userId }),
        provider_token: '',
        currency    : 'XTR',
        prices      : [{ label:`${amount} Stars`, amount }],
        start_parameter:'stars_dep',
        need_name:false, need_phone_number:false, need_email:false, need_shipping_address:false,
    });
}

async function sendGiftInvoice(ctx, gift, opts = {}) {
    // opts: { commentType, comment, anonymous, friendId, viaLink }
    const userId  = ctx.from.id;
    const balance = await getStars(userId);
    const apply   = Math.min(balance, Number(gift.price));
    const payable = Math.max(1, Number(gift.price) - apply);
    if (apply > 0) await deductStars(userId, apply);
    await ctx.replyWithInvoice({
        title       : `🎁 ${gift.name}`,
        description : opts.comment ? `Izoh: ${opts.comment}` : `${gift.name} — ${payable} ⭐`,
        payload     : JSON.stringify({
            action    : 'gift_buy',
            gift_id   : gift.id,
            tg_gift_id: gift.telegramId || null,
            gift_name : gift.name,
            user_id   : userId,
            ctype     : opts.commentType || 'plain',
            comment   : opts.comment     || null,
            anonymous : opts.anonymous   || false,
            friend_id : opts.friendId    || null,
            via_link  : opts.viaLink     || false,
        }),
        provider_token:'',
        currency    : 'XTR',
        prices      : [{ label: gift.name, amount: payable }],
        start_parameter:'gift',
        need_name:false, need_phone_number:false, need_email:false, need_shipping_address:false,
    });
}

// ─────────────────────────────────────────────
//  O'YIN LOGIKASI
// ─────────────────────────────────────────────
function calcDice(v,b){ if(v===6)return{win:b*2,msg:'🎉 6 tushdi! 2× yutdingiz!'}; if(v===5)return{win:Math.floor(b*1.5),msg:'🎊 5 tushdi! 1.5×!'}; if(v===4)return{win:b,msg:'🙂 4 tushdi. Tikish qaytarildi.'}; if(v===3)return{win:Math.floor(b*0.5),msg:'😕 3 tushdi. Yarmi qaytarildi.'}; return{win:0,msg:`😢 ${v} tushdi. Yutqazdingiz!`}; }
function calcFootball(v,b){ return v>=3?{win:Math.floor(b*1.44),msg:'⚽ GOL! 1.44× yutdingiz!'}:{win:0,msg:'❌ Xato! Yutqazdingiz.'}; }
function calcBball(v,b){ return v>=4?{win:Math.floor(b*1.5),msg:'🏀 HIT! 1.5× yutdingiz!'}:{win:0,msg:'❌ Xato! Yutqazdingiz.'}; }
function calcDarts(v,b){ if(v===6)return{win:b*2,msg:'🎯 MARKAZ! 2×!'}; if(v>=4)return{win:Math.floor(b*1.5),msg:'🎯 Yaqin! 1.5×!'}; return{win:0,msg:'❌ Xato! Yutqazdingiz.'}; }
function calcSlots(v,b){ if(v===SLOT_JACKPOT)return{win:b*5,bonus:0,msg:'🎰 777 JACKPOT! 5×! 🎉🎉🎉'}; if(v===SLOT_LEMONS)return{win:b*2,bonus:10,msg:'🍋🍋🍋 2× + 10⭐ bonus!'}; if(THREE_SAME.has(v))return{win:b*2,bonus:0,msg:'🎰 3 bir xil! 2×!'}; return{win:0,bonus:0,msg:'❌ Yutqazdingiz.'}; }

const GAME_INFO = {
    dice      :{ name:'🎲 Zar',       emoji:'🎲', calc:calcDice,     rule:'6→2× | 5→1.5× | 4→qaytarildi | 3→0.5× | 1-2→lost' },
    football  :{ name:'⚽ Futbol',    emoji:'⚽', calc:calcFootball, rule:'3-5→1.44× | 1-2→lost' },
    basketball:{ name:'🏀 Basketbol', emoji:'🏀', calc:calcBball,    rule:'4-5→1.5× | 1-3→lost' },
    darts     :{ name:'🎯 Darts',     emoji:'🎯', calc:calcDarts,    rule:'6→2× | 4-5→1.5× | 1-3→lost' },
    slots     :{ name:'🎰 Slotlar',   emoji:'🎰', calc:calcSlots,    rule:'777→5× | 🍋🍋🍋→2×+10⭐ | 3bir→2× | lost' },
};

async function playGame(ctx, game, bet) {
    const userId = ctx.from.id;
    const stars  = await getStars(userId);
    if (stars < bet) {
        return ctx.reply(`❌ Balans yetarli emas!\n💎 Sizda: ${stars} ⭐\n\nStars kiriting 👇`, KB.games());
    }

    // Slots — kunlik limit
    if (game === 'slots') {
        const u    = await getUser(userId);
        const last = u?.lastSlotsAt ? new Date(u.lastSlotsAt).getTime() : 0;
        const ela  = Date.now() - last;
        if (ela < DAILY_COOLDOWN_MS) {
            return ctx.reply(`⏰ <b>Slotlar kunlik!</b>\nKeyingi: <b>${remaining(DAILY_COOLDOWN_MS - ela)}</b>`, { parse_mode:'HTML', ...KB.games() });
        }
        await upsertUser(userId, { lastSlotsAt: new Date().toISOString() });
    }

    await deductStars(userId, bet);
    const gi = GAME_INFO[game];

    await ctx.reply(`🎮 <b>${gi.name}</b>\n💰 Tikish: ${bet} ⭐\n⏳ Natijani kuting...`, { parse_mode:'HTML' });
    const dm    = await ctx.replyWithDice({ emoji: gi.emoji });
    const value = dm.dice.value;
    const res   = gi.calc(value, bet);
    const win   = res.win   || 0;
    const bonus = res.bonus || 0;
    const total = win + bonus;
    if (total > 0) await addStars(userId, total);
    const newBal    = await getStars(userId);
    const netChange = total - bet;
    const chStr     = netChange >= 0 ? `+${netChange}` : `${netChange}`;

    await sleep(3500);
    await ctx.reply(
        `🎮 <b>${gi.name} natijasi</b>\n\n` +
        `🎲 Zar: <b>${value}</b>\n${res.msg}\n\n` +
        `💰 Tikish: ${bet} ⭐\n` +
        (win   > 0 ? `🏆 Yutish: +${win} ⭐\n` : '') +
        (bonus > 0 ? `🎁 Bonus:  +${bonus} ⭐\n` : '') +
        `📊 O'zgarish: <b>${chStr} ⭐</b>\n💎 Balans: <b>${newBal} ⭐</b>`,
        { parse_mode:'HTML', ...KB.games() }
    );
}

// ─────────────────────────────────────────────
//  ADMIN: NOTIF
// ─────────────────────────────────────────────
async function notifyAdmin(text) {
    try { await bot.telegram.sendMessage(ADMIN_ID, text, { parse_mode:'HTML' }); } catch {}
}

// ─────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────
bot.start(async ctx => {
    try {
        const userId   = ctx.from.id;
        const username = ctx.from.username ? `@${ctx.from.username}` : 'no_username';
        const args     = ctx.startPayload || '';
        const isNew    = await addUser(userId, username);
        if (!ST[userId]) ST[userId] = {};

        // Obuna tekshirish
        const ok = await isSubscribed(userId);
        if (!ok) {
            if (args && /^\d+$/.test(args)) await setReferrer(userId, Number(args));
            return ctx.reply('📢 Botdan foydalanish uchun kanallarga obuna bo\'ling!',
                { reply_markup:{ inline_keyboard: await subsKeyboard() } });
        }

        // Referral
        if (args && /^\d+$/.test(args) && Number(args) !== userId) {
            await setReferrer(userId, Number(args));
        }

        // Havola orqali gift: start=claim_GIFTID_SENDERID_anon|pub
        if (args.startsWith('claim_')) {
            const [,giftId, senderId, anonFlag] = args.split('_');
            const gifts = await getGifts();
            const gift  = gifts.find(g => String(g.id) === giftId);
            if (!gift) return ctx.reply('❌ Gift topilmadi yoki muddati o\'tgan!');
            const senderUser = await getUser(Number(senderId));
            const anon       = anonFlag === 'anon';
            const senderName = anon ? '🕵️ Anonim' : (senderUser?.username || `User #${senderId}`);
            await ctx.reply(`🎁 <b>Sizga sovg'a!</b>\n\nKim tomonidan: <b>${senderName}</b>\nGift: <b>${esc(gift.name)}</b>\n\n⏳ Yuborilmoqda...`, { parse_mode:'HTML' });
            const sent = await sendGift(userId, gift.telegramId || gift.id, anon);
            if (sent) await ctx.reply(`✅ <b>Gift yuborildi!</b>\n🎁 ${esc(gift.name)}\n💝 ${senderName} tomonidan`, { parse_mode:'HTML', ...KB.main() });
            else       await ctx.reply('❌ Xato yuz berdi. Admin bilan bog\'laning.', KB.main());
            return;
        }

        // Yangi foydalanuvchi notification
        if (isNew) {
            await notifyAdmin(
                `👤 <b>Yangi foydalanuvchi!</b>\n\n` +
                `🆔 ID: <code>${userId}</code>\n` +
                `👤 Ism: ${esc(ctx.from.first_name || '')} ${esc(ctx.from.last_name || '')}\n` +
                `📛 Username: ${esc(username)}\n` +
                `📅 Sana: ${new Date().toLocaleString('uz-UZ')}`
            );
        }

        await grantReferral(userId);
        const stars = await getStars(userId);
        const uzsAmt= await getUzs(userId);
        await ctx.reply(
            `🎁 <b>Sovg'alar Dunyosi</b> ga xush kelibsiz!\n\n` +
            `💼 <b>Hisobingiz:</b>\n` +
            `   ⭐ Stars: <b>${stars}</b>\n` +
            `   💵 UZS: <b>${uzs(uzsAmt)}</b>`,
            { parse_mode:'HTML', ...KB.main() }
        );
    } catch(e) { console.error('/start:', e); }
});

// ─────────────────────────────────────────────
//  CALLBACK HANDLERS
// ─────────────────────────────────────────────

// Obuna tekshirish
bot.action('check_subs', async ctx => {
    await ctx.answerCbQuery();
    const ok = await isSubscribed(ctx.from.id);
    if (!ok) return ctx.reply('❌ Hali obuna bo\'lmagansiz!', { reply_markup:{ inline_keyboard: await subsKeyboard() } });
    await grantReferral(ctx.from.id);
    const stars = await getStars(ctx.from.id), uzsAmt = await getUzs(ctx.from.id);
    await ctx.reply(`🎁 <b>Sovg'alar Dunyosi</b>\n\n⭐ ${stars} Stars\n💵 ${uzs(uzsAmt)}`,
        { parse_mode:'HTML', ...KB.main() });
});

// Bosh menyu
bot.action('main', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, s=await getStars(userId), u=await getUzs(userId);
    await ctx.reply(`🎁 <b>Sovg'alar Dunyosi</b>\n\n⭐ ${s} Stars\n💵 ${uzs(u)}`,
        { parse_mode:'HTML', ...KB.main() });
});

// Hisobim
bot.action('balance', async ctx => { await ctx.answerCbQuery(); await sendBalance(ctx, ctx.from.id); });

// ── UZS DEPOZIT ──────────────────────────────
bot.action('dep_uzs', async ctx => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    ST[userId] = { ...ST[userId], step:'uzs_amount' };
    await ctx.reply(
        `💵 <b>Pul kiritish (UZS)</b>\n\n` +
        `🏦 Quyidagi karta raqamiga pul o'tkazing:\n\n` +
        `<code>${CARD_NUMBER}</code>\n\n` +
        `📝 Qancha so'm yubormoqchisiz? Raqam kiriting:`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Orqaga', callback_data:'balance' }]] } }
    );
});

// ── STARS DEPOZIT ─────────────────────────────
bot.action('dep_stars', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, s=await getStars(userId), u=await getUzs(userId);
    ST[userId] = { ...ST[userId], step:'stars_amount' };
    await ctx.reply(
        `⭐ <b>Stars kiritish</b>\n\n💼 Balans:\n   ⭐ ${s} Stars\n   💵 ${uzs(u)}\n\nQancha Stars kiritmoqchisiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Orqaga', callback_data:'balance' }]] } }
    );
});

// ── CONVERT ───────────────────────────────────
bot.action('convert', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, s=await getStars(userId);
    if (s <= 0) return ctx.reply('❌ Sizda Stars yo\'q!', KB.balance());
    ST[userId] = { ...ST[userId], step:'convert_amount' };
    await ctx.reply(
        `🔄 <b>Stars → UZS</b>\n\n⭐ Sizda: <b>${s} Stars</b>\n💱 Kurs: 1 ⭐ = ${STARS_TO_UZS} UZS\n\nQancha Stars konvert qilasiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Bekor', callback_data:'balance' }]] } }
    );
});

// ── GIFT SHOP ─────────────────────────────────
bot.action('buy_gift', async ctx => {
    await ctx.answerCbQuery();
    const gifts = await getGifts();
    if (!gifts.length) return ctx.reply('⚠️ Hozircha gift yo\'q.', KB.main());
    const rows = gifts.map(g => [{
        text: `${g.name} — ${g.price}⭐  (${uzs(Number(g.price) * STARS_TO_UZS)})`,
        callback_data: `pick_${g.id}`
    }]);
    rows.push([{ text:'⬅️ Bosh menyu', callback_data:'main' }]);
    await ctx.reply('🎁 <b>Sovg\'ani tanlang:</b>', { parse_mode:'HTML', reply_markup:{ inline_keyboard:rows } });
});

bot.action(/^pick_(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, giftId=ctx.match[1];
    const gifts=await getGifts(), gift=gifts.find(g=>String(g.id)===giftId);
    if (!gift) return ctx.reply('❌ Gift topilmadi!');
    const balance=await getStars(userId);
    const apply=Math.min(balance,Number(gift.price)), payable=Math.max(1,Number(gift.price)-apply);
    ST[userId] = { ...ST[userId], selGift: gift };
    await ctx.reply(
        `🎁 <b>${esc(gift.name)}</b>\n\n` +
        `💰 Narx: <b>${gift.price} ⭐</b>  (${uzs(Number(gift.price)*STARS_TO_UZS)})\n` +
        `⭐ Balansdan: <b>${apply} ⭐</b>\n` +
        `💳 To'lov: <b>${payable} ⭐</b>\n\n` +
        `Qanday yubormoqchisiz?`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
            [{ text:'🔇 Izohsiz',       callback_data:'g_plain'  }],
            [{ text:'💬 Izoh bilan',     callback_data:'g_comment'}],
            [{ text:'🎁 Do\'stga hadya', callback_data:'g_friend' }],
            [{ text:'⬅️ Orqaga',        callback_data:'buy_gift' }],
        ]}}
    );
});

// Izohsiz → anonim so'ra
bot.action('g_plain', async ctx => {
    await ctx.answerCbQuery();
    const st = ST[ctx.from.id];
    if (!st?.selGift) return ctx.reply('❌ Qaytadan tanlang.', KB.main());
    st.ctype = 'plain';
    await askAnon(ctx, 'self');
});

// Izoh bilan
bot.action('g_comment', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, st=ST[userId];
    if (!st?.selGift) return ctx.reply('❌ Qaytadan tanlang.', KB.main());
    st.ctype = 'comment';
    st.step  = 'gift_comment';
    await ctx.reply('✍️ Izohingizni yozing:');
});

// Do'stga
bot.action('g_friend', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, st=ST[userId];
    if (!st?.selGift) return ctx.reply('❌ Qaytadan tanlang.', KB.main());
    st.ctype = 'friend';
    st.step  = 'friend_username';
    await ctx.reply(
        `🎁 <b>Do'stga hadya</b>\n\nDo'stingiz @username ni yozing:\nMisol: <code>@username</code>\n\nYoki havola orqali:`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
            [{ text:'🔗 Havola orqali yuborish', callback_data:'g_link' }],
            [{ text:'⬅️ Orqaga', callback_data:`pick_${st.selGift.id}` }],
        ]}}
    );
});

// Havola orqali
bot.action('g_link', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, st=ST[userId];
    if (!st?.selGift) return ctx.reply('❌ Qaytadan tanlang.', KB.main());
    st.ctype    = 'link';
    st.viaLink  = true;
    delete st.step;
    await askAnon(ctx, 'link');
});

// Anonim so'rash
async function askAnon(ctx, mode) {
    const prefix = mode === 'link' ? 'al' : mode === 'friend' ? 'af' : 'a';
    await ctx.reply('👤 <b>Kimdan yuborilsin?</b>', { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
        [{ text:'🕵️ Anonim',   callback_data:`${prefix}_yes` }],
        [{ text:'👤 Ommaviy',  callback_data:`${prefix}_no`  }],
    ]}});
}

// O'zi uchun anonim
bot.action(/^a_(yes|no)$/, async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, anon=ctx.match[1]==='yes', st=ST[userId];
    if (!st?.selGift) return ctx.reply('❌ Xato!', KB.main());
    await sendGiftInvoice(ctx, st.selGift, { commentType:st.ctype||'plain', comment:st.comment, anonymous:anon });
});

// Havola uchun anonim
bot.action(/^al_(yes|no)$/, async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, anon=ctx.match[1]==='yes', st=ST[userId];
    if (!st?.selGift) return ctx.reply('❌ Xato!', KB.main());
    await sendGiftInvoice(ctx, st.selGift, { commentType:'link', anonymous:anon, viaLink:true });
});

// Do'st uchun anonim (username bilan)
bot.action(/^af_(yes|no)$/, async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, anon=ctx.match[1]==='yes', st=ST[userId];
    if (!st?.selGift || !st?.friendUsername) return ctx.reply('❌ Xato!', KB.main());
    let friendId;
    try { const c=await bot.telegram.getChat(`@${st.friendUsername}`); friendId=c.id; }
    catch { return ctx.reply(`❌ @${st.friendUsername} topilmadi.`); }
    await sendGiftInvoice(ctx, st.selGift, { commentType:'friend', anonymous:anon, friendId });
});

// ── REFERAL ───────────────────────────────────
bot.action('referral', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, s=await getStars(userId), u=await getUzs(userId);
    const botInfo=await bot.telegram.getMe();
    const link=`https://t.me/${botInfo.username}?start=${userId}`;
    await ctx.reply(
        `👥 <b>Referal tizim</b>\n\n⭐ Stars: ${s}\n💵 UZS: ${uzs(u)}\n🎁 Har do'st: ${REFERRAL_REWARD} ⭐\n\n🔗 Sizning havola:\n${link}`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'⬅️ Bosh menyu', callback_data:'main' }]] } }
    );
});

// ── O'YINLAR ──────────────────────────────────
bot.action('games', async ctx => {
    await ctx.answerCbQuery();
    const s=await getStars(ctx.from.id);
    await ctx.reply(`🎮 <b>O'yinlar</b>\n\n💎 Balans: <b>${s} ⭐</b>\n\nO'yin tanlang:`, { parse_mode:'HTML', ...KB.games() });
});

bot.action(/^game_(dice|football|basketball|darts|slots)$/, async ctx => {
    await ctx.answerCbQuery();
    const game=ctx.match[1], userId=ctx.from.id;
    if (game==='slots') {
        const u=await getUser(userId), last=u?.lastSlotsAt?new Date(u.lastSlotsAt).getTime():0, ela=Date.now()-last;
        if (ela < DAILY_COOLDOWN_MS) return ctx.reply(`⏰ Kunlik! Keyingi: <b>${remaining(DAILY_COOLDOWN_MS-ela)}</b>`, { parse_mode:'HTML', ...KB.games() });
    }
    const gi=GAME_INFO[game], s=await getStars(userId);
    await ctx.reply(`${gi.name}\n\n📋 <b>Qoidalar:</b>\n${gi.rule}\n\n💎 Balans: ${s} ⭐\n\nTikish miqdorini tanlang:`,
        { parse_mode:'HTML', ...KB.bet(game) });
});

bot.action(/^bet_(dice|football|basketball|darts|slots)_(\d+|custom)$/, async ctx => {
    await ctx.answerCbQuery();
    const game=ctx.match[1], betStr=ctx.match[2], userId=ctx.from.id;
    if (betStr==='custom') {
        ST[userId]={ ...ST[userId], step:'custom_bet', curGame:game };
        return ctx.reply('✏️ Tikish miqdorini kiriting (raqam):');
    }
    await playGame(ctx, game, Number(betStr));
});

// Kunlik bonus
bot.action('daily', async ctx => {
    await ctx.answerCbQuery();
    const userId=ctx.from.id, user=await getUser(userId);
    if (!user) return ctx.reply('❌ Xato!');
    const last=user.lastDailyBonusAt?new Date(user.lastDailyBonusAt).getTime():0, ela=Date.now()-last;
    if (ela < DAILY_COOLDOWN_MS) return ctx.reply(`⏰ <b>Bonus olindi!</b>\nKeyingi: <b>${remaining(DAILY_COOLDOWN_MS-ela)}</b>`, { parse_mode:'HTML', ...KB.games() });
    try {
        const bi=await bot.telegram.getMe(), chat=await bot.telegram.getChat(userId);
        const bio=(chat.bio||'').toLowerCase();
        if (!bio.includes(`t.me/${bi.username}`.toLowerCase()))
            return ctx.reply(`❌ Bio ga referal havolani qo'ying:\n<code>https://t.me/${bi.username}?start=${userId}</code>\n\nQo'yib, qaytadan bosing!`, { parse_mode:'HTML', ...KB.games() });
    } catch { return ctx.reply('❌ Bio tekshirishda xato.', KB.games()); }
    const bonus=Math.floor(Math.random()*2)+1;
    await addStars(userId, bonus);
    await upsertUser(userId, { lastDailyBonusAt: new Date().toISOString() });
    const nb=await getStars(userId);
    await ctx.reply(`🎁 <b>Kunlik bonus!</b>\n\n⭐ +${bonus} Stars\n💎 Balans: <b>${nb} ⭐</b>\n\nErtaga qaytib keling! 🌟`, { parse_mode:'HTML', ...KB.games() });
});

// Yechish
bot.action('withdraw', async ctx => {
    await ctx.answerCbQuery();
    const s=await getStars(ctx.from.id);
    await ctx.reply(`💸 <b>Yechish</b>\n\n💎 Balans: <b>${s} ⭐</b>\n\nMiqdorni tanlang:`, { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
        [{ text:'15 ⭐', callback_data:'wd_15' }, { text:'25 ⭐', callback_data:'wd_25' }, { text:'50 ⭐', callback_data:'wd_50' }],
        [{ text:'⬅️ Orqaga', callback_data:'games' }],
    ]}});
});
bot.action(/^wd_(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const amount=Number(ctx.match[1]), userId=ctx.from.id, s=await getStars(userId);
    if (s<amount) return ctx.reply(`❌ Yetarli emas! Sizda: ${s} ⭐`, KB.games());
    await deductStars(userId, amount);
    const uname=ctx.from.username?`@${ctx.from.username}`:'no_username';
    await notifyAdmin(`💸 <b>Yechish so'rovi</b>\n\n👤 ${uname}\n🆔 <code>${userId}</code>\n⭐ ${amount} Stars`);
    await ctx.reply(`✅ <b>${amount} ⭐</b> yechish so'rovi yuborildi!\n\nAdmin tez orada ko'rib chiqadi.`, { parse_mode:'HTML', ...KB.games() });
});

// ── ADMIN PANEL ───────────────────────────────
bot.action('adm_panel', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.reply('⚙️ <b>Admin Panel</b>', { parse_mode:'HTML', ...KB.admin() });
});

// TG hisob ulash
bot.action('adm_tg', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    if (tgConnected) {
        try {
            const me=await tgClient.getMe();
            return ctx.reply(
                `✅ <b>Hisob ulangan</b>\n\n👤 @${me.username}\n📱 ${me.firstName} ${me.lastName||''}\n🆔 ${me.id}`,
                { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
                    [{ text:'🔌 Uzish', callback_data:'adm_tg_logout' }],
                    [{ text:'⬅️ Admin', callback_data:'adm_panel' }],
                ]}}
            );
        } catch {}
    }
    ST[ADMIN_ID] = { ...ST[ADMIN_ID], tgStep:'phone' };
    await ctx.reply(
        `📱 <b>Telegram hisob ulash</b>\n\nTelefon raqamingizni kiriting:\n<code>+998901234567</code>`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'❌ Bekor', callback_data:'adm_tg_cancel' }]] } }
    );
});

bot.action('adm_tg_cancel', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const st=ST[ADMIN_ID]||{};
    delete st.tgStep; delete st.tgPhone; delete st.tgHash;
    if (tgClient) { try { await tgClient.disconnect(); } catch {} tgClient=null; tgConnected=false; }
    await ctx.reply('❌ Bekor qilindi.', KB.admin());
});

bot.action('adm_tg_logout', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    try { if (tgClient) { await tgClient.invoke(new Api.auth.LogOut({})); await tgClient.disconnect(); } } catch {}
    tgClient=null; tgConnected=false;
    await sessionSave('');
    await ctx.reply('🔌 Hisob uzildi.', KB.admin());
});

// Statistika
bot.action('adm_stats', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const users=await getUsers(), gifts=await getGifts();
    const ts=users.reduce((s,u)=>s+Number(u.stars||0),0);
    const tu=users.reduce((s,u)=>s+Number(u.uzs||0),0);
    await ctx.reply(
        `📊 <b>Statistika</b>\n\n` +
        `👤 Foydalanuvchilar: <b>${users.length}</b>\n` +
        `🎁 Giftlar: <b>${gifts.length}</b>\n` +
        `⭐ Jami Stars: <b>${ts}</b>\n` +
        `💵 Jami UZS: <b>${uzs(tu)}</b>\n` +
        `📱 TG hisob: ${tgConnected?'🟢 Ulangan':'🔴 Ulanmagan'}`,
        { parse_mode:'HTML', ...KB.admin() }
    );
});

// Broadcast
bot.action('adm_bc', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    ST[ADMIN_ID] = { ...ST[ADMIN_ID], step:'broadcast' };
    await ctx.reply('📢 Broadcast xabarini yuboring:\n\nMatn\nTugma | https://link');
});

// Gift qo'shish
bot.action('adm_addgift', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    ST[ADMIN_ID] = { ...ST[ADMIN_ID], step:'add_gift' };
    await ctx.reply(
        `🎁 <b>Gift qo'shish</b>\n\nFormatda yozing:\n<code>Nom|Stars|TelegramGiftID</code>\n\nMisol:\n<code>Atirgul|100|5168043015958052</code>`,
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'❌ Bekor', callback_data:'adm_panel' }]] } }
    );
});

// Gift o'chirish
bot.action('adm_rmgift', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const gifts = await getGifts();
    if (!gifts.length) return ctx.reply('📭 Gift yo\'q.', KB.admin());
    const rows = gifts.map(g => [{ text:`🗑 ${g.name} (${g.price}⭐)`, callback_data:`rmg_${g.id}` }]);
    rows.push([{ text:'⬅️ Orqaga', callback_data:'adm_panel' }]);
    await ctx.reply('🗑 <b>O\'chirmoqchi bo\'lgan giftni tanlang:</b>', { parse_mode:'HTML', reply_markup:{ inline_keyboard:rows } });
});

bot.action(/^rmg_(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const gifts=await getGifts(), idx=gifts.findIndex(g=>String(g.id)===ctx.match[1]);
    if (idx===-1) return ctx.reply('❌ Topilmadi!');
    const name=gifts[idx].name; gifts.splice(idx,1); await saveGifts(gifts);
    await ctx.reply(`✅ "${name}" o'chirildi.`, KB.admin());
});

// Kanal qo'shish
bot.action('adm_addch', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    ST[ADMIN_ID] = { ...ST[ADMIN_ID], step:'add_channel' };
    await ctx.reply('📺 Kanal username ni kiriting:\nMisol: <code>@mychannel</code>',
        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'❌ Bekor', callback_data:'adm_panel' }]] } });
});

// Kanal o'chirish
bot.action('adm_rmch', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const chs = await getChannels();
    if (!chs.length) return ctx.reply('📭 Kanal yo\'q.', KB.admin());
    const rows = chs.map(ch => [{ text:`❌ ${ch}`, callback_data:`rmch_${ch.replace('@','')}` }]);
    rows.push([{ text:'⬅️ Orqaga', callback_data:'adm_panel' }]);
    await ctx.reply('❌ <b>O\'chirmoqchi bo\'lgan kanalni tanlang:</b>', { parse_mode:'HTML', reply_markup:{ inline_keyboard:rows } });
});

bot.action(/^rmch_(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const chs=await getChannels(), ch=`@${ctx.match[1]}`, idx=chs.indexOf(ch);
    if (idx===-1) return ctx.reply('❌ Topilmadi!');
    chs.splice(idx,1); await saveChannels(chs);
    await ctx.reply(`✅ ${ch} o'chirildi.`, KB.admin());
});

// Foydalanuvchilar
bot.action('adm_users', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    ST[ADMIN_ID] = { ...ST[ADMIN_ID], step:'find_user' };
    await ctx.reply('👤 Foydalanuvchi ID sini kiriting:', {
        reply_markup:{ inline_keyboard:[[{ text:'⬅️ Orqaga', callback_data:'adm_panel' }]] }
    });
});

// UZS so'rovlar
bot.action('adm_deps', async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const deps=await getDeposits(), pending=deps.filter(d=>d.status==='pending');
    if (!pending.length) return ctx.reply('📭 Kutayotgan so\'rov yo\'q.', KB.admin());
    for (const dep of pending.slice(0,10)) {
        await ctx.reply(
            `💵 <b>UZS Depozit</b>\n\n🆔 <code>${dep.id}</code>\n👤 ${dep.username} (<code>${dep.userId}</code>)\n💰 ${uzs(dep.amount)}\n📅 ${dep.createdAt}`,
            { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
                [{ text:'✅ Tasdiqlash', callback_data:`dep_ok_${dep.id}` }, { text:'❌ Rad etish', callback_data:`dep_no_${dep.id}` }],
            ]}}
        );
    }
});

bot.action(/^dep_ok_(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const deps=await getDeposits(), idx=deps.findIndex(d=>d.id===ctx.match[1]);
    if (idx===-1) return ctx.reply('❌ Topilmadi!');
    const dep=deps[idx]; deps[idx].status='approved'; await saveDeposits(deps);
    await addUzs(dep.userId, dep.amount);
    const nb=await getUzs(dep.userId);
    try { await bot.telegram.sendMessage(dep.userId, `✅ <b>UZS depozit tasdiqlandi!</b>\n\n💵 +${uzs(dep.amount)}\n💰 Balans: <b>${uzs(nb)}</b>`, { parse_mode:'HTML' }); } catch {}
    await ctx.reply(`✅ ${dep.userId} ga ${uzs(dep.amount)} qo'shildi.`);
});

bot.action(/^dep_no_(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const deps=await getDeposits(), idx=deps.findIndex(d=>d.id===ctx.match[1]);
    if (idx===-1) return ctx.reply('❌ Topilmadi!');
    deps[idx].status='rejected'; await saveDeposits(deps);
    try { await bot.telegram.sendMessage(deps[idx].userId, '❌ <b>UZS depozit rad etildi.</b>\nAdmin bilan bog\'laning.', { parse_mode:'HTML' }); } catch {}
    await ctx.reply('❌ Rad etildi.');
});

// ─────────────────────────────────────────────
//  PRE CHECKOUT
// ─────────────────────────────────────────────
bot.on('pre_checkout_query', async ctx => {
    try { await ctx.answerPreCheckoutQuery(true); } catch(e) { console.error('PreCheckout:', e); }
});

// ─────────────────────────────────────────────
//  SUCCESSFUL PAYMENT
// ─────────────────────────────────────────────
bot.on('successful_payment', async ctx => {
    try {
        const pay     = ctx.message.successful_payment;
        const payload = JSON.parse(pay.invoice_payload);
        const userId  = ctx.from.id;

        // ── Stars depozit ──
        if (payload.action === 'stars_dep') {
            const amount = Number(payload.amount);
            await addStars(userId, amount);
            // Referral bonus
            const u = await getUser(userId);
            if (u?.invitedBy) {
                const rb = Math.floor(amount * REFERRAL_PCT / 100);
                if (rb > 0) {
                    await addStars(u.invitedBy, rb);
                    try { await bot.telegram.sendMessage(u.invitedBy, `💰 Referalingiz Stars kiritdi!\n⭐ +${rb} Stars`, { parse_mode:'HTML' }); } catch {}
                }
            }
            const nb = await getStars(userId);
            await notifyAdmin(`⭐ <b>Stars depozit</b>\n👤 ${ctx.from.username?'@'+ctx.from.username:'—'} (<code>${userId}</code>)\n💰 +${amount} Stars`);
            return ctx.reply(`✅ <b>Stars qo'shildi!</b>\n\n⭐ +${amount} Stars\n💎 Balans: <b>${nb} ⭐</b>`, { parse_mode:'HTML', ...KB.main() });
        }

        // ── Gift ──
        if (payload.action === 'gift_buy') {
            const { gift_id, tg_gift_id, gift_name, ctype, comment, anonymous, friend_id, via_link } = payload;
            await notifyAdmin(`🎁 <b>Gift to'lovi</b>\nGift: ${esc(gift_name)}\nUser: ${ctx.from.username?'@'+ctx.from.username:'—'} (<code>${userId}</code>)\nTur: ${ctype}`);

            // Havola orqali
            if (via_link || ctype === 'link') {
                const bi  = await bot.telegram.getMe();
                const ap  = anonymous ? 'anon' : 'pub';
                const link= `https://t.me/${bi.username}?start=claim_${gift_id}_${userId}_${ap}`;
                return ctx.reply(
                    `✅ <b>To'lov qabul qilindi!</b>\n\n🎁 <b>${esc(gift_name)}</b>\n\n` +
                    `🔗 <b>Shu havolani do'stingizga yuboring:</b>\n${link}\n\n` +
                    `Do'stingiz kirganda avtomatik gift yuboriladi! 🎉`,
                    { parse_mode:'HTML', ...KB.main() }
                );
            }

            // To'g'ridan do'stga
            if (ctype === 'friend' && friend_id) {
                await ctx.reply('⏳ Gift yuborilmoqda...');
                const ok = await sendGift(Number(friend_id), tg_gift_id || gift_id, anonymous, comment);
                if (ok) return ctx.reply(`✅ <b>Gift do'stingizga yuborildi!</b>\n🎁 ${esc(gift_name)}`, { parse_mode:'HTML', ...KB.main() });
                return ctx.reply('❌ Xato! Admin bilan bog\'laning.', KB.main());
            }

            // O'zi uchun
            await ctx.reply('⏳ Gift yuborilmoqda...');
            const ok = await sendGift(userId, tg_gift_id || gift_id, anonymous, comment);
            if (ok) return ctx.reply(`✅ <b>Gift olindi!</b>\n🎁 ${esc(gift_name)}\n💰 To'lov amalga oshirildi.`, { parse_mode:'HTML', ...KB.main() });
            return ctx.reply('❌ Xato! Admin bilan bog\'laning.', KB.main());
        }
    } catch(e) { console.error('Payment:', e); try { await ctx.reply('❌ Xato.'); } catch {} }
});

// ─────────────────────────────────────────────
//  PHOTO — UZS CHEK
// ─────────────────────────────────────────────
bot.on('photo', async ctx => {
    try {
        const userId=ctx.from.id, st=ST[userId]||{};
        if (st.step !== 'uzs_check') return;
        const amount  = st.uzsAmount || 0;
        const username= ctx.from.username ? `@${ctx.from.username}` : 'no_username';
        delete st.step; delete st.uzsAmount;

        const deps   = await getDeposits();
        const depId  = `dep_${Date.now()}_${userId}`;
        deps.push({ id:depId, userId, username, amount, status:'pending', createdAt:new Date().toLocaleString('uz-UZ') });
        await saveDeposits(deps);

        await bot.telegram.sendPhoto(
            ADMIN_ID,
            ctx.message.photo[ctx.message.photo.length-1].file_id,
            {
                caption   : `💵 <b>UZS Depozit</b>\n\n👤 ${username} (<code>${userId}</code>)\n💰 ${uzs(amount)}\n🆔 <code>${depId}</code>`,
                parse_mode: 'HTML',
                reply_markup:{ inline_keyboard:[
                    [{ text:'✅ Tasdiqlash', callback_data:`dep_ok_${depId}` }, { text:'❌ Rad etish', callback_data:`dep_no_${depId}` }],
                ]},
            }
        );
        await ctx.reply(`✅ <b>Chek qabul qilindi!</b>\n\n💵 ${uzs(amount)}\n\n⏳ Admin tekshirib hisobingizga qo'shadi.`, { parse_mode:'HTML', ...KB.balance() });
    } catch(e) { console.error('Photo:', e); }
});

// ─────────────────────────────────────────────
//  TEXT HANDLER
// ─────────────────────────────────────────────
bot.on('text', async ctx => {
    try {
        const userId = ctx.from.id;
        const text   = (ctx.message.text || '').trim();
        const st     = ST[userId] || {};

        // ═══ ADMIN TG LOGIN ═══════════════════
        if (userId === ADMIN_ID) {

            // Telefon kiritish
            if (st.tgStep === 'phone') {
                if (!text.startsWith('+')) { await ctx.reply('❌ +998... formatida kiriting:'); return; }
                st.tgPhone = text; st.tgStep = 'code';
                try {
                    tgClient = new TelegramClient(new StringSession(''), API_ID, API_HASH, { connectionRetries:5, useWSS:false });
                    await tgClient.connect();
                    const res  = await tgClient.sendCode({ apiId:API_ID, apiHash:API_HASH }, text);
                    st.tgHash  = res.phoneCodeHash;
                    await ctx.reply('📲 Telegram kodni kiriting:\n<i>(Telegramdan kelgan 5 raqamli kod)</i>',
                        { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'❌ Bekor', callback_data:'adm_tg_cancel' }]] } });
                } catch(e) {
                    await ctx.reply(`❌ Xato: ${e.message}`);
                    delete st.tgStep; tgClient=null;
                }
                return;
            }

            // Kod kiritish
            if (st.tgStep === 'code') {
                try {
                    await tgClient.invoke(new Api.auth.SignIn({
                        phoneNumber   : st.tgPhone,
                        phoneCodeHash : st.tgHash,
                        phoneCode     : text.replace(/\s/g,''),
                    }));
                    tgConnected = true;
                    await sessionSave(tgClient.session.save());
                    const me = await tgClient.getMe();
                    delete st.tgStep; delete st.tgPhone; delete st.tgHash;
                    await ctx.reply(`✅ <b>Muvaffaqiyatli ulandi!</b>\n\n👤 @${me.username}\n📱 ${me.firstName}`, { parse_mode:'HTML', ...KB.admin() });
                } catch(e) {
                    if (e.message.includes('SESSION_PASSWORD_NEEDED')) {
                        st.tgStep = 'password';
                        await ctx.reply('🔐 <b>2FA paroli:</b>', { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{ text:'❌ Bekor', callback_data:'adm_tg_cancel' }]] } });
                    } else {
                        await ctx.reply(`❌ Kod xato: ${e.message}`);
                        delete st.tgStep;
                    }
                }
                return;
            }

            // 2FA paroli
            if (st.tgStep === 'password') {
                try {
                    const pwdInfo = await tgClient.invoke(new Api.account.GetPassword());
                    await tgClient.invoke(new Api.auth.CheckPassword({ password: await computeSrp(pwdInfo, text) }));
                    tgConnected = true;
                    await sessionSave(tgClient.session.save());
                    const me = await tgClient.getMe();
                    delete st.tgStep;
                    await ctx.reply(`✅ <b>Ulandi!</b>\n\n👤 @${me.username}`, { parse_mode:'HTML', ...KB.admin() });
                } catch(e) { await ctx.reply(`❌ Parol xato: ${e.message}`); }
                return;
            }

            // Foydalanuvchi qidirish
            if (st.step === 'find_user') {
                const targetId = Number(text);
                if (!targetId) { await ctx.reply('❌ To\'g\'ri ID kiriting.'); return; }
                delete st.step;
                const u = await getUser(targetId);
                if (!u) return ctx.reply('❌ Foydalanuvchi topilmadi!', KB.admin());
                await ctx.reply(
                    `👤 <b>Foydalanuvchi</b>\n\n🆔 <code>${u.userId}</code>\n📛 ${u.username}\n⭐ Stars: <b>${u.stars}</b>\n💵 UZS: <b>${uzs(u.uzs)}</b>\n📅 ${u.joinedAt}`,
                    { parse_mode:'HTML', reply_markup:{ inline_keyboard:[
                        [{ text:`+Stars`, callback_data:`admu_stars_${targetId}` }, { text:`+UZS`, callback_data:`admu_uzs_${targetId}` }],
                        [{ text:'⬅️ Admin', callback_data:'adm_panel' }],
                    ]}}
                );
                return;
            }

            // Gift qo'shish
            if (st.step === 'add_gift') {
                delete st.step;
                const parts = text.split('|');
                if (parts.length < 2) return ctx.reply('❌ Format: Nom|Stars|TgGiftID', KB.admin());
                const name=parts[0].trim(), price=parseInt(parts[1].trim(),10), tgId=parts[2]?parts[2].trim():null;
                if (!name||isNaN(price)||price<=0) return ctx.reply('❌ Format: Nom|Stars|TgGiftID');
                const gifts=await getGifts(), ng={ id:String(Date.now()), name, price, telegramId:tgId };
                gifts.push(ng); await saveGifts(gifts);
                await ctx.reply(`✅ <b>Gift qo'shildi!</b>\n\n🎁 ${ng.name}\n💰 ${ng.price}⭐ (${uzs(ng.price*STARS_TO_UZS)})\n🆔 TG ID: ${tgId||'—'}`, { parse_mode:'HTML', ...KB.admin() });
                return;
            }

            // Kanal qo'shish
            if (st.step === 'add_channel') {
                delete st.step;
                const ch = text.startsWith('@') ? text : `@${text}`;
                const chs= await getChannels();
                if (!chs.includes(ch)) chs.push(ch);
                await saveChannels(chs);
                await ctx.reply(`✅ ${ch} qo'shildi.`, KB.admin());
                return;
            }

            // Broadcast
            if (st.step === 'broadcast') {
                delete st.step;
                const lines=text.split('\n').map(s=>s.trim()).filter(Boolean), msgLines=[], buttons=[];
                for (const line of lines) {
                    if (line.includes('|')) { const[l,u]=line.split('|'); buttons.push([{ text:l.trim(), url:tme(u.trim()) }]); }
                    else msgLines.push(line);
                }
                const msg  = msgLines.join('\n') || ' ';
                const users= await getUsers();
                let ok=0, fail=0;
                await ctx.reply(`📢 Yuborilmoqda... (${users.length} ta foydalanuvchi)`);
                for (const u of users) {
                    try {
                        await bot.telegram.sendMessage(u.userId, msg, { parse_mode:'HTML', reply_markup:buttons.length?{ inline_keyboard:buttons }:undefined });
                        ok++;
                    } catch { fail++; }
                    await sleep(35);
                }
                await ctx.reply(`✅ Broadcast tugadi!\n\n✔️ Yuborildi: ${ok}\n❌ Xato: ${fail}`, KB.admin());
                return;
            }

            // Stars qo'shish (admu_stars_ID)
            if (st.step?.startsWith('addstars_')) {
                const targetId=Number(st.step.split('_')[1]), amount=Number(text);
                delete st.step;
                if (!amount||amount<=0) return ctx.reply('❌ Noto\'g\'ir miqdor!');
                const r=await addStars(targetId,amount);
                await ctx.reply(r?`✅ ${targetId} ga +${amount} ⭐`:'❌ Foydalanuvchi topilmadi!', KB.admin());
                return;
            }
            if (st.step?.startsWith('adduzs_')) {
                const targetId=Number(st.step.split('_')[1]), amount=Number(text.replace(/\s/g,''));
                delete st.step;
                if (!amount||amount<=0) return ctx.reply('❌ Noto\'g\'ir miqdor!');
                const r=await addUzs(targetId,amount);
                await ctx.reply(r?`✅ ${targetId} ga +${uzs(amount)}`:'❌ Foydalanuvchi topilmadi!', KB.admin());
                return;
            }
        }

        // ═══ USER STEPLAR ══════════════════════

        // UZS miqdori
        if (st.step === 'uzs_amount') {
            const amount = parseInt(text.replace(/[\s,]/g,''), 10);
            if (isNaN(amount) || amount <= 0) { await ctx.reply('❌ To\'g\'ri miqdor kiriting (raqam):'); return; }
            delete st.step; st.uzsAmount = amount; st.step = 'uzs_check';
            await ctx.reply(
                `💵 <b>To'lov ma'lumotlari:</b>\n\n💰 Miqdor: <b>${uzs(amount)}</b>\n🏦 Karta: <code>${CARD_NUMBER}</code>\n\n` +
                `✅ Shu kartaga <b>${uzs(amount)}</b> o'tkazing.\n📸 O'tkazgandan so'ng <b>to'lov chekini (screenshot)</b> yuboring:`,
                { parse_mode:'HTML' }
            );
            return;
        }

        // Stars miqdori
        if (st.step === 'stars_amount') {
            const amount = parseInt(text, 10);
            if (isNaN(amount) || amount < 1) { await ctx.reply('❌ 1 dan katta raqam kiriting:'); return; }
            delete st.step;
            await sendStarsInvoice(ctx, amount, ctx.from.id);
            return;
        }

        // Convert miqdori
        if (st.step === 'convert_amount') {
            const amount = parseInt(text, 10);
            const stars  = await getStars(ctx.from.id);
            if (isNaN(amount)||amount<=0) { await ctx.reply('❌ To\'g\'ri raqam kiriting:'); return; }
            if (amount > stars) { await ctx.reply(`❌ Yetarli Stars yo'q! Sizda: ${stars} ⭐`); return; }
            delete st.step;
            const uzsAmt = amount * STARS_TO_UZS;
            await deductStars(ctx.from.id, amount);
            await addUzs(ctx.from.id, uzsAmt);
            const ns=await getStars(ctx.from.id), nu=await getUzs(ctx.from.id);
            await ctx.reply(`✅ <b>Konvertatsiya!</b>\n\n⭐ -${amount} Stars → 💵 +${uzs(uzsAmt)}\n\n💼 Yangi balans:\n   ⭐ ${ns} Stars\n   💵 ${uzs(nu)}`,
                { parse_mode:'HTML', ...KB.balance() });
            return;
        }

        // Custom tikish
        if (st.step === 'custom_bet' && st.curGame) {
            const bet = parseInt(text, 10);
            if (isNaN(bet)||bet<=0) { await ctx.reply('❌ Musbat raqam kiriting:'); return; }
            delete st.step; delete st.curGame;
            await playGame(ctx, st.curGame, bet);
            return;
        }

        // Gift izoh
        if (st.step === 'gift_comment' && st.selGift) {
            if (text.startsWith('/')) return;
            delete st.step; st.comment = text;
            await askAnon(ctx, 'self');
            return;
        }

        // Do'st username
        if (st.step === 'friend_username' && st.selGift) {
            if (text.startsWith('/')) return;
            delete st.step;
            st.friendUsername = text.startsWith('@') ? text.slice(1) : text;
            await askAnon(ctx, 'friend');
            return;
        }

        // ═══ KOMANDALAR ════════════════════════
        if (text === '/admin' && userId === ADMIN_ID) {
            return ctx.reply('⚙️ <b>Admin Panel</b>', { parse_mode:'HTML', ...KB.admin() });
        }
        if (text === '/start') return; // start handler boshqaradi

        // /addstars 123 50
        if (text.startsWith('/addstars ') && userId === ADMIN_ID) {
            const [,id,am] = text.split(/\s+/);
            const r = await addStars(Number(id), Number(am));
            await ctx.reply(r ? `✅ +${am}⭐ → ${id}` : '❌ Topilmadi!');
            return;
        }
        if (text.startsWith('/adduzs ') && userId === ADMIN_ID) {
            const [,id,am] = text.split(/\s+/);
            const r = await addUzs(Number(id), Number(am));
            await ctx.reply(r ? `✅ +${uzs(Number(am))} → ${id}` : '❌ Topilmadi!');
            return;
        }
        if (text.startsWith('/stars ') && userId === ADMIN_ID) {
            const n = parseInt(text.split(' ')[1], 10);
            if (!isNaN(n) && n > 0) { REFERRAL_REWARD=n; await ctx.reply(`✅ Referral: ${n} ⭐`); }
            return;
        }

    } catch(e) { console.error('Text handler:', e); }
});

// ─────────────────────────────────────────────
//  ADMIN: foydalanuvchiga stars/uzs qo'shish inline
// ─────────────────────────────────────────────
bot.action(/^admu_(stars|uzs)_(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (ctx.from.id !== ADMIN_ID) return;
    const type=ctx.match[1], targetId=ctx.match[2];
    ST[ADMIN_ID] = { ...ST[ADMIN_ID], step:`add${type}_${targetId}` };
    await ctx.reply(`💰 ${targetId} ga qancha ${type==='stars'?'Stars ⭐':'UZS 💵'} qo'shmoqchisiz? Raqam kiriting:`);
});

// ─────────────────────────────────────────────
//  INIT & LAUNCH
// ─────────────────────────────────────────────
async function main() {
    await initDB();

    // Saqlangan sessiyani yuklash
    const saved = await sessionLoad();
    if (saved) {
        console.log('📡 Sessiya topildi, ulanilmoqda...');
        await tgInit(saved);
    } else {
        console.log('⚠️  TG hisob ulanmagan. /admin → 📱 TG hisob');
    }

    await bot.launch();
    const me = await bot.telegram.getMe();
    console.log('─'.repeat(50));
    console.log(`✅ Bot: @${me.username}`);
    console.log(`👨‍💼 Admin ID: ${ADMIN_ID}`);
    console.log(`💳 Karta: ${CARD_NUMBER}`);
    console.log(`💱 1 Stars = ${STARS_TO_UZS} UZS`);
    console.log(`📱 TG hisob: ${tgConnected ? '🟢 Ulangan' : '🔴 Ulanmagan'}`);
    console.log('─'.repeat(50));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
bot.catch((e, ctx) => console.error(`[${ctx?.updateType}]`, e));
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
