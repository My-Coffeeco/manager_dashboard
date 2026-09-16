const { randomUUID } = require('node:crypto');

function createStore(filename, sources) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, slug TEXT UNIQUE, title TEXT, source TEXT, status TEXT, settings TEXT, version INTEGER, updated TEXT);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, target TEXT, before_value TEXT, after_value TEXT, at TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf TEXT, actor TEXT, expires INTEGER);`);
  const audit = (actor, action, target, before, after) => db.prepare('INSERT INTO audit(actor,action,target,before_value,after_value,at) VALUES (?,?,?,?,?,?)').run(actor, action, target, JSON.stringify(before), JSON.stringify(after), new Date().toISOString());
  const hydrate = row => row && ({ ...row, settings: JSON.parse(row.settings) });
  const get = id => hydrate(db.prepare('SELECT * FROM pages WHERE id=?').get(id));
  if (!db.prepare('SELECT id FROM pages LIMIT 1').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const source of sources) {
        const id = randomUUID();
        db.prepare('INSERT INTO pages VALUES (?,?,?,?,?,?,?,?)').run(id, source.id, source.title, source.id, 'draft', JSON.stringify(source.settings), 1, new Date().toISOString());
        audit('system', 'seed_preview_draft', id, null, { source: source.id, status: 'draft' });
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return {
    db, get, audit,
    list: () => db.prepare('SELECT * FROM pages ORDER BY title').all().map(hydrate),
    bySlug: slug => hydrate(db.prepare('SELECT * FROM pages WHERE slug=?').get(slug)),
    history: () => db.prepare('SELECT id,actor,action,target,before_value,after_value,at FROM audit ORDER BY id DESC LIMIT 200').all(),
    mutate(actor, input, existingId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const before = existingId ? get(existingId) : null;
        if (existingId && !before) throw Object.assign(new Error('Page not found'), { status: 404 });
        if (before && before.version !== input.version) throw Object.assign(new Error('This page changed in another session. Reload before saving.'), { status: 409 });
        const record = { ...input, id: existingId || randomUUID(), version: before ? before.version + 1 : 1, updated: new Date().toISOString() };
        if (before) db.prepare('UPDATE pages SET slug=?,title=?,source=?,status=?,settings=?,version=?,updated=? WHERE id=?').run(record.slug, record.title, record.source, record.status, JSON.stringify(record.settings), record.version, record.updated, record.id);
        else db.prepare('INSERT INTO pages VALUES (?,?,?,?,?,?,?,?)').run(record.id, record.slug, record.title, record.source, record.status, JSON.stringify(record.settings), record.version, record.updated);
        audit(actor, before ? 'update_preview_page' : 'create_preview_page', record.id, before, record);
        db.exec('COMMIT');
        return record;
      } catch (e) { db.exec('ROLLBACK'); if (e.code === 'ERR_SQLITE_ERROR' && /UNIQUE/.test(e.message)) { e.status = 409; e.message = 'That preview URL is already in use.'; } throw e; }
    }
  };
}
module.exports = { createStore };
