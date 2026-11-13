const {
  json,
  sessionCookie,
  verifySession,
  resolveWorkspaceLogin,
  getWorkspaceMeta,
  normalizeWorkspace,
  WORKSPACES
} = require('../lib/api');

module.exports = (req, res) => {
  const defaultWorkspace = normalizeWorkspace(process.env.DEFAULT_WORKSPACE);

  if (req.method === 'GET') {
    const sess = verifySession(req);
    const ws = sess ? sess.workspace : null;
    return json(res, 200, {
      authenticated: Boolean(sess),
      workspace: ws,
      profile: ws ? getWorkspaceMeta(ws) : null,
      defaultWorkspace,
      workspaces: WORKSPACES
    });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', sessionCookie(req, true));
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const login = resolveWorkspaceLogin(req.body?.password, req.body?.workspace);
  if (!login.ok) {
    return json(res, 401, { error: login.error || 'That passcode is not correct.' });
  }

  res.setHeader('Set-Cookie', sessionCookie(req, false, login.workspace));
  return json(res, 200, {
    ok: true,
    workspace: login.workspace,
    profile: getWorkspaceMeta(login.workspace)
  });
};
