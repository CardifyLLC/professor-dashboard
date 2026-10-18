import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOrderById } from '../services/orderService';
import { orderLink, restoreOrderAfterSignIn, validOrderId } from '../services/orderLinks.mjs';

export default function useOrderLink() {
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderLinkError, setError] = useState('');
  const [orderLinkLoading, setLoading] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async (id) => {
    const request = ++generation.current;
    setSelectedOrder(null); setError(''); setLoading(false);
    if (!id) return;
    if (!validOrderId(id)) { setError('This order link is invalid.'); return; }
    setLoading(true);
    try {
      const order = await fetchOrderById(id);
      if (!order) throw new Error('Missing order');
      if (request === generation.current) setSelectedOrder(order);
    } catch {
      if (request === generation.current) setError('Unable to open this order. It may have been removed, or your account may not have access.');
    } finally { if (request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const counter = generation;
    restoreOrderAfterSignIn();
    const sync = () => load(new URL(window.location.href).searchParams.get('order'));
    sync();
    window.addEventListener('popstate', sync);
    return () => { counter.current++; window.removeEventListener('popstate', sync); };
  }, [load]);
  const openOrder = useCallback((order) => {
    if (!validOrderId(order.id)) return;
    window.history.pushState(null, '', orderLink(order.id));
    return load(order.id);
  }, [load]);
  const closeOrder = useCallback(() => {
    window.history.pushState(null, '', orderLink(null));
    load(null);
  }, [load]);
  return { selectedOrder, setSelectedOrder, openOrder, closeOrder, orderLinkError, orderLinkLoading };
}
