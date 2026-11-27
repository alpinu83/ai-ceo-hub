# CEO Office 서버 구조

`server.js`는 시작점만 담당합니다(앱 생성, 라우트 등록, MCP 연결, 부팅). 실제 기능은 아래 파일에 있습니다.

## 공유 로직 `src/hub/`
| 파일 | 하는 일 |
|-|-|
| `env.js` | 저장소 루트 경로, public 폴더, package.json |
| `missions.js` | 업무 생성, 자동 실행(autoStart), 결재 결정 반영 |
| `task-results.js` | 작업 결과 단일 처리 경로: 팀장 검수, 재작업, 상위 처리, 결과물 등록 |
| `lead-ops.js` | 총괄 팀장: 보고, 후속 배정, 운영 사이클(작전 계획, 마일스톤, 관문 결재) |
| `code-pipeline.js` | 결재 = 실코드 반영: PR 작성, 보안 감사, 머지, 배포 감시 |
| `outsourcing-bridge.js` | 외부 AI 외주 창구 연결: 결과 반영, 자문, 텔레그램 명령 |
| `ceo-chat.js` | 회의실·텔레그램 대화와 지시 등록 |
| `agent-inbox.js` | 외부 봇(HTTPS 인박스) 작업 보고 |
| `notify.js` | 텔레그램·푸시·웹훅 알림, 방해금지 시간 |
| `routines.js` | 루틴 업무, 정기 점검, 워치독 |

## HTTP 라우트 `src/routes/`
`auth`(관리자 키·텔레그램 로그인), `system`(상태·헬스·푸시·내보내기), `chat`, `agent-inbox`, `missions`(프로젝트·작업·결재), `routines`, `outsourcing`, `settings`(팀원·설정·스킬·기억).
등록 순서는 `server.js`에 있으며, 인증 미들웨어가 가장 먼저 등록되어야 합니다.

## 운영 방식
모든 프로젝트는 운영 사이클 하나로 진행합니다: 팀장이 작전 계획(마일스톤 + 완료 기준)을 세우고, 작업을 배정·검수하며, 대표님 결재는 관문(방향 선택, 비용, 외부 계정, 출시)에서만 받습니다. 예전의 단계별 제안서(next_phase) 방식은 제거되었습니다.


## 팀장 업무함 (lead desk)
- `src/lead-desk.js`: 팀장의 백그라운드 판단(결과물 검수 `review`, 작전 계획 `plan`, 마일스톤 판정 `milestone`)을 업무함에 올리고 깨어 있는 팀장에게 맡김. `generateObjectChain(..., { leadDesk })`가 진입점.
  - 주간: AGY 팀장 감시기(`worker=agy_lead`, Hydrogen 고정)가 최근 3분 안에 `GET /api/lead-jobs?worker=agy_lead`로 접속했으면 AGY 몫
  - 야간·부재: Gemini 앱 예약 작업이 MCP `list_lead_jobs` / `claim_lead_job` / `submit_lead_job`(worker `gemini_app`)으로 처리
  - AGY 몫이 15분 안 잡히면 Gemini 앱으로, Gemini 앱 몫이 100분 지나면 만료 → 기존 Gemini API 체인으로 판단
  - 서버는 기다리지 않음: `LeadPendingError`를 던지고 검수 작업은 `review_pending` 상태. 답이 제출되면 `src/hub/lead-desk-bridge.js`가 원래 일을 다시 실행(같은 키로 저장된 답을 사용)
- HTTP: `GET /api/lead-jobs`, `GET /api/lead-jobs/:id`, `POST /api/lead-jobs/:id/claim`, `POST /api/lead-jobs/:id/submit` (`src/routes/lead-desk.js`, 인증은 외주 API와 동일)
- 새 업무 분해·회의실 답변처럼 즉답이 필요한 것은 업무함을 거치지 않고 Gemini API가 처리
- 휴직한 무료 API 제공자(Groq·OpenRouter 등)는 팀장 대체 엔진에서도 제외(`buildLeadModelChain(..., agents)`)
- IT팀(무료 API)이 휴직이면 팀장이 배정한 코드 수정 작업은 바로 AGY 수정 → Aside 검수 외주(`codeWorkflow: 'agy_then_aside'`)
