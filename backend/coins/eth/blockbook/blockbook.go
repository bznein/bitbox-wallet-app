// Copyright 2025 Shift Crypto AG
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package blockbook

import (
	"context"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"path"
	"slices"
	"time"

	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/accounts"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/eth/erc20"
	ethtypes "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/eth/types"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"golang.org/x/time/rate"
)

// callsPerSec is thenumber of blockbook requests allowed
// per second.
// TODO bznein determine a better value for this.
var callsPerSec = 3.8

// Blockbook is a rate-limited etherscan api client. See https://etherscan.io/apis.
type Blockbook struct {
	url        string
	httpClient *http.Client
	limiter    *rate.Limiter
}

// NewBlockbook creates a new instance of EtherScan.
func NewBlockbook(chainId string, httpClient *http.Client) *Blockbook {
	return &Blockbook{
		url:        "https://bb1.shiftcrypto.io/api",
		httpClient: httpClient,
		limiter:    rate.NewLimiter(rate.Limit(callsPerSec), 1),
	}
}

// TODO possibly refactor this to take the handler in a nicer way.
func (blockbook *Blockbook) call(ctx context.Context, handler string, params url.Values, result interface{}) error {
	if err := blockbook.limiter.Wait(ctx); err != nil {
		return errp.WithStack(err)
	}
	response, err := blockbook.httpClient.Get(path.Join(blockbook.url, handler) + "?" + params.Encode())
	if err != nil {
		return errp.WithStack(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return errp.Newf("expected 200 OK, got %d", response.StatusCode)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return errp.WithStack(err)
	}
	if err := json.Unmarshal(body, result); err != nil {
		return errp.Newf("unexpected response from blockbook: %s", string(body))
	}
	return nil
}

// TODO: a lot of calls to blockbook rely on callinf "address" first, need to refactor.
func (blockbook *Blockbook) Balance(ctx context.Context, account common.Address) (*big.Int, error) {
	params := url.Values{}
	params.Set("address", account.Hex())

	result := struct {
		Balance string `json:"balance"`
	}{}

	if err := blockbook.call(ctx, path.Join("address", account.Hex()), params, &result); err != nil {
		return nil, errp.WithStack(err)
	}

	balance, ok := new(big.Int).SetString(result.Balance, 10)
	if !ok {
		return nil, errp.Newf("could not parse balance %q", result.Balance)
	}
	return balance, nil
}

func (blockbook *Blockbook) BlockNumber(ctx context.Context) (*big.Int, error) {
	result := struct {
		Backend struct {
			Blocks int64 `json:"blocks"`
		} `json:"backend"`
	}{}

	if err := blockbook.call(ctx, "status", nil, &result); err != nil {
		return nil, errp.WithStack(err)
	}

	blockNumber := new(big.Int).SetInt64(result.Backend.Blocks)
	return blockNumber, nil
}

// PendingNonceAt implements rpc.Interface.
func (blockbook *Blockbook) PendingNonceAt(ctx context.Context, account common.Address) (uint64, error) {
	params := url.Values{}
	params.Set("address", account.Hex())

	result := struct {
		Nonce uint64 `json:"nonce"`
	}{}

	if err := blockbook.call(ctx, path.Join("address", account.Hex()), params, &result); err != nil {
		return 0, errp.WithStack(err)
	}
	return result.Nonce, nil
}

// TODO move and change comments
// // Top-level struct
// type TransactionData struct {
// 	Tx      Tx      `json:"tx"`
// 	Receipt Receipt `json:"receipt"`
// }

// // Transaction details
// type Tx struct {
// 	Nonce                string `json:"nonce"`
// 	GasPrice             string `json:"gasPrice"`
// 	MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
// 	MaxFeePerGas         string `json:"maxFeePerGas"`
// 	BaseFeePerGas        string `json:"baseFeePerGas"`
// 	Gas                  string `json:"gas"`
// 	To                   string `json:"to"`
// 	Value                string `json:"value"`
// 	Input                string `json:"input"`
// 	Hash                 string `json:"hash"`
// 	BlockNumber          string `json:"blockNumber"`
// 	BlockHash            string `json:"blockHash"`
// 	From                 string `json:"from"`
// 	TransactionIndex     string `json:"transactionIndex"`
// }

// // Transaction receipt details
// type Receipt struct {
// 	GasUsed string `json:"gasUsed"`
// 	Status  string `json:"status"`
// }

// // TransactionByHad implements rpc.Interface.
// func (blockbook *Blockbook) TransactionByHash(ctx context.Context, hash common.Hash) (*types.Transaction, bool, error) {
// 	params := url.Values{}
// 	params.Set("txid", hash.Hex())
// 	var result rpcclient.RPCTransaction
// 	var blocbookTx TransactionData
// 	if err := blockbook.call(ctx, path.Join("tx-specific", hash.Hex()), params, &blocbookTx); err != nil {
// 		return nil, false, errp.WithStack(err)
// 	}
// 	// TODO (ask) can this be nil?
// 	result.BlockNumber = &blocbookTx.Tx.BlockNumber

// 	return &result, result.BlockNumber == nil, nil
// }

func (blockbook *Blockbook) Transactions(
	blockTipHeight *big.Int,
	address common.Address, endBlock *big.Int, erc20Token *erc20.Token) ([]*accounts.TransactionData, error) {
	params := url.Values{}
	params.Set("to", endBlock.String())
	if erc20Token != nil {
		params.Set("contract", erc20Token.ContractAddress().Hex())
	}
	result := struct {
		Txids []string `json:"txids"`
	}{}

	if err := blockbook.call(context.Background(), path.Join("address", address.Hex()), params, &result); err != nil {
		return nil, errp.WithStack(err)
	}

	// TODO a lot of stuff here needs to be moved.
	ours := address.Hex()
	type inOut struct {
		// TODO see if we need more
		Addresses []string `json:"addresses"`
	}
	returnedTxs := make([]*accounts.TransactionData, 0, len(result.Txids))
	txIds := result.Txids
	slices.Reverse(txIds) // Reverse the order so that the latest txs are first.
	for _, txid := range txIds {
		// TODO(bznein) move this struct definition out of this function.
		result := struct {
			Txid          string   `json:"txid"`
			Vin           []inOut  `json:"vin"`
			VOut          []inOut  `json:"vout"`
			BlockHeight   *big.Int `json:"blockHeight"`
			BlockTime     int64    `json:"blockTime"`
			Confirmations int64    `json:"confirmations"`
			Fees          string   `json:"fees"`
			// Amounrt in wei
			Value            string `json:"value"`
			EthereumSpecific struct {
				Status  int64 `json:"status"`
				Nonce   int64 `json:"nonce"`
				GasUsed int64 `json:"gasUsed"`
			} `json:"ethereumSpecific"`
		}{}
		if err := blockbook.call(context.Background(), path.Join("tx", txid), nil, &result); err != nil {
			return nil, errp.WithStack(err)
		}
		timestamp := time.Unix(result.BlockTime, 0)
		amount, err := coin.NewAmountFromString(result.Value, big.NewInt(10e8)) //TODO check this
		if err != nil {
			return nil, errp.WithStack(err)
		}
		from := result.Vin[0].Addresses[0]
		to := result.VOut[0].Addresses[0]
		var txType accounts.TxType

		switch {
		case ours == from && ours == to:
			txType = accounts.TxTypeSendSelf
		case ours == from:
			txType = accounts.TxTypeSend
		default:
			txType = accounts.TxTypeReceive
		}

		returnedTxs = append(returnedTxs, &accounts.TransactionData{
			TxID:                     result.Txid,
			InternalID:               result.Txid, // TODO: how do I obtain this?
			Fee:                      result.Fees,
			FeeIsDifferentUnit:       erc20Token != nil,
			Timestamp:                &timestamp,
			Height:                   result.BlockHeight,
			Type:                     txType,
			NumConfirmations:         result.Confirmations,
			Addresses:                result.VOut[0].Addresses[0],
			NumConfirmationsComplete: ethtypes.NumConfirmationsComplete,
			Status:                   accounts.TxStatus(result.EthereumSpecific.Status),
			Amount:                   amount,
			Gas:                      result.EthereumSpecific.GasUsed,
			Nonce:                    result.EthereumSpecific.Nonce,
			IsErc20:                  erc20Token != nil,
		})
	}
	return returnedTxs, nil
}

// SendTransaction implements rpc.Interface.
func (blockbook *Blockbook) SendTransaction(ctx context.Context, tx *types.Transaction) error {
	params := url.Values{}

	result := struct {
		Txid string `json:"txid"`
	}{}

	encodedTx, err := tx.MarshalJSON()
	if err != nil {
		return errp.WithStack(err)
	}
	if err := blockbook.call(ctx, path.Join("sendtx", hexutil.Encode(encodedTx)), params, &result); err != nil {
		return errp.WithStack(err)
	}
	if result.Txid == "" {
		return errp.New("empty txid in response")
	}
	return nil
}

// ERC20Balance implements rpc.Interface.
func (blockbook *Blockbook) ERC20Balance(account common.Address, erc20Token *erc20.Token) (*big.Int, error) {
	params := url.Values{}

	result := struct {
		Tokens []struct {
			Balance  string `json:"balance"`
			Contract string `json:"contract"`
		} `json:"tokens"`
	}{}

	if err := blockbook.call(context.Background(), path.Join("address", account.Hex()), params, &result); err != nil {
		return nil, errp.WithStack(err)
	}

	for _, token := range result.Tokens {
		if token.Contract == erc20Token.ContractAddress().Hex() {
			balance, ok := new(big.Int).SetString(token.Balance, 10)
			if !ok {
				return nil, errp.Newf("could not parse balance %q", token.Balance)
			}
			return balance, nil
		}
	}
	return nil, errp.Newf("no balance found for token %s", erc20Token.ContractAddress().Hex())
}
