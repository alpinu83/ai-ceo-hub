/**
 * Browser Standalone Runtime for GitHub Pages / Static Hosting.
 * Automatically activates when no Node.js backend is attached, providing:
 * - Full persistent localStorage database (org chart, missions, tasks, approvals, budgets, logs)
 * - Direct browser calls to Google Gemini API (Free & 4 Neon), Anthropic Claude API, LiteLLM/Ollama, and Telegram Bot API
 * - Smart Korean Team Lead decomposition, parallel execution, custom dispatch prompts, and MCP preview
 */

const STORAGE_KEY = 'ceo_office_standalone_v5';

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultDb() {
  const now = new Date().toISOString();
  const sampleMissionId = 'msn_welcome_01';

  return {
    settings: {
      companyName: 'CEO Office',
      ceoName: '대표님',
      defaultCostPolicy: 'free_first',
      monthlyBudgetKRW: 150000,
      spentThisMonthKRW: 40000,
      approvalThresholdKRW: 30000,
      requireApprovalForExternal: true,
      webhookUrl: '',
      remoteBackendUrl: '',
      telegram: {
        botToken: '',
        chatId: '',
        pollingEnabled: false
      },
      mcpToken: `ceo_mcp_${Math.random().toString(36).slice(2, 14)}`,
      providers: {
        gemini: { apiKey: '', freeModel: 'gemini-2.5-flash', paidModel: 'gemini-4-neon', enabled: false },
        claude: { apiKey: '', model: 'claude-sonnet-4-5', enabled: false },
        exaone: { apiKey: '', baseUrl: 'https://api.exaone.ai/v1', model: 'k-exaone_v2.5', enabled: false },
        manus: { apiKey: '', baseUrl: 'https://api.manus.ai/v1', cueEmail: '', enabled: false },
        litellm: { apiKey: '', baseUrl: 'http://localhost:4000/v1', model: 'gemini-free', enabled: false },
        ollama: { apiKey: '', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:14b', enabled: false }
      }
    },
    agents: [
      {
        id: 'agent_gemini_neon',
        name: 'Gemini 4 Neon',
        shortCode: 'GN',
        roleTitle: '전략·총괄 팀장 (AI Pro 구독)',
        tier: 'lead',
        reportsTo: 'ceo',
        provider: 'gemini',
        modelId: 'gemini-4-neon',
        connectionMode: 'bridge',
        costTier: 'paid_or_sub',
        appUrl: 'https://gemini.google.com',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev', 'life'],
        strengths: '복합 CEO 지시 분해, 장문 문서·PDF·표 분석, 전체 팀원 업무 배정 및 임원 종합 보고',
        bridgeGuide: '사전 추천 설정: 이미 결제 중인 Google AI Pro/Ultra 구독 앱을 추가 과금 0원으로 사용합니다. (지시서 복사 → Gemini 앱 바로 열기)',
        active: true,
        accent: '#0E6245'
      },
      {
        id: 'agent_claude',
        name: 'Claude',
        shortCode: 'CL',
        roleTitle: '개발·기획 수석 팀장 (구독 활용)',
        tier: 'lead',
        reportsTo: 'ceo',
        provider: 'claude',
        modelId: 'claude-sonnet-4-5',
        connectionMode: 'bridge',
        costTier: 'paid_or_sub',
        appUrl: 'https://claude.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['dev', 'business', 'content'],
        strengths: '정밀 코딩·아키텍처 설계, 코드 리뷰, 높은 완성도의 제안서·기획서 작성 및 검수',
        bridgeGuide: '사전 추천 설정: Claude Pro/Max 월정액 구독을 추가 API 과금 0원으로 사용합니다. (지시서 복사 → Claude 바로 열기)',
        active: true,
        accent: '#9A4A2E'
      },
      {
        id: 'agent_exaone',
        name: 'LG K-EXAONE 2.5',
        shortCode: 'EX',
        roleTitle: '한국어 실무·요약·단순업무 에이스 (무료 자동)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'exaone',
        modelId: 'k-exaone_v2.5',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://docs.exaone.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev', 'life'],
        strengths: 'LG AI연구원 무료 K-EXAONE 2.5 API(512K 컨텍스트). 한국어 문서 요약, 이메일 초안, 단순 반복 정리, 코딩 보조를 비용 0원 자동 실행',
        bridgeGuide: '보유하신 LG EXAONE API 키를 설정에 넣으면 https://api.exaone.ai/v1 로 즉시 무료 자동 가동됩니다.',
        active: true,
        accent: '#A50034'
      },
      {
        id: 'agent_muse',
        name: 'Meta Muse',
        shortCode: 'MS',
        roleTitle: '개인 컨텍스트·프로젝트 팀원 (무료 MCP)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'muse',
        modelId: 'meta-muse',
        connectionMode: 'mcp',
        costTier: 'free',
        appUrl: 'https://www.meta.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['life', 'business', 'content'],
        strengths: 'CEO 취향·제약 장기 기억, Spaces 프로젝트 보드, 이메일 정리 및 개인화 기획',
        bridgeGuide: 'Render 무료 MCP 서버(/api/mcp)를 Muse Settings → Connectors에 등록하면 복사·붙여넣기 없이 자동 연동됩니다.',
        active: true,
        accent: '#2B59C3'
      },
      {
        id: 'agent_cue',
        name: 'Manus Cue',
        shortCode: 'CU',
        roleTitle: '자율 리서치·메일 팀원 (무료 MCP)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'manus',
        modelId: 'manus-cue',
        connectionMode: 'mcp',
        costTier: 'freemium',
        appUrl: 'https://manus.im',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev'],
        strengths: '에이전트 전용 이메일·전화번호·가상 컴퓨터 기반 딥 리서치 및 외부 메일 송수신',
        bridgeGuide: 'Render 무료 MCP 서버(/api/mcp)를 Cue Integrations에 연결하거나 전용 이메일(Mail Manus)로 자동 지시합니다.',
        active: true,
        accent: '#3F6212'
      },
      {
        id: 'agent_pickle',
        name: '피클 (Pickle)',
        shortCode: 'PK',
        roleTitle: '한국 전화 예약·생활 실행 팀원 (무료 앱)',
        tier: 'executor',
        reportsTo: 'agent_gemini_neon',
        provider: 'pickle',
        modelId: 'pickle-app',
        connectionMode: 'bridge',
        costTier: 'free',
        appUrl: 'https://pickle.com/ko',
        monthlyCapKRW: 50000,
        spentKRW: 40000,
        domains: ['life', 'business'],
        strengths: '국내 식당·병원 전화 문의 및 예약, KTX·국내 플랫폼 실행 (결제 전 CEO 승인 필수)',
        bridgeGuide: '사전 추천 설정: 승인 멈춤 조건이 자동 삽입된 지시서를 복사해 피클 앱에 전달하고, 예약·결제 직전 CEO 결재를 받습니다.',
        active: true,
        accent: '#2F7D32'
      },
      {
        id: 'agent_vooy',
        name: '부이 (vooy)',
        shortCode: 'VY',
        roleTitle: '정기 브리핑·가격 모니터링 팀원 (무료)',
        tier: 'executor',
        reportsTo: 'agent_gemini_neon',
        provider: 'vooy',
        modelId: 'vooy-app',
        connectionMode: 'bridge',
        costTier: 'free',
        appUrl: '',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['life', 'business', 'content'],
        strengths: '매일 아침 같은 조건으로 뉴스·트렌드·상품 가격 반복 수집, 모임·여행 일정 조율',
        bridgeGuide: '사전 추천 설정: 기본 무료 모델만 쓰도록 조건이 들어간 지시서를 복사해 부이 앱에 등록합니다.',
        active: true,
        accent: '#A15C07'
      },
      {
        id: 'agent_instinct',
        name: '인스팅스 (Instinct)',
        shortCode: 'IN',
        roleTitle: '문자·전화 빠른 심부름 팀원 (무료 베타)',
        tier: 'executor',
        reportsTo: 'agent_gemini_neon',
        provider: 'instinct',
        modelId: 'instinct-beta',
        connectionMode: 'bridge',
        costTier: 'free',
        appUrl: '',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['life'],
        strengths: '별도 앱 없이 문자(iMessage/WhatsApp)·전화만으로 빠르게 처리하는 생활 심부름',
        bridgeGuide: '사전 추천 설정: 짧은 문자 지시문을 원클릭 복사해 인스팅스 대화방에 그대로 보내고 회신을 등록합니다.',
        active: true,
        accent: '#52525B'
      }
    ],
    missions: [
      {
        id: sampleMissionId,
        title: '1인 기업 주간 운영 + 고객 미팅 성수동 식사 예약',
        directive:
          '이번 주 신규 클라이언트 제안서 초안을 준비하고, 목요일 저녁 성수역 근처 4인 비즈니스 미팅 식당을 조사해 예약까지 진행해줘. 매일 아침 경쟁사 소식 브리핑도 세팅해줘.',
        domain: 'business',
        costPolicy: 'balanced',
        leadAgentId: 'agent_gemini_neon',
        status: 'waiting_approval',
        createdAt: now,
        leadPlanSummary:
          '총괄 팀장(Gemini 4 Neon)이 비용 균형 전략에 따라 1차 리서치는 무료 Gemini, 제안서 본문은 수석 Claude, 반복 뉴스 브리핑은 부이(vooy), 전화 예약은 피클(Pickle)에 배정했습니다. 식당 예약금 결제 직전에 CEO 결재 게이트를 배치했습니다.',
        finalReport: ''
      }
    ],
    tasks: [
      {
        id: 'tsk_sample_1',
        missionId: sampleMissionId,
        title: '경쟁사 3곳 가격·서비스 구조 1차 리서치',
        description: '국내 주요 경쟁사 3곳의 요금제, 핵심 기능, 최근 업데이트를 표로 정리해 제안서 근거 자료를 확보합니다.',
        assigneeId: 'agent_exaone',
        domain: 'business',
        status: 'completed',
        requiresApproval: false,
        estimatedCostKRW: 0,
        dispatchPrompt: '[LG K-EXAONE 2.5] 국내 주요 경쟁사 3곳의 요금제, 차별점, 약점을 비교 표로 정리해 주세요.',
        output:
          '### 경쟁사 3곳 비교 요약\n\n| 구분 | 가격 정책 | 핵심 강점 | 한계점 |\n| --- | --- | --- | --- |\n| **A사** | 월 49,000원 | 워크플로우 자동화 | 한국 전화 예약·생활 에이전트 부재 |\n| **B사** | 토큰 종량제 | 개발자 코딩 특화 | 비개발자용 CEO 결재 UI 복잡 |\n| **C사** | 무료 베타 | 개인 일상 비서 | 팀 단위 분업·통제 불가 |\n\n**제안서 핵심 소구점**: 무료 에이전트(EXAONE·Muse·피클·부이·인스팅스)와 구독 모델(Gemini 4 Neon·Claude)을 **오픈소스 MCP + CEO 결재 체계**로 통합.',
        executionModeUsed: 'simulation',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'tsk_sample_2',
        missionId: sampleMissionId,
        title: 'B2B 신규 클라이언트 제안서 본문 작성 및 검수',
        description: '리서치 결과를 반영해 5페이지 분량의 설득력 있는 제안서 초안과 예상 Q&A를 작성합니다.',
        assigneeId: 'agent_claude',
        domain: 'business',
        status: 'queued',
        requiresApproval: false,
        estimatedCostKRW: 0,
        dispatchPrompt:
          '[Claude 수석 팀장 지시서]\n목표: 신규 클라이언트용 5페이지 B2B 제안서 초안 작성\n포함 항목: 1) 문제 정의 2) 하이브리드 AI 팀 솔루션 3) 기대 ROI 4) 2주 파일럿 일정 5) 예상 질문 5선\n제약: 과장된 수치 금지, 의사결정권자가 바로 결재할 수 있는 간결한 톤 유지.',
        output: '',
        executionModeUsed: '',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'tsk_sample_3',
        missionId: sampleMissionId,
        title: '성수역 4인 비즈니스 식당 후보 조사 및 전화 예약',
        description: '목요일 오후 7시, 성수역 도보 10분 이내 조용한 프라이빗 룸 식당 3곳을 조사하고 전화 빈자리 확인 후 예약합니다.',
        assigneeId: 'agent_pickle',
        domain: 'life',
        status: 'awaiting_approval',
        requiresApproval: true,
        estimatedCostKRW: 240000,
        dispatchPrompt:
          '[피클(Pickle) 전달용 지시서]\n목요일 오후 7시, 성수역 도보 10분 이내 4인 비즈니스 식사 가능한 조용한 식당 3곳을 찾아줘.\n1인 예상 비용(6만원 이내), 룸 여부, 취소 수수료 규정을 정리하고 전화로 빈자리만 먼저 확인해줘.\n⚠️ 중요: 실제 예약 확정 및 예약금 결제는 절대 먼저 진행하지 말고, 후보와 금액을 정리해서 내 승인을 받은 뒤 실행해줘.',
        output:
          '### 피클 전화 확인 결과 (1순위 확보)\n- **식당명**: 성수 모던 한식 다이닝 (성수역 3번 출구 도보 6분)\n- **일시/인원**: 목요일 19:00 · 4인 프라이빗 룸\n- **예상 비용**: 1인 60,000원 코스 (총 240,000원 / **예약금 40,000원**)\n- **취소 규정**: 전일 오후 6시까지 100% 무료 취소\n\n> 예약 확정 및 예약금 결제 직전 단계에서 **CEO 결재 대기 중**입니다.',
        executionModeUsed: 'bridge',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'tsk_sample_4',
        missionId: sampleMissionId,
        title: '매일 오전 8시 경쟁사·AI 업계 브리핑 루틴 등록',
        description: '매일 아침 출근 전 경쟁사 업데이트와 AI 에이전트 업계 핵심 뉴스 5건을 자동 수집하도록 설정합니다.',
        assigneeId: 'agent_vooy',
        domain: 'business',
        status: 'awaiting_bridge',
        requiresApproval: false,
        estimatedCostKRW: 0,
        dispatchPrompt:
          '[부이(vooy) 전달용 지시서]\n매일 오전 8시마다 아래 키워드로 최신 소식 5건을 요약해서 브리핑해줘.\n- 키워드: 개인 AI 에이전트, MCP 커넥터, 국내 B2B AI 자동화\n- 형식: 제목 / 1줄 핵심 / 원본 링크 / CEO 의사결정 필요 여부\n- 기본 무료 모델만 사용하고, 유료 토큰 전환 전에는 반드시 먼저 물어봐 줘.',
        output: '',
        executionModeUsed: 'bridge',
        createdAt: now,
        updatedAt: now
      }
    ],
    approvals: [
      {
        id: 'apr_sample_1',
        missionId: sampleMissionId,
        taskId: 'tsk_sample_3',
        agentId: 'agent_pickle',
        title: '성수역 4인 비즈니스 식당 예약 확정 및 예약금 결제 승인',
        category: '예약 · 결제',
        riskLevel: 'medium',
        estimatedCostKRW: 240000,
        depositKRW: 40000,
        summary:
          '피클이 성수역 도보 6분 프라이빗 룸 식당(목요일 19:00, 4인)의 빈자리를 전화로 확인했습니다. 예약 확정 시 예약금 40,000원이 결제되며, 전일 18시까지 무료 취소가 가능합니다.',
        proposedAction: '피클 앱에서 예약 확정 승인 → 확정 문자 수신 후 팀장 최종 임원 보고서에 반영',
        status: 'pending',
        ceoNote: '',
        createdAt: now,
        decidedAt: null
      }
    ],
    logs: [
      {
        id: 'log_init_1',
        timestamp: now,
        actor: 'Gemini 4 Neon (총괄 팀장)',
        level: 'info',
        message: '샘플 미션 "1인 기업 주간 운영 + 고객 미팅 성수동 식사 예약"을 4개 실무 작업으로 분배했습니다.'
      },
      {
        id: 'log_init_2',
        timestamp: now,
        actor: '피클 (Pickle)',
        level: 'approval',
        message: '성수역 식당 전화 확인 완료 — 예약금 40,000원 결제 전 CEO 결재함에 상신했습니다.'
      }
    ],
    messages: [
      {
        id: 'msg_init_1',
        missionId: sampleMissionId,
        senderId: 'ceo',
        senderName: '대표님 (CEO)',
        senderRole: '최종 지시 · 결재권자',
        senderShortCode: 'CEO',
        senderAccent: '#171614',
        targetAgentId: 'agent_gemini_neon',
        statusText: '지시 하달',
        type: 'directive',
        text: '이번 주 신규 클라이언트 제안서 초안 준비하고, 목요일 저녁 성수역 근처 4인 비즈니스 미팅 식당을 조사해 예약까지 진행해줘. 매일 아침 경쟁사 소식 브리핑도 세팅해줘.',
        timestamp: now
      },
      {
        id: 'msg_init_2',
        missionId: sampleMissionId,
        senderId: 'agent_gemini_neon',
        senderName: 'Gemini 4 Neon',
        senderRole: '전략·총괄 팀장',
        senderShortCode: 'GN',
        senderAccent: '#0E6245',
        targetAgentId: 'agent_exaone',
        statusText: '업무 분배 중',
        type: 'plan',
        text: '대표님 지시 확인했습니다! 바로 분배하겠습니다. @엑사원 님은 경쟁사 3곳 가격·기능 리서치 먼저 부탁드리고, @Claude 수석님은 리서치 받아서 제안서 5페이지 본문 잡아주세요. @피클 님은 성수역 4인 룸 식당 전화 확인, @부이 님은 매일 오전 8시 경쟁사 브리핑 루틴 세팅 부탁드립니다!',
        timestamp: now
      },
      {
        id: 'msg_init_3',
        missionId: sampleMissionId,
        senderId: 'agent_exaone',
        senderName: 'LG K-EXAONE 2.5',
        senderRole: '한국어 실무·요약·리서치',
        senderShortCode: 'EX',
        senderAccent: '#A50034',
        targetAgentId: 'agent_claude',
        statusText: '리서치 완료 · 핸드오프',
        type: 'handoff',
        text: '네 팀장님! 무료 API로 국내 경쟁사 3곳 요금제·차별점 비교 표 정리 마쳤습니다. A사는 국내 전화 예약이 없고 B사는 결재 UI가 복잡하네요. @Claude 수석님, 제안서 핵심 소구점 바로 쓰실 수 있게 표 넘겨드렸습니다!',
        timestamp: now
      },
      {
        id: 'msg_init_4',
        missionId: sampleMissionId,
        senderId: 'agent_claude',
        senderName: 'Claude',
        senderRole: '개발·기획 수석 팀장',
        senderShortCode: 'CL',
        senderAccent: '#9A4A2E',
        targetAgentId: 'agent_exaone',
        statusText: '제안서 초안 구성 중',
        type: 'work',
        text: '@Gemini(무료) 님 자료 잘 받았습니다. 비교 표가 깔끔하네요. 이걸 기반으로 ROI 섹션과 2주 파일럿 일정까지 넣어서 5페이지 제안서 초안 마무리하겠습니다. 실행 버튼 눌러주시면 바로 완성본 올리겠습니다.',
        timestamp: now
      },
      {
        id: 'msg_init_5',
        missionId: sampleMissionId,
        senderId: 'agent_pickle',
        senderName: '피클 (Pickle)',
        senderRole: '전화 예약·생활 실행',
        senderShortCode: 'PK',
        senderAccent: '#2F7D32',
        targetAgentId: 'ceo',
        statusText: 'CEO 결재 대기',
        type: 'approval',
        text: '@대표님 성수역 3번 출구 도보 6분 프라이빗 룸 한식 다이닝에 직접 전화해 목요일 19시 4인 빈자리 확인했습니다! 1인 6만원(예약금 4만원, 전일 18시까지 무료 취소)입니다. 결제 전이라 멈춰두고 CEO 결재함에 상신했어요 — 승인해 주시면 바로 확정하겠습니다!',
        timestamp: now
      },
      {
        id: 'msg_init_6',
        missionId: sampleMissionId,
        senderId: 'agent_vooy',
        senderName: '부이 (vooy)',
        senderRole: '정기 브리핑·모니터링',
        senderShortCode: 'VY',
        senderAccent: '#A15C07',
        targetAgentId: 'agent_gemini_neon',
        statusText: '브리핑 루틴 준비',
        type: 'work',
        text: '@Gemini 4 Neon 팀장님, 매일 오전 8시 경쟁사·AI 에이전트 핵심 소식 5건 자동 수집 조건 만들어 두었습니다. 기본 무료 모델만 쓰도록 세팅했고 지시서 복사해서 부이 앱에 등록하시면 내일 아침부터 브리핑이 옵니다!',
        timestamp: now
      }
    ]
  };
}

function loadLocalDb() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const init = createDefaultDb();
      saveLocalDb(init);
      return init;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.messages)) {
      parsed.messages = createDefaultDb().messages;
    }
    return parsed;
  } catch {
    return createDefaultDb();
  }
}

function saveLocalDb(db) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore storage quota
  }
}

function sanitize(db) {
  const clone = JSON.parse(JSON.stringify(db));
  const providers = clone.settings?.providers || {};
  for (const k of Object.keys(providers)) {
    const raw = providers[k].apiKey || '';
    providers[k].hasApiKey = raw.length > 0;
    providers[k].apiKeyPreview = raw ? `${raw.slice(0, 4)}••••${raw.slice(-4)}` : '';
    delete providers[k].apiKey;
  }
  if (clone.settings?.telegram) {
    const rawTg = clone.settings.telegram.botToken || '';
    clone.settings.telegram.hasBotToken = rawTg.length > 0;
    clone.settings.telegram.botTokenPreview = rawTg ? `${rawTg.slice(0, 6)}••••${rawTg.slice(-4)}` : '';
    delete clone.settings.telegram.botToken;
  }
  return clone;
}

function addLog(db, actor, message, level = 'info') {
  db.logs.unshift({ id: uid('log'), timestamp: new Date().toISOString(), actor, level, message });
  if (db.logs.length > 80) db.logs = db.logs.slice(0, 80);
}

function addMessage(db, msg) {
  if (!Array.isArray(db.messages)) db.messages = [];
  const entry = { id: uid('msg'), timestamp: new Date().toISOString(), targetAgentId: null, statusText: '대화 중', type: 'reply', ...msg };
  db.messages.push(entry);
  if (db.messages.length > 160) db.messages = db.messages.slice(-160);
  return entry;
}

function buildDispatchPrompt(agent, task, mission) {
  const approvalRule = task.requiresApproval
    ? '⚠️ [CEO 결재 게이트] 결제, 예약 확정, 외부 이메일/문자 발송, 프로덕션 배포 전에는 절대 실행하지 말고 후보·금액·리스크를 정리해 멈춘 뒤 CEO 승인을 요청하세요.'
    : '완료 후 핵심 3줄 요약과 실행 산출물(표·체크리스트·링크)을 함께 보고하세요.';
  switch (agent.provider) {
    case 'pickle':
      return `[피클(Pickle) 실행 지시서]\n미션: ${mission.title}\n요청 작업: ${task.title}\n상세 내용: ${task.description}\n\n완료 조건:\n1. 전화 또는 국내 플랫폼 확인이 필요한 항목을 조사하고 후보 2~3곳(가격·가능 시간·취소 규정)을 표로 정리해줘.\n2. ${approvalRule}`;
    case 'vooy':
      return `[부이(vooy) 정기 브리핑·조사 지시서]\n미션: ${mission.title}\n요청 작업: ${task.title}\n상세 내용: ${task.description}\n\n실행 규칙:\n- 기본 무료 모델을 우선 사용하고, 유료 토큰 전환 전에는 반드시 먼저 물어봐 줘.\n- ${approvalRule}`;
    case 'instinct':
      return `[인스팅스 문자 지시문]\n${task.title} 진행해줘. (${task.description}) 확인되면 핵심만 짧게 회신해주고, 결제나 예약 확정 전에는 꼭 먼저 물어봐줘.`;
    case 'muse':
      return `[Meta Muse 협업 지시서]\n미션: ${mission.title}\n담당 작업: ${task.title}\n상세 지시: ${task.description}\n- 평소 기억하고 있는 내 취향과 일정 제약을 반영해 Spaces 보드로 정리해줘.\n- ${approvalRule}`;
    case 'manus':
      return `[Manus Cue 자율 에이전트 지시서]\n미션: ${mission.title}\n작업: ${task.title}\n상세: ${task.description}\n- Cue 전용 이메일·컴퓨터 환경에서 초안을 작성하고, 외부 발송·결제 전 CEO 승인을 받으세요.`;
    default:
      return `[${agent.name} (${agent.roleTitle}) 업무 지시서]\nCEO 원지시: ${mission.directive}\n\n담당 작업: ${task.title}\n상세 요구사항: ${task.description}\n\n${approvalRule}`;
  }
}

async function callGeminiDirect(apiKey, model, systemPrompt, userPrompt, jsonMode = false) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, ...(jsonMode ? { responseMimeType: 'application/json' } : {}) }
    })
  });
  if (!res.ok) throw new Error(`Gemini API 오류 (${res.status})`);
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

async function callClaudeDirect(apiKey, model, systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: systemPrompt || undefined,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!res.ok) throw new Error(`Claude API 오류 (${res.status})`);
  const data = await res.json();
  return (data?.content || []).map((c) => c.text || '').join('').trim();
}

async function callOpenAICompatDirect(baseUrl, apiKey, model, systemPrompt, userPrompt) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI 호환 API 오류 (${res.status})`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

async function callDirectAgent(agent, settings, systemPrompt, userPrompt, jsonMode = false) {
  const p = settings.providers || {};
  if (agent.connectionMode === 'litellm' && p.litellm?.baseUrl) {
    const model = agent.modelId || p.litellm.model || 'gemini-free';
    const text = await callOpenAICompatDirect(p.litellm.baseUrl, p.litellm.apiKey, model, systemPrompt, userPrompt);
    return { text, label: `litellm:${model}` };
  }
  if (agent.connectionMode !== 'api') return null;
  if (agent.provider === 'gemini' && p.gemini?.apiKey) {
    const model = agent.costTier === 'free' ? p.gemini.freeModel || 'gemini-2.5-flash' : agent.modelId || p.gemini.paidModel || 'gemini-4-neon';
    const text = await callGeminiDirect(p.gemini.apiKey, model, systemPrompt, userPrompt, jsonMode);
    return { text, label: `gemini:${model}` };
  }
  if (agent.provider === 'claude' && p.claude?.apiKey) {
    const model = agent.modelId || p.claude.model || 'claude-sonnet-4-5';
    const text = await callClaudeDirect(p.claude.apiKey, model, systemPrompt, userPrompt);
    return { text, label: `claude:${model}` };
  }
  if (agent.provider === 'exaone' && p.exaone?.apiKey) {
    const model = agent.modelId || p.exaone.model || 'k-exaone_v2.5';
    const text = await callOpenAICompatDirect(p.exaone.baseUrl || 'https://api.exaone.ai/v1', p.exaone.apiKey, model, systemPrompt, userPrompt);
    return { text, label: `exaone:${model}` };
  }
  if (agent.provider === 'ollama' && p.ollama?.baseUrl) {
    const model = agent.modelId || p.ollama.model || 'qwen2.5:14b';
    const text = await callOpenAICompatDirect(p.ollama.baseUrl, '', model, systemPrompt, userPrompt);
    return { text, label: `ollama:${model}` };
  }
  return null;
}

async function sendTelegramDirect(settings, approval, agentName) {
  const tg = settings?.telegram;
  if (!tg?.botToken || !tg?.chatId) return;
  const cost = (approval.estimatedCostKRW || 0) > 0 ? `${approval.estimatedCostKRW.toLocaleString('ko-KR')}원` : '비용 없음';
  const text = `[CEO 결재 요청] ${settings.companyName}\n안건: ${approval.title}\n상신: ${agentName}\n비용: ${cost}\n요약: ${approval.summary}`;
  const cleanToken = String(tg.botToken || '').trim().replace(/^bot/i, '');
  fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tg.chatId, text })
  }).catch(() => {});
}

function selectLead(agents) {
  const active = agents.filter((a) => a.active);
  return (
    active.find((a) => a.id === 'agent_gemini_neon') ||
    active.find((a) => a.id === 'agent_claude') ||
    active.find((a) => a.tier === 'lead') ||
    active[0]
  );
}

function heuristicPlan({ directive, domain, costPolicy, agents, leadAgent }) {
  const active = agents.filter((a) => a.active);
  const pick = (ids) => ids.map((id) => active.find((a) => a.id === id)).find(Boolean) || active[0];
  const text = directive.toLowerCase();
  const isFree = costPolicy === 'free_first';
  const tasks = [];

  tasks.push({
    title: '핵심 자료 조사 및 요구사항 구조화',
    description: `CEO 지시("${directive.slice(0, 72)}${directive.length > 72 ? '…' : ''}")의 선행 자료, 벤치마크, 제약 조건을 구조화합니다.`,
    assigneeId: (isFree ? pick(['agent_exaone', 'agent_vooy']) : pick(['agent_exaone', 'agent_cue'])).id,
    domain,
    requiresApproval: false,
    estimatedCostKRW: 0
  });

  if (/코드|개발|웹|앱|버그|리팩토링|배포|api|스크립트|리뷰/.test(text) || domain === 'dev') {
    tasks.push({
      title: '아키텍처 설계 · 구현 코드 작성 및 리뷰',
      description: '핵심 구현 코드, 예외 처리, 단위 테스트 및 보안 체크리스트를 작성합니다.',
      assigneeId: (isFree ? pick(['agent_exaone', 'agent_claude']) : pick(['agent_claude', 'agent_gemini_neon'])).id,
      domain: 'dev',
      requiresApproval: /배포|프로덕션|결제/.test(text),
      estimatedCostKRW: 0
    });
  }
  if (/유튜브|블로그|콘텐츠|sns|스레드|대본|마케팅|카피/.test(text) || domain === 'content') {
    tasks.push({
      title: '콘텐츠 기획안 · 대본 및 채널별 카피 제작',
      description: '후킹 제목 5종, 본문 초안, 블로그/스레드 확산용 버전을 제작합니다.',
      assigneeId: (isFree ? pick(['agent_exaone', 'agent_muse']) : pick(['agent_claude', 'agent_gemini_neon'])).id,
      domain: 'content',
      requiresApproval: /발행|업로드|게시|승인/.test(text),
      estimatedCostKRW: 0
    });
  }
  if (/이메일|메일|제안서|고객|미팅|거래처|영업/.test(text) || domain === 'business') {
    const needEmail = /이메일|메일|발송/.test(text);
    tasks.push({
      title: needEmail ? '대외 제안 문서 작성 및 메일 초안 준비' : '비즈니스 실행안 및 의사결정 옵션 비교',
      description: needEmail ? '고객/파트너 발송용 초안을 작성하고 실제 발송 전 CEO 결재를 거칩니다.' : '보수안/적극안 2가지 전략과 기대 ROI, 리스크를 비교 정리합니다.',
      assigneeId: (needEmail ? pick(['agent_cue', 'agent_exaone', 'agent_claude']) : isFree ? pick(['agent_exaone', 'agent_muse']) : pick(['agent_claude', 'agent_gemini_neon'])).id,
      domain: 'business',
      requiresApproval: needEmail,
      estimatedCostKRW: 0
    });
  }
  if (/예약|식당|병원|전화|ktx|호텔|주문|결제|구매/.test(text) || domain === 'life') {
    tasks.push({
      title: '후보 조사 · 전화 확인 및 예약/결제 준비',
      description: '조건에 맞는 후보 3곳(가격·가능 시간·취소 규정)을 확인하고, 확정 직전 CEO 결재를 요청합니다.',
      assigneeId: pick(['agent_pickle', 'agent_instinct', 'agent_muse']).id,
      domain: 'life',
      requiresApproval: true,
      estimatedCostKRW: /예약|식당|결제|구매/.test(text) ? 60000 : 0
    });
  }
  if (/매일|매주|아침|브리핑|모니터링|가격|뉴스/.test(text)) {
    tasks.push({
      title: '정기 자동 브리핑 · 모니터링 루틴 설정',
      description: '매일 아침 동일 조건으로 뉴스·가격·트렌드를 자동 수집해 보고하는 반복 루틴을 구성합니다.',
      assigneeId: pick(['agent_vooy', 'agent_exaone']).id,
      domain,
      requiresApproval: false,
      estimatedCostKRW: 0
    });
  }
  if (tasks.length < 3) {
    tasks.push({
      title: '개인 컨텍스트 대조 및 실행 체크리스트',
      description: 'CEO의 기존 일정과 우선순위에 맞춰 실행 순서를 정리하고 누락 항목을 점검합니다.',
      assigneeId: pick(['agent_muse', 'agent_exaone', 'agent_vooy']).id,
      domain,
      requiresApproval: false,
      estimatedCostKRW: 0
    });
  }

  const trimmed = tasks.slice(0, 5);
  return {
    leadAgentId: leadAgent.id,
    planSummary: `${leadAgent.name} 팀장이 CEO 지시를 ${trimmed.length}개 실무 작업으로 분배했습니다. 결제·예약·외부 발송 단계에는 CEO 결재 게이트를 배치했습니다.`,
    usedLiveApi: false,
    tasks: trimmed
  };
}

function updateMissionStatus(db, missionId) {
  const m = db.missions.find((x) => x.id === missionId);
  if (!m) return;
  const list = db.tasks.filter((t) => t.missionId === missionId);
  if (!list.length) return;
  if (list.every((t) => t.status === 'completed')) m.status = 'completed';
  else if (list.some((t) => t.status === 'awaiting_approval')) m.status = 'waiting_approval';
  else m.status = 'in_progress';
}

export async function standaloneApi(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  const db = loadLocalDb();

  if (method === 'GET' && path === '/api/state') return sanitize(db);

  if (method === 'GET' && path === '/api/oss-stack') {
    return {
      builtIn: [
        { name: 'Hono', repo: 'honojs/hono', url: 'https://github.com/honojs/hono', version: '^4.7.10', role: '초경량 REST · 병렬 실행 · 정적 번들 서버 엔진' },
        { name: 'Official MCP TypeScript SDK', repo: 'modelcontextprotocol/typescript-sdk', url: 'https://github.com/modelcontextprotocol/typescript-sdk', version: '^1.12.1', role: 'Meta Muse · Manus Cue · Claude Code 연결용 공식 Streamable HTTP MCP 서버' },
        { name: 'Vercel AI SDK', repo: 'vercel/ai', url: 'https://github.com/vercel/ai', version: '^4.3.16', role: 'Gemini(무료/4 Neon)·Claude·LiteLLM·Ollama 통합 실행 및 Zod 구조화 분해' },
        { name: 'Marked + Lucide + Browser Direct API', repo: 'markedjs/marked · lucide-icons/lucide', url: 'https://github.com/markedjs/marked', version: 'v2 Live', role: 'GitHub Pages에서도 브라우저 직접 Gemini/Claude API 호출 + GFM 임원 보고서 렌더링' }
      ],
      pluggable: [
        { name: 'LiteLLM AI Gateway', repo: 'BerriAI/litellm', url: 'https://github.com/BerriAI/litellm', role: '100+ 무료·유료·로컬 LLM 통합 프록시 + 월간 자동 지출 상한선(Spend Cap)' },
        { name: 'Paperclip AI Governance Pattern', repo: 'paperclipai/paperclip', url: 'https://github.com/paperclipai/paperclip', role: '조직도·팀원별 월 예산 한도·CEO 결재 거버넌스 아키텍처 반영' },
        { name: 'Ollama (Local Free LLMs)', repo: 'ollama/ollama', url: 'https://github.com/ollama/ollama', role: '내 PC/Mac에서 비용 0원으로 돌리는 오픈소스 로컬 AI 팀원 연결' },
        { name: 'Railway · Render · GitHub Actions CI', repo: 'alpinu83/ai-ceo-hub', url: 'https://github.com/alpinu83/ai-ceo-hub', role: '원클릭 HTTPS 백엔드 배포(모바일 Muse·Cue가 외부에서 /api/mcp 직접 접속)' }
      ]
    };
  }

  if (method === 'GET' && path.startsWith('/api/exports/')) {
    const name = path.split('/').pop();
    const res = await fetch(`./exports/${name}.txt`);
    if (res.ok) return res.text();
    return `# GitHub 저장소(https://github.com/alpinu83/ai-ceo-hub)에서 ${name} 설정 파일을 확인할 수 있습니다.`;
  }

  if (method === 'POST' && path === '/api/missions') {
    const directive = String(body.directive || '').trim();
    if (!directive) throw new Error('CEO 지시 내용을 입력해 주세요.');
    const domain = body.domain || 'business';
    const costPolicy = body.costPolicy || db.settings.defaultCostPolicy;
    const autoTitle = String(body.title || '').trim() || directive.split('\n')[0].slice(0, 40) + (directive.length > 40 ? '…' : '');
    const leadAgent = selectLead(db.agents, costPolicy, db.settings);

    let plan = null;
    try {
      const rosterText = db.agents.filter((a) => a.active).map((a) => `- id:"${a.id}", 이름:"${a.name}", 강점:"${a.strengths}"`).join('\n');
      const live = await callDirectAgent(
        leadAgent,
        db.settings,
        `당신은 AI 조직 총괄 팀장(${leadAgent.name})입니다. CEO 지시를 3~5개 실무 작업 JSON으로 분해하세요. 형식: {"planSummary":"요약","tasks":[{"title":"","description":"","assigneeId":"","domain":"business","requiresApproval":false,"estimatedCostKRW":0}]}\n조직원:\n${rosterText}`,
        `제목: ${autoTitle}\n지시: ${directive}`,
        true
      );
      if (live) {
        const match = live.text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed.tasks) && parsed.tasks.length) {
            plan = { leadAgentId: leadAgent.id, planSummary: `${parsed.planSummary} (브라우저 실시간 API · ${live.label})`, usedLiveApi: true, tasks: parsed.tasks.slice(0, 6) };
          }
        }
      }
    } catch {
      // fall back to heuristic
    }
    if (!plan) plan = heuristicPlan({ directive, domain, costPolicy, agents: db.agents, leadAgent });

    const now = new Date().toISOString();
    const mission = { id: uid('msn'), title: autoTitle, directive, domain, costPolicy, leadAgentId: plan.leadAgentId, status: 'in_progress', createdAt: now, leadPlanSummary: plan.planSummary, finalReport: '' };
    const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
    const createdTasks = plan.tasks.map((t) => {
      const ag = agentMap[t.assigneeId] || db.agents[0];
      const obj = { id: uid('tsk'), missionId: mission.id, title: t.title, description: t.description, assigneeId: ag.id, domain: t.domain || domain, status: ag.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued', requiresApproval: Boolean(t.requiresApproval), estimatedCostKRW: Number(t.estimatedCostKRW) || 0, dispatchPrompt: '', output: '', executionModeUsed: '', createdAt: now, updatedAt: now };
      obj.dispatchPrompt = buildDispatchPrompt(ag, obj, mission);
      return obj;
    });
    db.missions.unshift(mission);
    db.tasks.unshift(...createdTasks);
    addLog(db, agentMap[plan.leadAgentId]?.name || '총괄 팀장', `새 CEO 지시 "${mission.title}"을(를) ${createdTasks.length}개 업무로 분배했습니다.`);
    saveLocalDb(db);
    return { mission, tasks: createdTasks, state: sanitize(db) };
  }

  // Run single task or run-all
  const runSingle = path.match(/^\/api\/tasks\/([^/]+)\/run$/);
  const runAll = path.match(/^\/api\/missions\/([^/]+)\/run-all$/);
  if (method === 'POST' && (runSingle || runAll)) {
    const targets = runSingle
      ? db.tasks.filter((t) => t.id === runSingle[1])
      : db.tasks.filter((t) => t.missionId === runAll[1] && (t.status === 'queued' || t.status === 'awaiting_bridge'));

    let liveUsed = false;
    for (const task of targets) {
      const mission = db.missions.find((m) => m.id === task.missionId);
      const ag = db.agents.find((a) => a.id === task.assigneeId) || db.agents[0];
      let output = '';
      try {
        const res = await callDirectAgent(
          ag,
          db.settings,
          `당신은 "${ag.name}" (${ag.roleTitle})입니다. CEO 지시에 맞춰 간결한 한국어 마크다운 보고서를 작성하세요.`,
          `미션: ${mission.title}\n지시: ${mission.directive}\n담당 작업: ${task.title}\n상세: ${task.description}`
        );
        if (res) {
          output = res.text;
          liveUsed = true;
          task.executionModeUsed = `browser_live:${res.label}`;
        }
      } catch (err) {
        output = `> API 호출 오류(${err.message})로 시뮬레이션 초안을 표시합니다.\n\n`;
      }
      if (!output) {
        output = `### ${ag.name} 실행 보고서\n- **담당 업무**: ${task.title}\n- **핵심 결과**: ${task.description}\n\n| 점검 항목 | 상태 |\n| --- | --- |\n| 요구사항 분석 및 초안 | 완료 |\n| 외부 실행 안전 게이트 | ${task.requiresApproval ? '**CEO 결재 대기**' : '완료'} |\n\n> 💡 **오픈소스 · MCP 허브**에서 Google Gemini 무료 API 키나 Claude API 키를 입력하면 브라우저에서 즉시 실제 AI 응답이 생성됩니다.`;
        task.executionModeUsed = 'simulation';
      }
      task.output = output;
      task.updatedAt = new Date().toISOString();
      if (task.requiresApproval || (task.estimatedCostKRW || 0) >= (db.settings.approvalThresholdKRW || 30000)) {
        task.status = 'awaiting_approval';
        if (!db.approvals.some((a) => a.taskId === task.id && a.status === 'pending')) {
          const apr = { id: uid('apr'), missionId: mission.id, taskId: task.id, agentId: ag.id, title: `${task.title} — CEO 실행 승인 요청`, category: task.estimatedCostKRW > 0 ? '예약 · 결제' : '대외 실행 승인', riskLevel: task.estimatedCostKRW >= 100000 ? 'high' : 'medium', estimatedCostKRW: task.estimatedCostKRW || 0, depositKRW: 0, summary: `${ag.name}이(가) 사전 작업을 완료하고 CEO 결재를 요청했습니다.`, proposedAction: `승인 시 "${task.title}" 확정 처리`, status: 'pending', ceoNote: '', createdAt: new Date().toISOString(), decidedAt: null };
          db.approvals.unshift(apr);
          sendTelegramDirect(db.settings, apr, ag.name);
        }
        addLog(db, ag.name, `"${task.title}" 준비 완료 → CEO 결재함에 상신했습니다.`, 'approval');
      } else {
        task.status = 'completed';
        addLog(db, ag.name, `"${task.title}" 완료.`, 'success');
      }
      updateMissionStatus(db, task.missionId);
    }
    saveLocalDb(db);
    return runSingle ? { task: targets[0], live: liveUsed, state: sanitize(db) } : { ranCount: targets.length, state: sanitize(db) };
  }

  // Synthesize final report
  const synthMatch = path.match(/^\/api\/missions\/([^/]+)\/synthesize$/);
  if (method === 'POST' && synthMatch) {
    const m = db.missions.find((x) => x.id === synthMatch[1]);
    const tasks = db.tasks.filter((t) => t.missionId === m.id);
    const lead = db.agents.find((a) => a.id === m.leadAgentId) || db.agents[0];
    const map = Object.fromEntries(db.agents.map((a) => [a.id, a]));
    const rows = tasks.map((t) => `| **${t.title}** | ${map[t.assigneeId]?.name || '팀원'} | ${t.status === 'completed' ? '완료' : '진행/결재'} |`).join('\n');
    m.finalReport = `### ${lead.name} 총괄 팀장 최종 임원 보고\n**미션**: ${m.title}\n\n| 세부 업무 | 담당 AI | 상태 |\n| --- | --- | --- |\n${rows}\n\n- 결재함의 대기 안건을 최종 확인해 주세요.`;
    addLog(db, lead.name, `"${m.title}" 최종 임원 보고서를 제출했습니다.`, 'success');
    saveLocalDb(db);
    return { report: m.finalReport, state: sanitize(db) };
  }

  const delM = path.match(/^\/api\/missions\/([^/]+)$/);
  if (method === 'DELETE' && delM) {
    db.missions = db.missions.filter((m) => m.id !== delM[1]);
    db.tasks = db.tasks.filter((t) => t.missionId !== delM[1]);
    db.approvals = db.approvals.filter((a) => a.missionId !== delM[1]);
    saveLocalDb(db);
    return { state: sanitize(db) };
  }

  const repMatch = path.match(/^\/api\/tasks\/([^/]+)\/report$/);
  if (method === 'POST' && repMatch) {
    const task = db.tasks.find((t) => t.id === repMatch[1]);
    const mission = db.missions.find((m) => m.id === task.missionId);
    const ag = db.agents.find((a) => a.id === task.assigneeId) || db.agents[0];
    task.output = body.output;
    task.estimatedCostKRW = Number(body.estimatedCostKRW) || 0;
    task.updatedAt = new Date().toISOString();
    if (body.requestApproval) {
      task.requiresApproval = true;
      task.status = 'awaiting_approval';
      const apr = { id: uid('apr'), missionId: mission.id, taskId: task.id, agentId: ag.id, title: `${task.title} — CEO 승인 요청`, category: task.estimatedCostKRW > 0 ? '예약 · 결제' : '브릿지 실행 승인', riskLevel: 'medium', estimatedCostKRW: task.estimatedCostKRW, depositKRW: 0, summary: body.approvalReason || body.output.slice(0, 200), proposedAction: `${ag.name} 앱에서 최종 실행 확정`, status: 'pending', ceoNote: '', createdAt: new Date().toISOString(), decidedAt: null };
      db.approvals.unshift(apr);
      sendTelegramDirect(db.settings, apr, ag.name);
      addLog(db, `${ag.name} (브릿지)`, `"${task.title}" 결과 등록 및 CEO 결재 상신.`, 'approval');
    } else {
      task.status = 'completed';
      addLog(db, `${ag.name} (브릿지)`, `"${task.title}" 완료 보고.`, 'success');
    }
    updateMissionStatus(db, task.missionId);
    saveLocalDb(db);
    return { task, state: sanitize(db) };
  }

  const patchT = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (method === 'PATCH' && patchT) {
    const task = db.tasks.find((t) => t.id === patchT[1]);
    const mission = db.missions.find((m) => m.id === task.missionId);
    if (body.assigneeId) {
      const ag = db.agents.find((a) => a.id === body.assigneeId);
      if (ag) {
        task.assigneeId = ag.id;
        task.dispatchPrompt = buildDispatchPrompt(ag, task, mission);
      }
    }
    saveLocalDb(db);
    return { task, state: sanitize(db) };
  }

  const decMatch = path.match(/^\/api\/approvals\/([^/]+)\/decide$/);
  if (method === 'POST' && decMatch) {
    const apr = db.approvals.find((a) => a.id === decMatch[1]);
    apr.status = body.decision;
    apr.ceoNote = body.ceoNote || '';
    apr.decidedAt = new Date().toISOString();
    const task = db.tasks.find((t) => t.id === apr.taskId);
    const ag = db.agents.find((a) => a.id === apr.agentId);
    if (body.decision === 'approved') {
      const addCost = Number(apr.depositKRW || apr.estimatedCostKRW || 0);
      db.settings.spentThisMonthKRW = (db.settings.spentThisMonthKRW || 0) + addCost;
      if (ag) ag.spentKRW = (ag.spentKRW || 0) + addCost;
      if (task) task.status = 'completed';
    } else if (body.decision === 'revision_requested' && task) {
      task.status = ag?.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued';
    } else if (task) {
      task.status = 'rejected';
    }
    if (task) updateMissionStatus(db, task.missionId);
    addLog(db, 'CEO', `결재 [${body.decision}]: "${apr.title}"`, body.decision === 'approved' ? 'success' : 'warning');
    saveLocalDb(db);
    return { approval: apr, state: sanitize(db) };
  }

  if (method === 'POST' && path === '/api/agents') {
    const ag = { id: uid('agent'), name: body.name, shortCode: (body.name || 'AI').slice(0, 2).toUpperCase(), roleTitle: body.roleTitle || '맞춤 팀원', tier: body.tier || 'specialist', reportsTo: body.tier === 'lead' ? 'ceo' : 'agent_gemini_neon', provider: body.provider || 'custom', modelId: body.modelId || '', connectionMode: body.connectionMode || 'bridge', costTier: body.costTier || 'free', monthlyCapKRW: Number(body.monthlyCapKRW) || 0, spentKRW: 0, domains: ['business'], strengths: body.strengths || '맞춤 실무 처리', bridgeGuide: '브라우저 직접 API 또는 지시서 복사 브릿지 지원', active: true, accent: '#0E6245' };
    db.agents.push(ag);
    addLog(db, 'CEO', `새 AI 팀원 "${ag.name}" 채용.`, 'success');
    saveLocalDb(db);
    return { agent: ag, state: sanitize(db) };
  }

  const patchA = path.match(/^\/api\/agents\/([^/]+)$/);
  if (method === 'PATCH' && patchA) {
    const ag = db.agents.find((a) => a.id === patchA[1]);
    if (typeof body.active === 'boolean') ag.active = body.active;
    if (body.connectionMode) ag.connectionMode = body.connectionMode;
    saveLocalDb(db);
    return { agent: ag, state: sanitize(db) };
  }

  if (method === 'PUT' && path === '/api/settings') {
    const s = db.settings;
    if (body.companyName) s.companyName = body.companyName;
    if (body.ceoName) s.ceoName = body.ceoName;
    if (body.defaultCostPolicy) s.defaultCostPolicy = body.defaultCostPolicy;
    if (typeof body.monthlyBudgetKRW === 'number') s.monthlyBudgetKRW = body.monthlyBudgetKRW;
    if (typeof body.approvalThresholdKRW === 'number') s.approvalThresholdKRW = body.approvalThresholdKRW;
    if (typeof body.webhookUrl === 'string') s.webhookUrl = body.webhookUrl;
    if (typeof body.remoteBackendUrl === 'string') s.remoteBackendUrl = body.remoteBackendUrl.trim().replace(/\/$/, '');
    if (body.telegram) {
      if (body.telegram.botToken) s.telegram.botToken = body.telegram.botToken;
      if (typeof body.telegram.chatId === 'string') s.telegram.chatId = body.telegram.chatId;
      if (typeof body.telegram.pollingEnabled === 'boolean') s.telegram.pollingEnabled = body.telegram.pollingEnabled;
    }
    if (body.providers) {
      for (const k of ['exaone', 'gemini', 'claude', 'manus', 'litellm', 'ollama']) {
        if (!body.providers[k]) continue;
        s.providers[k] = s.providers[k] || {};
        if (body.providers[k].apiKey) s.providers[k].apiKey = body.providers[k].apiKey;
        for (const f of ['freeModel', 'paidModel', 'model', 'baseUrl', 'cueEmail']) {
          if (typeof body.providers[k][f] === 'string') s.providers[k][f] = body.providers[k][f];
        }
      }
    }
    saveLocalDb(db);
    return { state: sanitize(db) };
  }

  if (method === 'POST' && path === '/api/providers/test') {
    const p = db.settings.providers[body.provider];
    if (body.provider === 'exaone') {
      if (!p?.apiKey) throw new Error('LG EXAONE API 키를 입력하고 먼저 저장해 주세요.');
      const reply = await callOpenAICompatDirect(p.baseUrl || 'https://api.exaone.ai/v1', p.apiKey, p.model || 'k-exaone_v2.5', '', 'Respond with OK');
      return { ok: true, model: p.model || 'k-exaone_v2.5', reply };
    }
    if (body.provider === 'gemini') {
      if (!p?.apiKey) throw new Error('Gemini API 키를 입력하고 먼저 저장해 주세요.');
      const reply = await callGeminiDirect(p.apiKey, p.freeModel || 'gemini-2.5-flash', '', 'Respond with OK');
      return { ok: true, model: p.freeModel || 'gemini-2.5-flash', reply };
    }
    if (body.provider === 'claude') {
      if (!p?.apiKey) throw new Error('Claude API 키를 입력하고 먼저 저장해 주세요.');
      const reply = await callClaudeDirect(p.apiKey, p.model || 'claude-sonnet-4-5', '', 'Respond with OK');
      return { ok: true, model: p.model || 'claude-sonnet-4-5', reply };
    }
    if (body.provider === 'litellm' || body.provider === 'ollama') {
      const reply = await callOpenAICompatDirect(p.baseUrl, p.apiKey, p.model, '', 'Respond with OK');
      return { ok: true, model: p.model, reply };
    }
    return { ok: true, model: 'manus-cue', reply: p?.cueEmail ? `Cue 이메일(${p.cueEmail}) 준비됨` : '설정 확인 완료' };
  }

  if (method === 'POST' && path === '/api/telegram/test') {
    const tg = db.settings.telegram;
    if (!tg?.botToken || !tg?.chatId) throw new Error('Bot Token과 Chat ID를 먼저 저장해 주세요.');
    const cleanToken = String(tg.botToken || '').trim().replace(/^bot/i, '');
    const r = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tg.chatId, text: `[${db.settings.companyName}] GitHub Pages 웹앱에서 텔레그램 결재 알림 연결 테스트 성공!` })
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description || 'Telegram 전송 실패');
    return { ok: true, botUsername: 'telegram_bot' };
  }

  if (method === 'POST' && path === '/api/mcp') {
    // Interactive preview of official MCP JSON-RPC protocol in browser standalone mode
    if (body.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: body.id || 1,
        result: {
          tools: [
            { name: 'get_company_brief', description: '회사 현황·예산·대기 결재 조회' },
            { name: 'list_my_tasks', description: '담당 AI 업무 목록 조회' },
            { name: 'submit_task_result', description: '결과 제출 및 CEO 결재 상신' },
            { name: 'request_ceo_approval', description: '즉시 CEO 결재 안건 상신' }
          ]
        }
      };
    }
    if (body.params?.name === 'get_company_brief') {
      return {
        jsonrpc: '2.0',
        id: body.id || 2,
        result: {
          mode: 'standalone_preview (Render/Railway 원클릭 배포 시 외부 Meta Muse·Cue에서 실시간 접속 가능)',
          companyName: db.settings.companyName,
          pendingApprovals: db.approvals.filter((a) => a.status === 'pending').length,
          monthlyBudgetKRW: db.settings.monthlyBudgetKRW
        }
      };
    }
    return {
      jsonrpc: '2.0',
      id: body.id || 2,
      result: { count: db.tasks.length, tasks: db.tasks.map((t) => ({ id: t.id, title: t.title, assigneeId: t.assigneeId, status: t.status })) }
    };
  }

  if (method === 'POST' && path === '/api/chat/send') {
    const text = String(body.text || '').trim();
    if (!text) throw new Error('메시지를 입력해 주세요.');
    const mission = db.missions.find((m) => m.id === body.missionId) || db.missions[0] || null;
    const missionTasks = mission ? db.tasks.filter((t) => t.missionId === mission.id) : [];
    const ceoName = db.settings.ceoName || '대표님';

    const ceoMsg = addMessage(db, {
      missionId: mission?.id || '',
      senderId: 'ceo',
      senderName: `${ceoName} (CEO)`,
      senderRole: '최종 지시 · 결재권자',
      senderShortCode: 'CEO',
      senderAccent: '#171614',
      targetAgentId: null,
      statusText: '회의실 발언',
      type: 'ceo_chat',
      text
    });

    const active = db.agents.filter((a) => a.active);
    const lower = text.toLowerCase();
    const aliasMap = [
      { id: 'agent_gemini_neon', re: /제미나이|gemini|네온|neon|총괄|팀장/ },
      { id: 'agent_claude', re: /클로드|claude|수석|개발|코드|제안서/ },
      { id: 'agent_exaone', re: /엑사원|exaone|lg|무료|요약|정리|리서치|조사|단순|번역/ },
      { id: 'agent_muse', re: /뮤즈|muse|취향|일정|spaces/ },
      { id: 'agent_cue', re: /큐|cue|마누스|manus|이메일|메일/ },
      { id: 'agent_pickle', re: /피클|pickle|식당|예약|전화|병원|ktx/ },
      { id: 'agent_vooy', re: /부이|vooy|브리핑|뉴스|매일|모니터링|가격/ },
      { id: 'agent_instinct', re: /인스팅스|인스팅트|instinct|문자|심부름/ }
    ];
    let responders = [];
    if (/@전체|모두|전원|다들|보고해/.test(lower)) {
      const lead = active.find((a) => a.id === mission?.leadAgentId) || active[0];
      const assigned = [...new Set(missionTasks.map((t) => t.assigneeId))].filter((id) => id !== lead.id);
      responders = [lead, ...assigned.map((id) => active.find((a) => a.id === id)).filter(Boolean).slice(0, 3)];
    } else {
      for (const item of aliasMap) {
        if (item.re.test(lower)) {
          const ag = active.find((a) => a.id === item.id);
          if (ag && !responders.some((r) => r.id === ag.id)) responders.push(ag);
        }
      }
      if (responders.length === 0) {
        const lead = active.find((a) => a.id === mission?.leadAgentId) || active[0];
        const worker = active.find((a) => missionTasks.some((t) => t.assigneeId === a.id && a.id !== lead.id));
        if (lead) responders.push(lead);
        if (worker) responders.push(worker);
      }
    }

    const savedReplies = [];
    for (const ag of responders.slice(0, 3)) {
      const agTasks = missionTasks.filter((t) => t.assigneeId === ag.id);
      let replyText = '';
      let live = false;
      try {
        const ctx = [...(db.messages || []).slice(-5), ...savedReplies].map((m) => `${m.senderName}: ${m.text}`).join('\n');
        const res = await callDirectAgent(
          ag,
          db.settings,
          `당신은 AI 회사 "${db.settings.companyName}"의 직원 "${ag.name}"(${ag.roleTitle})입니다. 사내 회의실에서 동료들과 자연스럽게 2~3문장으로 한국어 협업 대화를 하세요.`,
          `미션: ${mission?.title || '전사 운영'}\n최근 대화:\n${ctx}\n${ceoName}: ${text}\n당신의 응답:`
        );
        if (res) {
          replyText = res.text;
          live = true;
        }
      } catch {
        // fallback below
      }
      if (!replyText) {
        const prev = savedReplies[savedReplies.length - 1];
        const prevRef = prev ? `@${prev.senderName} 님 말씀 이어서, ` : '';
        if (ag.tier === 'lead') {
          replyText = `${ceoName} 확인했습니다! "${text.slice(0, 48)}${text.length > 48 ? '…' : ''}" 기준으로 팀원 우선순위를 조율하겠습니다. 결제나 외부 실행은 반드시 결재함으로 올리겠습니다.`;
        } else if (ag.provider === 'exaone') {
          replyText = `${prevRef}LG K-EXAONE 2.5입니다! 한국어 요약·초안·단순 자동화 작업은 무료 512K 컨텍스트로 즉시 깔끔하게 정리해 두겠습니다.`;
        } else if (ag.provider === 'pickle') {
          replyText = `${prevRef}피클입니다! 전화 문의·국내 예약 조건을 즉시 반영하겠습니다. 실제 확정·결제 직전에 꼭 멈추고 결재 올릴게요!`;
        } else if (ag.provider === 'vooy') {
          replyText = `${prevRef}부이(vooy)입니다! 무료 기본 모델로 매일 반복 브리핑·가격 모니터링 조건을 반영해 두겠습니다.`;
        } else if (ag.provider === 'muse') {
          replyText = `${prevRef}Meta Muse입니다. 대표님 취향과 일정 충돌 여부를 대조해 Spaces 보드로 깔끔히 정리하겠습니다.`;
        } else if (ag.provider === 'manus') {
          replyText = `${prevRef}Manus Cue입니다. 전용 에이전트 이메일·가상 컴퓨터 환경에서 리서치 초안을 준비하고 발송 전 결재 올리겠습니다.`;
        } else if (ag.provider === 'instinct') {
          replyText = `${prevRef}인스팅스입니다! 문자 한 통으로 빠르게 확인해서 핵심만 바로 회신드리겠습니다.`;
        } else {
          replyText = `${prevRef}${ag.name}입니다. "${text.slice(0, 38)}${text.length > 38 ? '…' : ''}" 요청을 반영해 ${agTasks[0] ? `"${agTasks[0].title}"` : '담당 산출물'}을 바로 업데이트하겠습니다.`;
        }
      }
      const prev = savedReplies[savedReplies.length - 1];
      savedReplies.push(
        addMessage(db, {
          missionId: mission?.id || '',
          senderId: ag.id,
          senderName: ag.name,
          senderRole: ag.roleTitle,
          senderShortCode: ag.shortCode,
          senderAccent: ag.accent,
          targetAgentId: prev ? prev.senderId : 'ceo',
          statusText: live ? '실시간 AI 응답' : ag.tier === 'lead' ? '팀 조율 중' : '업무 협업 중',
          type: prev ? 'handoff' : 'reply',
          text: replyText
        })
      );
    }
    addLog(db, '사내 회의실', `CEO 메시지에 ${savedReplies.map((r) => r.senderName).join(', ')} 직원이 응답했습니다.`);
    saveLocalDb(db);
    return { ceoMessage: ceoMsg, replies: savedReplies, state: sanitize(db) };
  }

  const standupMatch = path.match(/^\/api\/missions\/([^/]+)\/standup$/);
  if (method === 'POST' && standupMatch) {
    const mission = db.missions.find((m) => m.id === standupMatch[1]);
    if (!mission) throw new Error('미션을 찾을 수 없습니다.');
    const missionTasks = db.tasks.filter((t) => t.missionId === mission.id);
    const lead = db.agents.find((a) => a.id === mission.leadAgentId) || db.agents[0];
    const map = Object.fromEntries(db.agents.map((a) => [a.id, a]));
    const ceoName = db.settings.ceoName || '대표님';
    const savedTurns = [];

    const names = [...new Set(missionTasks.map((t) => map[t.assigneeId]?.name).filter(Boolean))];
    savedTurns.push(
      addMessage(db, {
        missionId: mission.id,
        senderId: lead.id,
        senderName: lead.name,
        senderRole: lead.roleTitle,
        senderShortCode: lead.shortCode,
        senderAccent: lead.accent,
        targetAgentId: missionTasks[0]?.assigneeId || null,
        statusText: '스탠드업 주재 중',
        type: 'plan',
        text: `팀 스탠드업 시작하겠습니다! 미션 "${mission.title}" 점검합니다. 참여 팀원(${names.join(', ')}) 분들, 진행 현황과 핸드오프 사항 공유해 주세요.`
      })
    );

    for (let i = 0; i < missionTasks.length; i++) {
      const t = missionTasks[i];
      const ag = map[t.assigneeId] || db.agents[0];
      const nextAg = missionTasks[i + 1] ? map[missionTasks[i + 1].assigneeId] : null;
      let text = '';
      try {
        const res = await callDirectAgent(
          ag,
          db.settings,
          `당신은 "${ag.name}"(${ag.roleTitle})입니다. 팀 스탠드업에서 내 담당 업무 현황을 2문장으로 보고하세요.`,
          `미션: ${mission.title}\n업무: ${t.title} (상태:${t.status})\n요약: ${(t.output || t.description).slice(0, 200)}`
        );
        if (res) text = res.text;
      } catch {
        // fallback
      }
      if (!text) {
        const nextStr = nextAg && nextAg.id !== ag.id ? ` 다음 순서인 @${nextAg.name} 님께 바통 넘겨드립니다!` : '';
        if (t.status === 'completed') text = `"${t.title}" 완료했습니다! 핵심 산출물을 공유함에 올려두었습니다.${nextStr}`;
        else if (t.status === 'awaiting_approval') text = `"${t.title}" 사전 준비 마쳤고 실행 직전이라 멈춰두었습니다. @${ceoName} 결재 승인 부탁드립니다!`;
        else if (t.status === 'awaiting_bridge') text = `"${t.title}" 지시서 준비 완료! 제 앱(${ag.name})에 복사해 주시면 바로 실행하고 보고하겠습니다.${nextStr}`;
        else text = `"${t.title}" 바로 착수할 준비가 끝났습니다. 선행 맥락 반영해서 초안 올리겠습니다.${nextStr}`;
      }
      savedTurns.push(
        addMessage(db, {
          missionId: mission.id,
          senderId: ag.id,
          senderName: ag.name,
          senderRole: ag.roleTitle,
          senderShortCode: ag.shortCode,
          senderAccent: ag.accent,
          targetAgentId: t.status === 'awaiting_approval' ? 'ceo' : nextAg?.id || lead.id,
          statusText: t.status === 'completed' ? '완료 보고 중' : t.status === 'awaiting_approval' ? 'CEO 결재 요청 중' : '실무 협업 중',
          type: t.status === 'awaiting_approval' ? 'approval' : nextAg ? 'handoff' : 'work',
          text
        })
      );
    }

    const done = missionTasks.filter((t) => t.status === 'completed').length;
    const wait = missionTasks.filter((t) => t.status === 'awaiting_approval').length;
    savedTurns.push(
      addMessage(db, {
        missionId: mission.id,
        senderId: lead.id,
        senderName: lead.name,
        senderRole: lead.roleTitle,
        senderShortCode: lead.shortCode,
        senderAccent: lead.accent,
        targetAgentId: 'ceo',
        statusText: 'CEO 보고 완료',
        type: 'plan',
        text: `@${ceoName} 스탠드업 정리 보고드립니다. 전체 ${missionTasks.length}건 중 ${done}건 완료${wait > 0 ? `, 결재 대기 ${wait}건` : ''}입니다. 궁금한 점은 팀원을 @멘션해 바로 물어보세요!`
      })
    );

    addLog(db, '사내 회의실', `"${mission.title}" 실시간 팀 스탠드업을 진행했습니다.`);
    saveLocalDb(db);
    return { turns: savedTurns, state: sanitize(db) };
  }

  if (method === 'POST' && path === '/api/reset') {
    const fresh = createDefaultDb();
    saveLocalDb(fresh);
    return { state: sanitize(fresh) };
  }

  throw new Error(`Standalone 모드에서 지원하지 않는 경로입니다: ${path}`);
}
