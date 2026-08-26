from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

_engine = None
_SessionLocal = None


class Base(DeclarativeBase):
    pass


def init_engine(database_url: str):
    global _engine, _SessionLocal
    connect_args = {}
    if database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    _engine = create_engine(database_url, connect_args=connect_args, future=True)
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _engine


def get_engine():
    assert _engine is not None, "database engine not initialized"
    return _engine


def create_all():
    from app import models  # noqa: F401

    Base.metadata.create_all(get_engine())


def get_db():
    assert _SessionLocal is not None, "database session factory not initialized"
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()
