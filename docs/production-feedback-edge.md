# Production feedback invitation handoff

**Superseded for sending, 14 November 2026:** The owner restricted the feedback campaign to testing. Production `send-feedback-invitation` version 4 is deployed with an unconditional production sending block after authentication. The updated dashboard also blocks activation and sending. Professor and Nick retain production growth approval/rejection authority, but neither may send this testing-only campaign in production. The remaining deployment instructions below describe the earlier configuration and must not be used to activate production feedback.

Updated 12 November 2026. Prepared locally; no production deployment, campaign activation or email send was performed for this change. The verified production accounts `superiorvideo@gmail.com` (`b80fb162-04d0-47c4-928f-a03da244730e`) and `nick@cardify.club` (`f926669e-77bf-40cb-a054-3260f07b4dc8`) can approve/send while their dashboard admin membership is enabled. Both the dashboard API and Edge Function check the matching Auth ID and verified email independently. Testing permissions are unchanged. For the small update that adds Nick, use [the production approval update checklist](production-approval-update-2026-11-12.md).

## Files to upload to the production dashboard repository

Replace:
- `config/reporting.production.json`
- `server/growth-operations.mjs`
- `server/feedback-eligibility.mjs`
- `server/reporting-authority.mjs`
- `src/components/FeedbackEligibility.jsx`

Add:
- `server/feedback-edge.mjs`
- `supabase/functions/send-feedback-invitation/index.ts`
- `supabase/functions/_shared/feedback-invitation-handler.mjs`
- `supabase/functions/_shared/feedback-targeted.mjs`
- `supabase/functions/_shared/feedback-delivery.mjs`
- `supabase/functions/_shared/feedback-campaign.mjs`
- `scripts/feedback-edge.test.mjs`
- `scripts/feedback-targeted.test.mjs`
- `scripts/feedback-eligibility.test.mjs`
- `docs/production-feedback-edge.md`

Use the production `server/reporting-authority.mjs`; replace any copy containing testing approval branches. Retain `supabase/functions/_shared/envelope-mailer.mjs` and `supabase/functions/_shared/shipment-tracking.mjs`. The Edge deployment must include those two shared mailer files as dependencies. Do not copy testing `feedback-test-resend` or testing permission files into production.

## Configure and deploy

1. In production Supabase project `dunoesykjvdnpeavojsi`, deploy `send-feedback-invitation` with its `_shared` dependencies listed above. Keep JWT verification enabled. GitHub upload alone does not deploy Edge Functions. Calls carry the signed-in user's bearer token, never a copied service-role bearer.
2. Set these **production Supabase Edge secrets**:
   - `CUSTOMER_APP_URL=https://www.tcgplaytest.com`
   - `FEEDBACK_SIGNING_SECRET`: a distinct, stable random production secret of at least 32 characters. Preserve the current production signing secret if any invitations have already been created.
   - `MARKETING_UNSUBSCRIBE_SECRET`: identical to the production storefront's unsubscribe signing secret (or matching `MARKETING_SYNC_SECRET` fallback).
   - `GMAIL_SERVICE_ACCOUNT_JSON`, `GMAIL_SENDER_EMAIL`, `GMAIL_OAUTH_SUBJECT`: the working production mail configuration.
   - `FEEDBACK_DELIVERY_READY=true` once configured.
   Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` internally; do not paste secrets into code.
3. In production dashboard Vercel settings retain the production Supabase URL/server credentials and set `FEEDBACK_DELIVERY_READY=true`. The new targeted path reads Gmail and signing secrets from Supabase, not Vercel. Redeploy the production dashboard.
4. The production storefront must already have `app/feedback/page.tsx`, `app/api/feedback/route.ts`, `lib/server/feedbackResponse.mjs` and its existing unsubscribe route from the earlier handoff. Existing feedback SQL migrations must already be installed; this change adds no migration.
5. Sign in as superiorvideo@gmail.com or nick@cardify.club, configure the campaign, and review eligibility/readiness. Approve and enable only when ready. Choose one eligible order, click Send invitation, verify the email and full order ID, then Confirm and send.
6. Check inbox arrival, complete the questionnaire as that recipient, verify one 5-PRINTS ledger credit and completed status. Reopening/completing the same invitation must not award again. Keep the campaign enabled until completion; pausing blocks responses.

## Behavior and limits

The new single-order button uses the Edge Function. It rechecks eligibility through the existing atomic SQL functions, validates the selected recipient, and reserves sending before contacting Gmail. Existing invitations are never automatically resent. Failed, uncertain or stuck-sending invitations require provider review. `sent` means Gmail accepted the message, not confirmed inbox delivery. No schedule is enabled by this change. Provider receipts appear in the Edge log event `feedback_edge_delivery`.

After an explicitly authorized database requeue to `pending`, the button displays **Retry invitation**. The same invitation ID, original token, expiry and single reward are retained. An extra email attempt requires email budget but no extra invitation or PRINTS capacity. The original signing secret must match before claiming a retry. Each email attempt gets a distinct Message-ID; atomic claiming prevents simultaneous requests sending twice. No production invitation has been requeued by this update.

The legacy `run_feedback_batch` action is disabled, matching the testing dashboard. Use the single-order button.

Tests: `node --test scripts/feedback-edge.test.mjs scripts/feedback-targeted.test.mjs scripts/feedback-eligibility.test.mjs scripts/growth-operations.test.mjs`.
