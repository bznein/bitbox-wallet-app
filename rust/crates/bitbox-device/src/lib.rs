use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceProduct {
    Unknown,
    BitBox02Multi,
    BitBox02BtcOnly,
    BitBox02NovaMulti,
    BitBox02NovaBtcOnly,
}

pub trait DeviceApi {
    fn product(&self) -> DeviceProduct;
}

pub trait DeviceRegistry {
    fn registered_devices(&self) -> BTreeMap<String, String>;
}

#[derive(Debug, Default)]
pub struct StubDeviceRegistry;

impl DeviceRegistry for StubDeviceRegistry {
    fn registered_devices(&self) -> BTreeMap<String, String> {
        BTreeMap::new()
    }
}

#[cfg(feature = "with-bitbox-api-rs-usb")]
#[derive(Debug, Default)]
pub struct BitboxApiRsUsbRegistry;

#[cfg(feature = "with-bitbox-api-rs-usb")]
impl DeviceRegistry for BitboxApiRsUsbRegistry {
    fn registered_devices(&self) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        if bitbox_api::usb::get_any_bitbox02().is_ok() {
            out.insert("bitbox02-usb".to_owned(), "BitBox02".to_owned());
        }
        out
    }
}

pub fn default_registry() -> Box<dyn DeviceRegistry + Send + Sync> {
    #[cfg(feature = "with-bitbox-api-rs-usb")]
    {
        Box::<BitboxApiRsUsbRegistry>::default()
    }

    #[cfg(not(feature = "with-bitbox-api-rs-usb"))]
    {
        Box::<StubDeviceRegistry>::default()
    }
}

pub fn device_layer_source() -> &'static str {
    #[cfg(feature = "with-bitbox-api-rs-usb")]
    {
        "bitbox-api-rs-usb"
    }

    #[cfg(all(
        feature = "with-bitbox-api-rs",
        not(feature = "with-bitbox-api-rs-usb")
    ))]
    {
        "bitbox-api-rs"
    }

    #[cfg(not(feature = "with-bitbox-api-rs"))]
    {
        "stub-device-layer"
    }
}

#[cfg(feature = "with-bitbox-api-rs")]
impl From<bitbox_api::Product> for DeviceProduct {
    fn from(product: bitbox_api::Product) -> Self {
        match product {
            bitbox_api::Product::Unknown => DeviceProduct::Unknown,
            bitbox_api::Product::BitBox02Multi => DeviceProduct::BitBox02Multi,
            bitbox_api::Product::BitBox02BtcOnly => DeviceProduct::BitBox02BtcOnly,
            bitbox_api::Product::BitBox02NovaMulti => DeviceProduct::BitBox02NovaMulti,
            bitbox_api::Product::BitBox02NovaBtcOnly => DeviceProduct::BitBox02NovaBtcOnly,
        }
    }
}
