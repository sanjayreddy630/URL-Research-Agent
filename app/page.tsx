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

const youtubeWorkflowSteps = [
  {
    number: "01",
    title: "Validating YouTube URL",
    description: "Checking the submitted YouTube video URL.",
  },
  {
    number: "02",
    title: "Extracting Video Information",
    description: "Reading the available video metadata.",
  },
  {
    number: "03",
    title: "Fetching Transcript",
    description: "Fetching available public captions.",
  },
  {
    number: "04",
    title: "Processing Transcript",
    description: "Cleaning the transcript for analysis.",
  },
  {
    number: "05",
    title: "Splitting Transcript into Chunks",
    description: "Preparing ordered transcript evidence.",
  },
  {
    number: "06",
    title: "Generating Summary",
    description: "Creating a concise transcript-based summary.",
  },
  {
    number: "07",
    title: "Generating Action Items",
    description: "Extracting practical steps from the transcript.",
  },
  {
    number: "08",
    title: "Verifying AI Output",
    description: "Checking claims and actions against the transcript.",
  },
  {
    number: "09",
    title: "Research Complete",
    description: "Your verified YouTube research is ready.",
  },
];

interface AnalysisResult {
  sourceType: string;
  title: string;
  extractedContent: string;
  contentSize: number;
  research?: string;
  pipeline?: "website" | "youtube";
  transcriptStatus?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function splitResearchSections(research: string) {
  if (!research || !research.trim()) {
    return [];
  }

  const normalizedResearch = research
    .replace(/\r\n/g, "\n")
    .trim();

  const matches = normalizedResearch.split(
    /^(?:###?\s*(?:\d+\.\s*)?|(?:\*\*)?)(SUMMARY|KEY INSIGHTS|ACTION ITEMS|SOURCE VERIFICATION|VERIFICATION)(?:\*\*)?\s*:?\s*$/gim
  );

  const sections: {
    heading: string;
    content: string;
  }[] = [];

  if (matches.length >= 3) {
    for (let i = 1; i < matches.length; i += 2) {
      const heading = matches[i]?.trim();
      const content = matches[i + 1]?.trim();

      if (heading && content) {
        sections.push({
          heading,
          content,
        });
      }
    }
  }

  if (sections.length === 0) {
    const numberedSections = normalizedResearch
      .split(/^###\s+\d+\.\s+/gm)
      .slice(1);

    numberedSections.forEach((section) => {
      const [heading, ...content] = section.split("\n");

      const cleanHeading = heading?.trim() || "";
      const cleanContent = content.join("\n").trim();

      if (cleanHeading && cleanContent) {
        sections.push({
          heading: cleanHeading,
          content: cleanContent,
        });
      }
    });
  }

  return sections;
}

function isYouTubeInput(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();

    return (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "youtu.be"
    );
  } catch {
    return false;
  }
}

// Icon Helpers
const HexLogoIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="#60A5FA" strokeWidth="2" strokeLinejoin="round" />
    <path d="M12 6L6 9.5V14.5L12 18L18 14.5V9.5L12 6Z" fill="#3B82F6" fillOpacity="0.4" stroke="#93C5FD" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="2.5" fill="#60A5FA" />
  </svg>
);

const BlueCheckCircle = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#2563EB" fillOpacity="0.25" stroke="#3B82F6" strokeWidth="1.5" />
    <path d="M8 12L11 15L16 9" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function TopViewSwitcher({
  currentView,
  setPreviewMode,
}: {
  currentView: "home" | "processing" | "results";
  setPreviewMode: (mode: "home" | "processing" | "results") => void;
}) {
  return (
    <div className="demo-preview-bar">
      <span>View Modes:</span>
      <button
        className={`demo-preview-btn ${currentView === "home" ? "active" : ""}`}
        onClick={() => setPreviewMode("home")}
      >
        Homepage
      </button>
      <button
        className={`demo-preview-btn ${currentView === "processing" ? "active" : ""}`}
        onClick={() => setPreviewMode("processing")}
      >
        Processing Page
      </button>
      <button
        className={`demo-preview-btn ${currentView === "results" ? "active" : ""}`}
        onClick={() => setPreviewMode("results")}
      >
        Results Page
      </button>
    </div>
  );
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showResults, setShowResults] = useState(false);

  const [previewMode, setPreviewMode] = useState<"home" | "processing" | "results" | null>(null);

  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [copiedItem, setCopiedItem] = useState("");

  const activeWorkflowSteps = isYouTubeInput(url)
    ? youtubeWorkflowSteps
    : workflowSteps;

  const currentView: "home" | "processing" | "results" = previewMode
    ? previewMode
    : (showResults && analysisResult)
    ? "results"
    : isAnalyzing
    ? "processing"
    : "home";

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

    setPreviewMode(null);
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

      setAnalysisResult({
        sourceType: data.sourceType || "Website",
        title: data.title || "Untitled Source",
        extractedContent: data.extractedContent || "",
        contentSize: data.contentSize || 0,
        research: data.research || "",
        pipeline: data.pipeline || "website",
        transcriptStatus: data.transcriptStatus || "",
      });

      setChatMessages([]);
      setChatError("");

      setCurrentStep(activeWorkflowSteps.length);
    } catch (err) {
      setIsAnalyzing(false);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong."
      );
    }
  };

  const handleChatSubmit = async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const question = chatQuestion.trim();

    if (
      !question ||
      !analysisResult ||
      isChatLoading
    ) {
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: question,
    };

    const nextMessages = [
      ...chatMessages,
      userMessage,
    ];

    setChatQuestion("");
    setChatMessages(nextMessages);
    setChatError("");
    setIsChatLoading(true);

    try {
      const response = await fetch(
        "/api/chat",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            question,
            extractedContent:
              analysisResult.extractedContent,
            research:
              analysisResult.research || "",
            sourceUrl: url,
            sourceType:
              analysisResult.sourceType,
            history: chatMessages,
          }),
        }
      );

      const data = await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
          "Unable to answer that question."
        );
      }

      setChatMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: data.answer,
        },
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

  const generatePDF = async () => {
    try {
      const activeResult = analysisResult || demoResult;
      const response = await fetch(
        "/api/generate-pdf",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            url: url || "https://youtu.be/ZWPGWBFkup4E7lsliM9VHZkdymP_75",
            research:
              activeResult.research ||
              activeResult.extractedContent,
            sourceType:
              activeResult.sourceType,
            contentSize: `${activeResult.contentSize} characters`,
            transcriptStatus:
              activeResult.transcriptStatus,
            title: activeResult.title,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to generate PDF"
        );
      }

      const blob = await response.blob();
      const pdfUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

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
    if (!isAnalyzing) {
      return;
    }

    if (
      analysisResult &&
      currentStep >=
      activeWorkflowSteps.length
    ) {
      const timer = setTimeout(() => {
        setIsAnalyzing(false);
        setShowResults(true);
      }, 1000);

      return () =>
        clearTimeout(timer);
    }

    if (
      !analysisResult &&
      currentStep >=
      activeWorkflowSteps.length - 1
    ) {
      return;
    }

    const timer = setTimeout(() => {
      setCurrentStep((prev) => prev + 1);
    }, 900);

    return () => clearTimeout(timer);
  }, [
    isAnalyzing,
    currentStep,
    analysisResult,
    activeWorkflowSteps.length,
  ]);

  const resetToHome = () => {
    setPreviewMode(null);
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

  const scrollToHowItWorks = () => {
    const el = document.getElementById("how-it-works");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Demo Result for Previewing Results View
  const demoResult: AnalysisResult = analysisResult || {
    sourceType: "YouTube Video",
    title: "Fundamentals of Artificial Intelligence & Machine Learning",
    extractedContent: "Sample YouTube transcript extracted content...",
    contentSize: 8715,
    pipeline: "youtube",
    transcriptStatus: "Extracted",
    research: `### 1. Summary
This video discusses the fundamentals of Artificial Intelligence, its evolution, key technologies, and real-world applications across various industries.

### 2. Key Insights
- AI is transforming industries through automation and intelligent systems.
- Machine Learning enables systems to learn from data without explicit programming.
- Deep Learning uses neural networks to solve complex problems.

### 3. Action Items
- Start learning ML basics
- Build small AI projects
- Explore tools like Python, TensorFlow, and OpenAI

### 4. Source Verification
- Source URL successfully processed: https://youtu.be/ZWPGWBFkup4E7lsliM9VHZkdymP_75
- 8,715 characters extracted from the provided source
- AI research generated using extracted source content`,
  };

  /* ==========================================================================
     RESULTS PAGE VIEW
     ========================================================================== */

  if (currentView === "results") {
    const activeResult = analysisResult || demoResult;
    const activeUrl = url || "https://youtu.be/ZWPGWBFkup4E7lsliM9VHZkdymP_75";

    const researchSections = splitResearchSections(activeResult.research || "");
    const rawResearch = activeResult.research?.trim() || "";

    const displayChat = chatMessages.length > 0 ? chatMessages : [
      { role: "user", content: "What are the main takeaways from this video?" },
      { role: "assistant", content: "The main takeaways are:\n• AI fundamentals & types\n• Real-world applications\n• Future of AI & ML" },
      { role: "user", content: "Give some action items." },
      { role: "assistant", content: "Here are action items:\n• Start learning ML basics\n• Build small AI projects\n• Explore tools like Python, TensorFlow, and OpenAI" }
    ];

    return (
      <main style={{ minHeight: "100vh", backgroundColor: "#060b19" }}>

        <TopViewSwitcher currentView={currentView} setPreviewMode={setPreviewMode} />

        {/* FLOATING NAVBAR */}
        <div className="navbar-floating-wrapper">
          <header className="navbar">
            <div className="brand-wrapper" onClick={resetToHome}>
              <div className="brand-icon-box">
                <HexLogoIcon />
              </div>
              <div>
                <div className="brand-title">URL Research Agent</div>
                <div className="brand-subtitle">Grounded AI Research Platform</div>
              </div>
            </div>

            <div className="nav-right-actions">
              <div className="system-ready-badge">
                <span className="green-dot"></span> Report Ready
              </div>
              <span style={{ color: "#64748b", fontSize: "14px" }}>+</span>
              <button
                type="button"
                className="pdf-export-btn"
                onClick={generatePDF}
              >
                📄 PDF Export
              </button>
              <button
                type="button"
                className="analyze-btn"
                onClick={resetToHome}
                style={{ padding: "8px 16px", fontSize: "13px" }}
              >
                New Analysis
              </button>
            </div>
          </header>
        </div>

        {/* RESULTS CONTENT */}
        <div className="results-view-wrapper">
          
          {/* SOURCE BANNER */}
          <div className="source-header-banner">
            <div className="banner-top-line">
              <div className="source-url-block">
                <div className="source-icon-frame">🌐</div>
                <div>
                  <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "uppercase" }}>Source Information</span>
                  <p className="source-link-text">{activeUrl}</p>
                </div>
              </div>
              <span style={{ padding: "4px 14px", borderRadius: "14px", background: "rgba(30, 41, 59, 0.8)", border: "1px solid rgba(148, 163, 184, 0.25)", fontSize: "13px", fontWeight: 600 }}>
                {activeResult.pipeline === "youtube" ? "YouTube Video" : "Website Article"}
              </span>
            </div>

            <div className="banner-stats-row">
              <div className="banner-stat-item">
                <span>Content Size</span>
                <strong style={{ color: "#4ade80" }}>{activeResult.contentSize.toLocaleString()} characters</strong>
              </div>
              <div className="banner-stat-item">
                <span>Source Type</span>
                <strong>{activeResult.sourceType}</strong>
              </div>
              <div className="banner-stat-item">
                <span>Status</span>
                <strong style={{ color: "#4ade80" }}>✓ Extracted</strong>
              </div>
              <div className="banner-stat-item">
                <span>Pipeline</span>
                <strong>{activeResult.pipeline === "youtube" ? "Transcript Based" : "DOM Crawler"}</strong>
              </div>
            </div>
          </div>

          {/* 2-COLUMN LAYOUT */}
          <div className="results-grid-2col">

            {/* LEFT REPORT SECTION */}
            <div className="report-panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#ffffff" }}>AI Research Report</h3>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    className="copy-report-btn"
                    onClick={() => copyText(activeResult.research || "", "report")}
                  >
                    {copiedItem === "report" ? "✓ Copied" : "⧉ Copy"}
                  </button>
                  <button
                    type="button"
                    className="pdf-export-sm-btn"
                    onClick={generatePDF}
                  >
                    📄 Export PDF
                  </button>
                  <span style={{ padding: "4px 10px", borderRadius: "10px", background: "rgba(34, 197, 94, 0.15)", border: "1px solid rgba(34, 197, 94, 0.35)", color: "#4ade80", fontSize: "12px", fontWeight: 600 }}>
                    ✓ Source Based
                  </span>
                </div>
              </div>

              {researchSections.length > 0 ? (
                researchSections.map((section, idx) => (
                  <details className="accordion-card" key={idx} open={idx === 0 || idx === 1}>
                    <summary>
                      <span>{idx + 1}. {section.heading}</span>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>▼</span>
                    </summary>
                    <div className="accordion-body">
                      {section.content.split("\n").map((line, lIdx) => (
                        <p key={lIdx} style={{ marginBottom: "6px" }}>{line || "\u00A0"}</p>
                      ))}
                    </div>
                  </details>
                ))
              ) : (
                <div className="accordion-body">
                  {rawResearch.split("\n").map((line, lIdx) => (
                    <p key={lIdx} style={{ marginBottom: "6px" }}>{line || "\u00A0"}</p>
                  ))}
                </div>
              )}
            </div>

            {/* RIGHT CHAT ASSISTANT PANEL */}
            <div className="chat-panel-box">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", paddingBottom: "10px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#ffffff" }}>AI Assistant</h3>
                  <p style={{ fontSize: "12px", color: "#94a3b8" }}>Ask me anything about this research...</p>
                </div>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 8px #a855f7" }}></span>
              </div>

              <div className="chat-history-scroll">
                {displayChat.map((msg, idx) => (
                  <div className={`chat-bubble-item ${msg.role}`} key={idx}>
                    <p style={{ whiteSpace: "pre-line" }}>{msg.content}</p>
                  </div>
                ))}

                {isChatLoading && (
                  <div className="chat-bubble-item assistant">
                    <p style={{ fontStyle: "italic", color: "#94a3b8" }}>Agent is thinking...</p>
                  </div>
                )}
              </div>

              {chatError && <p style={{ color: "#ef4444", fontSize: "11px", marginBottom: "6px" }}>{chatError}</p>}

              <form className="chat-form-row" onSubmit={handleChatSubmit}>
                <input
                  className="chat-form-input"
                  type="text"
                  value={chatQuestion}
                  onChange={(e) => setChatQuestion(e.target.value)}
                  placeholder="Ask another question..."
                  disabled={isChatLoading}
                />
                <button type="submit" className="chat-submit-btn" disabled={isChatLoading || !chatQuestion.trim()}>
                  →
                </button>
              </form>
            </div>

          </div>

        </div>

      </main>
    );
  }

  /* ==========================================================================
     PROCESSING PAGE VIEW
     ========================================================================== */

  if (currentView === "processing") {
    const activeStepIndex = isAnalyzing ? currentStep : 2;
    const progressPercent = isAnalyzing
      ? Math.round((currentStep / activeWorkflowSteps.length) * 100)
      : 68;

    return (
      <main style={{ minHeight: "100vh", backgroundColor: "#060b19" }}>

        <TopViewSwitcher currentView={currentView} setPreviewMode={setPreviewMode} />

        {/* FLOATING NAVBAR */}
        <div className="navbar-floating-wrapper">
          <header className="navbar">
            <div className="brand-wrapper" onClick={resetToHome}>
              <div className="brand-icon-box">
                <HexLogoIcon />
              </div>
              <div>
                <div className="brand-title">URL Research Agent</div>
                <div className="brand-subtitle">Agentic AI Processing</div>
              </div>
            </div>

            <div className="system-ready-badge" style={{ background: "rgba(59, 130, 246, 0.15)", border: "1px solid rgba(59, 130, 246, 0.35)", color: "#60a5fa" }}>
              <span className="green-dot" style={{ background: "#3b82f6", boxShadow: "0 0 8px #3b82f6" }}></span> Processing...
            </div>
          </header>
        </div>

        {/* PROCESSING CONTENT */}
        <div className="processing-view-wrapper">

          {/* LEFT WORKFLOW SIDEBAR */}
          <div className="processing-sidebar">
            <h3 className="processing-sidebar-title">Agent Workflow Steps</h3>

            <div className="processing-steps-list">
              {activeWorkflowSteps.map((step, idx) => {
                const isCompleted = idx < activeStepIndex;
                const isActive = idx === activeStepIndex;

                return (
                  <div key={step.number} className="processing-step-item">
                    <div className={`step-badge ${isCompleted ? "completed" : isActive ? "active" : "pending"}`}>
                      {isCompleted ? "✓" : step.number}
                    </div>
                    <div className={`step-info ${isActive ? "active" : isCompleted ? "completed" : ""}`}>
                      <h4>{step.title}</h4>
                      <p>{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="thinking-pill">
              <span>✦</span> Agent is thinking...
            </div>
          </div>

          {/* RIGHT MAIN VISUAL STAGE */}
          <div className="processing-main-stage">
            <h2 className="stage-title">Analyzing Your Source</h2>
            <p className="stage-desc">Our agent is working step by step to deliver the most accurate research.</p>

            {/* HOLOGRAPHIC SCANNER STAGE GRAPHIC */}
            <div className="hologram-graphic-container">
              <div className="progress-circle-gauge">
                <strong>{progressPercent}%</strong>
                <span>Progress</span>
              </div>
            </div>

            {/* REAL-TIME PROGRESS BAR */}
            <div className="realtime-bar-box">
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#cbd5e1" }}>
                <span>Processing in real time...</span>
                <span>{progressPercent}% Completed</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
              </div>
            </div>

            {/* PHASE CHIPS */}
            <div className="phase-chips-row">
              <span className={`phase-chip ${activeStepIndex <= 1 ? "active" : ""}`}>Reading</span>
              <span className={`phase-chip ${activeStepIndex === 2 ? "active" : ""}`}>Chunking</span>
              <span className={`phase-chip ${activeStepIndex >= 3 && activeStepIndex <= 5 ? "active" : ""}`}>Analyzing</span>
              <span className={`phase-chip ${activeStepIndex >= 6 && activeStepIndex <= 7 ? "active" : ""}`}>Verifying</span>
              <span className={`phase-chip ${activeStepIndex >= 8 ? "active" : ""}`}>Compiling</span>
            </div>
          </div>

        </div>

      </main>
    );
  }

  /* ==========================================================================
     HOMEPAGE VIEW (CONTINUOUS AMBIENT DESK BACKGROUND FROM TOP TO BOTTOM)
     ========================================================================== */

  return (
    <main className="homepage-full-wrapper">

      <TopViewSwitcher currentView={currentView} setPreviewMode={setPreviewMode} />

      {/* FLOATING NAVBAR */}
      <div className="navbar-floating-wrapper">
        <header className="navbar">
          <div className="brand-wrapper" onClick={resetToHome}>
            <div className="brand-icon-box">
              <HexLogoIcon />
            </div>
            <div>
              <div className="brand-title">URL Research Agent</div>
              <div className="brand-subtitle">Grounded AI Research Platform</div>
            </div>
          </div>

          <nav className="nav-links">
            <button className="nav-link active" type="button" onClick={resetToHome}>Home</button>
            <button className="nav-link" type="button" onClick={scrollToHowItWorks}>About</button>
            <button className="nav-link" type="button" onClick={scrollToHowItWorks}>How it Works</button>
          </nav>

          <div className="nav-right-actions">
            <div className="system-ready-badge">
              <span className="green-dot"></span> System Ready
            </div>
            <div className="user-avatar">VR</div>
          </div>
        </header>
      </div>

      {/* HERO SECTION */}
      <section className="hero-section">
        <div className="hero-content-wrapper">

          {/* HERO BADGE */}
          <div className="agentic-badge">
            <span>⚛</span> Agentic AI Research System
          </div>

          {/* MAIN HEADING */}
          <h1 className="hero-heading">
            Turn Any Public URL Into
            <span className="hero-heading-gradient">Reliable Knowledge.</span>
          </h1>

          {/* SUBTITLE */}
          <p className="hero-subtitle">
            Our AI agent reads, analyzes, verifies, and summarizes content from YouTube videos, articles, documentation, and websites — all grounded in the source.
          </p>

          {/* GRID ROW (INPUT CARD & WHY CARD) */}
          <div className="hero-grid-2col">

            {/* INPUT SECTION CARD */}
            <div className="glass-panel">
              <div className="input-panel-label">
                <span style={{ color: "#60a5fa" }}>🔗</span> Paste a public URL to analyze
              </div>

              <div className="url-input-container">
                <span className="search-magnifier">🔍</span>
                <input
                  className="url-input-field"
                  type="url"
                  placeholder="https://youtube.com/watch?v=example"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                {url && (
                  <button className="clear-btn" onClick={() => setUrl("")} type="button" aria-label="Clear URL">
                    ×
                  </button>
                )}
                <button className="analyze-btn" onClick={handleAnalyze} type="button">
                  Analyze URL →
                </button>
              </div>

              {error && (
                <p style={{ color: "#f87171", fontSize: "12px", marginBottom: "12px" }}>
                  {error}
                </p>
              )}

              <div className="popular-sources-box">
                <span className="popular-sources-title">Popular Sources:</span>
                <button
                  type="button"
                  className="source-chip youtube"
                  onClick={() => setUrl("https://youtube.com/watch?v=example")}
                >
                  ▶ YouTube
                </button>
                <button
                  type="button"
                  className="source-chip article"
                  onClick={() => setUrl("https://news.ycombinator.com")}
                >
                  📄 Article
                </button>
                <button
                  type="button"
                  className="source-chip docs"
                  onClick={() => setUrl("https://docs.python.org/3/")}
                >
                  📘 Docs
                </button>
                <button
                  type="button"
                  className="source-chip website"
                  onClick={() => setUrl("https://wikipedia.org")}
                >
                  🌐 Website
                </button>
              </div>
            </div>

            {/* RIGHT SIDE CARD: "Why Our Agent is Different?" */}
            <div className="glass-panel">
              <div className="why-card-header">
                <h3>Why Our Agent is Different?</h3>
                <span style={{ color: "#64748b", fontSize: "14px" }}>✦</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>

                <div className="why-item-row">
                  <div className="why-item-left">
                    <div className="why-icon-box purple">🛡️</div>
                    <div className="why-item-text">
                      <h4>Grounded in Source</h4>
                      <p>No hallucinations. Only real facts.</p>
                    </div>
                  </div>
                  <BlueCheckCircle />
                </div>

                <div className="why-item-row">
                  <div className="why-item-left">
                    <div className="why-icon-box orange">⚙️</div>
                    <div className="why-item-text">
                      <h4>Agentic Workflow</h4>
                      <p>Multi-step intelligent processing.</p>
                    </div>
                  </div>
                  <BlueCheckCircle />
                </div>

                <div className="why-item-row">
                  <div className="why-item-left">
                    <div className="why-icon-box green">🔒</div>
                    <div className="why-item-text">
                      <h4>Verified Output</h4>
                      <p>Reflection & cross-checking.</p>
                    </div>
                  </div>
                  <BlueCheckCircle />
                </div>

                <div className="why-item-row">
                  <div className="why-item-left">
                    <div className="why-icon-box yellow">📋</div>
                    <div className="why-item-text">
                      <h4>Export Reports</h4>
                      <p>Download professional PDFs.</p>
                    </div>
                  </div>
                  <BlueCheckCircle />
                </div>

              </div>
            </div>

          </div>

          {/* STATISTICS CAPSULE BANNER (MATCHING PHOTO EXACTLY) */}
          <div className="stats-capsule-banner">

            <div className="stat-item-card green-accent">
              <div className="stat-icon-box green">🛡️</div>
              <div className="stat-number-text">
                <h4>100%</h4>
                <p>Source Grounded</p>
              </div>
            </div>

            <div className="stat-item-card yellow-accent">
              <div className="stat-icon-box yellow">⚡</div>
              <div className="stat-number-text">
                <h4>95%</h4>
                <p>Accuracy Boost</p>
              </div>
            </div>

            <div className="stat-item-card purple-accent">
              <div className="stat-icon-box purple">🧠</div>
              <div className="stat-number-text">
                <h4>10K+</h4>
                <p>Sources Analyzed</p>
              </div>
            </div>

            <div className="stat-item-card blue-accent">
              <div className="stat-icon-box blue">📄</div>
              <div className="stat-number-text">
                <h4>PDF</h4>
                <p>Export Reports</p>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* HOW IT WORKS SECTION (ENCLOSED IN SEAMLESS AMBIENT BACKGROUND) */}
      <section id="how-it-works" className="how-it-works-section">
        <div className="section-container">
          <div className="section-header-row">
            <div>
              <span className="section-label-tag">HOW IT WORKS</span>
              <h2 className="section-title-main">From URL to trusted insight.</h2>
            </div>
            <p className="section-desc-text">
              A structured agent workflow designed to reduce hallucination and keep results grounded in source evidence.
            </p>
          </div>

          <div className="workflow-5cards-grid">

            <div className="workflow-mini-card">
              <div className="card-top-row">
                <span className="card-num">01</span>
                <span className="card-arrow">↗</span>
              </div>
              <h4>Validate URL</h4>
              <p>Verifying that the URL is public, valid, and safe.</p>
            </div>

            <div className="workflow-mini-card">
              <div className="card-top-row">
                <span className="card-num">02</span>
                <span className="card-arrow">↗</span>
              </div>
              <h4>Extracting Website Content</h4>
              <p>Retrieving readable content from the provided URL.</p>
            </div>

            <div className="workflow-mini-card">
              <div className="card-top-row">
                <span className="card-num">03</span>
                <span className="card-arrow">↗</span>
              </div>
              <h4>Processing Extracted Content</h4>
              <p>Preparing the extracted content for research.</p>
            </div>

            <div className="workflow-mini-card">
              <div className="card-top-row">
                <span className="card-num">04</span>
                <span className="card-arrow">↗</span>
              </div>
              <h4>Analyzing Content with AI</h4>
              <p>Generating grounded findings from the source content.</p>
            </div>

            <div className="workflow-mini-card">
              <div className="card-top-row">
                <span className="card-num">05</span>
                <span className="card-arrow">↗</span>
              </div>
              <h4>Generate Report</h4>
              <p>Preparing the final grounded research output.</p>
            </div>

          </div>
        </div>
      </section>

    </main>
  );
}