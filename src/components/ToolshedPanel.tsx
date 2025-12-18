'use client';

import React, { useState } from 'react';
import {
  Card,
  Text,
  Button,
  makeStyles,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import {
  BroomRegular,
  ArrowLeftRegular,
  HardDriveRegular,
  Wifi1Regular,
  SettingsRegular,
  ShieldRegular,
} from '@fluentui/react-icons';
import { CleanerPanel } from './CleanerPanel';
import { DiskManager } from './tools/DiskManager';
import { NetworkToolkit } from './tools/NetworkToolkit';
import { SystemAdmin } from './tools/SystemAdmin';
import { SecurityMonitor } from './tools/SecurityMonitor';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    ...shorthands.padding(tokens.spacingVerticalL),
    ...shorthands.gap(tokens.spacingVerticalL),
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap(tokens.spacingHorizontalM),
  },
  toolGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    ...shorthands.gap(tokens.spacingVerticalL, tokens.spacingHorizontalL),
    ...shorthands.padding(tokens.spacingVerticalM, 0),
  },
  toolCard: {
    cursor: 'pointer',
    ...shorthands.transition('all', '0.2s', 'ease'),
    ':hover': {
      transform: 'translateY(-4px)',
      boxShadow: tokens.shadow16,
    },
  },
  toolCardContent: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalM),
    ...shorthands.padding(tokens.spacingVerticalL),
  },
  toolIcon: {
    fontSize: '32px',
    color: tokens.colorBrandForeground1,
  },
  toolTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  toolDescription: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  fullView: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
});

interface Tool {
  id: string;
  name: string;
  description: string;
  icon: React.ReactElement;
  component: React.ComponentType;
}

const tools: Tool[] = [
  {
    id: 'junk-cleaner',
    name: 'Junk File Cleaner',
    description: 'Scan and remove unnecessary files to free up disk space',
    icon: <BroomRegular />,
    component: CleanerPanel,
  },
  {
    id: 'disk-manager',
    name: 'Disk Manager',
    description: 'View disk information, partitions, and SMART health data',
    icon: <HardDriveRegular />,
    component: DiskManager,
  },
  {
    id: 'network-toolkit',
    name: 'Network Toolkit',
    description: 'Ping, DNS lookup, port scanning, and network diagnostics',
    icon: <Wifi1Regular />,
    component: NetworkToolkit,
  },
  {
    id: 'system-admin',
    name: 'System Administration',
    description: 'Manage services, view system info, and control processes',
    icon: <SettingsRegular />,
    component: SystemAdmin,
  },
  {
    id: 'security-monitor',
    name: 'Security Monitor',
    description: 'Monitor processes, security logs, open ports, and firewall',
    icon: <ShieldRegular />,
    component: SecurityMonitor,
  },
];

export default function ToolshedPanel() {
  const styles = useStyles();
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);

  if (selectedTool) {
    const ToolComponent = selectedTool.component;

    return (
      <div className={styles.fullView}>
        <div className={styles.header}>
          <Button
            icon={<ArrowLeftRegular />}
            appearance="subtle"
            onClick={() => setSelectedTool(null)}
          >
            Back to Toolshed
          </Button>
          <Text size={500} weight="semibold">
            {selectedTool.name}
          </Text>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <ToolComponent />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text size={600} weight="semibold">
          Toolshed
        </Text>
        <Text size={300} style={{ color: tokens.colorNeutralForeground3 }}>
          Select a tool to get started
        </Text>
      </div>

      <div className={styles.toolGrid}>
        {tools.map((tool) => (
          <Card
            key={tool.id}
            className={styles.toolCard}
            onClick={() => setSelectedTool(tool)}
          >
            <div className={styles.toolCardContent}>
              <div className={styles.toolIcon}>
                {tool.icon}
              </div>
              <Text className={styles.toolTitle}>
                {tool.name}
              </Text>
              <Text className={styles.toolDescription}>
                {tool.description}
              </Text>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
