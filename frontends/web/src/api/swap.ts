// SPDX-License-Identifier: Apache-2.0

import type { AccountCode } from './account';
import { runningInQtWebEngine, runningOnMobile } from '@/utils/env';
import { apiURL } from '@/utils/request';
import { call } from '@/utils/transport-qt';
import { mobileCall } from '@/utils/transport-mobile';

export type TGetSwapQuote = {
  buyAsset: AccountCode;
  sellAmount: string;
  sellAsset: AccountCode;
};

export type TSwapFee = {
  type: string;
  amount: string;
  asset: string;
  chain: string;
  protocol: string;
};

export type TSwapQuoteRoute = {
  routeId: string;
  providers: string[];
  sellAsset: string;
  buyAsset: string;
  sellAmount: string;
  expectedBuyAmount: string;
  expectedBuyAmountMaxSlippage: string;
  fees: TSwapFee[];
};

export type TSwapQuote = {
  quoteId: string;
  routes: TSwapQuoteRoute[];
  error?: string;
};

export type TSwapResponse = {
  success: boolean;
  error?: string;
  quote?: TSwapQuote;
};

const postSwapQuote = (data: TGetSwapQuote): Promise<TSwapResponse> => {
  if (runningInQtWebEngine()) {
    return call(JSON.stringify({
      method: 'POST',
      endpoint: 'swap/quote',
      body: JSON.stringify(data),
    })) as Promise<TSwapResponse>;
  }
  if (runningOnMobile()) {
    return mobileCall(JSON.stringify({
      method: 'POST',
      endpoint: 'swap/quote',
      body: JSON.stringify(data),
    })) as Promise<TSwapResponse>;
  }
  return fetch(apiURL('swap/quote'), {
    method: 'POST',
    body: JSON.stringify(data),
  }).then(response => response.json());
};

export const getSwapQuote = (
  data: TGetSwapQuote,
): Promise<TSwapResponse> => {
  return postSwapQuote(data);
};
