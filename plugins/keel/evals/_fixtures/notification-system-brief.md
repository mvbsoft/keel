## Goal
Customers get an e-mail when their order is paid or shipped, and can turn these e-mails off; staff
see new orders on the staff page without reloading it.

## Files
- src/payment.js:4 charge() returns status paid: where the "paid" e-mail starts
- Nothing in src/ sends e-mail or tracks shipping; src/auth.js:3 only keeps a reset token against an e-mail address

## Decisions and why
- Mail goes through the company's SMTP server - no new mail service account
- Texts in English only - the shop has no other language

## Open questions
- How do staff see new orders: a browser push or a counter on the staff page? - the staff part and its tickets depend on it
