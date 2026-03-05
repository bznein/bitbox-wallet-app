use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use bitbox_api::ApiServer;
use bitbox_bridge::{device_layer_source, RealBridge};

fn main() {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 8082);
    let api_token = std::env::var("API_TOKEN").unwrap_or_default();
    let server = ApiServer::new(RealBridge::default());
    println!(
        "servewallet-rs listening on http://{} (device layer: {})",
        addr,
        device_layer_source(),
    );
    if let Err(err) = server.serve_blocking(addr, api_token) {
        eprintln!("servewallet-rs failed: {err}");
        std::process::exit(1);
    }
}
