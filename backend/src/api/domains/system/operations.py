from datetime import datetime
from typing import Any, Dict

from src.api.core.app_state import config
from src.api.database import health_check as db_health_check


def get_health_payload() -> Dict[str, Any]:
    """
    Health check endpoint payload.
    Returns: overall status and database health
    """
    db_status = db_health_check()
    overall_status = "healthy" if db_status.get("status") == "healthy" else "degraded"
    
    return {
        "status": overall_status,
        "timestamp": datetime.now().isoformat(),
        "service": "multiminutes-api",
        "version": "1.0.0-beta",
        "database": db_status,
        "environment": config.environment,
    }


def get_healthz_payload() -> Dict[str, str]:
    """Minimal health check for load balancers (liveness probe)"""
    return {"status": "ok"}


def get_metrics_payload() -> Dict[str, Any]:
    """
    System metrics endpoint payload.
    Returns database pool stats, request counts, etc.
    """
    db_status = db_health_check()
    
    # Get additional metrics if available
    try:
        from src.cost.cost_logger import CostLogger
        cost_stats = CostLogger.get_monthly_stats()
    except Exception:
        cost_stats = {"error": "Cost tracking not available"}
    
    return {
        "timestamp": datetime.now().isoformat(),
        "database": db_status,
        "cost": cost_stats,
        "config": {
            "ai_provider": config.ai.provider,
            "environment": config.environment,
        }
    }
