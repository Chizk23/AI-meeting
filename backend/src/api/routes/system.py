from fastapi import APIRouter

from src.api.domains.system.operations import get_health_payload, get_healthz_payload, get_metrics_payload

router = APIRouter(tags=["system"])

@router.get("/health")
def health():
    return get_health_payload()

@router.get("/healthz")
def healthz():
    return get_healthz_payload()

@router.get("/metrics")
def metrics():
    return get_metrics_payload()
