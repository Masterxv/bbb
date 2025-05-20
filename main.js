const axios = require('axios');
const moment = require('moment');

const BINANCE_URL = "https://testnet.binance.vision/api/v3";
const WHATSAPP_API_URL = "https://x5lvzg-5001.csb.app/send-message";
const PHONE_NUMBER = "919701779143";
const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h"];

async function getTopSymbols(limit = 100, customSymbols = null) {
  try {
    const response = await axios.get(`${BINANCE_URL}/ticker/24hr`);
    const data = response.data;
    const usdtPairs = data.filter(x => x.symbol.endsWith('USDT') && !['USDCUSDT', 'FDUSDUSDT'].includes(x.symbol));
    
    // Sort by price change percentage
    const sortedByChange = [...usdtPairs].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
    
    // Get top 5 gainers and losers
    const topGainers = sortedByChange.slice(0, 10);
    const topLosers = sortedByChange.slice(-10).reverse();
    
    console.log("\n=== Top Gainers ===");
    topGainers.forEach(coin => {
      console.log(`${coin.symbol}: +${parseFloat(coin.priceChangePercent).toFixed(2)}%`);
    });
    
    console.log("\n=== Top Losers ===");
    topLosers.forEach(coin => {
      console.log(`${coin.symbol}: ${parseFloat(coin.priceChangePercent).toFixed(2)}%`);
    });

    // Combine custom symbols with top gainers
    const combinedSymbols = new Set([
      ...(customSymbols || []),
      ...topGainers.map(coin => coin.symbol)
    ]);

    return Array.from(combinedSymbols);
  } catch (error) {
    console.error("Error fetching top symbols:", error);
    return [];
  }
}

async function getKlines(symbol, interval, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await axios.get(`${BINANCE_URL}/klines`, {
        params: { symbol, interval, limit: 100 }
      });

      return response.data.map(k => ({
        timestamp: moment(k[0]),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error(`Failed to fetch klines for ${symbol}:`, error);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return null;
}

function calculateIndicators(data, period = 10, multiplier = 3) {
  // EMA 200
  let ema200 = data.reduce((acc, curr, i) => {
    const alpha = 2 / (200 + 1);
    return i === 0 ? curr.close : (curr.close * alpha) + (acc * (1 - alpha));
  }, 0);

  // MACD
  let exp1 = data.reduce((acc, curr, i) => {
    const alpha = 2 / (12 + 1);
    return i === 0 ? curr.close : (curr.close * alpha) + (acc * (1 - alpha));
  }, 0);

  let exp2 = data.reduce((acc, curr, i) => {
    const alpha = 2 / (26 + 1);
    return i === 0 ? curr.close : (curr.close * alpha) + (acc * (1 - alpha));
  }, 0);

  const macd = exp1 - exp2;
  const signal = macd * (2 / (9 + 1));
  const histogram = macd - signal;

  // Supertrend
  const hl2 = (data[data.length - 1].high + data[data.length - 1].low) / 2;
  const atr = data.slice(-period).reduce((acc, curr, i, arr) => {
    if (i === 0) return Math.abs(curr.high - curr.low);
    const tr = Math.max(
      Math.abs(curr.high - curr.low),
      Math.abs(curr.high - arr[i - 1].close),
      Math.abs(curr.low - arr[i - 1].close)
    );
    return (acc * (period - 1) + tr) / period;
  }, 0);

  const upperBand = hl2 + (multiplier * atr);
  const lowerBand = hl2 - (multiplier * atr);

  return {
    ema200,
    macd,
    signal,
    histogram,
    upperBand,
    lowerBand,
    inUptrend: data[data.length - 1].close > lowerBand
  };
}

async function sendAlert(message) {
  try {
    const response = await axios.get(WHATSAPP_API_URL, {
      params: { message, number: PHONE_NUMBER }
    });
    if (response.status === 200) {
      console.log("Alert sent:", message);
    } else {
      console.log("Failed to send alert:", response.status);
    }
  } catch (error) {
    console.error("Error sending alert:", error);
  }
}

async function main() {
  const customCoins = ["BTCUSDT", "ETHUSDT", "KDAUSDT", "SOLUSDT", "OMUSDT"];
  
  while (true) {
    console.log("\n=== Enhanced Supertrend Alert System ===");
    
    console.log("\nFetching top symbols...");
    const symbols = await getTopSymbols(undefined, customCoins);
    console.log("Top symbols:", symbols.join(", "));
    
    console.log("\nAnalyzing each symbol on different timeframes:");
    const alertsBySymbol = {};
    
    for (const symbol of symbols) {
      console.log(`\nProcessing ${symbol}:`);
      
      for (const interval of INTERVALS) {
        console.log(`\n${interval} Timeframe:`);
        const klines = await getKlines(symbol, interval);
        if (!klines) continue;
        
        const indicators = calculateIndicators(klines);
        const price = klines[klines.length - 1].close;
        
        const isAboveEma = price > indicators.ema200;
        const isMacdCrossover = indicators.histogram > 0;
        const isSupertrendBullish = indicators.inUptrend;
        
        const currentTrend = (isAboveEma && isMacdCrossover && isSupertrendBullish) ? "BULLISH" : "BEARISH";
        
        console.log(`Current Price: ${price.toFixed(4)}`);
        console.log(`Current Trend: ${currentTrend}`);
        console.log(`Upper Band: ${indicators.upperBand.toFixed(4)}`);
        console.log(`Lower Band: ${indicators.lowerBand.toFixed(4)}`);
        
        if (!alertsBySymbol[symbol]) {
          alertsBySymbol[symbol] = [];
        }
        
        const trendEmoji = currentTrend === "BULLISH" ? "🟢" : "🔴";
        alertsBySymbol[symbol].push(`${trendEmoji} ${interval}: ${currentTrend} @ ${price.toFixed(4)}`);
      }
      
      if (symbol in alertsBySymbol) {
        const alerts = alertsBySymbol[symbol];
        const is15mBearish = alerts.some(alert => alert.includes("15m: BEARISH"));
        
        if (is15mBearish) {
          const relevantAlerts = alerts.filter(alert => alert.includes("15m"));
          const message = `=== ${symbol} 15m BEARISH Alert ===\n${relevantAlerts.join("\n")}`;
          await sendAlert(message);
        }
        
        const is1mBullish = alerts.some(alert => alert.includes("1m: BULLISH"));
        const is5mBullish = alerts.some(alert => alert.includes("5m: BULLISH"));
        
        if (is1mBullish && is5mBullish) {
          const shortTimeframeAlerts = alerts.filter(alert => alert.includes("1m") || alert.includes("5m"));
          const message = `=== ${symbol} BULLISH Alert ===\n${shortTimeframeAlerts.join("\n")}`;
          await sendAlert(message);
        }
        
        alertsBySymbol[symbol] = [];
      }
    }
    
    console.log("\n=== Analysis Complete ===");
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
}

main().catch(console.error);
