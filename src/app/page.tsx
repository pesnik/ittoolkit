'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { FileSystemContext, FileMetadata } from '@/types/ai-types';
import { FileExplorer } from '@/components/FileExplorer';
import { AIPanel } from '@/components/AIPanel';
import { BrowserView } from '@/components/BrowserView';
import { WorkflowsPanel } from '@/components/WorkflowsPanel';
import { featureFlags } from '@/lib/featureFlags';
import { makeStyles, shorthands, tokens, Tab, TabList, type SelectTabEvent, type SelectTabData } from '@fluentui/react-components';

type Workspace = 'files' | 'browser' | 'workflows';

const useStyles = makeStyles({
  container: {
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    background: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    display: 'flex',
    position: 'relative',
  },
  explorerContainer: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  workspaceTabs: {
    flexShrink: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: '12px',
    paddingRight: '12px',
    background: tokens.colorNeutralBackground1,
  },
  workspaceBody: {
    flex: 1,
    minHeight: '0px',
    overflow: 'hidden',
  },
  aiPanelContainer: {
    height: '100%',
    transition: 'width 0.2s ease, opacity 0.2s ease', // Smooth open/close, immediate resize via state
    overflow: 'hidden',
    ...shorthands.borderLeft('1px', 'solid', tokens.colorNeutralStroke1),
    background: tokens.colorNeutralBackground1,
  },
  resizeHandle: {
    width: '4px',
    cursor: 'col-resize',
    height: '100%',
    background: 'transparent',
    transition: 'background 0.2s',
    zIndex: 100,
    position: 'relative',
    marginRight: '-2px',
    marginLeft: '-2px',
    flexShrink: 0, // Prevent handle from shrinking
    ':hover': {
      background: tokens.colorBrandBackground,
    },
  },
});

export default function Home() {
  const styles = useStyles();
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const [isManualResize, setIsManualResize] = useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // AI Context State
  const [fsContext, setFsContext] = useState<FileSystemContext | undefined>(undefined);
  const [aiPanelPrefill, setAiPanelPrefill] = useState<string>('');

  // Main-pane workspace switch — appears only when the browser-use harness
  // is enabled (browserAgent flag). Files remains the default.
  const [workspace, setWorkspace] = useState<Workspace>('files');
  const showWorkspaceTabs = featureFlags.browserAgent;

  // Auto-switch to BrowserView when a browser_observe event arrives, so the
  // user sees the page state without manually clicking the tab.
  useEffect(() => {
    if (!showWorkspaceTabs) return;
    const handler = () => {
      setWorkspace((w) => (w === 'files' ? 'browser' : w));
    };
    window.addEventListener('browser-view-update', handler as EventListener);
    return () => window.removeEventListener('browser-view-update', handler as EventListener);
  }, [showWorkspaceTabs]);

  const onWorkspaceChange = useCallback((_e: SelectTabEvent, data: SelectTabData) => {
    setWorkspace(data.value as Workspace);
  }, []);

  const startResizing = React.useCallback(() => {
    if (panelRef.current) {
      setPanelWidth(panelRef.current.clientWidth);
    }
    setIsResizing(true);
    // Don't set manual resize immediately to avoid jump if just clicking without dragging?
    // Actually we need it true so width switches to px mode.
    // By setting panelWidth to current clientWidth first, the switch should be seamless.
    setIsManualResize(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = window.innerWidth - mouseMoveEvent.clientX;
        if (newWidth > 300 && newWidth < 800) {
          setPanelWidth(newWidth);
        }
      }
    },
    [isResizing]
  );

  const handleContextChange = React.useCallback((path: string, selectedItems: string[], visibleFiles?: FileMetadata[]) => {
    setFsContext({
      currentPath: path,
      selectedPaths: selectedItems,
      visibleFiles: visibleFiles,
    });
  }, []);

  const handleAskAgent = useCallback((selectedPaths: string[], currentPath: string) => {
    const paths = selectedPaths.map(p => `${currentPath}/${p}`).join('\n');
    setAiPanelPrefill(paths);
    if (!isAIPanelOpen) {
      setIsAIPanelOpen(true);
    }
  }, [isAIPanelOpen]);

  const toggleAIPanel = () => {
    const newState = !isAIPanelOpen;
    setIsAIPanelOpen(newState);
    if (!newState) {
      // Reset manual resize when closing, so next open is "optimal" again
      setIsManualResize(false);
    }
  };

  React.useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  return (
    <main className={styles.container}>
      <div className={styles.explorerContainer}>
        {showWorkspaceTabs && (
          <TabList
            className={styles.workspaceTabs}
            selectedValue={workspace}
            onTabSelect={onWorkspaceChange}
          >
            <Tab value="files">Files</Tab>
            <Tab value="browser">Browser</Tab>
            <Tab value="workflows">Workflows</Tab>
          </TabList>
        )}
        <div className={styles.workspaceBody}>
          {workspace === 'files' && (
            <FileExplorer
              onToggleAI={toggleAIPanel}
              isAIPanelOpen={isAIPanelOpen}
              onContextChange={handleContextChange}
              onAskAgent={handleAskAgent}
            />
          )}
          {workspace === 'browser' && <BrowserView />}
          {workspace === 'workflows' && <WorkflowsPanel />}
        </div>
      </div>

      {isAIPanelOpen && (
        <div
          className={styles.resizeHandle}
          onMouseDown={startResizing}
        />
      )}

      <div
        ref={panelRef}
        className={styles.aiPanelContainer}
        style={{
          width: isAIPanelOpen
            ? (isManualResize ? `${panelWidth}px` : '45vw')
            : '0px',
          minWidth: isAIPanelOpen ? 'auto' : '0px',
          maxWidth: isAIPanelOpen ? '70vw' : '0px',
          opacity: isAIPanelOpen ? 1 : 0,
          pointerEvents: isAIPanelOpen ? 'auto' : 'none',
        }}
      >
        <AIPanel
          isOpen={isAIPanelOpen}
          onClose={toggleAIPanel}
          fsContext={fsContext}
          prefillInput={aiPanelPrefill}
        />
      </div>
    </main>
  );
}
