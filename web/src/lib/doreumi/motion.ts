import { AnimationClip, AnimationMixer, AnimationUtils, LoopOnce, LoopRepeat, Quaternion, QuaternionKeyframeTrack, Vector3, type AnimationAction, type Object3D } from 'three';
import { LOOP_ACTIONS, POSE_ACTIONS, resolveDoreumiAction } from '@/lib/doreumi/motion-catalog';
import { MOTION_GROUNDING } from '@/lib/doreumi/motion-grounding';
import { articulateDoreumiRig, doreumiRigData, inspectDoreumiContacts, type DoreumiRigInspection } from '@/lib/doreumi/motion-rig';
import { articulateDoreumiClips } from '@/lib/doreumi/motion-articulation';
import type { MotionFrameSample } from '@/lib/doreumi/motion-camera';
import { lapPropVisibility } from '@/lib/doreumi/motion-lap';

/** The host owns planar travel. Retarget first, apply measured floor correction
 * to the finished master clip, never to the old source skeleton. */
export function prepareDoreumiClips(source: AnimationClip[], applyGrounding = true, root?: Object3D): AnimationClip[] {
  if (root?.userData.doreumiClipsVersion === 3) return source.map(clip => clip.clone());
  const clips = source.map(original => original.clone());
  for (const clip of clips) for (const track of clip.tracks) if (track.name === 'DoreumiRig.position') for (let i = 0; i < track.values.length; i += 3) { track.values[i] = 0; track.values[i + 2] = 0; }
  const idle = clips.find(c => c.name === 'Idle');
  if (!idle || !idle.tracks.some(t => t.name === 'armL.quaternion')) throw new Error('Approved Doreumi rig is missing');
  for (const name of ['MegaphoneSpeak', 'CarryBag']) {
    const times = [0, .6, 1.3, 2, 2.7, 3.4, 4.1, 4.8, 5.5, 6];
    const levels = name === 'MegaphoneSpeak' ? [0, .25, 1, 1, .96, 1, .97, 1, .25, 0] : [0, .7, 1, .95, 1, .95, 1, .95, .7, 0];
    const rest = new Vector3(.234528, -.233184, .132414).normalize(), target = name === 'MegaphoneSpeak' ? new Vector3(-.23, .08, .38) : new Vector3(.29, -.15, .12);
    const delta = new Quaternion().setFromUnitVectors(rest, target.normalize());
    const tracks = idle.tracks.map(track => {
      const first = Array.from(track.values.slice(0, track.getValueSize()));
      if (track.name === 'armL.quaternion' || track.name === 'shoulderL.quaternion') {
        const q = new Quaternion().fromArray(first), factor = track.name.startsWith('shoulder') ? .1 : 1;
        return new QuaternionKeyframeTrack(track.name, times, levels.flatMap(level => new Quaternion().slerp(delta, level * factor).multiply(q).toArray()));
      }
      const copy = track.clone(); copy.times = new Float32Array([0, 6]); copy.values = new Float32Array([...first, ...first]); return copy;
    });
    clips.push(new AnimationClip(name, 6, tracks));
  }
  const prepared = articulateDoreumiClips(clips, root);
  if (applyGrounding) for (const clip of prepared) {
    const offsets = MOTION_GROUNDING[clip.name]; if (!offsets?.length) continue;
    const track = clip.tracks.find(t => t.name === 'DoreumiRig.position'); if (!track) continue;
    for (let i = 0; i < track.times.length; i++) {
      const index = track.times[i] / clip.duration * (offsets.length - 1), left = Math.floor(index), right = Math.min(offsets.length - 1, left + 1), fraction = index - left;
      track.values[i * 3 + 1] += offsets[left] * (1 - fraction) + offsets[right] * fraction;
    }
  }
  return prepared;
}
const SEATED = new Set(['Code', 'Read']);
const POSE_ENTRY_SECONDS: Record<string, number> = { Sit: 1.2, Lie: 2.4, Code: 1.2, Read: 1.2 };
const MAX_IMPORTED_CLIPS = 12;
const MAX_OUTGOING_ACTIONS = 4;
const publicName = (name: string) => name.replace(/__hold$/, '');
const isLoop = (name: string) => name.endsWith('__hold') || LOOP_ACTIONS.has(name as never);
const ease = (v: number) => { const x = Math.max(0, Math.min(1, v)); return x * x * (3 - 2 * x); };

/** One mixer with explicit entry/hold/recovery and a bounded imported-clip cache. */
export class DoreumiMotion {
  readonly mixer: AnimationMixer;
  readonly clips: AnimationClip[];
  readonly rig: DoreumiRigInspection;
  private current: AnimationAction;
  private pending: string | null = null;
  private recovering = false;
  private outgoing: { action: AnimationAction; until: number }[] = [];
  private clock = 0;
  private elapsed = 0;
  private desired = 'Idle';
  private clipMap: Map<string, AnimationClip>;
  private imported = new Map<string, number>();
  private sequence = 0;
  private locomotionRate = 1;
  private root: Object3D;
  private startedAt = -Infinity;
  private framingSamples: MotionFrameSample[] = [{ action: 'Idle', time: 0, weight: 1 }];
  constructor(root: Object3D, clips: AnimationClip[], options: { grounding?: boolean } = {}) {
    this.root = root;
    this.rig = articulateDoreumiRig(root);
    this.mixer = new AnimationMixer(root); this.clips = prepareDoreumiClips(clips, options.grounding !== false, root);
    this.clipMap = new Map(this.clips.map(c => [c.name, c]));
    for (const [name, entry] of Object.entries(POSE_ENTRY_SECONDS)) {
      const clip = this.clipMap.get(name)!;
      const hold = AnimationUtils.subclip(clip, `${name}__hold`, Math.round(entry * 30), Math.round((entry + 2.4) * 30), 30);
      for (const track of hold.tracks) {
        const valueSize = track.getValueSize();
        track.times = new Float32Array([...track.times, 2.4]);
        track.values = new Float32Array([...track.values, ...track.values.slice(0, valueSize)]);
      }
      hold.duration = 2.4; this.clipMap.set(`${name}__hold`, hold);
    }
    this.current = this.mixer.clipAction(this.clipMap.get('Idle')!);
    this.current.setLoop(LoopRepeat, Infinity).play(); this.mixer.update(0);
    this.mixer.addEventListener('finished', this.finished);
  }
  hasClip(name: string) { return this.clipMap.has(name); }
  registerClip(clip: AnimationClip, options: { planarSupportMaxOffset?: number } = {}) {
    const planarLimit = options.planarSupportMaxOffset;
    if (planarLimit !== undefined && (!Number.isFinite(planarLimit) || planarLimit < 0 || planarLimit > 2)) throw new Error('Invalid bounded planar support');
    if (!/^meshy:\d+$/.test(clip.name) || !Number.isFinite(clip.duration) || clip.duration <= 0 || !clip.tracks.length) throw new Error('Invalid imported Doreumi clip');
    if (this.clipMap.has(clip.name)) { this.imported.set(clip.name, ++this.sequence); return; }
    const seen = new Set<string>();
    for (const track of clip.tracks) {
      const split = track.name.lastIndexOf('.'), name = track.name.slice(0, split), property = track.name.slice(split + 1);
      const size = property === 'quaternion' ? 4 : 3, rest = doreumiRigData(this.root)?.rest[name];
      if (!rest || seen.has(track.name) || !['position', 'quaternion', 'scale'].includes(property) || !track.times.length || track.values.length !== track.times.length * size || !Array.from(track.values).every(Number.isFinite) || !Array.from(track.times).every((time, i, times) => Number.isFinite(time) && time >= 0 && time <= clip.duration + 1e-4 && (!i || time > times[i - 1]))) throw new Error(`Invalid imported track: ${track.name}`);
      seen.add(track.name);
      if (property === 'scale' && !Array.from(track.values).every(value => Math.abs(value - 1) < 1e-6)) throw new Error('Imported clips must preserve Doreumi proportions');
      if (property === 'position' && name !== 'DoreumiRig' && !Array.from(track.values).every((value, i) => Math.abs(value - rest.position[i % 3]) < 1e-6)) throw new Error('Imported clips must preserve Doreumi joint lengths');
      if (property === 'quaternion') for (let i = 0; i < track.values.length; i += 4) if (Math.abs(Math.hypot(...track.values.slice(i, i + 4)) - 1) > .001) throw new Error(`Invalid imported quaternion: ${track.name}`);
      if (name === 'DoreumiRig' && property === 'position') {
        for (let i = 0; i < track.values.length; i += 3) {
          const offset = Math.hypot(track.values[i], track.values[i + 2]);
          if (offset > (planarLimit === undefined ? 1e-6 : planarLimit + .001)) throw new Error('Imported planar root motion exceeds its support contract');
        }
        for (const i of [0, track.values.length - 3]) if (Math.hypot(track.values[i], track.values[i + 2]) > 1e-6) throw new Error('Planar support must recover to the resting origin');
      }
    }
    this.clipMap.set(clip.name, clip.clone()); this.imported.set(clip.name, ++this.sequence); this.evictImported();
  }
  private evictImported() {
    const protectedNames = new Set([this.current.getClip().name, this.pending, this.desired, ...this.outgoing.map(entry => entry.action.getClip().name)]);
    for (const [name] of [...this.imported].sort((a, b) => a[1] - b[1])) {
      if (this.imported.size <= MAX_IMPORTED_CLIPS) break;
      if (protectedNames.has(name)) continue;
      this.mixer.uncacheClip(this.clipMap.get(name)!); this.clipMap.delete(name); this.imported.delete(name);
    }
  }
  setLocomotionRate(rate: number) {
    this.locomotionRate = Math.max(.35, Math.min(3, Number.isFinite(rate) ? rate : 1));
    if (['Walk', 'Run'].includes(this.current.getClip().name) && !this.recovering) this.current.setEffectiveTimeScale(this.locomotionRate);
  }
  private finished = ({ action }: { action: AnimationAction }) => {
    if (action !== this.current) return;
    if (this.recovering) { const next = this.pending ?? 'Idle'; this.pending = null; this.recovering = false; this.start(next, .24); return; }
    if (POSE_ENTRY_SECONDS[action.getClip().name]) { this.start(`${action.getClip().name}__hold`, .12); return; }
    if (!POSE_ACTIONS.has(publicName(action.getClip().name) as never)) this.start('Idle', .38);
  };
  private start(name: string, duration: number) {
    const clip = this.clipMap.get(name); if (!clip) throw new Error(`Doreumi clip is not loaded: ${name}`);
    const previous = this.current, next = this.mixer.clipAction(clip);
    if (next === previous) { next.paused = false; return; }
    this.outgoing = this.outgoing.filter(entry => entry.action !== next);
    next.stopFading().reset().setEffectiveTimeScale(['Walk', 'Run'].includes(name) ? this.locomotionRate : 1).setEffectiveWeight(1);
    next.setLoop(isLoop(name) ? LoopRepeat : LoopOnce, isLoop(name) ? Infinity : 1); next.clampWhenFinished = true; next.play();
    previous.stopFading(); next.crossFadeFrom(previous, duration, false);
    this.outgoing.push({ action: previous, until: this.clock + duration + .02 }); this.current = next; this.elapsed = 0;
    this.startedAt = this.clock;
    while (this.outgoing.length > MAX_OUTGOING_ACTIONS) this.outgoing.shift()!.action.stop();
    if (this.imported.has(name)) this.imported.set(name, ++this.sequence);
  }
  setAction(value: string) {
    const name = resolveDoreumiAction(value); if (!this.clipMap.has(name)) return; this.desired = name;
    if (name === 'Dragged' || name === 'Falling') { this.pending = null; this.recovering = false; if (name !== this.current.getClip().name) this.start(name, .14); return; }
    if (this.recovering) { this.pending = name; return; }
    const currentName = publicName(this.current.getClip().name);
    if (name === currentName) return;
    if (POSE_ACTIONS.has(currentName as never) && (this.current.getClip().name.endsWith('__hold') || this.current.time > .15)) {
      this.pending = name; this.recovering = true;
      const entry = POSE_ENTRY_SECONDS[currentName];
      if (entry && (this.current.getClip().name.endsWith('__hold') || this.current.time > entry)) { this.start(currentName, .12); this.current.time = entry; }
      this.current.paused = false; this.current.enabled = true; this.current.setEffectiveTimeScale(-Math.max(1, this.current.time / 1.1)); this.current.setLoop(LoopOnce, 1); this.current.clampWhenFinished = true; return;
    }
    // Arriving from a run or walk settles quickly so the legs stop when the body stops.
    const arriving = (currentName === 'Run' || currentName === 'Walk') && name === 'Idle';
    // Landing and the run after it blend a little longer so a drop flows into the run (2026-09-26).
    this.start(name, name === 'Landing' ? .16 : arriving ? .14 : (name === 'Run' || name === 'Walk') && currentName === 'Landing' ? .26 : name === 'Run' || name === 'Walk' ? .2 : .34);
  }
  update(delta: number) {
    let remaining = Math.min(Math.max(delta, 0), .25);
    while (remaining > 1e-8) {
      const dt = Math.min(remaining, 1 / 60); remaining -= dt; this.clock += dt; this.elapsed += dt; this.mixer.update(dt);
      this.captureFramingSamples();
      this.outgoing = this.outgoing.filter(entry => { if (entry.until > this.clock) return true; if (entry.action !== this.current) entry.action.stop(); return false; });
      if (this.desired === 'Think' && this.current.getClip().name === 'Idle' && this.elapsed > 1.8) this.start('Think', .4);
    }
    this.evictImported();
  }
  private captureFramingSamples() {
    // finished can start another action during mixer.update(). That new action
    // has weight=1 until its first update but has not contributed to the pose.
    this.framingSamples = [...this.outgoing.map(entry => entry.action), ...(this.startedAt === this.clock ? [] : [this.current])]
      .filter(action => action.enabled && action.getEffectiveWeight() > 0)
      .map(action => ({ action: publicName(action.getClip().name), time: action.time, weight: action.getEffectiveWeight() }));
  }
  inspect() {
    const name = publicName(this.current.getClip().name), hold = this.current.getClip().name.endsWith('__hold');
    return { action: name, requested: this.desired, time: this.current.time, duration: this.current.getClip().duration, recovering: this.recovering, pending: this.pending, activeActions: this.outgoing.length + 1, framingSamples: this.framingSamples, rig: this.rig, phase: this.recovering ? 'exit' : hold ? 'hold' : 'entry', propVisibility: SEATED.has(name) ? lapPropVisibility(this.current.time, hold) : 0, contacts: inspectDoreumiContacts(this.root), importedClips: this.imported.size };
  }
  seek(name: string, seconds: number) {
    const id = resolveDoreumiAction(name), clip = this.clipMap.get(id); if (!clip) return;
    this.mixer.stopAllAction(); this.outgoing = []; this.pending = null; this.recovering = false; this.desired = id;
    this.current = this.mixer.clipAction(clip); this.current.reset().setLoop(LoopOnce, 1).setEffectiveWeight(1).play();
    this.startedAt = -Infinity;
    this.current.clampWhenFinished = true; this.current.time = Math.max(0, Math.min(seconds, clip.duration)); this.mixer.update(0); this.captureFramingSamples();
  }
  resume() {
    const name = this.current.getClip().name; this.current.paused = false;
    this.current.setEffectiveTimeScale(this.recovering ? -Math.max(1, this.current.time / 1.1) : ['Walk', 'Run'].includes(name) ? this.locomotionRate : 1);
    if (!this.recovering) { this.current.setLoop(isLoop(name) ? LoopRepeat : LoopOnce, isLoop(name) ? Infinity : 1); if (this.current.time >= this.current.getClip().duration) this.current.time = 0; }
  }
  dispose() { this.mixer.removeEventListener('finished', this.finished); this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); }
}
