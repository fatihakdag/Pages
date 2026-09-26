// The ▼ at the foot of a dialog with more below than fits: phones hide their
// scrollbars until you scroll, so a cut-off panel needs to say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.mjs';

/** Give a panel the measurements a browser would: content, window, scroll. */
function measure(panel, { content, window, scrolled = 0 }) {
  panel.scrollHeight = content;
  panel.clientHeight = window;
  panel.scrollTop = scrolled;
}

test('a panel taller than the screen shows ▼ until scrolled to the end', () => {
  const h = load();
  const panel = h.el('settings-panel');
  measure(panel, { content: 760, window: 540 });
  h.g.el.settingsBtn.dispatch('click');
  assert.ok(panel.classList.contains('more'), 'more below');

  panel.scrollTop = 120;
  panel.dispatch('scroll');
  assert.ok(panel.classList.contains('more'), 'still more');

  panel.scrollTop = 220;   // the end
  panel.dispatch('scroll');
  assert.ok(!panel.classList.contains('more'), 'nothing left below');
});

test('a panel that fits never shows it', () => {
  const h = load();
  const panel = h.el('settings-panel');
  measure(panel, { content: 440, window: 440 });
  h.g.el.settingsBtn.dispatch('click');
  assert.ok(!panel.classList.contains('more'));
});

test('closing the dialog takes it away, and so does a panel that is not open', () => {
  const h = load();
  const settings = h.el('settings-panel'), online = h.el('online-panel');
  measure(settings, { content: 760, window: 540 });
  measure(online, { content: 760, window: 540 });
  h.g.el.settingsBtn.dispatch('click');
  assert.ok(settings.classList.contains('more'));
  assert.ok(!online.classList.contains('more'), 'only the open one');
  h.g.closeDialog();
  assert.ok(!settings.classList.contains('more'));
});

test('the online dialog too, and rechecked when what it shows changes', () => {
  const h = load();
  const panel = h.el('online-panel');
  measure(panel, { content: 400, window: 400 });
  h.g.openOnline();
  assert.ok(!panel.classList.contains('more'), 'the way in fits');
  measure(panel, { content: 520, window: 400 });   // a long player list, say
  h.g.refreshOnlineDialog();
  assert.ok(panel.classList.contains('more'));
});

test('a resize can bring it or take it away', () => {
  const h = load();
  const panel = h.el('settings-panel');
  measure(panel, { content: 600, window: 600 });
  h.g.el.settingsBtn.dispatch('click');
  assert.ok(!panel.classList.contains('more'));
  measure(panel, { content: 600, window: 380 });    // turned to landscape
  h.g.refreshMoreHint();
  assert.ok(panel.classList.contains('more'));
});
