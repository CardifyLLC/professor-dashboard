import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ShoppingBag, Users, WalletCards } from 'lucide-react';
import { fetchAffiliateOrders } from '../services/orderService';
import './AffiliateOrders.css';

const money = (cents = 0) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format(Number(cents || 0) / 100);
const date = (value) => new Date(value).toLocaleString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export default function AffiliateOrders({ onSelectOrder }) {
  const [orders, setOrders] = useState([]);
  const [affiliateCode, setAffiliateCode] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setOrders(await fetchAffiliateOrders()); }
    catch (loadError) { setError(loadError.message || 'Could not load affiliate orders.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const affiliates = useMemo(() => {
    const byCode = new Map();
    orders.forEach((order) => {
      const current = byCode.get(order.affiliateCode) || {
        code: order.affiliateCode,
        name: order.affiliate.name || order.affiliate.email || order.affiliateCode,
        orders: 0, revenue: 0,
      };
      current.orders += 1;
      current.revenue += Number(order.total_amount_cents || 0);
      byCode.set(order.affiliateCode, current);
    });
    return [...byCode.values()].sort((a, b) => b.orders - a.orders);
  }, [orders]);

  const visibleOrders = affiliateCode === 'all' ? orders : orders.filter((order) => order.affiliateCode === affiliateCode);
  const revenue = visibleOrders.reduce((sum, order) => sum + Number(order.total_amount_cents || 0), 0);

  return (
    <section className="affiliate-orders-page">
      <div className="affiliate-orders-heading">
        <div><h1 className="page-title">Affiliate Orders</h1><p>Orders received through an approved affiliate link or code.</p></div>
        <button type="button" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh</button>
      </div>
      <div className="affiliate-order-stats">
        <div><ShoppingBag size={19} /><span><strong>{visibleOrders.length}</strong>Attributed orders</span></div>
        <div><WalletCards size={19} /><span><strong>{money(revenue)}</strong>Attributed revenue</span></div>
        <div><Users size={19} /><span><strong>{affiliates.length}</strong>Affiliates with orders</span></div>
      </div>
      <div className="affiliate-orders-filter">
        <label htmlFor="affiliate-order-partner">Affiliate</label>
        <select id="affiliate-order-partner" value={affiliateCode} onChange={(event) => setAffiliateCode(event.target.value)}>
          <option value="all">All affiliates</option>
          {affiliates.map((affiliate) => (
            <option value={affiliate.code} key={affiliate.code}>{affiliate.name} ({affiliate.code}) — {affiliate.orders} order{affiliate.orders === 1 ? '' : 's'}</option>
          ))}
        </select>
      </div>
      {error && <div className="affiliate-orders-message error">Could not load affiliate orders: {error}</div>}
      {loading && <div className="affiliate-orders-message">Loading affiliate orders...</div>}
      {!loading && !error && visibleOrders.length === 0 && <div className="affiliate-orders-message">No orders have been attributed to an approved affiliate yet.</div>}
      {!loading && !error && visibleOrders.length > 0 && (
        <div className="data-table-container affiliate-orders-table">
          <table className="data-table">
            <thead><tr><th>Order</th><th>Affiliate</th><th>Customer</th><th>Date</th><th>Status</th><th>Total</th></tr></thead>
            <tbody>{visibleOrders.map((order) => (
              <tr key={order.id} onClick={() => onSelectOrder(order)}>
                <td>#{order.id.slice(0, 8)}</td>
                <td><strong>{order.affiliate.name || order.affiliate.email}</strong><span>{order.affiliateCode}</span></td>
                <td><strong>{order.customer_name || 'Guest'}</strong><span>{order.customer_email}</span></td>
                <td>{date(order.created_at)}</td>
                <td><span className={`status-badge status-${String(order.status || '').toLowerCase()}`}>{order.status}</span></td>
                <td>{money(order.total_amount_cents)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
