// SPDX-License-Identifier: Apache-2.0

import Select, { components, SingleValueProps, OptionProps, DropdownIndicatorProps } from 'react-select';
import type { CoinUnit, TAmountWithConversions } from '@/api/account';
import type { TSwapQuoteRoute } from '@/api/swap';
import { Label } from '@/components/forms';
import { ChevronDownDark } from '@/components/icon';
import { Badge } from '@/components/badge/badge';
import { AmountWithUnit } from '@/components/amount/amount-with-unit';
import { SwapServiceLogo } from './swap-service-logo';
import style from './swap-service-selector.module.css';

type TOption = {
  amount: TAmountWithConversions;
  fee: string;
  label: string;
  isFast: boolean;
  isRecommended: boolean;
  provider: string;
  value: string;
};

type SwapProviderOptionProps = {
  data: TOption;
};

const SwapProviderOption = ({ data }: SwapProviderOptionProps) => {
  return (
    <>
      <SwapServiceLogo name={data.provider} />
      <span>
        <span className={style.serivceName}>
          {data.label}
        </span>
        {data.isRecommended && (
          <Badge type="success">Recommended</Badge>
        )}
        {data.isFast && (
          <Badge type="warning">Fastest</Badge>
        )}
        <span className={style.fee}>
          Fee:
          {' '}
          {data.fee}
        </span>
      </span>
      <span className={style.amount}>
        <AmountWithUnit amount={data.amount} />
      </span>
    </>
  );
};

const CustomSingleValue = (props: SingleValueProps<TOption, false>) => {
  const { data } = props;
  return (
    <components.SingleValue {...props}>
      <div className={style.swapServiceOption}>
        <SwapProviderOption data={data} />
      </div>
    </components.SingleValue>
  );
};

const CustomOption = (props: OptionProps<TOption, false>) => {
  const { data, innerProps, isFocused, isSelected } = props;

  return (
    <div
      {...innerProps}
      className={`
        ${style.customOption || ''}
        ${isFocused && style.customOptionFocused || ''}
        ${isSelected && style.customOptionSelected || ''}
      `}
    >
      <div className={style.swapServiceOption}>
        <SwapProviderOption data={data} />
      </div>
    </div>
  );
};

const DropdownIndicator = (props: DropdownIndicatorProps<TOption>) => (
  <components.DropdownIndicator {...props}>
    <ChevronDownDark />
  </components.DropdownIndicator>
);

type Props = {
  buyUnit: CoinUnit | undefined;
  error?: string;
  isLoading: boolean;
  onChangeRouteId: (routeId: string) => void;
  routes: TSwapQuoteRoute[];
  selectedRouteId?: string;
};

const addDecimalStrings = (a: string, b: string): string => {
  const [aInt = '0', aFrac = ''] = a.split('.');
  const [bInt = '0', bFrac = ''] = b.split('.');
  const fracLength = Math.max(aFrac.length, bFrac.length);
  const scale = BigInt(`1${'0'.repeat(fracLength)}`);
  const toScaled = (intPart: string, fracPart: string): bigint => {
    const normalizedFrac = fracPart.padEnd(fracLength, '0');
    return BigInt(intPart || '0') * scale + BigInt(normalizedFrac || '0');
  };
  const sum = toScaled(aInt, aFrac) + toScaled(bInt, bFrac);
  const intPart = sum / scale;
  const fracPart = (sum % scale).toString().padStart(fracLength, '0').replace(/0+$/, '');
  return fracPart.length ? `${intPart.toString()}.${fracPart}` : intPart.toString();
};

const getFeeLabel = (route: TSwapQuoteRoute): string => {
  if (!route.fees.length) {
    return '-';
  }
  const feesByAsset: Record<string, string> = {};
  route.fees.forEach(fee => {
    const currentFeeAmount = feesByAsset[fee.asset] ?? '0';
    feesByAsset[fee.asset] = addDecimalStrings(currentFeeAmount, fee.amount);
  });
  return Object.entries(feesByAsset)
    .map(([asset, amount]) => `${amount} ${asset}`)
    .join(' + ');
};

export const SwapServiceSelector = ({
  buyUnit,
  error,
  isLoading,
  onChangeRouteId,
  routes,
  selectedRouteId,
}: Props) => {
  const unit = buyUnit || 'BTC';
  const options: TOption[] = routes.map((route, index) => ({
    amount: {
      amount: route.expectedBuyAmount,
      unit,
      estimated: false,
      conversions: {},
    },
    fee: getFeeLabel(route),
    label: 'NEAR',
    isRecommended: index === 0,
    isFast: false,
    provider: 'near',
    value: route.routeId,
  }));

  const selectedOption = options.find(option => option.value === selectedRouteId) || options[0];
  const hasMultipleRoutes = options.length > 1;

  return (
    <section>
      <Label>
        Swap route
      </Label>
      <Select<TOption>
        className={style.select}
        classNamePrefix="react-select"
        isClearable={false}
        components={{
          IndicatorSeparator: undefined,
          DropdownIndicator,
          Option: CustomOption,
          SingleValue: CustomSingleValue,
        }}
        isDisabled={!options.length || !hasMultipleRoutes || isLoading}
        isSearchable={false}
        options={options}
        value={selectedOption}
        onChange={option => option && onChangeRouteId(option.value)}
      />
      {isLoading && (
        <p className={style.statusText}>Fetching routes...</p>
      )}
      {!isLoading && error && (
        <p className={style.errorText}>{error}</p>
      )}
      {!isLoading && !error && options.length === 1 && (
        <p className={style.statusText}>One route available.</p>
      )}
    </section>
  );
};
