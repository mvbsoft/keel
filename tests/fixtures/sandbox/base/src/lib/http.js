'use strict';
const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function sendJson(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, text ? { 'content-type': 'application/json; charset=utf-8' } : {});
  res.end(text);
}

// Reads a JSON object body; larger than MAX_BODY → 413, not an object → 400.
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'body is not valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'body must be a JSON object');
  return body;
}

// An integer query parameter within [min, max]; missing → fallback.
function intParam(url, name, { min, max, fallback }) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be an integer from ${min} to ${max}`);
  return n;
}

module.exports = { HttpError, sendJson, readJson, intParam, MAX_BODY };
