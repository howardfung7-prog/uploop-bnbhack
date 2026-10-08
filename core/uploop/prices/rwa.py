"""Read-only proxy for Binance Web3 API · RWA Data.

Why it goes through the backend: every Binance Web3 API request must be signed with the Secret Key
(HMAC-SHA256, https://web3.binance.com/en/dev-docs/authentication). Shipping the secret to the browser
would publish it. So the API process runs one background thread that, every `INTERVAL` seconds, sends a
single signed request for the on-chain price of every US-stock token in the catalog (bStocks, BSC
contract addresses; `GET /rwa/price` takes up to 100 addresses per call). `GET /rwa-prices` on our API
only reads that in-memory table.

Read-only and display-only: it never feeds settlement, the quote book, balances or the quote circuit
breaker. A failed refresh records `last_error` and the frontend simply hides the line. If no refresh has
succeeded for `STALE_AFTER` seconds the whole table is withheld (we never show a stale price).
Without UPLOOP_BWEB3_API_KEY / UPLOOP_BWEB3_SECRET_KEY the thread is not started and the endpoint
returns `enabled: false`.
"""

import base64
import hashlib
import hmac
import json
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Dict, Iterable, List, Optional

BASE = "https://web3.binance.com"
PATH = "/build/api/v1/dex/market/rwa/price"
CHAIN_ID = "56"
#: The endpoint accepts up to 100 addresses per call; our whole US-stock catalog fits in one request.
BATCH = 100
INTERVAL = 30
TIMEOUT = 8
#: After 5 minutes without a successful refresh the table is withheld.
STALE_AFTER = 300
#: The gateway rejects requests whose timestamp is outside this window (default 5 s, max 60 s). 10 s keeps a
#: slightly drifting server clock from turning every request into 40103.
RECV_WINDOW_MS = 10000
SOURCE = "Binance Web3 API · RWA Data"


class RwaError(Exception):
    """The request failed, or the response cannot be used."""


def iso_ms(t: float) -> str:
    """X-OC-TIMESTAMP format: UTC, ISO 8601, milliseconds, e.g. 2026-05-11T10:08:57.715Z."""
    d = datetime.fromtimestamp(t, timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (d.microsecond // 1000)


def sign(secret: str, timestamp: str, method: str, request_path: str, body: str = "") -> str:
    """Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body)). requestPath must include the /build prefix and the query exactly as sent."""
    pre = timestamp + method.upper() + request_path + body
    return base64.b64encode(hmac.new(secret.encode("utf-8"), pre.encode("utf-8"), hashlib.sha256).digest()).decode("ascii")


def request_path(addresses: List[str]) -> str:
    """The string we sign is the string we send: commas encoded as %2C, matching encodeURIComponent in the official JS example."""
    q = urllib.parse.urlencode({"binanceChainId": CHAIN_ID, "tokenContractAddresses": ",".join(addresses)},
                               quote_via=urllib.parse.quote, safe="")
    return PATH + "?" + q


def _price(v: Any) -> Optional[str]:
    """Keep a positive decimal string (normalised, no exponent); anything else counts as missing."""
    try:
        d = Decimal(str(v))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not d.is_finite() or d <= 0:
        return None
    return format(d.normalize(), "f")


def parse(doc: Any) -> Dict[str, Dict[str, Any]]:
    """`{code: 0, data: [...]}` → lowercase contract address → {token_price, reference_price, platform, updated_at}. Bad rows are dropped one by one."""
    if not isinstance(doc, dict):
        raise RwaError("response is not a JSON object")
    if doc.get("code") != 0:
        raise RwaError("code %s: %s" % (doc.get("code"), str(doc.get("msg") or "")[:200]))
    rows = doc.get("data")
    if not isinstance(rows, list):
        raise RwaError("data is not a list")
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        addr = str(r.get("tokenContractAddress") or "").lower()
        token = _price(r.get("tokenPrice"))
        if not addr.startswith("0x") or len(addr) != 42 or token is None:
            continue
        updated = r.get("tokenPriceUpdatedAt")
        out[addr] = {
            "token_price": token,
            "reference_price": _price(r.get("referencePrice")),
            "platform": str(r.get("platformId") or "")[:32],
            "updated_at": int(updated) // 1000 if isinstance(updated, int) and updated > 0 else None,
        }
    return out


class RwaPrices:
    """A background thread refreshes every `interval` seconds; `snapshot()` only reads memory. `addresses` is called once per round and must be an in-memory read (no database)."""

    def __init__(self, api_key: str, secret: str, addresses: Callable[[], Iterable[str]],
                 interval: float = INTERVAL, timeout: float = TIMEOUT, stale_after: float = STALE_AFTER,
                 opener: Optional[Callable[..., Any]] = None, clock: Callable[[], float] = time.time,
                 log: Optional[Callable[[str], None]] = None):
        self.api_key, self.secret = api_key, secret
        self.addresses = addresses
        self.interval, self.timeout, self.stale_after = float(interval), float(timeout), float(stale_after)
        self.opener = opener or urllib.request.urlopen
        self.clock = clock
        self.log = log or (lambda msg: print("[rwa] " + msg, file=sys.stderr))
        self._lock = threading.Lock()
        self._prices: Dict[str, Dict[str, Any]] = {}
        self.updated_at: Optional[float] = None
        self.last_error: Optional[str] = None
        self._thread: Optional[threading.Thread] = None

    def _get(self, addresses: List[str]) -> Dict[str, Dict[str, Any]]:
        path = request_path(addresses)
        ts = iso_ms(self.clock())
        req = urllib.request.Request(BASE + path, headers={
            "X-OC-APIKEY": self.api_key, "X-OC-TIMESTAMP": ts,
            "X-OC-SIGN": sign(self.secret, ts, "GET", path), "X-OC-RECV-WINDOW": str(RECV_WINDOW_MS),
            "Accept": "application/json",
        })
        try:
            with self.opener(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            # 401 / 403 / 429 use the same {code, msg} envelope: surface code and msg, not just the HTTP status.
            try:
                body = json.loads(exc.read() or b"{}")
                detail = "code %s: %s" % (body.get("code"), str(body.get("msg") or "")[:200])
            except (ValueError, AttributeError):
                detail = ""
            raise RwaError(("HTTP %s %s" % (exc.code, detail)).rstrip()) from None
        except (urllib.error.URLError, OSError) as exc:
            raise RwaError("network: %s" % exc) from None
        try:
            return parse(json.loads(raw))
        except ValueError:
            raise RwaError("response is not JSON") from None

    def refresh(self) -> None:
        addrs = sorted({str(a).lower() for a in self.addresses() if a})
        got: Dict[str, Dict[str, Any]] = {}
        try:
            for i in range(0, len(addrs), BATCH):
                got.update(self._get(addrs[i:i + BATCH]))
        except RwaError as exc:
            msg = str(exc)
            if msg != self.last_error:
                self.log("refresh failed: " + msg)
            self.last_error = msg
            return
        if self.last_error is not None:
            self.log("recovered (%d tokens)" % len(got))
        with self._lock:
            self._prices = got
            self.updated_at = self.clock()
        self.last_error = None

    def snapshot(self, now: Optional[float] = None) -> Dict[str, Any]:
        now = self.clock() if now is None else now
        with self._lock:
            at, prices = self.updated_at, dict(self._prices)
        stale = at is None or now - at > self.stale_after
        return {"enabled": True, "source": SOURCE, "chain_id": int(CHAIN_ID),
                "at": int(at) if at is not None else None, "stale": stale,
                "prices": {} if stale else prices}

    def start(self) -> None:
        if self._thread is not None:
            return

        def loop() -> None:
            while True:
                try:
                    self.refresh()
                except Exception as exc:  # the thread must not die: log anything unexpected once and try again next round
                    self.last_error = "unexpected: %s" % exc
                    self.log(self.last_error)
                time.sleep(self.interval)

        self._thread = threading.Thread(target=loop, name="rwa-prices", daemon=True)
        self._thread.start()
