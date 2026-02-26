// casty 設定
// ~/.casty/config.json でカスタマイズ可能 (なければデフォルト)

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const configPath = join(homedir(), '.casty', 'config.json');

const DEFAULTS = {
  homeUrl: 'https://github.com/sanohiro/casty',
  searchUrl: 'https://search.brave.com/search?q=',
  transport: 'auto', // 'auto' | 'file' | 'inline'
  format: 'auto',    // 'auto' | 'png' | 'jpeg'
};

let _cache = null;

export function loadConfig() {
  if (_cache) return _cache;
  try {
    const data = JSON.parse(readFileSync(configPath, 'utf8'));
    _cache = { ...DEFAULTS, ...data };
  } catch {
    _cache = { ...DEFAULTS };
  }
  return _cache;
}
