"""28 offline regressions for the HTTP backend used by the web app.

External ephemerides are controlled fixtures; visibility, interval extraction,
disk caching, the job worker, and HTTP request handling run normally.
Run: python -m pytest tests/test_backend_regressions.py -v
"""

import json
import time
from copy import deepcopy
from threading import Event
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi.testclient import TestClient
from support import temporary_directory

from app import create_app
from app.services import scientific_jobs
from app.services.ephemerides import horizons as hz
from app.services.ephemerides import scenario as sc
from app.services.ephemerides import visibility as vis
from app.services.terrain.engine import TerrainError
from app.settings import Settings

MINUTE = 60_000
FLAT = {"azimuthDeg": [0, 90, 180, 270], "elevationDeg": [0, 0, 0, 0]}
TERRAIN = {
    "site": {"latDeg": -88.5, "lonEastDeg": 20},
    "observerHeightM": 2,
    "config": {"azimuthStepDeg": 1, "maxDistanceKm": 10},
}
PARAMETERS = {
    "terrainAnalysisId": "fixture-terrain",
    "startUtc": "1970-01-01T00:00:00Z",
    "stopUtc": "1970-01-01T01:00:00Z",
    "stepMinutes": 10,
    "includeContext": False,
    "minSunFraction": 0,
}


@pytest.fixture(autouse=True)
def no_external_requests(monkeypatch):
    def reject(*args, **kwargs):
        raise AssertionError("This suite must not contact external services")

    monkeypatch.setattr("requests.sessions.Session.request", reject)


def body(times, az=0, el=5, radius=0.266, distance=150e6):
    times = np.asarray(times, dtype=float)
    return {
        "times": times,
        "az": np.full(times.size, az, dtype=float),
        "el": np.full(times.size, el, dtype=float),
        "radius": np.full(times.size, radius),
        "distance": np.full(times.size, distance),
        "lit": np.ones(times.size),
    }


def interval(start, stop):
    return {
        "startMs": start,
        "endMs": stop,
        "startTruncated": False,
        "endTruncated": False,
    }


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    fixture = SimpleNamespace(
        root=tmp_path,
        terrain={"id": "fixture-terrain", "profile": deepcopy(FLAT)},
        parameters=deepcopy(PARAMETERS),
        sun_elevation=5,
    )

    def observe(root, profile, name, start, stop, minutes):
        times = np.arange(start, stop + 1, minutes * MINUTE)
        track = (
            body(times, el=fixture.sun_elevation)
            if name == "sun"
            else body(times, az=180, radius=0.95, distance=384_000)
        )
        return track, {"sha256": f"fixture-{name}"}

    fixture.observe = Mock(side_effect=observe)
    fixture.orbit = Mock(return_value={"source": "fixture-orbit"})
    fixture.calendar = Mock(return_value={"events": []})
    monkeypatch.setattr(sc.hz, "observe", fixture.observe)
    monkeypatch.setattr(sc.hz, "orbit", fixture.orbit)
    monkeypatch.setattr(sc, "eclipse_calendar", fixture.calendar)
    fixture.run = lambda: sc.calculate(
        fixture.root, fixture.parameters, fixture.terrain, lambda *args: None
    )
    return fixture


@pytest.fixture
def api(monkeypatch):
    # Queue order, limits and cancellation are easiest to pin down with one worker.
    monkeypatch.setenv("MEOWRIZON_SCIENTIFIC_WORKERS", "1")
    with temporary_directory() as root:
        settings = Settings(root)
        result = {"id": "fixture-terrain", "origin": "engine", "profile": deepcopy(FLAT)}
        calculate = Mock(return_value=result)
        monkeypatch.setattr(scientific_jobs, "calculate", calculate)
        with TestClient(create_app(settings)) as client:
            fixture = SimpleNamespace(
                client=client,
                settings=settings,
                calculate=calculate,
                result=result,
                releases=[],
            )
            try:
                yield fixture
            finally:
                for release in fixture.releases:
                    release.set()


def submit(api, height=2, consumer=None, priority="interactive"):
    headers = {"X-Job-Priority": priority}
    if consumer:
        headers["X-Job-Consumer"] = consumer
    return api.client.post(
        "/api/terrain-analyses",
        json={**TERRAIN, "observerHeightM": height},
        headers=headers,
    )


def wait_job(api, identifier, route="terrain-analyses"):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        response = api.client.get(f"/api/{route}/{identifier}")
        assert response.status_code == 200, response.text
        job = response.json()
        if job["status"] in {"completed", "failed"}:
            return job
        time.sleep(0.01)
    pytest.fail(f"Job {identifier} did not reach a terminal state")


def block_first_job(api, consumer="owner"):
    started, release = Event(), Event()
    api.releases.append(release)
    order = []

    def calculate(root, parameters, progress):
        order.append(parameters["observerHeightM"])
        if len(order) == 1:
            started.set()
            if not release.wait(5):
                raise RuntimeError("Test worker was not released")
        progress(0.5, "Fixture checkpoint")
        return api.result

    api.calculate.side_effect = calculate
    response = submit(api, consumer=consumer)
    assert response.status_code == 202
    assert started.wait(2), "Test worker did not start"
    return response.json(), release, order


def test_sunlit_percentage_uses_interpolated_duration_not_sample_count():
    times = np.array([0, 10, 20, 30]) * MINUTE
    windows = vis.intervals(times, [0, 1, 1, 0])
    assert windows == [interval(5 * MINUTE, 25 * MINUTE)]
    percentage = sum(w["endMs"] - w["startMs"] for w in windows) / times[-1] * 100
    assert percentage == pytest.approx(100 * 2 / 3)


def test_threshold_equality_keeps_the_full_period_and_marks_truncated_edges():
    assert vis.intervals([0, 100], [0.5, 0.5]) == [
        {"startMs": 0, "endMs": 100, "startTruncated": True, "endTruncated": True}
    ]


def test_touching_sun_and_earth_windows_have_no_shared_duration():
    assert vis.intersect([interval(0, 10), interval(20, 30)], [interval(10, 20)]) == []


def test_shared_availability_counts_only_overlapping_time():
    sun = [interval(0, 20), interval(40, 70)]
    earth = [interval(10, 50), interval(60, 80)]
    both = vis.intersect(sun, earth)
    assert both == [interval(10, 20), interval(40, 50), interval(60, 70)]
    assert sum(w["endMs"] - w["startMs"] for w in both) == 30


def test_runtime_horizon_interpolation_is_continuous_across_north():
    profile = {"azimuthDeg": [0, 90, 180, 270], "elevationDeg": [2, 5, 2, -1]}
    np.testing.assert_allclose(
        vis.horizon(profile, [-1, 359, 0, 360, 361]),
        [2 - 1 / 30, 2 - 1 / 30, 2, 2, 2 + 1 / 30],
    )


def test_disc_center_on_flat_horizon_has_exactly_half_visible():
    terrain, visible, occulted = vis.fractions(FLAT, body([0], el=0))
    np.testing.assert_array_equal(terrain, [0.5])
    np.testing.assert_array_equal(visible, [0.5])
    np.testing.assert_array_equal(occulted, [0])


def test_a_body_behind_the_sun_cannot_eclipse_it():
    sun = body([0])
    behind = body([0], radius=1, distance=300e6)
    _, clear, blocked = vis.fractions(FLAT, sun, behind)
    np.testing.assert_array_equal(clear, [1])
    np.testing.assert_array_equal(blocked, [0])
    behind["distance"][:] = 384_000
    _, clear, blocked = vis.fractions(FLAT, sun, behind)
    np.testing.assert_array_equal(clear, [0])
    np.testing.assert_array_equal(blocked, [1])


def test_angular_separation_takes_the_short_path_across_north():
    assert vis.separation(body([0], az=359.9, el=0), body([0], az=0.1, el=0))[0] == (
        pytest.approx(0.2, abs=1e-10)
    )


def test_runtime_track_interpolation_crosses_north_without_turning_south():
    track = body([0, 10])
    track["az"] = np.array([359.0, 1.0])
    interpolated = hz.interpolate(track, [0, 2.5, 5, 7.5, 10])
    np.testing.assert_allclose(interpolated["az"], [359, 359.5, 0, 0.5, 1])
    np.testing.assert_array_equal(interpolated["distance"], np.full(5, 150e6))


def test_horizons_cache_avoids_refetch_and_detects_corruption(tmp_path, monkeypatch):
    response = Mock()
    response.json.return_value = {"result": "fixture\n$$SOE\nrow\n$$EOE"}
    get = Mock(return_value=response)
    monkeypatch.setattr(hz.requests, "get", get)
    first = hz.request(tmp_path, {"COMMAND": "10"})
    assert hz.request(tmp_path, {"COMMAND": "10"}) == first
    get.assert_called_once()
    path = next((tmp_path / "data/ephemerides").glob("*.json"))
    record = json.loads(path.read_text())
    record["response"]["result"] += "tampered"
    path.write_text(json.dumps(record))
    with pytest.raises(TerrainError, match="checksum"):
        hz.request(tmp_path, {"COMMAND": "10"})
    get.assert_called_once()


def observer_record(second_minute=10):
    return {
        "url": "fixture://horizons",
        "parameters": {},
        "retrievedUtc": "1970-01-01T00:00:00Z",
        "sha256": "fixture",
        "response": {
            "result": "MEAN_ME\n$$SOE\n"
            "1970-01-01T00:00:00Z,,,359,2,75,1800,1\n"
            f"1970-01-01T00:{second_minute:02d}:00Z,,,1,4,80,1800,1\n$$EOE"
        },
    }


def observer_profile():
    return {
        "observer": {
            "site": {"latDeg": -88, "lonEastDeg": 20},
            "surfaceHeightM": 1000,
            "heightAboveSurfaceM": 2,
        }
    }


def test_observer_parser_converts_units_and_includes_observer_height(tmp_path, monkeypatch):
    request = Mock(return_value=observer_record())
    monkeypatch.setattr(hz, "request", request)
    track, provenance = hz.observe(tmp_path, observer_profile(), "sun", 0, 10 * MINUTE, 10)
    np.testing.assert_array_equal(track["radius"], [0.25, 0.25])
    np.testing.assert_array_equal(track["distance"], [hz.AU_KM, hz.AU_KM])
    np.testing.assert_array_equal(track["lit"], [0.75, 0.8])
    assert request.call_args.args[1]["SITE_COORD"].endswith(",1.002000000")
    assert provenance["sha256"] == "fixture"


def test_observer_parser_rejects_a_missing_sample(tmp_path, monkeypatch):
    monkeypatch.setattr(hz, "request", Mock(return_value=observer_record(second_minute=20)))
    with pytest.raises(TerrainError, match="time gap"):
        hz.observe(tmp_path, observer_profile(), "sun", 0, 20 * MINUTE, 10)


def test_scenario_retains_exact_end_time_for_a_partial_final_step(scenario):
    scenario.parameters["stopUtc"] = "1970-01-01T00:07:30Z"
    result = scenario.run()
    assert result["timesMs"] == [0, 7.5 * MINUTE]
    assert result["intervals"]["both"][0]["endMs"] == 7.5 * MINUTE
    assert scenario.observe.call_args.args[4] == 10 * MINUTE


def test_scenario_rejects_more_than_366_days_before_requesting_ephemerides(scenario):
    scenario.parameters["stopUtc"] = "1971-01-03T00:00:00Z"
    with pytest.raises(TerrainError, match="366 days"):
        scenario.run()
    scenario.observe.assert_not_called()


def test_scenario_rejects_excessive_samples_before_requesting_ephemerides(scenario):
    scenario.parameters.update(stopUtc="1970-02-20T00:00:00Z", stepMinutes=1)
    with pytest.raises(TerrainError, match="60,000"):
        scenario.run()
    scenario.observe.assert_not_called()


def test_changed_horizon_invalidates_measurements_even_with_same_receipt(scenario):
    first = scenario.run()
    assert first["intervals"]["sun"]
    scenario.terrain["profile"]["elevationDeg"] = [10, 10, 10, 10]
    second = scenario.run()
    assert second["intervals"]["sun"] == []
    assert scenario.observe.call_count == 4


def test_changed_dates_do_not_reuse_old_tracks(scenario):
    first = scenario.run()
    scenario.parameters.update(startUtc="1970-01-02T00:00:00Z", stopUtc="1970-01-02T01:00:00Z")
    second = scenario.run()
    assert first["timesMs"][0] == 0
    assert second["timesMs"][0] == 86_400_000
    assert scenario.observe.call_count == 4


def test_skipped_site_does_not_poison_cache_when_cutoff_is_disabled(scenario):
    scenario.sun_elevation = -5
    scenario.parameters["minSunFraction"] = 0.45
    assert scenario.run()["skipped"]
    assert not list((scenario.root / "cache/scenario-measurements").glob("*.json"))
    scenario.parameters["minSunFraction"] = 0
    result = scenario.run()
    assert "skipped" not in result
    assert result["intervals"]["sun"] == []
    assert result["intervals"]["earth"]
    assert scenario.observe.call_count == 3


def test_mutating_a_returned_result_does_not_change_cached_measurements(scenario):
    first = scenario.run()
    expected = deepcopy(first)
    first["sun"]["visibleFraction"][0] = -999
    first["intervals"]["sun"].clear()
    assert scenario.run() == expected
    assert scenario.observe.call_count == 2


def test_optional_context_failure_preserves_completed_measurements(scenario):
    scenario.parameters["includeContext"] = True
    scenario.orbit.side_effect = RuntimeError("Fixture context service unavailable")
    with pytest.raises(RuntimeError, match="context service"):
        scenario.run()
    scenario.parameters["includeContext"] = False
    result = scenario.run()
    assert result["intervals"]["sun"]
    assert "orbit" not in result
    assert scenario.observe.call_count == 2


def test_unknown_consumer_cannot_cancel_another_clients_job(api):
    job, release, _ = block_first_job(api)
    response = api.client.delete(
        f"/api/terrain-analyses/{job['id']}", headers={"X-Job-Consumer": "stranger"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "running"
    release.set()
    assert wait_job(api, job["id"])["status"] == "completed"


def test_cancel_after_completion_preserves_result_and_cache(api):
    job = submit(api, consumer="owner").json()
    completed = wait_job(api, job["id"])
    assert completed["status"] == "completed"
    response = api.client.delete(
        f"/api/terrain-analyses/{job['id']}", headers={"X-Job-Consumer": "owner"}
    )
    assert response.json()["result"] == completed["result"]
    assert submit(api).json()["id"] == job["id"]
    api.calculate.assert_called_once()


def test_promoting_queued_background_job_executes_it_only_once(api):
    first, release, order = block_first_job(api)
    background = submit(api, height=3, consumer="background", priority="background").json()
    other = submit(api, height=4, priority="background").json()
    promoted = submit(api, height=3, consumer="interactive").json()
    assert promoted["id"] == background["id"]
    release.set()
    for job in (first, background, other):
        assert wait_job(api, job["id"])["status"] == "completed"
    assert order == [2, 3, 4]
    assert api.calculate.call_count == 3


def test_restart_marks_abandoned_jobs_failed_instead_of_leaving_them_running(monkeypatch):
    with temporary_directory() as root:
        settings = Settings(root)
        directory = settings.jobs / "scientific"
        directory.mkdir(parents=True)
        identifier = "a" * 32
        record = {
            "kind": "terrain",
            "parameters": TERRAIN,
            "key": "interrupted-fixture",
            "job": {"id": identifier, "status": "running", "progress": 0.3},
        }
        path = directory / f"{identifier}.json"
        path.write_text(json.dumps(record))
        calculate = Mock()
        monkeypatch.setattr(scientific_jobs, "calculate", calculate)
        service = scientific_jobs.ScientificJobs(settings)
        service.start()
        try:
            job = service.get("terrain", identifier)
            assert job["status"] == "failed"
            assert job["error"]["code"] == "service_interrupted"
            assert json.loads(path.read_text())["job"] == job
            calculate.assert_not_called()
        finally:
            service.close()


def test_unexpected_worker_exception_has_a_safe_actionable_api_error(api):
    api.calculate.side_effect = RuntimeError("fixture-private-internal-detail")
    job = submit(api).json()
    failed = wait_job(api, job["id"])
    assert failed["status"] == "failed"
    assert failed["error"]["code"] == "terrain_data_unavailable"
    assert "fixture-private" not in json.dumps(failed)
    assert "retry" in failed["error"]["message"].lower()
    assert "result" not in failed


def test_unknown_request_fields_are_rejected_without_scheduling_work(api):
    response = api.client.post("/api/terrain-analyses", json={**TERRAIN, "rankBy": "sun"})
    assert response.status_code == 422
    api.calculate.assert_not_called()
    assert not list((api.settings.jobs / "scientific").glob("*.json"))


def test_background_queue_limit_leaves_capacity_for_interactive_work(api):
    _, release, _ = block_first_job(api)
    for height in range(3, 10):
        assert submit(api, height=height, priority="background").status_code == 202
    rejected = submit(api, height=10, priority="background")
    assert rejected.status_code == 429
    assert "queue is full" in rejected.json()["detail"]
    interactive = submit(api, height=10)
    assert interactive.status_code == 202
    release.set()
    assert wait_job(api, interactive.json()["id"])["status"] == "completed"


def test_scenario_api_resolves_terrain_result_id_and_returns_calculation(api, monkeypatch):
    terrain_job = submit(api).json()
    assert wait_job(api, terrain_job["id"])["status"] == "completed"
    result = {"id": "fixture-scenario", "origin": "engine", "timesMs": [0, 60 * MINUTE]}
    calculate = Mock(return_value=result)
    monkeypatch.setattr(scientific_jobs, "calculate_scenario", calculate)
    response = api.client.post("/api/scenario-evaluations", json=PARAMETERS)
    assert response.status_code == 202
    job = wait_job(api, response.json()["id"], "scenario-evaluations")
    assert job["status"] == "completed"
    assert job["result"] == result
    assert calculate.call_args.args[2] == api.result
    assert calculate.call_args.args[1]["terrainAnalysisId"] != terrain_job["id"]
