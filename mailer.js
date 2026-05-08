const postmark = require('postmark');

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN);

const FROM_EMAIL = process.env.FROM_EMAIL; // e.g. feedback@ptlaunchlab.com
const FROM_NAME = process.env.FROM_NAME || 'PT Launch Lab';

const HEADER_BAR = `
  <div style="background: #000; padding: 20px 28px;">
    <h2 style="color: #fff; margin: 0; font-size: 18px;">AlbaCo Management Team — Submission Feedback</h2>
  </div>`;

function wrapHtml(innerHtml, footerNote) {
  return `
    <div style="font-family: sans-serif; max-width: 680px; margin: 0 auto; color: #1a1a1a;">
      ${HEADER_BAR}
      <div style="padding: 28px; border: 1px solid #e0e0e0; border-top: none;">
        <div style="white-space: pre-wrap; line-height: 1.8; font-size: 15px;">${innerHtml}</div>
        ${footerNote
          ? `<hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
             <p style="font-size: 12px; color: #888; margin: 0;">${footerNote}</p>`
          : ''}
      </div>
    </div>`;
}

/**
 * Sends standard AI feedback (used for REFER outcomes — first submission and
 * resubmission both share this template).
 */
async function sendFeedback({ toEmail, toName, submissionFilename, feedbackText }) {
  const subject = `Your submission feedback: ${submissionFilename}`;
  const innerHtml = feedbackText.replace(/\n/g, '<br/>');
  const footer = `This is your initial automated feedback on <strong>${submissionFilename}</strong>. A full portfolio review will follow separately.`;

  await client.sendEmail({
    From: `${FROM_NAME} <${FROM_EMAIL}>`,
    To: toEmail,
    Cc: process.env.CC_EMAIL || '',
    Bcc: 'submissions@albacomanagement.co.uk',
    Subject: subject,
    HtmlBody: wrapHtml(innerHtml, footer),
    TextBody: feedbackText,
    ReplyTo: FROM_EMAIL,
    MessageStream: 'outbound',
  });
}

/**
 * Sends a PASS confirmation. Adds an explicit "archived to your records"
 * footer so the learner knows the work is now on file and they don't need
 * to send it again.
 */
async function sendPassConfirmation({ toEmail, toName, submissionFilename, feedbackText }) {
  const subject = `Submission accepted: ${submissionFilename}`;
  const innerHtml = feedbackText.replace(/\n/g, '<br/>');
  const footer = `<strong>${submissionFilename}</strong> meets the criteria and has been archived to your records. There is no need to send this piece in again — pass the latest version to your tutor when you are ready.`;

  await client.sendEmail({
    From: `${FROM_NAME} <${FROM_EMAIL}>`,
    To: toEmail,
    Cc: process.env.CC_EMAIL || '',
    Bcc: 'submissions@albacomanagement.co.uk',
    Subject: subject,
    HtmlBody: wrapHtml(innerHtml, footer),
    TextBody: feedbackText + '\n\n— This submission meets the criteria and has been archived to your records.',
    ReplyTo: FROM_EMAIL,
    MessageStream: 'outbound',
  });
}

/**
 * Sends a short reinforcement note when a learner re-sends a unit that has
 * ALREADY passed previously. No re-archive, no fresh marking.
 */
async function sendReinforcement({ toEmail, toName, submissionFilename, feedbackText }) {
  const subject = `Already on file: ${submissionFilename}`;
  const innerHtml = feedbackText.replace(/\n/g, '<br/>');
  const footer = `This unit is already on file from your previous submission. Pass the latest version to your tutor when you are ready.`;

  await client.sendEmail({
    From: `${FROM_NAME} <${FROM_EMAIL}>`,
    To: toEmail,
    Cc: process.env.CC_EMAIL || '',
    Bcc: 'submissions@albacomanagement.co.uk',
    Subject: subject,
    HtmlBody: wrapHtml(innerHtml, footer),
    TextBody: feedbackText + '\n\n— This unit is already on file from your previous submission.',
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
    Bcc: 'submissions@albacomanagement.co.uk',
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

module.exports = {
  sendFeedback,
  sendPassConfirmation,
  sendReinforcement,
  sendErrorNotice,
};
