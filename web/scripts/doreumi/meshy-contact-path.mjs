/** Offline convex root trajectory solve. Stance goals remain fixed; the pelvis
 * moves inside the simultaneous fixed-length leg reach spheres. No rig edits. */
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((value,index)=>value-b[index]);
const length=a=>Math.hypot(...a);
const distance=(a,b)=>length(sub(a,b));
const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const ballProjection=(point,ball)=>{
  const delta=sub(point,ball.center),size=length(delta);
  return size<=ball.radius?[...point]:ball.center.map((value,index)=>value+delta[index]*ball.radius/size);
};
const inside=(point,ball)=>distance(point,ball.center)<=ball.radius+1e-11;

function lensCircle(a,b) {
  const delta=sub(b.center,a.center),d=length(delta),axis=delta.map(value=>value/d);
  const along=(a.radius*a.radius-b.radius*b.radius+d*d)/(2*d);
  return {axis,center:a.center.map((value,index)=>value+along*axis[index]),radius:Math.sqrt(Math.max(0,a.radius*a.radius-along*along))};
}

/** Exact Euclidean projection onto a nonempty intersection of up to two balls.
 * If neither individual projection is feasible, both boundaries are active and
 * the solution is the nearest point on their intersection circle. */
function projectLens(point,balls,plane=false) {
  if(!balls.length)return [...point];
  if(balls.length===1)return ballProjection(point,balls[0]);
  const [a,b]=balls;
  const onA=ballProjection(point,a);if(inside(onA,b))return onA;
  const onB=ballProjection(point,b);if(inside(onB,a))return onB;
  const centerDistance=distance(a.center,b.center);
  if(centerDistance<=Math.abs(a.radius-b.radius)+1e-12)return ballProjection(point,a.radius<=b.radius?a:b);
  const circle=lensCircle(a,b),delta=sub(point,circle.center),along=dot(delta,circle.axis);
  let radial=delta.map((value,index)=>value-along*circle.axis[index]),size=length(radial);
  if(size<1e-12) {
    const seed=plane?[0,1,0]:Math.abs(circle.axis[0])<.8?[1,0,0]:[0,0,1];
    // In an XZ disk the circle intersection has two points in the same plane.
    radial=plane?[-circle.axis[2],0,circle.axis[0]]:seed.map((value,index)=>value-dot(seed,circle.axis)*circle.axis[index]);size=length(radial);
  }
  return circle.center.map((value,index)=>value+circle.radius*radial[index]/size);
}

function maximumLensY(balls) {
  if(!balls.length)return Infinity;
  for(const ball of balls) {
    const top=[ball.center[0],ball.center[1]+ball.radius,ball.center[2]];
    if(balls.every(other=>inside(top,other)))return top[1];
  }
  const circle=lensCircle(balls[0],balls[1]);
  return circle.center[1]+circle.radius*Math.sqrt(Math.max(0,1-circle.axis[1]*circle.axis[1]));
}

function compileFrame(frame,index,reachScale) {
  if(!vector(frame.rawRoot)||!Array.isArray(frame.contacts)||frame.contacts.length>2)throw new Error(`Invalid root-path frame ${index}`);
  if(frame.minimumRootY!==undefined&&!Number.isFinite(frame.minimumRootY))throw new Error(`Invalid root floor ${index}`);
  const balls=frame.contacts.map(contact=>{
    if(!vector(contact.ankleGoal)||!vector(contact.hipOffset)||!Number.isFinite(contact.reach)||contact.reach<=0)throw new Error(`Invalid stance sphere ${index}`);
    return {center:sub(contact.ankleGoal,contact.hipOffset),radius:contact.reach*reachScale,reach:contact.reach,side:contact.side};
  });
  const gap=balls.length===2?Math.max(0,distance(balls[0].center,balls[1].center)-balls[0].radius-balls[1].radius):0;
  // Produce a finite diagnostic path for impossible constraints, but evaluate
  // feasibility against the original spheres and explicitly report the gap.
  const projectionBalls=gap?balls.map(ball=>({...ball,radius:ball.radius+gap/2+1e-12})):balls;
  const ceiling=maximumLensY(projectionBalls),floorConflict=frame.minimumRootY===undefined?0:Math.max(0,frame.minimumRootY-ceiling);
  return {...frame,balls,projectionBalls,gap,floorConflict,project(point){
    const first=projectLens(point,projectionBalls);
    if(frame.minimumRootY===undefined||first[1]>=frame.minimumRootY)return first;
    if(floorConflict>1e-10)return [first[0],frame.minimumRootY,first[2]];
    const level=frame.minimumRootY,disks=projectionBalls.map(ball=>({...ball,center:[ball.center[0],level,ball.center[2]],radius:Math.sqrt(Math.max(0,ball.radius*ball.radius-(level-ball.center[1])**2))}));
    const result=projectLens([point[0],level,point[2]],disks,true);result[1]=level;return result;
  }};
}

function objective(values,raw,smoothness,stride=3) {
  let result=0;for(let index=0;index<values.length;index++)result+=(values[index]-raw[index])**2;
  for(let index=stride;index<values.length-stride;index++)result+=smoothness*(values[index-stride]-2*values[index]+values[index+stride])**2;
  return result/2;
}

function gradient(values,raw,smoothness,stride=3) {
  const result=Float64Array.from(values,(value,index)=>value-raw[index]);
  for(let index=stride;index<values.length-stride;index++) {
    const curvature=smoothness*(values[index-stride]-2*values[index]+values[index+stride]);
    result[index-stride]+=curvature;result[index]-=2*curvature;result[index+stride]+=curvature;
  }
  return result;
}

function kinematics(path,times) {
  let maximumSpeed=0,maximumAcceleration=0;
  for(let index=1;index<path.length;index++)maximumSpeed=Math.max(maximumSpeed,distance(path[index],path[index-1])/(times[index]-times[index-1]));
  for(let index=1;index<path.length-1;index++) {
    const before=times[index]-times[index-1],after=times[index+1]-times[index];
    const acceleration=path[index].map((value,axis)=>2*((path[index+1][axis]-value)/after-(value-path[index-1][axis])/before)/(before+after));
    maximumAcceleration=Math.max(maximumAcceleration,length(acceleration));
  }
  return {maximumSpeed,maximumAcceleration};
}

/** Minimize .5*sum(|root-raw|²) + .5*smoothness*sum(|secondDifference|²).
 * The source sampling is uniform; optional frame.time is used for diagnostics.
 * Contacts must contain planted-core ankles only, never a releasing swing foot.
 * minimumRootY may include a measured non-leg body envelope. It must not encode
 * the old, uncorrected calf penetration as an immutable floor constraint. */
export function solveContactRootPath(frames,{reachScale=.98,smoothness=40,maxIterations=1200,tolerance=1e-7,fps=30}={}) {
  if(!Array.isArray(frames)||!frames.length||!(reachScale>0&&reachScale<=1)||!Number.isFinite(smoothness)||smoothness<0
    ||!Number.isSafeInteger(maxIterations)||maxIterations<1||!Number.isFinite(tolerance)||tolerance<=0||!Number.isFinite(fps)||fps<=0)throw new Error('Invalid root-path options');
  const compiled=frames.map((frame,index)=>compileFrame(frame,index,reachScale));
  const times=frames.map((frame,index)=>frame.time??index/fps);
  if(times.some((time,index)=>!Number.isFinite(time)||(index&&time<=times[index-1])))throw new Error('Root-path times must increase');
  const raw=new Float64Array(frames.flatMap(frame=>frame.rawRoot)),project=values=>{
    const result=new Float64Array(values.length);for(let index=0;index<frames.length;index++)result.set(compiled[index].project(Array.from(values.slice(index*3,index*3+3))),index*3);return result;
  };
  let current=project(raw),accelerated=current.slice(),factor=1,previousObjective=objective(current,raw,smoothness),iteration=0,maximumChange=Infinity;
  const initial=current.slice(),step=1/(1+16*smoothness);
  for(;iteration<maxIterations;iteration++) {
    let derivative=gradient(accelerated,raw,smoothness),next=project(Float64Array.from(accelerated,(value,index)=>value-step*derivative[index]));
    let nextObjective=objective(next,raw,smoothness);
    if(nextObjective>previousObjective+1e-12) {
      factor=1;accelerated=current.slice();derivative=gradient(accelerated,raw,smoothness);
      next=project(Float64Array.from(accelerated,(value,index)=>value-step*derivative[index]));nextObjective=objective(next,raw,smoothness);
    }
    maximumChange=0;for(let index=0;index<next.length;index++)maximumChange=Math.max(maximumChange,Math.abs(next[index]-current[index]));
    const nextFactor=(1+Math.sqrt(1+4*factor*factor))/2,momentum=(factor-1)/nextFactor;
    accelerated=Float64Array.from(next,(value,index)=>value+momentum*(value-current[index]));current=next;factor=nextFactor;previousObjective=nextObjective;
    if(maximumChange<tolerance){iteration++;break;}
  }
  const toPath=values=>frames.map((_,index)=>Array.from(values.slice(index*3,index*3+3))),rootPath=toPath(current);
  let maximumConstraintViolation=0,maximumReachRatio=0,maximumOffset=0;
  const infeasibleFrames=[];
  for(let index=0;index<frames.length;index++) {
    const frame=compiled[index],root=rootPath[index];
    const reachViolations=frame.balls.map(ball=>{const actual=distance(root,ball.center);maximumReachRatio=Math.max(maximumReachRatio,actual/ball.reach);return {side:ball.side,violation:Math.max(0,actual-ball.radius)};});
    const violation=Math.max(0,...reachViolations.map(item=>item.violation),frame.minimumRootY===undefined?0:frame.minimumRootY-root[1]);
    maximumConstraintViolation=Math.max(maximumConstraintViolation,violation);maximumOffset=Math.max(maximumOffset,distance(root,frame.rawRoot));
    if(violation>tolerance*10||frame.gap>tolerance*10||frame.floorConflict>tolerance*10)infeasibleFrames.push({index,time:times[index],violation,sphereGap:frame.gap,floorConflict:frame.floorConflict,reachViolations});
  }
  const derivative=gradient(current,raw,smoothness),stationary=project(Float64Array.from(current,(value,index)=>value-step*derivative[index]));
  const optimalityResidual=Math.max(...current.map((value,index)=>Math.abs(value-stationary[index])));
  return {rootPath,report:{version:1,method:'exact-reach-lens-projection-and-global-curvature-minimization',reachScale,smoothness,
    feasible:infeasibleFrames.length===0,converged:optimalityResidual<tolerance*2,iterations:iteration,maximumChange,optimalityResidual,
    maximumConstraintViolation,maximumReachRatio,maximumOffset,infeasibleFrames,objective:previousObjective,
    ...kinematics(rootPath,times),rawMaximumAcceleration:kinematics(frames.map(frame=>frame.rawRoot),times).maximumAcceleration,
    projectedMaximumAcceleration:kinematics(toPath(initial),times).maximumAcceleration}};
}

/** Plan one constant XZ landing offset for an entire contact phase. The other
 * planted foot remains fixed. Every future double-stance frame contributes a
 * disk: |(movingCenter-otherCenter).xz + offset|² <= (reachSum)²-deltaY².
 * A measured minimumRootY restricts that disk to a horizontal slice above the
 * actual non-leg body envelope, rather than forcing a sphere-tangent pelvis
 * that is reachable but penetrates the floor.
 * Dykstra projection finds the feasible offset nearest zero; the caller applies
 * it before contact, then keeps exactly the same offset through planted core. */
export function planContactPhaseOffset(frames,side,{reachScale=.98,maxOffset=.35,maxIterations=5000,tolerance=1e-8}={}) {
  if(!Array.isArray(frames)||!frames.length||!['L','R'].includes(side)||!(reachScale>0&&reachScale<=1)
    ||!Number.isFinite(maxOffset)||maxOffset<=0||!Number.isSafeInteger(maxIterations)||maxIterations<1||!Number.isFinite(tolerance)||tolerance<=0)throw new Error('Invalid contact-phase options');
  const disks=[];let maximumVerticalDeficit=0,maximumFloorDeficit=0;
  frames.forEach((frame,index)=>{
    const compiled=compileFrame(frame,index,reachScale);
    const moving=compiled.balls.find(ball=>ball.side===side),other=compiled.balls.find(ball=>ball.side!==side);
    if(!moving||!other)return;
    const delta=sub(moving.center,other.center),reach=moving.radius+other.radius;
    maximumVerticalDeficit=Math.max(maximumVerticalDeficit,Math.abs(delta[1])-reach);
    let radius=Math.sqrt(Math.max(0,reach*reach-delta[1]*delta[1]));
    if(frame.minimumRootY!==undefined) {
      const ceiling=Math.min(moving.center[1]+moving.radius,other.center[1]+other.radius);
      maximumFloorDeficit=Math.max(maximumFloorDeficit,frame.minimumRootY-ceiling);
      const widestY=(other.radius*moving.center[1]+moving.radius*other.center[1])/reach;
      if(frame.minimumRootY>widestY) {
        const sliceRadius=ball=>Math.sqrt(Math.max(0,ball.radius*ball.radius-(frame.minimumRootY-ball.center[1])**2));
        radius=sliceRadius(moving)+sliceRadius(other);
      }
    }
    disks.push({center:[-delta[0],-delta[2]],radius,index});
  });
  const contactConstraintCount=disks.length;
  disks.push({center:[0,0],radius:maxOffset,index:-1});
  const corrections=disks.map(()=>[0,0]);let point=[0,0],iteration=0,maximumConstraintViolation=Infinity,maximumChange=Infinity;
  for(;iteration<maxIterations;iteration++) {
    const before=[...point];
    for(let index=0;index<disks.length;index++) {
      const disk=disks[index],candidate=point.map((value,axis)=>value+corrections[index][axis]),delta=candidate.map((value,axis)=>value-disk.center[axis]),size=Math.hypot(...delta);
      const projected=size<=disk.radius?candidate:disk.center.map((value,axis)=>value+delta[axis]*disk.radius/size);
      corrections[index]=candidate.map((value,axis)=>value-projected[axis]);point=projected;
    }
    maximumChange=Math.hypot(point[0]-before[0],point[1]-before[1]);
    maximumConstraintViolation=Math.max(0,...disks.map(disk=>Math.hypot(point[0]-disk.center[0],point[1]-disk.center[1])-disk.radius));
    if(maximumChange<tolerance&&maximumConstraintViolation<tolerance){iteration++;break;}
  }
  const infeasibleFrames=disks.filter(disk=>disk.index>=0).map(disk=>({index:disk.index,violation:Math.max(0,Math.hypot(point[0]-disk.center[0],point[1]-disk.center[1])-disk.radius)})).filter(frame=>frame.violation>tolerance*10);
  return {offset:[point[0],0,point[1]],report:{version:1,method:'constant-contact-phase-offset-from-future-reach-disks',side,reachScale,maxOffset,
    feasible:maximumConstraintViolation<tolerance*10&&maximumVerticalDeficit<tolerance*10&&maximumFloorDeficit<tolerance*10,
    converged:maximumChange<tolerance&&maximumConstraintViolation<tolerance,
    contactConstraintCount,iterations:iteration,maximumChange,maximumConstraintViolation,maximumVerticalDeficit,maximumFloorDeficit,
    offsetLength:Math.hypot(...point),infeasibleFrames}};
}

/** Optimize one continuous knee-plane angle branch inside measured skin-clear
 * intervals. The caller must measure the whole [minimum,maximum] interval;
 * the smallest clear angle does not prove all larger angles are also clear.
 * Angles are unwrapped radians. Empty intervals stay explicit failures. */
export function solveContactAnglePath(frames,{smoothness=80,maxIterations=1200,tolerance=1e-7,fps=30}={}) {
  if(!Array.isArray(frames)||!frames.length||!Number.isFinite(smoothness)||smoothness<0
    ||!Number.isSafeInteger(maxIterations)||maxIterations<1||!Number.isFinite(tolerance)||tolerance<=0||!Number.isFinite(fps)||fps<=0)throw new Error('Invalid angle-path options');
  for(const frame of frames)if(![frame.rawAngle,frame.minimum,frame.maximum].every(Number.isFinite))throw new Error('Invalid angle-path interval');
  const times=frames.map((frame,index)=>frame.time??index/fps);
  if(times.some((time,index)=>!Number.isFinite(time)||(index&&time<=times[index-1])))throw new Error('Angle-path times must increase');
  const raw=Float64Array.from(frames,frame=>frame.rawAngle),project=values=>Float64Array.from(values,(value,index)=>{
    const {minimum,maximum}=frames[index];return minimum>maximum?(minimum+maximum)/2:Math.max(minimum,Math.min(maximum,value));
  });
  let current=project(raw),accelerated=current.slice(),factor=1,previousObjective=objective(current,raw,smoothness,1),iteration=0,maximumChange=Infinity;
  const initial=current.slice(),step=1/(1+16*smoothness);
  for(;iteration<maxIterations;iteration++) {
    let derivative=gradient(accelerated,raw,smoothness,1),next=project(Float64Array.from(accelerated,(value,index)=>value-step*derivative[index]));
    let nextObjective=objective(next,raw,smoothness,1);
    if(nextObjective>previousObjective+1e-12) {
      factor=1;accelerated=current.slice();derivative=gradient(accelerated,raw,smoothness,1);
      next=project(Float64Array.from(accelerated,(value,index)=>value-step*derivative[index]));nextObjective=objective(next,raw,smoothness,1);
    }
    maximumChange=0;for(let index=0;index<next.length;index++)maximumChange=Math.max(maximumChange,Math.abs(next[index]-current[index]));
    const nextFactor=(1+Math.sqrt(1+4*factor*factor))/2,momentum=(factor-1)/nextFactor;
    accelerated=Float64Array.from(next,(value,index)=>value+momentum*(value-current[index]));current=next;factor=nextFactor;previousObjective=nextObjective;
    if(maximumChange<tolerance){iteration++;break;}
  }
  const angles=Array.from(current),violations=frames.map((frame,index)=>Math.max(0,frame.minimum-angles[index],angles[index]-frame.maximum));
  const infeasibleFrames=frames.flatMap((frame,index)=>frame.minimum>frame.maximum||violations[index]>tolerance*10?[{index,time:times[index],minimum:frame.minimum,maximum:frame.maximum,violation:violations[index]}]:[]);
  const derivative=gradient(current,raw,smoothness,1),stationary=project(Float64Array.from(current,(value,index)=>value-step*derivative[index]));
  const optimalityResidual=Math.max(...current.map((value,index)=>Math.abs(value-stationary[index]))),path=values=>Array.from(values,value=>[value,0,0]);
  return {angles,report:{version:1,method:'skin-clear-angle-intervals-and-global-curvature-minimization',smoothness,
    feasible:infeasibleFrames.length===0,converged:optimalityResidual<tolerance*2,iterations:iteration,maximumChange,optimalityResidual,
    maximumConstraintViolation:Math.max(...violations),maximumOffset:Math.max(...current.map((value,index)=>Math.abs(value-raw[index]))),infeasibleFrames,objective:previousObjective,
    ...kinematics(path(current),times),rawMaximumAcceleration:kinematics(path(raw),times).maximumAcceleration,
    projectedMaximumAcceleration:kinematics(path(initial),times).maximumAcceleration}};
}
