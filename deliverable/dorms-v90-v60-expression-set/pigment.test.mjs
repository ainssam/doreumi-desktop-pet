import {test} from 'node:test';import assert from 'node:assert/strict';import {isolateExpression} from './src/pigment.mjs';
function fixture(){const rgba=new Uint8ClampedArray(80*80*4);for(let i=0;i<6400;i++)rgba.set([220,220,220,255],i*4);return {rgba,width:80,height:80,bounds:[-.35,-.1,.35,.35]};}
function rect(s,x,y,w,h,c){for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)s.rgba.set([...c,255],4*(j*80+i));}
test('keeps eyebrows, colored mouth and tears beyond three components; retains unchanged V60 cheek policy',()=>{
 const base=fixture();rect(base,7,55,8,5,[205,140,145]);rect(base,34,46,10,2,[30,30,30]);
 const src={...base,rgba:base.rgba.slice()};rect(src,34,46,10,2,[220,220,220]);
 for(const [x,y]of [[18,22],[50,22],[17,13],[51,13]])rect(src,x,y,7,3,[30,30,30]);rect(src,32,47,14,9,[210,120,130]);rect(src,58,37,4,8,[110,170,220]);
 const before=src.rgba.slice(),out=isolateExpression(src,base);
 assert.ok(out.components.length>=6);assert.equal(out.surface.rgba[4*(50*80+35)+3],255);assert.equal(out.surface.rgba[4*(40*80+59)+3],255);assert.equal(out.surface.rgba[4*(56*80+8)+3],0);assert.deepEqual(src.rgba,before);
});
test('keeps enclosed white highlights and excludes removed baseline features',()=>{
 const base=fixture();rect(base,35,60,10,2,[30,30,30]);const src={...base,rgba:base.rgba.slice()};rect(src,35,60,10,2,[220,220,220]);rect(src,20,20,14,14,[30,30,30]);rect(src,24,24,5,5,[250,250,250]);rect(src,48,20,10,10,[30,30,30]);
 const out=isolateExpression(src,base);assert.equal(out.surface.rgba[4*(26*80+26)+3],255);assert.equal(out.surface.rgba[4*(60*80+38)+3],0);
});
