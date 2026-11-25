# CEO Office — 오픈소스 멀티 AI 팀 지휘본부 (`ai-ceo-hub`)

검증된 GitHub 오픈소스 스택(**Hono**, **공식 `@modelcontextprotocol/sdk`**, **Vercel AI SDK**, **LiteLLM**, **Ollama**, **Marked**, **Lucide**)과 **텔레그램 CEO 결재 봇**을 결합해, 무료·유료 AI 모델 및 소비자 에이전트 앱(**LG K-EXAONE 2.5, Gemini, Gemini 4 Neon, Claude, Meta Muse, Manus Cue, 피클, 부이, 인스팅스**)을 하나의 회사처럼 지휘하고 결재하는 모바일·데스크톱 대응 멀티 AI 컨트롤 타워입니다.

## 주요 기능

- **CEO 홈 (메인 요약) & 업무 보드 분리**: 메인 화면에는 CEO가 즉시 봐야 할 3대 지표·빠른 지시·대기 결재·진행 미션만 배치하고, 세부 칸반 보드·리스트·SVG 조직 흐름도·로그는 전용 **업무 보드** 메뉴로 분리했습니다. (모바일 하단 5탭 네비게이션 지원)
- **라이브 회의실 (`#전사-회의실`)**: AI 팀장과 9명의 팀원들이 각자 자리에서 협업하고 핸드오프하는 대화를 실시간으로 보고 `@멘션`으로 직접 지시할 수 있습니다.
- **무료 자동 실행 2인 체제 (LG K-EXAONE 2.5 + Google Gemini 무료)**:
  - `EXAONE_API_KEY` (`https://api.exaone.ai/v1`, `k-exaone_v2.5`, 512K 컨텍스트) — 한국어 요약·문서 초안·번역·단순 자동화 무료 처리
  - `GEMINI_API_KEY` (`gemini-2.5-flash`) — 업무 분해·1차 리서치·회의실 실시간 응답 무료 처리
- **CEO 결재함 (Executive Decision Memo)**: 결제·예약 확정·외부 발송·프로덕션 배포 전 자동 정지 → 원터치 승인 / 수정 지시 / 반려 + 월간 예산(FinOps) 자동 반영
- **공식 MCP 공유 업무함 서버 (`/api/mcp`)**: `@modelcontextprotocol/sdk` 기반 Streamable HTTP 서버 — **Meta Muse**, **Manus Cue**, **Claude Desktop / Claude Code** 양방향 연동
- **Render 무료 티어 영구 백업 (GitHub Gist)**: `GITHUB_GIST_TOKEN` + `GIST_BACKUP_ID` 환경변수 설정 시 무료 클라우드 서버가 재시작돼도 미션·결재·설정이 비공개 Gist에서 자동 복구됩니다.

## 결재 승인 = 실코드 반영·배포 (IT 유지보수팀)

GitHub 저장소가 연결된 프로젝트(예: Korea-tax-cal.com → `alpinu83/kr-calc-hub`, CEO Office → `alpinu83/ai-ceo-hub`)는 별도 버튼이나 추가 지시 없이 다음 순서로 돌아갑니다.

1. AI 팀원들이 협업해 작업을 마치면, IT 유지보수팀이 팀 결정사항을 **실제 저장소 코드로 변경한 PR**을 만들고 보안 감사를 합니다.
2. 배포·코드 관련 결재 카드에는 그 PR(diff)이 붙은 뒤에 결재함·텔레그램으로 올라갑니다. (팀장 전결로 끝난 코드 작업도 PR 결재 카드로 자동 상신)
3. 대표님이 **승인**하면 CI 확인 → main 머지 → 라이브 배포 → GitHub Actions 결과 확인까지 자동으로 진행되고 결과를 로그·텔레그램으로 보고합니다.
4. **반려**하면 PR을 닫고, **수정 지시**하면 메모를 반영해 새 PR을 다시 올립니다.

안전장치: CI 실패 시 머지 보류, 보안 감사 high/주의 판정 시 자동 머지 중단 후 재확인 결재, main 충돌 시 최신 코드 기준으로 재작성, `data/db.json`·`.env`·`.github/` 수정 금지. 결제·광고비 집행·예약 확정 같은 결재는 코드 반영 대상에서 제외됩니다.

> 승인이 곧 배포이므로 Render 환경변수에 `CEO_ADMIN_KEY`를 설정해 API를 잠그는 것을 권장합니다. 설정하면 웹앱이 처음 한 번 키를 묻고 브라우저에 저장합니다.

## 회사 운영 엔진 (루틴 업무 · 정기 점검 · 자동 복구)

- **회의실 지시 = 실제 업무**: 회의실에서 대표님이 지시하면 팀장이 실제 업무로 등록·배정하고 바로 실행합니다. ("반려했던 거 다시 진행" 같은 말도 처리) 등록된 일이 없으면 "반영하겠습니다" 같은 빈 약속을 하지 않습니다.
- **루틴 업무 메뉴**: 정해진 요일·시간마다 AI 팀원에게 업무를 자동 배정합니다. 기본 루틴: 매일 10:00 정기 점검, 19:00 일일 마감 보고(텔레그램), 매주 월요일 사이트·자체 점검.
- **정기 점검**: 라이브 사이트 응답, GitHub Actions 배포 결과, 멈춘 업무, 오래된 결재, AI 엔진 한도, 백업 상태를 AI 한도 없이 점검하고 이상이 있을 때만 알립니다.
- **자동 복구(5분마다)**: 멈춘 작업을 되살리고, 대기 중인 AI 업무를 다시 실행합니다. 3번 실패하면 텔레그램으로 알립니다.
- **AI 한도 관리**: 무료 한도가 바닥난 엔진은 회복될 때까지 건너뛰고 다른 엔진으로 즉시 넘깁니다. 모든 AI 호출은 2분이 지나면 끊어서 멈춤을 막습니다.

## 총괄 팀장 능동 추진 · 전역 지침 · 회사 기억 (`src/lead-engine.js`)

API로 연결된 AI는 호출할 때마다 기억이 없기 때문에, 서버가 기억과 지침을 대신 들고 매 호출에 붙여 줍니다.

- **CEO 전역 지침**: 설정 → 기본 정보에서 편집. 팀원 작업·팀장 대화·업무 분해·임원 보고·IT팀 PR·외부 봇 수신함·MCP `get_company_brief`까지 모든 경로에 항상 적용됩니다.
- **회사 기억**: CEO 지시, 결재 결정(반려 사유 포함), 실행 결과, 배포 결과, 코드 반영 실패 원인이 자동으로 쌓입니다(최대 150개, 고정 항목은 유지). 회의실·텔레그램에서 "앞으로… / 항상… / 기억해"라고 말하면 고정 지침으로 저장됩니다. 회의실 메시지가 160개를 넘어 지워져도 맥락이 남습니다.
- **완료 보고**: 작업 묶음이 끝나면(코드 PR 작성 여부까지 포함) 총괄 팀장이 회의실과 텔레그램으로 먼저 보고합니다. 대표님이 해야 할 일(결재, 외부 계정 작업, 토큰 권한 등)은 따로 묶어 요청합니다. 머지·배포 결과(성공·실패·확인 불가)도 모두 보고합니다.
- **정기 점검(기본 30분)**: 누락된 보고, 6시간 넘은 결재 대기, 멈춘 외부 봇 업무, 재시도 소진, 실패한 코드 반영을 찾아 원인과 해결 방법을 먼저 알립니다(같은 건은 12시간에 한 번).
- **후속 추진**: 업무의 작업이 모두 끝나면 팀장이 스스로 판단합니다. 목표 달성이면 마무리 보고, 더 할 일이 있으면 후속 작업을 배정해 바로 실행, 막혔으면 대표님께 구체적으로 요청합니다. 대표님 개입 없이 이어가는 라운드는 기본 2회로 제한되고, 대표님이 말하거나 결재하면 초기화됩니다. 결제·외부 발송·배포는 계속 결재를 거칩니다.
- **텔레그램 자유 대화**: 명령어 없이 메시지를 보내면 회의실 발언과 똑같이 처리됩니다(지시면 실제 업무 등록). `#업무명 메시지`로 채널을 지정하고 `#전체`로 해제합니다.
- API: `GET/POST /api/memory`, `DELETE /api/memory/:id`, `POST /api/lead/follow-up`(지금 바로 팀장 점검), `PUT /api/settings`의 `globalDirectives`·`leadEngine`.

## 로컬 실행 및 테스트

```bash
npm install
npm start       # http://localhost:3456
npm test        # REST + 병렬 실행 + 공식 MCP SDK + 텔레그램 웹훅 E2E 검증
```

## 무료 클라우드 HTTPS 배포 (모바일 Muse · Cue MCP 접속용)

Meta Muse와 Manus Cue 앱은 공개 HTTPS URL의 `/api/mcp`에 접속합니다:

- **Render 무료 원클릭 배포**: `https://render.com/deploy?repo=https://github.com/alpinu83/ai-ceo-hub` (`render.yaml` Blueprint 자동 인식 · `EXAONE_API_KEY`, `GEMINI_API_KEY`, `GITHUB_GIST_TOKEN` 입력 가능)
- **Railway**: GitHub 저장소 연결 시 `railway.json` + `Dockerfile` 자동 인식
- **Docker + LiteLLM 프록시**: `docker compose --profile litellm up -d`
- **GitHub Actions CI & Pages**: `.github/workflows/ci.yml` (자동 테스트) 및 `.github/workflows/pages.yml` (웹앱 자동 배포)

