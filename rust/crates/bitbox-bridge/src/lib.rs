use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use bitbox_core::{BackendEvent, EventReceiver, EventStream};
use bitbox_device::{default_registry, DeviceRegistry};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Query {
    pub query_id: i32,
    pub json_query: String,
}

pub trait NativeCommunication {
    fn respond(&self, query_id: i32, response: &str);
    fn push_notify(&self, msg: &str);
}

pub trait BridgeRuntime {
    fn backend_call(&self, query: Query) -> String;
    fn handle_uri(&self, uri: &str);
    fn set_online(&self, is_online: bool);
    fn shutdown(&self);
    fn subscribe_events(&self) -> EventReceiver;
}

pub fn device_layer_source() -> &'static str {
    bitbox_device::device_layer_source()
}

pub fn online_event_payload(is_online: bool) -> String {
    BackendEvent::reload("online", if is_online { "true" } else { "false" }).to_json()
}

pub fn devices_registered_event_payload() -> &'static str {
    "{\"subject\":\"devices/registered\",\"action\":\"reload\",\"object\":null}"
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BridgeRequest {
    method: String,
    endpoint: String,
    query: String,
    body: String,
}

#[derive(Debug, Clone)]
struct BridgeState {
    version: String,
    online: bool,
    cached_devices: BTreeMap<String, String>,
    app_config: String,
}

pub struct RealBridge {
    state: Mutex<BridgeState>,
    device_registry: Box<dyn DeviceRegistry + Send + Sync>,
    events: Arc<EventStream>,
}

impl Default for RealBridge {
    fn default() -> Self {
        // APP_VERSION lives at repository root.
        let version = include_str!("../../../../APP_VERSION").trim().to_owned();
        Self::new(version)
    }
}

impl RealBridge {
    pub fn new(version: String) -> Self {
        Self {
            state: Mutex::new(BridgeState {
                version,
                online: false,
                cached_devices: BTreeMap::new(),
                app_config: default_app_config_json().to_owned(),
            }),
            device_registry: default_registry(),
            events: Arc::new(EventStream::new()),
        }
    }

    #[cfg(test)]
    fn with_registry_for_test(
        version: String,
        device_registry: Box<dyn DeviceRegistry + Send + Sync>,
    ) -> Self {
        Self {
            state: Mutex::new(BridgeState {
                version,
                online: false,
                cached_devices: BTreeMap::new(),
                app_config: default_app_config_json().to_owned(),
            }),
            device_registry,
            events: Arc::new(EventStream::new()),
        }
    }

    fn update_devices_cache(state: &mut BridgeState, devices: BTreeMap<String, String>) -> bool {
        if state.cached_devices != devices {
            state.cached_devices = devices;
            return true;
        }
        false
    }

    pub fn poll_device_registry_changed(&self) -> bool {
        let devices = self.device_registry.registered_devices();
        let mut state = self.state.lock().expect("bridge state lock poisoned");
        let changed = Self::update_devices_cache(&mut state, devices);
        drop(state);
        if changed {
            self.events.publish_reload("devices/registered", "null");
        }
        changed
    }

    fn handle_get(&self, endpoint: &str, _query: &str) -> String {
        let endpoint = normalize_endpoint(endpoint);
        match endpoint {
            "version" => {
                let state = self.state.lock().expect("bridge state lock poisoned");
                json_string(&state.version)
            }
            "devices/registered" => {
                let devices = self.device_registry.registered_devices();
                let mut state = self.state.lock().expect("bridge state lock poisoned");
                let _ = Self::update_devices_cache(&mut state, devices);
                json_string_map(&state.cached_devices)
            }
            "online" => {
                let state = self.state.lock().expect("bridge state lock poisoned");
                if state.online {
                    "true".to_owned()
                } else {
                    "false".to_owned()
                }
            }
            "config" => {
                let state = self.state.lock().expect("bridge state lock poisoned");
                state.app_config.clone()
            }
            "config/default" => default_app_config_json().to_owned(),
            "native-locale" => json_string("en-US"),
            "detect-dark-theme" => "false".to_owned(),
            "supported-coins" => "[]".to_owned(),
            "dev-servers" => "false".to_owned(),
            "testing" => "false".to_owned(),
            _ => json_error(&format!("unsupported GET endpoint: {endpoint}")),
        }
    }

    fn handle_post(&self, endpoint: &str, _query: &str, body: &str) -> String {
        let endpoint = normalize_endpoint(endpoint);
        match endpoint {
            "cancel-connect-keystore"
            | "accounts/reinitialize"
            | "authenticate"
            | "force-auth"
            | "on-auth-setting-changed" => "null".to_owned(),
            "config" => match normalize_app_config_json(body) {
                Ok(config) => {
                    let mut state = self.state.lock().expect("bridge state lock poisoned");
                    state.app_config = config;
                    "null".to_owned()
                }
                Err(err) => json_error(&format!("invalid config payload: {err}")),
            },
            _ => json_error(&format!("unsupported POST endpoint: {endpoint}")),
        }
    }
}

impl BridgeRuntime for RealBridge {
    fn backend_call(&self, query: Query) -> String {
        let parsed = match parse_query_json(&query.json_query) {
            Ok(parsed) => parsed,
            Err(err) => return json_error(&format!("invalid bridge query: {err}")),
        };

        match parsed.method.as_str() {
            "GET" => self.handle_get(&parsed.endpoint, &parsed.query),
            "POST" => self.handle_post(&parsed.endpoint, &parsed.query, &parsed.body),
            _ => json_error(&format!("unsupported method: {}", parsed.method)),
        }
    }

    fn handle_uri(&self, _uri: &str) {}

    fn set_online(&self, is_online: bool) {
        let mut state = self.state.lock().expect("bridge state lock poisoned");
        state.online = is_online;
        drop(state);
        self.events
            .publish_reload("online", if is_online { "true" } else { "false" });
    }

    fn shutdown(&self) {
        let mut state = self.state.lock().expect("bridge state lock poisoned");
        state.online = false;
    }

    fn subscribe_events(&self) -> EventReceiver {
        self.events.subscribe()
    }
}

#[derive(Default)]
pub struct StubBridge {
    events: Arc<EventStream>,
}

impl BridgeRuntime for StubBridge {
    fn backend_call(&self, _query: Query) -> String {
        json_error("rust bridge not implemented yet")
    }

    fn handle_uri(&self, _uri: &str) {}

    fn set_online(&self, _is_online: bool) {}

    fn shutdown(&self) {}

    fn subscribe_events(&self) -> EventReceiver {
        self.events.subscribe()
    }
}

fn parse_query_json(raw: &str) -> Result<BridgeRequest, &'static str> {
    let method = extract_json_string_field(raw, "method").ok_or("missing method")?;
    let endpoint = extract_json_string_field(raw, "endpoint").ok_or("missing endpoint")?;
    let query = extract_json_string_field(raw, "query").unwrap_or_default();
    let body = extract_json_string_field(raw, "body").unwrap_or_default();

    Ok(BridgeRequest {
        method,
        endpoint,
        query,
        body,
    })
}

fn extract_json_string_field(raw: &str, key: &str) -> Option<String> {
    let key_pattern = format!("\"{}\"", key);
    let mut search_start = 0usize;

    while let Some(rel) = raw[search_start..].find(&key_pattern) {
        let key_pos = search_start + rel;
        let mut i = key_pos + key_pattern.len();
        let bytes = raw.as_bytes();

        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b':' {
            search_start = key_pos + 1;
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'"' {
            search_start = key_pos + 1;
            continue;
        }

        i += 1;
        let mut out = String::new();
        while i < bytes.len() {
            match bytes[i] {
                b'"' => return Some(out),
                b'\\' => {
                    i += 1;
                    if i >= bytes.len() {
                        return None;
                    }
                    match bytes[i] {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{0008}'),
                        b'f' => out.push('\u{000C}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        // Minimal bridge parser: keep escaped unicode literal unchanged.
                        b'u' => {
                            out.push_str("\\u");
                        }
                        _ => return None,
                    }
                }
                b => out.push(b as char),
            }
            i += 1;
        }
        return None;
    }

    None
}

fn normalize_endpoint(endpoint: &str) -> &str {
    let endpoint = endpoint.trim().trim_start_matches('/');
    endpoint.strip_prefix("api/").unwrap_or(endpoint)
}

fn normalize_app_config_json(body: &str) -> Result<String, &'static str> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| "invalid json")?;
    if !value.is_object() {
        return Err("expected object");
    }
    Ok(value.to_string())
}

fn default_app_config_json() -> &'static str {
    r#"{"backend":{"proxy":{"useProxy":false,"proxyAddress":""},"bitcoinActive":true,"litecoinActive":true,"ethereumActive":true,"authentication":false,"btc":{"electrumServers":[{"server":"btc1.shiftcrypto.io:443","tls":true,"pemCert":""},{"server":"btc2.shiftcrypto.io:443","tls":true,"pemCert":""}]},"tbtc":{"electrumServers":[{"server":"tbtc1.shiftcrypto.io:443","tls":true,"pemCert":""},{"server":"tbtc2.shiftcrypto.io:443","tls":true,"pemCert":""}]},"rbtc":{"electrumServers":[{"server":"127.0.0.1:52001","tls":false,"pemCert":""},{"server":"127.0.0.1:52002","tls":false,"pemCert":""}]},"ltc":{"electrumServers":[{"server":"ltc1.shiftcrypto.io:443","tls":true,"pemCert":""},{"server":"ltc2.shiftcrypto.io:443","tls":true,"pemCert":""}]},"tltc":{"electrumServers":[{"server":"tltc1.shiftcrypto.io:443","tls":true,"pemCert":""},{"server":"tltc2.shiftcrypto.io:443","tls":true,"pemCert":""}]},"eth":{"activeERC20Tokens":[]},"fiatList":["USD","EUR","CHF"],"mainFiat":"USD","userLanguage":"","btcUnit":"default","startInTestnet":false,"gapLimitReceive":0,"gapLimitChange":0},"frontend":{}}"#
}

fn json_error(msg: &str) -> String {
    format!("{{\"error\":{}}}", json_string(msg))
}

fn json_string(value: &str) -> String {
    format!("\"{}\"", json_escape(value))
}

fn json_string_map(values: &BTreeMap<String, String>) -> String {
    let mut out = String::from("{");
    for (i, (k, v)) in values.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&json_string(k));
        out.push(':');
        out.push_str(&json_string(v));
    }
    out.push('}');
    out
}

fn json_escape(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c < ' ' => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    struct FixedRegistry {
        devices: BTreeMap<String, String>,
    }

    impl DeviceRegistry for FixedRegistry {
        fn registered_devices(&self) -> BTreeMap<String, String> {
            self.devices.clone()
        }
    }

    #[test]
    fn parse_query_decodes_method_and_endpoint() {
        let raw = r#"{"method":"GET","endpoint":"version","query":"foo=bar"}"#;
        let parsed = parse_query_json(raw).expect("query should parse");
        assert_eq!(parsed.method, "GET");
        assert_eq!(parsed.endpoint, "version");
        assert_eq!(parsed.query, "foo=bar");
        assert_eq!(parsed.body, "");
    }

    #[test]
    fn real_bridge_handles_version_devices_and_online() {
        let mut devices = BTreeMap::new();
        devices.insert("abc".to_owned(), "BitBox02".to_owned());
        let bridge = RealBridge::with_registry_for_test(
            "9.99.0".to_owned(),
            Box::new(FixedRegistry { devices }),
        );

        let version = bridge.backend_call(Query {
            query_id: 1,
            json_query: r#"{"method":"GET","endpoint":"version"}"#.to_owned(),
        });
        assert_eq!(version, r#""9.99.0""#);

        let devices = bridge.backend_call(Query {
            query_id: 2,
            json_query: r#"{"method":"GET","endpoint":"devices/registered"}"#.to_owned(),
        });
        assert_eq!(devices, r#"{"abc":"BitBox02"}"#);

        let online_before = bridge.backend_call(Query {
            query_id: 3,
            json_query: r#"{"method":"GET","endpoint":"online"}"#.to_owned(),
        });
        assert_eq!(online_before, "false");

        bridge.set_online(true);

        let online_after = bridge.backend_call(Query {
            query_id: 4,
            json_query: r#"{"method":"GET","endpoint":"online"}"#.to_owned(),
        });
        assert_eq!(online_after, "true");

        let config = bridge.backend_call(Query {
            query_id: 5,
            json_query: r#"{"method":"GET","endpoint":"config"}"#.to_owned(),
        });
        let config_value: serde_json::Value =
            serde_json::from_str(&config).expect("config must be valid json");
        assert_eq!(config_value["backend"]["mainFiat"], "USD");

        let config_default = bridge.backend_call(Query {
            query_id: 6,
            json_query: r#"{"method":"GET","endpoint":"config/default"}"#.to_owned(),
        });
        let config_default_value: serde_json::Value =
            serde_json::from_str(&config_default).expect("default config must be valid json");
        assert_eq!(config_default_value["backend"]["btcUnit"], "default");

        let native_locale = bridge.backend_call(Query {
            query_id: 7,
            json_query: r#"{"method":"GET","endpoint":"native-locale"}"#.to_owned(),
        });
        assert_eq!(native_locale, r#""en-US""#);

        let detect_dark_theme = bridge.backend_call(Query {
            query_id: 8,
            json_query: r#"{"method":"GET","endpoint":"detect-dark-theme"}"#.to_owned(),
        });
        assert_eq!(detect_dark_theme, "false");

        let supported_coins = bridge.backend_call(Query {
            query_id: 9,
            json_query: r#"{"method":"GET","endpoint":"supported-coins"}"#.to_owned(),
        });
        assert_eq!(supported_coins, "[]");
    }

    #[test]
    fn real_bridge_config_roundtrip_via_post_config() {
        let bridge = RealBridge::default();
        let new_config = r#"{"backend":{"mainFiat":"CHF","fiatList":["CHF","USD"]},"frontend":{"expertFee":true}}"#;
        let post_query = format!(
            r#"{{"method":"POST","endpoint":"config","body":"{}"}}"#,
            json_escape(new_config)
        );

        let post_result = bridge.backend_call(Query {
            query_id: 1,
            json_query: post_query,
        });
        assert_eq!(post_result, "null");

        let config = bridge.backend_call(Query {
            query_id: 2,
            json_query: r#"{"method":"GET","endpoint":"config"}"#.to_owned(),
        });
        let config_value: serde_json::Value =
            serde_json::from_str(&config).expect("config must be valid json");
        assert_eq!(config_value["backend"]["mainFiat"], "CHF");
        assert_eq!(config_value["backend"]["fiatList"][0], "CHF");
        assert_eq!(config_value["frontend"]["expertFee"], true);
    }

    #[test]
    fn real_bridge_post_config_rejects_non_object_payload() {
        let bridge = RealBridge::default();
        let post_result = bridge.backend_call(Query {
            query_id: 1,
            json_query: r#"{"method":"POST","endpoint":"config","body":"true"}"#.to_owned(),
        });
        assert!(
            post_result.contains("invalid config payload: expected object"),
            "unexpected error payload: {post_result}"
        );
    }

    #[test]
    fn online_event_payload_matches_transport_shape() {
        assert_eq!(
            online_event_payload(true),
            r#"{"subject":"online","action":"reload","object":true}"#
        );
    }

    #[test]
    fn devices_registered_event_payload_matches_transport_shape() {
        assert_eq!(
            devices_registered_event_payload(),
            r#"{"subject":"devices/registered","action":"reload","object":null}"#
        );
    }

    #[test]
    fn subscribe_events_receives_bridge_emits() {
        let bridge = RealBridge::default();
        let rx = bridge.subscribe_events();
        bridge.set_online(true);
        let payload = rx
            .recv_timeout(Duration::from_millis(100))
            .expect("online event should be emitted");
        assert_eq!(
            payload,
            r#"{"subject":"online","action":"reload","object":true}"#
        );
    }
}
