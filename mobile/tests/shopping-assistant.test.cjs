const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pickShoppingPhoto, buildStylistParts } = require('../shoppingAssistant.js');
const photo = { uri: 'sample.png', base64: 'SAMPLE_PHOTO', mimeType: 'image/png' };
const defaults = { message: 'Should I buy it?', wardrobe: [{ id: 'own-shirt', subCategory_en: 'White shirt', isDirty: true }], style: 'Minimal, regular fit', colors: 'Not analyzed', weather: { city: 'Istanbul', temp: 18, desc: 'Clear' }, lang: 'en' };

for (const source of ['camera', 'gallery']) {
  test(`shopping ${source} opens within the web click, without a permission wait`, async () => {
    let launched = false;
    const launch = () => { launched = true; return Promise.resolve({ canceled: false, assets: [photo] }); };
    const pending = pickShoppingPhoto(source, { platform: 'web', imagePicker: { launchCameraAsync: launch, launchImageLibraryAsync: launch } });
    assert.equal(launched, true);
    assert.deepEqual(await pending, photo);
  });
}

test('native permission denial prevents access to the camera', async () => {
  await assert.rejects(pickShoppingPhoto('camera', { platform: 'ios', imagePicker: {
    requestCameraPermissionsAsync: async () => ({ granted: false }), launchCameraAsync: () => assert.fail('Must not open camera'),
  } }), /permission denied/);
});

test('cancel leaves no attachment, and unsupported or oversized photos are rejected', async () => {
  const picker = result => ({ platform: 'web', imagePicker: { launchImageLibraryAsync: async () => result } });
  assert.equal(await pickShoppingPhoto('gallery', picker({ canceled: true })), null);
  await assert.rejects(pickShoppingPhoto('gallery', picker({ assets: [{ ...photo, mimeType: 'image/svg+xml' }] })), /Unsupported/);
  await assert.rejects(pickShoppingPhoto('gallery', picker({ assets: [{ ...photo, base64: 'a'.repeat(8 * 1024 * 1024 + 1) }] })), /too large/);
});

test('shopping prompt includes the photo, profile and all owned pieces, including laundry', () => {
  const original = JSON.stringify(defaults.wardrobe);
  const parts = buildStylistParts({ ...defaults, attachment: photo });
  assert.deepEqual(parts[1], { inline_data: { mime_type: 'image/png', data: 'SAMPLE_PHOTO' } });
  assert.match(parts[0].text, /Minimal, regular fit/);
  assert.match(parts[0].text, /"inLaundry":true/);
  assert.match(parts[0].text, /not an owned or purchased item/);
  assert.match(parts[0].text, /Without a known price and budget/);
  assert.equal(JSON.stringify(defaults.wardrobe), original);
});

test('text-only conversations remain text-only and follow-ups retain the last user photo', () => {
  assert.equal(buildStylistParts(defaults).length, 1);
  const history = [{ sender: 'user', text: 'This one?', attachment: photo }, { sender: 'ai', text: 'What is the price?' }];
  const parts = buildStylistParts({ ...defaults, message: 'It costs 800 TRY', history });
  assert.equal(parts[1].inline_data.data, photo.base64);
  assert.match(parts[0].text, /Previous user message/);
  assert.match(parts[0].text, /800 TRY/);
  const newer = buildStylistParts({ ...defaults, history, attachment: { ...photo, base64: 'NEW_PHOTO' } });
  assert.equal(newer[1].inline_data.data, 'NEW_PHOTO');
});

const app = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const sendHandler = app.slice(app.indexOf('  const handleSendMessage ='), app.indexOf('// Yüz / Selfie Seçimi'));
function makeChat(callGeminiAPI) {
  const context = {
    inputText: '', chatAttachment: photo, chatSendLock: { current: false }, chatLoading: false, chatPickingPhoto: false,
    chatMessages: [], lang: 'en', wardrobe: defaults.wardrobe, personalStyleContext: defaults.style, personalColorContext: defaults.colors, weather: defaults.weather,
    buildStylistParts, callGeminiAPI, console: { log() {} },
    setChatMessages: update => { context.chatMessages = update(context.chatMessages); },
    setInputText: value => { context.inputText = value; }, setChatAttachment: value => { context.chatAttachment = value; }, setChatLoading: value => { context.chatLoading = value; },
  };
  vm.createContext(context);
  vm.runInContext(`${sendHandler}\nthis.send = handleSendMessage;`, context);
  return context;
}

test('photo-only chat uses a default buying question, prevents duplicate sends and never changes the wardrobe', async () => {
  let resolve;
  let requests = 0;
  let sent;
  const context = makeChat(parts => { sent = parts; requests++; return new Promise(done => { resolve = done; }); });
  const pending = context.send();
  await context.send();
  assert.equal(requests, 1);
  assert.equal(sent[1].inline_data.data, 'SAMPLE_PHOTO');
  assert.equal(context.chatAttachment, null);
  assert.match(context.chatMessages[0].text, /Should I buy/);
  resolve('Try it with your existing shirt.');
  await pending;
  assert.equal(context.chatMessages.length, 2);
  assert.equal(context.wardrobe.length, 1);
  assert.equal(context.chatSendLock.current, false);
});

test('AI failure retains the original message/photo for retry and preserves an unrelated draft', async () => {
  const context = makeChat(async () => { throw new Error('Offline'); });
  await context.send();
  const original = context.chatMessages[0];
  assert.equal(context.chatMessages[1].error, true);
  assert.equal(original.attachment.base64, 'SAMPLE_PHOTO');
  context.inputText = 'An unrelated draft';
  context.callGeminiAPI = async parts => { assert.equal(parts[1].inline_data.data, 'SAMPLE_PHOTO'); return 'Replied'; };
  await context.send(original);
  assert.equal(context.chatMessages.at(-1).text, 'Replied');
  assert.equal(context.inputText, 'An unrelated draft');
});
