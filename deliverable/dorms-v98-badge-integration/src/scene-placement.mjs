import {Vector3} from 'three';
export function sceneActionAllowed(id,action){return !!SCENE_CONFIGS[id]&&['Idle',SCENE_CONFIGS[id].action].includes(action);}
export function placeSceneAsset(bounds,config){const size=bounds.getSize(new Vector3()),span=Math.max(size.x,size.y,size.z);if(!Number.isFinite(span)||span<=0)throw new Error('Invalid source bounds');const scale=config.size/span,c=bounds.getCenter(new Vector3());return {scale,position:[(config.x??0)-c.x*scale,(config.support??.004)-bounds.min.y*scale,(config.z??0)-c.z*scale]};}
export const SCENE_CONFIGS=Object.freeze({
 'podium-microphone':{size:1.05,x:0,z:.78,action:'Wave',note:'연단 배치 + 기존 인사 동작; 음성/립싱크 없음'},
 globe:{size:.65,x:1,z:.25,support:.48,action:'Showcase',note:'검수 받침대 위 지구본 + 소개 자세; 직접 회전 조작 아님'},
 guitar:{size:1.0,x:1,z:.15,action:'Idle',note:'옆에 세워 둔 배치형; 운지/연주 미구현'},
 microscope:{size:.60,x:1,z:.30,support:.48,action:'Idle',note:'검수 받침대 위 현미경 배치; 접안 동작 미구현'},
 chalkboard:{size:1.10,x:1.45,z:-.10,action:'Showcase',note:'칠판 간격 수정 + 소개 자세; 사용자 재검수 대기 / 필기 동작 미구현'},
 'puzzle-stack':{size:.44,x:.85,z:.35,support:.40,action:'Idle',note:'검수 받침대 위 퍼즐 배치; 조각 조립 미구현'},
 laptop:{size:.74,x:0,z:.64,support:.44,rotation:[0,Math.PI,0],action:'Code',note:'V42 컴퓨터 복구 + 승인 Code; 검수 받침대 사용, 키별 타건 접촉 미검증'},
 'book-v3':{size:.76,x:0,z:.64,support:.50,action:'Read',note:'V42 수정 책 V3 복구 + 승인 Read; 받침대 위 독서, 페이지 넘김 미구현'}
});
