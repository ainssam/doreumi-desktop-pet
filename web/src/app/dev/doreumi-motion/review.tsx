'use client';

import { useEffect, useRef, useState } from 'react';
import { DoreumiAvatar, type DoreumiAvatarHandle } from '@/components/doreumi/DoreumiAvatar';
import { DOREUMI_ACTIONS, DOREUMI_EXPRESSIONS } from '@/lib/doreumi/motion-catalog';
import type { DoreumiInspection } from '@/lib/doreumi/motion-runtime';
import { expressionForMotion, fetchMotionLibrary, type LibraryMotion } from '@/lib/doreumi/motion-library';
import type { DoreumiLook } from '@/lib/doreumi/seasons';
import type { DoreumiColors, DoreumiDress } from '@/lib/doreumi/items';
import styles from './review.module.css';

declare global {
  interface Window {
    __DOREUMI_QA__?: {
      ready: () => boolean;
      seek: (action: string, seconds: number) => void;
      expression: (id: string) => Promise<void>;
      ambientExpression: (motion: LibraryMotion) => Promise<void>;
      play: (action?: string) => void;
      inspect: () => DoreumiInspection | null;
      active: (value: boolean) => void;
      facing: (value: 'left' | 'right' | 'front') => void;
      skeleton: (visible: boolean) => void;
      load: (action: string) => Promise<void>;
      angle: (degrees: number) => void;
      speed: (rate: number) => void;
      season: (season: DoreumiLook | 'auto') => void;
      capture: () => string | undefined;
      /** 상점 색 바꾸기 검수: 몸통·배·머리 색만 입힌다(아이템 없음). */
      dress: (colors: DoreumiColors) => void;
    };
  }
}

export default function MotionReview() {
  const avatar = useRef<DoreumiAvatarHandle>(null);
  const [ready, setReady] = useState(false), [active, setActive] = useState(true);
  const [action, setAction] = useState('Idle'), [expression, setExpression] = useState('neutral');
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(true);
  const [inspection, setInspection] = useState<DoreumiInspection | null>(null);
  const [library, setLibrary] = useState<LibraryMotion[]>([]), [error, setError] = useState('');
  const [skeleton, setSkeleton] = useState(false);
  const [dress, setDress] = useState<DoreumiDress | undefined>();
  const duration = DOREUMI_ACTIONS.find(([id]) => id === action)?.[2] ?? library.find(item => item.id === action)?.duration ?? 4;
  useEffect(() => {
    const controller = new AbortController();
    void fetchMotionLibrary(controller.signal).then(value => setLibrary(value.motions)).catch(() => { if (!controller.signal.aborted) setError('추가 동작 목록을 불러오지 못했어요.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    window.__DOREUMI_QA__ = {
      ready: () => !!avatar.current?.inspect(),
      seek: (name, seconds) => avatar.current?.seek(name, seconds),
      expression: async id => { await avatar.current?.setExpression(id); },
      ambientExpression: async motion => { await avatar.current?.setExpression(expressionForMotion(motion)); },
      play: name => { if (name) avatar.current?.setAction(name); avatar.current?.play(); },
      inspect: () => avatar.current?.inspect() ?? null,
      active: setActive,
      facing: value => avatar.current?.setFacing(value), skeleton: value => avatar.current?.setSkeletonVisible(value),
      load: async value => { await avatar.current?.loadAction(value); },
      angle: value => avatar.current?.setViewAngle(value), speed: value => avatar.current?.setPlaybackRate(value),
      season: value => avatar.current?.setSeason(value),
      capture: () => avatar.current?.capture(),
      dress: colors => setDress({ items: [], colors }),
    };
    return () => { delete window.__DOREUMI_QA__; };
  }, []);
  async function selectAction(name: string) {
    try { await avatar.current?.loadAction(name); } catch { setError('이 동작은 아직 준비되지 않았어요.'); return; }
    setError('');
    setAction(name); setPlaying(true); setTime(0);
    avatar.current?.setAction(name); avatar.current?.play();
  }
  function seek(seconds: number) { setPlaying(false); setTime(seconds); avatar.current?.seek(action, seconds); setInspection(avatar.current?.inspect() ?? null); }
  function togglePlay() {
    if (playing) { const state = avatar.current?.inspect(); if (state) seek(state.time); }
    else { avatar.current?.play(); setPlaying(true); }
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>도름이 작업실</p><h1>동작과 표정 검수</h1></div>
        <span className={styles.status} data-qa-ready={ready}>{ready ? '3D 준비 완료' : '도름이를 불러오고 있어요'}</span>
      </header>
      <div className={styles.layout}>
        <section className={styles.preview} aria-label="도름이 3D 미리보기">
          <div className={styles.stage} data-doreumi-stage>
            <DoreumiAvatar ref={avatar} active={active} dress={dress} onReady={() => setReady(true)} />
          </div>
          <div className={styles.timeline}>
            <label htmlFor="motion-time">동작 위치 <span>{time.toFixed(2)} / {duration.toFixed(2)}초</span></label>
            <input id="motion-time" type="range" min="0" max={duration} step="0.01" value={time} onChange={event => seek(Number(event.target.value))} disabled={!ready} />
            <div className={styles.buttons}>
              <button type="button" onClick={togglePlay} disabled={!ready}>{playing ? '일시정지' : '재생'}</button>
              <button type="button" onClick={() => { avatar.current?.seek(action, 0); avatar.current?.play(); setTime(0); setPlaying(true); }} disabled={!ready}>처음부터</button>
              <button type="button" onClick={() => { setActive(!active); setInspection(avatar.current?.inspect() ?? null); }} disabled={!ready}>{active ? '화면 밖 상태 확인' : '화면으로 복귀'}</button>
            </div>
          </div>
          <p className={styles.caption}>아인T의 원래 외형과 34개 표정을 유지해요. 동작별로 앞·옆·뒤와 손발 접촉을 확인해요.</p>
        </section>
        <section className={styles.controls} aria-label="동작과 표정 선택">
          <div className={styles.selectors}>
            <label>동작<select value={action} onChange={event => selectAction(event.target.value)} disabled={!ready}>{DOREUMI_ACTIONS.map(([id, label]) => <option key={id} value={id}>{label}{['MegaphoneSpeak', 'CarryBag'].includes(id) ? ' (후보)' : ''}</option>)}</select></label>
            <label>표정<select value={expression} onChange={event => { setExpression(event.target.value); void avatar.current?.setExpression(event.target.value); }} disabled={!ready}>{DOREUMI_EXPRESSIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          </div>
          <div className={styles.selectors}>
            <label>보는 방향<select defaultValue="0" onChange={event => avatar.current?.setViewAngle(Number(event.target.value))}>{[[0, '정면'], [45, '비스듬히'], [90, '왼쪽'], [-90, '오른쪽'], [180, '뒤']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>재생 속도<select defaultValue="1" onChange={event => avatar.current?.setPlaybackRate(Number(event.target.value))}><option value="1">정상 속도</option><option value="0.25">0.25배속</option></select></label>
          </div>
          <button type="button" aria-pressed={skeleton} onClick={() => { avatar.current?.setSkeletonVisible(!skeleton); setSkeleton(!skeleton); }}>관절 표시</button>
          <label>의상<select defaultValue="everyday" onChange={event => avatar.current?.setSeason(event.target.value as DoreumiLook | 'auto')}><option value="auto">날짜에 맞추기</option><option value="everyday">평소 모습</option><option value="seollal">설날 한복</option><option value="chuseok">추석 한복</option><option value="christmas">크리스마스</option><option value="flower-pin">꽃 머리핀</option><option value="santa-hat">산타 모자</option></select></label>
          <h2>{DOREUMI_ACTIONS.length}개 동작</h2>
          <div className={styles.actions}>{DOREUMI_ACTIONS.map(([id, label]) => <button type="button" key={id} data-action={id} aria-pressed={action === id} disabled={!ready} onClick={() => selectAction(id)}>{label}</button>)}</div>
          <h2>Meshy 동작 {library.length}개</h2>
          <p>변환 {library.filter(item => item.url).length}개 · 검수 통과 {library.filter(item => item.review === 'passed').length}개 · 랜덤 연결 {library.filter(item => item.review === 'passed' && item.ambient && item.url).length}개</p>
          <label>추가 동작<select value={action.startsWith('meshy:') ? action : ''} onChange={event => { if (event.target.value) void selectAction(event.target.value); }} disabled={!ready}><option value="">동작 선택</option>{library.map(item => <option key={item.id} value={item.id} disabled={!item.url}>{item.sourceActionId}. {item.label} · {item.review === 'passed' ? '통과' : item.review === 'failed' ? '수정 필요' : '검수 전'}</option>)}</select></label>
          {error && <p role="alert">{error}</p>}
          <div className={styles.notes}>
            <h2>전환 확인</h2>
            <p>앉기와 눕기 중 다른 동작을 누르면 일어선 뒤 이어져요. 달리기와 걷기는 이어지는 지점도 함께 확인해 주세요.</p>
            <button type="button" onClick={() => setInspection(avatar.current?.inspect() ?? null)} disabled={!ready}>현재 렌더 상태 확인</button>
            {inspection && <pre data-doreumi-inspection>{JSON.stringify(inspection, null, 2)}</pre>}
          </div>
        </section>
      </div>
    </main>
  );
}
