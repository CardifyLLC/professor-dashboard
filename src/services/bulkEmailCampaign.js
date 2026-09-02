import { getAdminAuthHeaders } from './supabaseClient';

const wait = (milliseconds) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export async function sendBulkEmailCampaign({ emails, subject, htmlBody, onProgress }) {
  const recipients = [...new Set((emails || []).map(email => String(email).trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) return { sent: 0, failed: 0, campaignId: null, firstError: '' };

  const authHeaders = await getAdminAuthHeaders();
  const campaignId = crypto.randomUUID();
  const batchSize = 40;
  const batches = Array.from({ length: Math.ceil(recipients.length / batchSize) }, (_, index) =>
    recipients.slice(index * batchSize, (index + 1) * batchSize)
  );
  let sent = 0;
  let failed = 0;
  let firstError = '';

  for (let index = 0; index < batches.length; index += 1) {
    onProgress?.(`Sending notification batch ${index + 1} of ${batches.length}… ${sent} accepted so far.`);
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-bulk-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        emails: batches[index], subject, body: htmlBody, isHtml: true,
        campaignId, campaignTotal: recipients.length,
        batchIndex: index, batchCount: batches.length,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Wallet grant completed, but notification batch ${index + 1} failed after ${sent} accepted emails: ${result.error || 'Email delivery failed.'} Receipt ID: ${campaignId}`);
    }
    sent += Number(result.sent || 0);
    failed += Number(result.failed || 0);
    if (!firstError && result.firstError) firstError = result.firstError;

    if (index < batches.length - 1) {
      onProgress?.(`Notification batch ${index + 1} complete. Waiting 60 seconds before continuing.`);
      await wait(60_000);
    }
  }

  return { sent, failed, firstError, campaignId };
}

export function buildGrantEmail({ amount, note, welcome = false }) {
  const safeNote = String(note || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    subject: welcome
      ? `${Number(amount).toLocaleString()} welcome PRINTS added to your account`
      : `${Number(amount).toLocaleString()} PRINTS added to your account`,
    htmlBody: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:600px;margin:0 auto;padding:32px 24px;">
      <p>Hi there,</p>
      <p><strong>${Number(amount).toLocaleString()} ${welcome ? 'welcome ' : ''}PRINTS</strong> have been added to your TCGPlaytest wallet${welcome ? '' : ' by our team'}.</p>
      ${safeNote ? `<p><strong>Note from our team:</strong> ${safeNote}</p>` : ''}
      <p>You can apply PRINTS to your next order by selecting “Pay with PRINTS” at checkout. Shipping and any remaining balance are paid separately.</p>
      <p>The TCGPlaytest Team</p>
    </div>`,
  };
}
