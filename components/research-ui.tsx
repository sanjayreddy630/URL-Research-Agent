"use client";

import { useEffect, useState } from "react";
import {
  loadHistoryFromLocalStorage,
  deleteHistoryItem,
  clearAllHistory,
  type ResearchHistoryResponse,
} from "@/lib/research-history";

export interface SafetyBlockInfo {
  isBlocked: boolean;
  error: string;
  reason: string;
  url: string;
}

/**
 * SafetyBlockScreen Component
 * Displays when a URL is blocked due to safety issues
 */
export function SafetyBlockScreen({
  blockInfo,
  onRetry,
}: {
  blockInfo: SafetyBlockInfo;
  onRetry: () => void;
}) {
  return (
    <div className="safety-block-screen">
      <div className="safety-block-icon">🛡️</div>
      <div className="safety-block-content">
        <h2 className="safety-block-title">Analysis Unavailable</h2>
        <p className="safety-block-message">
          This URL cannot be processed because the source contains or appears to contain content
          that is not supported by this research platform.
        </p>
        <p className="safety-block-message" style={{ fontSize: "14px", opacity: 0.8 }}>
          The research system has blocked this URL for your safety and security.
        </p>
        <button className="safety-block-btn" onClick={onRetry}>
          Analyze Another URL
        </button>
      </div>
    </div>
  );
}

/**
 * ResearchHistoryPanel Component
 * Sidebar for viewing and managing research history
 */
export function ResearchHistoryPanel({
  isOpen,
  onClose,
  onSelectItem,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelectItem: (id: string) => void;
}) {
  const [history, setHistory] = useState<ResearchHistoryResponse[]>([]);

  useEffect(() => {
    if (isOpen) {
      const items = loadHistoryFromLocalStorage() as any[];
      setHistory(items.map(item => ({
        id: item.id,
        url: item.url,
        sourceType: item.sourceType,
        title: item.title,
        dateString: item.dateString,
        timestamp: item.timestamp,
      })));
    }
  }, [isOpen]);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteHistoryItem(id);
    setHistory(history.filter(item => item.id !== id));
  };

  const handleClearAll = () => {
    if (confirm("Are you sure you want to clear all research history?")) {
      clearAllHistory();
      setHistory([]);
    }
  };

  return (
    <div className={`history-panel ${isOpen ? "open" : ""}`}>
      <div className="history-panel-header">
        <h3 className="history-panel-title">Research History</h3>
        <button className="history-close-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="history-list">
        {history.length > 0 ? (
          history.map(item => (
            <div
              key={item.id}
              className="history-item"
              onClick={() => onSelectItem(item.id)}
            >
              <div className="history-item-title">{item.title}</div>
              <div className="history-item-date">{item.dateString}</div>
              <div
                className="history-item-delete"
                onClick={e => handleDelete(item.id, e)}
              >
                Delete
              </div>
            </div>
          ))
        ) : (
          <div className="history-empty">No research history yet</div>
        )}
      </div>

      {history.length > 0 && (
        <button className="history-clear-all-btn" onClick={handleClearAll}>
          Clear All History
        </button>
      )}
    </div>
  );
}

/**
 * MultiSourceInput Component
 * UI for adding and managing multiple URLs
 */
export function MultiSourceInput({
  onAnalyze,
  isAnalyzing,
}: {
  onAnalyze: (urls: string[]) => void;
  isAnalyzing: boolean;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");

  const handleAddUrl = () => {
    if (inputValue.trim() && urls.length < 5) {
      setUrls([...urls, inputValue.trim()]);
      setInputValue("");
    }
  };

  const handleRemoveUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  const handleAnalyze = () => {
    if (urls.length >= 2) {
      onAnalyze(urls);
    }
  };

  const canAddMore = urls.length < 5;
  const canAnalyze = urls.length >= 2;

  return (
    <div className="source-input-section">
      <div className="source-input-header">📚 Analyze Multiple Sources</div>

      <div className="source-input-form">
        <input
          type="url"
          className="source-input-field"
          placeholder="Enter URL (YouTube, articles, websites...)"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyPress={e => e.key === "Enter" && handleAddUrl()}
          disabled={!canAddMore || isAnalyzing}
        />
        <button
          className="source-add-btn"
          onClick={handleAddUrl}
          disabled={!canAddMore || !inputValue.trim() || isAnalyzing}
        >
          Add Source
        </button>
      </div>

      {urls.length > 0 && (
        <div className="sources-list">
          {urls.map((url, index) => (
            <div key={index} className="source-item">
              <div className="source-item-info">
                <div className="source-item-url">{url}</div>
                <div className="source-item-status">Source {index + 1}</div>
              </div>
              <button
                className="source-item-remove"
                onClick={() => handleRemoveUrl(index)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "12px" }}>
        <button
          className="multi-source-analyze-btn"
          onClick={handleAnalyze}
          disabled={!canAnalyze || isAnalyzing}
          style={{
            opacity: canAnalyze ? 1 : 0.5,
            cursor: canAnalyze && !isAnalyzing ? "pointer" : "not-allowed",
          }}
        >
          {isAnalyzing ? "Analyzing..." : `Analyze ${urls.length} Sources`}
        </button>
      </div>

      <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "8px" }}>
        Add 2-5 sources for comprehensive comparison • Supports YouTube, articles, and websites
      </div>
    </div>
  );
}
