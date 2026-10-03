"""Unit tests for the CPU sim loop (Record -> Validate -> Train -> Serve -> Eval)."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from ohho.cli import main as cli_main
from ohho.data.reader import DatasetReader
from ohho.sim_loop import (
    compute_percentiles,
    format_summary,
    record_sim_episodes,
    run_sim_loop,
    validate_dataset,
    validate_schema,
)


class TestSimLoop(unittest.TestCase):
    def test_record_sim_episodes(self):
        with tempfile.TemporaryDirectory() as tmp:
            dataset_dir = os.path.join(tmp, "dataset")
            saved_path = record_sim_episodes(
                robot_id="omnibot",
                num_episodes=5,
                steps_per_episode=10,
                fps=10.0,
                output_dir=dataset_dir,
            )
            self.assertEqual(saved_path, dataset_dir)

            # Check meta files
            meta = Path(saved_path) / "meta"
            self.assertTrue((meta / "info.json").exists())
            self.assertTrue((meta / "tasks.jsonl").exists())
            self.assertTrue((meta / "episodes.jsonl").exists())
            self.assertTrue((meta / "stats.json").exists())

            # Check data files
            data_dir = Path(saved_path) / "data" / "chunk-000"
            for ep in range(5):
                pq = data_dir / f"episode_{ep:06d}.parquet"
                jl = data_dir / f"episode_{ep:06d}.jsonl"
                self.assertTrue(pq.exists() or jl.exists())

            reader = DatasetReader(saved_path)
            self.assertEqual(reader.episode_count, 5)
            self.assertEqual(reader.frame_count, 50)
            self.assertEqual(reader.state_dim, 9)
            self.assertEqual(reader.action_dim, 9)

    def test_validate_schema_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            dataset_dir = os.path.join(tmp, "dataset")
            record_sim_episodes(
                robot_id="omnibot",
                num_episodes=5,
                steps_per_episode=10,
                output_dir=dataset_dir,
            )
            self.assertTrue(validate_schema(dataset_dir))

            val_info = validate_dataset(dataset_dir)
            self.assertTrue(val_info["schema_valid"])
            self.assertEqual(val_info["total_episodes"], 5)
            self.assertEqual(val_info["total_frames"], 50)

    def test_validate_schema_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Empty directory
            with self.assertRaises(FileNotFoundError):
                validate_schema(tmp)

            # Corrupted info.json
            meta = Path(tmp) / "meta"
            meta.mkdir(parents=True)
            with open(meta / "info.json", "w", encoding="utf-8") as f:
                json.dump({"total_episodes": 0, "total_frames": 0}, f)
            with open(meta / "tasks.jsonl", "w", encoding="utf-8") as f:
                f.write('{"task": "test"}\n')
            with open(meta / "episodes.jsonl", "w", encoding="utf-8") as f:
                f.write('{"episode_index": 0}\n')

            with self.assertRaises(ValueError):
                validate_schema(tmp)

    def test_compute_percentiles(self):
        # Empty list
        self.assertEqual(compute_percentiles([]), (0.0, 0.0))

        # Single element
        self.assertEqual(compute_percentiles([42.0]), (42.0, 42.0))

        # Known range 1..100
        vals = list(range(1, 101))
        p50, p95 = compute_percentiles([float(x) for x in vals])
        self.assertAlmostEqual(p50, 50.5, delta=1.0)
        self.assertAlmostEqual(p95, 95.05, delta=1.5)

    def test_format_summary(self):
        metrics = {
            "episodes_recorded": 5,
            "total_frames": 100,
            "schema_valid": True,
            "lerobot_dataset_loaded": False,
            "model_name": "Tiny ACT (Action Chunking Transformer)",
            "train_steps": 200,
            "initial_loss": 0.8421,
            "final_loss": 0.0412,
            "eval_steps_taken": 50,
            "eval_errors": 0,
            "latency_p50_ms": 2.15,
            "latency_p95_ms": 4.50,
            "loss_curve": [(0, 0.8421), (100, 0.2011), (200, 0.0412)],
        }

        with tempfile.NamedTemporaryFile("w+", delete=False, encoding="utf-8") as tmp:
            tmp_path = tmp.name

        try:
            os.environ["GITHUB_STEP_SUMMARY"] = tmp_path
            summary = format_summary(metrics)

            self.assertIn("OhhO OS Nightly Sim Loop Summary", summary)
            self.assertIn("Sim Episodes Recorded", summary)
            self.assertIn("5 (100 total frames)", summary)
            self.assertIn("initial=0.8421 -> final=0.0412", summary)
            self.assertIn("50 steps (0 errors)", summary)
            self.assertIn("2.15 ms", summary)
            self.assertIn("4.50 ms", summary)
            self.assertIn("Train Loss Curve", summary)

            with open(tmp_path, encoding="utf-8") as f:
                content = f.read()
            self.assertEqual(content.strip(), summary.strip())
        finally:
            os.environ.pop("GITHUB_STEP_SUMMARY", None)
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def test_mock_sim_loop_end_to_end(self):
        with tempfile.TemporaryDirectory() as tmp:
            results = run_sim_loop(
                robot_id="omnibot",
                episodes=5,
                steps_per_episode=10,
                train_steps=100,
                eval_steps=50,
                output_dir=tmp,
                mock=True,
            )

            self.assertEqual(results["episodes_recorded"], 5)
            self.assertEqual(results["total_frames"], 50)
            self.assertTrue(results["schema_valid"])
            self.assertEqual(results["eval_steps_taken"], 50)
            self.assertEqual(results["eval_errors"], 0)
            self.assertGreaterEqual(results["latency_p50_ms"], 0.0)
            self.assertGreaterEqual(results["latency_p95_ms"], 0.0)
            self.assertIn("loss_curve", results)
            self.assertTrue(len(results["loss_curve"]) > 0)

            # Check output files
            ckpt_dir = Path(tmp) / "checkpoint"
            self.assertTrue((ckpt_dir / "config.json").exists())
            self.assertTrue((ckpt_dir / "metrics.json").exists())

    def test_cli_sim_loop(self):
        with tempfile.TemporaryDirectory() as tmp:
            rc = cli_main(
                [
                    "sim-loop",
                    "--mock",
                    "--episodes",
                    "5",
                    "--steps-per-episode",
                    "5",
                    "--eval-steps",
                    "50",
                    "--output-dir",
                    tmp,
                ]
            )
            self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
