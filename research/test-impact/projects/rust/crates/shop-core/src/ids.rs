//! Identifiers: stable short hashes (SHA-1, hand-rolled) and zero-padded sequences.

use std::fmt::Display;

pub fn short_id(prefix: &str, parts: &[&dyn Display]) -> String {
    let joined = parts.iter().map(|p| p.to_string()).collect::<Vec<_>>().join("|");
    let digest = sha1_hex(joined.as_bytes());
    format!("{prefix}-{}", &digest[..8])
}

pub struct Sequence {
    pub prefix: String,
    pub next: u64,
}

impl Sequence {
    pub fn new(prefix: &str) -> Sequence {
        Sequence::starting_at(prefix, 1)
    }

    pub fn starting_at(prefix: &str, start: u64) -> Sequence {
        Sequence { prefix: prefix.to_string(), next: start }
    }

    pub fn take(&mut self) -> String {
        let value = format!("{}{:05}", self.prefix, self.next);
        self.next += 1;
        value
    }
}

pub fn sha1_hex(data: &[u8]) -> String {
    let mut h: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        for (slot, v) in h.iter_mut().zip([a, b, c, d, e]) {
            *slot = slot.wrapping_add(v);
        }
    }
    h.iter().map(|v| format!("{v:08x}")).collect()
}
