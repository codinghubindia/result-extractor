import puppeteer from 'puppeteer';
import { createWorker, PSM } from 'tesseract.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import {
    CaptchaSolveError,
    PortalUnavailableError,
    ScraperTimeoutError,
    StudentNotFoundError,
    ValidationError,
} from '../utils/errors.js';
import { normalizeUsn, isValidUsn } from '../utils/usn-range.js';
import { captchaRelayService as defaultCaptchaRelayService } from './captcha-relay.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORTAL_URL = process.env.TARGET_PORTAL_URL || 'https://eresultsglobal.contineo.in/';
const DEFAULT_MAX_CAPTCHA_RETRIES = 5;

/**
 * Finds the directory containing eng.traineddata.
 * Searches environment variable, current working directory, and parent paths.
 * @returns {string} Directory path
 */
export function resolveTrainedDataDir() {
    if (process.env.TESSERACT_LANG_PATH) {
        const envPath = path.resolve(process.env.TESSERACT_LANG_PATH);
        if (fs.existsSync(path.join(envPath, 'eng.traineddata'))) {
            return envPath;
        }
    }

    const candidateDirs = [
        process.cwd(),
        path.resolve(process.cwd(), '..'),
        path.resolve(__dirname, '../../../'),
        path.resolve(__dirname, '../../'),
        path.resolve(__dirname, '../'),
        __dirname,
    ];

    for (const dir of candidateDirs) {
        if (fs.existsSync(path.join(dir, 'eng.traineddata'))) {
            return dir;
        }
    }

    return '.';
}

/**
 * Helper to extract semester from department or exam text.
 * @param {string} department
 * @param {string} exam
 * @returns {string}
 */
export function parseSemester(department = '', exam = '') {
    const semRegex = /(?:Semester|Sem|SEM)[\s:-]*([0-9]+)/i;
    const matchDept = (department || '').match(semRegex);
    if (matchDept && matchDept[1]) return matchDept[1];
    const matchExam = (exam || '').match(semRegex);
    if (matchExam && matchExam[1]) return matchExam[1];
    return '';
}

/**
 * ScraperService provides headless browser automation and OCR-based CAPTCHA solving
 * for the VTU / GAT Contineo exam results portal with Web-Based Human Relay fallback.
 */
export class ScraperService extends EventEmitter {
    /**
     * @param {object} [config={}]
     * @param {string} [config.portalUrl] Portal login URL
     * @param {string} [config.langPath] Directory containing eng.traineddata
     * @param {number} [config.maxCaptchaRetries=5] Max attempts to solve CAPTCHA per USN
     * @param {boolean} [config.headless=true] Run in headless mode
     * @param {import('./captcha-relay.service.js').CaptchaRelayService} [config.captchaRelayService]
     */
    constructor(config = {}) {
        super();
        this.portalUrl = config.portalUrl || DEFAULT_PORTAL_URL;
        this.langPath = config.langPath || resolveTrainedDataDir();
        this.maxCaptchaRetries = config.maxCaptchaRetries || DEFAULT_MAX_CAPTCHA_RETRIES;
        this.headless = config.headless ?? true;
        this.captchaRelayService = config.captchaRelayService || defaultCaptchaRelayService;
    }

    /**
     * Initializes a configured Tesseract worker with single-word PSM and alphanumeric whitelist.
     * @returns {Promise<import('tesseract.js').Worker>}
     */
    async createOcrWorker() {
        const worker = await createWorker('eng', 1, {
            langPath: this.langPath,
            logger: process.env.DEBUG_OCR ? (m) => console.log('[Tesseract]', m) : () => {},
        });

        await worker.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_WORD,
            tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
        });

        return worker;
    }

    /**
     * Launches a headless Chromium browser instance optimized for backend throughput.
     * @returns {Promise<import('puppeteer').Browser>}
     */
    async launchBrowser() {
        return await puppeteer.launch({
            headless: this.headless,
            defaultViewport: { width: 1280, height: 800 },
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1280,800',
            ],
        });
    }

    /**
     * Executes page.evaluate safely with retries if the execution context was destroyed by a navigation.
     * @param {import('puppeteer').Page} page
     * @param {Function} fn
     * @param  {...any} args
     * @returns {Promise<any>}
     */
    async safeEvaluate(page, fn, ...args) {
        const maxTries = 3;
        for (let tryIdx = 0; tryIdx < maxTries; tryIdx++) {
            try {
                if (typeof page?.isClosed === 'function' && page.isClosed()) return null;
                return await page.evaluate(fn, ...args);
            } catch (err) {
                const msg = err?.message || '';
                const isNavigating =
                    msg.includes('Execution context was destroyed') ||
                    msg.includes('Cannot find context with specified id') ||
                    msg.includes('Session closed') ||
                    msg.includes('Target closed') ||
                    msg.includes('frame was detached');
                if (isNavigating && tryIdx < maxTries - 1) {
                    await new Promise((r) => setTimeout(r, 600));
                    continue;
                }
                if (isNavigating) {
                    return null;
                }
                throw err;
            }
        }
        return null;
    }

    /**
     * Preprocesses the CAPTCHA canvas image on the page.
     * Supports multiple modes: 'binary' (threshold 135), 'contrast' (contrast-stretched grayscale), 'binary_alt' (threshold 115).
     * @param {import('puppeteer').Page} page
     * @param {'binary'|'contrast'|'binary_alt'} [mode='binary']
     * @returns {Promise<string|null>} Base64 image payload (without data: prefix)
     */
    async getCaptchaBase64(page, mode = 'binary') {
        return await this.safeEvaluate(page, (modeParam) => {
            const img = document.querySelector('#captcha');
            if (!img) return null;

            // Wait until image is loaded
            if (!img.complete || img.naturalWidth === 0) {
                return null;
            }

            const scale = 3;
            const pad = 25;
            const w = (img.naturalWidth || 120) * scale;
            const h = (img.naturalHeight || 40) * scale;

            const canvas = document.createElement('canvas');
            canvas.width = w + pad * 2;
            canvas.height = h + pad * 2;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            // Fill white background
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw scaled captcha
            ctx.drawImage(img, pad, pad, w, h);

            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imgData.data;

            if (modeParam === 'contrast') {
                // High contrast grayscale enhancement (preserves smooth font contours)
                for (let i = 0; i < d.length; i += 4) {
                    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    let val;
                    if (gray < 75) val = 0;
                    else if (gray > 175) val = 255;
                    else val = Math.round(((gray - 75) / 100) * 255);
                    d[i] = val;
                    d[i + 1] = val;
                    d[i + 2] = val;
                    d[i + 3] = 255;
                }
            } else if (modeParam === 'binary_alt') {
                // Lighter threshold for faint text
                for (let i = 0; i < d.length; i += 4) {
                    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    const val = gray < 115 ? 0 : 255;
                    d[i] = val;
                    d[i + 1] = val;
                    d[i + 2] = val;
                    d[i + 3] = 255;
                }
            } else {
                // Standard binarization (135 threshold)
                for (let i = 0; i < d.length; i += 4) {
                    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    const val = gray < 135 ? 0 : 255;
                    d[i] = val;
                    d[i + 1] = val;
                    d[i + 2] = val;
                    d[i + 3] = 255;
                }
            }

            ctx.putImageData(imgData, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            return dataUrl.split(',')[1] || null;
        }, mode);
    }

    /**
     * Solves the on-page CAPTCHA using multi-pass recognition with the provided Tesseract worker.
     * @param {import('puppeteer').Page} page
     * @param {import('tesseract.js').Worker} worker
     * @returns {Promise<string>}
     */
    async autoSolveCaptcha(page, worker) {
        try {
            // Ensure captcha image is fully loaded
            await page.waitForFunction(() => {
                const img = document.querySelector('#captcha');
                return img && img.complete && img.naturalWidth > 0;
            }, { timeout: 3500 }).catch(() => {});

            // Pass 1: Standard binarization
            const base64Data = await this.getCaptchaBase64(page, 'binary');
            if (base64Data) {
                const buffer = Buffer.from(base64Data, 'base64');
                const ret = await worker.recognize(buffer);
                const text = (ret.data.text || '').replace(/[^a-zA-Z0-9]/g, '').trim();
                if (text.length >= 4 && text.length <= 7) {
                    return text;
                }
            }

            // Pass 2: High contrast enhancement fallback
            const contrastBase64 = await this.getCaptchaBase64(page, 'contrast');
            if (contrastBase64) {
                const buffer2 = Buffer.from(contrastBase64, 'base64');
                const ret2 = await worker.recognize(buffer2);
                const text2 = (ret2.data.text || '').replace(/[^a-zA-Z0-9]/g, '').trim();
                if (text2.length >= 4 && text2.length <= 7) {
                    return text2;
                }
            }

            // Pass 3: Alternative threshold
            const altBase64 = await this.getCaptchaBase64(page, 'binary_alt');
            if (altBase64) {
                const buffer3 = Buffer.from(altBase64, 'base64');
                const ret3 = await worker.recognize(buffer3);
                const text3 = (ret3.data.text || '').replace(/[^a-zA-Z0-9]/g, '').trim();
                if (text3.length >= 3) {
                    return text3;
                }
            }

            return '';
        } catch (err) {
            console.error('[ScraperService] OCR recognition failed:', err.message);
            return '';
        }
    }

    /**
     * Checks if the login form (#usn and #securityCode) is currently rendered.
     * @param {import('puppeteer').Page} page
     * @returns {Promise<boolean>}
     */
    async isLoginFormPresent(page) {
        const res = await this.safeEvaluate(page, () => {
            const usnInput = document.querySelector('#usn');
            const secInput = document.querySelector('#securityCode');
            return !!(usnInput && secInput);
        });
        return Boolean(res);
    }

    /**
     * Triggers a click on the reload CAPTCHA button and waits for the new image to load.
     * @param {import('puppeteer').Page} page
     */
    async reloadCaptcha(page) {
        try {
            const reloadBtn = await page.$('#reloadCaptcha');
            if (reloadBtn) {
                const oldSrc = await this.safeEvaluate(page, () => {
                    const img = document.querySelector('#captcha');
                    return img ? img.src : null;
                });

                await reloadBtn.click();

                // Wait for image src to change and be fully loaded
                await page.waitForFunction(
                    (prevSrc) => {
                        const img = document.querySelector('#captcha');
                        return img && img.complete && img.naturalWidth > 0 && img.src !== prevSrc;
                    },
                    { timeout: 3000 },
                    oldSrc
                ).catch(() => {});

                await new Promise((r) => setTimeout(r, 600));
            }
        } catch {
            // Ignore reload failure
        }
    }

    /**
     * Checks if a message indicates a student not found or invalid USN error.
     * @param {string} msg
     * @returns {boolean}
     */
    isNotFoundError(msg) {
        if (!msg || typeof msg !== 'string') return false;
        const lower = msg.toLowerCase();
        return (
            lower.includes('not found') ||
            lower.includes('does not exist') ||
            lower.includes("doesn't exist") ||
            lower.includes('invalid usn') ||
            lower.includes('candidate not found') ||
            lower.includes('student not found') ||
            lower.includes('no record') ||
            lower.includes('no records') ||
            lower.includes('no data') ||
            lower.includes('no result') ||
            lower.includes('not announced') ||
            lower.includes('not yet announced') ||
            lower.includes('unregistered') ||
            lower.includes('not registered') ||
            lower.includes('not available') ||
            lower.includes('withheld') ||
            lower.includes('with held') ||
            lower.includes('invalid registration') ||
            lower.includes('check the usn') ||
            lower.includes('check your usn') ||
            lower.includes('wrong usn') ||
            lower.includes('not eligible') ||
            lower.includes('hall ticket') ||
            lower.includes('hallticket') ||
            lower.includes('no match') ||
            lower.includes('does not match any record') ||
            lower.includes('session expired') ||
            lower.includes('no student found')
        );
    }

    /**
     * Checks if a message specifically indicates a CAPTCHA or security code error.
     * @param {string} msg
     * @returns {boolean}
     */
    isCaptchaError(msg) {
        if (!msg || typeof msg !== 'string') return false;
        const lower = msg.toLowerCase();
        return (
            lower.includes('captcha') ||
            lower.includes('security code') ||
            lower.includes('code does not match') ||
            lower.includes('code mismatch') ||
            lower.includes('invalid code') ||
            lower.includes('verification code')
        );
    }

    /**
     * Checks for error banners or alert messages currently rendered in the DOM.
     * @param {import('puppeteer').Page} page
     * @returns {Promise<string|null>}
     */
    async checkDomError(page) {
        return await this.safeEvaluate(page, () => {
            const selectors = [
                '.uk-alert-danger',
                '.alert-danger',
                '#system-message-container',
                '.uk-alert',
                '.alert',
                '.error-message',
                '.error',
                '.notification-danger',
                '#errorMsg',
                '#error_message',
                '[role="alert"]',
                '.text-danger',
                '.uk-text-danger',
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) {
                    const text = el.innerText.trim();
                    if (text.length > 0 && !text.toUpperCase().includes('CAPTCHA')) {
                        return text;
                    }
                }
            }

            // Also check for alert text anywhere in the body
            const body = document.body ? document.body.innerText : '';
            const notFoundMatch = body.match(
                /(?:USN|Student|Candidate|Result)[\s\w]*(?:not found|does not exist|not announced|no records|withheld)/i
            );
            if (notFoundMatch) {
                return notFoundMatch[0];
            }
            return null;
        });
    }

    /**
     * Detects post-login page state:
     * - 'DIRECT_RESULT': Results table or GPA summary rendered directly (Odd sem)
     * - 'EXAM_SELECTION': Exam selection cards or submitfrom links rendered (Even sem)
     * - 'ERROR': Error message rendered
     * - 'UNKNOWN': Page not yet recognized
     * 
     * @param {import('puppeteer').Page} page
     * @returns {Promise<'DIRECT_RESULT'|'EXAM_SELECTION'|'ERROR'|'UNKNOWN'>}
     */
    async detectPageState(page) {
        const state = await this.safeEvaluate(page, () => {
            const bodyText = document.body ? document.body.innerText : '';

            // Check for results table or grade indicators
            const hasResultTable = Array.from(document.querySelectorAll('table')).some((table) => {
                const text = table.innerText.toUpperCase();
                return text.includes('COURSE CODE') || text.includes('GRADE') || text.includes('CREDITS');
            });
            const hasGpaSummary = bodyText.includes('SGPA') || bodyText.includes('Credits Registered');

            if (hasResultTable || hasGpaSummary) {
                return 'DIRECT_RESULT';
            }

            // Check for exam selection cards / buttons
            const hasViewResultsInput = Array.from(
                document.querySelectorAll('input[type="button"], input[type="submit"], button, a')
            ).some((el) => {
                const val = (el.value || '').toUpperCase();
                const txt = (el.textContent || '').toUpperCase();
                const onclick = (el.getAttribute('onclick') || '').toLowerCase();
                return val.includes('VIEW RESULTS') || txt.includes('VIEW RESULTS') || onclick.includes('submitfrom');
            });

            if (hasViewResultsInput || bodyText.includes('Please Select Exam') || document.querySelector('#examfrom')) {
                return 'EXAM_SELECTION';
            }

            // Check for errors / alerts
            const alertBox = document.querySelector(
                '.uk-alert-danger, .alert-danger, #system-message-container, .error-message, [role="alert"]'
            );
            if (alertBox && alertBox.innerText.trim().length > 0) {
                return 'ERROR';
            }

            const lower = bodyText.toLowerCase();
            if (
                lower.includes('not found') ||
                lower.includes('does not exist') ||
                lower.includes('candidate not found') ||
                lower.includes('no records') ||
                lower.includes('result withheld')
            ) {
                return 'ERROR';
            }

            return 'UNKNOWN';
        });

        return state || 'UNKNOWN';
    }

    /**
     * Extracts list of available exam cards on the Exam Selection dashboard.
     * @param {import('puppeteer').Page} page
     * @returns {Promise<Array<{ index: number, title: string, semester: string, lastUpdated: string, usn: string, examId: string, displayName: string }>>}
     */
    async getAvailableExams(page) {
        const exams = await this.safeEvaluate(page, () => {
            const cards = Array.from(document.querySelectorAll('.cn-card')).filter((card) => {
                return card.querySelector('input[value*="View Results" i], a[onclick*="submitfrom"], input.cn-button');
            });

            if (cards.length > 0) {
                return cards.map((card, index) => {
                    const titleEl = card.querySelector('h3, h4');
                    const semEl = card.querySelector('p');
                    const updatedEl = card.querySelector('span');
                    const linkEl = card.querySelector('a[onclick*="submitfrom"]');

                    let usn = '';
                    let examId = '';
                    if (linkEl) {
                        const onclick = linkEl.getAttribute('onclick') || '';
                        const match = onclick.match(/submitfrom\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
                        if (match) {
                            usn = match[1];
                            examId = match[2];
                        }
                    }

                    const title = titleEl ? titleEl.innerText.trim() : `Exam ${index + 1}`;
                    const semester = semEl ? semEl.innerText.trim() : '';
                    const lastUpdated = updatedEl ? updatedEl.innerText.trim() : '';

                    return {
                        index,
                        title,
                        semester,
                        lastUpdated,
                        usn,
                        examId,
                        displayName: `${title} ${semester ? `[${semester}]` : ''} ${lastUpdated ? `(${lastUpdated})` : ''}`.trim(),
                    };
                });
            }

            // Fallback: search for any anchor with submitfrom
            const links = Array.from(document.querySelectorAll('a[onclick*="submitfrom"]'));
            return links.map((link, index) => {
                const onclick = link.getAttribute('onclick') || '';
                const match = onclick.match(/submitfrom\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
                const usn = match ? match[1] : '';
                const examId = match ? match[2] : '';
                const card = link.closest('.uk-card, div') || link.parentElement;
                const text = card ? card.innerText.trim().replace(/\s+/g, ' ') : '';
                return {
                    index,
                    title: `Exam (ID: ${examId})`,
                    semester: '',
                    lastUpdated: '',
                    usn,
                    examId,
                    displayName: text ? text.slice(0, 50) : `Exam ${index + 1} (ID: ${examId})`,
                };
            });
        });

        return exams || [];
    }

    /**
     * Submits selection for a chosen exam card on the Exam Selection page.
     * @param {import('puppeteer').Page} page
     * @param {object} exam
     */
    async triggerExamSubmission(page, exam) {
        await this.safeEvaluate(page, (u, eId, idx) => {
            if (u && eId && typeof window.submitfrom === 'function') {
                window.submitfrom(u, eId);
                return;
            }
            const usnInput = document.getElementById('usn');
            const examIdInput = document.getElementById('examId');
            const examForm = document.getElementById('examfrom');
            if (usnInput && examIdInput && examForm && u && eId) {
                usnInput.value = u;
                examIdInput.value = eId;
                examForm.submit();
                return;
            }

            // Fallback click on card button
            const cards = Array.from(document.querySelectorAll('.cn-card')).filter((card) => {
                return card.querySelector('input[value*="View Results" i], a[onclick*="submitfrom"]');
            });
            if (cards[idx]) {
                const btn = cards[idx].querySelector('input, a, button');
                if (btn) btn.click();
            }
        }, exam.usn, exam.examId, exam.index);
    }

    /**
     * Extracts structured student data, summary GPA metrics, and course grades table from DOM.
     * @param {import('puppeteer').Page} page
     * @param {string} [fallbackUsn='']
     * @returns {Promise<any>}
     */
    async extractResultData(page, fallbackUsn = '') {
        const raw = await this.safeEvaluate(page, (fallback) => {
            const data = {
                timestamp: new Date().toISOString(),
                student: {
                    name: '',
                    srn: '',
                    department: '',
                    semester: '',
                },
                exam: '',
                summary: {
                    creditsRegistered: null,
                    creditsEarned: null,
                    sgpa: null,
                    cgpa: null,
                },
                courses: [],
            };

            // 1. Student Name (prioritize student data container over general headings)
            const nameEl = document.querySelector('.stu-data1 h3, .student-header h3, .student-info h3');
            if (nameEl) {
                const text = nameEl.innerText.trim();
                // Filter out university/college titles
                if (!text.toUpperCase().includes('COLLEGE') && !text.toUpperCase().includes('ACADEMY') && !text.toUpperCase().includes('TECHNOLOGY')) {
                    data.student.name = text;
                }
            }

            // 2. USN & Department
            const usnEl = document.querySelector('.stu-data2 h2, .student-header h2');
            if (usnEl) {
                data.student.srn = usnEl.innerText.trim();
            }
            const deptEl = document.querySelector('.stu-data2 p, .student-header p');
            if (deptEl) {
                data.student.department = deptEl.innerText.trim();
            }

            const bodyText = document.body ? document.body.innerText : '';

            if (!data.student.srn) {
                const srnMatch = bodyText.match(/\b(1GA\w+)\b/i);
                if (srnMatch) data.student.srn = srnMatch[1];
            }
            if (!data.student.srn && fallback) {
                data.student.srn = fallback;
            }

            if (!data.student.name) {
                const nameMatch = bodyText.match(/([A-Z\s]{3,35})\n\s*(?:1GA\w+)/i);
                if (nameMatch) {
                    const matchedName = nameMatch[1].trim();
                    if (!matchedName.toUpperCase().includes('COLLEGE') && !matchedName.toUpperCase().includes('ACADEMY')) {
                        data.student.name = matchedName;
                    }
                }
            }

            // 3. Exam Title
            const examHeading = Array.from(document.querySelectorAll('h2, h3, h4, .uk-heading-bullet')).find((el) =>
                el.innerText.includes('Provisional Result') || el.innerText.includes('Results')
            );
            if (examHeading) {
                data.exam = examHeading.innerText.replace(/PRINT PROVISIONAL GRADE CARD/gi, '').trim();
            } else {
                const examMatch = bodyText.match(/([A-Za-z]+\s+\d{4}\s*-\s*Provisional Result)/i);
                if (examMatch) data.exam = examMatch[1].trim();
            }

            // 4. Summary metrics
            const metricCards = Array.from(document.querySelectorAll('.uk-card, div'));
            for (const card of metricCards) {
                const text = card.innerText || '';
                if (text.includes('Credits Registered')) {
                    const m = text.match(/Credits Registered\s*[\n:]*\s*([\d.]+)/i);
                    if (m && !data.summary.creditsRegistered) data.summary.creditsRegistered = m[1];
                }
                if (text.includes('Credits Earned')) {
                    const m = text.match(/Credits Earned\s*[\n:]*\s*([\d.]+)/i);
                    if (m && !data.summary.creditsEarned) data.summary.creditsEarned = m[1];
                }
                if (text.includes('SGPA') && !text.includes('Result SGPA')) {
                    const m = text.match(/SGPA\s*[\n:]*\s*([\d.]+)/i);
                    if (m && !data.summary.sgpa) data.summary.sgpa = m[1];
                }
                if (text.includes('CGPA')) {
                    const m = text.match(/CGPA\s*[\n:]*\s*([\d.]+)/i);
                    if (m && !data.summary.cgpa) data.summary.cgpa = m[1];
                }
            }

            if (!data.summary.creditsRegistered) {
                const m = bodyText.match(/Credits Registered\s*[\n:]*\s*([\d.]+)/i);
                if (m) data.summary.creditsRegistered = m[1];
            }
            if (!data.summary.creditsEarned) {
                const m = bodyText.match(/Credits Earned\s*[\n:]*\s*([\d.]+)/i);
                if (m) data.summary.creditsEarned = m[1];
            }
            if (!data.summary.sgpa) {
                const m = bodyText.match(/\bSGPA\s*[:\n]*\s*([\d.]+)/i);
                if (m) data.summary.sgpa = m[1];
            }
            if (!data.summary.cgpa) {
                const m = bodyText.match(/\bCGPA\s*[:\n]*\s*([\d.]+)/i);
                if (m) data.summary.cgpa = m[1];
            }

            // Normalize missing or dashed GPA values
            if (data.summary.sgpa && (data.summary.sgpa === '--' || data.summary.sgpa.toUpperCase() === 'N/A')) {
                data.summary.sgpa = '0.00';
            }
            if (data.summary.cgpa && (data.summary.cgpa === '--' || data.summary.cgpa.toUpperCase() === 'N/A')) {
                data.summary.cgpa = '0.00';
            }

            // 5. Course Marks Table
            const tables = Array.from(document.querySelectorAll('table'));
            for (const table of tables) {
                const rows = Array.from(table.querySelectorAll('tr'));
                if (rows.length > 1) {
                    // Find header row (may be row 0 or row 1)
                    let headerIndex = -1;
                    for (let r = 0; r < Math.min(3, rows.length); r++) {
                        const hText = rows[r].innerText.toUpperCase();
                        if (hText.includes('COURSE') || hText.includes('SEE') || hText.includes('GRADE') || hText.includes('TOTAL')) {
                            headerIndex = r;
                            break;
                        }
                    }

                    if (headerIndex >= 0) {
                        const rawHeaders = Array.from(rows[headerIndex].querySelectorAll('th, td')).map((c) =>
                            c.innerText.trim().replace(/\s+/g, ' ')
                        );

                        for (let i = headerIndex + 1; i < rows.length; i++) {
                            const cells = Array.from(rows[i].querySelectorAll('td')).map((c) =>
                                c.innerText.trim().replace(/\s+/g, ' ')
                            );
                            const rowText = cells.join(' ').toUpperCase();

                            // Filter out non-course rows (totals, gpa summary, repeated headers)
                            if (
                                cells.length >= 3 &&
                                cells.some((c) => /\w+/.test(c)) &&
                                !rowText.includes('TOTAL CREDITS') &&
                                !rowText.includes('CREDITS REGISTERED') &&
                                !rowText.includes('CREDITS EARNED') &&
                                !rowText.includes('SGPA') &&
                                !rowText.includes('CGPA') &&
                                !rowText.includes('PROVISIONAL')
                            ) {
                                const rowObj = {};
                                rawHeaders.forEach((h, idx) => {
                                    const key = h || `Column_${idx + 1}`;
                                    rowObj[key] = cells[idx] || '';
                                });
                                data.courses.push(rowObj);
                            }
                        }
                        break;
                    }
                }
            }

            return data;
        }, fallbackUsn);

        if (!raw) {
            throw new Error(`Failed to extract result data: page navigation or context destroyed`);
        }

        // Normalize courses and extract semester
        const semester = parseSemester(raw.student.department, raw.exam);
        raw.student.semester = semester;
        raw.student.srn = normalizeUsn(raw.student.srn || fallbackUsn);

        // Ensure clean normalized course keys while preserving original capitalized keys
        raw.courses = (raw.courses || []).map((c) => {
            const courseCode = c['COURSE CODE'] || c['Course Code'] || c.courseCode || '';
            const courseName = c['COURSE NAME'] || c['Course Name'] || c.courseName || '';
            const cie = c['CIE'] || c.cie || '';
            const see = c['SEE'] || c.see || '';
            const total = c['TOTAL'] || c.total || '';
            const creditsReg = c['CREDITS REG.'] || c['CREDITS'] || c.credits || '';
            const creditsEarned = c['CREDITS EARNED'] || c.creditsEarned || '';
            const grade = (c['GRADE'] || c.grade || '').toUpperCase();

            return {
                ...c,
                courseCode,
                courseName,
                cie,
                see,
                total,
                credits: creditsReg,
                creditsReg,
                creditsEarned,
                grade,
                'COURSE CODE': courseCode,
                'COURSE NAME': courseName,
                'CIE': cie,
                'SEE': see,
                'TOTAL': total,
                'CREDITS REG.': creditsReg,
                'CREDITS EARNED': creditsEarned,
                'GRADE': grade,
            };
        });

        return raw;
    }

    /**
     * Executes the scraping workflow for a USN using an existing Puppeteer page and Tesseract worker.
     * Ideal for worker pools to avoid per-scrape browser startup overhead.
     * 
     * @param {import('puppeteer').Page} page
     * @param {import('tesseract.js').Worker} worker
     * @param {string} usn
     * @param {object} [options={}]
     * @param {string} [options.examId] Specific exam to scrape if on exam selection page
     * @param {boolean} [options.latestOnly=false] Only extract the first/latest exam
     * @returns {Promise<any[]>} Array of extracted student result objects
     */
    async scrapeUsnWithPage(page, worker, usn, options = {}) {
        const targetUsn = normalizeUsn(usn);
        if (!isValidUsn(targetUsn)) {
            throw new ValidationError(`Invalid USN: '${targetUsn}'`, { usn: targetUsn });
        }

        // Track native browser dialog alerts
        let lastAlertMessage = null;
        const dialogHandler = async (dialog) => {
            lastAlertMessage = dialog.message();
            try {
                await dialog.accept();
            } catch {
                // Ignore if already handled
            }
        };

        page.on('dialog', dialogHandler);

        try {
            // Navigate to portal login
            try {
                await page.goto(this.portalUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: 45000,
                });
            } catch (err) {
                throw new PortalUnavailableError(`Failed to load portal at ${this.portalUrl}: ${err.message}`, {
                    portalUrl: this.portalUrl,
                    originalError: err.message,
                });
            }

            // Wait for login inputs
            try {
                await page.waitForSelector('#usn', { timeout: 15000 });
                await page.waitForSelector('#securityCode', { timeout: 15000 });
                await page.waitForSelector('#captcha', { timeout: 15000 });
            } catch (err) {
                throw new PortalUnavailableError(`Portal login form not rendered within timeout: ${err.message}`, {
                    originalError: err.message,
                });
            }

            let loggedIn = false;

            // CAPTCHA solving loop with up to 7 multi-pass attempts
            const maxAttempts = Math.max(this.maxCaptchaRetries, 7);
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                // If previous submission or navigation already landed on results or exams, terminate early!
                const preCheckState = await this.detectPageState(page);
                if (preCheckState === 'DIRECT_RESULT' || preCheckState === 'EXAM_SELECTION') {
                    loggedIn = true;
                    break;
                }

                // Ensure page is actually on login form; if redirected, re-navigate to portal URL
                const onLoginBefore = await this.isLoginFormPresent(page);
                if (!onLoginBefore) {
                    await page.goto(this.portalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                    await page.waitForSelector('#usn', { timeout: 10000 }).catch(() => {});
                }

                // Set USN safely
                try {
                    await page.waitForSelector('#usn', { timeout: 8000 });
                    await page.$eval('#usn', (el, val) => { el.value = val; }, targetUsn);
                } catch {
                    await page.goto(this.portalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                    await page.waitForSelector('#usn', { timeout: 10000 }).catch(() => {});
                    await page.$eval('#usn', (el, val) => { el.value = val; }, targetUsn).catch(() => {});
                }

                // Auto solve CAPTCHA with multi-pass OCR
                const autoText = await this.autoSolveCaptcha(page, worker);

                if (autoText && autoText.length >= 3) {
                    try {
                        await page.waitForSelector('#securityCode', { timeout: 5000 });
                        await page.$eval('#securityCode', (el, val) => { el.value = val; }, autoText);
                    } catch {
                        continue;
                    }

                    lastAlertMessage = null;

                    // Click submit button
                    const submitBtn = await page.$('button.myButton, button[type="submit"]');
                    if (submitBtn) {
                        await submitBtn.click().catch(() => {});
                    } else {
                        await this.safeEvaluate(page, () => {
                            const btn = document.querySelector('button.myButton, button[type="submit"]');
                            if (btn) btn.click();
                        });
                    }

                    // Settle / wait for navigation or result elements
                    await Promise.race([
                        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4500 }).catch(() => {}),
                        page.waitForSelector('.cn-card, table, .uk-alert-danger, .alert-danger, #errorMsg', { timeout: 4500 }).catch(() => {}),
                        new Promise((r) => setTimeout(r, 2200)),
                    ]);

                    // Extra short pause for DOM updates to stabilize
                    await new Promise((r) => setTimeout(r, 600));

                    // Check for dialog alert (e.g., student not found, invalid captcha)
                    if (lastAlertMessage) {
                        if (this.isNotFoundError(lastAlertMessage)) {
                            throw new StudentNotFoundError(`Portal alert: ${lastAlertMessage}`, {
                                usn: targetUsn,
                                alertMessage: lastAlertMessage,
                            });
                        }
                        if (attempt < maxAttempts) {
                            await this.reloadCaptcha(page);
                            continue;
                        }
                    }

                    // Check page state immediately after submit
                    const postSubmitState = await this.detectPageState(page);
                    if (postSubmitState === 'DIRECT_RESULT' || postSubmitState === 'EXAM_SELECTION') {
                        loggedIn = true;
                        break;
                    }

                    // Check for inline DOM alert
                    const domError = await this.checkDomError(page);
                    if (domError && this.isNotFoundError(domError)) {
                        throw new StudentNotFoundError(`Portal message: ${domError}`, {
                            usn: targetUsn,
                            domError,
                        });
                    }

                    const onLogin = await this.isLoginFormPresent(page);
                    if (!onLogin && !lastAlertMessage) {
                        loggedIn = true;
                        break;
                    } else if (attempt < maxAttempts) {
                        await this.reloadCaptcha(page);
                    }
                } else if (attempt < maxAttempts) {
                    await this.reloadCaptcha(page);
                }
            }

            // --- Human-in-the-Loop CAPTCHA Relay Fallback ---
            if (!loggedIn && (await this.isLoginFormPresent(page))) {
                const enableRelay = options.enableRelay ?? true;

                if (enableRelay) {
                    let releaseRelayLock = null;
                    if (typeof options.acquireRelayLock === 'function') {
                        try {
                            releaseRelayLock = await options.acquireRelayLock();
                        } catch (err) {
                            console.warn(`[ScraperService] Relay lock acquisition skipped: ${err.message}`);
                        }
                    }

                    try {
                        const maxRelayAttempts = options.maxRelayAttempts || 2;
                        const relayTimeoutMs = options.relayTimeoutMs || 25000;

                        for (let relayAttempt = 1; relayAttempt <= maxRelayAttempts; relayAttempt++) {
                            // a. Extract CAPTCHA canvas image as base64 without reloading page
                            const captchaBase64 = await this.getCaptchaBase64(page);
                            if (!captchaBase64) {
                                throw new CaptchaSolveError('Failed to capture CAPTCHA image for relay challenge', {
                                    usn: targetUsn,
                                });
                            }

                            // b. Keep Puppeteer page open at that exact state
                            // c. Create a challenge via captchaRelayService and emit captcha_required event
                            const challengeId = this.captchaRelayService.createChallenge({
                                jobId: options.jobId || null,
                                usn: targetUsn,
                                captchaImageBase64: captchaBase64,
                                timeoutMs: relayTimeoutMs,
                                metadata: { attempt: relayAttempt, ...options.metadata },
                            });

                            // Register reload handler to reload captcha and fetch fresh base64
                            this.captchaRelayService.registerReloadHandler(challengeId, async () => {
                                await this.reloadCaptcha(page);
                                return await this.getCaptchaBase64(page);
                            });

                            const challengePayload = {
                                challengeId,
                                jobId: options.jobId || null,
                                usn: targetUsn,
                                captchaImageBase64: captchaBase64,
                                attempt: relayAttempt,
                            };

                            if (typeof options.onCaptchaRequired === 'function') {
                                options.onCaptchaRequired(challengePayload);
                            }
                            this.emit('captcha_required', challengePayload);

                            // d. Await user resolution via captchaRelayService.waitForSolution(challengeId, timeoutMs)
                            let solution;
                            try {
                                solution = await this.captchaRelayService.waitForSolution(challengeId, relayTimeoutMs);
                            } catch (err) {
                                throw new CaptchaSolveError(`Human CAPTCHA relay failed: ${err.message}`, {
                                    usn: targetUsn,
                                    challengeId,
                                    originalError: err.message,
                                });
                            }

                            const resolvedText = (solution?.text || '').trim();
                            if (!resolvedText) {
                                await this.reloadCaptcha(page);
                                continue;
                            }

                            // e. Type the resolved text into #securityCode and submit
                            const onLoginRelay = await this.isLoginFormPresent(page);
                            if (onLoginRelay) {
                                await page.waitForSelector('#usn', { timeout: 5000 }).catch(() => {});
                                await page.$eval('#usn', (el, val) => { el.value = val; }, targetUsn).catch(() => {});
                                await page.waitForSelector('#securityCode', { timeout: 5000 }).catch(() => {});
                                await page.$eval('#securityCode', (el, val) => { el.value = val; }, resolvedText).catch(() => {});

                                lastAlertMessage = null;
                                const submitBtn = await page.$('button.myButton, button[type="submit"]');
                                if (submitBtn) {
                                    await submitBtn.click().catch(() => {});
                                } else {
                                    await this.safeEvaluate(page, () => {
                                        const btn = document.querySelector('button.myButton, button[type="submit"]');
                                        if (btn) btn.click();
                                    });
                                }

                                await Promise.race([
                                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 4500 }).catch(() => {}),
                                    page.waitForSelector('.cn-card, table, .uk-alert-danger, .alert-danger, #errorMsg', { timeout: 4500 }).catch(() => {}),
                                    new Promise((r) => setTimeout(r, 2200)),
                                ]);

                                await new Promise((r) => setTimeout(r, 600));

                                // Check if login succeeded or if portal rejected the captcha
                                if (lastAlertMessage) {
                                    if (this.isNotFoundError(lastAlertMessage)) {
                                        throw new StudentNotFoundError(`Portal alert: ${lastAlertMessage}`, {
                                            usn: targetUsn,
                                            alertMessage: lastAlertMessage,
                                        });
                                    }
                                    if (relayAttempt < maxRelayAttempts) {
                                        await this.reloadCaptcha(page);
                                        continue;
                                    }
                                }

                                const postRelayState = await this.detectPageState(page);
                                if (postRelayState === 'DIRECT_RESULT' || postRelayState === 'EXAM_SELECTION') {
                                    loggedIn = true;
                                    break;
                                }

                                const domError = await this.checkDomError(page);
                                if (domError && this.isNotFoundError(domError)) {
                                    throw new StudentNotFoundError(`Portal message: ${domError}`, {
                                        usn: targetUsn,
                                        domError,
                                    });
                                }

                                const onLogin = await this.isLoginFormPresent(page);
                                if (!onLogin && !lastAlertMessage) {
                                    loggedIn = true;
                                    break;
                                } else if (relayAttempt < maxRelayAttempts) {
                                    // Captcha rejected: reload and loop again to capture new image
                                    await this.reloadCaptcha(page);
                                }
                            } else {
                                const stateRelay = await this.detectPageState(page);
                                if (stateRelay === 'DIRECT_RESULT' || stateRelay === 'EXAM_SELECTION') {
                                    loggedIn = true;
                                    break;
                                }
                            }
                        }
                    } finally {
                        if (typeof releaseRelayLock === 'function') {
                            try { releaseRelayLock(); } catch {}
                        }
                    }
                }
            }

            if (!loggedIn) {
                const onLogin = await this.isLoginFormPresent(page);
                if (onLogin) {
                    // Check if an undetected not-found error was rendered on the login form
                    const domError = await this.checkDomError(page);
                    if (domError && this.isNotFoundError(domError)) {
                        throw new StudentNotFoundError(`Portal message: ${domError}`, { usn: targetUsn, domError });
                    }
                    if (lastAlertMessage && this.isNotFoundError(lastAlertMessage)) {
                        throw new StudentNotFoundError(`Portal alert: ${lastAlertMessage}`, {
                            usn: targetUsn,
                            alertMessage: lastAlertMessage,
                        });
                    }

                    throw new CaptchaSolveError(
                        `Failed to solve CAPTCHA after automated and relay attempts for USN ${targetUsn}`,
                        { usn: targetUsn, attempts: this.maxCaptchaRetries }
                    );
                } else {
                    const checkState = await this.detectPageState(page);
                    if (checkState === 'DIRECT_RESULT' || checkState === 'EXAM_SELECTION') {
                        loggedIn = true;
                    }
                }
            }

            // Post-login page state resolution with polling
            await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 1200));

            let pageState = await this.detectPageState(page);
            for (let retry = 0; retry < 3 && pageState === 'UNKNOWN'; retry++) {
                await new Promise((r) => setTimeout(r, 1500));
                pageState = await this.detectPageState(page);
            }

            const extractedResults = [];

            if (pageState === 'DIRECT_RESULT') {
                // Direct result page (Odd Semester or Single Exam Cohort)
                const result = await this.extractResultData(page, targetUsn);
                result.examMode = 'DIRECT_RESULT';
                if (options.semester) {
                    result.requestedSemester = options.semester;
                    const semStr = String(options.semester).trim().toLowerCase();
                    const extSem = String(result.student?.semester || '').trim().toLowerCase();
                    result.semesterMatched = extSem === semStr || extSem.includes(semStr);
                    if (!result.semesterMatched) {
                        result.warning = `Portal returned direct result for semester '${result.student?.semester || 'current'}' instead of requested semester '${options.semester}'`;
                    }
                }
                extractedResults.push(result);
            } else if (pageState === 'EXAM_SELECTION') {
                // Exam Selection dashboard (Even Semester / Multiple Exams)
                const exams = await this.getAvailableExams(page);

                if (!exams || exams.length === 0) {
                    const domError = await this.checkDomError(page);
                    if (domError && this.isNotFoundError(domError)) {
                        throw new StudentNotFoundError(`Portal message: ${domError}`, { usn: targetUsn, domError });
                    }
                    throw new StudentNotFoundError(`No exam records found for USN ${targetUsn}`, { usn: targetUsn });
                }

                if (options.examId || options.semester) {
                    // Match specific exam or semester requested
                    let semesterFound = false;
                    let targetExam = exams.find((e) => {
                        if (options.examId && (e.examId === options.examId || String(e.index + 1) === String(options.examId))) {
                            semesterFound = true;
                            return true;
                        }
                        if (options.semester) {
                            const semStr = String(options.semester).trim().toLowerCase();
                            const examSem = String(e.semester || '').toLowerCase();
                            const examTitle = String(e.title || '').toLowerCase();
                            if (
                                examSem.includes(semStr) ||
                                examTitle.includes(`sem ${semStr}`) ||
                                examTitle.includes(`${semStr}th sem`) ||
                                examTitle.includes(`${semStr}st sem`) ||
                                examTitle.includes(`${semStr}nd sem`) ||
                                examTitle.includes(`${semStr}rd sem`) ||
                                examSem === semStr
                            ) {
                                semesterFound = true;
                                return true;
                            }
                        }
                        return false;
                    });

                    // If requested semester does not exist for this student, gracefully fall back to latest exam
                    if (!targetExam) {
                        targetExam = exams[0];
                        semesterFound = false;
                    }

                    await this.triggerExamSubmission(page, targetExam);
                    await Promise.race([
                        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
                        page.waitForSelector('table', { timeout: 15000 }).catch(() => {}),
                    ]);
                    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
                    await new Promise((r) => setTimeout(r, 1200));

                    // Catch any alert after exam submission
                    if (lastAlertMessage && this.isNotFoundError(lastAlertMessage)) {
                        throw new StudentNotFoundError(`Portal alert: ${lastAlertMessage}`, { usn: targetUsn });
                    }
                    const examDomErr = await this.checkDomError(page);
                    if (examDomErr && this.isNotFoundError(examDomErr)) {
                        throw new StudentNotFoundError(`Portal message: ${examDomErr}`, { usn: targetUsn });
                    }

                    const res = await this.extractResultData(page, targetUsn);
                    if (!res.exam) res.exam = targetExam.title;
                    res.examMode = 'EXAM_SELECTION';
                    res.semesterMatched = semesterFound;
                    if (options.semester) {
                        res.requestedSemester = options.semester;
                        if (!semesterFound) {
                            res.warning = `Requested semester '${options.semester}' was not available on portal; defaulted to latest exam '${targetExam.title}'`;
                        }
                    }
                    extractedResults.push(res);
                } else if (options.latestOnly) {
                    // Only scrape latest exam
                    const latest = exams[0];
                    await this.triggerExamSubmission(page, latest);
                    await Promise.race([
                        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
                        page.waitForSelector('table', { timeout: 15000 }).catch(() => {}),
                    ]);
                    await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
                    await new Promise((r) => setTimeout(r, 1200));

                    const res = await this.extractResultData(page, targetUsn);
                    if (!res.exam) res.exam = latest.title;
                    extractedResults.push(res);
                } else {
                    // Scrape all available exams
                    for (let i = 0; i < exams.length; i++) {
                        await this.triggerExamSubmission(page, exams[i]);
                        await Promise.race([
                            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
                            page.waitForSelector('table', { timeout: 15000 }).catch(() => {}),
                        ]);
                        await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
                        await new Promise((r) => setTimeout(r, 1200));

                        const res = await this.extractResultData(page, targetUsn);
                        if (!res.exam) res.exam = exams[i].title;
                        extractedResults.push(res);

                        if (i < exams.length - 1) {
                            const backSuccess = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 6000 })
                                .then(() => true)
                                .catch(() => false);
                            await page.waitForNetworkIdle({ timeout: 2000 }).catch(() => {});
                            await new Promise((r) => setTimeout(r, 600));

                            const state = await this.detectPageState(page);
                            if (!backSuccess || state !== 'EXAM_SELECTION') {
                                // If goBack failed due to POST cache miss, break gracefully with what we have
                                break;
                            }
                        }
                    }
                }
            } else if (pageState === 'ERROR') {
                const errorMsg = (await this.checkDomError(page)) || lastAlertMessage || 'Student result not found or portal error';
                if (this.isNotFoundError(errorMsg)) {
                    throw new StudentNotFoundError(errorMsg, { usn: targetUsn });
                }
                throw new PortalUnavailableError(`Portal error encountered: ${errorMsg}`, { usn: targetUsn, errorMsg });
            } else {
                // Fallback attempt to extract whatever table is present
                const fallbackResult = await this.extractResultData(page, targetUsn);
                if (fallbackResult.courses && fallbackResult.courses.length > 0) {
                    extractedResults.push(fallbackResult);
                } else {
                    const errorMsg = (await this.checkDomError(page)) || lastAlertMessage || `No recognizable result tables found for USN ${targetUsn}`;
                    if (this.isNotFoundError(errorMsg)) {
                        throw new StudentNotFoundError(errorMsg, { usn: targetUsn });
                    }
                    throw new StudentNotFoundError(`No recognizable result tables found for USN ${targetUsn}`, {
                        usn: targetUsn,
                    });
                }
            }

            return extractedResults;
        } finally {
            page.off('dialog', dialogHandler);
        }
    }

    /**
     * Standalone scrape method for a single USN.
     * Manages full lifecycle: launches headless browser, creates OCR worker, extracts results,
     * and guarantees resource termination.
     * 
     * @param {string} usn
     * @param {object} [options={}]
     * @returns {Promise<any[]>} Array of extracted results
     */
    async scrapeUsn(usn, options = {}) {
        let browser = null;
        let worker = null;

        try {
            browser = await this.launchBrowser();
            worker = await this.createOcrWorker();

            const pages = await browser.pages();
            const page = pages.length > 0 ? pages[0] : await browser.newPage();

            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            return await this.scrapeUsnWithPage(page, worker, usn, options);
        } finally {
            if (worker) {
                await worker.terminate().catch(() => {});
            }
            if (browser && browser.connected) {
                await browser.close().catch(() => {});
            }
        }
    }
}

export const scraperService = new ScraperService();
