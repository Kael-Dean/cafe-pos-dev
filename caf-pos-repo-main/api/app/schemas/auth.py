from pydantic import BaseModel, Field

from app.enums import Role


class LoginRequest(BaseModel):
    store_slug: str = Field(min_length=1, max_length=60)
    pin: str = Field(min_length=4, max_length=6, pattern=r"^\d{4,6}$")


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    id: str
    name: str
    role: Role
    store_id: str | None
    store_name: str | None
    tenant_id: str
