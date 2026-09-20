import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createV60Viewer,loadGlbFromUrl} from './viewer-core.mjs';
import {geometrySnapshot} from '/v88/transfer.mjs';import {createFaceMaterial} from './face-material.mjs';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const state={ready:false,busy:false,selected:'neutral',mode:'trial',view:'front',focus:'face',zoom:1,decision:null,releaseConnected:false};let left,right,manifest,face,before,sourceRoot,sourceMaterial;let selectionQueue=Promise.resolve();
let reviews={};try{const stored=JSON.parse(localStorage.getItem('doreumi-v90-reviews')||'{}');if(stored&&typeof stored==='object'&&!Array.isArray(stored))reviews=stored;}catch{/* Keep malformed stored data untouched; allow fresh review/export. */}
const currentAsset=()=>manifest?.expressions.find(a=>a.id===state.selected);
const originalMaterials=new Map(),trialMaterials=new Map(),greys=new Map();
const press=(selector,key,value)=>$$(selector).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[key]===value)));
function render(){for(const v of [left,right])v.renderer.render(v.scene,v.camera);}
function framing(){const az={front:0,quarter:45,side:90,back:180}[state.view]*Math.PI/180;
 for(const v of [left,right]){if(state.focus==='body'){v.setView(state.view);v.setZoom(state.zoom*1.12);continue;}
  const center=new THREE.Vector3(0,1.27,.34),distance=1.56/state.zoom;v.camera.position.set(center.x+Math.sin(az)*distance,center.y+.08*distance,center.z+Math.cos(az)*distance);v.controls.target.copy(center);v.controls.minDistance=.3;v.controls.maxDistance=10;v.controls.update();}render();}
function setView(view){state.view=view;press('[data-view]','view',view);framing();return getState();}
function setFocus(focus){state.focus=focus;$('#face').setAttribute('aria-pressed',String(focus==='face'));$('#body').setAttribute('aria-pressed',String(focus==='body'));framing();return getState();}
function setMode(mode){if(!['trial','neutral','shape','original'].includes(mode))throw new Error('Unknown mode');state.mode=mode;press('[data-mode]','mode',mode);
 face.uniforms.faceInkEnabled.value=mode==='trial'?1:0;
 for(const [mesh,mat]of originalMaterials){const isRight=trialMaterials.has(mesh);mesh.material=mode==='shape'?greys.get(mesh):(isRight&&mode!=='original'?trialMaterials.get(mesh):mat);if(isRight)mesh.morphTargetInfluences[0]=mode==='original'?0:1;}
 $('#mode-label').textContent={trial:`V60 + ${currentAsset()?.label??''}`,neutral:'V60 중립 바탕',shape:'V60 보정 굴곡',original:'V60 원본으로 복원'}[mode];render();return getState();}
function seek(p){left.seek(p);right.seek(p);pause(true);render();return getState();}
function pause(value){left.pause(value);right.pause(value);$('#play').textContent=value?'재생':'일시정지';return getState();}
function action(name){left.play(name);right.play(name);$('#action').value=name;$('#play').textContent='일시정지';return getState();}
function reset(){left.reset();right.reset();seek(0);state.zoom=1;$('#zoom').value=100;setFocus('face');setView('front');setMode('trial');$('#action').value='Idle';return getState();}
function getState(){return {...state,model:right?.state,source:'V60',expression:state.selected,expressionVersion:currentAsset()?.version,asset:currentAsset(),expressionIds:manifest?.expressions.map(a=>a.id),geometry:manifest?.geometry,material:face?.report};}
async function invariants(){const after=await geometrySnapshot(right.model,[...right.clips.values()]);return {baseBuffersSkinAndClipsUnchanged:JSON.stringify(before)===JSON.stringify(after),before,after};}
function exportReview(){return {version:'V90',at:new Date().toISOString(),state:getState(),reviews:structuredClone(reviews),sources:manifest,releaseConnected:false};}
function saveReview(){reviews[state.selected]={decision:state.decision,note:$('#notes').value,at:new Date().toISOString(),modelSHA256:currentAsset().modelSHA256};localStorage.setItem('doreumi-v90-reviews',JSON.stringify(reviews));}
function showIdentity(){const a=currentAsset();$('#expression').value=a.id;$('#source-reference').href=a.referenceUrl;$('#source-photo').src=a.referenceUrl;$('#source-photo').alt=`${a.label} 승인 원본 사진`;$('#asset-version').textContent=`${a.label} · ${a.version} · 원본 정적 승인 / V60 적용 검수 대기`;$('#asset-path').textContent=a.model;$('#caption').textContent=`승인된 ${a.label}의 눈·입·표정 무늬만 이전합니다. 기본 피부·볼·몸·나선은 V60입니다.`;const review=reviews[a.id];state.decision=review?.decision??null;$('#notes').value=review?.note??'';$$('[data-decision]').forEach(b=>b.classList.toggle('active',b.dataset.decision===state.decision));$('#details').textContent=JSON.stringify({source:manifest.model.path,expression:a,correctionHashes:manifest.corrections,material:face.report},null,2);}
function selectExpression(id){const job=selectionQueue.catch(()=>{}).then(async()=>{
 const a=manifest.expressions.find(x=>x.id===id);if(!a)throw new Error('Unknown approved expression');
 state.busy=true;$('#expression').disabled=true;$('#previous').disabled=true;$('#next').disabled=true;$('#notice').textContent=`${a.label} 적용 중…`;
 const oldMap=sourceMaterial.map;let nextMap,nextFace;
 try{const r=await fetch(a.textureUrl);if(!r.ok)throw new Error(`Texture HTTP ${r.status}`);const image=await createImageBitmap(await r.blob());nextMap=new THREE.Texture(image);nextMap.flipY=false;nextMap.colorSpace=THREE.SRGBColorSpace;sourceMaterial.map=nextMap;
  nextFace=createFaceMaterial(left.model,sourceRoot,manifest.geometry.regionsXY,a);
  const newMaterials=new Map();right.model.traverse(mesh=>{if(mesh.isMesh)newMaterials.set(mesh,nextFace.material(originalMaterials.get(mesh)));});
  const oldFace=face,oldMaterials=[...trialMaterials.values()];face=nextFace;trialMaterials.clear();for(const pair of newMaterials)trialMaterials.set(...pair);state.selected=id;showIdentity();setMode(state.mode);oldFace.dispose();oldMaterials.forEach(m=>m.dispose());oldMap.dispose();oldMap.image?.close?.();$('#notice').textContent=`${a.label} 적용됨 · V89 보정값 고정 · 원본 정적 승인 34종 / V60 적용 결과는 개별 검수 대기`;
  return {...getState(),busy:false};
 }catch(error){sourceMaterial.map=oldMap;nextFace?.dispose();nextMap?.dispose();nextMap?.image?.close?.();$('#notice').textContent=`${a.label} 적용 실패: ${error.message}. 이전 표정을 유지합니다.`;throw error;}
 finally{state.busy=false;$('#expression').disabled=false;$('#previous').disabled=false;$('#next').disabled=false;}
 });selectionQueue=job;return job;}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function record(){const canvas=$('#candidate'),stream=canvas.captureStream(30),rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'}),chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};const stop=new Promise(r=>rec.onstop=r);rec.start();action($('#action').value);await new Promise(r=>setTimeout(r,5000));rec.stop();await stop;stream.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:'video/webm'});download(blob,`v90-${state.selected}-motion.webm`);return blob.size;}
try{
 $$('button,select,input').forEach(b=>b.disabled=true);manifest=await(await fetch('/api/manifest')).json();if(!manifest.geometry.pass)throw new Error('Geometry safety checks failed');
 left=await createV60Viewer({canvas:$('#original')});right=await createV60Viewer({canvas:$('#candidate'),onState:s=>{$('#timeline').value=s.progress;}});seek(0);
 for(const viewer of [left,right])viewer.model.traverse(mesh=>{if(!mesh.isMesh)return;mesh.receiveShadow=false;originalMaterials.set(mesh,mesh.material);const grey=mesh.material.clone();grey.map=null;grey.color.set('#c8c8c8');greys.set(mesh,grey);});
 before=await geometrySnapshot(right.model,[...right.clips.values()]);
 for(const a of manifest.expressions){const option=document.createElement('option');option.value=a.id;option.textContent=`${a.label} · ${a.version}`;$('#expression').append(option);}
 const source=await loadGlbFromUrl(new GLTFLoader(),manifest.expressions.find(a=>a.id==='neutral').modelUrl);sourceRoot=source.scene;sourceRoot.traverse(mesh=>{if(mesh.isMesh&&mesh.material.map&&!sourceMaterial)sourceMaterial=mesh.material;});face=createFaceMaterial(left.model,sourceRoot,manifest.geometry.regionsXY,currentAsset());
 const [position,normal]=await Promise.all(['neutral-position-delta','neutral-normal-delta'].map(async name=>{const r=await fetch(`/data/${name}.bin`);if(!r.ok)throw new Error(name+' load failed');return new Float32Array(await r.arrayBuffer());}));
 right.model.traverse(mesh=>{if(!mesh.isMesh)return;if(position.length!==mesh.geometry.attributes.position.array.length)throw new Error('V60 morph count mismatch');mesh.geometry.morphTargetsRelative=true;mesh.geometry.morphAttributes.position=[new THREE.Float32BufferAttribute(position,3)];mesh.geometry.morphAttributes.normal=[new THREE.Float32BufferAttribute(normal,3)];mesh.updateMorphTargets();mesh.morphTargetInfluences[0]=1;trialMaterials.set(mesh,face.material(mesh.material));});
 const verified=await invariants();if(!verified.baseBuffersSkinAndClipsUnchanged)throw new Error('Base V60 data changed');
 $('#checks').textContent='V89 보정 파일 해시 고정 / 몸·얼굴 외곽·기본 볼터치 좌표 동일 / 원본 버퍼·관절·21클립 동일';
 window.__v90={getState,left,right,setMode,setView,setFocus,selectExpression,seek,pause,action,reset,invariants,exportReview,record};await selectExpression('thinking');state.ready=true;reset();$$('button,select,input').forEach(b=>b.disabled=false);
 $$('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));$$('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));$('#face').onclick=()=>setFocus('face');$('#body').onclick=()=>setFocus('body');$('#zoom').oninput=e=>{state.zoom=Number(e.target.value)/100;framing();};$('#reset').onclick=reset;$('#action').onchange=e=>action(e.target.value);$('#timeline').oninput=e=>seek(Number(e.target.value));$('#play').onclick=()=>pause(!right.state.paused);
 $('#expression').onchange=e=>selectExpression(e.target.value).catch(console.error);const step=d=>{const i=manifest.expressions.findIndex(a=>a.id===state.selected);return selectExpression(manifest.expressions[(i+d+34)%34].id).catch(console.error);};$('#previous').onclick=()=>step(-1);$('#next').onclick=()=>step(1);
 $$('[data-decision]').forEach(b=>b.onclick=()=>{state.decision=b.dataset.decision;$$('[data-decision]').forEach(x=>x.classList.toggle('active',x===b));saveReview();});$('#notes').oninput=saveReview;$('#export').onclick=()=>download(new Blob([JSON.stringify(exportReview(),null,2)],{type:'application/json'}),'v90-review.json');$('#capture').onclick=async()=>download(await right.captureBlob(),`v90-${state.selected}.png`);$('#record').onclick=async()=>{$('#record').disabled=true;await record();$('#record').disabled=false;};window.addEventListener('resize',framing);
}catch(error){state.error=error.message;$('#notice').textContent=`시험 중단: ${error.message}`;console.error(error);window.__v90={getState};}
