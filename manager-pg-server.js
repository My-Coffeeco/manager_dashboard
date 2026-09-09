'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hash, verify } = require('./admin-db');
const { openPool, transaction, checkDatabase, safeNumber } = require('./manager-pg-db');
const { seedManager, provisionDatabaseRole } = require('./manager-pg-setup');

const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
const text = (value, max = 200) => typeof value === 'string' && value.trim() && value.length <= max
  ? value.trim() : fail(400, 'Invalid or missing text field.');
const integer = value => Number.isSafeInteger(value) && value >= 0
  ? value : fail(400, 'Expected a nonnegative integer.');
const digestEqual = (left, right) => crypto.timingSafeEqual(Buffer.from(hash(left), 'hex'), Buffer.from(hash(right), 'hex'));
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const assets = {
  '/admin/polish.css': ['admin-polish.css', 'text/css'],
  '/admin/raleway.woff2': ['raleway.woff2', 'font/woff2'],
  '/admin/ui.js': ['admin-ui.js', 'text/javascript'],
  '/admin/ui.css': ['admin-ui.css', 'text/css'],
  '/admin/logo.avif': ['logo.avif', 'image/avif'],
};
function originFor(env) {
  let url;
  try { url = new URL(env.ADMIN_ORIGIN); } catch { throw Error('ADMIN_ORIGIN is required.'); }
  if (url.origin !== env.ADMIN_ORIGIN || (url.protocol !== 'https:' &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url.origin))) {
    throw Error('Use an exact HTTPS ADMIN_ORIGIN without a path or trailing slash.');
  }
  return url.origin;
}
async function readInput(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'JSON required.');
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 32768) fail(413, 'Request too large.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Invalid request.');
  return value;
}
async function readRaw(req, max = 2097152) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) fail(413, 'Request too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function validShopifyHmac(raw, provided, secret) {
  if (typeof provided !== 'string' || typeof secret !== 'string' || secret.length < 16) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const left = Buffer.from(provided, 'utf8'), right = Buffer.from(expected, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function paise(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
  if (!match) fail(400, 'Invalid order amount.');
  const result = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return integer(result);
}
function shopifyOrderEvent(payload, headers) {
  const topic = text(headers['x-shopify-topic'], 80), delivery = text(headers['x-shopify-webhook-id'], 100);
  if (!['orders/create','orders/paid','orders/updated','orders/cancelled','orders/fulfilled'].includes(topic)) fail(400, 'Unsupported Shopify webhook topic.');
  const id = text(String(payload.name || payload.id), 100);
  let status = payload.cancelled_at || topic === 'orders/cancelled' ? 'cancelled'
    : payload.fulfillment_status === 'fulfilled' || topic === 'orders/fulfilled' ? 'shipped'
    : payload.financial_status === 'paid' || topic === 'orders/paid' ? 'paid' : 'payment_pending';
  const addressName = payload.shipping_address?.name || payload.billing_address?.name;
  const customerName = [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(' ');
  const occurredAt = Date.parse(headers['x-shopify-triggered-at'] || payload.updated_at || payload.created_at || '');
  return {
    event_id: `shopify:${delivery}`, store_id: 'mycoffeeco-online', type: 'order',
    occurred_at: Number.isSafeInteger(occurredAt) ? occurredAt : Date.now(),
    data: { id, customer: text(addressName || customerName || 'Customer', 100), status,
      amount_paise: paise(payload.current_total_price ?? payload.total_price),
      paid_at: payload.processed_at ? Date.parse(payload.processed_at) : null },
  };
}
const audit = (client, actor, action, target) => client.query(`INSERT INTO mcc_manager.admin_audit
  (actor,action,target,created_at) VALUES ($1,$2,$3,$4)`, [actor, action, target, Date.now()]);

async function rateLimit(pool, key, max = 10) {
  const now = Date.now();
  const { rows } = await pool.query(`INSERT INTO mcc_manager.admin_limits AS limits (key,attempts,reset_at)
    VALUES ($1,1,$2) ON CONFLICT(key) DO UPDATE SET
    attempts=CASE WHEN limits.reset_at <= $3 THEN 1 ELSE LEAST(limits.attempts+1,$4) END,
    reset_at=CASE WHEN limits.reset_at <= $3 THEN $2 ELSE limits.reset_at END RETURNING attempts`,
  [key, now + 900000, now, max + 1]);
  if (rows[0].attempts > max) fail(429, 'Too many attempts. Try again in 15 minutes.');
}

function validateEvent(input) {
  const id = text(input.event_id), store = text(input.store_id), type = text(input.type);
  const permission = { order: 'orders', stock: 'inventory', inquiry: 'inquiries' }[type];
  if (!permission) fail(400, 'Unknown event type.');
  const occurred = integer(input.occurred_at);
  if (occurred > Date.now() + 300000) fail(400, 'Event timestamp is in the future.');
  const d = input.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail(400, 'Event data is required.');
  const record = text(type === 'stock' ? d.sku : d.id);
  let values, message;
  if (type === 'order') {
    if (!['paid','payment_pending','shipped','delivered','cancelled'].includes(d.status)) fail(400, 'Invalid order status.');
    values = [record, store, text(d.customer, 100), d.status, integer(d.amount_paise), d.paid_at == null ? null : integer(d.paid_at), occurred];
    message = `Order ${record}: ${d.status}`;
  } else if (type === 'stock') {
    values = [record, store, integer(d.quantity), integer(d.threshold), occurred];
    message = d.quantity <= d.threshold ? `Low stock: ${record}` : null;
  } else {
    if (!['Wholesale','Franchise'].includes(d.type) || !['new','in_review','closed'].includes(d.status)) fail(400, 'Invalid inquiry type or status.');
    values = [record, store, text(d.name, 100), d.type, d.status, integer(d.submitted_at), occurred];
    message = `${d.type} inquiry: ${record}`;
  }
  return { id, store, type, permission, occurred, values, message };
}
const eventQueries = {
  order: `INSERT INTO mcc_manager.admin_orders AS current (id,store_id,customer,status,amount_paise,paid_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id,store_id) DO UPDATE SET
    customer=excluded.customer,status=excluded.status,amount_paise=excluded.amount_paise,
    paid_at=excluded.paid_at,updated_at=excluded.updated_at WHERE excluded.updated_at > current.updated_at RETURNING id`,
  stock: `INSERT INTO mcc_manager.admin_stock AS current (sku,store_id,quantity,threshold,updated_at)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT(sku,store_id) DO UPDATE SET
    quantity=excluded.quantity,threshold=excluded.threshold,updated_at=excluded.updated_at
    WHERE excluded.updated_at > current.updated_at RETURNING sku`,
  inquiry: `INSERT INTO mcc_manager.admin_inquiries AS current (id,store_id,name,type,status,submitted_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id,store_id) DO UPDATE SET
    name=excluded.name,type=excluded.type,status=excluded.status,submitted_at=excluded.submitted_at,
    updated_at=excluded.updated_at WHERE excluded.updated_at > current.updated_at RETURNING id`,
};
async function acceptEvent(pool, input) {
  const event = validateEvent(input);
  return transaction(pool, async client => {
    if (!(await client.query('SELECT id FROM mcc_manager.stores WHERE id=$1', [event.store])).rowCount) fail(400, 'Unknown store.');
    const insert = await client.query(`INSERT INTO mcc_manager.admin_events(id,store_id,type,occurred_at,created_at)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id`,
    [event.id, event.store, event.type, event.occurred, Date.now()]);
    if (!insert.rowCount) {
      const prior = (await client.query('SELECT store_id,type FROM mcc_manager.admin_events WHERE id=$1', [event.id])).rows[0];
      if (prior.store_id !== event.store || prior.type !== event.type) fail(409, 'Event ID already belongs to another source or store.');
      return { duplicate: true };
    }
    const update = await client.query(eventQueries[event.type], event.values);
    if (update.rowCount && event.message) {
      await client.query(`INSERT INTO mcc_manager.admin_alerts(admin_id,event_id,message)
        SELECT a.id,$1,$2 FROM mcc_manager.admins a
        JOIN mcc_manager.permissions p ON p.role=a.role AND p.permission=$3
        WHERE a.disabled=false AND a.role='store_manager' AND a.store_id=$4
        ON CONFLICT(admin_id,event_id) DO NOTHING`, [event.id, event.message, event.permission, event.store]);
    }
    await audit(client, 'connector', update.rowCount ? 'event_applied' : 'stale_event_ignored', event.id);
    return { ok: true, applied: !!update.rowCount };
  });
}
async function dashboard(pool, session, permissions) {
  const store = session.store_id;
  const result = await pool.query('SELECT id,name FROM mcc_manager.stores WHERE id=$1', [store]);
  if (!result.rowCount) fail(404, 'Store unavailable.');
  const sourceRows = (await pool.query(`SELECT type,max(created_at) AS last_received
    FROM mcc_manager.admin_events WHERE store_id=$1 GROUP BY type`, [store])).rows;
  const sources = Object.fromEntries(sourceRows.filter(row => permissions.has({ order: 'orders', stock: 'inventory', inquiry: 'inquiries' }[row.type]))
    .map(row => [row.type, safeNumber(row.last_received)]));
  const numericRows = (rows, keys) => rows.map(row => Object.fromEntries(Object.entries(row)
    .map(([key, value]) => [key, keys.includes(key) ? safeNumber(value) : value])));
  const orders = permissions.has('orders') ? numericRows((await pool.query(`SELECT id,customer,status,amount_paise,paid_at
    FROM mcc_manager.admin_orders WHERE store_id=$1 ORDER BY updated_at DESC,id LIMIT 100`, [store])).rows, ['amount_paise','paid_at']) : null;
  const inquiries = permissions.has('inquiries') ? numericRows((await pool.query(`SELECT id,name,type,status,submitted_at
    FROM mcc_manager.admin_inquiries WHERE store_id=$1 ORDER BY submitted_at DESC,id LIMIT 100`, [store])).rows, ['submitted_at']) : null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(x => x.type === type).value;
  const start = Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00+05:30`);
  const scalar = async (sql, values) => safeNumber((await pool.query(sql, values)).rows[0].value);
  const revenue = permissions.has('orders') && sources.order ? await scalar(`SELECT coalesce(sum(amount_paise),0) AS value
    FROM mcc_manager.admin_orders WHERE store_id=$1 AND paid_at >= $2 AND paid_at < $3
    AND status IN ('paid','shipped','delivered')`, [store, start, start + 86400000]) : null;
  return {
    store: result.rows[0], sources, revenue_paise: revenue,
    open_orders: permissions.has('orders') && sources.order ? await scalar(`SELECT count(*) AS value FROM mcc_manager.admin_orders WHERE store_id=$1 AND status IN ('paid','payment_pending')`, [store]) : null,
    low_stock: permissions.has('inventory') && sources.stock ? await scalar(`SELECT count(*) AS value FROM mcc_manager.admin_stock WHERE store_id=$1 AND quantity<=threshold`, [store]) : null,
    open_inquiries: permissions.has('inquiries') && sources.inquiry ? await scalar(`SELECT count(*) AS value FROM mcc_manager.admin_inquiries WHERE store_id=$1 AND status!='closed'`, [store]) : null,
    orders, inquiries,
    alerts: numericRows((await pool.query(`SELECT id,message FROM mcc_manager.admin_alerts
      WHERE admin_id=$1 AND read_at IS NULL ORDER BY id DESC LIMIT 100`, [session.id])).rows, ['id']),
    data_notice: Object.keys(sources).length
      ? 'Figures cover received records only, not a verified full Shopify sync. Shipping and payment actions remain in their existing systems.'
      : 'No order, stock or inquiry updates have been received. Shopify and Shiprocket feeds are not connected to this manager database yet.',
  };
}

function createManagerApp({ pool, env = process.env }) {
  const origin = originFor(env), secure = origin.startsWith('https:');
  const dummy = crypto.randomBytes(16).toString('hex') + ':' + crypto.randomBytes(64).toString('hex');
  const app = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    const cookie = (value, maxAge) => `mcc_admin=${value}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const p = new URL(req.url, origin).pathname, method = req.method;
      if (!['GET','POST'].includes(method)) fail(405, 'Method not allowed.');
      if (method === 'GET' && p === '/healthz') { await checkDatabase(pool, { requireManager: true }); return json(200, { status: 'ok' }); }
      if (['/','/manager','/admin/'].includes(p) && method === 'GET') { res.writeHead(302, { Location: '/admin' }); return res.end(); }
      if (p.startsWith('/admin/invite') || ['/admin/stores','/admin/audit'].includes(p)) fail(404, 'Not found.');
      if (method === 'GET' && ['/admin','/admin/login'].includes(p)) {
        const html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8')
          .replace('<div id="stats"', '<p id="data-notice" role="status"></p><div id="stats"');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html);
      }
      if (method === 'GET' && assets[p]) {
        res.writeHead(200, { 'Content-Type': assets[p][1] }); return res.end(fs.readFileSync(path.join(__dirname, assets[p][0])));
      }
      if (p === '/webhooks/shopify/orders' && method === 'POST') {
        const raw = await readRaw(req);
        if (!validShopifyHmac(raw, req.headers['x-shopify-hmac-sha256'], env.SHOPIFY_CLIENT_SECRET)) fail(401, 'Invalid Shopify webhook signature.');
        const shop = String(req.headers['x-shopify-shop-domain'] || '').toLowerCase();
        if (!env.SHOPIFY_SHOP_DOMAIN || shop !== env.SHOPIFY_SHOP_DOMAIN.toLowerCase()) fail(403, 'Unexpected Shopify store.');
        let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'Invalid Shopify webhook JSON.'); }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail(400, 'Invalid Shopify webhook payload.');
        const result = await acceptEvent(pool, shopifyOrderEvent(payload, req.headers));
        return json(200, result);
      }
      let input;
      if (method === 'POST') {
        if (p === '/admin/events') {
          if (!env.ADMIN_EVENT_SECRET || env.ADMIN_EVENT_SECRET.length < 32 ||
              !digestEqual(req.headers.authorization || '', 'Bearer ' + env.ADMIN_EVENT_SECRET)) fail(401, 'Invalid event credentials.');
          // An internal adapter endpoint, NOT a Shopify/Shiprocket webhook URL.
        } else if (req.headers.origin !== origin) fail(403, 'Invalid origin.');
        input = await readInput(req);
      }
      if (p === '/admin/events' && method === 'POST') return json(200, await acceptEvent(pool, input));
      if (p === '/admin/auth/login' && method === 'POST') {
        const email = text(input.email, 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Invalid email.');
        if (typeof input.password !== 'string' || !input.password || input.password.length > 128) fail(400, 'Invalid password.');
        await rateLimit(pool, 'login-global', 200); await rateLimit(pool, 'login:' + hash(email));
        const account = (await pool.query('SELECT id,password_hash FROM mcc_manager.admins WHERE email=$1', [email])).rows[0];
        let ok = false;
        try { ok = await verify(input.password, account?.password_hash || dummy); } catch { /* Fail closed for malformed hashes. */ }
        if (!ok || !account) fail(401, 'Email or password not recognised.');
        const token = crypto.randomBytes(32).toString('base64url'), csrf = crypto.randomBytes(32).toString('base64url');
        await transaction(pool, async client => {
          // Recheck the current role/account/password AFTER asynchronous password verification.
          const current = await client.query(`SELECT id FROM mcc_manager.admins
            WHERE id=$1 AND password_hash=$2 AND disabled=false AND role='store_manager'`, [account.id, account.password_hash]);
          if (!current.rowCount) fail(401, 'Email or password not recognised.');
          await client.query('DELETE FROM mcc_manager.admin_sessions WHERE expires <= $1', [Date.now()]);
          await client.query('DELETE FROM mcc_manager.admin_limits WHERE reset_at <= $1', [Date.now()]);
          await client.query(`INSERT INTO mcc_manager.admin_sessions(token_hash,admin_id,csrf,expires)
            VALUES ($1,$2,$3,$4)`, [hash(token), account.id, csrf, Date.now() + 14400000]);
          await audit(client, account.id, 'login', account.id);
        });
        res.setHeader('Set-Cookie', cookie(token, 14400)); return json(200, { ok: true });
      }
      const cookies = (req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith('mcc_admin='));
      const token = cookies.length === 1 ? cookies[0].slice(10) : '';
      if (!tokenPattern.test(token)) fail(401, 'Please sign in.');
      const session = (await pool.query(`SELECT s.csrf,a.id,a.name,a.email,a.role,a.store_id
        FROM mcc_manager.admin_sessions s JOIN mcc_manager.admins a ON a.id=s.admin_id
        WHERE s.token_hash=$1 AND s.expires>$2 AND a.disabled=false AND a.role='store_manager'`, [hash(token), Date.now()])).rows[0];
      if (!session) fail(401, 'Please sign in.');
      if (method === 'POST' && !digestEqual(req.headers['x-csrf-token'] || '', session.csrf)) fail(403, 'Invalid CSRF token.');
      const permissions = new Set((await pool.query('SELECT permission FROM mcc_manager.permissions WHERE role=$1', [session.role])).rows.map(x => x.permission));
      if (p === '/admin/auth/me' && method === 'GET') return json(200, { ...session, permissions: [...permissions] });
      if (p === '/admin/auth/logout' && method === 'POST') {
        await transaction(pool, async client => {
          await client.query('DELETE FROM mcc_manager.admin_sessions WHERE token_hash=$1', [hash(token)]);
          await audit(client, session.id, 'logout', session.id);
        });
        res.setHeader('Set-Cookie', cookie('', 0)); return json(200, { ok: true });
      }
      if (!permissions.has('dashboard')) fail(403, 'Permission denied.');
      if (p === '/admin/dashboard' && method === 'GET') return json(200, await dashboard(pool, session, permissions));
      if (p === '/admin/alerts/read' && method === 'POST') {
        await transaction(pool, async client => {
          const result = await client.query(`UPDATE mcc_manager.admin_alerts SET read_at=$1
            WHERE id=$2 AND admin_id=$3 RETURNING id`, [Date.now(), integer(input.id), session.id]);
          if (!result.rowCount) fail(404, 'Alert not found.');
          await audit(client, session.id, 'alert_read', String(input.id));
        });
        return json(200, { ok: true });
      }
      fail(404, 'Not found.');
    } catch (error) {
      if (error.status === 401 && !req.url.startsWith('/admin/events')) res.setHeader('Set-Cookie', cookie('', 0));
      if (!error.status) console.error('Manager request failed. Check database availability and schema; no request details logged.');
      return json(error.status || 503, { error: error.status ? error.message : 'Manager service temporarily unavailable. Please try again.' });
    }
  });
  app.requestTimeout = 15000; app.headersTimeout = 10000;
  return app;
}

async function start(env = process.env) {
  originFor(env);
  await provisionDatabaseRole(env);
  const pool = openPool(env);
  try {
    await checkDatabase(pool);
    if (env.MANAGER_BOOTSTRAP === '1') {
      const created = await seedManager(pool, env.MANAGER_INITIAL_PASSWORD);
      console.log(created ? 'Manager provisioned. Remove all one-time setup environment variables.' : 'Existing manager preserved. Remove any remaining one-time setup variables.');
    }
    await checkDatabase(pool, { requireManager: true });
    const app = createManagerApp({ pool, env });
    await new Promise((resolve, reject) => { app.once('error', reject); app.listen(Number(env.PORT || 3113), '0.0.0.0', resolve); });
    console.log('My Coffee Co. manager service ready. Data feeds require separate configuration.');
    const close = () => { app.close(() => pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(1), 10000).unref(); };
    process.once('SIGTERM', close); process.once('SIGINT', close);
    return app;
  } catch (error) { await pool.end(); throw error; }
}
if (require.main === module) start().catch(() => {
  console.error('Manager startup failed. Check ADMIN_ORIGIN, the private schema, restricted database credentials, TLS certificate and one-time setup flags. Secrets have not been logged.');
  process.exitCode = 1;
});
module.exports = { createManagerApp, start, acceptEvent, validateEvent, rateLimit, originFor,
  validShopifyHmac, shopifyOrderEvent, paise };
