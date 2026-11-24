use rustls::client::Resumption;
use rustls::pki_types::{CertificateDer, ServerName};
use rustls::{ClientConfig, ClientConnection, RootCertStore};
use std::fmt::Display;
use std::io::{Cursor, Read, Write};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

const BUFFER_LIMIT: usize = 64 * 1024;

fn tls_error(error: impl Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen]
pub struct VaultTrust {
    config: Arc<ClientConfig>,
    name: ServerName<'static>,
}

#[wasm_bindgen]
impl VaultTrust {
    #[wasm_bindgen(constructor)]
    pub fn new(anchor: Vec<u8>, name: String) -> Result<VaultTrust, JsValue> {
        let mut roots = RootCertStore::empty();
        roots.add(CertificateDer::from(anchor)).map_err(tls_error)?;
        let mut config =
            ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_protocol_versions(&[&rustls::version::TLS13])
                .map_err(tls_error)?
                .with_root_certificates(roots)
                .with_no_client_auth();
        config.resumption = Resumption::disabled();
        Ok(Self {
            config: Arc::new(config),
            name: ServerName::try_from(name).map_err(tls_error)?,
        })
    }

    pub fn connect(&self) -> Result<Channel, JsValue> {
        let mut tls =
            ClientConnection::new(self.config.clone(), self.name.clone()).map_err(tls_error)?;
        tls.set_buffer_limit(Some(BUFFER_LIMIT));
        Ok(Channel(tls))
    }
}

#[wasm_bindgen]
pub struct Channel(ClientConnection);

#[wasm_bindgen]
impl Channel {
    pub fn drain(&mut self) -> Result<Vec<u8>, JsValue> {
        let mut bytes = Vec::new();
        while self.0.wants_write() {
            self.0.write_tls(&mut bytes).map_err(tls_error)?;
        }
        Ok(bytes)
    }

    pub fn receive(&mut self, records: &[u8]) -> Result<Vec<u8>, JsValue> {
        let mut input = Cursor::new(records);
        let mut plaintext = Vec::new();
        while input.position() < records.len() as u64 {
            if self.0.read_tls(&mut input).map_err(tls_error)? == 0 {
                return Err(tls_error("Unexpected TLS EOF"));
            }
            let state = self.0.process_new_packets().map_err(tls_error)?;
            let start = plaintext.len();
            let end = start + state.plaintext_bytes_to_read();
            if end > BUFFER_LIMIT {
                return Err(tls_error("TLS plaintext limit exceeded"));
            }
            plaintext.resize(end, 0);
            self.0
                .reader()
                .read_exact(&mut plaintext[start..])
                .map_err(tls_error)?;
        }
        Ok(plaintext)
    }

    pub fn ready(&self) -> bool {
        !self.0.is_handshaking()
    }

    pub fn send(&mut self, plaintext: &[u8]) -> Result<(), JsValue> {
        if !self.ready() {
            return Err(tls_error("TLS peer is not authenticated"));
        }
        self.0.writer().write_all(plaintext).map_err(tls_error)
    }
}
