// アプリケーション設定（SWA のアプリケーション設定 / local.settings.json）の読み込み。
// import した時点では検査せず、使うときに検査する。値はログやレスポンスに出さない。

export function requiredSetting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required application setting is missing: ${name}`);
  return value;
}

export function optionalSetting(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}
