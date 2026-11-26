// hub/env.js: 저장소 루트 경로 · public 폴더 · package.json (server.js에서 분리)
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// 이 파일은 src/hub/ 아래에 있으므로 두 단계 위가 저장소 루트
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export const PKG = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
