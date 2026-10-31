"""Flag the AGENTS.md section 6 patterns that ruff has no rules for.

Usage: python scripts/check_no_fakes.py [--allowlist FILE] <path> [<path> ...]
Exits 1 if any error is found; warnings are printed but don't fail.

no-fakes.allow has two entry forms, globs relative to the allowlist's directory:

  <glob>  # <reason>            the file is not checked at all
  <glob>  text-off  # <reason>  the comment and docstring word rule is off; every
                                structural rule (identifiers, stub bodies, swallowed
                                exceptions, fallbacks, test-double imports) still runs

no-fakes.profile picks the rule set:

  strict     (default) no test doubles, stubs, fallbacks, or shortcut comments anywhere.
  interview  honest stubs are fine: test doubles in test files, Fake*/InMemory* names,
             NotImplementedError, shortcut comments. Silent fakes still fail: swallowed
             broad exceptions, empty bodies, fallback paths, skipped tests.
"""

import argparse
import ast
import fnmatch
import io
import re
import sys
import tokenize
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST = REPO_ROOT / "no-fakes.allow"
PROFILE_FILE = REPO_ROOT / "no-fakes.profile"
PROFILES = {"strict", "interview"}
SELF = Path(__file__).resolve()
SKIP_DIRS = {"node_modules", "venv", "__pycache__", "build", "dist"}

ABSTRACT_DECORATORS = {"abstractmethod", "overload"}
PYTEST_SKIP_ATTRS = {"skip", "skipif", "xfail"}
BROAD_EXCEPTIONS = {"Exception", "BaseException"}
DOUBLE_MODULES = {
    "unittest.mock", "mock", "pytest_mock", "responses", "respx", "requests_mock",
    "moto", "fakeredis", "freezegun", "faker",
}
PATCH_ATTRS = {"setattr", "setitem", "delattr", "delitem"}

SUSPECT_PART = re.compile(
    r"^(mocks?|mocked|mocking|mocker|fakes?|faked|faker|stubs?|stubbed|"
    r"dummy|dummies|fallbacks?|placeholders?)$"
)
SUSPECT_TEXT = re.compile(
    r"\b(mock(ed|s|ing)?|fake[ds]?|stub(bed|s)?|dummy|fall[ -]?backs?|placeholder|"
    r"for now|temporar(y|ily)|hard-?coded|simulat(e|ed|es|ing|ion))\b",
    re.IGNORECASE,
)
IDENT_PARTS = re.compile(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+")


def load_profile() -> str:
    if not PROFILE_FILE.exists():
        return "strict"
    lines = [ln.strip() for ln in PROFILE_FILE.read_text().splitlines()]
    values = [ln for ln in lines if ln and not ln.startswith("#")]
    if len(values) != 1 or values[0] not in PROFILES:
        raise SystemExit(f"error: {PROFILE_FILE.name} must contain one of {sorted(PROFILES)}, got {values}")
    return values[0]


SKIP = "skip"
TEXT_OFF = "text-off"


def load_allowlist(allowlist: Path) -> list[tuple[str, str]]:
    """Return (glob, mode) pairs, mode being SKIP or TEXT_OFF."""
    if not allowlist.exists():
        return []
    entries = []
    for n, raw in enumerate(allowlist.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        left, sep, reason = line.partition("#")
        if not sep or not reason.strip():
            raise SystemExit(f"error: {allowlist.name}:{n}: entry needs a reason after '#'")
        tokens = left.split()
        if len(tokens) == 1:
            entries.append((tokens[0], SKIP))
        elif len(tokens) == 2 and tokens[1] == TEXT_OFF:
            entries.append((tokens[0], TEXT_OFF))
        else:
            raise SystemExit(
                f"error: {allowlist.name}:{n}: entry must be '<glob>  # reason' or "
                f"'<glob>  {TEXT_OFF}  # reason', got {left.strip()!r}"
            )
    return entries


def name_of(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{name_of(node.value)}.{node.attr}"
    if isinstance(node, ast.Call):
        return name_of(node.func)
    return ""


def is_test_file(path: Path) -> bool:
    return (
        path.name.startswith("test_") or path.name.endswith("_test.py") or path.name == "conftest.py"
        or any(part in {"test", "tests"} for part in path.parts[:-1])
    )


def is_suspect_identifier(name: str, profile: str) -> bool:
    parts = [p.lower() for p in IDENT_PARTS.findall(name)]
    if "fallback" in "".join(parts):
        return True
    return profile == "strict" and any(SUSPECT_PART.match(p) for p in parts)


def is_abstract(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    return any(name_of(d).split(".")[-1] in ABSTRACT_DECORATORS for d in fn.decorator_list)


def docstring_of(body: list[ast.stmt]) -> ast.Constant | None:
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
            and isinstance(body[0].value.value, str):
        return body[0].value
    return None


def is_ellipsis(stmt: ast.stmt) -> bool:
    return isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant) and stmt.value.value is Ellipsis


def is_stub_body(body: list[ast.stmt]) -> bool:
    stmts = body[1:] if docstring_of(body) else body
    return not stmts or (len(stmts) == 1 and (isinstance(stmts[0], ast.Pass) or is_ellipsis(stmts[0])))


def is_silent_body(body: list[ast.stmt]) -> bool:
    return all(isinstance(s, (ast.Pass, ast.Continue)) or is_ellipsis(s) for s in body)


def is_broad_handler(handler: ast.ExceptHandler) -> bool:
    if handler.type is None:
        return True
    types = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
    return any(name_of(t).split(".")[-1] in BROAD_EXCEPTIONS for t in types)


def is_literal_default(node: ast.expr) -> bool:
    # A literal 0 is exempt: it's the identity for counting and sums.
    if isinstance(node, ast.Constant):
        return node.value not in (None, 0) and not isinstance(node.value, bool)
    return isinstance(node, (ast.List, ast.Dict, ast.Tuple, ast.Set, ast.JoinedStr))


class Checker(ast.NodeVisitor):
    def __init__(self, path: Path, profile: str, text_rules: bool = True) -> None:
        self.path = path
        self.strict = profile == "strict"
        self.profile = profile
        self.text_rules = text_rules
        # Interview profile: test files may use doubles.
        self.doubles_ok = not self.strict and is_test_file(path)
        self.findings: set[tuple[int, str, str]] = set()
        self.protocol_depth = 0
        self.abstract_depth = 0

    def report(self, node: ast.AST | int, msg: str, level: str = "error") -> None:
        line = node if isinstance(node, int) else node.lineno
        self.findings.add((line, level, msg))

    def soft(self, node: ast.AST, msg: str) -> None:
        """An error in strict, a warning in interview."""
        self.report(node, msg, "error" if self.strict else "warning")

    def check_name(self, node: ast.AST, name: str | None, kind: str) -> None:
        if name and not self.doubles_ok and is_suspect_identifier(name, self.profile):
            self.report(node, f"{kind} '{name}' names a mock/fake/stub/fallback")

    def check_docstring(self, body: list[ast.stmt]) -> None:
        doc = docstring_of(body)
        if self.strict and self.text_rules and doc and (m := SUSPECT_TEXT.search(doc.value)):
            self.report(doc, f"docstring says '{m.group(0)}'")

    def visit_Module(self, node: ast.Module) -> None:
        self.check_docstring(node.body)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.check_name(node, node.name, "class")
        self.check_docstring(node.body)
        is_protocol = any(name_of(b).split(".")[-1] in {"Protocol", "ABC"} for b in node.bases)
        self.protocol_depth += is_protocol
        self.generic_visit(node)
        self.protocol_depth -= is_protocol

    def visit_FunctionDef(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.check_name(node, node.name, "function")
        self.check_docstring(node.body)
        abstract = is_abstract(node) or self.protocol_depth > 0
        if not abstract and is_stub_body(node.body):
            hint = "" if self.strict else "; if it's a deliberate stub, raise NotImplementedError(...)"
            self.report(node, f"function '{node.name}' has an empty or stub body{hint}")
        for dec in node.decorator_list:
            parts = name_of(dec).split(".")
            if parts[:2] == ["pytest", "mark"] and len(parts) > 2 and parts[2] in PYTEST_SKIP_ATTRS:
                self.report(dec, f"test '{node.name}' is marked {parts[2]}")
        self.abstract_depth += abstract
        self.generic_visit(node)
        self.abstract_depth -= abstract

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_arg(self, node: ast.arg) -> None:
        self.check_name(node, node.arg, "parameter")

    def visit_Name(self, node: ast.Name) -> None:
        self.check_name(node, node.id, "name")

    def visit_Attribute(self, node: ast.Attribute) -> None:
        self.check_name(node, node.attr, "attribute")
        self.generic_visit(node)

    def visit_keyword(self, node: ast.keyword) -> None:
        self.check_name(node, node.arg, "keyword")
        self.generic_visit(node)

    def check_double_import(self, node: ast.AST, full: str, top: str) -> None:
        if not self.doubles_ok and (full in DOUBLE_MODULES or top in DOUBLE_MODULES):
            where = "outside test files" if not self.strict else "without approval in no-fakes.allow"
            self.report(node, f"imports test-double library '{full}' {where}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.check_double_import(node, alias.name, alias.name.split(".")[0])
            self.check_name(node, alias.asname, "import alias")

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        mod = node.module or ""
        for alias in node.names:
            full = f"{mod}.{alias.name}"
            hit = mod if mod in DOUBLE_MODULES else full
            self.check_double_import(node, hit, mod.split(".")[0])
            self.check_name(node, alias.asname or alias.name, "import")

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        reraises = any(isinstance(n, ast.Raise) for stmt in node.body for n in ast.walk(stmt))
        if not reraises:
            if self.strict:
                self.report(node, "except block doesn't re-raise; handle it for real or let it propagate")
            elif is_broad_handler(node):
                self.report(node, "broad except without re-raise swallows every error; catch the specific one")
            elif is_silent_body(node.body):
                self.report(node, "except block silently ignores the error")
        self.generic_visit(node)

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        if isinstance(node.op, ast.Or) and is_literal_default(node.values[-1]):
            self.soft(node, "`x or <literal>` substitutes a default; fail on missing data instead")
        self.generic_visit(node)

    def visit_Raise(self, node: ast.Raise) -> None:
        if self.strict and self.abstract_depth == 0 and node.exc is not None \
                and name_of(node.exc) == "NotImplementedError":
            self.report(node, "raises NotImplementedError outside an abstract method")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        callee = name_of(node.func)
        if callee in {"os.getenv", "os.environ.get"} and len(node.args) >= 2:
            default = node.args[1]
            if not (isinstance(default, ast.Constant) and default.value is None):
                self.soft(node, f"{callee}() with a default value; fail fast on missing config instead")
        if callee in {"pytest.skip", "pytest.xfail"}:
            self.report(node, f"{callee}() call")
        if callee.split(".")[-1] == "suppress":
            broad = not node.args or any(name_of(a) in BROAD_EXCEPTIONS for a in node.args)
            if self.strict or broad:
                self.report(node, "contextlib.suppress swallows errors")
        if callee.startswith("monkeypatch.") and callee.split(".")[-1] in PATCH_ATTRS and not self.doubles_ok:
            self.report(node, f"{callee}() patches real behavior")
        self.generic_visit(node)


def check_comments(source: str, checker: Checker) -> None:
    if not checker.strict or not checker.text_rules:
        return
    for tok in tokenize.generate_tokens(io.StringIO(source).readline):
        if tok.type == tokenize.COMMENT and (m := SUSPECT_TEXT.search(tok.string)):
            checker.report(tok.start[0], f"comment says '{m.group(0)}'")


def iter_py_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            files.extend(
                f for f in p.rglob("*.py")
                if not any(part.startswith(".") or part in SKIP_DIRS for part in f.relative_to(p).parts)
            )
        elif p.suffix == ".py":
            files.append(p)
        else:
            raise SystemExit(f"error: {p} is not a directory or .py file")
    return [f for f in files if f.resolve() != SELF]


def allow_mode(path: Path, root: Path, entries: list[tuple[str, str]]) -> str | None:
    """SKIP if any skip entry matches, else TEXT_OFF if one matches, else None."""
    try:
        rel = path.resolve().relative_to(root).as_posix()
    except ValueError:
        return None
    modes = {mode for glob, mode in entries if fnmatch.fnmatch(rel, glob)}
    if SKIP in modes:
        return SKIP
    if TEXT_OFF in modes:
        return TEXT_OFF
    return None


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--allowlist", type=Path, default=ALLOWLIST, help="allowlist file (default: no-fakes.allow)")
    parser.add_argument("paths", nargs="+")
    args = parser.parse_args(argv)
    profile = load_profile()
    allowlist = args.allowlist.resolve()
    entries = load_allowlist(allowlist)
    errors = 0
    for path in iter_py_files(args.paths):
        mode = allow_mode(path, allowlist.parent, entries)
        if mode == SKIP:
            continue
        source = path.read_text()
        checker = Checker(path, profile, text_rules=mode != TEXT_OFF)
        checker.visit(ast.parse(source, filename=str(path)))
        check_comments(source, checker)
        for line, level, msg in sorted(checker.findings):
            print(f"{path}:{line}: {level}: {msg}")
            errors += level == "error"
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
