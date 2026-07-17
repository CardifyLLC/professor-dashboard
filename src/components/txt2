import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, User, Users, RefreshCw } from 'lucide-react';

/**
 * Beautiful Export Modal Component
 * 
 * A professionally designed modal for selecting export scope
 * with smooth animations, modern styling, and excellent UX
 */

const BeautifulExportModal = ({
  isOpen,
  onClose,
  onConfirm,
  mode = 'pdf', // 'pdf' or 'mask'
  customerName = null,
  customerCount = 0,
  totalCount = 0,
  customerSheets = 0,
  totalSheets = 0,
  generating = false,
  selection = 'customer',
  onSelectionChange
}) => {
  if (!isOpen) return null;

  const title = mode === 'pdf' ? 'Export PDF' : 'Export Mask PDF';

  // Use the CSS you already added: body.modal-open { overflow: hidden; }
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  const modal = (
    <div
      className="export-modal export-modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-8 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="export-modal-container w-full max-w-3xl rounded-3xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.3)] overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="export-modal-header px-10 pt-10 pb-8 bg-gradient-to-b from-slate-50 to-white border-b border-slate-200">
          <div className="flex items-start justify-between gap-8">
            <div className="flex items-start gap-6 min-w-0 flex-1">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30 shrink-0">
                <Download className="w-7 h-7 text-white" />
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <h2 className="text-3xl font-bold text-slate-900 leading-tight">{title}</h2>
                <p className="text-base text-slate-600 mt-2">
                  Choose which cards to include in your export
                </p>
              </div>
            </div>
            <button
              className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all shrink-0"
              onClick={onClose}
              title="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="export-modal-body px-10 py-10">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em] mb-6">
            Export Scope
          </div>

          <div className="space-y-5">
            {/* Current customer option */}
            <label
              className={`export-option group relative flex items-start gap-6 rounded-2xl border-2 p-7 cursor-pointer transition-all ${
                selection === 'customer'
                  ? 'selected border-blue-500 bg-blue-50/50 shadow-lg shadow-blue-500/10'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <input
                type="radio"
                name="exportScope"
                className="sr-only"
                checked={selection === 'customer'}
                onChange={() => onSelectionChange('customer')}
              />
              
              {/* Custom radio indicator */}
              <div className={`relative shrink-0 w-7 h-7 rounded-full border-2 transition-all mt-1 ${
                selection === 'customer'
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-slate-300 bg-white group-hover:border-slate-400'
              }`}>
                {selection === 'customer' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-white"></div>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                      selection === 'customer'
                        ? 'bg-blue-500 shadow-lg shadow-blue-500/30'
                        : 'bg-slate-100 group-hover:bg-slate-200'
                    }`}>
                      <User className={`w-6 h-6 ${
                        selection === 'customer' ? 'text-white' : 'text-slate-600'
                      }`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-bold text-slate-900 mb-1">
                        Current customer only
                      </div>
                      <div className="text-sm text-slate-600 truncate">
                        {customerName ? `"${customerName}"` : 'Customer on current page'}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="badge inline-flex items-center rounded-full bg-white border-2 border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
                    {customerCount} {customerCount === 1 ? 'card' : 'cards'}
                  </span>
                  <span className="badge inline-flex items-center rounded-full bg-white border-2 border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
                    {customerSheets} {customerSheets === 1 ? 'sheet' : 'sheets'}
                  </span>
                </div>
              </div>
            </label>

            {/* All customers option */}
            <label
              className={`export-option group relative flex items-start gap-6 rounded-2xl border-2 p-7 cursor-pointer transition-all ${
                selection === 'all'
                  ? 'selected border-blue-500 bg-blue-50/50 shadow-lg shadow-blue-500/10'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <input
                type="radio"
                name="exportScope"
                className="sr-only"
                checked={selection === 'all'}
                onChange={() => onSelectionChange('all')}
              />
              
              {/* Custom radio indicator */}
              <div className={`relative shrink-0 w-7 h-7 rounded-full border-2 transition-all mt-1 ${
                selection === 'all'
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-slate-300 bg-white group-hover:border-slate-400'
              }`}>
                {selection === 'all' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-white"></div>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shrink-0 ${
                      selection === 'all'
                        ? 'bg-blue-500 shadow-lg shadow-blue-500/30'
                        : 'bg-slate-100 group-hover:bg-slate-200'
                    }`}>
                      <Users className={`w-6 h-6 ${
                        selection === 'all' ? 'text-white' : 'text-slate-600'
                      }`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-lg font-bold text-slate-900 mb-1">
                        All customers
                      </div>
                      <div className="text-sm text-slate-600">
                        Export everything currently loaded in BatchPro
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="badge inline-flex items-center rounded-full bg-white border-2 border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
                    {totalCount} {totalCount === 1 ? 'card' : 'cards'}
                  </span>
                  <span className="badge inline-flex items-center rounded-full bg-white border-2 border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
                    {totalSheets} {totalSheets === 1 ? 'sheet' : 'sheets'}
                  </span>
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="export-modal-footer px-10 py-7 bg-gradient-to-t from-slate-50 to-white border-t border-slate-200">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
              Tip: Exporting fewer cards is faster
            </div>
            <div className="flex items-center gap-3">
              <button
                className="px-6 py-6 h-12 w-24 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-100 border-2 border-slate-200 transition-all hover:border-slate-300"
                onClick={onClose}
                disabled={generating}
              >
                Cancel
              </button>
              <button
                className={`export-button-animated px-7 py-3 rounded-xl text-sm font-bold text-white transition-all shadow-lg ${
                  generating 
                    ? 'bg-blue-400 cursor-not-allowed' 
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-blue-500/30 hover:shadow-blue-500/50'
                }`}
                onClick={onConfirm}
                disabled={generating}
              >
                <span className="inline-flex items-center gap-2">
                  {generating ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-6 h-6" />
                  )}
                  {generating ? 'Exporting…' : 'Export'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Portal ensures the modal isn't clipped/scaled by any parent with overflow/transform.
  return createPortal(modal, document.body);
};

export default BeautifulExportModal;

/**
 * Usage Example:
 * 
 * const [modalState, setModalState] = useState({
 *   open: false,
 *   mode: 'pdf',
 *   selection: 'customer'
 * });
 * 
 * <BeautifulExportModal
 *   isOpen={modalState.open}
 *   onClose={() => setModalState(prev => ({ ...prev, open: false }))}
 *   onConfirm={handleExport}
 *   mode={modalState.mode}
 *   customerName="BB"
 *   customerCount={3}
 *   totalCount={161}
 *   customerSheets={1}
 *   totalSheets={9}
 *   generating={isGenerating}
 *   selection={modalState.selection}
 *   onSelectionChange={(value) => setModalState(prev => ({ ...prev, selection: value }))}
 * />
 */