from fastapi import APIRouter

from app.api.v1 import auth, categories, customers, inventory, modifier_groups, orders, products, realtime, reports

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
