---
description: CEO Office 외주 요청 처리 (무료 AI 팀이 못 한 일과 외부 자문을 Antigravity가 처리)
---

# CEO Office 외주 처리

CEO Office(https://ai-ceo-hub.onrender.com)의 무료 AI 팀이 할 수 없어서 외부로 넘긴 일을 처리한다.

1. MCP 서버 `ceo-office`의 `list_outsourcing_requests`를 worker "antigravity"로 호출해 대기 요청을 본다.
   - MCP가 연결돼 있지 않으면: `GET https://ai-ceo-hub.onrender.com/api/outsourcing?worker=antigravity&token=<MCP 토큰>`
2. 처리할 요청 하나를 `claim_outsourcing_request`(worker: "antigravity")로 잡고, 돌려받은 요청서를 끝까지 읽는다.
   - "회사 지침·기억"과 "지켜야 할 것"을 반드시 따른다. 결제·광고비 집행·외부 발송은 하지 않는다(초안까지만).
3. 종류별로 처리한다.
   - **코드 수정**: 요청서의 저장소를 연다(작업공간에 없으면 clone). `out/<요청ID>` 브랜치를 만들어 수정하고, 가능한 범위에서 실행·테스트한 뒤 push한다. 제목에 `[<요청ID>]`를 넣어 main 대상 PR을 연다. main에 직접 push하지 않는다. `data/db.json`, `.env`, `.github/`는 건드리지 않는다.
   - **외부 자문**: 결재안을 비판적으로 검토한다. ① 총평 한 줄 ② 사실과 다르거나 근거 없는 주장 ③ 빠진 리스크 ④ 바로 실행할 개선안 3가지 ⑤ 승인/수정 후 승인/반려 의견.
   - **브라우저·계정 작업**: 브라우저로 진행하되 결제·발송·되돌리기 어려운 변경은 하지 말고, 했으면 무엇을 바꿨는지 기록한다.
   - **실무·리서치**: 바로 쓸 수 있는 결과 문서를 쓴다. 실제로 확인한 사실과 추정을 구분한다.
4. `submit_outsourcing_result`로 제출한다: request_id, worker "antigravity", summary(2~4문장), document(마크다운 전문), 코드면 pr_url.
5. 남은 요청이 있으면 1번부터 반복한다. 처리할 수 없는 요청은 잡지 말고 이유를 대표님께 알린다.
