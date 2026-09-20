# 시작 위치와 실행 흐름

## 저장소 구조

```text
deliverable/
  dorms-v60-final-shoulder/       승인 몸체·관절·행동 모델
  dorms-v86-approved-expression-set/ 승인 표정 소스와 사용자 승인 목록
  dorms-v87-integrated-review-showcase/ 공유 런타임 유틸리티
  dorms-v88-expression-transfer-pilot/ 표면 투영·기하 해시 함수
  dorms-v89-v60-neutral-face/     승인 V60용 얼굴 보정 자료
  dorms-v90-v60-expression-set/   표정 34종 검증·전달 계층
  dorms-v42-character-rig/        현재 사용 중인 책·노트북만
  dorms-v48-premium-props/        소품 카탈로그와 15개 원본
  dorms-v97-badge-collection/     후보 배지 20개
  dorms-seasonal-meshy/           런타임 계절 텍스처
  dorms-v98-badge-integration/    통합 검수 화면과 Electron 창
scripts/                          루트 npm 명령 래퍼
docs/                             상태·로드맵·원본 승인 근거
```

디렉터리 이름과 상대 경로는 런타임 모듈이 그대로 사용합니다. 승인 원본을 다른 버전으로 바꾸면 `manifest.mjs`, SHA-256 검증, QA와 자산 상태 문서를 함께 수정해야 합니다.

## 실행 명령

| 명령 | 결과 |
|---|---|
| `npm run preview` | 브라우저 검수 페이지, 기본 포트 43198 |
| `npm run desktop:install` | 첫 데스크톱 실행 전에 Electron 바이너리 설치(데스크톱 명령도 자동 실행) |
| `npm run desktop` | Electron 투명 펫 미리보기 창 |
| `npm test` | V98 회귀 테스트 |
| `npm run qa:install-browser` | 최초 브라우저 QA용 Chromium 설치 |
| `npm run qa` | 임시 로컬 서버를 띄워 표정·행동·소품·배지·계절 통합 검수 |
| `npm run qa:motion` | 임시 로컬 서버에서 동작 캡처와 표면/접촉 검사 |
| `npm run qa:desktop` | Electron 창·보안 설정·자원 정리 검수 |

43198을 이미 쓰고 있으면 PowerShell에서 `$env:DOREUMI_PORT='43199'`로 포트를 지정하세요. 그다음 `npm run preview`를 실행하고 브라우저 검수 스크립트도 같은 `DOREUMI_PORT`를 사용합니다.

## 런타임 부팅 순서

1. `deliverable/dorms-v98-badge-integration/serve.mjs`가 읽기 전용 로컬 서버를 띄웁니다.
2. `manifest.mjs`가 V60 해시, V86 승인/텍스처, V48 소품 해시, V97 배지 출처를 검사합니다.
3. 브라우저가 Three.js와 V60 GLB를 불러오고 얼굴 재질·보정값을 준비합니다.
4. Electron은 같은 서버의 `/desktop`을 투명·always-on-top 창으로 표시합니다.

Meshy 생성 API는 실행 과정에 없습니다. Node 패키지 설치 외 네트워크 연결도 필요하지 않습니다.
