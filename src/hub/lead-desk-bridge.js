// hub/lead-desk-bridge.js: 팀장 업무함 답이 오면 원래 일(검수·작전 계획·마일스톤)을 이어서 처리
import { refreshLeadJobs, setLeadJobHandler } from '../lead-desk.js';
import { flushCloudBackup, loadDb, saveDb } from '../store.js';
import { processTaskResult } from './task-results.js';
import { opsCycle } from './lead-ops.js';
import { autoStartLiveMissionTasks, updateMissionStatus } from './missions.js';
import { appendLog } from '../store.js';
import { botConnected, isAgentExhausted, pickBotOrDevMember } from '../lead-engine.js';
import { buildDispatchPrompt } from '../orchestrator.js';
import { DEV_TEAM, dispatchDevTeamTask } from './dev-policy.js';
import { leadSay } from './missions.js';

const STALE_BRIDGE_MS = 3 * 3600 * 1000; // 봇이 3시간 동안 가져가지 않으면
const STUCK_BRIDGE_MS = 12 * 3600 * 1000; // 접속은 하는데 12시간째 처리 안 하면
const nudgedAt = new Map();
const BOT_IDS = ['agent_cue', 'agent_muse', 'agent_pickle', 'agent_instinct', 'agent_vooy'];
const IDLE_FILL_MS = 2 * 3600 * 1000;
let lastIdleFillAt = 0;

/** 접속 중인데 할 일이 0건인 봇 → 진행 중인 프로젝트(할 일이 가장 적은 곳)에서 팀장이 추가 배정 */
async function fillIdleBots(db) {
  if (Date.now() - lastIdleFillAt < IDLE_FILL_MS) return;
  const openOf = (id) => (db.tasks || []).filter((t) => t.assigneeId === id && !['completed', 'rejected'].includes(t.status)).length;
  const idle = BOT_IDS.filter((id) => botConnected(db, id, 3) && openOf(id) === 0);
  if (!idle.length) return;
  const missions = (db.missions || []).filter((m) => m.mode === 'project' && !m.isRoutineHub && (m.plan?.milestones || []).some((x) => x.status === 'doing'));
  if (!missions.length) return;
  lastIdleFillAt = Date.now();
  const openInMission = (mid) => (db.tasks || []).filter((t) => t.missionId === mid && !['completed', 'rejected'].includes(t.status)).length;
  const target = missions.sort((a, b) => openInMission(a.id) - openInMission(b.id))[0];
  appendLog(db, '총괄 팀장', `놀고 있는 봇 ${idle.length}명(${idle.map((id) => db.agents.find((a) => a.id === id)?.name).join(', ')}) → "${target.title}"에서 추가 배정 검토`, 'info');
  saveDb(db);
  opsCycle(target.id, { fillIdle: idle }).catch((err) => console.warn('idle fill failed:', err.message));
}

/** 봇이 안 가져가는 작업 → 성격 맞는 다른 봇 → 개발팀 Aside, 개발팀 배정 작업은 작업 큐로 */
function rebalanceBridgeTasks(db) {
  const now = Date.now();
  let changed = 0;
  const seenH = (id) => {
    const at = db.agentConnections?.[id]?.lastSeenAt;
    return at ? (now - Date.parse(at)) / 3600000 : Infinity;
  };
  for (const t of db.tasks || []) {
    if (DEV_TEAM[t.assigneeId] && ['queued', 'awaiting_bridge'].includes(t.status)) {
      if (dispatchDevTeamTask(db, t)) changed += 1;
      continue;
    }
    if (t.status !== 'awaiting_bridge') continue;
    const age = now - Date.parse(t.updatedAt || t.createdAt);
    if (age < STALE_BRIDGE_MS) continue;
    const ag = db.agents.find((a) => a.id === t.assigneeId);
    const offline = seenH(t.assigneeId) > 3;
    if (!offline && age < STUCK_BRIDGE_MS) continue;
    if (Number(t.botHandoffs || 0) >= 2) continue;
    t.triage = t.triage || { retries: 0, tried: [] };
    if (ag?.id && !t.triage.tried.includes(ag.id)) t.triage.tried.push(ag.id);
    const alt = pickBotOrDevMember(db, t, t.triage.tried);
    if (!alt) continue;
    const mission = db.missions.find((m) => m.id === t.missionId);
    t.assigneeId = alt.id;
    t.botHandoffs = Number(t.botHandoffs || 0) + 1;
    t.updatedAt = new Date().toISOString();
    if (mission) t.dispatchPrompt = buildDispatchPrompt(alt, t, mission);
    if (DEV_TEAM[alt.id]) dispatchDevTeamTask(db, t);
    const why = offline ? `${ag?.name || '담당'} 앱이 ${Math.round(age / 3600000)}시간째 가져가지 않음` : `${ag?.name || '담당'}가 ${Math.round(age / 3600000)}시간째 처리하지 않음`;
    appendLog(db, '총괄 팀장', `"${t.title}" → ${alt.name}에게 재배정 (${why})`, 'info');
    if (mission) leadSay(db, mission, '자동 재배정', `"${t.title}"을(를) ${alt.name}에게 넘겼습니다. (${why})`);
    changed += 1;
  }
  return changed;
}

/** 검수 대기(review_pending) 작업을 다시 검수 → 팀장 답이 있으면 그대로 쓰고, 업무함이 만료됐으면 Gemini API로 */
export async function resumeReviewTask(taskId) {
  const db = loadDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== 'review_pending') return null;
  const agent = db.agents.find((a) => a.id === task.assigneeId);
  const mission = db.missions.find((m) => m.id === task.missionId);
  const out = await processTaskResult(db, task, agent, mission, { output: task.output, executionModeUsed: task.executionModeUsed });
  updateMissionStatus(db, task.missionId);
  saveDb(db);
  await flushCloudBackup(db);
  if (out.requeued) setTimeout(() => autoStartLiveMissionTasks(task.missionId).catch(() => {}), 1500);
  if (task.status === 'completed' && mission) opsCycle(mission.id).catch(() => {});
  return out;
}

setLeadJobHandler(async ({ purpose, refs = {} }) => {
  if (purpose === 'review' && refs.taskId) return resumeReviewTask(refs.taskId);
  if (refs.missionId) return opsCycle(refs.missionId, refs.fillIdle?.length ? { fillIdle: refs.fillIdle, fillSlot: refs.fillSlot } : {});
  return null;
});

/** 매분: 근무 상태에 맞게 담당 재배정, 답이 왔거나 만료된 검수 대기 작업 이어서 처리 */
export async function leadDeskTick() {
  const db = loadDb();
  await fillIdleBots(db);
  const moved = rebalanceBridgeTasks(db);
  if (refreshLeadJobs(db) || moved) saveDb(db);
  // 오늘 한도 소진으로 멈춘 작업: 10분마다 다시 배정 시도 (봇·개발팀으로 대체)
  const exhausted = (t) => {
    const ag = db.agents.find((a) => a.id === t.assigneeId);
    return ag ? isAgentExhausted(ag, db.settings) : false;
  };
  for (const mid of new Set((db.tasks || []).filter((t) => t.status === 'queued' && (t.quotaHold || exhausted(t))).map((t) => t.missionId))) {
    if (Date.now() - (nudgedAt.get(mid) || 0) < 10 * 60 * 1000) continue;
    nudgedAt.set(mid, Date.now());
    autoStartLiveMissionTasks(mid).catch(() => {});
  }
  const fresh = loadDb();
  const live = new Set((fresh.leadJobs || []).filter((j) => ['open', 'claimed'].includes(j.status)).map((j) => j.refs?.taskId).filter(Boolean));
  const waiting = (fresh.tasks || []).filter((t) => t.status === 'review_pending' && !live.has(t.id)).slice(0, 3);
  for (const t of waiting) await resumeReviewTask(t.id);
}
