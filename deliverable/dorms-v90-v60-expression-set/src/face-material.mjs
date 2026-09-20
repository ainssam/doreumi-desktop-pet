import * as THREE from 'three';
import {projectModel,surfaceCanvas} from '/v88/transfer.mjs';
import {detectCheeks,fitCheekAlignment,targetToSource} from '/v88/projection.mjs';
import {isolateExpression} from './pigment.mjs';
import {isolatePigment as isolateThinking} from '/v89/pigment.mjs';
const preparedCache=new WeakMap();

const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
function regionWeight(x,y,regions){let w=0;for(const [cx,cy,rx,ry]of regions)w=Math.max(w,smooth((1-Math.hypot((x-cx)/rx,(y-cy)/ry))/.24));for(const [cx,cy,rx,ry]of [[-.21348,.13026,.038,.019],[.22184,.11323,.037,.017]])w*=smooth((Math.hypot((x-cx)/rx,(y-cy)/ry)-1)/.2);return w;}
function sample(surface,x,y){
 const [x0,y0,x1,y1]=surface.bounds,px=(x-x0)/(x1-x0)*surface.width-.5,py=(y1-y)/(y1-y0)*surface.height-.5;
 if(px<0||py<0||px>=surface.width-1||py>=surface.height-1)return [0,0,0,0];
 const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,out=[0,0,0,0];
 for(let j=0;j<2;j++)for(let i=0;i<2;i++){const k=4*((iy+j)*surface.width+ix+i),w=(i?fx:1-fx)*(j?fy:1-fy);for(let c=0;c<4;c++)out[c]+=surface.rgba[k+c]*w;}return out;
}
function solve(matrix,vector){
 const a=matrix.map((row,i)=>[...row,vector[i]]),n=vector.length;
 for(let k=0;k<n;k++){let pivot=k;for(let i=k+1;i<n;i++)if(Math.abs(a[i][k])>Math.abs(a[pivot][k]))pivot=i;[a[k],a[pivot]]=[a[pivot],a[k]];if(Math.abs(a[k][k])<1e-10)throw new Error('Skin boundary fit is singular');const v=a[k][k];for(let j=k;j<=n;j++)a[k][j]/=v;for(let i=0;i<n;i++)if(i!==k){const v=a[i][k];for(let j=k;j<=n;j++)a[i][j]-=v*a[k][j];}}
 return a.map(row=>row[n]);
}
function fitSkin(surface,region,regions){
 const [cx,cy,rx,ry]=region,m=Array.from({length:6},()=>Array(6).fill(0)),rhs=Array.from({length:3},()=>Array(6).fill(0));let samples=0;
 for(let a=0;a<360;a+=2)for(const r of [1.0,1.06,1.12]){
  const dx=Math.cos(a*Math.PI/180)*r,dy=Math.sin(a*Math.PI/180)*r,x=cx+rx*dx,y=cy+ry*dy;
  if(regionWeight(x,y,regions)>.03)continue;const rgb=sample(surface,x,y);if(rgb[3]<250||Math.min(...rgb.slice(0,3))<150||Math.max(...rgb.slice(0,3))-Math.min(...rgb.slice(0,3))>22)continue;
  const v=[1,dx,dy,dx*dx,dx*dy,dy*dy];for(let i=0;i<6;i++){for(let j=0;j<6;j++)m[i][j]+=v[i]*v[j];for(let c=0;c<3;c++)rhs[c][i]+=v[i]*rgb[c];}samples++;
 }
 if(samples<30)throw new Error('Not enough intact V60 skin samples');
 const coefficients=rhs.map(v=>solve(m,v));
 return {samples,coefficients,color(x,y){const dx=(x-cx)/rx,dy=(y-cy)/ry,v=[1,dx,dy,dx*dx,dx*dy,dy*dy];return coefficients.map(co=>Math.max(0,Math.min(255,co.reduce((s,c,i)=>s+c*v[i],0))));}};
}
function texture(surface){const t=new THREE.CanvasTexture(surfaceCanvas(surface));t.flipY=false;t.colorSpace=THREE.SRGBColorSpace;t.minFilter=THREE.LinearFilter;t.generateMipmaps=false;return t;}

export function createFaceMaterial(originalRoot,sourceRoot,regions,expression){
 const source=projectModel(sourceRoot,[-.46,-.22,.46,.43]);let prepared=preparedCache.get(originalRoot);
 if(!prepared){if(expression.id!=='neutral')throw new Error('Initialize with approved neutral baseline');const target=projectModel(originalRoot,[-.4,-.12,.4,.64]);const sourceCheeks=detectCheeks(source),targetCheeks=detectCheeks(target),fit=fitCheekAlignment(sourceCheeks,targetCheeks);prepared={target,baseline:source,sourceCheeks,targetCheeks,fit,skins:regions.map(r=>fitSkin(target,r,regions))};preparedCache.set(originalRoot,prepared);}
 const {target,baseline,sourceCheeks,targetCheeks,fit,skins}=prepared;
 const pigment=expression.id==='thinking'?isolateThinking(source):isolateExpression(source,baseline);
 const skin={...target,rgba:new Uint8ClampedArray(target.rgba.length)},ink={...target,rgba:new Uint8ClampedArray(target.rgba.length)};
 let erasedPixels=0,inkPixels=0;
 for(let row=0;row<target.height;row++)for(let col=0;col<target.width;col++){
   const k=4*(row*target.width+col),x=target.bounds[0]+(col+.5)/target.width*(target.bounds[2]-target.bounds[0]),y=target.bounds[3]-(row+.5)/target.height*(target.bounds[3]-target.bounds[1]);
   const w=regionWeight(x,y,regions);if(w>0){let total=0,rgb=[0,0,0];for(let r=0;r<regions.length;r++){const [cx,cy,rx,ry]=regions[r],q=smooth((1-Math.hypot((x-cx)/rx,(y-cy)/ry))/.24);if(q>0){const c=skins[r].color(x,y);total+=q;for(let i=0;i<3;i++)rgb[i]+=q*c[i];}}for(let i=0;i<3;i++)skin.rgba[k+i]=rgb[i]/Math.max(total,1e-6);skin.rgba[k+3]=w*255;erasedPixels++;}
   const [sx,sy]=targetToSource(x,y,fit);
   if(Math.abs(sx-.02)>.32||sy<-.10||sy>.34)continue;
   const c=sample(pigment.surface,sx,sy);
   const a=c[3]/255;
   if(a>0){ink.rgba.set([c[0],c[1],c[2],a*255],k);inkPixels++;}
 }
 const skinTexture=texture(skin),inkTexture=texture(ink),uniforms={faceSkin:{value:skinTexture},faceInk:{value:inkTexture},faceInkEnabled:{value:1},faceBounds:{value:new THREE.Vector4(...target.bounds)}};
 return {report:{expressionId:expression.id,fit,sourceCheeks,targetCheeks,pigmentComponents:pigment.components,discardedIsolatedMarks:pigment.discardedComponents,coloredPixels:pigment.coloredPixels??0,holePixels:pigment.holePixels??0,skinBoundarySamples:skins.map(s=>s.samples),erasedPixels,inkPixels,resolution:[768,768],newEyeOrMouthDrawn:false,sourceBodyTransferred:false},skin,ink,uniforms,material(original){const m=original.clone();m.onBeforeCompile=shader=>{Object.assign(shader.uniforms,uniforms);shader.vertexShader='varying vec3 vFacePosition;\nvarying vec3 vFaceRest;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <morphtarget_vertex>','#include <morphtarget_vertex>\nvFacePosition = transformed;\nvFaceRest = position;');shader.fragmentShader='varying vec3 vFacePosition;\nvarying vec3 vFaceRest;\nuniform sampler2D faceSkin;\nuniform sampler2D faceInk;\nuniform float faceInkEnabled;\nuniform vec4 faceBounds;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
   vec2 fp=vec2((vFacePosition.x-faceBounds.x)/(faceBounds.z-faceBounds.x),(faceBounds.w-vFacePosition.y)/(faceBounds.w-faceBounds.y));
   vec2 restFp=vec2((vFaceRest.x-faceBounds.x)/(faceBounds.z-faceBounds.x),(faceBounds.w-vFaceRest.y)/(faceBounds.w-faceBounds.y));
   float faceGate=step(.22,vFacePosition.z)*step(0.,fp.x)*step(fp.x,1.)*step(0.,fp.y)*step(fp.y,1.);
   vec4 cleanSkin=texture2D(faceSkin,restFp);vec4 approvedInk=texture2D(faceInk,fp);
   diffuseColor.rgb=mix(diffuseColor.rgb,cleanSkin.rgb,cleanSkin.a*faceGate);
   diffuseColor.rgb=mix(diffuseColor.rgb,approvedInk.rgb,approvedInk.a*faceGate*faceInkEnabled);
  `);};m.customProgramCacheKey=()=> 'v90-v60-approved-expression';return m;},dispose(){skinTexture.dispose();inkTexture.dispose();}};
}
