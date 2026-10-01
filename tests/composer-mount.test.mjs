import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../ui/composer-hud.js', import.meta.url), 'utf8');
// Exercise the production mount against the native footer's changing container layout.
const mountSource = source.slice(source.indexOf('  function mount() {'), source.indexOf('  const observer ='));
const footerSelector = '[data-composer-footer-responsive]';
class Node {
  constructor(kind) { this.kind = kind; this.children = []; }
  prepend(node) { node.remove(); this.children.unshift(node); node.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
  get isConnected() { return this.kind === 'document' || Boolean(this.parentElement?.isConnected); }
  getAttribute(name) { return name === 'data-codex-composer' && this.kind === 'editor' && !this.chat ? 'true' : null; }
  getBoundingClientRect() { return {width: 500, height: 28}; }
  closest(selector) { if (selector === footerSelector && this.kind === 'footer' || selector === '[data-codex-composer-root]' && this.codexRoot) return this; return this.parentElement?.closest(selector) || null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelector(selector) {
    return this.children.find(node => selector === ':scope > .flex' ? node.kind === 'row' : selector === ':scope > .flex-1' && node.kind === 'toolbar') || null;
  }
  querySelectorAll() { return this.children.flatMap(node => [...(node.kind === 'host' ? [node] : []), ...node.querySelectorAll()]); }
}
function fixture(count = 1) {
  const document = new Node('document'), hosts = new Map(), editors = [], layouts = [];
  for (let i = 0; i < count; i++) {
    const footer = new Node('footer'), editor = new Node('editor'), cell = new Node('cell'), row = new Node('row'), toolbar = new Node('toolbar');
    document.prepend(footer); footer.prepend(cell); footer.prepend(editor); cell.prepend(row);
    editors.push(editor); layouts.push({footer, row, toolbar, editor});
  }
  document.querySelectorAll = () => editors;
  const makeHost = toolbar => {
    const host = new Node('host'); toolbar.prepend(host);
    const item = {host, folds: new Map(), resizeObserver: {disconnect() {item.disconnected = true;}}};
    hosts.set(host, item); return item;
  };
  const context = vm.createContext({document, hosts, disposed: false, primary: null, selected: null, key: () => '', active: () => null, select() {}, render() {}, close() {}, makeHost});
  vm.runInContext(mountSource, context);
  return {mount: () => vm.runInContext('mount()', context), hosts, layouts, makeHost};
}

test('one footer keeps the same HUD when model controls appear and disappear', () => {
  const f = fixture(), {footer, row, toolbar} = f.layouts[0];
  f.mount(); const [host, item] = [...f.hosts][0]; item.folds.set('tokens', true);
  row.prepend(toolbar); f.mount(); f.mount();
  assert.equal(f.hosts.size, 1); assert.equal(host.parentElement, toolbar);
  assert.equal(footer.querySelectorAll().length, 1); assert.equal(item.folds.get('tokens'), true);
  toolbar.kind = 'container'; f.mount();
  assert.equal(f.hosts.size, 1); assert.equal(host.parentElement, row);
});

test('a footer repairs duplicates left in nested action containers', () => {
  const f = fixture(), {footer, row, toolbar} = f.layouts[0]; row.prepend(toolbar);
  const retained = f.makeHost(row), duplicate = f.makeHost(toolbar);
  f.mount();
  assert.equal(f.hosts.size, 1); assert.equal(footer.querySelectorAll().length, 1);
  assert.equal(retained.host.parentElement, toolbar); assert.equal(duplicate.disconnected, true);
});

test('separate composers each retain their own HUD', () => {
  const f = fixture(2); f.mount();
  for (const {row, toolbar} of f.layouts) row.prepend(toolbar);
  f.mount();
  assert.equal(f.hosts.size, 2);
  for (const {footer, toolbar} of f.layouts) {
    assert.equal(footer.querySelectorAll().length, 1);
    assert.equal(footer.querySelectorAll()[0].parentElement, toolbar);
  }
});

test('a shared Chat composer never receives a Codex HUD', () => {
  const f = fixture(); f.layouts[0].editor.chat = true; f.mount();
  assert.equal(f.hosts.size, 0);
});

test('switching from Codex to Chat removes the retained HUD', () => {
  const f = fixture(); f.mount(); const item = [...f.hosts.values()][0];
  f.layouts[0].editor.chat = true; f.mount();
  assert.equal(f.hosts.size, 0); assert.equal(item.host.isConnected, false);
  assert.equal(item.disconnected, true);
});

test('a Codex root still identifies a compact editor without its native marker', () => {
  const f = fixture(); const {editor, footer} = f.layouts[0];
  editor.chat = true; footer.codexRoot = true; f.mount();
  assert.equal(f.hosts.size, 1);
});
