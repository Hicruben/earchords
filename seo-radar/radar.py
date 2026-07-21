#!/usr/bin/env python3
"""sitemap-radar: 监控竞品 sitemap 的新增 URL。

竞品新增页面 = 它们刚验证过的新词。每次运行抓取 sites.txt 里每个站的
sitemap,和上次快照做 diff,把新增 URL 写进 reports/ 并打印到 stdout。

用法:
    python3 radar.py            # 常规运行(首次运行只建基线,不报新增)
    python3 radar.py --report   # 额外输出最近 7 天所有新增汇总

依赖:仅 Python 标准库。配置见 sites.txt,部署见 README.md。
"""

import gzip
import io
import json
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent
STATE_DIR = BASE / "state"
REPORT_DIR = BASE / "reports"
SITES_FILE = BASE / "sites.txt"

UA = "Mozilla/5.0 (compatible; sitemap-radar/1.0; personal research tool)"
TIMEOUT = 30
MAX_URLS_PER_SITE = 50000   # 超大 sitemap 截断保护
MAX_CHILD_SITEMAPS = 50     # sitemap index 最多追多少个子 sitemap
LOC_RE = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.I | re.S)
IS_INDEX_RE = re.compile(r"<sitemapindex", re.I)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = resp.read()
    if url.endswith(".gz") or data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    return data.decode("utf-8", errors="replace")


def extract_locs(xml: str) -> list[str]:
    return [loc.strip() for loc in LOC_RE.findall(xml) if loc.strip()]


def collect_urls(sitemap_url: str) -> set[str]:
    """抓取 sitemap;若是 sitemap index 则递归子 sitemap(单层)。"""
    urls: set[str] = set()
    xml = fetch(sitemap_url)
    if IS_INDEX_RE.search(xml):
        children = extract_locs(xml)[:MAX_CHILD_SITEMAPS]
        for child in children:
            try:
                urls.update(extract_locs(fetch(child)))
            except Exception as e:
                print(f"    warn: 子 sitemap 失败 {child}: {e}", file=sys.stderr)
            if len(urls) >= MAX_URLS_PER_SITE:
                break
    else:
        urls.update(extract_locs(xml))
    return set(list(urls)[:MAX_URLS_PER_SITE])


def load_sites() -> list[tuple[str, str]]:
    sites = []
    for line in SITES_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, _, url = line.partition("=")
        if url:
            sites.append((name.strip(), url.strip()))
    return sites


def state_path(name: str) -> Path:
    safe = re.sub(r"[^\w.-]", "_", name)
    return STATE_DIR / f"{safe}.json"


def run() -> None:
    STATE_DIR.mkdir(exist_ok=True)
    REPORT_DIR.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    report_lines = []

    for name, sitemap_url in load_sites():
        print(f"[{name}] {sitemap_url}")
        try:
            current = collect_urls(sitemap_url)
        except Exception as e:
            print(f"    error: 抓取失败: {e}", file=sys.stderr)
            continue
        if not current:
            print("    warn: 抓到 0 个 URL,跳过 diff", file=sys.stderr)
            continue

        sp = state_path(name)
        if sp.exists():
            state = json.loads(sp.read_text())
        else:
            state = {"urls": {}}
        known = state["urls"]
        new_urls = sorted(u for u in current if u not in known)

        first_run = not known
        for u in current:
            known.setdefault(u, now)
        sp.write_text(json.dumps(state, ensure_ascii=False))

        if first_run:
            print(f"    基线建立: {len(current)} 个 URL(首次运行不报新增)")
        elif new_urls:
            print(f"    ★ 新增 {len(new_urls)} 个 URL:")
            for u in new_urls[:200]:
                print(f"      + {u}")
            report_lines.append(f"## {name}({len(new_urls)} 个新增)\n")
            report_lines.extend(f"- {u}" for u in new_urls)
            report_lines.append("")
        else:
            print(f"    无新增(共 {len(current)} 个 URL)")

    if report_lines:
        rp = REPORT_DIR / f"{today}.md"
        header = f"# sitemap-radar 新增报告 {now}\n\n"
        existing = rp.read_text() if rp.exists() else ""
        rp.write_text(existing + header + "\n".join(report_lines) + "\n")
        print(f"\n报告已写入 {rp}")


def report_recent(days: int = 7) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    print(f"# 最近 {days} 天新增汇总\n")
    for sp in sorted(STATE_DIR.glob("*.json")):
        state = json.loads(sp.read_text())
        recent = []
        for url, seen in state["urls"].items():
            try:
                t = datetime.strptime(seen, "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if t >= cutoff:
                recent.append((seen, url))
        if recent:
            print(f"## {sp.stem}")
            for seen, url in sorted(recent):
                print(f"- {seen}  {url}")
            print()


if __name__ == "__main__":
    if "--report" in sys.argv:
        report_recent()
    else:
        run()
