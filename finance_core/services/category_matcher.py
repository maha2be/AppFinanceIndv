"""Alias-based category matcher for quick transaction input."""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..db.categories import DEFAULT_CATEGORIES
from ..domain import TransactionType


@dataclass(frozen=True)
class CategoryMatch:
    """Matched transaction category and review metadata."""

    type: str
    category_name: str
    asset_name: str | None
    confidence: float
    needs_review: bool


_INVESTMENT_ASSET_ALIASES: dict[str, str] = {
    "btc": "BTC",
    "bitcoin": "BTC",
    "eth": "ETH",
    "ethereum": "ETH",
    "xrp": "XRP",
    "ripple": "XRP",
    "sol": "SOL",
    "solana": "SOL",
    "bnb": "BNB",
    "usdt": "USDT",
    "usdc": "USDC",
    "ada": "ADA",
    "cardano": "ADA",
    "doge": "DOGE",
    "dogecoin": "DOGE",
    "sui": "SUI",
    "ton": "TON",
    "trx": "TRX",
    "avax": "AVAX",
    "link": "LINK",
    "dot": "DOT",
    "matic": "MATIC",
    "pol": "POL",
    "ltc": "LTC",
    "xlm": "XLM",
    "shib": "SHIB",
    "pepe": "PEPE",
    "bbca": "BBCA",
    "bmri": "BMRI",
    "emas": "Emas",
    "gold": "Emas",
    "antam": "Emas",
}

_EXTRA_CATEGORY_ALIASES: dict[tuple[TransactionType, str], tuple[str, ...]] = {
    (TransactionType.INVESTMENT, "Crypto"): (
        "xrp",
        "ripple",
        "sol",
        "solana",
        "bnb",
        "usdt",
        "usdc",
        "ada",
        "cardano",
        "doge",
        "dogecoin",
        "sui",
        "ton",
        "trx",
        "avax",
        "link",
        "dot",
        "matic",
        "pol",
        "ltc",
        "xlm",
        "shib",
        "pepe",
    ),
}


def match_category(
    text: str,
    custom_categories: list[tuple[str, str]] | None = None,
) -> CategoryMatch:
    """Match text to a category.

    Custom categories (name + type from the user's database) are checked first
    using a case-insensitive substring match, so a user's own category name
    takes priority over the default aliases. Falls back to ``DEFAULT_CATEGORIES``
    and then ``Lainnya``.
    """

    normalized_text = _normalize_text(text)
    tokens = set(normalized_text.split())

    # Custom categories first: a user's own category name wins over the default
    # aliases. Matching is word-bounded so "Asi" does not match inside "kasir".
    if custom_categories:
        for category_type, category_name in custom_categories:
            normalized_name = _normalize_text(category_name)
            if not normalized_name:
                continue
            pattern = rf"\b{re.escape(normalized_name)}\b"
            if re.search(pattern, normalized_text):
                return CategoryMatch(
                    category_type,
                    category_name,
                    asset_name=None,
                    confidence=1.0,
                    needs_review=False,
                )

    best_match: CategoryMatch | None = None
    best_score = 0

    for transaction_type, category_name, aliases in DEFAULT_CATEGORIES:
        category_aliases = _alias_values(aliases)
        extra = _EXTRA_CATEGORY_ALIASES.get((transaction_type, category_name), ())
        if extra:
            category_aliases.extend(extra)
        total_score = sum(
            _alias_score(normalized_text, tokens, alias) for alias in category_aliases
        )
        if total_score > best_score:
            best_score = total_score
            best_match = CategoryMatch(
                transaction_type.value,
                category_name,
                asset_name=_detect_asset(transaction_type, normalized_text),
                confidence=1.0,
                needs_review=False,
            )

    if best_match is not None:
        return best_match

    return CategoryMatch(
        TransactionType.EXPENSE.value,
        "Lainnya",
        asset_name=None,
        confidence=0.0,
        needs_review=True,
    )


def _alias_values(aliases: str) -> list[str]:
    return [_normalize_text(alias) for alias in aliases.split(",") if alias.strip()]


def _alias_score(normalized_text: str, tokens: set[str], alias: str) -> int:
    if " " in alias:
        return len(alias.split()) if re.search(rf"\b{re.escape(alias)}\b", normalized_text) else 0
    return 1 if alias in tokens else 0


def _detect_asset(transaction_type: TransactionType, normalized_text: str) -> str | None:
    if transaction_type is not TransactionType.INVESTMENT:
        return None

    tokens = set(normalized_text.split())
    for alias, asset_name in _INVESTMENT_ASSET_ALIASES.items():
        if alias in tokens:
            return asset_name
    return None


def _normalize_text(text: str) -> str:
    lowered = text.casefold()
    return " ".join(re.sub(r"[^\w\s]", " ", lowered).split())
