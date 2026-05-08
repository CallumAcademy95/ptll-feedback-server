const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const HISTORY_KEY_PREFIX = 'ptll:feedback-history:';
const HISTORY_LIMIT = 5;
const HISTORY_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function keyFor(email) {
  return HISTORY_KEY_PREFIX + email.trim().toLowerCase();
}

/**
 * Stores a feedback entry against a learner's email. Keeps the most recent
 * HISTORY_LIMIT entries so resubmissions can find the matching prior feedback
 * even when a learner has multiple submissions in flight across units.
 *
 * outcome: 'PASS' | 'REFER' | null — set by the grader. Drives whether a
 * future submission of the same unit is treated as a reinforcement (already
 * passed, no re-archive) or a resubmission (still working towards a pass).
 */
async function storeFeedback({
  email,
  qual,
  units,
  submissionType,
  filename,
  feedbackText,
  outcome,
  driveArchived,
}) {
  if (!email) return;

  const k = keyFor(email);
  const existing = (await redis.get(k)) || [];

  const entry = {
    qual: qual || null,
    units: units || null,
    submissionType: submissionType || null,
    filename: filename || null,
    feedbackText,
    outcome: outcome || null,
    driveArchived: !!driveArchived,
    storedAt: new Date().toISOString(),
  };

  const next = [entry, ...existing].slice(0, HISTORY_LIMIT);
  await redis.set(k, next, { ex: HISTORY_TTL_SECONDS });
}

/**
 * Looks up the most relevant prior feedback for a resubmission.
 * Preference order:
 *   1. Same qual + same units (exact match)
 *   2. Same qual
 *   3. Most recent of any kind
 * Returns the entry or null.
 */
async function lookupPreviousFeedback({ email, qual, units }) {
  if (!email) return null;

  const history = (await redis.get(keyFor(email))) || [];
  if (history.length === 0) return null;

  const unitsKey = (units || []).join(',');

  if (qual && unitsKey) {
    const exact = history.find(
      h => h.qual === qual && (h.units || []).join(',') === unitsKey,
    );
    if (exact) return exact;
  }

  if (qual) {
    const qualMatch = history.find(h => h.qual === qual);
    if (qualMatch) return qualMatch;
  }

  return history[0];
}

/**
 * Strict match for routing decisions. Returns the most recent prior entry
 * where the learner submitted the SAME qual and at least one OVERLAPPING unit.
 * Used to decide whether the current inbound is:
 *   - a first submission (no match → null)
 *   - a resubmission of failed work (match.outcome === 'REFER')
 *   - a duplicate of already-passed work (match.outcome === 'PASS')
 *
 * If qual or units cannot be identified for the current submission, returns
 * null — we do not auto-route an unidentified submission as a resubmission.
 */
async function findResubmissionMatch({ email, qual, units }) {
  if (!email || !qual || !units || units.length === 0) return null;

  const history = (await redis.get(keyFor(email))) || [];
  if (history.length === 0) return null;

  const currentUnits = new Set(units);

  for (const entry of history) {
    if (entry.qual !== qual) continue;
    const priorUnits = entry.units || [];
    const overlaps = priorUnits.some(u => currentUnits.has(u));
    if (overlaps) return entry;
  }

  return null;
}

module.exports = {
  storeFeedback,
  lookupPreviousFeedback,
  findResubmissionMatch,
};
