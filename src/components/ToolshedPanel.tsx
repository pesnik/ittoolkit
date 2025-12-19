'use client';

import React, { useState, useMemo } from 'react';
import {
  Card,
  Text,
  Button,
  makeStyles,
  shorthands,
  tokens,
  Input,
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
} from '@fluentui/react-components';
import {
  BroomRegular,
  ArrowLeftRegular,
  HardDriveRegular,
  Wifi1Regular,
  SettingsRegular,
  ShieldRegular,
  SearchRegular,
  ChevronDownRegular,
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
  searchContainer: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalS),
  },
  searchInput: {
    maxWidth: '400px',
  },
  categoriesContainer: {
    flex: 1,
    overflowY: 'auto',
  },
  categorySection: {
    marginBottom: tokens.spacingVerticalL,
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
  category: string;
}

const tools: Tool[] = [
  {
    id: 'junk-cleaner',
    name: 'Junk File Cleaner',
    description: 'Scan and remove unnecessary files to free up disk space',
    icon: <BroomRegular />,
    component: CleanerPanel,
    category: 'Storage & Cleanup',
  },
  {
    id: 'disk-manager',
    name: 'Disk Manager',
    description: 'View disk information, partitions, and SMART health data',
    icon: <HardDriveRegular />,
    component: DiskManager,
    category: 'Storage & Cleanup',
  },
  {
    id: 'network-toolkit',
    name: 'Network Toolkit',
    description: 'Ping, DNS lookup, port scanning, and network diagnostics',
    icon: <Wifi1Regular />,
    component: NetworkToolkit,
    category: 'Network & Connectivity',
  },
  {
    id: 'system-admin',
    name: 'System Administration',
    description: 'Manage services, view system info, and control processes',
    icon: <SettingsRegular />,
    component: SystemAdmin,
    category: 'System & Administration',
  },
  {
    id: 'security-monitor',
    name: 'Security Monitor',
    description: 'Monitor processes, security logs, open ports, and firewall',
    icon: <ShieldRegular />,
    component: SecurityMonitor,
    category: 'Security & Monitoring',
  },
];

export default function ToolshedPanel() {
  const styles = useStyles();
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [openCategories, setOpenCategories] = useState<string[]>([]);

  // Filter tools based on search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;

    const query = searchQuery.toLowerCase();
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // Group tools by category
  const categorizedTools = useMemo(() => {
    const categories = new Map<string, Tool[]>();

    filteredTools.forEach((tool) => {
      if (!categories.has(tool.category)) {
        categories.set(tool.category, []);
      }
      categories.get(tool.category)!.push(tool);
    });

    return categories;
  }, [filteredTools]);

  // Initialize all categories as open by default
  React.useEffect(() => {
    if (openCategories.length === 0) {
      setOpenCategories(Array.from(categorizedTools.keys()));
    }
  }, [categorizedTools, openCategories.length]);

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

      <div className={styles.searchContainer}>
        <Input
          className={styles.searchInput}
          placeholder="Search tools..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          contentBefore={<SearchRegular />}
          appearance="outline"
        />
      </div>

      <div className={styles.categoriesContainer}>
        <Accordion
          multiple
          collapsible
          openItems={openCategories}
          onToggle={(_e, data) => setOpenCategories(data.openItems as string[])}
        >
          {Array.from(categorizedTools.entries()).map(([category, categoryTools]) => (
            <AccordionItem key={category} value={category}>
              <AccordionHeader
                icon={<ChevronDownRegular />}
                expandIconPosition="end"
              >
                <Text weight="semibold">
                  {category} ({categoryTools.length})
                </Text>
              </AccordionHeader>
              <AccordionPanel>
                <div className={styles.toolGrid}>
                  {categoryTools.map((tool) => (
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
              </AccordionPanel>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
