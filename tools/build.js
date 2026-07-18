#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, 'dist');
mkdirSync(distDir, { recursive: true });

const flymasterSource = readFileSync(join(root, 'src', 'flymaster-my-location.js'), 'utf8');
const flymasterLiteSource = readFileSync(join(root, 'src', 'bookmarklet-lite.js'), 'utf8');
const garminSource = readFileSync(join(root, 'src', 'garmin-mapshare-overlay.js'), 'utf8');

function compactForBookmarklet(source) {
  return source
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\n\s+/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}

function writeBookmarklet(file, source) {
  const bookmarklet = `javascript:${encodeURIComponent(compactForBookmarklet(source))}`;
  writeFileSync(join(distDir, file), bookmarklet + '\n');
  return bookmarklet.length;
}

function writeUserscript(file, meta, source) {
  writeFileSync(join(distDir, file), `${meta}\n\n${source}\n`);
}

writeUserscript('flymaster-my-location.user.js', `// ==UserScript==
// @name         Flymaster My Location
// @namespace    https://lt.flymaster.net/
// @version      0.1.0
// @description  Add your own live GPS marker, accuracy circle, heading, and breadcrumb trail to Flymaster Live Tracking.
// @match        https://lt.flymaster.net/bs.php*
// @match        https://lt.flymaster.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==`, flymasterSource);

const flymasterBookmarkletLen = writeBookmarklet('bookmarklet.txt', flymasterSource);
const flymasterLiteBookmarkletLen = writeBookmarklet('bookmarklet-lite.txt', flymasterLiteSource);
writeFileSync(join(distDir, 'console-paste.js'), `window.FM_MY_LOCATION_CONFIG = Object.assign({ mock: false }, window.FM_MY_LOCATION_CONFIG || {});\n${flymasterSource}`);

writeUserscript('garmin-mapshare.user.js', `// ==UserScript==
// @name         MapShare Companion
// @namespace    https://share.garmin.com/
// @version      0.1.0
// @description  Clean Garmin MapShare overlay with racer location, phone location, distance, and bearing.
// @match        https://share.garmin.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==`, garminSource);

const garminBookmarkletLen = writeBookmarklet('garmin-bookmarklet.txt', garminSource);
writeFileSync(join(distDir, 'garmin-console-paste.js'), `window.GARMIN_TRACKER_CONFIG = Object.assign({}, window.GARMIN_TRACKER_CONFIG || {});\n${garminSource}`);
writeFileSync(join(distDir, 'garmin-mapshare-overlay.gist.js'), garminSource);

const gistRawUrl = process.env.GARMIN_GIST_RAW_URL || 'PASTE_RAW_GIST_URL_HERE';
const gistLoaderSource = `(()=>{const u=${JSON.stringify(gistRawUrl)};if(!u||u==='PASTE_RAW_GIST_URL_HERE'){alert('MapShare Companion: set the raw gist URL in this bookmarklet first.');return;}fetch(u+(u.includes('?')?'&':'?')+'_grt='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.text()}).then(code=>(0,eval)(code)).catch(e=>alert('MapShare Companion loader failed: '+(e&&e.message||e)));})();`;
const gistLoaderBookmarklet = `javascript:${encodeURIComponent(gistLoaderSource)}`;
writeFileSync(join(distDir, 'garmin-gist-loader-bookmarklet.txt'), gistLoaderBookmarklet + '\n');
writeFileSync(join(distDir, 'garmin-gist-loader-source.js'), gistLoaderSource + '\n');

console.log('Wrote:');
console.log('  dist/garmin-mapshare.user.js');
console.log(`  dist/garmin-bookmarklet.txt (${garminBookmarkletLen} chars)`);
console.log('  dist/garmin-console-paste.js');
console.log('  dist/garmin-mapshare-overlay.gist.js');
console.log(`  dist/garmin-gist-loader-bookmarklet.txt (${gistLoaderBookmarklet.length} chars)`);
console.log('  dist/flymaster-my-location.user.js');
console.log(`  dist/bookmarklet.txt (${flymasterBookmarkletLen} chars)`);
console.log(`  dist/bookmarklet-lite.txt (${flymasterLiteBookmarkletLen} chars)`);
console.log('  dist/console-paste.js');
