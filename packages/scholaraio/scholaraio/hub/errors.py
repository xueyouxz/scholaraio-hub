"""Failures the library reports to whoever asked, independent of transport.

Services raise these; the HTTP layer maps each to a status code. Subclassing the
builtin that used to be raised keeps callers that catch ``ValueError`` or
``LookupError`` working.
"""
from __future__ import annotations


class HubError(Exception):
    """A failure the caller should see, with a message meant for the user."""

    status_code = 500
    code = "INTERNAL_ERROR"


class InvalidRequest(HubError, ValueError):
    """The request names something malformed, forbidden or in the wrong state."""

    status_code = 422
    code = "VALIDATION_FAILED"


class TooLarge(InvalidRequest):
    """The request carries more than the library accepts in one go."""

    status_code = 413
    code = "PAYLOAD_TOO_LARGE"


class Conflict(HubError):
    """The request cannot be carried out now: the same work is already under way."""

    status_code = 409
    code = "STATE_CONFLICT"


class NotFound(HubError, LookupError):
    """The request names a paper, project, job or task that does not exist."""

    status_code = 404
    code = "RESOURCE_NOT_FOUND"

    def __init__(self, message: str, *, code: str = "RESOURCE_NOT_FOUND"):
        """记录缺失资源的提示和业务错误码。"""
        super().__init__(message)
        self.code = code


__all__ = ["Conflict", "HubError", "InvalidRequest", "NotFound", "TooLarge"]
