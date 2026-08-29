"""Flask front end for the multi-agent report pipeline.

Runs the same outline -> search-and-write -> image -> docx pipeline used by the
/generate-report skill and the notebook, but driven from a browser instead of the CLI.

Usage:
    pip install -r requirements.txt
    python webapp/app.py
    # then open http://127.0.0.1:5000
"""
import os
import sys
import threading
import uuid
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory

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

# override=True: a long-lived dev server restarted by Werkzeug's reloader inherits
# the watcher's already-populated os.environ, so a plain load_dotenv() would keep
# using the *first* value it ever loaded and silently ignore later .env edits.
load_dotenv(ROOT_DIR / ".env", override=True)

app = Flask(__name__)
OUTPUT_DIR = ROOT_DIR / "generated_reports"
OUTPUT_DIR.mkdir(exist_ok=True)

# In-memory job store. Fine for a single-user local dev server; not meant for production use.
jobs = {}


def run_job(job_id: str, topic: str, sections: int) -> None:
    job = jobs[job_id]
    try:
        llm = ChatOpenAI(model="gpt-4o-mini")
        search = TavilySearchResults(max_results=3)
        client = OpenAI()
        graph = build_graph(llm, search, client, str(OUTPUT_DIR))

        initial_state = {
            "messages": [HumanMessage(content=topic)],
            "total_sections": sections,
            "current_section": 1,
        }

        report_file = None
        for chunk in graph.stream(initial_state):
            for node, update in chunk.items():
                if node == "image_generator" and "full_report" in update:
                    job["current_section"] = min(update["current_section"], sections)
                    job["sections"] = [
                        {
                            "title": s["title"],
                            "content": s["content"],
                            "image": (
                                None
                                if s["image_url"] == "Image generation failed"
                                else os.path.basename(s["image_url"])
                            ),
                        }
                        for s in update["full_report"]
                    ]
                if node == "report_generator":
                    report_file = update.get("report_file")

        job["status"] = "done"
        job["download"] = os.path.basename(report_file) if report_file else None
    except Exception as exc:  # surface the error to the browser instead of hanging
        job["status"] = "error"
        job["error"] = str(exc)


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

    job_id = uuid.uuid4().hex
    jobs[job_id] = {
        "status": "running",
        "topic": topic,
        "total_sections": sections,
        "current_section": 1,
        "sections": [],
    }
    threading.Thread(target=run_job, args=(job_id, topic, sections), daemon=True).start()
    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "unknown job"}), 404
    return jsonify(job)


@app.route("/api/download/<job_id>")
def download(job_id):
    job = jobs.get(job_id)
    if not job or job.get("status") != "done" or not job.get("download"):
        return jsonify({"error": "not ready"}), 404
    return send_from_directory(OUTPUT_DIR, job["download"], as_attachment=True)


@app.route("/api/image/<filename>")
def image(filename):
    return send_from_directory(OUTPUT_DIR, filename)


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
