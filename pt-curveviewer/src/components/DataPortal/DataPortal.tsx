// ============================================================
// Data Portal - Main container: left=filter+tree, right=import+groups
// ============================================================

import React from 'react';
import { FileImport } from './FileImport';
import { DataTreeView } from './DataTreeView';
import { GroupPanel } from './GroupPanel';
import './DataPortal.css';

export const DataPortal: React.FC = () => {
  return (
    <div className="data-portal">
      {/* Left column: filter + data tree */}
      <div className="dp-left">
        <DataTreeView />
      </div>

      {/* Right column: import (top) + groups (bottom) */}
      <div className="dp-right">
        <div className="dp-right-top">
          <FileImport />
        </div>
        <div className="dp-right-bottom">
          <GroupPanel />
        </div>
      </div>
    </div>
  );
};
