"""Drive every feature in tests/acceptance/features/ for the current tier.

Seeded by software-factories and owned by this project. A feature file is Markdown with an H1
title, one `- Tier: fast` or `- Tier: full` line under its preconditions, and one or more
```bash fences under its "## Driving it with" section. The fences run in order from the
repository root under `bash -euo pipefail`, and the feature passes when they exit 0. The fast
tier runs the keyless features; the full tier runs every feature. CI sets FACTORY_TIER from
the lane's tier. Set it by hand for a local run.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FEATURES_DIR = Path(__file__).resolve().parent / "features"
REPORTS_DIR = ROOT / "reports" / "acceptance"
DEMOS_DIR = ROOT / "demos"
TIERS = ("fast", "full")
TIER_LINE = re.compile(r"^- Tier: (fast|full)$", re.MULTILINE)
DRIVING_HEADING = re.compile(r"^## Driving it with .*$", re.MULTILINE)
NEXT_HEADING = re.compile(r"^## ", re.MULTILINE)
BASH_FENCE = re.compile(r"^```bash\n(.*?)^```$", re.MULTILINE | re.DOTALL)


@dataclass(frozen=True)
class Feature:
    id: str
    title: str
    tier: str
    script: str


def current_tier() -> str:
    tier = os.environ.get("FACTORY_TIER")
    if tier not in TIERS:
        raise RuntimeError(
            "FACTORY_TIER must be fast (the keyless features) or full (every feature); "
            "CI sets it from the lane's tier, a local run sets it by hand"
        )
    return tier


def parse_feature(path: Path) -> Feature:
    text = path.read_text(encoding="utf-8")
    first_line = text.split("\n", 1)[0]
    if not first_line.startswith("# "):
        raise RuntimeError(f"{path}: the first line must be an H1 title")
    tiers = TIER_LINE.findall(text)
    if len(tiers) != 1:
        raise RuntimeError(
            f"{path}: expected exactly one '- Tier: fast' or '- Tier: full' line, found {len(tiers)}"
        )
    heading = DRIVING_HEADING.search(text)
    if heading is None:
        raise RuntimeError(f"{path}: no '## Driving it with <harness>' section")
    rest = text[heading.end() :]
    following = NEXT_HEADING.search(rest)
    section = rest if following is None else rest[: following.start()]
    fences = BASH_FENCE.findall(section)
    if not fences:
        raise RuntimeError(f"{path}: the driving section has no ```bash fence to run")
    return Feature(id=path.stem, title=first_line[2:], tier=tiers[0], script="\n".join(fences))


def all_features() -> list[Feature]:
    paths = sorted(p for p in FEATURES_DIR.glob("*.md") if p.name != "README.md")
    return [parse_feature(p) for p in paths]


def selected_features() -> list[Feature]:
    tier = current_tier()
    chosen = [f for f in all_features() if tier == "full" or f.tier == "fast"]
    if not chosen:
        raise RuntimeError(
            f"no feature in {FEATURES_DIR} is selected for tier {tier}; "
            "write one before the acceptance lane can pass"
        )
    return chosen


@pytest.mark.parametrize("feature", selected_features(), ids=lambda f: f.id)
def test_feature(feature: Feature) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["bash", "-euo", "pipefail", "-c", feature.script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    log = REPORTS_DIR / f"{feature.id}.log"
    log.write_text(
        f"# {feature.title}\n--- script\n{feature.script}\n--- stdout\n{result.stdout}"
        f"--- stderr\n{result.stderr}--- exit {result.returncode}\n",
        encoding="utf-8",
    )
    assert result.returncode == 0, (
        f"{feature.id} exited {result.returncode}; evidence in {log}\n"
        f"{result.stdout[-2000:]}\n{result.stderr[-2000:]}"
    )


def test_every_demo_readme_has_a_feature() -> None:
    missing = [
        f"{FEATURES_DIR.relative_to(ROOT)}/demo-{readme.parent.name}.md"
        for readme in sorted(DEMOS_DIR.glob("*/README.md"))
        if not (FEATURES_DIR / f"demo-{readme.parent.name}.md").is_file()
    ]
    assert missing == [], "every demo README needs a feature file: " + ", ".join(missing)
