require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const cron = require('node-cron');
const { extractText } = require('./parser');
const {
  generateFeedback,
  generateReinforcement,
  identifyQualAndUnit,
} = require('./feedback');
const { gradeOutcome } = require('./grader');
const { uploadPassedSubmission } = require('./drive');
const { storeFeedback, findResubmissionMatch } = require('./history');
const { sendErrorNotice } = require('./mailer');
const { scheduleSend, processDue } = require('./scheduler');

const app = express();
app.use(express.json({ limit: '25mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('PT Launch Lab feedback server running.'));

// ─── Core processing pipeline ───────────────────────────────────────────────
// Single source of truth used by both inbound endpoints. Takes the file
// buffer + email metadata, runs the full identify → route → mark → grade →
// archive → queue flow.
async function processSubmission({ buffer, filename, fromEmail, fromName, subject }) {
  // Subject-line override still respected — but no longer required.
  const subjectFlagsResubmission = /\b(?:re-?submission|resubmit(?:ted|ting)?)\b/i.test(subject || '');

  const assignmentHint = (subject || '')
    .replace(/^(re:|fwd?:|submission:?)/i, '')
    .replace(/\b(?:re-?submission|resubmit(?:ted|ting)?)\b[:\s-]*/i, '')
    .trim();

  // Extract text first — feeds both classification and feedback.
  const { text } = await extractText(buffer, filename);
  console.log(`[parser] Extracted ${text.length} chars from ${filename}`);

  // Identify qualification + unit + submission type up front so we can route
  // before we burn the larger Sonnet call on the wrong mode.
  const { qual, units, submissionType } = await identifyQualAndUnit(text, assignmentHint);
  console.log(`[identify] qual=${qual || 'unknown'} units=${(units || []).join(',') || 'unknown'} type=${submissionType || 'unknown'}`);

  // Look up history. If the same learner has previously submitted the same
  // qual + at least one overlapping unit, route by the prior outcome.
  const priorMatch = await findResubmissionMatch({ email: fromEmail, qual, units });

  // Decide mode:
  //   reinforcement → already passed previously, no re-archive, short note
  //   resubmission  → previously REFER (or subject says so), check against prior points
  //   first         → no relevant history
  let mode = 'first';
  if (priorMatch?.outcome === 'PASS') {
    mode = 'reinforcement';
  } else if (priorMatch?.outcome === 'REFER' || subjectFlagsResubmission) {
    mode = 'resubmission';
  }
  console.log(`[route] mode=${mode}${priorMatch ? ` (prior outcome=${priorMatch.outcome || 'unknown'} from ${priorMatch.storedAt})` : ''}`);

  // ── Mode: reinforcement ──────────────────────────────────────────────────
  if (mode === 'reinforcement') {
    const feedbackText = await generateReinforcement(fromName, qual, units, priorMatch);
    console.log(`[reinforcement] Generated reinforcement reply for ${fromEmail}`);

    // Update history so we know they re-sent, but keep outcome PASS and the
    // existing driveArchived flag (don't re-upload).
    await storeFeedback({
      email: fromEmail,
      qual,
      units,
      submissionType,
      filename,
      feedbackText,
      outcome: 'PASS',
      driveArchived: priorMatch.driveArchived === true,
    });

    await scheduleSend({
      kind: 'reinforcement',
      toEmail: fromEmail,
      toName: fromName,
      submissionFilename: filename,
      feedbackText,
    });
    return;
  }

  // ── Mode: first or resubmission ──────────────────────────────────────────
  const isResubmission = mode === 'resubmission';

  const { feedbackText } = await generateFeedback(text, fromName, assignmentHint, {
    fromEmail,
    isResubmission,
    filename,
    qual,
    units,
    submissionType,
  });
  console.log(`[feedback] Generated ${isResubmission ? 'resubmission' : 'first-pass'} feedback for ${fromEmail}`);

  // Grade — does the assessor's email read as PASS or REFER?
  let outcome = 'REFER';
  try {
    ({ outcome } = await gradeOutcome(feedbackText));
  } catch (err) {
    console.error('[grader] Failed — defaulting to REFER:', err.message);
  }

  let driveArchived = false;

  if (outcome === 'PASS') {
    // Archive the file to Drive before notifying the learner. If the upload
    // fails we still send the pass email — the work has met the criteria;
    // we'd rather flag the upload failure to ourselves than block the reply.
    try {
      const result = await uploadPassedSubmission({
        buffer,
        filename,
        learnerName: fromName,
        learnerEmail: fromEmail,
        qual,
        units,
        submissionType,
        isResubmission,
      });
      driveArchived = !!result.uploaded;
    } catch (err) {
      console.error('[drive] Upload threw — continuing with pass email:', err.message);
    }

    await scheduleSend({
      kind: 'pass-confirmation',
      toEmail: fromEmail,
      toName: fromName,
      submissionFilename: filename,
      feedbackText,
    });
  } else {
    // REFER — standard feedback email path. Drive archive does NOT happen.
    await scheduleSend({
      kind: 'feedback',
      toEmail: fromEmail,
      toName: fromName,
      submissionFilename: filename,
      feedbackText,
    });
  }

  // Store the feedback + outcome so the next submission of this unit routes
  // correctly. PASS entries gate future submissions into reinforcement mode.
  await storeFeedback({
    email: fromEmail,
    qual,
    units,
    submissionType,
    filename,
    feedbackText,
    outcome,
    driveArchived,
  });
}

// ─── Postmark inbound webhook ────────────────────────────────────────────────
// Postmark POSTs a JSON object for each inbound email.
// Attachments come base64-encoded in the Attachments array.
app.post('/inbound', async (req, res) => {
  // Acknowledge immediately — Postmark will retry if we take > 15s
  res.sendStatus(200);

  const email = req.body;

  const fromEmail = email.From || email.FromFull?.Email || '';
  const fromName  = email.FromName || email.FromFull?.Name || '';
  const subject   = email.Subject || '';
  const attachments = email.Attachments || [];

  console.log(`[inbound] From: ${fromEmail} | Subject: ${subject} | Attachments: ${attachments.length}`);

  // Guard: ignore our own outbound emails looping back in
  const ownDomain = (process.env.FROM_EMAIL || '').split('@')[1];
  if (ownDomain && fromEmail.toLowerCase().endsWith('@' + ownDomain.toLowerCase())) {
    console.log('[inbound] From own domain — skipping.');
    return;
  }

  if (attachments.length === 0) {
    console.log('[inbound] No attachments — skipping.');
    return;
  }

  // Process each attachment independently
  for (const attachment of attachments) {
    const filename = attachment.Name || 'submission';
    const contentType = attachment.ContentType || '';
    const isSupported =
      filename.toLowerCase().endsWith('.docx') ||
      filename.toLowerCase().endsWith('.pdf');

    if (!isSupported) {
      console.log(`[inbound] Skipping unsupported attachment: ${filename}`);
      continue;
    }

    try {
      const buffer = Buffer.from(attachment.Content, 'base64');
      await processSubmission({ buffer, filename, fromEmail, fromName, subject });
    } catch (err) {
      console.error(`[error] Failed processing ${filename}:`, err.message);

      await sendErrorNotice({
        toEmail: fromEmail,
        toName: fromName,
        submissionFilename: filename,
        reason: err.message,
      }).catch(e => console.error('[mailer] Error notice also failed:', e.message));
    }
  }
});

// ─── Make.com inbound webhook ────────────────────────────────────────────────
// Accepts multipart/form-data from a Make.com "Watch Emails" + HTTP scenario.
// Expected fields: fromEmail, fromName, subject
// Expected file field: attachment (one file per request — use an iterator in Make for multiple)
app.post('/inbound-make', upload.single('attachment'), async (req, res) => {
  res.sendStatus(200);

  const fromEmail = (req.body.fromEmail || '').trim();
  const fromName  = (req.body.fromName  || '').trim();
  const subject   = (req.body.subject   || '').trim();
  const file      = req.file;

  console.log(`[inbound-make] From: ${fromEmail} | Subject: ${subject} | File: ${file ? file.originalname : 'none'}`);

  if (!file) {
    console.log('[inbound-make] No attachment — skipping.');
    return;
  }

  const filename = file.originalname || 'submission';
  const isSupported =
    filename.toLowerCase().endsWith('.docx') ||
    filename.toLowerCase().endsWith('.pdf');

  if (!isSupported) {
    console.log(`[inbound-make] Unsupported file type: ${filename} — skipping.`);
    return;
  }

  try {
    await processSubmission({
      buffer: file.buffer,
      filename,
      fromEmail,
      fromName,
      subject,
    });
  } catch (err) {
    console.error(`[error] Failed processing ${filename}:`, err.message);

    await sendErrorNotice({
      toEmail: fromEmail,
      toName: fromName,
      submissionFilename: filename,
      reason: err.message,
    }).catch(e => console.error('[mailer] Error notice also failed:', e.message));
  }
});

// ─── Queue inspector ─────────────────────────────────────────────────────────
app.get('/queue', async (req, res) => {
  const { loadPending } = require('./scheduler');
  const pending = await loadPending();
  const { DateTime } = require('luxon');

  const formatted = pending.map(item => ({
    id: item.id,
    kind: item.kind || 'feedback',
    to: item.toEmail,
    file: item.submissionFilename,
    scheduledFor: DateTime.fromISO(item.sendAt).setZone('Europe/London').toFormat('EEE dd MMM yyyy HH:mm') + ' UK',
  }));

  res.json({ count: formatted.length, queue: formatted });
});

// ─── Cron: check for due sends every minute ──────────────────────────────────
cron.schedule('* * * * *', () => processDue());

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Feedback server listening on port ${PORT}`));
