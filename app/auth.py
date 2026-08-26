import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import AuthToken, User, utcnow

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(bytes.fromhex(hash_hex)),
        )
        return hmac.compare_digest(digest, bytes.fromhex(hash_hex))
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(db: Session, user: User) -> tuple[str, AuthToken]:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    record = AuthToken(
        token_hash=_token_hash(token),
        user_id=user.id,
        expires_at=utcnow() + timedelta(days=settings.token_ttl_days),
    )
    db.add(record)
    db.commit()
    return token, record


_login_attempts: dict[str, deque[float]] = defaultdict(deque)


def check_login_rate_limit(request: Request) -> None:
    settings = get_settings()
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    window = _login_attempts[ip]
    while window and now - window[0] > settings.login_rate_window_s:
        window.popleft()
    if len(window) >= settings.login_rate_limit:
        raise HTTPException(status_code=429, detail="Too many login attempts, retry later")


def register_login_attempt(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    _login_attempts[ip].append(time.monotonic())


def get_current_user(
    request: Request, db: Session = Depends(get_db)
) -> User:
    auth = request.headers.get("Authorization", "")
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    record = (
        db.execute(select(AuthToken).where(AuthToken.token_hash == _token_hash(token)))
        .scalars()
        .first()
    )
    if record is None or record.revoked or record.expires_at < utcnow():
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.get(User, record.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return user
