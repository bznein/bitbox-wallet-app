// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getBalance, TBalance, type AccountCode, type TAccount } from '@/api/account';
import { getSwapQuote, type TSwapQuoteRoute } from '@/api/swap';
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

const SWAP_ASSET_MAP: Partial<Record<TAccount['coinCode'], string>> = {
  btc: 'BTC.BTC',
  rbtc: 'BTC.BTC',
  tbtc: 'BTC.BTC',
  eth: 'ETH.ETH',
  sepeth: 'ETH.ETH',
};

const getSwapAsset = (account: TAccount | undefined): string | undefined => {
  if (!account) {
    return;
  }
  return SWAP_ASSET_MAP[account.coinCode];
};

export const Swap = ({
  accounts,
  code,
}: Props) => {
  const { t } = useTranslation();

  // Send
  const [sellAccountCode, setSellAccountCode] = useState<AccountCode>(code);
  const [sellAmount, setSellAmount] = useState<string>('');
  const [maxSellAmount, setMaxSellAmount] = useState<TBalance | undefined>();

  // Receive
  const [buyAccountCode, setBuyAccountCode] = useState<AccountCode | undefined>(
    accounts.find(account => account.code !== code)?.code
  );
  const [expectedOutput, setExpectedOutput] = useState<string>('');
  const [routes, setRoutes] = useState<TSwapQuoteRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | undefined>();
  const [isFetchingRoutes, setIsFetchingRoutes] = useState(false);
  const [routeError, setRouteError] = useState<string | undefined>();

  const sellAccount = useMemo(
    () => accounts.find(account => account.code === sellAccountCode),
    [accounts, sellAccountCode]
  );
  const buyAccount = useMemo(
    () => accounts.find(account => account.code === buyAccountCode),
    [accounts, buyAccountCode]
  );
  const selectedRoute = useMemo(
    () => routes.find(route => route.routeId === selectedRouteId),
    [routes, selectedRouteId]
  );

  // update max swappable amount (total coins of the account)
  useEffect(() => {
    if (sellAccountCode) {
      fetchBlance(sellAccountCode).then(setMaxSellAmount);
    }
  }, [sellAccountCode]);

  useEffect(() => {
    let isCancelled = false;
    const sellAsset = getSwapAsset(sellAccount);
    const buyAsset = getSwapAsset(buyAccount);
    const amount = Number(sellAmount);

    if (
      !sellAsset
      || !buyAsset
      || !sellAmount
      || Number.isNaN(amount)
      || amount <= 0
      || sellAccountCode === buyAccountCode
    ) {
      const hasAssetSelection = !!sellAccountCode && !!buyAccountCode;
      setRoutes([]);
      setSelectedRouteId(undefined);
      setExpectedOutput('');
      setRouteError(hasAssetSelection && (!sellAsset || !buyAsset)
        ? 'Selected assets are not supported for quoting yet.'
        : undefined);
      setIsFetchingRoutes(false);
      return;
    }

    setIsFetchingRoutes(true);
    setRouteError(undefined);

    const timeoutId = window.setTimeout(() => {
      console.info('[swap] requesting quote', { buyAsset, sellAmount, sellAsset });
      getSwapQuote({
        buyAsset,
        sellAmount,
        sellAsset,
      })
        .then(response => {
          if (isCancelled) {
            return;
          }
          console.info('[swap] quote response', response);
          console.info('[swap] quote response JSON', JSON.stringify(response));
          console.info('[swap] route fees', (response.quote?.routes || []).map(route => ({
            routeId: route.routeId,
            fees: route.fees,
          })));
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
            setExpectedOutput('');
            setRouteError(response.error);
            return;
          }
          setRoutes([]);
          setSelectedRouteId(undefined);
          setExpectedOutput('');
          setRouteError('No quotes are available for the selected parameters.');
        })
        .catch((error: unknown) => {
          if (isCancelled) {
            return;
          }
          setRoutes([]);
          setSelectedRouteId(undefined);
          setExpectedOutput('');
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
  }, [buyAccount, buyAccountCode, sellAccount, sellAccountCode, sellAmount]);

  useEffect(() => {
    setExpectedOutput(selectedRoute?.expectedBuyAmount || '');
  }, [selectedRoute]);

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
                {maxSellAmount && (
                  <Button transparent className={style.maxButton}>
                    Max
                    {' '}
                    <AmountWithUnit amount={maxSellAmount.available} />
                  </Button>
                )}
              </div>
              <InputWithAccountSelector
                accounts={accounts}
                id="swapSendAmount"
                accountCode={sellAccountCode}
                onChangeAccountCode={setSellAccountCode}
                value={sellAmount}
                onChangeValue={setSellAmount}
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
                accountCode={buyAccountCode}
                onChangeAccountCode={setBuyAccountCode}
                value={expectedOutput}
              />
              <SwapServiceSelector
                buyUnit={buyAccount?.coinUnit}
                error={routeError}
                isLoading={isFetchingRoutes}
                onChangeRouteId={setSelectedRouteId}
                routes={routes}
                selectedRouteId={selectedRouteId}
              />
            </ViewContent>
            <ViewButtons>
              <Button primary>
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
    </GuideWrapper>
  );
};
