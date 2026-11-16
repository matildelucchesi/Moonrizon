"""Persistent terrain jobs, a small worker pool, immutable completed results and polling.

Several sites are calculated at once (the compare screen asks for up to four). Each
worker takes the next job from one shared priority queue. Cached files are written
atomically, and JPL Horizons requests still go one at a time through the collection lock.
"""

import hashlib
import heapq
import itertools
import json
import logging
import os
import re
import threading
import uuid
from datetime import UTC, datetime

from .ephemerides.scenario import VERSION as SCENARIO_VERSION
from .ephemerides.scenario import calculate as calculate_scenario
from .storage import _write_json
from .terrain.engine import VERSION, TerrainError, calculate

LOG = logging.getLogger(__name__)


def default_workers():
    """MEOWRIZON_SCIENTIFIC_WORKERS, or 4: one per site on the compare screen."""
    try:
        return max(1, int(os.environ.get("MEOWRIZON_SCIENTIFIC_WORKERS", "4")))
    except ValueError:
        return 4


class JobCancelled(Exception):
    pass


class ScientificJobs:
    def __init__(self, settings, workers=None):
        self.root = settings.root
        self.directory = settings.jobs / "scientific"
        self.size = workers or default_workers()
        self.workers = []
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.queue = []
        self.sequence = itertools.count()
        self.live = {}
        self.stopping = False
        self.pending = {}

    def start(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        for path in self.directory.glob("*.json"):
            record = json.loads(path.read_text())
            if record["job"]["status"] in {"queued", "running"}:
                record["job"] = {
                    "id": record["job"]["id"],
                    "status": "failed",
                    "error": {
                        "code": "service_interrupted",
                        "message": "Service stopped during calculation. Retry the request.",
                    },
                }
                _write_json(path, record)
        self.workers = [
            threading.Thread(target=self._work, name=f"scientific-{n}", daemon=True)
            for n in range(self.size)
        ]
        for worker in self.workers:
            worker.start()

    def close(self):
        with self.condition:
            self.stopping = True
            for record in self.live.values():
                record["cancelled"] = True
            self.condition.notify_all()
        for worker in self.workers:
            worker.join()

    def _enqueue(self, record, priority):
        heapq.heappush(self.queue, (priority, next(self.sequence), record))
        self.condition.notify()

    def _work(self):
        while True:
            with self.condition:
                while not self.queue and not self.stopping:
                    self.condition.wait()
                if self.stopping:
                    return
                _, _, record = heapq.heappop(self.queue)
                if record.get("started") or record.get("cancelled"):
                    continue
                record["started"] = True
            self._run(record)

    def submit(self, kind, parameters, priority="interactive", consumer=None):
        key = hashlib.sha256(
            json.dumps([VERSION, SCENARIO_VERSION, kind, parameters], sort_keys=True).encode()
        ).hexdigest()
        with self.lock:
            if key in self.pending:
                record = self.live[self.pending[key]]
                record["consumers"].add(consumer)
                if priority == "interactive" and not record.get("started"):
                    self._enqueue(record, 0)
                return self.get(kind, self.pending[key])
            for path in self.directory.glob("*.json"):
                saved = json.loads(path.read_text())
                if saved.get("key") == key and saved["job"]["status"] == "completed":
                    return saved["job"]
            if len(self.pending) >= (16 if priority == "interactive" else 8):
                raise ValueError("Terrain queue is full; wait for a current job to finish.")
            identifier = uuid.uuid4().hex
            record = {
                "kind": kind,
                "parameters": parameters,
                "key": key,
                "createdAt": datetime.now(UTC).isoformat(),
                "job": {
                    "id": identifier,
                    "status": "queued",
                    "progress": 0,
                    "message": "Terrain request queued",
                },
            }
            self._save(record)
            if not self.workers:
                raise RuntimeError("Scientific worker not started")
            self.pending[key] = identifier
            record.update(consumers={consumer}, cancelled=False, started=False)
            self.live[identifier] = record
            self._enqueue(record, 0 if priority == "interactive" else 1)
            return dict(record["job"])

    def _save(self, record):
        persisted = {
            k: v for k, v in record.items() if k not in {"consumers", "cancelled", "started"}
        }
        with self.lock:
            _write_json(self.directory / f"{record['job']['id']}.json", persisted)

    def _run(self, record):
        identifier = record["job"]["id"]

        def progress(value, message):
            if record.get("cancelled"):
                raise JobCancelled()
            record["job"] = {
                "id": identifier,
                "status": "running",
                "progress": value,
                "message": message,
            }
            self._save(record)

        try:
            progress(0, "Starting scientific calculation")
            if record["kind"] == "terrain":
                result = calculate(self.root, record["parameters"], progress)
            else:
                terrain = self.terrain_result(record["parameters"]["terrainAnalysisId"])
                result = calculate_scenario(self.root, record["parameters"], terrain, progress)
            if record.get("cancelled"):
                raise JobCancelled()
            record["job"] = {
                "id": identifier,
                "status": "completed",
                "progress": 1,
                "result": result,
            }
        except JobCancelled:
            record["job"] = self._cancelled_job(identifier)
        except Exception as exc:
            if isinstance(exc, TerrainError):
                LOG.warning("Scientific job %s: %s", identifier, exc)
            else:
                LOG.exception("Scientific calculation failed")
            record["job"] = {
                "id": identifier,
                "status": "failed",
                "error": {
                    "code": "terrain_data_unavailable"
                    if record["kind"] == "terrain"
                    else "scenario_data_unavailable",
                    "message": str(exc)
                    if isinstance(exc, TerrainError)
                    else "A source could not be loaded. Check backend logs and retry.",
                },
            }
        finally:
            with self.lock:
                try:
                    self._save(record)
                finally:
                    if self.pending.get(record["key"]) == identifier:
                        self.pending.pop(record["key"], None)
                    self.live.pop(identifier, None)

    @staticmethod
    def _cancelled_job(identifier):
        return {
            "id": identifier,
            "status": "failed",
            "error": {"code": "cancelled", "message": "Calculation cancelled."},
        }

    def cancel(self, kind, identifier, consumer):
        with self.lock:
            job = self.get(kind, identifier)
            record = self.live.get(identifier)
            if record is None or consumer not in record["consumers"]:
                return job
            record["consumers"].discard(consumer)
            if record["consumers"]:
                return job
            record["cancelled"] = True
            if self.pending.get(record["key"]) == identifier:
                self.pending.pop(record["key"], None)
            if not record["started"]:
                record["job"] = self._cancelled_job(identifier)
                self._save(record)
                self.live.pop(identifier, None)
            return dict(record["job"])

    def get(self, kind, identifier):
        if not re.fullmatch(r"[a-f0-9]{32}", identifier):
            raise KeyError(identifier)
        with self.lock:
            record = self.live.get(identifier)
            if record is None:
                try:
                    record = json.loads((self.directory / f"{identifier}.json").read_text())
                except FileNotFoundError as exc:
                    raise KeyError(identifier) from exc
            if record["kind"] != kind:
                raise KeyError(identifier)
            return dict(record["job"])

    def terrain_result(self, identifier):
        for path in self.directory.glob("*.json"):
            record = json.loads(path.read_text())
            job = record["job"]
            if record["kind"] == "terrain" and job["status"] == "completed":
                if job["result"]["id"] == identifier:
                    return job["result"]
        raise TerrainError("Terrain analysis not found. Calculate terrain before its scenario.")
