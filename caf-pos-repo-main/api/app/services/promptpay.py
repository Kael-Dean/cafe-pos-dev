import base64
import io
import logging
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound, Unprocessable
from app.enums import OrderStatus
from app.models.orders import Order
from app.models.tenancy import Store
from app.schemas.orders import PromptPayQRResponse

logger = logging.getLogger(__name__)


def _tlv(tag: str, value: str) -> str:
    return f"{tag}{len(value):02d}{value}"


def _crc16(data: str) -> int:
    """CRC-16/CCITT-FALSE: poly=0x1021, init=0xFFFF, no reflection."""
    crc = 0xFFFF
    for byte in data.encode("ascii"):
        crc ^= byte << 8
        for _ in range(8):
            crc = (crc << 1) ^ 0x1021 if crc & 0x8000 else crc << 1
            crc &= 0xFFFF
    return crc


def _normalise_proxy(proxy: str) -> str:
    p = proxy.strip().replace("-", "").replace(" ", "")
    if len(p) == 10 and p.startswith("0"):
        return "0066" + p[1:]
    return p


def build_promptpay_payload(proxy: str, amount: Decimal) -> str:
    """Return the EMV QR payload string for a PromptPay dynamic QR code."""
    norm = _normalise_proxy(proxy)
    merchant_info = _tlv("29", _tlv("00", "A000000677010111") + _tlv("01", norm))
    body = (
        _tlv("00", "01")
        + _tlv("01", "12")
        + merchant_info
        + _tlv("53", "764")
        + _tlv("54", f"{amount:.2f}")
        + _tlv("58", "TH")
        + "6304"
    )
    return body + f"{_crc16(body):04X}"


def _render_qr_png_base64(payload: str) -> str:
    import qrcode  # deferred import — only loaded when this feature is used

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


async def get_promptpay_qr(db: AsyncSession, *, store_id: str, order_id: str) -> PromptPayQRResponse:
    order = await db.get(Order, order_id)
    if not order or order.store_id != store_id:
        raise NotFound("Order not found")
    if order.status == OrderStatus.VOID:
        raise Unprocessable("Cannot generate QR for a voided order")

    store = await db.get(Store, store_id)
    if not store or not store.promptpay_id:
        raise Unprocessable("Store PromptPay ID is not configured — set promptpay_id on the store record")

    payload = build_promptpay_payload(store.promptpay_id, order.total)
    qr_image_base64 = _render_qr_png_base64(payload)

    return PromptPayQRResponse(
        order_id=order.id,
        order_number=order.order_number,
        amount=order.total,
        payload=payload,
        qr_image_base64=qr_image_base64,
    )
