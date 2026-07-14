// SPDX-License-Identifier: Apache-2.0

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { TBalance } from '@/api/account';
import { getLightningBalance, subscribeListPayments } from '@/api/lightning';
import { RatesContext } from '@/contexts/RatesContext';
import { useMountedRef } from '@/hooks/mount';

export const useLightningBalance = (): TBalance | undefined => {
  const { btcUnit } = useContext(RatesContext);
  const mounted = useMountedRef();
  const request = useRef(0);
  const [balance, setBalance] = useState<TBalance>();

  const loadBalance = useCallback((reset = false) => {
    const currentRequest = ++request.current;
    if (reset) {
      setBalance(undefined);
    }
    getLightningBalance()
      .then((balance) => {
        if (currentRequest === request.current && mounted.current) {
          setBalance(balance);
        }
      })
      .catch(console.error);
  }, [mounted]);

  useEffect(() => {
    loadBalance(true);
    return subscribeListPayments(() => loadBalance());
  }, [btcUnit, loadBalance]);

  return balance;
};
