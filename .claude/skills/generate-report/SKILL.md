---
name: generate-report
description: Runs the multi-agent LangGraph report pipeline (outline -> web-searched content -> AI-generated images -> .docx) on a given topic. Triggered by /generate-report <topic> [sections] — makes real OpenAI/Tavily API calls and costs money, so it is user-invoked only.
disable-model-invocation: true
---

# Generate illustrated report

This project's core workflow (see `03_다중_에이전트_다중_에이전트로_이미지가_포함된_리포트_자동화해보기.ipynb`) is a
four-agent LangGraph pipeline that turns a topic into an illustrated Word report:

1. **outline_generator** — plans the section titles for the topic.
2. **contents_writer** — searches the web with Tavily for each section and writes the content.
3. **image_generator** — writes an infographic prompt from the section content and generates an
   image with OpenAI `gpt-image-1`.
4. **report_generator** — assembles all sections and images into a `.docx` file.

Steps 2-3 repeat per section; step 4 runs once at the end.

`$ARGUMENTS` is `<topic> [sections]` — the topic (may contain spaces) followed optionally by an
integer section count. If the last whitespace-separated token is an integer, treat it as the
section count and the rest as the topic; otherwise use the whole argument as the topic and
default to 3 sections. If no topic is given at all, ask the user for one.

## Steps

1. Check prerequisites:
   - `.env` at the project root must define `OPENAI_API_KEY` and `TAVILY_API_KEY`. If
     `TAVILY_API_KEY` is missing (it wasn't in the original `.env`), tell the user to add it —
     get one at https://tavily.com — and stop.
   - Confirm the packages in `requirements.txt` are installed (`pip show langgraph` as a quick
     check); if not, run `pip install -r requirements.txt` first.
2. Run the pipeline:
   ```
   python .claude/skills/generate-report/scripts/generate_report.py --topic "<topic>" --sections <N>
   ```
3. This writes `report_<topic>.docx` plus the generated section images into `generated_reports/`
   (created if missing). Report the resulting `.docx` path back to the user.
4. If the run fails on a rate limit or API error, surface the error message as-is rather than
   retrying silently — these pipelines make paid API calls per section.

## Standalone interactive use

The script also works as a plain program outside Claude Code: running
`python .claude/skills/generate-report/scripts/generate_report.py` with no flags prompts on stdin
for the topic and section count (mirroring the original notebook's `input()` flow), then runs the
same four-agent pipeline and saves the report — no Claude involvement needed for that path.
