/**
 * Copyright 2024 Shift Crypto AG
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ConversionUnit } from '@/api/account';
import { Amount } from '@/components/amount/amount';
import style from './fiat-value.module.css';

type TFiatValueProps = {
  amount: string;
  baseCurrencyUnit: ConversionUnit;
  className?: string;
}

export const FiatValue = ({
  amount,
  baseCurrencyUnit,
  className,
}: TFiatValueProps) => {

  const classNames = `${style.fiatValue} ${className ? className : ''}`;

  return (
    <p className={classNames}>
      <span>
        <Amount
          alwaysShowAmounts
          amount={amount}
          unit={baseCurrencyUnit} />
        {' '}
        <span className={style.unit}>
          {baseCurrencyUnit}
        </span>
      </span>
    </p>
  );
};
