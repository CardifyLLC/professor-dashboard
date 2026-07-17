import React, { useState } from 'react';
import { parseAddress, getOrderImageUrl, updateOrderCardData, updateOrderStatus, hasUploadedXml, downloadUploadedXml, rejectAndRefundOrder } from '../services/orderService';
import { ORDER_REJECTION_TEMPLATES, getRejectionTemplate } from '../constants/rejectionTemplates';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Download, Eye, EyeOff, X, Pencil, Check, Loader2 } from 'lucide-react';

const OrderDetail = ({ order, onClose, onOrderUpdated }) => {
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState({ percent: 0, completed: 0, total: 0, status: '' });
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [showImagesOnly, setShowImagesOnly] = useState(false);
    const [showCards, setShowCards] = useState(false);
    const [editingCardIndex, setEditingCardIndex] = useState(null);
    const [editValues, setEditValues] = useState({});
    const [isSavingCard, setIsSavingCard] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [cardDataState, setCardDataState] = useState(null); // local mutable copy
    const [selectedRejectTemplateKey, setSelectedRejectTemplateKey] = useState(null);
    const [rejectAdminNote, setRejectAdminNote] = useState('');
    const [isRejectingOrder, setIsRejectingOrder] = useState(false);
    const [rejectActionMessage, setRejectActionMessage] = useState('');

    const shippingAddress = parseAddress(order.shipping_address);
    // Parse card_images if it's a string, otherwise use as is
    const cardImages = typeof order.card_images === 'string'
        ? JSON.parse(order.card_images)
        : (order.card_images || []);

    // Parse card_data if it's a string, otherwise use as is
    const parsedCardData = typeof order.card_data === 'string'
        ? JSON.parse(order.card_data)
        : (order.card_data || []);
    // Use local mutable copy if available (after edits), else use parsed
    const cardData = cardDataState !== null ? cardDataState : parsedCardData;

    // Helper function to check if an image path is a mask
    const isMask = (path) => {
        if (!path) return false;
        const pathLower = path.toLowerCase();
        return pathLower.includes('mask') || pathLower.endsWith('mask.png') || pathLower.endsWith('mask.jpg') || pathLower.endsWith('mask.jpeg');
    };

    const getNextNonEmptyImageIndex = (images, startIndex) => {
        let index = startIndex;
        while (index < images.length) {
            const value = images[index];
            if (typeof value === 'string' && value.trim() === '') {
                index++;
                continue;
            }
            if (value === null || value === undefined) {
                index++;
                continue;
            }
            return index;
        }
        return -1;
    };

    // Group images into front/back/mask sets - Robust logic matching BatcherPRO
    const cardItems = [];
    let i = 0;

    // We'll traverse the raw array and extract sets
    while (i < cardImages.length) {
        const currentIndex = getNextNonEmptyImageIndex(cardImages, i);
        if (currentIndex === -1) break;

        const current = cardImages[currentIndex];

        // Skip empty strings (placeholder for non-existent masks) and standalone masks encountered out of order logic
        // But logic below handles masks specifically, so here we mostly skip empty entries
        if (!current || current === '') {
            i = currentIndex + 1;
            continue;
        }

        if (isMask(current)) {
            // Standalone mask
            cardItems.push({
                type: 'mask',
                mask: current,
                data: cardData[cardItems.length] || null
            });
            i = currentIndex + 1;
        } else {
            // It's a front image
            const front = current;
            let back = null;
            let mask = null;
            let nextIndex = currentIndex + 1;

            const backIndex = getNextNonEmptyImageIndex(cardImages, currentIndex + 1);
            if (backIndex !== -1) {
                const backCandidate = cardImages[backIndex];
                if (backCandidate && !isMask(backCandidate)) {
                    back = backCandidate;
                    nextIndex = backIndex + 1;

                    const maskIndex = getNextNonEmptyImageIndex(cardImages, backIndex + 1);
                    if (maskIndex !== -1 && isMask(cardImages[maskIndex])) {
                        mask = cardImages[maskIndex];
                        nextIndex = maskIndex + 1;
                    }
                } else if (isMask(backCandidate)) {
                    mask = backCandidate;
                    nextIndex = backIndex + 1;
                }
            }

            cardItems.push({
                type: 'card',
                front: front,
                back: back,
                mask: mask,
                data: cardData[cardItems.length] || null
            });

            i = nextIndex;
        }
    }

    // Count cards and masks separately
    const cardCount = cardItems.filter(item => item.type === 'card').length;
    const maskCount = cardItems.filter(item => item.type === 'mask' || item.mask).length;
    const xmlTaggedCount = cardItems.filter(item => {
        const tag = item?.data?.xmlTag;
        return typeof tag === 'string' ? tag.trim().length > 0 : Boolean(tag);
    }).length;
    const orderId = order.id.slice(0, 8);
    const hasXml = hasUploadedXml(order);
    const normalizedStatus = String(order.status || '').toLowerCase();
    const isCompleted = normalizedStatus === 'completed';
    const isCancelled = normalizedStatus === 'cancelled';
    const normalizedPaymentStatus = String(order.payment_status || '').toLowerCase();
    const isRefunded = normalizedPaymentStatus === 'refunded';
    const rejectPreviewTemplate = getRejectionTemplate(selectedRejectTemplateKey);

    const formatFinish = (finish) => {
        if (!finish) return 'N/A';
        return finish.split('-').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    };

    const startEditCard = (index, data) => {
        setEditingCardIndex(index);
        setEditValues({
            finish: data?.finish || '',
            trimMm: data?.trimMm ?? '',
            bleedMm: data?.bleedMm ?? '',
            hasBleed: data?.hasBleed ?? false,
            silverMask: data?.silverMask ?? false,
            maskingColors: data?.maskingColors ? data.maskingColors.join(', ') : '',
        });
    };

    const saveEditCard = async (cardItemIndex) => {
        setIsSavingCard(true);
        try {
            // Build updated card_data array
            const updatedCardData = [...cardData];
            // Map cardItem index to card_data index (same as how cardItems is built)
            const updated = {
                ...updatedCardData[cardItemIndex],
                finish: editValues.finish || undefined,
                trimMm: editValues.trimMm !== '' ? Number(editValues.trimMm) : undefined,
                bleedMm: editValues.bleedMm !== '' ? Number(editValues.bleedMm) : undefined,
                hasBleed: editValues.hasBleed,
                silverMask: editValues.silverMask,
                maskingColors: editValues.maskingColors
                    ? editValues.maskingColors.split(',').map(s => s.trim()).filter(Boolean)
                    : [],
            };
            updatedCardData[cardItemIndex] = updated;
            await updateOrderCardData(order.id, updatedCardData);
            setCardDataState(updatedCardData);
            setEditingCardIndex(null);
        } catch (err) {
            alert('Failed to save card data: ' + err.message);
        } finally {
            setIsSavingCard(false);
        }
    };

    const copyAddress = async () => {
        try {
            // Format address as multi-line string for shipping labels (includes email)
            const addressText = [
                order.customer_name,
                order.customer_email,
                shippingAddress.line1,
                shippingAddress.line2,
                `${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postal_code}`,
                shippingAddress.country
            ].filter(Boolean).join('\n');

            await navigator.clipboard.writeText(addressText);
            setShowCopySuccess(true);
            setTimeout(() => setShowCopySuccess(false), 2000);
        } catch (error) {
            console.error('Failed to copy address:', error);
            alert('Failed to copy address to clipboard');
        }
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const urlToBlob = async (url, label, attempt = 1) => {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
            }
            return await response.blob();
        } catch (error) {
            if (attempt >= 3) {
                throw new Error(`Failed to fetch ${label} after ${attempt} attempts: ${error.message}`);
            }
            await sleep(400 * attempt);
            return urlToBlob(url, label, attempt + 1);
        }
    };

    const downloadAllImagesZip = async () => {
        if (cardItems.length === 0) return;

        setIsDownloading(true);
        setDownloadProgress({ percent: 0, completed: 0, total: 0, status: 'Preparing download...' });
        const zip = new JSZip();
        const folder = zip.folder(`Order_${orderId}_Images`);
        const frontsFolder = folder.folder('Fronts');
        const backsFolder = folder.folder('Backs');
        const masksFolder = folder.folder('Masks');

        try {
            // Build lazy fetch tasks so batching actually limits concurrent requests.
            const tasks = [];
            let cardNumber = 1;
            for (const item of cardItems) {
                const num = cardNumber;
                if (item.type === 'card') {
                    if (item.front) tasks.push(async () => {
                        const blob = await urlToBlob(getOrderImageUrl(item.front), `card-${num}-front.jpg`);
                        frontsFolder.file(`card-${num}-front.jpg`, blob);
                    });
                    if (item.back) tasks.push(async () => {
                        const blob = await urlToBlob(getOrderImageUrl(item.back), `card-${num}-back.jpg`);
                        backsFolder.file(`card-${num}-back.jpg`, blob);
                    });
                    if (item.mask) tasks.push(async () => {
                        const blob = await urlToBlob(getOrderImageUrl(item.mask), `card-${num}-mask.png`);
                        masksFolder.file(`card-${num}-mask.png`, blob);
                    });
                    cardNumber++;
                } else if (item.type === 'mask') {
                    if (item.mask) tasks.push(async () => {
                        const blob = await urlToBlob(getOrderImageUrl(item.mask), `mask-${num}.png`);
                        masksFolder.file(`mask-${num}.png`, blob);
                    });
                    cardNumber++;
                }
            }

            const totalFiles = tasks.length;
            let completedFiles = 0;
            setDownloadProgress({
                percent: totalFiles === 0 ? 0 : 5,
                completed: completedFiles,
                total: totalFiles,
                status: `Downloading images (0/${totalFiles})`
            });

            // Fetch all images in parallel (batched to avoid overwhelming the browser)
            const BATCH = 6;
            for (let i = 0; i < tasks.length; i += BATCH) {
                await Promise.all(
                    tasks.slice(i, i + BATCH).map(async (task) => {
                        await task();
                        completedFiles += 1;
                        const fetchPercent = totalFiles === 0 ? 90 : Math.round((completedFiles / totalFiles) * 90);
                        setDownloadProgress({
                            percent: fetchPercent,
                            completed: completedFiles,
                            total: totalFiles,
                            status: `Downloading images (${completedFiles}/${totalFiles})`
                        });
                    })
                );
            }

            const content = await zip.generateAsync(
                { type: "blob" },
                (metadata) => {
                    const zipPercent = 90 + Math.round(metadata.percent * 0.1);
                    setDownloadProgress({
                        percent: Math.min(zipPercent, 100),
                        completed: totalFiles,
                        total: totalFiles,
                        status: `Building zip (${Math.round(metadata.percent)}%)`
                    });
                }
            );
            setDownloadProgress({
                percent: 100,
                completed: totalFiles,
                total: totalFiles,
                status: 'Download ready'
            });
            saveAs(content, `Order_${orderId}_Images.zip`);

        } catch (error) {
            console.error('Error creating zip:', error);
            alert(error.message || 'Failed to generate zip file.');
        } finally {
            setIsDownloading(false);
        }
    };

    const downloadXmlFile = async () => {
        try {
            const didDownload = downloadUploadedXml(order);
            if (!didDownload) {
                throw new Error('No uploaded XML file is available for this order.');
            }
        } catch (error) {
            console.error('Error downloading XML:', error);
            alert(error.message || 'Failed to download XML file.');
        }
    };

    const markOrderCompleted = async () => {
        if (isCompleted) return;

        setIsUpdatingStatus(true);
        try {
            const updatedOrder = await updateOrderStatus(order.id, 'completed');
            onOrderUpdated?.(updatedOrder);
        } catch (error) {
            console.error('Error updating order status:', error);
            alert(error.message || 'Failed to mark order as completed.');
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    const startRejectFlow = (templateKey) => {
        setSelectedRejectTemplateKey(templateKey);
        setRejectActionMessage('');
    };

    const closeRejectFlow = () => {
        if (isRejectingOrder) return;
        setSelectedRejectTemplateKey(null);
        setRejectAdminNote('');
        setRejectActionMessage('');
    };

    const submitRejectFlow = async () => {
        if (!selectedRejectTemplateKey || isRejectingOrder) return;

        setIsRejectingOrder(true);
        setRejectActionMessage('');
        try {
            const result = await rejectAndRefundOrder({
                orderId: order.id,
                templateKey: selectedRejectTemplateKey,
                adminNote: rejectAdminNote,
            });

            if (result?.order) {
                onOrderUpdated?.(result.order);
            }

            const statusMessage = result?.email?.status === 'sent'
                ? 'Refund created and email sent.'
                : 'Refund created. Email requires follow-up.';

            setRejectActionMessage(statusMessage);
            setRejectAdminNote('');
            setSelectedRejectTemplateKey(null);
        } catch (error) {
            console.error('Error rejecting/refunding order:', error);
            setRejectActionMessage(error.message || 'Failed to reject and refund the order.');
        } finally {
            setIsRejectingOrder(false);
        }
    };

    return (
        <div>
            <div className="modal-overlay" onClick={onClose}>
                <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: showImagesOnly ? '90vw' : '800px' }}>
                <div className="modal-header">
                    <div>
                        <h2>Order #{orderId}</h2>
                        {xmlTaggedCount > 0 && (
                            <div style={{ marginTop: '0.35rem', fontSize: '0.875rem', fontWeight: 600, color: '#60a5fa' }}>
                                XML Cards: {xmlTaggedCount}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowImagesOnly(!showImagesOnly)}
                            className="p-2 rounded hover:bg-slate-100 transition-colors"
                            title={showImagesOnly ? "Show Details" : "Show Images Only"}
                        >
                            {showImagesOnly ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                        <button className="close-btn" onClick={onClose}><X className="w-6 h-6" /></button>
                    </div>
                </div>

                <div className="modal-body">
                    {!showImagesOnly && (
                        <div className="detail-grid">
                            <div className="detail-section">
                                <h3>Customer Information</h3>
                                <div className="info-row">
                                    <span className="info-label">Name</span>
                                    <span>{order.customer_name}</span>
                                </div>
                                <div className="info-row">
                                    <span className="info-label">Email</span>
                                    <span>{order.customer_email}</span>
                                </div>
                                <div className="info-row">
                                    <span className="info-label">Phone</span>
                                    <span>{order.customer_phone || 'N/A'}</span>
                                </div>
                                <div className="info-row">
                                    <span className="info-label">Payment</span>
                                    <span>{order.payment_status || 'N/A'}</span>
                                </div>
                            </div>

                            <div className="detail-section">
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                    <h3 style={{ margin: 0 }}>Shipping Address</h3>
                                    <button
                                        onClick={copyAddress}
                                        style={{
                                            padding: '8px',
                                            cursor: 'pointer',
                                            backgroundColor: showCopySuccess ? '#10b981' : '#007bff',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: '36px',
                                            height: '36px',
                                            transition: 'background-color 0.3s'
                                        }}
                                        title={showCopySuccess ? 'Copied!' : 'Copy address to clipboard'}
                                    >
                                        {showCopySuccess ? (
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        ) : (
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                            </svg>
                                        )}
                                    </button>
                                </div>
                                <div className="info-row">
                                    <span className="info-label">Address</span>
                                    <span>{shippingAddress.line1}</span>
                                </div>
                                {shippingAddress.line2 && (
                                    <div className="info-row">
                                        <span className="info-label">Line 2</span>
                                        <span>{shippingAddress.line2}</span>
                                    </div>
                                )}
                                <div className="info-row">
                                    <span className="info-label">City/State</span>
                                    <span>{shippingAddress.city}, {shippingAddress.state} {shippingAddress.postal_code}</span>
                                </div>
                                <div className="info-row">
                                    <span className="info-label">Country</span>
                                    <span>{shippingAddress.country}</span>
                                </div>
                            </div>

                            <div className="detail-section" style={{ gridColumn: '1 / -1' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                    <div>
                                        <h3 style={{ marginBottom: '0.5rem' }}>Reject & Refund</h3>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '42rem' }}>
                                            Each action calls the server-side refund function in Stripe and then sends the matching customer email template.
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        {ORDER_REJECTION_TEMPLATES.map((template) => (
                                            <button
                                                key={template.key}
                                                type="button"
                                                onClick={() => startRejectFlow(template.key)}
                                                disabled={isRejectingOrder || isRefunded || isCancelled}
                                                className="order-reject-btn"
                                            >
                                                {template.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ marginTop: '1rem', display: 'grid', gap: '0.5rem' }}>
                                    <div className="info-row">
                                        <span className="info-label">Stripe Session</span>
                                        <span>{order.stripe_session_id || 'Missing'}</span>
                                    </div>
                                    <div className="info-row">
                                        <span className="info-label">Refund Status</span>
                                        <span>{order.payment_status || 'N/A'}</span>
                                    </div>
                                </div>

                                {rejectActionMessage && (
                                    <div
                                        style={{
                                            marginTop: '1rem',
                                            padding: '0.8rem 1rem',
                                            borderRadius: '0.75rem',
                                            border: '1px solid rgba(248, 113, 113, 0.3)',
                                            background: 'rgba(15, 23, 42, 0.6)',
                                            color: 'var(--text-primary)',
                                        }}
                                    >
                                        {rejectActionMessage}
                                    </div>
                                )}

                                {(isRefunded || isCancelled) && (
                                    <div style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                        This order already appears to be closed for refund actions.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="detail-section" style={{ border: showImagesOnly ? 'none' : undefined, padding: showImagesOnly ? 0 : undefined, background: showImagesOnly ? 'transparent' : undefined }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', position: 'sticky', top: 0, background: 'var(--bg-primary)', zIndex: 10, padding: '10px 0' }}>
                            <h3 style={{ margin: 0 }}>
                                Card Images ({cardCount} Cards{maskCount > 0 ? `, ${maskCount} Masks` : ''})
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem', minWidth: '280px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        <span className={`status-badge status-${normalizedStatus}`}>
                                            {order.status}
                                        </span>
                                        <button
                                            onClick={markOrderCompleted}
                                            type="button"
                                            disabled={isUpdatingStatus || isCompleted}
                                            className="order-complete-btn"
                                        >
                                            {isUpdatingStatus ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Saving...
                                                </>
                                            ) : (
                                                <>
                                                    <Check className="w-4 h-4" />
                                                    {isCompleted ? 'Completed' : 'Mark Completed'}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                    {cardItems.length > 0 && (
                                    <div className="flex gap-2">
                                        {hasXml && (
                                            <button
                                                onClick={downloadXmlFile}
                                                type="button"
                                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 font-semibold text-sm transition-all shadow-sm"
                                            >
                                                <Download className="w-4 h-4" />
                                                Download XML
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setShowCards(!showCards)}
                                            type="button"
                                            className="show-cards-btn"
                                        >
                                            {showCards ? (
                                                <>
                                                    <EyeOff className="w-4 h-4" />
                                                    Show Less
                                                </>
                                            ) : (
                                                <>
                                                    <Eye className="w-4 h-4" />
                                                    Show Cards
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={downloadAllImagesZip}
                                            disabled={isDownloading}
                                            type="button"
                                            className="download-zip-btn"
                                        >
                                            {isDownloading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Zipping...
                                                </>
                                            ) : (
                                                <>
                                                    <Download className="w-4 h-4" />
                                                    Download Zip
                                                </>
                                            )}
                                        </button>
                                    </div>
                                    )}
                                    {isDownloading && (
                                        <div style={{ width: '100%', maxWidth: '360px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                <span>{downloadProgress.status}</span>
                                                <span>{downloadProgress.percent}%</span>
                                            </div>
                                            <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--bg-secondary)', borderRadius: '999px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                <div
                                                    style={{
                                                        width: `${downloadProgress.percent}%`,
                                                        height: '100%',
                                                        background: 'linear-gradient(90deg, #2563eb, #60a5fa)',
                                                        transition: 'width 0.2s ease'
                                                    }}
                                                />
                                            </div>
                                            <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                                                {downloadProgress.total > 0 ? `${downloadProgress.completed} of ${downloadProgress.total} files downloaded` : 'Starting...'}
                                            </div>
                                        </div>
                                    )}
                                </div>
                        </div>

                        {(showCards || showImagesOnly) && (
                            <div className={`images-grid ${showImagesOnly ? 'images-only-view' : ''}`} style={showImagesOnly ? {
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                gap: '1rem'
                            } : {}}>
                                {cardItems.map((item, index) => {
                                    const itemData = item.data;
                                    const isMaskOnly = item.type === 'mask';

                                    if (showImagesOnly) {
                                        // Simplified view: Just the front image (or mask)
                                        const displayImage = isMaskOnly ? item.mask : item.front;
                                        return (
                                            <div key={index} className="relative group rounded-lg overflow-hidden shadow-md">
                                                <img
                                                    src={getOrderImageUrl(displayImage)}
                                                    alt={`Item ${index + 1}`}
                                                    loading="lazy"
                                                    className="w-full h-auto object-cover aspect-[63/88]"
                                                />
                                                <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-1 text-center truncate">
                                                    {isMaskOnly ? 'Make' : 'Card'} {index + 1}
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={index} className="card-pair">
                                            {isMaskOnly ? (
                                                // Standalone mask
                                                <div className="card-preview">
                                                    <div className="card-label" style={{ color: '#60a5fa', fontWeight: 'bold' }}>Mask</div>
                                                    {item.mask ? (
                                                        <img src={getOrderImageUrl(item.mask)} alt={`Mask ${index + 1}`} loading="lazy" />
                                                    ) : (
                                                        <div className="no-image-placeholder">No mask</div>
                                                    )}
                                                </div>
                                            ) : (
                                                // Card with front/back and optional mask
                                                <>
                                                    <div className="card-preview">
                                                        <div className="card-label">Front</div>
                                                        {item.front ? (
                                                            <img src={getOrderImageUrl(item.front)} alt={`Card ${index + 1} Front`} loading="lazy" />
                                                        ) : (
                                                            <div className="no-image-placeholder">No Front</div>
                                                        )}
                                                    </div>
                                                    <div className="card-preview" style={{ marginTop: '0.5rem' }}>
                                                        <div className="card-label">Back</div>
                                                        {item.back ? (
                                                            <img src={getOrderImageUrl(item.back)} alt={`Card ${index + 1} Back`} loading="lazy" />
                                                        ) : (
                                                            <div className="no-image-placeholder">No Back</div>
                                                        )}
                                                    </div>
                                                    {item.mask && (
                                                        <div className="card-preview" style={{ marginTop: '0.5rem' }}>
                                                            <div className="card-label" style={{ color: '#60a5fa', fontWeight: 'bold' }}>Mask</div>
                                                            <img src={getOrderImageUrl(item.mask)} alt={`Card ${index + 1} Mask`} loading="lazy" />
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                            {itemData && (
                                                <div style={{
                                                    marginTop: '1rem',
                                                    padding: '0.75rem',
                                                    backgroundColor: 'var(--bg-secondary)',
                                                    borderRadius: '0.5rem',
                                                    border: '1px solid var(--border-color)',
                                                    fontSize: '0.875rem'
                                                }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                                        <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                                                            {isMaskOnly ? 'Mask' : 'Card'} {index + 1} {itemData.quantity > 1 && `(Qty: ${itemData.quantity})`}
                                                        </span>
                                                        {editingCardIndex === index ? (
                                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                                <button
                                                                    onClick={() => setEditingCardIndex(null)}
                                                                    disabled={isSavingCard}
                                                                    style={{ padding: '4px', cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', borderRadius: '4px' }}
                                                                    title="Cancel"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => saveEditCard(index)}
                                                                    disabled={isSavingCard}
                                                                    style={{ padding: '4px', cursor: 'pointer', background: '#10b981', border: 'none', color: 'white', borderRadius: '4px', display: 'flex', alignItems: 'center' }}
                                                                    title="Save to database"
                                                                >
                                                                    {isSavingCard ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => startEditCard(index, itemData)}
                                                                style={{ padding: '4px', cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-muted)', borderRadius: '4px' }}
                                                                title="Edit card details"
                                                            >
                                                                <Pencil className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    {editingCardIndex === index ? (
                                                        <div style={{ display: 'grid', gap: '0.4rem' }}>
                                                            {itemData.xmlTag && (
                                                                <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                    <span className="info-label">XML Tag:</span>
                                                                    <span>{String(itemData.xmlTag)}</span>
                                                                </div>
                                                            )}
                                                            <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                <span className="info-label">Finish:</span>
                                                                <input
                                                                    value={editValues.finish}
                                                                    onChange={e => setEditValues(v => ({ ...v, finish: e.target.value }))}
                                                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '2px 6px', width: '120px', fontSize: '0.875rem' }}
                                                                />
                                                            </div>
                                                            <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                <span className="info-label">Trim (mm):</span>
                                                                <input
                                                                    type="number"
                                                                    value={editValues.trimMm}
                                                                    onChange={e => setEditValues(v => ({ ...v, trimMm: e.target.value }))}
                                                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '2px 6px', width: '80px', fontSize: '0.875rem' }}
                                                                />
                                                            </div>
                                                            <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                <span className="info-label">Bleed (mm):</span>
                                                                <input
                                                                    type="number"
                                                                    value={editValues.bleedMm}
                                                                    onChange={e => setEditValues(v => ({ ...v, bleedMm: e.target.value }))}
                                                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '2px 6px', width: '80px', fontSize: '0.875rem' }}
                                                                />
                                                            </div>
                                                            <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                <span className="info-label">Has Bleed:</span>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={editValues.hasBleed}
                                                                    onChange={e => setEditValues(v => ({ ...v, hasBleed: e.target.checked }))}
                                                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                                />
                                                            </div>
                                                            <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                <span className="info-label">Silver Mask:</span>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={editValues.silverMask}
                                                                    onChange={e => setEditValues(v => ({ ...v, silverMask: e.target.checked }))}
                                                                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                                                />
                                                            </div>
                                                            <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                <span className="info-label">Masking Colors:</span>
                                                                <input
                                                                    value={editValues.maskingColors}
                                                                    onChange={e => setEditValues(v => ({ ...v, maskingColors: e.target.value }))}
                                                                    placeholder="e.g. red, blue"
                                                                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '2px 6px', width: '120px', fontSize: '0.875rem' }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div style={{ display: 'grid', gap: '0.25rem' }}>
                                                            {itemData.xmlTag && (
                                                                <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                    <span className="info-label">XML Tag:</span>
                                                                    <span>{String(itemData.xmlTag)}</span>
                                                                </div>
                                                            )}
                                                            {itemData.finish && (
                                                                <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                    <span className="info-label">Finish:</span>
                                                                    <span>{formatFinish(itemData.finish)}</span>
                                                                </div>
                                                            )}
                                                            {itemData.trimMm !== undefined && itemData.trimMm !== null && (
                                                                <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                    <span className="info-label">Trim:</span>
                                                                    <span>{itemData.trimMm}mm</span>
                                                                </div>
                                                            )}
                                                            {itemData.bleedMm !== undefined && itemData.bleedMm !== null && (
                                                                <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                    <span className="info-label">Bleed:</span>
                                                                    <span>{itemData.bleedMm}mm</span>
                                                                </div>
                                                            )}
                                                            {itemData.hasBleed !== undefined && (
                                                                <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                    <span className="info-label">Has Bleed:</span>
                                                                    <span>{itemData.hasBleed ? 'Yes' : 'No'}</span>
                                                                </div>
                                                            )}
                                                            {itemData.silverMask && (
                                                                <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                    <span className="info-label">Silver Mask:</span>
                                                                    <span>Yes</span>
                                                                </div>
                                                            )}
                                                            {itemData.maskingColors && itemData.maskingColors.length > 0 && (
                                                                <div className="info-row" style={{ padding: '0.25rem 0', borderBottom: 'none' }}>
                                                                    <span className="info-label">Masking Colors:</span>
                                                                    <span>{itemData.maskingColors.join(', ')}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            </div>
            {rejectPreviewTemplate && (
                <div className="modal-overlay" onClick={closeRejectFlow} style={{ zIndex: 1100 }}>
                    <div className="reject-confirm-modal" onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                        <div>
                            <h3 style={{ margin: 0 }}>Confirm Reject & Refund</h3>
                            <div style={{ marginTop: '0.35rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                {rejectPreviewTemplate.label}
                            </div>
                        </div>
                        <button className="close-btn" onClick={closeRejectFlow}>
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="reject-confirm-section">
                        <div className="reject-confirm-label">Customer</div>
                        <div>{order.customer_email}</div>
                    </div>
                    <div className="reject-confirm-section">
                        <div className="reject-confirm-label">Expected Action</div>
                        <div>Trigger Stripe refund, then send the selected template email.</div>
                    </div>
                    <div className="reject-confirm-section">
                        <div className="reject-confirm-label">Email Subject</div>
                        <div>{rejectPreviewTemplate.subject}</div>
                    </div>
                    <div className="reject-confirm-section">
                        <div className="reject-confirm-label">Template Summary</div>
                        <div>{rejectPreviewTemplate.bodyPreview}</div>
                    </div>
                    <div className="reject-confirm-section">
                        <div className="reject-confirm-label">Admin Note</div>
                        <textarea
                            value={rejectAdminNote}
                            onChange={(e) => setRejectAdminNote(e.target.value)}
                            placeholder="Optional internal note"
                            className="reject-note-input"
                        />
                    </div>

                    {rejectActionMessage && (
                        <div className="reject-confirm-error">
                            {rejectActionMessage}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                        <button type="button" className="reject-cancel-btn" onClick={closeRejectFlow} disabled={isRejectingOrder}>
                            Close
                        </button>
                        <button type="button" className="reject-confirm-btn" onClick={submitRejectFlow} disabled={isRejectingOrder}>
                            {isRejectingOrder ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Refunding...
                                </>
                            ) : (
                                'Confirm Reject & Refund'
                            )}
                        </button>
                    </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderDetail;
