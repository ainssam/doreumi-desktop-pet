# V98 QA 상태

검증일: 2026-09-20

## 결과

- 표정: 34/34 렌더 성공, 34개 고유 캡처, 얼굴판 신규 메시·이중 표정 없음
- 승인 행동: 21/21, 각 5개 시점의 관절 유한값·쿼터니언 정규화·바닥 관통 허용치 통과
- 소품 조합: 17/17, 시작·중간·끝 접촉 유지 또는 배치 지지면 높이 유지
- 가슴 배지: 20/20, 2048 텍스처·단일 슬롯 교체·6 mm 표면 간격 유지
- 다중 조합: 3/3, 머리+손+배지 및 장면 소품+배지 동시 사용 통과
- 계절 대표 조합: 4/4
- 브라우저 콘솔·페이지·네트워크 로딩 오류: 0
- 원본 V60 지오메트리·스킨·승인 클립 해시 불변: 통과
- Electron 보안·종료: sandbox/contextIsolation 통과, nodeIntegration 꺼짐, 로컬 서버 정상 종료
- 단위·통합 테스트: 23/23 통과

## 실제 불러온 자산

- 표정 34종: `aa`, `aha`, `annoyed`, `apologetic`, `blink_closed`, `cheering`, `confused`, `curious`, `determined`, `ee`, `focused`, `greeting_smile`, `half_sleepy`, `laugh`, `listening`, `love`, `mm`, `neutral`, `oh`, `oo`, `proud`, `relieved`, `shy`, `skeptical`, `sleepy`, `smile`, `soft_sad`, `sparkly`, `surprise`, `teary`, `thinking`, `wink`, `worried`, `yawning`
- 행동 21종: `Idle`, `Walk`, `Run`, `Wave`, `Showcase`, `HeadTilt`, `Sit`, `Think`, `Bow`, `Stretch`, `Lie`, `Roll`, `Jump`, `Joy`, `Code`, `Read`, `Cheer`, `PeekLeft`, `PeekRight`, `NewYearBow`, `Snowman`
- 소품 17종: 산타 모자, 설날 매화 장식, 추석 보름달 장식, 요술봉, 확성기, 하트, 팔레트, 농구공, 선물 주머니, 연단 마이크, 지구본, 기타, 현미경, 칠판, 퍼즐, 코딩 컴퓨터, 책 V3
- 배지 20종: `hello`, `rocket`, `classroom`, `code`, `maker`, `update`, `question`, `solution`, `magnifier`, `tester`, `lighthouse`, `team`, `opensource`, `remix`, `recommended`, `steady`, `monthly`, `challenge`, `automation`, `safe`
- 계절 4종: `spring`, `summer`, `autumn`, `winter`

## 승인 구분

- 승인: V60 몸·관절, V60의 21개 행동, V86 기반 V60 표정 34종
- 후보: V48/V42 소품 17종, V97 배지 20종
- 후보 소품·배지는 기술 호환성 검수에 통과했지만 출시 승인으로 표기하지 않는다.

## 조합 가능 / 제한

- 가능: 표정+승인 행동+머리 소품+손 소품+가슴 배지+계절+나선 효과
- 가능: 장면 소품+가슴 배지+해당 장면에 지정된 행동
- 제한: 손 소품과 장면 소품의 동시 사용은 손·장면 접촉이 함께 검증되지 않아 차단
- 제한: 장면 소품은 `Idle` 또는 해당 소품에 지정된 행동만 허용
- 제한: 확성기·선물 주머니 전용 후보 행동은 해당 손 소품이 선택된 경우만 허용
- 정적 표정 적용을 립싱크·연속 표정 보간·자연 깜빡임으로 간주하지 않는다.

## 증거

- `reports/deep-integration-validation.json`
- `reports/badge-smoke.json`
- `reports/motion-evidence.json`
- `reports/desktop-validation.json`
- `reports/chest-anchor-probe.json`
- `evidence/contact-sheets/`
- `evidence/doreumi-v98-combination.gif`
- `evidence/doreumi-v98-combination.webm`

현재 자동 검사와 대표 화면 육안 검토에서 추가 수정이 필요한 오류는 발견되지 않았다. 후보의 최종 출시 채택 여부는 사용자 승인 단계로 남긴다.
