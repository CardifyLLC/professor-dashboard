import React, { useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { parseAddress } from '../services/orderService';

const STATE_CENTERS = {
    AL: { name: 'Alabama', lat: 32.806671, lon: -86.79113 },
    AK: { name: 'Alaska', lat: 61.370716, lon: -152.404419 },
    AZ: { name: 'Arizona', lat: 33.729759, lon: -111.431221 },
    AR: { name: 'Arkansas', lat: 34.969704, lon: -92.373123 },
    CA: { name: 'California', lat: 36.116203, lon: -119.681564 },
    CO: { name: 'Colorado', lat: 39.059811, lon: -105.311104 },
    CT: { name: 'Connecticut', lat: 41.597782, lon: -72.755371 },
    DE: { name: 'Delaware', lat: 39.318523, lon: -75.507141 },
    FL: { name: 'Florida', lat: 27.766279, lon: -81.686783 },
    GA: { name: 'Georgia', lat: 33.040619, lon: -83.643074 },
    HI: { name: 'Hawaii', lat: 21.094318, lon: -157.498337 },
    ID: { name: 'Idaho', lat: 44.240459, lon: -114.478828 },
    IL: { name: 'Illinois', lat: 40.349457, lon: -88.986137 },
    IN: { name: 'Indiana', lat: 39.849426, lon: -86.258278 },
    IA: { name: 'Iowa', lat: 42.011539, lon: -93.210526 },
    KS: { name: 'Kansas', lat: 38.5266, lon: -96.726486 },
    KY: { name: 'Kentucky', lat: 37.66814, lon: -84.670067 },
    LA: { name: 'Louisiana', lat: 31.169546, lon: -91.867805 },
    ME: { name: 'Maine', lat: 44.693947, lon: -69.381927 },
    MD: { name: 'Maryland', lat: 39.063946, lon: -76.802101 },
    MA: { name: 'Massachusetts', lat: 42.230171, lon: -71.530106 },
    MI: { name: 'Michigan', lat: 43.326618, lon: -84.536095 },
    MN: { name: 'Minnesota', lat: 45.694454, lon: -93.900192 },
    MS: { name: 'Mississippi', lat: 32.741646, lon: -89.678696 },
    MO: { name: 'Missouri', lat: 38.456085, lon: -92.288368 },
    MT: { name: 'Montana', lat: 46.921925, lon: -110.454353 },
    NE: { name: 'Nebraska', lat: 41.12537, lon: -98.268082 },
    NV: { name: 'Nevada', lat: 38.313515, lon: -117.055374 },
    NH: { name: 'New Hampshire', lat: 43.452492, lon: -71.563896 },
    NJ: { name: 'New Jersey', lat: 40.298904, lon: -74.521011 },
    NM: { name: 'New Mexico', lat: 34.840515, lon: -106.248482 },
    NY: { name: 'New York', lat: 42.165726, lon: -74.948051 },
    NC: { name: 'North Carolina', lat: 35.630066, lon: -79.806419 },
    ND: { name: 'North Dakota', lat: 47.528912, lon: -99.784012 },
    OH: { name: 'Ohio', lat: 40.388783, lon: -82.764915 },
    OK: { name: 'Oklahoma', lat: 35.565342, lon: -96.928917 },
    OR: { name: 'Oregon', lat: 44.572021, lon: -122.070938 },
    PA: { name: 'Pennsylvania', lat: 40.590752, lon: -77.209755 },
    RI: { name: 'Rhode Island', lat: 41.680893, lon: -71.51178 },
    SC: { name: 'South Carolina', lat: 33.856892, lon: -80.945007 },
    SD: { name: 'South Dakota', lat: 44.299782, lon: -99.438828 },
    TN: { name: 'Tennessee', lat: 35.747845, lon: -86.692345 },
    TX: { name: 'Texas', lat: 31.054487, lon: -97.563461 },
    UT: { name: 'Utah', lat: 40.150032, lon: -111.862434 },
    VT: { name: 'Vermont', lat: 44.045876, lon: -72.710686 },
    VA: { name: 'Virginia', lat: 37.769337, lon: -78.169968 },
    WA: { name: 'Washington', lat: 47.400902, lon: -121.490494 },
    WV: { name: 'West Virginia', lat: 38.491226, lon: -80.954453 },
    WI: { name: 'Wisconsin', lat: 44.268543, lon: -89.616508 },
    WY: { name: 'Wyoming', lat: 42.755966, lon: -107.30249 },
    DC: { name: 'District of Columbia', lat: 38.897438, lon: -77.026817 },
};

const STATE_NAMES = Object.entries(STATE_CENTERS).reduce((lookup, [code, state]) => {
    lookup[state.name.toLowerCase()] = code;
    return lookup;
}, {});

const normalizeState = (value) => {
    if (!value) return '';
    const cleaned = String(value).trim();
    const upper = cleaned.toUpperCase();
    if (STATE_CENTERS[upper]) return upper;
    return STATE_NAMES[cleaned.toLowerCase()] || '';
};

const getOrderState = (order) => {
    const address = parseAddress(order.shipping_address);
    return normalizeState(address.state || address.province || address.region || order.shipping_state);
};

const formatCurrency = (cents) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format((Number(cents) || 0) / 100);
};

const projectUs = (lat, lon) => {
    const minLon = -125;
    const maxLon = -66;
    const minLat = 24;
    const maxLat = 50;
    return {
        x: ((lon - minLon) / (maxLon - minLon)) * 100,
        y: ((maxLat - lat) / (maxLat - minLat)) * 100,
    };
};

const OrdersMap = ({ orders, onSelectOrder }) => {
    const [selectedState, setSelectedState] = useState(null);

    const mapData = useMemo(() => {
        const byState = new Map();
        let mappable = 0;
        let unmapped = 0;

        orders.forEach((order) => {
            const stateCode = getOrderState(order);
            if (!stateCode || !STATE_CENTERS[stateCode]) {
                unmapped += 1;
                return;
            }

            mappable += 1;
            const current = byState.get(stateCode) || {
                code: stateCode,
                name: STATE_CENTERS[stateCode].name,
                count: 0,
                totalCents: 0,
                orders: [],
                ...projectUs(STATE_CENTERS[stateCode].lat, STATE_CENTERS[stateCode].lon),
            };

            current.count += 1;
            current.totalCents += Number(order.total_amount_cents) || 0;
            current.orders.push(order);
            byState.set(stateCode, current);
        });

        const states = Array.from(byState.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        return {
            states,
            mappable,
            unmapped,
            topState: states[0] || null,
            selected: states.find((state) => state.code === selectedState) || states[0] || null,
        };
    }, [orders, selectedState]);

    const maxCount = Math.max(1, ...mapData.states.map((state) => state.count));
    const selectedOrders = mapData.selected?.orders.slice(0, 12) || [];

    return (
        <div className="orders-map-page">
            <div className="orders-map-header">
                <div>
                    <h1 className="page-title">USA Order Map</h1>
                    <p className="orders-map-subtitle">
                        Pins are grouped by shipping state from current order records.
                    </p>
                </div>
                <div className="orders-map-stats">
                    <div>
                        <span>{mapData.mappable}</span>
                        Mapped
                    </div>
                    <div>
                        <span>{mapData.states.length}</span>
                        States
                    </div>
                    <div>
                        <span>{mapData.unmapped}</span>
                        No state
                    </div>
                </div>
            </div>

            <div className="orders-map-layout">
                <section className="orders-map-card" aria-label="United States order map">
                    <svg className="orders-map-svg" viewBox="0 0 100 100" role="img" aria-label="Map of USA with order pins">
                        <defs>
                            <linearGradient id="orders-map-land" x1="0" x2="1" y1="0" y2="1">
                                <stop offset="0%" stopColor="#1e293b" />
                                <stop offset="100%" stopColor="#0f172a" />
                            </linearGradient>
                        </defs>
                        <rect width="100" height="100" rx="3" fill="#0b1220" />
                        <path
                            d="M9 30 L16 18 L29 17 L39 14 L53 15 L66 18 L78 20 L88 28 L91 41 L86 52 L81 62 L72 66 L62 72 L54 82 L44 78 L33 80 L26 70 L19 64 L13 54 L8 44 Z"
                            fill="url(#orders-map-land)"
                            stroke="#334155"
                            strokeWidth="0.8"
                        />
                        <path
                            d="M19 64 L24 67 L31 66 L37 69 L44 68 L51 71 L57 69 L64 64 L72 63 L80 55"
                            fill="none"
                            stroke="#1f2a3d"
                            strokeWidth="0.45"
                        />
                        <path
                            d="M18 35 L31 34 L44 33 L58 34 L73 36 L86 39 M24 49 L38 48 L52 49 L66 48 L82 49"
                            fill="none"
                            stroke="#1f2a3d"
                            strokeWidth="0.45"
                        />
                        <path
                            d="M18 84 C21 81 26 80 31 81 C27 85 22 87 18 84 Z"
                            fill="#1e293b"
                            stroke="#334155"
                            strokeWidth="0.6"
                        />
                        <path
                            d="M7 79 C10 77 13 78 15 81 C12 83 9 83 7 79 Z"
                            fill="#1e293b"
                            stroke="#334155"
                            strokeWidth="0.6"
                        />
                        {mapData.states.map((state) => {
                            const radius = 1.8 + (state.count / maxCount) * 3.4;
                            const active = mapData.selected?.code === state.code;

                            return (
                                <g
                                    key={state.code}
                                    className={`orders-map-pin ${active ? 'active' : ''}`}
                                    transform={`translate(${state.x} ${state.y})`}
                                    onClick={() => setSelectedState(state.code)}
                                    tabIndex="0"
                                    role="button"
                                    aria-label={`${state.name}, ${state.count} orders`}
                                >
                                    <circle r={radius + 1.4} />
                                    <circle r={radius} />
                                    <text y="0.55">{state.count}</text>
                                </g>
                            );
                        })}
                    </svg>
                </section>

                <aside className="orders-map-panel">
                    <div className="orders-map-panel-title">
                        <MapPin size={18} />
                        {mapData.selected ? `${mapData.selected.name} Orders` : 'Mapped Orders'}
                    </div>

                    {mapData.selected ? (
                        <>
                            <div className="orders-map-selected-stats">
                                <div>
                                    <span>{mapData.selected.count}</span>
                                    Orders
                                </div>
                                <div>
                                    <span>{formatCurrency(mapData.selected.totalCents)}</span>
                                    Total
                                </div>
                            </div>
                            <div className="orders-map-order-list">
                                {selectedOrders.map((order) => (
                                    <button
                                        key={order.id}
                                        type="button"
                                        className="orders-map-order"
                                        onClick={() => onSelectOrder(order)}
                                    >
                                        <span>#{String(order.id).slice(0, 8)}</span>
                                        <strong>{order.customer_name || 'Guest'}</strong>
                                        <small>{formatCurrency(order.total_amount_cents)}</small>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="orders-map-empty">No USA state data found on orders.</div>
                    )}

                    {mapData.states.length > 0 && (
                        <div className="orders-map-rank">
                            {mapData.states.slice(0, 8).map((state) => (
                                <button
                                    key={state.code}
                                    type="button"
                                    className={mapData.selected?.code === state.code ? 'active' : ''}
                                    onClick={() => setSelectedState(state.code)}
                                >
                                    <span>{state.name}</span>
                                    <strong>{state.count}</strong>
                                </button>
                            ))}
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
};

export default OrdersMap;
