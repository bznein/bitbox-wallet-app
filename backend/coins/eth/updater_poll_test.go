// SPDX-License-Identifier: Apache-2.0

package eth

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/params"
	"github.com/stretchr/testify/require"
)

func testETHAccount(chainConfig *params.ChainConfig) *Account {
	return &Account{
		coin: &Coin{
			net: chainConfig,
		},
	}
}

func TestPollBalancesCoalescesStartupAndManualTriggers(t *testing.T) {
	previousPollInterval := pollInterval
	pollInterval = time.Hour
	defer func() {
		pollInterval = previousPollInterval
	}()

	accountUpdates := make(chan *Account, 1)
	firstGlobalStarted := make(chan struct{})
	releaseFirstGlobal := make(chan struct{})
	pollDone := make(chan struct{})

	var globalCalls int32
	var perChainCalls int32
	updater := NewUpdater(accountUpdates, nil, nil, func() error {
		call := atomic.AddInt32(&globalCalls, 1)
		if call == 1 {
			close(firstGlobalStarted)
			<-releaseFirstGlobal
		}
		return nil
	})
	updater.updateAccountsByChain = func(chainID string, accounts []*Account) {
		atomic.AddInt32(&perChainCalls, 1)
	}

	go func() {
		defer close(pollDone)
		updater.PollBalances()
	}()

	<-firstGlobalStarted

	accountUpdates <- testETHAccount(params.SepoliaChainConfig)
	updater.EnqueueUpdateForAllAccounts()
	updater.EnqueueUpdateForAllAccounts()
	updater.EnqueueUpdateForAllAccounts()
	close(releaseFirstGlobal)

	require.Eventually(t, func() bool {
		return atomic.LoadInt32(&globalCalls) == 2
	}, time.Second, 10*time.Millisecond)
	time.Sleep(30 * time.Millisecond)
	require.Equal(t, int32(2), atomic.LoadInt32(&globalCalls))
	require.Equal(t, int32(0), atomic.LoadInt32(&perChainCalls))

	updater.Close()
	require.Eventually(t, func() bool {
		select {
		case <-pollDone:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
}

func TestPollBalancesDoesNotRunOverlappingGlobalUpdates(t *testing.T) {
	previousPollInterval := pollInterval
	pollInterval = 15 * time.Millisecond
	defer func() {
		pollInterval = previousPollInterval
	}()

	pollDone := make(chan struct{})
	var inflight int32
	var maxInflight int32
	var globalCalls int32

	updater := NewUpdater(nil, nil, nil, func() error {
		currentInflight := atomic.AddInt32(&inflight, 1)
		for {
			max := atomic.LoadInt32(&maxInflight)
			if currentInflight <= max || atomic.CompareAndSwapInt32(&maxInflight, max, currentInflight) {
				break
			}
		}
		atomic.AddInt32(&globalCalls, 1)
		time.Sleep(45 * time.Millisecond)
		atomic.AddInt32(&inflight, -1)
		return nil
	})

	go func() {
		defer close(pollDone)
		updater.PollBalances()
	}()

	require.Eventually(t, func() bool {
		return atomic.LoadInt32(&globalCalls) >= 2
	}, time.Second, 10*time.Millisecond)

	updater.Close()
	require.Eventually(t, func() bool {
		select {
		case <-pollDone:
			return true
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)

	require.Eventually(t, func() bool {
		return atomic.LoadInt32(&inflight) == 0
	}, time.Second, 10*time.Millisecond)
	require.Equal(t, int32(1), atomic.LoadInt32(&maxInflight))
}
