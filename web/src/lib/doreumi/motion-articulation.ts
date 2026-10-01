import { AnimationClip, Euler, LinearInterpolant, Object3D, Quaternion, QuaternionKeyframeTrack, QuaternionLinearInterpolant, Vector3, VectorKeyframeTrack } from 'three';
import { doreumiRigData } from '@/lib/doreumi/motion-rig';
import { DOREUMI_GAIT } from '@/lib/doreumi/motion-gait';
import { sampleSnowmanMotion } from '@/lib/doreumi/motion-snowman';
import { DOREUMI_LAP } from '@/lib/doreumi/motion-lap';

const TAU = Math.PI * 2;
const ease = (v: number) => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
const envelope = (t: number, d: number) => ease(t / .4) * ease((d - t) / .5);
function worldQuaternion(object: Object3D, quaternion: Quaternion) {
  object.quaternion.copy(object.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(quaternion)); object.updateWorldMatrix(false, true);
}
/** Two-bone solver preserves measured segment lengths; unreachable targets are
 * clamped, never stretched. The pole is explicitly chosen in character space. */
export function solveDoreumiLimb(upper: Object3D, lower: Object3D, end: Object3D, target: Vector3, pole: Vector3) {
  upper.updateWorldMatrix(true, true);
  const a = upper.getWorldPosition(new Vector3()), b = lower.getWorldPosition(new Vector3()), c = end.getWorldPosition(new Vector3());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c), desired = target.clone().sub(a);
  const distance = Math.min(l1 + l2 - .0002, Math.max(Math.abs(l1 - l2) + .0002, desired.length()));
  const axis = desired.lengthSq() > 1e-12 ? desired.normalize() : c.clone().sub(a).normalize();
  const side = pole.clone().addScaledVector(axis, -pole.dot(axis));
  if (side.lengthSq() < 1e-8) { side.set(Math.abs(axis.x) < .8 ? 1 : 0, 0, Math.abs(axis.x) < .8 ? 0 : 1); side.addScaledVector(axis, -side.dot(axis)); } side.normalize();
  const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
  const bend = a.clone().addScaledVector(axis, along).addScaledVector(side, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  const delta = new Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), bend.clone().sub(a).normalize());
  worldQuaternion(upper, delta.multiply(upper.getWorldQuaternion(new Quaternion())));
  const movedB = lower.getWorldPosition(new Vector3()), movedC = end.getWorldPosition(new Vector3()), reachable = a.clone().addScaledVector(axis, distance);
  const lowerDelta = new Quaternion().setFromUnitVectors(movedC.sub(movedB).normalize(), reachable.sub(movedB).normalize());
  worldQuaternion(lower, lowerDelta.multiply(lower.getWorldQuaternion(new Quaternion())));
  return end.getWorldPosition(new Vector3()).distanceTo(target);
}

/** Retarget the 21 creator motions into the corrected rest axes and author the
 * core actions on that same skeleton. Returned clips have no dependency on the
 * source skeleton; the offline builder uses this exact production code. */
export function articulateDoreumiClips(clips: AnimationClip[], root?: Object3D): AnimationClip[] {
  for (const [name, duration] of [['Dragged', 1.8], ['Falling', .8], ['Landing', .65]] as const) if (!clips.some(c => c.name === name)) clips.push(new AnimationClip(name, duration, []));
  if (!root) return clips;
  const rig = doreumiRigData(root); if (!rig) throw new Error('Doreumi master rig was not built');
  const lapSocket = root.getObjectByName('lap')!;
  const authoringRest: typeof rig.rest = { ...rig.rest, lap: { position: lapSocket.position.toArray(), quaternion: lapSocket.quaternion.toArray(), scale: lapSocket.scale.toArray(), parent: lapSocket.parent!.name, parentQuaternion: lapSocket.parent!.getWorldQuaternion(new Quaternion()).toArray() } };
  const objects = new Map(Object.keys(authoringRest).map(name => [name, root.getObjectByName(name)!]));
  const bone = (name: string) => { const value = objects.get(name); if (!value) throw new Error(`Missing Doreumi joint: ${name}`); return value; };
  const neutralRoot = clips.find(c => c.name === 'Idle')!.tracks.find(t => t.name === 'DoreumiRig.position')!.values[1];
  const reset = () => { for (const [name, object] of objects) { const rest = authoringRest[name]; object.position.fromArray(rest.position); object.quaternion.fromArray(rest.quaternion); object.scale.fromArray(rest.scale); } };
  const rotate = (name: string, x = 0, y = 0, z = 0) => bone(name).quaternion.setFromEuler(new Euler(x, y, z));
  const handTo = (side: string, amount: number, target: Vector3, pole = new Vector3(side === 'L' ? 1 : -1, -.2, -.1)) => {
    root.updateMatrixWorld(true); const wrist = bone(`wrist${side}`);
    solveDoreumiLimb(bone(`arm${side}`), bone(`elbow${side}`), wrist, wrist.getWorldPosition(new Vector3()).lerp(target, amount), pole);
  };
  const seated = (amount: number) => {
    bone('DoreumiRig').position.y = neutralRoot - .158 * amount;
    for (const side of ['L', 'R']) { rotate(`thigh${side}`, -1.12 * amount); rotate(`knee${side}`, .35 * amount); rotate(`foot${side}`, .77 * amount); }
  };
  const plantedCrouch = (amount: number) => {
    bone('DoreumiRig').position.y = neutralRoot - .075 * amount; rotate('torso', .15 * amount); rotate('head', -.08 * amount);
    for (const side of ['L', 'R']) {
      root.updateMatrixWorld(true);
      solveDoreumiLimb(bone(`thigh${side}`), bone(`knee${side}`), bone(`foot${side}`), new Vector3(side === 'L' ? .2675 : -.2675, .097, .065), new Vector3(0, 0, 1));
      worldQuaternion(bone(`foot${side}`), new Quaternion());
    }
  };
  const raisedHands = (amount: number, pulse = 0) => {
    for (const side of ['L', 'R']) {
      const sign = side === 'L' ? 1 : -1; rotate(`shoulder${side}`, -.06 * amount, 0, sign * .60 * amount);
      root.updateMatrixWorld(true); const arm = bone(`arm${side}`).getWorldPosition(new Vector3());
      handTo(side, amount, arm.add(new Vector3(sign * .035, .335 - pulse * .045, .075)), new Vector3(sign, 0, -.3));
      rotate(`wrist${side}`, -.12 * amount, 0, sign * .06 * pulse);
    }
  };
  const core = new Set(['Idle', 'Walk', 'Run', 'Wave', 'Code', 'Read', 'Sit', 'Lie', 'Think', 'Showcase', 'Stretch', 'Cheer', 'Jump', 'Joy', 'Roll', 'NewYearBow', 'Snowman', 'Dragged', 'Falling', 'Landing']);
  const output: AnimationClip[] = [];
  for (const clip of clips) {
    const steps = Math.ceil(clip.duration * (clip.name === 'Run' || clip.name === 'Walk' ? 90 : 30)), times = Array.from({ length: steps + 1 }, (_, i) => clip.duration * i / steps);
    const channels = clip.tracks.map(track => ({ name: track.name, sample: track.name.endsWith('.quaternion') ? new QuaternionLinearInterpolant(track.times, track.values, 4) : new LinearInterpolant(track.times, track.values, track.getValueSize()) }));
    const positions = new Map([...objects.keys()].map(name => [name, [] as number[]])), rotations = new Map([...objects.keys()].map(name => [name, [] as number[]])), scales = new Map([...objects.keys()].map(name => [name, [] as number[]]));
    for (const t of times) {
      reset(); bone('DoreumiRig').position.set(0, neutralRoot, 0);
      if (!core.has(clip.name)) {
        for (const channel of channels) {
          const split = channel.name.lastIndexOf('.'), name = channel.name.slice(0, split), property = channel.name.slice(split + 1), object = objects.get(name), source = rig.source[name];
          if (!object || !source) continue;
          const value = channel.sample.evaluate(t);
          if (property === 'quaternion') {
            const parentBasis = new Quaternion().fromArray(source.parentQuaternion);
            object.quaternion.copy(parentBasis).multiply(new Quaternion().fromArray(value).multiply(new Quaternion().fromArray(source.quaternion).invert())).multiply(parentBasis.invert());
          } else if (property === 'scale') object.scale.fromArray(value);
          else if (property === 'position') {
            if (name === 'DoreumiRig') object.position.set(0, value[1], 0);
            else object.position.add(new Vector3().fromArray(value).sub(new Vector3().fromArray(source.position)).applyQuaternion(new Quaternion().fromArray(source.parentQuaternion)));
          }
        }
        // Source arm and shoulder were siblings. Preserve the arm's intended
        // orientation while making the new collar a genuine parent.
        for (const side of ['L', 'R']) {
          bone(`arm${side}`).quaternion.premultiply(bone(`shoulder${side}`).quaternion.clone().invert());
          bone(`knee${side}`).quaternion.copy(bone(`shin${side}`).quaternion); bone(`shin${side}`).quaternion.identity();
        }
      } else {
        const phase = TAU * t / clip.duration;
        if (clip.name === 'Idle') {
          rotate('torso', .009 * Math.sin(phase), .012 * Math.sin(phase), .008 * Math.sin(phase));
          rotate('head', -.007 * Math.sin(phase), -.009 * Math.sin(phase), -.012 * Math.sin(phase));
          for (const side of ['L', 'R']) rotate(`elbow${side}`, -.025 * (1 - Math.cos(phase)));
        } else if (clip.name === 'Walk' || clip.name === 'Run') {
          const run = clip.name === 'Run', gait = DOREUMI_GAIT[run ? 'Run' : 'Walk'], cycle = TAU * t / gait.cycleSeconds, stride = gait.stride, duty = gait.stanceFraction;
          bone('DoreumiRig').position.y = neutralRoot - (run ? .040 : .026) + (run ? .025 : .012) * (1 - Math.cos(2 * cycle)) / 2;
          bone('body').position.x += (run ? .018 : .012) * Math.sin(cycle);
          rotate('body', run ? .035 : 0, .045 * Math.sin(cycle), (run ? .040 : .025) * Math.sin(cycle));
          rotate('torso', (run ? .12 : .04) + (run ? .02 : .01) * Math.sin(2 * cycle), -.075 * Math.sin(cycle), -.025 * Math.sin(cycle));
          rotate('head', (run ? -.045 : -.02) + .014 * Math.sin(2 * cycle - .45), .03 * Math.sin(cycle - .4), -.02 * Math.sin(cycle - .4));
          for (const side of ['L', 'R']) {
            const sign = side === 'L' ? 1 : -1, u = ((t / gait.cycleSeconds + (sign < 0 ? .5 : 0)) % 1 + 1) % 1;
            const swing = u >= duty, fraction = swing ? (u - duty) / (1 - duty) : u / duty;
            const z = swing ? -stride / 2 + stride * ease(fraction) : stride / 2 - stride * fraction;
            const lift = swing ? gait.lift * Math.sin(Math.PI * fraction) : 0;
            const armPhase = cycle + (sign < 0 ? Math.PI : 0);
            rotate(`shoulder${side}`, (run ? .10 : .04) * Math.cos(armPhase), 0, sign * .025 * Math.sin(armPhase));
            rotate(`arm${side}`, (run ? .65 : .30) * Math.cos(armPhase), 0, sign * (run ? .035 : .015));
            rotate(`elbow${side}`, run ? -.75 - .12 * Math.sin(armPhase) : -.16 - .04 * Math.sin(armPhase));
            root.updateMatrixWorld(true);
            const ankle = new Vector3(sign * .2675, .097 + lift, .065 + z);
            solveDoreumiLimb(bone(`thigh${side}`), bone(`knee${side}`), bone(`foot${side}`), ankle, new Vector3(0, 0, 1));
            worldQuaternion(bone(`foot${side}`), new Quaternion().setFromEuler(new Euler(swing ? -.20 * Math.sin(Math.PI * fraction) : 0, 0, 0)));
          }
        } else if (clip.name === 'Wave') {
          const amount = envelope(t, clip.duration); rotate('torso', 0, -.06 * amount, .035 * amount); rotate('head', 0, .045 * amount, -.09 * amount);
          root.updateMatrixWorld(true);
          const hand = bone('wristR').getWorldPosition(new Vector3()), shoulder = bone('armR').getWorldPosition(new Vector3());
          const target = new Vector3(-.66 - .025 * Math.sin(t * 7), shoulder.y + .29, .08);
          solveDoreumiLimb(bone('armR'), bone('elbowR'), bone('wristR'), hand.lerp(target, amount), new Vector3(-1, 0, -.2));
          worldQuaternion(bone('wristR'), new Quaternion().setFromEuler(new Euler(0, .13 * Math.sin(t * 7) * amount, -.18 * Math.sin(t * 7) * amount)));
        } else if (clip.name === 'Sit') {
          const amount = ease(t / 1.15); seated(amount); rotate('torso', .11 * amount); rotate('head', -.055 * amount, .016 * Math.sin(TAU * (t - 1.2) / 2.4) * amount);
          root.updateMatrixWorld(true);
          for (const side of ['L', 'R']) handTo(side, amount, root.getObjectByName('lap')!.localToWorld(new Vector3(side === 'L' ? .57 : -.57, .045, .015)));
        } else if (clip.name === 'Lie') {
          const sit = ease(t / .75), recline = ease((t - .65) / 1.15); seated(sit);
          bone('DoreumiRig').position.y -= .45 * recline; rotate('body', -Math.PI / 2 * recline); rotate('torso', -.04 * recline); rotate('head', (.055 + .008 * Math.sin(TAU * (t - 2.4) / 1.2)) * recline);
          for (const side of ['L', 'R']) {
            rotate(`thigh${side}`, -.22 * recline - 1.12 * sit * (1 - recline)); rotate(`knee${side}`, .32 * recline + .35 * sit * (1 - recline)); rotate(`foot${side}`, -.10 * recline + .77 * sit * (1 - recline));
            root.updateMatrixWorld(true); handTo(side, sit, bone('body').localToWorld(new Vector3(side === 'L' ? .48 : -.48, .28, .30)), new Vector3(side === 'L' ? 1 : -1, 0, .2));
          }
        } else if (clip.name === 'Think') {
          const amount = envelope(t, clip.duration), ponder = Math.sin(t * 2.4) * amount;
          bone('body').position.x += .023 * amount; rotate('torso', .02 * amount, -.045 * amount, -.025 * amount); rotate('head', .06 * amount, .07 * amount + .025 * ponder, -.12 * amount);
          rotate('shoulderR', -.12 * amount, 0, -.85 * amount); root.updateMatrixWorld(true);
          const head = bone('head').getWorldPosition(new Vector3());
          handTo('R', amount, new Vector3(-.425, head.y + .155 + .005 * ponder, .245), new Vector3(-1, -.1, -.2));
          rotate('wristR', -.1 * amount, 0, -.15 * amount); rotate('elbowL', -.1 * amount);
        } else if (clip.name === 'Showcase') {
          const amount = envelope(t, clip.duration), reveal = ease((t - .35) / .6), settle = Math.sin(t * 2) * amount;
          rotate('torso', .025 * amount, -.16 * amount * reveal, .025 * amount); rotate('head', -.025 * amount, .16 * amount * ease((t - .6) / .5), -.035 * amount);
          bone('body').position.x -= .016 * amount; rotate('shoulderL', -.12 * amount, 0, .18 * amount); root.updateMatrixWorld(true);
          const shoulder = bone('armL').getWorldPosition(new Vector3());
          handTo('L', amount, new Vector3(.83, shoulder.y + .10 + .007 * settle, .22), new Vector3(1, -.5, -.2)); rotate('wristL', -.3 * amount, .3 * amount); rotate('elbowR', -.14 * amount);
        } else if (clip.name === 'Stretch' || clip.name === 'Cheer') {
          const cheer = clip.name === 'Cheer', amount = ease(t / .8) * ease((clip.duration - t) / .75), pulse = cheer ? .5 + .5 * Math.sin(t * 8) : .5 + .5 * Math.sin(t * 2.3);
          plantedCrouch((cheer ? .16 : .06) * amount * pulse);
          rotate('torso', -.065 * amount + (cheer ? .035 * amount * pulse : 0), 0, .025 * amount * Math.sin(t * 2)); rotate('head', -.08 * amount, .02 * amount * Math.sin(t * 2), -.018 * amount * Math.sin(t * 2));
          raisedHands(amount, cheer ? pulse : .12 * pulse);
        } else if (clip.name === 'Jump' || clip.name === 'Joy') {
          const joy = clip.name === 'Joy', local = joy ? t < 3.6 ? (t % 1.8) / 1.8 : 1 : t / clip.duration;
          const crouch = local < .2 ? ease(local / .2) : local < .29 ? 1 - ease((local - .2) / .09) : local < .57 ? 0 : local < .67 ? ease((local - .57) / .10) : 1 - ease((local - .67) / .17);
          const airborne = local >= .29 && local <= .57, flight = airborne ? (local - .29) / .28 : 0, lift = airborne ? (joy ? .18 : .31) * 4 * flight * (1 - flight) : 0;
          plantedCrouch(crouch); bone('DoreumiRig').position.y += lift;
          const reach = ease((local - .18) / .12) * (1 - ease((local - .61) / .20)); raisedHands(.80 * reach, .3 * Math.sin(Math.PI * flight));
          if (airborne) for (const side of ['L', 'R']) { rotate(`thigh${side}`, -.22 * Math.sin(Math.PI * flight)); rotate(`knee${side}`, .38 * Math.sin(Math.PI * flight)); rotate(`foot${side}`, -.16 * Math.sin(Math.PI * flight)); }
          rotate('torso', .14 * crouch - .05 * reach); rotate('head', -.09 * crouch + .035 * Math.sin(Math.PI * flight));
        } else if (clip.name === 'Roll') {
          const down = ease(t / .95), up = ease((t - 3.05) / .85), lying = down * (1 - up), rolling = ease((t - .95) / 2.1), tuck = ease(t / .55) * (1 - up);
          bone('DoreumiRig').position.y = neutralRoot - .55 * lying;
          // Barrel roll after lying down: long axis stays horizontal, the center
          // translates while the arms and legs tuck, then feet help stand up.
          const qLie = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2 * lying);
          const qRoll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), TAU * rolling);
          bone('body').quaternion.copy(qRoll.multiply(qLie)); bone('body').position.x += .28 * Math.sin(Math.PI * rolling);
          rotate('torso', .14 * tuck); rotate('head', .11 * tuck);
          for (const side of ['L', 'R']) {
            rotate(`thigh${side}`, -.60 * tuck); rotate(`knee${side}`, .95 * tuck); rotate(`foot${side}`, -.35 * tuck);
            root.updateMatrixWorld(true); handTo(side, tuck, bone('body').localToWorld(new Vector3(side === 'L' ? .47 : -.47, .29, .26)), new Vector3(side === 'L' ? 1 : -1, 0, .1));
          }
        } else if (clip.name === 'NewYearBow') {
          const kneel = ease(t / 1.1) * (1 - ease((t - 5.6) / 1.2)), bow = ease((t - 1.1) / 1.2) * (1 - ease((t - 4.3) / 1.1));
          bone('DoreumiRig').position.y = neutralRoot - .18 * kneel; rotate('torso', .84 * bow); rotate('head', .12 * bow);
          for (const side of ['L', 'R']) {
            rotate(`thigh${side}`, -.70 * kneel); rotate(`knee${side}`, 2.1 * kneel); rotate(`foot${side}`, -1.4 * kneel);
            rotate(`shoulder${side}`, -.12 * bow); root.updateMatrixWorld(true);
            handTo(side, kneel, bone('body').localToWorld(new Vector3(side === 'L' ? .50 : -.50, .20 - .20 * bow, .27 + .10 * bow)), new Vector3(side === 'L' ? 1 : -1, -.5, -.2));
          }
        } else if (clip.name === 'Code' || clip.name === 'Read') {
          const name = clip.name, read = name === 'Read';
          const sit = ease(t / DOREUMI_LAP.sitSeconds), working = ease((t - DOREUMI_LAP.handsStartSeconds) / DOREUMI_LAP.handsSeconds);
          seated(sit);
          rotate('body', DOREUMI_LAP.pelvisPitch * sit);
          rotate('torso', (DOREUMI_LAP.torsoPitch[name] - DOREUMI_LAP.pelvisPitch) * sit);
          rotate('head', -.15 * sit + .008 * working * Math.sin(TAU * (t - 1.2) / 2.4), read ? .018 * working * Math.sin(TAU * (t - 1.2) / 2.4) : 0);
          for (const side of ['L', 'R']) {
            rotate(`thigh${side}`, -.8 * sit); rotate(`knee${side}`, 1.5 * sit); rotate(`foot${side}`, -.05 * sit);
          }
          root.updateMatrixWorld(true);
          const lap = lapSocket, position = new Vector3(...DOREUMI_LAP.position);
          if (read) position.y += DOREUMI_LAP.bookHeightOffset;
          lap.position.copy(lap.parent!.worldToLocal(root.localToWorld(position)));
          worldQuaternion(lap, root.getWorldQuaternion(new Quaternion()).multiply(new Quaternion().setFromEuler(new Euler(...DOREUMI_LAP.rotation))));
          lap.scale.set(...DOREUMI_LAP.scale); root.updateMatrixWorld(true);
          for (const side of ['L', 'R']) {
            const sign = side === 'L' ? 1 : -1, wrist = bone(`wrist${side}`), shoulder = bone(`shoulder${side}`);
            // Read keeps a slow, loop-aligned hold shift so the pose never freezes; the
            // 2.4s period matches the hold clip; the .008 lift stays well inside the .02 palm-contact budget.
            const tap = read ? DOREUMI_LAP.readingLift * (1 - Math.cos(TAU * (t - 1.2) / 2.4 + (sign < 0 ? Math.PI : 0))) / 2
              : DOREUMI_LAP.typingLift * (1 + Math.sin(TAU * (t - 1.2) / .4 + (sign < 0 ? Math.PI : 0))) / 2;
            const local = new Vector3(sign * DOREUMI_LAP.handWidth, DOREUMI_LAP.handHeight[name] + tap, DOREUMI_LAP.handDepth[name]);
            // Palms ride the tipped book page, turning with it around the hinge.
            if (read) local.sub(new Vector3(0, 0, DOREUMI_LAP.bookHingeZ)).applyAxisAngle(new Vector3(1, 0, 0), -DOREUMI_LAP.bookTilt).add(new Vector3(0, 0, DOREUMI_LAP.bookHingeZ));
            const target = lap.localToWorld(local);
            const orientation = lap.getWorldQuaternion(new Quaternion());
            // The lap socket is scaled (y 1, z .75), so the visible page tilt is steeper than bookTilt.
            if (read) orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.atan2(Math.sin(DOREUMI_LAP.bookTilt) * DOREUMI_LAP.scale[1], Math.cos(DOREUMI_LAP.bookTilt) * DOREUMI_LAP.scale[2])));
            target.sub(root.getObjectByName(`palm${side}`)!.position.clone().applyQuaternion(orientation));
            // Bring the collar toward the wrist goal before the two-bone solve.
            // Every sample starts at rest, so no twist accumulates between frames.
            const origin = shoulder.getWorldPosition(new Vector3());
            const axis = bone(`arm${side}`).getWorldPosition(new Vector3()).sub(origin).normalize();
            const authored = shoulder.getWorldQuaternion(new Quaternion());
            const aimed = new Quaternion().setFromUnitVectors(axis, target.clone().sub(origin).normalize()).multiply(authored);
            worldQuaternion(shoulder, authored.slerp(aimed, working));
            target.lerp(wrist.getWorldPosition(new Vector3()), 1 - working);
            solveDoreumiLimb(bone(`arm${side}`), bone(`elbow${side}`), wrist, target, new Vector3(sign * .3, 1, 0).applyQuaternion(root.getWorldQuaternion(new Quaternion())));
            worldQuaternion(wrist, wrist.getWorldQuaternion(new Quaternion()).slerp(orientation, working));
          }
        } else if (clip.name === 'Snowman') {
          const snow = sampleSnowmanMotion(t); plantedCrouch(snow.crouch);
          bone('body').position.x -= .02 * snow.working; rotate('torso', snow.lean, .10 * snow.working, .10 * snow.working);
          rotate('head', .12 * snow.working, -.24 * snow.working, -.045 * snow.working);
          rotate('shoulderR', 0, .60 * snow.working); rotate('elbowL', -.25 * snow.working); rotate('armL', -.07 * snow.working, 0, .10 * snow.working);
          root.updateMatrixWorld(true);
          const target = new Vector3().fromArray(snow.handPosition).sub(root.getObjectByName('palmR')!.position);
          handTo('R', snow.working, target, new Vector3(-1, -.4, -.2)); worldQuaternion(bone('wristR'), new Quaternion());
        } else if (clip.name === 'Dragged' || clip.name === 'Falling') {
          const fall = clip.name === 'Falling', swing = Math.sin(phase), lag = Math.sin(phase - .55);
          bone('body').position.x += (fall ? .035 : .11) * swing;
          rotate('body', (fall ? .05 : .035) * Math.sin(phase - .25), .035 * lag, (fall ? .055 : .12) * swing);
          rotate('torso', .045 * lag, 0, -.035 * lag); rotate('head', -.10 + .04 * Math.sin(phase - .7), .05 * lag, -.075 * lag);
          for (const side of ['L', 'R']) {
            const sign = side === 'L' ? 1 : -1, flutter = Math.sin(phase - .6 + sign * .35);
            rotate(`shoulder${side}`, -.035 * flutter, 0, sign * (fall ? .07 : .025));
            rotate(`arm${side}`, -.12 + (fall ? .10 : .22) * flutter, 0, sign * (fall ? .55 : .18));
            rotate(`elbow${side}`, -.26 - .09 * Math.sin(phase - .9 + sign)); rotate(`wrist${side}`, -.05 * Math.sin(phase - 1.1 + sign));
            rotate(`thigh${side}`, (fall ? -.15 : .02) + .19 * Math.sin(phase - .7 + sign * .4));
            rotate(`knee${side}`, (fall ? .42 : .20) + .12 * Math.sin(phase - 1.0 + sign * .4)); rotate(`foot${side}`, -.12 - .065 * Math.sin(phase - 1.3 + sign * .4));
          }
        } else if (clip.name === 'Landing') {
          const compression = t < .12 ? ease(t / .12) : 1 - ease((t - .12) / .45);
          const headLag = t < .17 ? ease(t / .17) : 1 - ease((t - .17) / .45);
          plantedCrouch(1.2 * compression); rotate('torso', .23 * compression); rotate('head', -.13 * headLag);
          for (const side of ['L', 'R']) { const sign = side === 'L' ? 1 : -1; rotate(`arm${side}`, -.30 * compression, 0, sign * .11 * compression); rotate(`elbow${side}`, -.32 * headLag); }
        }
      }
      root.updateMatrixWorld(true);
      for (const [name, object] of objects) { positions.get(name)!.push(...object.position.toArray()); rotations.get(name)!.push(...object.quaternion.toArray()); scales.get(name)!.push(...object.scale.toArray()); }
    }
    const tracks = [...objects.keys()].flatMap(name => [new VectorKeyframeTrack(`${name}.position`, times, positions.get(name)!), new QuaternionKeyframeTrack(`${name}.quaternion`, times, rotations.get(name)!), new VectorKeyframeTrack(`${name}.scale`, times, scales.get(name)!)]);
    output.push(new AnimationClip(clip.name, clip.duration, tracks));
  }
  reset(); root.updateMatrixWorld(true); return output;
}
