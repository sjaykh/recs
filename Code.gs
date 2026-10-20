/**
 * @OnlyCurrentDoc
 *
 * Backend for recs.sjaykh.in
 * A Google Sheet that stores recommendations, plus a tiny web API for the page.
 *
 * The @OnlyCurrentDoc line above limits this script to the one spreadsheet it is
 * attached to. It cannot open, read or change any of your other files.
 * appsscript.json pins the exact permissions it may ask for:
 *   - this spreadsheet only
 *   - send email as you (used only to email you about new recommendations)
 *   - see your email address (so it knows where to send that email)
 *
 * SETUP (once)
 * 1. Create a new Google Sheet (sheets.new) and name it "Recommendations".
 * 2. Extensions > Apps Script. Replace everything in Code.gs with this file. Save.
 * 3. Project Settings (gear icon) > tick "Show appsscript.json manifest file in editor".
 *    Back in the editor, replace everything in appsscript.json with this repo's appsscript.json. Save.
 * 4. Pick "setup" in the function dropdown and click Run. Approve the permissions.
 *    This adds the headers, the Type and Status dropdowns and the Approved checkbox column.
 * 5. Deploy > New deployment > type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the Web app URL (ends in /exec) into index.html (the API line near the top of the script).
 *
 * DAY TO DAY
 * - New recommendations land at the bottom with Approved unticked. Open the link
 *   before you tick Approved: ticking it publishes the title and link.
 * - Change Status (Not started / In progress / Done) from the dropdown.
 * - Add your own finds as new rows. Leave "Recommended by" empty and fill
 *   "Found through" instead (e.g. Instagram).
 * - Edits show on the page right away.
 *
 * If you change this script later: Deploy > Manage deployments > Edit (pencil) >
 * Version: New version > Deploy. That keeps the same URL.
 */

const CONFIG = {
  SHEET_NAME: 'Recommendations',
  NOTIFY_BY_EMAIL: true,          // email you when someone recommends something
  MAX_SUGGESTIONS_PER_HOUR: 30,   // across all visitors; protects against floods
  MAX_SUGGESTIONS_PER_DAY: 100,   // hard daily ceiling on new rows
  MIN_FILL_MS: 3000,              // forms submitted faster than this are bots
  MAX_REQUEST_BYTES: 4000,        // a real submission is a few hundred bytes
  KEEP_MAIL_QUOTA: 10,            // stop emailing when Google's daily quota gets this low
  CACHE_SECONDS: 60,              // how long the public list is cached
};

const TYPES = ['Book', 'Film', 'Article', 'Video'];
const STATUSES = ['Not started', 'In progress', 'Done'];

// Column order in the sheet. Keep HEADERS and COL in step if you ever reorder.
const HEADERS = ['Added', 'Type', 'Title', 'Link', 'Recommended by', 'Their website',
  'Found through', 'Status', 'Approved'];
const COL = { added: 0, type: 1, title: 2, url: 3, by: 4, byLink: 5, via: 6, status: 7, approved: 8 };

const LIMITS = { title: 200, name: 80, link: 500 };
const CACHE_KEY = 'recs:list:v4';

/* ---------------------------------------------------------------- setup */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    const only = ss.getSheets();
    sheet = only.length === 1 && only[0].getLastRow() === 0
      ? only[0].setName(CONFIG.SHEET_NAME)
      : ss.insertSheet(CONFIG.SHEET_NAME);
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  applyValidation_(sheet, 2, sheet.getMaxRows() - 1);

  [100, 80, 280, 280, 150, 200, 130, 110, 80]
    .forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  clearCache_();
}

/* ------------------------------------------------------------- read API */

// Returns approved rows only, and only the fields the page shows.
function doGet() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(CACHE_KEY);
    if (cached) return json_(JSON.parse(cached));

    const items = readRows_()
      .filter(r => r[COL.approved] === true && clean_(r[COL.title], LIMITS.title))
      .map(r => ({
        type: TYPES.indexOf(r[COL.type]) > -1 ? r[COL.type] : '',
        title: clean_(r[COL.title], LIMITS.title),
        url: safeLink_(r[COL.url]),
        by: clean_(r[COL.by], LIMITS.name),
        byLink: safeLink_(r[COL.byLink]),
        via: clean_(r[COL.via], LIMITS.name),
        status: STATUSES.indexOf(r[COL.status]) > -1 ? r[COL.status] : 'Not started',
        added: r[COL.added] instanceof Date
          ? Utilities.formatDate(r[COL.added], 'Etc/UTC', 'yyyy-MM-dd')
          : '',
      }));

    const payload = { ok: true, items: items };
    try { cache.put(CACHE_KEY, JSON.stringify(payload), CONFIG.CACHE_SECONDS); } catch (e) { /* too big to cache */ }
    return json_(payload);
  } catch (err) {
    console.error('doGet failed: ' + err);
    return json_({ ok: false });
  }
}

/* ------------------------------------------------------------ write API */

// Only ever appends one new, unapproved row. It never edits or deletes anything.
function doPost(e) {
  try {
    return handlePost_(e);
  } catch (err) {
    // Log the detail for you; never send internals back to the visitor.
    console.error('doPost failed: ' + err);
    return json_({ ok: false, error: 'Something went wrong. Try again later.' });
  }
}

function handlePost_(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  if (body.length > CONFIG.MAX_REQUEST_BYTES) return json_({ ok: false, error: 'That was too long.' });

  const p = (e && e.parameter) || {};

  // Bots: honeypot filled in, or form submitted impossibly fast.
  // Pretend it worked so they don't adapt.
  if (p.website || Number(p.t || 0) < CONFIG.MIN_FILL_MS) return json_({ ok: true });

  const item = {
    type: TYPES.indexOf(p.type) > -1 ? p.type : 'Book',
    title: clean_(p.title, LIMITS.title),
    url: safeLink_(p.url),
    by: clean_(p.name, LIMITS.name),
    byLink: safeLink_(p.link),
  };
  if (!item.title) return json_({ ok: false, error: 'Add a title.' });
  if (!item.url) return json_({ ok: false, error: 'Add a link to it.' });
  if (!item.by) return json_({ ok: false, error: 'Add your name.' });
  if (hasLink_(item.title) || hasLink_(item.by)) {
    return json_({ ok: false, error: 'Put links in the link fields only.' });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({ ok: false, error: 'Busy right now. Try again in a moment.' });

  try {
    if (!underRateLimit_()) {
      return json_({ ok: false, error: 'Lots of recommendations right now. Try again later.' });
    }

    const titleKey = titleKey_(item.type, item.title);
    const urlKey = urlKey_(item.url);
    const exists = readRows_().some(r =>
      titleKey_(r[COL.type], r[COL.title]) === titleKey || (urlKey && urlKey_(r[COL.url]) === urlKey));
    if (exists) return json_({ ok: true, duplicate: true });

    const row = new Array(HEADERS.length).fill('');
    row[COL.added] = new Date();
    row[COL.type] = item.type;
    row[COL.title] = sheetSafe_(item.title);
    row[COL.url] = sheetSafe_(item.url);
    row[COL.by] = sheetSafe_(item.by);
    row[COL.byLink] = sheetSafe_(item.byLink);
    row[COL.status] = 'Not started';
    row[COL.approved] = false;   // nothing a visitor sends is ever published automatically

    const sheet = getSheet_();
    sheet.appendRow(row);
    applyValidation_(sheet, sheet.getLastRow(), 1);
  } finally {
    lock.releaseLock();
  }

  if (CONFIG.NOTIFY_BY_EMAIL) notify_(item);
  return json_({ ok: true });
}

/* -------------------------------------------------------------- helpers */

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Run setup() first.');
  return sheet;
}

// Dropdowns for Type and Status, a checkbox for Approved. Validation only,
// no values, so empty rows stay empty and getLastRow() stays accurate.
function applyValidation_(sheet, fromRow, count) {
  const list = values => SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true).setAllowInvalid(false).build();
  sheet.getRange(fromRow, COL.type + 1, count, 1).setDataValidation(list(TYPES));
  sheet.getRange(fromRow, COL.status + 1, count, 1).setDataValidation(list(STATUSES));
  sheet.getRange(fromRow, COL.approved + 1, count, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sheet.getRange(fromRow, COL.added + 1, count, 1).setNumberFormat('yyyy-mm-dd');
}

function readRows_() {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Trim, collapse whitespace, cap length, and strip control characters plus the
// invisible and right-to-left characters used to disguise text and links.
function clean_(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Only plain http(s) links survive. Bare domains get https:// added.
// Links with a username or password before the host (https://real.com@evil.com) are dropped.
function safeLink_(value) {
  let s = clean_(value, LIMITS.link);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = 'https://' + s;
    else return '';
  }
  if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s)) return '';
  if (/^https?:\/\/[^/?#]*@/i.test(s)) return '';
  return s;
}

function hasLink_(s) {
  return /https?:\/\/|www\./i.test(s);
}

// Stop text that starts with = + - @ from being read as a formula.
function sheetSafe_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Same title as a different type (a book and its film) is not a duplicate.
function titleKey_(type, title) {
  return String(type).toLowerCase() + '|' + String(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function urlKey_(url) {
  const s = safeLink_(url);
  return s ? s.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[/#?]+$/, '') : '';
}

// Counts per hour and per day across all visitors. Call only while holding the lock.
function underRateLimit_() {
  const cache = CacheService.getScriptCache();
  const now = new Date();
  const hourKey = 'recs:rate:h:' + Utilities.formatDate(now, 'Etc/UTC', 'yyyyMMddHH');
  const dayKey = 'recs:rate:d:' + Utilities.formatDate(now, 'Etc/UTC', 'yyyyMMdd');
  const perHour = Number(cache.get(hourKey) || 0);
  const perDay = Number(cache.get(dayKey) || 0);
  if (perHour >= CONFIG.MAX_SUGGESTIONS_PER_HOUR || perDay >= CONFIG.MAX_SUGGESTIONS_PER_DAY) return false;
  cache.put(hourKey, String(perHour + 1), 3600);
  cache.put(dayKey, String(perDay + 1), 21600);  // cache entries last at most 6 hours
  return true;
}

function clearCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}

// Emails only you. Skips quietly if Google's daily email quota is nearly used up.
function notify_(item) {
  try {
    if (MailApp.getRemainingDailyQuota() <= CONFIG.KEEP_MAIL_QUOTA) return;
    const to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    MailApp.sendEmail({
      to: to,
      subject: 'Recommendation: "' + item.title + '" from ' + item.by,
      body: [
        item.type + ': ' + item.title,
        item.url,
        'Recommended by ' + item.by + (item.byLink ? ' (' + item.byLink + ')' : ''),
        '',
        'Check the link, then tick Approved to publish it:',
        SpreadsheetApp.getActiveSpreadsheet().getUrl(),
      ].join('\n'),
    });
  } catch (err) {
    console.warn('Notification failed: ' + err);
  }
}

// Runs automatically when you edit the sheet, so approvals and status changes
// show on the page right away instead of after the cache expires.
function onEdit() {
  try { clearCache_(); } catch (e) { /* cache expires on its own anyway */ }
}
