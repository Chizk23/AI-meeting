from typing import Any, Dict

from fastapi import HTTPException

from src.api.domains.meetings.upload_jobs import create_retry_job, get_upload_job, start_upload_job

def get_job_status_payload(job_id: str) -> Dict[str, Any]:
    job = get_upload_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job.snapshot()


def retry_job_payload(job_id: str) -> Dict[str, Any]:
    try:
        retry_job = create_retry_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    start_upload_job(retry_job)
    return retry_job.snapshot()
