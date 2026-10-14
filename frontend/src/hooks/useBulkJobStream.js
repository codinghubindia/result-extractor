import { useState, useEffect, useRef, useCallback } from 'react';
import { cancelBulkJob, getBulkJobStreamUrl, submitCaptchaSolution } from '../api/apiClient';

/**
 * Custom React hook establishing a real-time Server-Sent Events (SSE) stream
 * for an active bulk scraping job with automatic reconnection, heartbeat tracking,
 * CAPTCHA relay handling, and comprehensive progress state aggregation.
 *
 * @param {string|null} jobId - Target bulk job ID (stream connects when provided)
 * @param {Object} [options={}]
 * @param {boolean} [options.enabled=true] - Whether to connect immediately
 * @param {boolean} [options.autoReconnect=true] - Attempt auto-reconnect on unexpected drop
 * @param {number} [options.maxReconnectAttempts=5] - Maximum reconnect tries before giving up
 * @param {number} [options.reconnectDelay=1200] - Base reconnect delay in ms
 * @param {Function} [options.onProgress] - Callback invoked on progress events
 * @param {Function} [options.onCompleted] - Callback invoked on terminal completion
 * @param {Function} [options.onError] - Callback invoked on terminal or streaming error
 * @returns {Object} Bulk stream state and action controllers
 */
export function useBulkJobStream(jobId, options = {}) {
  const {
    enabled = true,
    autoReconnect = true,
    maxReconnectAttempts = 5,
    reconnectDelay = 1200,
    onProgress,
    onCompleted,
    onError,
  } = options;

  // Stream state
  const [status, setStatus] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'completed' | 'cancelled' | 'failed'
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [successful, setSuccessful] = useState(0);
  const [failed, setFailed] = useState(0);
  const [currentUsn, setCurrentUsn] = useState(null);
  const [latestResult, setLatestResult] = useState(null);
  const [results, setResults] = useState([]);
  const [errorsList, setErrorsList] = useState([]);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // CAPTCHA Relay State
  const [captchaChallenge, setCaptchaChallenge] = useState(null);
  const [isSubmittingCaptcha, setIsSubmittingCaptcha] = useState(false);
  const [captchaError, setCaptchaError] = useState(null);

  // Connection control refs
  const eventSourceRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const isTerminatedRef = useRef(false);
  const connectRef = useRef(null);

  // Stable callback refs
  const onProgressRef = useRef(onProgress);
  const onCompletedRef = useRef(onCompleted);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onProgressRef.current = onProgress;
    onCompletedRef.current = onCompleted;
    onErrorRef.current = onError;
  }, [onProgress, onCompleted, onError]);

  // Append entry to formatted logs list
  const appendLog = useCallback((message, type = 'info', metadata = {}) => {
    const entry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toLocaleTimeString(),
      message,
      type, // 'info' | 'success' | 'warn' | 'error'
      metadata,
    };
    setLogs((prev) => [entry, ...prev.slice(0, 99)]); // Maintain latest 100 log entries
  }, []);

  // Cleanup helper
  const closeStream = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Submit human CAPTCHA solution
  const submitCaptcha = useCallback(
    async (text) => {
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('CAPTCHA solution text is required');
      }

      try {
        setIsSubmittingCaptcha(true);
        setCaptchaError(null);
        appendLog(`Submitting CAPTCHA solution for ${captchaChallenge?.usn || 'active challenge'}...`, 'info');

        const result = await submitCaptchaSolution({
          challengeId: captchaChallenge?.challengeId,
          jobId: captchaChallenge?.jobId || jobId,
          text: text.trim().toUpperCase(),
        });

        appendLog('CAPTCHA solution submitted successfully to backend relay.', 'success');
        setCaptchaChallenge(null);
        return result;
      } catch (err) {
        const msg = err.message || 'Failed to submit CAPTCHA solution';
        setCaptchaError(msg);
        appendLog(`CAPTCHA submission error: ${msg}`, 'error');
        throw err;
      } finally {
        setIsSubmittingCaptcha(false);
      }
    },
    [captchaChallenge, jobId, appendLog]
  );

  // Dismiss / Cancel active CAPTCHA challenge
  const cancelCaptcha = useCallback(() => {
    setCaptchaChallenge(null);
    setCaptchaError(null);
    appendLog('CAPTCHA challenge dismissed by user.', 'warn');
  }, [appendLog]);

  // Manual cancel trigger
  const cancel = useCallback(async () => {
    if (!jobId || isTerminatedRef.current || isCancelling) return;

    try {
      setIsCancelling(true);
      appendLog(`Sending cancellation request for job ${jobId}...`, 'warn');
      await cancelBulkJob(jobId);
      setStatus('cancelled');
      setCaptchaChallenge(null);
      isTerminatedRef.current = true;
      closeStream();
      appendLog(`Job ${jobId} successfully cancelled by user.`, 'warn');
    } catch (err) {
      appendLog(`Failed to cancel job ${jobId}: ${err.message}`, 'error');
      setError(err);
    } finally {
      setIsCancelling(false);
    }
  }, [jobId, isCancelling, closeStream, appendLog]);

  // Connect function
  const connect = useCallback(() => {
    if (!jobId || !enabled || typeof window === 'undefined') return;

    closeStream();

    const streamUrl = getBulkJobStreamUrl(jobId);
    setStatus((prev) => (prev === 'idle' ? 'connecting' : 'reconnecting'));
    setError(null);

    appendLog(
      reconnectAttemptsRef.current > 0
        ? `Reconnecting to stream (Attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`
        : `Connecting to real-time progress stream for job ${jobId}...`,
      'info'
    );

    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    // Standard initial handshake event from backend
    es.addEventListener('connected', (event) => {
      try {
        const payload = JSON.parse(event.data);
        setStatus('connected');
        reconnectAttemptsRef.current = 0; // reset retry counter on healthy connection
        appendLog(`Connected to progress stream (Status: ${payload.status || 'in_progress'}).`, 'info');
      } catch {
        setStatus('connected');
      }
    });

    // Listen for dedicated CAPTCHA event
    es.addEventListener('captcha_required', (event) => {
      try {
        const payload = JSON.parse(event.data);
        setCaptchaChallenge({
          challengeId: payload.challengeId,
          jobId: payload.jobId || jobId,
          usn: payload.usn,
          captchaImageBase64: payload.captchaImageBase64 || payload.captchaImage,
          timestamp: Date.now(),
        });
        setCaptchaError(null);
        appendLog(`CAPTCHA relay required for USN ${payload.usn}. Awaiting human input...`, 'warn');
      } catch (parseErr) {
        console.error('Error parsing captcha_required payload:', parseErr);
      }
    });

    es.addEventListener('captcha_solved', () => {
      setCaptchaChallenge(null);
      setCaptchaError(null);
      appendLog('CAPTCHA solved successfully. Resuming scraping...', 'success');
    });

    // Main progress event
    es.addEventListener('progress', (event) => {
      try {
        const payload = JSON.parse(event.data);

        // Update counters if provided
        if (payload.total !== undefined) setTotal(payload.total);
        if (payload.processed !== undefined) setProcessed(payload.processed);
        if (payload.successful !== undefined) setSuccessful(payload.successful);
        if (payload.failed !== undefined) setFailed(payload.failed);

        // Handle specific event sub-types
        switch (payload.type) {
          case 'usn:start': {
            setCurrentUsn(payload.usn);
            appendLog(`[Worker ${payload.workerIndex + 1}] Scraping USN ${payload.usn}...`, 'info');
            break;
          }

          case 'usn:result': {
            setLatestResult(payload.data);
            if (payload.data) {
              setResults((prev) => [payload.data, ...prev]);
            }
            appendLog(
              `Extracted ${payload.usn} - SGPA: ${payload.data?.sgpa || 'N/A'}, Name: ${payload.data?.name || 'Student'}`,
              'success',
              payload.data
            );
            break;
          }

          case 'usn:skipped': {
            const skipEntry = {
              usn: payload.usn,
              status: 'NOT_FOUND',
              message: payload.message || 'Result not found on portal',
            };
            setErrorsList((prev) => [skipEntry, ...prev]);
            appendLog(`Skipped ${payload.usn} (${payload.message || 'Not found'})`, 'warn');
            break;
          }

          case 'usn:error': {
            const errEntry = {
              usn: payload.usn,
              status: 'FAILED',
              error: payload.error || 'Extraction failed',
            };
            setErrorsList((prev) => [errEntry, ...prev]);
            appendLog(`Error on ${payload.usn}: ${payload.error || 'Scrape failed'}`, 'error');
            break;
          }

          case 'captcha_required': {
            setCaptchaChallenge({
              challengeId: payload.challengeId,
              jobId: payload.jobId || jobId,
              usn: payload.usn,
              captchaImageBase64: payload.captchaImageBase64 || payload.captchaImage,
              timestamp: Date.now(),
            });
            setCaptchaError(null);
            appendLog(`CAPTCHA relay required for USN ${payload.usn}. Awaiting human input...`, 'warn');
            break;
          }

          case 'captcha_solved': {
            setCaptchaChallenge(null);
            setCaptchaError(null);
            appendLog(`CAPTCHA solved for USN ${payload.usn || ''}. Resuming batch...`, 'success');
            break;
          }

          case 'job:completed': {
            isTerminatedRef.current = true;
            setStatus(payload.status || 'completed');
            setCurrentUsn(null);
            setCaptchaChallenge(null);
            appendLog(
              `Batch job finished. Successful: ${payload.successful}, Failed: ${payload.failed}, Total: ${payload.total}`,
              payload.status === 'completed' ? 'success' : 'warn'
            );
            if (onCompletedRef.current) {
              onCompletedRef.current(payload);
            }
            closeStream();
            break;
          }

          case 'job:cancelled': {
            isTerminatedRef.current = true;
            setStatus('cancelled');
            setCurrentUsn(null);
            setCaptchaChallenge(null);
            appendLog('Bulk job was cancelled.', 'warn');
            closeStream();
            break;
          }

          case 'job:error': {
            isTerminatedRef.current = true;
            setStatus('failed');
            setCaptchaChallenge(null);
            setError(new Error(payload.error || 'Bulk job encountered an error'));
            appendLog(`Bulk job failed: ${payload.error}`, 'error');
            if (onErrorRef.current) {
              onErrorRef.current(new Error(payload.error));
            }
            closeStream();
            break;
          }

          default:
            break;
        }

        if (onProgressRef.current) {
          onProgressRef.current(payload);
        }
      } catch (parseErr) {
        console.error('Error parsing SSE progress payload:', parseErr);
      }
    });

    // Native SSE error handler
    es.onerror = () => {
      // If job has already reached terminal status, ignore disconnect
      if (isTerminatedRef.current) {
        closeStream();
        return;
      }

      closeStream();

      if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        const delay = Math.min(reconnectDelay * Math.pow(1.5, reconnectAttemptsRef.current - 1), 10000);
        setStatus('reconnecting');
        appendLog(`Stream interrupted. Retrying in ${(delay / 1000).toFixed(1)}s...`, 'warn');

        reconnectTimeoutRef.current = setTimeout(() => {
          connectRef.current?.();
        }, delay);
      } else {
        setStatus('error');
        const streamErr = new Error(
          reconnectAttemptsRef.current >= maxReconnectAttempts
            ? 'Connection lost to bulk progress stream after multiple attempts.'
            : 'Failed to establish event stream connection.'
        );
        setError(streamErr);
        appendLog(streamErr.message, 'error');
        if (onErrorRef.current) {
          onErrorRef.current(streamErr);
        }
      }
    };
  }, [
    jobId,
    enabled,
    autoReconnect,
    maxReconnectAttempts,
    reconnectDelay,
    closeStream,
    appendLog,
  ]);

  // Keep connectRef pointing to the latest connect callback
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Connect on mount or when jobId/enabled changes
  useEffect(() => {
    isTerminatedRef.current = false;
    reconnectAttemptsRef.current = 0;

    if (jobId && enabled) {
      queueMicrotask(() => {
        if (!isTerminatedRef.current) {
          connect();
        }
      });
    } else {
      closeStream();
    }

    return () => {
      closeStream();
    };
  }, [jobId, enabled, connect, closeStream]);

  // Derived progress percentage (0 - 100)
  const progressPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isFinished = ['completed', 'cancelled', 'failed'].includes(status);
  const isConnected = status === 'connected';
  const isReconnecting = status === 'reconnecting';

  return {
    jobId,
    status,
    total,
    processed,
    successful,
    failed,
    currentUsn,
    latestResult,
    results,
    errors: errorsList,
    logs,
    progress: progressPercent,
    isConnected,
    isReconnecting,
    isFinished,
    isCancelling,
    error,
    // CAPTCHA Relay API
    captchaChallenge,
    isSubmittingCaptcha,
    captchaError,
    submitCaptcha,
    cancelCaptcha,
    cancel,
    reconnect: () => {
      reconnectAttemptsRef.current = 0;
      isTerminatedRef.current = false;
      connect();
    },
    reset: () => {
      closeStream();
      setStatus('idle');
      setTotal(0);
      setProcessed(0);
      setSuccessful(0);
      setFailed(0);
      setCurrentUsn(null);
      setLatestResult(null);
      setResults([]);
      setErrorsList([]);
      setLogs([]);
      setError(null);
      setCaptchaChallenge(null);
      setCaptchaError(null);
    },
  };
}

export default useBulkJobStream;
