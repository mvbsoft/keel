'use strict';
// Task ids and session ids: keel builds folder and file names from them, so both are checked here.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
// Windows cannot create these names (with any extension) and drops a trailing dot; `git add -A`
// would then fail for the whole repository.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const validId = (id) => typeof id === 'string' && TASK_ID.test(id) && !id.includes('..') && !RESERVED.test(id) && !id.endsWith('.');
const validSid = (sid) => typeof sid === 'string' && SESSION_ID.test(sid);

module.exports = { validId, validSid };
