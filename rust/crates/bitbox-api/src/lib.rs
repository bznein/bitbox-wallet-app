use std::collections::VecDeque;
use std::sync::mpsc::{RecvTimeoutError, TryRecvError};
use std::time::Duration;

use bitbox_bridge::{BridgeRuntime, Query};
use bitbox_core::EventReceiver;

pub struct ApiServer<R: BridgeRuntime> {
    runtime: R,
}

impl<R: BridgeRuntime> ApiServer<R> {
    pub fn new(runtime: R) -> Self {
        Self { runtime }
    }

    pub fn handle_bridge_query(&self, query_id: i32, json_query: String) -> String {
        self.runtime.backend_call(Query {
            query_id,
            json_query,
        })
    }

    pub fn subscribe_events(&self) -> EventReceiver {
        self.runtime.subscribe_events()
    }

    pub fn events_session(&self, api_token: impl Into<String>) -> EventsSession {
        EventsSession::new(api_token, self.subscribe_events())
    }
}

#[cfg(feature = "server")]
impl<R> ApiServer<R>
where
    R: BridgeRuntime + Send + Sync + 'static,
{
    pub fn serve_blocking(
        self,
        bind_addr: std::net::SocketAddr,
        api_token: String,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()?;
        runtime.block_on(self.serve(bind_addr, api_token))?;
        Ok(())
    }

    pub async fn serve(
        self,
        bind_addr: std::net::SocketAddr,
        api_token: String,
    ) -> std::io::Result<()> {
        use std::sync::Arc;

        use axum::routing::{any, get};
        use axum::Router;

        let state = HttpState::new(Arc::new(self), api_token);

        let app = Router::new()
            .route("/api/events", get(events_ws_handler::<R>))
            .route("/api/{*endpoint}", any(api_call_handler::<R>))
            .with_state(state);

        let listener = tokio::net::TcpListener::bind(bind_addr).await?;
        axum::serve(listener, app).await
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventsAuthError {
    Unauthorized,
}

pub struct EventsSession {
    expected_auth_line: String,
    event_rx: EventReceiver,
    buffered_events: VecDeque<String>,
    authorized: bool,
}

impl EventsSession {
    pub fn new(api_token: impl Into<String>, event_rx: EventReceiver) -> Self {
        Self {
            expected_auth_line: format!("Authorization: Basic {}", api_token.into()),
            event_rx,
            buffered_events: VecDeque::new(),
            authorized: false,
        }
    }

    pub fn authorized(&self) -> bool {
        self.authorized
    }

    pub fn ingest_client_text(&mut self, msg: &str) -> Result<(), EventsAuthError> {
        if self.authorized {
            return Ok(());
        }
        if msg == self.expected_auth_line {
            self.authorized = true;
            return Ok(());
        }
        Err(EventsAuthError::Unauthorized)
    }

    pub fn next_event(&mut self, timeout: Duration) -> Option<String> {
        self.collect_pending_events();

        if !self.authorized {
            return None;
        }

        if let Some(payload) = self.buffered_events.pop_front() {
            return Some(payload);
        }

        match self.event_rx.recv_timeout(timeout) {
            Ok(payload) => Some(payload),
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => None,
        }
    }

    fn collect_pending_events(&mut self) {
        loop {
            match self.event_rx.try_recv() {
                Ok(payload) => self.buffered_events.push_back(payload),
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => return,
            }
        }
    }
}

#[cfg(feature = "server")]
const WS_EVENT_TICK: Duration = Duration::from_millis(25);

#[cfg(feature = "server")]
struct HttpState<R: BridgeRuntime + Send + Sync + 'static> {
    api: std::sync::Arc<ApiServer<R>>,
    api_token: String,
}

#[cfg(feature = "server")]
impl<R: BridgeRuntime + Send + Sync + 'static> Clone for HttpState<R> {
    fn clone(&self) -> Self {
        Self {
            api: std::sync::Arc::clone(&self.api),
            api_token: self.api_token.clone(),
        }
    }
}

#[cfg(feature = "server")]
impl<R: BridgeRuntime + Send + Sync + 'static> HttpState<R> {
    fn new(api: std::sync::Arc<ApiServer<R>>, api_token: String) -> Self {
        Self { api, api_token }
    }
}

#[cfg(feature = "server")]
async fn api_call_handler<R>(
    axum::extract::State(state): axum::extract::State<HttpState<R>>,
    method: axum::http::Method,
    axum::extract::Path(endpoint): axum::extract::Path<String>,
    uri: axum::http::Uri,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl axum::response::IntoResponse
where
    R: BridgeRuntime + Send + Sync + 'static,
{
    use axum::http::header;
    use axum::http::{HeaderValue, StatusCode};
    use axum::response::Response;
    use serde_json::json;

    let dev_mode = state.api_token.is_empty();
    let allow_origin = if dev_mode {
        resolve_allowed_origin(&headers)
    } else {
        None
    };

    if method == axum::http::Method::OPTIONS {
        let mut response = Response::new(axum::body::Body::empty());
        *response.status_mut() = StatusCode::NO_CONTENT;
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET,POST,OPTIONS"),
        );
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("Content-Type,Authorization"),
        );
        if let Some(origin) = allow_origin {
            if let Ok(origin) = HeaderValue::from_str(&origin) {
                response
                    .headers_mut()
                    .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
            }
        }
        return response;
    }

    if !dev_mode {
        let auth_header = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        let expected_auth_header = format!("Basic {}", state.api_token);

        if auth_header.is_empty() {
            let mut response = Response::new(axum::body::Body::from(format!(
                "missing token /api/{endpoint}"
            )));
            *response.status_mut() = StatusCode::UNAUTHORIZED;
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            );
            return response;
        }

        if auth_header != expected_auth_header {
            let mut response = Response::new(axum::body::Body::from("incorrect token"));
            *response.status_mut() = StatusCode::UNAUTHORIZED;
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            );
            return response;
        }
    }

    let body_text = String::from_utf8_lossy(&body).into_owned();
    let query_json = json!({
        "method": method.as_str(),
        "endpoint": endpoint,
        "query": uri.query().unwrap_or_default(),
        "body": body_text,
    })
    .to_string();

    let payload = state.api.handle_bridge_query(0, query_json);

    let mut response = Response::new(axum::body::Body::from(payload));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );

    if let Some(origin) = allow_origin {
        if let Ok(origin) = HeaderValue::from_str(&origin) {
            response
                .headers_mut()
                .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        }
    }

    response
}

#[cfg(feature = "server")]
async fn events_ws_handler<R>(
    ws: axum::extract::ws::WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<HttpState<R>>,
) -> axum::response::Response
where
    R: BridgeRuntime + Send + Sync + 'static,
{
    ws.on_upgrade(move |socket| events_ws_loop(socket, state))
}

#[cfg(feature = "server")]
async fn events_ws_loop<R>(mut socket: axum::extract::ws::WebSocket, state: HttpState<R>)
where
    R: BridgeRuntime + Send + Sync + 'static,
{
    use axum::extract::ws::{close_code, CloseFrame, Message};
    use futures_util::StreamExt;

    let mut session = state.api.events_session(state.api_token);

    loop {
        tokio::select! {
            maybe_msg = socket.next() => {
                match maybe_msg {
                    Some(Ok(Message::Text(msg))) => {
                        if session.ingest_client_text(&msg).is_err() {
                            let _ = socket.send(Message::Close(Some(CloseFrame {
                                code: close_code::POLICY,
                                reason: "unauthorized".into(),
                            }))).await;
                            return;
                        }
                    }
                    Some(Ok(Message::Ping(msg))) => {
                        if socket.send(Message::Pong(msg)).await.is_err() {
                            return;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Binary(_))) => {
                        if !session.authorized() {
                            let _ = socket.send(Message::Close(Some(CloseFrame {
                                code: close_code::POLICY,
                                reason: "unauthorized".into(),
                            }))).await;
                            return;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => return,
                    Some(Err(_)) => return,
                }
            }
            _ = tokio::time::sleep(WS_EVENT_TICK) => {
                if let Some(payload) = session.next_event(Duration::from_millis(0)) {
                    if socket.send(Message::Text(payload.into())).await.is_err() {
                        return;
                    }
                }
            }
        }
    }
}

#[cfg(feature = "server")]
fn resolve_allowed_origin(headers: &axum::http::HeaderMap) -> Option<String> {
    let origin = headers.get(axum::http::header::ORIGIN)?.to_str().ok()?;
    let vite_port = std::env::var("VITE_PORT").unwrap_or_else(|_| "8080".to_owned());

    let allowed = [
        format!("http://localhost:{vite_port}"),
        format!("http://127.0.0.1:{vite_port}"),
    ];

    if allowed.iter().any(|allowed| allowed == origin) {
        return Some(origin.to_owned());
    }

    None
}

#[cfg(test)]
mod tests {
    #[cfg(feature = "server")]
    use std::sync::Arc;
    use std::time::Duration;

    use super::*;
    use axum::response::IntoResponse;
    use bitbox_bridge::RealBridge;
    #[cfg(feature = "server")]
    use bitbox_bridge::{BridgeRuntime, Query};
    #[cfg(feature = "server")]
    use bitbox_core::{EventReceiver, EventStream};

    #[test]
    fn events_session_buffers_until_authorized() {
        let bridge = RealBridge::default();
        let rx = bridge.subscribe_events();
        let mut session = EventsSession::new("token", rx);

        bridge.set_online(true);
        assert_eq!(session.next_event(Duration::from_millis(10)), None);

        session
            .ingest_client_text("Authorization: Basic token")
            .expect("auth should succeed");

        let payload = session
            .next_event(Duration::from_millis(10))
            .expect("buffered payload expected");

        assert_eq!(
            payload,
            r#"{"subject":"online","action":"reload","object":true}"#
        );
    }

    #[test]
    fn events_session_rejects_wrong_auth_line() {
        let bridge = RealBridge::default();
        let rx = bridge.subscribe_events();
        let mut session = EventsSession::new("token", rx);

        let result = session.ingest_client_text("Authorization: Basic wrong");
        assert_eq!(result, Err(EventsAuthError::Unauthorized));
        assert!(!session.authorized());
    }

    #[test]
    fn events_session_streams_after_authorization() {
        let bridge = RealBridge::default();
        let rx = bridge.subscribe_events();
        let mut session = EventsSession::new("token", rx);

        session
            .ingest_client_text("Authorization: Basic token")
            .expect("auth should succeed");
        bridge.set_online(true);

        let payload = session
            .next_event(Duration::from_millis(100))
            .expect("payload expected");

        assert_eq!(
            payload,
            r#"{"subject":"online","action":"reload","object":true}"#
        );
    }

    #[cfg(feature = "server")]
    struct EchoRuntime {
        events: Arc<EventStream>,
    }

    #[cfg(feature = "server")]
    impl Default for EchoRuntime {
        fn default() -> Self {
            Self {
                events: Arc::new(EventStream::new()),
            }
        }
    }

    #[cfg(feature = "server")]
    impl BridgeRuntime for EchoRuntime {
        fn backend_call(&self, query: Query) -> String {
            query.json_query
        }

        fn handle_uri(&self, _uri: &str) {}

        fn set_online(&self, _is_online: bool) {}

        fn shutdown(&self) {}

        fn subscribe_events(&self) -> EventReceiver {
            self.events.subscribe()
        }
    }

    #[cfg(feature = "server")]
    fn http_state_for_test(version: &str, api_token: &str) -> HttpState<RealBridge> {
        HttpState::new(
            Arc::new(ApiServer::new(RealBridge::new(version.to_owned()))),
            api_token.to_owned(),
        )
    }

    #[cfg(feature = "server")]
    #[tokio::test]
    async fn api_call_rejects_missing_auth_header_when_token_is_set() {
        let state = http_state_for_test("v-test", "secret-token");
        let response = api_call_handler::<RealBridge>(
            axum::extract::State(state),
            axum::http::Method::GET,
            axum::extract::Path("version".to_owned()),
            axum::http::Uri::from_static("/api/version"),
            axum::http::HeaderMap::new(),
            axum::body::Bytes::new(),
        )
        .await
        .into_response();

        assert_eq!(response.status(), axum::http::StatusCode::UNAUTHORIZED);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        assert_eq!(body.as_ref(), b"missing token /api/version");
    }

    #[cfg(feature = "server")]
    #[tokio::test]
    async fn api_call_accepts_valid_auth_header() {
        let state = http_state_for_test("v-test", "secret-token");
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            axum::http::header::AUTHORIZATION,
            axum::http::HeaderValue::from_static("Basic secret-token"),
        );
        let response = api_call_handler::<RealBridge>(
            axum::extract::State(state),
            axum::http::Method::GET,
            axum::extract::Path("version".to_owned()),
            axum::http::Uri::from_static("/api/version"),
            headers,
            axum::body::Bytes::new(),
        )
        .await
        .into_response();

        assert_eq!(response.status(), axum::http::StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        assert_eq!(body.as_ref(), b"\"v-test\"");
    }

    #[cfg(feature = "server")]
    #[tokio::test]
    async fn api_call_sets_cors_header_only_in_dev_mode_and_allowed_origin() {
        let state = http_state_for_test("v-test", "");
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            axum::http::header::ORIGIN,
            axum::http::HeaderValue::from_static("http://localhost:8080"),
        );
        let response = api_call_handler::<RealBridge>(
            axum::extract::State(state),
            axum::http::Method::GET,
            axum::extract::Path("testing".to_owned()),
            axum::http::Uri::from_static("/api/testing"),
            headers,
            axum::body::Bytes::new(),
        )
        .await
        .into_response();

        assert_eq!(
            response
                .headers()
                .get(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|v| v.to_str().ok()),
            Some("http://localhost:8080")
        );

        let state = http_state_for_test("v-test", "secret-token");
        let mut headers = axum::http::HeaderMap::new();
        headers.insert(
            axum::http::header::ORIGIN,
            axum::http::HeaderValue::from_static("http://localhost:8080"),
        );
        headers.insert(
            axum::http::header::AUTHORIZATION,
            axum::http::HeaderValue::from_static("Basic secret-token"),
        );
        let response = api_call_handler::<RealBridge>(
            axum::extract::State(state),
            axum::http::Method::GET,
            axum::extract::Path("testing".to_owned()),
            axum::http::Uri::from_static("/api/testing"),
            headers,
            axum::body::Bytes::new(),
        )
        .await
        .into_response();

        assert!(response
            .headers()
            .get(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    #[cfg(feature = "server")]
    #[tokio::test]
    async fn api_call_forwards_query_string_to_bridge_payload() {
        let state = HttpState::new(
            Arc::new(ApiServer::new(EchoRuntime::default())),
            String::new(),
        );
        let response = api_call_handler::<EchoRuntime>(
            axum::extract::State(state),
            axum::http::Method::GET,
            axum::extract::Path("coins/convert-from-fiat".to_owned()),
            axum::http::Uri::from_static("/api/coins/convert-from-fiat?amount=42&currency=USD"),
            axum::http::HeaderMap::new(),
            axum::body::Bytes::new(),
        )
        .await
        .into_response();

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let parsed: serde_json::Value = serde_json::from_slice(&body).expect("valid json");
        assert_eq!(parsed["method"], "GET");
        assert_eq!(parsed["endpoint"], "coins/convert-from-fiat");
        assert_eq!(parsed["query"], "amount=42&currency=USD");
        assert_eq!(parsed["body"], "");
    }
}
