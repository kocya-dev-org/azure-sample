// ビルド成果物にシークレットらしき文字列が含まれていないかを検査する。
// 使い方: node scripts/check-secrets.mjs <ディレクトリ>...
// 値そのものは出力せず、ファイル名と種類だけを表示する。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PATTERNS = [
  { name: 'Cosmos DB / Storage のアカウントキー', regex: /AccountKey=[A-Za-z0-9+/=]{20,}/ },
  { name: 'Storage の接続文字列', regex: /DefaultEndpointsProtocol=https?;AccountName=/ },
  { name: 'GitHub のトークン', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub の fine-grained トークン', regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
  { name: 'OpenAI 形式の API キー', regex: /\bsk-[A-Za-z0-9_-]{32,}\b/ },
];

// 実行環境にシークレットが設定されている場合は、その値そのものも検査する
const SECRET_ENV_NAMES = [
  'FOUNDRY_API_KEY',
  'COSMOS_CONNECTION_STRING',
  'ISSUE_GITHUB_TOKEN',
  'AZURE_AI_FOUNDRY_API_KEY',
  'FOUNDRY_TRANSCRIBE_API_KEY',
  'AZURE_AI_FOUNDRY_TRANSCRIBE_API_KEY',
  'FOUNDRY_REALTIME_API_KEY',
  'REALTIME_TICKET_SECRET',
];
const secretValues = SECRET_ENV_NAMES.map((name) => [name, process.env[name]]).filter(
  ([, value]) => value && value.length >= 8,
);

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.map', '.json', '.html', '.css', '.txt']);

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return listFiles(full);
    return TEXT_EXTENSIONS.has(path.extname(name)) ? [full] : [];
  });
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('検査するディレクトリを指定してください。');
  process.exit(2);
}

const findings = [];
let fileCount = 0;
for (const dir of dirs) {
  if (!existsSync(dir)) {
    console.error(`${dir} がありません。先にビルドしてください。`);
    process.exit(2);
  }
  for (const file of listFiles(dir)) {
    fileCount += 1;
    const text = readFileSync(file, 'utf8');
    for (const { name, regex } of PATTERNS) {
      if (regex.test(text)) findings.push(`${file}: ${name}`);
    }
    for (const [name, value] of secretValues) {
      if (text.includes(value)) findings.push(`${file}: ${name} の値`);
    }
  }
}

if (findings.length > 0) {
  console.error('シークレットらしき文字列が見つかりました:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(`シークレットは見つかりませんでした（${fileCount} ファイル）。`);
