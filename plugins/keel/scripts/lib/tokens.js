'use strict';
// The token kinds of a usage record in the price table's terms (lib/prices.js costOf): one response's
// `usage` from a transcript, or a ledger line's summed usage (1-hour cache writes in
// cache_creation_1h_input_tokens). The 5-minute cache writes are their own field when the transcript has
// it, else what is left of all cache writes after the 1-hour ones.
function tokensOf(usage) {
  const u = usage || {};
  const cc = u.cache_creation || {};
  const cw1h = cc.ephemeral_1h_input_tokens || u.cache_creation_1h_input_tokens || 0;
  const cw5 = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : Math.max(0, (u.cache_creation_input_tokens || 0) - cw1h);
  return { in: u.input_tokens || 0, cw5, cw1h, cr: u.cache_read_input_tokens || 0, out: u.output_tokens || 0 };
}

module.exports = { tokensOf };
