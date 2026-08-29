# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-notebook project: `03_다중_에이전트_다중_에이전트로_이미지가_포함된_리포트_자동화해보기.ipynb` is the source of truth. It's a LangGraph multi-agent pipeline — outline generator → content writer (Tavily search) → image generator → docx report writer (python-docx) — that loops over report sections and produces a Word document. Image generation prefers Gemini (`gemini-3.1-flash-image`, via `GEMINI_API_KEY`/`GOOGLE_API_KEY`) and automatically falls back to OpenAI's `gpt-image-1` if Gemini isn't configured or the call fails — see `generate_image()` in `generate_report.py`.

A reusable, non-interactive version of this pipeline lives in `.claude/skills/generate-report/scripts/generate_report.py` (invoked via the `/generate-report` skill, or standalone as an interactive CLI).

`webapp/` is a Flask front end (Tailwind CDN, Memphis-style design) for the same pipeline: `python webapp/app.py` serves a browser UI at `http://127.0.0.1:5000` where a topic + section count kicks off a background job, polled via `/api/status/<job_id>`, with per-section results and images rendered as they complete and a `.docx` download link at the end. It imports `build_graph` from `generate_report.py` rather than duplicating the LangGraph wiring.

`search_analysis.py` is a standalone CLI, independent of the LangGraph pipeline: it queries both Tavily and Serper (Google) for the same query via raw REST calls and reports domain overlap/frequency and keyword frequency across the combined results. Run with `python search_analysis.py "<query>"`. `webapp/`'s `/search` page (`templates/search.html` + `static/search.js`) is the browser version — it calls `search_analysis.run()` synchronously from `POST /api/search` and renders the same analysis as bar charts (with a table-view toggle). `webapp/templates/base.html` holds the shared page chrome (nav, decorative shapes, fonts/Tailwind config) that both `index.html` and `search.html` extend.

## Setup and dependencies

- The notebook installs dependencies inline via `!pip install` cells (langchain, langgraph, langchain-openai, langchain-community, chromadb, python-docx, etc.) — there is no requirements.txt/pyproject.toml for the notebook itself. `requirements.txt` at the repo root covers only what `generate_report.py` needs to run.
- The notebook was written for Google Colab: it reads secrets via `google.colab.userdata.get(...)` and assumes `/content` as the working directory. Running it outside Colab requires swapping those for `.env`-based loading (`python-dotenv` + `os.environ`) and a local path — `generate_report.py` already does this.
- `.env` holds API keys (`OPENAI_API_KEY`, `GOOGLE_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`) — never commit it or print its contents. There is no git repo yet; add a `.gitignore` excluding `.env` before running `git init`.
- Every `load_dotenv()` call in this repo passes `override=True`. Without it, a long-lived process (the Flask dev server across Werkzeug reloader restarts, in particular) keeps whatever value it loaded on *first* start and silently ignores later edits to `.env` — a restart alone doesn't fix this since the reloader's child inherits the parent's already-populated environment. If `.env` values ever seem to not "take" while `webapp/app.py` is running, fully kill and relaunch the process rather than editing and waiting for autoreload.
- Gemini image generation (`gemini-3.1-flash-image`) requires a billing-enabled Google AI/Cloud project — the free tier's quota for this model is 0 requests. A 429 `RESOURCE_EXHAUSTED` from it is expected on a free-tier key; the pipeline handles this automatically by falling back to OpenAI, so it's not a bug to chase.
