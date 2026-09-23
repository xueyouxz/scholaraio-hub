"""The paper library as Hub runs it: one writer, many readers, pushed changes.

Layers, from the bottom up:

- ``storage``, ``config``, ``errors``, ``events``: primitives with no library state.
- ``repository``, ``views``, ``artifacts``: the data on disk and how it is shown.
- ``runtime``: what every service shares (config, lock, repository, events, index).
- ``papers``, ``search``, ``retrieval``, ``projects``, ``citations``, ``metadata``,
  ``exports``, ``settings``, ``analytics``, ``status``: request-time services.
- ``imports``, ``acquire``, ``tasks``, ``maintenance``, ``watcher``: background work.
- ``library``: the composition root that wires them together.

The HTTP interface in :mod:`scholaraio.interfaces.api` only translates requests
into calls on these services.
"""
from __future__ import annotations

from scholaraio.hub.library import HubLibrary

__all__ = ["HubLibrary"]
