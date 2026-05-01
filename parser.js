const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const JSZip = require('jszip');
const {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
  PDFOptionList,
} = require('pdf-lib');

/**
 * Extracts plain text from a docx or pdf buffer.
 * Returns { text, type } or throws if unsupported/unreadable.
 *
 * DOCX: combines mammoth's body extraction with a zip walk over headers,
 * footers, footnotes and any <w:t> text nodes — catches answers typed into
 * text boxes, drawing-layer shapes and form fields, which mammoth alone misses.
 *
 * PDF: combines pdf-parse's rendered page text with AcroForm field values,
 * since pdf-parse cannot see text typed into fillable form fields.
 */
async function extractText(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase();

  if (ext === 'docx') {
    const text = await extractDocxText(buffer);
    if (!text) throw new Error('DOCX appears to be empty or unreadable.');
    return { text, type: 'docx' };
  }

  if (ext === 'pdf') {
    const text = await extractPdfText(buffer);
    if (!text) throw new Error(
      'PDF text could not be extracted. It may be a scanned image — ask the learner to resubmit as a text-based PDF or DOCX.'
    );
    return { text, type: 'pdf' };
  }

  throw new Error(`Unsupported file type: .${ext}. Please submit as .docx or .pdf`);
}

async function extractDocxText(buffer) {
  const parts = [];

  // 1. Mammoth body text (paragraphs + tables in the main document).
  let mammothText = '';
  try {
    const result = await mammoth.extractRawText({ buffer });
    mammothText = (result && result.value ? result.value : '').trim();
    if (mammothText) parts.push(mammothText);
  } catch (_) {
    // fall through to zip walk
  }

  // 2. Zip walk: pull every <w:t> across document.xml, header*.xml, footer*.xml,
  // footnotes.xml, endnotes.xml. This catches text boxes (txbxContent), legacy
  // form fields and header/footer answers that mammoth's extractRawText skips.
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xmlPaths = Object.keys(zip.files).filter(p =>
      /^word\/(document\d*|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(p)
    );

    const extraChunks = [];
    for (const p of xmlPaths) {
      const xml = await zip.files[p].async('string');
      const matches = xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
      const lineParts = [];
      for (const m of matches) {
        const inner = m
          .replace(/^<w:t[^>]*>/, '')
          .replace(/<\/w:t>$/, '');
        if (inner.length) lineParts.push(decodeXmlEntities(inner));
      }
      const joined = lineParts.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) extraChunks.push(joined);
    }

    const extraText = extraChunks.join('\n').trim();
    // Only append zip-walk text if it adds material mammoth didn't already pick up.
    if (extraText && extraText !== mammothText) {
      parts.push(extraText);
    }
  } catch (_) {
    // no-op — keep whatever mammoth produced
  }

  return parts.join('\n\n').trim();
}

function decodeXmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractPdfText(buffer) {
  const parts = [];

  // 1. Rendered page text (works for non-fillable PDFs and any flattened answers).
  try {
    const result = await pdfParse(buffer);
    const pageText = (result && result.text ? result.text : '').trim();
    if (pageText) parts.push(pageText);
  } catch (_) {
    // fall through to form-field extraction
  }

  // 2. AcroForm field values — answers typed into fillable PDF boxes are stored
  // here, NOT in the page content stream, so pdf-parse never sees them.
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    const fieldLines = [];
    for (const f of fields) {
      const name = safeFieldName(f);
      const value = readFieldValue(f);
      if (value) fieldLines.push(name ? `${name}: ${value}` : value);
    }

    if (fieldLines.length) {
      parts.push('--- form fields ---\n' + fieldLines.join('\n'));
    }
  } catch (_) {
    // No form, encrypted, or unsupported — ignore.
  }

  return parts.join('\n\n').trim();
}

function safeFieldName(field) {
  try {
    return field.getName() || '';
  } catch {
    return '';
  }
}

function readFieldValue(field) {
  try {
    if (field instanceof PDFTextField) {
      return (field.getText() || '').trim();
    }
    if (field instanceof PDFCheckBox) {
      return field.isChecked() ? 'checked' : '';
    }
    if (field instanceof PDFRadioGroup) {
      return (field.getSelected() || '').toString().trim();
    }
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const sel = field.getSelected() || [];
      return sel.join(', ').trim();
    }
  } catch {
    return '';
  }
  return '';
}

module.exports = { extractText };
