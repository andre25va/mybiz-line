import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'tc@myredeal.com',
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(opts: EmailOptions) {
  return transporter.sendMail({
    from: '"MyBiz Line" <tc@myredeal.com>',
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
