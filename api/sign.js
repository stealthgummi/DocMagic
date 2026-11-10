const { json, env, hashToken } = require('../lib/api');
const database = require('../lib/db');
const { sendMail } = require('../lib/mailer');

function escapeHtml(s) {
  return typeof s === 'string' ? s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) : '';
}

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });

  try {
    env();
    const sql = database();

    // GET: Retrieve agreement for signing/reviewing
    if (req.method === 'GET') {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (token.length < 30) return json(res, 400, { error: 'This signing link is not valid.' });

      const rows = await sql`
        SELECT id, title, provider_name, provider_signer_name, provider_signed_at, provider_email,
               client_name, client_email, effective_date, terms, status, created_at, signed_at,
               signer_name, signer_ip, token
        FROM contract_requests 
        WHERE token_hash=${hashToken(token)} 
        LIMIT 1
      `;
      if (!rows.length) return json(res, 404, { error: 'This signing link is invalid or has expired.' });

      const row = rows[0];
      return json(res, 200, {
        id: row.id,
        title: row.title,
        provider: row.provider_name,
        providerSigner: row.provider_signer_name || 'Julia Singerman',
        providerSignedAt: row.provider_signed_at || row.created_at,
        providerEmail: row.provider_email,
        client: row.client_name,
        clientEmail: row.client_email,
        date: row.effective_date,
        terms: row.terms,
        status: row.status,
        createdAt: row.created_at,
        signedAt: row.signed_at,
        signer: row.signer_name,
        signerIp: row.signer_ip
      });
    }

    // POST: Submit signature
    const { token, signer, consent, role } = req.body || {};
    const signerName = typeof signer === 'string' ? signer.trim().slice(0, 160) : '';

    if (typeof token !== 'string' || token.length < 30 || !signerName || consent !== true) {
      return json(res, 400, { error: 'Please enter your full legal name and check the consent box to sign.' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64) || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = (req.headers['user-agent'] || '').slice(0, 512);

    if (role === 'provider') {
      const updated = await sql`
        UPDATE contract_requests 
        SET provider_signer_name=${signerName}, provider_signed_at=now()
        WHERE token_hash=${hashToken(token)} 
        RETURNING id
      `;
      if (!updated.length) return json(res, 404, { error: 'Could not update provider signature.' });
      return json(res, 200, { ok: true, role: 'provider', signer: signerName });
    }

    // Client signature (or final execution)
    const updated = await sql`
      UPDATE contract_requests 
      SET status='signed',
          signed_at=now(),
          signer_name=${signerName},
          signer_ip=${ip},
          signer_user_agent=${userAgent},
          signer_consent=true
      WHERE token_hash=${hashToken(token)} AND status='pending' 
      RETURNING id
    `;
    if (!updated.length) {
      return json(res, 409, { error: 'This agreement has already been signed or the link is invalid.' });
    }

    const [agreement] = await sql`
      SELECT id, title, provider_email, client_email, provider_name, provider_signer_name, provider_signed_at,
             client_name, terms, signed_at, signer_name, signer_ip 
      FROM contract_requests 
      WHERE id=${updated[0].id} 
      LIMIT 1
    `;

    if (agreement) {
      const provSigner = agreement.provider_signer_name || 'Julia Singerman';
      const provSignedDate = new Date(agreement.provider_signed_at || agreement.signed_at).toLocaleString();
      const clientSignedDate = new Date(agreement.signed_at).toLocaleString();

      let notifyEmail = (agreement.provider_email || '').trim().toLowerCase() || 'contracts@7layer.store';
      if (notifyEmail === 'contract@7layer.store') notifyEmail = 'contracts@7layer.store';
      const clientEmail = (agreement.client_email || '').trim().toLowerCase();

      const executedHtml = `
        <div style="font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; color: #232822; background: #ffffff; border: 1px solid #e7e8e1; border-radius: 12px;">
          <div style="background: #edf7ed; border: 1px solid #c8e6c9; border-radius: 8px; padding: 14px 18px; margin-bottom: 20px;">
            <h2 style="color: #1e4620; margin: 0 0 6px 0; font-size: 19px;">✓ Agreement Fully Executed &amp; Legally Binding</h2>
            <p style="margin: 0; font-size: 13px; color: #2e5932;">Both Provider and Client have completed electronic signatures for <strong>${escapeHtml(agreement.title)}</strong>.</p>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px;">
            <div style="background: #fbfaf7; border: 1px solid #e7e8e1; border-radius: 8px; padding: 12px 14px;">
              <div style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: #73796f; margin-bottom: 4px;">Provider Authorization</div>
              <div style="font-size: 16px; font-family: Georgia, serif; font-weight: bold; color: #315d45;">✓ ${escapeHtml(provSigner)}</div>
              <div style="font-size: 11px; color: #73796f; margin-top: 2px;">${escapeHtml(agreement.provider_name)} · ${provSignedDate}</div>
            </div>
            <div style="background: #fbfaf7; border: 1px solid #e7e8e1; border-radius: 8px; padding: 12px 14px;">
              <div style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: #73796f; margin-bottom: 4px;">Client Acceptance</div>
              <div style="font-size: 16px; font-family: Georgia, serif; font-weight: bold; color: #315d45;">✓ ${escapeHtml(agreement.signer_name)}</div>
              <div style="font-size: 11px; color: #73796f; margin-top: 2px;">${escapeHtml(agreement.client_name)} · ${clientSignedDate}</div>
            </div>
          </div>

          <h3 style="margin: 18px 0 8px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #73796f;">Executed Terms &amp; Provisions</h3>
          <div style="background: #f7f7f2; border: 1px solid #e7e8e1; padding: 16px; border-radius: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; font-family: Georgia, serif;">${escapeHtml(agreement.terms)}</div>

          <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #e7e8e1; font-size: 11px; color: #73796f; line-height: 1.5;">
            <strong>Audit Trail Verification:</strong> Executed via DocMagic E-Sign. Signer IP: ${escapeHtml(agreement.signer_ip || 'Recorded')} · Timestamp: ${clientSignedDate}. An indelible electronic archive record has been generated.
          </div>
        </div>
      `;

      const plainText = `Agreement Executed: ${agreement.title}\n\nProvider: ${agreement.provider_name} (Signed by ${provSigner} at ${provSignedDate})\nClient: ${agreement.client_name} (Signed by ${agreement.signer_name} at ${clientSignedDate})\n\nTerms:\n${agreement.terms}\n\nAudit: IP ${agreement.signer_ip || 'Recorded'} at ${clientSignedDate}`;

      // Email 1: Send to Provider
      try {
        await sendMail({
          to: notifyEmail,
          subject: `✓ Executed Agreement: ${agreement.title} (${agreement.client_name})`,
          html: executedHtml,
          text: plainText
        });
      } catch (err) {
        console.error('Could not send executed copy to provider:', err.message);
      }

      // Email 2: Send to Client
      if (clientEmail && clientEmail !== notifyEmail) {
        try {
          await sendMail({
            to: clientEmail,
            subject: `✓ Your Executed Agreement Copy: ${agreement.title}`,
            html: executedHtml,
            text: plainText
          });
        } catch (err) {
          console.error('Could not send executed copy to client:', err.message);
        }
      }
    }

    return json(res, 200, { ok: true, status: 'signed', signer: signerName });
  } catch (error) {
    console.error('Signing request failed:', error.message);
    return json(res, error.message.startsWith('Missing server configuration') ? 503 : 500, { error: error.message || 'Could not process this request.' });
  }
};
