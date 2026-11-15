// SWA マネージド Functions にアップロードする API 成果物を .deploy/api に作成する。
// npm workspaces では依存がルートの node_modules に hoist されるため、
// lockfile で解決済みの本番依存ツリー（npm ls --omit=dev）だけをコピーする。
// 事前に `npm ci` と `npm run build` を実行しておくこと。
import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apiDir = path.join(root, 'src', 'api');
const outDir = path.join(root, '.deploy', 'api');
const outModules = path.join(outDir, 'node_modules');

if (!existsSync(path.join(apiDir, 'dist'))) {
  throw new Error('src/api/dist がありません。先に npm run build を実行してください。');
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outModules, { recursive: true });
for (const entry of ['dist', 'host.json', 'package.json']) {
  cpSync(path.join(apiDir, entry), path.join(outDir, entry), { recursive: true });
}

const listed = execSync('npm ls --omit=dev --workspace src/api --all --parseable', {
  cwd: root,
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => path.relative(root, line).split(path.sep).join('/'));

const prefixes = ['node_modules/', 'src/api/node_modules/'];
const packages = [];
for (const rel of listed) {
  // ルートプロジェクト自身と API workspace 自身は依存ではない
  if (rel === '' || rel === 'src/api') continue;
  // workspace へのシンボリックリンク（node_modules/flyingfish-api など）も除外する
  const resolved = path.relative(realpathSync(root), realpathSync(path.join(root, rel)));
  if (!resolved.split(path.sep).includes('node_modules')) continue;
  const prefix = prefixes.find((p) => rel.startsWith(p));
  if (!prefix) {
    throw new Error(`想定外の依存パスです: ${rel}`);
  }
  // src/api 直下の依存はルートより優先されるため、後からコピーして上書きする
  packages.push({ rel, target: rel.slice(prefix.length), order: prefixes.indexOf(prefix) });
}
packages.sort((a, b) => a.order - b.order || a.rel.length - b.rel.length);

for (const { rel, target } of packages) {
  rmSync(path.join(outModules, target), { recursive: true, force: true });
  cpSync(path.join(root, rel), path.join(outModules, target), {
    recursive: true,
    dereference: true,
  });
}

// テストファイルを Functions ホストに読み込ませない
const findTests = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return findTests(full);
    return name.endsWith('.test.js') ? [full] : [];
  });
const tests = findTests(path.join(outDir, 'dist'));
if (tests.length > 0) {
  throw new Error(`テストファイルはデプロイできません: ${tests.join(', ')}`);
}

console.log(
  `API を ${path.relative(root, outDir)} にステージングしました（依存 ${packages.length} 件）。`,
);
