/**
 * Email delivery adapter.
 * PreShoot has no built-in mailer. If RESEND_API_KEY is set, send via Resend.
 * Otherwise callers must record failure — never report success.
 */
export function emailProviderStatus() {
  if (process.env.RESEND_API_KEY) {
    return { configured: true, provider: 'resend' };
  }
  return { configured: false, provider: null };
}

export async function sendTransactionalEmail({ to, subject, text }) {
  const status = emailProviderStatus();
  if (!status.configured) {
    return {
      ok: false,
      error: 'email_not_configured',
      message: 'No email provider is connected. Set RESEND_API_KEY to enable sending.'
    };
  }
  const from = process.env.EMAIL_FROM || 'PreShoot <noreply@preshoot.app>';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [String(to).slice(0, 320)],
      subject: String(subject || '').slice(0, 200),
      text: String(text || '').slice(0, 8000)
    })
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    return {
      ok: false,
      error: 'provider_failed',
      message: (data && (data.message || data.error)) || 'Email provider rejected the message'
    };
  }
  return {
    ok: true,
    provider: 'resend',
    provider_message_id: data && data.id ? String(data.id).slice(0, 128) : null
  };
}
