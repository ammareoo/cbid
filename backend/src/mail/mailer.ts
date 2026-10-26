import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
  readonly kind: 'smtp' | 'dev-file';
}

/**
 * SMTP in any environment where SMTP_URL is set. Without it (development only) messages are
 * written to storage/dev-mail so reset/invite links can be opened locally. Production without
 * SMTP_URL is refused by createMailer so links are never written to disk on a server.
 */
export function createMailer(opts: { smtpUrl?: string; from: string; env: string; devDir?: string }): Mailer {
  if (opts.smtpUrl) {
    const transport = nodemailer.createTransport(opts.smtpUrl);
    return {
      kind: 'smtp',
      async send(msg) {
        await transport.sendMail({ from: opts.from, to: msg.to, subject: msg.subject, text: msg.text });
      },
    };
  }
  if (opts.env === 'production') throw new Error('SMTP_URL is required in production');
  const dir = opts.devDir ?? path.resolve('storage/dev-mail');
  return {
    kind: 'dev-file',
    async send(msg) {
      await mkdir(dir, { recursive: true });
      const safe = msg.to.replace(/[^a-z0-9@._-]/gi, '_');
      await writeFile(path.join(dir, `${Date.now()}-${safe}.txt`), `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n`, { mode: 0o600 });
    },
  };
}
