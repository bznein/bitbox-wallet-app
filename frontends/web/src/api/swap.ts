// SPDX-License-Identifier: Apache-2.0

import type { AccountCode } from './account';
import type { FeeTargetCode } from './account';
import { apiPost } from '@/utils/request';

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
  expectedBuyAmount: string;
  expectedBuyAmountMaxSlippage?: string;
  sellAmount: string;
  sellAsset: string;
  buyAsset: string;
};

export type TSwapQuoteResponse = {
  success: true;
  quote: {
    quoteId: string;
    routes: TSwapQuoteRoute[];
  };
} | {
  success: false;
  error: string;
};

export const getSwapQuote = (
  data: TSwapQuoteRequest,
): Promise<TSwapQuoteResponse> => {
  return apiPost('swap/quote', data);
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
