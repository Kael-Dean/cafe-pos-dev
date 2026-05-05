from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.enums import LeaveStatus, LeaveType, Role, ShiftType


class StaffRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    role: Role
    is_active: bool


class StaffCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: Role
    pin: str = Field(min_length=4, max_length=8)


class StaffUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    role: Role | None = None
    pin: str | None = Field(None, min_length=4, max_length=8)


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
    shift_type: ShiftType
    notes: str | None
    created_by_id: str
    created_at: datetime
    updated_at: datetime


class ShiftCreate(BaseModel):
    user_id: str
    assignment_date: date
    shift_type: ShiftType
    notes: str | None = Field(None, max_length=500)
