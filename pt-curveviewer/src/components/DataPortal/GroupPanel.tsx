// ============================================================
// Group Panel — manages channel groups with activation toggle
// ============================================================

import React, { useState, useCallback } from 'react';
import { useFileStore } from '../../stores/fileStore';
import { useGroupStore } from '../../stores/groupStore';
import { intColorToHex } from '../../utils/colorConverter';
import type { ImportedFile, CurveChannel } from '../../types';
import './GroupPanel.css';

// ── Helpers ──────────────────────────────────────────────────

// ── Main Component ───────────────────────────────────────────
export const GroupPanel: React.FC = () => {
  const files = useFileStore((s) => s.files);
  const groups = useGroupStore((s) => s.groups);
  const createGroup = useGroupStore((s) => s.createGroup);
  const addChannelsToGroup = useGroupStore((s) => s.addChannelsToGroup);
  const removeGroup = useGroupStore((s) => s.removeGroup);
  const renameGroup = useGroupStore((s) => s.renameGroup);
  const removeChannelFromGroup = useGroupStore((s) => s.removeChannelFromGroup);
  const removeFileFromGroup = useGroupStore((s) => s.removeFileFromGroup);
  const clearGroups = useGroupStore((s) => s.clearGroups);
  const toggleGroupActive = useGroupStore((s) => s.toggleGroupActive);

  // collapse / expand
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // group rename
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // new group creation
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  // ── Toggle helpers ──
  const toggleGroup = useCallback((id: string) => {
    setExpandedGroups((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  // ── Group actions ──
  const handleCreateGroup = useCallback(() => {
    setNewGroupName(`Group ${groups.length + 1}`);
    setCreatingGroup(true);
  }, [groups.length]);

  const finishCreateGroup = useCallback(() => {
    const name = newGroupName.trim();
    if (name) {
      const id = createGroup(name);
      setExpandedGroups((p) => new Set(p).add(id));
    }
    setCreatingGroup(false);
    setNewGroupName('');
  }, [createGroup, newGroupName]);

  const cancelCreateGroup = useCallback(() => {
    setCreatingGroup(false);
    setNewGroupName('');
  }, []);

  // ── Rename ──
  const startRename = useCallback((gId: string, name: string) => {
    setEditingGroupId(gId);
    setEditName(name);
  }, []);
  const finishRename = useCallback(
    (gId: string) => { if (editName.trim()) renameGroup(gId, editName.trim()); setEditingGroupId(null); },
    [editName, renameGroup],
  );

  // ── Drag & drop ──
  const onGroupDrop = useCallback(
    (e: React.DragEvent, gId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const d = e.dataTransfer.getData('application/channels');
      if (d) { try { addChannelsToGroup(gId, JSON.parse(d)); } catch { /* noop */ } }
    },
    [addChannelsToGroup],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  // ── Render: channel row ──
  const renderChannel = (
    ch: CurveChannel,
    fId: string,
    inGroup: string,
  ) => {
    const color = intColorToHex(ch.lineColor);

    return (
      <div
        key={`${fId}-${ch.id}-${inGroup}`}
        className="gp-channel"
      >
        <span className="gp-color" style={{ background: color }} />
        <span className="gp-ch-name">{ch.description || ch.yName}</span>
        <span className="gp-ch-unit">{ch.yUnit ? `[${ch.yUnit}]` : ''}</span>
        {ch.noOfPoints > 0 && <span className="gp-ch-pts">{ch.noOfPoints} pts</span>}
        <button
          className="gp-x sm"
          title="Remove from group"
          onClick={(e) => { e.stopPropagation(); removeChannelFromGroup(inGroup, fId, ch.id); }}
        >✕</button>
      </div>
    );
  };

  // ── Render: group node ──
  const renderGroupNode = (group: typeof groups[0]) => {
    const isExp = expandedGroups.has(group.id);
    const fMap = new Map<string, { file: ImportedFile | undefined; chs: CurveChannel[] }>();
    for (const ref of group.channels) {
      if (!fMap.has(ref.fileId)) fMap.set(ref.fileId, { file: files.find((f) => f.id === ref.fileId), chs: [] });
      const e = fMap.get(ref.fileId)!;
      const ch = e.file?.curves.find((c) => c.id === ref.channelId);
      if (ch) e.chs.push(ch);
    }

    return (
      <div key={group.id} className={`gp-group${group.isActive ? '' : ' inactive'}`} onDrop={(e) => onGroupDrop(e, group.id)} onDragOver={onDragOver}>
        <div className="gp-group-row">
          {/* Activation checkbox */}
          <input
            type="checkbox"
            className="gp-cb"
            checked={group.isActive}
            onChange={() => toggleGroupActive(group.id)}
            onClick={(e) => e.stopPropagation()}
            title={group.isActive ? 'Deactivate group (hide in plot)' : 'Activate group (show in plot)'}
          />
          <span className={`gp-caret${isExp ? ' open' : ''}`} onClick={() => toggleGroup(group.id)}>▶</span>
          <span className="gp-group-icon">📁</span>
          {editingGroupId === group.id ? (
            <input
              className="gp-rename"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => finishRename(group.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') finishRename(group.id); if (e.key === 'Escape') setEditingGroupId(null); }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="gp-group-name" onClick={() => toggleGroup(group.id)} onDoubleClick={(e) => { e.stopPropagation(); startRename(group.id, group.name); }} title="Double-click to rename">
              {group.name}
            </span>
          )}
          <span className="gp-group-count">({group.channels.length})</span>
          <div className="gp-group-actions" onClick={(e) => e.stopPropagation()}>
            <button className="gp-icon-btn" title="Rename" onClick={() => startRename(group.id, group.name)}>✏️</button>
            <button className="gp-x" title="Delete group" onClick={() => removeGroup(group.id)}>✕</button>
          </div>
        </div>
        {isExp && (
          <div className="gp-group-children">
            {group.channels.length === 0 && <div className="gp-empty">Drag channels or files here</div>}
            {Array.from(fMap.entries()).map(([fId, { file, chs }]) => {
              if (!file) return null;
              return (
                <div key={fId} className="gp-gf-section">
                  <div className="gp-gf-label">
                    <span className="gp-gf-name">{file.filename}</span>
                    <button className="gp-x sm" title="Remove file from group" onClick={() => removeFileFromGroup(group.id, fId)}>✕</button>
                  </div>
                  {chs.map((c) => renderChannel(c, fId, group.id))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ──
  return (
    <div className="group-panel">
      <div className="gp-header">
        <span className="gp-title">Groups ({groups.length})</span>
        <div className="gp-header-actions">
          <button className="gp-btn-primary" onClick={handleCreateGroup}>+ New Group</button>
          {groups.length > 0 && (
            <button className="gp-btn-danger" onClick={() => { if (confirm('Delete all groups?')) clearGroups(); }}>🗑</button>
          )}
        </div>
      </div>
      {creatingGroup && (
        <div className="gp-inline-input">
          <input
            autoFocus
            className="gp-rename-input"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') finishCreateGroup(); if (e.key === 'Escape') cancelCreateGroup(); }}
            placeholder="Group name"
          />
          <button className="gp-inline-ok" onClick={finishCreateGroup} title="Create group (Enter)">OK</button>
          <button className="gp-inline-cancel" onClick={cancelCreateGroup} title="Cancel (Escape)">✕</button>
        </div>
      )}
      <div className="gp-list">
        {groups.length === 0 ? (
          <div className="gp-empty">No groups created. Create a group or select channels in the tree and assign them.</div>
        ) : (
          groups.map(renderGroupNode)
        )}
      </div>
    </div>
  );
};
