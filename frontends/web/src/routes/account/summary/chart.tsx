// SPDX-License-Identifier: Apache-2.0

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { AutoscaleInfoProvider, createChart, IChartApi, LineData, LineStyle, LogicalRange, ISeriesApi, MouseEventParams, ColorType, Time } from 'lightweight-charts';
import type { TChartData, ChartData } from '@/api/account';
import { usePrevious } from '@/hooks/previous';
import { Skeleton } from '@/components/skeleton/skeleton';
import { Amount } from '@/components/amount/amount';
import { PercentageDiff } from './percentage-diff';
import { Filters } from './filters';
import { useDarkmode } from '@/hooks/darkmode';
import { RatesContext } from '@/contexts/RatesContext';
import { AppContext, TChartDisplay, TPortfolioPercentageType } from '@/contexts/AppContext';
import { AmountUnit } from '@/components/amount/amount-with-unit';
import { triggerHapticFeedback } from '@/utils/transport-mobile';
import { LinechartGray } from '@/components/icon';
import { getChartVisibleRange } from './chart-range';
import styles from './chart.module.css';

type TProps = {
  data?: TChartData;
  noDataPlaceholder?: JSX.Element;
  hideAmounts?: boolean;
};

const defaultData: Readonly<TChartData> = {
  chartDataMissing: true,
  chartDataDaily: [],
  chartDataHourly: [],
  chartFiat: 'USD',
  chartPerformance: {
    week: { moneyWeightedReturn: null, startTimestamp: null },
    month: { moneyWeightedReturn: null, startTimestamp: null },
    year: { moneyWeightedReturn: null, startTimestamp: null },
    all: { moneyWeightedReturn: null, startTimestamp: null },
  },
  chartTotal: null,
  formattedChartTotal: null,
  chartIsUpToDate: false,
  lastTimestamp: 0,
};

const switchedBadgeVisibleMs = 2000;
const switchedBadgeFadeMs = 180;

type FormattedData = {
  [key: number]: string;
};

const updateRange = (
  chart: IChartApi | undefined,
  startTimestamp: number | null,
) => {
  if (!chart) {
    return;
  }

  const range = getChartVisibleRange(startTimestamp);
  if (range) {
    chart.timeScale().setVisibleRange(range);
  } else {
    chart.timeScale().fitContent();
  }
};

const renderDate = (
  date: number,
  lang: string,
  src: string
) => {
  return new Date(date).toLocaleString(
    lang,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(src === 'hourly' ? {
        hour: '2-digit',
        minute: '2-digit',
      } : null)
    }
  );
};

const autoScaleProvider: AutoscaleInfoProvider = (original) => {
  const res = original();
  if (!res) {
    return null;
  }

  let { minValue, maxValue } = res.priceRange;
  const diff = maxValue - minValue;

  // if all values are equal or range is extremely small
  if (diff === 0 || diff < Math.abs(maxValue) * 0.001) {
    const center = maxValue;

    let padding: number;

    // define a natural padding strategy
    if (center === 0) {
      padding = 0.0001;
    } else if (center < 0.001) {
      padding = 0.0001; // for very small BTC-like values
    } else if (center < 1) {
      padding = 0.1;
    } else if (center < 1000) {
      padding = center * 0.1;
    } else {
      padding = center * 0.05;
    }

    minValue = center - padding;
    maxValue = center + padding;
  }

  // clamp to zero (balances never negative)
  if (minValue < 0) {
    minValue = 0;
  }

  return {
    priceRange: {
      minValue,
      maxValue,
    },
  };
};

export const Chart = ({
  data = defaultData,
  noDataPlaceholder,
  hideAmounts = false
}: TProps) => {
  const height: number = 300;
  const mobileHeight: number = 150;
  const hasData = data.chartDataDaily && data.chartDataDaily.length > 0;
  const hasHourlyData = data.chartDataHourly && data.chartDataHourly.length > 0;

  const { t, i18n } = useTranslation();
  const { isDarkMode } = useDarkmode();
  const {
    chartDisplay,
    portfolioPercentageType,
    setChartDisplay,
    updatePortfolioPercentageType,
  } = useContext(AppContext);
  const { defaultCurrency, rotateDefaultCurrency } = useContext(RatesContext);
  const [searchParams] = useSearchParams();

  const ref = useRef<HTMLDivElement>(null);
  const refToolTip = useRef<HTMLSpanElement>(null);
  const chart = useRef<IChartApi>();
  const chartInitialized = useRef(false);
  const lineSeries = useRef<ISeriesApi<'Area'>>();
  const formattedData = useRef<FormattedData>({});
  const lastHapticTime = useRef<number | null>(null);
  const switchedBadgeHideTimeout = useRef<number>();
  const switchedBadgeClearTimeout = useRef<number>();

  const source = chartDisplay === 'week' ? 'hourly' : 'daily';
  const rangeStartTimestamp = data.chartPerformance[chartDisplay].startTimestamp;
  const [valueDifference, setValueDifference] = useState<number | null>();
  const [diffSince, setDiffSince] = useState<string>();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isSwitchedBadgeVisible, setIsSwitchedBadgeVisible] = useState(false);
  const [switchedToType, setSwitchedToType] = useState<TPortfolioPercentageType>();
  const [tooltipData, setTooltipData] = useState<{
    toolTipVisible: boolean;
    toolTipValue?: string;
    toolTipTop: number;
    toolTipLeft: number;
    toolTipTime: number;
  }>({
    toolTipVisible: false,
    toolTipTop: 0,
    toolTipLeft: 0,
    toolTipTime: 0,
  });

  useEffect(() => {
    setTooltipData({
      toolTipVisible: false,
      toolTipTop: 0,
      toolTipLeft: 0,
      toolTipTime: 0,
    });
  }, [defaultCurrency]);

  const [showAnimationOverlay, setAnimationOverlay] = useState(true);

  const prevChartDataDaily = usePrevious(data.chartDataDaily);
  const prevChartDataHourly = usePrevious(data.chartDataHourly);
  const prevChartFiat = usePrevious(data.chartFiat);
  const prevHideAmounts = usePrevious(hideAmounts);
  const hasChartAnimationParam = searchParams.get('with-chart-animation');

  const setFormattedData = (chartData: ChartData) => {
    formattedData.current = {};

    chartData.forEach(entry => {
      formattedData.current[entry.time as number] = entry.formattedValue;
    });
  };

  const displayRange = (display: TChartDisplay) => {
    triggerHapticFeedback();
    setChartDisplay(display);
  };

  useEffect(() => {
    updateRange(chart.current, rangeStartTimestamp);
  }, [chartDisplay, rangeStartTimestamp, source]);

  const onResize = useCallback(() => {
    const isMobile = window.innerWidth <= 768;
    setIsMobile(isMobile);
    if (!chart.current || !ref.current) {
      return;
    }
    const chartWidth = !isMobile ? ref.current.offsetWidth : document.body.clientWidth;
    const chartHeight = !isMobile ? height : mobileHeight;
    chart.current.resize(chartWidth, chartHeight);
    chart.current.applyOptions({
      grid: {
        horzLines: {
          visible: !isMobile
        }
      },
      timeScale: {
        visible: !isMobile
      },
      leftPriceScale: {
        visible: hideAmounts ? false : !isMobile,
      },
    });
    updateRange(chart.current, rangeStartTimestamp);
  }, [hideAmounts, rangeStartTimestamp]);

  useEffect(() => {
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [onResize]);

  useEffect(() => {
    return () => {
      if (switchedBadgeHideTimeout.current) {
        window.clearTimeout(switchedBadgeHideTimeout.current);
      }
      if (switchedBadgeClearTimeout.current) {
        window.clearTimeout(switchedBadgeClearTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!switchedToType) {
      return;
    }

    setIsSwitchedBadgeVisible(false);
    const animationFrame = window.requestAnimationFrame(() => {
      setIsSwitchedBadgeVisible(true);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [switchedToType]);

  const calculateChange = useCallback(() => {
    const chartData = data[source === 'daily' ? 'chartDataDaily' : 'chartDataHourly'];
    if (!chartData || !chart.current || !lineSeries.current) {
      return;
    }
    const logicalrange = chart.current.timeScale().getVisibleLogicalRange() as LogicalRange;
    const visiblerange = lineSeries.current.barsInLogicalRange(logicalrange);
    if (!visiblerange) {
      // if the chart is empty, during first load, barsInLogicalRange is null
      return;
    }
    const rangeFrom = Math.max(Math.floor(visiblerange.barsBefore), 0);
    const firstEntry = chartData[rangeFrom];
    const startEntry = firstEntry?.value === 0 ? chartData[rangeFrom + 1] : firstEntry;
    // Series changes can temporarily leave the visible range without a starting point.
    if (!startEntry || startEntry.value <= 0 || !Number.isFinite(startEntry.value) || data.chartTotal === null) {
      setValueDifference(null);
      setDiffSince('');
      return;
    }
    setValueDifference((data.chartTotal - startEntry.value) / startEntry.value);
    setDiffSince(`${startEntry.formattedValue} (${renderDate(Number(startEntry.time) * 1000, i18n.language, source)})`);
  }, [data, i18n.language, source]);

  const removeChart = useCallback(() => {
    if (chartInitialized.current) {
      chart.current?.timeScale().unsubscribeVisibleLogicalRangeChange(calculateChange);
      chart.current?.unsubscribeCrosshairMove(handleCrosshair);
      chart.current?.remove();
      chart.current = undefined;
      chartInitialized.current = false;
    }
  }, [calculateChange]);

  const handleCrosshair = ({
    point,
    time,
    seriesData
  }: MouseEventParams) => {
    if (!refToolTip.current) {
      return;
    }
    const tooltip = refToolTip.current;
    const parent = tooltip.parentNode as HTMLDivElement;
    if (
      !lineSeries.current || !point || !time
      || point.x < 0 || point.x > parent.clientWidth
      || point.y < 0 || point.y > parent.clientHeight
    ) {
      setTooltipData((tooltipData) => ({
        ...tooltipData,
        toolTipVisible: false
      }));
      lastHapticTime.current = null;
      return;
    }
    const price = seriesData.get(lineSeries.current) as LineData<Time>;
    if (!price) {
      return;
    }

    const currentTime = time as number;
    if (lastHapticTime.current !== currentTime) {
      triggerHapticFeedback();
      lastHapticTime.current = currentTime;
    }
    const coordinate = lineSeries.current.priceToCoordinate(price.value);
    if (!coordinate) {
      return;
    }
    const coordinateY = (
      (coordinate - tooltip.clientHeight > 0)
        ? coordinate - tooltip.clientHeight
        : Math.max(
          0,
          Math.min(
            parent.clientHeight - tooltip.clientHeight,
            coordinate + 70
          )
        )
    );

    const toolTipTop = Math.floor(Math.max(coordinateY, 0));
    const toolTipLeft = Math.floor(Math.max(40, Math.min(parent.clientWidth - 140, point.x + 40 - 70)));

    setTooltipData({
      toolTipVisible: true,
      toolTipValue: formattedData.current ? formattedData.current[time as number] : '',
      toolTipTop,
      toolTipLeft,
      toolTipTime: time as number,
    });
  };

  const initChart = useCallback(() => {
    if (ref.current && hasData && !data.chartDataMissing) {
      const chartWidth = !isMobile ? ref.current.offsetWidth : document.body.clientWidth;
      const chartHeight = !isMobile ? height : mobileHeight;
      chart.current = createChart(ref.current, {
        width: chartWidth,
        height: chartHeight,
        handleScroll: false,
        handleScale: false,
        crosshair: {
          vertLine: {
            visible: false,
            labelVisible: false,
          },
          horzLine: {
            visible: false,
            labelVisible: false,
          },
          mode: 1,
        },
        grid: {
          vertLines: {
            visible: false,
          },
          horzLines: {
            color: isDarkMode ? '#333333' : '#dedede',
            style: LineStyle.Solid,
            visible: !isMobile,
          },
        },
        layout: {
          background: {
            type: ColorType.Solid,
            color: isDarkMode ? '#1D1D1B' : '#F5F5F5',
          },
          fontSize: 11,
          fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Roboto", "Oxygen", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
          textColor: isDarkMode ? '#F5F5F5' : '#1D1D1B',
        },
        leftPriceScale: {
          borderVisible: false,
          ticksVisible: false,
          visible: hideAmounts ? false : !isMobile,
          entireTextOnly: true,
        },
        localization: {
          locale: i18n.language,
        },
        rightPriceScale: {
          visible: false,
          ticksVisible: false,
        },
        timeScale: {
          borderVisible: false,
          timeVisible: chartDisplay === 'week',
          visible: !isMobile,
        },
        trackingMode: {
          exitMode: 0
        }
      });
      lineSeries.current = chart.current.addAreaSeries({
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: autoScaleProvider,
        priceFormat: (
          data.chartFiat === 'BTC' ? {
            minMove: 0.000001,
            type: 'custom',
            formatter: (price: number) => {
              if (price <= 0) {
                return '0';
              }
              return price.toLocaleString(i18n.language, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 8,
              });
            }
          } : {
            type: 'volume',
          }),
        topColor: isDarkMode ? '#5E94BF' : '#DFF1FF',
        bottomColor: isDarkMode ? '#1D1D1B' : '#F5F5F5',
        lineColor: 'rgba(94, 148, 192, 1)',
        crosshairMarkerRadius: 6,
      });
      const isChartDisplayWeekly = chartDisplay === 'week';
      const dataToDisplay = (
        isChartDisplayWeekly
          ? data.chartDataHourly
          : data.chartDataDaily
      );
      lineSeries.current.setData(dataToDisplay);
      setFormattedData(dataToDisplay);
      chart.current.timeScale().subscribeVisibleLogicalRangeChange(calculateChange);
      chart.current.subscribeCrosshairMove(handleCrosshair);
      chart.current.timeScale().fitContent();
      if (styles.invisible) {
        ref.current?.classList.remove(styles.invisible);
      }
      chartInitialized.current = true;
      updateRange(chart.current, rangeStartTimestamp);
    }
  }, [calculateChange, chartDisplay, data.chartDataDaily, data.chartDataHourly, data.chartDataMissing, data.chartFiat, hasData, hideAmounts, i18n.language, isMobile, isDarkMode, rangeStartTimestamp]);

  const reinitializeChart = () => {
    removeChart();
    initChart();
  };

  const nextPercentageType = portfolioPercentageType === 'moneyWeightedReturn' ? 'value' : 'moneyWeightedReturn';

  const togglePortfolioPercentageType = () => {
    updatePortfolioPercentageType(nextPercentageType);
    setSwitchedToType(nextPercentageType);
    setIsSwitchedBadgeVisible(false);

    if (switchedBadgeHideTimeout.current) {
      window.clearTimeout(switchedBadgeHideTimeout.current);
    }
    if (switchedBadgeClearTimeout.current) {
      window.clearTimeout(switchedBadgeClearTimeout.current);
    }
    switchedBadgeHideTimeout.current = window.setTimeout(() => {
      setIsSwitchedBadgeVisible(false);
      switchedBadgeHideTimeout.current = undefined;
    }, switchedBadgeVisibleMs);
    switchedBadgeClearTimeout.current = window.setTimeout(() => {
      setSwitchedToType(undefined);
      switchedBadgeClearTimeout.current = undefined;
    }, switchedBadgeVisibleMs + switchedBadgeFadeMs);
  };

  if (source === 'daily' && prevChartDataDaily?.length !== data.chartDataDaily.length) {
    lineSeries.current?.setData(data.chartDataDaily);
    chart.current?.timeScale().fitContent();
    setFormattedData(data.chartDataDaily);
  }

  if (source === 'hourly' && prevChartDataHourly?.length !== data.chartDataHourly.length) {
    lineSeries.current?.setData(data.chartDataHourly);
    chart.current?.timeScale().fitContent();
    setFormattedData(data.chartDataHourly);
  }

  if (prevChartFiat !== data.chartFiat) {
    reinitializeChart();
  }

  if (prevHideAmounts !== hideAmounts) {
    chart.current?.applyOptions({
      leftPriceScale: {
        visible: hideAmounts ? false : !isMobile,
      }
    });
  }

  useEffect(() => {
    if (!chartInitialized.current) {
      initChart();
    }
    return () => {
      removeChart();
    };
  }, [initChart, removeChart]);

  useEffect(() => {
    if (data.chartDataMissing || !hasChartAnimationParam) {
      return;
    }
    setAnimationOverlay(false);
  }, [data.chartDataMissing, hasChartAnimationParam]);

  const {
    lastTimestamp,
    chartDataMissing,
    chartFiat,
    chartIsUpToDate,
    chartTotal,
    formattedChartTotal,
  } = data;

  const moneyWeightedReturn = data.chartPerformance[chartDisplay].moneyWeightedReturn;
  const difference = portfolioPercentageType === 'moneyWeightedReturn'
    ? moneyWeightedReturn
    : valueDifference;
  const displayModeLabels = {
    value: t('chart.displayMode.totalValue'),
    moneyWeightedReturn: t('chart.displayMode.performance'),
  };
  const switchedLabel = switchedToType ? displayModeLabels[switchedToType] : undefined;
  const differenceAvailable = typeof difference === 'number' && Number.isFinite(difference);
  const percentageToggleLabel = differenceAvailable
    ? t('chart.displayMode.switchTo', { displayMode: displayModeLabels[nextPercentageType] })
    : t('chart.displayMode.unavailableSwitchTo', {
      displayMode: displayModeLabels[portfolioPercentageType],
      nextDisplayMode: displayModeLabels[nextPercentageType],
    });

  if (!hasData && chartIsUpToDate && valueDifference !== null) {
    setDiffSince('');
    setValueDifference(null);
  }

  const {
    toolTipVisible,
    toolTipValue,
    toolTipTop,
    toolTipLeft,
    toolTipTime,
  } = tooltipData;

  const disableFilters = !hasData || chartDataMissing;
  const disableWeeklyFilters = !hasHourlyData || chartDataMissing;
  const showMobileTotalValue = toolTipVisible && !!toolTipValue && isMobile;
  const chartFiltersProps = {
    display: chartDisplay,
    disableFilters,
    disableWeeklyFilters,
    onDisplayWeek: () => displayRange('week'),
    onDisplayMonth: () => displayRange('month'),
    onDisplayYear: () => displayRange('year'),
    onDisplayAll: () => displayRange('all'),
  };

  const chartHeight = `${!isMobile ? height : mobileHeight}px`;

  return (
    <section className={styles.chart}>
      <header>
        <div className={styles.summary}>
          <div className={styles.totalValue}>
            {formattedChartTotal !== null ? (
              // remove trailing zeroes for BTC fiat total
              <Amount
                amount={!showMobileTotalValue ? formattedChartTotal : toolTipValue}
                unit={chartFiat}
                onMobileClick={rotateDefaultCurrency}
              />
            ) : (
              <Skeleton minWidth="220px" />
            )}
            <span className={styles.totalUnit}>
              {chartTotal !== null && <AmountUnit unit={chartFiat} rotateUnit={rotateDefaultCurrency}/>}
            </span>
          </div>
          {!showMobileTotalValue ? (
            <PercentageDiff
              ariaLabel={percentageToggleLabel}
              badgeVisible={isSwitchedBadgeVisible}
              difference={difference}
              onClick={togglePortfolioPercentageType}
              switchedLabel={switchedLabel}
              switchedType={switchedToType}
              title={diffSince}
            />
          ) : (
            <span className={styles.diffValue}>
              {renderDate(toolTipTime * 1000, i18n.language, source)}
            </span>
          )}
        </div>
        {!isMobile && <Filters {...chartFiltersProps} />}
      </header>
      {!chartDataMissing && hasChartAnimationParam && (
        <div
          style={{ minHeight: chartHeight }}
          className={`
          ${styles.transitionDiv || ''}
          ${showAnimationOverlay ? '' : styles.overlayRemove || ''}`}
        />
      )}
      <div className={styles.chartCanvas} style={{ minHeight: chartHeight }}>
        {chartDataMissing ? (
          <div className={styles.chartUnavailableMessageContainer} style={{ height: chartHeight }}>
            <div className={styles.chartUnavailableMessage}>
              <LinechartGray />
              <p>
                {t('chart.dataMissing')}
              </p>
            </div>
          </div>
        ) : hasData ? !chartIsUpToDate && (
          <div className={styles.chartUpdatingMessage}>
            {t('chart.dataOldTimestamp', {
              time: new Date(lastTimestamp).toLocaleString(i18n.language)
            })}
          </div>
        ) : (
          <div className={styles.placeholderContainer}>
            {noDataPlaceholder}
          </div>
        )}
        <div ref={ref} className={styles.invisible}></div>
        <span
          ref={refToolTip}
          className={styles.tooltip}
          style={{ left: toolTipLeft, top: toolTipTop }}
          hidden={!toolTipVisible || isMobile}>
          {toolTipValue !== undefined ? (
            <span>
              <h2 className={styles.toolTipValue}>
                <Amount amount={toolTipValue} unit={chartFiat} />
                <span className={styles.toolTipUnit}>{chartFiat}</span>
              </h2>
              <span className={styles.toolTipTime}>
                {renderDate(toolTipTime * 1000, i18n.language, source)}
              </span>
            </span>
          ) : null}
        </span>
      </div>
      {isMobile && <Filters {...chartFiltersProps} />}
    </section>
  );
};
