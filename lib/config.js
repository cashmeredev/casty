// Configuration
// Customizable via ~/.casty/config.json (falls back to defaults)

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Safely load and parse a JSON file (returns fallback on parse error or missing file)
export function loadJsonFile(filePath, fallback) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

const configPath = join(homedir(), '.casty', 'config.json');

// Detect system locale (e.g. "en-US", "ja", "zh-CN")
function detectLocale() {
  // Intl API gives the most reliable result
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) return locale;
  } catch {}
  // Fallback to environment variables
  const env = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';
  const m = env.match(/^([a-z]{2}(?:[_-][A-Z]{2})?)/);
  return m ? m[1].replace('_', '-') : 'en-US';
}

const DEFAULTS = {
  homeUrl: 'https://github.com/sanohiro/casty',
  searchUrl: 'https://www.google.com/search?q=',
  transport: 'auto', // 'auto' | 'file' | 'inline'
  format: 'auto',    // 'auto' | 'png' | 'jpeg'
  language: detectLocale(), // System locale (override: "en-US", "ja", etc.)
};

let _cache = null;

export function loadConfig() {
  if (_cache) return _cache;
  _cache = { ...DEFAULTS, ...loadJsonFile(configPath, {}) };
  return _cache;
}
