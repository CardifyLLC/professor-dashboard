export const ORDER_REJECTION_TEMPLATES = [
  {
    key: 'bleed_settings',
    label: 'Bleed Settings',
    subject: 'Action needed: fix bleed settings and reorder',
    bodyPreview:
      'Refunds the Stripe payment and emails the customer with the bleed settings tutorial before asking them to reorder.',
  },
  {
    key: 'official_backs',
    label: 'Official Backs',
    subject: 'Order rejected: official backs not allowed',
    bodyPreview:
      'Refunds the Stripe payment and emails the customer explaining that official backs are not permitted.',
  },
  {
    key: 'payment_issue',
    label: 'Payment Issue',
    subject: 'Question about your recent order',
    bodyPreview:
      'Emails the customer to check in about a payment that did not fully process.',
  },
  {
    key: 'corner_defects',
    label: 'Corner Defects',
    subject: 'Action needed: corner defects found — please reorder',
    bodyPreview:
      'Refunds the Stripe payment and emails the customer with the corner defect tutorial before asking them to reorder.',
  },
];

export const getRejectionTemplate = (templateKey) =>
  ORDER_REJECTION_TEMPLATES.find((template) => template.key === templateKey) ?? null;
