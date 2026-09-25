"""Failures the library reports to whoever asked, independent of transport.

Services raise these; the HTTP layer maps each to a status code. Subclassing the
builtin that used to be raised keeps callers that catch ``ValueError`` or
``LookupError`` working.
"""
from __future__ import annotations


class HubError(Exception):
    """A failure the caller should see, with a message meant for the user."""

    status_code = 500


class InvalidRequest(HubError, ValueError):
    """The request names something malformed, forbidden or in the wrong state."""

    status_code = 400


class TooLarge(InvalidRequest):
    """The request carries more than the library accepts in one go."""

    status_code = 413


class NotFound(HubError, LookupError):
    """The request names a paper, project, job or task that does not exist."""

    status_code = 404


__all__ = ["HubError", "InvalidRequest", "NotFound", "TooLarge"]
