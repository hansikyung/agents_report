"""Flask front end for the multi-agent report pipeline.

Runs the same outline -> search-and-write -> image -> docx pipeline used by the
/generate-report skill and the notebook, but driven from a browser instead of the CLI.

/api/generate is fully synchronous and in-memory (no background thread, no shared
job store, no disk writes) so this runs the same way locally and as a serverless
Vercel Function: each request does all the work itself and returns the complete
result — sections with base64-embedded images, plus the base64-encoded .docx — in
one JSON response. The frontend builds the download link from that response
client-side (see static/app.js), so there's no follow-up request that depends on
a previous one having touched the same filesystem/process.

Usage:
    pip install -r requirements.txt
    python webapp/app.py
    # then open http://127.0.0.1:5000
"""
import base64
import os
import sys
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

# The pipeline lives in the generate-report skill; import it directly rather than
# duplicating the LangGraph wiring here.
ROOT_DIR = Path(__file__).resolve().parent.parent
SKILL_SCRIPTS_DIR = ROOT_DIR / ".claude" / "skills" / "generate-report" / "scripts"
sys.path.insert(0, str(SKILL_SCRIPTS_DIR))
sys.path.insert(0, str(ROOT_DIR))

from generate_report import build_graph  # noqa: E402
from search_analysis import run as run_search_analysis  # noqa: E402

from langchain_community.tools.tavily_search import TavilySearchResults  # noqa: E402
from langchain_core.messages import HumanMessage  # noqa: E402
from langchain_openai import ChatOpenAI  # noqa: E402
from openai import OpenAI  # noqa: E402

# override=True: a long-lived process (Flask's reloader locally, or a warm serverless
# instance) inherits/keeps whatever os.environ it first populated, so a plain
# load_dotenv() would silently ignore later .env edits.
load_dotenv(ROOT_DIR / ".env", override=True)

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html", active_page="report")


@app.route("/search")
def search_page():
    return render_template("search.html", active_page="search")


@app.route("/api/generate", methods=["POST"])
def generate():
    data = request.get_json(force=True, silent=True) or {}
    topic = str(data.get("topic") or "").strip()
    try:
        sections = int(data.get("sections") or 3)
    except (TypeError, ValueError):
        return jsonify({"error": "sections must be a number"}), 400

    if not topic:
        return jsonify({"error": "topic is required"}), 400
    if not 1 <= sections <= 10:
        return jsonify({"error": "sections must be between 1 and 10"}), 400
    for var in ("OPENAI_API_KEY", "TAVILY_API_KEY"):
        if not os.environ.get(var):
            return jsonify({"error": f"Missing {var} in .env"}), 500

    try:
        llm = ChatOpenAI(model="gpt-4o-mini")
        search = TavilySearchResults(max_results=3)
        client = OpenAI()
        graph = build_graph(llm, search, client)  # output_dir=None: in-memory, no disk writes

        initial_state = {
            "messages": [HumanMessage(content=topic)],
            "total_sections": sections,
            "current_section": 1,
        }

        full_report = []
        report_bytes = None
        report_name = None
        for chunk in graph.stream(initial_state):
            for node, update in chunk.items():
                if node == "image_generator" and "full_report" in update:
                    full_report = update["full_report"]
                if node == "report_generator":
                    report_bytes = update.get("report_bytes")
                    report_name = update.get("report_name")

        if report_bytes is None:
            return jsonify({"error": "리포트 생성에 실패했습니다 (report_bytes 없음)."}), 500

        sections_out = [
            {
                "title": s["title"],
                "content": s["content"],
                "image_base64": (
                    base64.b64encode(s["image_bytes"]).decode("ascii") if s.get("image_bytes") else None
                ),
            }
            for s in full_report
        ]

        return jsonify(
            {
                "topic": topic,
                "sections": sections_out,
                "report_base64": base64.b64encode(report_bytes).decode("ascii"),
                "filename": report_name,
            }
        )
    except Exception as exc:  # surface the error to the browser instead of a bare 500
        return jsonify({"error": str(exc)}), 500


@app.route("/api/search", methods=["POST"])
def api_search():
    data = request.get_json(force=True, silent=True) or {}
    query = str(data.get("query") or "").strip()
    try:
        max_results = int(data.get("max_results") or 5)
    except (TypeError, ValueError):
        return jsonify({"error": "max_results must be a number"}), 400

    if not query:
        return jsonify({"error": "query is required"}), 400
    if not 1 <= max_results <= 10:
        return jsonify({"error": "max_results must be between 1 and 10"}), 400

    try:
        report = run_search_analysis(query, max_results)
    except SystemExit as exc:
        return jsonify({"error": str(exc)}), 500
    except requests.exceptions.RequestException as exc:
        return jsonify({"error": f"검색 API 호출 실패: {exc}"}), 502

    return jsonify(report)


if __name__ == "__main__":
    missing = [v for v in ("OPENAI_API_KEY", "TAVILY_API_KEY") if not os.environ.get(v)]
    if missing:
        print(f"Warning: missing from .env: {', '.join(missing)} (generation will fail until set)")
    app.run(debug=True, port=5000)
