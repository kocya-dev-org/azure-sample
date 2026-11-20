import { describe, expect, it } from 'vitest';
import { displayName, generatedName, publicPerson } from '../../src/lib/person';

describe('generatedName', () => {
  it('userId ごとに一意で、同じ userId なら同じ名前を返す', () => {
    expect(generatedName('u1')).toMatch(/^ユーザー-[0-9a-f]{8}$/);
    expect(generatedName('u1')).toBe(generatedName('u1'));
    expect(generatedName('u1')).not.toBe(generatedName('u2'));
  });
});

describe('displayName', () => {
  it('name クレームがあればそれを使う', () => {
    const claims = [
      { typ: 'preferred_username', val: 'user@example.com' },
      { typ: 'name', val: ' 山田 太郎 ' },
    ];
    expect(displayName('u1', claims)).toBe('山田 太郎');
  });

  it('name クレームがない・空・メールアドレスなら userId から生成する', () => {
    expect(displayName('u1', undefined)).toBe(generatedName('u1'));
    expect(displayName('u1', [{ typ: 'name', val: '' }])).toBe(generatedName('u1'));
    expect(displayName('u1', [{ typ: 'name', val: 'user@example.com' }])).toBe(generatedName('u1'));
    expect(displayName('u1', [null, 'x', { typ: 'name' }])).toBe(generatedName('u1'));
  });
});

describe('publicPerson', () => {
  it('メールアドレスが保存されている以前のデータは生成した名前に置き換える', () => {
    expect(publicPerson({ userId: 'u1', name: 'user@example.com' })).toEqual({
      userId: 'u1',
      name: generatedName('u1'),
    });
  });

  it('表示名と匿名はそのまま返す', () => {
    expect(publicPerson({ userId: 'u1', name: '山田 太郎' })).toEqual({
      userId: 'u1',
      name: '山田 太郎',
    });
    expect(publicPerson({ userId: 'anonymous', name: '不明' })).toEqual({
      userId: 'anonymous',
      name: '不明',
    });
  });
});
