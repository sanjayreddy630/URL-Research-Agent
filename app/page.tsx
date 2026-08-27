"use client";

import { useEffect, useState } from "react";

const workflowSteps = [
  {
    number: "01",
    title: "Validate URL",
    description: "Verifying that the URL is public, valid, and safe.",
  },
  {
    number: "02",
    title: "Extracting Website Content",
    description: "Retrieving readable content from the provided URL.",
  },
  {
    number: "03",
    title: "Processing Extracted Content",
    description: "Preparing the extracted content for research.",
  },
  {
    number: "04",
    title: "Analyzing Content with AI",
    description: "Generating grounded findings from the source content.",
  },
  {
    number: "05",
    title: "Generate Report",
    description: "Preparing the final grounded research output.",
  },
  {
    number: "06",
    title: "Research Complete",
    description: "Your grounded research report is ready.",
  },
];

interface AnalysisResult {
  sourceType: string;
  title: string;
  extractedContent: string;
  contentSize: number;
  research?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function splitResearchSections(research: string) {
  const sections = research.split(/^###\s+\d+\.\s+/gm);

  return sections
    .slice(1)
    .map((section) => {
      const [heading, ...content] = section.split("\n");

      return {
        heading: heading.trim(),
        content: content.join("\n").trim(),
      };
    })
    .filter((section) => section.heading && section.content);
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showResults, setShowResults] = useState(false);

  const [analysisResult, setAnalysisResult] =
    useState<AnalysisResult | null>(null);

  const [error, setError] = useState("");
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [copiedItem, setCopiedItem] = useState("");

  const copyText = async (text: string, item: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItem(item);
      setTimeout(() => setCopiedItem(""), 1800);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  const handleAnalyze = async () => {
    if (!url.trim()) {
      alert("Please enter a public URL.");
      return;
    }

    setError("");
    setAnalysisResult(null);
    setShowResults(false);
    setCurrentStep(0);
    setIsAnalyzing(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Unable to analyze this URL."
        );
      }

      // Store real backend response
      setAnalysisResult({
        sourceType: data.sourceType || "Website",
        title: data.title || "Untitled Source",
        extractedContent: data.extractedContent || "",
        contentSize: data.contentSize || 0,
        research: data.research || "",
      });
      setChatMessages([]);
      setChatError("");

      // Mark all stages complete only after the API succeeds.
      setCurrentStep(workflowSteps.length);
    } catch (err) {
      setIsAnalyzing(false);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    }
  };

  const handleChatSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const question = chatQuestion.trim();

    if (!question || !analysisResult || isChatLoading) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: question,
    };
    const nextMessages = [...chatMessages, userMessage];

    setChatQuestion("");
    setChatMessages(nextMessages);
    setChatError("");
    setIsChatLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          extractedContent: analysisResult.extractedContent,
          research: analysisResult.research || "",
          sourceUrl: url,
          history: chatMessages,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to answer that question.");
      }

      setChatMessages([
        ...nextMessages,
        { role: "assistant", content: data.answer },
      ]);
    } catch (err) {
      setChatError(
        err instanceof Error
          ? err.message
          : "Unable to get an answer right now."
      );
    } finally {
      setIsChatLoading(false);
    }
  };

  // =========================
  // GENERATE PDF
  // =========================

  const generatePDF = async () => {
    try {
      if (!analysisResult) {
        alert("No research result available.");
        return;
      }

      const response = await fetch("/api/generate-pdf", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          url,

          research:
            analysisResult.research ||
            analysisResult.extractedContent,

          sourceType: analysisResult.sourceType,

          contentSize: `${analysisResult.contentSize} characters`,

          title: analysisResult.title,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate PDF");
      }

      const blob = await response.blob();

      const pdfUrl =
        window.URL.createObjectURL(blob);

      const link =
        document.createElement("a");

      link.href = pdfUrl;

      link.download = "research-report.pdf";

      document.body.appendChild(link);

      link.click();

      link.remove();

      window.URL.revokeObjectURL(pdfUrl);
    } catch (error) {
      console.error(error);

      alert("Failed to generate PDF");
    }
  };

  useEffect(() => {
    if (!isAnalyzing) return;

    if (analysisResult && currentStep >= workflowSteps.length) {
      const timer = setTimeout(() => {
        setIsAnalyzing(false);
        setShowResults(true);
      }, 1000);

      return () => clearTimeout(timer);
    }

    if (!analysisResult && currentStep >= workflowSteps.length - 1) {
      return;
    }

    const timer = setTimeout(() => {
      setCurrentStep((prev) => prev + 1);
    }, 900);

    return () => clearTimeout(timer);
  }, [isAnalyzing, currentStep, analysisResult]);

  const resetToHome = () => {
    setIsAnalyzing(false);
    setShowResults(false);
    setCurrentStep(0);
    setUrl("");
    setAnalysisResult(null);
    setChatMessages([]);
    setChatQuestion("");
    setChatError("");
    setCopiedItem("");
    setError("");
  };

  /* =========================
     RESULTS PAGE
  ========================= */

  if (showResults && analysisResult) {
    return (
      <main className="results-page">
        <nav className="processing-navbar">
          <div className="brand">
            <div className="brand-icon">◈</div>

            <div>
              <h1>URL Research Agent</h1>
              <p>Grounded AI Research Platform</p>
            </div>
          </div>

          <div className="results-status">
            <span className="status-dot"></span>
            Report Ready
          </div>
        </nav>

        <section className="results-container">
          <div className="results-header">
            <div>
              <span className="section-label">
                RESEARCH COMPLETE
              </span>

              <h2>Source extracted successfully.</h2>

              <p>
                The source has been processed and its content has been
                successfully extracted.
              </p>
            </div>

            {/* BUTTONS */}
            <div
              style={{
                display: "flex",
                gap: "12px",
                alignItems: "center",
              }}
            >
              <button
                className="new-analysis-button"
                type="button"
                onClick={() =>
                  copyText(analysisResult.research || "", "report")
                }
                disabled={!analysisResult.research}
              >
                {copiedItem === "report" ? "✓ Copied" : "⧉ Copy Report"}
              </button>

              <button
                className="new-analysis-button"
                onClick={generatePDF}
                type="button"
              >
                📄 Generate PDF
              </button>

              <button
                className="new-analysis-button"
                onClick={resetToHome}
              >
                ← New Analysis
              </button>
            </div>
          </div>

          <div className="analysis-status-grid" aria-label="Analysis status">
            <div className="analysis-status-item">
              <span className="status-icon">✓</span>
              <div>
                <span>ANALYSIS STATUS</span>
                <strong>Complete</strong>
              </div>
            </div>
            <div className="analysis-status-item">
              <span className="status-icon">◈</span>
              <div>
                <span>SOURCE TYPE</span>
                <strong>{analysisResult.sourceType}</strong>
              </div>
            </div>
            <div className="analysis-status-item">
              <span className="status-icon">#</span>
              <div>
                <span>CONTENT SIZE</span>
                <strong>{analysisResult.contentSize.toLocaleString()} characters</strong>
              </div>
            </div>
            <div className="analysis-status-item">
              <span className="status-icon">✓</span>
              <div>
                <span>RESEARCH STATUS</span>
                <strong>Grounded in source</strong>
              </div>
            </div>
          </div>

          <div className="results-layout">
            <div className="results-main">
              {/* SOURCE INFORMATION */}

              <div className="source-card">
            <div className="source-card-header">
              <span>SOURCE INFORMATION</span>

              <span className="source-verified">
                ● EXTRACTED
              </span>
            </div>

            <div className="source-info-grid">
              <div className="source-info-item">
                <span>URL</span>
                <p>{url}</p>
              </div>

              <div className="source-info-item">
                <span>SOURCE TYPE</span>

                <p>
                  {analysisResult.sourceType}
                </p>
              </div>

              <div className="source-info-item">
                <span>CONTENT SIZE</span>

                <p className="success-text">
                  {analysisResult.contentSize} characters
                </p>
              </div>
            </div>
              </div>

              <div className="result-section">
            <div className="result-section-header">
              <div>
                <span className="section-label">AI RESEARCH REPORT</span>
                <h3>Grounded research findings</h3>
              </div>

              <span className="grounded-badge">✓ SOURCE BASED</span>
            </div>

            <div className="research-sections">
              {splitResearchSections(analysisResult.research || "").length > 0 ? (
                splitResearchSections(analysisResult.research || "").map(
                  (section, index) => (
                    <details
                      className="research-section-card"
                      key={section.heading}
                      open={index === 0}
                    >
                      <summary>
                        <h4>{section.heading}</h4>
                        <span className="expand-icon">⌄</span>
                      </summary>
                      <p>{section.content}</p>
                    </details>
                  )
                )
              ) : (
                <div className="research-empty-state">
                  No structured research sections are available.
                </div>
              )}
            </div>
              </div>

              {/* GROUNDING & VERIFICATION */}

              <div className="verification-card">
            <div className="verification-icon">
              ✓
            </div>

            <div className="verification-content">
              <span className="section-label">
                GROUNDING & VERIFICATION
              </span>

              <h3>
                Research grounded in the extracted source
              </h3>

              <p>
                This research report is generated based on the content
                extracted from the provided source URL. The AI analysis is
                intended to remain grounded in the available source content.
              </p>

              <div className="verification-list">
                <div>
                  ✓ Source URL successfully processed: {url}
                </div>

                <div>
                  ✓ {analysisResult.contentSize.toLocaleString()} characters
                  extracted from the provided source
                </div>

                <div>
                  ✓ AI research generated using extracted source content
                </div>

                <div>
                  ✓ No external unsupported information should be included
                </div>
              </div>
            </div>
              </div>
            </div>

            <aside className="chat-panel">
              <div className="chat-panel-header">
                <div>
                  <span className="section-label">AI ASSISTANT</span>
                  <h3>ASK THE RESEARCH AGENT</h3>
                </div>
                <span className="chat-status-dot" aria-label="Assistant ready"></span>
              </div>

              <div className="chat-messages" aria-live="polite">
                {chatMessages.length === 0 && (
                  <div className="chat-empty-state">
                    Ask a question about this source or research report.
                  </div>
                )}

                {chatMessages.map((message, index) => (
                  <div
                    className={`chat-message ${message.role}`}
                    key={`${message.role}-${index}`}
                  >
                    <span className="chat-message-label">
                      {message.role === "user" ? "YOU" : "RESEARCH AGENT"}
                    </span>
                    <div className="chat-message-row">
                      <p>{message.content}</p>
                      {message.role === "assistant" && (
                        <button
                          type="button"
                          className="copy-answer-button"
                          onClick={() =>
                            copyText(message.content, `answer-${index}`)
                          }
                          aria-label="Copy answer"
                        >
                          {copiedItem === `answer-${index}` ? "✓" : "⧉"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {isChatLoading && (
                  <div className="chat-message assistant chat-loading">
                    <span className="chat-message-label">RESEARCH AGENT</span>
                    <p>Reviewing the analyzed source...</p>
                  </div>
                )}
              </div>

              {chatError && <p className="chat-error">{chatError}</p>}

              <form className="chat-form" onSubmit={handleChatSubmit}>
                <input
                  type="text"
                  value={chatQuestion}
                  onChange={(event) => setChatQuestion(event.target.value)}
                  placeholder="Ask about this research..."
                  aria-label="Ask the research agent"
                  disabled={isChatLoading}
                />
                <button
                  type="submit"
                  className="chat-send-button"
                  disabled={isChatLoading || !chatQuestion.trim()}
                >
                  {isChatLoading ? "..." : "Send"}
                </button>
              </form>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  /* =========================
     PROCESSING PAGE
  ========================= */

  if (isAnalyzing) {
    return (
      <main className="processing-page">
        <nav className="processing-navbar">
          <div className="brand">
            <div className="brand-icon">◈</div>

            <div>
              <h1>URL Research Agent</h1>
              <p>Agentic AI Processing</p>
            </div>
          </div>

          <div className="processing-status">
            <span className="processing-dot"></span>
            Processing
          </div>
        </nav>

        <section className="processing-container">
          <div className="processing-header">
            <div className="ai-loader">
              <div className="loader-ring"></div>
              <div className="loader-core">✦</div>
            </div>

            <span className="section-label">
              AGENT WORKFLOW ACTIVE
            </span>

            <h2>Analyzing your source</h2>

            <p>
              Our agent is validating and extracting real content
              from the provided URL.
            </p>
          </div>

          <div className="processing-url">
            <span>↗</span>
            <p>{url}</p>
          </div>

          <div className="progress-section">
            <div className="progress-header">
              <span>Processing Progress</span>

              <span>
                {Math.round(
                  (currentStep / workflowSteps.length) * 100
                )}
                %
              </span>
            </div>

            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${
                    (currentStep / workflowSteps.length) * 100
                  }%`,
                }}
              ></div>
            </div>
          </div>

          <div className="processing-workflow">
            {workflowSteps.map((step, index) => {
              const isCompleted = index < currentStep;
              const isActive = index === currentStep;
              const isPending = index > currentStep;

              return (
                <div
                  key={step.number}
                  className={`processing-step ${
                    isCompleted
                      ? "completed"
                      : isActive
                      ? "active"
                      : "pending"
                  }`}
                >
                  <div className="step-status">
                    {isCompleted ? "✓" : step.number}
                  </div>

                  <div className="processing-step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>

                  {isActive && (
                    <div className="active-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  )}

                  {isCompleted && (
                    <span className="completed-text">
                      Completed
                    </span>
                  )}

                  {isPending && (
                    <span className="waiting-text">
                      Waiting
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    );
  }

  /* =========================
     HOME PAGE
  ========================= */

  return (
    <main className="app-container">
      <nav className="navbar">
        <div className="nav-content">
          <div className="brand">
            <div className="brand-icon">◈</div>

            <div>
              <h1>URL Research Agent</h1>
              <p>Grounded AI Research Platform</p>
            </div>
          </div>

          <div className="nav-status">
            <span className="status-dot"></span>
            System Ready
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-badge">
          <span>✦</span>
          Agentic AI Research System
        </div>

        <h2>
          Turn Any Public URL Into
          <span> Reliable Knowledge.</span>
        </h2>

        <p className="hero-description">
          Analyze YouTube videos, articles, documentation,
          and public web content.
        </p>

        <div className="url-card">
          <div className="input-wrapper">
            <span className="link-icon">↗</span>

            <input
              type="url"
              placeholder="Paste a public URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />

            {url && (
              <button
                className="clear-button"
                onClick={() => setUrl("")}
                aria-label="Clear URL"
              >
                ×
              </button>
            )}
          </div>

          <button
            className="analyze-button"
            onClick={handleAnalyze}
          >
            <span>Analyze URL</span>
            <span className="arrow">→</span>
          </button>
        </div>

        {error && (
          <p
            style={{
              color: "#ff8a8a",
              marginTop: "16px",
            }}
          >
            {error}
          </p>
        )}

        <p className="input-info">
          Supports public YouTube videos, articles,
          documentation, and websites.
        </p>
      </section>

      <section className="metrics">
        <div className="metric">
          <strong>Grounded</strong>
          <span>Evidence-based outputs</span>
        </div>

        <div className="metric-divider"></div>

        <div className="metric">
          <strong>Agentic</strong>
          <span>Intelligent decision flow</span>
        </div>

        <div className="metric-divider"></div>

        <div className="metric">
          <strong>Verified</strong>
          <span>Reflection-based validation</span>
        </div>
      </section>

      <section className="workflow-section">
        <div className="section-header">
          <div>
            <span className="section-label">
              HOW IT WORKS
            </span>

            <h3>
              From URL to trusted insight.
            </h3>
          </div>

          <p>
            A structured agent workflow designed to reduce
            hallucination and keep results grounded in source evidence.
          </p>
        </div>

        <div className="workflow-grid">
          {workflowSteps.slice(0, 5).map((step) => (
            <div
              className="workflow-card"
              key={step.number}
            >
              <div className="step-top">
                <span className="step-number">
                  {step.number}
                </span>

                <span className="step-arrow">
                  ↗
                </span>
              </div>

              <h4>{step.title}</h4>

              <p>{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      <footer>
        <p>URL Research Agent</p>

        <span>
          Built for reliable AI-powered research
        </span>
      </footer>
    </main>
  );
}