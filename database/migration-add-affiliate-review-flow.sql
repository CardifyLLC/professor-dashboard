-- Run once after the existing affiliate_applications table has been created.
alter table public.affiliate_applications
  add column if not exists reviewed_at timestamptz,
  add column if not exists decision_message text,
  add column if not exists requested_affiliate_code text,
  add column if not exists affiliate_code text,
  add column if not exists affiliate_link text,
  add column if not exists decision_email_status text,
  add column if not exists decision_email_sent_at timestamptz,
  add column if not exists decision_email_message_id text,
  add column if not exists decision_email_error text;

comment on column public.affiliate_applications.decision_message is
  'Message displayed to the applicant after the application is reviewed.';

comment on column public.affiliate_applications.affiliate_link is
  'Unique referral link generated when the application is approved.';

create unique index if not exists affiliate_applications_affiliate_code_unique
  on public.affiliate_applications (affiliate_code)
  where affiliate_code is not null;

create unique index if not exists affiliate_applications_affiliate_code_upper_unique
  on public.affiliate_applications (upper(affiliate_code))
  where affiliate_code is not null;

create unique index if not exists affiliate_applications_active_requested_code_unique
  on public.affiliate_applications (upper(requested_affiliate_code))
  where requested_affiliate_code is not null
    and status in ('pending', 'reviewing', 'approved');

comment on column public.affiliate_applications.requested_affiliate_code is
  'Optional unique affiliate code requested by the applicant and reserved during review.';

create index if not exists affiliate_applications_status_created_idx
  on public.affiliate_applications (status, created_at desc);

comment on column public.affiliate_applications.status is
  'Review state: pending, reviewing, approved, or declined.';

-- The service-role Edge Function can read and update this RLS-enabled table.
-- No public SELECT or UPDATE policy is added, so applications remain private.
