#!/usr/bin/env python3
"""
Lumen Fintech Python Research SDK
==================================
Empowers computational finance researchers, econometricians, and data scientists
to interact with the Lumen double-entry ledger, retrieve cryptographic audit logs,
run Monte Carlo stress testing simulations, execute multi-chain crypto & mobile payment rails, and stream cash flow series.

Example:
--------
from sdk.research_client import LumenClient

client = LumenClient(base_url="http://localhost:3000")
print("Financial Health:", client.get_health_score())
wallet = client.get_crypto_wallet(network="celo")
print("Celo Wallet Address:", wallet["address"])
"""

import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, List

class LumenClient:
    """Client for the Lumen Fintech REST API and Computational Research Core."""

    def __init__(self, base_url: str = "http://localhost:3000", api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _request(self, method: str, endpoint: str, data: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"
        req_headers = {"Content-Type": "application/json"}
        if self.api_key:
            req_headers["x-api-key"] = self.api_key
        if headers:
            req_headers.update(headers)

        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body, headers=req_headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_body)
                raise RuntimeError(f"API Error {e.code}: {err_json.get('error', err_body)}")
            except json.JSONDecodeError:
                raise RuntimeError(f"HTTP {e.code}: {err_body}")

    # =========================================================================
    # System & Cryptographic Audit
    # =========================================================================
    def get_system_health(self) -> Dict[str, Any]:
        """Returns server diagnostics, SQLite database metrics, and uptime."""
        return self._request("GET", "/api/system/health")

    def verify_cryptographic_audit(self) -> Dict[str, Any]:
        """
        Recalculates SHA-256 hash chains across all journal entries from genesis.
        Returns verification status and tamper detection diagnostics.
        """
        return self._request("GET", "/api/ledger/verify-audit")

    def export_ledger_backup(self) -> Dict[str, Any]:
        """Downloads full double-entry ledger JSON snapshot."""
        return self._request("GET", "/api/system/export")

    # =========================================================================
    # Double-Entry Ledger Core & Financial Statements
    # =========================================================================
    def get_accounts(self) -> List[Dict[str, Any]]:
        """Retrieves all connected accounts with real-time double-entry balances."""
        res = self._request("GET", "/api/accounts")
        return res.get("accounts", [])

    def get_trial_balance(self) -> Dict[str, Any]:
        """
        Retrieves standard GAAP trial balance proving mathematical equilibrium
        where Total Debits === Total Credits.
        """
        return self._request("GET", "/api/ledger/trial-balance")

    def get_balance_sheet(self) -> Dict[str, Any]:
        """Retrieves Assets = Liabilities + Equity balance sheet."""
        return self._request("GET", "/api/ledger/balance-sheet")

    def get_income_statement(self, from_date: Optional[str] = None, to_date: Optional[str] = None) -> Dict[str, Any]:
        """Retrieves P&L statement (Revenue, Expenses, Net Income)."""
        params = []
        if from_date: params.append(f"fromDate={from_date}")
        if to_date: params.append(f"toDate={to_date}")
        query = f"?{'&'.join(params)}" if params else ""
        return self._request("GET", f"/api/ledger/income-statement{query}")

    def get_transactions(self, limit: int = 100, tx_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves transaction history."""
        query = f"?limit={limit}"
        if tx_type: query += f"&type={tx_type}"
        res = self._request("GET", f"/api/transactions{query}")
        return res.get("transactions", [])

    # =========================================================================
    # Payment Rails (M-Pesa, Airtel, Bank Wire, On-Chain Crypto & Fintech P2P)
    # =========================================================================
    def initiate_mpesa_stk_push(self, phone_number: str, amount_kes: float, description: str = "Deposit") -> Dict[str, Any]:
        """Initiates M-Pesa STK Push prompt."""
        return self._request("POST", "/api/rails/mpesa/stk-push", data={"phoneNumber": phone_number, "amountKes": amount_kes, "description": description})

    def send_mpesa_b2c_payout(self, recipient_phone: str, amount_kes: float, description: str = "Payout") -> Dict[str, Any]:
        """Sends M-Pesa B2C payout."""
        return self._request("POST", "/api/rails/mpesa/b2c", data={"recipientPhone": recipient_phone, "amountKes": amount_kes, "description": description})

    def initiate_bank_wire(self, iban: str, recipient_name: str, amount_usd: float, bic: Optional[str] = None, wire_type: str = "SWIFT") -> Dict[str, Any]:
        """Initiates SWIFT / SEPA / ACH wire transfer."""
        return self._request("POST", "/api/rails/bank/wire", data={"iban": iban, "recipientName": recipient_name, "amountUsd": amount_usd, "bic": bic, "type": wire_type})

    def get_crypto_wallet(self, network: str = "celo") -> Dict[str, Any]:
        """Retrieves or creates EVM / Celo wallet address."""
        return self._request("GET", f"/api/rails/crypto/wallet?network={network}")

    def send_onchain_crypto(self, recipient_address: str, amount: float, asset: str = "cUSD", network: str = "celo") -> Dict[str, Any]:
        """Transfers on-chain crypto to an external 0x address."""
        return self._request("POST", "/api/rails/crypto/send", data={"recipientAddress": recipient_address, "amount": amount, "asset": asset, "network": network})

    def receive_onchain_deposit(self, amount: float, tx_hash: Optional[str] = None, from_address: Optional[str] = None, asset: str = "cUSD", network: str = "celo") -> Dict[str, Any]:
        """Credits an inbound on-chain deposit."""
        return self._request("POST", "/api/rails/crypto/receive", data={"amount": amount, "txHash": tx_hash, "fromAddress": from_address, "asset": asset, "network": network})

    def buy_crypto_with_fiat(self, fiat_amount: float, fiat_currency: str = "KES", crypto_asset: str = "cUSD", payment_rail: str = "mpesa") -> Dict[str, Any]:
        """Buys on-chain crypto using local fiat (On-Ramp)."""
        return self._request("POST", "/api/rails/crypto/buy", data={"fiatAmount": fiat_amount, "fiatCurrency": fiat_currency, "cryptoAsset": crypto_asset, "paymentRail": payment_rail})

    def sell_crypto_for_fiat(self, crypto_amount: float, crypto_asset: str = "cUSD", fiat_currency: str = "KES", payout_rail: str = "mpesa", recipient_details: Optional[str] = None) -> Dict[str, Any]:
        """Sells on-chain crypto for local fiat payout (Off-Ramp)."""
        return self._request("POST", "/api/rails/crypto/sell", data={"cryptoAmount": crypto_amount, "cryptoAsset": crypto_asset, "fiatCurrency": fiat_currency, "payoutRail": payout_rail, "recipientDetails": recipient_details})

    def execute_crypto_swap(self, from_asset: str, to_asset: str, from_amount: float) -> Dict[str, Any]:
        """Executes crypto asset swap (e.g. cUSD -> KES, USD -> CELO)."""
        return self._request("POST", "/api/rails/crypto/swap", data={"fromAsset": from_asset, "toAsset": to_asset, "fromAmount": from_amount})

    def generate_payment_link(self, amount: float, currency: str = "USD", description: str = "Payment Request") -> Dict[str, Any]:
        """Generates unified payment link & QR code metadata."""
        return self._request("POST", "/api/rails/fintech/paylink", data={"amount": amount, "currency": currency, "description": description})

    def send_fintech_disbursement(self, platform: str, recipient_handle: str, amount: float, currency: str = "USD") -> Dict[str, Any]:
        """Sends disbursement to Wise, Revolut, PayPal, Paystack, Chipper Cash."""
        return self._request("POST", "/api/rails/fintech/send-p2p", data={"platform": platform, "recipientHandle": recipient_handle, "amount": amount, "currency": currency})

    # =========================================================================
    # Computational Finance Research Modules
    # =========================================================================
    def get_cash_flow_forecast(self, horizon_months: int = 6) -> Dict[str, Any]:
        """
        Retrieves Holt-Winters Double Exponential Smoothing cash flow forecast
        with 80% and 95% confidence bands.
        """
        return self._request("GET", f"/api/research/forecast?horizon={horizon_months}")

    def run_monte_carlo_simulation(
        self,
        iterations: int = 1000,
        horizon_months: int = 12,
        income_shock_pct: float = 0.0,
        emergency_shock_amount: float = 0.0,
        emergency_prob: float = 0.5
    ) -> Dict[str, Any]:
        """
        Executes N stochastic simulation paths under user-defined stress parameters.
        Returns solvency probability, Value at Risk (VaR 5%), and runway percentiles.
        """
        payload = {
            "iterations": iterations,
            "horizonMonths": horizon_months,
            "incomeShockPct": income_shock_pct,
            "emergencyShockAmount": emergency_shock_amount,
            "emergencyProbPerYear": emergency_prob
        }
        return self._request("POST", "/api/research/monte-carlo", data=payload)

    def get_health_score(self) -> Dict[str, Any]:
        """
        Evaluates the 5 econometric pillars (Savings Rate, Runway, Leverage,
        Discipline, Stability) and returns composite 0-100 score + recommendations.
        """
        return self._request("GET", "/api/research/health-score")

    def get_detected_subscriptions(self) -> Dict[str, Any]:
        """Analyzes periodic intervals to detect recurring bills and annual burn."""
        return self._request("GET", "/api/research/subscriptions")

    def get_spending_anomalies(self, threshold_z: float = 2.2) -> Dict[str, Any]:
        """Detects statistical outliers using rolling category Z-scores."""
        return self._request("GET", f"/api/research/anomalies?threshold={threshold_z}")

    # =========================================================================
    # Pandas / Data Science Helpers
    # =========================================================================
    def get_transactions_dataframe(self):
        """Helper to return transactions directly as a pandas DataFrame."""
        try:
            import pandas as pd
            txs = self.get_transactions(limit=1000)
            return pd.DataFrame(txs)
        except ImportError:
            raise RuntimeError("pandas is not installed. Install via `pip install pandas`.")


if __name__ == "__main__":
    print("✨ Lumen Python Research SDK Self-Test...")
    client = LumenClient()
    try:
        health = client.get_system_health()
        print(f"✅ System Online: {health['system']} (v{health['version']})")
        audit = client.verify_cryptographic_audit()
        print(f"✅ Cryptographic Ledger: {audit['audit']['message']}")
        score = client.get_health_score()
        print(f"✅ Financial Health Score: {score['health']['summary']}")
    except Exception as err:
        print(f"ℹ️ Note: Server may not be running on localhost:3000 yet. ({err})")
