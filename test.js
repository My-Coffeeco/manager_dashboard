const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('./server');

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-preview-'));
  const env = { DATA_MODE: 'preview', PUBLIC_ORIGIN: 'http://127.0.0.1:3210', PREVIEW_ADMIN_USER: 'reviewer', PREVIEW_ADMIN_PASSWORD: 'sixteen-character-preview-only' };
  const app = createApp({ env, database: path.join(dir, 'test.sqlite') });
  await new Promise(resolve => app.listen(3210, '127.0.0.1', resolve));
  let cookie = '', csrf = '';
  const request = async (url, options = {}) => {
    const headers = { ...options.headers }; if (cookie) headers.Cookie = cookie; if (csrf) headers['X-CSRF-Token'] = csrf; if (options.method && options.method !== 'GET') headers.Origin = env.PUBLIC_ORIGIN;
    const response = await fetch(`${env.PUBLIC_ORIGIN}${url}`, { redirect: 'manual', ...options, headers });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0]; return response;
  };
  return { app, request, setCsrf: value => { csrf = value; }, close: async () => { await new Promise(resolve => app.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('preview fails closed when credentials are not configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcc-preview-'));
  const app = createApp({ env: { DATA_MODE: 'preview' }, database: path.join(dir, 'test.sqlite') }); await new Promise(resolve => app.listen(3211, '127.0.0.1', resolve));
  const response = await fetch('http://127.0.0.1:3211/manager', { redirect: 'manual' }); assert.equal(response.status, 503); assert.match(await response.text(), /Preview locked/);
  await new Promise(resolve => app.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
});

test('private dashboard enforces authentication, CSRF, preview states and audit', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/manager')).status, 303);
    let response = await f.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'reviewer', password: 'wrong-password' }) }); assert.equal(response.status, 401);
    response = await f.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'reviewer', password: 'sixteen-character-preview-only' }) }); assert.equal(response.status, 200);
    response = await f.request('/api/overview'); let state = await response.json(); assert.equal(state.mode, 'preview'); assert.equal(state.pages.length, 6); assert.equal(state.integrations.shiprocket, 'deferred');
    const page = state.pages[0]; const source = state.sources.find(x => x.id === page.source); const payload = { ...page, status: 'live', settings: Object.fromEntries(source.fields.map(x => [x.id, page.settings[x.id] || ''])) };
    response = await f.request(`/api/pages/${page.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); assert.equal(response.status, 403);
    f.setCsrf(state.csrf); response = await f.request(`/api/pages/${page.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); assert.equal(response.status, 200);
    response = await f.request(`/preview/pages/${page.slug}`); const landing = await response.text(); assert.equal(response.status, 200); assert.doesNotMatch(landing, /<script\b/i); assert.doesNotMatch(landing, /<form\b/i); assert.match(landing, /Private preview only/);
    state = await (await f.request('/api/overview')).json(); assert.ok(state.audit.some(item => item.action === 'update_preview_page' && item.actor === 'reviewer'));
    for (const record of state.pages) {
      const source = state.sources.find(x => x.id === record.source);
      const data = { ...record, status: 'live', settings: Object.fromEntries(source.fields.map(x => [x.id, record.settings[x.id] || ''])) };
      response = await f.request(`/api/pages/${record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      assert.equal(response.status, 200, `${record.title} saved`);
      const saved = await response.json();
      response = await f.request(`/preview/pages/${record.slug}`); assert.equal(response.status, 200, `${record.title} Liquid renders`);
      const output = await response.text(); assert.doesNotMatch(output, /<script\b|<form\b/i);
      response = await f.request(`/api/pages/${record.id}/export`); assert.equal(response.status, 200); assert.equal((await response.json()).sections.main.type, source.section);
      response = await f.request(`/api/pages/${record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, version: saved.version, status: 'paused' }) }); assert.equal(response.status, 200);
      assert.equal((await f.request(`/preview/pages/${record.slug}`)).status, 410, 'pause changes what is served');
      response = await f.request(`/api/pages/${record.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); assert.equal(response.status, 409, 'stale editor cannot overwrite another change');
    }
    const source2 = state.sources[0];
    response = await f.request('/api/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'QA draft', slug: 'qa-draft', source: source2.id, settings: {}, status: 'draft' }) }); assert.equal(response.status, 201);
    assert.equal((await f.request('/preview/pages/qa-draft')).status, 404);
    response = await f.request('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.status, 200);
    assert.equal((await f.request('/api/overview')).status, 401);
  } finally { await f.close(); }
});

test('production integration configuration is rejected before startup', () => {
  assert.throws(() => createApp({ env: { DATA_MODE: 'production' } }), /preview data only/);
  assert.throws(() => createApp({ env: { DATA_MODE: 'preview', SHOPIFY_ADMIN_ACCESS_TOKEN: 'test-marker-not-a-token' } }), /must not be attached/);
});

test('customer preview contains honest empty states and an editor-only Shopify gate', () => {
  const html = fs.readFileSync(path.join(__dirname, 'customer.html'), 'utf8'); assert.match(html, /No live orders have been loaded/); assert.match(html, /No opt-in is recorded/); assert.match(html, /does not create or store a separate customer password/); assert.doesNotMatch(html, /fetch\(|customer\.|\/admin\/api/i);
  const liquid = fs.readFileSync(path.join(__dirname, 'index.mcc-customer-preview.liquid'), 'utf8'); assert.match(liquid, /request\.design_mode/); assert.match(liquid, /Shopify editor-only review/);
});
