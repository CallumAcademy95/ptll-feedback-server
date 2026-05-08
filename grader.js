const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Reads the assessor's feedback email and decides whether the assessor
 * concluded the work meets the criteria.
 *
 * Output: { outcome: 'PASS' | 'REFER', raw: string }
 *
 * Bias: when the email reads as "off you go to your tutor, no fixes needed"
 * → PASS. When the email lists points the learner must address before the
 * work is acceptable → REFER. Soft "worth thinking about" notes alongside
 * a clean conclusion are still PASS — that matches the assessor system
 * prompt which says ~80% of submissions should pass on first read.
 *
 * The grader reads only the assessor's email, not the submission. The
 * assessor has already done the marking; we just classify their conclusion.
 */
const SYSTEM_PROMPT = `You are a strict classifier reading a UK fitness assessor's feedback email to a learner.

Your only job: decide whether the assessor concluded the work MEETS THE CRITERIA (PASS) or asked the learner to REVISE the work before it can be accepted (REFER).

PASS indicators:
- The email confirms the work meets the criteria.
- The closing line sends the learner off to pass the work to their tutor with no pending fixes.
- Any notes are framed as soft suggestions ("worth keeping in mind", "something to think about", "for next time") — not required changes.

REFER indicators:
- The email lists specific points the learner MUST address before the work is acceptable.
- The email names pass-blockers, missing required sections within the submitted document, unsafe practice, or scope-of-practice violations.
- The closing asks the learner to update specific points and pass the updated work back.
- In resubmission mode: the email lists outstanding items from the previous feedback that have not been addressed.

Mixed-content rule:
- If the email contains BOTH soft "worth thinking about" notes AND any required change → REFER.
- If the only issues mentioned are explicitly framed as suggestions, optional, or "for next time" → PASS.

Output exactly one word, with no punctuation, in capitals: PASS or REFER.`;

async function gradeOutcome(feedbackText) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 5,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Assessor email:\n\n${feedbackText}\n\nClassify: PASS or REFER?`,
      },
    ],
  });

  const raw = (message.content[0]?.text || '').trim().toUpperCase();
  const outcome = raw.startsWith('PASS') ? 'PASS' : 'REFER';

  console.log(`[grader] outcome=${outcome} raw="${raw}"`);

  return { outcome, raw };
}

module.exports = { gradeOutcome };
