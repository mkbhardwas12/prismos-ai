// Patent Pending — PrismOS-AI (US Provisional Patent, Feb 2026)
// PrismOS-AI Custom Title Bar — Frameless window chrome
//
// Replaces native OS title bar with a sleek custom drag bar.
// Provides window controls (minimize, maximize, close) and app identity.

import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import prismosIcon from "../assets/prismos-icon.svg";
import "./TitleBar.css";

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    // Check initial state
    appWindow.isMaximized().then(setIsMaximized).catch(() => {});

    // Listen for resize events to track maximized state
    let unlisten: (() => void) | null = null;
    appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    }).then((fn) => { unlisten = fn; });

    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleMinimize = () => {
    getCurrentWindow().minimize().catch(() => {});
  };

  const handleMaximize = () => {
    const win = getCurrentWindow();
    win.toggleMaximize().catch(() => {});
  };

  const handleClose = () => {
    // Instead of closing, hide to system tray
    getCurrentWindow().hide().catch(() => {});
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      {/* App identity */}
      <div className="titlebar-brand" data-tauri-drag-region>
        <img src={prismosIcon} alt="" className="titlebar-icon" />
        <span className="titlebar-title" data-tauri-drag-region>PrismOS-AI</span>
        <span className="titlebar-version">v0.5.0</span>
      </div>

      {/* Spacer — entire bar is draggable */}
      <div className="titlebar-spacer" data-tauri-drag-region />

      {/* Window controls */}
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-minimize"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize window"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-maximize"
          onClick={handleMaximize}
          title={isMaximized ? "Restore" : "Maximize"}
          aria-label={isMaximized ? "Restore window" : "Maximize window"}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M2 0h6v2h2v6h-2v2H2V8H0V2h2V0zm1 1v1h5v5h1V1H3zm-2 3v5h5V4H1z" fill="currentColor" fillRule="evenodd" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0" y="0" width="10" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          className="titlebar-btn titlebar-close"
          onClick={handleClose}
          title="Minimize to tray"
          aria-label="Minimize to tray"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 0L5 4L9 0L10 1L6 5L10 9L9 10L5 6L1 10L0 9L4 5L0 1Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}
