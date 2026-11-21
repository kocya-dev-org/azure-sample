// CORS のオリジン判定。SWA の既定ホストと PR プレビューのホストを許可する（ADR 0013）。

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** パターンの `*` は英数字とハイフンの並びにだけ一致させる（`.` をまたいで別のドメインに一致させない）。 */
export function originMatcher(patterns: string[]): (origin: string) => boolean {
  const regexes = patterns.map(
    (pattern) => new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[a-z0-9-]+')}$`, 'i'),
  );
  return (origin) => regexes.some((regex) => regex.test(origin));
}
