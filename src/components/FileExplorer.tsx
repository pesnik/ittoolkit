'use client';

import * as React from 'react';
import {
    makeStyles,
    shorthands,
    Button,
    Input,
    Text,
    DataGrid,
    DataGridBody,
    DataGridRow,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridCell,
    TableCellLayout,
    TableColumnDefinition,
    createTableColumn,
    ProgressBar,
    Tooltip,
    SelectionItemId,
    Menu,
    MenuTrigger,
    MenuList,
    MenuItem,
    MenuPopover,
} from '@fluentui/react-components';
import {
    FolderRegular,
    DocumentRegular,
    ArrowUpRegular,
    ArrowLeftRegular,
    ArrowRightRegular,
    ArrowClockwiseRegular,
    OpenRegular,
    DeleteRegular,
    FolderOpenRegular,
} from '@fluentui/react-icons';
import { invoke } from '@tauri-apps/api/core';
import { FileNode } from '@/types';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        ...shorthands.gap('10px'),
        ...shorthands.padding('20px'),
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
    },
    pathBar: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('10px'),
        flexGrow: 1,
    },
    gridContainer: {
        flexGrow: 1,
        overflowY: 'auto',
        ...shorthands.border('1px', 'solid', '#333'),
        ...shorthands.borderRadius('4px'),
    },
    statusBar: {
        display: 'flex',
        justifyContent: 'space-between',
        paddingTop: '8px',
        borderTop: '1px solid #333',
    },
});

interface ExplorerState {
    path: string;
    loading: boolean;
    data: FileNode | null;
    history: string[];
    historyIndex: number;
    error: string | null;
}

export const FileExplorer = () => {
    const styles = useStyles();
    const [state, setState] = React.useState<ExplorerState>({
        path: 'C:\\',
        loading: false,
        data: null,
        history: ['C:\\'],
        historyIndex: 0,
        error: null,
    });

    const [inputPath, setInputPath] = React.useState(state.path);
    const [selectedItems, setSelectedItems] = React.useState<Set<SelectionItemId>>(new Set());

    // Context Menu State
    const [contextMenuOpen, setContextMenuOpen] = React.useState(false);
    const [contextMenuLocation, setContextMenuLocation] = React.useState({ x: 0, y: 0 });
    const [contextMenuItem, setContextMenuItem] = React.useState<FileNode | null>(null);

    // Compute the actually selected item object (only one supported for now)
    const selectedItem = React.useMemo(() => {
        if (selectedItems.size === 0) return null;
        const id = Array.from(selectedItems)[0];
        // We use path as ID
        return state.data?.children?.find(c => c.path === id) || null;
    }, [selectedItems, state.data]);

    const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const columns: TableColumnDefinition<FileNode>[] = [
        createTableColumn({
            columnId: 'file',
            compare: (a, b) => a.name.localeCompare(b.name),
            renderHeaderCell: () => 'Name',
            renderCell: (item) => (
                <TableCellLayout media={item.is_dir ? <FolderRegular /> : <DocumentRegular />}>
                    {item.name}
                </TableCellLayout>
            ),
        }),
        createTableColumn({
            columnId: 'size',
            compare: (a, b) => a.size - b.size,
            renderHeaderCell: () => 'Size',
            renderCell: (item) => formatSize(item.size),
        }),
        createTableColumn({
            columnId: 'count',
            compare: (a, b) => a.file_count - b.file_count,
            renderHeaderCell: () => 'Files',
            renderCell: (item) => item.is_dir ? item.file_count.toLocaleString() : '-',
        }),
        createTableColumn({
            columnId: 'modified',
            compare: (a, b) => a.last_modified - b.last_modified,
            renderHeaderCell: () => 'Modified',
            renderCell: (item) => new Date(item.last_modified * 1000).toLocaleString(),
        }),
    ];

    const fetchData = async (path: string, forceRefresh: boolean = false) => {
        setState(prev => ({ ...prev, loading: true, error: null }));
        try {
            const command = forceRefresh ? 'refresh_scan' : 'scan_dir';
            const data = await invoke<FileNode>(command, { path });
            setState(prev => ({ ...prev, loading: false, data, path }));
            setInputPath(path);
            setSelectedItems(new Set()); // Clear selection on navigate
        } catch (e: any) {
            setState(prev => ({ ...prev, loading: false, error: String(e) }));
        }
    };

    React.useEffect(() => {
        const initialPath = '/';
        setState(prev => ({
            ...prev,
            history: [initialPath],
            historyIndex: 0,
            path: initialPath,
            loading: true
        }));
        fetchData(initialPath);
    }, []);

    const handleNavigate = (newPath: string) => {
        if (newPath === state.path) return;

        const newHistory = state.history.slice(0, state.historyIndex + 1);
        newHistory.push(newPath);

        setState(prev => ({
            ...prev,
            history: newHistory,
            historyIndex: newHistory.length - 1,
        }));

        fetchData(newPath);
    };

    const handleBack = () => {
        if (state.historyIndex > 0) {
            const newIndex = state.historyIndex - 1;
            const prevPath = state.history[newIndex];
            setState(prev => ({ ...prev, historyIndex: newIndex }));
            fetchData(prevPath);
        }
    };

    const handleForward = () => {
        if (state.historyIndex < state.history.length - 1) {
            const newIndex = state.historyIndex + 1;
            const nextPath = state.history[newIndex];
            setState(prev => ({ ...prev, historyIndex: newIndex }));
            fetchData(nextPath);
        }
    };

    // Up one level logic
    const handleUp = () => {
        let separator = '/';
        if (state.path.includes('\\')) separator = '\\';

        // Handle root cases primarily for UNIX
        if (state.path === '/' || state.path === '\\') return;

        const parts = state.path.split(separator).filter(Boolean);
        if (parts.length > 0) {
            parts.pop();
            const parentPath = parts.length === 0 ? '/' : parts.join(separator);
            const finalPath = parentPath === '' ? '/' : (state.path.startsWith('/') ? '/' + parentPath : parentPath);
            handleNavigate(finalPath);
        }
    };

    const handleDelete = async (item: FileNode) => {
        if (!confirm(`Are you sure you want to delete ${item.name}?`)) return;
        try {
            await invoke('delete_item', { path: item.path });
            // Refresh current view
            fetchData(state.path, true);
        } catch (e) {
            alert(`Failed to delete: ${e}`);
        }
    };

    const handleOpenInExplorer = async (item: FileNode) => {
        try {
            await invoke('open_in_explorer', { path: item.path });
        } catch (e) {
            console.error(e);
        }
    };

    const items = state.data?.children || [];

    return (
        <div className={styles.container}>
            {/* Toolbar */}
            <div className={styles.toolbar}>
                <Tooltip content="Back" relationship="label">
                    <Button icon={<ArrowLeftRegular />} disabled={state.historyIndex <= 0} onClick={handleBack} />
                </Tooltip>
                <Tooltip content="Open Selected Folder" relationship="label">
                    <Button
                        icon={<ArrowRightRegular />}
                        disabled={!selectedItem || !selectedItem.is_dir}
                        onClick={() => selectedItem && handleNavigate(selectedItem.path)}
                    />
                </Tooltip>
                <Tooltip content="Up" relationship="label">
                    <Button icon={<ArrowUpRegular />} onClick={handleUp} />
                </Tooltip>
                <Tooltip content="Refresh" relationship="label">
                    <Button icon={<ArrowClockwiseRegular />} onClick={() => fetchData(state.path, true)} />
                </Tooltip>

                <div className={styles.pathBar}>
                    <Input
                        value={inputPath}
                        onChange={(e, data) => setInputPath(data.value)}
                        style={{ flexGrow: 1 }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleNavigate(inputPath);
                        }}
                    />
                    <Button appearance="primary" onClick={() => handleNavigate(inputPath)}>Go</Button>
                </div>
            </div>

            {state.loading && <ProgressBar />}
            {state.error && <Text style={{ color: 'red' }}>{state.error}</Text>}

            {/* Grid */}
            <div className={styles.gridContainer}>
                <DataGrid
                    items={items}
                    columns={columns}
                    sortable
                    selectionMode="single"
                    selectedItems={selectedItems}
                    onSelectionChange={(e, data) => setSelectedItems(data.selectedItems)}
                    getRowId={(item) => item.path}
                >
                    <DataGridHeader>
                        <DataGridRow>
                            {({ renderHeaderCell }) => (
                                <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                            )}
                        </DataGridRow>
                    </DataGridHeader>
                    <DataGridBody<FileNode>>
                        {({ item, rowId }) => (
                            <DataGridRow<FileNode>
                                key={rowId}
                                onContextMenu={(e: React.MouseEvent) => {
                                    e.preventDefault();
                                    setContextMenuItem(item);
                                    setContextMenuLocation({ x: e.clientX, y: e.clientY });
                                    setContextMenuOpen(true);
                                    setSelectedItems(new Set([item.path])); // Auto select on right click
                                }}
                                onDoubleClick={() => {
                                    if (item.is_dir) handleNavigate(item.path);
                                }}
                                onKeyDown={(e: React.KeyboardEvent) => {
                                    if ((e.key === 'Enter' || e.key === 'ArrowRight') && item.is_dir) {
                                        handleNavigate(item.path);
                                    }
                                }}
                            >
                                {({ renderCell }) => (
                                    <DataGridCell>{renderCell(item)}</DataGridCell>
                                )}
                            </DataGridRow>
                        )}
                    </DataGridBody>
                </DataGrid>

                {/* Context Menu */}
                <Menu
                    open={contextMenuOpen}
                    onOpenChange={(e, data) => setContextMenuOpen(data.open)}
                    positioning={{ target: { x: contextMenuLocation.x, y: contextMenuLocation.y } }}
                >
                    <MenuPopover>
                        <MenuList>
                            <MenuItem icon={<OpenRegular />} onClick={() => contextMenuItem && handleNavigate(contextMenuItem.path)} disabled={!contextMenuItem?.is_dir}>
                                Open
                            </MenuItem>
                            <MenuItem icon={<FolderOpenRegular />} onClick={() => contextMenuItem && handleOpenInExplorer(contextMenuItem)}>
                                Reveal in Explorer/Finder
                            </MenuItem>
                            <MenuItem icon={<DeleteRegular />} onClick={() => contextMenuItem && handleDelete(contextMenuItem)}>
                                Delete
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </div>

            {/* Status Bar */}
            <div className={styles.statusBar}>
                <Text>{items.length} items</Text>
                <Text>Total Size: {formatSize(state.data?.size || 0)}</Text>
            </div>
        </div>
    );
};
