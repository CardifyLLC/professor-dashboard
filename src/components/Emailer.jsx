import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { getAdminAuthHeaders, supabase } from '../services/supabaseClient';

/* =========================================================================
   Email Templates — built for physical product (TCG / card printing) blasts
   Variables: {{HEADLINE}} {{SUBHEADLINE}} {{BODY}} {{CTA_TEXT}} {{CTA_URL}}
              {{IMAGE_URL}} {{COUPON_CODE}}
   ========================================================================= */
const TEMPLATES = [
  {
    id: 'blank',
    name: '— No template (plain text) —',
    defaults: null,
    html: null,
  },
  {
    id: 'product-launch',
    name: '🎴 Product Launch',
    defaults: {
      HEADLINE: 'Your Custom Cards Are Here',
      SUBHEADLINE: 'Premium finishes. Fast turnaround. Shipped to your door.',
      BODY: 'We\'ve just unlocked a new lineup of premium finishes — Rainbow Foil, Piano Gloss, and Spot Silver. Whether you\'re prototyping your own TCG or bringing a dream deck to life, we\'ve got you covered.',
      CTA_TEXT: 'Start Designing',
      CTA_URL: 'https://tcgplaytest.com',
      IMAGE_URL: '',
      COUPON_CODE: '',
    },
    html: `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; background: #ffffff;">
  {{IMAGE_BLOCK}}
  <div style="padding: 32px 24px;">
    <h1 style="color: #1e40af; font-size: 28px; margin: 0 0 8px 0;">{{HEADLINE}}</h1>
    <p style="color: #6b7280; font-size: 16px; margin: 0 0 24px 0;">{{SUBHEADLINE}}</p>
    <p style="font-size: 15px; margin: 0 0 24px 0;">{{BODY}}</p>
    {{COUPON_BLOCK}}
    <p style="text-align: center; margin: 32px 0;">
      <a href="{{CTA_URL}}" style="background-color: #1e40af; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">{{CTA_TEXT}}</a>
    </p>
    <p style="font-size: 14px; color: #6b7280;">Questions? Just reply to this email — we read every message.</p>
    <p style="font-size: 14px; color: #6b7280;">— The TCGPlaytest Team</p>
  </div>
  <hr style="margin: 0; border: none; border-top: 1px solid #e5e7eb;" />
  <p style="font-size: 12px; color: #9ca3af; padding: 16px 24px; text-align: center;">© TCGPlaytest · <a href="https://tcgplaytest.com" style="color: #9ca3af;">tcgplaytest.com</a></p>
</div>`.trim(),
  },
  {
    id: 'promo-coupon',
    name: '🎟 Promo / Coupon Blast',
    defaults: {
      HEADLINE: 'A Gift For You 🎁',
      SUBHEADLINE: 'Limited time offer — use your code at checkout',
      BODY: 'Thanks for being part of the TCGPlaytest community. Here\'s a token of appreciation — use the code below on your next order for an exclusive discount.',
      CTA_TEXT: 'Redeem Now',
      CTA_URL: 'https://tcgplaytest.com',
      IMAGE_URL: '',
      COUPON_CODE: 'PLAY-XXXX-XXXX',
    },
    html: `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; background: #ffffff;">
  {{IMAGE_BLOCK}}
  <div style="padding: 32px 24px; text-align: center;">
    <h1 style="color: #dc2626; font-size: 32px; margin: 0 0 8px 0;">{{HEADLINE}}</h1>
    <p style="color: #6b7280; font-size: 16px; margin: 0 0 24px 0;">{{SUBHEADLINE}}</p>
    <p style="font-size: 15px; text-align: left; margin: 0 0 24px 0;">{{BODY}}</p>
    <div style="background: #fef3c7; border: 2px dashed #f59e0b; border-radius: 10px; padding: 20px; margin: 24px 0;">
      <p style="font-size: 12px; color: #92400e; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px 0;">Your Code</p>
      <p style="font-family: 'Courier New', monospace; font-size: 24px; font-weight: bold; color: #92400e; letter-spacing: 0.15em; margin: 0;">{{COUPON_CODE}}</p>
    </div>
    <p style="margin: 32px 0;">
      <a href="{{CTA_URL}}" style="background-color: #dc2626; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">{{CTA_TEXT}}</a>
    </p>
  </div>
  <hr style="margin: 0; border: none; border-top: 1px solid #e5e7eb;" />
  <p style="font-size: 12px; color: #9ca3af; padding: 16px 24px; text-align: center;">© TCGPlaytest · <a href="https://tcgplaytest.com" style="color: #9ca3af;">tcgplaytest.com</a></p>
</div>`.trim(),
  },
  {
    id: 'newsletter',
    name: '📰 Newsletter / Weekly Update',
    defaults: {
      HEADLINE: 'What\'s New at TCGPlaytest',
      SUBHEADLINE: 'Your weekly roundup',
      BODY: 'Here\'s everything that\'s happening this week — new finishes, community spotlights, and tips from the print room. Read on and keep designing!',
      CTA_TEXT: 'View Latest Designs',
      CTA_URL: 'https://tcgplaytest.com',
      IMAGE_URL: '',
      COUPON_CODE: '',
    },
    html: `
<div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.7; color: #1f2937; max-width: 600px; margin: 0 auto; background: #fafaf9;">
  <div style="background: #1e40af; padding: 24px; text-align: center;">
    <h1 style="color: #ffffff; font-size: 24px; margin: 0; letter-spacing: 0.05em;">TCGPLAYTEST</h1>
  </div>
  {{IMAGE_BLOCK}}
  <div style="padding: 32px 24px; background: #ffffff;">
    <h2 style="color: #111827; font-size: 24px; margin: 0 0 4px 0; font-weight: 700;">{{HEADLINE}}</h2>
    <p style="color: #6b7280; font-size: 14px; font-style: italic; margin: 0 0 24px 0;">{{SUBHEADLINE}}</p>
    <p style="font-size: 16px; margin: 0 0 24px 0;">{{BODY}}</p>
    {{COUPON_BLOCK}}
    <p style="margin: 32px 0;">
      <a href="{{CTA_URL}}" style="color: #1e40af; text-decoration: underline; font-weight: bold; font-size: 16px;">{{CTA_TEXT}} →</a>
    </p>
  </div>
  <p style="font-size: 12px; color: #9ca3af; padding: 16px 24px; text-align: center; background: #f9fafb;">You're receiving this because you signed up at tcgplaytest.com</p>
</div>`.trim(),
  },
];

const renderTemplate = (tpl, vars) => {
  if (!tpl.html) return '';
  let html = tpl.html;

  const imageBlock = vars.IMAGE_URL
    ? `<img src="${vars.IMAGE_URL}" alt="" style="width: 100%; height: auto; display: block;" />`
    : '';
  const couponBlock = vars.COUPON_CODE
    ? `<div style="background: #fef3c7; border: 2px dashed #f59e0b; border-radius: 10px; padding: 16px; margin: 20px 0; text-align: center;"><p style="font-size: 12px; color: #92400e; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 6px 0;">Use Code</p><p style="font-family: 'Courier New', monospace; font-size: 20px; font-weight: bold; color: #92400e; letter-spacing: 0.15em; margin: 0;">${vars.COUPON_CODE}</p></div>`
    : '';

  html = html.replace(/\{\{IMAGE_BLOCK\}\}/g, imageBlock);
  html = html.replace(/\{\{COUPON_BLOCK\}\}/g, couponBlock);

  Object.entries(vars).forEach(([key, val]) => {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val || '');
  });

  return html;
};

const Emailer = () => {
  const [emails, setEmails] = useState([]);
  const [emailInput, setEmailInput] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [exportingEmails, setExportingEmails] = useState(false);
  const [exportError, setExportError] = useState('');

  // Template state
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank');
  const [vars, setVars] = useState({});
  const [showPreview, setShowPreview] = useState(false);

  // Coupon generator
  const [generatingCoupon, setGeneratingCoupon] = useState(false);
  const [couponCode, setCouponCode] = useState(null);
  const [couponError, setCouponError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');

  const selectedTemplate = TEMPLATES.find(t => t.id === selectedTemplateId);
  const usingTemplate = selectedTemplate && selectedTemplate.html;

  const handleTemplateChange = (id) => {
    setSelectedTemplateId(id);
    const tpl = TEMPLATES.find(t => t.id === id);
    if (tpl?.defaults) {
      setVars(tpl.defaults);
    } else {
      setVars({});
    }
  };

  const renderedHtml = useMemo(() => {
    if (!usingTemplate) return '';
    return renderTemplate(selectedTemplate, vars);
  }, [selectedTemplate, vars, usingTemplate]);

  const finalBody = usingTemplate ? renderedHtml : body;

  const handleGenerateCoupon = async (overrideExpiresAt = null, noExpiry = false) => {
    setGeneratingCoupon(true);
    setCouponCode(null);
    setCouponError(null);
    try {
      const payload = {
        prefix: 'PLAY',
        count: 1,
        createdBy: 'professor-dashboard',
        note: 'Generated from Professor Dashboard',
      };
      const effectiveExpiry = noExpiry
        ? null
        : overrideExpiresAt || (expiresAt ? new Date(expiresAt).toISOString() : null);
      if (effectiveExpiry) payload.expiresAt = effectiveExpiry;
      if (overrideExpiresAt || noExpiry) setExpiresAt('');

      const authHeaders = await getAdminAuthHeaders();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-coupon`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate coupon');
      setCouponCode(data.code);
    } catch (err) {
      setCouponError(err.message);
    } finally {
      setGeneratingCoupon(false);
    }
  };

  const handleGenerate30DayCoupon = () => {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    handleGenerateCoupon(thirtyDaysFromNow.toISOString());
  };

  const handleGenerateNoExpiryCoupon = () => {
    handleGenerateCoupon(null, true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(couponCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUseCouponInTemplate = () => {
    if (couponCode) setVars(v => ({ ...v, COUPON_CODE: couponCode }));
  };

  const addEmails = () => {
    const raw = emailInput.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.includes('@'));
    const unique = [...new Set([...emails, ...raw])];
    setEmails(unique);
    setEmailInput('');
  };

  const removeEmail = (email) => setEmails(emails.filter(e => e !== email));

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = new Uint8Array(ev.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      let allText = '';
      workbook.SheetNames.forEach(name => {
        const sheet = workbook.Sheets[name];
        allText += XLSX.utils.sheet_to_csv(sheet) + '\n';
      });
      const found = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      const unique = [...new Set([...emails, ...found])];
      setEmails(unique);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const fetchAllRows = async (table, columns, configure = query => query) => {
    const pageSize = 1000;
    const rows = [];
    let from = 0;
    while (true) {
      const query = configure(supabase.from(table).select(columns).range(from, from + pageSize - 1));
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  };

  const handleDownloadAllEmails = async () => {
    setExportingEmails(true);
    setExportError('');
    try {
      const [profiles, orders, subscribers] = await Promise.all([
        fetchAllRows('profiles', 'id,email,full_name,created_at'),
        fetchAllRows('orders', 'id,user_id,customer_email,customer_name,created_at'),
        fetchAllRows('marketing_subscribers', 'email,full_name,status,created_at', query => query.eq('status', 'subscribed')),
      ]);

      let archivedOrders = [];
      try {
        archivedOrders = await fetchAllRows('deleted_orders_archive', 'order_id,customer_email,order_created_at');
      } catch {
        archivedOrders = [];
      }

      const people = new Map();
      const normalizeEmail = value => String(value || '').trim().toLowerCase();
      const ensurePerson = (email, name = '') => {
        const normalized = normalizeEmail(email);
        if (!normalized || !normalized.includes('@')) return null;
        if (!people.has(normalized)) {
          people.set(normalized, {
            email: normalized, name: String(name || '').trim(), sources: new Set(),
            hasProfile: false, hasOrder: false, hasGuestOrder: false, isSubscriber: false,
          });
        }
        const person = people.get(normalized);
        if (!person.name && name) person.name = String(name).trim();
        return person;
      };

      const profileEmails = new Map();
      profiles.forEach(profile => {
        const person = ensurePerson(profile.email, profile.full_name);
        if (!person) return;
        person.hasProfile = true;
        profileEmails.set(normalizeEmail(profile.email), person);
      });

      [...orders, ...archivedOrders].forEach(order => {
        const email = normalizeEmail(order.customer_email);
        const person = ensurePerson(email, order.customer_name);
        if (!person) return;
        person.hasOrder = true;
        if (!order.user_id && !profileEmails.has(email)) person.hasGuestOrder = true;
      });

      subscribers.forEach(subscriber => {
        const person = ensurePerson(subscriber.email, subscriber.full_name);
        if (!person) return;
        person.isSubscriber = true;
      });

      people.forEach(person => {
        if (person.hasProfile && person.hasOrder) person.sources.add('Profile + Ordered');
        if (person.hasProfile && !person.hasOrder) person.sources.add('Profile + No Order');
        if (person.hasGuestOrder) person.sources.add('Guest Order');
        if (person.isSubscriber) person.sources.add('Subscriber');
      });

      const rows = [...people.values()].filter(person => person.sources.size > 0)
        .sort((a, b) => a.email.localeCompare(b.email)).map(person => ({
          Email: person.email,
          Name: person.name,
          Sources: [...person.sources].join(', '),
          'Has Profile': person.hasProfile ? 'Yes' : 'No',
          'Has Ordered': person.hasOrder ? 'Yes' : 'No',
          'Guest Order': person.hasGuestOrder ? 'Yes' : 'No',
          'Active Subscriber': person.isSubscriber ? 'Yes' : 'No',
        }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `all-customer-emails-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setExportError(error.message || 'Unable to download all emails.');
    } finally {
      setExportingEmails(false);
    }
  };

  const handleSend = async () => {
    const toSend = finalBody;
    if (!emails.length || !subject.trim() || !toSend.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const authHeaders = await getAdminAuthHeaders();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-bulk-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({ emails, subject, body: toSend, isHtml: Boolean(usingTemplate) }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setResult({
        type: 'success',
        message: `Sent to ${data.sent} recipient${data.sent !== 1 ? 's' : ''} as ${data.format === 'html' ? 'HTML' : 'plain text'}.${data.failed > 0 ? ` ${data.failed} failed${data.firstError ? `: ${data.firstError}` : '.'}` : ''}`,
      });
      setEmails([]);
      setSubject('');
      setBody('');
    } catch (err) {
      setResult({ type: 'error', message: err.message });
    } finally {
      setSending(false);
    }
  };

  const canSend = emails.length > 0 && subject.trim() && finalBody.trim() && !sending;

  const inputStyle = {
    width: '100%',
    padding: '9px 12px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const labelStyle = { fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '5px' };

  return (
    <div>
      <h1 className="page-title">Email Blast</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'start' }}>

        {/* Left — Recipients */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>
            Recipients <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>({emails.length})</span>
          </h2>

          <textarea
            value={emailInput}
            onChange={e => setEmailInput(e.target.value)}
            placeholder="Paste emails here — one per line, or comma/semicolon separated"
            rows={4}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={addEmails}
              disabled={!emailInput.trim()}
              style={{
                padding: '8px 18px',
                background: emailInput.trim() ? 'var(--accent-primary)' : 'var(--bg-hover)',
                color: emailInput.trim() ? '#fff' : 'var(--text-muted)',
                border: 'none', borderRadius: '8px',
                cursor: emailInput.trim() ? 'pointer' : 'not-allowed',
                fontSize: '0.875rem', fontWeight: '600',
              }}
            >Add</button>

            <label style={{
              padding: '8px 18px', background: 'var(--bg-hover)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer',
              fontSize: '0.875rem', fontWeight: '600', whiteSpace: 'nowrap',
            }}>
              Upload CSV / Excel
              <input type="file" accept=".csv,.xlsx,.xls,.txt" onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>

            <button
              type="button"
              onClick={handleDownloadAllEmails}
              disabled={exportingEmails}
              style={{
                padding: '8px 18px',
                background: exportingEmails ? 'var(--bg-hover)' : '#10b981',
                color: exportingEmails ? 'var(--text-muted)' : '#fff',
                border: 'none', borderRadius: '8px',
                cursor: exportingEmails ? 'wait' : 'pointer',
                fontSize: '0.875rem', fontWeight: '600', whiteSpace: 'nowrap',
              }}
              title="Download unique emails from profiles, orders, guest orders, and active subscribers"
            >
              {exportingEmails ? 'Preparing All Emails…' : '⬇ Download All Emails'}
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            Supports .csv, .xlsx, .xls, .txt — emails extracted automatically
          </p>

          {exportError && (
            <p style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: '8px' }}>{exportError}</p>
          )}

          {emails.length > 0 && (
            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '260px', overflowY: 'auto' }}>
              {emails.map(email => (
                <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--bg-hover)', borderRadius: '6px' }}>
                  <span style={{ fontSize: '0.825rem', color: 'var(--text-primary)' }}>{email}</span>
                  <button onClick={() => removeEmail(email)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          )}
          {emails.length > 0 && (
            <button onClick={() => setEmails([])} style={{ marginTop: '10px', background: 'none', border: 'none', color: '#ef4444', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}>
              Clear all
            </button>
          )}
        </div>

        {/* Right — Compose */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Compose</h2>

          {/* Template selector */}
          <div>
            <label style={labelStyle}>Template</label>
            <select
              value={selectedTemplateId}
              onChange={e => handleTemplateChange(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {TEMPLATES.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Subject</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject line" style={inputStyle} />
          </div>

          {usingTemplate ? (
            <>
              {/* Template variables */}
              <div>
                <label style={labelStyle}>Headline</label>
                <input type="text" value={vars.HEADLINE || ''} onChange={e => setVars(v => ({ ...v, HEADLINE: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Subheadline</label>
                <input type="text" value={vars.SUBHEADLINE || ''} onChange={e => setVars(v => ({ ...v, SUBHEADLINE: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Body Text</label>
                <textarea value={vars.BODY || ''} onChange={e => setVars(v => ({ ...v, BODY: e.target.value }))} rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={labelStyle}>Button Text</label>
                  <input type="text" value={vars.CTA_TEXT || ''} onChange={e => setVars(v => ({ ...v, CTA_TEXT: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Button Link</label>
                  <input type="url" value={vars.CTA_URL || ''} onChange={e => setVars(v => ({ ...v, CTA_URL: e.target.value }))} placeholder="https://..." style={inputStyle} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Hero Image URL <span style={{ textTransform: 'none', color: 'var(--text-muted)' }}>(optional — top of email)</span></label>
                <input type="url" value={vars.IMAGE_URL || ''} onChange={e => setVars(v => ({ ...v, IMAGE_URL: e.target.value }))} placeholder="https://example.com/hero.jpg" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Coupon Code <span style={{ textTransform: 'none', color: 'var(--text-muted)' }}>(optional)</span></label>
                <input type="text" value={vars.COUPON_CODE || ''} onChange={e => setVars(v => ({ ...v, COUPON_CODE: e.target.value }))} placeholder="PLAY-XXXX-XXXX" style={inputStyle} />
              </div>

              <button
                onClick={() => setShowPreview(v => !v)}
                style={{ padding: '8px', background: 'var(--bg-hover)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}
              >
                {showPreview ? '✕ Hide preview' : '👁 Show preview'}
              </button>
            </>
          ) : (
            <div>
              <label style={labelStyle}>Message</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write your email here..." rows={10} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          )}

          {result && (
            <div style={{
              padding: '12px 16px', borderRadius: '8px',
              background: result.type === 'success' ? '#10b98120' : '#ef444420',
              border: `1px solid ${result.type === 'success' ? '#10b981' : '#ef4444'}`,
              color: result.type === 'success' ? '#10b981' : '#ef4444',
              fontSize: '0.875rem',
            }}>
              {result.message}
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{
              padding: '12px',
              background: canSend ? 'var(--accent-primary)' : 'var(--bg-hover)',
              color: canSend ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: '8px',
              cursor: canSend ? 'pointer' : 'not-allowed',
              fontSize: '0.9rem', fontWeight: '600',
            }}
          >
            {sending ? 'Sending...' : `Send to ${emails.length} recipient${emails.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* Preview */}
      {usingTemplate && showPreview && (
        <div style={{ marginTop: '24px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '16px' }}>Live Preview</h2>
          <div style={{ background: '#f3f4f6', padding: '24px', borderRadius: '8px' }}>
            <iframe
              title="Email Preview"
              srcDoc={renderedHtml}
              style={{ width: '100%', height: '700px', border: 'none', background: '#fff', borderRadius: '6px' }}
            />
          </div>
        </div>
      )}

      {/* Coupon Generator */}
      <div style={{ marginTop: '24px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>Coupon Generator</h2>
        <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', marginBottom: '16px' }}>Generate a new PLAY-XXXX-XXXX coupon code instantly.</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div>
            <label style={labelStyle}>Expiry Date &amp; Time <span style={{ textTransform: 'none', color: 'var(--text-muted)' }}>(optional)</span></label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              style={{ ...inputStyle, width: 'auto', colorScheme: 'dark' }}
            />
            {expiresAt && (
              <button onClick={() => setExpiresAt('')} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#ef4444', fontSize: '0.8rem', cursor: 'pointer' }}>Clear</button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleGenerateCoupon()}
            disabled={generatingCoupon}
            style={{
              padding: '10px 24px',
              background: generatingCoupon ? 'var(--bg-hover)' : 'var(--accent-primary)',
              color: generatingCoupon ? 'var(--text-muted)' : '#fff',
              border: 'none', borderRadius: '8px',
              cursor: generatingCoupon ? 'not-allowed' : 'pointer',
              fontWeight: '600', fontSize: '0.9rem',
            }}
            title="Generate a coupon using the expiry date above (or no expiry if blank)"
          >
            {generatingCoupon ? 'Generating...' : '🎟 Generate Coupon (Custom Expiry)'}
          </button>

          <button
            onClick={handleGenerate30DayCoupon}
            disabled={generatingCoupon}
            style={{
              padding: '10px 24px',
              background: generatingCoupon ? 'var(--bg-hover)' : '#10b981',
              color: generatingCoupon ? 'var(--text-muted)' : '#fff',
              border: 'none', borderRadius: '8px',
              cursor: generatingCoupon ? 'not-allowed' : 'pointer',
              fontWeight: '600', fontSize: '0.9rem',
            }}
            title="Generate a coupon that expires exactly 30 days from now"
          >
            {generatingCoupon ? 'Generating...' : '📅 Generate 30-Day Coupon'}
          </button>

          <button
            onClick={handleGenerateNoExpiryCoupon}
            disabled={generatingCoupon}
            style={{
              padding: '10px 24px',
              background: generatingCoupon ? 'var(--bg-hover)' : '#8b5cf6',
              color: generatingCoupon ? 'var(--text-muted)' : '#fff',
              border: 'none', borderRadius: '8px',
              cursor: generatingCoupon ? 'not-allowed' : 'pointer',
              fontWeight: '600', fontSize: '0.9rem',
            }}
            title="Generate a one-time-use coupon that never expires"
          >
            {generatingCoupon ? 'Generating...' : '♾ Generate One-Time Coupon (No Expiry)'}
          </button>

          {couponCode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                padding: '10px 20px', background: 'var(--bg-secondary)',
                border: '2px dashed var(--accent-primary)', borderRadius: '8px',
                fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: '700',
                color: 'var(--accent-primary)', letterSpacing: '0.1em',
              }}>
                {couponCode}
              </div>
              <button onClick={handleCopy} style={{
                padding: '10px 16px',
                background: copied ? '#10b981' : 'var(--bg-hover)',
                color: copied ? '#fff' : 'var(--text-primary)',
                border: '1px solid var(--border-color)', borderRadius: '8px',
                cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem',
              }}>
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
              {usingTemplate && (
                <button onClick={handleUseCouponInTemplate} style={{
                  padding: '10px 16px', background: 'var(--bg-hover)',
                  color: 'var(--text-primary)', border: '1px solid var(--border-color)',
                  borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem',
                }}>
                  ⬆ Use in template
                </button>
              )}
            </div>
          )}

          {couponError && <span style={{ color: '#ef4444', fontSize: '0.875rem' }}>{couponError}</span>}
        </div>
      </div>
    </div>
  );
};

export default Emailer;
