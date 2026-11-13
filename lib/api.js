const { createHash, randomBytes, createHmac, timingSafeEqual } = require('node:crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'c8f39a01e9d448b17b2f65a910dc847291a27e5b610382947192837190283741';

const WORKSPACES = {
  '7layer': {
    id: '7layer',
    brandName: '7Layer Studio',
    eyebrow: '7Layer Studio Agreements',
    defaultSigner: 'Julia Singerman',
    defaultEmail: 'contracts@7layer.store',
    fromName: '7Layer Studio Contracts',
    draftKey: 'clause-contract-draft-v1',
    productPlaceholder: 'e.g. The Natal Crucible: Master Guide & Portal'
  },
  flipbooks: {
    id: 'flipbooks',
    brandName: 'Flipbooks Media',
    eyebrow: 'Flipbooks Media · Partner & Licensing Agreements',
    defaultSigner: 'Jaque Hill',
    defaultEmail: 'license@flipbooks.media',
    fromName: 'Flipbooks Media Contracts',
    draftKey: 'clause-contract-draft-flipbooks-v1',
    productPlaceholder: 'e.g. The ADHD Dopamine Boost Blueprint (3D Flipbook Edition)'
  }
};

function sanitize(val) {
  if (typeof val !== 'string') return '';
  return val.trim().replace(/^["']|["']$/g, '');
}

function normalizeWorkspace(ws) {
  const clean = sanitize(ws).toLowerCase();
  if (clean === 'flipbooks' || clean === 'flipbooks.media' || clean === 'flipbooks-media') return 'flipbooks';
  if (clean === '7layer' || clean === '7layer-studio') return '7layer';
  const envDefault = sanitize(process.env.DEFAULT_WORKSPACE).toLowerCase();
  return envDefault === 'flipbooks' ? 'flipbooks' : '7layer';
}

function getWorkspaceMeta(ws) {
  return WORKSPACES[normalizeWorkspace(ws)] || WORKSPACES['7layer'];
}

function json(res, status, value) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (typeof res.status === 'function') {
    return res.status(status).json(value);
  }
  res.statusCode = status;
  res.end(JSON.stringify(value));
}

function env() {
  const db = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!db) throw new Error('Missing database configuration (DATABASE_URL or POSTGRES_URL)');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(aStr, bStr) {
  if (!aStr || !bStr || typeof aStr !== 'string' || typeof bStr !== 'string') return false;
  const a = Buffer.from(aStr);
  const b = Buffer.from(bStr);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionValue(expires, workspace = '7layer') {
  const ws = normalizeWorkspace(workspace);
  const payload = Buffer.from(JSON.stringify({ exp: expires, ws })).toString('base64url');
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(req) {
  // Optional bearer / header API key for Flipbooks Media automation
  const apiKeyHeader = sanitize(req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const flipbooksApiKey = sanitize(process.env.FLIPBOOKS_API_KEY);
  if (apiKeyHeader && flipbooksApiKey && safeEqual(apiKeyHeader, flipbooksApiKey)) {
    return { authenticated: true, workspace: 'flipbooks', via: 'api_key' };
  }

  const raw = (req.headers.cookie || '')
    .split(';')
    .map(v => v.trim())
    .find(v => v.startsWith('clause_session='))
    ?.slice('clause_session='.length);
  if (!raw) return false;

  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return false;
  const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data || !(data.exp > Date.now())) return false;
    return {
      authenticated: true,
      workspace: data.ws ? normalizeWorkspace(data.ws) : '7layer',
      exp: data.exp
    };
  } catch {
    return false;
  }
}

function sessionCookie(req, clear = false, workspace = '7layer') {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `clause_session=${clear ? '' : sessionValue(Date.now() + 8 * 60 * 60 * 1000, workspace)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 28800}${secure}`;
}

function resolveWorkspaceLogin(password, requestedWorkspace = '') {
  const candidate = typeof password === 'string' ? password.trim() : '';
  if (!candidate) return { ok: false, error: 'Please enter your workspace passcode.' };

  const defaultWs = normalizeWorkspace(process.env.DEFAULT_WORKSPACE);
  const flipbooksPass = sanitize(process.env.FLIPBOOKS_OWNER_PASSWORD) || (defaultWs === 'flipbooks' ? sanitize(process.env.OWNER_PASSWORD) : '');
  const sevenLayerPass = sanitize(process.env.SEVENLAYER_OWNER_PASSWORD) || (defaultWs !== 'flipbooks' ? (sanitize(process.env.OWNER_PASSWORD) || 'Romeo4407!') : '');

  const reqWs = sanitize(requestedWorkspace).toLowerCase();

  if (reqWs === 'flipbooks') {
    if (!flipbooksPass) {
      return { ok: false, error: 'Flipbooks Media workspace passcode (FLIPBOOKS_OWNER_PASSWORD) is not configured in Vercel settings yet.' };
    }
    if (safeEqual(candidate, flipbooksPass)) return { ok: true, workspace: 'flipbooks' };
    return { ok: false, error: 'That Flipbooks Media passcode is not correct.' };
  }

  if (reqWs === '7layer') {
    if (!sevenLayerPass) {
      return { ok: false, error: '7Layer Studio passcode is not configured on this deployment.' };
    }
    if (safeEqual(candidate, sevenLayerPass)) return { ok: true, workspace: '7layer' };
    return { ok: false, error: 'That 7Layer Studio passcode is not correct.' };
  }

  if (flipbooksPass && safeEqual(candidate, flipbooksPass)) return { ok: true, workspace: 'flipbooks' };
  if (sevenLayerPass && safeEqual(candidate, sevenLayerPass)) return { ok: true, workspace: '7layer' };

  return { ok: false, error: 'That passcode is not correct.' };
}

function verifyPassword(actual) {
  return resolveWorkspaceLogin(actual).ok;
}

module.exports = {
  WORKSPACES,
  sanitize,
  normalizeWorkspace,
  getWorkspaceMeta,
  json,
  env,
  hashToken,
  verifySession,
  verifyPassword,
  resolveWorkspaceLogin,
  sessionCookie,
  randomToken: () => randomBytes(32).toString('base64url')
};
