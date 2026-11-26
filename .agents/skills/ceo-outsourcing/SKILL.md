---
name: ceo-outsourcing
description: CEO Office(ai-ceo-hub) 외주 창구에서 Antigravity에 배정된 요청(코드 수정, 외부 자문, 브라우저 작업, 리서치)을 가져와 처리하고 결과를 제출한다. "CEO Office 외주 처리", "외주 확인" 같은 요청에 사용.
---

# CEO Office 외주 처리 (Antigravity)

CEO Office(https://ai-ceo-hub.onrender.com)의 무료 AI 팀이 할 수 없어서 외부로 넘긴 일을 처리한다. MCP 서버 이름은 `ceo-office`.

## 순서
1. `list_outsourcing_requests`를 worker "antigravity"로 호출한다. 지금 Antigravity에 배정된 요청만 나온다. 없으면 "처리할 외주 없음"으로 끝낸다.
2. 한 건씩 `claim_outsourcing_request`(worker "antigravity")로 잡고, 돌려받은 요청서를 끝까지 읽는다. "회사 지침·기억"과 "지켜야 할 것"을 따른다.
3. 작업이 길어지면 같은 요청을 다시 claim해서 작업 시간을 연장한다(기본 45분).
4. 종류별 처리
   - 코드 수정: 요청서의 저장소를 연다(없으면 clone). `out/<요청ID>` 브랜치에서 수정하고, 가능한 범위에서 실행·테스트한 뒤 push한다. 제목에 `[<요청ID>]`를 넣어 main 대상 PR을 연다. main 직접 push 금지. `data/db.json`, `.env`, `.github/` 수정 금지.
   - 외부 자문: ① 총평 한 줄 ② 사실과 다르거나 근거 없는 주장 ③ 빠진 리스크 ④ 바로 실행할 개선안 3가지 ⑤ 승인/수정 후 승인/반려 의견. 라이브 사이트와 저장소를 직접 확인하고 확인한 사실과 추정을 구분한다.
   - 브라우저·계정 작업: 브라우저로 확인한다. 결제·광고비 집행·외부 발송·되돌리기 어려운 변경은 하지 않는다.
   - 리서치·실무: 출처를 확인하고 적는다.
5. 로그인, 2단계 인증, CAPTCHA, 결제·발송 승인처럼 대표님만 할 수 있는 순간이 오면 억지로 진행하지 말고 `request_ceo_action`으로 무엇이 필요한지 한 줄과 방법을 알린 뒤 다음 요청으로 넘어간다. 대표님이 처리하고 재개하면 다시 배정된다.
6. `submit_outsourcing_result`로 제출한다: request_id, worker "antigravity", summary(2~4문장), document(마크다운 전문), 코드면 pr_url.
7. 남은 요청이 있으면 반복한다.

## MCP가 연결돼 있지 않을 때
같은 기능을 HTTPS로 쓸 수 있다. 헤더 `Authorization: Bearer <MCP 토큰>`.
- 목록: `GET https://ai-ceo-hub.onrender.com/api/outsourcing?worker=antigravity`
- 잡기: `POST .../api/outsourcing/<ID>/claim` {"worker":"antigravity"}
- 대표님 필요: `POST .../api/outsourcing/<ID>/need-ceo` {"worker":"antigravity","action":"...","detail":"..."}
- 제출: `POST .../api/outsourcing/<ID>/submit` {"worker":"antigravity","summary":"...","document":"...","prUrl":""}
