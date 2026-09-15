'use strict';

// Vercel adapter for the existing Node HTTP application. The dashboard
// application remains unchanged; this function only supplies the serverless
// entrypoint Vercel requires.
let runtimePromise;

async function initRuntime() {
  const env = process.env;
  const { openPool, checkDatabase } = require('../manager-pg-db');
  const { createManagerApp } = require('../manager-pg-server');
  const { seedManager, provisionDatabaseRole } = require('../manager-pg-setup');
  const { getSupabaseClient } = require('../lib/supabaseClient');
  if (env.NEXT_PUBLIC_SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY)) {
    getSupabaseClient(env);
  }
  await provisionDatabaseRole(env);
  let pool;
  try {
    pool = openPool(env);
    await checkDatabase(pool);
    if (env.MANAGER_BOOTSTRAP === '1') {
      await seedManager(pool, env.MANAGER_INITIAL_PASSWORD);
    }
    await checkDatabase(pool, { requireManager: true });
    return { app: createManagerApp({ pool, env }), pool };
  } catch (error) {
    if (pool) {
      await pool.end().catch(() => {});
    }
    throw error;
  }
}

async function runtime() {
  if (!runtimePromise) {
    runtimePromise = initRuntime().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

module.exports = async function handler(req, res) {
  try {
    const { app } = await Promise.race([
      runtime(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Manager startup timed out.')), 7000)),
    ]);
    if (typeof req.url === 'string' && req.url.startsWith('/api')) {
      req.url = req.url.slice(4) || '/';
    }
    app.emit('request', req, res);
  } catch (error) {
    console.error('Manager serverless startup failed:', error?.message || error?.code || error?.name || 'startup');
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: 'Manager service temporarily unavailable.',
        message: error?.message || 'Serverless startup failed'
      }));
    }
  }
};
