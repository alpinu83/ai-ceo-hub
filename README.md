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

