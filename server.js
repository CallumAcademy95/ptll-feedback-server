require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const cron = require('node-cron');
const { extractText } = require('./parser');
const { generateFeedback } = require('./feedback');
const { sendErrorNotice } = require('./mailer');
const { scheduleSend, processDue } = require('./scheduler');

const app = express();
app.use(express.json({ limit: '25mb' }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ─── Health check ───────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('PT Launch Lab feedback server running.'));

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

  // Guard: no attachments
  if (attachments.length === 0) {
    console.log('[inbound] No attachments — skipping.');
    return;
  }

  // Detect resubmission flag in the subject line BEFORE stripping prefixes
  const isResubmission = /\b(?:re-?submission|resubmit(?:ted|ting)?)\b/i.test(subject);

  // Try to extract an assignment name from the subject line
  const assignmentHint = subject
    .replace(/^(re:|fwd?:|submission:?)/i, '')
    .replace(/\b(?:re-?submission|resubmit(?:ted|ting)?)\b[:\s-]*/i, '')
    .trim();

  if (isResubmission) {
    console.log(`[inbound] Resubmission detected for ${fromEmail}`);
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
      // Decode base64 attachment
      const buffer = Buffer.from(attachment.Content, 'base64');

      // Extract text
      const { text } = await extractText(buffer, filename);
      console.log(`[parser] Extracted ${text.length} chars from ${filename}`);

      // Generate feedback
      const feedbackText = await generateFeedback(text, fromName, assignmentHint, {
        fromEmail,
        isResubmission,
        filename,
      });
      console.log(`[feedback] Generated feedback for ${fromEmail}`);

      // Schedule reply within working hours (Mon–Fri 9am–5pm, 1–2hr lag)
      await scheduleSend({
        toEmail: fromEmail,
        toName: fromName,
        submissionFilename: filename,
        feedbackText,
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

  const isResubmission = /\b(?:re-?submission|resubmit(?:ted|ting)?)\b/i.test(subject);

  const assignmentHint = subject
    .replace(/^(re:|fwd?:|submission:?)/i, '')
    .replace(/\b(?:re-?submission|resubmit(?:ted|ting)?)\b[:\s-]*/i, '')
    .trim();

  if (isResubmission) {
    console.log(`[inbound-make] Resubmission detected for ${fromEmail}`);
  }

  try {
    const { text } = await extractText(file.buffer, filename);
    console.log(`[parser] Extracted ${text.length} chars from ${filename}`);

    const feedbackText = await generateFeedback(text, fromName, assignmentHint, {
      fromEmail,
      isResubmission,
      filename,
    });
    console.log(`[feedback] Generated feedback for ${fromEmail}`);

    await scheduleSend({
      toEmail: fromEmail,
      toName: fromName,
      submissionFilename: filename,
      feedbackText,
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
