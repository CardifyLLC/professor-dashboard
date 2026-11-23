import React, { useState } from 'react';
import { getAdminAuthHeaders } from '../services/supabaseClient';
import { acquisitionCsv } from '../services/acquisitionCsv.mjs';

export default function AcquisitionExport() {
    const [filters, setFilters] = useState({ source: '', campaign: '', content: '' });
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const download = async () => {
        setBusy(true); setMessage('Preparing the report…');
        try {
            const headers = await getAdminAuthHeaders();
            const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value.trim()).map(([key, value]) => [key, value.trim()]));
            const rows = []; let cursor = null;
            do {
                if (cursor) { params.set('before', cursor.before); params.set('before_id', cursor.before_id); }
                const response = await fetch(`/api/ad-attribution?${params}`, { headers, cache: 'no-store' });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not load the report.');
                rows.push(...result.rows); cursor = result.next;
                if (cursor && rows.length >= 100000) throw new Error('Report too large. Narrow the campaign filters and try again.');
            } while (cursor);
            const blob = new Blob([acquisitionCsv(rows)], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url; link.download = 'account-ad-attribution.csv'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            const buyers = rows.filter(row => Number(row.paid_order_count) > 0).length;
            const repeat = rows.filter(row => row.repeat_customer === true).length;
            setMessage(`Exported ${rows.length} accounts. ${buyers} buyers; repeat buyers: ${buyers ? (100 * repeat / buyers).toFixed(1) : '0'}%.`);
        } catch (error) { setMessage(error.message || 'Export failed. No partial report was downloaded.'); }
        finally { setBusy(false); }
    };
    return <section style={{ marginBottom: 20 }} aria-label="Ad attribution export">
        <h2 style={{ fontSize: '1.05rem', marginBottom: 8 }}>Account acquisition</h2>
        <p style={{ fontSize: '.85rem', marginBottom: 10 }}>Filter by the first ad visit. Blank fields include all accounts. Use source “organic” for unattributed accounts; this also includes older accounts and customers who declined tracking.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
            {Object.keys(filters).map(key => <label key={key} style={{ display: 'grid', gap: 4, textTransform: 'capitalize' }}>{key}
                <input style={{ padding: '8px 10px', color: 'var(--text-primary)', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 6 }} aria-label={`First-touch ${key}`} maxLength={100} value={filters[key]} disabled={busy} onChange={event => setFilters({ ...filters, [key]: event.target.value })} />
            </label>)}
            <button style={{ padding: '8px 12px', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: busy ? 'wait' : 'pointer' }} type="button" disabled={busy} onClick={download}>{busy ? 'Exporting…' : 'Export accounts CSV'}</button>
        </div>
        <p role="status" style={{ fontSize: '.85rem', marginTop: 10 }}>{message}</p>
    </section>;
}
