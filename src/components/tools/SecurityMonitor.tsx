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
  Input,
  Field,
  Badge,
  DataGrid,
  DataGridBody,
  DataGridRow,
  DataGridHeader,
  DataGridHeaderCell,
  DataGridCell,
  TableCellLayout,
  TableColumnDefinition,
  createTableColumn,
} from '@fluentui/react-components';
import {
  ShieldRegular,
  ArrowClockwiseRegular,
  SearchRegular,
  DismissRegular,
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
  searchBar: {
    marginBottom: tokens.spacingVerticalM,
  },
  logContainer: {
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    height: '500px',
    overflowY: 'auto',
  },
  logEntry: {
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke2),
    fontFamily: 'monospace',
    fontSize: '12px',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground3,
    },
  },
  gridContainer: {
    height: '500px',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
  statsCard: {
    ...shorthands.padding(tokens.spacingVerticalL),
    marginBottom: tokens.spacingVerticalM,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    ...shorthands.gap(tokens.spacingVerticalM),
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
  },
});

interface ProcessInfo {
  pid: number;
  name: string;
  cpu_usage: number;
  memory_usage: number;
  status: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

interface PortInfo {
  port: number;
  protocol: string;
  process_name: string;
  pid: number;
}

export function SecurityMonitor() {
  const styles = useStyles();
  const [selectedTab, setSelectedTab] = useState<'processes' | 'logs' | 'ports' | 'firewall'>('processes');
  const [loading, setLoading] = useState(false);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadProcesses = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<ProcessInfo[]>('get_process_list');
      setProcesses(data);
    } catch (err) {
      setError(err as string);
      console.error('Failed to load processes:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSecurityLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<LogEntry[]>('get_security_logs');
      setLogs(data);
    } catch (err) {
      setError(err as string);
      console.error('Failed to load logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadOpenPorts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<PortInfo[]>('get_open_ports');
      setPorts(data);
    } catch (err) {
      setError(err as string);
      console.error('Failed to load ports:', err);
    } finally {
      setLoading(false);
    }
  };

  const killProcess = async (pid: number) => {
    try {
      await invoke('kill_process', { pid });
      await loadProcesses();
    } catch (err) {
      setError(err as string);
      console.error('Failed to kill process:', err);
    }
  };

  useEffect(() => {
    if (selectedTab === 'processes') {
      loadProcesses();
    } else if (selectedTab === 'logs') {
      loadSecurityLogs();
    } else if (selectedTab === 'ports') {
      loadOpenPorts();
    }
  }, [selectedTab]);

  const filteredProcesses = processes.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.pid.toString().includes(searchTerm)
  );

  const processColumns: TableColumnDefinition<ProcessInfo>[] = [
    createTableColumn<ProcessInfo>({
      columnId: 'pid',
      renderHeaderCell: () => 'PID',
      renderCell: (item) => <TableCellLayout>{item.pid}</TableCellLayout>,
    }),
    createTableColumn<ProcessInfo>({
      columnId: 'name',
      renderHeaderCell: () => 'Process Name',
      renderCell: (item) => <TableCellLayout>{item.name}</TableCellLayout>,
    }),
    createTableColumn<ProcessInfo>({
      columnId: 'cpu',
      renderHeaderCell: () => 'CPU %',
      renderCell: (item) => <TableCellLayout>{item.cpu_usage.toFixed(2)}%</TableCellLayout>,
    }),
    createTableColumn<ProcessInfo>({
      columnId: 'memory',
      renderHeaderCell: () => 'Memory (MB)',
      renderCell: (item) => <TableCellLayout>{(item.memory_usage / 1024 / 1024).toFixed(2)}</TableCellLayout>,
    }),
    createTableColumn<ProcessInfo>({
      columnId: 'status',
      renderHeaderCell: () => 'Status',
      renderCell: (item) => (
        <TableCellLayout>
          <Badge appearance="filled" color={item.status === 'Running' ? 'success' : 'warning'}>
            {item.status}
          </Badge>
        </TableCellLayout>
      ),
    }),
    createTableColumn<ProcessInfo>({
      columnId: 'actions',
      renderHeaderCell: () => 'Actions',
      renderCell: (item) => (
        <TableCellLayout>
          <Button
            size="small"
            appearance="subtle"
            icon={<DismissRegular />}
            onClick={() => killProcess(item.pid)}
          >
            Kill
          </Button>
        </TableCellLayout>
      ),
    }),
  ];

  const portColumns: TableColumnDefinition<PortInfo>[] = [
    createTableColumn<PortInfo>({
      columnId: 'port',
      renderHeaderCell: () => 'Port',
      renderCell: (item) => <TableCellLayout>{item.port}</TableCellLayout>,
    }),
    createTableColumn<PortInfo>({
      columnId: 'protocol',
      renderHeaderCell: () => 'Protocol',
      renderCell: (item) => <TableCellLayout>{item.protocol}</TableCellLayout>,
    }),
    createTableColumn<PortInfo>({
      columnId: 'process',
      renderHeaderCell: () => 'Process',
      renderCell: (item) => <TableCellLayout>{item.process_name}</TableCellLayout>,
    }),
    createTableColumn<PortInfo>({
      columnId: 'pid',
      renderHeaderCell: () => 'PID',
      renderCell: (item) => <TableCellLayout>{item.pid}</TableCellLayout>,
    }),
  ];

  const getLogLevelColor = (level: string): 'danger' | 'warning' | 'informative' | 'success' => {
    switch (level.toLowerCase()) {
      case 'error':
      case 'critical':
        return 'danger';
      case 'warning':
        return 'warning';
      case 'info':
        return 'informative';
      default:
        return 'success';
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text size={500} weight="semibold">
          Security & Monitoring
        </Text>
        <Button
          icon={<ArrowClockwiseRegular />}
          onClick={() => {
            if (selectedTab === 'processes') loadProcesses();
            else if (selectedTab === 'logs') loadSecurityLogs();
            else if (selectedTab === 'ports') loadOpenPorts();
          }}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      <TabList
        selectedValue={selectedTab}
        onTabSelect={(_, data) => setSelectedTab(data.value as any)}
      >
        <Tab value="processes" icon={<ShieldRegular />}>Processes</Tab>
        <Tab value="logs">Security Logs</Tab>
        <Tab value="ports">Open Ports</Tab>
        <Tab value="firewall">Firewall</Tab>
      </TabList>

      <div className={styles.content}>
        {error && (
          <Card style={{ marginBottom: tokens.spacingVerticalM }}>
            <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
              Error: {error}
            </Text>
          </Card>
        )}

        {selectedTab === 'processes' && (
          <>
            <Field className={styles.searchBar}>
              <Input
                placeholder="Search processes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                contentBefore={<SearchRegular />}
              />
            </Field>

            {loading ? (
              <div style={{ textAlign: 'center', padding: tokens.spacingVerticalXXL }}>
                <Spinner label="Loading processes..." />
              </div>
            ) : (
              <div className={styles.gridContainer}>
                <DataGrid
                  items={filteredProcesses}
                  columns={processColumns}
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
                  <DataGridBody<ProcessInfo>>
                    {({ item, rowId }) => (
                      <DataGridRow<ProcessInfo> key={rowId}>
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

        {selectedTab === 'logs' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: tokens.spacingVerticalXXL }}>
                <Spinner label="Loading logs..." />
              </div>
            ) : (
              <div className={styles.logContainer}>
                {logs.length === 0 ? (
                  <div style={{ padding: tokens.spacingVerticalL, textAlign: 'center' }}>
                    <Text>No security logs available</Text>
                  </div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className={styles.logEntry}>
                      <Badge appearance="filled" color={getLogLevelColor(log.level)} size="small">
                        {log.level}
                      </Badge>
                      {' '}
                      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        [{log.timestamp}]
                      </Text>
                      {' '}
                      <Text size={200} weight="semibold">
                        {log.source}:
                      </Text>
                      {' '}
                      {log.message}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {selectedTab === 'ports' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: tokens.spacingVerticalXXL }}>
                <Spinner label="Scanning ports..." />
              </div>
            ) : (
              <div className={styles.gridContainer}>
                <DataGrid
                  items={ports}
                  columns={portColumns}
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
                  <DataGridBody<PortInfo>>
                    {({ item, rowId }) => (
                      <DataGridRow<PortInfo> key={rowId}>
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

        {selectedTab === 'firewall' && (
          <Card className={styles.statsCard}>
            <Text size={400} weight="semibold">
              Firewall Status
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalM }}>
              Firewall management will be available here
            </Text>
          </Card>
        )}
      </div>
    </div>
  );
}
