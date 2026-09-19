# Computational Finance Research Methodology & Algorithms

## 1. Overview

Lumen Finance provides computational finance researchers, quantitative analysts, and data scientists with a research-grade analytics core. This document formalizes the mathematical formulations and algorithms implemented in `server/research-engine/`.

---

## 2. Time-Series Cash Flow Forecasting

### Holt-Winters Double Exponential Smoothing (Additive Trend)

For a historical sequence of monthly income or spending observations $\{y_1, y_2, \dots, y_t\}$, the model computes smoothed level $\ell_t$ and trend $b_t$:

$$\ell_t = \alpha y_t + (1 - \alpha)(\ell_{t-1} + b_{t-1})$$
$$b_t = \beta(\ell_t - \ell_{t-1}) + (1 - \beta)b_{t-1}$$

Where:
- $\alpha \in [0.4, 0.5]$: Level smoothing coefficient.
- $\beta \in [0.15, 0.25]$: Trend smoothing coefficient.

### Point Forecast & Error Bands
For horizon $h \ge 1$:
$$\hat{y}_{t+h} = \ell_t + h \cdot b_t$$

Assuming residual errors $e_t = y_t - \hat{y}_t \sim \mathcal{N}(0, \sigma^2)$, the forecast standard error expands over time according to:
$$\sigma_h = \sigma \sqrt{1 + (h - 1)\alpha^2}$$

- **80% Confidence Interval:** $\hat{y}_{t+h} \pm 1.28 \cdot \sigma_h$
- **95% Confidence Interval:** $\hat{y}_{t+h} \pm 1.96 \cdot \sigma_h$

---

## 3. Monte Carlo Runway & Stress Testing Simulation

### Stochastic Trajectory Generation
Over a horizon of $M=12$ to $24$ months, Lumen runs $N=1,000$ simulation paths. For month $m \in [1, M]$ in path $i$:

$$B_{m}^{(i)} = B_{m-1}^{(i)} + I_m^{(i)} - S_m^{(i)} - E_m^{(i)}$$

Where:
1. **Initial Liquidity:** $B_0 = \sum \text{Liquid Assets} - \sum \text{Immediate Liabilities}$
2. **Income Inflows:**
   $$I_m^{(i)} = \max\left(0, \mu_{\text{income}} \cdot (1 + \delta_{\text{shock}}) + \sigma_{\text{income}} \cdot Z_1\right)$$
   Where $Z_1 \sim \mathcal{N}(0, 1)$ generated via the Box-Muller transform:
   $$Z_1 = \sqrt{-2\ln U_1} \cos(2\pi U_2), \quad U_1, U_2 \sim \mathcal{U}(0, 1)$$
3. **Stochastic Spending:**
   $$S_m^{(i)} = \max\left(S_{\text{min}}, \mu_{\text{spend}} \cdot (1 + \pi)^m + \sigma_{\text{spend}} \cdot Z_2\right)$$
   Where $\pi$ is monthly inflation rate ($\approx 3\% / 12$).
4. **Poisson Emergency Shock:**
   $$E_m^{(i)} = \begin{cases} X_{\text{emergency}}, & \text{with probability } p = \lambda_{\text{annual}} / 12 \\ 0, & \text{otherwise} \end{cases}$$

### Quantitative Risk Metrics
- **Solvency Probability:**
  $$P(\text{Solvent}) = \frac{1}{N}\sum_{i=1}^{N} \mathbb{I}\left(\min_{m \in [1, M]} B_m^{(i)} > 0\right) \times 100\%$$
- **Value at Risk (5% VaR):** The 5th percentile of ending balances $B_M$.
- **Median Runway:** Median month at which liquid reserves are exhausted across failing paths.

---

## 4. Econometric Financial Health Index (0-100)

Evaluates 5 fundamental macroeconomic pillars:

| Pillar | Formula / Condition | Target Metric | Weight |
| :--- | :--- | :--- | :--- |
| **Savings Rate** | $SR = \frac{\text{Income} - \text{Spending}}{\text{Income}}$ | $SR \ge 20\%$ | 25 pts |
| **Emergency Runway** | $ER = \frac{\text{Liquid Assets}}{\text{Monthly Burn}}$ | $ER \ge 6\text{ months}$ | 25 pts |
| **Debt Burden** | $DR = \frac{\text{Liabilities}}{\text{Liquid Assets}}$ | $DR \le 15\%$ | 20 pts |
| **Budget Discipline** | $BD = \frac{\text{Spending}}{\text{Income}}$ | $BD \le 80\%$ | 15 pts |
| **Income Stability** | $CV = \frac{\sigma_{\text{income}}}{\mu_{\text{income}}}$ | $CV \le 0.20$ | 15 pts |

---

## 5. Using the Python Research SDK

Researchers can stream data directly into pandas DataFrames:

```python
from sdk.research_client import LumenClient

client = LumenClient(base_url="http://localhost:3000")

# 1. Verify cryptographic ledger
audit = client.verify_cryptographic_audit()
print("Ledger Status:", audit["audit"]["message"])

# 2. Run Monte Carlo stress test
sim = client.run_monte_carlo_simulation(
    iterations=1000,
    horizon_months=12,
    income_shock_pct=-25.0,     # -25% salary shock
    emergency_shock_amount=3000 # $3,000 emergency outlay
)
print(f"Solvency: {sim['simulation']['results']['solvencyProbability']}%")
print(f"VaR (5th percentile): ${sim['simulation']['results']['valueAtRisk5pct']}")

# 3. Stream transactions into pandas DataFrame
df = client.get_transactions_dataframe()
print(df.groupby('category')['amount'].sum())
```
