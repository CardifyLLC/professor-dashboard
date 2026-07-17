import React, { useState, useEffect, useMemo } from 'react';
import { getAdminAuthHeaders, supabase } from '../services/supabaseClient';
import { ORDER_REJECTION_TEMPLATES } from '../constants/rejectionTemplates';

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt$ = (cents) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
const fmtNum = (n) => new Intl.NumberFormat('en-US').format(n || 0);
const fmtPct = (n, d) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '—');
const fmtDate = (str) => {
    if (!str) return '—';
    const d = new Date(str);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const REJECTION_LABEL = Object.fromEntries(
    ORDER_REJECTION_TEMPLATES.map((t) => [t.key, t.label])
);

const DATE_RANGES = [
    { label: '7 days', days: 7 },
    { label: '30 days', days: 30 },
    { label: '90 days', days: 90 },
    { label: 'All time', days: null },
];

const FUNNEL_STEPS = ['import', 'customize', 'preview', 'checkout', 'completed'];
const ORDER_FUNNEL_STEPS = ['checkout_opened', 'payment_initiated', 'payment_completed'];
const FUNNEL_STEP_LABEL = {
    checkout_opened: 'Checkout Opened',
    payment_initiated: 'Payment Initiated',
    payment_completed: 'Payment Completed',
    checkout_abandoned: 'Abandoned',
};

const STATUS_COLOR = {
    completed: '#22c55e', shipped: '#3b82f6', processing: '#8b5cf6',
    paid: '#06b6d4', pending: '#f59e0b', cancelled: '#ef4444',
};

// ── Sub-components ────────────────────────────────────────────────────────────

const StatCard = ({ label, value, sub, color, small }) => (
    <div className="stat-card" style={small ? { padding: '0.9rem 1rem' } : undefined}>
        <div className="stat-label" style={small ? { fontSize: '0.75rem' } : undefined}>{label}</div>
        <div className="stat-value" style={{ color: color || 'var(--text-primary)', fontSize: small ? '1.3rem' : undefined }}>{value}</div>
        {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
);

const SectionCard = ({ title, children, style }) => (
    <div className="detail-section" style={style}>
        <h3 style={{ marginBottom: '1rem', fontSize: '0.95rem', fontWeight: '600' }}>{title}</h3>
        {children}
    </div>
);

const HBar = ({ label, value, total, color = 'var(--accent-primary)', suffix }) => {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-primary)' }}>{label}</span>
                <span style={{ color: 'var(--text-muted)' }}>
                    {suffix || fmtNum(value)} <span style={{ opacity: 0.5 }}>({pct}%)</span>
                </span>
            </div>
            <div style={{ height: '7px', background: 'var(--bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '999px', transition: 'width 0.4s ease' }} />
            </div>
        </div>
    );
};

const VBarChart = ({ data, valueKey, color = 'var(--accent-primary)', formatVal }) => {
    const max = Math.max(...data.map((d) => d[valueKey] || 0), 1);
    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '72px' }}>
            {data.map((d, i) => {
                const h = Math.max(2, Math.round(((d[valueKey] || 0) / max) * 72));
                return (
                    <div key={i} title={`${d.label}: ${formatVal ? formatVal(d[valueKey]) : fmtNum(d[valueKey])}`}
                        style={{ flex: 1, height: `${h}px`, background: color, borderRadius: '2px 2px 0 0', opacity: 0.8, cursor: 'default', transition: 'opacity 0.15s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                    />
                );
            })}
        </div>
    );
};

const FunnelStep = ({ label, count, prevCount, color = 'var(--accent-primary)' }) => {
    const rate = prevCount > 0 ? ((count / prevCount) * 100).toFixed(0) : null;
    return (
        <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '0.65rem', marginBottom: '0.4rem' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: '700', color }}>{fmtNum(count)}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</div>
            </div>
            {rate !== null && (
                <div style={{ fontSize: '0.72rem', color: Number(rate) >= 50 ? '#22c55e' : '#f59e0b' }}>
                    {rate}% conv.
                </div>
            )}
        </div>
    );
};

const Empty = ({ text = 'No data for this period.' }) => (
    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>{text}</p>
);

const Pill = ({ text, color }) => (
    <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '0.72rem',
        fontWeight: '600', background: color + '22', color, border: `1px solid ${color}44`,
    }}>{text}</span>
);

// ── Main ──────────────────────────────────────────────────────────────────────

const Analytics = ({ orders }) => {
    const [rangeDays, setRangeDays] = useState(30);
    const [designFunnel, setDesignFunnel] = useState([]);
    const [orderFunnel, setOrderFunnel] = useState([]);
    const [features, setFeatures] = useState([]);
    const [nps, setNps] = useState([]);
    const [errorSummary, setErrorSummary] = useState([]);
    const [recentEvents, setRecentEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [aiModel, setAiModel] = useState('claude');
    const [aiInsight, setAiInsight] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');
    const [showKeyInput, setShowKeyInput] = useState(false);
    const [apiKeys, setApiKeys] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('ai_api_keys') || '{}');
        } catch { return {}; }
    });
    const [keyDraft, setKeyDraft] = useState('');

    // ── Fetch analytics tables ────────────────────────────────────────────────
    useEffect(() => {
        const fetchAll = async () => {
            setLoading(true);
            const cutoff = rangeDays
                ? new Date(Date.now() - rangeDays * 86400000).toISOString()
                : null;

            const q = (table, col = 'day') =>
                cutoff
                    ? supabase.from(table).select('*').gte(col, cutoff).order(col, { ascending: false })
                    : supabase.from(table).select('*').order(col, { ascending: false });

            const [df, of, ft, np, er, ev] = await Promise.all([
                q('v_design_funnel_summary'),
                q('v_order_funnel_summary'),
                q('v_feature_adoption', 'week'),
                q('v_nps_summary', 'week'),
                q('v_error_summary'),
                cutoff
                    ? supabase.from('analytics_events').select('*').gte('created_at', cutoff).order('created_at', { ascending: false }).limit(25)
                    : supabase.from('analytics_events').select('*').order('created_at', { ascending: false }).limit(25),
            ]);

            setDesignFunnel(df.data || []);
            setOrderFunnel(of.data || []);
            setFeatures(ft.data || []);
            setNps(np.data || []);
            setErrorSummary(er.data || []);
            setRecentEvents(ev.data || []);
            setLoading(false);
        };

        fetchAll();
    }, [rangeDays]);

    // ── Order metrics from prop ───────────────────────────────────────────────
    const filtered = useMemo(() => {
        if (!rangeDays) return orders;
        const cutoff = new Date(Date.now() - rangeDays * 86400000);
        return orders.filter((o) => new Date(o.created_at) >= cutoff);
    }, [orders, rangeDays]);

    const om = useMemo(() => {
        const total = filtered.length;
        const completed = filtered.filter((o) => ['completed', 'shipped'].includes(String(o.status).toLowerCase())).length;
        const inProgress = filtered.filter((o) => ['processing', 'paid'].includes(String(o.status).toLowerCase())).length;
        const pending = filtered.filter((o) => String(o.status).toLowerCase() === 'pending').length;
        const cancelled = filtered.filter((o) => String(o.status).toLowerCase() === 'cancelled').length;
        const refunded = filtered.filter((o) => String(o.payment_status).toLowerCase() === 'refunded').length;
        const gross = filtered.reduce((s, o) => s + (o.total_amount_cents || 0), 0);
        const refundedCents = filtered.filter((o) => String(o.payment_status).toLowerCase() === 'refunded').reduce((s, o) => s + (o.total_amount_cents || 0), 0);
        const net = gross - refundedCents;
        const totalCards = filtered.reduce((s, o) => s + (o.quantity || 0), 0);
        const avgCents = total > 0 ? Math.round(gross / total) : 0;
        const uniqueCustomers = new Set(filtered.map((o) => o.customer_email).filter(Boolean)).size;
        const statusCounts = {};
        filtered.forEach((o) => { const s = String(o.status || 'unknown').toLowerCase(); statusCounts[s] = (statusCounts[s] || 0) + 1; });
        const rejectionCounts = {};
        filtered.filter((o) => o.refund_reason_key).forEach((o) => { rejectionCounts[o.refund_reason_key] = (rejectionCounts[o.refund_reason_key] || 0) + 1; });
        return { total, completed, inProgress, pending, cancelled, refunded, gross, refundedCents, net, totalCards, avgCents, uniqueCustomers, statusCounts, rejectionCounts };
    }, [filtered]);

    // ── Daily chart data ──────────────────────────────────────────────────────
    const dailyData = useMemo(() => {
        const days = Math.min(rangeDays || 30, 30);
        const buckets = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            buckets.push({ label: key.slice(5), date: key, orders: 0, revenue: 0 });
        }
        const map = Object.fromEntries(buckets.map((b) => [b.date, b]));
        filtered.forEach((o) => {
            const key = (o.created_at || '').slice(0, 10);
            if (map[key]) { map[key].orders += 1; map[key].revenue += o.total_amount_cents || 0; }
        });
        return buckets;
    }, [filtered, rangeDays]);

    // ── Design funnel aggregation ─────────────────────────────────────────────
    const designFunnelAgg = useMemo(() => {
        const entered = {};
        const completed = {};
        designFunnel.forEach((row) => {
            if (row.action === 'entered') entered[row.step] = (entered[row.step] || 0) + Number(row.unique_sessions || 0);
            if (row.action === 'completed') completed[row.step] = (completed[row.step] || 0) + Number(row.unique_sessions || 0);
        });
        return FUNNEL_STEPS.map((step) => ({ step, entered: entered[step] || 0, completed: completed[step] || 0 }));
    }, [designFunnel]);

    // ── Order funnel aggregation ──────────────────────────────────────────────
    const orderFunnelAgg = useMemo(() => {
        const counts = {};
        orderFunnel.forEach((row) => { counts[row.event] = (counts[row.event] || 0) + Number(row.event_count || 0); });
        return ORDER_FUNNEL_STEPS.map((e) => ({ event: e, count: counts[e] || 0 }));
    }, [orderFunnel]);

    // ── Top features ──────────────────────────────────────────────────────────
    const topFeatures = useMemo(() => {
        const agg = {};
        features.forEach((r) => {
            if (!agg[r.feature]) agg[r.feature] = { usage: 0, sessions: 0 };
            agg[r.feature].usage += Number(r.usage_count || 0);
            agg[r.feature].sessions += Number(r.unique_sessions || 0);
        });
        return Object.entries(agg).sort((a, b) => b[1].usage - a[1].usage).slice(0, 8);
    }, [features]);
    const maxFeatureUsage = topFeatures[0]?.[1].usage || 1;

    // ── NPS latest ───────────────────────────────────────────────────────────
    const latestNps = nps[0] || null;

    // ── Error agg ─────────────────────────────────────────────────────────────
    const errorAgg = useMemo(() => {
        const agg = {};
        errorSummary.forEach((r) => {
            if (!agg[r.error_type]) agg[r.error_type] = { count: 0, sessions: 0 };
            agg[r.error_type].count += Number(r.occurrences || 0);
            agg[r.error_type].sessions += Number(r.affected_sessions || 0);
        });
        return Object.entries(agg).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
    }, [errorSummary]);
    const maxErrors = errorAgg[0]?.[1].count || 1;

    // ── NPS color ─────────────────────────────────────────────────────────────
    const npsColor = (score) => score >= 50 ? '#22c55e' : score >= 0 ? '#f59e0b' : '#ef4444';

    // ── AI Insights ───────────────────────────────────────────────────────────
    const generateInsights = async () => {
        setAiLoading(true);
        setAiError('');
        setAiInsight('');

        const analyticsData = {
            period: rangeDays ? `Last ${rangeDays} days` : 'All time',
            orders: {
                total: om.total,
                completed: om.completed,
                inProgress: om.inProgress,
                pending: om.pending,
                cancelled: om.cancelled,
                refunded: om.refunded,
                refundRate: `${fmtPct(om.refunded, om.total)}`,
                grossRevenue: fmt$(om.gross),
                refundedAmount: fmt$(om.refundedCents),
                netRevenue: fmt$(om.net),
                avgOrderValue: fmt$(om.avgCents),
                totalCards: om.totalCards,
                uniqueCustomers: om.uniqueCustomers,
                statusBreakdown: om.statusCounts,
                rejectionReasons: om.rejectionCounts,
            },
            designFunnel: designFunnelAgg,
            checkoutFunnel: orderFunnelAgg,
            topFeatures: topFeatures.map(([feature, stats]) => ({ feature, ...stats })),
            nps: latestNps,
            topErrors: errorAgg.map(([type, stats]) => ({ type, ...stats })),
        };

        try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

            const authHeaders = await getAdminAuthHeaders();
            const res = await fetch(`${supabaseUrl}/functions/v1/ai-insights`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders,
                },
                body: JSON.stringify({ model: aiModel, analyticsData, apiKey: apiKeys[aiModel] || undefined }),
            });

            const payload = await res.json();
            if (!res.ok) throw new Error(payload?.error || `Request failed with ${res.status}`);
            setAiInsight(payload.result || '');
        } catch (err) {
            setAiError(err.message || 'Failed to generate insights.');
        } finally {
            setAiLoading(false);
        }
    };

    const AI_MODELS = [
        { id: 'claude', label: 'Claude', version: '4.6', color: '#f97316' },
        { id: 'openai', label: 'GPT', version: '5.4', color: '#22c55e' },
        { id: 'gemini', label: 'Gemini', version: '3.1 Pro', color: '#3b82f6' },
    ];

    const saveKey = () => {
        const trimmed = keyDraft.trim();
        if (!trimmed) return;
        const updated = { ...apiKeys, [aiModel]: trimmed };
        setApiKeys(updated);
        localStorage.setItem('ai_api_keys', JSON.stringify(updated));
        setKeyDraft('');
        setShowKeyInput(false);
    };

    const removeKey = (modelId) => {
        const updated = { ...apiKeys };
        delete updated[modelId];
        setApiKeys(updated);
        localStorage.setItem('ai_api_keys', JSON.stringify(updated));
    };

    return (
        <div>
            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                <h1 className="page-title" style={{ margin: 0 }}>Analytics</h1>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {DATE_RANGES.map(({ label, days }) => (
                        <button key={label} onClick={() => setRangeDays(days)} style={{
                            padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--border-color)',
                            background: rangeDays === days ? 'var(--accent-primary)' : 'var(--bg-card)',
                            color: rangeDays === days ? '#fff' : 'var(--text-muted)',
                            fontSize: '0.82rem', cursor: 'pointer', fontWeight: rangeDays === days ? '600' : '400',
                        }}>{label}</button>
                    ))}
                </div>
            </div>

            {/* ── Order summary cards ── */}
            <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
                <StatCard label="Total Orders" value={fmtNum(om.total)} />
                <StatCard label="Completed" value={fmtNum(om.completed)} color="#22c55e" />
                <StatCard label="In Progress" value={fmtNum(om.inProgress)} color="#8b5cf6" />
                <StatCard label="Pending" value={fmtNum(om.pending)} color="#f59e0b" />
                <StatCard label="Cancelled" value={fmtNum(om.cancelled)} color="#ef4444" />
                <StatCard label="Refunded" value={fmtNum(om.refunded)} sub={fmtPct(om.refunded, om.total) + ' of orders'} color="#ef4444" />
                <StatCard label="Gross Revenue" value={fmt$(om.gross)} />
                <StatCard label="Refunded Amount" value={fmt$(om.refundedCents)} color="#ef4444" />
                <StatCard label="Net Revenue" value={fmt$(om.net)} color="#22c55e" />
                <StatCard label="Avg Order Value" value={fmt$(om.avgCents)} />
                <StatCard label="Total Cards" value={fmtNum(om.totalCards)} />
                <StatCard label="Unique Customers" value={fmtNum(om.uniqueCustomers)} />
            </div>

            {/* ── Charts row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
                <SectionCard title={`Orders — last ${Math.min(rangeDays || 30, 30)} days`}>
                    <VBarChart data={dailyData} valueKey="orders" color="var(--accent-primary)" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        <span>{dailyData[0]?.label}</span><span>{dailyData[dailyData.length - 1]?.label}</span>
                    </div>
                </SectionCard>
                <SectionCard title={`Revenue — last ${Math.min(rangeDays || 30, 30)} days`}>
                    <VBarChart data={dailyData} valueKey="revenue" color="#22c55e" formatVal={fmt$} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        <span>{dailyData[0]?.label}</span><span>{dailyData[dailyData.length - 1]?.label}</span>
                    </div>
                </SectionCard>

                {/* Order status breakdown */}
                <SectionCard title="Orders by Status">
                    {Object.keys(om.statusCounts).length === 0 ? <Empty /> :
                        Object.entries(om.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                            <HBar key={status} label={status.charAt(0).toUpperCase() + status.slice(1)}
                                value={count} total={om.total} color={STATUS_COLOR[status] || 'var(--accent-primary)'} />
                        ))}
                </SectionCard>

                {/* Rejection reasons */}
                <SectionCard title="Rejection Reasons">
                    {Object.keys(om.rejectionCounts).length === 0 ? <Empty text="No rejections in this period." /> : (() => {
                        const entries = Object.entries(om.rejectionCounts).sort((a, b) => b[1] - a[1]);
                        const total = entries.reduce((s, [, n]) => s + n, 0);
                        return (<>
                            {entries.map(([key, count]) => (
                                <HBar key={key} label={REJECTION_LABEL[key] || key} value={count} total={total} color="#ef4444" />
                            ))}
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{total} total rejection{total !== 1 ? 's' : ''}</p>
                        </>);
                    })()}
                </SectionCard>
            </div>

            {/* ── Design Funnel ── */}
            <SectionCard title="Design Funnel — Sessions by Step" style={{ marginBottom: '1.25rem' }}>
                {loading ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</p> :
                    designFunnelAgg.every((s) => s.entered === 0) ? <Empty /> : (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', overflowX: 'auto' }}>
                            {designFunnelAgg.map((s, i) => (
                                <React.Fragment key={s.step}>
                                    <FunnelStep
                                        label={s.step.charAt(0).toUpperCase() + s.step.slice(1)}
                                        count={s.entered}
                                        prevCount={i > 0 ? designFunnelAgg[i - 1].entered : null}
                                        color="var(--accent-primary)"
                                    />
                                    {i < designFunnelAgg.length - 1 && (
                                        <div style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: '1rem', marginTop: '-1rem' }}>→</div>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    )}
            </SectionCard>

            {/* ── Order Funnel + NPS + Errors row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>

                {/* Order funnel */}
                <SectionCard title="Checkout Funnel">
                    {loading ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</p> :
                        orderFunnelAgg.every((s) => s.count === 0) ? <Empty /> : (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                {orderFunnelAgg.map((s, i) => (
                                    <React.Fragment key={s.event}>
                                        <FunnelStep
                                            label={FUNNEL_STEP_LABEL[s.event] || s.event}
                                            count={s.count}
                                            prevCount={i > 0 ? orderFunnelAgg[i - 1].count : null}
                                            color="#3b82f6"
                                        />
                                        {i < orderFunnelAgg.length - 1 && (
                                            <div style={{ alignSelf: 'center', color: 'var(--text-muted)', fontSize: '1rem', marginTop: '-1rem' }}>→</div>
                                        )}
                                    </React.Fragment>
                                ))}
                            </div>
                        )}
                    {/* Abandoned */}
                    {!loading && (() => {
                        const abandoned = (orderFunnel || []).filter((r) => r.event === 'checkout_abandoned').reduce((s, r) => s + Number(r.unique_sessions || 0), 0);
                        const opened = orderFunnelAgg[0]?.count || 0;
                        if (!abandoned) return null;
                        return (
                            <div style={{ marginTop: '1rem', padding: '0.6rem 0.8rem', borderRadius: '0.5rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                                <span style={{ fontSize: '0.82rem', color: '#ef4444' }}>
                                    {fmtNum(abandoned)} abandoned ({fmtPct(abandoned, opened)} of opened)
                                </span>
                            </div>
                        );
                    })()}
                </SectionCard>

                {/* NPS */}
                <SectionCard title="Customer Satisfaction (NPS)">
                    {loading ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</p> :
                        !latestNps ? <Empty text="No NPS data yet." /> : (
                            <>
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1.5rem', marginBottom: '1rem' }}>
                                    <div>
                                        <div style={{ fontSize: '2.5rem', fontWeight: '800', color: npsColor(Number(latestNps.nps_score)) }}>
                                            {latestNps.nps_score > 0 ? '+' : ''}{latestNps.nps_score}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>NPS Score</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                                            {Number(latestNps.avg_score).toFixed(1)}<span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/10</span>
                                        </div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Avg Score</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '1.2rem', fontWeight: '600', color: 'var(--text-primary)' }}>{fmtNum(latestNps.responses)}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Responses</div>
                                    </div>
                                </div>
                                {nps.length > 1 && (
                                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.4rem' }}>Weekly trend</div>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            {nps.slice(0, 6).reverse().map((w, i) => (
                                                <div key={i} style={{ fontSize: '0.72rem', textAlign: 'center' }}>
                                                    <div style={{ fontWeight: '700', color: npsColor(Number(w.nps_score)) }}>
                                                        {w.nps_score > 0 ? '+' : ''}{w.nps_score}
                                                    </div>
                                                    <div style={{ color: 'var(--text-muted)' }}>{new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                </SectionCard>

                {/* Errors */}
                <SectionCard title="Error Summary">
                    {loading ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</p> :
                        errorAgg.length === 0 ? <Empty text="No errors logged." /> :
                            errorAgg.map(([type, { count, sessions }]) => (
                                <HBar key={type}
                                    label={type.replace(/_/g, ' ')}
                                    value={count}
                                    total={maxErrors}
                                    color="#ef4444"
                                    suffix={`${fmtNum(count)} (${fmtNum(sessions)} sessions)`}
                                />
                            ))}
                </SectionCard>
            </div>

            {/* ── Feature Usage ── */}
            <SectionCard title="Feature Adoption" style={{ marginBottom: '1.25rem' }}>
                {loading ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</p> :
                    topFeatures.length === 0 ? <Empty /> : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0 2rem' }}>
                            {topFeatures.map(([feature, { usage, sessions }]) => (
                                <HBar key={feature}
                                    label={feature.replace(/_/g, ' ')}
                                    value={usage}
                                    total={maxFeatureUsage}
                                    color="#8b5cf6"
                                    suffix={`${fmtNum(usage)} uses (${fmtNum(sessions)} sessions)`}
                                />
                            ))}
                        </div>
                    )}
            </SectionCard>

            {/* ── AI Insights ── */}
            <SectionCard title="AI Insights" style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    {/* Model selector */}
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                        {AI_MODELS.map((m) => (
                            <button key={m.id} onClick={() => setAiModel(m.id)} style={{
                                padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: aiModel === m.id ? '700' : '500',
                                border: `1px solid ${aiModel === m.id ? m.color : 'var(--border-color)'}`,
                                background: aiModel === m.id ? m.color + '22' : 'var(--bg-secondary)',
                                color: aiModel === m.id ? m.color : 'var(--text-muted)',
                                transition: 'all 0.15s',
                            }}>
                                {m.label} <span style={{ opacity: 0.7, fontSize: '0.72rem' }}>v{m.version}</span>
                            </button>
                        ))}
                    </div>
                    {/* Key indicator + manage button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {apiKeys[aiModel] ? (
                            <span style={{ fontSize: '0.75rem', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                ● Key saved
                            </span>
                        ) : (
                            <span style={{ fontSize: '0.75rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                ○ No key
                            </span>
                        )}
                        <button onClick={() => { setShowKeyInput(!showKeyInput); setKeyDraft(''); }} style={{
                            padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-color)',
                            background: 'var(--bg-secondary)', color: 'var(--text-muted)',
                            fontSize: '0.75rem', cursor: 'pointer',
                        }}>
                            {showKeyInput ? 'Cancel' : '⚙ API Key'}
                        </button>
                        {apiKeys[aiModel] && !showKeyInput && (
                            <button onClick={() => removeKey(aiModel)} style={{
                                padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.3)',
                                background: 'transparent', color: '#ef4444', fontSize: '0.75rem', cursor: 'pointer',
                            }}>Remove</button>
                        )}
                    </div>

                    {/* Generate button */}
                    <button onClick={generateInsights} disabled={aiLoading} style={{
                        padding: '6px 20px', borderRadius: '8px', border: 'none', cursor: aiLoading ? 'not-allowed' : 'pointer',
                        background: aiLoading ? 'var(--bg-secondary)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                        color: aiLoading ? 'var(--text-muted)' : '#fff', fontSize: '0.85rem', fontWeight: '700',
                        boxShadow: aiLoading ? 'none' : '0 8px 16px -8px rgba(99,102,241,0.8)',
                        transition: 'all 0.15s',
                    }}>
                        {aiLoading ? '⏳ Analyzing...' : '✦ Generate Insights'}
                    </button>
                    {aiInsight && !aiLoading && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Generated by {AI_MODELS.find(m => m.id === aiModel)?.label} {AI_MODELS.find(m => m.id === aiModel)?.version}
                        </span>
                    )}
                </div>

                {/* API Key input */}
                {showKeyInput && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderRadius: '0.65rem', border: '1px solid var(--border-color)', marginBottom: '0.75rem' }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                                {AI_MODELS.find(m => m.id === aiModel)?.label} API Key
                                <span style={{ opacity: 0.6, marginLeft: '0.4rem' }}>— saved in browser only, never sent to our servers</span>
                            </div>
                            <input
                                type="password"
                                value={keyDraft}
                                onChange={(e) => setKeyDraft(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                                placeholder={`Paste your ${AI_MODELS.find(m => m.id === aiModel)?.label} API key...`}
                                style={{
                                    width: '100%', padding: '8px 12px', borderRadius: '6px',
                                    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
                                    color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
                                }}
                            />
                        </div>
                        <button onClick={saveKey} disabled={!keyDraft.trim()} style={{
                            padding: '8px 16px', borderRadius: '6px', border: 'none',
                            background: keyDraft.trim() ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                            color: keyDraft.trim() ? '#fff' : 'var(--text-muted)',
                            fontSize: '0.85rem', fontWeight: '600', cursor: keyDraft.trim() ? 'pointer' : 'not-allowed',
                            whiteSpace: 'nowrap', marginTop: '1.25rem',
                        }}>Save Key</button>
                    </div>
                )}

                {/* Error */}
                {aiError && (
                    <div style={{ padding: '0.75rem 1rem', borderRadius: '0.65rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                        {aiError}
                    </div>
                )}

                {/* Loading skeleton */}
                {aiLoading && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {[100, 85, 90, 70, 95].map((w, i) => (
                            <div key={i} style={{ height: '14px', width: `${w}%`, borderRadius: '6px', background: 'var(--bg-secondary)', animation: 'pulse 1.5s ease-in-out infinite', opacity: 0.6 }} />
                        ))}
                    </div>
                )}

                {/* Result */}
                {aiInsight && !aiLoading && (
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: '0.75rem', padding: '1.25rem', border: '1px solid var(--border-color)', lineHeight: '1.7', fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                        {aiInsight.split('\n').map((line, i) => {
                            if (line.startsWith('## ')) return <h3 key={i} style={{ fontSize: '0.95rem', fontWeight: '700', margin: '1rem 0 0.4rem', color: 'var(--text-primary)' }}>{line.replace('## ', '')}</h3>;
                            if (line.startsWith('- ') || line.startsWith('• ')) return <div key={i} style={{ paddingLeft: '1rem', marginBottom: '0.25rem' }}>• {line.replace(/^[-•] /, '')}</div>;
                            if (line.trim() === '') return <div key={i} style={{ height: '0.4rem' }} />;
                            return <div key={i} style={{ marginBottom: '0.2rem' }}>{line}</div>;
                        })}
                    </div>
                )}

                {!aiInsight && !aiLoading && !aiError && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Select a model and click <strong>Generate Insights</strong> to get an AI-powered analysis of your analytics data.
                    </p>
                )}
            </SectionCard>

            {/* ── Recent Events ── */}
            <SectionCard title="Recent Events">
                {loading ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</p> :
                    recentEvents.length === 0 ? <Empty text="No events recorded yet." /> : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        {['Event', 'Category', 'Page', 'Session', 'Time'].map((h) => (
                                            <th key={h} style={{ padding: '0.4rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', whiteSpace: 'nowrap' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {recentEvents.map((e) => (
                                        <tr key={e.id} style={{ borderBottom: '1px solid var(--border-color)', opacity: 0.9 }}>
                                            <td style={{ padding: '0.5rem 0.75rem', fontWeight: '600', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{e.event_name}</td>
                                            <td style={{ padding: '0.5rem 0.75rem' }}>
                                                <Pill text={e.event_category} color={
                                                    e.event_category === 'error' ? '#ef4444' :
                                                    e.event_category === 'order_funnel' ? '#3b82f6' :
                                                    e.event_category === 'feature_usage' ? '#8b5cf6' :
                                                    e.event_category === 'design_journey' ? '#06b6d4' : '#6b7280'
                                                } />
                                            </td>
                                            <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.page_path || '—'}</td>
                                            <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.72rem' }}>{e.session_id ? e.session_id.slice(0, 8) + '…' : '—'}</td>
                                            <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(e.created_at)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
            </SectionCard>
        </div>
    );
};

export default Analytics;
