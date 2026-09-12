'use strict';

let client;

/**
 * Lazily creates one Supabase client for server-side integrations.
 * The secret key is never sent to browser code; manager data access continues
 * through the restricted PostgreSQL role for least privilege.
 */
function getSupabaseClient(env = process.env) {
  if (client) return client;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw Error('Supabase URL and server key are required.');
  // Load the SDK only when it is actually configured. This keeps the Vercel
  // function bootable while environment variables are being completed.
  const { createClient } = require('@supabase/supabase-js');
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

module.exports = { getSupabaseClient };
