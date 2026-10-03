"""Cloudflare R2 object storage (S3-compatible).

R2 is reached with the S3 API: writes go through the signed endpoint
``https://<account-id>.r2.cloudflarestorage.com`` (authenticated with an R2 API
token), while public reads are served from a separate public base URL — either
the bucket's free ``pub-xxxx.r2.dev`` URL or a custom domain.

``boto3`` is synchronous. ``generate_presigned_url`` is pure local signing (no
network I/O) so it is safe to call directly from async code; ``head_object`` and
``delete_object`` make network calls and are wrapped with ``anyio.to_thread``.
"""

from functools import lru_cache

from anyio import to_thread

from app.config import get_settings
from app.core.errors import Unprocessable

# content-type -> file extension allowlist for product images
_ALLOWED_IMAGE_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def is_configured() -> bool:
    s = get_settings()
    return all(
        [s.R2_ACCOUNT_ID, s.R2_ACCESS_KEY_ID, s.R2_SECRET_ACCESS_KEY, s.R2_BUCKET, s.R2_PUBLIC_BASE_URL]
    )


def _require_configured() -> None:
    if not is_configured():
        raise Unprocessable("Image storage (R2) is not configured on this server")


def ext_for_content_type(content_type: str) -> str:
    ext = _ALLOWED_IMAGE_TYPES.get(content_type.lower())
    if ext is None:
        raise Unprocessable(
            f"Unsupported image type {content_type!r}; allowed: {', '.join(_ALLOWED_IMAGE_TYPES)}"
        )
    return ext


@lru_cache
def _client():  # type: ignore[no-untyped-def]
    # Imported lazily so the app (and test suite) boot without boto3/R2 creds.
    import boto3
    from botocore.config import Config

    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=f"https://{s.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=s.R2_ACCESS_KEY_ID,
        aws_secret_access_key=s.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def public_url(key: str) -> str:
    base = get_settings().R2_PUBLIC_BASE_URL.rstrip("/")  # type: ignore[union-attr]
    return f"{base}/{key.lstrip('/')}"


def key_from_public_url(url: str) -> str | None:
    base = (get_settings().R2_PUBLIC_BASE_URL or "").rstrip("/")
    if base and url.startswith(base + "/"):
        return url[len(base) + 1 :]
    return None


def presign_put(key: str, content_type: str, expires_in: int = 300) -> str:
    """Return a short-lived URL the browser can PUT raw bytes to.

    The browser MUST send the same ``Content-Type`` header that was signed here.
    """
    _require_configured()
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": get_settings().R2_BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )


async def object_exists(key: str) -> bool:
    _require_configured()

    def _head() -> bool:
        from botocore.exceptions import ClientError

        try:
            _client().head_object(Bucket=get_settings().R2_BUCKET, Key=key)
            return True
        except ClientError:
            return False

    return await to_thread.run_sync(_head)


async def delete_object(key: str) -> None:
    _require_configured()

    def _delete() -> None:
        _client().delete_object(Bucket=get_settings().R2_BUCKET, Key=key)

    await to_thread.run_sync(_delete)
