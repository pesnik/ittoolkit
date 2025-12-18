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
  ProgressBar,
  TabList,
  Tab,
} from '@fluentui/react-components';
import {
  HardDriveRegular,
  ArrowClockwiseRegular,
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
    ...shorthands.gap(tokens.spacingVerticalM),
    display: 'flex',
    flexDirection: 'column',
  },
  diskCard: {
    ...shorthands.padding(tokens.spacingVerticalL),
  },
  diskHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalM,
  },
  diskInfo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    ...shorthands.gap(tokens.spacingVerticalM),
    marginTop: tokens.spacingVerticalM,
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
  },
  partitionList: {
    marginTop: tokens.spacingVerticalL,
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalS),
  },
  partition: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.padding(tokens.spacingVerticalS, tokens.spacingHorizontalM),
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    ...shorthands.gap(tokens.spacingHorizontalM),
  },
  partitionBar: {
    flex: 1,
    height: '8px',
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.borderRadius(tokens.borderRadiusSmall),
    overflow: 'hidden',
  },
  partitionFill: {
    height: '100%',
    backgroundColor: tokens.colorBrandBackground,
  },
  healthGood: {
    color: tokens.colorPaletteGreenForeground1,
  },
  healthWarning: {
    color: tokens.colorPaletteYellowForeground1,
  },
  healthBad: {
    color: tokens.colorPaletteRedForeground1,
  },
});

interface DiskInfo {
  name: string;
  size: number;
  used: number;
  available: number;
  mount_point?: string;
  file_system?: string;
  disk_type?: string;
  removable: boolean;
}

interface PartitionInfo {
  name: string;
  mount_point?: string;
  file_system?: string;
  total_space: number;
  used_space: number;
  available_space: number;
}

interface SmartInfo {
  temperature?: number;
  power_on_hours?: number;
  power_cycle_count?: number;
  health_status: string;
}

export function DiskManager() {
  const styles = useStyles();
  const [loading, setLoading] = useState(false);
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'partitions' | 'smart'>('overview');
  const [error, setError] = useState<string | null>(null);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const loadDiskInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const diskData = await invoke<DiskInfo[]>('get_disk_info');
      setDisks(diskData);
    } catch (err) {
      setError(err as string);
      console.error('Failed to load disk info:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDiskInfo();
  }, []);

  const getUsagePercentage = (used: number, total: number): number => {
    return total > 0 ? (used / total) * 100 : 0;
  };

  const getHealthColor = (percentage: number): string => {
    if (percentage < 70) return styles.healthGood;
    if (percentage < 90) return styles.healthWarning;
    return styles.healthBad;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Text size={500} weight="semibold">
          Disk Manager
        </Text>
        <Button
          icon={<ArrowClockwiseRegular />}
          onClick={loadDiskInfo}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      <TabList
        selectedValue={selectedTab}
        onTabSelect={(_, data) => setSelectedTab(data.value as any)}
      >
        <Tab value="overview">Overview</Tab>
        <Tab value="partitions">Partitions</Tab>
        <Tab value="smart">SMART Data</Tab>
      </TabList>

      <div className={styles.content}>
        {loading && (
          <div style={{ textAlign: 'center', padding: tokens.spacingVerticalXXL }}>
            <Spinner label="Loading disk information..." />
          </div>
        )}

        {error && (
          <Card>
            <Text style={{ color: tokens.colorPaletteRedForeground1 }}>
              Error: {error}
            </Text>
          </Card>
        )}

        {!loading && !error && selectedTab === 'overview' && (
          <>
            {disks.length === 0 ? (
              <Card>
                <Text>No disks found</Text>
              </Card>
            ) : (
              disks.map((disk, idx) => {
                const usagePercent = getUsagePercentage(disk.used, disk.size);
                return (
                  <Card key={idx} className={styles.diskCard}>
                    <div className={styles.diskHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM }}>
                        <HardDriveRegular style={{ fontSize: '24px' }} />
                        <div>
                          <Text size={400} weight="semibold">
                            {disk.name}
                          </Text>
                          {disk.mount_point && (
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                              {disk.mount_point}
                            </Text>
                          )}
                        </div>
                      </div>
                      <Text
                        size={300}
                        className={getHealthColor(usagePercent)}
                        weight="semibold"
                      >
                        {usagePercent.toFixed(1)}% Used
                      </Text>
                    </div>

                    <div>
                      <div style={{ marginBottom: tokens.spacingVerticalXS }}>
                        <Text size={200}>
                          {formatBytes(disk.used)} / {formatBytes(disk.size)}
                        </Text>
                      </div>
                      <ProgressBar
                        value={usagePercent / 100}
                        color={usagePercent > 90 ? 'error' : usagePercent > 70 ? 'warning' : 'success'}
                      />
                    </div>

                    <div className={styles.diskInfo}>
                      <div className={styles.infoItem}>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          Total Size
                        </Text>
                        <Text size={300} weight="semibold">
                          {formatBytes(disk.size)}
                        </Text>
                      </div>
                      <div className={styles.infoItem}>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          Used Space
                        </Text>
                        <Text size={300} weight="semibold">
                          {formatBytes(disk.used)}
                        </Text>
                      </div>
                      <div className={styles.infoItem}>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                          Available
                        </Text>
                        <Text size={300} weight="semibold">
                          {formatBytes(disk.available)}
                        </Text>
                      </div>
                      {disk.file_system && (
                        <div className={styles.infoItem}>
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            File System
                          </Text>
                          <Text size={300} weight="semibold">
                            {disk.file_system}
                          </Text>
                        </div>
                      )}
                      {disk.disk_type && (
                        <div className={styles.infoItem}>
                          <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            Type
                          </Text>
                          <Text size={300} weight="semibold">
                            {disk.disk_type} {disk.removable ? '(Removable)' : ''}
                          </Text>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })
            )}
          </>
        )}

        {!loading && !error && selectedTab === 'partitions' && (
          <Card className={styles.diskCard}>
            <Text size={400} weight="semibold" style={{ marginBottom: tokens.spacingVerticalM }}>
              Partition Layout
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Detailed partition information will be displayed here
            </Text>
          </Card>
        )}

        {!loading && !error && selectedTab === 'smart' && (
          <Card className={styles.diskCard}>
            <Text size={400} weight="semibold" style={{ marginBottom: tokens.spacingVerticalM }}>
              SMART Health Data
            </Text>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              SMART monitoring requires elevated permissions
            </Text>
          </Card>
        )}
      </div>
    </div>
  );
}
