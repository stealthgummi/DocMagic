const nodemailer = require('nodemailer');
const { sanitize, normalizeWorkspace, getWorkspaceMeta } = require('./api');

function getMailSettings(workspace = '7layer') {
  const ws = normalizeWorkspace(workspace);
  const defaultWs = normalizeWorkspace(process.env.DEFAULT_WORKSPACE);

  if (ws === 'flipbooks') {
    const host = sanitize(process.env.FLIPBOOKS_SMTP_HOST) || sanitize(process.env.SMTP_HOST) || 'smtp.hostinger.com';
    const port = parseInt(sanitize(process.env.FLIPBOOKS_SMTP_PORT) || sanitize(process.env.SMTP_PORT) || '465', 10);
    const user = sanitize(process.env.FLIPBOOKS_SMTP_USER) || sanitize(process.env.FLIPBOOKS_FROM_EMAIL) || (defaultWs === 'flipbooks' ? sanitize(process.env.SMTP_USER) : '') || 'license@flipbooks.media';
    const pass = sanitize(process.env.FLIPBOOKS_SMTP_PASS) || (defaultWs === 'flipbooks' ? sanitize(process.env.SMTP_PASS) : '');
    const senderName = sanitize(process.env.FLIPBOOKS_FROM_NAME) || getWorkspaceMeta('flipbooks').fromName;
    const replyTo = sanitize(process.env.FLIPBOOKS_REPLY_TO) || 'info@flipbooks.media';
    return { host, port, secure: port === 465, user, pass, senderName, replyTo };
  }

  const host = sanitize(process.env.SMTP_HOST) || 'smtp.hostinger.com';
  const port = parseInt(sanitize(process.env.SMTP_PORT) || '465', 10);
  const user = sanitize(process.env.SMTP_USER) || sanitize(process.env.FROM_EMAIL) || 'contracts@7layer.store';
  const pass = sanitize(process.env.SMTP_PASS) || '';
  const senderName = sanitize(process.env.FROM_NAME) || getWorkspaceMeta('7layer').fromName;
  const replyTo = sanitize(process.env.REPLY_TO_EMAIL) || user;
  return { host, port, secure: port === 465, user, pass, senderName, replyTo };
}

function getTransporter(workspace = '7layer') {
  const cfg = getMailSettings(workspace);
  if (!cfg.user || !cfg.pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: {
      rejectUnauthorized: false
    }
  });
}

async function sendMail({ to, subject, html, text, workspace = '7layer' }) {
  const cfg = getMailSettings(workspace);
  const transporter = getTransporter(workspace);
  if (!transporter) {
    const missingHint = normalizeWorkspace(workspace) === 'flipbooks'
      ? 'Flipbooks Media SMTP credentials missing (set FLIPBOOKS_SMTP_USER and FLIPBOOKS_SMTP_PASS).'
      : 'SMTP credentials missing (SMTP_USER or SMTP_PASS not set).';
    console.warn(`${missingHint} Skipping email.`);
    return { sent: false, error: missingHint };
  }

  const from = `"${cfg.senderName}" <${cfg.user}>`;

  try {
    const info = await transporter.sendMail({
      from,
      replyTo: cfg.replyTo,
      to,
      subject,
      text,
      html,
      envelope: {
        from: cfg.user,
        to
      }
    });

    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('Nodemailer sendMail failed:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { getMailSettings, getTransporter, sendMail };
