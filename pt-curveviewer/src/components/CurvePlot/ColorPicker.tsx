// ============================================================
// ColorPicker — Modern color picker with palette + recent colors
// ============================================================

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import './ColorPicker.css';

// Predefined palette — vibrant, distinguishable colors for charts
const PALETTE = [
  '#ff6b6b', '#ee5a24', '#ff922b', '#ffd43b', '#a3d977',
  '#51cf66', '#20c997', '#22b8cf', '#339af0', '#5c7cfa',
  '#845ef7', '#cc5de8', '#f06595', '#ff8787', '#ffa94d',
  '#ffe066', '#8ce99a', '#63e6be', '#66d9e8', '#74c0fc',
  '#91a7ff', '#b197fc', '#e599f7', '#faa2c1', '#ffffff',
  '#ced4da', '#868e96', '#495057', '#212529', '#000000',
];

interface ColorPickerProps {
  currentColor: string;
  onColorChange: (color: string) => void;
  onClose: () => void;
  label?: string;
  anchorEl?: HTMLElement | null;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  currentColor,
  onColorChange,
  onClose,
  label,
  anchorEl,
}) => {
  const [hexInput, setHexInput] = useState(currentColor);
  const recentColors = useSettingsStore((s) => s.recentColors);
  const addRecentColor = useSettingsStore((s) => s.addRecentColor);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Position the popup near the anchor element
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const popupWidth = 260;
      const popupHeight = 320;
      let left = rect.right + 6;
      let top = rect.top;

      // Keep within viewport
      if (left + popupWidth > window.innerWidth) {
        left = rect.left - popupWidth - 6;
      }
      if (top + popupHeight > window.innerHeight) {
        top = Math.max(8, window.innerHeight - popupHeight - 8);
      }

      setPosition({ top, left });
    }
  }, [anchorEl]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay listener to avoid immediate closing from the click that opened it
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const selectColor = useCallback(
    (color: string) => {
      onColorChange(color);
      addRecentColor(color);
      setHexInput(color);
    },
    [onColorChange, addRecentColor],
  );

  const handleHexSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const cleaned = hexInput.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) {
        selectColor(cleaned);
      } else if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
        selectColor('#' + cleaned);
      }
    },
    [hexInput, selectColor],
  );

  return (
    <div
      ref={pickerRef}
      className="color-picker-popup"
      style={{ top: position.top, left: position.left }}
    >
      {label && <div className="cp-label">{label}</div>}

      {/* Current color preview */}
      <div className="cp-preview-row">
        <div className="cp-preview-swatch" style={{ background: currentColor }} />
        <span className="cp-preview-hex">{currentColor}</span>
      </div>

      {/* Palette grid */}
      <div className="cp-section-label">Palette</div>
      <div className="cp-palette">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`cp-swatch ${c === currentColor ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => selectColor(c)}
            title={c}
          />
        ))}
      </div>

      {/* Recent colors */}
      {recentColors.length > 0 && (
        <>
          <div className="cp-section-label">Recently Used</div>
          <div className="cp-recent">
            {recentColors.map((c, i) => (
              <button
                key={`${c}-${i}`}
                className={`cp-swatch ${c === currentColor ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => selectColor(c)}
                title={c}
              />
            ))}
          </div>
        </>
      )}

      {/* Hex input */}
      <div className="cp-section-label">Custom</div>
      <form className="cp-hex-form" onSubmit={handleHexSubmit}>
        <input
          type="color"
          className="cp-native-picker"
          value={hexInput.startsWith('#') ? hexInput : `#${hexInput}`}
          onChange={(e) => {
            setHexInput(e.target.value);
            selectColor(e.target.value);
          }}
        />
        <input
          className="cp-hex-input"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          placeholder="#ff6b6b"
          maxLength={7}
          spellCheck={false}
        />
        <button type="submit" className="cp-apply-btn" title="Apply">
          ✓
        </button>
      </form>
    </div>
  );
};
