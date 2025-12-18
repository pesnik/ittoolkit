'use client';

import React, { useState, useEffect } from 'react';
import {
  Card,
  Text,
  Button,
  makeStyles,
  shorthands,
  tokens,
  Spinner,
  TabList,
  Tab,
  DataGrid,
  DataGridBody,
  DataGridRow,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridCell,
  TableCellLayout,
  TableColumnDefinition,
  createTableColumn,
  Badge,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
} from '@fluentui/react-components';
import {
  SettingsRegular,
  PlayRegular,
  PauseRegular,
  ArrowClockwiseRegular,
  MoreVerticalRegular,
} from '@fluentui/react-icons';
import { invoke } from '@tauri-apps/api/core';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    ...shorthands.gap(tokens.spacingVerticalM),
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
  },
  gridContainer: {
    height: '100%',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
  infoCard: {
    ...shorthands.padding(tokens.spacingVerticalL),
    marginBottom: tokens.spacingVerticalM,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    ...shorthands.gap(tokens.spacingVerticalM),
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
  },
});

interface ServiceInfo {
  name: string;
  display_name: string;
  status: string;
  startup_type?: string;
  description?: string;
}

interface SystemInfo {
  os_name: string;
  os_version: string;
  hostname: string;
  uptime_seconds: number;
  cpu_count: number;
  total_memory: number;
  available_memory: number;
}

export function SystemAdmin() {
  const styles = useStyles();
  const [selectedTab, setSelectedTab] = useState<'services' | 'system' | 'processes'>('services');
  const [loading, setLoading] = useState(false);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const loadServices = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<ServiceInfo[]>('get_services');
      setServices(data);
    } catch (err) {
      setError(err as string);
      console.error('Failed to load services:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSystemInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<SystemInfo>('get_system_info');
      setSystemInfo(data);
    } catch (err) {
      setError(err as string);
      console.error('Failed to load system info:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleServiceAction = async (serviceName: string, action: 'start' | 'stop' | 'restart') => {
    try {
      await invoke('service_action', { serviceName, action });
      await loadServices();
    } catch (err) {
      console.error(`Failed to ${action} service:`, err);
      setError(err as string);
    }
  };

  useEffect(() => {
    if (selectedTab === 'services') {
      loadServices();
    } else if (selectedTab === 'system') {
      loadSystemInfo();
    }
  }, [selectedTab]);

  const serviceColumns: TableColumnDefinition<ServiceInfo>[] = [
    createTableColumn<ServiceInfo>({
      columnId: 'name',
      renderHeaderCell: () => 'Service Name',
      renderCell: (item) => (
        <TableCellLayout>
          <div>
            <Text weight="semibold">{item.display_name}</Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {item.name}
            </Text>
          </div>
        </TableCellLayout>
      ),
    }),
    createTableColumn<ServiceInfo>({
      columnId: 'status',
      renderHeaderCell: () => 'Status',
      renderCell: (item) => (
        <TableCellLayout>
          <Badge
            appearance="filled"
            color={item.status === 'Running' ? 'success' : item.status === 'Stopped' ? 'danger' : 'warning'}
          >
            {item.status}
          </Badge>
        </TableCellLayout>
      ),
    }),
    createTableColumn<ServiceInfo>({
      columnId: 'startup',
      renderHeaderCell: () => 'Startup Type',
      renderCell: (item) => (
        <TableCellLayout>{item.startup_type || 'N/A'}</TableCellLayout>
      ),
    }),
    createTableColumn<ServiceInfo>({
      columnId: 'actions',
      renderHeaderCell: () => 'Actions',
      renderCell: (item) => (
        <TableCellLayout>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button icon={<MoreVerticalRegular />} appearance="subtle" size="small" />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem
                  icon={<PlayRegular />}
                  onClick={() => handleServiceAction(item.name, 'start')}
                  disabled={item.status === 'Running'}
                >
                  Start
                </MenuItem>
                <MenuItem
                  icon={<PauseRegular />}
                  onClick={() => handleServiceAction(item.name, 'stop')}
                  disabled={item.status === 'Stopped'}
                >
                  Stop
                </MenuItem>
                <MenuItem
                  icon={<ArrowClockwiseRegular />}
                  onClick={() => handleServiceAction(item.name, 'restart')}
                  disabled={item.status !== 'Running'}
                >
                  Restart
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </TableCellLayout>
      ),
    }),
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text size={500} weight="semibold">
          System Administration
        </Text>
        {selectedTab === 'services' && (
          <Button
            icon={<ArrowClockwiseRegular />}
            onClick={loadServices}
            disabled={loading}
          >
            Refresh
          </Button>
        )}
      </div>

      <TabList
        selectedValue={selectedTab}
        onTabSelect={(_, data) => setSelectedTab(data.value as any)}
      >
        <Tab value="services" icon={<SettingsRegular />}>Services</Tab>
        <Tab value="system">System Info</Tab>
        <Tab value="processes">Processes</Tab>
      </TabList>

      <div className={styles.content}>
        {error && (
          <Card style={{ marginBottom: tokens.spacingVerticalM }}>
            <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
              Error: {error}
            </Text>
          </Card>
        )}

        {selectedTab === 'services' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: tokens.spacingVerticalXXL }}>
                <Spinner label="Loading services..." />
              </div>
            ) : (
              <div className={styles.gridContainer}>
                <DataGrid
                  items={services}
                  columns={serviceColumns}
                  sortable
                  resizableColumns
                >
                  <DataGridHeader>
                    <DataGridRow>
                      {({ renderHeaderCell }) => (
                        <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                      )}
                    </DataGridRow>
                  </DataGridHeader>
                  <DataGridBody<ServiceInfo>>
                    {({ item, rowId }) => (
                      <DataGridRow<ServiceInfo> key={rowId}>
                        {({ renderCell }) => (
                          <DataGridCell>{renderCell(item)}</DataGridCell>
                        )}
                      </DataGridRow>
                    )}
                  </DataGridBody>
                </DataGrid>
              </div>
            )}
          </>
        )}

        {selectedTab === 'system' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: tokens.spacingVerticalXXL }}>
                <Spinner label="Loading system info..." />
              </div>
            ) : systemInfo ? (
              <Card className={styles.infoCard}>
                <Text size={400} weight="semibold" style={{ marginBottom: tokens.spacingVerticalL }}>
                  System Information
                </Text>
                <div className={styles.statsGrid}>
                  <div className={styles.statItem}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      Operating System
                    </Text>
                    <Text size={300} weight="semibold">
                      {systemInfo.os_name}
                    </Text>
                  </div>
                  <div className={styles.statItem}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      Version
                    </Text>
                    <Text size={300} weight="semibold">
                      {systemInfo.os_version}
                    </Text>
                  </div>
                  <div className={styles.statItem}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      Hostname
                    </Text>
                    <Text size={300} weight="semibold">
                      {systemInfo.hostname}
                    </Text>
                  </div>
                  <div className={styles.statItem}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      Uptime
                    </Text>
                    <Text size={300} weight="semibold">
                      {formatUptime(systemInfo.uptime_seconds)}
                    </Text>
                  </div>
                  <div className={styles.statItem}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      CPU Cores
                    </Text>
                    <Text size={300} weight="semibold">
                      {systemInfo.cpu_count}
                    </Text>
                  </div>
                  <div className={styles.statItem}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      Total Memory
                    </Text>
                    <Text size={300} weight="semibold">
                      {formatBytes(systemInfo.total_memory)}
                    </Text>
                  </div>
                  <div className={styles.statItem}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      Available Memory
                    </Text>
                    <Text size={300} weight="semibold">
                      {formatBytes(systemInfo.available_memory)}
                    </Text>
                  </div>
                  <div className={styles.statItem}>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      Memory Usage
                    </Text>
                    <Text size={300} weight="semibold">
                      {((1 - systemInfo.available_memory / systemInfo.total_memory) * 100).toFixed(1)}%
                    </Text>
                  </div>
                </div>
              </Card>
            ) : (
              <Card>
                <Button onClick={loadSystemInfo}>Load System Information</Button>
              </Card>
            )}
          </>
        )}

        {selectedTab === 'processes' && (
          <Card className={styles.infoCard}>
            <Text size={400} weight="semibold">
              Process Manager
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalM }}>
              Process management will be available here
            </Text>
          </Card>
        )}
      </div>
    </div>
  );
}
