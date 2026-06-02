import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_router
from app.config import get_settings
from app.core.logging import configure_logging
from app.core.ratelimit import limiter
from app.realtime.pusher import PusherClient

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)
    app.state.pusher = PusherClient(settings)
    logger.info("startup.complete env=%s", settings.ENVIRONMENT)
    yield
    logger.info("shutdown.complete")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Cafe POS API",
        version="0.1.0",
        description="Multi-tenant POS backend (auth + inventory).",
        lifespan=lifespan,
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": _semantic_code(exc), "message": str(exc.detail)}},
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "UNPROCESSABLE_ENTITY",
                    "message": "Validation failed",
                    "details": exc.errors(),
                }
            },
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error_handler(request: Request, exc: IntegrityError):
        return JSONResponse(
            status_code=409,
            content={"error": {"code": "CONFLICT", "message": "Resource conflict"}},
        )

    @app.get("/health", tags=["meta"], summary="Liveness probe")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(api_router)
    return app


def _code_for(status_code: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "UNPROCESSABLE_ENTITY",
        429: "RATE_LIMITED",
    }.get(status_code, "ERROR")


def _semantic_code(exc: StarletteHTTPException) -> str:
    """Use exc.detail as the error code when it looks like a SNAKE_CASE identifier.

    Service layer raises e.g. Conflict("RECEIPT_ALREADY_CONFIRMED") — the detail
    IS the semantic code. Fall back to the generic status-code mapping otherwise.
    """
    detail = str(exc.detail)
    if detail and detail.replace("_", "").isupper() and " " not in detail:
        return detail
    return _code_for(exc.status_code)


app = create_app()
