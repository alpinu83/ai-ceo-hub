# AGENTS.md — AI CEO Hub (`alpinu83/ai-ceo-hub`)

이 파일은 `ai-ceo-hub` 저장소에서 코드를 수정하는 모든 AI 에이전트(Antigravity, Aside 등)가 작업 전에 반드시 읽고 따라야 하는 작업 규칙입니다.

## 1. 파일 지도 (기준 문서: `docs/ARCHITECTURE.md`)
- 서버 모듈 구조와 공유 로직(`src/hub/*`), HTTP 라우트(`src/routes/*`)의 정식 지도는 **`docs/ARCHITECTURE.md`**를 기준으로 한다. (구조가 바뀌면 `docs/ARCHITECTURE.md`를 함께 갱신해 어긋나지 않게 유지)
- 주요 진입·연동 파일:
  - `server.js`: 앱 생성, 라우트 등록(인증 미들웨어가 최우선), MCP 연결, 부팅
  - `src/outsourcing.js` · `src/hub/outsourcing-bridge.js` · `src/routes/outsourcing.js`: 외부 협업(Antigravity · Aside · Gemini 앱) 라우팅·2단계 코드 검수(`codeWorkflow: 'agy_then_aside'`)
  - `src/mcp.js`: 공식 `@modelcontextprotocol/sdk` Streamable HTTP MCP 서버 (`/api/mcp`)
  - `public/index.html` · `public/app.js` · `public/styles.css`: 프론트엔드 SPA (Render + GitHub Pages 공용)
  - `scripts/windows/`: Windows 로컬 Antigravity 감시기 (`ceo-hub-agy-watcher.ps1`, `install-agy-watcher.ps1`)
  - `scripts/test-e2e.mjs`: 통합 E2E 테스트 (`npm test`)

## 2. 절대 깨뜨리지 말아야 할 규칙 (Hard Invariants)
1. **최신 `origin/main` 기반 작업 + `main` 직접 push 금지 (`main` 보호 설정 적용)**:
   - 작업 시작 전 반드시 `git fetch origin && git checkout -b <브랜치> origin/main`으로 최신 코드 위에서 시작한다.
   - `main` 직접 push는 금지(보호 설정으로 차단). 반드시 작업 브랜치(`out/<요청ID>` 또는 `feat/...`)에서 자동 테스트(CI)를 통과한 PR로만 반영한다.
   - PR을 올리기 직전에 `git fetch origin && git merge origin/main`을 한 번 더 수행해 최근 머지된 PR의 변경을 되돌린 줄이 없는지 확인한다.
2. **외주 API 하위 호환성 (Aside · Antigravity 감시기 계약)**:
   - Aside(`%LOCALAPPDATA%\CeoHubWatcher\ceo-hub-watcher.ps1`)와 Antigravity(`%LOCALAPPDATA%\CeoHubAgyWatcher\ceo-hub-agy-watcher.ps1`)가 `/api/outsourcing` (목록, `claim`, `submit`, `need-ceo`, `pass`) 응답 스키마에 의존한다. 기존 필드는 삭제·이름 변경 금지(추가만 허용).
   - SSE 엔드포인트 추가 금지(60초 HTTP 폴링 유지).
3. **2단계 코드 협업 (`codeWorkflow: 'agy_then_aside'`) 계약**:
   - 1단계(Antigravity): `kind: 'code'` 요청을 `out/<요청ID>` 브랜치로 작업·테스트 후 PR URL과 함께 `submit`.
   - 켜는 방법: 설정 → 역할 분담의 코드 수정 1순위(전체 기본값) 또는 외주 요청별 "맡길 곳: AGY 수정 + Aside 검수"(요청 필드 `codeWorkflow: 'agy_then_aside'`, `pinnedWorker: 'antigravity'`).
   - 서버 자동 인계: `reviewStage: 'aside_review'`, `sourcePrUrl: <1차 PR URL>`, `sourceOutsourceId: <1차 요청 ID>`, `reviewRound: 1..3`, `pinnedWorker: 'aside'`로 새 `kind: 'code'` 요청 생성.
   - 2단계(Aside):
     - 통과/직접 보완 완료: `POST /api/outsourcing/:id/submit` (`worker: "aside"`, `prUrl`, `summary`, `document`; `prUrl` 생략 시 `sourcePrUrl` 자동 폴백) → 대표님 결재 카드 생성.
     - 문제 발견 시 반려: `POST /api/outsourcing/:id/pass` (`worker: "aside"`, `to: "antigravity"`, `reason: "구체적인 수정 지시"`) → `reviewStage: 'agy_rework'`로 전환 → AGY가 같은 PR 수정 후 재제출하면 다시 `aside_review`로 자동 회귀(최대 3라운드).
4. **프론트엔드 캐시 버스팅**: `public/app.js` 수정 시 `public/index.html`의 `./app.js?v=YYYYMMDDx` 버전을 반드시 올린다.
5. **보호 파일 및 보안**: `data/db.json`, `data/state.json`, `.env`, `.github/` 수정 금지. 토큰·API 키를 코드·문서·로그에 절대 출력·커밋 금지.
6. **프로젝트 범위 규칙**: `대표님 돈벌어다주기` 프로젝트에서 세금·세무·연말정산 주제를 절대 제안·구현하지 않는다(세무는 `Korea-tax-cal.com` / `kr-calc-hub` 전용).
7. **PowerShell 5.1 호환**: `scripts/windows/*.ps1`은 PS 5.1 문법만 사용(`? :` 등 PS 7 전용 금지), UTF-8 HTTP 응답은 `StreamReader(..., [Text.Encoding]::UTF8)`로 명시 디코딩한다.

## 3. 코드 수정 필수 4단계 검증 루프
1. **동기화 & 선행 읽기**: `git fetch origin`으로 최신 `origin/main`을 받고, `docs/ARCHITECTURE.md`와 수정 대상 파일·모든 호출부(`rg`)를 끝까지 읽는다.
2. **최소·정밀 수정**: 요청 범위만 수정하고, 최근 PR 변경·기존 주석·무관한 동작을 건드리지 않는다.
3. **테스트 통과 필수**:
   - `node --check <변경된 .js 파일>`
   - `npm test` (통합 E2E — 100% 통과할 때까지 수정, 실패 상태로 PR 금지)
4. **PR 직전 최신화 & 자가 검수**:
   - `git fetch origin && git merge origin/main` 후 `npm test` 재확인
   - `git diff origin/main...HEAD`를 직접 검토(최근 PR 되돌림, 없는 import, 깨진 API, 캐시 버전, 토큰 노출 여부)
   - PR 본문에 ① 변경 요약 ② 수정 파일 목록 ③ 테스트 명령·결과 ④ 검수 확인 포인트를 남긴다.
