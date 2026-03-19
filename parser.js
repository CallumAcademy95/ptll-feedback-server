const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

/**
 * Extracts plain text from a docx or pdf buffer.
 * Returns { text, type } or throws if unsupported/unreadable.
 */
async function extractText(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase();

  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (!text) throw new Error('DOCX appears to be empty or unreadable.');
    return { text, type: 'docx' };
  }

  if (ext === 'pdf') {
    const result = await pdfParse(buffer);
    const text = result.text.trim();
    if (!text) throw new Error(
      'PDF text could not be extracted. It may be a scanned image — ask the learner to resubmit as a text-based PDF or DOCX.'
    );
    return { text, type: 'pdf' };
  }

  throw new Error(`Unsupported file type: .${ext}. Please submit as .docx or .pdf`);
}

module.exports = { extractText };
