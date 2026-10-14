import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Alert } from './Alert';
import { Badge } from './Badge';
import { Skeleton } from './SkeletonLoader';
import { ShieldCheck, KeyRound, ArrowRight, RefreshCw } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Web-Based CAPTCHA Relay Modal for human-in-the-loop CAPTCHA solving.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Controls visibility
 * @param {Function} props.onClose - Triggered when modal is closed/cancelled
 * @param {string} [props.captchaImage] - Base64 string or data URL of portal CAPTCHA canvas
 * @param {string} [props.usn] - University Seat Number being solved for
 * @param {Function} props.onSubmit - Triggered with the entered CAPTCHA string
 * @param {Function} [props.onReload] - Callback to refresh the CAPTCHA image
 * @param {boolean} [props.isLoading=false] - Submission in-flight indicator
 * @param {boolean} [props.isReloading=false] - Reload in-flight indicator
 * @param {string} [props.errorMessage] - Server verification error message
 * @param {string} [props.className]
 */
export function CaptchaModal({
  isOpen,
  onClose,
  captchaImage,
  usn,
  onSubmit,
  onReload,
  isLoading = false,
  isReloading = false,
  errorMessage,
  className,
}) {
  const [captchaText, setCaptchaText] = useState('');
  const [localError, setLocalError] = useState('');
  const inputRef = useRef(null);
  const prevOpenRef = useRef(false);
  const prevImageRef = useRef(null);

  // Auto-focus and reset input only when modal FIRST opens or when image genuinely changes
  useEffect(() => {
    if (!isOpen) {
      prevOpenRef.current = false;
      return;
    }

    const justOpened = !prevOpenRef.current;
    const imageChanged = prevImageRef.current !== null && prevImageRef.current !== captchaImage;
    prevOpenRef.current = true;
    prevImageRef.current = captchaImage;

    if (justOpened || imageChanged) {
      setCaptchaText('');
      setLocalError('');
      const timer = setTimeout(() => {
        if (inputRef.current && document.activeElement !== inputRef.current) {
          inputRef.current.focus();
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen, captchaImage]);

  const handleChange = (e) => {
    // Alphanumeric with exact case preserved
    const val = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
    setCaptchaText(val);
    if (localError) setLocalError('');
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const trimmed = captchaText.trim();
    if (!trimmed) {
      setLocalError('Please enter the security characters shown in the image.');
      return;
    }
    setLocalError('');
    onSubmit(trimmed);
  };

  // Resolve base64 data URL formatting
  const resolvedImageSrc = captchaImage
    ? captchaImage.startsWith('data:')
      ? captchaImage
      : `data:image/png;base64,${captchaImage}`
    : null;

  const handleCloseDialog = () => {
    if (!isLoading && typeof onClose === 'function') {
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCloseDialog}
      title="Security Verification Required"
      size="sm"
      className={className}
      footer={
        <div className="flex w-full items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel Scrape
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            loading={isLoading}
            loadingText="Verifying..."
            disabled={!captchaText.trim() || isLoading}
            iconRight={<ArrowRight className="h-3.5 w-3.5" />}
          >
            Submit CAPTCHA
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Context description & target USN */}
        <div className="flex items-center justify-between pb-1 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-blue-600" aria-hidden="true" />
            <span>Contineo Portal Challenge</span>
          </div>
          {usn && (
            <div className="flex items-center gap-1">
              <span className="text-slate-400">Target USN:</span>
              <Badge variant="primary" size="sm" className="font-mono font-semibold">
                {usn}
              </Badge>
            </div>
          )}
        </div>

        {/* Error Alert from server or local validation */}
        {errorMessage && (
          <Alert variant="error" title="CAPTCHA Challenge">
            Incorrect CAPTCHA entered. Please solve the updated image below.
          </Alert>
        )}

        {localError && (
          <Alert variant="error">
            {localError}
          </Alert>
        )}

        {/* CAPTCHA Image Display Area */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-center">
          <p className="mb-2 text-xs font-medium text-slate-500">
            Type the characters shown in the security box:
          </p>

          <div className="mx-auto flex h-20 w-full max-w-[260px] items-center justify-center rounded-lg border border-slate-300 bg-white p-2 shadow-inner">
            {resolvedImageSrc ? (
              <img
                src={resolvedImageSrc}
                alt="Security verification CAPTCHA challenge"
                className="max-h-16 max-w-full select-none object-contain"
                draggable={false}
              />
            ) : (
              <div className="w-full space-y-2 px-4" aria-label="Loading security image">
                <Skeleton className="h-10 w-full" />
                <span className="text-[11px] text-slate-400">Loading challenge image...</span>
              </div>
            )}
          </div>

          {/* Reload action if image is unclear */}
          {onReload && (
            <div className="mt-2.5 flex items-center justify-center">
              <button
                type="button"
                onClick={onReload}
                disabled={isLoading || isReloading}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isReloading && 'animate-spin')} />
                <span>{isReloading ? 'Reloading Image...' : 'Reload New CAPTCHA'}</span>
              </button>
            </div>
          )}
        </div>

        {/* User Input Field */}
        <div className="space-y-1.5">
          <label
            htmlFor="captcha-input"
            className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-700"
          >
            <span>CAPTCHA Characters</span>
            <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded capitalize">Exact Case-Sensitive</span>
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <input
              ref={inputRef}
              id="captcha-input"
              type="text"
              autoFocus
              value={captchaText}
              onChange={handleChange}
              placeholder="e.g. 7k4BP"
              disabled={isLoading}
              maxLength={10}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              className={cn(
                'block w-full rounded-lg border bg-white py-2.5 pl-9 pr-3 font-mono text-base font-bold tracking-widest text-slate-900 placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500',
                errorMessage || localError
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500'
                  : 'border-slate-300 focus:border-blue-500 hover:border-slate-400'
              )}
            />
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          Press <kbd className="rounded border border-slate-200 bg-slate-100 px-1 font-mono text-[10px] text-slate-700">Enter</kbd> to submit or <kbd className="rounded border border-slate-200 bg-slate-100 px-1 font-mono text-[10px] text-slate-700">Esc</kbd> to cancel.
        </p>
      </form>
    </Modal>
  );
}

export default CaptchaModal;
