// ブックマーク機能
// ~/.casty/bookmarks.json を参照し、/b でアドレスバーから検索

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const bookmarkPath = join(homedir(), '.casty', 'bookmarks.json');

// ブックマークを読み込み ({ name: url } の配列に正規化)
export function loadBookmarks() {
  try {
    const data = JSON.parse(readFileSync(bookmarkPath, 'utf8'));
    // { "名前": "URL", ... } 形式
    if (!Array.isArray(data) && typeof data === 'object') {
      return Object.entries(data).map(([name, url]) => ({ name, url }));
    }
    // [{ name, url }, ...] 形式
    if (Array.isArray(data)) {
      return data.filter(e => e.name && e.url);
    }
    return [];
  } catch {
    return [];
  }
}

// クエリでブックマークを検索 (名前・URL の部分一致、大文字小文字無視)
export function searchBookmarks(query) {
  const bookmarks = loadBookmarks();
  if (!query) return bookmarks;
  const q = query.toLowerCase();
  return bookmarks.filter(b =>
    b.name.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
  );
}
