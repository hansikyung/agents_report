"""Vercel Python entrypoint.

Vercel's Flask framework preset auto-detects a top-level `app` object in one of a
few fixed root-level filenames (app.py, index.py, server.py, main.py, wsgi.py,
asgi.py) — it does not look inside arbitrary subdirectories like webapp/. This
file just re-exports the real Flask app from webapp/app.py so nothing has to move.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "webapp"))
from app import app  # noqa: E402,F401 — Vercel looks for this top-level `app` name
