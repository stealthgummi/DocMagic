const { json, env, hashToken } = require('../lib/api');
const database = require('../lib/db');

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  try {
    env();
    const sql = database();
    if (req.method === 'GET') {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (token.length < 30) return json(res, 400, { error: 'This signing link is not valid.' });
      const rows = await sql`SELECT id,title,provider_name,client_name,effective_date,terms,status,signed_at,signer_name
        FROM contract_requests WHERE token_hash=${hashToken(token)} LIMIT 1`;
      if (!rows.length) return json(res, 404, { error: 'This signing link is invalid or has expired.' });
      const row = rows[0];
      return json(res, 200, { id: row.id, title: row.title, provider: row.provider_name, client: row.client_name, date: row.effective_date, terms: row.terms, status: row.status, signedAt: row.signed_at, signer: row.signer_name });
    }
    const { token, signer, consent } = req.body || {};
    const signerName = typeof signer === 'string' ? signer.trim().slice(0, 160) : '';
    if (typeof token !== 'string' || token.length < 30 || !signerName || consent !== true) return json(res, 400, { error: 'Enter your name and confirm your agreement to sign.' });
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].slice(0, 64);
    const userAgent = (req.headers['user-agent'] || '').slice(0, 512);
    const updated = await sql`UPDATE contract_requests SET status='signed',signed_at=now(),signer_name=${signerName},signer_ip=${ip},signer_user_agent=${userAgent},signer_consent=true
      WHERE token_hash=${hashToken(token)} AND status='pending' AND ${consent === true} RETURNING id`;
    if (!updated.length) return json(res, 409, { error: 'This agreement has already been signed or the link is invalid.' });
    const [agreement] = await sql`SELECT title,provider_email,provider_name,client_name,terms,signed_at,signer_name FROM contract_requests WHERE id=${updated[0].id} LIMIT 1`;
    if (agreement && process.env.RESEND_API_KEY && process.env.FROM_EMAIL) {
      const copy = `Agreement: ${agreement.title}\nProvider: ${agreement.provider_name}\nClient: ${agreement.client_name}\nSigned by: ${agreement.signer_name}\nSigned at: ${agreement.signed_at}\n\n${agreement.terms}`;
      const emailResponse = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.FROM_EMAIL, to: [agreement.provider_email], subject: `Signed: ${agreement.title}`, text: `Your agreement has been signed. The agreement and signature record are included below.\n\n${copy}` }) });
      if (!emailResponse.ok) console.error('Could not send provider signature confirmation.');
    }
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error('Signing request failed:', error.message);
    return json(res, error.message.startsWith('Missing server configuration') ? 503 : 500, { error: error.message || 'Could not process this request.' });
  }
};
