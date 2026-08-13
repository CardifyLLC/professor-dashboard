import React, { useState, useRef, useEffect, createContext, useContext } from 'react';
import { jsPDF } from 'jspdf';
import { Upload, FileText, Settings, Download, Layers, X, Grid, Image as ImageIcon, RefreshCw, ArrowRight, ArrowLeft, ZoomIn, ZoomOut, Move, RotateCcw, Eye, Printer, Save, FolderOpen, Trash2, RotateCw, Layout, GripVertical, Hand, MousePointer2, AlignCenterVertical, Scissors, ImagePlus, Images, Sparkles, Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import BeautifulExportModal from './BeautifulExportModal';
import { fetchPaidOrdersForBatcher, fetchOrderById, getOrderImageUrl, updateOrderCardData, updateOrderCardImages } from '../services/orderService';

// DEBUG: log image natural vs rendered dimensions to locate where quality is lost
function logImgInfo(label, imgEl) {
  console.log(`[QualityCheck] ${label}`, {
    src: imgEl.currentSrc || imgEl.src,
    natural: [imgEl.naturalWidth, imgEl.naturalHeight],
    rendered: [imgEl.width, imgEl.height],
  });
}

// Create Context for BatcherPRO state
export const BatcherPROContext = createContext(null);

const PAPER_SIZES = {
  '12x18': { name: '12" x 18"', width: 304.8, height: 457.2 },
  '11x17': { name: 'Tabloid (11" x 17")', width: 279.4, height: 431.8 },
  'letter': { name: 'Letter (8.5" x 11")', width: 215.9, height: 279.4 },
  'a4': { name: 'A4 (210 x 297mm)', width: 210, height: 297 },
  'a3': { name: 'A3 (297 x 420mm)', width: 297, height: 420 },
  'custom': { name: 'Custom Size', width: 0, height: 0 }
};

// EXACT REQUESTED DEFAULTS (LOCKED)
const DEFAULT_CARD_WIDTH = 67.0;
const DEFAULT_CARD_HEIGHT = 92.0;
const LOCKED_TARGET_DPI = 1200;
const UPSCALE_API_URL = (import.meta.env.VITE_UPSCALE_API_URL || '/api').replace(/\/$/, '');
const UPSCALE_API_KEY = import.meta.env.VITE_UPSCALE_API_KEY || '';
const UPSCALE_POLL_INTERVAL_MS = 3000;
const UPSCALE_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const UPSCALED_FRONT_CACHE_KEY = 'cardBatcherUpscaledFronts';

const INITIAL_CONFIG = {
  sheetSize: '12x18',
  orientation: 'landscape',
  customSheetWidth: 304.8,
  customSheetHeight: 457.2,
  gridCols: 6,
  gridRows: 3,

  // Layout Defaults (Locked)
  marginTop: 15.5,
  marginLeft: 9.7,
  gapHorizontal: 2.6,
  gapVertical: 6.4,

  // Card Size (Locked)
  cardWidth: DEFAULT_CARD_WIDTH,
  cardHeight: DEFAULT_CARD_HEIGHT,

  showRegMarks: true,
  overlayOpacity: 0.5,

  // Reg Mark Defaults (Locked)
  regMarkWidth: 3.3,
  regMarkHeight: 60.0,
  regMarkX: 7.0,
  regMarkY: 60.4,

  // Duplex & Bleed (Locked)
  flipBackPage: true, // ENABLED
  backShiftX: 0.0,    // Locked to 0.0
  backShiftY: 0.0,    // Locked to 0.0
  bleedAmount: 0.0,
  safetyCrop: 0.0,
  targetDPI: LOCKED_TARGET_DPI,    // Locked to 1200
  printCutLines: true
};

const CardBatcherPro = ({ showSidebar = true, onBackToDashboard }) => {
  // --- State ---
  // frontImages: { id, url, file, customBack: (url|null), spotMask: (url|null) }
  const [frontImages, setFrontImages] = useState([]);
  const [backImage, setBackImage] = useState(null);
  const [templateOverlay, setTemplateOverlay] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationLabel, setGenerationLabel] = useState('');
  const [generationStartedAt, setGenerationStartedAt] = useState(null);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaleProgress, setUpscaleProgress] = useState({ completed: 0, total: 0, label: '' });
  const [previewPage, setPreviewPage] = useState(0);
  const [previewSide, setPreviewSide] = useState('front');
  const [zoom, setZoom] = useState(1.0);
  const [autoFitZoom, setAutoFitZoom] = useState(true);

  const [activeTool, setActiveTool] = useState('select');
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const scrollContainerRef = useRef(null);
  const fileInputRef = useRef(null);

  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarGridCols, setSidebarGridCols] = useState(4);
  const sidebarRef = useRef(null);

  const [presetName, setPresetName] = useState('');
  const [savedPresets, setSavedPresets] = useState([]);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isLoadingPaidOrders, setIsLoadingPaidOrders] = useState(false);
  const [paidOrdersLoaded, setPaidOrdersLoaded] = useState(false);
  const didAutoLoadPaidOrdersRef = useRef(false);
  const [exportScopeModal, setExportScopeModal] = useState({
    open: false,
    mode: 'pdf', // 'pdf' | 'mask'
    customerName: null,
    selection: 'customer' // 'customer' | 'all'
  });

  // Date filter state
  const [selectedDate, setSelectedDate] = useState(null); // null = all dates
  const [availableDates, setAvailableDates] = useState([]);
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [allLoadedCards, setAllLoadedCards] = useState([]); // Store all cards before filtering
  const [mergeNextOrder, setMergeNextOrder] = useState(false); // Track if we're merging next order into current sheet

  // Customer navigation state
  const [currentCustomerIndex, setCurrentCustomerIndex] = useState(0);

  // Config State - Always starts with INITIAL_CONFIG
  const [config, setConfig] = useState(INITIAL_CONFIG);

  // --- Effects ---

  // Load Presets List Only
  useEffect(() => {
    const loaded = JSON.parse(localStorage.getItem('cardBatcherPresets') || '[]');
    setSavedPresets(loaded);
  }, []);

  // Automatically load paid orders on component mount
  useEffect(() => {
    // In dev StrictMode this effect runs twice; guard to avoid duplicating cards.
    if (didAutoLoadPaidOrdersRef.current) return;
    didAutoLoadPaidOrdersRef.current = true;
    loadPaidOrders(true); // Pass true to indicate auto-load
  }, []); // Only run once on mount

  // Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        setActiveTool('pan');
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
        setActiveTool('select');
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      const newWidth = Math.max(250, Math.min(e.clientX, 600));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const startResizing = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseDown = (e) => {
    if (activeTool === 'pan') {
      setIsPanning(true);
      setPanStart({
        x: e.clientX + scrollContainerRef.current.scrollLeft,
        y: e.clientY + scrollContainerRef.current.scrollTop
      });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning && activeTool === 'pan' && scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = panStart.x - e.clientX;
      scrollContainerRef.current.scrollTop = panStart.y - e.clientY;
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // --- Logic ---
  const getActiveSheetDims = () => {
    let width, height;
    if (config.sheetSize === 'custom') {
      width = config.customSheetWidth;
      height = config.customSheetHeight;
    } else {
      const paper = PAPER_SIZES[config.sheetSize] || PAPER_SIZES['12x18'];
      width = paper.width;
      height = paper.height;
    }
    const short = Math.min(width, height);
    const long = Math.max(width, height);
    if (config.orientation === 'landscape') {
      return { width: long, height: short };
    } else {
      return { width: short, height: long };
    }
  };

  const { width: PAGE_WIDTH_MM, height: PAGE_HEIGHT_MM } = getActiveSheetDims();
  const cardsPerPage = config.gridCols * config.gridRows;
  const CUSTOMER_HEADER_HEIGHT_MM = 7;
  const CUSTOMER_HEADER_GAP_MM = 3;
  const CUSTOMER_HEADER_OFFSET_MM = CUSTOMER_HEADER_HEIGHT_MM + CUSTOMER_HEADER_GAP_MM;

  // Build pages that pack multiple orders onto the same sheet when there are empty slots.
  // Each page is { customerName: string|null, entries: Array<{ card, index, customerName }> } where index is in `frontImages`.
  // Multiple customers can share a sheet - each entry tracks its own customerName.
  const buildCustomerPages = (cards, perPage) => {
    if (!Array.isArray(cards) || cards.length === 0 || !perPage || perPage <= 0) return [];

    const NO_CUSTOMER = '__NO_CUSTOMER__';
    const order = [];
    const byCustomer = new Map();

    cards.forEach((card, index) => {
      const rawName = typeof card?.customerName === 'string' ? card.customerName.trim() : '';
      const key = rawName ? rawName : NO_CUSTOMER;
      if (!byCustomer.has(key)) {
        byCustomer.set(key, []);
        order.push(key);
      }
      byCustomer.get(key).push({ card, index, customerName: key === NO_CUSTOMER ? null : key });
    });

    const orderedKeys = order.filter(k => k !== NO_CUSTOMER);
    if (byCustomer.has(NO_CUSTOMER)) orderedKeys.push(NO_CUSTOMER);

    const pages = [];
    let currentPage = { customerName: null, entries: [] };

    orderedKeys.forEach((key) => {
      const entries = byCustomer.get(key) || [];

      entries.forEach((entry) => {
        // If current page is full, push it and start a new one
        if (currentPage.entries.length >= perPage) {
          pages.push(currentPage);
          currentPage = { customerName: null, entries: [] };
        }

        // Add this card to the current page
        currentPage.entries.push(entry);

        // Set the page's customerName to the first customer on the page (for header display)
        if (currentPage.entries.length === 1) {
          currentPage.customerName = entry.customerName;
        }
      });
    });

    // Push the last page if it has any entries
    if (currentPage.entries.length > 0) {
      pages.push(currentPage);
    }

    return pages;
  };

  // Get unique customers from displayed cards (frontImages) - defined before customerPages for filtering
  const uniqueCustomers = React.useMemo(() => {
    const customers = [];
    const seen = new Set();
    frontImages.forEach(card => {
      const name = card.customerName || 'Unknown Customer';
      if (!seen.has(name)) {
        seen.add(name);
        customers.push(name);
      }
    });
    return customers;
  }, [frontImages]);

  // Current customer based on index - defined before customerPages for filtering
  const currentCustomer = uniqueCustomers[currentCustomerIndex] || null;

  const customerPages = React.useMemo(
    () => {
      // Show only current customer's cards, unless mergeNextOrder is true
      if (uniqueCustomers.length > 1) {
        let includedCustomers = [currentCustomer];

        // If merging, include current + next customer
        if (mergeNextOrder && currentCustomerIndex < uniqueCustomers.length - 1) {
          includedCustomers = [currentCustomer, uniqueCustomers[currentCustomerIndex + 1]];
        }

        const customerCards = frontImages.filter(
          card => includedCustomers.includes(card.customerName || 'Unknown Customer')
        );
        return buildCustomerPages(customerCards, cardsPerPage);
      }
      // If only one customer, show all cards
      return buildCustomerPages(frontImages, cardsPerPage);
    },
    [frontImages, cardsPerPage, currentCustomer, currentCustomerIndex, uniqueCustomers, mergeNextOrder]
  );

  const totalPages = Math.max(1, customerPages.length);

  // Keep preview page in range when data changes
  useEffect(() => {
    if (previewPage > totalPages - 1) setPreviewPage(Math.max(0, totalPages - 1));
  }, [totalPages]);

  const handleZoomIn = () => {
    setAutoFitZoom(false);
    setZoom(prev => Math.min(prev + 0.1, 3.0));
  };
  const handleZoomOut = () => {
    setAutoFitZoom(false);
    setZoom(prev => Math.max(prev - 0.1, 0.2));
  };

  // Auto-fit sheet to available width (so it "covers" the screen)
  useEffect(() => {
    if (!autoFitZoom) return;

    const el = scrollContainerRef.current;
    if (!el) return;

    // mmToPx uses: mm * 3.78 * (0.6 * zoom)
    // So at zoom=1, pxPerMm = 3.78 * 0.6
    const pxPerMmAtZoom1 = 3.78 * 0.6;
    const sheetPaddingPx = 16; // 8px left + 8px right (see sheet container style)
    const sheetWidthAtZoom1 = (PAGE_WIDTH_MM * pxPerMmAtZoom1) + sheetPaddingPx;

    const computeAndSet = () => {
      const available = el.clientWidth - 48; // small buffer for padding/scrollbar
      if (!Number.isFinite(available) || available <= 0 || sheetWidthAtZoom1 <= 0) return;

      const fitZoom = available / sheetWidthAtZoom1;
      setZoom(Math.max(0.2, Math.min(3.0, fitZoom)));
    };

    const raf = window.requestAnimationFrame(computeAndSet);
    window.addEventListener('resize', computeAndSet);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', computeAndSet);
    };
  }, [autoFitZoom, PAGE_WIDTH_MM, sidebarWidth, showSidebar]);

  const handleFrontUpload = (e) => {
    const files = Array.from(e.target.files);
    // Use the currently active customer (from top-level scope) to group these new cards with them
    const activeCustomerName = currentCustomer || undefined;

    const newImages = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      url: URL.createObjectURL(file),
      file,
      customBack: undefined,
      spotMask: undefined,
      customerName: activeCustomerName // Assign current customer so they fill slots
    }));
    setFrontImages(prev => [...prev, ...newImages]);
  };

  // Batch Upload Backs
  const handleBatchBackUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setFrontImages(prev => {
      const next = [...prev];
      files.forEach((file, index) => {
        if (index < next.length) {
          const url = URL.createObjectURL(file);
          next[index] = {
            ...next[index],
            customBack: url
          };
        }
      });
      return next;
    });
    e.target.value = null;
  };

  // Batch Upload Spot Masks
  const handleBatchSpotMaskUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setFrontImages(prev => {
      const next = [...prev];
      files.forEach((file, index) => {
        if (index < next.length) {
          const url = URL.createObjectURL(file);
          next[index] = {
            ...next[index],
            spotMask: url
          };
        }
      });
      return next;
    });
    e.target.value = null;
  };

  const replaceFrontImage = (e, index) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);

    setFrontImages(prev => {
      const next = [...prev];
      if (next[index].url) URL.revokeObjectURL(next[index].url);
      next[index] = {
        ...next[index],
        url,
        file
      };
      return next;
    });
    e.target.value = null;
  };

  const handleBackUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setBackImage(URL.createObjectURL(file));
    }
  };

  const handleOverlayUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setTemplateOverlay(URL.createObjectURL(file));
    }
  };

  const removeFrontImage = (index) => {
    setFrontImages(prev => prev.filter((_, i) => i !== index));
  };

  const updateConfig = (key, value) => {
    if (key === 'targetDPI') {
      setConfig(prev => ({ ...prev, targetDPI: LOCKED_TARGET_DPI }));
      return;
    }
    let newValue = value;
    if (value !== '' && value !== '-' && !isNaN(parseFloat(value))) {
      newValue = parseFloat(value);
    }
    setConfig(prev => ({ ...prev, [key]: newValue }));
  };

  const getConfigNum = (key) => {
    const val = parseFloat(config[key]);
    return isNaN(val) ? 0 : val;
  };

  const handleNumberKeyDown = (e, key) => {
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const currentVal = getConfigNum(key);
      const step = 1.0;
      const direction = e.key === 'ArrowUp' ? 1 : -1;
      const newValue = parseFloat((currentVal + (step * direction)).toFixed(1));
      updateConfig(key, newValue);
    }
  };

  const updateStringConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const readUpscaledFrontCache = () => {
    try {
      return JSON.parse(localStorage.getItem(UPSCALED_FRONT_CACHE_KEY) || '{}');
    } catch (error) {
      console.warn('Failed to read upscaled front cache:', error);
      return {};
    }
  };

  const getCachedFrontUrl = (originalUrl) => {
    if (!originalUrl) return originalUrl;
    const cache = readUpscaledFrontCache();
    return cache[originalUrl] || originalUrl;
  };

  const rememberUpscaledFrontUrl = (originalUrl, upscaledUrl) => {
    if (!originalUrl || !upscaledUrl) return;
    try {
      const cache = readUpscaledFrontCache();
      localStorage.setItem(UPSCALED_FRONT_CACHE_KEY, JSON.stringify({
        ...cache,
        [originalUrl]: upscaledUrl,
      }));
    } catch (error) {
      console.warn('Failed to save upscaled front cache:', error);
    }
  };

  const persistUpscaledFrontToOrder = async (card, upscaledUrl) => {
    if (!card?.orderId || !upscaledUrl) return;

    const order = await fetchOrderById(card.orderId);

    if (Number.isInteger(card.cardDataIndex)) {
      const cardData = typeof order.card_data === 'string'
        ? JSON.parse(order.card_data)
        : (order.card_data || []);

      if (!Array.isArray(cardData) || !cardData[card.cardDataIndex]) return;

      const updatedCardData = cardData.map((item, index) => (
        index === card.cardDataIndex
          ? { ...item, frontUrl: upscaledUrl, originalFrontUrl: item.originalFrontUrl || item.frontUrl }
          : item
      ));

      await updateOrderCardData(card.orderId, updatedCardData);
      return;
    }

    if (Number.isInteger(card.cardImagesIndex)) {
      const cardImages = typeof order.card_images === 'string'
        ? JSON.parse(order.card_images)
        : (order.card_images || []);

      if (!Array.isArray(cardImages) || !cardImages[card.cardImagesIndex]) return;

      const updatedCardImages = [...cardImages];
      updatedCardImages[card.cardImagesIndex] = upscaledUrl;
      await updateOrderCardImages(card.orderId, updatedCardImages);
    }
  };

  const requestUpscale = async (imageUrl, requestId, onStatus) => {
    if (!UPSCALE_API_URL) {
      throw new Error('Missing VITE_UPSCALE_API_URL. Point it to your Real-ESRGAN API server.');
    }

    const postUpscale = async (body) => {
      const response = await fetch(`${UPSCALE_API_URL}/upscale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(UPSCALE_API_KEY ? { Authorization: `Bearer ${UPSCALE_API_KEY}` } : {}),
        },
        body: JSON.stringify(body),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Upscale failed with HTTP ${response.status}.`);
      }

      return payload;
    };

    const startedAt = Date.now();
    let payload = await postUpscale({ imageUrl, requestId });

    while (!payload.imageUrl) {
      if (!payload.jobId) {
        throw new Error('Upscale server did not return an image or job id.');
      }

      if (Date.now() - startedAt > UPSCALE_POLL_TIMEOUT_MS) {
        throw new Error('Upscale timed out. The RunPod job may still finish in the background.');
      }

      if (typeof onStatus === 'function') {
        onStatus(payload.status || 'IN_PROGRESS');
      }

      await new Promise(resolve => setTimeout(resolve, UPSCALE_POLL_INTERVAL_MS));
      payload = await postUpscale({ jobId: payload.jobId });
    }

    return payload.imageUrl;
  };

  const upscaleLoadedImages = async () => {
    if (frontImages.length === 0 || isUpscaling) return;

    const tasks = [];
    const cardsToUpscale = customerPages
      .flatMap((page) => page.entries || [])
      .map((entry) => entry.card)
      .filter(Boolean);
    const seenTasks = new Set();

    const addTask = (card, field, imageUrl) => {
      const taskKey = `${card.id}-${field}`;
      if (!imageUrl || seenTasks.has(taskKey)) return;
      seenTasks.add(taskKey);
      tasks.push({
        card,
        cardId: card.id,
        field,
        imageUrl,
        orderId: card.orderId,
        cardDataIndex: card.cardDataIndex,
      });
    };

    cardsToUpscale.forEach((card) => {
      if (card?.url) {
        addTask(card, 'url', card.url);
      }
    });

    if (tasks.length === 0) return;

    setIsUpscaling(true);
    setUpscaleProgress({ completed: 0, total: tasks.length, label: 'Starting upscale' });

    try {
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        setUpscaleProgress({
          completed: index,
          total: tasks.length,
          label: `Upscaling front ${index + 1} of ${tasks.length}`,
        });

        const upscaledUrl = await requestUpscale(
          task.imageUrl,
          `${task.cardId}-${task.field}`,
          (status) => {
            setUpscaleProgress({
              completed: index,
              total: tasks.length,
              label: `${status.replace(/_/g, ' ').toLowerCase()} ${index + 1} of ${tasks.length}`,
            });
          }
        );
        const applyUpscaledImage = (cards) => cards.map((card) => (
          card.id === task.cardId
            ? { ...card, [task.field]: upscaledUrl, upscaled: true }
            : card
        ));

        rememberUpscaledFrontUrl(task.imageUrl, upscaledUrl);
        try {
          await persistUpscaledFrontToOrder(task.card, upscaledUrl);
        } catch (persistError) {
          console.error('Upscaled image saved locally but failed to update Supabase order card_data:', persistError);
        }
        setFrontImages(applyUpscaledImage);
        setAllLoadedCards(applyUpscaledImage);
        setUpscaleProgress({
          completed: index + 1,
          total: tasks.length,
          label: `Upscaled ${index + 1} of ${tasks.length}`,
        });
      }
    } catch (error) {
      console.error('Upscale failed:', error);
      alert(error.message || 'Upscale failed.');
    } finally {
      setIsUpscaling(false);
      window.setTimeout(() => {
        setUpscaleProgress({ completed: 0, total: 0, label: '' });
      }, 1200);
    }
  };

  const handleIndividualBackUpload = (e, index) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFrontImages(prev => {
      const next = [...prev];
      next[index] = { ...next[index], customBack: url };
      return next;
    });
    e.target.value = null;
  };

  const handleIndividualSpotMaskUpload = (e, index) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFrontImages(prev => {
      const next = [...prev];
      next[index] = { ...next[index], spotMask: url };
      return next;
    });
    e.target.value = null;
  };

  const clearIndividualBack = (index) => {
    setFrontImages(prev => {
      const next = [...prev];
      next[index] = { ...next[index], customBack: null };
      return next;
    });
  };

  const revertIndividualBack = (index) => {
    setFrontImages(prev => {
      const next = [...prev];
      const { customBack, ...rest } = next[index];
      next[index] = rest;
      return next;
    });
  };

  // --- Preset & Project Logic ---
  const exportPreset = () => {
    const name = presetName.trim() || 'Untitled_Preset';
    const presetData = {
      version: '1.0',
      type: 'layout_preset',
      name: name,
      config: config
    };
    const blob = new Blob([JSON.stringify(presetData, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()} _preset.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const importPreset = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.config && confirm(`Load preset "${data.name || file.name}" ? `)) {
          setConfig({ ...INITIAL_CONFIG, ...data.config });
        }
      } catch (err) { alert("Invalid Preset"); }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const savePreset = () => {
    if (!presetName.trim()) return;
    const newPreset = { name: presetName, config: { ...config } };
    const updatedPresets = [...savedPresets, newPreset];
    setSavedPresets(updatedPresets);
    localStorage.setItem('cardBatcherPresets', JSON.stringify(updatedPresets));
    setPresetName('');
    alert(`Preset "${presetName}" saved!`);
  };

  const loadPreset = (preset) => {
    if (confirm(`Load preset "${preset.name}" ? `)) {
      setConfig({ ...INITIAL_CONFIG, ...preset.config });
    }
  };

  const deletePreset = (index) => {
    const updated = savedPresets.filter((_, i) => i !== index);
    setSavedPresets(updated);
    localStorage.setItem('cardBatcherPresets', JSON.stringify(updated));
  };

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

  // Reorganize cards to group by customer
  const reorganizeCardsByCustomer = (cards) => {
    // Separate cards with and without customer names
    const cardsWithCustomer = cards.filter(card => card.customerName);
    const cardsWithoutCustomer = cards.filter(card => !card.customerName);

    // Group cards by customer
    const cardsByCustomer = {};
    cardsWithCustomer.forEach(card => {
      const customerName = card.customerName || 'Unknown Customer';
      if (!cardsByCustomer[customerName]) {
        cardsByCustomer[customerName] = [];
      }
      cardsByCustomer[customerName].push(card);
    });

    // Reorganize: all cards from customer 1, then all from customer 2, etc.
    // Preserve the original order (don't alphabetically sort - maintains date-based order)
    const reorganized = [];
    Object.keys(cardsByCustomer).forEach(customerName => {
      reorganized.push(...cardsByCustomer[customerName]);
    });

    // Add cards without customer names at the end
    reorganized.push(...cardsWithoutCustomer);

    return reorganized;
  };

  // Load paid orders and populate cards grouped by customer
  const loadPaidOrders = async (isAutoLoad = false) => {
    setIsLoadingPaidOrders(true);
    try {
      const paidOrders = await fetchPaidOrdersForBatcher();

      if (paidOrders.length === 0) {
        if (!isAutoLoad) {
          alert('No paid orders found.');
        }
        setIsLoadingPaidOrders(false);
        setPaidOrdersLoaded(true);
        return;
      }

      // Extract unique dates from orders
      const uniqueDates = new Set();
      paidOrders.forEach(order => {
        if (order.created_at) {
          // Format date as YYYY-MM-DD
          const dateStr = new Date(order.created_at).toISOString().split('T')[0];
          uniqueDates.add(dateStr);
        }
      });

      // Sort dates in descending order (newest first)
      const sortedDates = Array.from(uniqueDates).sort((a, b) => b.localeCompare(a));
      setAvailableDates(sortedDates);

      // Sort orders by date (newest first) so recent orders appear at position 1
      const sortedPaidOrders = [...paidOrders].sort((a, b) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA; // Descending order (newest first)
      });

      // Group orders by customer name (maintaining newest-first order within each customer)
      const ordersByCustomer = {};
      sortedPaidOrders.forEach(order => {
        const customerName = order.customer_name || 'Unknown Customer';
        if (!ordersByCustomer[customerName]) {
          ordersByCustomer[customerName] = [];
        }
        ordersByCustomer[customerName].push(order);
      });

      // Process cards from each customer
      const newCards = [];

      // Sort customers by their most recent order date (newest first)
      const sortedCustomerNames = Object.keys(ordersByCustomer).sort((a, b) => {
        const aNewestOrder = ordersByCustomer[a][0]; // First order is newest due to earlier sort
        const bNewestOrder = ordersByCustomer[b][0];
        const dateA = aNewestOrder?.created_at ? new Date(aNewestOrder.created_at).getTime() : 0;
        const dateB = bNewestOrder?.created_at ? new Date(bNewestOrder.created_at).getTime() : 0;
        return dateB - dateA; // Customers with newest orders come first
      });

      sortedCustomerNames.forEach(customerName => {
        const customerOrders = ordersByCustomer[customerName];

        customerOrders.forEach(order => {
          const orderDate = order.created_at ? new Date(order.created_at).toISOString().split('T')[0] : null;

          const cardData = typeof order.card_data === 'string'
            ? JSON.parse(order.card_data)
            : (order.card_data || []);
          const isProModeOrder = order.metadata?.proMode === true || order.metadata?.pro_mode === true;

          if (cardData.length > 0) {
            // Use structured card_data which has explicit frontUrl/backUrl — immune to positional drift
            cardData.forEach((card, cardDataIndex) => {
              const frontUrl = isProModeOrder
                ? (card.originalFrontUrl || card.originalFront || card.frontUrl)
                : card.frontUrl;
              const backUrl = isProModeOrder
                ? (card.originalBackUrl || card.originalBack || card.backUrl)
                : card.backUrl;
              if (!frontUrl) return;
              newCards.push({
                id: Math.random().toString(36).substr(2, 9),
                url: isProModeOrder
                  ? getOrderImageUrl(frontUrl)
                  : getCachedFrontUrl(getOrderImageUrl(frontUrl)),
                file: null,
                customBack: backUrl ? getOrderImageUrl(backUrl) : null,
                spotMask: card.silverMask ? getOrderImageUrl(card.silverMask) : undefined,
                customerName: customerName,
                orderId: order.id,
                orderDate: orderDate,
                cardDataIndex
              });
            });
            return;
          }

          // Fallback: positional parsing of card_images for orders without card_data
          const cardImages = typeof order.card_images === 'string'
            ? JSON.parse(order.card_images)
            : (order.card_images || []);

          if (cardImages.length === 0) return;

          const isBack = (path) => {
            if (!path) return false;
            const p = path.toLowerCase();
            return p.endsWith('/back.jpeg') || p.endsWith('/back.jpg') || p.endsWith('/back.png') || p.includes('_back.') || p.includes('-back.');
          };

          let i = 0;
          while (i < cardImages.length) {
            const currentIndex = getNextNonEmptyImageIndex(cardImages, i);
            if (currentIndex === -1) break;

            const current = cardImages[currentIndex];

            if (!current || current === '' || isMask(current) || isBack(current)) {
              i = currentIndex + 1;
              continue;
            }

            const front = current;
            let back = null;
            let mask = null;
            let nextIndex = currentIndex + 1;

            const backIndex = getNextNonEmptyImageIndex(cardImages, currentIndex + 1);
            if (backIndex !== -1) {
              const backCandidate = cardImages[backIndex];
              if (backCandidate && !isMask(backCandidate) && !isBack(backCandidate)) {
                // Next non-empty is another front — this card has no back
              } else if (backCandidate && isBack(backCandidate)) {
                back = backCandidate;
                nextIndex = backIndex + 1;

                const maskIndex = getNextNonEmptyImageIndex(cardImages, backIndex + 1);
                if (maskIndex !== -1 && isMask(cardImages[maskIndex])) {
                  mask = cardImages[maskIndex];
                  nextIndex = maskIndex + 1;
                }
              } else if (backCandidate && !isMask(backCandidate)) {
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

            newCards.push({
              id: Math.random().toString(36).substr(2, 9),
              url: getCachedFrontUrl(getOrderImageUrl(front)),
              file: null,
              customBack: back ? getOrderImageUrl(back) : null,
              spotMask: mask ? getOrderImageUrl(mask) : undefined,
              customerName: customerName,
              orderId: order.id,
              orderDate: orderDate,
              cardImagesIndex: currentIndex
            });

            i = nextIndex;
          }
        });
      });

      // Store all cards and set them as frontImages
      const reorganizedCards = reorganizeCardsByCustomer(newCards);
      setAllLoadedCards(reorganizedCards);
      setFrontImages(reorganizedCards);

      setPaidOrdersLoaded(true);

      // Only show alert if manually triggered (not auto-load)
      if (!isAutoLoad) {
        alert(`Loaded ${newCards.length} cards from ${Object.keys(ordersByCustomer).length} paid customer(s).`);
      } else {
        console.log(`Auto-loaded ${newCards.length} cards from ${Object.keys(ordersByCustomer).length} paid customer(s).`);
      }
    } catch (error) {
      console.error('Error loading paid orders:', error);
      if (!isAutoLoad) {
        alert('Failed to load paid orders. Please try again.');
      }
      setPaidOrdersLoaded(true); // Mark as loaded even on error to prevent retry loops
    } finally {
      setIsLoadingPaidOrders(false);
    }
  };

  // Filter cards by selected date
  useEffect(() => {
    if (!selectedDate) {
      // Show all cards when no date is selected
      setFrontImages(allLoadedCards);
    } else {
      // Filter cards by selected date
      const filtered = allLoadedCards.filter(card => card.orderDate === selectedDate);
      setFrontImages(filtered);
    }
  }, [selectedDate, allLoadedCards]);

  // Get card count for each customer
  const getCustomerCardCount = (customerName) => {
    return frontImages.filter(card => (card.customerName || 'Unknown Customer') === customerName).length;
  };

  // Navigate to previous customer
  const goToPreviousCustomer = () => {
    if (uniqueCustomers.length === 0) return;
    setCurrentCustomerIndex(prev => {
      const newIndex = prev <= 0 ? uniqueCustomers.length - 1 : prev - 1;
      return newIndex;
    });
    setPreviewPage(0); // Reset to first page of new customer
  };

  // Navigate to next customer - smart behavior based on current page state
  const goToNextCustomer = () => {
    if (uniqueCustomers.length === 0) return;
    if (currentCustomerIndex >= uniqueCustomers.length - 1) {
      // Already at the last customer, wrap around to first
      setCurrentCustomerIndex(0);
      setMergeNextOrder(false);
      setPreviewPage(0);
      return;
    }

    // Check if we're on the LAST page of the current customer's order
    const isLastPage = previewPage >= customerPages.length - 1;

    // Check if current page has empty slots
    const currentPageEntries = customerPages[previewPage]?.entries?.length || 0;
    const hasEmptySlots = currentPageEntries < cardsPerPage;

    if (isLastPage && hasEmptySlots && !mergeNextOrder) {
      // On last page with empty slots - merge next order to fill them
      setMergeNextOrder(true);
      // Stay on same page to see slots being filled
    } else {
      // Navigate to next order (show only that order)
      setCurrentCustomerIndex(prev => prev + 1);
      setMergeNextOrder(false);
      setPreviewPage(0);
    }
  };

  // Reset customer index when customers list changes
  useEffect(() => {
    if (currentCustomerIndex >= uniqueCustomers.length) {
      setCurrentCustomerIndex(0);
    }
  }, [uniqueCustomers.length]);

  // Format date for display (e.g., "December 18, 2025")
  const formatDateForDisplay = (dateStr) => {
    if (!dateStr) return 'Unknown Date';
    const date = new Date(dateStr + 'T00:00:00'); // Add time to avoid timezone issues
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isDateDropdownOpen && !e.target.closest('.date-dropdown-container')) {
        setIsDateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDateDropdownOpen]);

  const urlToBase64 = async (url) => {
    if (!url) return null;
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  };

  const exportProject = async () => {
    setGenerating(true);
    setGenerationProgress(10);
    try {
      const frontsBase64 = await Promise.all(frontImages.map(async (img) => ({
        id: img.id,
        data: await urlToBase64(img.url),
        customBackData: img.customBack ? await urlToBase64(img.customBack) : undefined,
        customBackIsNull: img.customBack === null,
        spotMaskData: img.spotMask ? await urlToBase64(img.spotMask) : undefined
      })));
      const backBase64 = backImage ? await urlToBase64(backImage) : null;
      const overlayBase64 = templateOverlay ? await urlToBase64(templateOverlay) : null;
      const projectData = {
        version: '2.8',
        date: new Date().toISOString(),
        config,
        backImage: backBase64,
        templateOverlay: overlayBase64,
        frontImages: frontsBase64
      };
      const blob = new Blob([JSON.stringify(projectData)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `card-batcher-project-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setGenerationProgress(100);
    } catch (err) {
      console.error(err);
      alert("Failed to export project.");
    }
    setGenerating(false);
  };

  const importProject = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoadingProject(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!data.config || !Array.isArray(data.frontImages)) throw new Error("Invalid project file");
        setConfig({ ...INITIAL_CONFIG, ...data.config });
        setFrontImages(data.frontImages.map(img => ({
          id: img.id || Math.random().toString(36),
          url: img.data,
          customBack: img.customBackIsNull ? null : (img.customBackData || undefined),
          spotMask: img.spotMaskData || undefined,
          file: null
        })));
        setBackImage(data.backImage);
        setTemplateOverlay(data.templateOverlay);
        alert("Project loaded successfully!");
      } catch (err) {
        console.error(err);
        alert("Error loading project file.");
      }
      setIsLoadingProject(false);
    };
    reader.readAsText(file);
  };

  // Locked export path: this matches the canvas → JPEG workflow that the client
  // approved for PDF output quality.
  const processImageForPrintLocked = (imageUrl, widthMM, heightMM, rotate180 = false) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const widthPx = Math.ceil((widthMM / 25.4) * LOCKED_TARGET_DPI);
        const heightPx = Math.ceil((heightMM / 25.4) * LOCKED_TARGET_DPI);

        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = heightPx;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, widthPx, heightPx);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (rotate180) {
          ctx.translate(widthPx, heightPx);
          ctx.rotate(Math.PI);
        }

        ctx.drawImage(img, 0, 0, widthPx, heightPx);

        let quality = 0.92;
        if (LOCKED_TARGET_DPI >= 600) quality = 0.80;
        if (LOCKED_TARGET_DPI >= 1200) quality = 0.50;
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  };

  // Export scope modal (professional UI instead of window.confirm)
  const openExportScopeModal = (mode) => {
    const currentCustomerName = customerPages?.[previewPage]?.customerName;
    // If there's no customer context on this page, just export all (no prompt needed)
    if (!currentCustomerName) {
      if (mode === 'mask') generateSpotMaskPDF();
      else generatePDF();
      return;
    }
    setExportScopeModal({
      open: true,
      mode,
      customerName: currentCustomerName,
      selection: 'customer'
    });
  };

  const closeExportScopeModal = () => {
    setExportScopeModal(prev => ({ ...prev, open: false }));
  };

  // Close export modal on Escape
  useEffect(() => {
    if (!exportScopeModal.open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeExportScopeModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exportScopeModal.open]);

  const confirmExportScopeModal = () => {
    const { mode, selection, customerName } = exportScopeModal;
    closeExportScopeModal();

    let pagesOverride;
    if (selection === 'customer' && customerName) {
      const scopedCards = frontImages.filter(c => (c?.customerName || '').trim() === String(customerName).trim());
      pagesOverride = buildCustomerPages(scopedCards, cardsPerPage);
    }

    if (mode === 'mask') generateSpotMaskPDF(pagesOverride);
    else generatePDF(pagesOverride);
  };

  // --- PDF GENERATION: Main Artwork (chunked for large orders) ---
  const generatePDF = async (pagesOverride) => {
    setGenerating(true);
    setGenerationProgress(0);
    setGenerationLabel('Exporting PDF');
    setGenerationStartedAt(Date.now());
    await new Promise(resolve => setTimeout(resolve, 100));

    const MAX_SHEETS_PER_FILE = 20;

    try {
      const cWidth = getConfigNum('cardWidth');
      const cHeight = getConfigNum('cardHeight');
      const mTop = getConfigNum('marginTop');
      const mLeft = getConfigNum('marginLeft');
      const gHorz = getConfigNum('gapHorizontal');
      const gVert = getConfigNum('gapVertical');
      const shiftX = getConfigNum('backShiftX');
      const shiftY = getConfigNum('backShiftY');
      const cols = getConfigNum('gridCols');
      const printCutLines = config.printCutLines;

      const pages = pagesOverride || customerPages;
      const pageCount = pages.length;
      const chunkCount = Math.max(1, Math.ceil(pageCount / MAX_SHEETS_PER_FILE));
      const totalSteps = Math.max(1, pageCount * cardsPerPage * 2);
      let stepsCompleted = 0;

      for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx++) {
        const chunkStart = chunkIdx * MAX_SHEETS_PER_FILE;
        const chunkEnd = Math.min(chunkStart + MAX_SHEETS_PER_FILE, pageCount);

        const doc = new jsPDF({
          orientation: config.orientation,
          unit: 'mm',
          format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM],
          compress: false
        });

        const frontImageCache = {};
        let processedGlobalBack = null;
        let processedGlobalBackRotated = null;

        if (backImage) {
          try {
            processedGlobalBack = await processImageForPrintLocked(backImage, cWidth, cHeight, false);
            if (config.flipBackPage) {
              processedGlobalBackRotated = await processImageForPrintLocked(backImage, cWidth, cHeight, true);
            }
          } catch (e) {
            console.error('Back image failed to load (skipping backs).', e);
            processedGlobalBack = null;
            processedGlobalBackRotated = null;
          }
        }

        for (let p = chunkStart; p < chunkEnd; p++) {
          if (p > chunkStart) doc.addPage([PAGE_WIDTH_MM, PAGE_HEIGHT_MM], config.orientation);

          // --- Front Page ---
          const pageImages = (pages[p]?.entries || []).map(e => e.card);

          if (config.showRegMarks) drawRegistrationBar(doc, false);

          const customerName = pages[p]?.customerName;
          if (customerName) {
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(12);
            const headerY = Math.max(6, mTop - 2);
            doc.text(customerName, mLeft, headerY);
          }

          for (let i = 0; i < pageImages.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);

            const x = mLeft + (col * (cWidth + gHorz));
            const y = mTop + (row * (cHeight + gVert));

            if (pageImages[i]) {
              try {
                const cacheKey = `front::${pageImages[i].url}`;
                let highResImage = frontImageCache[cacheKey];
                if (!highResImage) {
                  highResImage = await processImageForPrintLocked(pageImages[i].url, cWidth, cHeight, false);
                  frontImageCache[cacheKey] = highResImage;
                }
                doc.addImage(highResImage, 'JPEG', x, y, cWidth, cHeight, cacheKey, 'FAST');

                if (printCutLines) {
                  doc.setDrawColor(200, 200, 200);
                  doc.setLineWidth(0.1);
                  doc.rect(x, y, cWidth, cHeight);
                }
              } catch (e) {
                console.error(e);
              }
            }
            stepsCompleted++;
            setGenerationProgress(Math.round((stepsCompleted / totalSteps) * 100));
            if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
          }

          // --- Back Page ---
          const hasAnyBacks = backImage || pageImages.some(img => img?.customBack);

          if (hasAnyBacks) {
            doc.addPage([PAGE_WIDTH_MM, PAGE_HEIGHT_MM], config.orientation);
            if (config.showRegMarks) drawRegistrationBar(doc, true);

            for (let i = 0; i < pageImages.length; i++) {
              const card = pageImages[i];
              const col = i % cols;
              const row = Math.floor(i / cols);

              const frontBaseX = mLeft + (col * (cWidth + gHorz));
              const frontBaseY = mTop + (row * (cHeight + gVert));

              let x, y;
              let useRotatedImage = false;

              if (config.flipBackPage) {
                x = frontBaseX + shiftX;
                y = PAGE_HEIGHT_MM - frontBaseY - cHeight + shiftY;
                useRotatedImage = true;
              } else {
                x = PAGE_WIDTH_MM - frontBaseX - cWidth + shiftX;
                y = frontBaseY + shiftY;
                useRotatedImage = false;
              }

              let sourceToUse = null;
              let aliasId = null;

              if (card.customBack !== undefined) {
                if (card.customBack === null) {
                  sourceToUse = null;
                } else {
                  try {
                    const cacheKey = `back::${card.customBack}::${useRotatedImage ? 'r' : 'n'}`;
                    let cached = frontImageCache[cacheKey];
                    if (!cached) {
                      cached = await processImageForPrintLocked(card.customBack, cWidth, cHeight, useRotatedImage);
                      frontImageCache[cacheKey] = cached;
                    }
                    sourceToUse = cached;
                    aliasId = cacheKey;
                  } catch (e) {
                    console.error('Custom back failed to load (skipping this back).', e);
                    sourceToUse = null;
                  }
                }
              } else {
                sourceToUse = useRotatedImage ? processedGlobalBackRotated : processedGlobalBack;
                aliasId = useRotatedImage ? 'global-back-rot' : 'global-back';
              }

              if (sourceToUse) {
                doc.addImage(sourceToUse, 'JPEG', x, y, cWidth, cHeight, aliasId, 'FAST');

                if (printCutLines) {
                  doc.setDrawColor(200, 200, 200);
                  doc.setLineWidth(0.1);
                  doc.rect(x, y, cWidth, cHeight);
                }
              }

              stepsCompleted++;
              setGenerationProgress(Math.round((stepsCompleted / totalSteps) * 100));
              if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
            }
          }
        }

        const partSuffix = chunkCount > 1 ? `-part${chunkIdx + 1}` : '';
        setGenerationLabel(`Saving PDF file${partSuffix}`);

        const arrayBuffer = doc.output('arraybuffer');
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `card-sheet-${LOCKED_TARGET_DPI}dpi${partSuffix}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 0);

        if (chunkIdx < chunkCount - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      setGenerationProgress(100);
    } catch (err) {
      console.error("PDF Gen Error", err);
      alert("Failed to generate PDF.");
    }
    setGenerationLabel('');
    setGenerationStartedAt(null);
    setGenerating(false);
  };

  // --- PDF Generation: Spot Mask Only (chunked, With Sync Blanks) ---
  const generateSpotMaskPDF = async (pagesOverride) => {
    setGenerating(true);
    setGenerationProgress(0);
    setGenerationLabel('Exporting mask PDF');
    setGenerationStartedAt(Date.now());
    await new Promise(resolve => setTimeout(resolve, 100));

    const MAX_SHEETS_PER_FILE = 20;

    try {
      const cWidth = getConfigNum('cardWidth');
      const cHeight = getConfigNum('cardHeight');
      const mTop = getConfigNum('marginTop');
      const mLeft = getConfigNum('marginLeft');
      const gHorz = getConfigNum('gapHorizontal');
      const gVert = getConfigNum('gapVertical');
      const cols = getConfigNum('gridCols');

      const pages = pagesOverride || customerPages;
      const pageCount = pages.length;
      const hasAnyBacks = backImage || frontImages.some(img => img.customBack);
      const chunkCount = Math.max(1, Math.ceil(pageCount / MAX_SHEETS_PER_FILE));

      let stepsCompleted = 0;
      const totalSteps = Math.max(1, pageCount * 2);

      for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx++) {
        const chunkStart = chunkIdx * MAX_SHEETS_PER_FILE;
        const chunkEnd = Math.min(chunkStart + MAX_SHEETS_PER_FILE, pageCount);

        const doc = new jsPDF({
          orientation: config.orientation,
          unit: 'mm',
          format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM],
          compress: false
        });

        const spotImageCache = {};

        for (let p = chunkStart; p < chunkEnd; p++) {
          if (p > chunkStart) doc.addPage([PAGE_WIDTH_MM, PAGE_HEIGHT_MM], config.orientation);

          const pageImages = (pages[p]?.entries || []).map(e => e.card);

          if (config.showRegMarks) drawRegistrationBar(doc, false);

          const customerName = pages[p]?.customerName;
          if (customerName) {
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(12);
            const headerY = Math.max(6, mTop - 2);
            doc.text(customerName, mLeft, headerY);
          }

          for (let i = 0; i < pageImages.length; i++) {
            const col = i % cols;
            const row = Math.floor(i / cols);

            const x = mLeft + (col * (cWidth + gHorz));
            const y = mTop + (row * (cHeight + gVert));

            if (pageImages[i] && pageImages[i].spotMask) {
              try {
                const cacheKey = `mask::${pageImages[i].spotMask}`;
                let maskImage = spotImageCache[cacheKey];
                if (!maskImage) {
                  maskImage = await processImageForPrintLocked(pageImages[i].spotMask, cWidth, cHeight, false);
                  spotImageCache[cacheKey] = maskImage;
                }
                doc.addImage(maskImage, 'JPEG', x, y, cWidth, cHeight, cacheKey, 'FAST');
              } catch (e) { console.error(e); }
            }
          }
          stepsCompleted++;
          setGenerationProgress(Math.round((stepsCompleted / totalSteps) * 100));

          if (hasAnyBacks) {
            doc.addPage([PAGE_WIDTH_MM, PAGE_HEIGHT_MM], config.orientation);
          }
          stepsCompleted++;
          setGenerationProgress(Math.round((stepsCompleted / totalSteps) * 100));
          await new Promise(r => setTimeout(r, 0));
        }

        const partSuffix = chunkCount > 1 ? `-part${chunkIdx + 1}` : '';
        setGenerationLabel(`Saving mask PDF file${partSuffix}`);

        const arrayBuffer = doc.output('arraybuffer');
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `card-sheet-SPOT-MASK${partSuffix}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 0);

        if (chunkIdx < chunkCount - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      setGenerationProgress(100);
    } catch (err) {
      console.error("Spot PDF Gen Error", err);
      alert("Failed to generate Spot PDF.");
    }
    setGenerationLabel('');
    setGenerationStartedAt(null);
    setGenerating(false);
  };


  const drawRegistrationBar = (doc, isBackPage) => {
    doc.setFillColor(0, 0, 0);
    const regX = getConfigNum('regMarkX');
    const regY = getConfigNum('regMarkY');
    const w = getConfigNum('regMarkWidth');
    const h = getConfigNum('regMarkHeight');
    const shiftX = getConfigNum('backShiftX');
    const shiftY = getConfigNum('backShiftY');

    let x = regX;
    let y = regY;

    if (isBackPage) {
      if (config.flipBackPage) {
        x = regX + shiftX;
        y = PAGE_HEIGHT_MM - regY - h + shiftY;
      } else {
        x = PAGE_WIDTH_MM - regX - w + shiftX;
        y = regY + shiftY;
      }
    }

    if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
      doc.rect(x, y, w, h, 'F');
    }
  };

  // --- Render Helpers ---
  const displayScale = 0.6 * zoom;
  const mmToPx = (mm) => mm * 3.78 * displayScale;
  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
  };
  const progressPercent = Math.max(0, Math.min(100, Math.round(generationProgress || 0)));
  const upscalePercent = upscaleProgress.total
    ? Math.round((upscaleProgress.completed / upscaleProgress.total) * 100)
    : 0;
  const elapsedSeconds = generationStartedAt
    ? Math.max(0, Math.round((Date.now() - generationStartedAt) / 1000))
    : 0;
  const estimatedRemainingSeconds = generating && progressPercent >= 5
    ? Math.max(0, Math.round((elapsedSeconds * (100 - progressPercent)) / progressPercent))
    : null;
  const elapsedLabel = formatDuration(elapsedSeconds);
  const remainingLabel = formatDuration(estimatedRemainingSeconds);

  // Provide context value (after all handlers are defined)
  const contextValue = {
    config,
    setConfig,
    frontImages,
    setFrontImages,
    backImage,
    setBackImage,
    templateOverlay,
    setTemplateOverlay,
    presetName,
    setPresetName,
    savedPresets,
    setSavedPresets,
    isLoadingProject,
    setIsLoadingProject,
    generating,
    sidebarGridCols,
    setSidebarGridCols,
    fileInputRef,
    updateConfig,
    updateStringConfig,
    handleNumberKeyDown,
    handleFrontUpload,
    handleBackUpload,
    handleBatchBackUpload,
    handleBatchSpotMaskUpload,
    handleOverlayUpload,
    removeFrontImage,
    exportPreset,
    importPreset,
    exportProject,
    importProject
  };

  const exportModalCustomerName = exportScopeModal.customerName;
  const exportModalCustomerCount = exportModalCustomerName
    ? frontImages.filter(c => (c?.customerName || '').trim() === String(exportModalCustomerName).trim()).length
    : 0;
  const exportModalTotalCount = frontImages.length;
  const exportModalCustomerSheets = exportModalCustomerCount ? Math.ceil(exportModalCustomerCount / cardsPerPage) : 0;
  const exportModalTotalSheets = exportModalTotalCount ? Math.ceil(exportModalTotalCount / cardsPerPage) : 0;

  // If showSidebar is false, render Dashboard layout
  if (!showSidebar) {
    return (
      <BatcherPROContext.Provider value={contextValue}>
        <div className="dashboard-container">
          <BeautifulExportModal
            isOpen={exportScopeModal.open}
            onClose={closeExportScopeModal}
            onConfirm={confirmExportScopeModal}
            mode={exportScopeModal.mode}
            customerName={exportModalCustomerName}
            customerCount={exportModalCustomerCount}
            totalCount={exportModalTotalCount}
            customerSheets={exportModalCustomerSheets}
            totalSheets={exportModalTotalSheets}
            generating={generating}
            selection={exportScopeModal.selection}
            onSelectionChange={(value) => setExportScopeModal(prev => ({ ...prev, selection: value }))}
          />
          <aside className="sidebar">
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
                marginTop: '1rem',
                paddingLeft: '1rem'
              }}>
                Navigation
              </div>
              <div
                className="nav-item"
                onClick={onBackToDashboard}
              >
                <span>⬅️</span> Back to Dashboard
              </div>
            </nav>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <BatcherPROSidebar />
            </div>
          </aside>
          <main className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--bg-primary)' }}>
            <div className="min-h-screen w-full bg-slate-800 text-slate-100 font-sans flex flex-col select-none" style={{ flex: 1 }}>

              {/* Header */}
              <header className="bg-slate-900 text-white p-4 shadow-lg flex justify-between items-center z-[200]">
                <div className="flex items-center gap-3">
                  <Layers className="text-blue-400" />
                  <h1 className="text-xl font-bold tracking-wider">CardBatcher<span className="text-blue-400">Pro</span></h1>
                </div>

                {/* Tool Bar */}
                <div className="flex items-center gap-4">
                  {/* Interaction Tools */}
                  <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
                    <button
                      onClick={() => setActiveTool('select')}
                      className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${activeTool === 'select' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'} `}
                      title="Select Mode"
                    >
                      <MousePointer2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setActiveTool('pan')}
                      className={`w-8 h-8 p-1 rounded transition-colors ${activeTool === 'pan' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'} `}
                      title="Pan Tool (Space)"
                    >
                      <Hand className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Side Toggle */}
                  <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1 border border-slate-700">
                    <button
                      onClick={() => setPreviewSide('front')}
                      className={`shrink-0 whitespace-nowrap min-w-[92px] min-h-[30px] px-4 py-1.5 rounded text-xs font-bold leading-none transition-all flex items-center justify-center gap-2 ${previewSide === 'front'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                        }`}
                    >
                      <Eye className="w-3 h-3" /> Front
                    </button>
                    <button
                      onClick={() => setPreviewSide('back')}
                      className={`shrink-0 whitespace-nowrap min-w-[92px] min-h-[30px] px-4 py-1.5 rounded text-xs font-bold leading-none transition-all flex items-center justify-center gap-2 ${previewSide === 'back'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                        }`}
                    >
                      <RotateCcw className="w-3 h-3" /> Back
                    </button>

                    {/* Date Filter Dropdown - Always visible */}
                    <div className="relative date-dropdown-container ml-1">
                      <button
                        onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors text-xs font-semibold min-w-[160px] justify-between"
                        title="Filter by order date"
                      >
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-blue-400" />
                          <span className="truncate">
                            {selectedDate ? formatDateForDisplay(selectedDate) : 'All Dates'}
                          </span>
                        </div>
                        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isDateDropdownOpen ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Dropdown Menu */}
                      {isDateDropdownOpen && (
                        <div className="absolute top-full right-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-[100] overflow-hidden">
                          <div className="max-h-80 overflow-y-auto">
                            {/* All Dates Option */}
                            <button
                              onClick={() => {
                                setSelectedDate(null);
                                setIsDateDropdownOpen(false);
                              }}
                              className={`w-full px-4 py-2.5 text-left text-xs font-medium transition-colors flex items-center gap-2 ${!selectedDate
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-300 hover:bg-slate-700'
                                }`}
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              <span>All Dates</span>
                              <span className="ml-auto text-[10px] bg-blue-500 px-1.5 py-0.5 rounded">
                                {allLoadedCards.length || frontImages.length} cards
                              </span>
                            </button>

                            {/* Individual Date Options */}
                            {availableDates.length > 0 ? (
                              availableDates.map((date) => {
                                const cardCount = allLoadedCards.filter(card => card.orderDate === date).length;
                                return (
                                  <button
                                    key={date}
                                    onClick={() => {
                                      setSelectedDate(date);
                                      setIsDateDropdownOpen(false);
                                    }}
                                    className={`w-full px-4 py-2.5 text-left text-xs font-medium transition-colors flex items-center gap-2 border-t border-slate-700/50 ${selectedDate === date
                                      ? 'bg-blue-600 text-white'
                                      : 'text-slate-300 hover:bg-slate-700'
                                      }`}
                                  >
                                    <Calendar className="w-3.5 h-3.5" />
                                    <span className="flex-1 truncate">{formatDateForDisplay(date)}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${selectedDate === date
                                      ? 'bg-blue-500'
                                      : 'bg-slate-600'
                                      }`}>
                                      {cardCount} cards
                                    </span>
                                  </button>
                                );
                              })
                            ) : (
                              <div className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-700/50">
                                No dates found in orders
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Customer/Order Navigation */}
                {uniqueCustomers.length > 0 && (
                  <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1 border border-slate-700">
                    <button
                      onClick={goToPreviousCustomer}
                      className="w-8 h-8 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                      title="Previous Order"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="px-3 py-1 text-xs font-semibold text-white min-w-[120px] text-center">
                      <span className="text-blue-400">{currentCustomerIndex + 1}</span>
                      <span className="text-slate-500"> / {uniqueCustomers.length}</span>
                      <div className="text-[10px] text-slate-400 truncate max-w-[100px]" title={currentCustomer}>
                        {currentCustomer || 'No Orders'}
                      </div>
                    </div>
                    <button
                      onClick={goToNextCustomer}
                      className="w-8 h-8 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                      title="Next Order"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={upscaleLoadedImages}
                    disabled={generating || isUpscaling || frontImages.length === 0 || !UPSCALE_API_URL}
                    title={!UPSCALE_API_URL ? 'Set VITE_UPSCALE_API_URL to enable Real-ESRGAN upscaling' : 'Upscale loaded front cards'}
                    className={`flex items-center justify-center gap-2 min-w-[140px] px-6 py-2 rounded-lg font-semibold transition-all text-xs ${generating || isUpscaling || frontImages.length === 0 || !UPSCALE_API_URL
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      : 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg hover:shadow-violet-500/30'
                      }`}
                  >
                    {isUpscaling ? <RefreshCw className="animate-spin w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                    {isUpscaling ? 'Upscaling' : 'Upscale'}
                  </button>
                  <button
                    onClick={() => openExportScopeModal('mask')}
                    disabled={generating || isUpscaling || frontImages.length === 0}
                    className="flex items-center justify-center gap-2 min-w-[140px] px-10 py-2 rounded-lg font-semibold transition-all text-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700"
                  >
                    {generating ? <RefreshCw className="animate-spin w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                    Export Mask
                  </button>
                  <button
                    onClick={() => openExportScopeModal('pdf')}
                    disabled={generating || isUpscaling || frontImages.length === 0}
                    className={`flex items-center justify-center gap-2 min-w-[140px] px-10 py-2 rounded-lg font-semibold transition-all ${generating || isUpscaling || frontImages.length === 0
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg hover:shadow-blue-500/30'
                      } `}
                  >
                    {generating ? <RefreshCw className="animate-spin w-4 h-4" /> : <Download className="w-4 h-4" />}
                    {generating ? `Processing` : 'Export PDF'}
                  </button>
                </div>
              </header>

              {isUpscaling && (
                <div className="bg-slate-950 border-b border-slate-800 px-4 py-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">
                        Real-ESRGAN upscaling
                      </div>
                      <div className="text-xs text-slate-400">
                        {upscaleProgress.label || 'Upscaling loaded images'} - {upscalePercent}% complete
                      </div>
                    </div>
                    <div className="w-full lg:max-w-md">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] duration-300"
                          style={{ width: `${upscalePercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {generating && (
                <div className="bg-slate-950 border-b border-slate-800 px-4 py-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">
                        {generationLabel || 'Exporting PDF'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {progressPercent}% complete
                        {remainingLabel ? ` • about ${remainingLabel} remaining` : ''}
                        {elapsedLabel ? ` • ${elapsedLabel} elapsed` : ''}
                      </div>
                    </div>
                    <div className="w-full lg:max-w-md">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-[width] duration-300"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <main className="flex-1 flex overflow-hidden h-[calc(100vh-64px)] w-full">

                {/* Left Sidebar: Configuration */}
                {showSidebar && (
                  <aside
                    ref={sidebarRef}
                    style={{ width: sidebarWidth }}
                    className="shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden z-10 shadow-xl relative"
                  >
                    {/* Scrollable Content Area */}
                    <div className="flex-1 overflow-y-auto">

                      <div className="p-6 border-b border-slate-100">
                        <h2 className="font-bold flex items-center gap-2 text-slate-700 mb-6">
                          <Settings className="w-4 h-4" /> Layout Settings
                        </h2>

                        <div className="space-y-6">

                          {/* Registration Bar */}
                          <div className="pb-6 border-b border-slate-100">
                            <div className="flex items-center justify-between mb-4">
                              <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <Move className="w-3 h-3" /> Registration Bar
                              </label>
                              <input
                                type="checkbox"
                                checked={config.showRegMarks}
                                onChange={(e) => setConfig({ ...config, showRegMarks: e.target.checked })}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                              />
                            </div>

                            {config.showRegMarks && (
                              <div className="bg-slate-50 p-4 rounded border border-slate-100 space-y-4">
                                <div className="grid grid-cols-1 gap-3">
                                  <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-2">Width (mm)</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={config.regMarkWidth}
                                      onChange={(e) => updateConfig('regMarkWidth', e.target.value)}
                                      onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkWidth')}
                                      className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-2">Height (mm)</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={config.regMarkHeight}
                                      onChange={(e) => updateConfig('regMarkHeight', e.target.value)}
                                      onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkHeight')}
                                      className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                    />
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-3">
                                  <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-2">Pos X (mm)</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={config.regMarkX}
                                      onChange={(e) => updateConfig('regMarkX', e.target.value)}
                                      onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkX')}
                                      className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-2">Pos Y (mm)</label>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={config.regMarkY}
                                      onChange={(e) => updateConfig('regMarkY', e.target.value)}
                                      onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkY')}
                                      className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Margins */}
                          <div className="grid grid-cols-1 gap-5">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-2">Top Margin (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.marginTop}
                                onChange={(e) => updateConfig('marginTop', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'marginTop')}
                                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-2">Left Margin (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.marginLeft}
                                onChange={(e) => updateConfig('marginLeft', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'marginLeft')}
                                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                          </div>

                          {/* Gaps */}
                          <div className="grid grid-cols-1 gap-5">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-2">Gap X (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.gapHorizontal}
                                onChange={(e) => updateConfig('gapHorizontal', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'gapHorizontal')}
                                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-2">Gap Y (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.gapVertical}
                                onChange={(e) => updateConfig('gapVertical', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'gapVertical')}
                                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                          </div>

                          {/* Sheet Size Selection */}
                          <div className="bg-slate-50 p-4 rounded border border-slate-100">
                            <div className="flex items-center gap-2 mb-4">
                              <Layout className="w-3 h-3 text-slate-500" />
                              <label className="text-xs font-bold text-slate-600">Sheet Configuration</label>
                            </div>

                            <div className="space-y-4">
                              <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-2">Paper Size</label>
                                <select
                                  value={config.sheetSize}
                                  onChange={(e) => updateStringConfig('sheetSize', e.target.value)}
                                  className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                >
                                  {Object.entries(PAPER_SIZES).map(([key, val]) => (
                                    <option key={key} value={key}>{val.name}</option>
                                  ))}
                                </select>
                              </div>

                              <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold text-slate-500">Orientation</label>
                                <div className="flex bg-white border border-slate-200 rounded overflow-hidden">
                                  <button
                                    onClick={() => updateStringConfig('orientation', 'portrait')}
                                    className={`px-3 py-1.5 text-xs ${config.orientation === 'portrait' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-slate-500 hover:bg-slate-50'} `}
                                  >
                                    Portrait
                                  </button>
                                  <div className="w-[1px] bg-slate-200"></div>
                                  <button
                                    onClick={() => updateStringConfig('orientation', 'landscape')}
                                    className={`px-3 py-1.5 text-xs ${config.orientation === 'landscape' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-slate-500 hover:bg-slate-50'} `}
                                  >
                                    Landscape
                                  </button>
                                </div>
                              </div>

                              {config.sheetSize === 'custom' && (
                                <div className="grid grid-cols-1 gap-3">
                                  <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-2">W (mm)</label>
                                    <input
                                      type="number"
                                      value={config.customSheetWidth}
                                      onChange={(e) => updateConfig('customSheetWidth', e.target.value)}
                                      onKeyDown={(e) => handleNumberKeyDown(e, 'customSheetWidth')}
                                      className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-2">H (mm)</label>
                                    <input
                                      type="number"
                                      value={config.customSheetHeight}
                                      onChange={(e) => updateConfig('customSheetHeight', e.target.value)}
                                      onKeyDown={(e) => handleNumberKeyDown(e, 'customSheetHeight')}
                                      className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs"
                                    />
                                  </div>
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-500 mb-2">Columns</label>
                                  <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={config.gridCols}
                                    onChange={(e) => updateConfig('gridCols', e.target.value)}
                                    className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-500 mb-2">Rows</label>
                                  <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={config.gridRows}
                                    onChange={(e) => updateConfig('gridRows', e.target.value)}
                                    className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Card Dimensions */}
                          <div className="grid grid-cols-1 gap-5">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-2">Card Width (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.cardWidth}
                                onChange={(e) => updateConfig('cardWidth', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'cardWidth')}
                                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-2">Card Height (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.cardHeight}
                                onChange={(e) => updateConfig('cardHeight', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'cardHeight')}
                                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                              />
                            </div>
                          </div>

                          {/* Output Resolution Setting */}
                          <div className="bg-blue-50 p-4 rounded border border-blue-100">
                            <label className="block text-xs font-bold text-blue-700 mb-3 flex items-center gap-2">
                              <Printer className="w-3 h-3" /> Print Resolution (DPI)
                            </label>
                            <select
                              value={config.targetDPI}
                              onChange={(e) => updateConfig('targetDPI', parseInt(e.target.value))}
                              className="w-full p-2.5 bg-white border border-blue-200 rounded text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                              <option value="300">300 DPI (Standard)</option>
                              <option value="600">600 DPI (High Quality)</option>
                              <option value="1200">1200 DPI (Ultra Fine)</option>
                            </select>
                            <p className="text-xs text-blue-500 mt-2 leading-relaxed">
                              Note: 1200 DPI may take longer to process and create larger files.
                            </p>
                          </div>

                          {/* Print Cut Lines Option */}
                          <div className="flex items-center justify-between bg-white p-3 rounded border border-slate-200">
                            <label className="text-xs font-medium text-slate-600">Print Cut Lines (Dashed)</label>
                            <input
                              type="checkbox"
                              checked={config.printCutLines}
                              onChange={(e) => setConfig(p => ({ ...p, printCutLines: e.target.checked }))}
                              className="w-4 h-4 text-blue-600 rounded"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="p-6 border-b border-slate-100">
                        <h2 className="font-bold flex items-center gap-2 text-slate-700 mb-6">
                          <ImageIcon className="w-4 h-4" /> Assets
                        </h2>

                        <div className="space-y-6">
                          {/* Load Paid Orders - Moved to top for visibility */}
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-3">Auto-Load Paid Orders</label>
                            <button
                              onClick={() => loadPaidOrders(false)}
                              disabled={isLoadingPaidOrders}
                              className="w-full flex items-center justify-center gap-2 h-12 border-2 border-dashed border-green-200 rounded-lg cursor-pointer bg-green-50 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isLoadingPaidOrders ? (
                                <>
                                  <RefreshCw className="w-4 h-4 text-green-500 animate-spin" />
                                  <span className="text-xs text-green-600 font-medium">Loading...</span>
                                </>
                              ) : (
                                <>
                                  <Download className="w-4 h-4 text-green-500" />
                                  <span className="text-xs text-green-600 font-medium">Reload Paid Orders</span>
                                </>
                              )}
                            </button>
                            <p className="text-xs text-slate-400 mt-2">
                              {paidOrdersLoaded ? 'Cards loaded automatically on page load' : 'Loading cards from paid orders...'}
                            </p>
                          </div>

                          {/* Front Upload */}
                          <div>
                            <div className="flex justify-between items-center mb-3">
                              <label className="block text-xs font-semibold text-slate-500">1. Batch Upload Fronts</label>
                            </div>
                            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-blue-200 rounded-lg cursor-pointer bg-blue-50 hover:bg-blue-100 transition-colors">
                              <div className="flex flex-col items-center justify-center pt-6 pb-6">
                                <Upload className="w-6 h-6 text-blue-400 mb-2" />
                                <p className="text-xs text-blue-500 font-medium">Click to upload cards</p>
                                <p className="text-xs text-blue-400 mt-1">{frontImages.length} cards loaded</p>
                              </div>
                              <input
                                type="file"
                                className="hidden"
                                multiple
                                accept="image/*"
                                onChange={handleFrontUpload}
                                ref={fileInputRef}
                              />
                            </label>
                          </div>

                          {/* Back Upload */}
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-3">2. Common Back Image</label>
                            <div className="flex gap-3 items-center">
                              <label className="flex-1 flex items-center justify-center h-12 border border-slate-200 rounded bg-white cursor-pointer hover:bg-slate-50 text-xs text-slate-600">
                                {backImage ? 'Change Back' : 'Upload Back'}
                                <input type="file" className="hidden" accept="image/*" onChange={handleBackUpload} />
                              </label>
                              {backImage && (
                                <>
                                  <img src={backImage} className="w-12 h-12 object-cover rounded border border-slate-300" alt="Back" />
                                  <button
                                    onClick={() => setBackImage(null)}
                                    className="w-12 h-12 flex items-center justify-center text-red-500 hover:bg-red-50 rounded border border-slate-200 shrink-0"
                                    title="Remove Back Image"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>

                            {/* Batch Unique Backs Upload */}
                            <div className="mt-4">
                              <label className="block text-xs font-semibold text-slate-500 mb-2">3. Batch Unique Backs</label>
                              <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                                <div className="flex flex-col items-center justify-center pt-3 pb-3">
                                  <Images className="w-4 h-4 text-slate-400 mb-1" />
                                  <p className="text-xs text-slate-500 font-medium">Batch Upload Backs (Sequential)</p>
                                </div>
                                <input
                                  type="file"
                                  className="hidden"
                                  multiple
                                  accept="image/*"
                                  onChange={handleBatchBackUpload}
                                />
                              </label>
                            </div>

                            {/* Batch Spot Mask Upload */}
                            <div className="mt-4">
                              <label className="block text-xs font-semibold text-slate-500 mb-2 flex items-center gap-2">
                                4. Batch Spot Masks (Silver) <Sparkles className="w-3 h-3 text-cyan-500" />
                              </label>
                              <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-cyan-100 rounded-lg cursor-pointer bg-cyan-50 hover:bg-cyan-100 transition-colors">
                                <div className="flex flex-col items-center justify-center pt-3 pb-3">
                                  <Sparkles className="w-4 h-4 text-cyan-400 mb-1" />
                                  <p className="text-xs text-cyan-600 font-medium">Batch Upload Masks (Sequential)</p>
                                </div>
                                <input
                                  type="file"
                                  className="hidden"
                                  multiple
                                  accept="image/*"
                                  onChange={handleBatchSpotMaskUpload}
                                />
                              </label>
                            </div>

                            {/* Duplex Toggle */}
                            <div className="mt-5 flex items-center justify-between bg-slate-50 p-3 rounded border border-slate-100">
                              <label className="text-xs font-semibold text-slate-600">Flip 180° (Duplex Fix)</label>
                              <input
                                type="checkbox"
                                checked={config.flipBackPage}
                                onChange={(e) => setConfig(p => ({ ...p, flipBackPage: e.target.checked }))}
                                className="w-4 h-4 text-blue-600 rounded"
                              />
                            </div>

                            {/* Back Shift / Offset Controls */}
                            <div className="mt-3 bg-slate-50 p-3 rounded border border-slate-100 space-y-3">
                              <div className="flex items-center gap-2">
                                <AlignCenterVertical className="w-3 h-3 text-slate-500" />
                                <label className="text-xs font-bold text-slate-600">Back Page Shift (mm)</label>
                              </div>
                              <div className="grid grid-cols-1 gap-3">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-400 mb-2">Shift X</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={config.backShiftX}
                                    onChange={(e) => updateConfig('backShiftX', e.target.value)}
                                    onKeyDown={(e) => handleNumberKeyDown(e, 'backShiftX')}
                                    className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                    placeholder="0.0"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-400 mb-2">Shift Y</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={config.backShiftY}
                                    onChange={(e) => updateConfig('backShiftY', e.target.value)}
                                    onKeyDown={(e) => handleNumberKeyDown(e, 'backShiftY')}
                                    className="w-full p-2.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                                    placeholder="0.0"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Template Overlay */}
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-3">3. Template Overlay (Guide)</label>
                            <div className="flex gap-3 items-center mb-3">
                              <label className="flex-1 flex items-center justify-center h-12 border border-slate-200 rounded bg-white cursor-pointer hover:bg-slate-50 text-xs text-slate-600">
                                {templateOverlay ? 'Change Overlay' : 'Upload Guide'}
                                <input type="file" className="hidden" accept="image/*" onChange={handleOverlayUpload} />
                              </label>
                              {templateOverlay && (
                                <button
                                  onClick={() => setTemplateOverlay(null)}
                                  className="w-12 h-12 flex items-center justify-center text-red-500 hover:bg-red-50 rounded border border-slate-200"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            {templateOverlay && (
                              <div>
                                <label className="flex justify-between text-xs text-slate-500 mb-2">
                                  <span>Overlay Opacity</span>
                                  <span>{Math.round(config.overlayOpacity * 100)}%</span>
                                </label>
                                <input
                                  type="range"
                                  min="0"
                                  max="1"
                                  step="0.05"
                                  value={config.overlayOpacity}
                                  onChange={(e) => updateConfig('overlayOpacity', e.target.value)}
                                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="p-6 pb-10">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <h2 className="font-bold text-xs text-slate-400 uppercase tracking-wider">Uploaded Fronts</h2>
                            <span className="text-xs text-slate-400">({frontImages.length})</span>
                          </div>
                          {/* Thumbnail Size Slider */}
                          <div className="flex items-center gap-2" title="Thumbnail Size">
                            <ZoomOut className="w-3 h-3 text-slate-400" />
                            <input
                              type="range"
                              min="2"
                              max="6"
                              step="1"
                              value={sidebarGridCols}
                              onChange={(e) => setSidebarGridCols(parseInt(e.target.value))}
                              className="w-16 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                            <ZoomIn className="w-3 h-3 text-slate-400" />
                          </div>
                        </div>

                        <div
                          className="grid gap-1"
                          style={{ gridTemplateColumns: `repeat(${sidebarGridCols}, minmax(0, 1fr))` }}
                        >
                          {frontImages.map((img, idx) => {
                            // Check if this is the first card of a new customer group
                            const prevImg = idx > 0 ? frontImages[idx - 1] : null;
                            const isFirstOfCustomer = img.customerName && (!prevImg || prevImg.customerName !== img.customerName);

                            return (
                              <React.Fragment key={img.id}>
                                {/* Customer Name Heading - temporarily disabled */}
                                {/*
                                {isFirstOfCustomer && (
                                  <div 
                                    className="col-span-full bg-blue-600 text-white px-3 py-2 rounded shadow-md mb-2 flex items-center justify-between"
                                    style={{ gridColumn: `1 / ${sidebarGridCols + 1}` }}
                                  >
                                    <span className="text-xs font-bold">{img.customerName}</span>
                                    <span className="text-[10px] opacity-90">
                                      {frontImages.filter(c => c.customerName === img.customerName).length} {frontImages.filter(c => c.customerName === img.customerName).length === 1 ? 'card' : 'cards'}
                                    </span>
                                  </div>
                                ))}
                                */}

                                <div className="relative group aspect-[2.5/3.5]">
                                  <img
                                    loading="lazy"
                                    src={img.url}
                                    className="w-full h-full object-cover rounded border border-slate-200"
                                    alt=""
                                    onError={(e) => {
                                      console.error('Thumbnail image failed to load:', img.url);
                                      e.target.style.display = 'none';
                                    }}
                                  />
                                  <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center rounded">
                                    <button
                                      onClick={() => removeFrontImage(idx)}
                                      className="text-white p-1 hover:bg-red-500 rounded-full transition-colors"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                  <div className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1 rounded-tl">
                                    {idx + 1}
                                  </div>
                                  {img.customerName && (
                                    <div className="absolute top-0 left-0 right-0 bg-green-600/90 text-white text-[6px] px-1 py-0.5 rounded-b truncate font-semibold">
                                      {img.customerName}
                                    </div>
                                  )}
                                </div>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* SAVE / LOAD SECTION - Sticky Footer */}
                    <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-5 z-20">
                      <h2 className="font-boldflex items-center gap-2 text-slate-700 mb-5">
                        <Save className="w-4 h-4" /> Save & Load
                      </h2>

                      {/* Layout Presets (FILE EXPORT/IMPORT) */}
                      <div className="mb-5">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Layout Presets (File)</label>
                        <div className="flex flex-col gap-3">
                          <div className="flex gap-3">
                            <input
                              type="text"
                              value={presetName}
                              onChange={(e) => setPresetName(e.target.value)}
                              placeholder="Preset Name"
                              className="flex-1 p-2.5 border border-slate-200 rounded text-xs"
                            />
                            <button
                              onClick={exportPreset}
                              className="flex items-center justify-center gap-1 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded text-xs font-semibold transition-colors"
                              title="Download Preset File"
                            >
                              <Download className="w-3 h-3" /> Save
                            </button>
                          </div>

                          <label className="flex items-center justify-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-2.5 rounded text-xs font-semibold transition-colors cursor-pointer w-full">
                            <Upload className="w-3 h-3" /> Load Preset File
                            <input type="file" accept=".json" className="hidden" onChange={importPreset} />
                          </label>
                        </div>
                      </div>

                      {/* Full Project */}
                      <div className="pt-3 border-t border-slate-200">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Full Project (With Images)</label>
                        <div className="grid grid-cols-1 gap-3">
                          <button
                            onClick={exportProject}
                            disabled={generating}
                            className="flex items-center justify-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-2.5 rounded text-xs font-semibold transition-colors"
                          >
                            <Download className="w-3 h-3" /> Save Project
                          </button>
                          <label className={`flex items-center justify-center gap-1 bg-slate-200 hover: bg-slate-300 text-slate-700 py-2.5 rounded text-xs font-semibold transition-colors cursor-pointer ${isLoadingProject ? 'opacity-50 cursor-wait' : ''} `}>
                            {isLoadingProject ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            Load Project
                            <input type="file" accept=".json" className="hidden" onChange={importProject} disabled={isLoadingProject} />
                          </label>
                        </div>
                      </div>
                    </div>
                  </aside>
                )}

                {/* Drag Handle */}
                {showSidebar && (
                  <div
                    className="w-1 bg-slate-200 hover:bg-blue-400 cursor-col-resize transition-colors z-20 flex flex-col justify-center items-center group"
                    onMouseDown={startResizing}
                  >
                    <div className="h-8 w-1 bg-slate-300 rounded group-hover:bg-blue-500 transition-colors" />
                  </div>
                )}

                {/* Main Preview Area */}
                <div className="flex-1 bg-slate-800 relative overflow-hidden flex flex-col">

                  {/* Zoom Controls */}
                  <div className="absolute top-4 right-4 z-30 bg-slate-700/90 backdrop-blur shadow-sm border border-slate-600 rounded-lg px-2 py-1 flex items-center gap-2">
                    <button
                      onClick={handleZoomOut}
                      className="p-1 text-slate-300 hover:text-blue-400 rounded hover:bg-slate-600"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-mono font-medium w-10 text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      onClick={handleZoomIn}
                      className="p-1 text-slate-300 hover:text-blue-400 rounded hover:bg-slate-600"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Pagination Controls for Preview */}
                  {totalPages > 1 && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-slate-700/90 backdrop-blur shadow-sm border border-slate-600 rounded-full px-4 py-2 flex items-center gap-4">
                      <button
                        disabled={previewPage === 0}
                        onClick={() => setPreviewPage(p => Math.max(0, p - 1))}
                        className="text-slate-300 hover:text-blue-600 disabled:opacity-30"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <span className="text-xs font-semibold text-slate-300">
                        Sheet {previewPage + 1} of {totalPages}
                      </span>
                      <button
                        disabled={previewPage >= totalPages - 1}
                        onClick={() => setPreviewPage(p => Math.min(totalPages - 1, p + 1))}
                        className="text-slate-300 hover:text-blue-600 disabled:opacity-30"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Canvas Container */}
                  <div
                    className={`flex-1 overflow-auto relative w-full ${activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    ref={scrollContainerRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                  >
                    {isLoadingPaidOrders && (
                      <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                        <div className="w-full max-w-md mx-4 bg-[var(--bg-card)] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.55)] border border-[var(--border-color)] px-6 py-5 flex items-center gap-4 ring-1 ring-white/10 bg-gradient-to-b from-white/5 to-transparent">
                          <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-black/20 border border-white/10">
                            <RefreshCw className="w-5 h-5 animate-spin text-[var(--accent-primary)]" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">Loading cards…</span>
                            <span className="text-xs leading-snug text-[var(--text-secondary)]">Fetching paid orders and building sheets</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="w-full flex justify-center mt-10 pb-20 px-10">
                      {/* The physical page representation */}
                      <div
                        className="bg-[var(--bg-hover)] shadow-2xl relative flex-shrink-0 transition-transform duration-500"
                        style={{
                          width: `${mmToPx(PAGE_WIDTH_MM)}px`,
                          height: `${mmToPx(PAGE_HEIGHT_MM)}px`,
                          paddingTop: '8px',
                          paddingBottom: '8px',
                          paddingLeft: '8px',
                          paddingRight: '8px',
                          boxSizing: 'border-box'
                        }}
                      >
                        {/* ALL YOUR CARD CONTENT GOES HERE */}
                        {templateOverlay && (
                          <img
                            src={templateOverlay}
                            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                            style={{ opacity: config.overlayOpacity }}
                            alt="Template Guide"
                          />
                        )}


                        {/* 2. Registration Marks Layer (Positionable Bar) */}
                        {config.showRegMarks && (
                          <div className="absolute inset-0 gap-2 pointer-events-none">
                            {/* SVG for precision preview */}
                            <svg width="100%" height="100%" className="absolute inset-0">
                              {/* Render reg mark preview with exact same logic as drawRegistrationBar */}
                              {(() => {
                                const w = mmToPx(getConfigNum('regMarkWidth'));
                                const h = mmToPx(getConfigNum('regMarkHeight'));
                                let x = mmToPx(getConfigNum('regMarkX'));
                                let y = mmToPx(getConfigNum('regMarkY'));
                                const shiftX = mmToPx(getConfigNum('backShiftX'));
                                const shiftY = mmToPx(getConfigNum('backShiftY'));

                                if (previewSide === 'back') {
                                  if (config.flipBackPage) {
                                    // Flip Logic
                                    x = mmToPx(getConfigNum('regMarkX')) + shiftX;
                                    y = mmToPx(getConfigNum('regMarkY')) + shiftY;
                                  } else {
                                    // Standard Mirror
                                    x = mmToPx(PAGE_WIDTH_MM) - x - w + shiftX;
                                    y = y + shiftY;
                                  }
                                }
                                return <rect x={x} y={y} width={w} height={h} fill="black" />;
                              })()}
                            </svg>
                          </div>
                        )}

                        {/* Customer Header (one customer per sheet) */}
                        {customerPages[previewPage]?.customerName && (
                          <div
                            className="absolute z-40 pointer-events-none px-3 py-1.5 text-[20px] font-semibold tracking-wide text-white/90 shadow-sm"
                            style={{
                              left: mmToPx(getConfigNum('marginLeft')),
                              top: mmToPx(6),
                              maxWidth: mmToPx(PAGE_WIDTH_MM - (getConfigNum('marginLeft') * 2)),
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {customerPages[previewPage].customerName}
                          </div>
                        )}

                        {/* 3. Cards Grid Layer */}
                        <div className="absolute inset-0">
                          {Array.from({ length: cardsPerPage }).map((_, i) => {
                            const col = i % getConfigNum('gridCols');
                            const row = Math.floor(i / getConfigNum('gridCols'));

                            let mmX = getConfigNum('marginLeft') + (col * (getConfigNum('cardWidth') + getConfigNum('gapHorizontal')));
                            let mmY = (getConfigNum('marginTop') + CUSTOMER_HEADER_OFFSET_MM) + (row * (getConfigNum('cardHeight') + getConfigNum('gapVertical')));

                            if (previewSide === 'back') {
                              if (config.flipBackPage) {
                                // Flip Mode
                                mmX += getConfigNum('backShiftX');
                                mmY += getConfigNum('backShiftY');
                              } else {
                                // Standard Mirror
                                mmX = PAGE_WIDTH_MM - mmX - getConfigNum('cardWidth');
                                mmX += getConfigNum('backShiftX');
                                mmY += getConfigNum('backShiftY');
                              }
                            }

                            // Preview Draw: 1:1 Match PDF (No Bleed, No Compensation)
                            const drawX = mmToPx(mmX);
                            const drawY = mmToPx(mmY);
                            const drawW = mmToPx(getConfigNum('cardWidth'));
                            const drawH = mmToPx(getConfigNum('cardHeight'));

                            const pageEntry = customerPages[previewPage]?.entries?.[i];
                            const imageIndex = pageEntry?.index;
                            const cardData = pageEntry?.card;

                            let image = null;
                            let showControls = false;

                            if (previewSide === 'front') {
                              image = cardData ? cardData.url : null;
                            } else {
                              if (cardData) {
                                showControls = true;
                                if (cardData.customBack !== undefined) {
                                  image = cardData.customBack;
                                } else {
                                  image = backImage;
                                }
                              }
                            }

                            return (
                              <React.Fragment key={i}>
                                {/* Customer Name Heading - temporarily disabled */}
                                {/*
                                {showCustomerHeading && cardData?.customerName && (
                                  <div
                                    className="absolute bg-blue-600 text-white px-3 py-2 rounded-t shadow-lg z-30"
                                    style={{
                                      left: drawX,
                                      top: row === 0 ? Math.max(8, mmToPx(getConfigNum('marginTop')) - 40) : drawY - 40,
                                      width: drawW,
                                      minHeight: '22px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: '11px',
                                      fontWeight: 'bold',
                                      boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                                    }}
                                  >
                                    {cardData.customerName}
                                  </div>
                                ))}
                                */}
                                {/* IMAGE LAYER (Previewing Trim Only) */}
                                <div
                                  className="absolute overflow-hidden bg-slate-50 group"
                                  style={{
                                    width: drawW,
                                    height: drawH,
                                    left: drawX,
                                    top: drawY,
                                    zIndex: 10
                                  }}
                                >
                                  {image ? (
                                    <img
                                      src={image}
                                      onLoad={(e) => logImgInfo('front (preview-grid)', e.currentTarget)}
                                      className="w-full h-full object-cover"
                                      alt=""
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                                      {previewSide === 'front' ? `Slot ${i + 1} ` : (cardData ? 'No Back' : 'Empty')}
                                    </div>
                                  )}


                                  {/* Spot Mask Badge */}
                                  {previewSide === 'front' && cardData?.spotMask !== undefined && (
                                    <div className="absolute top-5 right-1 bg-cyan-500 text-white text-[8px] px-1.5 py-0.5 rounded-sm shadow-sm z-20 pointer-events-none font-bold tracking-tight uppercase flex items-center gap-1">
                                      <Sparkles className="w-2 h-2" /> Spot
                                    </div>
                                  )}

                                  {/* Customer Name Badge */}
                                  {cardData?.customerName && (
                                    <div className="absolute bottom-0 left-0 right-0 bg-green-600/90 text-white text-[7px] px-1.5 py-0.5 rounded-t-sm shadow-sm z-20 pointer-events-none font-semibold truncate">
                                      {cardData.customerName}
                                    </div>
                                  )}

                                  {/* Spot Mask Hover Preview */}
                                  {previewSide === 'front' && cardData?.spotMask && (
                                    <img
                                      src={cardData.spotMask}
                                      className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-40 transition-opacity z-15 pointer-events-none mix-blend-multiply"
                                      style={{ filter: 'sepia(1) hue-rotate(130deg) saturate(5)' }} // Cyan tint for preview
                                    />
                                  )}

                                  {/* Spot Silver mask overlay (visible) */}
                                  {previewSide === 'front' && cardData?.spotMask && (
                                    <div
                                      className="finish-silver"
                                      style={{
                                        WebkitMaskImage: `url(${cardData.spotMask})`,
                                        maskImage: `url(${cardData.spotMask})`
                                      }}
                                    />
                                  )}

                                  {/* Controls Overlay */}
                                  {((previewSide === 'back' && showControls) || (previewSide === 'front' && cardData)) && (
                                    <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-30 p-2">

                                      {/* Front Controls */}
                                      {previewSide === 'front' && cardData && (
                                        <div className="flex gap-1.5">
                                          <label className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer shadow-sm" title="Replace Front Image">
                                            <ImagePlus className="w-3.5 h-3.5" />
                                            <input type="file" className="hidden" accept="image/*" onChange={(e) => replaceFrontImage(e, imageIndex)} />
                                          </label>

                                          <label className={`p-1.5 text-white rounded cursor-pointer shadow-sm ${cardData.customBack ? 'bg-green-600 hover:bg-green-500' : 'bg-slate-600 hover:bg-slate-500'} `} title="Set Custom Back Image">
                                            <RotateCcw className="w-3.5 h-3.5" />
                                            <input type="file" className="hidden" accept="image/*" onChange={(e) => handleIndividualBackUpload(e, imageIndex)} />
                                          </label>

                                          <button
                                            onClick={() => removeFrontImage(imageIndex)}
                                            className="p-1.5 bg-red-500 text-white rounded hover:bg-red-400 shadow-sm"
                                            title="Remove Card"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      )}

                                      {/* Back Controls */}
                                      {previewSide === 'back' && cardData && (
                                        <div className="flex gap-1.5">
                                          <label className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer shadow-sm" title="Upload Custom Back">
                                            <Upload className="w-3.5 h-3.5" />
                                            <input type="file" className="hidden" accept="image/*" onChange={(e) => handleIndividualBackUpload(e, imageIndex)} />
                                          </label>

                                          <button
                                            onClick={() => clearIndividualBack(imageIndex)}
                                            className="p-1.5 bg-red-500 text-white rounded hover:bg-red-400 shadow-sm"
                                            title="Clear Back (Blank)"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>

                                          {cardData.customBack !== undefined && (
                                            <button
                                              onClick={() => revertIndividualBack(imageIndex)}
                                              className="p-1.5 bg-slate-500 text-white rounded hover:bg-slate-400 shadow-sm"
                                              title="Revert to Common Back"
                                            >
                                              <RefreshCw className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* CUT LINE LAYER (Border Only) - Blue guide */}
                                {getConfigNum('printCutLines') === true && (
                                  <div
                                    className="absolute border border-blue-400/50 pointer-events-none shadow-sm"
                                    style={{
                                      width: drawW,
                                      height: drawH,
                                      left: drawX,
                                      top: drawY,
                                      zIndex: 20
                                    }}
                                  />
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </main>
            </div>
          </main>
        </div>
      </BatcherPROContext.Provider>
    );
  }

  return (
    <BatcherPROContext.Provider value={contextValue}>
      <div className="min-h-screen bg-blue-100 text-slate-900 font-sans flex flex-col select-none w-full">
        <BeautifulExportModal
          isOpen={exportScopeModal.open}
          onClose={closeExportScopeModal}
          onConfirm={confirmExportScopeModal}
          mode={exportScopeModal.mode}
          customerName={exportModalCustomerName}
          customerCount={exportModalCustomerCount}
          totalCount={exportModalTotalCount}
          customerSheets={exportModalCustomerSheets}
          totalSheets={exportModalTotalSheets}
          generating={generating}
          selection={exportScopeModal.selection}
          onSelectionChange={(value) => setExportScopeModal(prev => ({ ...prev, selection: value }))}
        />

        {/* Header */}
        <header className="bg-slate-900 text-white p-4 shadow-lg flex justify-between items-center z-20">
          <div className="flex items-center gap-3">
            <Layers className="text-blue-400" />
            <h1 className="text-xl font-bold tracking-wider">CardBatcher<span className="text-blue-400">Pro</span></h1>
          </div>

          {/* Tool Bar */}
          <div className="flex items-center gap-4">
            {/* Interaction Tools */}
            <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
              <button
                onClick={() => setActiveTool('select')}
                className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${activeTool === 'select' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'} `}
                title="Select Mode"
              >
                <MousePointer2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveTool('pan')}
                className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${activeTool === 'pan' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'} `}
                title="Pan Tool (Space)"
              >
                <Hand className="w-4 h-4" />
              </button>
            </div>

            {/* Side Toggle */}
            <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700 gap-1">
              <button
                onClick={() => setPreviewSide('front')}
                className={`shrink-0 whitespace-nowrap min-w-[92px] min-h-[30px] px-4 py-1.5 rounded text-xs font-bold leading-none transition-all flex items-center justify-center gap-2 ${previewSide === 'front'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
                  }`}
              >
                <Eye className="w-3 h-3" /> Front
              </button>
              <button
                onClick={() => setPreviewSide('back')}
                className={`shrink-0 whitespace-nowrap min-w-[92px] min-h-[30px] px-4 py-1.5 rounded text-xs font-bold leading-none transition-all flex items-center justify-center gap-2 ${previewSide === 'back'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
                  }`}
              >
                <RotateCcw className="w-3 h-3" /> Back
              </button>

              {/* Date Filter Dropdown - Always visible */}
              <div className="relative date-dropdown-container ml-1">
                <button
                  onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors text-xs font-semibold min-w-[160px] justify-between"
                  title="Filter by order date"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-blue-400" />
                    <span className="truncate">
                      {selectedDate ? formatDateForDisplay(selectedDate) : 'All Dates'}
                    </span>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isDateDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {isDateDropdownOpen && (
                  <div className="absolute top-full right-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-[100] overflow-hidden">
                    <div className="max-h-80 overflow-y-auto">
                      {/* All Dates Option */}
                      <button
                        onClick={() => {
                          setSelectedDate(null);
                          setIsDateDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-2.5 text-left text-xs font-medium transition-colors flex items-center gap-2 ${!selectedDate
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-300 hover:bg-slate-700'
                          }`}
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>All Dates</span>
                        <span className="ml-auto text-[10px] bg-blue-500 px-1.5 py-0.5 rounded">
                          {allLoadedCards.length || frontImages.length} cards
                        </span>
                      </button>

                      {/* Individual Date Options */}
                      {availableDates.length > 0 ? (
                        availableDates.map((date) => {
                          const cardCount = allLoadedCards.filter(card => card.orderDate === date).length;
                          return (
                            <button
                              key={date}
                              onClick={() => {
                                setSelectedDate(date);
                                setIsDateDropdownOpen(false);
                              }}
                              className={`w-full px-4 py-2.5 text-left text-xs font-medium transition-colors flex items-center gap-2 border-t border-slate-700/50 ${selectedDate === date
                                ? 'bg-blue-600 text-white'
                                : 'text-slate-300 hover:bg-slate-700'
                                }`}
                            >
                              <Calendar className="w-3.5 h-3.5" />
                              <span className="flex-1 truncate">{formatDateForDisplay(date)}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${selectedDate === date
                                ? 'bg-blue-500'
                                : 'bg-slate-600'
                                }`}>
                                {cardCount} cards
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-700/50">
                          No dates found in orders
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Customer/Order Navigation */}
          {uniqueCustomers.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1 border border-slate-700">
              <button
                onClick={goToPreviousCustomer}
                className="w-8 h-8 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                title="Previous Order"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-3 py-1 text-xs font-semibold text-white min-w-[120px] text-center">
                <span className="text-blue-400">{currentCustomerIndex + 1}</span>
                <span className="text-slate-500"> / {uniqueCustomers.length}</span>
                <div className="text-[10px] text-slate-400 truncate max-w-[100px]" title={currentCustomer}>
                  {currentCustomer || 'No Orders'}
                </div>
              </div>
              <button
                onClick={goToNextCustomer}
                className="w-8 h-8 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                title="Next Order"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={upscaleLoadedImages}
              disabled={generating || isUpscaling || frontImages.length === 0 || !UPSCALE_API_URL}
              title={!UPSCALE_API_URL ? 'Set VITE_UPSCALE_API_URL to enable Real-ESRGAN upscaling' : 'Upscale loaded front cards'}
              className={`flex items-center justify-center gap-2 min-w-[140px] px-6 py-2 rounded-lg font-semibold transition-all text-xs ${generating || isUpscaling || frontImages.length === 0 || !UPSCALE_API_URL
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg hover:shadow-violet-500/30'
                }`}
            >
              {isUpscaling ? <RefreshCw className="animate-spin w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
              {isUpscaling ? 'Upscaling' : 'Upscale'}
            </button>
            <button
              onClick={() => openExportScopeModal('mask')}
              disabled={generating || isUpscaling || frontImages.length === 0}
              className="flex items-center justify-center gap-2 min-w-[140px] px-10 py-2 rounded-lg font-semibold transition-all text-xs bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700"
            >
              {generating ? <RefreshCw className="animate-spin w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
              Export Mask
            </button>
            <button
              onClick={() => openExportScopeModal('pdf')}
              disabled={generating || isUpscaling || frontImages.length === 0}
              className={`flex items-center justify-center gap-2 min-w-[140px] px-10 py-2 rounded-lg font-semibold transition-all ${generating || isUpscaling || frontImages.length === 0
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg hover:shadow-blue-500/30'
                } `}
            >
              {generating ? <RefreshCw className="animate-spin w-4 h-4" /> : <Download className="w-4 h-4" />}
              {generating ? `Processing` : 'Export PDF'}
            </button>
          </div>
        </header>

        {isUpscaling && (
          <div className="bg-slate-950 border-b border-slate-800 px-4 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">
                  Real-ESRGAN upscaling
                </div>
                <div className="text-xs text-slate-400">
                  {upscaleProgress.label || 'Upscaling loaded images'} - {upscalePercent}% complete
                </div>
              </div>
              <div className="w-full lg:max-w-md">
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] duration-300"
                    style={{ width: `${upscalePercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {generating && (
          <div className="bg-slate-950 border-b border-slate-800 px-4 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">
                  {generationLabel || 'Exporting PDF'}
                </div>
                <div className="text-xs text-slate-400">
                  {progressPercent}% complete
                  {remainingLabel ? ` • about ${remainingLabel} remaining` : ''}
                  {elapsedLabel ? ` • ${elapsedLabel} elapsed` : ''}
                </div>
              </div>
              <div className="w-full lg:max-w-md">
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-[width] duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 flex overflow-hidden h-[calc(100vh-64px)]">

          {/* Left Sidebar: Configuration */}
          {showSidebar && (
            <aside
              ref={sidebarRef}
              style={{ width: sidebarWidth }}
              className="shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden z-10 shadow-xl relative"
            >
              {/* Scrollable Content Area */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-5 border-b border-slate-100">
                  <h2 className="font-bold flex items-center gap-2 text-slate-700 mb-4">
                    <Settings className="w-4 h-4" /> Layout Settings
                  </h2>

                  <div className="space-y-4">
                    {/* Registration Bar */}
                    <div className="pb-4 border-b border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                          <Move className="w-3 h-3" /> Registration Bar
                        </label>
                        <input
                          type="checkbox"
                          checked={config.showRegMarks}
                          onChange={(e) => setConfig({ ...config, showRegMarks: e.target.checked })}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                      </div>

                      {config.showRegMarks && (
                        <div className="bg-slate-50 p-5 rounded border border-slate-100 space-y-5">
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Width (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.regMarkWidth}
                                onChange={(e) => updateConfig('regMarkWidth', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkWidth')}
                                className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Height (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.regMarkHeight}
                                onChange={(e) => updateConfig('regMarkHeight', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkHeight')}
                                className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Pos X (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.regMarkX}
                                onChange={(e) => updateConfig('regMarkX', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkX')}
                                className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Pos Y (mm)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={config.regMarkY}
                                onChange={(e) => updateConfig('regMarkY', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkY')}
                                className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Margins */}
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Top Margin (mm)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={config.marginTop}
                          onChange={(e) => updateConfig('marginTop', e.target.value)}
                          onKeyDown={(e) => handleNumberKeyDown(e, 'marginTop')}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Left Margin (mm)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={config.marginLeft}
                          onChange={(e) => updateConfig('marginLeft', e.target.value)}
                          onKeyDown={(e) => handleNumberKeyDown(e, 'marginLeft')}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>

                    {/* Gaps */}
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Gap X (mm)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={config.gapHorizontal}
                          onChange={(e) => updateConfig('gapHorizontal', e.target.value)}
                          onKeyDown={(e) => handleNumberKeyDown(e, 'gapHorizontal')}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Gap Y (mm)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={config.gapVertical}
                          onChange={(e) => updateConfig('gapVertical', e.target.value)}
                          onKeyDown={(e) => handleNumberKeyDown(e, 'gapVertical')}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>

                    {/* Sheet Size Selection */}
                    <div className="bg-slate-50 p-3 rounded border border-slate-100">
                      <div className="flex items-center gap-2 mb-2">
                        <Layout className="w-3 h-3 text-slate-500" />
                        <label className="text-xs mt-2 font-bold text-slate-600">Sheet Configuration</label>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 mb-1">Paper Size</label>
                          <select
                            value={config.sheetSize}
                            onChange={(e) => updateStringConfig('sheetSize', e.target.value)}
                            className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                          >
                            {Object.entries(PAPER_SIZES).map(([key, val]) => (
                              <option key={key} value={key}>{val.name}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-semibold text-slate-500">Orientation</label>
                          <div className="flex bg-white border border-slate-200 rounded overflow-hidden">
                            <button
                              onClick={() => updateStringConfig('orientation', 'portrait')}
                              className={`px-2 py-1 text-[10px] ${config.orientation === 'portrait' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-slate-500 hover:bg-slate-50'} `}
                            >
                              Portrait
                            </button>
                            <div className="w-[1px] bg-slate-200"></div>
                            <button
                              onClick={() => updateStringConfig('orientation', 'landscape')}
                              className={`px-2 py-1 text-[10px] ${config.orientation === 'landscape' ? 'bg-blue-100 text-blue-700 font-bold' : 'text-slate-500 hover:bg-slate-50'} `}
                            >
                              Landscape
                            </button>
                          </div>
                        </div>

                        {config.sheetSize === 'custom' && (
                          <div className="grid grid-cols-1 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">W (mm)</label>
                              <input
                                type="number"
                                value={config.customSheetWidth}
                                onChange={(e) => updateConfig('customSheetWidth', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'customSheetWidth')}
                                className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">H (mm)</label>
                              <input
                                type="number"
                                value={config.customSheetHeight}
                                onChange={(e) => updateConfig('customSheetHeight', e.target.value)}
                                onKeyDown={(e) => handleNumberKeyDown(e, 'customSheetHeight')}
                                className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs"
                              />
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100">
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 mb-1">Columns</label>
                            <input
                              type="number"
                              min="1"
                              max="20"
                              value={config.gridCols}
                              onChange={(e) => updateConfig('gridCols', e.target.value)}
                              className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 mb-1">Rows</label>
                            <input
                              type="number"
                              min="1"
                              max="20"
                              value={config.gridRows}
                              onChange={(e) => updateConfig('gridRows', e.target.value)}
                              className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card Dimensions */}
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Card Width (mm)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={config.cardWidth}
                          onChange={(e) => updateConfig('cardWidth', e.target.value)}
                          onKeyDown={(e) => handleNumberKeyDown(e, 'cardWidth')}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Card Height (mm)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={config.cardHeight}
                          onChange={(e) => updateConfig('cardHeight', e.target.value)}
                          onKeyDown={(e) => handleNumberKeyDown(e, 'cardHeight')}
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                      </div>
                    </div>

                    {/* Output Resolution Setting */}
                    <div className="bg-blue-50 p-3 rounded border border-blue-100">
                      <label className="block text-xs font-bold text-blue-700 mb-2 flex items-center gap-2">
                        <Printer className="w-3 h-3" /> Print Resolution (DPI)
                      </label>
                      <select
                        value={config.targetDPI}
                        onChange={(e) => updateConfig('targetDPI', parseInt(e.target.value))}
                        className="w-full p-2 bg-white border border-blue-200 rounded text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        <option value="300">300 DPI (Standard)</option>
                        <option value="600">600 DPI (High Quality)</option>
                        <option value="1200">1200 DPI (Ultra Fine)</option>
                      </select>
                      <p className="text-[10px] text-blue-500 mt-1 leading-tight">
                        Note: 1200 DPI may take longer to process and create larger files.
                      </p>
                    </div>

                    {/* Print Cut Lines Option */}
                    <div className="mt-2 flex items-center justify-between bg-white p-1.5 rounded border border-slate-200">
                      <label className="text-[10px] font-medium text-slate-600">Print Cut Lines (Dashed)</label>
                      <input
                        type="checkbox"
                        checked={config.printCutLines}
                        onChange={(e) => setConfig(p => ({ ...p, printCutLines: e.target.checked }))}
                        className="w-3 h-3 text-blue-600 rounded"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-5 border-b border-slate-100">
                  <h2 className="font-bold flex items-center gap-2 text-slate-700 mb-4">
                    <ImageIcon className="w-4 h-4" /> Assets
                  </h2>

                  <div className="space-y-4">
                    {/* Front Upload */}
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs font-semibold text-slate-500">1. Batch Upload Fronts</label>
                      </div>
                      <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-blue-200 rounded-lg cursor-pointer bg-blue-50 hover:bg-blue-100 transition-colors">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <Upload className="w-6 h-6 text-blue-400 mb-1" />
                          <p className="text-xs text-blue-500 font-medium">Click to upload cards</p>
                          <p className="text-[10px] text-blue-400">{frontImages.length} cards loaded</p>
                        </div>
                        <input
                          type="file"
                          className="hidden"
                          multiple
                          accept="image/*"
                          onChange={handleFrontUpload}
                          ref={fileInputRef}
                        />
                      </label>
                    </div>

                    {/* Back Upload */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-2">2. Common Back Image</label>
                      <div className="flex gap-2 items-center">
                        <label className="flex-1 flex items-center justify-center h-10 border border-slate-200 rounded bg-white cursor-pointer hover:bg-slate-50 text-xs text-slate-600">
                          {backImage ? 'Change Back' : 'Upload Back'}
                          <input type="file" className="hidden" accept="image/*" onChange={handleBackUpload} />
                        </label>
                        {backImage && (
                          <>
                            <img src={backImage} className="w-10 h-10 object-cover rounded border border-slate-300" alt="Back" />
                            <button
                              onClick={() => setBackImage(null)}
                              className="w-10 h-10 flex items-center justify-center text-red-500 hover:bg-red-50 rounded border border-slate-200 shrink-0"
                              title="Remove Back Image"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Batch Unique Backs Upload */}
                      <div className="mt-3">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">3. Batch Unique Backs</label>
                        <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                          <div className="flex flex-col items-center justify-center pt-2 pb-2">
                            <Images className="w-4 h-4 text-slate-400 mb-1" />
                            <p className="text-[10px] text-slate-500 font-medium">Batch Upload Backs (Sequential)</p>
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            multiple
                            accept="image/*"
                            onChange={handleBatchBackUpload}
                          />
                        </label>
                      </div>

                      {/* Batch Spot Mask Upload */}
                      <div className="mt-3">
                        <label className="block text-xs font-semibold text-slate-500 mb-1 flex items-center gap-2">
                          4. Batch Spot Masks (Silver) <Sparkles className="w-3 h-3 text-cyan-500" />
                        </label>
                        <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-cyan-100 rounded-lg cursor-pointer bg-cyan-50 hover:bg-cyan-100 transition-colors">
                          <div className="flex flex-col items-center justify-center pt-2 pb-2">
                            <Sparkles className="w-4 h-4 text-cyan-400 mb-1" />
                            <p className="text-[10px] text-cyan-600 font-medium">Batch Upload Masks (Sequential)</p>
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            multiple
                            accept="image/*"
                            onChange={handleBatchSpotMaskUpload}
                          />
                        </label>
                      </div>

                      {/* Duplex Toggle */}
                      <div className="mt-4 flex items-center justify-between bg-slate-50 p-2 rounded border border-slate-100">
                        <label className="text-[10px] font-semibold text-slate-600">Flip 180° (Duplex Fix)</label>
                        <input
                          type="checkbox"
                          checked={config.flipBackPage}
                          onChange={(e) => setConfig(p => ({ ...p, flipBackPage: e.target.checked }))}
                          className="w-3 h-3 text-blue-600 rounded"
                        />
                      </div>

                      {/* Back Shift / Offset Controls */}
                      <div className="mt-2 bg-slate-50 p-2 rounded border border-slate-100 space-y-2">
                        <div className="flex items-center gap-2">
                          <AlignCenterVertical className="w-3 h-3 text-slate-500" />
                          <label className="text-[10px] font-bold text-slate-600">Back Page Shift (mm)</label>
                        </div>
                        <div className="grid grid-cols-1 gap-4">
                          <div>
                            <label className="block text-[9px] font-semibold text-slate-400 mb-0.5">Shift X</label>
                            <input
                              type="number"
                              step="0.1"
                              value={config.backShiftX}
                              onChange={(e) => updateConfig('backShiftX', e.target.value)}
                              onKeyDown={(e) => handleNumberKeyDown(e, 'backShiftX')}
                              className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                              placeholder="0.0"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-semibold text-slate-400 mb-0.5">Shift Y</label>
                            <input
                              type="number"
                              step="0.1"
                              value={config.backShiftY}
                              onChange={(e) => updateConfig('backShiftY', e.target.value)}
                              onKeyDown={(e) => handleNumberKeyDown(e, 'backShiftY')}
                              className="w-full p-1.5 bg-white border border-slate-200 rounded text-xs outline-none focus:border-blue-400"
                              placeholder="0.0"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Template Overlay */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-2">3. Template Overlay (Guide)</label>
                      <div className="flex gap-2 items-center mb-2">
                        <label className="flex-1 flex items-center justify-center h-10 border border-slate-200 rounded bg-white cursor-pointer hover:bg-slate-50 text-xs text-slate-600">
                          {templateOverlay ? 'Change Overlay' : 'Upload Guide'}
                          <input type="file" className="hidden" accept="image/*" onChange={handleOverlayUpload} />
                        </label>
                        {templateOverlay && (
                          <button
                            onClick={() => setTemplateOverlay(null)}
                            className="w-10 h-10 flex items-center justify-center text-red-500 hover:bg-red-50 rounded border border-slate-200"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {templateOverlay && (
                        <div>
                          <label className="flex justify-between text-[10px] text-slate-500 mb-1">
                            <span>Overlay Opacity</span>
                            <span>{Math.round(config.overlayOpacity * 100)}%</span>
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={config.overlayOpacity}
                            onChange={(e) => updateConfig('overlayOpacity', e.target.value)}
                            className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-5 pb-10">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-xs text-slate-400 uppercase tracking-wider">Uploaded Fronts</h2>
                      <span className="text-[10px] text-slate-400">({frontImages.length})</span>
                    </div>
                    {/* Thumbnail Size Slider */}
                    <div className="flex items-center gap-2" title="Thumbnail Size">
                      <ZoomOut className="w-3 h-3 text-slate-400" />
                      <input
                        type="range"
                        min="2"
                        max="6"
                        step="1"
                        value={sidebarGridCols}
                        onChange={(e) => setSidebarGridCols(parseInt(e.target.value))}
                        className="w-16 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <ZoomIn className="w-3 h-3 text-slate-400" />
                    </div>
                  </div>

                  <div
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${sidebarGridCols}, minmax(0, 1fr))` }}
                  >
                    {frontImages.map((img, idx) => (
                      <div key={img.id} className="relative group aspect-[2.5/3.5]">
                        <img
                          loading="lazy"
                          src={img.url}
                          className="w-full h-full object-cover rounded border border-slate-200"
                          alt=""
                        />
                        <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center rounded">
                          <button
                            onClick={() => removeFrontImage(idx)}
                            className="text-white p-1 hover:bg-red-500 rounded-full transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1 rounded-tl">
                          {idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* SAVE / LOAD SECTION - Sticky Footer */}
                <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-4 z-20">
                  <h2 className="font-bold flex items-center gap-2 text-slate-700 mb-4">
                    <Save className="w-4 h-4" /> Save & Load
                  </h2>

                  {/* Layout Presets (FILE EXPORT/IMPORT) */}
                  <div className="mb-4">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Layout Presets (File)</label>
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={presetName}
                          onChange={(e) => setPresetName(e.target.value)}
                          placeholder="Preset Name"
                          className="flex-1 p-1.5 border border-slate-200 rounded text-xs"
                        />
                        <button
                          onClick={exportPreset}
                          className="flex items-center justify-center gap-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                          title="Download Preset File"
                        >
                          <Download className="w-3 h-3" /> Save
                        </button>
                      </div>

                      <label className="flex items-center justify-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer w-full">
                        <Upload className="w-3 h-3" /> Load Preset File
                        <input type="file" accept=".json" className="hidden" onChange={importPreset} />
                      </label>
                    </div>
                  </div>

                  {/* Full Project */}
                  <div className="pt-2 border-t border-slate-200">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Full Project (With Images)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={exportProject}
                        disabled={generating}
                        className="flex items-center justify-center gap-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-1.5 rounded text-xs font-semibold transition-colors"
                      >
                        <Download className="w-3 h-3" /> Save Project
                      </button>
                      <label className={`flex items-center justify-center gap-1 bg-slate-200 hover: bg-slate-300 text-slate-700 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${isLoadingProject ? 'opacity-50 cursor-wait' : ''} `}>
                        {isLoadingProject ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                        Load Project
                        <input type="file" accept=".json" className="hidden" onChange={importProject} disabled={isLoadingProject} />
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          )}

          {/* Drag Handle */}
          {showSidebar && (
            <div
              className="w-1 bg-slate-200 hover:bg-blue-400 cursor-col-resize transition-colors z-20 flex flex-col justify-center items-center group"
              onMouseDown={startResizing}
            >
              <div className="h-8 w-1 bg-slate-300 rounded group-hover:bg-blue-500 transition-colors" />
            </div>
          )}

          {/* Main Preview Area */}
          <div className="flex-1 bg-slate-200 relative overflow-hidden flex flex-col">
            {/* Zoom Controls */}
            <div className="absolute top-4 right-4 z-30 bg-white/90 backdrop-blur shadow-sm border border-slate-300 rounded-lg px-2 py-1 flex items-center gap-2">
              <button
                onClick={handleZoomOut}
                className="p-1 text-slate-600 hover:text-blue-600 rounded hover:bg-slate-100"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-mono font-medium w-10 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                onClick={handleZoomIn}
                className="p-1 text-slate-600 hover:text-blue-600 rounded hover:bg-slate-100"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Pagination Controls for Preview */}
            {totalPages > 1 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-white/90 backdrop-blur shadow-sm border border-slate-300 rounded-full px-4 py-2 flex items-center gap-4">
                <button
                  disabled={previewPage === 0}
                  onClick={() => setPreviewPage(p => Math.max(0, p - 1))}
                  className="text-slate-600 hover:text-blue-600 disabled:opacity-30"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-semibold text-slate-700">
                  Sheet {previewPage + 1} of {totalPages}
                </span>
                <button
                  disabled={previewPage >= totalPages - 1}
                  onClick={() => setPreviewPage(p => Math.min(totalPages - 1, p + 1))}
                  className="text-slate-600 hover:text-blue-600 disabled:opacity-30"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Canvas Container */}
            <div
              className={`flex-1 overflow-auto relative ${activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : ''}`}
              ref={scrollContainerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {isLoadingPaidOrders && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                  <div className="w-full max-w-md mx-4 bg-[var(--bg-card)] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.55)] border border-[var(--border-color)] px-6 py-5 flex items-center gap-4 ring-1 ring-white/10 bg-gradient-to-b from-white/5 to-transparent">
                    <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-black/20 border border-white/10">
                      <RefreshCw className="w-5 h-5 animate-spin text-[var(--accent-primary)]" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">Loading cards…</span>
                      <span className="text-xs leading-snug text-[var(--text-secondary)]">Fetching paid orders and building sheets</span>
                    </div>
                  </div>
                </div>
              )}
              <div className="w-fit mx-auto mt-10 pb-20 px-10">
                {/* The physical page representation */}
                <div
                  className="bg-[var(--bg-hover)] shadow-2xl relative flex-shrink-0 transition-transform duration-500"
                  style={{
                    width: `${mmToPx(PAGE_WIDTH_MM)}px`,
                    height: `${mmToPx(PAGE_HEIGHT_MM)}px`,
                    paddingTop: '8px',
                    paddingBottom: '8px',
                    paddingLeft: '8px',
                    paddingRight: '8px',
                    boxSizing: 'border-box'
                  }}
                >
                  {templateOverlay && (
                    <img
                      src={templateOverlay}
                      className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                      style={{ opacity: config.overlayOpacity }}
                      alt="Template Guide"
                    />
                  )}

                  {config.showRegMarks && (
                    <div className="absolute inset-0 pointer-events-none">
                      <svg width="100%" height="100%" className="absolute inset-0">
                        {(() => {
                          const w = mmToPx(getConfigNum('regMarkWidth'));
                          const h = mmToPx(getConfigNum('regMarkHeight'));
                          let x = mmToPx(getConfigNum('regMarkX'));
                          let y = mmToPx(getConfigNum('regMarkY'));
                          const shiftX = mmToPx(getConfigNum('backShiftX'));
                          const shiftY = mmToPx(getConfigNum('backShiftY'));

                          if (previewSide === 'back') {
                            if (config.flipBackPage) {
                              x = mmToPx(getConfigNum('regMarkX')) + shiftX;
                              y = mmToPx(getConfigNum('regMarkY')) + shiftY;
                            } else {
                              x = mmToPx(PAGE_WIDTH_MM) - x - w + shiftX;
                              y = y + shiftY;
                            }
                          }
                          return <rect x={x} y={y} width={w} height={h} fill="black" />;
                        })()}
                      </svg>
                    </div>
                  )}

                  {/* Customer Header (one customer per sheet) */}
                  {customerPages[previewPage]?.customerName && (
                    <div
                      className="absolute z-40 pointer-events-none px-3 py-1.5 rounded-md border border-white/10 bg-black/35 text-[11px] font-semibold tracking-wide text-white/90 shadow-sm"
                      style={{
                        left: mmToPx(getConfigNum('marginLeft')),
                        top: mmToPx(6),
                        maxWidth: mmToPx(PAGE_WIDTH_MM - (getConfigNum('marginLeft') * 2)),
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {customerPages[previewPage].customerName}
                    </div>
                  )}

                  <div className="absolute inset-0">
                    {Array.from({ length: cardsPerPage }).map((_, i) => {
                      const col = i % getConfigNum('gridCols');
                      const row = Math.floor(i / getConfigNum('gridCols'));

                      let mmX = getConfigNum('marginLeft') + (col * (getConfigNum('cardWidth') + getConfigNum('gapHorizontal')));
                      let mmY = (getConfigNum('marginTop') + CUSTOMER_HEADER_OFFSET_MM) + (row * (getConfigNum('cardHeight') + getConfigNum('gapVertical')));

                      if (previewSide === 'back') {
                        if (config.flipBackPage) {
                          mmX += getConfigNum('backShiftX');
                          mmY += getConfigNum('backShiftY');
                        } else {
                          mmX = PAGE_WIDTH_MM - mmX - getConfigNum('cardWidth');
                          mmX += getConfigNum('backShiftX');
                          mmY += getConfigNum('backShiftY');
                        }
                      }

                      const drawX = mmToPx(mmX);
                      const drawY = mmToPx(mmY);
                      const drawW = mmToPx(getConfigNum('cardWidth'));
                      const drawH = mmToPx(getConfigNum('cardHeight'));

                      const pageEntry = customerPages[previewPage]?.entries?.[i];
                      const imageIndex = pageEntry?.index;
                      const cardData = pageEntry?.card;

                      let image = null;
                      let showControls = false;

                      if (previewSide === 'front') {
                        image = cardData ? cardData.url : null;
                      } else {
                        if (cardData) {
                          showControls = true;
                          if (cardData.customBack !== undefined) {
                            image = cardData.customBack;
                          } else {
                            image = backImage;
                          }
                        }
                      }

                      return (
                        <React.Fragment key={i}>
                          {/* Customer Name Heading - temporarily disabled */}
                          {/*
                          {showCustomerHeading && cardData?.customerName && (
                            <div
                              className="absolute bg-blue-600 text-white px-3 py-2 rounded-t shadow-lg z-30"
                              style={{
                                left: drawX,
                                top: row === 0 ? Math.max(8, mmToPx(getConfigNum('marginTop')) - 40) : drawY - 40,
                                width: drawW,
                                minHeight: '22px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.3)'
                              }}
                            >
                              {cardData.customerName}
                            </div>
                          ))}
                          */}

                          <div
                            className="absolute overflow-hidden bg-slate-50 group"
                            style={{
                              width: drawW,
                              height: drawH,
                              left: drawX,
                              top: drawY,
                              zIndex: 10
                            }}
                          >
                            {image ? (
                              <img
                                src={image}
                                onLoad={(e) => logImgInfo('front (main-grid)', e.currentTarget)}
                                onError={(e) => {
                                  console.error('Image failed to load:', image);
                                  e.target.style.display = 'none';
                                }}
                                className="w-full h-full object-cover"
                                alt=""
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                                {previewSide === 'front' ? `Slot ${i + 1} ` : (cardData ? 'No Back' : 'Empty')}
                              </div>
                            )}


                            {previewSide === 'front' && cardData?.spotMask !== undefined && (
                              <div className="absolute top-5 right-1 bg-cyan-500 text-white text-[8px] px-1.5 py-0.5 rounded-sm shadow-sm z-20 pointer-events-none font-bold tracking-tight uppercase flex items-center gap-1">
                                <Sparkles className="w-2 h-2" /> Spot
                              </div>
                            )}

                            {/* Customer Name Badge */}
                            {cardData?.customerName && (
                              <div className="absolute bottom-0 left-0 right-0 bg-green-600/90 text-white text-[7px] px-1.5 py-0.5 rounded-t-sm shadow-sm z-20 pointer-events-none font-semibold truncate">
                                {cardData.customerName}
                              </div>
                            )}

                            {previewSide === 'front' && cardData?.spotMask && (
                              <img
                                src={cardData.spotMask}
                                className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-40 transition-opacity z-15 pointer-events-none mix-blend-multiply"
                                style={{ filter: 'sepia(1) hue-rotate(130deg) saturate(5)' }}
                              />
                            )}

                            {/* Spot Silver mask overlay (visible) */}
                            {previewSide === 'front' && cardData?.spotMask && (
                              <div
                                className="finish-silver"
                                style={{
                                  WebkitMaskImage: `url(${cardData.spotMask})`,
                                  maskImage: `url(${cardData.spotMask})`
                                }}
                              />
                            )}

                            {((previewSide === 'back' && showControls) || (previewSide === 'front' && cardData)) && (
                              <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-30 p-2">
                                {previewSide === 'front' && cardData && (
                                  <div className="flex gap-1.5">
                                    <label className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer shadow-sm" title="Replace Front Image">
                                      <ImagePlus className="w-3.5 h-3.5" />
                                      <input type="file" className="hidden" accept="image/*" onChange={(e) => replaceFrontImage(e, imageIndex)} />
                                    </label>

                                    <label className={`p-1.5 text-white rounded cursor-pointer shadow-sm ${cardData.customBack ? 'bg-green-600 hover:bg-green-500' : 'bg-slate-600 hover:bg-slate-500'} `} title="Set Custom Back Image">
                                      <RotateCcw className="w-3.5 h-3.5" />
                                      <input type="file" className="hidden" accept="image/*" onChange={(e) => handleIndividualBackUpload(e, imageIndex)} />
                                    </label>

                                    <button
                                      onClick={() => removeFrontImage(imageIndex)}
                                      className="p-1.5 bg-red-500 text-white rounded hover:bg-red-400 shadow-sm"
                                      title="Remove Card"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}

                                {previewSide === 'back' && cardData && (
                                  <div className="flex gap-1.5">
                                    <label className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-500 cursor-pointer shadow-sm" title="Upload Custom Back">
                                      <Upload className="w-3.5 h-3.5" />
                                      <input type="file" className="hidden" accept="image/*" onChange={(e) => handleIndividualBackUpload(e, imageIndex)} />
                                    </label>

                                    <button
                                      onClick={() => clearIndividualBack(imageIndex)}
                                      className="p-1.5 bg-red-500 text-white rounded hover:bg-red-400 shadow-sm"
                                      title="Clear Back (Blank)"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>

                                    {cardData.customBack !== undefined && (
                                      <button
                                        onClick={() => revertIndividualBack(imageIndex)}
                                        className="p-1.5 bg-slate-500 text-white rounded hover:bg-slate-400 shadow-sm"
                                        title="Revert to Common Back"
                                      >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {getConfigNum('printCutLines') === true && (
                            <div
                              className="absolute border border-blue-400/50 pointer-events-none shadow-sm"
                              style={{
                                width: drawW,
                                height: drawH,
                                left: drawX,
                                top: drawY,
                                zIndex: 20
                              }}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </BatcherPROContext.Provider>
  );
};

// Export sidebar component for use in Dashboard  
export const BatcherPROSidebar = () => {
  const ctx = useContext(BatcherPROContext);
  if (!ctx) return null;

  const {
    config,
    setConfig,
    frontImages,
    setFrontImages,
    backImage,
    setBackImage,
    templateOverlay,
    setTemplateOverlay,
    presetName,
    setPresetName,
    savedPresets,
    setSavedPresets,
    isLoadingProject,
    setIsLoadingProject,
    generating,
    sidebarGridCols,
    setSidebarGridCols,
    fileInputRef,
    updateConfig,
    updateStringConfig,
    handleNumberKeyDown,
    handleFrontUpload,
    handleBackUpload,
    handleBatchBackUpload,
    handleBatchSpotMaskUpload,
    handleOverlayUpload,
    removeFrontImage,
    exportPreset,
    importPreset,
    exportProject,
    importProject
  } = ctx;

  // Return the sidebar content (same as what was in the aside tag)
  // This will be rendered in Dashboard sidebar
  return (
    <div className="flex-1 overflow-y-auto" style={{ color: 'var(--text-primary)' }}>
      <div className="p-6" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="font-bold flex items-center gap-2 mb-6" style={{ color: 'var(--text-primary)' }}>
          <Settings className="w-4 h-4" /> Layout Settings
        </h2>

        <div className="space-y-8">
          {/* Registration Bar */}
          <div className="pb-6" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between mb-4">
              <label className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Move className="w-3 h-3" /> Registration Bar
              </label>
              <input
                type="checkbox"
                checked={config.showRegMarks}
                onChange={(e) => setConfig({ ...config, showRegMarks: e.target.checked })}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--accent-primary)' }}
              />
            </div>

            {config.showRegMarks && (
              <div className="p-5 rounded space-y-5" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                <div className="grid grid-cols-1 gap-5">
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Width (mm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={config.regMarkWidth}
                      onChange={(e) => updateConfig('regMarkWidth', e.target.value)}
                      onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkWidth')}
                      className="w-full p-2.5 rounded text-xs outline-none"
                      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                      onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Height (mm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={config.regMarkHeight}
                      onChange={(e) => updateConfig('regMarkHeight', e.target.value)}
                      onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkHeight')}
                      className="w-full p-2.5 rounded text-xs outline-none"
                      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                      onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-5">
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Pos X (mm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={config.regMarkX}
                      onChange={(e) => updateConfig('regMarkX', e.target.value)}
                      onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkX')}
                      className="w-full p-2.5 rounded text-xs outline-none"
                      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                      onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Pos Y (mm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={config.regMarkY}
                      onChange={(e) => updateConfig('regMarkY', e.target.value)}
                      onKeyDown={(e) => handleNumberKeyDown(e, 'regMarkY')}
                      className="w-full p-2.5 rounded text-xs outline-none"
                      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                      onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                      onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Margins */}
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Top Margin (mm)</label>
              <input
                type="number"
                step="0.1"
                value={config.marginTop}
                onChange={(e) => updateConfig('marginTop', e.target.value)}
                onKeyDown={(e) => handleNumberKeyDown(e, 'marginTop')}
                className="w-full p-2.5 rounded text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Left Margin (mm)</label>
              <input
                type="number"
                step="0.1"
                value={config.marginLeft}
                onChange={(e) => updateConfig('marginLeft', e.target.value)}
                onKeyDown={(e) => handleNumberKeyDown(e, 'marginLeft')}
                className="w-full p-2.5 rounded text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>
          </div>

          {/* Gaps */}
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Gap X (mm)</label>
              <input
                type="number"
                step="0.1"
                value={config.gapHorizontal}
                onChange={(e) => updateConfig('gapHorizontal', e.target.value)}
                onKeyDown={(e) => handleNumberKeyDown(e, 'gapHorizontal')}
                className="w-full p-2.5 rounded text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Gap Y (mm)</label>
              <input
                type="number"
                step="0.1"
                value={config.gapVertical}
                onChange={(e) => updateConfig('gapVertical', e.target.value)}
                onKeyDown={(e) => handleNumberKeyDown(e, 'gapVertical')}
                className="w-full p-2.5 rounded text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>
          </div>

          {/* Sheet Size Selection */}
          <div className="p-5 rounded" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-4">
              <Layout className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
              <label className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Sheet Configuration</label>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Paper Size</label>
                <select
                  value={config.sheetSize}
                  onChange={(e) => updateStringConfig('sheetSize', e.target.value)}
                  className="w-full p-2.5 rounded text-xs outline-none"
                  style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                >
                  {Object.entries(PAPER_SIZES).map(([key, val]) => (
                    <option key={key} value={key} style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>{val.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Orientation</label>
                <div className="flex rounded overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
                  <button
                    onClick={() => updateStringConfig('orientation', 'portrait')}
                    className={`px-3 py-1.5 text-xs font-bold ${config.orientation === 'portrait' ? '' : ''} `}
                    style={config.orientation === 'portrait'
                      ? { backgroundColor: 'var(--accent-primary)', color: 'var(--text-primary)' }
                      : { color: 'var(--text-secondary)' }
                    }
                  >
                    Portrait
                  </button>
                  <div className="w-[1px]" style={{ backgroundColor: 'var(--border-color)' }}></div>
                  <button
                    onClick={() => updateStringConfig('orientation', 'landscape')}
                    className={`px-3 py-1.5 text-xs font-bold ${config.orientation === 'landscape' ? '' : ''} `}
                    style={config.orientation === 'landscape'
                      ? { backgroundColor: 'var(--accent-primary)', color: 'var(--text-primary)' }
                      : { color: 'var(--text-secondary)' }
                    }
                  >
                    Landscape
                  </button>
                </div>
              </div>

              {config.sheetSize === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>W (mm)</label>
                    <input
                      type="number"
                      value={config.customSheetWidth}
                      onChange={(e) => updateConfig('customSheetWidth', e.target.value)}
                      onKeyDown={(e) => handleNumberKeyDown(e, 'customSheetWidth')}
                      className="w-full p-2.5 rounded text-xs"
                      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>H (mm)</label>
                    <input
                      type="number"
                      value={config.customSheetHeight}
                      onChange={(e) => updateConfig('customSheetHeight', e.target.value)}
                      onKeyDown={(e) => handleNumberKeyDown(e, 'customSheetHeight')}
                      className="w-full p-2.5 rounded text-xs"
                      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Columns</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={config.gridCols}
                    onChange={(e) => updateConfig('gridCols', e.target.value)}
                    className="w-full p-2.5 rounded text-xs outline-none"
                    style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Rows</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={config.gridRows}
                    onChange={(e) => updateConfig('gridRows', e.target.value)}
                    className="w-full p-2.5 rounded text-xs outline-none"
                    style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Card Dimensions */}
          <div className="grid grid-cols-1 gap-5">
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Card Width (mm)</label>
              <input
                type="number"
                step="0.1"
                value={config.cardWidth}
                onChange={(e) => updateConfig('cardWidth', e.target.value)}
                onKeyDown={(e) => handleNumberKeyDown(e, 'cardWidth')}
                className="w-full p-2.5 rounded text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Card Height (mm)</label>
              <input
                type="number"
                step="0.1"
                value={config.cardHeight}
                onChange={(e) => updateConfig('cardHeight', e.target.value)}
                onKeyDown={(e) => handleNumberKeyDown(e, 'cardHeight')}
                className="w-full p-2.5 rounded text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>
          </div>

          {/* Output Resolution Setting */}
          <div className="p-4 rounded" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <label className="block text-xs font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--accent-primary)' }}>
              <Printer className="w-3 h-3" /> Print Resolution (DPI)
            </label>
            <select
              value={config.targetDPI}
              onChange={(e) => updateConfig('targetDPI', parseInt(e.target.value))}
              className="w-full p-2.5 rounded text-sm font-medium outline-none"
              style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
            >
              <option value="300" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>300 DPI (Standard)</option>
              <option value="600" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>600 DPI (High Quality)</option>
              <option value="1200" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>1200 DPI (Ultra Fine)</option>
            </select>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Note: 1200 DPI may take longer to process and create larger files.
            </p>
          </div>

          {/* Print Cut Lines Option */}
          <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <label className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Print Cut Lines (Dashed)</label>
            <input
              type="checkbox"
              checked={config.printCutLines}
              onChange={(e) => setConfig(p => ({ ...p, printCutLines: e.target.checked }))}
              className="w-4 h-4 rounded"
              style={{ accentColor: 'var(--accent-primary)' }}
            />
          </div>
        </div>
      </div>

      <div className="p-6" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="font-bold flex items-center gap-2 mb-6" style={{ color: 'var(--text-primary)' }}>
          <ImageIcon className="w-4 h-4" /> Assets
        </h2>

        <div className="space-y-6">
          {/* Front Upload */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>1. Batch Upload Fronts</label>
            </div>
            <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors" style={{ borderColor: 'var(--accent-primary)', backgroundColor: 'var(--bg-card)' }}>
              <div className="flex flex-col items-center justify-center pt-6 pb-6">
                <Upload className="w-6 h-6 mb-2" style={{ color: 'var(--accent-primary)' }} />
                <p className="text-xs font-medium" style={{ color: 'var(--accent-primary)' }}>Click to upload cards</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{frontImages.length} cards loaded</p>
              </div>
              <input
                type="file"
                className="hidden"
                multiple
                accept="image/*"
                onChange={handleFrontUpload}
                ref={fileInputRef}
              />
            </label>
          </div>

          {/* Back Upload */}
          <div>
            <label className="block text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>2. Common Back Image</label>
            <div className="flex gap-3 items-center">
              <label className="flex-1 flex items-center justify-center h-12 rounded cursor-pointer text-xs" style={{ border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                {backImage ? 'Change Back' : 'Upload Back'}
                <input type="file" className="hidden" accept="image/*" onChange={handleBackUpload} />
              </label>
              {backImage && (
                <>
                  <img src={backImage} className="w-12 h-12 object-cover rounded" style={{ border: '1px solid var(--border-color)' }} alt="Back" />
                  <button
                    onClick={() => setBackImage(null)}
                    className="w-12 h-12 flex items-center justify-center rounded shrink-0"
                    style={{ color: 'var(--status-cancelled)', border: '1px solid var(--border-color)' }}
                    title="Remove Back Image"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {/* Batch Unique Backs Upload */}
            <div className="mt-4">
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>3. Batch Unique Backs</label>
              <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed rounded-lg cursor-pointer transition-colors" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
                <div className="flex flex-col items-center justify-center pt-3 pb-3">
                  <Images className="w-4 h-4 mb-1" style={{ color: 'var(--text-secondary)' }} />
                  <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Batch Upload Backs (Sequential)</p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={handleBatchBackUpload}
                />
              </label>
            </div>

            {/* Batch Spot Mask Upload */}
            <div className="mt-4">
              <label className="block text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                4. Batch Spot Masks (Silver) <Sparkles className="w-3 h-3" style={{ color: 'var(--accent-secondary)' }} />
              </label>
              <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed rounded-lg cursor-pointer transition-colors" style={{ borderColor: 'var(--accent-secondary)', backgroundColor: 'var(--bg-card)' }}>
                <div className="flex flex-col items-center justify-center pt-3 pb-3">
                  <Sparkles className="w-4 h-4 mb-1" style={{ color: 'var(--accent-secondary)' }} />
                  <p className="text-xs font-medium" style={{ color: 'var(--accent-secondary)' }}>Batch Upload Masks (Sequential)</p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={handleBatchSpotMaskUpload}
                />
              </label>
            </div>

            {/* Duplex Toggle */}
            <div className="mt-5 flex items-center justify-between p-3 rounded" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <label className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Flip 180° (Duplex Fix)</label>
              <input
                type="checkbox"
                checked={config.flipBackPage}
                onChange={(e) => setConfig(p => ({ ...p, flipBackPage: e.target.checked }))}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--accent-primary)' }}
              />
            </div>

            {/* Back Shift / Offset Controls */}
            <div className="mt-3 p-3 rounded space-y-3" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2">
                <AlignCenterVertical className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
                <label className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>Back Page Shift (mm)</label>
              </div>
              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Shift X</label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.backShiftX}
                    onChange={(e) => updateConfig('backShiftX', e.target.value)}
                    onKeyDown={(e) => handleNumberKeyDown(e, 'backShiftX')}
                    className="w-full p-2.5 rounded text-xs outline-none"
                    style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                    placeholder="0.0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Shift Y</label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.backShiftY}
                    onChange={(e) => updateConfig('backShiftY', e.target.value)}
                    onKeyDown={(e) => handleNumberKeyDown(e, 'backShiftY')}
                    className="w-full p-2.5 rounded text-xs outline-none"
                    style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                    placeholder="0.0"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Template Overlay */}
          <div>
            <label className="block text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>3. Template Overlay (Guide)</label>
            <div className="flex gap-3 items-center mb-3">
              <label className="flex-1 flex items-center justify-center h-12 rounded cursor-pointer text-xs" style={{ border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                {templateOverlay ? 'Change Overlay' : 'Upload Guide'}
                <input type="file" className="hidden" accept="image/*" onChange={handleOverlayUpload} />
              </label>
              {templateOverlay && (
                <button
                  onClick={() => setTemplateOverlay(null)}
                  className="w-12 h-12 flex items-center justify-center rounded"
                  style={{ color: 'var(--status-cancelled)', border: '1px solid var(--border-color)' }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {templateOverlay && (
              <div>
                <label className="flex justify-between text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                  <span>Overlay Opacity</span>
                  <span>{Math.round(config.overlayOpacity * 100)}%</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.overlayOpacity}
                  onChange={(e) => updateConfig('overlayOpacity', e.target.value)}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                  style={{ backgroundColor: 'var(--bg-hover)' }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 pb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Uploaded Fronts</h2>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({frontImages.length})</span>
          </div>
          {/* Thumbnail Size Slider */}
          <div className="flex items-center gap-2" title="Thumbnail Size">
            <ZoomOut className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
            <input
              type="range"
              min="2"
              max="6"
              step="1"
              value={sidebarGridCols}
              onChange={(e) => setSidebarGridCols(parseInt(e.target.value))}
              className="w-16 h-1 rounded-lg appearance-none cursor-pointer"
              style={{ backgroundColor: 'var(--bg-hover)', accentColor: 'var(--accent-primary)' }}
            />
            <ZoomIn className="w-3 h-3" style={{ color: 'var(--text-secondary)' }} />
          </div>
        </div>

        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${sidebarGridCols}, minmax(0, 1fr))` }}
        >
          {frontImages.map((img, idx) => (
            <div key={img.id} className="relative group aspect-[2.5/3.5]">
              <img
                loading="lazy"
                src={img.url}
                className="w-full h-full object-cover rounded"
                style={{ border: '1px solid var(--border-color)' }}
                alt=""
              />
              <div className="absolute inset-0 bg-black/50 hidden group-hover:flex items-center justify-center rounded">
                <button
                  onClick={() => removeFrontImage(idx)}
                  className="text-white p-1 hover:bg-red-500 rounded-full transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1 rounded-tl">
                {idx + 1}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SAVE / LOAD SECTION - Sticky Footer */}
      <div className="shrink-0 p-4 z-20" style={{ borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
        <h2 className="font-bold flex items-center gap-2 mb-4" style={{ color: 'var(--text-primary)' }}>
          <Save className="w-4 h-4" /> Save & Load
        </h2>

        {/* Layout Presets (FILE EXPORT/IMPORT) */}
        <div className="mb-4">
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Layout Presets (File)</label>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset Name"
                className="flex-1 p-1.5 rounded text-xs"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={exportPreset}
                className="flex items-center justify-center gap-1 px-3 py-1.5 rounded text-xs font-semibold transition-colors"
                style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--text-primary)' }}
                title="Download Preset File"
              >
                <Download className="w-3 h-3" /> Save
              </button>
            </div>

            <label className="flex items-center justify-center gap-1 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer w-full" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }}>
              <Upload className="w-3 h-3" /> Load Preset File
              <input type="file" accept=".json" className="hidden" onChange={importPreset} />
            </label>
          </div>
        </div>

        {/* Full Project */}
        <div className="pt-2" style={{ borderTop: '1px solid var(--border-color)' }}>
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Full Project (With Images)</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={exportProject}
              disabled={generating}
              className="flex items-center justify-center gap-1 py-1.5 rounded text-xs font-semibold transition-colors"
              style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }}
            >
              <Download className="w-3 h-3" /> Save Project
            </button>
            <label className={`flex items-center justify-center gap-1 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${isLoadingProject ? 'opacity-50 cursor-wait' : ''} `} style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' }}>
              {isLoadingProject ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              Load Project
              <input type="file" accept=".json" className="hidden" onChange={importProject} disabled={isLoadingProject} />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardBatcherPro;
