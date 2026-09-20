import * as THREE from 'three';
import {projectSurface,detectCheeks,fitCheekAlignment} from './projection.mjs';

function sampler(material){
  const map=material.map;
  if(!map)return ()=>[...material.color.clone().convertLinearToSRGB().toArray().map(c=>c*255),255];
  const image=map.image,canvas=document.createElement('canvas');
  const scale=Math.min(1,4096/Math.max(image.width,image.height));
  canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const {data}=ctx.getImageData(0,0,canvas.width,canvas.height),w=canvas.width,h=canvas.height;
  const factor=material.color.clone().convertLinearToSRGB().toArray();
  return (u,v)=>{
    const x=Math.min(w-1,Math.max(0,u*(w-1))),y=Math.min(h-1,Math.max(0,(map.flipY?1-v:v)*(h-1)));
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(x0+1,w-1),y1=Math.min(y0+1,h-1),fx=x-x0,fy=y-y0;
    const result=[0,0,0,255];
    for(let c=0;c<3;c++)result[c]=factor[c]*((1-fy)*((1-fx)*data[4*(y0*w+x0)+c]+fx*data[4*(y0*w+x1)+c])+fy*((1-fx)*data[4*(y1*w+x0)+c]+fx*data[4*(y1*w+x1)+c]));
    return result;
  };
}

export function projectModel(root,bounds){
  const primitives=[];
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const g=mesh.geometry;
    if(Array.isArray(mesh.material))throw new Error('Grouped materials require explicit primitive split');
    primitives.push({positions:g.attributes.position.array,uvs:g.attributes.uv.array,indices:g.index?.array??Uint32Array.from({length:g.attributes.position.count},(_,i)=>i),sample:sampler(mesh.material)});
  });
  return projectSurface(primitives,{bounds,width:768,height:768,minDepth:.10});
}

export function surfaceCanvas(surface){
  const canvas=document.createElement('canvas');canvas.width=surface.width;canvas.height=surface.height;
  canvas.getContext('2d').putImageData(new ImageData(surface.rgba,surface.width,surface.height),0,0);return canvas;
}

export async function geometrySnapshot(root,clips=[]){
  const parts=[],meshes=[];
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const g=mesh.geometry;
    const attrs={};
    for(const [name,a] of Object.entries(g.attributes)){parts.push({label:`${mesh.name}:${name}`,bytes:new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength)});attrs[name]=a.count;}
    if(g.index)parts.push({label:`${mesh.name}:indices`,bytes:new Uint8Array(g.index.array.buffer,g.index.array.byteOffset,g.index.array.byteLength)});
    meshes.push({name:mesh.name,attributes:attrs,triangles:(g.index?.count??g.attributes.position.count)/3,bones:mesh.skeleton?.bones.map(b=>({name:b.name,parent:b.parent?.name})),inverseBindMatrices:mesh.skeleton?.boneInverses.map(m=>m.toArray())});
  });
  for(const clip of clips)for(const track of clip.tracks)for(const kind of ['times','values']){const a=track[kind];parts.push({label:`${clip.name}:${track.name}:${kind}`,bytes:new Uint8Array(a.buffer,a.byteOffset,a.byteLength)});}
  const hashes=[];for(const p of parts){const hash=await crypto.subtle.digest('SHA-256',p.bytes);hashes.push({label:p.label,sha256:[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')});}
  return {meshes,hashes};
}

export function createTransfer(target,source){
  const sourceSurface=projectModel(source,[-.46,-.22,.46,.43]);
  const targetSurface=projectModel(target,[-.4,-.12,.4,.64]);
  const sourceCheeks=detectCheeks(sourceSurface),targetCheeks=detectCheeks(targetSurface);
  const fit=fitCheekAlignment(sourceCheeks,targetCheeks);
  if(fit.scale<.5||fit.scale>2.5||Math.abs(fit.rotation)>.45)throw new Error('Face correspondence outside pilot limits');
  const fieldCanvas=surfaceCanvas(sourceSurface),field=new THREE.CanvasTexture(fieldCanvas);
  field.flipY=false;field.colorSpace=THREE.SRGBColorSpace;field.generateMipmaps=true;field.minFilter=THREE.LinearMipmapLinearFilter;
  const originals=new Map(),trials=new Map(),greys=new Map();
  const mid=[(sourceCheeks.left[0]+sourceCheeks.right[0])/2,(sourceCheeks.left[1]+sourceCheeks.right[1])/2];
  const span=Math.hypot(sourceCheeks.right[0]-sourceCheeks.left[0],sourceCheeks.right[1]-sourceCheeks.left[1]);
  const mask={center:[mid[0],mid[1]+span*.11],radius:[span*.67,span*.44],minLocalDepth:.18,edgeFade:.06};
  target.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const original=mesh.material;originals.set(mesh,original);
    const trial=original.clone();
    trial.onBeforeCompile=shader=>{
      shader.uniforms.pilotField={value:field};shader.uniforms.pilotFit={value:new THREE.Vector4(fit.a,fit.b,fit.tx,fit.ty)};
      shader.uniforms.pilotBounds={value:new THREE.Vector4(...sourceSurface.bounds)};
      shader.uniforms.pilotMask={value:new THREE.Vector4(...mask.center,...mask.radius)};
      shader.vertexShader='varying vec3 vPilotRest;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPilotRest = position;');
      shader.fragmentShader='varying vec3 vPilotRest;\nuniform sampler2D pilotField;\nuniform vec4 pilotFit;\nuniform vec4 pilotBounds;\nuniform vec4 pilotMask;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
        vec2 src = vec2(pilotFit.x*vPilotRest.x-pilotFit.y*vPilotRest.y+pilotFit.z, pilotFit.y*vPilotRest.x+pilotFit.x*vPilotRest.y+pilotFit.w);
        vec2 puv = vec2((src.x-pilotBounds.x)/(pilotBounds.z-pilotBounds.x),(pilotBounds.w-src.y)/(pilotBounds.w-pilotBounds.y));
        vec4 approvedColor = texture2D(pilotField,puv);
        float radius = length((src-pilotMask.xy)/pilotMask.zw);
        float maskWeight = (1.0-smoothstep(0.94,1.0,radius))*step(0.18,vPilotRest.z)*approvedColor.a;
        diffuseColor.rgb = mix(diffuseColor.rgb,approvedColor.rgb,maskWeight);
      `);
    };
    trial.customProgramCacheKey=()=> 'v88-approved-color-coordinate-transfer-1';trials.set(mesh,trial);
    const grey=original.clone();grey.map=null;grey.color.set('#c8c8c8');greys.set(mesh,grey);
  });
  let mode='original';
  return {sourceSurface,targetSurface,fieldCanvas,report:{sourceCheeks,targetCheeks,fit,mask,sourceProjectionResolution:[768,768],operation:'approved texture color resampling in existing material; rest-position mask follows existing skinning',geometryEdited:false,uvEdited:false,sourcePixelsRepainted:false},setMode(next){if(!['original','trial','shape'].includes(next))throw new Error('Invalid mode');for(const [mesh,original] of originals)mesh.material=next==='original'?original:(next==='trial'?trials:greys).get(mesh);mode=next;return mode;},get mode(){return mode;},restored(){return [...originals].every(([mesh,material])=>mesh.material===material);},dispose(){for(const [mesh,material]of originals)mesh.material=material;for(const m of [...trials.values(),...greys.values()])m.dispose();field.dispose();}};
}
