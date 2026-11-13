const { randomUUID } = require('node:crypto');
const { json, hashToken, verifySession, getWorkspaceMeta, randomToken } = require('../lib/api');
const database = require('../lib/db');
const { sendMail } = require('../lib/mailer');

function clean(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function ensureContractsTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS contract_requests (
      id text primary key,
      workspace text not null default '7layer',
      title text not null,
      provider_name text not null,
      provider_email text not null,
      client_company text,
      client_name text not null,
      client_email text not null,
      effective_date date,
      terms text not null,
      token_hash text not null unique,
      token text,
      status text not null default 'pending' check (status in ('pending', 'signed')),
      created_at timestamptz not null default now(),
      signed_at timestamptz,
      signer_name text,
      signer_ip text,
      signer_user_agent text,
      signer_consent boolean not null default false,
      provider_signer_name text,
      provider_signed_at timestamptz
    );
  `;
  await sql`ALTER TABLE contract_requests ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT '7layer';`;
  await sql`ALTER TABLE contract_requests ADD COLUMN IF NOT EXISTS token text;`;
  await sql`ALTER TABLE contract_requests ADD COLUMN IF NOT EXISTS provider_signer_name text;`;
  await sql`ALTER TABLE contract_requests ADD COLUMN IF NOT EXISTS provider_signed_at timestamptz;`;
  await sql`ALTER TABLE contract_requests ADD COLUMN IF NOT EXISTS client_company text;`;
  await sql`CREATE INDEX IF NOT EXISTS idx_contract_requests_workspace ON contract_requests (workspace, created_at DESC);`;
}

module.exports = async (req, res) => {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  const sess = verifySession(req);

  // GET: List contracts or get specific contract scoped strictly to the signed-in workspace
  if (req.method === 'GET') {
    if (!sess) return json(res, 401, { error: 'Please sign in again.' });
    const ws = sess.workspace;

    if (!dbUrl) {
      return json(res, 200, { ok: false, workspace: ws, requests: [], error: 'Database is not connected yet. Connect Neon in your Vercel Storage settings.' });
    }

    try {
      const sql = database();
      await ensureContractsTable(sql);

      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const defaultUrl = host ? `${proto}://${host}` : 'https://doc-magic-zeta.vercel.app';
      const appUrl = (process.env.APP_URL || process.env.APP_URLD || defaultUrl).replace(/\/$/, '');

      if (req.query && req.query.id) {
        const [row] = await sql`
          SELECT id, workspace, title, provider_name, provider_email, client_company, client_name, client_email, effective_date, terms, status, created_at, signed_at, signer_name, signer_ip, signer_user_agent, provider_signer_name, provider_signed_at, token
          FROM contract_requests
          WHERE id = ${req.query.id} AND workspace = ${ws}
          LIMIT 1
        `;
        if (!row) return json(res, 404, { error: 'Contract request not found in this workspace.' });
        if (row.token) {
          row.signUrl = `${appUrl}/sign.html?token=${encodeURIComponent(row.token)}`;
        }
        return json(res, 200, { ok: true, workspace: ws, request: row });
      }

      const rows = await sql`
        SELECT id, workspace, title, provider_name, provider_email, client_company, client_name, client_email, effective_date, status, created_at, signed_at, signer_name, token
        FROM contract_requests
        WHERE workspace = ${ws}
        ORDER BY created_at DESC
        LIMIT 100
      `;
      const requestsWithUrls = rows.map(r => ({
        ...r,
        signUrl: r.token ? `${appUrl}/sign.html?token=${encodeURIComponent(r.token)}` : null
      }));
      return json(res, 200, { ok: true, workspace: ws, requests: requestsWithUrls });
    } catch (error) {
      console.error('List contract requests failed:', error.message);
      return json(res, 200, { ok: false, workspace: ws, requests: [], error: error.message });
    }
  }

  // DELETE: Delete a contract request strictly within the signed-in workspace
  if (req.method === 'DELETE') {
    if (!sess) return json(res, 401, { error: 'Please sign in again.' });
    const ws = sess.workspace;
    if (!dbUrl) return json(res, 503, { error: 'Database is not connected.' });
    const id = req.query?.id || req.body?.id;
    if (!id) return json(res, 400, { error: 'Contract ID is required.' });
    try {
      const sql = database();
      await ensureContractsTable(sql);
      await sql`DELETE FROM contract_requests WHERE id = ${id} AND workspace = ${ws}`;
      return json(res, 200, { ok: true, message: 'Contract deleted.' });
    } catch (err) {
      console.error('Delete contract failed:', err.message);
      return json(res, 500, { error: err.message || 'Could not delete contract.' });
    }
  }

  // POST: Create a new contract signature request scoped strictly to the signed-in workspace
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!sess) return json(res, 401, { error: 'Please sign in again before sending a request.' });

  if (!dbUrl) {
    return json(res, 503, { error: 'Database is not connected. Connect Neon or add POSTGRES_URL in Vercel settings.' });
  }

  try {
    const ws = sess.workspace;
    const meta = getWorkspaceMeta(ws);
    const data = req.body || {};
    const token = randomToken();

    let providerEmail = clean(data.providerEmail, 254).toLowerCase() || meta.defaultEmail;
    if (providerEmail === 'contract@7layer.store') providerEmail = 'contracts@7layer.store';
    const clientEmail = clean(data.email, 254).toLowerCase();

    const record = {
      id: randomUUID(),
      workspace: ws,
      title: clean(data.title, 160) || 'Agreement',
      provider: clean(data.provider, 160) || meta.brandName,
      providerSigner: clean(data.providerSigner, 160) || meta.defaultSigner,
      clientCompany: clean(data.clientCompany, 160),
      client: clean(data.client, 160),
      providerEmail,
      clientEmail,
      date: /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : null,
      terms: clean(data.terms, 20000),
      tokenHash: hashToken(token)
    };

    const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!record.provider || !record.client || !record.terms || !validEmail(record.clientEmail) || !validEmail(record.providerEmail)) {
      return json(res, 400, { error: 'Add both names, valid email addresses, and the agreement terms.' });
    }

    const sql = database();
    await ensureContractsTable(sql);
    await sql`
      INSERT INTO contract_requests (
        id, workspace, title, provider_name, provider_email, client_company, client_name,
        client_email, effective_date, terms, token_hash, token, provider_signer_name, provider_signed_at
      )
      VALUES (
        ${record.id}, ${record.workspace}, ${record.title}, ${record.provider}, ${record.providerEmail},
        ${record.clientCompany}, ${record.client}, ${record.clientEmail}, ${record.date}, ${record.terms},
        ${record.tokenHash}, ${token}, ${record.providerSigner}, now()
      )
    `;

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const defaultUrl = host ? `${proto}://${host}` : 'https://doc-magic-zeta.vercel.app';
    const appUrl = (process.env.APP_URL || process.env.APP_URLD || defaultUrl).replace(/\/$/, '');
    const signUrl = `${appUrl}/sign.html?token=${encodeURIComponent(token)}`;

    let emailSent = false;
    let emailError = null;
    try {
      const result = await sendMail({
        workspace: ws,
        to: record.clientEmail,
        subject: `Signature requested: ${record.title}`,
        html: `
          <div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #232822; background: #ffffff; border: 1px solid #e7e8e1; border-radius: 12px;">
            <h2 style="margin-top: 0; color: #315d45; font-size: 22px;">Signature Requested: ${escapeHtml(record.title)}</h2>
            <p>Hello <strong>${escapeHtml(record.client)}</strong>${record.clientCompany ? ` (${escapeHtml(record.clientCompany)})` : ''},</p>
            <p><strong>${escapeHtml(record.provider)}</strong> has prepared an agreement for you to review and sign online.</p>
            <div style="margin: 28px 0;">
              <a href="${escapeHtml(signUrl)}" style="display: inline-block; padding: 14px 24px; background: #315d45; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Review and Sign Agreement ➔</a>
            </div>
            <p style="font-size: 13px; color: #73796f;">Or copy and paste this personal signing link into your browser:<br><span style="word-break: break-all; color: #315d45;">${escapeHtml(signUrl)}</span></p>
            <hr style="border: 0; border-top: 1px solid #e7e8e1; margin: 24px 0;">
            <p style="font-size: 12px; color: #888;">This is a secure personal link intended only for ${escapeHtml(record.client)}${record.clientCompany ? ` of ${escapeHtml(record.clientCompany)}` : ''}. If you have questions about the terms, reply directly to this email or contact ${escapeHtml(record.providerEmail)}.</p>
          </div>
        `,
        text: `Hello ${record.client}${record.clientCompany ? ` (${record.clientCompany})` : ''},\n\n${record.provider} has sent you "${record.title}" to review and sign.\n\nReview and sign here:\n${signUrl}\n\nIf you have any questions, contact ${record.providerEmail}.`
      });
      emailSent = result.sent;
      if (!result.sent) {
        emailError = result.error;
      }
    } catch (mailErr) {
      console.error('SMTP send error:', mailErr.message);
      emailError = mailErr.message;
    }

    return json(res, 201, {
      ok: true,
      workspace: ws,
      emailSent,
      emailError,
      signUrl,
      id: record.id,
      message: emailSent
        ? `Signature request emailed to ${record.clientEmail} via Hostinger!`
        : 'Agreement created! Copy the signing link below.'
    });
  } catch (error) {
    console.error('Create signature request failed:', error.message);
    return json(res, 500, { error: error.message || 'Could not send the request.' });
  }
};
