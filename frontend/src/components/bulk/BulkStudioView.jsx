import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BulkConfigForm } from './BulkConfigForm';
import { BulkProgressBar } from './BulkProgressBar';
import { BatchCounters } from './BatchCounters';
import { LiveRecordFeed } from './LiveRecordFeed';
import { Alert } from '../common/Alert';
import { CaptchaModal } from '../common/CaptchaModal';
import { Zap } from 'lucide-react';
import { cn } from '../../utils/cn';
import { submitCaptchaSolution, reloadCaptchaChallenge } from '../../api/apiClient';

/**
 * Bulk USN Studio composite view: range inputs, concurrency controls, live progress,
 * batch metrics, streaming record feed, and human-in-the-loop CAPTCHA relay modal.
 *
 * @param {Object} props
 * @param {Function} [props.onStart] - Triggered with { fromUsn, toUsn, concurrency }
 * @param {Function} [props.onCancel] - Cancel callback
 * @param {Object} [props.job] - Active or historical job data
 * @param {boolean} [props.isStarting=false]
 * @param {boolean} [props.isCancelling=false]
 * @param {Array} [props.liveRecords] - Streamed records
 * @param {Function} [props.onExport] - Export callback
 * @param {Object} [props.captchaChallenge] - Active CAPTCHA challenge from hook
 * @param {Function} [props.onSubmitCaptcha] - Submission handler for CAPTCHA
 * @param {Function} [props.onCancelCaptcha] - Cancellation handler for CAPTCHA
 * @param {boolean} [props.isSubmittingCaptcha=false]
 * @param {string} [props.captchaError]
 * @param {string} [props.className]
 */
export function BulkStudioView({
  onStart,
  onCancel,
  job,
  isStarting = false,
  isCancelling: _isCancelling = false,
  liveRecords,
  onExport,
  captchaChallenge: externalCaptchaChallenge,
  onSubmitCaptcha: externalSubmitCaptcha,
  onCancelCaptcha: externalCancelCaptcha,
  isSubmittingCaptcha: externalIsSubmittingCaptcha = false,
  captchaError: externalCaptchaError = null,
  className,
}) {
  const [internalJob, setInternalJob] = useState(null);
  const [internalRecords, setInternalRecords] = useState([]);
  const [internalRunning, setInternalRunning] = useState(false);
  const [internalStarting, setInternalStarting] = useState(false);
  const [alertInfo, setAlertInfo] = useState(null);
  const [logs, setLogs] = useState([]);

  // Standalone CAPTCHA state for uncontrolled mode
  const [internalCaptchaChallenge, setInternalCaptchaChallenge] = useState(null);
  const [internalSubmittingCaptcha, setInternalSubmittingCaptcha] = useState(false);
  const [internalReloadingCaptcha, setInternalReloadingCaptcha] = useState(false);
  const [internalCaptchaError, setInternalCaptchaError] = useState(null);

  const eventSourceRef = useRef(null);

  const isControlled = job !== undefined;
  const currentJob = isControlled ? job : internalJob;
  const currentRecords = liveRecords !== undefined ? liveRecords : internalRecords;
  const isRunning = isControlled
    ? currentJob?.status === 'RUNNING' || currentJob?.status === 'PENDING' || currentJob?.status === 'in_progress'
    : internalRunning;

  const activeCaptchaChallenge =
    externalCaptchaChallenge !== undefined ? externalCaptchaChallenge : internalCaptchaChallenge;
  const activeIsSubmittingCaptcha =
    externalIsSubmittingCaptcha !== undefined ? externalIsSubmittingCaptcha : internalSubmittingCaptcha;
  const activeCaptchaError =
    externalCaptchaError !== undefined ? externalCaptchaError : internalCaptchaError;

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Polling fallback to guarantee continuous updates even if SSE disconnects
  useEffect(() => {
    const activeId = currentJob?.jobId || currentJob?.id;
    if (!isRunning || !activeId) return;

    const interval = setInterval(() => {
      pollJobStatus(activeId);
    }, 2000);

    return () => clearInterval(interval);
  }, [isRunning, currentJob?.jobId, currentJob?.id]);

  const handleStart = async (config) => {
    if (onStart) {
      onStart(config);
      return;
    }

    // Standalone fallback: start bulk job via backend REST API
    try {
      setInternalStarting(true);
      setAlertInfo(null);
      setInternalRecords([]);
      setLogs([]);

      const response = await fetch('/api/scrape/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          clearPreviousData: Boolean(config?.clearPreviousData),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.message || 'Failed to start bulk scrape job');
      }

      const createdJob = data.data || data;
      setInternalJob(createdJob);
      setInternalRunning(true);

      // Connect SSE stream
      const jobId = createdJob.jobId || createdJob.id;
      if (jobId) {
        connectSseStream(jobId);
      }
    } catch (err) {
      setAlertInfo({
        variant: 'error',
        title: 'Failed to Launch Bulk Job',
        message: err.message,
      });
    } finally {
      setInternalStarting(false);
    }
  };

  const connectSseStream = (jobId) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sse = new EventSource(`/api/scrape/bulk/${jobId}/stream`);
    eventSourceRef.current = sse;

    const handleSsePayload = (rawPayload) => {
      try {
        const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
        if (!payload) return;

        // 1. Worker log messages
        if (payload.type === 'log' && payload.message) {
          setLogs((prev) => [
            ...prev.slice(-150),
            { time: payload.time || new Date().toLocaleTimeString(), message: payload.message },
          ]);
        }

        // 2. CAPTCHA Relay Challenge
        if (payload.type === 'captcha_required') {
          const newImg = payload.captchaImageBase64 || payload.captchaImage;
          setInternalCaptchaChallenge((prev) => {
            if (
              prev &&
              prev.challengeId === payload.challengeId &&
              prev.captchaImageBase64 === newImg
            ) {
              return prev;
            }
            return {
              challengeId: payload.challengeId,
              jobId: payload.jobId || jobId,
              usn: payload.usn,
              captchaImageBase64: newImg,
            };
          });
          setInternalCaptchaError(null);
          return;
        }

        // 3. CAPTCHA Solved
        if (payload.type === 'captcha_solved') {
          setInternalCaptchaChallenge(null);
          setInternalCaptchaError(null);
          return;
        }

        // 4. Progress or Status Updates
        if (payload.processed !== undefined || payload.total !== undefined || payload.status || payload.jobId) {
          setInternalJob((prev) => ({
            ...prev,
            ...payload,
            processed: payload.processed ?? prev?.processed ?? 0,
            total: payload.total ?? prev?.total ?? 0,
            successful: payload.successful ?? prev?.successful ?? 0,
            failed: payload.failed ?? prev?.failed ?? 0,
            currentUsn: payload.usn || payload.currentUsn || prev?.currentUsn,
            status: payload.status || prev?.status,
          }));

          const rec = payload.record || payload.data;
          if (rec && (rec.usn || rec.name)) {
            setInternalRecords((prev) => {
              const exists = prev.some((r) => r.usn === rec.usn);
              return exists ? prev.map((r) => (r.usn === rec.usn ? rec : r)) : [rec, ...prev];
            });
          }

          if (['COMPLETED', 'FAILED', 'CANCELLED', 'completed', 'failed', 'cancelled'].includes(payload.status)) {
            setInternalRunning(false);
            setInternalCaptchaChallenge(null);
            if (eventSourceRef.current) {
              eventSourceRef.current.close();
            }
          }
        }
      } catch (e) {
        console.error('Error handling SSE event:', e);
      }
    };

    sse.addEventListener('captcha_required', (e) => handleSsePayload(e.data));
    sse.addEventListener('captcha_solved', (e) => handleSsePayload(e.data));
    sse.addEventListener('progress', (e) => handleSsePayload(e.data));
    sse.addEventListener('message', (e) => handleSsePayload(e.data));
    sse.onmessage = (e) => handleSsePayload(e.data);

    sse.onerror = () => {
      pollJobStatus(jobId);
    };
  };

  const pollJobStatus = async (jobId) => {
    try {
      const res = await fetch(`/api/scrape/bulk/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        const j = data.data || data;
        setInternalJob(j);
        if (j.results && Array.isArray(j.results) && j.results.length > 0) {
          setInternalRecords(j.results);
        }
        if (['COMPLETED', 'FAILED', 'CANCELLED', 'completed', 'failed', 'cancelled'].includes(j.status)) {
          setInternalRunning(false);
          setInternalCaptchaChallenge(null);
        }
      }
    } catch {}
  };

  const handleCancel = async () => {
    if (onCancel) {
      onCancel();
      return;
    }

    const jobId = currentJob?.jobId || currentJob?.id;
    if (!jobId) return;

    try {
      await fetch(`/api/scrape/bulk/${jobId}/cancel`, { method: 'POST' });
      setInternalRunning(false);
      setInternalCaptchaChallenge(null);
      setAlertInfo({
        variant: 'warning',
        title: 'Job Cancellation Requested',
        message: 'Active worker browsers are shutting down safely.',
      });
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    } catch (err) {
      console.error('Failed to cancel job:', err);
    }
  };

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
        jobId: activeCaptchaChallenge?.jobId || currentJob?.jobId || currentJob?.id,
        text,
      });
      setInternalCaptchaChallenge(null);
    } catch (err) {
      setInternalCaptchaError(err.message || 'Failed to submit CAPTCHA solution');
    } finally {
      setInternalSubmittingCaptcha(false);
    }
  }, [externalSubmitCaptcha, activeCaptchaChallenge?.challengeId, activeCaptchaChallenge?.jobId, currentJob?.jobId, currentJob?.id]);

  const handleCancelCaptcha = useCallback(() => {
    if (externalCancelCaptcha) {
      externalCancelCaptcha();
    } else {
      setInternalCaptchaChallenge(null);
      setInternalCaptchaError(null);
    }
  }, [externalCancelCaptcha]);

  const handleReloadCaptcha = useCallback(async () => {
    const challengeId = activeCaptchaChallenge?.challengeId;
    if (!challengeId) return;

    try {
      setInternalReloadingCaptcha(true);
      setInternalCaptchaError(null);
      const res = await reloadCaptchaChallenge({
        challengeId,
        jobId: activeCaptchaChallenge?.jobId || currentJob?.jobId || currentJob?.id,
      });
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
  }, [activeCaptchaChallenge?.challengeId, activeCaptchaChallenge?.jobId, currentJob?.jobId, currentJob?.id]);

  const metrics = {
    total: currentJob?.total || 0,
    processed: currentJob?.processed || (currentJob?.successful || 0) + (currentJob?.failed || 0) + (currentJob?.skipped || 0),
    successful: currentJob?.successful || currentRecords.length,
    failed: currentJob?.failed || 0,
    skipped: currentJob?.skipped || 0,
    currentUsn: currentJob?.currentUsn || (isRunning ? 'Processing...' : 'Idle'),
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6 shadow-none">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              Bulk USN Studio
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Automated high-throughput batch extraction with parallel workers, live progress, and instant multi-format export.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 self-start sm:self-auto text-xs text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
            <Zap className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
            <span>Parallel Worker Pool</span>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <BulkConfigForm
        onStart={handleStart}
        onCancel={handleCancel}
        isRunning={isRunning}
        isStarting={isStarting || internalStarting}
      />

      {/* Alert banner */}
      {alertInfo && (
        <Alert
          variant={alertInfo.variant}
          title={alertInfo.title}
          onClose={() => setAlertInfo(null)}
        >
          {alertInfo.message}
        </Alert>
      )}

      {/* Progress & Status */}
      {(currentJob || isRunning) && (
        <div className="space-y-4">
          <BulkProgressBar
            processed={metrics.processed}
            total={metrics.total}
            status={currentJob?.status || (isRunning ? 'RUNNING' : 'IDLE')}
          />

          <BatchCounters metrics={metrics} isRunning={isRunning} />

          {/* Live Worker Activity Console */}
          {(isRunning || logs.length > 0) && (
            <div className="rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-100 shadow-sm">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                <span className="flex items-center gap-2 font-semibold text-slate-300">
                  <span className={cn("h-2 w-2 rounded-full", isRunning ? "bg-emerald-400 animate-ping" : "bg-slate-500")} />
                  Live Worker Activity Console
                </span>
                <span className="text-[11px] text-slate-500">{logs.length} logged events</span>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700">
                {logs.length > 0 ? (
                  logs.map((log, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <span className="text-slate-500 shrink-0 select-none">[{log.time}]</span>
                      <span className="text-slate-300 break-words">{log.message}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 italic py-2 text-center">
                    Workers initialized. Waiting for first event...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Live Record Feed */}
      <LiveRecordFeed
        records={currentRecords}
        jobId={currentJob?.jobId || currentJob?.id}
        isRunning={isRunning}
        onExport={onExport}
      />

      {/* CAPTCHA Relay Modal */}
      <CaptchaModal
        isOpen={Boolean(activeCaptchaChallenge)}
        onClose={handleCancelCaptcha}
        captchaImage={activeCaptchaChallenge?.captchaImageBase64 || activeCaptchaChallenge?.captchaImage}
        usn={activeCaptchaChallenge?.usn}
        onSubmit={handleSubmitCaptcha}
        onReload={handleReloadCaptcha}
        isLoading={activeIsSubmittingCaptcha}
        isReloading={internalReloadingCaptcha}
        errorMessage={activeCaptchaError}
      />
    </div>
  );
}

export default BulkStudioView;
