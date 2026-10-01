# 도름이 웹판 (`web/`)

도름스(DoRms) 웹사이트에서 실제로 움직이는 도름이를 그대로 옮겨 둔 폴더예요. 이 저장소의 V60 모델과 표정을 바탕으로 도름스에서 뼈대와 동작을 다듬었어요. 윈도우 데스크톱 펫(`deliverable/`)과는 따로 있고 원본 자산은 건드리지 않아요.

## 들어 있는 것

| 경로 | 내용 |
|---|---|
| `public/doreumi/doreumi-master.glb` | 뼈대와 가중치를 고치고 기본 동작 26개를 다시 만든 마스터 모델. 사이트는 이 파일을 그린다 |
| `public/doreumi/doreumi.glb` | 이 저장소의 V60 모델을 웹용으로 옮긴 판(마스터 모델을 만들 때 쓰는 원본) |
| `public/doreumi/motions/` | Meshy 동작 524개를 도름이 뼈대에 맞춘 동작 데이터와 목록(`registry.json`) |
| `public/doreumi/expressions/`, `face-skin.webp` | 표정 34종 |
| `public/doreumi/props/`, `shop/` | 동작에 쓰는 소품과 상점 그림 |
| `public/doreumi/rig-contract.json`, `manifest.json` | 뼈대 약속(관절 이름·위치·부착점), 자산 목록과 해시 |
| `src/lib/doreumi/` | Three.js 런타임: 동작 재생과 전환, 바닥 접지, 화면 이동, 옷 입히기. `three` 만 쓴다 |
| `src/components/doreumi/` | React 감싸개 `DoreumiAvatar`, 이동·성격 훅 |
| `scripts/doreumi/` | 마스터 모델 만들기, Meshy 동작 받기와 뼈대 맞추기, 검수 스크립트. API 키는 들어 있지 않다 |
| `tests/` | 마스코트 시험 |
| `docs/doreumi/` | 뼈대·동작 설명과 검수 기록 |
| `SYNC.json` | 마지막으로 도름스와 맞춘 상태 |

경로는 도름스 저장소와 똑같아요. 코드의 `@/` 는 `src/` 를 가리켜요(`tests/alias-hooks.mjs`).

## 시험 돌리기

Node 22.18 이상이 필요해요.

```sh
cd web
npm install
npm test
```

## 마스터 모델 다시 만들기

동작이나 뼈대를 고쳤으면 아래 순서로 다시 굽고 시험해요. 자세한 내용은 `docs/doreumi/master-rig.md` 에 있어요.

```sh
node --import ./tests/register-alias.mjs scripts/doreumi/motion-verify.mjs --bake-grounding
node --import ./tests/register-alias.mjs scripts/doreumi/build-master-rig.mjs
node --import ./tests/register-alias.mjs scripts/doreumi/motion-verify.mjs
node --import ./tests/register-alias.mjs --test tests/doreumi-rig.test.mjs
```

## 권리

- **도름이 캐릭터, 모델, 표정, 동작, 소품과 상점 그림**: 만든 사람 아인T. [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/deed.ko) 으로 공개해요. 출처를 밝히면 비상업적으로 쓰고 고칠 수 있어요. 출처는 이렇게 적으면 돼요: `도름이 © 아인T, CC BY-NC 4.0`. 판매처럼 상업적으로 쓰려면 아인T와 따로 합의해야 해요.
- **코드**: MIT 라이선스예요. 저장소 루트의 `LICENSE-CODE.md` 를 따라요.
- **동작 데이터(`public/doreumi/motions/`)**: Meshy 유료 플랜의 동작 라이브러리로 만든 결과물이에요. Meshy 약관상 라이브러리 동작은 결과물에 들어간 범위에서만 배포할 수 있어요. 그래서 도름이에게 입힌 동작으로만 제공해요. 동작만 떼어 다른 캐릭터용 동작 모음으로 다시 배포하지는 마세요.

## 도름스와 맞추는 방법

이 폴더는 도름스 개편 브랜치에서 동기화 도구(`scripts/doreumi/upstream-sync.mjs`, 도름스 저장소에 있음)로 맞춰 올려요.

- 여기서 직접 고쳐도 돼요. 다음 동기화 때 도름스가 바뀐 파일을 되가져가요.
- 같은 파일을 양쪽에서 다르게 고치면 동기화가 멈추고 어느 쪽을 남길지 사람이 정해요.
- `SYNC.json` 은 비교 기준이라 손으로 고치지 않아요.
