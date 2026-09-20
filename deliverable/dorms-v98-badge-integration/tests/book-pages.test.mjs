import test from 'node:test';import assert from 'node:assert/strict';
const m=await import('../src/book-pages.mjs').catch(()=>({}));
test('book page mask excludes bottom cover and side edges',()=>{assert.equal(typeof m.isPageSurface,'function');assert.equal(m.isPageSurface({height:.8,up:.8,x:0,z:0}),true);assert.equal(m.isPageSurface({height:.05,up:1,x:0,z:0}),false);assert.equal(m.isPageSurface({height:.8,up:-1,x:0,z:0}),false);assert.equal(m.isPageSurface({height:.8,up:1,x:.99,z:0}),false);});
