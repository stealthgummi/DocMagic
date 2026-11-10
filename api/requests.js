const { randomUUID } = require('node:crypto');
const { json, env, hashToken, verifySession, randomToken } = require('../lib/api');
const database = require('../lib/db');

function clean(value, max) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : ''; }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!verifySession(req)) return json(res, 401, { error: 'Please sign in again before sending a request.' });
  try {
    env();
    const data = req.body || {};
    const token = randomToken();
    const record = {
      id: randomUUID(), title: clean(data.title, 160) || 'Agreement',
      provider: clean(data.provider, 160), client: clean(data.client, 160),
      providerEmail: clean(data.providerEmail, 254).toLowerCase(), clientEmail: clean(data.email, 254).toLowerCase(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : null,
      terms: clean(data.terms, 20000), tokenHash: hashToken(token)
    };
    const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!record.provider || !record.client || !record.terms || !validEmail(record.clientEmail) || !validEmail(record.providerEmail)) return json(res, 400, { error: 'Add both names, valid email addresses, and the agreement terms.' });
    if (!process.env.RESEND_API_KEY || !process.env.FROM_EMAIL) return json(res, 503, { error: 'Email is not configured yet. Add RESEND_API_KEY and FROM_EMAIL in Vercel settings.' });
    const sql = database();
    await sql`INSERT INTO contract_requests (id,title,provider_name,provider_email,client_name,client_email,effective_date,terms,token_hash)
      VALUES (${record.id},${record.title},${record.provider},${record.providerEmail},${record.client},${record.clientEmail},${record.date},${record.terms},${record.tokenHash})`;
    const signUrl = `${process.env.APP_URL.replace(/\/$/, '')}/sign.html?token=${encodeURIComponent(token)}`;
    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.FROM_EMAIL, to: [record.clientEmail], subject: `Signature requested: ${record.title}`,
        html: `<p>Hello ${escapeHtml(record.client)},</p><p>${escapeHtml(record.provider)} has sent you an agreement to review and sign.</p><p><a href="${escapeHtml(signUrl)}" style="display:inline-block;padding:12px 18px;background:#315d45;color:white;text-decoration:none;border-radius:7px">Review and sign agreement</a></p><p>This personal signing link should not be forwarded. If you have questions, reply directly to the sender.</p><p><small>${escapeHtml(record.title)}</small></p>`,
        text: `Hello ${record.client},\n\n${record.provider} has sent you “${record.title}” to review and sign.\n\nReview and sign: ${signUrl}\n\nThis personal signing link should not be forwarded.` })
    });
    if (!mail.ok) {
      await sql`DELETE FROM contract_requests WHERE id=${record.id}`;
      throw new Error('The contract was not sent. Check your Resend sender and API key.');
    }
    return json(res, 201, { ok: true, message: 'Signature request sent.' });
  } catch (error) {
    console.error('Create signature request failed:', error.message);
    return json(res, error.message.startsWith('Missing server configuration') ? 503 : 500, { error: error.message || 'Could not send the request.' });
  }
};
