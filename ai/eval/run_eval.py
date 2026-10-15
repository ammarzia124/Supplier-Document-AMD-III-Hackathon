"""Run the ground-truth corpus through the Supplier Document Desk API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOCUMENTS = ROOT / "data" / "documents"
DEFAULT_GROUND_TRUTH = ROOT / "data" / "ground_truth.json"
DEFAULT_API_URL = os.environ.get("BACKEND_URL", "http://localhost:3000")
DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_POLL_SECONDS = 2
NUMERIC_TOLERANCE = 0.01


class EvaluationError(Exception):
    """An input or API error that should be reported to the evaluator."""


def api_root(base_url: str) -> str:
    """Return a normalized API root, accepting either a host or a /api URL."""
    normalized = base_url.rstrip("/")
    if not normalized:
        raise EvaluationError("API URL cannot be empty")
    return normalized if normalized.endswith("/api") else f"{normalized}/api"


def load_ground_truth(path: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise EvaluationError(f"Cannot read ground truth at {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise EvaluationError(f"Invalid ground-truth JSON at {path}: {exc}") from exc

    if not isinstance(data, list) or not data:
        raise EvaluationError("Ground truth must be a non-empty JSON array")
    if any(not isinstance(row, dict) or not isinstance(row.get("fileName"), str) for row in data):
        raise EvaluationError("Every ground-truth entry must be an object with a fileName")
    names = [row["fileName"] for row in data]
    if len(names) != len(set(names)):
        raise EvaluationError("Ground truth contains duplicate fileName entries")
    return data


def validate_corpus(documents_dir: Path, ground_truth: list[dict[str, Any]]) -> list[tuple[Path, dict[str, Any]]]:
    expected_names = {row["fileName"] for row in ground_truth}
    actual_names = {path.name for path in documents_dir.glob("*.pdf")}
    if not documents_dir.is_dir():
        raise EvaluationError(f"PDF directory does not exist: {documents_dir}")

    missing_files = sorted(expected_names - actual_names)
    untracked_files = sorted(actual_names - expected_names)
    if missing_files or untracked_files:
        parts = []
        if missing_files:
            parts.append(f"ground-truth PDFs missing: {', '.join(missing_files)}")
        if untracked_files:
            parts.append(f"PDFs without ground truth: {', '.join(untracked_files)}")
        raise EvaluationError("; ".join(parts))

    return [(documents_dir / row["fileName"], row) for row in ground_truth]


def request_json(
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30,
) -> dict[str, Any]:
    request = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise EvaluationError(f"API returned HTTP {exc.code} for {url}: {body}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise EvaluationError(f"Cannot reach API at {url}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise EvaluationError(f"API returned invalid JSON for {url}: {exc}") from exc

    if not isinstance(payload, dict):
        raise EvaluationError(f"API returned an unexpected JSON shape for {url}")
    return payload


def multipart_upload(file_path: Path, language: str, doc_type: str, base_url: str) -> dict[str, Any]:
    boundary = f"----SupplierDesk{uuid.uuid4().hex}"
    safe_name = file_path.name.replace('"', "")
    file_bytes = file_path.read_bytes()
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'.encode(),
            b"Content-Type: application/pdf\r\n\r\n",
            file_bytes,
            b"\r\n",
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n{language}\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\n{doc_type}\r\n".encode(),
            f"--{boundary}--\r\n".encode(),
        ]
    )
    response = request_json(
        f"{api_root(base_url)}/documents",
        method="POST",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    if not response.get("id"):
        raise EvaluationError(f"Upload response for {file_path.name} did not include a document id")
    return response


def wait_for_document(document_id: str, base_url: str, timeout_seconds: int, poll_seconds: float) -> dict[str, Any]:
    url = f"{api_root(base_url)}/documents/{urllib.parse.quote(document_id, safe='')}"
    deadline = time.monotonic() + timeout_seconds
    while True:
        document = request_json(url)
        status = document.get("status")
        if status and status != "processing":
            return document
        if time.monotonic() >= deadline:
            raise EvaluationError(f"Timed out waiting for document {document_id}")
        time.sleep(poll_seconds)


def run_document(
    file_path: Path,
    truth: dict[str, Any],
    base_url: str,
    timeout_seconds: int,
    poll_seconds: float,
) -> dict[str, Any]:
    started = time.monotonic()
    upload = multipart_upload(
        file_path,
        str(truth.get("language") or "en"),
        str(truth.get("type") or "invoice"),
        base_url,
    )
    document = wait_for_document(upload["id"], base_url, timeout_seconds, poll_seconds)
    return {
        "fileName": file_path.name,
        "id": document.get("id", upload["id"]),
        "status": document.get("status"),
        "extracted": document.get("extracted"),
        "issues": document.get("issues") or [],
        "timing": document.get("timing"),
        "elapsedMs": round((time.monotonic() - started) * 1000),
    }


def field_matches(actual: Any, expected: Any) -> bool:
    if isinstance(actual, (int, float)) and not isinstance(actual, bool) and isinstance(expected, (int, float)):
        return abs(actual - expected) < NUMERIC_TOLERANCE
    return actual == expected


def evaluate_results(
    results: list[dict[str, Any]], ground_truth: list[dict[str, Any]]
) -> dict[str, Any]:
    results_by_name = {row.get("fileName"): row for row in results}
    truth_by_name = {row["fileName"]: row for row in ground_truth}
    if len(results_by_name) != len(results):
        raise EvaluationError("Evaluation results contain duplicate or missing fileName values")

    field_count = 0
    field_matches_count = 0
    true_positives = 0
    false_negatives = 0
    false_positives = 0
    clean_count = 0
    clean_flagged = 0
    status_matches = 0
    statuses_compared = 0
    elapsed_values = []
    server_times = []
    per_document = []

    for name, truth in truth_by_name.items():
        result = results_by_name.get(name)
        if result is None:
            per_document.append({"fileName": name, "error": "No pipeline result"})
            continue

        expected_fields = truth.get("extracted") or {}
        actual_fields = result.get("extracted") or {}
        field_details = {}
        for field, expected in expected_fields.items():
            matched = field_matches(actual_fields.get(field), expected)
            field_count += 1
            field_matches_count += int(matched)
            field_details[field] = {
                "expected": expected,
                "actual": actual_fields.get(field),
                "match": matched,
            }

        expected_issues = {
            issue.get("type") for issue in (truth.get("issues") or []) if issue.get("type")
        }
        actual_issues = {
            issue.get("type") for issue in (result.get("issues") or []) if issue.get("type")
        }
        true_positives += len(expected_issues & actual_issues)
        false_negatives += len(expected_issues - actual_issues)
        false_positives += len(actual_issues - expected_issues)

        expected_status = truth.get("expectedStatus")
        if expected_status is not None:
            statuses_compared += 1
            status_matches += int(result.get("status") == expected_status)

        is_clean = not expected_issues
        if is_clean:
            clean_count += 1
            flagged = bool(actual_issues) or result.get("status") in {"needs_review", "rejected"}
            clean_flagged += int(flagged)

        elapsed = result.get("elapsedMs")
        if isinstance(elapsed, (int, float)):
            elapsed_values.append(elapsed)
        server_total = (result.get("timing") or {}).get("totalMs")
        if isinstance(server_total, (int, float)):
            server_times.append(server_total)

        per_document.append(
            {
                "fileName": name,
                "expectedStatus": expected_status,
                "actualStatus": result.get("status"),
                "statusMatch": result.get("status") == expected_status if expected_status is not None else None,
                "expectedIssueTypes": sorted(expected_issues),
                "actualIssueTypes": sorted(actual_issues),
                "fieldResults": field_details,
                "elapsedMs": elapsed,
            }
        )

    processed = sum(1 for name in truth_by_name if name in results_by_name)
    return {
        "documentsExpected": len(ground_truth),
        "documentsProcessed": processed,
        "documentsMissing": len(ground_truth) - processed,
        "fieldAccuracy": field_matches_count / field_count if field_count else None,
        "fieldsCorrect": field_matches_count,
        "fieldsCompared": field_count,
        "errorCatchRate": true_positives / (true_positives + false_negatives)
        if true_positives + false_negatives
        else None,
        "issuesCaught": true_positives,
        "expectedIssues": true_positives + false_negatives,
        "falsePositiveIssues": false_positives,
        "falseAlarmRate": clean_flagged / clean_count if clean_count else None,
        "cleanDocumentsFlagged": clean_flagged,
        "cleanDocuments": clean_count,
        "statusAccuracy": status_matches / statuses_compared if statuses_compared else None,
        "statusesCorrect": status_matches,
        "statusesCompared": statuses_compared,
        "averageTotalMs": round(sum(elapsed_values) / len(elapsed_values)) if elapsed_values else None,
        "documentsTimed": len(elapsed_values),
        "averageServerTotalMs": round(sum(server_times) / len(server_times)) if server_times else None,
        "perDocument": per_document,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="Backend origin or /api URL")
    parser.add_argument("--documents", type=Path, default=DEFAULT_DOCUMENTS, help="Directory of PDF test documents")
    parser.add_argument("--ground-truth", type=Path, default=DEFAULT_GROUND_TRUTH, help="Ground-truth JSON array")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SECONDS, help="Maximum wait per document in seconds")
    parser.add_argument("--poll-interval", type=float, default=DEFAULT_POLL_SECONDS, help="Polling interval in seconds")
    parser.add_argument("--output", type=Path, help="Optional path for the full JSON evaluation report")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.timeout <= 0 or args.poll_interval <= 0:
            raise EvaluationError("--timeout and --poll-interval must be positive")
        truth = load_ground_truth(args.ground_truth)
        corpus = validate_corpus(args.documents, truth)
        results = []
        for index, (file_path, expected) in enumerate(corpus, start=1):
            print(f"[{index}/{len(corpus)}] Uploading {file_path.name}...", flush=True)
            result = run_document(
                file_path, expected, args.api_url, args.timeout, args.poll_interval
            )
            results.append(result)
            print(f"  {result['status']} in {result['elapsedMs']} ms", flush=True)

        report = {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "apiUrl": api_root(args.api_url),
            "groundTruth": str(args.ground_truth),
            "metrics": evaluate_results(results, truth),
            "results": results,
        }
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(f"Full report: {args.output}")

        print(json.dumps(report["metrics"], indent=2))
        if report["metrics"]["documentsMissing"]:
            return 1
        return 0
    except (EvaluationError, OSError) as exc:
        print(f"Evaluation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
