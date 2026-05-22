// src/utils/emailService.ts
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
  // Wrapped in callOutbound so a flaky SMTP doesn't pin a request-handling
  // process. The crash-reporter calls this too — a crash + an unreachable
  // SMTP shouldn't compound into a hung shutdown. 8s × 2 attempts is enough
  // for one TLS handshake retry but bounded total wait.
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
