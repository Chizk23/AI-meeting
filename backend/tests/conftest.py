import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api.database import Base, get_db
from src.api.main import app
from src.api.domains.admin.runtime import ADMIN_SYSTEM_SETTINGS


@pytest.fixture(autouse=True)
def _disable_maintenance_mode_in_tests():
    """Ensure maintenance mode is OFF for every test by default.

    The maintenance-mode middleware (P1 #9) blocks non-system-admin traffic
    when ADMIN_SYSTEM_SETTINGS["maintenance_mode"] is truthy. Production
    boot loads this from DB, but tests that don't monkey-patch the runtime
    session factory share state across modules — so we explicitly normalize
    it here. Individual tests can still flip the flag inside their test body.
    """
    ADMIN_SYSTEM_SETTINGS["maintenance_mode"] = False
    yield
    ADMIN_SYSTEM_SETTINGS["maintenance_mode"] = False


TEST_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def client(monkeypatch):
    # admin_runtime persists settings/prompts/broadcasts via a module-level
    # session factory. We point it at the in-memory test engine for the
    # duration of the test so admin operations do not bleed into the
    # developer's local sqlite file and so reload_admin_runtime_from_db
    # uses the freshly-seeded test database on startup.
    from src.api.core import admin_runtime as runtime
    monkeypatch.setattr(runtime, "_runtime_session_factory", TestingSessionLocal)
    Base.metadata.create_all(bind=test_engine)
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture()
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
