require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { extractText } = require('./parser');
const { generateFeedback } = require('./feedback');
const { sendErrorNotice } = require('./mailer');
const { scheduleSend, processDue } = require('./scheduler');

const app = express();
app.use(express.json({ limit: '25mb' }));

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

  // Guard: no attachments
  if (attachments.length === 0) {
    console.log('[inbound] No attachments — skipping.');
    return;
  }

  // Try to extract an assignment name from the subject line
  const assignmentHint = subject.replace(/^(re:|fwd?:|submission:?)/i, '').trim();

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
      const feedbackText = await generateFeedback(text, fromName, assignmentHint);
      console.log(`[feedback] Generated feedback for ${fromEmail}`);

      // Schedule reply within working hours (Mon–Fri 9am–5pm, 1–2hr lag)
      scheduleSend({
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

// ─── Cron: check for due sends every minute ──────────────────────────────────
cron.schedule('* * * * *', () => processDue());

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Feedback server listening on port ${PORT}`));
