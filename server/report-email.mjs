// Presentation only: values, coverage, delivery keys and stored evidence stay unchanged.
const MAX_ROWS = 8;
const clean = (value, limit = 180) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const list = value => Array.isArray(value) ? value : [];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') : 'Unavailable';
const size = value => Array.isArray(value) ? value.length : null;
const date = value => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value)) : 'Date unavailable';
const updated = value => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(value)) + ' UTC' : 'Update time unavailable';
export function emailMoney(value, currency) {
  if (!Number.isSafeInteger(value) || !/^[A-Z]{3}$/.test(currency || '')) return 'Unavailable';
  try {
    const formatter = new Intl.NumberFormat('en-US', {style:'currency',currency});
    return formatter.format(value / 10 ** formatter.resolvedOptions().maximumFractionDigits);
  } catch { return 'Unavailable'; }
}
export function emailPeriod(period = {}) {
  const start = Date.parse(period.start), end = Date.parse(period.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'Reporting dates unavailable';
  const first = date(period.start), last = date(new Date(end - 1).toISOString());
  return first === last ? first : first + ' – ' + last;
}
const section = (title, rows = [], notes = []) => ({title, rows, notes:notes.filter(Boolean)});
function dashboardLink(options) {
  const fallback = options.testing ? 'https://testing-dashboard-phi.vercel.app/' : 'https://professor-dashboard-five.vercel.app/';
  try {
    const url = new URL(options.dashboardUrl || fallback);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : fallback;
  } catch { return fallback; }
}
function renderEmail({title,period,notice,sections,options,footer}) {
  const testing = options.testing === true, url = dashboardLink(options);
  const environment = testing ? 'TESTING · Test environment' : 'PRODUCTION · Business report';
  const text = [
    'TCGPlaytest — ' + title, period, environment,
    testing ? 'This email contains testing data. Do not use it to assess the live business.' : '',
    notice,
    ...sections.map(item => [item.title.toUpperCase(), ...item.rows.map(([label,value]) => label + ': ' + value), ...item.notes].join('\n')),
    'OPEN DASHBOARD\n' + url + '\nChoose Growth and operations for the full report and action list.',
    footer,
  ].filter(Boolean).join('\n\n');
  const rowHtml = rows => '<table style="width:100%;border-collapse:collapse;font-size:15px">' +
    rows.map(([label,value]) => '<tr><th scope="row" style="text-align:left;font-weight:400;color:#475569;padding:10px 8px 10px 0;border-bottom:1px solid #edf0f4;vertical-align:top;width:58%">' + escape(label) + '</th><td style="text-align:right;font-weight:700;color:#0f172a;padding:10px 0 10px 8px;border-bottom:1px solid #edf0f4;vertical-align:top;overflow-wrap:anywhere">' + escape(value) + '</td></tr>').join('') + '</table>';
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escape(title) +
    '</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">' +
    '<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px"><table role="presentation" style="width:100%;max-width:640px;margin:0 auto;border-collapse:collapse;background:#ffffff">' +
    '<tr><td style="padding:28px 24px;background:#111b31;color:#ffffff;border-top:5px solid ' + (testing ? '#a78bfa' : '#f59e0b') + '">' +
    '<p style="margin:0 0 14px;font-size:12px;font-weight:700;letter-spacing:1px;color:#cbd5e1">TCGPLAYTEST · ' + (testing ? 'TESTING' : 'PRODUCTION') + '</p>' +
    '<h1 style="margin:0 0 10px;font-size:28px;line-height:1.2">' + escape(title) + '</h1><p style="margin:0;font-size:16px;color:#e2e8f0">' + escape(period) + '</p></td></tr>' +
    (testing ? '<tr><td style="padding:14px 24px;background:#f3e8ff;color:#6b21a8;font-size:14px;line-height:1.5"><strong>Testing data only.</strong> Do not use these figures to assess the live business.</td></tr>' : '') +
    '<tr><td style="padding:20px 24px 4px;font-size:15px;line-height:1.6">' + escape(notice) + '</td></tr>' +
    sections.map(item => '<tr><td style="padding:20px 24px 4px"><h2 style="margin:0 0 8px;font-size:19px">' + escape(item.title) + '</h2>' +
      (item.rows.length ? rowHtml(item.rows) : '') + item.notes.map(note => '<p style="margin:10px 0;font-size:14px;line-height:1.6;color:#475569">' + escape(note) + '</p>').join('') + '</td></tr>').join('') +
    '<tr><td style="padding:28px 24px"><a href="' + escape(url) + '" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 22px;font-size:15px;font-weight:700;border-radius:6px">Open dashboard</a>' +
    '<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#64748b">Choose Growth and operations for the full report and action list.</p></td></tr>' +
    '<tr><td style="padding:18px 24px;background:#e8edf3;font-size:12px;line-height:1.6;color:#475569">' + escape(footer) + '</td></tr></table></td></tr></table></body></html>';
  return {text,html};
}
const sources = {
  stripe:'Stripe payments',paypal:'PayPal payments',storefront:'Order records',prints_ledger:'PRINTS activity',
  reconciliation_evidence:'Payment matching records',exceptions:'The action list',ideas:'Growth ideas',
  journey:'Website activity',attempts:'Checkout tracking',health:'Service monitoring',campaigns:'Feedback campaign settings',
  invitations:'Feedback invitations',claims:'Feedback rewards',pdf_jobs:'Print-file checks',shipping:'Shipping updates',delivery:'Report delivery checks',
};
const reconciliationReasons = {
  provider_refund_not_recorded_on_order:'Refunds need to be matched to their orders',
  paid_timestamp_missing_created_at_fallback:'Orders are missing a confirmed payment date',
  unmatched_provider_movement:'Payments need to be matched to an order',
  paid_order_without_period_cash_match:'Paid orders need a matching payment record',
  wallet_redemption_mismatch:'PRINTS usage needs to be checked',
  feedback_claim_ledger_mismatch:'Feedback rewards need to be checked',
  review_adjustment:'Payment adjustments need review',
};
function groupedReasons(issues) {
  const groups = new Map();
  for (const item of list(issues)) {
    const label = reconciliationReasons[item.reason] || 'Other payment records need review';
    groups.set(label,(groups.get(label) || 0) + 1);
  }
  return [...groups].sort((a,b) => b[1] - a[1]).slice(0,3).map(([label,n]) => [label,count(n)]);
}
function comparisonSection(report) {
  const comparison = report.comparison, previous = report.kind === 'weekly' ? 'previous week' : 'previous day';
  if (!comparison) return section('Compared with the ' + previous, [], ['Comparison unavailable.']);
  const rows = list(comparison.currencies).slice(0,MAX_ROWS).map(c => ['Previous cash after refunds (' + clean(c.currency,3) + ')',emailMoney(c.net_cash_minor,c.currency)]);
  if (comparison.status !== 'matched' || report.financials?.reconciliation?.status !== 'matched') {
    return section('Compared with the ' + previous,rows,['Previous figures are provisional. We cannot reliably show an increase or decrease until both periods pass the data checks.']);
  }
  for (const change of list(comparison.net_cash_change).slice(0,MAX_ROWS)) {
    const percent = Number.isFinite(change.change_percent) ? ' (' + (change.change_percent > 0 ? '+' : '') + change.change_percent.toFixed(1) + '%)' : '';
    rows.push(['Change in cash after refunds (' + clean(change.currency,3) + ')',emailMoney(change.change_minor,change.currency) + percent]);
  }
  return section('Compared with the ' + previous,rows);
}
export function reportEmail(report, options = {}) {
  const f = report.financials || {}, coverage = f.coverage || {}, operations = report.operations || {};
  const partial = f.status !== 'available', issues = list(f.reconciliation?.issues);
  const title = report.kind === 'weekly' ? 'Weekly business review' : 'Daily business summary';
  const period = emailPeriod(f.period) + ' · UTC';
  const sections = [], cash = [];
  for (const c of list(f.currencies).slice(0,MAX_ROWS)) {
    const unit = clean(c.currency,3);
    cash.push(['Money received (' + unit + ')',emailMoney(c.cash_collected_minor,c.currency)],
      ['Refunds (' + unit + ')',emailMoney(c.refunds_minor,c.currency)],
      ['Cash after refunds (' + unit + ')',emailMoney(c.net_cash_minor,c.currency)]);
  }
  sections.push(section('Money at a glance',cash,[
    !cash.length ? (partial ? 'Cash totals are unavailable. Missing data must not be read as zero sales.' : 'No cash activity was recorded in this period.') : '',
    partial && cash.length ? 'These figures cover the available payment sources only; some payment data is missing.' : '',
    'Cash after refunds is before payment fees and other costs. It is not profit.',
  ]));
  const checks = [];
  for (const [key,label] of Object.entries(sources)) {
    const source = coverage[key];
    if (source && source.status !== 'available') checks.push(label + (source.status === 'provisional' ? ': data may still be updating.' : ': data is unavailable and is not included.'));
  }
  if (partial && !checks.length) checks.push('Some payment data is unavailable. Treat these totals as incomplete.');
  const matched = f.reconciliation?.stripe_and_prints?.status === 'matched';
  checks.push(matched ? 'Stripe payments and PRINTS records match. This check does not include PayPal.' :
    'Payment and PRINTS records have not yet been fully matched.');
  sections.push(section('Data checks',groupedReasons(issues),checks));
  const attention = [
    ['Print files need attention',size(operations.pdf_failures),'Review the affected print files before retrying.'],
    ['Shipping updates need review',size(operations.shipping_exceptions),'Check whether the shipping email was received before sending it again.'],
    ['Report emails need review',size(operations.delivery_exceptions),'Confirm the email outcome before resending.'],
    ['Services need checking',size(operations.health_failures),'Ask the technical team to check service status and restore normal operation.'],
    ['Orders older than ' + (Number.isFinite(operations.aged_threshold_hours) ? operations.aged_threshold_hours : 72) + ' hours',size(operations.aged_orders),'Check order progress and whether a customer update is needed.'],
  ];
  const actions = attention.filter(([,n]) => n > 0);
  sections.push(section('What needs attention now',actions.map(([label,n]) => [label,count(n)]),[
    ...actions.map(([label,,next]) => label + ': ' + next),
    !actions.length ? (attention.some(([,n]) => n === null) ? 'Some operational checks are unavailable; a clear status cannot be confirmed.' : 'No issues were found in the available operational checks.') : '',
    attention.some(([,n]) => n === null) && actions.length ? 'Some operational checks are unavailable. Review the data checks above.' : '',
    'Open action-list items: ' + count(size(operations.exceptions)) + '. These can overlap with the counts above. Current status as of the update time.',
  ]));
  const p = f.prints;
  sections.push(section('PRINTS activity',[
    ['Purchased',count(p?.purchased)],['Used on orders',count(p?.redeemed)],
    ['Returned to customers',count(p?.redemption_reversed)],['Awarded for feedback',count(p?.feedback_awarded)],
  ],['Using PRINTS on an order does not create a second cash sale.']));
  sections.push(comparisonSection(report));
  const conversion = report.conversion || {}, stages = conversion.stages || {};
  const verified = conversion.status === 'verified', conversionRows = [
    ['Visits',count(stages.visit)],['Designs started',count(stages.design_start)],
    ['Imports completed',count(stages.import_complete)],['Previews reached',count(stages.preview)],
    ['Checkouts started',count(stages.checkout_start)],['Payments linked to these visits',count(stages.payment_confirmed)],
    ['Visit-to-payment rate',verified && Number.isFinite(conversion.visit_to_paid) ? (conversion.visit_to_paid * 100).toFixed(1) + '%' : 'Not verified'],
  ];
  sections.push(section('Website activity' + (verified ? '' : ' — not yet verified'),conversionRows,[
    'These are tracked sessions, not individual people or total paid orders. PRINTS package purchases are outside this journey.',
    conversion.matured === false ? 'We allow seven days after each visit for a purchase. That waiting period is not yet complete.' : '',
    Number(conversion.unlinked_attempts) > 0 ? count(conversion.unlinked_attempts) + ' checkout attempts are not linked to a visit. The technical team needs to check tracking.' : '',
  ]));
  const growth = report.growth || {};
  sections.push(section('Growth',[
    ['Repeat paid orders',count(growth.repeat_paid_orders)],['Affiliate orders',count(growth.affiliate_orders)],['Partner orders',count(growth.partner_orders)],
    ['Ideas awaiting a decision',Array.isArray(growth.experiments) ? count(growth.experiments.filter(i => i.status === 'pending').length) : 'Unavailable'],
  ],['Repeat orders from guests cannot be confirmed without a linked account.',
    options.aiEnabled === false ? 'Automatic AI suggestions are off.' : 'Review ideas and their recorded outcomes in the dashboard.']));
  if (report.campaigns === null || report.campaigns === undefined) sections.push(section('Feedback campaign',[],['Campaign data is unavailable.']));
  else if (!report.campaigns.length) sections.push(section('Feedback campaign',[],['No feedback campaigns are recorded.']));
  else for (const campaign of report.campaigns.slice(0,3)) {
    const status = campaign.enabled && !campaign.paused ? 'Active' : 'Paused';
    sections.push(section(clean(campaign.name,80) || 'Feedback for 5 PRINTS',[
      ['Status',status],['Invitations',count(campaign.invitations)],['Completed responses',count(campaign.completed)],
      ['PRINTS awarded',count(campaign.prints_awarded)],['Deliveries needing review',count(campaign.failures)],
      ['Invitations skipped',count(campaign.opt_outs)],['Estimated email cost',emailMoney(campaign.email_cost_minor,campaign.currency)],
      ['Repeat orders after feedback',count(campaign.repeat_orders_after_feedback)],
    ],['Campaign totals to date, not just this reporting period.']));
  }
  const movements = list(f.reconciliation?.excluded_movements), totals = new Map();
  for (const m of movements) {
    const label = m.kind === 'payout' ? 'Payouts / transfers to bank' : ['stripe_fee','stripe_fx_fee'].includes(m.kind) ? 'Payment fees' : 'Other balance movements';
    const key = label + ' (' + clean(m.currency,3) + ')', existing = totals.get(key);
    // Retain signs: a withdrawal is negative, a returned amount is positive.
    const amount = Number.isSafeInteger(m.amount_minor) && (!existing || Number.isSafeInteger(existing.amount)) ? (existing?.amount || 0) + m.amount_minor : null;
    totals.set(key,{label:key,currency:m.currency,amount});
  }
  if (totals.size) sections.push(section('Separate account movements',[...totals.values()].slice(0,MAX_ROWS).map(m => [m.label,emailMoney(m.amount,m.currency)]),
    ['These affect the payment account balance and are not new sales or customer refunds. Negative amounts leave the account.']));
  const notice = partial || issues.length ? 'Some figures need review. Start with the money summary, then check the action list below.' :
    'Your business summary is ready. Review the key figures and current action list below.';
  const footer = 'Updated ' + updated(f.fetched_at) + '. Reporting dates use UTC. Full details and the action list are available in the dashboard.';
  return {
    subject:(options.testing ? '[TEST] ' : '') + 'TCGPlaytest ' + (report.kind === 'weekly' ? 'weekly review' : 'daily summary') + ' — ' + emailPeriod(f.period),
    ...renderEmail({title,period,notice,sections,options,footer}),
  };
}
const alertTypes = [
  [/^pdf:/,'Print files need attention','Review the affected print files before retrying.'],
  [/^aged:/,'Orders waiting too long','Check order progress, production capacity and customer updates.'],
  [/^shipping:/,'Shipping emails need review','Check delivery before sending another shipping email.'],
  [/^delivery:/,'Report emails need review','Check delivery before resending a report.'],
  [/^health:/,'Services need checking','Ask the technical team to check and restore the affected service.'],
  [/^refund:/,'Refund records need review','Check the payment provider and order record. Do not issue a second refund.'],
  [/^feedback:/,'Feedback invitations need review','Check campaign limits and delivery before sending again.'],
  [/^generation:/,'AI suggestions need review','Ask the technical team to check the idea-generation service.'],
  [/^source:/,'Monitoring data is unavailable','Ask the technical team to restore the missing data source.'],
];
export function operationsEmail(items, options = {}) {
  const groups = new Map();
  for (const item of list(items)) {
    const key = item.source_key || item.id || '';
    const type = alertTypes.find(([pattern]) => pattern.test(key));
    const label = type?.[1] || 'Other items need review';
    const entry = groups.get(label) || {label,count:0,next:type?.[2] || 'Review these items and their next steps in the dashboard.'};
    entry.count++; groups.set(label,entry);
  }
  const groupsShown = [...groups.values()].sort((a,b) => b.count - a.count).slice(0,MAX_ROWS);
  const sections = [section('Action summary',groupsShown.map(g => [g.label,count(g.count)]),[
    ...groupsShown.map(g => g.label + ': ' + g.next),
    groups.size > MAX_ROWS ? 'More issue categories are listed in the dashboard.' : '',
    'Counts are issues, not unique orders. An order may appear in more than one category.',
  ])];
  const owners = [...new Set(list(items).map(i => clean(i.owner,100) || clean(options.owner,100)).filter(Boolean))];
  sections.push(section('Who should follow up',[],[
    owners.length ? 'Assigned to: ' + owners.slice(0,3).join(', ') + (owners.length > 3 ? ' and other owners listed in the dashboard.' : '.') : 'See the assigned owners in the dashboard.',
    'Open Growth and operations, review each next step, and record the resolution when finished.',
  ]));
  return {
    subject:(options.testing ? '[TEST] ' : '') + 'TCGPlaytest — ' + count(size(items)) + ' operations items need attention',
    ...renderEmail({title:'Operations need attention',period:updated(options.now),options,sections,
      notice:count(size(items)) + ' open issues were found. They are grouped below so you can see what needs attention without reading every order record.',
      footer:'This shows the issues found at the time above. Full order details and action history are available in the dashboard.'}),
  };
}
