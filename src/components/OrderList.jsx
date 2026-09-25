import React, { useState, useEffect } from 'react';
import { Download, TriangleAlert } from 'lucide-react';
import { saveAs } from 'file-saver';
import { completeOrdersOlderThanTwoWeeks } from '../services/orderService';
import { awardCashPurchaseReward, createOrderPdfDownloadUrls, fetchCompletedOrderPdfsByDate, fetchOrderPdfGenerations, getCurrentPacificDate, hasUploadedXml, isXmlOrder } from '../services/orderService';

const statusTabs = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'paid', label: 'Paid' },
    { value: 'processing', label: 'Processing' },
    { value: 'shipped', label: 'Shipped' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
];

const getDeckQuantity = (order) => {
    const quantity = Number(order?.deck_quantity ?? order?.metadata?.deckQuantity ?? 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
};

const isProModeOrder = (order) => {
    const metadata = order?.metadata && typeof order.metadata === 'object' ? order.metadata : {};
    return metadata.proMode === true || metadata.pro_mode === true;
};

const OrderList = ({ orders, onSelectOrder, page, setPage, totalCount, pageSize, activeStatus, onChangeStatus, onBulkStatusChange, onOrdersUpdated }) => {
    const [completingOlder, setCompletingOlder] = useState(false);
    const [completionMessage, setCompletionMessage] = useState('');
    const handleCompleteOlder = async () => {
        if (completingOlder) return;
        setCompletingOlder(true);
        setCompletionMessage('');
        try {
            const count = await completeOrdersOlderThanTwoWeeks();
            setCompletionMessage(count === null ? 'Eligible orders marked completed.' : `${count} order${count === 1 ? '' : 's'} marked completed.`);
            setSelectedIds(new Set());
            await onOrdersUpdated?.();
        } catch (error) {
            setCompletionMessage(`Could not complete the update: ${error.message || error}`);
        } finally {
            setCompletingOlder(false);
        }
    };
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkUpdating, setBulkUpdating] = useState(false);
    const [updatingOrderId, setUpdatingOrderId] = useState(null);
    const [rewardingOrderId, setRewardingOrderId] = useState(null);
    const [rewardMessages, setRewardMessages] = useState({});
    const [pdfGenerations, setPdfGenerations] = useState({});
    const [pdfDownloadDate, setPdfDownloadDate] = useState(getCurrentPacificDate);
    const [bulkPdfDownload, setBulkPdfDownload] = useState({ running: false, completed: 0, total: 0, message: '' });

    // Clear selection whenever the visible orders change (page change, filter, search, etc.)
    useEffect(() => {
        setSelectedIds(new Set());
    }, [page, activeStatus, totalCount]);

    useEffect(() => {
        let active = true;
        let timer;
        const orderIds = orders.map(order => order.id);

        const loadPdfStatuses = async () => {
            try {
                const generations = await fetchOrderPdfGenerations(orderIds);
                if (!active) return;
                setPdfGenerations(Object.fromEntries(generations.map(item => [item.order_id, item])));
                if (generations.some(item => item.status === 'processing')) {
                    timer = window.setTimeout(loadPdfStatuses, 3000);
                }
            } catch (error) {
                console.error('Could not load PDF generation statuses:', error);
            }
        };

        if (orderIds.length) loadPdfStatuses();
        else setPdfGenerations({});
        return () => {
            active = false;
            if (timer) window.clearTimeout(timer);
        };
    }, [orders]);

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatCurrency = (cents) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(cents / 100);
    };

    const totalPages = Math.ceil(totalCount / pageSize);
    const multiDeckOrders = orders.filter(order => getDeckQuantity(order) > 1);

    const visibleIds = orders.map(o => o.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
    const someSelected = selectedIds.size > 0 && !allVisibleSelected;

    const toggleOne = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const toggleAllVisible = () => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (allVisibleSelected) {
                visibleIds.forEach(id => next.delete(id));
            } else {
                visibleIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const handleMarkCompleted = async () => {
        if (selectedIds.size === 0) return;
        const ids = Array.from(selectedIds);
        const ok = window.confirm(`Mark ${ids.length} order${ids.length !== 1 ? 's' : ''} as completed?`);
        if (!ok) return;
        setBulkUpdating(true);
        try {
            await onBulkStatusChange(ids, 'completed');
            setSelectedIds(new Set());
        } finally {
            setBulkUpdating(false);
        }
    };

    const handleMarkIncomplete = async (event, orderId) => {
        event.stopPropagation();
        setUpdatingOrderId(orderId);
        try {
            await onBulkStatusChange([orderId], 'paid');
        } finally {
            setUpdatingOrderId(null);
        }
    };

    const handleDownloadPdfsByDate = async () => {
        if (!pdfDownloadDate || bulkPdfDownload.running) return;
        setBulkPdfDownload({ running: true, completed: 0, total: 0, message: 'Finding completed PDFs...' });
        try {
            const generations = await fetchCompletedOrderPdfsByDate(pdfDownloadDate);
            const files = generations.flatMap(generation => {
                const paths = Array.isArray(generation.storage_paths) && generation.storage_paths.length
                    ? generation.storage_paths
                    : generation.storage_path ? [generation.storage_path] : [];
                return paths.map((path, index) => ({
                    orderId: generation.order_id,
                    path,
                    part: index + 1,
                    totalParts: paths.length,
                }));
            });
            if (!files.length) {
                setBulkPdfDownload({ running: false, completed: 0, total: 0, message: 'No completed PDFs found for this date.' });
                return;
            }

            setBulkPdfDownload({ running: true, completed: 0, total: files.length, message: 'Creating secure download links...' });
            const signedUrls = [];
            for (let start = 0; start < files.length; start += 100) {
                signedUrls.push(...await createOrderPdfDownloadUrls(files.slice(start, start + 100).map(file => file.path)));
            }

            for (let index = 0; index < files.length; index += 1) {
                const response = await fetch(signedUrls[index]);
                if (!response.ok) throw new Error(`Could not download PDF ${index + 1} (HTTP ${response.status}).`);
                const blob = await response.blob();
                const file = files[index];
                const suffix = file.totalParts > 1 ? `-part-${file.part}-of-${file.totalParts}` : '';
                saveAs(blob, `order-${file.orderId}${suffix}.pdf`);
                setBulkPdfDownload({ running: true, completed: index + 1, total: files.length, message: `Downloading ${index + 1} of ${files.length}...` });
                await new Promise(resolve => window.setTimeout(resolve, 300));
            }
            setBulkPdfDownload({ running: false, completed: files.length, total: files.length, message: `Downloaded ${files.length} PDF file${files.length === 1 ? '' : 's'}.` });
        } catch (error) {
            console.error('Could not download PDFs by date:', error);
            setBulkPdfDownload(current => ({ ...current, running: false, message: error.message || 'PDF download failed.' }));
        }
    };

    const handleGrantCashReward = async (event, order) => {
        event.stopPropagation();
        if (!window.confirm(`Grant another 5% cash-purchase PRINTS reward for order #${order.id.slice(0, 8)}? Every confirmed click adds a new wallet credit.`)) return;
        setRewardingOrderId(order.id);
        setRewardMessages(current => ({ ...current, [order.id]: null }));
        try {
            const result = await awardCashPurchaseReward(order.id);
            const message = result.awarded
                ? `Granted ${Number(result.prints || 0).toLocaleString()} PRINTS`
                : result.reason === 'already_awarded' ? 'Already granted'
                    : result.reason === 'reward_below_one_print' ? 'Below 1 PRINT'
                        : result.reason === 'signed_in_user_required' ? 'Guest order - no wallet'
                            : result.reason === 'order_not_paid' ? 'Order is not paid'
                                : `Not granted: ${String(result.reason || 'unknown reason').replaceAll('_', ' ')}`;
            setRewardMessages(current => ({ ...current, [order.id]: { ok: Boolean(result.awarded), text: message } }));
        } catch (error) {
            setRewardMessages(current => ({ ...current, [order.id]: { ok: false, text: error.message || 'Reward failed' } }));
        } finally {
            setRewardingOrderId(null);
        }
    };

    return (
        <div className="data-table-container">
            <div style={{ padding: '14px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                <button type="button" disabled={completingOlder || bulkUpdating} onClick={handleCompleteOlder}
                    style={{ background: '#166534', color: '#fff', border: '1px solid #22c55e', borderRadius: '8px', padding: '10px 14px', cursor: completingOlder ? 'wait' : 'pointer' }}>
                    {completingOlder ? 'Completing orders…' : 'Complete orders 14+ days old'}
                </button>
                <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Paid and shipped orders only · all pages · based on order date</span>
                {completionMessage && <span role="status">{completionMessage}</span>}
            </div>
            <div className="orders-filter-tabs">
                {statusTabs.map((tab) => (
                    <button
                        key={tab.value}
                        type="button"
                        className={`orders-filter-tab ${activeStatus === tab.value ? 'active' : ''}`}
                        onClick={() => onChangeStatus(tab.value)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {multiDeckOrders.length > 0 && (
                <div className="multi-deck-page-alert" role="status">
                    <span className="multi-deck-page-alert-icon" aria-hidden="true">
                        <TriangleAlert size={20} strokeWidth={2.5} />
                    </span>
                    <div>
                        <strong>{multiDeckOrders.length} multi-deck order{multiDeckOrders.length === 1 ? '' : 's'} on this page</strong>
                        <span>Rows outlined in orange contain more than one deck. Confirm the deck count before processing.</span>
                    </div>
                </div>
            )}

            {/* Bulk action bar — appears when at least one row is selected */}
            {selectedIds.size > 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', margin: '8px 0',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--accent-primary)', borderRadius: '8px',
                    gap: '12px', flexWrap: 'wrap',
                }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
                        {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                            onClick={handleMarkCompleted}
                            disabled={bulkUpdating}
                            style={{
                                padding: '8px 16px',
                                background: bulkUpdating ? 'var(--bg-hover)' : '#10b981',
                                color: bulkUpdating ? 'var(--text-muted)' : '#fff',
                                border: 'none', borderRadius: '8px',
                                cursor: bulkUpdating ? 'not-allowed' : 'pointer',
                                fontWeight: 600, fontSize: '0.85rem',
                            }}
                        >
                            {bulkUpdating ? 'Updating...' : '✓ Mark as Completed'}
                        </button>
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            disabled={bulkUpdating}
                            style={{
                                padding: '8px 16px',
                                background: 'none',
                                color: 'var(--text-muted)',
                                border: '1px solid var(--border-color)', borderRadius: '8px',
                                cursor: 'pointer', fontSize: '0.85rem',
                            }}
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="table-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap', padding: '10px' }}>
                <span>Total Orders: {totalCount}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <label htmlFor="pdf-download-date" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Order date (Pacific)</label>
                    <input
                        id="pdf-download-date"
                        type="date"
                        value={pdfDownloadDate}
                        onChange={event => setPdfDownloadDate(event.target.value)}
                        disabled={bulkPdfDownload.running}
                        style={{ padding: '7px 9px', borderRadius: '7px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                    <button
                        type="button"
                        onClick={handleDownloadPdfsByDate}
                        disabled={!pdfDownloadDate || bulkPdfDownload.running}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 11px', border: 0, borderRadius: '7px', background: '#10b981', color: '#fff', fontWeight: 700, cursor: bulkPdfDownload.running ? 'not-allowed' : 'pointer', opacity: bulkPdfDownload.running ? 0.7 : 1 }}
                    >
                        <Download size={15} />
                        {bulkPdfDownload.running ? `${bulkPdfDownload.completed}/${bulkPdfDownload.total || '...'}` : 'Download day PDFs'}
                    </button>
                    {bulkPdfDownload.message && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{bulkPdfDownload.message}</span>}
                </div>
                <div className="pagination-controls" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                        disabled={page === 1}
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        style={{ padding: '5px 10px', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
                    >
                        Previous
                    </button>
                    <span>Page {page} of {totalPages || 1}</span>
                    <button
                        disabled={page >= totalPages}
                        onClick={() => setPage(p => p + 1)}
                        style={{ padding: '5px 10px', cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
                    >
                        Next
                    </button>
                </div>
            </div>
            <table className="data-table">
                <thead>
                    <tr>
                        <th style={{ width: '36px', textAlign: 'center' }}>
                            <input
                                type="checkbox"
                                checked={allVisibleSelected}
                                ref={el => { if (el) el.indeterminate = someSelected; }}
                                onChange={toggleAllVisible}
                                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                title="Select all on this page"
                            />
                        </th>
                        <th>Order ID</th>
                        <th>Customer</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Total</th>
                        <th>Items</th>
                        <th>PDF</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {orders.map(order => {
                        const xmlOrder = isXmlOrder(order);
                        const hasXml = hasUploadedXml(order);
                        const isCardstockOrder = order.metadata?.productType === 'cardstock';
                        const proModeOrder = isProModeOrder(order);
                        const normalizedStatus = String(order.status || '').toLowerCase();
                        const pdfGeneration = pdfGenerations[order.id];
                        const isSelected = selectedIds.has(order.id);
                        const deckQuantity = getDeckQuantity(order);
                        const isMultiDeckOrder = !isCardstockOrder && deckQuantity > 1;
                        return (
                        <tr
                            key={order.id}
                            onClick={() => onSelectOrder(order)}
                            className={isMultiDeckOrder ? 'multi-deck-order-row' : undefined}
                            style={isSelected ? { background: 'var(--bg-hover)' } : undefined}
                        >
                            <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => toggleOne(order.id)}
                                    style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                />
                            </td>
                            <td>
                                <div className="order-id-cell">#{order.id.slice(0, 8)}</div>
                                {isMultiDeckOrder && <span className="multi-deck-order-badge">MULTI-DECK ×{deckQuantity}</span>}
                            </td>
                            <td>
                                <div style={{ fontWeight: 'bold' }}>{order.customer_name || 'Guest'}</div>
                                <div style={{ fontSize: '0.8em', color: 'var(--text-muted)' }}>{order.customer_email}</div>
                            </td>
                            <td>{formatDate(order.created_at)}</td>
                            <td>
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                    <span className={`status-badge ${xmlOrder ? 'status-paid' : 'status-pending'}`}>
                                        {isCardstockOrder ? 'Cardstock' : (xmlOrder ? 'XML' : 'Standard')}
                                    </span>
                                    {hasXml && (
                                        <span className="status-badge" style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>
                                            Has XML
                                        </span>
                                    )}
                                    {proModeOrder && (
                                        <span className="pro-mode-order-badge" title="Customer submitted original artwork using Pro Mode">
                                            PRO MODE
                                        </span>
                                    )}
                                </div>
                            </td>
                            <td>
                                <span className={`status-badge status-${normalizedStatus}`}>
                                    {order.status}
                                </span>
                            </td>
                            <td>{formatCurrency(order.total_amount_cents)}</td>
                            <td>
                                <div>{order.quantity} {isCardstockOrder ? (order.quantity === 1 ? 'sheet' : 'sheets') : 'cards'}</div>
                                {!isCardstockOrder && (
                                    <div className={isMultiDeckOrder ? 'multi-deck-item-count' : 'single-deck-item-count'}>
                                        {deckQuantity} {deckQuantity === 1 ? 'deck' : 'decks'}
                                    </div>
                                )}
                            </td>
                            <td>
                                {!pdfGeneration ? (
                                    <span className="pdf-status-badge pdf-status-none">Not generated</span>
                                ) : pdfGeneration.status === 'completed' ? (
                                    <span className="pdf-status-badge pdf-status-ready" title={`${pdfGeneration.completed_parts || 1} PDF part(s) ready`}>
                                        ✓ PDF ready
                                    </span>
                                ) : pdfGeneration.status === 'processing' ? (
                                    <span className="pdf-status-badge pdf-status-processing">
                                        <span className="pdf-status-dot" />
                                        {pdfGeneration.total_cards > 0
                                            ? `${pdfGeneration.processed_cards}/${pdfGeneration.total_cards}`
                                            : 'Generating'}
                                    </span>
                                ) : (
                                    <span className="pdf-status-badge pdf-status-failed" title={pdfGeneration.error_message || 'PDF generation failed'}>
                                        ! PDF failed
                                    </span>
                                )}
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
                                <button
                                    type="button"
                                    onClick={(event) => handleGrantCashReward(event, order)}
                                    disabled={rewardingOrderId === order.id}
                                    style={{
                                        padding: '6px 12px',
                                        background: rewardingOrderId === order.id ? 'var(--bg-hover)' : '#2563eb',
                                        color: rewardingOrderId === order.id ? 'var(--text-muted)' : '#fff',
                                        border: 'none', borderRadius: '8px',
                                        cursor: rewardingOrderId === order.id ? 'not-allowed' : 'pointer',
                                        fontWeight: 600, fontSize: '0.8rem', whiteSpace: 'nowrap',
                                    }}
                                >
                                    {rewardingOrderId === order.id ? 'Granting...' : 'Grant 5%'}
                                </button>
                                {rewardMessages[order.id] && (
                                    <span style={{
                                        maxWidth: '150px', fontSize: '0.72rem', lineHeight: 1.25,
                                        color: rewardMessages[order.id].ok ? '#10b981' : '#f59e0b',
                                    }}>
                                        {rewardMessages[order.id].text}
                                    </span>
                                )}
                                {normalizedStatus === 'completed' ? (
                                    <button
                                        type="button"
                                        onClick={(event) => handleMarkIncomplete(event, order.id)}
                                        disabled={updatingOrderId === order.id}
                                        style={{
                                            padding: '6px 12px',
                                            background: updatingOrderId === order.id ? 'var(--bg-hover)' : '#f59e0b',
                                            color: updatingOrderId === order.id ? 'var(--text-muted)' : '#111827',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: updatingOrderId === order.id ? 'not-allowed' : 'pointer',
                                            fontWeight: 600,
                                            fontSize: '0.8rem',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {updatingOrderId === order.id ? 'Updating...' : 'Mark Incomplete'}
                                    </button>
                                ) : (
                                    null
                                )}
                                </div>
                            </td>
                        </tr>
                    )})}
                </tbody>
            </table>
        </div>
    );
};

export default OrderList;
