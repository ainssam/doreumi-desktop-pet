export function validateApproval(approval,manifest) {
 const entries=approval?.assets;if(!Array.isArray(entries)||new Set(entries.map(a=>a.id)).size!==entries.length)throw new Error('승인 목록 오류');
 for(const a of manifest.expressions){const p=entries.find(x=>x.id===a.id);if(!p||p.decision!=='pass'||p.modelSHA256!==a.modelSHA256||p.textureSHA256!==a.textureSHA256)throw new Error('승인/해시 불일치: '+a.id);}
}
