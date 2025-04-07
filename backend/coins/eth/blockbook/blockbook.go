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
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/eth/rpcclient"
	ethtypes "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/eth/types"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

type BlockBook struct {
	url        string
	httpClient *http.Client
	//TODO bznein do we need a rate limiter here? What values?
}

func NewBlockBook(url string, httpClient *http.Client) *BlockBook {
	return &BlockBook{
		url:        url,
		httpClient: httpClient,
	}
}

// TransactionReceiptWithBlockNumber implements rpc.Interface.
func (b *BlockBook) TransactionReceiptWithBlockNumber(ctx context.Context, hash common.Hash) (*rpcclient.RPCTransactionReceipt, error) {
	return nil, nil
}

// TransactionByHash implements rpc.Interface.
func (b *BlockBook) TransactionByHash(
	ctx context.Context, hash common.Hash) (*types.Transaction, bool, error) {
	return nil, false, nil
}

// BlockNumber implements rpc.Interface.
func (b *BlockBook) BlockNumber(ctx context.Context) (*big.Int, error) {
	return nil, nil
}

// Balance implements rpc.Interface.
func (b *BlockBook) Balance(ctx context.Context, account common.Address) (*big.Int, error) {
	return nil, nil
}

// ERC20Balance implements rpc.Interface.
func (b *BlockBook) ERC20Balance(account common.Address, erc20Token *erc20.Token) (*big.Int, error) {
	return nil, nil
}

// PendingNonceAt implements rpc.Interface.
func (b *BlockBook) PendingNonceAt(ctx context.Context, account common.Address) (uint64, error) {
	return 0, nil
}

// SendTransaction implements rpc.Interface.
func (b *BlockBook) SendTransaction(ctx context.Context, tx *types.Transaction) error {
	return nil
}

// SuggestGasPrice implements rpc.Interface.
func (b *BlockBook) SuggestGasPrice(ctx context.Context) (*big.Int, error) {
	return nil, nil
}

// SuggestGasTipCap implements rpc.Interface.
func (b *BlockBook) SuggestGasTipCap(ctx context.Context) (*big.Int, error) {
	return nil, errp.New("not implemented")
}

// EstimateGas implements rpc.Interface.
func (b *BlockBook) EstimateGas(ctx context.Context, msg ethereum.CallMsg) (uint64, error) {
	return 0, nil
}

// Transactions queries BlockBook for transactions for the given account, until endBlock.
// Provide erc20Token to filter for those. If nil, standard etheruem transactions will be fetched.
func (b *BlockBook) Transactions(
	blockTipHeight *big.Int,
	address common.Address, endBlock *big.Int, erc20Token *erc20.Token) (
	[]*accounts.TransactionData, error) {
	return nil, nil
}

// FeeTargets returns three priorities with fee targets estimated by Etherscan
// https://docs.etherscan.io/api-endpoints/gas-tracker#get-gas-oracle
// FeeTargets implements rpc.Interface.
// Note: This is not a true RPC but a custom Etherscan API call which implements their own fee estimation.
func (b *BlockBook) FeeTargets(ctx context.Context) ([]*ethtypes.FeeTarget, error) {
	return nil, nil
}

// TODO bznein we need the context only if we use a rate limiter
func (b *BlockBook) call(ctx context.Context, apiPath string, params url.Values, result interface{}) error {

	url := path.Join(b.url, apiPath)

	response, err := b.httpClient.Get(url + "?" + params.Encode())
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
		return errp.Newf("unexpected response from EtherScan: %s", string(body))
	}
	return nil
}
