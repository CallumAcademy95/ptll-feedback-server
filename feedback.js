const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a senior coach and assessor for AlbaCo Management Team, a professional personal training education programme.

Your role is to give honest, specific, and encouraging automated feedback on learner submissions before their full portfolio review.

When reviewing work, you must:
1. Acknowledge what the learner did well — be specific, not generic
2. Identify 2–4 clear areas for improvement with actionable guidance
3. Flag any required sections that appear missing or incomplete
4. Give an overall RAG status: 🟢 Ready, 🟡 Needs work, 🔴 Significant revision needed
5. End with 1–2 motivating sentences — keep it human, not corporate

Tone: Direct, warm, professional. Like a mentor who genuinely wants them to pass.
Format: Use clear headings and bullet points. Keep it scannable.
Length: 300–500 words. No padding.`;

/**
 * Sends extracted submission text to Claude and returns feedback string.
 */
async function generateFeedback(submissionText, learnerName, assignmentHint) {
  const userMessage = [
    assignmentHint ? `Assignment: ${assignmentHint}` : null,
    learnerName ? `Learner: ${learnerName}` : null,
    `\n--- SUBMISSION ---\n`,
    submissionText.slice(0, 50000), // cap at ~50k chars to stay within context
  ]
    .filter(Boolean)
    .join('\n');

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  return message.content[0].text;
}

module.exports = { generateFeedback };
