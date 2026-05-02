from fastapi import HTTPException, status


class NotFound(HTTPException):
    def __init__(self, detail: str = "Not found") -> None:
        super().__init__(status.HTTP_404_NOT_FOUND, detail)


class Unauthorized(HTTPException):
    def __init__(self, detail: str = "Invalid session") -> None:
        super().__init__(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


class Forbidden(HTTPException):
    def __init__(self, detail: str = "Insufficient role") -> None:
        super().__init__(status.HTTP_403_FORBIDDEN, detail)


class Conflict(HTTPException):
    def __init__(self, detail: str = "Conflict") -> None:
        super().__init__(status.HTTP_409_CONFLICT, detail)


class Unprocessable(HTTPException):
    def __init__(self, detail: str = "Unprocessable entity") -> None:
        super().__init__(status.HTTP_422_UNPROCESSABLE_ENTITY, detail)
