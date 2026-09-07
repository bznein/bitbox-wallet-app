// SPDX-License-Identifier: Apache-2.0

import { useState, type ContextType } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { createChart, type UTCTimestamp } from 'lightweight-charts';
import type { TChartData } from '@/api/account';
import { AppContext, type TChartDisplay, type TPortfolioPercentageType } from '@/contexts/AppContext';
import { LocalizationContext } from '@/contexts/localization-context';
import translations from '@/locales/en/app.json';
import { Chart } from './chart';

vi.mock('@/hooks/mediaquery', () => ({ useMediaQuery: () => false }));
vi.mock('@/utils/transport-mobile', () => ({ triggerHapticFeedback: vi.fn() }));
vi.mock('lightweight-charts', async importOriginal => {
  const original = await importOriginal<typeof import('lightweight-charts')>();
  return {
    ...original,
    createChart: vi.fn(() => {
      let onRangeChange = () => {};
      const timeScale = {
        getVisibleLogicalRange: () => ({ from: 0, to: 1 }),
        setVisibleRange: vi.fn(() => onRangeChange()),
        fitContent: () => onRangeChange(),
        subscribeVisibleLogicalRangeChange: (callback: () => void) => {
          onRangeChange = callback;
        },
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
      };
      return {
        addAreaSeries: () => ({
          setData: vi.fn(),
          barsInLogicalRange: () => ({ barsBefore: 0 }),
        }),
        timeScale: () => timeScale,
        subscribeCrosshairMove: vi.fn(),
        unsubscribeCrosshairMove: vi.fn(),
        applyOptions: vi.fn(),
        remove: vi.fn(),
      };
    }),
  };
});

const i18n = createInstance();
beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: translations } } });
});

const renderChart = (total: number | null) => {
  const start = (Math.floor(Date.now() / 1000) - 24 * 3600) as UTCTimestamp;
  const performance = { moneyWeightedReturn: 0, startTimestamp: start };
  const data: TChartData = {
    chartDataMissing: false,
    chartIsUpToDate: true,
    chartFiat: 'USD',
    chartTotal: total,
    formattedChartTotal: total?.toFixed(2) ?? null,
    chartDataDaily: [{ time: start, value: 100, formattedValue: '100.00' }],
    chartDataHourly: [{ time: start, value: 200, formattedValue: '200.00' }],
    chartPerformance: { week: performance, month: performance, year: performance, all: { ...performance, startTimestamp: null } },
    lastTimestamp: start * 1000,
  };
  const Wrapper = () => {
    const [chartDisplay, setChartDisplay] = useState<TChartDisplay>('all');
    const [portfolioPercentageType, updatePortfolioPercentageType] = useState<TPortfolioPercentageType>('value');
    const context = {
      chartDisplay, setChartDisplay, portfolioPercentageType, updatePortfolioPercentageType,
      hideAmounts: false, nativeLocale: 'en',
    } as ContextType<typeof AppContext>;
    return (
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <AppContext.Provider value={context}>
            <LocalizationContext.Provider value={{ decimal: '.', group: ',' }}>
              <Chart data={data} />
            </LocalizationContext.Provider>
          </AppContext.Provider>
        </I18nextProvider>
      </MemoryRouter>
    );
  };
  render(<Wrapper />);
  return start;
};

describe('Chart percentage', () => {
  it('shows the full decrease to zero and can switch to zero performance', () => {
    renderChart(0);
    const toggle = screen.getByRole('button', { name: 'Switch to Performance' });
    expect(toggle).toHaveTextContent('-100.00%');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Switch to Value over time' })).toHaveTextContent('0.00%');
  });

  it('keeps a missing ending value unavailable', () => {
    renderChart(null);
    expect(screen.getByRole('button', { name: 'Value over time unavailable. Switch to Performance' })).toHaveTextContent('—');
  });

  it('switches between daily and hourly data using the backend range', () => {
    const start = renderChart(150);
    expect(screen.getByRole('button', { name: 'Switch to Performance' })).toHaveTextContent('50.00%');
    fireEvent.click(screen.getByRole('button', { name: translations.chart.filter.week }));
    expect(screen.getByRole('button', { name: 'Switch to Performance' })).toHaveTextContent('-25.00%');
    expect(createChart).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      timeScale: expect.objectContaining({ timeVisible: true }),
    }));
    const chart = vi.mocked(createChart).mock.results.at(-1)?.value;
    expect(chart.timeScale().setVisibleRange).toHaveBeenCalledWith(expect.objectContaining({ from: start }));
    fireEvent.click(screen.getByRole('button', { name: translations.chart.filter.all }));
    expect(screen.getByRole('button', { name: 'Switch to Performance' })).toHaveTextContent('50.00%');
  });
});
