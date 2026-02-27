// Vimium-style hint mode
// Alt+F shows labels on clickable/focusable elements, select by typing the label

const HINT_CHARS = ['a', 's', 'd', 'f', 'j', 'k', 'l'];
const MAX_HINTS = HINT_CHARS.length * HINT_CHARS.length; // 49

// Collect elements + generate labels + inject overlay in a single evaluate call
function makeCollectAndOverlayScript(hintChars, maxHints) {
  return `(() => {
  try {
    const old = document.getElementById('__casty_hints');
    if (old) old.remove();

    const CLICKABLE = 'a, button, [role="button"], [onclick], summary, [role="link"], [role="tab"], [tabindex]';
    const FOCUSABLE = 'input, textarea, select, [contenteditable]';
    const all = document.querySelectorAll(CLICKABLE + ', ' + FOCUSABLE);

    const elems = [];
    for (const el of all) {
      if (elems.length >= ${maxHints}) break;
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (rect.right < 0 || rect.left > window.innerWidth) continue;

      const isFocusable = el.matches('input, textarea, select, [contenteditable]');
      elems.push({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        cx: Math.round(rect.left + rect.width / 2),
        cy: Math.round(rect.top + rect.height / 2),
        type: isFocusable ? 'focus' : 'click',
      });
    }

    if (elems.length === 0) return JSON.stringify([]);

    // Generate labels
    const chars = ${JSON.stringify(hintChars)};
    const labels = [];
    if (elems.length <= chars.length) {
      for (let i = 0; i < elems.length; i++) labels.push(chars[i]);
    } else {
      for (const c1 of chars) {
        for (const c2 of chars) {
          labels.push(c1 + c2);
          if (labels.length >= elems.length) break;
        }
        if (labels.length >= elems.length) break;
      }
    }

    // Inject overlay
    const container = document.createElement('div');
    container.id = '__casty_hints';
    container.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    for (let i = 0; i < elems.length; i++) {
      const h = elems[i];
      h.label = labels[i];
      const span = document.createElement('span');
      span.textContent = labels[i].toUpperCase();
      span.dataset.label = labels[i];
      span.style.cssText = 'position:fixed;background:#FFEE00;color:#000;font:bold 12px monospace;border:1px solid #C38A00;border-radius:3px;padding:0 2px;z-index:2147483647;pointer-events:none;line-height:1.4;'
        + 'left:' + h.x + 'px;top:' + h.y + 'px;';
      container.appendChild(span);
    }
    document.documentElement.appendChild(container);

    return JSON.stringify(elems);
  } catch (e) {
    return JSON.stringify([]);
  }
})()`;
}

const COLLECT_OVERLAY_SCRIPT = makeCollectAndOverlayScript(HINT_CHARS, MAX_HINTS);

// Dim non-matching labels
function makeDimScript(buffer) {
  return `(() => {
    const c = document.getElementById('__casty_hints');
    if (!c) return;
    for (const span of c.children) {
      const label = span.dataset.label;
      span.style.opacity = label.startsWith('${buffer}') ? '1' : '0.2';
    }
  })()`;
}

// Remove overlay script
const REMOVE_OVERLAY_SCRIPT = `(() => {
  const el = document.getElementById('__casty_hints');
  if (el) el.remove();
})()`;

export class HintMode {
  constructor(forceCapture) {
    this.active = false;
    this.buffer = '';
    this._resolve = null;
    this._client = null;
    this._hints = [];
    this._rawForceCapture = forceCapture || (() => {});
  }

  // Ensure frame capture after DOM changes (immediate + delayed retry)
  _forceCapture() {
    this._rawForceCapture();
    setTimeout(() => this._rawForceCapture(), 200);
  }

  // Start hint mode — waits until user selects or cancels
  async start(client) {
    this._client = client;
    this.buffer = '';

    // Single evaluate: collect elements + generate labels + inject overlay
    let hints;
    try {
      const { result } = await client.send('Runtime.evaluate', {
        expression: COLLECT_OVERLAY_SCRIPT,
      });
      hints = JSON.parse(result.value);
    } catch (e) {
      console.error(`casty: hints failed: ${e.message}`);
      return;
    }

    if (!hints || hints.length === 0) {
      console.error('casty: hints: no elements found');
      return;
    }

    console.error(`casty: hints: ${hints.length} elements`);
    this._hints = hints;
    this.active = true;
    this._forceCapture();

    const { promise, resolve } = Promise.withResolvers();
    this._resolve = resolve;
    return promise;
  }

  // Handle input (only called while active)
  async handleInput(str) {
    if (!this.active) return false;

    // Escape → cancel
    if (str === '\x1b') {
      await this._cancel();
      return true;
    }

    // Backspace → remove last buffer char
    if (str === '\x7f' || str === '\x08') {
      if (this.buffer.length > 0) {
        this.buffer = this.buffer.slice(0, -1);
        await this._updateDim();
      }
      return true;
    }

    // Ignore non-hint characters
    const ch = str.toLowerCase();
    if (ch.length !== 1 || !HINT_CHARS.includes(ch)) {
      return true;
    }

    this.buffer += ch;

    // Exact match check
    const exact = this._hints.find(h => h.label === this.buffer);
    if (exact) {
      await this._selectHint(exact);
      return true;
    }

    // Prefix match check
    const partial = this._hints.some(h => h.label.startsWith(this.buffer));
    if (!partial) {
      this.buffer = '';
      await this._updateDim();
      return true;
    }

    // Partial match — dim non-matching labels
    await this._updateDim();
    return true;
  }

  async _updateDim() {
    try {
      await this._client.send('Runtime.evaluate', {
        expression: this.buffer ? makeDimScript(this.buffer) : makeDimScript(''),
      });
      this._forceCapture();
    } catch {}
  }

  async _selectHint(hint) {
    await this._removeOverlay();

    if (hint.type === 'focus') {
      try {
        await this._client.send('Runtime.evaluate', {
          expression: `(() => {
            const all = document.querySelectorAll('input, textarea, select, [contenteditable]');
            for (const el of all) {
              const r = el.getBoundingClientRect();
              if (Math.round(r.left + r.width/2) === ${hint.cx} && Math.round(r.top + r.height/2) === ${hint.cy}) {
                el.focus();
                el.click();
                break;
              }
            }
          })()`,
        });
      } catch {}
    } else {
      try {
        await this._client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: hint.cx, y: hint.cy, button: 'left', clickCount: 1,
        });
        await this._client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: hint.cx, y: hint.cy, button: 'left',
        });
      } catch {}
    }

    this._done();
    this._forceCapture();
  }

  async _cancel() {
    await this._removeOverlay();
    this._done();
    this._forceCapture();
  }

  _done() {
    this.active = false;
    this.buffer = '';
    this._hints = [];
    if (this._resolve) { this._resolve(); this._resolve = null; }
  }

  async _removeOverlay() {
    try {
      await this._client.send('Runtime.evaluate', {
        expression: REMOVE_OVERLAY_SCRIPT,
      });
    } catch {}
  }
}
