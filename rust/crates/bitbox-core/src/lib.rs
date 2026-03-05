use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;

use bitbox_contracts::{EventAction, AUTHRES_CANCEL, AUTHRES_ERR, AUTHRES_MISSING, AUTHRES_OK};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendEvent {
    pub subject: String,
    pub action: EventAction,
    pub object_json: String,
}

impl BackendEvent {
    pub fn reload(subject: impl Into<String>, object_json: impl Into<String>) -> Self {
        Self {
            subject: subject.into(),
            action: EventAction::Reload,
            object_json: object_json.into(),
        }
    }

    pub fn replace(subject: impl Into<String>, object_json: impl Into<String>) -> Self {
        Self {
            subject: subject.into(),
            action: EventAction::Replace,
            object_json: object_json.into(),
        }
    }

    pub fn to_json(&self) -> String {
        format!(
            "{{\"subject\":\"{}\",\"action\":\"{}\",\"object\":{}}}",
            json_escape(&self.subject),
            self.action.as_wire(),
            self.object_json,
        )
    }
}

pub type EventReceiver = Receiver<String>;

#[derive(Default)]
pub struct EventStream {
    subscribers: Mutex<Vec<Sender<String>>>,
}

impl EventStream {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self) -> EventReceiver {
        let (sender, receiver) = mpsc::channel();
        let mut subscribers = self.subscribers.lock().expect("event stream lock poisoned");
        subscribers.push(sender);
        receiver
    }

    pub fn publish(&self, event: BackendEvent) {
        let payload = event.to_json();
        let mut subscribers = self.subscribers.lock().expect("event stream lock poisoned");
        subscribers.retain(|subscriber| subscriber.send(payload.clone()).is_ok());
    }

    pub fn publish_reload(&self, subject: impl Into<String>, object_json: impl Into<String>) {
        self.publish(BackendEvent::reload(subject, object_json));
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthResultType {
    Ok,
    Err,
    Cancel,
    Missing,
}

impl AuthResultType {
    pub fn as_wire(self) -> &'static str {
        match self {
            AuthResultType::Ok => AUTHRES_OK,
            AuthResultType::Err => AUTHRES_ERR,
            AuthResultType::Cancel => AUTHRES_CANCEL,
            AuthResultType::Missing => AUTHRES_MISSING,
        }
    }
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
    use super::*;

    #[test]
    fn backend_event_json_shape_matches_frontend_contract() {
        let payload = BackendEvent::reload("online", "true").to_json();
        assert_eq!(
            payload,
            r#"{"subject":"online","action":"reload","object":true}"#
        );
    }

    #[test]
    fn event_stream_publish_delivers_to_subscribers() {
        let stream = EventStream::new();
        let rx = stream.subscribe();
        stream.publish_reload("devices/registered", "null");
        let payload = rx
            .recv_timeout(std::time::Duration::from_millis(50))
            .expect("event should be delivered");
        assert_eq!(
            payload,
            r#"{"subject":"devices/registered","action":"reload","object":null}"#
        );
    }
}
