const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Liquid } = require('liquidjs');
const { createStore } = require('./store');

const root = __dirname;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const cookie = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('mcc_preview='))?.slice(12) || '';
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const baseCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://mycoffeeco.com https://cdn.shopify.com; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function createApp(config = {}) {
  const env = config.env || process.env;
  if ((env.DATA_MODE || 'preview') !== 'preview') throw new Error('This build supports preview data only. Production promotion requires a separate reviewed integration.');
  const forbidden = ['SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_CUSTOMER_ACCESS_TOKEN', 'SHOPIFY_WEBHOOK_SECRET', 'RISTA_API_KEY', 'SHIPROCKET_TOKEN', 'KLAVIYO_API_KEY', 'WHATSAPP_ACCESS_TOKEN', 'DATABASE_URL'];
  if (forbidden.some(key => env[key])) throw new Error('Production integration variables must not be attached to this isolated preview.');
  const user = env.PREVIEW_ADMIN_USER || 'preview-manager';
  const password = env.PREVIEW_ADMIN_PASSWORD || '';
  const configured = password.length >= 16;
  const salt = crypto.randomBytes(32);
  const expected = crypto.scryptSync(password, salt, 64);
  const origin = env.PUBLIC_ORIGIN || '';
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && !isLocal && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash.');
  const secure = !isLocal;
  const sources = JSON.parse(read('sources.json'));
  const store = createStore(config.database || env.PREVIEW_DB_PATH || path.join(root, 'preview.sqlite'), sources);
  const limiter = new Map();
  const engine = new Liquid({ strictVariables: false, strictFilters: false, jsTruthy: false });
  engine.registerFilter('image_url', (value, ...args) => {
    let url = String(value || '').replace('shopify://shop_images/', 'https://mycoffeeco.com/cdn/shop/files/');
    if (!/^https:\/\/(mycoffeeco\.com|cdn\.shopify\.com)\//.test(url)) return '';
    const width = args.find(x => Array.isArray(x) && x[0] === 'width')?.[1];
    return `${url}${url.includes('?') ? '&' : '?'}width=${Number(width) || 1200}`;
  });
  engine.registerTag('form', { parse(tagToken, remainTokens) { this.templates = []; const stream = this.liquid.parser.parseStream(remainTokens).on('tag:endform', () => stream.stop()).on('template', tpl => this.templates.push(tpl)).on('end', () => { throw new Error('Unclosed form'); }); stream.start(); }, *render(ctx, emitter) { emitter.write('<div class="preview-disabled-form">'); yield this.liquid.renderer.renderTemplates(this.templates, ctx, emitter); emitter.write('</div>'); } });
  const sourceFor = id => sources.find(source => source.id === id);
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  const html = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
  const blankPage = (title, text) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | My Coffee Co.</title><link rel="stylesheet" href="/ui.css"><main class="auth-card"><img class="brand" src="/logo.avif" alt="My Coffee Co."><h1>${escape(title)}</h1><p>${escape(text)}</p><a href="/manager">Back to preview</a></main></html>`;
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('JSON content type required.'), { status: 415 });
    let value = ''; for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 50000) throw Object.assign(new Error('Request is too large.'), { status: 413 }); }
    try { return JSON.parse(value); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
  }
  function validate(input) {
    const source = sourceFor(input.source);
    if (!source) throw Object.assign(new Error('Choose an existing source template.'), { status: 400 });
    if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(input.slug || '')) throw Object.assign(new Error('Use 1-60 lowercase letters, numbers or hyphens for the URL.'), { status: 400 });
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 100) throw Object.assign(new Error('Title must be 1-100 characters.'), { status: 400 });
    if (!['draft', 'live', 'paused'].includes(input.status)) throw Object.assign(new Error('Invalid preview status.'), { status: 400 });
    const settings = { ...source.settings };
    for (const field of source.fields) {
      if (!(field.id in (input.settings || {}))) continue;
      const value = input.settings[field.id];
      if (typeof value !== 'string' || value.length > 1500 || /[<>]/.test(value)) throw Object.assign(new Error(`Use plain text for ${field.label} (maximum 1500 characters).`), { status: 400 });
      settings[field.id] = value;
    }
    return { title: input.title.trim(), slug: input.slug, source: source.id, status: input.status, settings, version: input.version };
  }
  const app = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', baseCsp);
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://internal');
      if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { service: 'dashboard-preview', productionConnected: false });
      if (!configured || !origin) return html(res, 503, blankPage('Preview locked', 'The owner must configure preview access before either dashboard can be viewed.'));
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin !== origin) return json(res, 403, { error: 'Request origin is not allowed.' });
      const tokenHash = hash(cookie(req));
      const now = Date.now();
      store.db.prepare('DELETE FROM sessions WHERE expires < ?').run(now);
      const session = store.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(tokenHash);
      const publicAssets = { '/ui.css': ['ui.css', 'text/css'], '/login.js': ['login.js', 'text/javascript'], '/logo.avif': ['logo.avif', 'image/avif'], '/raleway.woff2': ['raleway.woff2', 'font/woff2'] };
      if (req.method === 'GET' && publicAssets[url.pathname]) {
        const [file, type] = publicAssets[url.pathname]; res.writeHead(200, { 'Content-Type': type }); return res.end(fs.readFileSync(path.join(root, file)));
      }
      if (url.pathname === '/login' && req.method === 'GET') return html(res, 200, read('login.html'));
      if (url.pathname === '/api/login' && req.method === 'POST') {
        // Aggregate limit cannot be bypassed by spoofing proxy headers. There is one preview reviewer account.
        const attempts = (limiter.get('login') || []).filter(time => time > now - 15 * 60 * 1000);
        limiter.set('login', attempts);
        if (attempts.length >= 10) { res.setHeader('Retry-After', '900'); return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' }); }
        const input = await body(req);
        attempts.push(now);
        const supplied = await new Promise((resolve, reject) => crypto.scrypt(typeof input.password === 'string' ? input.password.slice(0, 1024) : '', salt, 64, (err, key) => err ? reject(err) : resolve(key)));
        if (!crypto.timingSafeEqual(supplied, expected) || input.username !== user) return json(res, 401, { error: 'Sign-in details were not recognised.' });
        limiter.delete('login');
        const token = crypto.randomBytes(32).toString('base64url');
        const csrf = crypto.randomBytes(32).toString('base64url');
        store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
        store.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token), csrf, user, now + 4 * 3600000);
        store.audit(user, 'preview_sign_in', 'session', null, { expiresInHours: 4 });
        res.setHeader('Set-Cookie', `mcc_preview=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400${secure ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      if (!session) {
        if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'Preview sign-in required.' });
        res.writeHead(303, { Location: '/login' }); return res.end();
      }
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== session.csrf) return json(res, 403, { error: 'Refresh the preview and try again.' });
      // Protected manager UI: intentionally presents no invented operational data until the
      // separate Supabase/Shopify/Shiprocket connectors have been reviewed and enabled.
      const managerAssets = {
        '/admin/ui.js': ['admin-ui.js', 'text/javascript'],
        '/admin/ui.css': ['admin-ui.css', 'text/css'],
        '/admin/polish.css': ['admin-polish.css', 'text/css'],
        '/admin/raleway.woff2': ['raleway.woff2', 'font/woff2'],
        '/admin/logo.avif': ['logo.avif', 'image/avif'],
      };
      if (req.method === 'GET' && managerAssets[url.pathname]) {
        const [file, type] = managerAssets[url.pathname]; res.writeHead(200, { 'Content-Type': type }); return res.end(read(file));
      }
      if (url.pathname === '/admin/auth/me' && req.method === 'GET') return json(res, 200, {
        name: 'Manager preview', role: 'store_manager', store_id: 'mycoffeeco-online', csrf: session.csrf,
        permissions: ['dashboard', 'orders', 'inventory', 'inquiries'],
      });
      if (url.pathname === '/admin/dashboard' && req.method === 'GET') return json(res, 200, {
        store: { id: 'mycoffeeco-online', name: 'My Coffee Co. Online' }, sources: {},
        revenue_paise: null, open_orders: null, low_stock: null, open_inquiries: null,
        orders: [], inquiries: [], alerts: [],
        data_notice: 'No live data connected yet. Shopify, Shiprocket and Supabase will be connected in the next phase.',
      });
      if (url.pathname === '/admin/alerts/read' && req.method === 'POST') return json(res, 200, { ok: true });
      if (url.pathname === '/admin/auth/logout' && req.method === 'POST') {
        store.audit(session.actor, 'preview_sign_out', 'manager_dashboard', null, null);
        store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
        res.setHeader('Set-Cookie', `mcc_preview=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        store.audit(session.actor, 'preview_sign_out', 'session', null, null);
        store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
        res.setHeader('Set-Cookie', `mcc_preview=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/overview' && req.method === 'GET') return json(res, 200, { actor: session.actor, csrf: session.csrf, mode: 'preview', pages: store.list(), sources: sources.map(({ html, ...source }) => source), audit: store.history(), integrations: { analytics: 'shopify-selected-not-connected', shiprocket: 'deferred', shopifyCustomer: 'not-connected', whatsapp: 'not-connected', loyalty: 'not-connected' }, persistence: 'Temporary preview storage. Render free-service redeploys can reset pages and audit history.' });
      if (url.pathname === '/api/pages' && req.method === 'POST') return json(res, 201, store.mutate(session.actor, validate(await body(req))));
      const update = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)$/);
      if (update && req.method === 'PATCH') return json(res, 200, store.mutate(session.actor, validate(await body(req)), update[1]));
      const download = url.pathname.match(/^\/api\/pages\/([a-f0-9-]+)\/export$/);
      if (download && req.method === 'GET') {
        const record = store.get(download[1]); if (!record) return json(res, 404, { error: 'Page not found.' });
        res.setHeader('Content-Disposition', `attachment; filename="page.${record.slug}.json"`);
        return json(res, 200, { sections: { main: { type: sourceFor(record.source).section, settings: record.settings } }, order: ['main'] });
      }
      if (url.pathname === '/' && req.method === 'GET') { res.writeHead(303, { Location: '/manager' }); return res.end(); }
      if (url.pathname === '/manager' && req.method === 'GET') {
        const dashboard = read('admin.html').replace('<main>', '<main><p id="data-notice" role="status"></p>');
        return html(res, 200, dashboard);
      }
      if (url.pathname === '/customer' && req.method === 'GET') return html(res, 200, read('customer.html'));
      if (url.pathname === '/customer.css' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(read('customer.css')); }
      if (url.pathname === '/customer.js' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(read('customer.js')); }
      if (url.pathname === '/manager.js' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(read('manager.js')); }
      const landing = url.pathname.match(/^\/preview\/pages\/([a-z0-9-]+)$/);
      if (landing && req.method === 'GET') {
        const record = store.bySlug(landing[1]);
        if (!record) return html(res, 404, blankPage('Page not found', 'This preview URL does not exist.'));
        if (record.status !== 'live') return html(res, record.status === 'paused' ? 410 : 404, blankPage(record.status === 'paused' ? 'Preview paused' : 'Preview is a draft', 'Nothing is served here until this page is set to Live in preview. The production page is unchanged.'));
        const source = sourceFor(record.source);
        const safeSettings = Object.fromEntries(Object.entries(record.settings).map(([key, value]) => [key, typeof value === 'string' ? escape(value) : value]));
        const rendered = await engine.parseAndRender(source.html, { section: { id: `preview-${record.id}`, settings: safeSettings }, shop: { name: 'My Coffee Co.' } });
        // Existing forms/scripts can send leads to production. They are inert in this sandbox.
        const inert = rendered.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/<form\b[^>]*>/gi, '<div class="preview-disabled-form">').replace(/<\/form>/gi, '</div>').replace(/<input\b/gi, '<input disabled').replace(/<textarea\b/gi, '<textarea disabled').replace(/<button\b/gi, '<button disabled');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https://mycoffeeco.com https://cdn.shopify.com data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'none'");
        return html(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(record.title)} - PRIVATE PREVIEW</title></head><body><aside style="position:relative;z-index:999999;background:#0a06ff;color:#fff;padding:16px;font:16px system-ui">Private preview only. Forms and integrations are disabled. <a style="color:#fff" href="/manager#pages">Return to manager</a></aside>${inert}</body></html>`);
      }
      return json(res, 404, { error: 'Not found.' });
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) console.error('Preview request failed:', error.code || error.name);
      return json(res, status, { error: status === 500 ? 'Preview request failed. No production action was taken.' : error.message });
    }
  });
  app.on('close', () => store.db.close());
  return app;
}
if (require.main === module) {
  const app = createApp();
  app.listen(Number(process.env.PORT) || 3210, process.env.PUBLIC_ORIGIN?.startsWith('http://') ? '127.0.0.1' : '0.0.0.0', () => console.log('MCC isolated dashboard preview started. Production connectors: disabled.'));
}
module.exports = { createApp };
