const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { extractText } = require('./parser');

// Legacy binary Word (.doc) — learners still send these. Fixture is any real
// .doc on disk; point DOC_FIXTURE at one (kept out of the repo, it is large).
const docFixture = process.env.DOC_FIXTURE;

test('extracts text from a legacy .doc', { skip: !docFixture && 'set DOC_FIXTURE to a .doc path' }, async () => {
  const buffer = fs.readFileSync(docFixture);
  const { text, type } = await extractText(buffer, 'pt work new submittion.doc');
  assert.strictEqual(type, 'doc');
  assert.ok(text.length > 200, `expected body text, got ${text.length} chars`);
});

test('rejects a genuinely unsupported type with a learner-readable message', async () => {
  await assert.rejects(
    () => extractText(Buffer.from('x'), 'notes.pages'),
    /Unsupported file type: \.pages/
  );
});
