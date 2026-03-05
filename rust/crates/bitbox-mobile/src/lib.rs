pub trait MobileEnvironment {
    fn notify_user(&self, msg: &str);
    fn native_locale(&self) -> String;
    fn using_mobile_data(&self) -> bool;
}

pub trait MobileApi {
    fn respond(&self, query_id: i32, response: &str);
    fn push_notify(&self, msg: &str);
}

pub fn serve(
    _data_dir: &str,
    _testnet: bool,
    _environment: &dyn MobileEnvironment,
    _api: &dyn MobileApi,
) {
}

pub fn shutdown() {}
