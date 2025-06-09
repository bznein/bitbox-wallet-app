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

	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/accounts"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/eth/erc20"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/ethereum/go-ethereum/common"
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

func (blockbook *Blockbook) Transactions(
	blockTipHeight *big.Int,
	address common.Address, endBlock *big.Int, erc20Token *erc20.Token) ([]*accounts.TransactionData, error) {
	// TODO erc20token is not handled right now
	params := url.Values{}
	params.Set("to", endBlock.String())

	result := struct {
		Txids []string `json:"txids"`
	}

	if err := blockbook.call(context.Background(),path.Join("address", address.Hex()), params,&result); err != nil {
		return nil, errp.WithStack(err)
	}

	returnedTxs := make([]*accounts.TransactionData, 0, len(result.Txids))
	for _, txid := range result.Txids {
		// TODO(bznein) move this struct definition out of this function.
		result := struct {
			Txid      string `json:"txid"`
			BlockHeight *big.Int `json:"blockHeight"`
			BlockTime   int64  `json:"blockTime"`
			Confirmations int64 `json:"confirmations"`
			Fees 	 string `json:"fees"`
			// Amounrt in wei
			Value     string `json:"value"`
			EthereumSpecific struct {
				Status int64 `json:"status"`
				Nonce  int64 `json:"nonce"`
				GasUsed int64 `json:"gasUsed"`
			} `json:"ethereumSpecific"`
		}
		if err := blockbook.call(context.Background(), path.Join("tx", txid), nil, &result); err != nil {
			return nil, errp.WithStack(err)
		}
		returnedTxs = append(returnedTxs, &accounts.TransactionData{
			Txid:          result.Txid,
			Fee:          result.Fees,
			Timestamp:     time.Unix(result.BlockTime, 0),
			Height:        result.BlockHeight,
			NumConfirmations: result.Confirmations,
			Amount:        coinpkg.NewAmountFromString(result.Value),
			GasUsed:       result.EthereumSpecific.GasUsed,
			Nonce:         result.EthereumSpecific.Nonce,
		})
	}
	return returnedTxs, nil
)
