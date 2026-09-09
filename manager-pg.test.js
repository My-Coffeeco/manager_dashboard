'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { connectionOptions, transaction, safeNumber, checkDatabase } = require('./manager-pg-db');
const { seedManager } = require('./manager-pg-setup');
const { createManagerApp, acceptEvent, rateLimit, validShopifyHmac, shopifyOrderEvent, paise } = require('./manager-pg-server');
const crypto = require('node:crypto');
const { hash, verify } = require('./admin-db');
const schema = fs.readFileSync(path.join(__dirname, 'manager-schema.sql'), 'utf8');
// PGlite executes PostgreSQL in WASM locally. This verifies SQL/RLS, not Supabase TLS or networking.
// Serialize transactions because PGlite has one connection; real deployment uses pg pinned clients.
function testPool(db) {
  let tail = Promise.resolve();
  const acquire = async () => { const prior = tail; let unlock; tail = new Promise(r => { unlock = r; }); await prior; return unlock; };
  const query = async (sql, values) => { const result = await db.query(sql, values); return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }; };
  return {
    query: async (...args) => { const unlock = await acquire(); try { return await query(...args); } finally { unlock(); } },
    connect: async () => { const unlock = await acquire(); return { query, release: unlock }; },
  };
}
test('PostgreSQL connection always verifies TLS and rejects privileged runtime users', () => {
  const url = 'postgresql://mcc_manager_app.test:longpassword@pooler.example:5432/postgres';
  const config = connectionOptions({ MANAGER_DATABASE_URL: url });
  assert.equal(config.ssl.rejectUnauthorized, true); assert.equal(config.max, 3);
  assert.equal(config.connectionString, undefined);
  assert.throws(() => connectionOptions({ MANAGER_DATABASE_URL: url + '?sslmode=disable' }));
  assert.throws(() => connectionOptions({ MANAGER_DATABASE_URL: url.replace('mcc_manager_app.test','postgres.test') }));
  assert.throws(() => connectionOptions({ MANAGER_DATABASE_URL: url.replace(':5432',':6543') }));
  assert.equal(safeNumber('28500'),28500); assert.equal(safeNumber(null),null);
  assert.throws(() => safeNumber('9007199254740993'));
});
test('Shopify webhook mapping uses exact money and never marks fulfilment delivered', () => {
  const headers={'x-shopify-topic':'orders/fulfilled','x-shopify-webhook-id':'delivery-1','x-shopify-triggered-at':'2026-09-09T08:30:00Z'};
  const event=shopifyOrderEvent({id:1,name:'#1068',current_total_price:'285.05',financial_status:'paid',fulfillment_status:'fulfilled',processed_at:'2026-09-09T08:00:00Z',customer:{first_name:'Test',last_name:'Buyer'}},headers);
  assert.equal(event.data.amount_paise,28505); assert.equal(event.data.status,'shipped'); assert.equal(event.data.customer,'Test Buyer');
  assert.equal(paise('0'),0); assert.equal(paise('1.5'),150); assert.throws(()=>paise('1.234'));
  const raw=Buffer.from('{"safe":true}'), secret='shopify-secret-for-test';
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('base64');
  assert.equal(validShopifyHmac(raw,signature,secret),true); assert.equal(validShopifyHmac(raw,signature+'x',secret),false);
});
test('transaction uses one client and rolls back and releases on failure', async () => {
  const seen = [], client = { query: async sql => { seen.push(sql); }, release: error => seen.push(error ? 'release-error' : 'release') };
  await assert.rejects(transaction({ connect: async () => client }, async c => { assert.equal(c, client); await c.query('WORK'); throw Error('failure'); }));
  assert.deepEqual(seen, ['BEGIN','WORK','ROLLBACK','release']);
});
test('manager-only schema, private role, real PostgreSQL routes, restart persistence, and event isolation', async () => {
  const db = new PGlite(); await db.waitReady;
  const pool = testPool(db); let app;
  const password = 'only a test password - never deploy';
  try {
    // An unrelated existing table must survive the migration.
    await db.exec('CREATE TABLE public.keep_existing (id integer); INSERT INTO public.keep_existing VALUES (7);');
    await db.exec(schema);
    assert.equal((await db.query('SELECT id FROM public.keep_existing')).rows[0].id,7);
    assert.equal((await db.query("SELECT count(*) FROM pg_tables WHERE schemaname='mcc_manager'")).rows[0].count,13);
    assert.ok((await db.query("SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='mcc_manager' AND c.relkind='r'")).rows.every(r=>r.relrowsecurity));
    await db.exec("CREATE ROLE anonymous_test; SET ROLE anonymous_test;");
    await assert.rejects(db.query('SELECT * FROM mcc_manager.admins'), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE mcc_manager_app;');
    await checkDatabase(pool);
    await assert.rejects(checkDatabase(pool,{requireManager:true}));
    await assert.rejects(seedManager(pool, 'short'));
    assert.equal(await seedManager(pool,password),true);
    assert.equal(await seedManager(pool,'this must not overwrite the first password'),false);
    await checkDatabase(pool,{requireManager:true});
    const managers = (await pool.query('SELECT * FROM mcc_manager.admins')).rows;
    assert.equal(managers.length,1); assert.equal(managers[0].email,'ayush@mycoffeeco.com');
    assert.equal(managers[0].role,'store_manager'); assert.notEqual(managers[0].password_hash,password);
    assert.equal(await verify(password,managers[0].password_hash),true);
    await assert.rejects(pool.query('UPDATE mcc_manager.permissions SET permission=\'stores\''), /permission denied/);
    await assert.rejects(pool.query('SELECT * FROM public.keep_existing'), /permission denied/);
    const env={ ADMIN_ORIGIN:'http://localhost', ADMIN_EVENT_SECRET:'test-only-event-key-'.repeat(3), SHOPIFY_CLIENT_SECRET:'shopify-client-secret-for-test', SHOPIFY_SHOP_DOMAIN:'new-mycoffeeco.myshopify.com' };
    async function listen() { app=createManagerApp({pool,env}); await new Promise(r=>app.listen(0,'127.0.0.1',r)); return 'http://127.0.0.1:'+app.address().port; }
    let base=await listen();
    async function call(route, body, auth={}, extra={}) {
      const response=await fetch(base+route, { method:body===undefined?'GET':'POST', headers:{ Origin:env.ADMIN_ORIGIN,'Content-Type':'application/json',Cookie:auth.cookie||'','X-CSRF-Token':auth.csrf||'',...extra }, body:body===undefined?undefined:JSON.stringify(body) });
      const isJson=response.headers.get('content-type')?.includes('json');
      return { status:response.status, data:isJson?await response.json():await response.text(), cookie:response.headers.get('set-cookie'), headers:response.headers };
    }
    async function shopify(payload, headers={}) {
      const raw=JSON.stringify(payload), signature=crypto.createHmac('sha256',env.SHOPIFY_CLIENT_SECRET).update(raw).digest('base64');
      const response=await fetch(base+'/webhooks/shopify/orders',{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Hmac-Sha256':signature,'X-Shopify-Shop-Domain':env.SHOPIFY_SHOP_DOMAIN,'X-Shopify-Topic':'orders/create','X-Shopify-Webhook-Id':'shopify-delivery-1','X-Shopify-Triggered-At':new Date().toISOString(),...headers},body:raw});
      return {status:response.status,data:await response.json()};
    }
    assert.equal((await call('/healthz')).status,200);
    assert.equal((await call('/admin/dashboard')).status,401);
    assert.equal((await call('/admin/invite')).status,404);
    assert.equal((await call('/admin/auth/login',{email:managers[0].email,password},{},{Origin:'https://evil.example'})).status,403);
    assert.equal((await call('/admin/auth/login',{email:managers[0].email,password:'wrong password'})).status,401);
    const login=await call('/admin/auth/login',{email:managers[0].email,password});
    assert.equal(login.status,200,JSON.stringify(login.data)); assert.match(login.cookie,/HttpOnly; SameSite=Strict; Path=\/admin; Max-Age=14400/);
    const auth={cookie:login.cookie.split(';')[0]};
    const me=await call('/admin/auth/me',undefined,auth); auth.csrf=me.data.csrf;
    assert.equal(me.data.password_hash,undefined); assert.equal(me.data.permissions.includes('invite'),false);
    const stored=(await pool.query('SELECT token_hash FROM mcc_manager.admin_sessions')).rows[0].token_hash;
    assert.equal(stored, hash(auth.cookie.slice(10))); assert.notEqual(stored,auth.cookie.slice(10));
    const empty=(await call('/admin/dashboard',undefined,auth)).data;
    assert.equal(empty.revenue_paise,null); assert.equal(empty.open_orders,null); assert.deepEqual(empty.orders,[]);
    assert.match(empty.data_notice,/not connected/);
    assert.equal((await call('/admin/alerts/read',{id:1},{cookie:auth.cookie})).status,403);
    const shopPayload={id:1066,name:'#1066',current_total_price:'0.00',financial_status:'paid',processed_at:new Date().toISOString(),customer:{first_name:'Test',last_name:'Customer'}};
    assert.equal((await shopify(shopPayload,{'X-Shopify-Hmac-Sha256':'invalid'})).status,401);
    assert.equal((await shopify(shopPayload,{'X-Shopify-Shop-Domain':'another-store.myshopify.com'})).status,403);
    assert.equal((await shopify(shopPayload)).status,200);
    assert.equal((await shopify(shopPayload)).data.duplicate,true);
    const shopView=(await call('/admin/dashboard',undefined,auth)).data;
    assert.ok(shopView.orders.some(order=>order.id==='#1066'));
    assert.equal((await call('/admin/alerts/read',{id:shopView.alerts[0].id},auth)).status,200);
    const now=Date.now();
    const event={event_id:'order:one:1',store_id:'mycoffeeco-online',type:'order',occurred_at:now,data:{id:'#1067',customer:'Test only',status:'paid',amount_paise:28500,paid_at:now}};
    assert.equal((await call('/admin/events',event)).status,401);
    const ingested=await call('/admin/events',event,{}, {Authorization:'Bearer '+env.ADMIN_EVENT_SECRET});
    assert.equal(ingested.status,200); assert.equal(ingested.data.applied,true);
    assert.equal((await acceptEvent(pool,event)).duplicate,true);
    const stale={...event,event_id:'order:one:older',occurred_at:now-1000,data:{...event.data,status:'payment_pending'}};
    assert.equal((await acceptEvent(pool,stale)).applied,false);
    const d=(await call('/admin/dashboard?store_id=someone-else',undefined,auth)).data;
    assert.equal(d.store.id,'mycoffeeco-online'); assert.equal(d.revenue_paise,28500);
    assert.equal(d.alerts.length,1); assert.equal(d.orders[0].status,'paid');
    assert.equal((await call('/admin/alerts/read',{id:d.alerts[0].id},auth)).status,200);
    assert.equal((await call('/admin/alerts/read',{id:999999},auth)).status,404);
    assert.equal((await call('/admin/dashboard',undefined,auth)).data.alerts.length,0);
    await acceptEvent(pool,{event_id:'stock:1',store_id:'mycoffeeco-online',type:'stock',occurred_at:now,data:{sku:'beans',quantity:1,threshold:3}});
    await acceptEvent(pool,{event_id:'inquiry:1',store_id:'mycoffeeco-online',type:'inquiry',occurred_at:now,data:{id:'i1',name:'Test contact',type:'Wholesale',status:'new',submitted_at:now}});
    const complete=(await call('/admin/dashboard',undefined,auth)).data;
    assert.equal(complete.low_stock,1); assert.equal(complete.open_inquiries,1);
    const before=(await pool.query('SELECT count(*) FROM mcc_manager.admin_events')).rows[0].count;
    await assert.rejects(acceptEvent(pool,{...event,event_id:'invalid',data:{...event.data,amount_paise:-1}}));
    assert.equal((await pool.query('SELECT count(*) FROM mcc_manager.admin_events')).rows[0].count,before);
    // Create another store/manager ONLY in this isolated local test, as DB owner.
    await db.exec('RESET ROLE;');
    await db.query("INSERT INTO mcc_manager.stores VALUES ('other','Other test store')");
    await db.query("INSERT INTO mcc_manager.admins SELECT '00000000-0000-4000-8000-000000000001',name,'other@example.invalid',password_hash,role,'other',created_at,false FROM mcc_manager.admins LIMIT 1");
    await db.exec('SET ROLE mcc_manager_app;');
    await acceptEvent(pool,{...event,event_id:'other:1',store_id:'other',data:{...event.data,id:'#private'}});
    const isolated=(await call('/admin/dashboard?store_id=other',undefined,auth)).data;
    assert.ok(isolated.orders.some(order=>order.id==='#1067'));
    assert.ok(!isolated.orders.some(order=>order.id==='#private'));
    const otherAlert=(await pool.query("SELECT id FROM mcc_manager.admin_alerts WHERE admin_id='00000000-0000-4000-8000-000000000001'")).rows[0].id;
    assert.equal((await call('/admin/alerts/read',{id:Number(otherAlert)},auth)).status,404);
    // Reconstruct the HTTP server with the SAME database: session and records survive.
    await new Promise(r=>app.close(r)); base=await listen();
    assert.equal((await call('/admin/auth/me',undefined,auth)).status,200);
    assert.ok((await call('/admin/dashboard',undefined,auth)).data.orders.some(order=>order.id==='#1067'));
    await db.exec('RESET ROLE;');
    await db.query("DELETE FROM mcc_manager.permissions WHERE permission='orders'");
    await db.exec('SET ROLE mcc_manager_app;');
    const restricted=(await call('/admin/dashboard',undefined,auth)).data;
    assert.equal(restricted.orders,null); assert.equal(restricted.revenue_paise,null);
    assert.equal((await call('/admin/auth/logout',{},auth)).status,200);
    assert.equal((await call('/admin/auth/me',undefined,auth)).status,401);
    const login2=await call('/admin/auth/login',{email:managers[0].email,password});
    const auth2={cookie:login2.cookie.split(';')[0]};
    await db.exec('RESET ROLE; UPDATE mcc_manager.admin_sessions SET expires=0; SET ROLE mcc_manager_app;');
    assert.equal((await call('/admin/auth/me',undefined,auth2)).status,401);
    for(let i=0;i<10;i++)await rateLimit(pool,'isolated-limit');
    await assert.rejects(rateLimit(pool,'isolated-limit'),{status:429});
    await db.exec('RESET ROLE;');
    assert.ok((await db.query('SELECT count(*) FROM mcc_manager.admin_audit')).rows[0].count>0);
  } finally { if(app?.listening)await new Promise(r=>app.close(r)); await db.close(); }
});
