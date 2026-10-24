"""SpacetimeDB over its HTTP API: call reducers and run SQL.

There's no Python SDK. Reducer names are snake_case on the wire, but argument
names are camelCase, so `call` converts snake_case keyword arguments for you:

    await stdb.call("post_feed_item", group_id=1, friend_id=2, ...)

SQL rows come back as positional arrays in SATS JSON; `sql` turns them into
dicts keyed by column name and decodes options, timestamps and identities.
"""

from datetime import UTC, datetime
from typing import Any

import httpx


class ReducerRejected(Exception):
    """A reducer's rule said no (HTTP 530): consent off, daily limit, etc.

    Skip it; retrying gives the same answer.
    """


def camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part.title() for part in rest)


def _decode(value: Any, ty: dict) -> Any:
    kind, body = next(iter(ty.items()))
    if kind == "Sum":
        names = [v["name"].get("some") for v in body["variants"]]
        if names == ["some", "none"]:
            tag, inner = value
            return _decode(inner, body["variants"][0]["algebraic_type"]) if tag == 0 else None
        return value
    if kind == "Product":
        fields = body["elements"]
        if len(fields) == 1:
            special = fields[0]["name"].get("some")
            if special == "__timestamp_micros_since_unix_epoch__":
                return datetime.fromtimestamp(value[0] / 1_000_000, UTC)
            if special == "__identity__":
                return value[0]
        return {
            f["name"].get("some"): _decode(v, f["algebraic_type"])
            for f, v in zip(fields, value)
        }
    if kind == "Array":
        return [_decode(v, body) for v in value]
    return value


def decode_rows(result: dict) -> list[dict]:
    fields = result["schema"]["elements"]
    return [
        {f["name"].get("some"): _decode(v, f["algebraic_type"]) for f, v in zip(fields, row)}
        for row in result["rows"]
    ]


class StdbClient:
    def __init__(
        self,
        uri: str,
        database: str,
        token: str,
        *,
        http: httpx.AsyncClient | None = None,
    ):
        self._base = f"{uri.rstrip('/')}/v1/database/{database}"
        self._headers = {"Authorization": f"Bearer {token}"}
        self._http = http or httpx.AsyncClient(timeout=10)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def call(self, reducer: str, **args: Any) -> None:
        r = await self._http.post(
            f"{self._base}/call/{reducer}",
            json={camel(k): v for k, v in args.items()},
            headers=self._headers,
        )
        if r.status_code == 530:
            raise ReducerRejected(r.text)
        r.raise_for_status()

    async def sql(self, query: str) -> list[dict]:
        """Rows of the last statement in `query`."""
        r = await self._http.post(f"{self._base}/sql", content=query, headers=self._headers)
        r.raise_for_status()
        results = r.json()
        return decode_rows(results[-1]) if results else []
