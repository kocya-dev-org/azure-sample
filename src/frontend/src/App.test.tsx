import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

describe('App', () => {
  it('API の結果を表示する', async () => {
    const fetchMock = vi.fn<() => Promise<unknown>>().mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'goodbye' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'API を呼び出す' }));

    expect(await screen.findByText('goodbye')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/goodbye');
  });

  it('API の呼び出しに失敗するとエラーを表示する', async () => {
    vi.stubGlobal('fetch', vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error('network')));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'API を呼び出す' }));

    expect(await screen.findByText('API の呼び出しに失敗しました')).toBeInTheDocument();
  });
});
