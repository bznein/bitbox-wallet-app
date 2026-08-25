// SPDX-License-Identifier: Apache-2.0

package lightning

import (
	"fmt"
	"io"
	"log"
	"sync"

	"github.com/BitBoxSwiss/bitbox-wallet-app/util/logging"
	"github.com/breez/breez-sdk-spark-go/breez_sdk_spark"
)

type sdkLogger struct {
	log    *log.Logger
	writer io.Closer
}

func (logger *sdkLogger) Log(l breez_sdk_spark.LogEntry) {
	logger.log.Printf("[%s] %s", l.Level, l.Line)
}

func (logger *sdkLogger) close() error {
	return logger.writer.Close()
}

func newSDKLogger(logFilePath string) (*sdkLogger, error) {
	writer, err := logging.NewRotatingFileWriter(logFilePath)
	if err != nil {
		return nil, fmt.Errorf("open Breez SDK log: %w", err)
	}
	return &sdkLogger{
		log:    log.New(writer, "", log.LstdFlags|log.Lmicroseconds),
		writer: writer,
	}, nil
}

var (
	logListener    *sdkLogger
	loggingInitErr error
	loggingOnce    sync.Once
)

// initializeLogging sends Breez SDK logs to their own private rotating file.
func initializeLogging(logFilePath string) error {
	loggingOnce.Do(func() {
		logListener, loggingInitErr = newSDKLogger(logFilePath)
		if loggingInitErr != nil {
			return
		}

		var loggerImpl breez_sdk_spark.Logger = logListener
		if err := breez_sdk_spark.InitLogging(nil, &loggerImpl, nil); err != nil {
			loggingInitErr = fmt.Errorf("initialize Breez SDK logging: %w", err)
		}
	})
	return loggingInitErr
}
