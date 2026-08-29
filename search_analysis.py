"""Fetch web search results from Tavily and, optionally, Serper (Google), and analyze them.

Loads TAVILY_API_KEY (required) and SERPER_API_KEY (optional) from .env via python-dotenv.
Serper is only queried if its key is set; without it, the search and analysis run on
Tavily results alone. Reports: result counts per source, the domains each source
returned, domains that showed up in both (when both ran), the most common domains
overall, and the most frequent keywords across all titles/snippets.

Usage:
    python search_analysis.py "피지컬 AI" --max-results 5
"""
import argparse
import os
import re
import sys
from collections import Counter
from typing import Dict, List
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

TAVILY_URL = "https://api.tavily.com/search"
SERPER_URL = "https://google.serper.dev/search"

# Minimal stopword list so keyword frequency isn't dominated by common
# English/Korean function words and particles.
STOPWORDS = {
    "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "is", "are",
    "was", "were", "with", "as", "by", "at", "from", "this", "that", "it", "be",
    "이", "그", "저", "것", "수", "등", "및", "에서", "으로", "하는", "합니다",
    "있는", "위해", "대한", "그리고", "하지만", "이번", "년", "월", "일",
}


def search_tavily(query: str, api_key: str, max_results: int = 5) -> List[Dict]:
    """Query Tavily's search API and return a normalized list of results."""
    response = requests.post(
        TAVILY_URL,
        json={
            "api_key": api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": "basic",
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return [
        {
            "source": "tavily",
            "title": item.get("title", ""),
            "url": item.get("url", ""),
            "snippet": item.get("content", ""),
        }
        for item in data.get("results", [])
    ]


def search_serper(query: str, api_key: str, max_results: int = 5) -> List[Dict]:
    """Query Serper's Google Search API and return a normalized list of results."""
    response = requests.post(
        SERPER_URL,
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        json={"q": query, "num": max_results},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return [
        {
            "source": "serper",
            "title": item.get("title", ""),
            "url": item.get("link", ""),
            "snippet": item.get("snippet", ""),
        }
        for item in data.get("organic", [])[:max_results]
    ]


def domain_of(url: str) -> str:
    netloc = urlparse(url).netloc
    return netloc[4:] if netloc.startswith("www.") else netloc


def tokenize(text: str) -> List[str]:
    words = re.findall(r"[A-Za-z가-힣]+", text.lower())
    return [w for w in words if len(w) > 1 and w not in STOPWORDS]


def analyze(results: List[Dict]) -> Dict:
    by_source = Counter(r["source"] for r in results)

    domains_by_source = {
        source: {domain_of(r["url"]) for r in results if r["source"] == source and r["url"]}
        for source in by_source
    }
    overlap = set.intersection(*domains_by_source.values()) if len(domains_by_source) > 1 else set()

    domain_freq = Counter(domain_of(r["url"]) for r in results if r["url"])

    keywords = Counter()
    for r in results:
        keywords.update(tokenize(f"{r['title']} {r['snippet']}"))

    return {
        "result_count_by_source": dict(by_source),
        "domains_by_source": {source: sorted(domains) for source, domains in domains_by_source.items()},
        "overlapping_domains": sorted(overlap),
        "top_domains": domain_freq.most_common(10),
        "top_keywords": keywords.most_common(15),
    }


def run(query: str, max_results: int = 5) -> Dict:
    """Search with Tavily, and with Serper too if SERPER_API_KEY is configured.

    Only TAVILY_API_KEY is required. Serper is optional — if its key isn't set,
    the search silently falls back to Tavily-only rather than failing.
    """
    # override=True: always trust the current .env over whatever is already in the
    # process environment (see generate_report.py's run() for why this matters for
    # long-lived processes like the Flask app).
    load_dotenv(override=True)
    tavily_key = os.environ.get("TAVILY_API_KEY")
    serper_key = os.environ.get("SERPER_API_KEY")

    if not tavily_key:
        raise SystemExit("Missing from .env: TAVILY_API_KEY")

    used_apis = ["tavily"]
    results: List[Dict] = search_tavily(query, tavily_key, max_results)

    if serper_key:
        used_apis.append("serper")
        results += search_serper(query, serper_key, max_results)

    return {
        "query": query,
        "used_apis": used_apis,
        "serper_available": bool(serper_key),
        "results": results,
        "analysis": analyze(results),
    }


def print_report(report: Dict) -> None:
    analysis = report["analysis"]
    print(f"\n=== 검색어: {report['query']} ===")
    print(f"사용된 API: {', '.join(report['used_apis'])}")
    if not report.get("serper_available"):
        print("(SERPER_API_KEY가 .env에 없어 Tavily 결과만 사용했습니다.)")
    print(f"결과 수: {analysis['result_count_by_source']}")

    print("\n[출처별 도메인]")
    for source, domains in analysis["domains_by_source"].items():
        print(f"  {source}: {', '.join(domains) or '(없음)'}")

    print("\n[두 API 모두에 등장한 도메인]")
    print(f"  {', '.join(analysis['overlapping_domains']) or '(없음)'}")

    print("\n[가장 많이 등장한 도메인 Top 10]")
    for domain, count in analysis["top_domains"]:
        print(f"  {domain}: {count}")

    print("\n[핵심 키워드 Top 15]")
    for word, count in analysis["top_keywords"]:
        print(f"  {word}: {count}")
    print()


def main():
    # Windows consoles often default to a non-UTF-8 codepage, which garbles Korean
    # output; force UTF-8 stdout so the report always prints correctly.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Search with Tavily + Serper and analyze the combined results.")
    parser.add_argument("query", help="Search query / report topic")
    parser.add_argument("--max-results", type=int, default=5, help="Results to fetch per API (default: 5)")
    args = parser.parse_args()

    try:
        report = run(args.query, args.max_results)
    except requests.exceptions.RequestException as exc:
        raise SystemExit(f"검색 API 호출 실패: {exc}")

    print_report(report)


if __name__ == "__main__":
    main()
