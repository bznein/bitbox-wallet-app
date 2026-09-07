// SPDX-License-Identifier: Apache-2.0

package backend

import (
	"math"
	"math/big"
	"sort"
	"time"

	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/accounts"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
)

// ChartPerformance contains portfolio performance metrics for a chart range.
type ChartPerformance struct {
	// MoneyWeightedReturn is the money-weighted return for the range.
	MoneyWeightedReturn *float64 `json:"moneyWeightedReturn"`
	// StartTimestamp is the canonical start of the chart range. It is nil for the all-time range.
	StartTimestamp *int64 `json:"startTimestamp"`
}

// ChartPerformanceByDisplay contains portfolio performance metrics for each chart filter.
type ChartPerformanceByDisplay struct {
	Week  ChartPerformance `json:"week"`
	Month ChartPerformance `json:"month"`
	Year  ChartPerformance `json:"year"`
	All   ChartPerformance `json:"all"`
}

type chartCashFlow struct {
	Time           time.Time
	Value          float64
	ValueAvailable bool
}

type chartWeightedCashFlow struct {
	Value           float64
	RemainingWeight float64
}

func hasCashFlowBetween(cashFlows []chartCashFlow, start, end time.Time) bool {
	for _, cashFlow := range cashFlows {
		if cashFlow.Time.After(start) && !cashFlow.Time.After(end) {
			return true
		}
	}
	return false
}

func findPerformanceStartEntry(entries []ChartEntry, from time.Time, cashFlows []chartCashFlow) *ChartEntry {
	startIndex := 0
	if !from.IsZero() {
		startIndex = sort.Search(len(entries), func(i int) bool {
			return entries[i].Time >= from.Unix()
		})
	}
	if startIndex == len(entries) {
		return nil
	}

	periodStartEntry := &entries[startIndex]
	periodStart := time.Unix(periodStartEntry.Time, 0)
	for i := startIndex; i < len(entries); i++ {
		if entries[i].Value <= 0 {
			continue
		}
		if hasCashFlowBetween(cashFlows, periodStart, time.Unix(entries[i].Time, 0)) {
			return periodStartEntry
		}
		return &entries[i]
	}

	for _, cashFlow := range cashFlows {
		if cashFlow.Time.After(periodStart) {
			return periodStartEntry
		}
	}
	return nil
}

func chartMoneyWeightedReturnValue(
	logReturn float64,
	beginningValue, endingValue float64,
	cashFlows []chartWeightedCashFlow,
) float64 {
	result := beginningValue*math.Exp(logReturn) - endingValue
	for _, cashFlow := range cashFlows {
		result += cashFlow.Value * math.Exp(cashFlow.RemainingWeight*logReturn)
	}
	return result
}

func chartMoneyWeightedReturnScale(
	beginningValue, endingValue float64,
	cashFlows []chartWeightedCashFlow,
) float64 {
	scale := math.Max(math.Abs(beginningValue), math.Abs(endingValue))
	for _, cashFlow := range cashFlows {
		scale = math.Max(scale, math.Abs(cashFlow.Value))
	}
	return scale
}

func chartHasSignChange(a, b float64) bool {
	return (a < 0 && b > 0) || (a > 0 && b < 0)
}

// Solve EV = BV*(1+r) + sum(CF_i*(1+r)^remaining_i) in log-return space.
func solveChartMoneyWeightedReturn(
	beginningValue, endingValue float64,
	cashFlows []chartWeightedCashFlow,
) *float64 {
	const (
		initialLogReturnStep = 0.01
		maxAbsLogReturn      = 50.0
		maxIterations        = 200
	)

	valueAt := func(logReturn float64) float64 {
		return chartMoneyWeightedReturnValue(logReturn, beginningValue, endingValue, cashFlows)
	}
	scale := chartMoneyWeightedReturnScale(beginningValue, endingValue, cashFlows)
	tolerance := math.Max(scale*1e-12, 1e-12)

	valueAtZero := valueAt(0)
	if math.IsNaN(valueAtZero) || math.IsInf(valueAtZero, 0) {
		return nil
	}
	if math.Abs(valueAtZero) <= tolerance {
		result := 0.0
		return &result
	}

	var lowerLogReturn, upperLogReturn float64
	foundBracket := false
	previousStep := 0.0
	previousValues := [2]float64{valueAtZero, valueAtZero}
	for step := initialLogReturnStep; ; step *= 2 {
		currentStep := math.Min(step, maxAbsLogReturn)
		// Preserve positive-first ordering when both directions can contain a root.
		for i, direction := range []float64{1, -1} {
			logReturn := direction * currentStep
			value := valueAt(logReturn)
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return nil
			}
			if value == 0 {
				result := math.Expm1(logReturn)
				return &result
			}
			if chartHasSignChange(previousValues[i], value) {
				previousLogReturn := direction * previousStep
				lowerLogReturn = math.Min(previousLogReturn, logReturn)
				upperLogReturn = math.Max(previousLogReturn, logReturn)
				foundBracket = true
				break
			}
			previousValues[i] = value
		}

		if foundBracket || currentStep == maxAbsLogReturn {
			break
		}
		previousStep = currentStep
	}

	if !foundBracket {
		return nil
	}

	lowerValue := valueAt(lowerLogReturn)
	for i := 0; i < maxIterations; i++ {
		midLogReturn := (lowerLogReturn + upperLogReturn) / 2
		midValue := valueAt(midLogReturn)
		if math.IsNaN(midValue) || math.IsInf(midValue, 0) {
			return nil
		}
		if midValue == 0 {
			result := math.Expm1(midLogReturn)
			return &result
		}
		if chartHasSignChange(lowerValue, midValue) {
			upperLogReturn = midLogReturn
		} else {
			lowerLogReturn = midLogReturn
			lowerValue = midValue
		}
	}

	// All candidate log returns stay within +/-maxAbsLogReturn, so Expm1 is finite.
	result := math.Expm1((lowerLogReturn + upperLogReturn) / 2)
	return &result
}

func calculateMoneyWeightedReturn(
	beginningValue, endingValue float64,
	startTime, endTime time.Time,
	cashFlows []chartCashFlow,
) *float64 {
	periodSeconds := endTime.Sub(startTime).Seconds()
	if beginningValue < 0 || endingValue < 0 || periodSeconds <= 0 {
		return nil
	}

	hasCapitalAtRisk := beginningValue > 0
	weightedCashFlows := []chartWeightedCashFlow{}
	for _, cashFlow := range cashFlows {
		if !cashFlow.Time.After(startTime) || cashFlow.Time.After(endTime) {
			continue
		}
		if !cashFlow.ValueAvailable {
			return nil
		}

		remainingWeight := endTime.Sub(cashFlow.Time).Seconds() / periodSeconds
		if cashFlow.Value > 0 && remainingWeight > 0 {
			hasCapitalAtRisk = true
		}
		weightedCashFlows = append(weightedCashFlows, chartWeightedCashFlow{
			Value:           cashFlow.Value,
			RemainingWeight: remainingWeight,
		})
	}

	if !hasCapitalAtRisk {
		return nil
	}

	return solveChartMoneyWeightedReturn(beginningValue, endingValue, weightedCashFlows)
}

func (backend *Backend) historicalOrLatestPriceAt(asset coin.Coin, fiat string, at time.Time) (float64, bool) {
	price := backend.RatesUpdater().HistoricalPriceAt(string(asset.Code()), fiat, at)
	if price != 0 {
		return price, true
	}

	latestRatesTime := backend.RatesUpdater().HistoryLatestTimestampCoin(string(asset.Code()))
	if (latestRatesTime.IsZero() || latestRatesTime.Before(at)) && time.Since(at) < 2*time.Hour {
		latestPrice, err := backend.RatesUpdater().LatestPriceForPair(asset.Unit(false), fiat)
		if err == nil && latestPrice != 0 {
			return latestPrice, true
		}
	}

	return 0, false
}

func (backend *Backend) fiatValueAt(asset coin.Coin, amount coin.Amount, fiat string, at time.Time) (float64, bool) {
	price, ok := backend.historicalOrLatestPriceAt(asset, fiat, at)
	if !ok {
		return 0, false
	}

	valueRat := new(big.Rat).Mul(
		new(big.Rat).SetFrac(amount.BigInt(), coin.DecimalsExp(asset, false)),
		new(big.Rat).SetFloat64(price),
	)
	value, _ := valueRat.Float64()
	return value, true
}

func (backend *Backend) appendChartCashFlows(
	asset coin.Coin,
	fiat string,
	txs accounts.OrderedTransactions,
	now time.Time,
	flows []chartCashFlow,
) []chartCashFlow {
	for _, tx := range txs {
		if tx.Timestamp == nil || tx.Height <= 0 || tx.Status == accounts.TxStatusFailed {
			continue
		}

		var multiplier float64
		switch tx.Type {
		case accounts.TxTypeReceive:
			multiplier = 1
		case accounts.TxTypeSend:
			multiplier = -1
		default:
			continue
		}

		at := *tx.Timestamp
		// The confirmed balance already includes this transfer, even if its block time is ahead.
		if at.After(now) {
			at = now
		}
		value, ok := backend.fiatValueAt(asset, tx.Amount, fiat, at)
		flows = append(flows, chartCashFlow{
			Time:           at,
			Value:          multiplier * value,
			ValueAvailable: ok,
		})
	}
	return flows
}

func chartPerformanceForRange(
	entries []ChartEntry,
	cashFlows []chartCashFlow,
	rangeStart, endTime time.Time,
	endingValue *float64,
) ChartPerformance {
	var performance ChartPerformance
	if !rangeStart.IsZero() {
		timestamp := rangeStart.Unix()
		performance.StartTimestamp = &timestamp
	}
	startEntry := findPerformanceStartEntry(entries, rangeStart, cashFlows)
	if startEntry == nil || endingValue == nil {
		return performance
	}

	performance.MoneyWeightedReturn = calculateMoneyWeightedReturn(
		startEntry.Value,
		*endingValue,
		time.Unix(startEntry.Time, 0),
		endTime,
		cashFlows,
	)
	return performance
}

func computeChartPerformance(
	now time.Time,
	chartDataDaily, chartDataHourly []ChartEntry,
	cashFlows []chartCashFlow,
	chartTotal *float64,
) ChartPerformanceByDisplay {
	roundedHour := now.UTC().Truncate(time.Hour)

	return ChartPerformanceByDisplay{
		Week: chartPerformanceForRange(
			chartDataHourly,
			cashFlows,
			roundedHour.AddDate(0, 0, -7),
			now,
			chartTotal,
		),
		Month: chartPerformanceForRange(
			chartDataDaily,
			cashFlows,
			roundedHour.AddDate(0, -1, 0),
			now,
			chartTotal,
		),
		Year: chartPerformanceForRange(
			chartDataDaily,
			cashFlows,
			roundedHour.AddDate(-1, 0, 0),
			now,
			chartTotal,
		),
		All: chartPerformanceForRange(
			chartDataDaily,
			cashFlows,
			time.Time{},
			now,
			chartTotal,
		),
	}
}
