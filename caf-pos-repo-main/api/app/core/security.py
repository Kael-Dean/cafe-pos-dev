from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def hash_pin(pin: str) -> str:
    return _pwd.hash(pin)


def verify_pin(pin: str, pin_hash: str) -> bool:
    try:
        return _pwd.verify(pin, pin_hash)
    except ValueError:
        return False


TokenType = Literal["access", "refresh"]


def _now_utc() -> datetime:
    return datetime.now(UTC)


def create_token(
    *,
    subject: str,
    store_id: str | None,
    role: str,
    token_type: TokenType,
    expires_minutes: int | None = None,
) -> str:
    settings = get_settings()
    if expires_minutes is None:
        expires_minutes = (
            settings.ACCESS_TOKEN_EXPIRE_MINUTES
            if token_type == "access"
            else settings.REFRESH_TOKEN_EXPIRE_MINUTES
        )
    issued = _now_utc()
    payload: dict[str, Any] = {
        "sub": subject,
        "store_id": store_id,
        "role": role,
        "type": token_type,
        "iat": int(issued.timestamp()),
        "exp": int((issued + timedelta(minutes=expires_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str, *, expected_type: TokenType | None = None) -> dict[str, Any]:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise InvalidToken(str(exc)) from exc
    if expected_type and payload.get("type") != expected_type:
        raise InvalidToken(f"Expected {expected_type} token, got {payload.get('type')}")
    return payload


class InvalidToken(Exception):
    pass
