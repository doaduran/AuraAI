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

function photoProcessor(reply, background = async () => null) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  const code = source.slice(source.indexOf('const processAndAnalyzeImage ='), source.indexOf('  photoProcessor.current ='));
  const state = { wardrobe: [], failed: [] };
  const context = {
    lang: 'tr', Platform: { OS: 'web' }, Date, console: { log() {} },
    setLoading: value => { state.loading = value; }, setStatusMessage() {},
    prepareWardrobePhoto: async () => ({ uri: 'data:image/jpeg;base64,small', base64: 'small', mimeType: 'image/jpeg' }),
    parseAIJson: require('../styleProfile.js').parseAIJson,
    removeBackgroundSafe: background,
    callGeminiAPI: typeof reply === 'function' ? reply : async () => reply,
    setWardrobe: update => { state.wardrobe = update(state.wardrobe); },
    setFailedPhotos: update => { state.failed = update(state.failed); },
  };
  vm.createContext(context);
  vm.runInContext(`${code}; this.processPhoto = processAndAnalyzeImage;`, context);
  return { state, run: () => context.processPhoto('blob:original', 'original-large-photo', 'image/png') };
}

test('successful analysis saves a persistent resized photo when background removal is unavailable', async () => {
  const processor = photoProcessor('{"mainCategory":"UstGiyim","subCategory_tr":"Gömlek"}');
  await processor.run();
  assert.equal(processor.state.wardrobe.length, 1);
  assert.equal(processor.state.wardrobe[0].uri, 'data:image/jpeg;base64,small');
  assert.equal(processor.state.loading, false);
});

test('multiple concatenated clothing objects are rejected with a readable retry message', async () => {
  const processor = photoProcessor('{"mainCategory":"UstGiyim"}\n{"mainCategory":"AltGiyim"}');
  await processor.run();
  assert.equal(processor.state.wardrobe.length, 0);
  assert.equal(processor.state.failed.length, 1);
  assert.match(processor.state.failed[0].message, /Tek parça/);
  assert.equal(processor.state.failed[0].photo[1], 'small');
});

test('analysis failure waits for the bounded background request before advancing the photo queue', async () => {
  let release;
  const processor = photoProcessor(async () => { throw new Error('Busy model'); }, () => new Promise(resolve => { release = resolve; }));
  const running = processor.run();
  await new Promise(setImmediate);
  assert.equal(processor.state.loading, true);
  release(null);
  await running;
  assert.equal(processor.state.failed.length, 1);
  assert.equal(processor.state.loading, false);
});
