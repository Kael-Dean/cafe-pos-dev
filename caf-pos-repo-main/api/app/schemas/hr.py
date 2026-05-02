from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.enums import LeaveStatus, LeaveType, Role, ShiftType


class _OrmBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Staff ─────────────────────────────────────────────────────────────────────

class StaffRead(_OrmBase):
    id: str
    name: str
    role: Role


# ── Leave requests ────────────────────────────────────────────────────────────

class LeaveRequestCreate(BaseModel):
    start_date: date
    end_date: date
    leave_type: LeaveType
    note: str | None = None


class LeaveReview(BaseModel):
    status: LeaveStatus = Field(..., pattern="^(APPROVED|REJECTED)$")


class LeaveRequestRead(_OrmBase):
    id: str
    store_id: str
    user_id: str
    user_name: str = ""
    start_date: date
    end_date: date
    leave_type: LeaveType
    status: LeaveStatus
    note: str | None
    reviewed_by_id: str | None
    reviewed_at: datetime | None
    created_at: datetime
    updated_at: datetime


# ── Shift assignments ─────────────────────────────────────────────────────────

class ShiftAssignmentCreate(BaseModel):
    user_id: str
    assignment_date: date
    shift_type: ShiftType
    notes: str | None = None


class ShiftAssignmentRead(_OrmBase):
    id: str
    store_id: str
    user_id: str
    user_name: str = ""
    assignment_date: date
    shift_type: ShiftType
    notes: str | None
    created_by_id: str
    created_at: datetime
    updated_at: datetime
