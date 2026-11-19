// 投稿者・作成者の表示名。メールアドレスは画面や GitHub Issue に出さない。
import { createHash } from 'node:crypto';
import type { Person } from './types';

/** userId から、利用者ごとに一意で安定した表示名（例: 「ユーザー-1a2b3c4d」）を作る。 */
export function generatedName(userId: string): string {
  const hash = createHash('sha256').update(userId).digest('hex');
  return `ユーザー-${hash.slice(0, 8)}`;
}

/** 表示名として使える値か。空の値とメールアドレスらしき値は使わない。 */
function isUsableName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('@');
}

/**
 * クライアントプリンシパルの claims から name クレームを探し、なければ userId から表示名を作る。
 * SWA が API に渡す x-ms-client-principal には通常 claims が含まれないため、多くの場合は生成した名前になる。
 */
export function displayName(userId: string, claims: unknown): string {
  if (Array.isArray(claims)) {
    for (const claim of claims) {
      if (typeof claim !== 'object' || claim === null) continue;
      const { typ, val } = claim as Record<string, unknown>;
      if (typ === 'name' && isUsableName(val)) return val.trim();
    }
  }
  return generatedName(userId);
}

/** 以前のデータでは name にメールアドレス（userDetails）を保存していたため、読み出し時に置き換える。 */
export function publicPerson(person: Person): Person {
  if (person.userId === 'anonymous' || isUsableName(person.name)) return person;
  return { userId: person.userId, name: generatedName(person.userId) };
}
