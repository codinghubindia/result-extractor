import React, { useState, useCallback, useRef } from 'react';
import { UsnSearchForm } from './UsnSearchForm';
import { StudentProfileHeader } from './StudentProfileHeader';
import { MetricCards } from './MetricCards';
import { CoursesTable } from './CoursesTable';
import { Alert } from '../common/Alert';
import { CaptchaModal } from '../common/CaptchaModal';
import { StudentProfileSkeleton } from '../common/SkeletonLoader';
import {
  GraduationCap,
  ArrowRight,
  ShieldCheck,
  Database,
  RefreshCw,
  Terminal,
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { submitCaptchaSolution, reloadCaptchaChallenge } from '../../api/apiClient';

/**
 * Single USN Scraper view: search form, student profile header, SGPA/CGPA cards,
 * courses table, and human-in-the-loop CAPTCHA relay modal.
 *
 * @param {Object} props
 * @param {Function} [props.onScrape] - External scrape trigger (e.g. from TanStack Query hook)
 * @param {Object} [props.data] - Scraped student result data
 * @param {boolean} [props.isLoading=false]
 * @param {string|Object} [props.error=null]
 * @param {Function} [props.onExport] - Export callback
 * @param {Object} [props.captchaChallenge] - Active CAPTCHA challenge
 * @param {Function} [props.onSubmitCaptcha] - CAPTCHA solution submit callback
 * @param {Function} [props.onCancelCaptcha] - CAPTCHA cancel callback
 * @param {boolean} [props.isSubmittingCaptcha=false]
 * @param {string} [props.captchaError=null]
 * @param {string} [props.className]
 */
export function SingleScraperView({
  onScrape,
  data,
  isLoading = false,
  error = null,
  onExport,
  captchaChallenge: externalCaptchaChallenge,
  onSubmitCaptcha: externalSubmitCaptcha,
  onCancelCaptcha: externalCancelCaptcha,
  isSubmittingCaptcha: externalIsSubmittingCaptcha = false,
  captchaError: externalCaptchaError = null,
  className,
}) {
  const [internalResult, setInternalResult] = useState(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalError, setInternalError] = useState(null);
  const [activeExamIndex, setActiveExamIndex] = useState(0);
  const [lastSearchedUsn, setLastSearchedUsn] = useState('');
  const [lastSearchOptions, setLastSearchOptions] = useState({});

  // Standalone CAPTCHA relay state
  const [internalCaptchaChallenge, setInternalCaptchaChallenge] = useState(null);
  const [internalSubmittingCaptcha, setInternalSubmittingCaptcha] = useState(false);
  const [internalReloadingCaptcha, setInternalReloadingCaptcha] = useState(false);
  const [internalCaptchaError, setInternalCaptchaError] = useState(null);

  // Live activity console & progress tracking
  const [logs, setLogs] = useState([]);
  const [currentStep, setCurrentStep] = useState(null); // 'connecting' | 'solving_captcha' | 'navigating' | 'extracting' | 'completed' | 'error'
  const logIntervalRef = useRef(null);

  // Helper to append a timestamped log entry
  const addLog = useCallback((message, level = 'info') => {
    setLogs((prev) => [
      ...prev.slice(-100),
      {
        time: new Date().toLocaleTimeString(),
        message,
        level,
      },
    ]);
  }, []);

  // Support both external prop-driven mode and self-contained mode
  const isControlled = data !== undefined || onScrape !== undefined;
  const activeData = isControlled ? data : internalResult;
  const activeIsLoading = isControlled ? isLoading : internalLoading;
  const activeError = isControlled ? error : internalError;

  const activeCaptchaChallenge =
    externalCaptchaChallenge !== undefined ? externalCaptchaChallenge : internalCaptchaChallenge;
  const activeIsSubmittingCaptcha =
    externalIsSubmittingCaptcha !== undefined ? externalIsSubmittingCaptcha : internalSubmittingCaptcha;
  const activeCaptchaError =
    externalCaptchaError !== undefined ? externalCaptchaError : internalCaptchaError;

  const handleSearch = async (usn, options = {}) => {
    setLastSearchedUsn(usn);
    setLastSearchOptions(options);
    setLogs([]);
    setCurrentStep('connecting');

    addLog(`[Client] Initializing lookup for USN ${usn.toUpperCase()}...`);
    addLog(`[Client] Connecting to Contineo portal gateway...`);

    if (onScrape) {
      onScrape(usn, options);
      return;
    }

    // Standalone fallback: execute direct API call
    let pollInterval = null;
    let stepTimer1 = null;
    let stepTimer2 = null;

    try {
      setInternalLoading(true);
      setInternalError(null);
      setActiveExamIndex(0);

      // Simulate realistic step transitions while the backend browser runs
      stepTimer1 = setTimeout(() => {
        setCurrentStep('solving_captcha');
        addLog(`[Worker 1] Portal login loaded. Processing CAPTCHA image with neural OCR...`);
      }, 1200);

      stepTimer2 = setTimeout(() => {
        setCurrentStep('navigating');
        addLog(`[Worker 1] Submitting credentials and verifying session response...`);
      }, 3500);

      // Start fast polling for CAPTCHA challenge while server is attempting OCR / relay
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/scrape/captcha-pending');
          if (res.ok) {
            const json = await res.json();
            const chal = json.data || json.challenge;
            if (chal && chal.challengeId) {
              addLog(`[Relay] OCR auto-solve ambiguous. Human CAPTCHA solution required.`, 'warn');
              setInternalCaptchaChallenge((prev) => {
                if (prev && prev.challengeId === chal.challengeId && prev.captchaImageBase64 === chal.captchaImageBase64) {
                  return prev;
                }
                return {
                  challengeId: chal.challengeId,
                  usn: chal.usn || usn,
                  captchaImageBase64: chal.captchaImageBase64,
                };
              });
            }
          }
        } catch {}
      }, 1500);

      const response = await fetch('/api/scrape/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usn,
          latestOnly: Boolean(options.latestOnly),
          semester: options.semester || undefined,
        }),
      });

      const json = await response.json();
      if (!response.ok) {
        // If server indicates human CAPTCHA required
        if (json.code === 'CAPTCHA_SOLVE_FAILED' && json.details?.captchaImage) {
          addLog(`[Relay] CAPTCHA auto-solve failed. Prompting human solver modal...`, 'warn');
          setInternalCaptchaChallenge((prev) => {
            if (prev && prev.challengeId === json.details.challengeId) return prev;
            return {
              challengeId: json.details.challengeId,
              usn,
              captchaImageBase64: json.details.captchaImage,
            };
          });
          return;
        }

        const errMsg = json.detail || json.message || `Request failed with status ${response.status}`;
        addLog(`[Error] Portal returned failure: ${errMsg}`, 'error');
        setCurrentStep('error');
        throw new Error(errMsg);
      }

      setCurrentStep('extracting');
      addLog(`[Worker 1] Authentication verified. Parsing student profile and course grades table...`, 'success');

      const extracted = json.data || json;
      const count = Array.isArray(extracted) ? extracted.length : 1;
      addLog(`[Success] Extracted ${count} result records for ${usn.toUpperCase()} successfully.`, 'success');
      setCurrentStep('completed');
      setInternalResult(extracted);
    } catch (err) {
      setCurrentStep('error');
      addLog(`[Failure] ${err.message || 'Lookup encountered an unrecoverable error.'}`, 'error');
      setInternalError(err.message || 'Failed to fetch student result from university portal.');
    } finally {
      if (pollInterval) clearInterval(pollInterval);
      if (stepTimer1) clearTimeout(stepTimer1);
      if (stepTimer2) clearTimeout(stepTimer2);
      setInternalLoading(false);
    }
  };

  const handleReloadCaptcha = useCallback(async () => {
    const challengeId = activeCaptchaChallenge?.challengeId;
    if (!challengeId) return;

    try {
      setInternalReloadingCaptcha(true);
      setInternalCaptchaError(null);
      const res = await reloadCaptchaChallenge({ challengeId });
      const newImg = res?.data?.captchaImageBase64 || res?.data?.captchaImage;
      if (newImg) {
        setInternalCaptchaChallenge((prev) => ({
          ...prev,
          captchaImageBase64: newImg,
          captchaImage: newImg,
        }));
      }
    } catch (err) {
      setInternalCaptchaError(err.message || 'Failed to reload CAPTCHA image');
    } finally {
      setInternalReloadingCaptcha(false);
    }
  }, [activeCaptchaChallenge?.challengeId]);

  const handleSubmitCaptcha = useCallback(async (text) => {
    if (externalSubmitCaptcha) {
      await externalSubmitCaptcha(text);
      return;
    }

    try {
      setInternalSubmittingCaptcha(true);
      setInternalCaptchaError(null);
      await submitCaptchaSolution({
        challengeId: activeCaptchaChallenge?.challengeId,
        text,
      });
      setInternalCaptchaChallenge(null);
    } catch (err) {
      setInternalCaptchaError(err.message || 'Failed to verify CAPTCHA solution');
    } finally {
      setInternalSubmittingCaptcha(false);
    }
  }, [externalSubmitCaptcha, activeCaptchaChallenge?.challengeId]);

  const handleCancelCaptcha = useCallback(() => {
    if (externalCancelCaptcha) {
      externalCancelCaptcha();
    } else {
      setInternalCaptchaChallenge(null);
      setInternalCaptchaError(null);
    }
  }, [externalCancelCaptcha]);

  // Resolve result object when multiple exams are returned in an array
  let currentResult = null;
  let allExams = [];
  if (Array.isArray(activeData)) {
    allExams = activeData;
    currentResult = activeData[activeExamIndex] || activeData[0];
  } else if (activeData && Array.isArray(activeData.exams)) {
    allExams = activeData.exams;
    currentResult = activeData.exams[activeExamIndex] || activeData.exams[0];
  } else if (activeData) {
    currentResult = activeData;
  }

  const errorMessage =
    typeof activeError === 'string'
      ? activeError
      : activeError?.detail || activeError?.message || null;

  return (
    <div className={cn('space-y-6', className)}>
      {/* Top Banner / Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Single USN Scraper
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Instant university seat lookup with OCR CAPTCHA auto-solving and full course marks breakdown.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 self-start sm:self-auto text-xs text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
            <span>Contineo Portal Verified</span>
          </div>
        </div>

        {/* Search input form */}
        <UsnSearchForm onSubmit={handleSearch} loading={activeIsLoading} />
      </div>

      {/* Live Worker Activity & Progress Console (Identical to Bulk Studio) */}
      {(activeIsLoading || logs.length > 0) && (
        <div className="space-y-3">
          {/* Active Pipeline Status Banner */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-white font-mono text-xs font-bold",
                  activeIsLoading ? "bg-blue-600 animate-pulse" : currentStep === 'completed' ? "bg-emerald-600" : "bg-rose-600"
                )}>
                  {activeIsLoading ? "1/1" : currentStep === 'completed' ? "✓" : "!"}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    Scraping Pipeline Status: {lastSearchedUsn ? lastSearchedUsn.toUpperCase() : 'SINGLE USN'}
                    {activeIsLoading && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-ping" />
                        RUNNING
                      </span>
                    )}
                    {!activeIsLoading && currentStep === 'completed' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" />
                        COMPLETED
                      </span>
                    )}
                    {!activeIsLoading && currentStep === 'error' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                        <AlertCircle className="h-3 w-3" />
                        STOPPED / ERROR
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {activeIsLoading
                      ? 'Automated Puppeteer browser is interacting with Contineo portal and solving OCR.'
                      : currentStep === 'completed'
                      ? 'Extraction completed and academic records parsed successfully.'
                      : 'Workflow stopped. See details in error banner and activity console below.'}
                  </p>
                </div>
              </div>

              {/* Progress percentage pill */}
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-slate-500">Progress:</span>
                <span className={cn(
                  "font-bold px-2 py-0.5 rounded",
                  activeIsLoading ? "bg-blue-100 text-blue-900" : currentStep === 'completed' ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"
                )}>
                  {currentStep === 'completed' ? '100%' : currentStep === 'extracting' ? '85%' : currentStep === 'navigating' ? '60%' : currentStep === 'solving_captcha' ? '35%' : currentStep === 'connecting' ? '15%' : '0%'}
                </span>
              </div>
            </div>

            {/* Stepper visual tracking */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 text-[11px] font-medium">
              <div className={cn(
                "flex items-center gap-2 p-2 rounded border transition-colors",
                ['connecting', 'solving_captcha', 'navigating', 'extracting', 'completed'].includes(currentStep)
                  ? "bg-blue-50/70 border-blue-200 text-blue-900"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              )}>
                <span className="font-bold">1.</span> Portal Gateway
              </div>
              <div className={cn(
                "flex items-center gap-2 p-2 rounded border transition-colors",
                ['solving_captcha', 'navigating', 'extracting', 'completed'].includes(currentStep)
                  ? "bg-blue-50/70 border-blue-200 text-blue-900"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              )}>
                <span className="font-bold">2.</span> CAPTCHA OCR
              </div>
              <div className={cn(
                "flex items-center gap-2 p-2 rounded border transition-colors",
                ['navigating', 'extracting', 'completed'].includes(currentStep)
                  ? "bg-blue-50/70 border-blue-200 text-blue-900"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              )}>
                <span className="font-bold">3.</span> Auth & Navigate
              </div>
              <div className={cn(
                "flex items-center gap-2 p-2 rounded border transition-colors",
                currentStep === 'completed'
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900 font-semibold"
                  : currentStep === 'extracting'
                  ? "bg-blue-50/70 border-blue-200 text-blue-900"
                  : "bg-slate-50 border-slate-200 text-slate-500"
              )}>
                <span className="font-bold">4.</span> Parse Results
              </div>
            </div>
          </div>

          {/* Live Activity Console (Dark Terminal identical to Bulk Studio) */}
          <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-100 shadow-sm">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <span className="flex items-center gap-2 font-semibold text-slate-300">
                <span className={cn("h-2 w-2 rounded-full", activeIsLoading ? "bg-emerald-400 animate-ping" : "bg-slate-500")} />
                <Terminal className="h-3.5 w-3.5 text-slate-400" />
                Live Worker Activity Console
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500">{logs.length} logged events</span>
                {logs.length > 0 && !activeIsLoading && (
                  <button
                    onClick={() => setLogs([])}
                    className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700">
              {logs.length > 0 ? (
                logs.map((log, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="text-slate-500 shrink-0 select-none">[{log.time}]</span>
                    <span
                      className={cn(
                        'break-words',
                        log.level === 'error'
                          ? 'text-rose-400 font-bold'
                          : log.level === 'warn'
                          ? 'text-amber-400'
                          : log.level === 'success'
                          ? 'text-emerald-400 font-medium'
                          : 'text-slate-300'
                      )}
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-slate-500 italic py-2 text-center">
                  Worker initialized. Awaiting next request...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error alert */}
      {errorMessage && (
        <Alert
          variant={
            errorMessage.toLowerCase().includes('not found') ||
            errorMessage.toLowerCase().includes('does not exist') ||
            errorMessage.toLowerCase().includes('no records') ||
            errorMessage.toLowerCase().includes('unregistered')
              ? 'warning'
              : 'error'
          }
          title={
            errorMessage.toLowerCase().includes('not found') ||
            errorMessage.toLowerCase().includes('does not exist') ||
            errorMessage.toLowerCase().includes('no records') ||
            errorMessage.toLowerCase().includes('unregistered')
              ? 'Student USN Not Found on Portal'
              : 'Scraping Failed'
          }
          onClose={() => (isControlled ? null : setInternalError(null))}
          action={
            <button
              onClick={() => handleSearch(lastSearchedUsn)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:text-rose-900 underline"
            >
              <RefreshCw className="h-3 w-3" />
              Retry Lookup
            </button>
          }
        >
          {errorMessage}
        </Alert>
      )}

      {/* Loading Skeleton */}
      {activeIsLoading && <StudentProfileSkeleton />}

      {/* Main Student Profile & Results Content */}
      {!activeIsLoading && currentResult && (
        <div className="space-y-6">
          <StudentProfileHeader
            student={currentResult.student}
            exam={currentResult.exam}
            scrapedAt={currentResult.scrapedAt || currentResult.timestamp}
            exams={allExams}
            activeExamIndex={activeExamIndex}
            onSelectExam={(idx) => setActiveExamIndex(idx)}
          />

          <MetricCards summary={currentResult.summary} courses={currentResult.courses || []} />

          <CoursesTable
            courses={currentResult.courses || []}
            summary={currentResult.summary}
            onExport={onExport}
          />
        </div>
      )}

      {/* Empty State */}
      {!activeIsLoading && !currentResult && !errorMessage && (
        <div className="text-center py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-white">
          <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
            <GraduationCap className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 mb-1">
            No Student Record Selected
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mb-4">
            Enter a student University Seat Number above or click one of the quick sample chips to scrape marks, credits, and GPA directly from the portal.
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
              Automated OCR CAPTCHA
            </span>
            <span className="inline-flex items-center gap-1">
              <Database className="h-3.5 w-3.5 text-slate-400" />
              Auto-saved to database
            </span>
            <span className="inline-flex items-center gap-1">
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              Instant Excel & CSV export
            </span>
          </div>
        </div>
      )}

      {/* CAPTCHA Relay Modal */}
      <CaptchaModal
        isOpen={Boolean(activeCaptchaChallenge)}
        onClose={handleCancelCaptcha}
        captchaImage={activeCaptchaChallenge?.captchaImageBase64 || activeCaptchaChallenge?.captchaImage}
        usn={activeCaptchaChallenge?.usn || lastSearchedUsn}
        onSubmit={handleSubmitCaptcha}
        onReload={handleReloadCaptcha}
        isLoading={activeIsSubmittingCaptcha}
        isReloading={internalReloadingCaptcha}
        errorMessage={activeCaptchaError}
      />
    </div>
  );
}

export default SingleScraperView;
