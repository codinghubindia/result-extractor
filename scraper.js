import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import readline from 'readline';
import { createWorker, PSM } from 'tesseract.js';

// Interactive prompt via terminal
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Preprocess CAPTCHA image using canvas
async function getCaptchaBase64(page) {
  return await page.evaluate(() => {
    const img = document.querySelector('#captcha');
    if (!img) return null;

    const scale = 3;
    const pad = 25;
    const w = (img.naturalWidth || 120) * scale;
    const h = (img.naturalHeight || 40) * scale;

    const canvas = document.createElement('canvas');
    canvas.width = w + pad * 2;
    canvas.height = h + pad * 2;
    const ctx = canvas.getContext('2d');

    // Fill white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw scaled captcha
    ctx.drawImage(img, pad, pad, w, h);

    // Binarize to remove noise lines
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const val = gray < 135 ? 0 : 255;
      d[i] = val;
      d[i + 1] = val;
      d[i + 2] = val;
      d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    return canvas.toDataURL('image/png').split(',')[1];
  });
}

// Auto-solve CAPTCHA with Tesseract OCR
async function autoSolveCaptcha(page, worker) {
  try {
    const base64Data = await getCaptchaBase64(page);
    if (!base64Data) return '';

    const buffer = Buffer.from(base64Data, 'base64');
    const ret = await worker.recognize(buffer);
    const text = (ret.data.text || '').replace(/[^a-zA-Z0-9]/g, '');
    return text;
  } catch (err) {
    console.error('Error during OCR recognition:', err.message);
    return '';
  }
}

// Check if still on the login form
async function isLoginFormPresent(page) {
  return await page.evaluate(() => {
    const usnInput = document.querySelector('#usn');
    const secInput = document.querySelector('#securityCode');
    return !!(usnInput && secInput);
  });
}

// Reload CAPTCHA image
async function reloadCaptchaImage(page) {
  try {
    const reloadBtn = await page.$('#reloadCaptcha');
    if (reloadBtn) {
      await reloadBtn.click();
      await new Promise(r => setTimeout(r, 1200));
    }
  } catch (e) {
    // Ignore error
  }
}

// Checks if a message indicates a student not found or invalid USN error
function isNotFoundError(msg) {
  if (!msg || typeof msg !== 'string') return false;
  const lower = msg.toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('does not exist') ||
    lower.includes("doesn't exist") ||
    lower.includes('invalid usn') ||
    lower.includes('candidate not found') ||
    lower.includes('no record') ||
    lower.includes('no records') ||
    lower.includes('no data') ||
    lower.includes('no result') ||
    lower.includes('not announced') ||
    lower.includes('unregistered') ||
    lower.includes('not registered') ||
    lower.includes('not available') ||
    lower.includes('withheld') ||
    lower.includes('invalid registration') ||
    lower.includes('check the usn') ||
    lower.includes('wrong usn') ||
    lower.includes('not eligible') ||
    lower.includes('hall ticket') ||
    lower.includes('no match')
  );
}

// Checks for error banners or alerts rendered in DOM
async function checkDomError(page) {
  return await page.evaluate(() => {
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
    const body = document.body ? document.body.innerText : '';
    const match = body.match(/(?:USN|Student|Candidate|Result)[\s\w]*(?:not found|does not exist|not announced|no records|withheld)/i);
    return match ? match[0] : null;
  });
}

// Detect current page state after login
async function detectPageState(page) {
  return await page.evaluate(() => {
    const bodyText = document.body ? document.body.innerText : '';

    // Check for results table or grade indicators (result.png)
    const hasResultTable = Array.from(document.querySelectorAll('table')).some(table => {
      const text = table.innerText.toUpperCase();
      return text.includes('COURSE CODE') || text.includes('GRADE') || text.includes('CREDITS');
    });
    const hasGpaSummary = bodyText.includes('SGPA') || bodyText.includes('Credits Registered');

    if (hasResultTable || hasGpaSummary) {
      return 'DIRECT_RESULT';
    }

    // Check for exam selection cards / buttons (pagein.png)
    // Matches input[type="button"][value="View Results"], a[onclick*="submitfrom"], or text
    const hasViewResultsInput = Array.from(document.querySelectorAll('input[type="button"], input[type="submit"], button, a')).some(el => {
      const val = (el.value || '').toUpperCase();
      const txt = (el.textContent || '').toUpperCase();
      const onclick = (el.getAttribute('onclick') || '').toLowerCase();
      return val.includes('VIEW RESULTS') || txt.includes('VIEW RESULTS') || onclick.includes('submitfrom');
    });

    if (hasViewResultsInput || bodyText.includes('Please Select Exam') || document.querySelector('#examfrom')) {
      return 'EXAM_SELECTION';
    }

    // Check for errors / alerts inside page
    const alertBox = document.querySelector('.uk-alert-danger, .alert-danger, #system-message-container, .error-message, [role="alert"]');
    if (alertBox && alertBox.innerText.trim().length > 0) {
      return 'ERROR';
    }

    const lower = bodyText.toLowerCase();
    if (lower.includes('not found') || lower.includes('does not exist') || lower.includes('candidate not found') || lower.includes('no records')) {
      return 'ERROR';
    }

    return 'UNKNOWN';
  });
}

// Get list of available exams on Exam Selection page (pagein.png)
async function getAvailableExams(page) {
  return await page.evaluate(() => {
    // Each exam card is a .cn-card containing an input button or submitfrom link
    const cards = Array.from(document.querySelectorAll('.cn-card')).filter(card => {
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
          displayName: `${title} ${semester ? `[${semester}]` : ''} ${lastUpdated ? `(${lastUpdated})` : ''}`.trim()
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
        displayName: text ? text.slice(0, 50) : `Exam ${index + 1} (ID: ${examId})`
      };
    });
  });
}

// Trigger submission for a selected exam
async function triggerExamSubmission(page, exam) {
  await page.evaluate((u, eId, idx) => {
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
    const cards = Array.from(document.querySelectorAll('.cn-card')).filter(card => {
      return card.querySelector('input[value*="View Results" i], a[onclick*="submitfrom"]');
    });
    if (cards[idx]) {
      const btn = cards[idx].querySelector('input, a, button');
      if (btn) btn.click();
    }
  }, exam.usn, exam.examId, exam.index);
}

// Extract result data from result.png
async function extractResultData(page) {
  return await page.evaluate(() => {
    const data = {
      timestamp: new Date().toISOString(),
      student: {
        name: '',
        srn: '',
        department: '',
        semester: ''
      },
      exam: '',
      summary: {
        creditsRegistered: null,
        creditsEarned: null,
        sgpa: null,
        cgpa: null
      },
      courses: []
    };

    // 1. Student Name
    const nameEl = document.querySelector('.stu-data1 h3, .student-header h3, h3');
    if (nameEl) {
      data.student.name = nameEl.innerText.trim();
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
    if (!data.student.name) {
      const nameMatch = bodyText.match(/([A-Z\s]{3,35})\n\s*(?:1GA\w+)/i);
      if (nameMatch) data.student.name = nameMatch[1].trim();
    }

    // 3. Exam Title (e.g. "January 2026 - Provisional Result")
    const examHeading = Array.from(document.querySelectorAll('h2, h3, h4, .uk-heading-bullet')).find(el =>
      el.innerText.includes('Provisional Result') || el.innerText.includes('Results')
    );
    if (examHeading) {
      data.exam = examHeading.innerText.trim();
    } else {
      const examMatch = bodyText.match(/([A-Za-z]+\s+\d{4}\s*-\s*Provisional Result)/i);
      if (examMatch) data.exam = examMatch[1].trim();
    }

    // 4. Summary metrics (Credits Registered, Credits Earned, SGPA, CGPA)
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

    // 5. Course Marks Table
    const tables = Array.from(document.querySelectorAll('table'));
    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length > 1) {
        const headerText = rows[0].innerText.toUpperCase();
        if (headerText.includes('COURSE') || headerText.includes('SEE') || headerText.includes('GRADE') || headerText.includes('TOTAL')) {
          const rawHeaders = Array.from(rows[0].querySelectorAll('th, td')).map(c =>
            c.innerText.trim().replace(/\s+/g, ' ')
          );

          for (let i = 1; i < rows.length; i++) {
            const cells = Array.from(rows[i].querySelectorAll('td')).map(c =>
              c.innerText.trim().replace(/\s+/g, ' ')
            );
            if (cells.length >= 3 && cells.some(c => /\w+/.test(c))) {
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
  });
}

// Pretty print extracted result to console
function displayResultsSummary(result) {
  console.log('\n===============================================================');
  console.log('                   STUDENT PROVISIONAL RESULT                  ');
  console.log('===============================================================');
  if (result.exam) console.log(`Exam:        ${result.exam}`);
  if (result.student.name) console.log(`Name:        ${result.student.name}`);
  if (result.student.srn) console.log(`SRN/USN:     ${result.student.srn}`);
  if (result.student.department) console.log(`Department:  ${result.student.department}`);

  console.log('---------------------------------------------------------------');
  console.log(`Credits Registered: ${result.summary.creditsRegistered || 'N/A'} | Credits Earned: ${result.summary.creditsEarned || 'N/A'}`);
  console.log(`SGPA:               ${result.summary.sgpa || 'N/A'} | CGPA:           ${result.summary.cgpa || 'N/A'}`);
  console.log('---------------------------------------------------------------');

  if (result.courses && result.courses.length > 0) {
    console.log('\nCOURSE DETAILS:');
    console.table(result.courses);
  } else {
    console.log('No individual course rows parsed from table.');
  }
  console.log('===============================================================\n');
}

async function runScraper() {
  const targetUsn = process.argv[2] || '1GA23IS073';
  const targetUrl = 'https://eresultsglobal.contineo.in/';

  console.log('====================================================');
  console.log('     GAT Online Results Automation & Scraper       ');
  console.log('====================================================');
  console.log(`Target URL: ${targetUrl}`);
  console.log(`Target SRN/USN: ${targetUsn}`);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    slowMo: 30,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  let tesseractWorker = null;

  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Track browser dialog alerts
    let lastAlertMessage = null;
    page.on('dialog', async dialog => {
      lastAlertMessage = dialog.message();
      console.log(`[Browser Alert]: "${lastAlertMessage}"`);
      await dialog.accept();
    });

    console.log('\nNavigating to target page...');
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for login form
    try {
      await page.waitForSelector('#usn', { timeout: 15000 });
      await page.waitForSelector('#securityCode', { timeout: 15000 });
      await page.waitForSelector('#captcha', { timeout: 15000 });
    } catch (err) {
      throw new Error(`Failed to load login form on ${targetUrl}: ${err.message}`);
    }

    console.log('Login form detected.');

    // Initialize OCR solver
    console.log('Initializing OCR solver for CAPTCHA...');
    tesseractWorker = await createWorker('eng');
    await tesseractWorker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
      tessedit_char_whitelist: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    });

    let loggedIn = false;
    const MAX_AUTO_TRIES = 2;

    // --- PHASE 1: Auto-solver (Max 2 tries) ---
    for (let attempt = 1; attempt <= MAX_AUTO_TRIES; attempt++) {
      console.log(`\n[Auto CAPTCHA Solver] Attempt ${attempt} of ${MAX_AUTO_TRIES}...`);

      await page.$eval('#usn', (el, val) => el.value = val, targetUsn);

      const autoText = await autoSolveCaptcha(page, tesseractWorker);
      console.log(`[Auto CAPTCHA Solver] Detected text: "${autoText}"`);

      if (autoText && autoText.length >= 3) {
        await page.$eval('#securityCode', (el, val) => el.value = val, autoText);

        lastAlertMessage = null;
        console.log('Submitting login form...');
        const submitBtn = await page.$('button.myButton, button[type="submit"]');
        if (submitBtn) await submitBtn.click();

        await new Promise(r => setTimeout(r, 2500));

        const onLogin = await isLoginFormPresent(page);
        const domErr = await checkDomError(page);

        if (lastAlertMessage && isNotFoundError(lastAlertMessage)) {
          console.log(`\n[!] Student Not Found: "${lastAlertMessage}"`);
          return;
        }
        if (domErr && isNotFoundError(domErr)) {
          console.log(`\n[!] Student Not Found: "${domErr}"`);
          return;
        }

        if (!onLogin && !lastAlertMessage) {
          console.log('[+] Auto CAPTCHA solved successfully!');
          loggedIn = true;
          break;
        } else {
          console.log(`[-] Auto CAPTCHA attempt ${attempt} unsuccessful (${lastAlertMessage || domErr || 'Login not completed'}).`);
          if (attempt < MAX_AUTO_TRIES) {
            console.log('Reloading CAPTCHA for next attempt...');
            await reloadCaptchaImage(page);
          }
        }
      } else {
        console.log(`[-] Low confidence / empty auto-solve on attempt ${attempt}.`);
        if (attempt < MAX_AUTO_TRIES) {
          console.log('Reloading CAPTCHA for next attempt...');
          await reloadCaptchaImage(page);
        }
      }
    }

    // --- PHASE 2: User prompt if auto-solver failed ---
    while (!loggedIn && (await isLoginFormPresent(page))) {
      // Check if not found error before asking user
      const domErr = await checkDomError(page);
      if (lastAlertMessage && isNotFoundError(lastAlertMessage)) {
        console.log(`\n[!] Student Not Found: "${lastAlertMessage}"`);
        return;
      }
      if (domErr && isNotFoundError(domErr)) {
        console.log(`\n[!] Student Not Found: "${domErr}"`);
        return;
      }

      console.log('\n-----------------------------------------------------------');
      console.log('Auto CAPTCHA solver reached maximum tries (2).');
      console.log('Please look at the opened browser window to see the CAPTCHA.');
      console.log('-----------------------------------------------------------');

      await page.$eval('#usn', (el, val) => el.value = val, targetUsn);

      const userCaptcha = await askQuestion('>> Enter the CAPTCHA text shown in the browser: ');

      if (!userCaptcha) {
        console.log('No CAPTCHA entered. Please enter the characters.');
        continue;
      }

      await page.$eval('#securityCode', (el, val) => el.value = val, userCaptcha);

      lastAlertMessage = null;
      console.log('Submitting login form with your input...');
      const submitBtn = await page.$('button.myButton, button[type="submit"]');
      if (submitBtn) await submitBtn.click();

      await new Promise(r => setTimeout(r, 2500));

      const onLogin = await isLoginFormPresent(page);
      const postDomErr = await checkDomError(page);

      if (lastAlertMessage && isNotFoundError(lastAlertMessage)) {
        console.log(`\n[!] Student Not Found: "${lastAlertMessage}"`);
        return;
      }
      if (postDomErr && isNotFoundError(postDomErr)) {
        console.log(`\n[!] Student Not Found: "${postDomErr}"`);
        return;
      }

      if (!onLogin && !lastAlertMessage) {
        console.log('[+] Login successful!');
        loggedIn = true;
        break;
      } else {
        console.log(`[-] Submission failed: ${lastAlertMessage || postDomErr || 'Invalid CAPTCHA'}. Please try again.`);
        await reloadCaptchaImage(page);
      }
    }

    // --- PHASE 3: Handle Scenarios (Direct Result vs Exam Selection) ---
    console.log('\nChecking response page state...');
    await page.waitForNetworkIdle({ timeout: 6000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    let pageState = await detectPageState(page);

    // If still loading or unknown, wait up to 4s more
    if (pageState === 'UNKNOWN') {
      await new Promise(r => setTimeout(r, 3000));
      pageState = await detectPageState(page);
    }

    console.log(`Detected Page State: ${pageState}`);

    let allExtractedResults = [];

    if (pageState === 'DIRECT_RESULT') {
      // Scenario A: Odd semester / Direct Result page (result.png)
      console.log('\n[Scenario A]: Direct Result page detected (Odd Semester).');
      console.log('Extracting result data...');
      const result = await extractResultData(page);
      displayResultsSummary(result);
      allExtractedResults.push(result);

    } else if (pageState === 'EXAM_SELECTION') {
      // Scenario B: Even semester / Exam Selection page (pagein.png)
      console.log('\n[Scenario B]: Exam Selection dashboard detected (Even Semester / Multiple Exams).');

      const exams = await getAvailableExams(page);

      if (!exams || exams.length === 0) {
        console.log('[!] Warning: No exam cards detected on exam selection page.');
      } else {
        console.log('\nAvailable Exams:');
        exams.forEach(ex => {
          console.log(`  [${ex.index + 1}] ${ex.displayName}`);
        });
        if (exams.length > 1) {
          console.log(`  [A] Extract All Exams (Both/All options)`);
        }

        // Prompt user to select which exam to view
        const selection = await askQuestion(
          `\n>> Select exam to view [1-${exams.length}${exams.length > 1 ? ', or A for all' : ''}] (default 1): `
        );

        const cleanSelection = selection.toUpperCase().trim() || '1';

        if (cleanSelection === 'A' && exams.length > 1) {
          // Extract All Exams sequentially
          console.log('\nExtracting all available exam results...');

          for (let i = 0; i < exams.length; i++) {
            console.log(`\nNavigating to Exam ${i + 1}: ${exams[i].displayName}...`);

            await triggerExamSubmission(page, exams[i]);

            await Promise.race([
              page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
              page.waitForSelector('table', { timeout: 15000 }).catch(() => {})
            ]);
            await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));

            const examResult = await extractResultData(page);
            if (!examResult.exam) examResult.exam = exams[i].title;
            displayResultsSummary(examResult);
            allExtractedResults.push(examResult);

            if (i < exams.length - 1) {
              console.log('Navigating back to Exam Selection dashboard...');
              await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
              await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
              await new Promise(r => setTimeout(r, 1500));
            }
          }

        } else {
          // Extract single selected exam
          const selectedIdx = parseInt(cleanSelection, 10) - 1;
          const validIdx = (!isNaN(selectedIdx) && selectedIdx >= 0 && selectedIdx < exams.length) ? selectedIdx : 0;
          const chosenExam = exams[validIdx];

          console.log(`\nSelected Exam: ${chosenExam.displayName}`);
          console.log('Submitting exam request...');

          await triggerExamSubmission(page, chosenExam);

          await Promise.race([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
            page.waitForSelector('table', { timeout: 15000 }).catch(() => {})
          ]);
          await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 1500));

          const result = await extractResultData(page);
          if (!result.exam) result.exam = chosenExam.title;
          displayResultsSummary(result);
          allExtractedResults.push(result);
        }
      }

    } else if (pageState === 'ERROR') {
      const pageErrorMessage = await page.evaluate(() => {
        const alertBox = document.querySelector('.uk-alert-danger, .alert-danger, #system-message-container');
        return alertBox ? alertBox.innerText.trim() : 'Unknown error returned by server.';
      });
      console.error(`\n[!] Error from website: ${pageErrorMessage}`);

    } else {
      console.log('\n[!] Page state could not be determined automatically.');
      console.log('Attempting general data extraction from current page...');
      const fallbackResult = await extractResultData(page);
      displayResultsSummary(fallbackResult);
      allExtractedResults.push(fallbackResult);
    }

    // Save final output
    const outputData = allExtractedResults.length === 1 ? allExtractedResults[0] : allExtractedResults;
    await fs.writeFile('extracted_data.json', JSON.stringify(outputData, null, 2), 'utf-8');
    console.log(`[+] Saved ${allExtractedResults.length} result(s) to extracted_data.json`);

    console.log('\n===============================================================');
    console.log('Execution finished! The browser will stay open for your review.');
    console.log('Close the browser window or press Ctrl+C in terminal to exit.');
    console.log('===============================================================');

    // Clean exit handlers
    const handleExit = async () => {
      console.log('\nExiting script and closing browser...');
      try {
        if (tesseractWorker) await tesseractWorker.terminate();
        if (browser && browser.connected) await browser.close();
      } catch (e) {}
      process.exit(0);
    };
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);

    // Keep process alive while browser is open
    await new Promise(resolve => browser.on('disconnected', resolve));
    console.log('Browser was closed.');

  } catch (error) {
    console.error('\n[Error encountered during execution]:', error.message || error);
    if (browser && browser.connected) {
      console.log('Browser is kept open for debugging. Press Ctrl+C in terminal to exit.');
      await new Promise(resolve => browser.on('disconnected', resolve));
    }
  } finally {
    if (tesseractWorker) {
      await tesseractWorker.terminate().catch(() => {});
    }
  }
}

runScraper();
