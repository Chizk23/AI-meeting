from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.api import auth, schemas
from src.api.domains.search.operations import search_entities_payload
from src.api.database import get_db

router = APIRouter(tags=["search"])

@router.get("/api/search", response_model=List[schemas.SearchResult])
def search_entities(
    q: str = Query(..., min_length=2),
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return search_entities_payload(q, db, current_user)
