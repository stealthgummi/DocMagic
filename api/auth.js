const { json, sessionCookie, verifySession, verifyPassword } = require('../lib/api');

module.exports = (req, res) => {
  if (req.method === 'GET') return json(res, 200, { authenticated: verifySession(req) });
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', sessionCookie(req, true)); return json(res, 200, { ok: true }); }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!verifyPassword(req.body?.password)) return json(res, 401, { error: 'That passcode is not correct.' });
  res.setHeader('Set-Cookie', sessionCookie(req));
  return json(res, 200, { ok: true });
};
