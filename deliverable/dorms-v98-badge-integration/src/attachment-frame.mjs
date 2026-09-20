import {Matrix4,Vector3} from 'three';
export function surfaceFrame(points,weights,expectedNormal){
 if(points.length!==3||weights.length!==3||points.some(p=>!p.toArray().every(Number.isFinite))||weights.some(w=>!Number.isFinite(w)||w<0)||Math.abs(weights.reduce((s,w)=>s+w,0)-1)>1e-6)throw new Error('부착 좌표 오류');
 const x=new Vector3().subVectors(points[1],points[0]),z=new Vector3().crossVectors(x,new Vector3().subVectors(points[2],points[0]));
 if(x.lengthSq()<1e-14||z.lengthSq()<1e-16)throw new Error('부착 표면이 퇴화함');x.normalize();z.normalize();if(expectedNormal&&(!expectedNormal.toArray().every(Number.isFinite)||expectedNormal.lengthSq()<1e-10||z.dot(expectedNormal.clone().normalize())<=0))throw new Error('부착 표면 방향이 뒤집힘');const y=new Vector3().crossVectors(z,x),p=new Vector3();points.forEach((v,i)=>p.addScaledVector(v,weights[i]));return new Matrix4().makeBasis(x,y,z).setPosition(p);
}
