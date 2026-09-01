# 🔍 AI Research Agent

An AI-powered research application that analyzes both **public websites** and **YouTube videos** and transforms source content into concise, structured, and grounded research outputs.

The project is designed to explore an important challenge in AI systems: **how to generate useful summaries while reducing hallucinations and keeping the output grounded in the original source**.

The application supports two research pipelines:

- 🌐 Website Research
- 🎥 YouTube Video Research

For websites, the system extracts website content and generates a structured research report.

For YouTube videos, the system validates the video URL, processes the available transcript, handles long transcripts through chunking, generates a concise summary, creates action items, and performs verification to reduce unsupported or off-topic responses.

---
Simple architecture:

User URL → Validation → URL Type Detection → Content/Transcript Extraction → Chunking → AI Analysis → Reflection & Verification → Final Answer → PDF

---

# 🆕 NEW Features (v2.0)

## 🎯 Major Enhancements

### ✨ Professional Dark Navy UI
- Clean, modern dark navy theme with blue & purple accents
- Fully responsive design for all devices
- Professional glass morphism components
- Subtle, sophisticated visual effects

### 📚 Multi-Source Research
- Analyze 2-5 sources simultaneously
- Automatic source comparison and analysis
- Unified research report combining all sources
- Identifies common findings and differences
- Clearly attributes each finding to its source

### 🔀 Source Comparison
- Automatically finds common information across sources
- Detects unique findings in each source
- Identifies conflicting information
- Professional comparison formatting
- Source-aware recommendations

### 💬 Enhanced Chat Assistant
- Ask questions about analyzed research
- Multi-source chat support
- Strict source grounding to prevent hallucinations
- Clear statements when information isn't available
- Context-aware responses

### 📋 Research History
- Persistent research storage in browser
- Quick access to previous analyses
- One-click reload of past research
- Delete individual items or clear all
- Professional history sidebar

### 🛡️ Comprehensive Safety System
- **URL Validation**: Format and domain checking
- **Domain Whitelist**: Trusted domains verification
- **Content Scanning**: Detects unsafe content patterns
- **YouTube Safety**: Validates video metadata before processing
- **Layered Approach**: Multi-step safety checks

### 🚫 Safety Block Screen
- Professional blocking messages
- Clear explanations without explicit details
- One-click "Analyze Another URL" option
- User-friendly communication

### 🔒 AI Guardrails
- Prevents hallucination and false claims
- Sources grounded in retrieved content
- Clear distinction between facts and analysis
- Explicit statements when information unavailable
- Professional, safe responses

### 🏗️ Modular Architecture
- Separate services for safety, history, comparison
- Clean separation of concerns
- Easier maintenance and testing
- Prepared for future enhancements

---

# 🚀 Quick Start

## Single-Source Analysis
1. **Paste a URL** in the "Single Source" mode (default)
2. **Click "Analyze"** to start the research pipeline
3. **View Results** - Get structured research report in 7 sections
4. **Ask Questions** - Use the AI chat to ask follow-up questions
5. **Export** - Download your research as a PDF report

## Multi-Source Analysis
1. **Switch to "Multi-Source" mode** using the toggle button
2. **Add 2-5 URLs** - Can be YouTube videos, articles, or websites
3. **Click "Analyze"** - System analyzes all sources simultaneously
4. **View Comparison** - See common findings and differences
5. **Combined Report** - Get unified analysis with source attribution
6. **Ask Questions** - Chat about all sources at once

## Research History
1. **Click "📚 History"** in the navigation bar
2. **Select Previous Analysis** to reload it instantly
3. **Manage History** - Delete items or clear all history
4. **Persistent Storage** - Your research history is saved locally

## Safety & Trust
- The system automatically validates all URLs for safety
- Blocks unsafe content with clear, professional explanations
- Never processes inappropriate or harmful material
- Always grounds AI responses in actual source content
- Never hallucinate or invent information

---

# 🎯 Problem Statement

AI models can generate summaries quickly, but a major challenge is **hallucination**.

For example, imagine a user provides a YouTube video about:

> LangGraph

A poorly designed AI pipeline might generate a response mainly discussing:

> LangChain

even if the video transcript does not support that information.

This project explores how an AI research system can reduce such problems by:

- Using source content as evidence
- Grounding AI responses in the extracted content
- Processing large transcripts
- Using chunking for long videos
- Generating concise summaries
- Producing practical action items
- Verifying AI-generated output
- Detecting topic drift and unsupported information

---

# ✨ Original Features

## 🌐 Website Research

- Analyze public website URLs
- Fetch website content
- Extract readable text from HTML
- Remove unnecessary HTML elements
- Process extracted content
- Generate AI-powered research reports
- Generate important insights
- Generate action items
- Provide grounding and verification information
- Ask follow-up questions using an AI chatbot
- Generate downloadable PDF reports

---

## 🎥 YouTube Video Research

- Detect YouTube URLs automatically
- Validate supported YouTube URL formats
- Extract the YouTube video ID
- Fetch available public transcript/captions
- Process transcript content
- Handle long transcripts
- Split transcripts into manageable chunks
- Generate a concise summary
- Keep the video summary approximately 6–7 lines
- Extract important points
- Generate practical action items
- Verify AI output against the transcript
- Reduce hallucination and topic drift
- Regenerate output when verification identifies problems
- Support chatbot-based follow-up questions
- Generate downloadable PDF reports

---

# 🧠 Why This Project?

The main goal of this project is not simply to summarize a URL.

It explores important concepts involved in building more reliable AI systems.

These include:

- AI agents
- Tool usage
- Grounding
- Hallucination prevention
- Reflection and verification
- Processing large transcripts
- Chunking
- Agentic workflows
- Scalable system design

The project demonstrates why a simple pipeline such as:

```text
Source
↓
LLM
↓
Summary


                         USER INPUT
                             │
                             ▼
                      URL TYPE DETECTION
                             │
                 ┌───────────┴───────────┐
                 │                       │
                 ▼                       ▼
          🌐 WEBSITE URL           🎥 YOUTUBE URL
                 │                       │
                 ▼                       ▼
         WEBSITE VALIDATION      YOUTUBE VALIDATION
                 │                       │
                 ▼                       ▼
         CONTENT EXTRACTION     TRANSCRIPT EXTRACTION
                 │                       │
                 ▼                       ▼
          CONTENT PROCESSING    TRANSCRIPT PROCESSING
                 │                       │
                 │                       ▼
                 │                CHUNKING TOOL
                 │                       │
                 ▼                       ▼
              AI ANALYSIS        SUMMARIZATION AGENT
                 │                       │
                 │                       ▼
                 │                ACTION ITEMS
                 │                       │
                 │                       ▼
                 │               REFLECTION AGENT
                 │                       │
                 │                       ▼
                 │              VERIFICATION CHECK
                 │                       │
                 │               ┌───────┴────────┐
                 │               │                │
                 │              PASS             FAIL
                 │               │                │
                 │               ▼                ▼
                 │           FINAL RESULT    REGENERATE
                 │
                 └───────────────┬───────────────┘
                                 │
                                 ▼
                           AI CHATBOT
                                 │
                                 ▼
                            PDF REPORT





                            Transcript
     ↓
Initial AI Output
     ↓
Reflection / Verification
     ↓
Is the Output Grounded?
     │
 ┌───┴────┐
 │        │
YES       NO
 │        │
 ▼        ▼
FINAL   REGENERATE
OUTPUT      │
            ▼
        VERIFY AGAIN
