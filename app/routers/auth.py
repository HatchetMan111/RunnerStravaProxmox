from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app
from app.auth import (
    check_login_rate_limit,
    get_current_user,
    hash_password,
    issue_token,
    register_login_attempt,
    verify_password,
)
from app.db import get_db
from app.models import AuthToken, User
from app.schemas import MeResponse, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    password: str = Field(..., min_length=8, max_length=256)


@router.post("/setup", response_model=TokenResponse, status_code=201)
def setup(credentials: Credentials, db: Session = Depends(get_db)):
    user_count = db.scalar(select(func.count()).select_from(User))
    if user_count and user_count > 0:
        raise HTTPException(status_code=409, detail="Setup already completed")
    user = User(
        username=credentials.username.strip().lower(),
        password_hash=hash_password(credentials.password),
    )
    db.add(user)
    db.commit()
    token, _ = issue_token(db, user)
    return TokenResponse(token=token, username=user.username)


@router.post("/login", response_model=TokenResponse)
def login(
    credentials: Credentials,
    request: Request,
    db: Session = Depends(get_db),
):
    check_login_rate_limit(request)
    user = (
        db.execute(
            select(User).where(User.username == credentials.username.strip().lower())
        )
        .scalars()
        .first()
    )
    if user is None or not verify_password(credentials.password, user.password_hash):
        register_login_attempt(request)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token, _ = issue_token(db, user)
    return TokenResponse(token=token, username=user.username)


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)):
    return MeResponse(username=user.username)


@router.post("/logout")
def logout(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        token_hash = __import__("hashlib").sha256(auth[7:].strip().encode()).hexdigest()
        record = db.get(AuthToken, token_hash)
        if record:
            record.revoked = True
            db.commit()
    return {"status": "logged_out", "app": app.APP_NAME}


@router.post("/change-password", status_code=204)
def change_password(
    payload: Credentials,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.auth import _token_hash

    auth = request.headers.get("Authorization", "")
    current_password = request.headers.get("X-Current-Password", "")
    if not current_password or not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=403, detail="Current password required or wrong")
    user.password_hash = hash_password(payload.password)
    if auth.lower().startswith("bearer "):
        record = db.get(AuthToken, _token_hash(auth[7:].strip()))
        if record:
            record.revoked = True
    for other in db.execute(
        select(AuthToken).where(AuthToken.user_id == user.id, AuthToken.revoked.is_(False))
    ).scalars():
        other.revoked = True
    db.commit()
