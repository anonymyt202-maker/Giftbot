require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

const API_ID = Number(process.env.API_ID || 0);
const API_HASH = process.env.API_HASH || '';
const SESSION_FILE = path.join(__dirname, 'telegram.session');
const HOST = process.env.SENDGIFT_HOST || '0.0.0.0';
const PORT = Number(process.env.SENDGIFT_PORT || 4242);
const SECRET = process.env.SENDGIFT_SECRET || 'supersecretkey';

let client = null;
let authState = null;

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadSessionString() {
  try {
    return (await fs.readFile(SESSION_FILE, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function saveSessionString(sessionString) {
  await fs.writeFile(SESSION_FILE, sessionString, 'utf8');
}

async function getClient() {
  if (client) return client;
  if (!API_ID || !API_HASH) throw new Error('API_ID yoki API_HASH yo‘q');
  const sessionString = await loadSessionString();
  client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
    connectionRetries: 5
  });
  await client.connect();
  return client;
}

async function isAuthorized() {
  const c = await getClient();
  return await c.isUserAuthorized();
}

function requireSecret(req, res, next) {
  if ((req.headers['x-secret'] || '') !== SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

async function startLogin(phone) {
  const c = await getClient();

  if (authState?.running) {
    throw new Error('Login jarayoni allaqachon davom etmoqda');
  }

  const codeGate = deferred();
  const passGate = deferred();
  const doneGate = deferred();
  const passwordNeededGate = deferred();

  authState = {
    running: true,
    phone,
    codeGate,
    passGate,
    doneGate,
    passwordNeededGate,
    needPassword: false,
    lastError: null
  };

  (async () => {
    try {
      await c.start({
        phoneNumber: async () => phone,
        phoneCode: async () => {
          authState.needCode = true;
          return await codeGate.promise;
        },
        password: async () => {
          authState.needPassword = true;
          passwordNeededGate.resolve(true);
          return await passGate.promise;
        },
        onError: (err) => {
          authState.lastError = err?.message || String(err);
        }
      });

      const sessionString = c.session.save();
      await saveSessionString(sessionString);
      const me = await c.getMe();
      doneGate.resolve({
        ok: true,
        user: {
          id: me?.id ? String(me.id) : null,
          username: me?.username || null,
          first_name: me?.firstName || me?.first_name || null,
          last_name: me?.lastName || me?.last_name || null
        }
      });
    } catch (err) {
      doneGate.reject(err);
    } finally {
      authState.running = false;
    }
  })().catch(err => {
    authState.lastError = err?.message || String(err);
    doneGate.reject(err);
    authState.running = false;
  });

  return { ok: true, need_code: true };
}

async function submitCode(code) {
  if (!authState?.running) return { ok: false, error: 'Login boshlanmagan' };
  authState.codeGate.resolve(code);
  const race = await Promise.race([
    authState.doneGate.promise.then(v => ({ type: 'done', value: v })).catch(err => ({ type: 'done_err', error: err })),
    authState.passwordNeededGate.promise.then(() => ({ type: 'need_password' })),
    new Promise(resolve => setTimeout(() => resolve({ type: 'pending' }), 1200))
  ]);

  if (race.type === 'done') return race.value;
  if (race.type === 'done_err') return { ok: false, error: race.error?.message || String(race.error) };
  if (race.type === 'need_password') return { ok: false, need_password: true };
  return { ok: true, pending: true };
}

async function submitPassword(password) {
  if (!authState?.running) return { ok: false, error: 'Login boshlanmagan' };
  authState.passGate.resolve(password);
  try {
    const result = await authState.doneGate.promise;
    return result;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function resolveRecipient(c, recipient) {
  const value = String(recipient || '').trim();
  if (!value) throw new Error('recipient kerak');

  if (value === 'me') {
    return await c.getInputEntity('me');
  }

  if (/^@?[a-zA-Z0-9_]{5,32}$/.test(value)) {
    const username = value.startsWith('@') ? value : `@${value}`;
    return await c.getInputEntity(username);
  }

  if (/^\d+$/.test(value)) {
    return await c.getInputEntity(Number(value));
  }

  return await c.getInputEntity(value);
}

async function sendGiftToRecipient({ recipient, giftId, anonymous = false, message = '' }) {
  const c = await getClient();
  if (!(await isAuthorized())) {
    throw new Error('Telegram akkaunt ulanmagan');
  }

  const peer = await resolveRecipient(c, recipient);
  const invoice = new Api.InputInvoiceStarGift({
    peer,
    giftId: BigInt(giftId),
    hideName: !!anonymous,
    includeUpgrade: false,
    message: message
      ? new Api.TextWithEntities({
          text: String(message),
          entities: []
        })
      : undefined
  });

  const form = await c.invoke(new Api.payments.GetPaymentForm({ invoice }));
  const result = await c.invoke(new Api.payments.SendStarsForm({
    formId: form.formId,
    invoice
  }));

  return { ok: true, result: String(result) };
}

async function health() {
  try {
    const authorized = await isAuthorized();
    return { ok: true, authorized, pending: !!authState?.running };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function main() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', requireSecret, async (_req, res) => {
    res.json(await health());
  });

  app.post('/auth/start', requireSecret, async (req, res) => {
    try {
      const phone = String(req.body?.phone || '').trim();
      if (!phone) return res.status(400).json({ ok: false, error: 'phone kerak' });
      res.json(await startLogin(phone));
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/auth/code', requireSecret, async (req, res) => {
    try {
      const code = String(req.body?.code || '').trim();
      if (!code) return res.status(400).json({ ok: false, error: 'code kerak' });
      res.json(await submitCode(code));
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/auth/password', requireSecret, async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      if (!password) return res.status(400).json({ ok: false, error: 'password kerak' });
      res.json(await submitPassword(password));
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  app.post('/sendgift', requireSecret, async (req, res) => {
    try {
      const recipient = req.body?.recipient;
      const giftId = req.body?.gift_id;
      const anonymous = !!req.body?.anonymous;
      const message = String(req.body?.message || '');

      if (!recipient) return res.status(400).json({ ok: false, error: 'recipient kerak' });
      if (!giftId) return res.status(400).json({ ok: false, error: 'gift_id kerak' });

      const result = await sendGiftToRecipient({ recipient, giftId, anonymous, message });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  await getClient();
  app.listen(PORT, HOST, () => {
    console.log(`✅ sendgift.js ishga tushdi: http://${HOST}:${PORT}`);
  });
}

main().catch(err => {
  console.error('sendgift main error:', err);
  process.exit(1);
});

process.once('SIGINT', () => {
  if (client) client.destroy();
  process.exit(0);
});
process.once('SIGTERM', () => {
  if (client) client.destroy();
  process.exit(0);
});
