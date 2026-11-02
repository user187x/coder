"""Transactional Postgres backing for retained platform settings and connection policies."""
import contextlib
import copy
import json
import os
import threading


class Documents:
    def __init__(self, pool):
        self.pool = pool
        self.ready = False
        self.lock = threading.Lock()
        self.current = threading.local()

    def database(self):
        pool = self.pool()
        if pool is None:
            raise RuntimeError('Shared platform storage is unavailable.')
        with self.lock:
            if not self.ready:
                pool.query('CREATE SCHEMA IF NOT EXISTS coder_ui_updates')
                pool.query("""CREATE TABLE IF NOT EXISTS coder_ui_updates.documents (
                    name text PRIMARY KEY, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())""")
                self.ready = True
        return pool

    @contextlib.contextmanager
    def state(self, name, default, write=False, legacy=None):
        active = getattr(self.current, 'states', {})
        if name in active:
            yield active[name]
            return
        pool = self.database()
        with pool.transaction() as db:
            # Serialize first-time import and subsequent policy updates across replicas.
            db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['coder-ui-state:' + name])
            rows = db.query('SELECT body::text FROM coder_ui_updates.documents WHERE name = $1 FOR UPDATE', [name])
            if rows:
                data = json.loads(rows[0][0])
            else:
                data = legacy() if legacy is not None else copy.deepcopy(default)
                db.query('INSERT INTO coder_ui_updates.documents(name, body) VALUES ($1, $2::jsonb)', [name, json.dumps(data, allow_nan=False)])
            self.current.states = {**active, name: data}
            try:
                yield data
                if write:
                    db.query('UPDATE coder_ui_updates.documents SET body=$2::jsonb, updated_at=now() WHERE name=$1',
                             [name, json.dumps(self.current.states[name], allow_nan=False)])
            finally:
                self.current.states = active

    def read(self, name, default, legacy=None):
        with self.state(name, default, legacy=legacy) as data:
            return copy.deepcopy(data)

    @staticmethod
    def legacy_file(path, default):
        try:
            with open(path) as source:
                return json.load(source)
        except FileNotFoundError:
            return copy.deepcopy(default)

    def file_state(self, path, default, write=False):
        return self.state('file:' + os.path.basename(path), default, write,
                          lambda: self.legacy_file(path, default))

    def read_file(self, path, default=None):
        with self.file_state(path, default) as data:
            return copy.deepcopy(data)

    def write_file(self, path, data):
        # Replace the document rather than merging security policy or revocation records.
        name = 'file:' + os.path.basename(path)
        active = getattr(self.current, 'states', {})
        if name in active:
            active[name] = copy.deepcopy(data)
            return
        with self.database().transaction() as db:
            db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['coder-ui-state:' + name])
            db.query('''INSERT INTO coder_ui_updates.documents(name, body) VALUES($1, $2::jsonb)
                ON CONFLICT(name) DO UPDATE SET body=EXCLUDED.body, updated_at=now()''', [name, json.dumps(data, allow_nan=False)])
