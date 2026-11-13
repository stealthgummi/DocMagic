const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { json, sanitize, normalizeWorkspace, verifySession } = require('../lib/api');

function escapeHtml(s) {
  return typeof s === 'string' ? s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) : '';
}

function getImapConfig(workspace = '7layer') {
  const ws = normalizeWorkspace(workspace);
  const defaultWs = normalizeWorkspace(process.env.DEFAULT_WORKSPACE);

  if (ws === 'flipbooks') {
    const host = sanitize(process.env.FLIPBOOKS_IMAP_HOST) || sanitize(process.env.IMAP_HOST) || 'imap.hostinger.com';
    const port = parseInt(sanitize(process.env.FLIPBOOKS_IMAP_PORT) || sanitize(process.env.IMAP_PORT) || '993', 10);
    const secure = process.env.IMAP_SECURE !== 'false';
    const auth = {
      user:
        sanitize(process.env.FLIPBOOKS_IMAP_USER) ||
        sanitize(process.env.FLIPBOOKS_SMTP_USER) ||
        (defaultWs === 'flipbooks' ? sanitize(process.env.IMAP_USER || process.env.SMTP_USER) : '') ||
        'license@flipbooks.media',
      pass:
        sanitize(process.env.FLIPBOOKS_IMAP_PASS) ||
        sanitize(process.env.FLIPBOOKS_SMTP_PASS) ||
        (defaultWs === 'flipbooks' ? sanitize(process.env.IMAP_PASS || process.env.SMTP_PASS) : '')
    };
    if (!auth.user || !auth.pass) return null;
    return { host, port, secure, auth, logger: false };
  }

  const host = sanitize(process.env.IMAP_HOST) || 'imap.hostinger.com';
  const port = parseInt(sanitize(process.env.IMAP_PORT) || '993', 10);
  const secure = process.env.IMAP_SECURE !== 'false';
  const auth = {
    user: sanitize(process.env.IMAP_USER) || sanitize(process.env.SMTP_USER) || 'contracts@7layer.store',
    pass: sanitize(process.env.IMAP_PASS) || sanitize(process.env.SMTP_PASS) || ''
  };

  if (!auth.user || !auth.pass) {
    return null;
  }

  return { host, port, secure, auth, logger: false };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const sess = verifySession(req);
  if (!sess) return json(res, 401, { error: 'Please sign in again before accessing inbox.' });

  const ws = sess.workspace;
  const imapConfig = getImapConfig(ws);
  if (!imapConfig) {
    const envHint = ws === 'flipbooks'
      ? 'Flipbooks Media inbox is not configured yet. Add FLIPBOOKS_SMTP_USER and FLIPBOOKS_SMTP_PASS in Vercel settings.'
      : 'Email inbox is not configured yet. Add SMTP_USER and SMTP_PASS in Vercel settings.';
    return json(res, 200, {
      ok: false,
      workspace: ws,
      messages: [],
      error: envHint
    });
  }

  const client = new ImapFlow(imapConfig);

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const uidParam = req.query.uid;

      if (uidParam) {
        const uid = parseInt(uidParam, 10);
        const message = await client.fetchOne(uid, { source: true, flags: true, envelope: true }, { uid: true });
        if (!message) {
          return json(res, 404, { error: 'Message not found.' });
        }

        const parsed = await simpleParser(message.source);
        return json(res, 200, {
          ok: true,
          workspace: ws,
          message: {
            uid: message.uid,
            seq: message.seq,
            subject: parsed.subject || '(No Subject)',
            from: parsed.from?.text || parsed.from?.value?.[0]?.address || 'Unknown',
            to: parsed.to?.text || parsed.to?.value?.[0]?.address || imapConfig.auth.user,
            date: parsed.date || message.envelope?.date,
            html: parsed.html || (parsed.text ? `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(parsed.text)}</pre>` : ''),
            text: parsed.text || '',
            flags: Array.from(message.flags || [])
          }
        });
      }

      const status = await client.status('INBOX', { messages: true });
      const total = status.messages || 0;
      if (total === 0) {
        return json(res, 200, { ok: true, workspace: ws, account: imapConfig.auth.user, messages: [] });
      }

      const rangeStart = Math.max(1, total - 29);
      const range = `${rangeStart}:*`;

      const list = [];
      for await (const msg of client.fetch(range, { envelope: true, flags: true, internalDate: true }, { uid: true })) {
        const fromAddr = msg.envelope?.from?.[0]?.address || '';
        const fromName = msg.envelope?.from?.[0]?.name || '';
        list.push({
          uid: msg.uid,
          seq: msg.seq,
          subject: msg.envelope?.subject || '(No Subject)',
          from: fromName ? `${fromName} <${fromAddr}>` : (fromAddr || 'Unknown'),
          date: msg.internalDate || msg.envelope?.date,
          flags: Array.from(msg.flags || []),
          unread: !msg.flags.has('\\Seen')
        });
      }

      list.sort((a, b) => new Date(b.date) - new Date(a.date));

      return json(res, 200, {
        ok: true,
        workspace: ws,
        account: imapConfig.auth.user,
        total,
        messages: list
      });
    } finally {
      lock.release();
    }
  } catch (err) {
    console.warn('IMAP connection warning:', err.message);
    return json(res, 200, {
      ok: false,
      workspace: ws,
      messages: [],
      account: imapConfig.auth.user,
      error: `Could not connect to ${imapConfig.auth.user}: ${err.message}. Please verify the mailbox exists in Hostinger and uses this password.`
    });
  } finally {
    try { await client.logout(); } catch (_) {}
  }
};
