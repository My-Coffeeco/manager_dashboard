'use strict';

// Vercel adapter for the existing Node HTTP application. The dashboard
// application remains unchanged; this function only supplies the serverless
// entrypoint Vercel requires.
let runtimePromise;

async function runtime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const env = process.env;
      // Keep application/database modules inside the guarded initialiser so a
      // platform runtime mismatch becomes a controlled 503, not a Vercel
      // FUNCTION_INVOCATION_FAILED before the handler can respond.
      const { openPool, checkDatabase } = require('../manager-pg-db');
      const { createManagerApp } = require('../manager-pg-server');
      const { getSupabaseClient } = require('../lib/supabaseClient');
      // Initialise the server-side Supabase client when API credentials are
      // configured. The manager's primary data path remains the restricted
      // PostgreSQL role, so a missing optional API key must not crash startup.
      if (env.NEXT_PUBLIC_SUPABASE_URL && (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY)) {
        getSupabaseClient(env);
      }
      const pool = openPool(env);
      try {
        await checkDatabase(pool, { requireManager: true });
        return { app: createManagerApp({ pool, env }), pool };
      } catch (error) {
        await pool.end();
        throw error;
      }
    })();
  }
  return runtimePromise;
}

module.exports = async function handler(req, res) {
  try {
    const { app } = await runtime();
    // Vercel rewrites may expose the function prefix in req.url. Strip only
    // that internal prefix so the existing route table sees /admin, /healthz,
    // and the existing webhook paths.
    if (typeof req.url === 'string' && req.url.startsWith('/api')) {
      req.url = req.url.slice(4) || '/';
    }
    // Let the existing Node server write directly to Vercel's response.
    // Vercel owns the response lifecycle, so do not wait for a Node
    // finish event that may not be emitted by its adapter.
    app.emit('request', req, res);
  } catch (error) {
    console.error('Manager serverless startup failed:', error?.code || error?.name || 'startup');
    if (!res.headersSent) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Manager service temporarily unavailable.' }));
    }
  }
};
