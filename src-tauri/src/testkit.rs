//! A premium server on loopback, for the tests that talk to one.
//!
//! It answers every request the way a test scripted it and hands each
//! request back: what left the app is checked byte by byte. A vault
//! holds an account only once a device connected with a key, so the
//! tests that need one connect it here, the way the app does.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, Shutdown, TcpListener};
use std::sync::mpsc;

use gerfaut_core::WalletManager;
use gerfaut_core::premium::DevicePlatform;

/// The token the server hands the device the tests connect.
pub(crate) const TOKEN: &str = "gdt1_q83vEjRWeJC6ze8SNFZ4kLrN7xI0VniQus3vEjRWeJA";
/// That device's id.
pub(crate) const DEVICE_ID: &str = "0f3b7c2e-1a2b-4c3d-8e9f-a0b1c2d3e4f5";
/// When it connected.
pub(crate) const CONNECTED_AT: i64 = 1_790_000_000;
/// The key it connected with, as it is typed.
pub(crate) const KEY: &str = "abcd-efgh-ijkm-npqr";

/// One HTTP request, read whole: the head, then as much body as its
/// `Content-Length` announces.
fn read_request(stream: &mut std::net::TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = stream.read(&mut buf).unwrap_or(0);
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        let text = String::from_utf8_lossy(&bytes);
        let Some(end) = text.find("\r\n\r\n") else {
            continue;
        };
        let length = text[..end]
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        if bytes.len() >= end + 4 + length {
            break;
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// A server that answers the requests in turn with `answers`, the last
/// one for every request after it, and hands each request to the test.
pub(crate) fn stub_answers(answers: Vec<(u16, String)>) -> (String, mpsc::Receiver<String>) {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for (index, stream) in listener.incoming().enumerate() {
            let Ok(mut stream) = stream else { break };
            let request = read_request(&mut stream);
            let _ = sender.send(request);
            let (status, body) = &answers[index.min(answers.len() - 1)];
            let response = format!(
                "HTTP/1.1 {status} Stub\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.shutdown(Shutdown::Both);
        }
    });
    (format!("http://{address}"), receiver)
}

/// A server that answers every request with `status` and `body`.
pub(crate) fn stub_server(status: u16, body: &str) -> (String, mpsc::Receiver<String>) {
    stub_answers(vec![(status, body.to_owned())])
}

/// A field of the JSON body a request carried.
pub(crate) fn sent_field(request: &str, field: &str) -> String {
    let body = request.split("\r\n\r\n").nth(1).unwrap_or_default();
    let json: serde_json::Value = serde_json::from_str(body).unwrap();
    json[field].as_str().unwrap_or_default().to_owned()
}

/// The platform this build connects as, the way the server spells it.
pub(crate) fn platform_word() -> String {
    serde_json::to_value(DevicePlatform::current().unwrap())
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}

/// `POST /v1/devices` for the account's first device.
fn connected_body() -> String {
    format!(
        r#"{{"device":{{"id":"{DEVICE_ID}","platform":"{}","connected_at":{CONNECTED_AT},"access":"full","pending_until":null,"approved_at":{CONNECTED_AT},"this_device":true}},"token":"{TOKEN}"}}"#,
        platform_word()
    )
}

/// Connects the vault's device with [`KEY`], as the account's first,
/// and hands back the request the connection went with. The licence
/// that follows cannot be had: the device stays connected all the
/// same, with no certificate.
pub(crate) fn connect(manager: &WalletManager) -> String {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let (base_url, requests) = stub_answers(vec![
        (201, connected_body()),
        (503, r#"{"error":"node unreachable"}"#.to_owned()),
    ]);
    let device = runtime
        .block_on(manager.premium_connect(&base_url, KEY, DevicePlatform::current().unwrap()))
        .unwrap();
    assert_eq!(device.id, DEVICE_ID);
    requests.recv().unwrap()
}
