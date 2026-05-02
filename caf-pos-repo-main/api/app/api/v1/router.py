from fastapi import APIRouter

from app.api.v1 import (
    auth,
    cash,
    categories,
    customers,
    hr,
    inventory,
    modifier_groups,
    orders,
    products,
    promotions,
    protocols,
    realtime,
    reports,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(inventory.router)
api_router.include_router(categories.router)
api_router.include_router(products.router)
api_router.include_router(modifier_groups.router)
api_router.include_router(orders.router)
api_router.include_router(realtime.router)
api_router.include_router(reports.router)
api_router.include_router(customers.router)
api_router.include_router(cash.router)
api_router.include_router(promotions.router)
api_router.include_router(protocols.router)
api_router.include_router(hr.router)
