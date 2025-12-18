'use client';

import React, { useState } from 'react';
import {
  Card,
  Text,
  Button,
  Input,
  makeStyles,
  shorthands,
  tokens,
  Spinner,
  TabList,
  Tab,
  Field,
  Textarea,
} from '@fluentui/react-components';
import {
  Wifi1Regular,
  PlayRegular,
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
  content: {
    flex: 1,
    overflowY: 'auto',
  },
  toolCard: {
    ...shorthands.padding(tokens.spacingVerticalL),
    marginBottom: tokens.spacingVerticalM,
  },
  inputGroup: {
    display: 'flex',
    ...shorthands.gap(tokens.spacingHorizontalM),
    marginBottom: tokens.spacingVerticalM,
  },
  resultBox: {
    marginTop: tokens.spacingVerticalM,
    ...shorthands.padding(tokens.spacingVerticalM),
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    fontFamily: 'monospace',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    maxHeight: '400px',
    overflowY: 'auto',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    ...shorthands.gap(tokens.spacingVerticalM),
    marginTop: tokens.spacingVerticalM,
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    ...shorthands.gap(tokens.spacingVerticalXS),
  },
});

interface PingResult {
  host: string;
  success: boolean;
  latency_ms?: number;
  error?: string;
}

interface NetworkInterface {
  name: string;
  ip_address?: string;
  mac_address?: string;
  is_up: boolean;
}

export function NetworkToolkit() {
  const styles = useStyles();
  const [selectedTab, setSelectedTab] = useState<'ping' | 'interfaces' | 'dns' | 'ports'>('ping');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');

  // Ping tool state
  const [pingHost, setPingHost] = useState('8.8.8.8');
  const [pingCount, setPingCount] = useState('4');

  // DNS tool state
  const [dnsHost, setDnsHost] = useState('');

  // Port scanner state
  const [portHost, setPortHost] = useState('localhost');
  const [portRange, setPortRange] = useState('80,443,3000,5432,3306');

  const handlePing = async () => {
    setLoading(true);
    setResult('');
    try {
      const count = parseInt(pingCount) || 4;
      const output = await invoke<string>('ping_host', {
        host: pingHost,
        count,
      });
      setResult(output);
    } catch (err) {
      setResult(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDnsLookup = async () => {
    setLoading(true);
    setResult('');
    try {
      const output = await invoke<string>('dns_lookup', {
        host: dnsHost,
      });
      setResult(output);
    } catch (err) {
      setResult(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePortScan = async () => {
    setLoading(true);
    setResult('');
    try {
      const ports = portRange.split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p));
      const output = await invoke<string>('scan_ports', {
        host: portHost,
        ports,
      });
      setResult(output);
    } catch (err) {
      setResult(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const loadNetworkInterfaces = async () => {
    setLoading(true);
    setResult('');
    try {
      const interfaces = await invoke<NetworkInterface[]>('get_network_interfaces');
      const output = interfaces.map(iface =>
        `${iface.name}\n` +
        `  IP: ${iface.ip_address || 'N/A'}\n` +
        `  MAC: ${iface.mac_address || 'N/A'}\n` +
        `  Status: ${iface.is_up ? 'UP' : 'DOWN'}\n`
      ).join('\n');
      setResult(output);
    } catch (err) {
      setResult(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <Text size={500} weight="semibold">
        Network Toolkit
      </Text>

      <TabList
        selectedValue={selectedTab}
        onTabSelect={(_, data) => setSelectedTab(data.value as any)}
      >
        <Tab value="ping" icon={<Wifi1Regular />}>Ping</Tab>
        <Tab value="interfaces">Interfaces</Tab>
        <Tab value="dns">DNS Lookup</Tab>
        <Tab value="ports">Port Scanner</Tab>
      </TabList>

      <div className={styles.content}>
        {selectedTab === 'ping' && (
          <Card className={styles.toolCard}>
            <Text size={400} weight="semibold" style={{ marginBottom: tokens.spacingVerticalM }}>
              Ping Test
            </Text>

            <div className={styles.inputGroup}>
              <Field label="Host" style={{ flex: 1 }}>
                <Input
                  value={pingHost}
                  onChange={(e) => setPingHost(e.target.value)}
                  placeholder="Enter IP or hostname"
                />
              </Field>
              <Field label="Count" style={{ width: '100px' }}>
                <Input
                  type="number"
                  value={pingCount}
                  onChange={(e) => setPingCount(e.target.value)}
                  min="1"
                  max="100"
                />
              </Field>
              <div style={{ alignSelf: 'flex-end' }}>
                <Button
                  appearance="primary"
                  icon={<PlayRegular />}
                  onClick={handlePing}
                  disabled={loading || !pingHost}
                >
                  Ping
                </Button>
              </div>
            </div>

            {loading && <Spinner label="Pinging..." />}
            {result && (
              <div className={styles.resultBox}>
                {result}
              </div>
            )}
          </Card>
        )}

        {selectedTab === 'interfaces' && (
          <Card className={styles.toolCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: tokens.spacingVerticalM }}>
              <Text size={400} weight="semibold">
                Network Interfaces
              </Text>
              <Button
                icon={<PlayRegular />}
                onClick={loadNetworkInterfaces}
                disabled={loading}
              >
                Load Interfaces
              </Button>
            </div>

            {loading && <Spinner label="Loading interfaces..." />}
            {result && (
              <div className={styles.resultBox}>
                {result}
              </div>
            )}
          </Card>
        )}

        {selectedTab === 'dns' && (
          <Card className={styles.toolCard}>
            <Text size={400} weight="semibold" style={{ marginBottom: tokens.spacingVerticalM }}>
              DNS Lookup
            </Text>

            <div className={styles.inputGroup}>
              <Field label="Domain" style={{ flex: 1 }}>
                <Input
                  value={dnsHost}
                  onChange={(e) => setDnsHost(e.target.value)}
                  placeholder="example.com"
                />
              </Field>
              <div style={{ alignSelf: 'flex-end' }}>
                <Button
                  appearance="primary"
                  icon={<PlayRegular />}
                  onClick={handleDnsLookup}
                  disabled={loading || !dnsHost}
                >
                  Lookup
                </Button>
              </div>
            </div>

            {loading && <Spinner label="Resolving..." />}
            {result && (
              <div className={styles.resultBox}>
                {result}
              </div>
            )}
          </Card>
        )}

        {selectedTab === 'ports' && (
          <Card className={styles.toolCard}>
            <Text size={400} weight="semibold" style={{ marginBottom: tokens.spacingVerticalM }}>
              Port Scanner
            </Text>

            <div className={styles.inputGroup}>
              <Field label="Host" style={{ flex: 1 }}>
                <Input
                  value={portHost}
                  onChange={(e) => setPortHost(e.target.value)}
                  placeholder="localhost"
                />
              </Field>
            </div>

            <Field label="Ports (comma-separated)" style={{ marginBottom: tokens.spacingVerticalM }}>
              <Input
                value={portRange}
                onChange={(e) => setPortRange(e.target.value)}
                placeholder="80,443,3000,5432"
              />
            </Field>

            <Button
              appearance="primary"
              icon={<PlayRegular />}
              onClick={handlePortScan}
              disabled={loading || !portHost}
            >
              Scan Ports
            </Button>

            {loading && <Spinner label="Scanning ports..." style={{ marginTop: tokens.spacingVerticalM }} />}
            {result && (
              <div className={styles.resultBox}>
                {result}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
