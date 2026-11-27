---
name: ceo-outsourcing
description: CEO Office(ai-ceo-hub) 외주 창구에서 Antigravity에 배정된 요청(코드 수정, 외부 자문, 브라우저 작업, 리서치)을 가져와 처리하고 결과를 제출한다. "CEO Office 외주 처리", "외주 확인" 같은 요청에 사용.
---

# CEO Office 외주 처리 (Antigravity)

CEO Office(https://ai-ceo-hub.onrender.com)의 무료 AI 팀이 할 수 없어서 외부로 넘긴 일을 처리한다. MCP 서버 이름은 `ceo-office`.

## 모델 계층 (Carbon > Neon > Hydrogen)
- Carbon(최상위, 이 대화의 기본): 요청서 해석, 계획·설계, 위험 판단, 하위 결과 검토, PR 전 최종 리뷰, 제출 문서 작성
- Neon(중간): 여러 파일 구현, 원인 추적이 필요한 디버깅, 판단이 들어가는 분석 → Neon 하위 에이전트
- Hydrogen(하위): 자료 조사, 파일·코드 검색, 정해진 대로 하는 단순 수정, 테스트·빌드 실행, 문서 갱신 → Hydrogen 하위 에이전트(Orchestrator 실행 모델)
- 하위 에이전트를 부를 때 "Gemini 4 Neon으로 실행"처럼 모델을 적는다. Hydrogen이 막히면 Neon, Neon이 막히면 Carbon이 직접 판단한다.
- Carbon 사용량을 아끼려고 반복·단순 작업은 직접 하지 않는다. 모델을 지정할 수 없으면 현재 모델로 하고 결과 문서 끝에 사용한 모델을 적는다.
- 요청서의 "모델 분담" 항목이 이 스킬보다 최신이면 요청서를 따른다.

## 순서
1. `list_outsourcing_requests`를 worker "antigravity"로 호출한다. 지금 Antigravity에 배정된 요청만 나온다. 없으면 "처리할 외주 없음"으로 끝낸다.
2. 한 건씩 `claim_outsourcing_request`(worker "antigravity")로 잡고, 돌려받은 요청서를 끝까지 읽는다. "회사 지침·기억"과 "지켜야 할 것"을 따른다.
3. 작업이 길어지면 같은 요청을 다시 claim해서 작업 시간을 연장한다(기본 45분).
4. 종류별 처리
   - **코드 수정 (필수 4단계 검증 루프)**:
     1) 저장소를 열고(없으면 clone) `git fetch origin`으로 최신 `origin/main`을 받는다. 루트의 `AGENTS.md`와 `docs/ARCHITECTURE.md`(있으면), 수정 대상 파일과 호출부(`rg`)를 먼저 읽는다.
     2) 일반 코드 요청은 최신 `origin/main` 기준 `out/<요청ID>` 브랜치를 만들고, Aside 검수 반려(`reviewStage: "agy_rework"`) 요청이면 기존 PR(`sourcePrUrl`) 브랜치를 체크아웃해 `[Aside 검수 반려 · 수정 지시]` 항목을 모두 반영한다.
     3) 요청 범위만 최소·정밀하게 수정한다. `main` 직접 push 금지(main 보호 설정 적용). `data/db.json`, `data/state.json`, `.env`, `.github/` 수정 금지. `public/app.js` 수정 시 `public/index.html` 캐시 버전 갱신.
     4) 저장소의 테스트·빌드 명령(예: `npm test`, `npm run build && npm run verify`)을 100% 통과할 때까지 고친 뒤, PR 올리기 직전 `git fetch origin && git merge origin/main` 및 `git diff origin/main...HEAD`로 최근 PR 되돌림·회귀가 없는지 자가 검수한다. 제목에 `[<요청ID>]`를 넣어 PR을 열고, 본문에 변경 파일·테스트 결과·확인 포인트를 적어 제출한다.
   - **외부 자문**: ① 총평 한 줄 ② 사실과 다르거나 근거 없는 주장 ③ 빠진 리스크 ④ 바로 실행할 개선안 3가지 ⑤ 승인/수정 후 승인/반려 의견. 라이브 사이트와 저장소를 직접 확인하고 확인한 사실과 추정을 구분한다.
   - **브라우저·계정 작업**: 브라우저로 확인한다. 결제·광고비 집행·외부 발송·되돌리기 어려운 변경은 하지 않는다.
   - **리서치·실무**: 출처를 확인하고 적는다. (`대표님 돈벌어다주기` 프로젝트에서 세금·세무 주제는 절대 제안 금지)
5. 로그인, 2단계 인증, CAPTCHA, 결제·발송 승인처럼 대표님만 할 수 있는 순간이 오면 억지로 진행하지 말고 `request_ceo_action`으로 무엇이 필요한지 한 줄과 방법을 알린 뒤 다음 요청으로 넘어간다. 대표님이 처리하고 재개하면 다시 배정된다.
6. `submit_outsourcing_result`로 제출한다: request_id, worker "antigravity", summary(2~4문장), document(마크다운 전문), 코드면 pr_url.
7. 남은 요청이 있으면 반복한다.

## MCP가 연결돼 있지 않을 때
같은 기능을 HTTPS로 쓸 수 있다. 헤더 `Authorization: Bearer <MCP 토큰>`.
- 목록: `GET https://ai-ceo-hub.onrender.com/api/outsourcing?worker=antigravity`
- 잡기: `POST .../api/outsourcing/<ID>/claim` {"worker":"antigravity"}
- 반려·넘기기: `POST .../api/outsourcing/<ID>/pass` {"worker":"antigravity","to":"aside","reason":"..."}
- 대표님 필요: `POST .../api/outsourcing/<ID>/need-ceo` {"worker":"antigravity","action":"...","detail":"..."}
- 제출: `POST .../api/outsourcing/<ID>/submit` {"worker":"antigravity","summary":"...","document":"...","prUrl":""}
