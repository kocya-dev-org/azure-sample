// SWA マネージド Functions にアップロードする API 成果物を .deploy/api に作成する。
// 引数に batch を渡すと、独立 Function App（日次バッチ、ADR 0010）用の成果物を .deploy/batch に作成し、
// package.json の main をバッチ用エントリー（dist/src/batch.js）に書き換える。
// 引数に relay を渡すと、音声会話の中継（App Service、ADR 0013）用の成果物を .deploy/relay に作成する。
// npm workspaces では依存がルートの node_modules に hoist されるため、
// lockfile で解決済みの本番依存ツリー（npm ls --omit=dev）だけをコピーする。
// 事前に `npm ci` と `npm run build` を実行しておくこと。
import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const TARGETS = {
  api: {
    workspace: 'src/api',
    entries: ['dist', 'host.json', 'package.json'],
    outDir: 'api',
    main: 'dist/src/index.js',
  },
  batch: {
    workspace: 'src/api',
    entries: ['dist', 'host.json', 'package.json'],
    outDir: 'batch',
    main: 'dist/src/batch.js',
  },
  relay: {
    workspace: 'src/relay',
    entries: ['dist', 'package.json'],
    outDir: 'relay',
    main: 'dist/src/server.js',
  },
};
const targetName = process.argv[2] ?? 'api';
const target = TARGETS[targetName];
if (!target) {
  throw new Error(`不明なステージング対象です: ${targetName}（api・batch・relay のいずれか）`);
}

const root = process.cwd();
const workspaceDir = path.join(root, ...target.workspace.split('/'));
const outDir = path.join(root, '.deploy', target.outDir);
const outModules = path.join(outDir, 'node_modules');

if (!existsSync(path.join(workspaceDir, 'dist'))) {
  throw new Error(`${target.workspace}/dist がありません。先に npm run build を実行してください。`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outModules, { recursive: true });
for (const entry of target.entries) {
  cpSync(path.join(workspaceDir, entry), path.join(outDir, entry), { recursive: true });
}
if (!existsSync(path.join(outDir, target.main))) {
  throw new Error(`エントリーポイント ${target.main} がありません。`);
}
const packageJsonPath = path.join(outDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
packageJson.main = target.main;
writeFileSync(
  packageJsonPath,
  `${JSON.stringify(packageJson, null, 2)}
`,
);

const listed = execSync(`npm ls --omit=dev --workspace ${target.workspace} --all --parseable`, {
  cwd: root,
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => path.relative(root, line).split(path.sep).join('/'));

const prefixes = ['node_modules/', `${target.workspace}/node_modules/`];
const packages = [];
for (const rel of listed) {
  // ルートプロジェクト自身と workspace 自身は依存ではない
  if (rel === '' || rel === target.workspace) continue;
  // workspace へのシンボリックリンク（node_modules/flyingfish-api など）も除外する
  const resolved = path.relative(realpathSync(root), realpathSync(path.join(root, rel)));
  if (!resolved.split(path.sep).includes('node_modules')) continue;
  const prefix = prefixes.find((p) => rel.startsWith(p));
  if (!prefix) {
    throw new Error(`想定外の依存パスです: ${rel}`);
  }
  // workspace 直下の依存はルートより優先されるため、後からコピーして上書きする
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

// テストファイルをデプロイしない
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
  `${targetName} を ${path.relative(root, outDir)} にステージングしました（依存 ${packages.length} 件）。`,
);
