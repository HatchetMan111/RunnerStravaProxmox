import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import APP_NAME
from app import __version__ as APP_VERSION
from app.config import Settings, get_settings
from app.db import create_all, init_engine
from app.routers import activities, auth, health, imports, stats, sync

logger = logging.getLogger("localtrack")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(_api: FastAPI):
        data_dir: Path = Path(settings.data_dir)
        for sub in ("originals", "exports", "cache"):
            (data_dir / sub).mkdir(parents=True, exist_ok=True)
        init_engine(settings.database_url)
        create_all()
        logger.info(
            "%s %s started (data_dir=%s, database=%s)",
            APP_NAME,
            APP_VERSION,
            data_dir,
            settings.database_url.split("@")[-1],
        )
        yield

    api = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

    api.include_router(health.router, prefix="/api/v1")
    api.include_router(auth.router, prefix="/api/v1")
    api.include_router(sync.router, prefix="/api/v1")
    api.include_router(imports.router, prefix="/api/v1")
    api.include_router(activities.router, prefix="/api/v1")
    api.include_router(stats.router, prefix="/api/v1")

    dist: Path = Path(settings.frontend_dist)
    if dist.is_dir():
        assets = dist / "assets"
        if assets.is_dir():
            api.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

        @api.get("/manifest.webmanifest", include_in_schema=False)
        def manifest():
            return FileResponse(dist / "manifest.webmanifest", media_type="application/manifest+json")

        @api.get("/sw.js", include_in_schema=False)
        def service_worker():
            return FileResponse(dist / "sw.js", media_type="text/javascript")

        for static_name in ("favicon.svg", "icon.svg", "icon-maskable.svg"):
            if (dist / static_name).is_file():

                def _static_file(name: str):
                    def handler():
                        return FileResponse(dist / name, media_type="image/svg+xml")

                    return handler

                api.get(f"/{static_name}", include_in_schema=False)(_static_file(static_name))

        @api.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str, _request: Request):
            candidate = (dist / full_path).resolve()
            try:
                candidate.relative_to(dist.resolve())
            except ValueError:
                return JSONResponse({"error": "not found"}, status_code=404)
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    else:
        logger.warning("frontend dist not found at %s; API-only mode", dist)

        @api.get("/", include_in_schema=False)
        def root():
            return JSONResponse(
                {
                    "app": APP_NAME,
                    "version": APP_VERSION,
                    "status": "ok",
                    "note": "frontend not built; see README",
                }
            )

    return api


app = create_app()
