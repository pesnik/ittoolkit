'use client';

import React from 'react';
import { makeStyles, tokens, Text } from '@fluentui/react-components';
import { OpenRegular, NavigationRegular } from '@fluentui/react-icons';
import { emitAgentAction, AgentActionType } from '@/lib/agent/action-bus';

const useStyles = makeStyles({
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'monospace',
    cursor: 'pointer',
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground4,
    },
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
  },
  label: {
    fontSize: '12px',
    fontFamily: 'monospace',
  },
});

interface AgentActionChipProps {
  path: string;
  label?: string;
  actionType?: AgentActionType;
}

export function AgentActionChip({
  path,
  label,
  actionType = 'navigate',
}: AgentActionChipProps) {
  const styles = useStyles();

  const handleClick = () => {
    emitAgentAction({ type: actionType, payload: { path } });
  };

  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <span
      className={styles.chip}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      title={`Open in file explorer: ${path}`}
      style={isHovered ? { borderColor: tokens.colorBrandForeground1 } as React.CSSProperties : undefined}
    >
      <span className={styles.icon}>
        {actionType === 'navigate' ? <NavigationRegular fontSize={12} /> : <OpenRegular fontSize={12} />}
      </span>
      <Text className={styles.label}>{label ?? path}</Text>
    </span>
  );
}
