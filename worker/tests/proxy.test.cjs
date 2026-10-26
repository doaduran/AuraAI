const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/index.js'), 'utf8')
  .replace('export default', 'const worker =').replaceAll('export async function', 'async function');

function setup(fetch, timers = {}) {
  const context = { fetch, Request, Response, URL, AbortController, setTimeout, clearTimeout, Date, console: { info() {} }, ...timers };
  vm.createContext(context);
  vm.runInContext(`${source}; this.worker = worker; this.fetchJson = fetchJson;`, context);
  const send = body => context.worker.fetch(new Request('https://aura.test/gemini', {method:'POST',body:JSON.stringify(body)}), { GEMINI_API_KEY: 'test-key' });
  return { send, context };
}
const success = () => new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'Hidden thoughts'},{text:'OK'}]}}]}));

test('wardrobe uses a pinned fast model, minimal thinking, and an API header rather than URL credentials', async () => {
  const calls = [];
  const app = setup(async (url, options) => { calls.push({url,options}); return success(); });
  const result = await app.send({task:'wardrobe',parts:[{text:'Classify this shirt'}]});
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-aura-model'),'gemini-3.6-flash');
  assert.ok(!calls[0].url.includes('test-key'));
  assert.equal(calls[0].options.headers['x-goog-api-key'],'test-key');
  assert.equal(JSON.parse(calls[0].options.body).generationConfig.thinkingConfig.thinkingLevel,'minimal');
  const config=JSON.parse(calls[0].options.body).generationConfig;
  assert.equal(config.responseSchema.type,'OBJECT');
  assert.ok(config.responseSchema.required.includes('mainCategory'));
  assert.equal(config.responseSchema.required.length,9);
  assert.deepEqual((await result.json()).candidates[0].content.parts,[{text:'OK'}]);
});

test('busy model falls back once, without a six-call retry cycle', async () => {
  const calls=[];
  const app=setup(async url=>{ calls.push(url); return calls.length===1 ? new Response('busy',{status:503}) : success(); });
  const result=await app.send({parts:[{text:'Suggest an outfit'}]});
  assert.equal(result.status,200);
  assert.equal(calls.length,2);
});

test('quota, rejected credentials, empty replies and invalid requests are distinguished', async () => {
  let app=setup(async()=>new Response('{}',{status:429}));
  assert.equal((await app.send({parts:[{text:'hello'}]})).status,429);
  let count=0;
  app=setup(async()=>{ count++; return new Response('{}',{status:403}); });
  assert.equal((await (await app.send({parts:[{text:'hello'}]})).json()).code,'AI_REQUEST_REJECTED');
  assert.equal(count,1);
  app=setup(async()=>new Response('{}'));
  assert.equal((await (await app.send({parts:[{text:'hello'}]})).json()).code,'AI_EMPTY_RESPONSE');
  assert.equal((await app.send({parts:[]})).status,400);
});

test('timeout aborts a pending upstream request and remains retryable', async () => {
  const app=setup((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timed out','AbortError')))), {
    setTimeout: callback=>setTimeout(callback,1),
  });
  const result=await app.send({parts:[{text:'hello'}]});
  assert.equal(result.status,504);
  assert.equal((await result.json()).retryable,true);
});
