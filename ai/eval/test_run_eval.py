import unittest

from run_eval import EvaluationError, evaluate_results, validate_corpus


class EvaluationTests(unittest.TestCase):
    def test_computes_field_issue_false_alarm_and_status_metrics(self):
        truth = [
            {
                "fileName": "clean.pdf",
                "extracted": {"total": 100, "invoiceNumber": "INV-1"},
                "expectedStatus": "auto_approved",
                "issues": [],
            },
            {
                "fileName": "bad.pdf",
                "extracted": {"total": 50},
                "expectedStatus": "needs_review",
                "issues": [{"type": "PRICE_MISMATCH"}],
            },
        ]
        results = [
            {
                "fileName": "clean.pdf",
                "status": "auto_approved",
                "extracted": {"total": 100.005, "invoiceNumber": "INV-1"},
                "issues": [],
                "elapsedMs": 100,
                "timing": {"totalMs": 80},
            },
            {
                "fileName": "bad.pdf",
                "status": "needs_review",
                "extracted": {"total": 50},
                "issues": [{"type": "PRICE_MISMATCH"}],
                "elapsedMs": 300,
                "timing": {"totalMs": 250},
            },
        ]

        metrics = evaluate_results(results, truth)

        self.assertEqual(metrics["documentsProcessed"], 2)
        self.assertEqual(metrics["fieldAccuracy"], 1)
        self.assertEqual(metrics["errorCatchRate"], 1)
        self.assertEqual(metrics["falseAlarmRate"], 0)
        self.assertEqual(metrics["statusAccuracy"], 1)
        self.assertEqual(metrics["averageTotalMs"], 200)
        self.assertEqual(metrics["averageServerTotalMs"], 165)

    def test_missing_result_is_counted_and_not_included_in_accuracy(self):
        truth = [{"fileName": "missing.pdf", "extracted": {"total": 4}, "issues": []}]
        metrics = evaluate_results([], truth)

        self.assertEqual(metrics["documentsMissing"], 1)
        self.assertEqual(metrics["fieldsCompared"], 0)
        self.assertIsNone(metrics["fieldAccuracy"])

    def test_rejects_pdf_without_ground_truth(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            Path(temp_dir, "untracked.pdf").write_bytes(b"%PDF-")
            with self.assertRaisesRegex(EvaluationError, "without ground truth"):
                validate_corpus(Path(temp_dir), [])


if __name__ == "__main__":
    unittest.main()
