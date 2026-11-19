// 独立した Function App（日次バッチ）のエントリーポイント（ADR 0010）。
// SWA マネージド Functions には載せないタイマー関数だけを読み込む。
// デプロイ時は scripts/stage-api.mjs batch が package.json の main をこのファイルに書き換える。
import './batch/syncIssueStatusTimer';
