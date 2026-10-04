#!/usr/bin/env python3
"""Validate this documentation and optionally fetch its registered primary sources.

Usage: python3 docs/github-repository-map/research/validate_map.py [--fetch]
Only writes generated artifacts in this research directory. No credentials needed.
The one-hop discovery list is a review aid, not a claim to crawl all GitHub Docs.
"""

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlsplit, urldefrag
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
RESEARCH = ROOT / "research"


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = set()
        self.title = []
        self.h1 = []
        self.headings = []
        self.active = None
        self.buffer = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "a" and values.get("href"):
            self.links.add(values["href"])
        if tag in {"title", "h1", "h2", "h3"}:
            self.active = tag
            self.buffer = []

    def handle_data(self, data):
        if self.active:
            self.buffer.append(data)

    def handle_endtag(self, tag):
        if tag == self.active:
            value = " ".join("".join(self.buffer).split())
            if tag == "title":
                self.title.append(value)
            elif tag == "h1":
                self.h1.append(value)
            else:
                self.headings.append(value)
            self.active = None


def fetch_source(url):
    record = {"url": url, "checked_at": datetime.now(timezone.utc).isoformat()}
    try:
        req = Request(url, headers={"User-Agent": "Beanstalk-repository-map-research/1.0"})
        with urlopen(req, timeout=25) as response:
            data = response.read(4_000_000)
            record.update(status=response.status, resolved_url=response.url,
                          content_type=response.headers.get("Content-Type", ""),
                          body_sha256=hashlib.sha256(data).hexdigest(), bytes_read=len(data))
        parser = PageParser()
        if "html" in record["content_type"]:
            parser.feed(data.decode("utf-8", errors="replace"))
            record.update(title=parser.title[:1], h1=parser.h1[:3], headings=parser.headings[:60])
            links = {urldefrag(urljoin(record["resolved_url"], link))[0] for link in parser.links}
            record["linked_docs"] = sorted(link for link in links
                                            if urlsplit(link).netloc == "docs.github.com"
                                            and urlsplit(link).path.startswith("/en/"))
        else:
            record.update(title=[], h1=[], headings=[], linked_docs=[])
        record["reachable"] = 200 <= record["status"] < 300
    except HTTPError as exc:
        record.update(status=exc.code, resolved_url=exc.url, reachable=False, error=str(exc))
    except (URLError, TimeoutError, OSError) as exc:
        record.update(status=None, reachable=False, error=str(exc))
    return record


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--fetch", action="store_true")
    options = args.parse_args()
    docs = sorted(ROOT.rglob("*.md"))
    issues = []
    components = []
    sources = []
    source_files = sorted(RESEARCH.glob("*-sources.json"))
    for path in source_files:
        try:
            rows = json.loads(path.read_text())
            if not isinstance(rows, list):
                issues.append(f"{path.name}: source registry must be an array")
                continue
            for row in rows:
                if not all(key in row for key in ["id", "url", "title", "feature", "verified", "method", "checked_date"]):
                    issues.append(f"{path.name}: incomplete source record {row.get('id')}")
                if row.get("verified") is not True:
                    issues.append(f"{path.name}: unverified cited source {row.get('id')}")
                host = urlsplit(row.get("url", "")).netloc
                if host not in {"docs.github.com", "github.com", "raw.githubusercontent.com", "git-scm.com"}:
                    issues.append(f"{path.name}: review non-primary source {row.get('url')}")
                sources.append({**row, "registry": path.name})
        except (ValueError, TypeError) as exc:
            issues.append(f"{path.name}: {exc}")
    source_urls = {urldefrag(row["url"])[0] for row in sources}
    source_by_id = {row["id"]: row["url"] for row in sources}
    for path in docs:
        body = path.read_text()
        definitions = dict(re.findall(r"^\[([^\]]+)\]:\s+(\S+)", body, re.M))
        defined = set(definitions)
        for label, url in definitions.items():
            if label in source_by_id and url != source_by_id[label]:
                issues.append(f"{path.name}: reference [{label}] differs from source registry")
        for url in set(re.findall(r'https?://[^\s)<>"|]+', body)):
            if urldefrag(url)[0] not in source_urls:
                issues.append(f"{path.name}: external URL absent from source registry {url}")
        for number, line in enumerate(body.splitlines(), 1):
            match = re.match(r"^\|\s*`?([CWASI]\d{3})`?\s*\|", line)
            if match:
                cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
                if len(cells) != 6:
                    issues.append(f"{path.name}:{number}: expected six component columns, found {len(cells)}")
                components.append({"id": match.group(1), "file": path.name, "line": number,
                                   "surface": cells[1] if len(cells) > 1 else "", "cells": cells})
        for label in re.findall(r"(?<!!)\[([A-Z][A-Z0-9-]*\d+)\](?![(:\[])", body):
            if label not in defined:
                issues.append(f"{path.name}: unresolved reference [{label}]")
        for target in re.findall(r"(?<!!)\[[^\]]*\]\(([^)]+)\)", body):
            target = target.strip("<>")
            if target.startswith(("http:", "https:", "mailto:", "#")):
                continue
            local = unquote(target.split("#", 1)[0])
            if local and not (path.parent / local).exists():
                issues.append(f"{path.name}: missing local link {target}")
        if len(re.findall(r"^```", body, re.M)) % 2:
            issues.append(f"{path.name}: unmatched fenced code block")
    counts = Counter(row["id"] for row in components)
    for key, count in counts.items():
        if count != 1:
            issues.append(f"component {key} appears in {count} inventory rows")
    registry_ids = Counter(row.get("id") for row in sources)
    for key, count in registry_ids.items():
        if count != 1:
            issues.append(f"source ID {key} appears {count} times")
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "documentation_files": len(docs), "component_count": len(components),
        "counts_by_document": dict(Counter(row["file"] for row in components)),
        "source_records": len(sources), "unique_source_urls": len({row["url"] for row in sources}),
        "issues": sorted(set(issues)), "scope": "github-repository-map only; no app/UI tests",
    }
    (RESEARCH / "component-index.json").write_text(json.dumps(components, indent=2) + "\n")
    (RESEARCH / "structural-validation.json").write_text(json.dumps(report, indent=2) + "\n")
    if options.fetch:
        urls = sorted({urldefrag(row["url"])[0] for row in sources})
        results = []
        previous = {}
        prior_path = RESEARCH / "source-crawl.json"
        if prior_path.exists():
            try:
                previous = {row["url"]: row for row in json.loads(prior_path.read_text()).get("records", [])
                            if row.get("reachable")}
            except (ValueError, TypeError):
                previous = {}
        results.extend(previous[url] for url in urls if url in previous)
        pending_urls = [url for url in urls if url not in previous]
        with ThreadPoolExecutor(max_workers=6) as pool:
            tasks = {pool.submit(fetch_source, url): url for url in pending_urls}
            for future in as_completed(tasks):
                results.append(future.result())
        results.sort(key=lambda row: row["url"])
        cited = set(urls)
        discovered = sorted({link for row in results for link in row.get("linked_docs", [])} - cited)
        fetch_report = {"checked_at": datetime.now(timezone.utc).isoformat(),
                        "sources_checked": len(results),
                        "fetched_this_run": len(pending_urls),
                        "reused_reachable_records": len(results) - len(pending_urls),
                        "reachable": sum(row["reachable"] for row in results),
                        "failed": [row for row in results if not row["reachable"]],
                        "records": results,
                        "discovered_one_hop_not_necessarily_in_scope": discovered,
                        "limits": "Reachability and headings do not validate factual claims or authenticated UI. One-hop candidates include navigation/configuration links."}
        (RESEARCH / "source-crawl.json").write_text(json.dumps(fetch_report, indent=2) + "\n")
        report["fetch_summary"] = {key: fetch_report[key] for key in ["sources_checked", "reachable"]}
        report["fetch_failures"] = len(fetch_report["failed"])
        (RESEARCH / "structural-validation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return bool(issues or report.get("fetch_failures", 0))


if __name__ == "__main__":
    raise SystemExit(main())
