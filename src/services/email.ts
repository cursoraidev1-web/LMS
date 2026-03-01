import nodemailer from 'nodemailer';

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@lms.local';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: port ? parseInt(port, 10) : 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
}

export async function sendPasswordResetEmail(to: string, resetToken: string): Promise<boolean> {
  const transport = getTransport();
  const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
  const html = `
    <p>You requested a password reset for your CBT account.</p>
    <p><a href="${resetUrl}">Reset your password</a></p>
    <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
  `;
  if (transport) {
    try {
      await transport.sendMail({
        from: FROM_EMAIL,
        to,
        subject: 'Reset your password',
        text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
        html,
      });
      return true;
    } catch (err) {
      console.error('Send password reset email failed:', err);
      return false;
    }
  }
  return false;
}
