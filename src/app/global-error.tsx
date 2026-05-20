'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: '1rem',
            padding: '2rem',
            backgroundColor: '#111',
            color: '#eee',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ fontSize: '48px' }}>⚠️</div>
          <h2 style={{ margin: 0 }}>Fatal Error</h2>
          <p style={{ color: '#999', textAlign: 'center', maxWidth: 400, margin: 0 }}>
            {error.message || 'A critical error occurred outside the app shell'}
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '8px 24px',
              borderRadius: 4,
              border: 'none',
              background: '#f56f1f',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
