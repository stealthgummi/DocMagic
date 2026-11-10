const nodemailer = require('nodemailer');

function sanitize(val) {
  if (typeof val !== 'string') return '';
  return val.trim().replace(/^["']|["']$/g, '');
}

function getTransporter() {
  const host = sanitize(process.env.SMTP_HOST) || 'smtp.hostinger.com';
  const port = parseInt(sanitize(process.env.SMTP_PORT) || '465', 10);
  const user = sanitize(process.env.SMTP_USER) || sanitize(process.env.FROM_EMAIL) || 'contracts@7layer.store';
  const pass = sanitize(process.env.SMTP_PASS) || '';
  const secure = port === 465;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: {
      rejectUnauthorized: false
    }
  });
}

async function sendMail({ to, subject, html, text }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('SMTP is not configured (SMTP_USER / SMTP_PASS missing). Skipping email.');
    return { sent: false, error: 'SMTP credentials missing (SMTP_USER or SMTP_PASS not set).' };
  }

  const senderName = sanitize(process.env.FROM_NAME) || '7Layer Studio Contracts';
  const user = sanitize(process.env.SMTP_USER) || sanitize(process.env.FROM_EMAIL) || 'contracts@7layer.store';
  const from = `"${senderName}" <${user}>`;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      envelope: {
        from: user,
        to
      }
    });

    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('Nodemailer sendMail failed:', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = { getTransporter, sendMail };

