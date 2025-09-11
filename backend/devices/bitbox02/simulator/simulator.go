package simulator

import (
	"fmt"
	"io"
	"net"
	"time"

	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/devices/bitbox02"
	"github.com/BitBoxSwiss/bitbox02-api-go/api/common"
	bitbox02common "github.com/BitBoxSwiss/bitbox02-api-go/api/common"
	"github.com/BitBoxSwiss/bitbox02-api-go/api/firmware/mocks"
	"github.com/BitBoxSwiss/bitbox02-api-go/communication/u2fhid"
	"github.com/BitBoxSwiss/bitbox02-api-go/util/semver"
)

func New(simulatorPort int, simulatorVersion string) (*bitbox02.Device, error) {

	var err error
	var conn net.Conn
	for range 200 {
		conn, err = net.Dial("tcp", fmt.Sprintf("localhost:%d", simulatorPort))
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		return nil, err
	}
	const bitboxCMD = 0x80 + 0x40 + 0x01

	communication := u2fhid.NewCommunication(conn, bitboxCMD)
	version, err := semver.NewSemVerFromString(simulatorVersion)
	if err != nil {
		return nil, err
	}
	device := bitbox02.NewDevice("ID", version, common.ProductBitBox02Multi,
		&mocks.Config{}, communication,
	)
	return device, nil
}

type DeviceInfo struct {
}

func (d DeviceInfo) IsBluetooth() bool {
	return false
}

func (d DeviceInfo) VendorID() int {
	return 0x03eb
}

func (d DeviceInfo) ProductID() int {
	return 0x2403
}

func (d DeviceInfo) UsagePage() int {
	return 0xfffff
}

func (d DeviceInfo) Interface() int {
	return 0
}

func (d DeviceInfo) Serial() string {
	return "simulator"
}

func (d DeviceInfo) Product() string {
	return bitbox02common.FirmwareDeviceProductStringBitBox02Multi
}

func (d DeviceInfo) Identifier() string {
	return "ID"
}

func (d DeviceInfo) Open() (io.ReadWriteCloser, error) {
	return nil, nil
}

//export systemOpen
