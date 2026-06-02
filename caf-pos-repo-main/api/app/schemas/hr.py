import decimal
from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field

from app.enums import LeaveStatus, LeaveType, Role, StaffPosition, TaskStatus


class StaffRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    role: Role
    position: StaffPosition
    phone: str | None
    email: str | None
    address: str | None
    is_active: bool


class StaffCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: Role
    position: StaffPosition
    pin: str = Field(min_length=4, max_length=8)
    phone: str = Field(min_length=7, max_length=20)
    email: str | None = Field(None, max_length=255)
    address: str | None = Field(None, max_length=500)


class StaffUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    role: Role | None = None
    position: StaffPosition | None = None
    pin: str | None = Field(None, min_length=4, max_length=8)
    phone: str | None = Field(None, min_length=7, max_length=20)
    # email and address use model_fields_set — null means "clear", omit means "leave unchanged"
    email: str | None = None
    address: str | None = None


class LeaveRead(BaseModel):
    id: str
    store_id: str
    user_id: str
    user_name: str
    start_date: date
    end_date: date
    leave_type: LeaveType
    status: LeaveStatus
    note: str | None
    reviewed_by_id: str | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class LeaveCreate(BaseModel):
    start_date: date
    end_date: date
    leave_type: LeaveType
    note: str | None = Field(None, max_length=500)


class LeaveReview(BaseModel):
    status: LeaveStatus
    note: str | None = Field(None, max_length=500)


class ShiftRead(BaseModel):
    id: str
    store_id: str
    user_id: str
    user_name: str
    assignment_date: date
    start_time: time
    end_time: time
    notes: str | None
    created_by_id: str
    created_at: datetime
    updated_at: datetime


class ShiftCreate(BaseModel):
    user_id: str
    assignment_date: date
    start_time: time
    end_time: time
    notes: str | None = Field(None, max_length=500)


class CashSessionCreate(BaseModel):
    cash_open: decimal.Decimal = Field(ge=0, decimal_places=2)
    notes: str | None = Field(None, max_length=500)


class CashSessionClose(BaseModel):
    cash_close: decimal.Decimal = Field(ge=0, decimal_places=2)
    notes: str | None = Field(None, max_length=500)


class CashSessionRead(BaseModel):
    id: str
    store_id: str
    opened_by_id: str
    closed_by_id: str | None
    cash_open: decimal.Decimal
    cash_close: decimal.Decimal | None
    opened_at: datetime
    closed_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class TaskRead(BaseModel):
    id: str
    store_id: str
    assignee_id: str | None
    assignee_name: str | None
    created_by_id: str
    title: str
    description: str | None
    status: TaskStatus
    due_date: date | None
    created_at: datetime
    updated_at: datetime


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    assignee_id: str | None = None
    due_date: date | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    assignee_id: str | None = None
    status: TaskStatus | None = None
    due_date: date | None = None
