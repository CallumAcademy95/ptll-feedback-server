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
