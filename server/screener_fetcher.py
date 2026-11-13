#!/usr/bin/env python3
"""Fetch NSE stock fundamentals via yfinance and print JSON to stdout.

Usage:
    python3 screener_fetcher.py RELIANCE.NS TCS.NS INFY.NS
"""

import json
import sys

import yfinance as yf


def clean_symbol(symbol):
    return symbol.replace(".NS", "")


def fetch(symbols):
    results = []
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            market_cap = info.get("marketCap") or 0
            results.append(
                {
                    "symbol": clean_symbol(symbol),
                    "name": info.get("shortName", symbol),
                    "price": info.get("currentPrice") or info.get("regularMarketPrice"),
                    "pe": info.get("trailingPE"),
                    "roe": info.get("returnOnEquity"),
                    "de": info.get("debtToEquity"),
                    "mcapCr": round(market_cap / 1e7) if market_cap else None,
                    "divYield": info.get("dividendYield"),
                    "beta": info.get("beta"),
                }
            )
        except Exception as e:
            results.append(
                {
                    "symbol": clean_symbol(symbol),
                    "name": "Error",
                    "price": None,
                    "pe": None,
                    "roe": None,
                    "de": None,
                    "mcapCr": None,
                    "divYield": None,
                    "beta": None,
                    "error": str(e),
                }
            )
    print(json.dumps({"results": results, "count": len(results)}))


if __name__ == "__main__":
    symbols = sys.argv[1:]
    if not symbols:
        print(json.dumps({"error": "No symbols provided", "results": [], "count": 0}))
        sys.exit(1)
    # Ensure .NS suffix
    symbols = [s if s.endswith(".NS") else f"{s}.NS" for s in symbols]
    fetch(symbols)
