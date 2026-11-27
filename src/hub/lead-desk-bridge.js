// hub/lead-desk-bridge.js: 팀장 업무함 답이 오면 원래 일(검수·작전 계획·마일스톤)을 이어서 처리
import { refreshLeadJobs, setLeadJobHandler } from '../lead-desk.js';
import { flushCloudBackup, loadDb, saveDb } from '../store.js';
import { processTaskResult } from './task-results.js';
import { opsCycle } from './lead-ops.js';
import { autoStartLiveMissionTasks, updateMissionStatus } from './missions.js';

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
  if (refs.missionId) return opsCycle(refs.missionId);
  return null;
});

/** 매분: 근무 상태에 맞게 담당 재배정, 답이 왔거나 만료된 검수 대기 작업 이어서 처리 */
export async function leadDeskTick() {
  const db = loadDb();
  if (refreshLeadJobs(db)) saveDb(db);
  const fresh = loadDb();
  const live = new Set((fresh.leadJobs || []).filter((j) => ['open', 'claimed'].includes(j.status)).map((j) => j.refs?.taskId).filter(Boolean));
  const waiting = (fresh.tasks || []).filter((t) => t.status === 'review_pending' && !live.has(t.id)).slice(0, 3);
  for (const t of waiting) await resumeReviewTask(t.id);
}
