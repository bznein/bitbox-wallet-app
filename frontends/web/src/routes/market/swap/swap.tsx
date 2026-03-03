// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { alertUser } from '@/components/alert/Alert';
import { getBalance, getReceiveAddressList, hasPaymentRequest, TBalance, type AccountCode, type CoinCode, type TAccount } from '@/api/account';
import { GuideWrapper, GuidedContent, Main, Header } from '@/components/layout';
import { View, ViewButtons, ViewContent } from '@/components/view/view';
import { SubTitle } from '@/components/title';
import { Guide } from '@/components/guide/guide';
import { Entry } from '@/components/guide/entry';
import { Button, Label } from '@/components/forms';
import { BackButton } from '@/components/backbutton/backbutton';
import { SwapServiceSelector } from './components/swap-service-selector';
import { InputWithAccountSelector } from './components/input-with-account-selector';
import { AmountWithUnit } from '@/components/amount/amount-with-unit';
import { ArrowSwap } from '@/components/icon';
import { executeSwap, getSwapQuote, type TSwapQuoteRoute } from '@/api/swap';
import { FirmwareUpgradeRequiredDialog } from '@/components/dialog/firmware-upgrade-required-dialog';
import style from './swap.module.css';

type Props = {
  accounts: TAccount[];
  code: AccountCode;
};

const fetchBlance = async (code: AccountCode) => {
  const response = await getBalance(code);
  if (response.success) {
    return response.balance;
  }
  return;
};

const toSwapkitAsset = (coinCode: CoinCode | undefined): string | undefined => {
  if (!coinCode) {
    return;
  }
  const erc20AssetMap: Partial<Record<CoinCode, string>> = {
    'eth-erc20-usdt': 'ETH.USDT-0xdac17f958d2ee523a2206206994597c13d831ec7',
    'eth-erc20-usdc': 'ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    'eth-erc20-link': 'ETH.LINK-0x514910771af9ca656af840dff83e8264ecf986ca',
    'eth-erc20-bat': 'ETH.BAT-0x0d8775f648430679a709e98d2b0cb6250d2887ef',
    'eth-erc20-mkr': 'ETH.MKR-0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2',
    'eth-erc20-zrx': 'ETH.ZRX-0xe41d2489571d322189246dafa5ebde1f4699f498',
    'eth-erc20-wbtc': 'ETH.WBTC-0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    'eth-erc20-paxg': 'ETH.PAXG-0x45804880De22913dAFE09f4980848ECE6EcbAf78',
    'eth-erc20-dai0x6b17': 'ETH.DAI-0x6b175474e89094c44da98b954eedeac495271d0f',
  };
  if (coinCode in erc20AssetMap) {
    return erc20AssetMap[coinCode];
  }
  switch (coinCode) {
  case 'btc':
    return 'BTC.BTC';
  case 'eth':
    return 'ETH.ETH';
  default:
    return;
  }
};

export const Swap = ({
  accounts,
  code,
}: Props) => {
  const { t } = useTranslation();

  const [fromAccountCode, setFromAccountCode] = useState<AccountCode>(code);
  const [swapSendAmount, setSwapSendAmount] = useState<string>('');
  const [swapMaxAmount, setSwapMaxAmount] = useState<TBalance | undefined>();

  const [toAccountCode, setToAccountCode] = useState<AccountCode | undefined>(
    accounts.find(account => account.code !== code)?.code
  );
  const [swapReceiveAmount, setSwapReceiveAmount] = useState<string>('');
  const [routes, setRoutes] = useState<TSwapQuoteRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>();
  const [isFetchingRoutes, setIsFetchingRoutes] = useState(false);
  const [routeError, setRouteError] = useState<string | undefined>();

  const [isSwapping, setIsSwapping] = useState(false);
  const [fwRequiredDialog, setFwRequiredDialog] = useState(false);

  const fromAccount = useMemo(
    () => accounts.find(account => account.code === fromAccountCode),
    [accounts, fromAccountCode],
  );
  const toAccount = useMemo(
    () => accounts.find(account => account.code === toAccountCode),
    [accounts, toAccountCode],
  );
  const selectedRoute = useMemo(
    () => routes.find(route => route.routeId === selectedRouteId),
    [routes, selectedRouteId]
  );

  useEffect(() => {
    if (fromAccountCode) {
      fetchBlance(fromAccountCode).then(setSwapMaxAmount);
    }
  }, [fromAccountCode]);

  useEffect(() => {
    if (toAccountCode || accounts.length === 0) {
      return;
    }
    const firstDifferent = accounts.find(account => account.code !== fromAccountCode);
    if (firstDifferent) {
      setToAccountCode(firstDifferent.code);
    }
  }, [accounts, fromAccountCode, toAccountCode]);

  useEffect(() => {
    let isCancelled = false;
    const sellAsset = toSwapkitAsset(fromAccount?.coinCode);
    const buyAsset = toSwapkitAsset(toAccount?.coinCode);
    const amount = Number(swapSendAmount);

    if (
      !sellAsset
      || !buyAsset
      || !swapSendAmount
      || Number.isNaN(amount)
      || amount <= 0
      || fromAccountCode === toAccountCode
    ) {
      const hasAssetSelection = !!fromAccountCode && !!toAccountCode;
      setRoutes([]);
      setSelectedRouteId(undefined);
      setSwapReceiveAmount('');
      setRouteError(hasAssetSelection && (!sellAsset || !buyAsset)
        ? 'Selected assets are not supported for quoting yet.'
        : undefined);
      setIsFetchingRoutes(false);
      return;
    }

    setIsFetchingRoutes(true);
    setRouteError(undefined);

    const timeoutId = window.setTimeout(() => {
      getSwapQuote({
        buyAsset,
        sellAmount: swapSendAmount,
        sellAsset,
      })
        .then(response => {
          if (isCancelled) {
            return;
          }
          const nextRoutes = response.quote?.routes || [];
          if (nextRoutes.length) {
            setRoutes(nextRoutes);
            const firstRouteId = nextRoutes[0]?.routeId;
            setSelectedRouteId(currentRouteId => (
              nextRoutes.some(route => route.routeId === currentRouteId)
                ? currentRouteId
                : firstRouteId
            ));
            return;
          }
          if (response.error) {
            setRoutes([]);
            setSelectedRouteId(undefined);
            setSwapReceiveAmount('');
            setRouteError(response.error);
            return;
          }
          setRoutes([]);
          setSelectedRouteId(undefined);
          setSwapReceiveAmount('');
          setRouteError('No quotes are available for the selected parameters.');
        })
        .catch((error: unknown) => {
          if (isCancelled) {
            return;
          }
          setRoutes([]);
          setSelectedRouteId(undefined);
          setSwapReceiveAmount('');
          setRouteError(typeof error === 'string' && error
            ? error
            : 'Unable to fetch quotes right now. Please try again.');
        })
        .finally(() => {
          if (!isCancelled) {
            setIsFetchingRoutes(false);
          }
        });
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [fromAccount?.coinCode, fromAccountCode, swapSendAmount, toAccount?.coinCode, toAccountCode]);

  useEffect(() => {
    setSwapReceiveAmount(selectedRoute?.expectedBuyAmount || '');
  }, [selectedRoute]);

  const getFirstReceiveAddress = async (accountCode: AccountCode): Promise<string | undefined> => {
    const response = await getReceiveAddressList(accountCode)();
    if (!response || response.length === 0 || response[0].addresses.length === 0) {
      return;
    }
    return response[0].addresses[0].address;
  };

  const handleSwap = async () => {
    if (!fromAccount || !toAccount || !selectedRoute) {
      alertUser(t('unknownError', {
        errorMessage: routeError || 'No route available for this swap.',
      }));
      return;
    }

    if (fromAccount.coinCode === 'btc') {
      const paymentRequestSupport = await hasPaymentRequest(fromAccount.code);
      if (!paymentRequestSupport.success) {
        if (paymentRequestSupport.errorCode === 'firmwareUpgradeRequired') {
          setFwRequiredDialog(true);
          return;
        }
        alertUser(t('unknownError', { errorMessage: paymentRequestSupport.errorMessage || 'Unsupported firmware' }));
        return;
      }
    }

    setIsSwapping(true);
    try {
      const sourceAddress = await getFirstReceiveAddress(fromAccount.code);
      const destinationAddress = await getFirstReceiveAddress(toAccount.code);
      if (!sourceAddress || !destinationAddress) {
        alertUser(t('unknownError', { errorMessage: 'Missing receive address' }));
        return;
      }

      const executeResponse = await executeSwap({
        accountCode: fromAccount.code,
        routeId: selectedRoute.routeId,
        sourceAddress,
        destinationAddress,
        useHighestFee: true,
        txNote: `Swapkit swap to ${toAccount.coinName}`,
      });
      if (executeResponse.success) {
        alertUser(t('send.success'));
      } else if (executeResponse.aborted) {
        alertUser(t('send.abort'));
      } else if (executeResponse.errorCode) {
        alertUser(t(['send.error', executeResponse.errorCode].join('.')));
      } else {
        alertUser(t('unknownError', { errorMessage: executeResponse.error || 'Swap failed' }));
      }
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <GuideWrapper>
      <GuidedContent>
        <Main>
          <Header
            hideSidebarToggler
            title={
              <SubTitle>
                Swap
              </SubTitle>
            }
          />
          <View
            fullscreen={false}
            width="600px"
          >
            <ViewContent>
              <div className={style.row}>
                <Label
                  className={style.label}
                  htmlFor="swapSendAmount">
                  <span>
                    {t('generic.send')}
                  </span>
                </Label>
                {swapMaxAmount && (
                  <Button
                    transparent
                    className={style.maxButton}
                    onClick={() => setSwapSendAmount(swapMaxAmount.available.amount)}>
                    Max
                    {' '}
                    <AmountWithUnit amount={swapMaxAmount.available} />
                  </Button>
                )}
              </div>
              <InputWithAccountSelector
                accounts={accounts}
                id="swapSendAmount"
                accountCode={fromAccountCode}
                onChangeAccountCode={setFromAccountCode}
                value={swapSendAmount}
                onChangeValue={setSwapSendAmount}
              />
              <div className={style.flipContainer}>
                <Button
                  disabled
                  transparent
                  className={style.flipAcconutsButton}>
                  <ArrowSwap className={style.flipAcconutsIcon} />
                </Button>
              </div>
              <div className={style.row}>
                <Label
                  htmlFor="swapGetAmount">
                  <span>
                    {t('generic.receiveWithoutCoinCode')}
                  </span>
                </Label>
              </div>
              <InputWithAccountSelector
                accounts={accounts}
                id="swapGetAmount"
                accountCode={toAccountCode}
                onChangeAccountCode={setToAccountCode}
                value={swapReceiveAmount}
              />
              <SwapServiceSelector
                buyUnit={toAccount?.coinUnit}
                error={routeError}
                isLoading={isFetchingRoutes}
                onChangeRouteId={setSelectedRouteId}
                routes={routes}
                selectedRouteId={selectedRouteId}
              />
            </ViewContent>
            <ViewButtons>
              <Button primary disabled={isSwapping || !selectedRoute} onClick={handleSwap}>
                {t('generic.swap')}
              </Button>
              <BackButton>
                {t('button.back')}
              </BackButton>
            </ViewButtons>
          </View>
        </Main>
      </GuidedContent>
      <Guide>
        <Entry
          key="guide.settings.servers"
          entry={{
            text: t('guide.settings.servers.text'),
            title: t('guide.settings.servers.title'),
          }}
        />
      </Guide>
      <FirmwareUpgradeRequiredDialog open={fwRequiredDialog} onClose={() => setFwRequiredDialog(false)} />
    </GuideWrapper>
  );
};
