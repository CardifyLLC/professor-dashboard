# Reporting, reconciliation, conversion and alerts — GitHub rollout

**14 November update:** Feedback is now testing-only; production enable/send/batch actions are blocked. The three additive reporting migrations dated 20261113 are already applied to both hosted projects; do not rerun them. The updated handoff's `UPLOAD-NOW.md`, `ROLLOUT-2026-11-14.md` and `SETTINGS-2026-11-14.md` supersede the historical installation/activation steps below. UTC scheduled delivery, audited uncertain-delivery review, evidence-backed pending proposals, and Discord fallback are included. AI remains disabled at the owner's request. Vercel/GitHub settings are installed after explicit approval; the owner must still upload source and deploy before live scheduled delivery can be verified.

Prepared 11 November 2026; production approval permissions updated 12 November 2026. This is a source-code handoff, not a deployment or a certification of live financial balances. Historical installation steps below must be compared with your existing deployment before applying. The Nick approval update needs no new SQL: see [the exact incremental upload list](production-approval-update-2026-11-12.md).

## Repository mapping

Upload each folder's **contents** to the corresponding repository root. Do not put `dashboard-main/` or `testing-prof-main/` inside the GitHub repository unless that is already its structure. Use the generated `GITHUB-FILES.md` for every exact path. Production and testing are separate copies: the testing checkout retains its promo logic and disabled automatic tax settings; the testing dashboard retains Promo Cards and Iridesse PDF tools. Never replace testing with the production folder wholesale.

## Database first, testing first

Run these files once in this order in the **testing** Supabase SQL editor, then repeat against production after testing:

1. `database/reporting-workflows.draft.sql`
2. `database/feedback-invitations.draft.sql`
3. `database/reporting-v2.sql`

Despite the older `.draft.sql` filenames, these are the implementation migrations included in the tested handoff. Do not run a migration twice; they intentionally fail on pre-existing objects rather than silently replacing an unknown schema. If a previous version was applied manually, compare that schema first. None of these three migrations was applied to either hosted database during this handoff.

The first migration creates the approval/exception queues, disabled feedback campaign, atomic reward function and refund audit. The second creates consent-checked invitation functions. The third adds retained financial facts, server checkout attempts, deduplicated journey stages, health heartbeats and durable report delivery records. All new tables and RPCs deny anonymous/authenticated direct access. Authenticated application routes check current admin membership.

Financial facts preserve minimal order/payment metadata and ledger references when operational orders are deleted. Backfill covers **records that still exist**; it cannot reconstruct orders purged before this migration. Provider movements with no retained counterpart stay visible as reconciliation exceptions. These facts contain user/order identifiers and need your normal retention/access policy.

## Hosting configuration

Use each environment's own Supabase project and provider credentials. Do not put any secret below in a `VITE_` or `NEXT_PUBLIC_` variable or a committed file.

| Location | Variables / settings |
| --- | --- |
| Both dashboard servers | Existing `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; server-only `SUPABASE_URL` (same project), `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` |
| Both dashboard servers | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, explicit `PAYPAL_ENV=live` in production or `sandbox` in testing. PayPal application needs Transaction Search read permission. Missing permission is reported unavailable, never zero. |
| Both dashboard servers | `DASHBOARD_APP_URL` and `CUSTOMER_APP_URL`, HTTPS URLs for that environment |
| Both dashboard servers | `REPORTING_JOB_SECRET`: a new random secret of at least 32 characters; keep identical in that environment's scheduler and dashboard, different between production/testing |
| Both dashboard servers | Existing Gmail service-account values must also be available here: `GMAIL_SERVICE_ACCOUNT_JSON`, `GMAIL_SENDER_EMAIL`, `GMAIL_OAUTH_SUBJECT`. They were previously used in Edge Functions; Vercel does not inherit Edge Function secrets. |
| Both dashboard servers | `REPORT_DELIVERY_ENABLED=true` and `OPERATION_ALERTS_ENABLED=true` only when the mail configuration and destinations are ready |
| Testing dashboard | `REPORT_TEST_RECIPIENTS`: explicit comma-separated test addresses. There is deliberately no production-recipient fallback. Testing keeps its existing verified-email approver list and enabled-admin check; the Nick production update does not change it. |
| Both dashboard servers | Optional `REPORT_AGED_ORDER_HOURS` (default 72), `OPERATIONS_OWNER` (default superiorvideo@gmail.com) |
| Both dashboard servers | Keep `CONVERSION_VALIDATED=false` until the deployed provider-path smoke checks below pass. Even when true, immature cohorts, missing linkage or source failures suppress conversion rates. |
| Both storefronts | `DASHBOARD_APP_URL` points to their matching dashboard. Existing Supabase/service keys and payment secrets remain environment-specific. |
| Production `ai-insights` Edge Function | Set `DASHBOARD_APP_URL` to production and `AI_INSIGHTS_ENABLED=true` to retain production AI. AI fetches the private server report using the verified admin session and ignores client-supplied financial numbers. |
| Testing AI | **Deliberately disabled in source and UI.** Provider keys or `AI_INSIGHTS_ENABLED=true` cannot activate this testing handler. |
| Feedback | Keep `FEEDBACK_DELIVERY_READY` unset/false. Campaigns remain disabled until timing, audience, consent, questions, reward limits and budget are explicitly configured and verified. Existing secret requirements are `FEEDBACK_SIGNING_SECRET` (32+ characters), `MARKETING_UNSUBSCRIBE_SECRET` or `MARKETING_SYNC_SECRET`, and the customer origin. |

Production report recipients remain `superiorvideo@gmail.com` and `placeparks@gmail.com`. Production approval authority belongs to the verified accounts `superiorvideo@gmail.com` and `nick@cardify.club`, with matching Auth IDs pinned in `config/reporting.production.json` and independently checked by the feedback Edge handler. Both must be enabled dashboard admins. `placeparks@gmail.com` does not gain production approval. The production approval module rejects other projects and ignores `REPORTING_APPROVER_USER_ID` overrides. Testing uses its existing separate verified-email approver list.

Deploy the `reject-order` and `ai-insights` Edge Functions from the corresponding dashboard folder after their migrations/configuration. Include imported `_shared` modules when deploying. Updating GitHub alone does not deploy Supabase functions or run SQL. The old `stripe-analytics` function is no longer the source for dashboard cash cards; they now call `/api/business-report`.

## Reuse the existing daily report delivery

The existing storefront `/api/bots/prints` public PRINTS-only response is preserved. Its private extension is:

`GET /api/bots/prints?scope=business&kind=daily&date=2026-11-10`

Send a bearer admin session or the matching `REPORTING_JOB_SECRET`. Without authentication the business report returns 401. The public endpoint never receives financial/operations details.

For the existing scheduler, replace its report-generation/send step with **one** of these dashboard job calls; the job handles the two recipient emails and durable deduplication:

```text
POST /api/reporting-job?kind=daily
POST /api/reporting-job?kind=weekly
Authorization: Bearer <REPORTING_JOB_SECRET>
```

Daily defaults to the previous complete UTC day; weekly defaults to the previous seven complete UTC days. `date` specifies a daily UTC day, or a weekly exclusive end date. Use the existing delivery time; run at least three hours after UTC midnight so PayPal reporting has time to appear. Add the weekly invocation to that same scheduler on the agreed review day. Do not keep the old email-send step as well as the new job send step.

Alternatively, the scheduler can execute `node scripts/reporting-job.mjs daily` or `weekly` with the configured origin/secret. The new GitHub workflow supports manual daily/weekly dispatch but **does not add a second daily or weekly schedule**. The original external report scheduler was not identifiable from the checked code or database cron; its schedule must be connected during installation, not guessed. No email was sent during implementation.

## Alerts and PDF heartbeat

The new `.github/workflows/reporting-operations.yml` schedules an operations scan every 15 minutes. Configure repository variable `DASHBOARD_APP_URL`, secret `REPORTING_JOB_SECRET`, and secret `OPERATIONS_ALERT_WEBHOOK_URL` (an HTTPS Slack/Teams-compatible JSON webhook) in each dashboard repository. This independent webhook is used if the monitor or mail path fails, including workflow setup failures. It does not replace the report recipients.

The existing PDF workflow records success/failure heartbeats and calls the same independent fallback webhook on failure. Retain its existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` GitHub secrets. The monitor checks app health, failed PDF jobs, missing/stale worker heartbeats, aged orders, shipping-notification failures, unresolved refunds and uncertain report deliveries. It creates an exception with an owner and next action and sends one notification per unresolved incident. Reopening a resolved incident increments its version and permits a new alert. It never retries customer/refund emails automatically.

Carrier transit status, stock, finishes, physical capacity and destination holiday cutoffs are not inferred from email acceptance or order age. Staff can enter those exceptions in the queue; holiday shipping promises remain blocked on operational verification.

## Metrics and verification

`business-v2` is the shared calculation for cards, private reports, prior-period comparisons and minimal AI input. UTC intervals are start-inclusive/end-exclusive. Stripe uses balance-movement creation time and captured presentment amounts for order matching; reported cash is in each movement's balance currency. PayPal uses balance-affecting Transaction Search rows, successful or reversed-original payment records, and refund event codes. It uses the provider transaction initiation time; pending records remain exceptions, and delayed settlements can require rerunning historical periods. Three-hour PayPal freshness is enforced for current periods.

Cash collected, successful refund movements and net cash are separate by currency and before fees. Transfers, payouts, disputes, adjustments, pending/unknown movements and unrecognized transaction codes are not silently treated as sales; they remain exceptions. PRINTS purchases, redemptions and reversals are units, not additional cash sales. Package payments match session identity and awarded units. Wallet-only and mixed-tender orders reconcile ledger debits without counting wallet consumption as cash. A `matched` status means the loaded evidence matches; it is not a financial audit opinion. Prior-period changes are withheld unless both periods match. Missing sources/overflow/truncated extracts fail visibly.

Conversion follows visit sessions for seven days, with 30-minute browser session inactivity expiry. The server generates checkout-attempt identity from its order UUID; browser-supplied payment success is rejected. Database uniqueness handles duplicate events and attempt/stage transitions. Signed Stripe asynchronous successes use the same fulfillment path; retries preserve already-refunded and already-shipped states. PayPal/wallet completion is observed after server payment state and any required PRINTS consumption. Package purchases are a separate financial flow, not the card-design conversion funnel. Non-browser/unlinked attempts are counted and keep the conversion status unverified.

Before production rollout: run the SQL on testing; deploy both testing apps and their Edge Functions; test Stripe card and delayed payment, PayPal, mixed tender, wallet redemption, failure/abandonment, retry and duplicate callbacks. Verify one linked server payment event per attempt, correct amounts/currencies and one ledger effect. Generate both reports, confirm both test mail receipts, force a synthetic PDF/health failure and confirm the alert plus queue entry. Check the fallback webhook too. Set production secrets and run equivalent non-destructive readiness checks after rollout. Do not use a real customer refund to test the refund code.

Focused automated tests cover provider normalization/pagination, multi-currency cash, prior-period refunds, mixed tender, wallet-only/package flows, missing sources, date boundaries, duplicate/conflicting data, immutable fact retention, SQL access denial, server payment stages, atomic feedback credit, delivery concurrency and uncertain outcomes. Both storefront TypeScript checks and both dashboard builds pass. Local checks used Node 24.16; deployment should use the repositories' required Node version (dashboard >=24.22.1 <25).

## Recovery

Disable report/alert delivery flags to pause sending. Stop the operations workflow if its host configuration is incorrect. Roll back application code if needed, but retain refund operations, claims, report deliveries, journey records and financial facts; deleting audit/deduplication rows can make retries unsafe. `sending`/`uncertain` deliveries require checking the mail provider before an operator resets state. Do not run the old seven-table security rollback as part of this feature rollback.

Provider references: [Stripe balance transactions](https://docs.stripe.com/api/balance_transactions/list), [PayPal transaction search](https://developer.paypal.com/api/transaction-search/v1/search-get), [PayPal event codes](https://developer.paypal.com/reports/reference/t-codes).
