# Protocol: security

Topic of the `security` specialist group (with business rules). Question: can an attacker use this
change to read, change or run something they should not?

## Method
1. **Context first.** Find the project's existing security mechanisms: authentication middleware,
   authorization checks or policies, input validation and sanitization helpers, ORM or query builder,
   templating auto-escape, CSRF protection, secret handling. Note how the project normally does it.
2. **Compare.** Does the new code use those mechanisms the way the rest of the project does? A new
   route without the middleware its siblings have, raw SQL where the project uses the query builder,
   a template marked safe: inconsistencies are where vulnerabilities hide.
3. **Trace source to sink.** For each new or changed input (HTTP parameters, body, headers, cookies,
   files, webhooks, queue messages, data read back from storage that a user wrote), follow it to
   dangerous operations: SQL or NoSQL queries, shell and process calls, file paths, HTML output,
   redirects, outbound requests (host or scheme control), deserialization, template evaluation,
   permission decisions, crypto. Check every hop for validation, encoding or authorization.
4. **Privilege boundaries.** Who may call this? Is ownership checked on every object accessed by id
   (no access to another user's record by changing an id)? Are admin-only paths guarded on the server?

## What to look for
- Injection: SQL, NoSQL, OS command, LDAP, template, header; path traversal; XXE.
- Broken access control: missing authentication or authorization, missing ownership checks (IDOR),
  privilege escalation, mass assignment of role or owner fields.
- XSS where unsafe output APIs are used (`innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `|safe`,
  `raw()`); framework auto-escaping otherwise holds.
- SSRF where the attacker controls the host or scheme of an outbound request.
- Unsafe deserialization (`pickle`, `unserialize`, unsafe YAML loading, Java serialization).
- Authentication flaws: weak session handling, token validation skipped, password reset or login
  flows that can be bypassed, insecure comparison of secrets, JWT `none` or unchecked signatures.
- Cryptography misuse: hard-coded keys, weak algorithms for passwords (fast hashes such as MD5, SHA-1
  without a password KDF), predictable randomness for tokens (`Math.random`).
- Secrets: credentials committed in code or config; high-value secrets, passwords or personal data
  written to logs.

## Evidence (all required)
- The source (`file:line`) and the sink (`file:line`), and every hop between them you checked.
- An **attack scenario**: who the attacker is (anonymous, logged-in user, other tenant), the exact
  request or input, and what they gain.
- Why existing protection does not stop it (you looked for the middleware, validator or escape and
  name what is missing).
- Report only what you believe is exploitable with high confidence (more than 80 %). A suspicious
  pattern that needs unlikely conditions is not a finding.

## Do not treat as a security finding
Covered by another keel topic instead:
- Denial of service, resource exhaustion, rate limiting, memory or CPU use → performance protocol.
- Vulnerable or outdated third-party libraries → dependencies protocol.
- CI workflow input handling → infrastructure protocol (only with a concrete untrusted-input path).
- Concrete races on money or state → business-rules protocol.
Not findings at all:
- Missing hardening without a concrete vulnerability (headers, extra checks "just in case").
- Theoretical races or timing attacks without a practical path.
- Memory-safety issues in memory-safe languages.
- Code used only by tests.
- Log spoofing from user input; logging URLs or non-personal data.
- SSRF that controls only the path.
- Regex injection or regex denial of service.
- User content in AI prompts.
- Insecure examples in documentation.
- Missing audit logs.
- Attacks that require controlling environment variables or command-line flags (trusted).
- Guessing UUIDs.
- Missing authorization in client-side code when the server checks it.
- Command injection in shell scripts without a specific untrusted input reaching them.

## Severity
- **critical**: directly exploitable remote code execution, data breach, authentication or
  authorization bypass, privilege escalation, a committed live secret.
- **important**: exploitable under specific but realistic conditions with significant impact (e.g. an
  IDOR on non-sensitive data, stored XSS behind a login).
- **minor**: defense in depth with a concrete but low-impact case.

## Principles
- Learn the repository's context, compare with its existing patterns, then trace each source to
  its sink.
- Every finding needs an exploit scenario and more than 80 % confidence, and passes its own
  false-positive check.
- Verifiers default to refuting, never invent a mitigation, and weigh reachability, impact and
  defenses.
- Classify changes by risk, not by size. Severity is likelihood times impact.
