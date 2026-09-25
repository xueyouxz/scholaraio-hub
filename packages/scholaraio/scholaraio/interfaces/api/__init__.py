"""Application-owned HTTP interface over :mod:`scholaraio.hub`.

- ``app``: the FastAPI factory; ``server``: the child-process entry point.
- ``routes``: one router per domain, thin controllers only.
- ``schemas``: request bodies; ``dependencies``: services routes may ask for.
- ``errors`` and ``security``: failure responses and the internal token check.
"""
