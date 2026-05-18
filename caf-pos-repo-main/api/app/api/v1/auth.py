from fastapi import APIRouter, Request, status

from app.core.ratelimit import limiter
from app.deps import CurrentUser, DbSession
from app.schemas.auth import (
    AccessTokenResponse,
    LoginRequest,
    MeResponse,
    RefreshRequest,
    TokenPair,
)
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=TokenPair,
    summary="Exchange store_slug + PIN for an access/refresh token pair",
    operation_id="auth_login",
)
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest, db: DbSession) -> TokenPair:
    user = await auth_service.authenticate_pin(db, store_slug=payload.store_slug, pin=payload.pin)
    return auth_service.mint_token_pair(user)


@router.post(
    "/refresh",
    response_model=AccessTokenResponse,
    summary="Exchange a refresh token for a new access token",
    operation_id="auth_refresh",
)
async def refresh(payload: RefreshRequest, db: DbSession) -> AccessTokenResponse:
    return await auth_service.refresh_access_token(db, refresh_token=payload.refresh_token)


@router.get(
    "/me",
    response_model=MeResponse,
    summary="Profile of the currently authenticated user",
    operation_id="auth_me",
)
async def me(user: CurrentUser, db: DbSession) -> MeResponse:
    ctx = await auth_service.load_me_context(db, user)
    return MeResponse(**ctx)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stateless logout (client drops token)",
    operation_id="auth_logout",
)
async def logout(user: CurrentUser) -> None:
    return None
