import React, { useEffect, useState } from 'react';
import { parseAddress } from '../services/orderService';
import { getAdminAuthHeaders } from '../services/supabaseClient';

const Customers = ({ orders }) => {
    const [copiedIndex, setCopiedIndex] = useState(null);
    const [newUserEmails, setNewUserEmails] = useState(new Set());
    const [newUserCount, setNewUserCount] = useState(null);

    useEffect(() => {
        let active = true;
        const loadNewUserEligibility = async () => {
            try {
                const headers = await getAdminAuthHeaders();
                const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/grant-prints-new-users`, {
                    method: 'GET', headers,
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || 'Could not load new-user eligibility.');
                if (!active) return;
                const emails = Array.isArray(result.eligibleEmails) ? result.eligibleEmails : [];
                setNewUserEmails(new Set(emails));
                setNewUserCount(Number(result.eligibleCount || 0));
            } catch (error) {
                if (!active) return;
                console.error('Could not load new-user eligibility:', error);
                setNewUserCount(null);
            }
        };
        void loadNewUserEligibility();
        return () => { active = false; };
    }, []);

    // Extract unique customers from orders
    const customers = orders.reduce((acc, order) => {
        const existing = acc.find(c => c.email === order.customer_email);
        if (!existing) {
            acc.push({
                name: order.customer_name,
                email: order.customer_email,
                phone: order.customer_phone,
                totalOrders: 1,
                totalSpent: order.total_amount_cents,
                shippingAddress: order.shipping_address
            });
        } else {
            existing.totalOrders += 1;
            existing.totalSpent += order.total_amount_cents;
            // Update address if this order has a more recent one (assuming orders are sorted by date)
            if (order.shipping_address) {
                existing.shippingAddress = order.shipping_address;
            }
        }
        return acc;
    }, []);

    const formatCurrency = (cents) => {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(cents / 100);
    };

    const formatAddressForCopy = (customer) => {
        const address = parseAddress(customer.shippingAddress);
        if (!address || !address.line1) return '';

        const parts = [customer.name || 'Guest'];
        
        if (address.line1) {
            parts.push(address.line1);
        }
        
        // Skip line2 if it's "none" or empty
        if (address.line2 && address.line2.toLowerCase() !== 'none' && address.line2.trim() !== '') {
            parts.push(address.line2);
        }
        
        const cityStateZip = [];
        if (address.city) cityStateZip.push(address.city);
        if (address.state) cityStateZip.push(address.state);
        if (address.postal_code) cityStateZip.push(address.postal_code);
        
        if (cityStateZip.length > 0) {
            parts.push(cityStateZip.join(' '));
        }
        
        if (address.country) {
            parts.push(address.country);
        }
        
        return parts.join('\n');
    };

    const copyAddress = async (customer, index) => {
        const addressText = formatAddressForCopy(customer);
        if (!addressText) return;
        
        try {
            await navigator.clipboard.writeText(addressText);
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch (err) {
            console.error('Failed to copy address:', err);
        }
    };

    const formatAddressDisplay = (customer) => {
        const address = parseAddress(customer.shippingAddress);
        if (!address || !address.line1) return 'N/A';
        
        const parts = [];
        if (address.line1) parts.push(address.line1);
        if (address.line2 && address.line2.toLowerCase() !== 'none') {
            parts.push(address.line2);
        }
        if (address.city) {
            const cityStateZip = [address.city];
            if (address.state) cityStateZip.push(address.state);
            if (address.postal_code) cityStateZip.push(address.postal_code);
            parts.push(cityStateZip.join(', '));
        }
        if (address.country) parts.push(address.country);
        
        return parts.join(', ');
    };

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <h1 className="page-title" style={{ marginBottom: 0 }}>Customers</h1>
                <span style={{
                    display: 'inline-flex', alignItems: 'center', borderRadius: '999px',
                    border: '1px solid #3b82f6', background: 'rgba(59, 130, 246, 0.14)',
                    color: '#60a5fa', padding: '5px 10px', fontSize: '0.78rem', fontWeight: 700,
                }} title="Registered accounts that have never received a dashboard-admin PRINTS grant">
                    New users: {newUserCount === null ? '—' : newUserCount.toLocaleString()}
                </span>
            </div>
            <div className="data-table-container">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Address</th>
                            <th>Total Orders</th>
                            <th>Total Spent</th>
                        </tr>
                    </thead>
                    <tbody>
                        {customers.map((customer, index) => {
                            const address = parseAddress(customer.shippingAddress);
                            const hasAddress = address && address.line1;
                            
                            return (
                                <tr key={index}>
                                    <td style={{ fontWeight: 'bold' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <span>{customer.name || 'Guest'}</span>
                                            {newUserEmails.has(String(customer.email || '').trim().toLowerCase()) && (
                                                <span style={{
                                                    borderRadius: '999px', background: '#2563eb', color: '#fff',
                                                    padding: '2px 7px', fontSize: '0.65rem', fontWeight: 800,
                                                    letterSpacing: '0.06em',
                                                }}>NEW</span>
                                            )}
                                        </div>
                                    </td>
                                    <td>{customer.email}</td>
                                    <td>{customer.phone || 'N/A'}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span>{formatAddressDisplay(customer)}</span>
                                            {hasAddress && (
                                                <button
                                                    onClick={() => copyAddress(customer, index)}
                                                    style={{
                                                        padding: '6px',
                                                        cursor: 'pointer',
                                                        backgroundColor: copiedIndex === index ? '#4CAF50' : '#007bff',
                                                        color: 'white',
                                                        border: 'none',
                                                        borderRadius: '4px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        width: '28px',
                                                        height: '28px'
                                                    }}
                                                    title={copiedIndex === index ? 'Copied!' : 'Copy address'}
                                                >
                                                    {copiedIndex === index ? (
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12"></polyline>
                                                        </svg>
                                                    ) : (
                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                                        </svg>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    <td>{customer.totalOrders}</td>
                                    <td>{formatCurrency(customer.totalSpent)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Customers;
