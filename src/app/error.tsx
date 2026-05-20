'use client';

import { Button, Text } from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '1rem',
        padding: '2rem',
      }}
    >
      <ErrorCircleRegular style={{ fontSize: '48px', color: '#f56f1f' }} />
      <Text size={500} weight="semibold">
        Something went wrong
      </Text>
      <Text size={300} style={{ color: '#999', textAlign: 'center', maxWidth: 400 }}>
        {error.message || 'An unexpected error occurred'}
      </Text>
      <Button appearance="primary" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
