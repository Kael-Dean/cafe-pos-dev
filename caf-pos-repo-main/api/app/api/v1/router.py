from fastapi import APIRouter

from app.api.v1 import (
    auth,
    categories,
    customers,
    hr,
    inventory,
    membership,
    modifier_groups,
    orders,
    pre_orders,
    production,
    promotions,
    products,
    realtime,
    receipts,
    reports,
    shopping_list,
    stock_takes,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(inventory.router)
api_router.include_router(receipts.router)
api_router.include_router(categories.router)
api_router.include_router(products.router)
api_router.include_router(modifier_groups.router)
api_router.include_router(orders.router)
api_router.include_router(realtime.router)
api_router.include_router(reports.router)
api_router.include_router(customers.router)
api_router.include_router(hr.router)
api_router.include_router(pre_orders.router)
api_router.include_router(shopping_list.router)
api_router.include_router(production.router)
api_router.include_router(promotions.router)
api_router.include_router(stock_takes.router)
api_router.include_router(membership.router)
