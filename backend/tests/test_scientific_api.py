"""Exercise the existing HttpProvider payloads without inventing scientific results."""

import json
import time
import unittest
from copy import deepcopy
from threading import Barrier, Event
from unittest.mock import patch

from fastapi.testclient import TestClient
from support import temporary_directory

from app import create_app
from app.services.scientific_jobs import ScientificJobs
from app.settings import Settings

TERRAIN = {
    "site": {"latDeg": -89.67, "lonEastDeg": 129.8},
    "observerHeightM": 2,
    "config": {"azimuthStepDeg": 0.5, "maxDistanceKm": 150},
}
SCENARIO = {
    "terrainAnalysisId": "terrain-result-id",
    "startUtc": "2026-11-15T00:17:00.000Z",
    "stopUtc": "2026-12-15T00:17:00.000Z",
    "stepMinutes": 30,
}


class ScientificApiTests(unittest.TestCase):
    def setUp(self):
        temporary = temporary_directory()
        self.addCleanup(temporary.cleanup)
        self.settings = Settings(temporary.name)
        self.result = {
            "id": "unit-test-result",
            "origin": "engine",
            "preview": False,
            "profile": {},
        }
        self.calculate = self.enterContext(
            patch("app.services.scientific_jobs.calculate", return_value=self.result)
        )
        # Queue order and cancellation are easiest to pin down with one worker.
        self.enterContext(patch.dict("os.environ", {"MEOWRIZON_SCIENTIFIC_WORKERS": "1"}))
        self.client = self.enterContext(TestClient(create_app(self.settings)))

    def wait_job(self, route, identifier):
        for _ in range(200):
            response = self.client.get(f"/api/{route}/{identifier}")
            self.assertEqual(response.status_code, 200)
            job = response.json()
            if job["status"] in {"completed", "failed"}:
                return job
            time.sleep(0.01)
        self.fail("Scientific job did not finish")

    def test_frontend_requests_polling_and_persistence(self):
        for route, kind, payload in (
            ("terrain-analyses", "terrain", TERRAIN),
            ("scenario-evaluations", "scenario", SCENARIO),
        ):
            with self.subTest(route=route):
                response = self.client.post(f"/api/{route}", json=payload)
                self.assertEqual(response.status_code, 202)
                job = self.wait_job(route, response.json()["id"])
                if kind == "terrain":
                    self.assertEqual(job["status"], "completed")
                    self.assertEqual(job["result"], self.result)
                    cached = self.client.post(f"/api/{route}", json=payload).json()
                    self.assertEqual(cached, job)
                    self.calculate.assert_called_once()
                else:
                    self.assertEqual(job["status"], "failed")
                    self.assertEqual(job["error"]["code"], "scenario_data_unavailable")
                    self.assertIn("Terrain analysis not found", job["error"]["message"])
                    self.assertNotIn("result", job)
                self.assertEqual(self.client.get(f"/api/{route}/{job['id']}").json(), job)
                # A new service instance reads the same terminal state after restart.
                self.assertEqual(ScientificJobs(self.settings).get(kind, job["id"]), job)
                saved = json.loads(
                    (self.settings.jobs / "scientific" / f"{job['id']}.json").read_text()
                )
                expected = payload if kind == "terrain" else {"includeContext": True, **payload}
                self.assertEqual(saved["parameters"], expected)
                other = "scenario-evaluations" if kind == "terrain" else "terrain-analyses"
                self.assertEqual(self.client.get(f"/api/{other}/{job['id']}").status_code, 404)

    def test_sunlight_screening_is_cached_separately_from_full_evaluations(self):
        self.result["id"] = SCENARIO["terrainAnalysisId"]
        terrain = self.client.post("/api/terrain-analyses", json=TERRAIN).json()
        self.assertEqual(self.wait_job("terrain-analyses", terrain["id"])["status"], "completed")
        skipped = {
            "skipped": True,
            "origin": "engine",
            "reason": "sunlight_below_threshold",
            "terrainAnalysisId": SCENARIO["terrainAnalysisId"],
            "minSunFraction": 0.45,
            "sunFractionUpperBound": 0.3,
        }
        with patch("app.services.scientific_jobs.calculate_scenario", return_value=skipped) as calc:
            payload = {**SCENARIO, "includeContext": False, "minSunFraction": 0.45}
            submitted = self.client.post("/api/scenario-evaluations", json=payload).json()
            job = self.wait_job("scenario-evaluations", submitted["id"])
            self.assertEqual(job["status"], "completed")
            self.assertEqual(job["result"], skipped)
            self.assertEqual(
                self.client.post("/api/scenario-evaluations", json=payload).json(), job
            )
            calc.assert_called_once()
            self.assertEqual(calc.call_args.args[1], payload)
            full = self.client.post("/api/scenario-evaluations", json=SCENARIO).json()
            self.assertNotEqual(full["id"], job["id"])
            self.wait_job("scenario-evaluations", full["id"])
            self.assertEqual(calc.call_count, 2)

    def test_concurrent_duplicate_is_one_job(self):
        started, release = Event(), Event()

        def calculate(root, parameters, progress):
            progress(0.4, "Computing test fixture")
            started.set()
            if not release.wait(5):
                raise RuntimeError("Test did not release worker")
            return self.result

        self.calculate.side_effect = calculate
        first = self.client.post("/api/terrain-analyses", json=TERRAIN).json()
        try:
            self.assertTrue(started.wait(2))
            second = self.client.post("/api/terrain-analyses", json=TERRAIN).json()
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(second["status"], "running")
            self.assertEqual(second["progress"], 0.4)
        finally:
            release.set()
        self.assertEqual(self.wait_job("terrain-analyses", first["id"])["status"], "completed")
        self.calculate.assert_called_once()

    def test_failure_is_retryable_and_restart_reuses_completed_result(self):
        from app.services.terrain.engine import TerrainError

        self.calculate.side_effect = TerrainError("NoData on ray")
        first = self.client.post("/api/terrain-analyses", json=TERRAIN).json()
        failed = self.wait_job("terrain-analyses", first["id"])
        self.assertEqual(failed["error"]["message"], "NoData on ray")
        self.assertNotIn("result", failed)
        self.calculate.side_effect = None
        second = self.client.post("/api/terrain-analyses", json=TERRAIN).json()
        self.assertNotEqual(first["id"], second["id"])
        completed = self.wait_job("terrain-analyses", second["id"])
        service = ScientificJobs(self.settings)
        service.start()
        try:
            # The HTTP boundary canonicalizes all Number fields to floats.
            saved = json.loads(
                (self.settings.jobs / "scientific" / f"{second['id']}.json").read_text()
            )
            self.assertEqual(service.submit("terrain", saved["parameters"]), completed)
        finally:
            service.close()

    def test_several_sites_are_calculated_at_the_same_time(self):
        # Each job waits until the other has started: one worker alone would time out.
        both = Barrier(2, timeout=5)

        def calculate(root, parameters, progress):
            both.wait()
            return {**self.result, "id": f"site-{parameters['site']['latDeg']}"}

        self.calculate.side_effect = calculate
        service = ScientificJobs(self.settings, workers=2)
        service.start()
        try:
            jobs = [
                service.submit("terrain", {**TERRAIN, "site": {"latDeg": lat, "lonEastDeg": 0}})
                for lat in (-89.0, -88.0)
            ]
            for job in jobs:
                for _ in range(500):
                    done = service.get("terrain", job["id"])
                    if done["status"] in {"completed", "failed"}:
                        break
                    time.sleep(0.01)
                self.assertEqual(done["status"], "completed")
        finally:
            service.close()

    def test_interactive_jobs_overtake_queued_background_jobs(self):
        started, release = Event(), Event()
        order = []

        def calculate(root, parameters, progress):
            height = parameters["observerHeightM"]
            order.append(height)
            if height == 2:
                started.set()
                if not release.wait(5):
                    raise RuntimeError("Worker not released")
            return self.result

        self.calculate.side_effect = calculate
        first = self.client.post("/api/terrain-analyses", json=TERRAIN).json()
        try:
            self.assertTrue(started.wait(2))
            background = self.client.post(
                "/api/terrain-analyses",
                json={**TERRAIN, "observerHeightM": 3},
                headers={"X-Job-Priority": "background"},
            ).json()
            interactive = self.client.post(
                "/api/terrain-analyses",
                json={**TERRAIN, "observerHeightM": 4},
            ).json()
        finally:
            release.set()
        for job in (first, background, interactive):
            self.assertEqual(self.wait_job("terrain-analyses", job["id"])["status"], "completed")
        self.assertEqual(order, [2, 4, 3])

    def test_cancellation_respects_shared_consumers_and_discards_queued_jobs(self):
        started, release = Event(), Event()

        def calculate(root, parameters, progress):
            started.set()
            if not release.wait(5):
                raise RuntimeError("Worker not released")
            progress(0.5, "Cancellation checkpoint")
            return self.result

        self.calculate.side_effect = calculate
        route = "/api/terrain-analyses"
        first = self.client.post(route, json=TERRAIN, headers={"X-Job-Consumer": "first"}).json()
        try:
            self.assertTrue(started.wait(2))
            second = self.client.post(
                route, json=TERRAIN, headers={"X-Job-Consumer": "second"}
            ).json()
            self.assertEqual(first["id"], second["id"])
            url = f"{route}/{first['id']}"
            self.assertEqual(self.client.delete(url).status_code, 400)
            job = self.client.delete(url, headers={"X-Job-Consumer": "first"}).json()
            self.assertEqual(job["status"], "running")
            queued = self.client.post(
                route, json={**TERRAIN, "observerHeightM": 3}, headers={"X-Job-Consumer": "queued"}
            ).json()
            cancelled = self.client.delete(
                f"{route}/{queued['id']}", headers={"X-Job-Consumer": "queued"}
            ).json()
            self.assertEqual(cancelled["error"]["code"], "cancelled")
            self.client.delete(url, headers={"X-Job-Consumer": "second"})
        finally:
            release.set()
        self.assertEqual(
            self.wait_job("terrain-analyses", first["id"])["error"]["code"], "cancelled"
        )
        self.calculate.assert_called_once()
        retry = self.client.post(route, json=TERRAIN).json()
        self.assertNotEqual(retry["id"], first["id"])
        self.assertEqual(self.wait_job("terrain-analyses", retry["id"])["status"], "completed")

    def test_obsolete_earth_projection_preview_is_not_served(self):
        self.assertEqual(
            self.client.get("/api/terrain-preview/connecting-ridge.png").status_code, 410
        )

    def test_invalid_payloads_do_not_create_job_files(self):
        for path, value in (
            (("site", "latDeg"), 91),
            (("site", "latDeg"), -90),
            (("site", "latDeg"), "-89"),
            (("site", "lonEastDeg"), True),
            (("observerHeightM",), -1),
            (("includeLocalTerrain",), "true"),
            (("config", "azimuthStepDeg"), 0),
            (("config", "azimuthStepDeg"), 7),
            (("config", "maxDistanceKm"), 0),
        ):
            payload = deepcopy(TERRAIN)
            target = payload
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            response = self.client.post("/api/terrain-analyses", json=payload)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertIsInstance(response.json()["detail"], str)
        for key, value in (
            ("stopUtc", SCENARIO["startUtc"]),
            ("startUtc", "yesterday"),
            ("startUtc", "2026-11-15T00:00:00+01:00"),
            ("horizonMode", "flat"),
            ("stepMinutes", True),
            ("stepMinutes", 0),
            ("minSunFraction", -0.01),
            ("minSunFraction", 1.01),
            ("minSunFraction", True),
            ("minSunFraction", "0.45"),
        ):
            response = self.client.post("/api/scenario-evaluations", json={**SCENARIO, key: value})
            self.assertEqual(response.status_code, 422, response.text)
        # JSON numeric NaN is rejected cleanly rather than breaking error serialization.
        payload = json.dumps(TERRAIN).replace("129.8", "NaN")
        self.assertEqual(
            self.client.post("/api/terrain-analyses", content=payload).status_code, 422
        )
        self.assertFalse(list(self.settings.jobs.rglob("*.json")))

    def test_normalization_unknown_jobs_and_separate_acquisition_store(self):
        payload = deepcopy(TERRAIN)
        payload["site"]["lonEastDeg"] = 489.8
        job = self.client.post("/api/terrain-analyses", json=payload).json()
        self.wait_job("terrain-analyses", job["id"])
        record = json.loads((self.settings.jobs / "scientific" / f"{job['id']}.json").read_text())
        self.assertAlmostEqual(record["parameters"]["site"]["lonEastDeg"], 129.8)
        self.assertEqual(self.client.get(f"/api/data/jobs/{job['id']}").status_code, 404)
        self.assertEqual(self.client.get("/api/terrain-analyses/unknown").status_code, 404)
        self.assertEqual(self.client.get(f"/api/terrain-analyses/{'0' * 32}").status_code, 404)

    def test_openapi_describes_only_the_implemented_boundary(self):
        paths = self.client.get("/api/openapi.json").json()["paths"]
        for name in ("terrain-analyses", "scenario-evaluations"):
            self.assertIn("post", paths[f"/api/{name}"])
            self.assertIn("get", paths[f"/api/{name}/{{jobId}}"])
        self.assertNotIn("/api/ranking", paths)
        self.assertNotIn("/api/globe-state", paths)
