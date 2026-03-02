// SPDX-License-Identifier: Apache-2.0

import type { AccountCode } from './account';
import type { FeeTargetCode } from './account';
import { runningInQtWebEngine, runningOnMobile } from '@/utils/env';
import { apiPost, apiURL } from '@/utils/request';
import { call } from '@/utils/transport-qt';
import { mobileCall } from '@/utils/transport-mobile';

export type TSwapQuoteRequest = {
  buyAsset: string;
  sellAmount: string;
  sellAsset: string;
  sourceAddress?: string;
  destinationAddress?: string;
};

export type TSwapQuoteRoute = {
  routeId: string;
  providers: string[];
  fees: TSwapFee[];
  expectedBuyAmount: string;
  expectedBuyAmountMaxSlippage?: string;
  sellAmount: string;
  sellAsset: string;
  buyAsset: string;
};

export type TSwapFee = {
  type: string;
  amount: string;
  asset: string;
  chain: string;
  protocol: string;
};

export type TSwapQuoteResponse = {
  success: boolean;
  error?: string;
  quote?: {
    quoteId: string;
    routes: TSwapQuoteRoute[];
  };
};

const postSwapQuote = (data: TSwapQuoteRequest): Promise<TSwapQuoteResponse> => {
  if (runningInQtWebEngine()) {
    return call(JSON.stringify({
      method: 'POST',
      endpoint: 'swap/quote',
      body: JSON.stringify(data),
    })) as Promise<TSwapQuoteResponse>;
  }
  if (runningOnMobile()) {
    return mobileCall(JSON.stringify({
      method: 'POST',
      endpoint: 'swap/quote',
      body: JSON.stringify(data),
    })) as Promise<TSwapQuoteResponse>;
  }
  return fetch(apiURL('swap/quote'), {
    method: 'POST',
    body: JSON.stringify(data),
  }).then(response => response.json());
};

export const getSwapQuote = (
  data: TSwapQuoteRequest,
): Promise<TSwapQuoteResponse> => {
  return postSwapQuote(data);
};

export type TSwapExecuteRequest = {
  accountCode: AccountCode;
  routeId: string;
  sourceAddress: string;
  destinationAddress: string;
  feeTarget?: FeeTargetCode;
  customFee?: string;
  useHighestFee?: boolean;
  txNote?: string;
};

export type TSwapExecuteResponse = {
  success: true;
  txId: string;
} | {
  success: false;
  error?: string;
  errorCode?: string;
  aborted?: boolean;
};

export const executeSwap = (
  data: TSwapExecuteRequest,
): Promise<TSwapExecuteResponse> => {
  return apiPost('swap/execute', data);
};
