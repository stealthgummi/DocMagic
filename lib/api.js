const { createHash, randomBytes, createHmac, timingSafeEqual } = require('node:crypto');

function json(res, status, value) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(value);
}

function env() {
  const db = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!db) throw new Error('Missing database configuration (DATABASE_URL or POSTGRES_URL)');
}

function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
function sessionValue(expires) { const payload = Buffer.from(JSON.stringify({ exp: expires })).toString('base64url'); const sig = createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url'); return `${payload}.${sig}`; }
function verifySession(req) {
  if (!process.env.SESSION_SECRET) return false;
  const raw = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('clause_session='))?.slice('clause_session='.length);
  if (!raw) return false;
  const [payload, signature] = raw.split('.'); if (!payload || !signature) return false;
  const expected = createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest();
  let actual; try { actual = Buffer.from(signature, 'base64url'); } catch { return false; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
function sessionCookie(req, clear = false) { const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''; return `clause_session=${clear ? '' : sessionValue(Date.now() + 8 * 60 * 60 * 1000)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${secure}`; }
function verifyPassword(actual) {
  const expected = process.env.OWNER_PASSWORD || '';
  if (!expected || typeof actual !== 'string') return false;
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = { json, env, hashToken, verifySession, verifyPassword, sessionCookie, randomToken: () => randomBytes(32).toString('base64url') };
