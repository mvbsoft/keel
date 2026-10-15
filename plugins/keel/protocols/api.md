# Protocol: API changes

Topic of the `data` specialist group. Question: will existing clients break, and is every new input
checked at the boundary?

## Checklist
**Compatibility for existing clients**
1. A response field, parameter, header, path, enum value or endpoint removed or renamed (a rename is a
   removal plus an addition).
2. A field type changed, even to a "compatible" one (int → string, scalar → object): generated
   clients break.
3. A request parameter or body field newly required, or an optional one made required.
4. A default changed (page size, sort order, filters, flags).
5. A success status code changed (200 → 201/204), or what triggers an existing error code changed.
6. Validation tightened on input older clients send (shorter maximum, stricter pattern, narrower enum).
7. Paging added to a previously unpaged list, or the page cap lowered.
8. An enum value added to a response where a client switches exhaustively: look for such a client in
   the repository (generated types, `switch` without a default) before claiming impact.
9. The same schema with different behavior: sort order, which records return, soft-deleted
   visibility, units, id format, rounding.
10. GraphQL or protobuf: field removed, type narrowed, non-null argument added, field number reused.
11. If the project versions its API, is the breaking change behind a new version or a compatibility
    shim? Never fault the versioning scheme itself.

**Boundary hygiene**
12. Every new input validated at the boundary: type, required, range, length, array size, enum, and a
    server-side maximum page size.
13. Mass assignment: can a client set fields it should not (`role`, `owner_id`, `price`) through
    automatic binding? Does a generic serializer expose internal fields?
14. Errors keep one shape and stable machine codes; no stack traces or SQL in responses; an error
    code's meaning not changed.
15. Status codes follow the project's convention (400 vs 422, 401 vs 403, 404 vs 403); permission is
    checked before existence is revealed.
16. New or changed lists: a stable order with a unique tie-breaker, a hard maximum `limit`, no next
    link on the last page, an index behind the cursor.
17. Retried requests: does a POST that creates, charges, sends or enqueues have an idempotency key, a
    unique constraint or an upsert, when the code shows a retry source (client retries, at-least-once
    queues, webhook redelivery)?
18. PUT replaces, DELETE repeated ends in the same state, PATCH does not reset omitted fields.
19. The OpenAPI, proto or GraphQL schema (and generated clients) updated with the handler, including
    new error responses.
20. Something deprecated with a path to removal rather than removed in one step.

## Evidence
- Old and new contract side by side at `file:line` (old handler or spec vs new).
- A consumer that breaks, strongest first: a client in this repository that reads the field or sends
  the old shape; a published spec, SDK or docs page; a public route prefix (`/api/v1`, `/public`);
  mobile apps. Consumers updated in the same change → not a finding. No consumer evidence →
  "consumers unknown" and at most important.
- The failing request: example request with old and new response.
- Validation findings: an input that gets through and what it causes (500, memory, privilege change).
- Idempotency findings: the retry source in the code plus the side effect that repeats.

## Do not flag
- New optional response fields, optional parameters, new endpoints or event types.
- Internal endpoints when the code shows they are internal (only called from code changed in the
  same change, internal prefix, no public spec).
- Changed error message text when the machine code is unchanged.
- A new error code for a new feature (minor at most).
- Opaque id length or format changes the docs never promised.
- Versioning or pagination style opinions on endpoints the change does not touch.
- Endpoints introduced in this same change, or marked beta.
- Missing idempotency on naturally idempotent operations or without a retry path.

## Severity
- **critical**: removal, rename or type change in a proven public contract with known consumers;
  mass assignment that escalates privileges; an error-shape change that breaks every client's
  handling; a non-idempotent money or inventory operation on a demonstrated retry path.
- **important**: a new required field on an existing endpoint; a default or status-code change with
  plausible consumers; tightened validation; no maximum page size or length on public input; a changed
  error code; paging added to a list.
- **minor**: spec not updated (when not generated), inconsistent error shape on a new endpoint,
  missing deprecation marker.
