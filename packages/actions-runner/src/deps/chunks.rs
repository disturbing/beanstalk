//! Packages into chunks by a hash of their name (doc 27 §4.1): N buckets, N a power of two from
//! 4 to 64 chosen so a chunk is about 64 MB compressed, kept by the family so a lockfile change
//! re-uploads only the buckets whose packages changed. A bucket too big for one chunk is split
//! by a second hash. The layout is its own chunk.

use sha2::{Digest, Sha256};

use super::tree::Tree;

/// Target compressed size of one chunk.
pub const TARGET_CHUNK_BYTES: u64 = 64 * 1024 * 1024;
/// No chunk may be bigger (Cache API and Workers Cache take at most 512 MB).
pub const MAX_CHUNK_BYTES: u64 = 256 * 1024 * 1024;
pub const MIN_CHUNKS: u32 = 4;
pub const MAX_CHUNKS: u32 = 64;
/// Raw-to-compressed ratio measured on real trees (fastify, a Next.js app, synthetic): 3.7:1.
/// Used only to estimate N and to decide splits before packing.
const RATIO: u64 = 3;
/// A bucket above this many raw bytes is split before packing (about 128 MB compressed).
const SPLIT_RAW_BYTES: u64 = 2 * TARGET_CHUNK_BYTES * RATIO;

/// What one chunk will hold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkPlan {
    pub label: String,
    pub packages: Vec<String>,
    pub entries: Vec<String>,
    pub raw_bytes: u64,
}

/// N for a new family: the smallest power of two keeping the estimated chunk at or under the
/// target, between 4 and 64.
pub fn chunk_count_for(raw_bytes: u64) -> u32 {
    let estimated = raw_bytes / RATIO;
    let mut count = MIN_CHUNKS;
    while count < MAX_CHUNKS && estimated / u64::from(count) > TARGET_CHUNK_BYTES {
        count *= 2;
    }
    count
}

/// The chunks of `tree` with `count` buckets, plus the layout chunk; empty buckets are left out.
pub fn plan(tree: &Tree, count: u32) -> Vec<ChunkPlan> {
    let count = count.clamp(1, MAX_CHUNKS);
    let mut buckets: Vec<Vec<usize>> = vec![Vec::new(); usize::try_from(count).unwrap_or(1)];
    for (index, package) in tree.packages.iter().enumerate() {
        let bucket = hash_index(&package.name, b"bucket", count);
        if let Some(slot) = buckets.get_mut(bucket) {
            slot.push(index);
        }
    }
    let mut plans = Vec::new();
    for (bucket, members) in buckets.iter().enumerate() {
        if members.is_empty() {
            continue;
        }
        let raw: u64 = members.iter().map(|&i| tree.packages[i].bytes).sum();
        let parts = split_count(raw);
        for part in 0..parts {
            let chosen: Vec<usize> = members
                .iter()
                .copied()
                .filter(|&i| {
                    parts == 1
                        || hash_index(&tree.packages[i].name, b"split", parts)
                            == usize::try_from(part).unwrap_or(0)
                })
                .collect();
            if chosen.is_empty() {
                continue;
            }
            let label = if parts == 1 {
                format!("b{bucket:02}")
            } else {
                format!("b{bucket:02}.{part}")
            };
            plans.push(chunk_of(tree, &chosen, label));
        }
    }
    plans.push(ChunkPlan {
        label: "layout".into(),
        packages: Vec::new(),
        entries: tree.layout.clone(),
        raw_bytes: tree.layout_bytes,
    });
    plans
}

fn chunk_of(tree: &Tree, members: &[usize], label: String) -> ChunkPlan {
    let mut entries: Vec<String> = members
        .iter()
        .flat_map(|&i| tree.packages[i].entries.iter().cloned())
        .collect();
    entries.sort();
    ChunkPlan {
        label,
        packages: members
            .iter()
            .map(|&i| tree.packages[i].path.clone())
            .collect(),
        entries,
        raw_bytes: members.iter().map(|&i| tree.packages[i].bytes).sum(),
    }
}

fn split_count(raw: u64) -> u32 {
    let mut parts = 1;
    while parts < 16 && raw / u64::from(parts) > SPLIT_RAW_BYTES {
        parts *= 2;
    }
    parts
}

fn hash_index(name: &str, salt: &[u8], count: u32) -> usize {
    let digest = Sha256::new()
        .chain_update(salt)
        .chain_update(name.as_bytes())
        .finalize();
    let mut first = [0u8; 8];
    first.copy_from_slice(&digest[..8]);
    usize::try_from(u64::from_be_bytes(first) % u64::from(count.max(1))).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    use super::super::tree::Package;
    use super::*;

    fn tree(names: &[&str]) -> Tree {
        Tree {
            packages: names
                .iter()
                .map(|name| Package {
                    path: format!("node_modules/{name}"),
                    name: (*name).to_owned(),
                    entries: vec![format!("node_modules/{name}")],
                    bytes: 1000,
                })
                .collect(),
            layout: vec!["node_modules".into()],
            layout_bytes: 0,
            files: 0,
        }
    }

    #[test]
    fn small_trees_use_four_chunks_and_big_ones_more_up_to_64() {
        assert_eq!(chunk_count_for(146_000_000), 4);
        assert_eq!(chunk_count_for(3_220_000_000), 16);
        assert_eq!(chunk_count_for(u64::MAX / 2), 64);
    }

    #[test]
    fn adding_a_package_changes_only_its_own_bucket() {
        let before = plan(&tree(&["a", "b", "c", "d", "e", "f", "g"]), 4);
        let after = plan(&tree(&["a", "b", "c", "d", "e", "f", "g", "zz"]), 4);
        let changed = before.iter().filter(|chunk| !after.contains(chunk)).count();
        assert!(changed <= 1);
    }

    proptest! {
        #[test]
        fn every_package_lands_in_exactly_one_chunk(names in proptest::collection::btree_set("[a-z]{1,8}", 1..60)) {
            let names: Vec<&str> = names.iter().map(String::as_str).collect();
            let plans = plan(&tree(&names), 8);
            let mut placed: Vec<String> = plans.iter().flat_map(|chunk| chunk.packages.clone()).collect();
            placed.sort();
            let mut expected: Vec<String> = names.iter().map(|name| format!("node_modules/{name}")).collect();
            expected.sort();
            prop_assert_eq!(placed, expected);
        }
    }
}
