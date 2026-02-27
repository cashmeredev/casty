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

const DEFAULTS = {
  homeUrl: 'https://github.com/sanohiro/casty',
  searchUrl: 'https://www.google.com/search?q=',
  transport: 'auto', // 'auto' | 'file' | 'inline'
  format: 'auto',    // 'auto' | 'png' | 'jpeg'
};

let _cache = null;

export function loadConfig() {
  if (_cache) return _cache;
  _cache = { ...DEFAULTS, ...loadJsonFile(configPath, {}) };
  return _cache;
}
