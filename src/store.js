import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

export function resolveStableMcpToken() {
  if (process.env.MCP_TOKEN && process.env.MCP_TOKEN.trim()) {
    return process.env.MCP_TOKEN.trim();
  }
  const renderSeed = process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_HOSTNAME || '';
  if (renderSeed) {
    const hash = crypto.createHash('sha256').update(`ceo-office-stable-v1:${renderSeed}`).digest('hex').slice(0, 20);
    return `ceo_mcp_${hash}`;
  }
  return `ceo_mcp_${crypto.randomBytes(8).toString('hex')}`;
}

export function createDefaultState() {
  const now = new Date().toISOString();
  const sampleMissionId = 'msn_welcome_01';

  return {
    settings: {
      companyName: 'CEO Office',
      ceoName: '대표님',
      defaultCostPolicy: 'free_first', // 사전 최적화: 추가 API 과금 0원 (무료 자동 + 기존 구독 브릿지)
      monthlyBudgetKRW: 150000,
      spentThisMonthKRW: 40000,
      approvalThresholdKRW: 30000,
      requireApprovalForExternal: true,
      webhookUrl: process.env.WEBHOOK_URL || '', // Slack / Discord / n8n / OpenClaw approval alert webhook
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        pollingEnabled: process.env.TELEGRAM_POLLING === 'true'
      },
      mcpToken: resolveStableMcpToken(),
      providers: {
        gemini: {
          apiKey: process.env.GEMINI_API_KEY || '',
          freeModel: 'gemini-2.5-flash',
          paidModel: 'gemini-4-neon',
          enabled: Boolean(process.env.GEMINI_API_KEY)
        },
        claude: {
          apiKey: process.env.ANTHROPIC_API_KEY || '',
          model: 'claude-sonnet-4-5',
          enabled: Boolean(process.env.ANTHROPIC_API_KEY)
        },
        manus: {
          apiKey: process.env.MANUS_API_KEY || '',
          baseUrl: 'https://api.manus.ai/v1',
          cueEmail: '',
          enabled: Boolean(process.env.MANUS_API_KEY)
        },
        exaone: {
          apiKey: process.env.EXAONE_API_KEY || '',
          baseUrl: process.env.EXAONE_BASE_URL || 'https://api.exaone.ai/v1',
          model: process.env.EXAONE_MODEL || 'k-exaone_v2.5',
          enabled: Boolean(process.env.EXAONE_API_KEY)
        },
        litellm: {
          apiKey: process.env.LITELLM_MASTER_KEY || '',
          baseUrl: process.env.LITELLM_BASE_URL || 'http://localhost:4000/v1',
          model: 'gemini-free',
          enabled: Boolean(process.env.LITELLM_MASTER_KEY)
        },
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen2.5:14b',
          enabled: false
        }
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
        bridgeGuide: '보유하신 LG EXAONE API 키를 빠른 시작 화면에 넣으면 https://api.exaone.ai/v1 로 즉시 무료 자동 가동됩니다.',
        active: true,
        accent: '#A50034'
      },
      {
        id: 'agent_gemini_free',
        name: 'Gemini (무료 티어)',
        shortCode: 'GM',
        roleTitle: '자동 실무·리서치·초안 팀원 (무료 자동)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://aistudio.google.com',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev', 'life'],
        strengths: 'Google AI Studio 무료 API로 추가 비용 0원 자동 분해·리서치·초안·회의실 대화 처리',
        bridgeGuide: 'Google AI Studio 무료 키를 넣으면 LG 엑사원과 함께 무료 자동 실행 팀원으로 가동됩니다.',
        active: true,
        accent: '#1D5B8C'
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
        assigneeId: 'agent_gemini_free',
        domain: 'business',
        status: 'completed',
        requiresApproval: false,
        estimatedCostKRW: 0,
        dispatchPrompt: '[Gemini 무료 티어] 국내 주요 경쟁사 3곳의 요금제, 차별점, 약점을 비교 표로 정리해 주세요.',
        output:
          '### 경쟁사 3곳 비교 요약\n\n| 구분 | 가격 정책 | 핵심 강점 | 한계점 |\n| --- | --- | --- | --- |\n| **A사** | 월 49,000원 | 워크플로우 자동화 | 한국 전화 예약·생활 에이전트 부재 |\n| **B사** | 토큰 종량제 | 개발자 코딩 특화 | 비개발자용 CEO 결재 UI 복잡 |\n| **C사** | 무료 베타 | 개인 일상 비서 | 팀 단위 분업·예산 통제 불가 |\n\n**제안서 핵심 소구점**: 무료 에이전트(Gemini·Muse·피클·부이·인스팅스)와 유료 모델(Gemini 4 Neon·Claude)을 **오픈소스 MCP + CEO 결재 체계**로 통합.',
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
        targetAgentId: 'agent_gemini_free',
        statusText: '업무 분배 중',
        type: 'plan',
        text: '대표님 지시 확인했습니다! 비용 균형 정책으로 바로 분배하겠습니다. @Gemini(무료) 님은 경쟁사 3곳 가격·기능 리서치 먼저 부탁드리고, @Claude 수석님은 리서치 받아서 제안서 5페이지 본문 잡아주세요. @피클 님은 성수역 4인 룸 식당 전화 확인, @부이 님은 매일 오전 8시 경쟁사 브리핑 루틴 세팅 부탁드립니다!',
        timestamp: now
      },
      {
        id: 'msg_init_3',
        missionId: sampleMissionId,
        senderId: 'agent_gemini_free',
        senderName: 'Gemini (무료 티어)',
        senderRole: '리서치·초안 팀원',
        senderShortCode: 'GM',
        senderAccent: '#1D5B8C',
        targetAgentId: 'agent_claude',
        statusText: '리서치 완료 · 핸드오프',
        type: 'handoff',
        text: '네 팀장님! 무료 티어로 국내 경쟁사 3곳 요금제·차별점 비교 표 정리 마쳤습니다. A사는 국내 전화 예약이 없고 B사는 결재 UI가 복잡하네요. @Claude 수석님, 제안서 핵심 소구점 바로 쓰실 수 있게 표 넘겨드렸습니다!',
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
        targetAgentId: 'agent_gemini_free',
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

export function loadDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const initial = createDefaultState();
    saveDb(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Migrate v1 state smoothly if missing v2 fields
    const def = createDefaultState();
    parsed.settings = {
      ...def.settings,
      ...(parsed.settings || {}),
      telegram: {
        ...def.settings.telegram,
        ...(parsed.settings?.telegram || {})
      },
      providers: {
        ...def.settings.providers,
        ...(parsed.settings?.providers || {})
      }
    };
    parsed.agents = (parsed.agents || def.agents).map((a) => ({
      reportsTo: a.tier === 'lead' ? 'ceo' : 'agent_gemini_neon',
      monthlyCapKRW: a.costTier === 'free' ? 0 : 50000,
      spentKRW: 0,
      ...a
    }));
    if (!Array.isArray(parsed.messages)) {
      parsed.messages = def.messages;
    }
    return parsed;
  } catch {
    const initial = createDefaultState();
    saveDb(initial);
    return initial;
  }
}

let gistSyncTimer = null;
let activeGistId = (process.env.GIST_BACKUP_ID || '').trim();
let cloudBackupState = { enabled: false, restored: false, gistId: '', lastSyncAt: null, error: '' };
const GIST_FILENAME = 'ceo-office-db.json';
const GIST_DESCRIPTION = 'CEO Office (ai-ceo-hub) Private Cloud Backup';

function getGistHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_GIST_TOKEN.trim()}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'ai-ceo-hub'
  };
}

function isGistTokenSet() {
  return Boolean(process.env.GITHUB_GIST_TOKEN && process.env.GITHUB_GIST_TOKEN.trim());
}

export function getCloudPersistenceStatus() {
  return {
    enabled: cloudBackupState.enabled,
    restored: cloudBackupState.restored,
    gistId: activeGistId ? `${activeGistId.slice(0, 6)}…${activeGistId.slice(-4)}` : '',
    lastSyncAt: cloudBackupState.lastSyncAt,
    error: cloudBackupState.error || ''
  };
}

/**
 * Free zero-data-loss persistence for Render Free Tier:
 * Needs ONLY GITHUB_GIST_TOKEN (GIST_BACKUP_ID is optional!).
 * Auto-discovers an existing private ceo-office-db.json Gist, or auto-creates one on first run.
 */
export async function initCloudPersistence() {
  if (!isGistTokenSet()) {
    cloudBackupState = { enabled: false, restored: false, gistId: '', lastSyncAt: null, error: '' };
    return cloudBackupState;
  }
  cloudBackupState.enabled = true;
  const headers = getGistHeaders();

  try {
    // 1) If no GIST_BACKUP_ID is provided, auto-discover existing private backup Gist
    if (!activeGistId) {
      const listRes = await fetch('https://api.github.com/gists?per_page=30', { headers });
      if (listRes.ok) {
        const list = await listRes.json();
        const found = Array.isArray(list) ? list.find((g) => g?.files?.[GIST_FILENAME]) : null;
        if (found?.id) {
          activeGistId = found.id;
        }
      }
    }

    // 2) If found or provided, fetch & restore full DB from Gist
    if (activeGistId) {
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(activeGistId)}`, { headers });
      if (res.ok) {
        const gist = await res.json();
        const fileObj = gist?.files?.[GIST_FILENAME];
        let raw = fileObj?.content || '';
        if (fileObj?.truncated && fileObj?.raw_url) {
          const rawRes = await fetch(fileObj.raw_url, { headers });
          if (rawRes.ok) raw = await rawRes.text();
        }
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.settings && Array.isArray(parsed.agents)) {
            // Preserve current environment API keys, Telegram credentials & permanent token if present
            if (process.env.EXAONE_API_KEY) parsed.settings.providers.exaone.apiKey = process.env.EXAONE_API_KEY;
            if (process.env.GEMINI_API_KEY) parsed.settings.providers.gemini.apiKey = process.env.GEMINI_API_KEY;
            if (process.env.ANTHROPIC_API_KEY) parsed.settings.providers.claude.apiKey = process.env.ANTHROPIC_API_KEY;
            if (process.env.TELEGRAM_BOT_TOKEN) parsed.settings.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (process.env.TELEGRAM_CHAT_ID) parsed.settings.telegram.chatId = process.env.TELEGRAM_CHAT_ID;
            if (process.env.TELEGRAM_POLLING === 'true') parsed.settings.telegram.pollingEnabled = true;
            if (process.env.MCP_TOKEN || process.env.RENDER_SERVICE_ID) {
              parsed.settings.mcpToken = resolveStableMcpToken();
            }
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(DB_PATH, JSON.stringify(parsed, null, 2), 'utf8');
            cloudBackupState = { enabled: true, restored: true, gistId: activeGistId, lastSyncAt: new Date().toISOString(), error: '' };
            console.log(`☁️  GitHub Gist cloud backup restored (${activeGistId})`);
            return cloudBackupState;
          }
        }
      }
    }

    // 3) No backup Gist exists yet → auto-create a private (secret) Gist right now!
    const initialDb = loadDb();
    const createRes = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: {
          [GIST_FILENAME]: { content: JSON.stringify(initialDb, null, 2) }
        }
      })
    });
    if (createRes.ok) {
      const created = await createRes.json();
      activeGistId = created.id || '';
      cloudBackupState = { enabled: true, restored: false, gistId: activeGistId, lastSyncAt: new Date().toISOString(), error: '' };
      console.log(`☁️  Created new private GitHub Gist backup (${activeGistId})`);
      return cloudBackupState;
    }
    cloudBackupState.error = `Gist init HTTP ${createRes.status}`;
    return cloudBackupState;
  } catch (err) {
    cloudBackupState.error = err.message;
    return cloudBackupState;
  }
}

function scheduleGistBackup(serialized) {
  if (!isGistTokenSet() || !activeGistId) return;
  if (gistSyncTimer) clearTimeout(gistSyncTimer);
  gistSyncTimer = setTimeout(() => {
    fetch(`https://api.github.com/gists/${encodeURIComponent(activeGistId)}`, {
      method: 'PATCH',
      headers: getGistHeaders(),
      body: JSON.stringify({
        files: {
          [GIST_FILENAME]: { content: serialized }
        }
      })
    })
      .then((res) => {
        if (res.ok) {
          cloudBackupState.lastSyncAt = new Date().toISOString();
          cloudBackupState.error = '';
        }
      })
      .catch(() => {});
  }, 1500);
}

export function saveDb(db) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const serialized = JSON.stringify(db, null, 2);
  fs.writeFileSync(DB_PATH, serialized, 'utf8');
  scheduleGistBackup(serialized);
}

export function appendLog(db, actor, message, level = 'info') {
  db.logs.unshift({
    id: uid('log'),
    timestamp: new Date().toISOString(),
    actor,
    level,
    message
  });
  if (db.logs.length > 100) {
    db.logs = db.logs.slice(0, 100);
  }
}

export function appendMessage(db, msg) {
  if (!Array.isArray(db.messages)) db.messages = [];
  const entry = {
    id: uid('msg'),
    timestamp: new Date().toISOString(),
    targetAgentId: null,
    statusText: '대화 중',
    type: 'reply',
    ...msg
  };
  db.messages.push(entry);
  if (db.messages.length > 160) {
    db.messages = db.messages.slice(-160);
  }
  return entry;
}

export function sanitizeStateForClient(db) {
  const clone = structuredClone(db);
  const providers = clone.settings?.providers || {};
  for (const key of Object.keys(providers)) {
    const rawKey = providers[key].apiKey || '';
    providers[key].hasApiKey = rawKey.length > 0;
    providers[key].apiKeyPreview = rawKey
      ? `${rawKey.slice(0, 4)}••••${rawKey.slice(-4)}`
      : '';
    delete providers[key].apiKey;
  }
  if (clone.settings?.telegram) {
    const rawTg = clone.settings.telegram.botToken || '';
    clone.settings.telegram.hasBotToken = rawTg.length > 0;
    clone.settings.telegram.botTokenPreview = rawTg ? `${rawTg.slice(0, 6)}••••${rawTg.slice(-4)}` : '';
    delete clone.settings.telegram.botToken;
  }
  return clone;
}
