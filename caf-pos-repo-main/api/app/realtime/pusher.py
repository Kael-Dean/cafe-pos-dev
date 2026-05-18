import asyncio
import logging
from typing import Any

from app.config import Settings

logger = logging.getLogger(__name__)


class PusherClient:
    """Wraps the Pusher SDK with a no-op fallback when credentials are missing.

    The orders module (Tier 4) will call `publish(...)` after committing an order;
    until then the wrapper logs at debug level and silently drops events.
    """

    def __init__(self, settings: Settings) -> None:
        self._client: Any = None
        if not (settings.PUSHER_APP_ID and settings.PUSHER_KEY and settings.PUSHER_SECRET):
            logger.info("pusher.disabled: missing credentials, realtime publish is a no-op")
            return
        try:
            from pusher import Pusher

            self._client = Pusher(
                app_id=settings.PUSHER_APP_ID,
                key=settings.PUSHER_KEY,
                secret=settings.PUSHER_SECRET,
                cluster=settings.PUSHER_CLUSTER,
                ssl=True,
            )
            logger.info("pusher.enabled cluster=%s", settings.PUSHER_CLUSTER)
        except Exception:
            logger.exception("pusher.init_failed; falling back to no-op")
            self._client = None

    async def publish(self, channel: str, event: str, data: dict) -> None:
        if self._client is None:
            logger.debug("pusher.publish.skipped channel=%s event=%s", channel, event)
            return
        await asyncio.to_thread(self._client.trigger, channel, event, data)
