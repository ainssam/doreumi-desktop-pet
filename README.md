# 도름이 데스크톱 펫

도름이 데스크톱 펫을 이어서 완성하기 위한 독립 저장소입니다. V60 기본 모델, 승인 기록, 표정 텍스처, 행동 클립, 연결된 소품·계절 연출, Electron 검수 실행기와 재현 가능한 검수 환경을 한 저장소에서 관리합니다.

## 5분 안에 검수 화면 열기

요구 환경: Windows 10/11, Git LFS, Node.js 22 이상, npm.

```powershell
git lfs install
git clone https://github.com/ainssam/doreumi-desktop-pet.git
cd doreumi-desktop-pet
git lfs pull
npm ci
npm test
npm run preview
```

브라우저 주소는 `http://127.0.0.1:43198/`입니다. Electron 창은 `npm run desktop`으로 실행합니다.

## 먼저 읽을 문서

1. [`docs/START-HERE.md`](docs/START-HERE.md): 구조, 실행 흐름, 검수 명령
2. [`docs/ASSET-STATUS.md`](docs/ASSET-STATUS.md): 승인·후보·재검수 자산 구분
3. [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md): 데스크톱 펫 마무리 순서와 완료 조건
4. [`docs/RELEASE-BACKLOG.md`](docs/RELEASE-BACKLOG.md): 상세 기능별 출시 체크리스트

## 현재 상태

V98은 통합 검수 화면과 투명 Electron 미니창을 포함한 제작 기반입니다. 34개 정적 표정, V60의 사용자 승인 행동 21개, 소품 조합, 사계절 효과와 후보 배지를 시험할 수 있습니다. 이것만으로 완성된 데스크톱 펫이라고 볼 수는 없습니다. 눈 깜빡임과 연속 표정 전환, 행동 상태·전환 로직, 창 이동·트레이·다중 모니터, 설치·업데이트·제거와 새 PC 출시 검수는 [`docs/NEXT-STEPS.md`](docs/NEXT-STEPS.md)에 남아 있습니다.

## 검수 명령

```powershell
npm run qa:install-browser
npm test
npm run qa
npm run qa:motion
npm run qa:desktop
```

`npm run desktop`와 `npm run qa:desktop`은 첫 실행 때 필요한 Electron 실행 파일을 자동으로 내려받습니다. 직접 준비하려면 `npm run desktop:install`을 실행하세요. 이 단계는 GitHub Actions나 Meshy를 사용하지 않으며, Windows용 Electron 바이너리 다운로드만 수행합니다.

파일 전체는 Git LFS로 내려받습니다. 자산별 SHA-256·사용자 승인·미완료 상태를 문서와 JSON에 기록해 두었습니다. 자산 라이선스 안내는 [`LICENSE-ASSETS.md`](LICENSE-ASSETS.md)를 확인하세요.

GitHub 협업 계정은 초대받은 계정으로 로그인해 clone하세요. 코드와 캐릭터 자산은 별도 조건입니다. 초대받지 않은 사용자에게 저장소나 자산을 전달하거나, 자산을 재배포하지 마세요.
