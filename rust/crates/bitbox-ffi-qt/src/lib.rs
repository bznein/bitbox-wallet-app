use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

use bitbox_bridge::{BridgeRuntime, Query, RealBridge};

type PushNotificationsCallback = Option<extern "C" fn(*const c_char)>;
type ResponseCallback = Option<extern "C" fn(i32, *const c_char)>;
type NotifyUserCallback = Option<extern "C" fn(*const c_char)>;
type GetSaveFilenameCallback = Option<extern "C" fn(*const c_char) -> *mut c_char>;
type CppHeapFree = Option<extern "C" fn(*mut c_void)>;

const DEVICE_POLL_INTERVAL: Duration = Duration::from_millis(750);
const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(200);

struct QtBridgeState {
    started: bool,
    online: bool,
    preferred_locale: String,
    push_notifications_fn: PushNotificationsCallback,
    response_fn: ResponseCallback,
    notify_user_fn: NotifyUserCallback,
    get_save_filename_fn: GetSaveFilenameCallback,
    cpp_heap_free_fn: CppHeapFree,
    bridge: RealBridge,
    poller_stop: Option<Arc<AtomicBool>>,
    poller_thread: Option<JoinHandle<()>>,
    event_forwarder_stop: Option<Arc<AtomicBool>>,
    event_forwarder_thread: Option<JoinHandle<()>>,
}

impl Default for QtBridgeState {
    fn default() -> Self {
        Self {
            started: false,
            online: false,
            preferred_locale: String::new(),
            push_notifications_fn: None,
            response_fn: None,
            notify_user_fn: None,
            get_save_filename_fn: None,
            cpp_heap_free_fn: None,
            bridge: RealBridge::default(),
            poller_stop: None,
            poller_thread: None,
            event_forwarder_stop: None,
            event_forwarder_thread: None,
        }
    }
}

static QT_STATE: OnceLock<Mutex<QtBridgeState>> = OnceLock::new();

fn state() -> &'static Mutex<QtBridgeState> {
    QT_STATE.get_or_init(|| Mutex::new(QtBridgeState::default()))
}

fn c_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: callers are expected to pass a valid, NUL-terminated C string.
    unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() }
}

fn push_notification(push_cb: PushNotificationsCallback, payload: &str) {
    if let Some(cb) = push_cb {
        if let Ok(c_payload) = CString::new(payload) {
            cb(c_payload.as_ptr());
        }
    }
}

fn start_device_poller_if_needed(guard: &mut QtBridgeState) {
    if guard.poller_thread.is_some() {
        return;
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);

    let thread = std::thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Relaxed) {
            let changed = {
                let bridge_guard = state().lock().expect("qt state lock poisoned");
                if !bridge_guard.started {
                    false
                } else {
                    bridge_guard.bridge.poll_device_registry_changed()
                }
            };

            let _ = changed;

            std::thread::sleep(DEVICE_POLL_INTERVAL);
        }
    });

    guard.poller_stop = Some(stop);
    guard.poller_thread = Some(thread);
}

fn start_event_forwarder_if_needed(guard: &mut QtBridgeState) {
    if guard.event_forwarder_thread.is_some() {
        return;
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_for_thread = Arc::clone(&stop);
    let receiver = guard.bridge.subscribe_events();

    let thread = std::thread::spawn(move || {
        while !stop_for_thread.load(Ordering::Relaxed) {
            match receiver.recv_timeout(EVENT_POLL_INTERVAL) {
                Ok(payload) => {
                    let push_cb = {
                        let bridge_guard = state().lock().expect("qt state lock poisoned");
                        if !bridge_guard.started {
                            None
                        } else {
                            bridge_guard.push_notifications_fn
                        }
                    };
                    push_notification(push_cb, &payload);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    guard.event_forwarder_stop = Some(stop);
    guard.event_forwarder_thread = Some(thread);
}

#[allow(non_snake_case)]
#[no_mangle]
pub extern "C" fn backendCall(queryID: i32, s: *const c_char) {
    let query = Query {
        query_id: queryID,
        json_query: c_string(s),
    };

    let guard = state().lock().expect("qt state lock poisoned");
    let response = guard.bridge.backend_call(query);
    if let Some(cb) = guard.response_fn {
        if let Ok(c_response) = CString::new(response) {
            cb(queryID, c_response.as_ptr());
        }
    }
}

#[no_mangle]
pub extern "C" fn setOnline(online: bool) {
    let mut guard = state().lock().expect("qt state lock poisoned");
    guard.online = online;
    guard.bridge.set_online(online);
}

#[no_mangle]
pub extern "C" fn handleURI(uri: *const c_char) {
    let uri = c_string(uri);
    let guard = state().lock().expect("qt state lock poisoned");
    guard.bridge.handle_uri(&uri);
}

#[allow(non_snake_case)]
#[no_mangle]
pub extern "C" fn serve(
    cppHeapFreeFn: CppHeapFree,
    pushNotificationsFn: PushNotificationsCallback,
    responseFn: ResponseCallback,
    notifyUserFn: NotifyUserCallback,
    preferredLocale: *const c_char,
    getSaveFilenameFn: GetSaveFilenameCallback,
) {
    let mut guard = state().lock().expect("qt state lock poisoned");
    guard.started = true;
    guard.cpp_heap_free_fn = cppHeapFreeFn;
    guard.push_notifications_fn = pushNotificationsFn;
    guard.response_fn = responseFn;
    guard.notify_user_fn = notifyUserFn;
    guard.get_save_filename_fn = getSaveFilenameFn;
    guard.preferred_locale = c_string(preferredLocale);
    start_device_poller_if_needed(&mut guard);
    start_event_forwarder_if_needed(&mut guard);
}

#[no_mangle]
pub extern "C" fn systemOpen(_url: *const c_char) {}

#[no_mangle]
pub extern "C" fn goLog(msg: *const c_char) {
    eprintln!("[bitbox-ffi-qt] {}", c_string(msg));
}

#[no_mangle]
pub extern "C" fn backendShutdown() {
    let (poller_stop, poller_thread, event_forwarder_stop, event_forwarder_thread) = {
        let mut guard = state().lock().expect("qt state lock poisoned");
        guard.started = false;
        guard.online = false;
        guard.bridge.shutdown();
        (
            guard.poller_stop.take(),
            guard.poller_thread.take(),
            guard.event_forwarder_stop.take(),
            guard.event_forwarder_thread.take(),
        )
    };

    if let Some(stop) = poller_stop {
        stop.store(true, Ordering::Relaxed);
    }
    if let Some(thread) = poller_thread {
        let _ = thread.join();
    }

    if let Some(stop) = event_forwarder_stop {
        stop.store(true, Ordering::Relaxed);
    }
    if let Some(thread) = event_forwarder_thread {
        let _ = thread.join();
    }
}
