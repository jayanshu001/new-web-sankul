// src/utils/emailService.ts
import 'dotenv/config';
import nodemailer, { Transporter, SentMessageInfo } from 'nodemailer';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error('SMTP env missing: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // SSL on 465; STARTTLS on 587/2525 
    auth: { user, pass },
  });

  return transporter;
}

export async function sendEmail(
  to: string | string[],
  subject: string,
  html?: string,
  text?: string
): Promise<SentMessageInfo> {
  const tx = getTransporter();
  await tx.verify(); // fail fast if can’t connect/auth
  const info = await tx.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    html,
    text,
  });
  return info;
}
