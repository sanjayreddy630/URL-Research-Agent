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

# ✨ Features

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
