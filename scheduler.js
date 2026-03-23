const { Redis } = require('@upstash/redis');
const { DateTime } = require('luxon');
const { sendFeedback } = require('./mailer');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const QUEUE_KEY = 'ptll:pending-sends';
const WORK_START = 9;   // 9am UK time
const WORK_END = 17;    // 5pm UK time
const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri (Luxon: 1=Mon, 7=Sun)

// ─── Store helpers ───────────────────────────────────────────────────────────

async function loadPending() {
  const data = await redis.get(QUEUE_KEY);
  return data || [];
}

async function savePending(items) {
  await redis.set(QUEUE_KEY, items);
}

// ─── Scheduling logic ────────────────────────────────────────────────────────

/**
 * Calculates the next valid send time:
 * - Random 60–120 minute lag from now
 * - Must land within Mon–Fri 09:00–17:00 UK time
 * - If it would fall outside, push to next working day at 09:00 + random 0–30 mins
 */
function calculateSendTime() {
  const lagMinutes = 60 + Math.floor(Math.random() * 60); // 60–120 min
  let sendAt = DateTime.now().setZone('Europe/London').plus({ minutes: lagMinutes });

  const isWeekend = !WEEKDAYS.includes(sendAt.weekday);
  const isTooLate = sendAt.hour >= WORK_END || (sendAt.hour === WORK_END - 1 && sendAt.minute > 45);
  const isTooEarly = sendAt.hour < WORK_START;

  if (isWeekend || isTooLate) {
    // Push to next working day 9am + random 0–30 min offset
    sendAt = sendAt
      .plus({ days: 1 })
      .set({ hour: WORK_START, minute: Math.floor(Math.random() * 30), second: 0, millisecond: 0 });

    // Skip over weekends
    while (!WEEKDAYS.includes(sendAt.weekday)) {
      sendAt = sendAt.plus({ days: 1 });
    }
  } else if (isTooEarly) {
    sendAt = sendAt.set({
      hour: WORK_START,
      minute: Math.floor(Math.random() * 30),
      second: 0,
      millisecond: 0,
    });
  }

  return sendAt.toUTC().toJSDate();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Schedules a feedback email to be sent at the next valid working-hours slot.
 */
async function scheduleSend(payload) {
  const sendAt = calculateSendTime();
  const item = { ...payload, sendAt: sendAt.toISOString(), id: Date.now().toString() };

  const pending = await loadPending();
  pending.push(item);
  await savePending(pending);

  const ukTime = DateTime.fromJSDate(sendAt).setZone('Europe/London').toFormat('EEE dd MMM HH:mm');
  console.log(`[scheduler] Queued feedback for ${payload.toEmail} — scheduled for ${ukTime} UK`);
}

/**
 * Checks for due sends and fires them. Called by cron every minute.
 */
async function processDue() {
  const now = new Date();
  const pending = await loadPending();
  const due = pending.filter(item => new Date(item.sendAt) <= now);
  const remaining = pending.filter(item => new Date(item.sendAt) > now);

  for (const item of due) {
    try {
      await sendFeedback(item);
      console.log(`[scheduler] Sent delayed feedback to ${item.toEmail}`);
    } catch (err) {
      console.error(`[scheduler] Failed to send to ${item.toEmail}:`, err.message);
      // Put it back with a 15-min retry delay rather than losing it
      item.sendAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      remaining.push(item);
    }
  }

  await savePending(remaining);
}

module.exports = { scheduleSend, processDue, loadPending };
