import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Unauthorized
from app.core.security import (
    InvalidToken,
    create_token,
    decode_token,
    verify_pin,
)
from app.models import Store, Tenant, User
from app.schemas.auth import AccessTokenResponse, TokenPair

logger = logging.getLogger(__name__)


async def authenticate_pin(db: AsyncSession, *, store_slug: str, pin: str) -> User:
    """Look up active users in the named store and return the one matching the PIN.

    Multiple users in a store can have the same PIN per the prototype's seed
    data (manager `1234`, owner `1234`); ordering by role priority disambiguates.
    """
    result = await db.execute(
        select(User)
        .join(Store, User.store_id == Store.id)
        .where(
            Store.slug == store_slug,
            User.is_active.is_(True),
        )
    )
    candidates = list(result.scalars())
    if not candidates:
        logger.info("auth.login_failed reason=store_or_no_users store_slug=%s", store_slug)
        raise Unauthorized("Invalid PIN")

    role_order = {"OWNER": 0, "MANAGER": 1, "BAKER": 2, "BARISTA": 3}
    candidates.sort(key=lambda u: role_order.get(u.role.value, 99))

    for user in candidates:
        if verify_pin(pin, user.pin_hash):
            logger.info("auth.login_ok user_id=%s role=%s store_slug=%s", user.id, user.role.value, store_slug)
            return user

    logger.info("auth.login_failed reason=bad_pin store_slug=%s", store_slug)
    raise Unauthorized("Invalid PIN")


def mint_token_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(
            subject=user.id, store_id=user.store_id, role=user.role.value, token_type="access"
        ),
        refresh_token=create_token(
            subject=user.id, store_id=user.store_id, role=user.role.value, token_type="refresh"
        ),
    )


async def refresh_access_token(db: AsyncSession, *, refresh_token: str) -> AccessTokenResponse:
    try:
        payload = decode_token(refresh_token, expected_type="refresh")
    except InvalidToken as exc:
        raise Unauthorized(str(exc)) from exc
    user = await db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise Unauthorized("User no longer active")
    return AccessTokenResponse(
        access_token=create_token(
            subject=user.id, store_id=user.store_id, role=user.role.value, token_type="access"
        )
    )


async def load_me_context(db: AsyncSession, user: User) -> dict:
    store_name: str | None = None
    if user.store_id:
        store = await db.get(Store, user.store_id)
        if store:
            store_name = store.name
    return {
        "id": user.id,
        "name": user.name,
        "role": user.role,
        "store_id": user.store_id,
        "store_name": store_name,
        "tenant_id": user.tenant_id,
    }


async def get_tenant_for_user(db: AsyncSession, user: User) -> Tenant | None:
    return await db.get(Tenant, user.tenant_id)
