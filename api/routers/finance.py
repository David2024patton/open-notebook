"""Finance data API endpoints.

Provides stock market data, financial analysis, and portfolio tracking.
Uses yfinance for free stock data without API keys.
"""

import json
import traceback
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

router = APIRouter()


class StockQuoteRequest(BaseModel):
    symbols: list[str]
    period: str = "1mo"  # 1d, 5d, 1mo, 3mo, 6mo, 1y, 5y, max
    interval: str = "1d"  # 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo


class StockQuote(BaseModel):
    symbol: str
    name: str
    price: float
    change: float
    change_percent: float
    volume: int
    market_cap: Optional[float] = None
    pe_ratio: Optional[float] = None
    high_52w: Optional[float] = None
    low_52w: Optional[float] = None
    history: list[dict] = []


class StockAnalysisRequest(BaseModel):
    symbol: str
    analysis_type: str = "summary"  # summary, technical, fundamental


class StockAnalysis(BaseModel):
    symbol: str
    analysis_type: str
    summary: str
    metrics: dict
    signals: list[str]
    recommendation: str


@router.post("/finance/quotes", response_model=list[StockQuote])
async def get_stock_quotes(request: StockQuoteRequest):
    """Get real-time stock quotes with history.

    Supports any valid ticker symbol (e.g., AAPL, MSFT, GOOGL, TSLA).
    """
    try:
        import yfinance as yf

        quotes = []
        for symbol in request.symbols[:10]:  # Limit to 10 symbols
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.info

                # Get current price
                current_price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
                previous_close = info.get("previousClose", current_price)

                change = current_price - previous_close if current_price and previous_close else 0
                change_percent = (change / previous_close * 100) if previous_close else 0

                # Get history
                history = ticker.history(period=request.period, interval=request.interval)
                history_data = []
                for date, row in history.iterrows():
                    history_data.append({
                        "date": date.strftime("%Y-%m-%d"),
                        "open": round(float(row.get("Open", 0)), 2),
                        "high": round(float(row.get("High", 0)), 2),
                        "low": round(float(row.get("Low", 0)), 2),
                        "close": round(float(row.get("Close", 0)), 2),
                        "volume": int(row.get("Volume", 0)),
                    })

                quotes.append(StockQuote(
                    symbol=symbol.upper(),
                    name=info.get("longName", symbol),
                    price=round(current_price or 0, 2),
                    change=round(change, 2),
                    change_percent=round(change_percent, 2),
                    volume=info.get("volume", 0),
                    market_cap=info.get("marketCap"),
                    pe_ratio=info.get("trailingPE"),
                    high_52w=info.get("fiftyTwoWeekHigh"),
                    low_52w=info.get("fiftyTwoWeekLow"),
                    history=history_data[-30:],  # Last 30 data points
                ))
            except Exception as e:
                logger.warning(f"Failed to fetch quote for {symbol}: {e}")
                continue

        if not quotes:
            raise HTTPException(status_code=404, detail="No valid stock quotes found")

        return quotes

    except ImportError:
        raise HTTPException(status_code=500, detail="yfinance not installed. Run: pip install yfinance")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching stock quotes: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/finance/analyze", response_model=StockAnalysis)
async def analyze_stock(request: StockAnalysisRequest):
    """Analyze a stock with AI-powered insights.

    Combines real market data with AI analysis.
    """
    try:
        import yfinance as yf
        from open_notebook.ai.models import Model

        ticker = yf.Ticker(request.symbol)
        info = ticker.info

        current_price = info.get("currentPrice") or info.get("regularMarketPrice", 0)
        previous_close = info.get("previousClose", current_price)

        # Build metrics
        metrics = {
            "current_price": current_price,
            "previous_close": previous_close,
            "market_cap": info.get("marketCap"),
            "pe_ratio": info.get("trailingPE"),
            "forward_pe": info.get("forwardPE"),
            "peg_ratio": info.get("pegRatio"),
            "price_to_book": info.get("priceToBook"),
            "debt_to_equity": info.get("debtToEquity"),
            "return_on_equity": info.get("returnOnEquity"),
            "revenue_growth": info.get("revenueGrowth"),
            "earnings_growth": info.get("earningsGrowth"),
            "profit_margin": info.get("profitMargins"),
            "dividend_yield": info.get("dividendYield"),
            "beta": info.get("beta"),
            "52w_high": info.get("fiftyTwoWeekHigh"),
            "52w_low": info.get("fiftyTwoWeekLow"),
            "avg_volume": info.get("averageVolume"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
        }

        # Get recent history for context
        history = ticker.history(period="3mo")
        recent_prices = [round(float(row.get("Close", 0)), 2) for _, row in history.tail(30).iterrows()]

        # Generate AI analysis
        analysis_prompt = f"""Analyze this stock based on the following data:

Symbol: {request.symbol}
Name: {info.get('longName', request.symbol)}
Sector: {info.get('sector', 'N/A')}
Industry: {info.get('industry', 'N/A')}

Current Price: ${current_price}
52-Week High: ${info.get('fiftyTwoWeekHigh', 'N/A')}
52-Week Low: ${info.get('fiftyTwoWeekLow', 'N/A')}
Market Cap: ${info.get('marketCap', 'N/A'):,.0f}
P/E Ratio: {info.get('trailingPE', 'N/A')}
Revenue Growth: {info.get('revenueGrowth', 'N/A')}
Profit Margin: {info.get('profitMargins', 'N/A')}

Recent prices (last 30 days): {recent_prices[:10]}...

Provide a {request.analysis_type} analysis with:
1. A concise summary (2-3 sentences)
2. Key signals (bullish/bearish indicators)
3. A recommendation (buy/hold/sell/neutral)

Return as JSON: {{"summary": "...", "signals": ["..."], "recommendation": "..."}}"""

        model = await Model.get_default_model("outline")
        if model:
            esperanto_model = await model.get_esperanto_model()
            response = await esperanto_model.ainvoke(analysis_prompt)
            response_text = response.content if hasattr(response, "content") else str(response)

            # Parse response
            cleaned = response_text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]

            try:
                analysis_data = json.loads(cleaned.strip())
                summary = analysis_data.get("summary", "Analysis unavailable")
                signals = analysis_data.get("signals", [])
                recommendation = analysis_data.get("recommendation", "neutral")
            except json.JSONDecodeError:
                summary = response_text[:500]
                signals = ["Unable to parse analysis signals"]
                recommendation = "neutral"
        else:
            summary = f"{request.symbol} is trading at ${current_price}. Market data available but AI analysis requires a configured model."
            signals = ["AI model not available for detailed analysis"]
            recommendation = "neutral"

        return StockAnalysis(
            symbol=request.symbol.upper(),
            analysis_type=request.analysis_type,
            summary=summary,
            metrics=metrics,
            signals=signals,
            recommendation=recommendation,
        )

    except ImportError:
        raise HTTPException(status_code=500, detail="yfinance not installed")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error analyzing stock: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/finance/search")
async def search_stocks(q: str, limit: int = 5):
    """Search for stock symbols by company name."""
    try:
        import yfinance as yf

        # Use yfinance search
        results = []

        # Try direct symbol lookup
        try:
            ticker = yf.Ticker(q)
            info = ticker.info
            if info and info.get("symbol"):
                results.append({
                    "symbol": info["symbol"],
                    "name": info.get("longName", q),
                    "exchange": info.get("exchange", ""),
                    "type": info.get("quoteType", "Equity"),
                })
        except Exception:
            pass

        # Try common symbols
        common_symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "JPM", "V", "JNJ"]
        for symbol in common_symbols:
            if len(results) >= limit:
                break
            if q.upper() in symbol or q.lower() in symbol.lower():
                try:
                    ticker = yf.Ticker(symbol)
                    info = ticker.info
                    if info and info.get("symbol") not in [r["symbol"] for r in results]:
                        results.append({
                            "symbol": info["symbol"],
                            "name": info.get("longName", symbol),
                            "exchange": info.get("exchange", ""),
                            "type": info.get("quoteType", "Equity"),
                        })
                except Exception:
                    continue

        return {"results": results[:limit]}

    except ImportError:
        raise HTTPException(status_code=500, detail="yfinance not installed")
    except Exception as e:
        logger.error(f"Error searching stocks: {e}")
        raise HTTPException(status_code=500, detail=str(e))
