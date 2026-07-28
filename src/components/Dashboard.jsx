import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { fetchOrders, fetchAllOrders, fetchOrderById, fetchOrdersForExport, updateOrderStatus } from '../services/orderService';
import { supabase } from '../services/supabaseClient';
import OrderList from './OrderList';
import OrderDetail from './OrderDetail';
import Customers from './Customers';
import Analytics from './Analytics';
import CardBatcherPro from './BatcherPRO';
import Profiles from './Profiles';
import Emailer from './Emailer';
import Subscribers from './Subscribers';
import DeletedOrdersStats from './DeletedOrdersStats';
import OrdersMap from './OrdersMap';
import AffiliateRequests from './AffiliateRequests';
import AffiliateOrders from './AffiliateOrders';

const Dashboard = () => {
    const [orders, setOrders] = useState([]);
    const [allOrders, setAllOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingAll, setLoadingAll] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeView, setActiveView] = useState('orders');
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [statusFilter, setStatusFilter] = useState('all');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [downloading, setDownloading] = useState(false);
    const pageSize = 20;
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showChangePassword, setShowChangePassword] = useState(false);
    const [pwForm, setPwForm] = useState({ newPassword: '', confirm: '' });
    const [pwStatus, setPwStatus] = useState({ loading: false, error: '', success: '' });

    const handleSignOut = async () => {
        await supabase.auth.signOut();
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (pwForm.newPassword !== pwForm.confirm) {
            setPwStatus({ loading: false, error: 'Passwords do not match.', success: '' });
            return;
        }
        if (pwForm.newPassword.length < 6) {
            setPwStatus({ loading: false, error: 'Password must be at least 6 characters.', success: '' });
            return;
        }
        setPwStatus({ loading: true, error: '', success: '' });
        const { error } = await supabase.auth.updateUser({ password: pwForm.newPassword });
        if (error) {
            setPwStatus({ loading: false, error: error.message, success: '' });
        } else {
            setPwStatus({ loading: false, error: '', success: 'Password updated successfully!' });
            setPwForm({ newPassword: '', confirm: '' });
            setTimeout(() => setShowChangePassword(false), 1500);
        }
    };

    const loadOrders = useCallback(async () => {
        setLoading(true);
        try {
            const { data, count } = await fetchOrders(page, pageSize, searchTerm, statusFilter, dateFrom, dateTo);
            setOrders(data);
            setTotalCount(count);
        } catch (error) {
            console.error('Failed to load orders', error);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, searchTerm, statusFilter, dateFrom, dateTo]);

    const loadAllOrders = useCallback(async () => {
        setLoadingAll(true);
        try {
            const data = await fetchAllOrders();
            setAllOrders(data);
        } catch (error) {
            console.error('Failed to load all orders', error);
        } finally {
            setLoadingAll(false);
        }
    }, []);

    useEffect(() => {
        loadOrders();
    }, [loadOrders]);

    useEffect(() => {
        if ((activeView === 'customers' || activeView === 'analytics' || activeView === 'map') && allOrders.length === 0 && !loadingAll) {
            loadAllOrders();
        }
    }, [activeView, allOrders.length, loadingAll, loadAllOrders]);

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
        setPage(1); // Reset to first page on search
    };

    const handleStatusFilterChange = (nextStatus) => {
        setStatusFilter(nextStatus);
        setPage(1);
    };

    const handleDownloadEmails = async () => {
        setDownloading(true);
        try {
            const data = await fetchOrdersForExport(searchTerm, statusFilter, dateFrom, dateTo);
            const rows = [...new Set(data.map(o => o.customer_email).filter(Boolean))]
                .map(email => ({ Email: email }));
            const ws = XLSX.utils.json_to_sheet(rows);
            ws['!cols'] = [{ wch: 40 }];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Orders');
            const label = [
                dateFrom && `from-${dateFrom}`,
                dateTo && `to-${dateTo}`,
            ].filter(Boolean).join('_') || new Date().toISOString().slice(0, 10);
            XLSX.writeFile(wb, `orders-${label}.xlsx`);
        } catch (err) {
            console.error('Download failed', err);
        } finally {
            setDownloading(false);
        }
    };

    const handleBulkStatusChange = async (orderIds, newStatus) => {
        if (!orderIds.length) return;
        try {
            await Promise.all(orderIds.map(id => updateOrderStatus(id, newStatus)));
            await loadOrders();
        } catch (error) {
            console.error('Bulk status update failed', error);
            alert(`Failed to update some orders: ${error.message || error}`);
        }
    };

    const handleSelectOrder = async (order) => {
        try {
            // Fetch full order details including card_images and card_data
            const fullOrder = await fetchOrderById(order.id);
            setSelectedOrder(fullOrder);
        } catch (error) {
            console.error('Failed to load order details:', error);
            // Fallback to the order from the list if fetch fails
            setSelectedOrder(order);
        }
    };

    const handleOrderUpdated = async (updatedOrder) => {
        setSelectedOrder(updatedOrder);

        setOrders((currentOrders) =>
            currentOrders.map((currentOrder) =>
                currentOrder.id === updatedOrder.id ? { ...currentOrder, ...updatedOrder } : currentOrder
            )
        );

        setAllOrders((currentOrders) =>
            currentOrders.map((currentOrder) =>
                currentOrder.id === updatedOrder.id ? { ...currentOrder, ...updatedOrder } : currentOrder
            )
        );

        if (activeView === 'orders') {
            await loadOrders();
        }
    };

    return (
        <div className="dashboard-container">
            {activeView === 'batcher' ? (
                <CardBatcherPro showSidebar={false} onBackToDashboard={() => setActiveView('orders')} />
            ) : (
                <>
                    <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
                        <div className="logo">
                            <img src="/logo.png" alt="TCGPlaytest Logo" style={{ width: '32px', height: '32px' }} />
                            TCGPlaytest
                        </div>

                        <nav>
                            <div className="nav-section-title" style={{
                                color: 'var(--text-muted)',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em',
                                marginBottom: '0.5rem',
                                paddingLeft: '1rem'
                            }}>
                                Menu
                            </div>
                            <div
                                className={`nav-item ${activeView === 'orders' ? 'active' : ''}`}
                                onClick={() => { setActiveView('orders'); setMobileMenuOpen(false); }}
                            >
                                <span>📦</span> Orders
                            </div>
                            <div
                                className={`nav-item ${activeView === 'customers' ? 'active' : ''}`}
                                onClick={() => { setActiveView('customers'); setMobileMenuOpen(false); }}
                            >
                                <span>👥</span> Customers
                            </div>
                            <div
                                className={`nav-item ${activeView === 'profiles' ? 'active' : ''}`}
                                onClick={() => { setActiveView('profiles'); setMobileMenuOpen(false); }}
                            >
                                <span>🪪</span> Profiles
                            </div>
                            <div
                                className={`nav-item ${activeView === 'emailer' ? 'active' : ''}`}
                                onClick={() => { setActiveView('emailer'); setMobileMenuOpen(false); }}
                            >
                                <span>✉️</span> Email Blast
                            </div>
                            <div
                                className={`nav-item ${activeView === 'subscribers' ? 'active' : ''}`}
                                onClick={() => { setActiveView('subscribers'); setMobileMenuOpen(false); }}
                            >
                                <span>📬</span> Subscribers
                            </div>
                            <div
                                className={`nav-item ${activeView === 'affiliates' ? 'active' : ''}`}
                                onClick={() => { setActiveView('affiliates'); setMobileMenuOpen(false); }}
                            >
                                <span>🤝</span> Affiliate Requests
                            </div>
                            <div
                                className={`nav-item ${activeView === 'affiliate-orders' ? 'active' : ''}`}
                                onClick={() => { setActiveView('affiliate-orders'); setMobileMenuOpen(false); }}
                            >
                                <span>🔗</span> Affiliate Orders
                            </div>
                            <div
                                className={`nav-item ${activeView === 'analytics' ? 'active' : ''}`}
                                onClick={() => { setActiveView('analytics'); setMobileMenuOpen(false); }}
                            >
                                <span>📊</span> Analytics
                            </div>
                            <div
                                className={`nav-item ${activeView === 'map' ? 'active' : ''}`}
                                onClick={() => { setActiveView('map'); setMobileMenuOpen(false); }}
                            >
                                <span>Map</span> Order Map
                            </div>
                            <div
                                className={`nav-item ${activeView === 'deleted-stats' ? 'active' : ''}`}
                                onClick={() => { setActiveView('deleted-stats'); setMobileMenuOpen(false); }}
                            >
                                <span>🗑️</span> Deleted Orders
                            </div>

                        </nav>

                        <div className="sidebar-apps">
                            <div className="nav-section-title" style={{
                                color: 'var(--text-muted)',
                                fontSize: '0.75rem',
                                fontWeight: 'bold',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em',
                                marginBottom: '0.5rem',
                                marginTop: '1.5rem',
                                paddingLeft: '1rem'
                            }}>
                                Apps
                            </div>
                            <div
                                className={`nav-item ${activeView === 'batcher' ? 'active' : ''}`}
                                onClick={() => { setActiveView('batcher'); setMobileMenuOpen(false); }}
                            >
                                <span>🎴</span> Batcher PRO
                            </div>
                        </div>
                    </aside>

                    {mobileMenuOpen && (
                        <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
                    )}

                    <main className="main-content">
                        <header className="header">
                            <button
                                className="mobile-menu-btn"
                                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            >
                                ☰
                            </button>
                            <input
                                type="text"
                                className="search-bar"
                                placeholder="Search orders..."
                                value={searchTerm}
                                onChange={handleSearch}
                            />
                            <div className="user-profile" style={{ position: 'relative' }}>
                                <div
                                    className="avatar"
                                    onClick={() => setShowUserMenu(v => !v)}
                                    style={{ cursor: 'pointer', userSelect: 'none' }}
                                >
                                    Admin
                                </div>
                                {showUserMenu && (
                                    <>
                                        <div
                                            onClick={() => setShowUserMenu(false)}
                                            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                                        />
                                        <div style={{
                                            position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                                            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                                            borderRadius: '10px', padding: '6px', minWidth: '180px',
                                            boxShadow: '0 8px 24px rgba(0,0,0,0.3)', zIndex: 100,
                                        }}>
                                            <button
                                                onClick={() => { setShowUserMenu(false); setShowChangePassword(true); setPwStatus({ loading: false, error: '', success: '' }); }}
                                                style={{
                                                    display: 'block', width: '100%', textAlign: 'left',
                                                    padding: '10px 14px', background: 'none', border: 'none',
                                                    color: 'var(--text-primary)', fontSize: '0.875rem',
                                                    borderRadius: '7px', cursor: 'pointer',
                                                }}
                                                onMouseOver={e => e.target.style.background = 'var(--bg-hover)'}
                                                onMouseOut={e => e.target.style.background = 'none'}
                                            >
                                                🔑 Change Password
                                            </button>
                                            <button
                                                onClick={handleSignOut}
                                                style={{
                                                    display: 'block', width: '100%', textAlign: 'left',
                                                    padding: '10px 14px', background: 'none', border: 'none',
                                                    color: '#ef4444', fontSize: '0.875rem',
                                                    borderRadius: '7px', cursor: 'pointer',
                                                }}
                                                onMouseOver={e => e.target.style.background = 'var(--bg-hover)'}
                                                onMouseOut={e => e.target.style.background = 'none'}
                                            >
                                                ↩ Sign Out
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </header>

                        <div className="content-area">
                            {loading ? (
                                <div className="loading">Loading orders...</div>
                            ) : (
                                <>
                                    {activeView === 'orders' && (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '8px' }}>
                                                <h1 className="page-title" style={{ margin: 0 }}>Orders</h1>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>From</label>
                                                    <input
                                                        type="date"
                                                        value={dateFrom}
                                                        onChange={e => { setDateFrom(e.target.value); setPage(1); }}
                                                        style={{ padding: '6px 10px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none', colorScheme: 'dark' }}
                                                    />
                                                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>To</label>
                                                    <input
                                                        type="date"
                                                        value={dateTo}
                                                        onChange={e => { setDateTo(e.target.value); setPage(1); }}
                                                        style={{ padding: '6px 10px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none', colorScheme: 'dark' }}
                                                    />
                                                    {(dateFrom || dateTo) && (
                                                        <button
                                                            onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
                                                            style={{ padding: '6px 12px', background: 'none', border: '1px solid var(--border-color)', borderRadius: '8px', color: '#ef4444', fontSize: '0.8rem', cursor: 'pointer' }}
                                                        >
                                                            Clear
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={handleDownloadEmails}
                                                        disabled={downloading}
                                                        style={{
                                                            padding: '6px 14px',
                                                            background: downloading ? 'var(--bg-hover)' : '#10b981',
                                                            color: downloading ? 'var(--text-muted)' : '#fff',
                                                            border: 'none',
                                                            borderRadius: '8px',
                                                            cursor: downloading ? 'not-allowed' : 'pointer',
                                                            fontSize: '0.85rem',
                                                            fontWeight: '600',
                                                        }}
                                                    >
                                                        {downloading ? 'Downloading...' : '⬇ Download Emails'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setActiveView('map')}
                                                        style={{
                                                            padding: '6px 14px',
                                                            background: 'var(--accent-primary)',
                                                            color: '#fff',
                                                            border: 'none',
                                                            borderRadius: '8px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.85rem',
                                                            fontWeight: '600',
                                                        }}
                                                    >
                                                        Map
                                                    </button>
                                                </div>
                                            </div>
                                            <OrderList
                                                orders={orders}
                                                onSelectOrder={handleSelectOrder}
                                                page={page}
                                                setPage={setPage}
                                                totalCount={totalCount}
                                                pageSize={pageSize}
                                                activeStatus={statusFilter}
                                                onChangeStatus={handleStatusFilterChange}
                                                onBulkStatusChange={handleBulkStatusChange}
                                            />
                                        </>
                                    )}

                                    {activeView === 'customers' && (
                                        loadingAll ? (
                                            <div className="loading">Loading customer data...</div>
                                        ) : (
                                            <Customers orders={allOrders} />
                                        )
                                    )}

                                    {activeView === 'profiles' && (
                                        <Profiles />
                                    )}

                                    {activeView === 'emailer' && (
                                        <Emailer />
                                    )}

                                    {activeView === 'subscribers' && (
                                        <Subscribers />
                                    )}

                                    {activeView === 'affiliates' && (
                                        <AffiliateRequests />
                                    )}

                                    {activeView === 'affiliate-orders' && (
                                        <AffiliateOrders onSelectOrder={handleSelectOrder} />
                                    )}

                                    {activeView === 'analytics' && (
                                        loadingAll ? (
                                            <div className="loading">Loading analytics data...</div>
                                        ) : (
                                            <Analytics
                                                orders={allOrders}
                                                onRefreshOrders={loadAllOrders}
                                                refreshingOrders={loadingAll}
                                            />
                                        )
                                    )}

                                    {activeView === 'map' && (
                                        loadingAll ? (
                                            <div className="loading">Loading map data...</div>
                                        ) : (
                                            <OrdersMap orders={allOrders} onSelectOrder={handleSelectOrder} />
                                        )
                                    )}

                                    {activeView === 'deleted-stats' && (
                                        <DeletedOrdersStats />
                                    )}
                                </>
                            )}
                        </div>
                    </main>

                    {selectedOrder && (
                        <OrderDetail
                            order={selectedOrder}
                            onClose={() => setSelectedOrder(null)}
                            onOrderUpdated={handleOrderUpdated}
                        />
                    )}

                    {showChangePassword && (
                        <div style={{
                            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
                        }}>
                            <div style={{
                                background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                                borderRadius: '12px', padding: '32px', width: '360px',
                            }}>
                                <h2 style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: '600', marginBottom: '20px' }}>
                                    Change Password
                                </h2>
                                <form onSubmit={handleChangePassword}>
                                    <input
                                        type="password"
                                        placeholder="New password"
                                        value={pwForm.newPassword}
                                        onChange={e => { setPwForm(f => ({ ...f, newPassword: e.target.value })); setPwStatus(s => ({ ...s, error: '', success: '' })); }}
                                        required
                                        style={{
                                            width: '100%', padding: '11px 14px', marginBottom: '10px',
                                            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                            borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.9rem',
                                            outline: 'none', boxSizing: 'border-box',
                                        }}
                                    />
                                    <input
                                        type="password"
                                        placeholder="Confirm new password"
                                        value={pwForm.confirm}
                                        onChange={e => { setPwForm(f => ({ ...f, confirm: e.target.value })); setPwStatus(s => ({ ...s, error: '', success: '' })); }}
                                        required
                                        style={{
                                            width: '100%', padding: '11px 14px', marginBottom: '12px',
                                            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                                            borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.9rem',
                                            outline: 'none', boxSizing: 'border-box',
                                        }}
                                    />
                                    {pwStatus.error && (
                                        <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '10px' }}>{pwStatus.error}</p>
                                    )}
                                    {pwStatus.success && (
                                        <p style={{ color: '#10b981', fontSize: '0.8rem', marginBottom: '10px' }}>{pwStatus.success}</p>
                                    )}
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button
                                            type="button"
                                            onClick={() => setShowChangePassword(false)}
                                            style={{
                                                flex: 1, padding: '11px', background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-color)', borderRadius: '8px',
                                                color: 'var(--text-muted)', fontSize: '0.9rem', cursor: 'pointer',
                                            }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={pwStatus.loading}
                                            style={{
                                                flex: 1, padding: '11px', background: 'var(--accent-primary)',
                                                border: 'none', borderRadius: '8px', color: '#fff',
                                                fontSize: '0.9rem', fontWeight: '600',
                                                cursor: pwStatus.loading ? 'not-allowed' : 'pointer',
                                                opacity: pwStatus.loading ? 0.7 : 1,
                                            }}
                                        >
                                            {pwStatus.loading ? 'Saving…' : 'Save'}
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default Dashboard;
