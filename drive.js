/**
 * Sends a passed submission to Make.com, which uploads it to Google Drive
 * under: My Drive / ALBACOMANAGEMENT / LEARNER WORK SUBMISSIONS / {learner_name}/
 *
 * Mirrors the existing signed-docs Make.com pattern:
 *   - JSON POST with raw base64 (no data URI prefix) so Make's toBinary works
 *   - One scenario per use case: this one is "Passed Submissions → Drive"
 *
 * Required env var: MAKE_DRIVE_WEBHOOK_URL
 *
 * Make.com scenario steps expected:
 *   1. Webhook (Custom) — receives this JSON.
 *   2. Google Drive (Search/Create folder) — find or create folder named
 *      {{1.learner_name}} inside the LEARNER WORK SUBMISSIONS folder.
 *   3. Google Drive (Upload a File) — file_name {{1.pdf_filename}},
 *      data toBinary(1.pdf_base64; "base64"), parent = folder id from step 2.
 */

const WEBHOOK_URL = process.env.MAKE_DRIVE_WEBHOOK_URL;

async function uploadPassedSubmission({
  buffer,
  filename,
  learnerName,
  learnerEmail,
  qual,
  units,
  submissionType,
  isResubmission,
}) {
  if (!WEBHOOK_URL) {
    console.error('[drive] MAKE_DRIVE_WEBHOOK_URL not set — skipping upload.');
    return { uploaded: false, reason: 'no-webhook-configured' };
  }

  if (!buffer || buffer.length === 0) {
    console.error('[drive] Empty buffer — skipping upload.');
    return { uploaded: false, reason: 'empty-buffer' };
  }

  const safeLearnerName = (learnerName || learnerEmail || 'Unknown Learner').trim();

  const qualLabel = qual === 'ncfe'
    ? 'NCFE L3 Personal Training'
    : qual === 'exref'
      ? 'Active IQ L3 Exercise Referral'
      : 'Unknown qualification';

  const unitLabel = units && units.length
    ? `Unit ${units.join(', ')}`
    : 'Unknown unit';

  const payload = {
    pdf_filename: filename,
    pdf_base64: buffer.toString('base64'),
    learner_name: safeLearnerName,
    learner_email: learnerEmail || '',
    qual: qualLabel,
    units: unitLabel,
    submission_type: submissionType || 'unknown',
    submission_round: isResubmission ? 'resubmission-pass' : 'first-pass',
    submitted_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[drive] Webhook returned ${res.status}: ${text}`);
      return { uploaded: false, reason: `webhook-${res.status}` };
    }

    console.log(
      `[drive] Uploaded ${filename} to Drive folder for "${safeLearnerName}" (${qualLabel}, ${unitLabel}, ${payload.submission_round})`,
    );
    return { uploaded: true };
  } catch (err) {
    console.error('[drive] Upload failed:', err.message);
    return { uploaded: false, reason: err.message };
  }
}

module.exports = { uploadPassedSubmission };
