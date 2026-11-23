export function acquisitionCsv(rows) {
  const columns = ['account_id','email','full_name','signup_at','acq_first_source','acq_first_medium','acq_first_campaign','acq_first_content','acq_first_term','acq_first_at','acq_last_source','acq_last_medium','acq_last_campaign','acq_last_content','acq_last_term','acq_last_at','acq_rdt_cid','acq_landing_path','acq_referrer','acquisition_recorded_at','paid_order_count','gross_paid_usd_cents','other_currency_paid_order_count','first_order_at','last_order_at','repeat_customer'];
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  return '\ufeff' + [columns.map(cell).join(','), ...rows.map(row => columns.map(column => cell(row[column])).join(','))].join('\r\n');
}
