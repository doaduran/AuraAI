const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWardrobeStorage } = require('../wardrobeStorageCore.js');
const { fitPhoto, createPhotoQueue } = require('../prepareWardrobePhoto.js');

test('phone photos shrink to at most 1024 pixels without stretching or upscaling', () => {
  assert.deepEqual(fitPhoto(4032, 3024), { width: 1024, height: 768 });
  assert.deepEqual(fitPhoto(600, 800), { width: 600, height: 800 });
  assert.deepEqual(fitPhoto(3000, 6000), { width: 512, height: 1024 });
  assert.throws(() => fitPhoto(0, 12));
});

test('additional photos join a running queue without parallel background-removal requests', async () => {
  const starts = [], counts = [], releases = [];
  const queue = createPhotoQueue(photo => { starts.push(photo); return new Promise(resolve => releases.push(resolve)); }, n => counts.push(n));
  queue.add(['one', 'two']);
  queue.add(['three']);
  assert.deepEqual(starts, ['one']);
  assert.equal(queue.count, 3);
  releases.shift()(); await new Promise(setImmediate);
  assert.deepEqual(starts, ['one', 'two']);
  releases.shift()(); await new Promise(setImmediate);
  assert.deepEqual(starts, ['one', 'two', 'three']);
  releases.shift()(); await new Promise(setImmediate);
  assert.equal(queue.count, 0);
  assert.equal(counts.at(-1), 0);
});

function storageFixture({ failWrite = false } = {}) {
  const events = [], values = new Map();
  let old = '[{"id":"existing","uri":"data:image/png;base64,photo"}]';
  const storage = createWardrobeStorage({
    getItem: async () => old,
    removeItem: async () => { events.push('remove-old'); old = null; },
  }, {
    get: async key => values.get(key),
    set: async (key, value) => { events.push('write-new'); if (failWrite) throw new Error('Disk full'); values.set(key, value); },
  });
  return { storage, events, values, old: () => old };
}

test('existing wardrobe migrates before the old copy is removed', async () => {
  const f = storageFixture();
  const previous = f.old();
  assert.equal(await f.storage.getItem(), previous);
  assert.deepEqual(f.events, ['write-new', 'remove-old']);
  assert.equal(f.old(), null);
  assert.equal(await f.storage.getItem(), previous);
});

test('failed migration preserves existing photos', async () => {
  const f = storageFixture({ failWrite: true });
  await assert.rejects(f.storage.getItem(), /Disk full/);
  assert.ok(f.old());
  assert.deepEqual(f.events, ['write-new']);
});

test('snapshots save in order and a failed save can be retried', async () => {
  const calls = [], release = [];
  const storage = createWardrobeStorage({}, { set: async (key, value) => {
    calls.push(value);
    if (value === 'broken') throw new Error('Quota');
    await new Promise(resolve => release.push(resolve));
  } });
  const one = storage.setItem('one');
  const two = storage.setItem('two');
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['one']);
  release.shift()(); await one; await new Promise(setImmediate);
  assert.deepEqual(calls, ['one', 'two']);
  release.shift()(); await two;
  await assert.rejects(storage.setItem('broken'), /Quota/);
  const retry = storage.setItem('retry'); await new Promise(setImmediate);
  release.shift()(); await retry;
  assert.equal(calls.at(-1), 'retry');
});
