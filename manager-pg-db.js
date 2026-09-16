'use strict';
const { Pool } = require('pg');
const fs = require('node:fs');

function connectionOptions(env = process.env, key = 'MANAGER_DATABASE_URL', owner = false) {
  if (!env[key]) throw Error(`${key} environment variable is missing.`);
  let url;
  try { url = new URL(env[key]); } catch { throw Error(`${key} must be a PostgreSQL connection URI.`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      !url.username || !url.password || url.pathname !== '/postgres' || url.hash) {
    throw Error(`${key} must include a host, database user, password and /postgres database.`);
  }
  // Decode fields ourselves: pg connectionString SSL parameters can override TLS verification.
  if (url.search) throw Error('Remove connection URI query parameters; TLS is enforced by the backend.');
  const user = decodeURIComponent(url.username);
  if (!owner && !/^mcc_manager_app(?:\.[a-z0-9]+)?$/.test(user)) {
    throw Error('Use the restricted mcc_manager_app database role, not the postgres owner.');
  }
  const port = Number(url.port || 5432);
  if (port !== 5432) throw Error('Use the Session pooler on port 5432.');
  const ssl = { rejectUnauthorized: env.MANAGER_DATABASE_SSL_REJECT_UNAUTHORIZED === '0' ? false : true };
  if (env.MANAGER_DATABASE_CA_FILE) ssl.ca = fs.readFileSync(env.MANAGER_DATABASE_CA_FILE, 'utf8');
  return {
    host: url.hostname, port, database: 'postgres', user,
    password: decodeURIComponent(url.password), ssl,
    max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    statement_timeout: 10000, query_timeout: 15000,
    application_name: 'mycoffeeco-manager',
  };
}

async function transaction(pool, run) {
  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; }
    throw error;
  } finally { client.release(releaseError); }
}

function openPool(env = process.env) {
  const pool = new Pool(connectionOptions(env));
  // Never log connection strings, request payloads or database error detail.
  pool.on('error', () => console.error('Manager database connection interrupted.'));
  return pool;
}

async function checkDatabase(pool, { requireManager = false } = {}) {
  const { rows } = await pool.query(`SELECT i.version, i.bootstrapped,
    current_user AS db_role FROM mcc_manager.installation i WHERE id=1`);
  if (rows[0]?.version !== 1 || rows[0]?.db_role !== 'mcc_manager_app') {
    throw Error('Manager schema v1 and the restricted database role are required.');
  }
  if (requireManager && !rows[0].bootstrapped) throw Error('Complete the private manager setup before starting the service.');
}

// PostgreSQL int8/numeric arrive as strings; never silently round money, IDs or timestamps.
function safeNumber(value) {
  if (value === null) return null;
  if (!/^-?\d+$/.test(String(value))) throw Error('Invalid database integer.');
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw Error('Database integer exceeds the supported range.');
  return number;
}

module.exports = { connectionOptions, transaction, openPool, checkDatabase, safeNumber };
