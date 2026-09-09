'use strict';
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { connectionOptions, transaction } = require('./manager-pg-db');
const { passwordHash } = require('./admin-db');

async function seedManager(pool, password) {
  return transaction(pool, async client => {
    const row = (await client.query('SELECT bootstrapped FROM mcc_manager.installation WHERE id=1 FOR UPDATE')).rows[0];
    if (!row) throw Error('Run manager-schema.sql first.');
    if (row.bootstrapped) return false; // Restarts can never reset the manager password.
    if ((await client.query('SELECT id FROM mcc_manager.admins LIMIT 1')).rowCount) {
      throw Error('An account already exists; setup refuses to overwrite it.');
    }
    const encoded = await passwordHash(password);
    const id = crypto.randomUUID(), now = Date.now();
    await client.query(`INSERT INTO mcc_manager.admins
      (id,name,email,password_hash,role,store_id,created_at)
      VALUES ($1,$2,$3,$4,'store_manager','mycoffeeco-online',$5)`,
    [id, 'Aayush Jha', 'ayush@mycoffeeco.com', encoded, now]);
    await client.query(`INSERT INTO mcc_manager.admin_audit(actor,action,target,created_at)
      VALUES ($1,'manager_provisioned',$1,$2)`, [id, now]);
    await client.query('UPDATE mcc_manager.installation SET bootstrapped=true WHERE id=1');
    return true;
  });
}

// Optional ONE-TIME deployment helper, needed because a Render Free service has no shell.
// The project owner URI is used only to activate an existing NOLOGIN role, never for requests.
// Remove MANAGER_SETUP_DATABASE_URL and MANAGER_PROVISION_DATABASE immediately afterward.
async function provisionDatabaseRole(env = process.env) {
  if (env.MANAGER_PROVISION_DATABASE !== '1') return false;
  const runtime = connectionOptions(env);
  const owner = connectionOptions(env, 'MANAGER_SETUP_DATABASE_URL', true);
  if (runtime.host !== owner.host || runtime.port !== owner.port || runtime.database !== owner.database ||
      owner.user !== runtime.user.replace(/^mcc_manager_app/, 'postgres')) {
    throw Error('Owner and runtime database connections must target the same project and pooler.');
  }
  if (runtime.password.length < 24 || runtime.password === owner.password) {
    throw Error('Use a separate database application password of at least 24 characters.');
  }
  const pool = new Pool(owner);
  pool.on('error', () => console.error('Database setup connection interrupted.'));
  try {
    return await transaction(pool, async client => {
      await client.query('SELECT id FROM mcc_manager.installation WHERE id=1 FOR UPDATE');
      const role = (await client.query(`SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
        FROM pg_roles WHERE rolname='mcc_manager_app'`)).rows[0];
      if (!role || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls) {
        throw Error('Run the reviewed manager schema first; an unsafe or missing role cannot be provisioned.');
      }
      if (role.rolcanlogin) return false; // Never rotate an existing credential on restart.
      // PostgreSQL identifiers are fixed and the server quotes the password literal safely.
      const sql = (await client.query(`SELECT format('ALTER ROLE mcc_manager_app LOGIN PASSWORD %L', $1::text) AS sql`, [runtime.password])).rows[0].sql;
      await client.query(sql);
      return true;
    });
  } finally { await pool.end(); }
}
module.exports = { seedManager, provisionDatabaseRole };
