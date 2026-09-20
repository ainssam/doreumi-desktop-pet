import http from 'node:http';import path from 'node:path';import {createReadStream} from 'node:fs';import {stat} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {ROOT,WORKSPACE,buildManifest} from './manifest.mjs';import {resolveSafePrefix,contentTypeFor} from '../dorms-v87-integrated-review-showcase/lib/server-routes.mjs';
export async function startServer(port=0){
 const manifest=await buildManifest(),routes=new Map([['/',path.join(ROOT,'index.html')],['/desktop',path.join(ROOT,'index.html')],['/styles.css',path.join(ROOT,'styles.css')],['/assets/v60.glb',manifest.model.path],['/data/attachments.json',path.join(ROOT,'data/attachments.json')],['/data/badge-attachment.json',path.join(ROOT,'data/badge-attachment.json')]]);
 routes.set('/assets/v60-spiral-mask.bin',path.resolve(ROOT,'../dorms-v60-final-shoulder/models/spiral-mask.bin'));
 for(const p of manifest.props.filter(p=>p.slot))routes.set(`/runtime-props/${p.id}.png`,path.join(ROOT,'data/prop-textures',p.id+'.png'));
 for(const b of manifest.badges){routes.set(b.modelUrl,b.model);routes.set('/runtime-badges/'+b.id+'.png',path.join(ROOT,'data/badge-textures',b.id+'.png'));}
 for(const a of manifest.expressions){routes.set(a.modelUrl,a.model);routes.set(a.textureUrl,a.texture);routes.set(a.referenceUrl,a.qa.front.path);}for(const [name,a]of Object.entries(manifest.corrections))routes.set('/data/'+name+'.bin',a.path);for(const p of manifest.props)routes.set(p.modelUrl,p.model);for(const s of manifest.seasons)routes.set(s.textureUrl,s.texture);
 const server=http.createServer(async(req,res)=>{const pathname=(req.url??'/').split('?')[0],json=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};if(!['GET','HEAD'].includes(req.method))return json(405,{error:'read-only'});if(pathname==='/favicon.ico')return res.writeHead(204).end();if(pathname==='/api/manifest')return json(200,manifest);if(pathname==='/api/health')return json(200,{ok:true,version:'V98',count:34});let file=routes.get(pathname);
 for(const [prefix,dir]of [['/src/',path.join(ROOT,'src')],...['87-integrated-review-showcase','88-expression-transfer-pilot','89-v60-neutral-face','90-v60-expression-set'].map(v=>['/v'+v.slice(0,2)+'/',path.resolve(ROOT,'../dorms-v'+v+'/src')]),['/vendor/',path.join(WORKSPACE,'node_modules/three')]])if(!file)file=resolveSafePrefix(req.url,prefix,dir);
 if(!file)return json(404,{error:'not found'});try{const info=await stat(file);if(!info.isFile())return json(404,{error:'not a file'});res.writeHead(200,{'content-type':contentTypeFor(file),'content-length':info.size,'cache-control':'no-store','x-content-type-options':'nosniff'});if(req.method==='HEAD')return res.end();createReadStream(file).on('error',()=>res.destroy()).pipe(res);}catch{json(404,{error:'not found'});}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return {server,url:`http://127.0.0.1:${server.address().port}`,manifest};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DOREUMI_PORT ?? 43198);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('DOREUMI_PORT must be between 0 and 65535');
  const { url } = await startServer(port);
  console.log(url);
}
