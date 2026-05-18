import asyncio

from fastapi import APIRouter, Form

from app.core.errors import Forbidden
from app.deps import PusherDep, StoreUser

router = APIRouter(prefix="/realtime", tags=["realtime"])


@router.post(
    "/auth",
    summary="Pusher private-channel auth signature",
    operation_id="realtime_auth",
)
async def pusher_auth(
    user: StoreUser,
    pusher: PusherDep,
    socket_id: str = Form(...),
    channel_name: str = Form(...),
) -> dict:
    expected = f"kds-store-{user.store_id}"
    if channel_name != expected and not channel_name.endswith(f"-{expected}"):
        raise Forbidden("Channel not authorized for this store")

    if pusher._client is None:
        return {"auth": ""}

    auth = await asyncio.to_thread(
        pusher._client.authenticate, channel=channel_name, socket_id=socket_id
    )
    return auth
