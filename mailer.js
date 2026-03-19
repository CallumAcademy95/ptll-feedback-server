const postmark = require('postmark');

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

const FROM_EMAIL = process.env.FROM_EMAIL; // e.g. feedback@ptlaunchlab.com
const FROM_NAME = process.env.FROM_NAME || 'PT Launch Lab';

/**
 * Sends AI feedback reply to the learner.
 */
async function sendFeedback({ toEmail, toName, submissionFilename, feedbackText }) {
  const subject = `Your submission feedback: ${submissionFilename}`;

  const htmlBody = `
    <div style="font-family: sans-serif; max-width: 680px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: #000; padding: 20px 28px;">
        <h2 style="color: #fff; margin: 0; font-size: 18px;">AlbaCo Management Team — Submission Feedback</h2>
      </div>
      <div style="padding: 28px; border: 1px solid #e0e0e0; border-top: none;">
        <p>Hi ${toName || 'there'},</p>
        <p>Here's your automated feedback on <strong>${submissionFilename}</strong>.
           This is an initial read — your full portfolio review will follow separately.</p>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
        <div style="white-space: pre-wrap; line-height: 1.7;">${feedbackText.replace(/\n/g, '<br/>')}</div>
        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
        <p style="font-size: 13px; color: #666;">
          This feedback was generated automatically. If you have questions, reply to this email
          and a coach will follow up during your full review.
        </p>
      </div>
    </div>
  `;

  await client.sendEmail({
    From: `${FROM_NAME} <${FROM_EMAIL}>`,
    To: toEmail,
    Cc: process.env.CC_EMAIL || '',
    Subject: subject,
    HtmlBody: htmlBody,
    TextBody: feedbackText,
    ReplyTo: FROM_EMAIL,
    MessageStream: 'outbound',
  });
}

/**
 * Sends an error notice when we couldn't process the submission.
 */
async function sendErrorNotice({ toEmail, toName, submissionFilename, reason }) {
  await client.sendEmail({
    From: `${FROM_NAME} <${FROM_EMAIL}>`,
    To: toEmail,
    Subject: `Problem with your submission: ${submissionFilename}`,
    TextBody: [
      `Hi ${toName || 'there'},`,
      '',
      `We received your submission (${submissionFilename}) but couldn't process it automatically.`,
      '',
      `Reason: ${reason}`,
      '',
      'Please check the file and resubmit, or reply to this email if you need help.',
      '',
      `— ${FROM_NAME}`,
    ].join('\n'),
    MessageStream: 'outbound',
  });
}

module.exports = { sendFeedback, sendErrorNotice };
