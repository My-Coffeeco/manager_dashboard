const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password between 12 and 128 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
async function verify(password, encoded) {
  const [salt, value] = encoded.split(':');
  const key = await scrypt(String(password).slice(0,128), salt, 64);
  return crypto.timingSafeEqual(key, Buffer.from(value, 'hex'));
}
function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS roles(role TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS permissions(role TEXT REFERENCES roles(role),permission TEXT,PRIMARY KEY(role,permission));
    CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT,role TEXT NOT NULL REFERENCES roles(role),store_id TEXT REFERENCES stores(id),invite_token TEXT UNIQUE,invite_expires_at INTEGER,created_at INTEGER NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT REFERENCES admins(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,target TEXT,created_at INTEGER);
    CREATE TABLE IF NOT EXISTS admin_limits(key TEXT PRIMARY KEY,attempts INTEGER,reset_at INTEGER);
    CREATE TABLE IF NOT EXISTS admin_events(id TEXT PRIMARY KEY,store_id TEXT REFERENCES stores(id),type TEXT,created_at INTEGER);
    CREATE TABLE IF NOT EXISTS admin_alerts(id INTEGER PRIMARY KEY,admin_id TEXT REFERENCES admins(id),event_id TEXT REFERENCES admin_events(id),message TEXT,read_at INTEGER,UNIQUE(admin_id,event_id));
    CREATE TABLE IF NOT EXISTS admin_orders(id TEXT,store_id TEXT REFERENCES stores(id),customer TEXT,status TEXT,amount_paise INTEGER,paid_at INTEGER,PRIMARY KEY(id,store_id));
    CREATE TABLE IF NOT EXISTS admin_stock(sku TEXT,store_id TEXT REFERENCES stores(id),quantity INTEGER,threshold INTEGER,PRIMARY KEY(sku,store_id));
    CREATE TABLE IF NOT EXISTS admin_inquiries(id TEXT,store_id TEXT REFERENCES stores(id),name TEXT,type TEXT,status TEXT,submitted_at INTEGER,PRIMARY KEY(id,store_id));
    CREATE TABLE IF NOT EXISTS admin_outbox(id INTEGER PRIMARY KEY,recipient TEXT,subject TEXT,body TEXT,attempts INTEGER DEFAULT 0,next_at INTEGER,sent_at INTEGER);
  `);
  const grants = { super_admin:['dashboard','invite','stores','orders','inventory','inquiries','audit'],store_manager:['dashboard','orders','inventory','inquiries'],fulfillment:['dashboard','orders','inventory'],support:['dashboard','inquiries'] };
  for (const [role, perms] of Object.entries(grants)) {
    db.prepare('INSERT OR IGNORE INTO roles VALUES (?)').run(role);
    for (const p of perms) db.prepare('INSERT OR IGNORE INTO permissions VALUES (?,?)').run(role,p);
  }
  return db;
}
module.exports={openDatabase,passwordHash,verify,hash};
