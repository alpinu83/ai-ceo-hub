# CEO Office — 오픈소스 멀티 AI 팀 지휘본부 (`ai-ceo-hub`)

검증된 GitHub 오픈소스 스택(**Hono**, **공식 `@modelcontextprotocol/sdk`**, **Vercel AI SDK**, **LiteLLM**, **Ollama**, **Marked**, **Lucide**)과 **텔레그램 CEO 결재 봇**을 결합해, 무료·유료 AI 모델 및 소비자 에이전트 앱(**Gemini, Gemini 4 Neon, Claude, Meta Muse, Manus Cue, 피클, 부이, 인스팅스**)을 하나의 회사처럼 지휘하고 결재하는 멀티 AI 컨트롤 타워입니다.

## 주요 기능

- **CEO 지휘실 (보드 · 리스트 · 실시간 SVG 조직 흐름도)**: 자연어 지시 → 총괄 팀장이 비용 전략(`무료·구독 우선` / `균형` / `최고 성능`)에 맞춰 하위 업무 자동 분배 → 병렬 실행(`대기 AI 전원 투입`) → 팀장 최종 임원 보고서(`.md` 다운로드)
- **CEO 결재함 (Executive Decision Memo)**: 결제·예약 확정·외부 발송·프로덕션 배포 전 자동 정지 → 승인 확정 / 수정 지시 / 반려 + 월간 예산(FinOps) 자동 반영
- **텔레그램 CEO 결재 봇 (모바일 양방향)**:
  - 결재 안건이 생기면 텔레그램으로 **`✅ 승인 확정` / `✏️ 수정 지시` / `❌ 반려`** 인라인 버튼 카드 자동 발송
  - 폰에서 `/order 지시내용`, `/status`, `/approvals` 명령어로 실시간 지휘 (Long Polling & `/api/telegram/webhook` 모두 지원)
- **공식 MCP 공유 업무함 서버 (`/api/mcp`)**: `@modelcontextprotocol/sdk` 기반 Streamable HTTP 서버 — **Meta Muse**, **Manus Cue**, **Claude Desktop / Claude Code** 양방향 연동
- **소비자 앱 · 월정액 구독 브릿지**: 공개 API가 없는 **피클·부이·인스팅스** 및 웹 구독(**Claude Pro / Gemini AI Pro**)용 맞춤 지시서 원클릭 복사 + 결과 보고 통합

## 내장 및 연동 GitHub 오픈소스 스택

| 오픈소스 프로젝트 | 역할 |
| :--- | :--- |
| **[honojs/hono](https://github.com/honojs/hono)** | 초경량 REST API · 정적 에셋 서버 |
| **[modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)** | 공식 `McpServer` + `StreamableHTTPServerTransport` (`/api/mcp`) |
| **[vercel/ai](https://github.com/vercel/ai)** (`@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) | Gemini(무료/4 Neon)·Claude·LiteLLM·Ollama 통합 실행 및 `Zod` 구조화 업무 분해 |
| **[BerriAI/litellm](https://github.com/BerriAI/litellm)** | 동봉된 `litellm_config.yaml` + `docker-compose.yml`로 100+ 모델 통합 라우팅 및 지출 상한선(Spend Cap) |
| **[paperclipai/paperclip](https://github.com/paperclipai/paperclip) 패턴** | 조직도(Org Chart) · 팀원별 월 예산 한도 · CEO 결재 거버넌스 설계 반영 |
| **[ollama/ollama](https://github.com/ollama/ollama)** | 비용 0원 로컬 오픈소스 LLM 팀원 연동 |
| **[markedjs/marked](https://github.com/markedjs/marked)** · **[lucide-icons/lucide](https://github.com/lucide-icons/lucide)** | GFM 임원 보고서 렌더링 및 오픈소스 아이콘 시스템 |

## 로컬 실행 및 테스트

```bash
npm install
npm start       # http://localhost:3456
npm test        # REST + 병렬 실행 + 공식 MCP SDK + 텔레그램 웹훅 E2E 검증
```

## 원클릭 클라우드 HTTPS 배포 (모바일 Muse · Cue MCP 접속용)

Meta Muse와 Manus Cue 앱은 공개 HTTPS URL의 `/api/mcp`에 접속합니다. 동봉된 설정 파일로 바로 배포할 수 있습니다:

- **Railway**: GitHub 저장소 연결 시 `railway.json` + `Dockerfile` 자동 인식 → `https://<app>.up.railway.app/api/mcp` 즉시 활성화
- **Render**: Blueprint(`render.yaml`) 연결 시 Docker 웹 서비스 자동 생성
- **Docker + LiteLLM 프록시**:
  ```bash
  docker compose --profile litellm up -d
  ```
- **GitHub Actions CI**: `.github/workflows/ci.yml`이 매 푸시/PR마다 Node 22 문법 검사 및 `npm test`를 자동 실행합니다.
