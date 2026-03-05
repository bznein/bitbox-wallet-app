pub const QT_EXPORTS: &[&str] = &[
    "backendCall",
    "setOnline",
    "handleURI",
    "serve",
    "systemOpen",
    "goLog",
    "backendShutdown",
];

pub const AUTHRES_OK: &str = "authres-ok";
pub const AUTHRES_ERR: &str = "authres-err";
pub const AUTHRES_CANCEL: &str = "authres-cancel";
pub const AUTHRES_MISSING: &str = "authres-missing";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventAction {
    Replace,
    Reload,
}

impl EventAction {
    pub fn as_wire(self) -> &'static str {
        match self {
            EventAction::Replace => "replace",
            EventAction::Reload => "reload",
        }
    }
}
