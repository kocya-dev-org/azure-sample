import { useState } from 'react';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function App() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function callApi() {
    setStatus('loading');
    try {
      const response = await fetch('/api/goodbye');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { message: string };
      setMessage(data.message);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  return (
    <main>
      <h1>Flyingfish</h1>
      <button type="button" onClick={callApi} disabled={status === 'loading'}>
        API を呼び出す
      </button>
      {status === 'loading' && <p>読み込み中…</p>}
      {status === 'success' && <p>{message}</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          API の呼び出しに失敗しました
        </p>
      )}
    </main>
  );
}
