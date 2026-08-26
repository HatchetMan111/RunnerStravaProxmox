import re
import uuid
from pathlib import Path

_SAFE_EXT = re.compile(r"^[a-z0-9]{1,8}$")


def originals_dir(data_dir: Path) -> Path:
    path = data_dir / "originals"
    path.mkdir(parents=True, exist_ok=True)
    return path


def sanitize_extension(filename: str | None, detected_format: str | None) -> str:
    ext = ""
    if filename and "." in filename:
        candidate = filename.rsplit(".", 1)[1].lower()
        if _SAFE_EXT.match(candidate):
            ext = candidate
    if not ext and detected_format:
        ext = detected_format
    if not _SAFE_EXT.match(ext):
        ext = "bin"
    return ext


def save_original(data_dir: Path, activity_id: str, data: bytes, filename: str | None, fmt: str | None) -> str:
    base = originals_dir(data_dir)
    ext = sanitize_extension(filename, fmt)
    target = base / f"{activity_id}.{ext}"
    resolved_target = target.resolve()
    if not str(resolved_target).startswith(str(base.resolve())):
        raise ValueError("invalid storage path")
    with open(resolved_target, "wb") as fh:
        fh.write(data)
    return f"originals/{activity_id}.{ext}"


def read_original(data_dir: Path, raw_path: str) -> bytes:
    base = originals_dir(data_dir).resolve()
    target = (base.parent / raw_path).resolve()
    if not str(target).startswith(str(base)):
        raise ValueError("invalid storage path")
    return target.read_bytes()


def new_activity_id() -> str:
    return uuid.uuid4().hex


def slugify(name: str, fallback: str = "activity") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:60] or fallback
