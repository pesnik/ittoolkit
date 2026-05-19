'use client';

import React, { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Button,
  Text,
  Badge,
  Spinner,
  makeStyles,
  tokens,
  shorthands,
} from '@fluentui/react-components';
import {
  CheckmarkCircle20Regular,
  Edit20Regular,
  Beaker20Regular,
  Dismiss20Regular,
} from '@fluentui/react-icons';
import type { WorkflowFileV2, WorkflowStepV2 } from '@/types/workflow-types';

const ACTOR_META: Record<string, { label: string }> = {
  auto: { label: 'Auto' },
  agent: { label: 'Agent' },
  human: { label: 'Human' },
};

const ACTOR_COLORS: Record<string, string> = {
  auto: tokens.colorPaletteGreenBackground2,
  agent: tokens.colorPaletteBlueBackground2,
  human: tokens.colorPaletteGoldBackground2,
};

const useStyles = makeStyles({
  card: {
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    borderRadius: '8px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    backgroundColor: tokens.colorNeutralBackground1,
    marginTop: '8px',
    marginBottom: '8px',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '8px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  stepList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: '12px',
  },
  stepIndex: {
    width: '20px',
    textAlign: 'right' as const,
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
  stepIntent: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stepTool: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
    fontFamily: 'monospace',
    fontSize: '11px',
  },
  actorBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 6px',
    borderRadius: '3px',
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    flexShrink: 0,
    lineHeight: '16px',
  },
  metaRow: {
    fontSize: '11px',
    color: tokens.colorNeutralForeground3,
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '4px',
  },
  errorText: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: '12px',
  },
  successText: {
    color: tokens.colorPaletteGreenForeground1,
    fontSize: '12px',
  },
});

interface WorkflowCardProps {
  workflow: WorkflowFileV2;
  onAccept?: () => void;
  onEdit?: (slug: string) => void;
  onDismiss?: () => void;
}

export function WorkflowCard({ workflow, onAccept, onEdit, onDismiss }: WorkflowCardProps) {
  const styles = useStyles();
  const [saving, setSaving] = useState(false);
  const [testingIndex, setTestingIndex] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const handleAccept = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke<WorkflowFileV2>('workflow_update', { definition: workflow });
      onAccept?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [workflow, onAccept]);

  const handleEdit = useCallback(() => {
    onEdit?.(workflow.slug);
  }, [workflow.slug, onEdit]);

  const handleTestStep = useCallback(async (step: WorkflowStepV2, index: number) => {
    setTestingIndex(index);
    setError(null);
    try {
      const method = step.tool;
      const params = step.params ?? {};
      const result = await invoke<unknown>('browser_rpc', {
        request: { method, params },
      });
      setTestResults((prev) => ({
        ...prev,
        [index]: { ok: true, text: JSON.stringify(result, null, 2).slice(0, 500) },
      }));
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [index]: { ok: false, text: String(e) },
      }));
    } finally {
      setTestingIndex(null);
    }
  }, []);

  const stepCount = workflow.steps?.length ?? 0;

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <Text weight="semibold" size={300}>{workflow.name}</Text>
          <Badge size="small" appearance="tint">v{workflow.version}</Badge>
        </div>
        <Text size={100} className={styles.metaRow}>
          {stepCount} step{stepCount !== 1 ? 's' : ''}
          {workflow.variables?.length > 0 ? ` · ${workflow.variables.length} variable${workflow.variables.length !== 1 ? 's' : ''}` : ''}
        </Text>
      </div>

      {workflow.description && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>{workflow.description}</Text>
      )}

      <div className={styles.stepList}>
        {workflow.steps?.map((step, i) => (
          <div key={step.id ?? i}>
            <div className={styles.stepRow}>
              <span className={styles.stepIndex}>{i + 1}.</span>
              <span className={styles.stepIntent}>{step.intent}</span>
              <span className={styles.stepTool}>{step.tool}</span>
              <span
                className={styles.actorBadge}
                style={{ backgroundColor: ACTOR_COLORS[step.actor] ?? tokens.colorNeutralBackground3 }}
              >
                {ACTOR_META[step.actor]?.label ?? step.actor}
              </span>
              <Button
                size="small"
                appearance="subtle"
                icon={testingIndex === i ? <Spinner size="tiny" /> : <Beaker20Regular />}
                disabled={testingIndex !== null}
                onClick={() => handleTestStep(step, i)}
              />
            </div>
            {testResults[i] && (
              <div style={{
                padding: '4px 8px 4px 32px',
                fontSize: '11px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                color: testResults[i].ok ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1,
              }}>
                {testResults[i].text}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div className={styles.errorText}>{error}</div>}

      <div className={styles.actionsRow}>
        <Button
          appearance="primary"
          size="small"
          icon={saving ? <Spinner size="tiny" /> : <CheckmarkCircle20Regular />}
          disabled={saving}
          onClick={handleAccept}
        >
          {saving ? 'Saving...' : 'Accept'}
        </Button>
        <Button
          appearance="subtle"
          size="small"
          icon={<Edit20Regular />}
          onClick={handleEdit}
        >
          Edit
        </Button>
        {onDismiss && (
          <Button
            appearance="subtle"
            size="small"
            icon={<Dismiss20Regular />}
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
