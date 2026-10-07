//! git's pkt-line framing: a four-digit hex length (counting itself) and the payload, or one of
//! the special packets `0000` (flush), `0001` (delim) and `0002` (response end).

use bytes::{BufMut, Bytes, BytesMut};
use tokio::io::{AsyncRead, AsyncReadExt};

use crate::error::Error;

/// The longest pkt-line git writes or accepts: 65516 bytes of payload plus the header.
pub const MAX_PKT_LEN: usize = 65_520;
const HEADER_LEN: usize = 4;

/// One pkt-line, with the exact bytes it was read from (so it can be forwarded unchanged).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pkt {
    kind: PktKind,
    raw: Bytes,
}

/// What a pkt-line is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PktKind {
    Flush,
    Delim,
    ResponseEnd,
    Data,
}

impl Pkt {
    pub fn kind(&self) -> PktKind {
        self.kind
    }

    /// The bytes on the wire, header included.
    pub fn raw(&self) -> &Bytes {
        &self.raw
    }

    /// The payload of a data packet (empty for the special packets).
    pub fn payload(&self) -> &[u8] {
        match self.kind {
            PktKind::Data => self.raw.get(HEADER_LEN..).unwrap_or_default(),
            PktKind::Flush | PktKind::Delim | PktKind::ResponseEnd => &[],
        }
    }

    pub fn is_flush(&self) -> bool {
        self.kind == PktKind::Flush
    }
}

/// Reads one pkt-line, or `None` at a clean end of input (no byte of a new packet read).
///
/// # Errors
///
/// [`Error::Protocol`] for a malformed header or a truncated packet; [`Error::Io`] when reading
/// fails.
pub async fn read_pkt<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Option<Pkt>, Error> {
    let mut header = [0_u8; HEADER_LEN];
    let first = reader.read(&mut header).await?;
    if first == 0 {
        return Ok(None);
    }
    if first < HEADER_LEN {
        reader
            .read_exact(header.get_mut(first..).unwrap_or_default())
            .await
            .map_err(|_| Error::Protocol("truncated pkt-line header".into()))?;
    }
    let length = parse_length(&header)?;
    let kind = match length {
        0 => PktKind::Flush,
        1 => PktKind::Delim,
        2 => PktKind::ResponseEnd,
        _ => PktKind::Data,
    };
    let mut raw = BytesMut::with_capacity(length.max(HEADER_LEN));
    raw.put_slice(&header);
    if kind == PktKind::Data {
        raw.resize(length, 0);
        reader
            .read_exact(raw.get_mut(HEADER_LEN..).unwrap_or_default())
            .await
            .map_err(|_| Error::Protocol("truncated pkt-line".into()))?;
    }
    Ok(Some(Pkt {
        kind,
        raw: raw.freeze(),
    }))
}

/// The length a pkt-line header announces.
///
/// # Errors
///
/// [`Error::Protocol`] when the header is not four hex digits, is `0003`, or is too long.
pub fn parse_length(header: &[u8; HEADER_LEN]) -> Result<usize, Error> {
    let text = std::str::from_utf8(header)
        .map_err(|_| Error::Protocol("pkt-line header is not ASCII".into()))?;
    let length = usize::from_str_radix(text, 16)
        .map_err(|_| Error::Protocol(format!("bad pkt-line header {text:?}")))?;
    if length == 3 || length > MAX_PKT_LEN {
        return Err(Error::Protocol(format!("bad pkt-line length {length}")));
    }
    Ok(length)
}

/// Encodes `payload` as one data pkt-line.
///
/// # Errors
///
/// [`Error::Protocol`] when the payload does not fit in one packet.
pub fn encode(payload: &[u8]) -> Result<Bytes, Error> {
    let length = payload.len() + HEADER_LEN;
    if length > MAX_PKT_LEN {
        return Err(Error::Protocol("pkt-line payload too long".into()));
    }
    let mut out = BytesMut::with_capacity(length);
    out.put_slice(format!("{length:04x}").as_bytes());
    out.put_slice(payload);
    Ok(out.freeze())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    async fn read_all(bytes: &[u8]) -> Result<Vec<Pkt>, Error> {
        let mut reader = bytes;
        let mut packets = Vec::new();
        while let Some(pkt) = read_pkt(&mut reader).await? {
            packets.push(pkt);
        }
        Ok(packets)
    }

    #[tokio::test]
    async fn reads_data_and_special_packets() -> Result<(), Error> {
        let packets = read_all(b"0009hello00000001000200").await;
        assert!(packets.is_err(), "a trailing partial header is truncated");
        let packets = read_all(b"0009hello000000010002").await?;
        let kinds: Vec<PktKind> = packets.iter().map(Pkt::kind).collect();
        assert_eq!(
            kinds,
            [
                PktKind::Data,
                PktKind::Flush,
                PktKind::Delim,
                PktKind::ResponseEnd
            ]
        );
        assert_eq!(packets.first().map(Pkt::payload), Some(&b"hello"[..]));
        Ok(())
    }

    #[tokio::test]
    async fn rejects_bad_headers() {
        assert!(read_all(b"zzzz").await.is_err());
        assert!(read_all(b"0003").await.is_err());
        assert!(read_all(b"fff1").await.is_err());
        assert!(read_all(b"0010short").await.is_err());
    }

    #[tokio::test]
    async fn empty_input_is_a_clean_end() -> Result<(), Error> {
        assert!(read_all(b"").await?.is_empty());
        Ok(())
    }

    proptest! {
        #[test]
        fn encoded_payloads_read_back(payloads in proptest::collection::vec(proptest::collection::vec(any::<u8>(), 0..300), 0..8)) {
            let mut wire = Vec::new();
            for payload in &payloads {
                wire.extend_from_slice(&encode(payload).map_err(|e| TestCaseError::fail(e.to_string()))?);
            }
            let runtime = tokio::runtime::Builder::new_current_thread().build().map_err(|e| TestCaseError::fail(e.to_string()))?;
            let packets = runtime.block_on(read_all(&wire)).map_err(|e| TestCaseError::fail(e.to_string()))?;
            let read: Vec<Vec<u8>> = packets.iter().map(|p| p.payload().to_vec()).collect();
            prop_assert_eq!(read, payloads);
            let raw: Vec<u8> = packets.iter().flat_map(|p| p.raw().to_vec()).collect();
            prop_assert_eq!(raw, wire);
        }

        #[test]
        fn never_panics_on_arbitrary_input(bytes in proptest::collection::vec(any::<u8>(), 0..64)) {
            let runtime = tokio::runtime::Builder::new_current_thread().build().map_err(|e| TestCaseError::fail(e.to_string()))?;
            let _ = runtime.block_on(read_all(&bytes));
        }
    }
}
