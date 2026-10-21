const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { STYLE_NAMES, STYLE_QUESTIONS, scoreStyleProfile, profileDetails, styleContext, parseAIJson, selectOutfitItems } = require('../styleProfile.js');
const { inspirationFeed } = require('../inspirations.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const answers = { aesthetic: 'minimal', fit: 'regular', palette: 'neutral', occasion: 'work', priority: 'versatile' };

test('the five-question test produces a reproducible profile with every preference', () => {
  const result = scoreStyleProfile(answers);
  assert.equal(result.primary, 'Minimalist');
  assert.equal(profileDetails(result, 'tr').length, 5);
  assert.match(styleContext(result, '', 'en'), /Office and professional settings/);
  assert.deepEqual(scoreStyleProfile(JSON.parse(JSON.stringify(result)).answers), result);
});

test('incomplete and unknown answers cannot create a saved result', () => {
  assert.throws(() => scoreStyleProfile({}));
  assert.throws(() => scoreStyleProfile({ ...answers, fit: 'unknown' }));
});

test('all 1536 answer combinations score and can represent all six styles', () => {
  const reached = new Set();
  let count = 0;
  function walk(index, selected) {
    if (index === STYLE_QUESTIONS.length) {
      const profile = scoreStyleProfile(selected);
      assert.ok(STYLE_NAMES.includes(profile.primary));
      assert.notEqual(profile.primary, profile.secondary);
      reached.add(profile.primary);
      count++;
      return;
    }
    const question = STYLE_QUESTIONS[index];
    for (const option of question.options) walk(index + 1, { ...selected, [question.id]: option.id });
  }
  walk(0, {});
  assert.equal(count, 1536);
  assert.equal(reached.size, 6);
});

test('outfit validation rejects dirty, invented, empty and malformed selections', () => {
  const wardrobe = [{ id: 'top' }, { id: 'pants' }, { id: 'dirty', isDirty: true }];
  assert.deepEqual(selectOutfitItems(['top', 'pants', 'top'], wardrobe).map(item => item.id), ['top', 'pants']);
  for (const ids of [[], undefined, ['dirty'], ['unknown'], ['top', 'unknown']]) assert.throws(() => selectOutfitItems(ids, wardrobe));
  assert.deepEqual(parseAIJson('```json\n{"itemIds":["top"]}\n```'), { itemIds: ['top'] });
});

test('inspiration filtering and style ranking keep the actual photo sources', () => {
  assert.ok(inspirationFeed('all', 'Classic')[0].styles.includes('Classic'));
  for (const style of STYLE_NAMES) {
    const feed = inspirationFeed(style, style);
    assert.ok(feed.length);
    assert.ok(feed.every(item => item.styles.includes(style) && item.source.startsWith('https://unsplash.com/') && item.image.startsWith('https://images.unsplash.com/')));
  }
});

for (const name of ['camera', 'gallery']) {
  test(`selfie ${name} launches directly on web and preserves PNG type`, async () => {
    const calls = [];
    const block = source.slice(source.indexOf('  const handleStartColorAnalysis ='), source.indexOf('  // Gemini AI Yüz Analiz Motoru'));
    const picker = () => { calls.push('picker'); return Promise.resolve({ canceled: false, assets: [{ base64: 'photo', mimeType: 'image/png' }] }); };
    const context = { Platform: { OS: 'web' }, lang: 'tr', colorLoading: false,
      ImagePicker: { launchCameraAsync: picker, launchImageLibraryAsync: picker },
      analyzeFaceWithAI: (...args) => { calls.push(args); }, showAlert: (...args) => { context.buttons = args[2]; } };
    vm.createContext(context);
    vm.runInContext(`${block}\nthis.open = handleStartColorAnalysis;`, context);
    context.open();
    const pending = context.buttons[name === 'camera' ? 0 : 1].onPress();
    assert.equal(calls[0], 'picker');
    await pending;
    assert.deepEqual(calls[1], ['photo', 'image/png']);
  });
}

test('daily outfit consumes the requested JSON keys and sends the complete profile', async () => {
  const block = source.slice(source.indexOf('  const generateSmartOutfit ='), source.indexOf('  const removeCloth ='));
  const state = {};
  const wardrobe = [{ id: 'top', subCategory: 'shirt' }, { id: 'pants', subCategory: 'trousers' }, { id: 'dirty', isDirty: true }];
  let sent;
  const context = {
    outfitRequest: { current: 0 }, wardrobe, lang: 'tr', personalStyleContext: 'PROFILE_WITH_FIVE_ANSWERS', personalColorContext: 'No selfie yet', weather: { temp: 18, desc: 'Clear' },
    setOutfitError: value => { state.error = value; }, setOutfitLoading: value => { state.loading = value; }, setCurrentOutfit: value => { state.outfit = value; },
    getItemField: (item, key) => item[key], showAlert() {}, console: { log() {} },
    callGeminiAPI: async parts => { sent = parts[0].text; return JSON.stringify({ title: 'Test outfit', note: 'Test explanation', itemIds: ['top', 'pants'] }); },
    parseAIJson, selectOutfitItems,
  };
  vm.createContext(context);
  vm.runInContext(`${block}\nthis.generate = generateSmartOutfit;`, context);
  await context.generate();
  assert.equal(state.outfit.title, 'Test outfit');
  assert.deepEqual(state.outfit.items.map(item => item.id), ['top', 'pants']);
  assert.match(sent, /PROFILE_WITH_FIVE_ANSWERS/);
  assert.doesNotMatch(sent, /ID:dirty/);
  assert.equal(state.loading, false);
  context.callGeminiAPI = async () => '{"title":"Bad","note":"Bad","itemIds":["dirty"]}';
  await context.generate();
  assert.equal(state.outfit, null);
  assert.ok(state.error);
});

test('inspiration matching sends the actual photo and style profile to vision AI', async () => {
  const block = source.slice(source.indexOf('  const handleMatchInspiration ='), source.indexOf('  const handleSendMessage ='));
  let sent;
  let result;
  const context = {
    matchingLoading: false, wardrobe: [{ id: 'top' }, { id: 'dirty', isDirty: true }], lang: 'tr',
    personalStyleContext: 'SAVED_PROFILE', personalColorContext: 'NONE', weather: { temp: 18, desc: 'Clear' },
    showAlert() {}, setMatchingLoading() {}, setMatchModalVisible() {}, setMatchedOutfitResult: value => { result = value; },
    loadInspirationImage: async () => ({ data: 'REFERENCE_IMAGE', mimeType: 'image/png' }),
    getItemField: (item, key) => item[key], parseAIJson, selectOutfitItems, console,
    callGeminiAPI: async parts => { sent = parts; return JSON.stringify({ matchedItemIds: ['top'], matchNote: 'Matched', missingItemAdvice: 'Add trousers' }); },
  };
  vm.createContext(context);
  vm.runInContext(`${block}\nthis.match = handleMatchInspiration;`, context);
  await context.match({ title: { tr: 'Fotoğraf', en: 'Photo' }, image: 'photo.jpg' });
  assert.equal(sent[1].inline_data.data, 'REFERENCE_IMAGE');
  assert.equal(sent[1].inline_data.mime_type, 'image/png');
  assert.match(sent[0].text, /SAVED_PROFILE/);
  assert.doesNotMatch(sent[0].text, /"id":"dirty"/);
  assert.equal(result.items[0].id, 'top');
});

test('a busy proxy is reported without repeating its internal model retries', async () => {
  const block = source.slice(source.indexOf('async function callGeminiAPI('), source.indexOf('// === MERKEZİ ARKA PLAN'));
  let requests = 0;
  const context = { AbortController, setTimeout, clearTimeout, PROXY_BASE_URL: 'https://example.com', APP_SHARED_SECRET: '', sleep: async () => {},
    fetch: async () => { requests++; return { ok: false, status: 502, json: async () => ({ error: 'Model busy' }) }; } };
  vm.createContext(context);
  vm.runInContext(`${block}\nthis.call = callGeminiAPI;`, context);
  await assert.rejects(context.call([{ text: 'Example' }]), error => error.retryable === true && error.httpStatus === 502);
  assert.equal(requests, 1);
});
