// SPDX-License-Identifier: Apache-2.0

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { t } = vi.hoisted(() => ({
  t: (key: string) => key,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t }),
}));
vi.mock('@/api/lightning');
vi.mock('@/hooks/debounce', () => ({
  useDebounce: <T>(value: T) => value,
}));

import * as lightningApi from '@/api/lightning';
import { usePaymentReview } from './use-payment-review';

const firstKey = '00000000-0000-4000-8000-000000000001';
const secondKey = '00000000-0000-4000-8000-000000000002';

const paymentDetails = {
  type: lightningApi.TPaymentInputType.LNURL_PAY,
  details: {
    input: 'alice@example.com',
    domain: 'example.com',
    minAmountSat: 1,
    maxAmountSat: 1_000,
  },
} as const;

const readyPayment = (idempotencyKey = firstKey, status: 'ready' | 'unknown' = 'ready') => ({
  status,
  idempotencyKey,
  amountSat: 100,
  feeSat: 2,
  totalDebitSat: 102,
} as const);

const finalPayment = (status: 'pending' | 'completed' | 'failed', idempotencyKey = firstKey) => ({
  status,
  idempotencyKey,
} as const);

const renderPaymentReview = () => {
  const backToPaymentInput = vi.fn();
  const onSuccess = vi.fn();
  const hook = renderHook(() => usePaymentReview({
    paymentDetails,
    backToPaymentInput,
    onSuccess,
  }));
  return { ...hook, backToPaymentInput, onSuccess };
};

const enterAmount = async (result: ReturnType<typeof renderPaymentReview>['result']) => {
  act(() => result.current.setCustomAmount(100));
  await waitFor(() => expect(lightningApi.postPreparePayment).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(result.current.preparedPayment?.status).not.toBe('preparing'));
};

describe('usePaymentReview LNURL payment intent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(lightningApi.subscribeListPayments).mockReturnValue(vi.fn());
  });

  it('echoes the prepared UUID and reports immediate completion', async () => {
    vi.mocked(lightningApi.postPreparePayment).mockResolvedValue(readyPayment());
    vi.mocked(lightningApi.postSendPayment).mockResolvedValue({ status: 'completed' });
    const { result, onSuccess } = renderPaymentReview();

    await enterAmount(result);
    await act(async () => result.current.sendPayment());

    expect(lightningApi.postSendPayment).toHaveBeenCalledWith({
      type: lightningApi.TPaymentInputType.LNURL_PAY,
      paymentInput: 'alice@example.com',
      amountSat: 100,
      approvedFeeSat: 2,
      idempotencyKey: firstKey,
    });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('retires completed attempts explicitly and requires a fresh review', async () => {
    vi.mocked(lightningApi.postPreparePayment)
      .mockResolvedValueOnce(finalPayment('completed'))
      .mockResolvedValueOnce(readyPayment(secondKey));
    vi.mocked(lightningApi.postStartNewPayment).mockResolvedValue();
    const { result } = renderPaymentReview();

    await enterAmount(result);
    await act(async () => result.current.startNewPayment());

    expect(lightningApi.postStartNewPayment).toHaveBeenCalledWith({
      type: lightningApi.TPaymentInputType.LNURL_PAY,
      paymentInput: 'alice@example.com',
      amountSat: 100,
      idempotencyKey: firstKey,
    });
    expect(lightningApi.postSendPayment).not.toHaveBeenCalled();
    expect(result.current.preparedPayment).toMatchObject({
      status: 'ready',
      idempotencyKey: secondKey,
    });
  });

  it('retries an unknown attempt with the same UUID', async () => {
    vi.mocked(lightningApi.postPreparePayment).mockResolvedValue(readyPayment(firstKey, 'unknown'));
    vi.mocked(lightningApi.postSendPayment).mockResolvedValue({ status: 'pending' });
    const { result } = renderPaymentReview();

    await enterAmount(result);
    await act(async () => result.current.sendPayment());

    expect(lightningApi.postSendPayment).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: firstKey,
    }));
    expect(result.current.preparedPayment).toMatchObject({
      status: 'pending',
      idempotencyKey: firstKey,
    });
    expect(result.current.canSend).toBe(false);
  });

  it('advances a pending attempt when its payment event completes', async () => {
    let paymentListener: ((payments: lightningApi.TLightningPayment[]) => void) | undefined;
    vi.mocked(lightningApi.subscribeListPayments).mockImplementation((listener) => {
      paymentListener = listener;
      return vi.fn();
    });
    vi.mocked(lightningApi.postPreparePayment)
      .mockResolvedValueOnce(readyPayment())
      .mockResolvedValueOnce(finalPayment('completed'));
    vi.mocked(lightningApi.postSendPayment).mockResolvedValue({ status: 'pending' });
    const { result, onSuccess } = renderPaymentReview();

    await enterAmount(result);
    await act(async () => result.current.sendPayment());
    await waitFor(() => expect(paymentListener).toBeDefined());

    act(() => paymentListener?.([{ id: firstKey } as lightningApi.TLightningPayment]));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });

  it('reconciles state after an ambiguous send error', async () => {
    vi.mocked(lightningApi.postPreparePayment)
      .mockResolvedValueOnce(readyPayment())
      .mockResolvedValueOnce(readyPayment(firstKey, 'unknown'));
    vi.mocked(lightningApi.postSendPayment).mockRejectedValue(new Error('response lost'));
    const { result } = renderPaymentReview();

    await enterAmount(result);
    await act(async () => result.current.sendPayment());

    expect(lightningApi.postPreparePayment).toHaveBeenCalledTimes(2);
    expect(result.current.preparedPayment).toMatchObject({
      status: 'unknown',
      idempotencyKey: firstKey,
    });
    expect(result.current.sendError).toContain('response lost');
  });

  it('ignores an older same-amount refresh after starting a new attempt', async () => {
    let paymentListener: ((payments: lightningApi.TLightningPayment[]) => void) | undefined;
    let resolveStaleRefresh: ((value: lightningApi.TPreparePaymentResponse) => void) | undefined;
    const staleRefresh = new Promise<lightningApi.TPreparePaymentResponse>((resolve) => {
      resolveStaleRefresh = resolve;
    });
    vi.mocked(lightningApi.subscribeListPayments).mockImplementation((listener) => {
      paymentListener = listener;
      return vi.fn();
    });
    vi.mocked(lightningApi.postPreparePayment)
      .mockResolvedValueOnce(finalPayment('completed'))
      .mockReturnValueOnce(staleRefresh)
      .mockResolvedValueOnce(readyPayment(secondKey));
    vi.mocked(lightningApi.postStartNewPayment).mockResolvedValue();
    const { result } = renderPaymentReview();

    await enterAmount(result);
    await waitFor(() => expect(paymentListener).toBeDefined());
    act(() => paymentListener?.([{ id: firstKey } as lightningApi.TLightningPayment]));
    await waitFor(() => expect(lightningApi.postPreparePayment).toHaveBeenCalledTimes(2));
    await act(async () => result.current.startNewPayment());
    act(() => resolveStaleRefresh?.(finalPayment('completed')));

    await waitFor(() => expect(result.current.preparedPayment).toMatchObject({
      status: 'ready',
      idempotencyKey: secondKey,
    }));
  });
});
