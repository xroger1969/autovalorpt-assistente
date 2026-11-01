import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/chat.js';

test('Astra requests preserve structured output and allocate reasoning tokens', async () => {
 const original=globalThis.fetch, key=process.env.OPENAI_API_KEY, model=process.env.OPENAI_MODEL;
 const calls=[];process.env.OPENAI_API_KEY='test-key';delete process.env.OPENAI_MODEL;
 globalThis.fetch=async (_url,init)=>{calls.push(JSON.parse(init.body));return Response.json({error:{message:'synthetic test rejection'}},{status:503});};
 try {
  const res={status(){return this;},json(){return this;}};await handler({method:'POST',body:{message:'Explica como funciona um automóvel elétrico.'}},res);
  assert.ok(calls.length>0);
  for(const p of calls){assert.equal(p.model,'gpt-6-astra');assert.deepEqual(p.reasoning,{effort:'low'});assert.ok(p.max_output_tokens>=3072);assert.equal(p.temperature,undefined);}
  assert.equal(calls[0].text.format.strict,true);
 } finally {globalThis.fetch=original;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(model===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=model;}
});
