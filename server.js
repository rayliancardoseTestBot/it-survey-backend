'use strict';

/**
 * IT Post-Ticket Survey — Backend (SQLite + Google Apps Script version)
 *
 * Stack: Node.js 18+ · Express · SQLite (local file-based database)
 * Webhook: Google Apps Script (no API keys, no authentication needed)
 * Deploy: Railway / Render / any VPS running Node
 *
 * Required env vars:
 *   PORT                      — default 3000
 *   WEBHOOK_URL               — Google Apps Script deployment URL
 *   SURVEY_SECRET             — random string used for token signing (optional)
 *   ALLOWED_ORIGIN            — optional CORS origin
 */

require('dotenv').config();

const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SECRET      = process.env.SURVEY_SECRET || 'change-me-in-production';

if (!WEBHOOK_URL) {
  console.error('ERROR: WEBHOOK_URL environment variable is required');
  console.error('See setup instructions for how to deploy the Google Apps Script');
  process.exit(1);
}

// ─── Token helpers (tamper-prevention) ───────────────────────────────────────

function generateToken(ticketId, email) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${ticketId}:${String(email).toLowerCase()}`)
    .digest('hex')
    .slice(0, 20);
}

function verifyToken(ticketId, email, token) {
  const expected = generateToken(ticketId, email);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(String(token).padEnd(expected.length, '\0').slice(0, expected.length), 'utf8')
    );
  } catch {
    return false;
  }
}

// ─── Webhook helpers ─────────────────────────────────────────────────────────

/**
 * POST to the Google Apps Script webhook
 */
async function sendToWebhook(action, params) {
  try {
    const response = await axios.post(WEBHOOK_URL, null, {
      params: {
        action,
        ...params,
      },
      timeout: 5000,
    });

    if (response.status === 200) {
      return { success: true, data: response.data };
    } else {
      return { success: false, error: `Webhook returned ${response.status}` };
    }
  } catch (error) {
    console.error('[webhook] Error:', error.message);
    return { success: false, error: error.message };
  }
}

// ─── HTML response pages ──────────────────────────────────────────────────────

function renderRatingConfirmation(ticketId, metric, score) {
  const labels = {
    responsiveness:       'Responsiveness',
    communication:        'Communication',
    technical_resolution: 'Technical Resolution',
  };
  const scoreColor = score >= 4 ? '#16a34a' : score === 3 ? '#d97706' : '#dc2626';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Thank you for your feedback</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,Arial,sans-serif;background:#f0f4f8;min-height:100vh;
         display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border-radius:12px;padding:48px 40px;max-width:480px;width:100%;
          text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .score{font-size:56px;font-weight:900;color:${scoreColor};line-height:1}
    .metric{font-size:13px;color:#6b7280;margin:8px 0 20px;font-weight:600;
             text-transform:uppercase;letter-spacing:.06em}
    h1{font-size:22px;color:#111827;margin-bottom:10px}
    p{font-size:14px;color:#4b5563;line-height:1.7}
    .comment-box{margin-top:28px;background:#f8fafc;border:1px solid #e5e7eb;
                  border-radius:8px;padding:20px;text-align:left}
    .comment-box p{font-size:13px;font-weight:600;color:#374151;margin-bottom:10px}
    textarea{width:100%;border:1px solid #d1d5db;border-radius:6px;padding:10px;
              font-size:13px;font-family:inherit;resize:vertical;min-height:80px;
              color:#111827;background:#fff}
    button{margin-top:10px;width:100%;background:#1a56db;color:#fff;border:none;
            border-radius:6px;padding:11px;font-size:14px;font-weight:600;
            cursor:pointer;font-family:inherit}
    button:hover{background:#1e40af}
    .ticket{font-size:12px;color:#9ca3af;margin-top:24px}
  </style>
</head>
<body>
  <div class="card">
    <div class="score">${score}</div>
    <div class="metric">${labels[metric] || metric}</div>
    <h1>Rating received!</h1>
    <p>Thanks for taking the time.<br>
       Your feedback helps us improve IT support for everyone.</p>

    <form class="comment-box" method="POST" action="/comment">
      <input type="hidden" name="ticket" value="${escapeHtml(String(ticketId))}">
      <p>Any additional comments? (optional)</p>
      <textarea name="comment" placeholder="Describe your experience…"></textarea>
      <button type="submit">Submit Comment</button>
    </form>

    <p class="ticket">Ticket #${escapeHtml(String(ticketId))}</p>
  </div>
</body>
</html>`;
}

function renderCommentConfirmation() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Comment received</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,Arial,sans-serif;background:#f0f4f8;min-height:100vh;
         display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border-radius:12px;padding:48px 40px;max-width:480px;width:100%;
          text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .icon{font-size:52px;margin-bottom:16px}
    h1{font-size:22px;color:#111827;margin-bottom:10px}
    p{font-size:14px;color:#4b5563;line-height:1.7}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>All done — thank you!</h1>
    <p>Your comment has been saved alongside your ratings.<br>
       We appreciate you helping us get better.</p>
  </div>
</body>
</html>`;
}

function renderError(message, statusCode) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Error ${statusCode}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,Arial,sans-serif;background:#f0f4f8;min-height:100vh;
         display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border-radius:12px;padding:48px 40px;max-width:480px;width:100%;
          text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .icon{font-size:52px;margin-bottom:16px}
    h1{font-size:20px;color:#111827;margin-bottom:10px}
    p{font-size:14px;color:#6b7280;line-height:1.7}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>Something went wrong</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use((req, res, next) => {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /rate
 * One-click rating handler — sends data to Google Apps Script webhook
 *
 * Query params:
 *   ticket  — Freshservice ticket ID
 *   metric  — responsiveness | communication | technical_resolution
 *   score   — integer 1–5
 *   email   — requester email
 *   agent   — agent name
 *   token   — HMAC token (optional)
 */
app.get('/rate', async (req, res) => {
  const { ticket, metric, score, requester_name, agent, token } = req.query;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!ticket || !metric || !score) {
    return res.status(400).send(renderError('Missing required parameters.', 400));
  }

  const validMetrics = ['responsiveness', 'communication', 'technical_resolution'];
  if (!validMetrics.includes(metric)) {
    return res.status(400).send(renderError('Unknown metric.', 400));
  }

  const scoreNum = parseInt(score, 10);
  if (isNaN(scoreNum) || scoreNum < 1 || scoreNum > 5) {
    return res.status(400).send(renderError('Score must be between 1 and 5.', 400));
  }

  // ── Token verification (uncomment in production) ──────────────────────
  // if (!token || !verifyToken(ticket, email, token)) {
  //   return res.status(403).send(renderError('Invalid or expired link.', 403));
  // }

  try {
    const result = await sendToWebhook('rate', {
      ticket,
      metric,
      score: scoreNum,
      requester_name: requester_name || '',
      agent: agent || '',
    });

    if (result.success) {
      res.send(renderRatingConfirmation(ticket, metric, scoreNum));
    } else {
      console.error('[/rate] Webhook failed:', result.error);
      res.status(500).send(renderError('Could not save your rating. Please try again.', 500));
    }
  } catch (err) {
    console.error('[/rate] Error:', err.message);
    res.status(500).send(renderError('Could not save your rating. Please try again.', 500));
  }
});

/**
 * GET /comment
 * Renders a standalone comment form
 */
app.get('/comment', (req, res) => {
  const { ticket, email } = req.query;
  if (!ticket) return res.status(400).send(renderError('Missing ticket parameter.', 400));

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Add a comment — Ticket #${escapeHtml(String(ticket))}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,Arial,sans-serif;background:#f0f4f8;min-height:100vh;
         display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border-radius:12px;padding:40px;max-width:480px;width:100%;
          box-shadow:0 4px 24px rgba(0,0,0,.08)}
    h1{font-size:20px;color:#111827;margin-bottom:6px}
    .sub{font-size:13px;color:#6b7280;margin-bottom:24px}
    label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}
    textarea{width:100%;border:1px solid #d1d5db;border-radius:6px;padding:12px;
              font-size:14px;font-family:inherit;resize:vertical;min-height:120px;color:#111827}
    button{margin-top:14px;width:100%;background:#1a56db;color:#fff;border:none;
            border-radius:6px;padding:12px;font-size:15px;font-weight:600;
            cursor:pointer;font-family:inherit}
    button:hover{background:#1e40af}
  </style>
</head>
<body>
  <div class="card">
    <h1>Leave a comment</h1>
    <p class="sub">Ticket #${escapeHtml(String(ticket))}</p>
    <form method="POST" action="/comment">
      <input type="hidden" name="ticket" value="${escapeHtml(String(ticket))}">
      <label for="comment">Your feedback</label>
      <textarea id="comment" name="comment" required
                placeholder="Tell us what went well or how we could improve…"></textarea>
      <button type="submit">Submit</button>
    </form>
  </div>
</body>
</html>`);
});

/**
 * POST /comment
 * Saves the comment via webhook
 */
app.post('/comment', async (req, res) => {
  const { ticket, comment } = req.body;

  if (!ticket || !comment || !comment.trim()) {
    return res.status(400).send(renderError('Ticket ID and comment are required.', 400));
  }

  const safeComment = String(comment).trim().slice(0, 2000);

  try {
    const result = await sendToWebhook('comment', {
      ticket,
      comment: safeComment,
    });

    if (result.success) {
      res.send(renderCommentConfirmation());
    } else {
      console.error('[/comment] Webhook failed:', result.error);
      res.status(500).send(renderError('Could not save your comment. Please try again.', 500));
    }
  } catch (err) {
    console.error('[/comment] Error:', err.message);
    res.status(500).send(renderError('Could not save your comment. Please try again.', 500));
  }
});

/**
 * GET /survey
 * Landing page with all rating buttons
 */
app.get('/survey', (req, res) => {
  const { ticket, requester_name, agent } = req.query;
  if (!ticket) return res.status(400).send(renderError('Missing ticket parameter.', 400));

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Rate Your Support Experience</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,Arial,sans-serif;background:#f0f4f8;min-height:100vh;
         display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#fff;border-radius:12px;padding:48px 40px;max-width:600px;width:100%;
          text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    h1{font-size:24px;color:#111827;margin-bottom:10px}
    .subtitle{font-size:14px;color:#6b7280;margin-bottom:28px}
    .metric{margin-bottom:32px;text-align:left}
    .metric-title{font-size:15px;font-weight:bold;color:#111827;margin-bottom:12px}
    .metric-desc{font-size:13px;color:#6b7280;margin-bottom:10px}
    .buttons{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
    a{display:inline-block;width:50px;height:50px;line-height:50px;text-align:center;
      font-size:18px;font-weight:bold;text-decoration:none;border-radius:8px;border:1.5px solid;
      transition:all 0.2s}
    a:hover{transform:scale(1.05)}
    .score-1{background:#fee2e2;color:#b91c1c;border-color:#fca5a5}
    .score-2{background:#ffedd5;color:#c2410c;border-color:#fdba74}
    .score-3{background:#fef9c3;color:#a16207;border-color:#fde047}
    .score-4{background:#dcfce7;color:#15803d;border-color:#86efac}
    .score-5{background:#16a34a;color:#fff;border-color:#15803d}
    .footer{margin-top:32px;font-size:12px;color:#9ca3af}
  </style>
</head>
<body>
  <div class="card">
    <h1>How did we do?</h1>
    <p class="subtitle">Rate your support experience (1 = Poor, 5 = Excellent)</p>

    <div class="metric">
      <div class="metric-title">1. Responsiveness</div>
      <div class="metric-desc">How quickly was your issue resolved?</div>
      <div class="buttons">
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=responsiveness&score=1&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-1">1</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=responsiveness&score=2&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-2">2</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=responsiveness&score=3&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-3">3</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=responsiveness&score=4&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-4">4</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=responsiveness&score=5&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-5">5</a>
      </div>
    </div>

    <div class="metric">
      <div class="metric-title">2. Communication</div>
      <div class="metric-desc">Were updates clear and professional?</div>
      <div class="buttons">
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=communication&score=1&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-1">1</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=communication&score=2&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-2">2</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=communication&score=3&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-3">3</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=communication&score=4&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-4">4</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=communication&score=5&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-5">5</a>
      </div>
    </div>

    <div class="metric">
      <div class="metric-title">3. Technical Resolution</div>
      <div class="metric-desc">Was your issue fully resolved?</div>
      <div class="buttons">
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=technical_resolution&score=1&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-1">1</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=technical_resolution&score=2&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-2">2</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=technical_resolution&score=3&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-3">3</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=technical_resolution&score=4&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-4">4</a>
        <a href="/rate?ticket=${escapeHtml(String(ticket))}&metric=technical_resolution&score=5&requester_name=${escapeHtml(String(requester_name || ''))}&agent=${escapeHtml(String(agent || ''))}" class="score-5">5</a>
      </div>
    </div>

    <p class="footer">Ticket #${escapeHtml(String(ticket))}</p>
  </div>
</body>
</html>`);
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Survey server listening on port ${PORT}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
});

module.exports = app;
