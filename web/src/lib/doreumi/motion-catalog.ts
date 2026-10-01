export const DOREUMI_ACTIONS = [
  ['Idle', '기본', 4], ['Walk', '걷기', 2.3], ['Run', '달리기', .9],
  ['Wave', '손 흔들기', 3.6], ['Showcase', '소개', 7.8], ['HeadTilt', '갸우뚱', 4],
  ['Sit', '앉기', 6], ['Think', '생각하기', 6], ['Bow', '인사', 4],
  ['Stretch', '기지개', 5], ['Lie', '눕기', 6], ['Roll', '구르기', 4],
  ['Jump', '점프', 2.8], ['Joy', '기뻐하기', 4], ['Code', '코딩', 6],
  ['Read', '읽기', 6], ['Cheer', '응원', 4], ['PeekLeft', '왼쪽 빼꼼', 5],
  ['PeekRight', '오른쪽 빼꼼', 5], ['NewYearBow', '새해 인사', 7], ['Snowman', '눈사람', 7],
  ['MegaphoneSpeak', '확성기', 6], ['CarryBag', '선물 보따리', 6],
  ['Dragged', '들려 있기', 1.8], ['Falling', '떨어지기', .8], ['Landing', '착지', .65],
] as const;
export type DoreumiAction = typeof DOREUMI_ACTIONS[number][0] | `meshy:${number}`;

export const DOREUMI_EXPRESSIONS = [
  ['neutral', '기본'], ['smile', '미소'], ['wink', '윙크'], ['laugh', '활짝 웃음'],
  ['surprise', '놀람'], ['thinking', '생각'], ['sleepy', '졸림'], ['aa', '말하기 아'],
  ['oh', '말하기 오'], ['oo', '말하기 우'], ['blink_closed', '눈 감기'], ['relieved', '기쁨'],
  ['half_sleepy', '반쯤 졸림'], ['soft_sad', '살짝 슬픔'], ['curious', '호기심'], ['shy', '부끄러움'],
  ['proud', '뿌듯함'], ['teary', '울먹임'], ['annoyed', '살짝 짜증'], ['determined', '결의'],
  ['confused', '혼란'], ['worried', '걱정'], ['love', '반함'], ['sparkly', '초롱초롱'],
  ['listening', '경청'], ['focused', '집중'], ['aha', '아하'], ['skeptical', '의심'],
  ['apologetic', '미안함'], ['cheering', '응원'], ['greeting_smile', '인사 미소'], ['yawning', '하품'],
  ['ee', '말하기 이'], ['mm', '말하기 음'],
] as const;
export type DoreumiExpression = typeof DOREUMI_EXPRESSIONS[number][0];
const ACTION_ALIASES: Record<string, DoreumiAction> = {
  peek: 'PeekRight', greet: 'Wave', talk: 'Idle', retreat: 'Run', thinking: 'Think', happy: 'Joy',
  'run-left': 'Run', 'run-right': 'Run', drag: 'Dragged', fall: 'Falling', land: 'Landing',
};
const EXPRESSION_ALIASES: Record<string, DoreumiExpression> = { happy: 'smile', think: 'thinking', sad: 'soft_sad', talk: 'aa' };
export function resolveDoreumiAction(value = 'Idle'): DoreumiAction {
  if (/^meshy:\d{1,4}$/.test(value)) return value as DoreumiAction;
  return DOREUMI_ACTIONS.find(([id]) => id.toLowerCase() === value.toLowerCase())?.[0] ?? ACTION_ALIASES[value.toLowerCase()] ?? 'Idle';
}
export function resolveDoreumiExpression(value = 'neutral'): DoreumiExpression {
  return DOREUMI_EXPRESSIONS.find(([id]) => id === value.toLowerCase())?.[0] ?? EXPRESSION_ALIASES[value.toLowerCase()] ?? 'neutral';
}
export const LOOP_ACTIONS = new Set<DoreumiAction>(['Idle', 'Walk', 'Run', 'Dragged', 'Falling']);
export const POSE_ACTIONS = new Set<DoreumiAction>(['Sit', 'Lie', 'Code', 'Read']);
export const DOREUMI_ASSET_VERSION = 'b2cb2a6-master-rig-v3';
export function doreumiFrame(action: string, aspect = 1) {
  const roll = resolveDoreumiAction(action) === 'Roll';
  const wide = roll || resolveDoreumiAction(action) === 'Lie';
  const halfHeight = Math.max(wide ? 1.6 : 1.34, (wide ? 1.56 : 1.15) / Math.max(.1, aspect));
  return { centerY: roll ? 1.35 : 1.14, halfHeight, halfWidth: halfHeight * aspect };
}
