### Summary

| Language | Test files | Mutations | Breaking | Safety (breaking) | Selected (all) | Selected (breaking) | Actually failing | Wall time: selected vs full suite | Test work saved | Granularity |
|---|---|---|---|---|---|---|---|---|---|---|
| python | 16 | 72 | 59 | **59/59 (100%)** | 45% (median 31%) | 42% | 20% | 37s vs 40s (**7% saved**) | 55% | file (module) |
| ts | 16 | 71 | 59 | **59/59 (100%)** | 34% (median 31%) | 35% | 20% | 26s vs 45s (**43% saved**) | 66% | file (module) |
| java | 16 | 68 | 57 | **57/57 (100%)** | 58% (median 56%) | 59% | 27% | 96s vs 95s (**-1% saved**) | 40% | file (class, compile closure + class loads) |
| go | 18 | 71 | 62 | **62/62 (100%)** | 37% (median 44%) | 38% | 26% | 28s vs 53s (**47% saved**) | 64% | package (compile), file (runtime reads) |
| rust | 16 | 71 | 61 | **61/61 (100%)** | 72% (median 81%) | 74% | 43% | 53s vs 68s (**22% saved**) | 29% | crate (compile), file (runtime reads) |

### Safety by mutation kind (total / breaking / safe)

| Language | code | helper | data | config | test-edit | delete | add | multi |
|---|---|---|---|---|---|---|---|---|
| python | 36/30/30 | 5/4/4 | 8/6/6 | 5/3/3 | 2/0/0 | 2/2/2 | 2/2/2 | 12/12/12 |
| ts | 36/30/30 | 5/5/5 | 8/4/4 | 5/3/3 | 2/2/2 | 2/2/2 | 1/1/1 | 12/12/12 |
| java | 36/30/30 | 5/5/5 | 8/6/6 | 2/1/1 | 2/2/2 | 2/2/2 | 1/1/1 | 12/10/10 |
| go | 36/31/31 | 5/5/5 | 8/5/5 | 5/5/5 | 2/1/1 | 2/2/2 | 1/1/1 | 12/12/12 |
| rust | 36/31/31 | 5/4/4 | 8/6/6 | 5/4/4 | 2/1/1 | 2/2/2 | 1/1/1 | 12/12/12 |

### Misses

| Language | Kind | Mutation | Failing but not selected |
|---|---|---|---|
| - | - | none | - |

### Ablation: map from one phase only (compiled languages)

| Language | Map | Safe (breaking) | Mean selected | Example misses |
|---|---|---|---|---|
| java | run-phase reads only | 47/57 | 34% | src/main/java/shop/catalog/Inventory.java:22 rename rename a; src/main/java/shop/catalog/Catalog.java:34 rename rename fin; src/main/java/shop/core/Limits.java:13 num 3->4 ... |
| java | build-phase reads only | 46/57 | 52% | src/main/resources/data/shipping_zones.properties:3 num 1500; src/main/resources/data/rates.csv:3 num 0.9->0.0; src/main/resources/data/shipping_zones.properties:1 num 500- ... |
| go | run-phase reads only | 12/62 | 7% | internal/invoice/invoice.go:31 str "Total"+x; internal/catalog/products.go:29 rename rename Error; internal/money/money.go:56 num 100->101 ... |
| go | build-phase reads only | 54/62 | 32% | internal/testkit/testdata/orders.json:5 str "SKU-004"+x; data/shipping_zones.json:1 str "domestic"+x; data/rates.csv:3 num 0.9->0.0 ... |
| rust | run-phase reads only | 8/61 | 4% | crates/shop-sales/src/coupons.rs:27 str "OFF"+x; crates/shop-catalog/src/inventory.rs:36 num 0->1; crates/shop-catalog/src/inventory.rs:23 rename rename reserv ... |
| rust | build-phase reads only | 55/61 | 69% | data/catalog.csv:4 num 450->451; data/shipping_zones.txt:2 num 150->151; data/rates.csv:2 num 1.0->1.1 ... |

### Overhead

| Language | Units untraced (sum) | Units traced (sum) | Ratio | Full suite | Full traced | Ratio | Mean repo files read per test file |
|---|---|---|---|---|---|---|---|
| python | 2.0s | 3.8s | **1.92x** | 0.18s | 0.32s | 1.79x | 44 |
| ts | 1.2s | 1.9s | **1.58x** | 0.12s | 0.22s | 1.84x | 25 |
| java | 9.8s | 14.9s | **1.52x** | 0.78s | 1.50s | 1.92x | 53 |
| go | 2.1s | 6.0s | **2.82x** | 0.32s | 0.73s | 2.26x | 26 |
| rust | 0.8s | 2.0s | **2.63x** | 0.22s | 0.84s | 3.74x | 53 |

### Freshness

| Language | New test selected (no map) | Ran traced, mapped | Dep change selects it / it fails | Edited test: new dep in map before -> after | Dep change selects it / it fails |
|---|---|---|---|---|---|
| python | True | True (34 files) | True / True | False -> True | True / True |
| ts | True | True (13 files) | True / True | False -> True | True / True |
| java | True | True (32 files) | True / True | True -> True | True / True |
| go | True | True (13 files) | True / True | False -> True | True / True |
| rust | True | True (59 files) | True / True | True -> True | True / True |
