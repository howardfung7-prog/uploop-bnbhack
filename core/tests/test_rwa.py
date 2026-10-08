# -*- coding: utf-8 -*-
"""Binance Web3 API · RWA Data client: signing, parsing and background-refresh semantics. No network access.

Run from `core/`:  python3 -m unittest discover -s tests -v
"""

import io
import json
import unittest
import urllib.error
import urllib.parse

from uploop.prices import rwa
from uploop.prices.rwa import RwaError, RwaPrices, iso_ms, parse, request_path, sign

A = "0x" + "aa" * 20
B = "0x" + "bb" * 20


def row(addr, price="120.5", ref="120.5", platform="bstocks", updated=1_800_000_000_000):
    return {"binanceChainId": "56", "tokenContractAddress": addr, "platformId": platform,
            "tokenPrice": price, "referencePrice": ref, "tokenPriceUpdatedAt": updated}


class FakeResp:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeOpener:
    """Records every request; `reply` maps (address list) → response dict, or raises."""

    def __init__(self, reply):
        self.reply, self.requests = reply, []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(req.full_url).query)
        out = self.reply(q["tokenContractAddresses"][0].split(","))
        return FakeResp(json.dumps(out).encode("utf-8"))


def ok(addrs):
    return {"code": 0, "msg": "success", "data": [row(a) for a in addrs], "success": True}


class Signing(unittest.TestCase):
    def test_signature_matches_an_independent_openssl_vector(self):
        # printf '%s' '<preHash>' | openssl dgst -sha256 -hmac 'test-secret' -binary | base64
        path = request_path(["0xaa", "0xbb"])
        self.assertEqual(path, "/build/api/v1/dex/market/rwa/price?binanceChainId=56&tokenContractAddresses=0xaa%2C0xbb")
        self.assertEqual(sign("test-secret", "2026-05-11T10:08:57.715Z", "get", path),
                         "QvvpLMWVGSaR/MJvYoxOYGxgsWHlroutVnd44zMeJQk=")

    def test_timestamp_is_utc_iso_with_milliseconds(self):
        self.assertEqual(iso_ms(1778494137.715), "2026-05-11T10:08:57.715Z")
        self.assertEqual(iso_ms(1778494137), "2026-05-11T10:08:57.000Z")


class Parsing(unittest.TestCase):
    def test_rows_are_keyed_by_lowercase_address(self):
        got = parse(ok([A.upper().replace("0X", "0x")]))
        self.assertEqual(got, {A: {"token_price": "120.5", "reference_price": "120.5", "platform": "bstocks",
                                   "updated_at": 1_800_000_000}})

    def test_bad_rows_are_dropped_one_by_one(self):
        doc = {"code": 0, "data": [row(A), row(B, price="0"), row("0x12", price="1"), "junk",
                                   row("0x" + "cc" * 20, price="abc"), row("0x" + "dd" * 20, ref=None, updated=None)]}
        got = parse(doc)
        self.assertEqual(sorted(got), [A, "0x" + "dd" * 20])
        self.assertEqual(got["0x" + "dd" * 20]["reference_price"], None)
        self.assertEqual(got["0x" + "dd" * 20]["updated_at"], None)

    def test_scientific_notation_is_written_out(self):
        self.assertEqual(parse({"code": 0, "data": [row(A, price="1.2E+2")]})[A]["token_price"], "120")

    def test_business_error_raises(self):
        with self.assertRaisesRegex(RwaError, "40104"):
            parse({"code": 40104, "msg": "API Key lacks required permission", "data": None})
        with self.assertRaises(RwaError):
            parse({"code": 0, "data": None})
        with self.assertRaises(RwaError):
            parse([])


class Feed(unittest.TestCase):
    def setUp(self):
        self.now = 1_800_000_000.0
        self.addrs = [A, B]
        self.logs = []

    def feed(self, opener, **kw):
        return RwaPrices("key-1", "secret-1", lambda: self.addrs, opener=opener, clock=lambda: self.now,
                         log=self.logs.append, **kw)

    def test_request_is_signed_over_the_exact_wire_path(self):
        op = FakeOpener(ok)
        f = self.feed(op)
        f.refresh()
        req = op.requests[0]
        path = req.full_url[len(rwa.BASE):]
        self.assertTrue(path.startswith("/build/api/v1/dex/market/rwa/price?"))
        h = {k.lower(): v for k, v in req.header_items()}
        self.assertEqual(h["x-oc-apikey"], "key-1")
        self.assertEqual(h["x-oc-timestamp"], iso_ms(self.now))
        self.assertEqual(h["x-oc-sign"], sign("secret-1", iso_ms(self.now), "GET", path))
        self.assertEqual(h["x-oc-recv-window"], "10000")
        self.assertNotIn("secret-1", req.full_url + json.dumps(h))

    def test_snapshot_serves_memory_and_hides_when_stale(self):
        f = self.feed(FakeOpener(ok))
        self.assertEqual(f.snapshot()["prices"], {})          # no successful refresh yet
        self.assertTrue(f.snapshot()["stale"])
        f.refresh()
        s = f.snapshot()
        self.assertEqual((s["enabled"], s["stale"], s["at"], sorted(s["prices"])), (True, False, int(self.now), [A, B]))
        self.assertEqual(s["source"], rwa.SOURCE)
        self.now += rwa.STALE_AFTER + 1
        self.assertEqual((f.snapshot()["stale"], f.snapshot()["prices"]), (True, {}))

    def test_failure_keeps_last_good_table_and_logs_once(self):
        state = {"fail": False}

        def reply(addrs):
            if state["fail"]:
                raise urllib.error.URLError("dns")
            return ok(addrs)
        f = self.feed(FakeOpener(reply))
        f.refresh()
        state["fail"] = True
        self.now += 30
        f.refresh()
        f.refresh()
        self.assertIn("dns", f.last_error)
        self.assertEqual(len([m for m in self.logs if "failed" in m]), 1)   # the same error is logged once
        self.assertEqual(sorted(f.snapshot()["prices"]), [A, B])           # still within 5 minutes: keep serving the last good table
        state["fail"] = False
        f.refresh()
        self.assertIsNone(f.last_error)
        self.assertTrue(any("recovered" in m for m in self.logs))

    def test_http_error_carries_the_gateway_code(self):
        def opener(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, 401, "Unauthorized", {},
                                         io.BytesIO(b'{"code":40102,"msg":"Invalid signature","data":null}'))
        f = self.feed(opener)
        f.refresh()
        self.assertIn("HTTP 401", f.last_error)
        self.assertIn("40102", f.last_error)

    def test_more_than_100_addresses_are_batched(self):
        self.addrs = ["0x%040x" % i for i in range(1, 151)]
        op = FakeOpener(ok)
        f = self.feed(op)
        f.refresh()
        self.assertEqual(len(op.requests), 2)
        self.assertEqual(len(f.snapshot()["prices"]), 150)

    def test_empty_catalog_makes_no_request(self):
        self.addrs = []
        op = FakeOpener(ok)
        f = self.feed(op)
        f.refresh()
        self.assertEqual(op.requests, [])
        self.assertFalse(f.snapshot()["stale"])
