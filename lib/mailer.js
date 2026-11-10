const nodemailer = require('nodemailer');

function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.hostinger.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const user = process.env.SMTP_USER || process.env.FROM_EMAIL || '';
  const pass = process.env.SMTP_PASS || '';
  const secure = port === 465;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

async function sendMail({ to, subject, html, text }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('SMTP is not configured (SMTP_USER / SMTP_PASS missing). Skipping email.');
    return { sent: false, reason: 'unconfigured' };
  }

  const senderName = process.env.FROM_NAME || '7Layer Studio Contracts';
  const user = process.env.SMTP_USER || process.env.FROM_EMAIL;
  const from = `"${senderName}" <${user}>`;

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html
  });

  return { sent: true, messageId: info.messageId };
}

module.exports = { getTransporter, sendMail };

