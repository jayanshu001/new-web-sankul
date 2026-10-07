// Email: SMTP (nodemailer) transport with bounded, retried sends.
import 'dotenv/config';
import nodemailer, { Transporter, SentMessageInfo } from 'nodemailer';
import { callOutbound } from '../libs/outbound';

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
  // Bounded so a flaky SMTP can't pin a request or hang the crash reporter's shutdown.
  const tx = getTransporter();
  return callOutbound(
    async () => {
      await tx.verify();
      return tx.sendMail({
        from: process.env.SMTP_USER,
        to,
        subject,
        html,
        text,
      });
    },
    { label: "email.smtp", timeoutMs: 8_000, attempts: 2 }
  );
}
