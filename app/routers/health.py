from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app
from app.db import get_db
from app.models import User

router = APIRouter()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    user_count = db.scalar(select(func.count()).select_from(User)) or 0
    return {
        "status": "ok",
        "app": app.APP_NAME,
        "version": app.__version__,
        "setup_complete": user_count > 0,
    }
