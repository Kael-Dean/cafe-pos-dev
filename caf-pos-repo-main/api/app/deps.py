from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, Unauthorized
from app.core.security import InvalidToken, decode_token, oauth2_scheme
from app.db.session import async_session_maker
from app.enums import Role
from app.models import User
from app.realtime.pusher import PusherClient


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session_maker() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    token: Annotated[str | None, Depends(oauth2_scheme)],
    db: DbSession,
) -> User:
    if not token:
        raise Unauthorized("Missing bearer token")
    try:
        payload = decode_token(token, expected_type="access")
    except InvalidToken as exc:
        raise Unauthorized(str(exc)) from exc
    user_id = payload.get("sub")
    if not user_id:
        raise Unauthorized("Token has no subject")
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise Unauthorized("Invalid session")
    # Close the autobegun read txn so downstream services can use `async with db.begin():`.
    # Commit (no-op since we wrote nothing) preserves `user`'s attributes; `rollback`
    # would expire them and trigger a sync lazy-load on later attribute access.
    await db.commit()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: Role):
    allowed = set(roles)

    async def _checker(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise Forbidden(f"Requires one of: {', '.join(r.value for r in allowed)}")
        return user

    return _checker


def require_store(user: CurrentUser) -> User:
    if not user.store_id:
        raise Forbidden("This endpoint requires a store-scoped user")
    return user


StoreUser = Annotated[User, Depends(require_store)]


def get_pusher(request: Request) -> PusherClient:
    return request.app.state.pusher


PusherDep = Annotated[PusherClient, Depends(get_pusher)]
