# Feedback Server — Setup Guide

## How it works

```
Learner emails work → submissions@yourdomain.com
  → forwarded to Postmark inbound address
    → Postmark POSTs JSON to /inbound on this server
      → server extracts text from docx/pdf attachment
        → Claude reads it and writes feedback
          → Postmark sends reply email to learner
```

---

## Step 1 — Clone and install

```bash
cd PT-Launch-Lab-AI/feedback-server
npm install
```

---

## Step 2 — Create your .env

```bash
cp .env.example .env
# Fill in values (see below)
```

---

## Step 3 — Set up Postmark

1. Go to [postmarkapp.com](https://postmarkapp.com) → create a free account
2. Create a **Server** (e.g. "PTLL Feedback")
3. Go to **Settings → API Tokens** → copy your Server Token → paste into `POSTMARK_SERVER_TOKEN`
4. Go to **Sender Signatures** → add and verify `feedback@yourdomain.com`
5. Go to **Inbound** → copy the Postmark inbound address (looks like `xyz@inbound.postmarkapp.com`)

---

## Step 4 — Set up email forwarding

In your domain's DNS / email admin:
- Create a forwarding rule: `submissions@yourdomain.com` → `xyz@inbound.postmarkapp.com`

Or if using your company email (e.g. Google Workspace):
- Set up a filter that auto-forwards submission emails to the Postmark inbound address

---

## Step 5 — Deploy to Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Select this repo (or this folder)
3. Add environment variables (copy from your .env)
4. Note your public URL, e.g. `https://ptll-feedback.up.railway.app`

---

## Step 6 — Connect Postmark inbound webhook

In Postmark → **Inbound** → set the webhook URL to:
```
https://your-railway-url.up.railway.app/inbound
```

---

## Step 7 — Test it

Send a test email with a .docx or .pdf attachment to `submissions@yourdomain.com`.
Check server logs on Railway. Learner should receive feedback within ~30 seconds.

---

## Customising the feedback prompt

Edit the `SYSTEM_PROMPT` in [feedback.js](feedback.js) to match your specific assignments,
marking criteria, or tone preferences.

---

## File size limits

- Server: 25MB JSON body limit (covers most docs)
- Postmark inbound: 10MB per email (their limit)
- If learners hit this, ask them to send separate emails per attachment

---

## Supported file types

| Format | Support |
|--------|---------|
| .docx  | Full text extraction |
| .pdf   | Text-based PDFs only (not scanned images) |
| .doc   | Not supported — ask learners to save as .docx |

---

## PASS routing + Drive archive (added 2026-05-08)

After the assessor email is generated, a separate Haiku call grades it as PASS or REFER. The flow then branches:

| Outcome | What happens |
|---------|--------------|
| PASS (first time) | File uploaded to Google Drive → `My Drive / ALBACOMANAGEMENT / LEARNER WORK SUBMISSIONS / {Learner Name}/`. Learner gets a "Submission accepted" email noting the work is on file. History records `outcome: PASS`. |
| PASS (already passed before) | Reinforcement mode: short warm note, NO re-upload to Drive. Triggered when `findResubmissionMatch` returns a prior entry with `outcome === 'PASS'`. |
| REFER (first time) | Standard feedback email with the points to address. No Drive upload. History records `outcome: REFER`. |
| REFER (resubmission) | Resubmission mode: only checks whether previous points were addressed. If still REFER, sends the outstanding points. If now PASS, archives + sends pass email. |

### Resubmission detection

No longer relies on the subject line saying "RESUBMISSION". Detection order:

1. `findResubmissionMatch({ email, qual, units })` in `history.js` — strict match on learner email + same qual + at least one overlapping unit.
2. Subject-line keyword (`re-?submission`, `resubmit(?:ted|ting)?`) still respected as a fallback.

History is stored in Upstash Redis under `ptll:feedback-history:{email}` with a 90-day TTL.

### New env var

```
MAKE_DRIVE_WEBHOOK_URL=https://hook.eu1.make.com/<webhook-id>
```

If unset, PASS submissions are still graded and replied to, but no Drive upload happens. Logs will print `[drive] MAKE_DRIVE_WEBHOOK_URL not set — skipping upload.`

### Make.com scenario — "Passed Submissions → Drive"

Mirror the existing signed-docs pattern. Steps:

1. **Webhook (Custom)** — receives JSON from `drive.js`. Fields:
   - `pdf_filename` — the original file name
   - `pdf_base64` — raw base64 of the file (no `data:` prefix)
   - `learner_name`, `learner_email`
   - `qual` (e.g. "NCFE L3 Personal Training")
   - `units` (e.g. "Unit 5")
   - `submission_type` (e.g. "case-study")
   - `submission_round` ("first-pass" | "resubmission-pass")
   - `submitted_at` (ISO timestamp)

2. **Google Drive — Search/Create folder**
   - Parent: `My Drive / ALBACOMANAGEMENT / LEARNER WORK SUBMISSIONS /`
   - Folder name: `{{1.learner_name}}`
   - Create if not found.

3. **Google Drive — Upload File**
   - Parent: folder ID from step 2
   - File name: `{{1.pdf_filename}}`
   - Data: `{{toBinary(1.pdf_base64; "base64")}}`

Copy the webhook URL into Render → environment variables → `MAKE_DRIVE_WEBHOOK_URL`.

### Queue inspector

`GET /queue` now also returns `kind` for each pending item: `feedback`, `pass-confirmation`, or `reinforcement`.
