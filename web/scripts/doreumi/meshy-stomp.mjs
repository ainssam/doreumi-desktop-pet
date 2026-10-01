import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export const STOMP_ACTIONS=new Set([255,256]);
const UP=new Vector3(0,1,0),FORWARD=new Vector3(0,0,1);
const smooth=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};

function frame(direction,pole) {
  const x=direction.clone().normalize(),y=pole.clone().addScaledVector(x,-pole.dot(x)).normalize();
  if(y.lengthSq()<.5)throw new Error('Stomp leg plane became singular');
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x,y,x.clone().cross(y).normalize()));
}

/** Amplify the two inspected small left-foot stomps using their actual skin
 * lift, preserving event timing, the other leg and both short segment lengths.
 * No root/body translation, local scale or donor geometry is introduced. */
export function adaptStomp(target,metadata,sourceTime,sourceDuration,update,footSampler) {
  if(!STOMP_ACTIONS.has(metadata.actionId))return {active:false,maxReachClamp:0};
  if(!footSampler)throw new Error('Stomp adaptation requires actual target foot-surface samples');
  const feet=footSampler.sample(target),minimum=side=>Math.min(...feet[side].map(point=>point[1]));
  const liftBefore=minimum('L')-minimum('R');
  // The original .05-unit lift lasts too briefly and tucks behind the belly.
  // Preserve its main 1.2-second accent, with a short readable preparation/hold.
  const accent=smooth((sourceTime-.97)/.18)*smooth((1.43-sourceTime)/.18);
  const weight=Math.max(smooth((liftBefore-.007)/.048),accent);
  if(weight<=1e-8)return {active:false,maxReachClamp:0,liftBefore,liftAfter:liftBefore,weight};
  const thigh=target.byName.get('thighL'),knee=target.byName.get('kneeL'),foot=target.byName.get('footL');
  const thighBefore=thigh.quaternion.clone(),kneeBefore=knee.quaternion.clone(),footWorld=foot.worldQuaternion.clone();
  const upper=knee.position.clone(),lower=foot.position.clone(),a=upper.length(),b=lower.length();
  // Keep the foot in front of the belly silhouette while raised. The target
  // depth is limited by the measured two-segment reach, never a stretched bone.
  const origin=thigh.worldPosition.clone(),forward=FORWARD.clone().applyQuaternion(target.byName.get('body').worldQuaternion);forward.y=0;forward.normalize();
  const right=UP.clone().cross(forward),goalY=foot.worldPosition.y+minimum('R')+.14+Math.min(.055,Math.max(0,liftBefore))-minimum('L');
  const dy=goalY-origin.y,lateral=.045,depth=Math.min(.27,Math.sqrt(Math.max(0,(a+b-.012)**2-dy*dy-lateral*lateral)));
  const goal=origin.clone().addScaledVector(right,lateral).addScaledVector(forward,depth);goal.y=goalY;
  const direction=goal.clone().sub(origin);
  const requested=direction.length(),distance=Math.max(Math.abs(a-b)+.001,Math.min(a+b-.001,requested));direction.normalize();
  const worldPole=FORWARD.clone().applyQuaternion(target.byName.get('body').worldQuaternion);
  worldPole.addScaledVector(direction,-worldPole.dot(direction)).normalize();
  const along=(a*a-b*b+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,a*a-along*along));
  const kneeGoal=origin.clone().addScaledVector(direction,along).addScaledVector(worldPole,bend);
  const reachable=origin.clone().addScaledVector(direction,distance);
  // Construct absolute bone frames from the unchanged bind axes. Successive
  // shortest-arc rotations would leave an unconstrained accumulated twist.
  const upperWorld=frame(kneeGoal.clone().sub(origin),worldPole).multiply(frame(upper,FORWARD).invert());
  thigh.quaternion.copy(thigh.parent.worldQuaternion.clone().invert().multiply(upperWorld));update();
  const lowerWorld=frame(reachable.clone().sub(kneeGoal),worldPole).multiply(frame(lower,FORWARD).invert());
  knee.quaternion.copy(knee.parent.worldQuaternion.clone().invert().multiply(lowerWorld));update();
  const thighGoal=thigh.quaternion.clone(),kneeGoalRotation=knee.quaternion.clone();
  thigh.quaternion.copy(thighBefore.slerp(thighGoal,weight));
  knee.quaternion.copy(kneeBefore.slerp(kneeGoalRotation,weight));update();
  foot.quaternion.copy(foot.parent.worldQuaternion.clone().invert().multiply(footWorld));update();
  // A large simultaneous head nod hid the tiny leg in the 128-pixel avatar.
  // Keep the angry yaw/roll while reducing pitch during the foot accent.
  for(const [name,reduction]of [['torso',.35],['head',.65]]) {
    const node=target.byName.get(name),euler=new Euler().setFromQuaternion(node.quaternion);euler.x*=1-reduction*weight;
    node.quaternion.setFromEuler(euler);
  }
  update();
  const adapted=footSampler.sample(target),liftAfter=Math.min(...adapted.L.map(point=>point[1]))-Math.min(...adapted.R.map(point=>point[1]));
  return {active:true,maxReachClamp:Math.max(0,requested-a-b),liftBefore,liftAfter,weight};
}
