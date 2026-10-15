'use strict';
// Text and JSON from files a user may edit. Editors on Windows and Windows PowerShell 5.1 save UTF-8
// with a byte order mark, which hides front matter and which JSON.parse rejects, so a leading one is
// dropped. parseJson and readJsonFile throw like JSON.parse; callers decide the fallback.
const fs = require('node:fs');

const noBom = (text) => (typeof text === 'string' ? text.replace(/^﻿/, '') : text);
const parseJson = (text) => JSON.parse(noBom(String(text)));
const readJsonFile = (file) => parseJson(fs.readFileSync(file, 'utf8'));

module.exports = { noBom, parseJson, readJsonFile };
