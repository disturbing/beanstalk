| metric | opus-v2fair-sonnet-12-s7 | e1-self-sonnet-12-s7 | e1-first-sonnet-12-s7 | e1-firstmerged-sonnet-12-s7 |
|---|---|---|---|---|
| tests | given | self | first | first |
| greens | 35 | 39 | 30 | 37 |
| landed | 35 | 39 | 33 | 37 |
| landed beans correct at landing (hidden tests) | 34 | 34 | 30 | 33 |
| green tasks correct on the stalk | 35 | 33 | 28 | 31 |
| stalk correct (every green task) | True | False | False | False |
| green but wrong at landing | t018 | t018, t025, t031, t032, t036 | t031, t037 | t025, t031, t036, t037 |
| green, broken later (by) |  | t005<-t032 |  | t007<-t010, t012<-t039 |
| beans with bean-written test changes | 0 | 38 | 1 | 1 |
| beans without any test change | t001, t002, t004, t005, t006, t008, t009, t010, t011, t012, t014, t015, t016, t017, t018, t019, t020, t021, t022, t023, t024, t025, t026, t027, t028, t029, t030, t031, t033, t034, t035, t037, t038, t039, t040 | t040 | t001, t004, t005, t006, t008, t009, t010, t011, t012, t013, t014, t015, t016, t017, t018, t019, t020, t021, t023, t026, t027, t028, t029, t030, t031, t033, t034, t035, t037, t038, t039, t040 | t001, t003, t004, t005, t006, t007, t008, t009, t010, t011, t012, t013, t014, t015, t016, t017, t018, t019, t020, t021, t022, t023, t025, t026, t027, t028, t029, t030, t031, t033, t034, t036, t037, t038, t039, t040 |
| bean-written test cases | 0 | 77 | 0 | 0 |
| share passing before the change | - | 0.104 | - | - |
| beans whose tests prove nothing (all pass without the change) |  | t029 |  |  |
| changed existing cases that detect the change | 0 | 10 | 3 | 3 |
| beans that added a test file of their own | 0 | 1 | 0 | 0 |
| bean-written cases (green tasks) gone from the stalk | 0 | 0 | 0 | 0 |
| bean-written cases of green tasks | 0 | 77 | 0 | 0 |
| share of beans with tests | - | 0.026 | 0.0 | 0.0 |
| test-author tasks | - | - | 40 | 40 |
| author cases passing on snapshot | - | - | 50 | 44 |
| author cases | - | - | 245 | 244 |
| author tests pass the reference solution (tasks) | - | - | 33 | 32 |
| author tests reject the reference solution | - | - | t010, t022, t024, t025, t029, t038, t039 | t022, t023, t024, t025, t029, t034, t038, t039 |
| author proofs accepted, first session | - | - | 40 | 40 |
| author proofs accepted after one retry | - | - | 0 | 0 |
| tasks dropped without a proof | - | - |  |  |
| author phase median s (start to implementer) | - | - | 43.395 | 41.976 |
| test-author sessions | - | - | 40 | 40 |
| test-author cost $ | - | - | 3.4244 | 3.5538 |
| cost $ | 5.2899 | 5.9156 | 11.5323 | 7.9755 |
| red validations | 1 | 0 | 5 | 0 |
| pre-land checks | 83 | 84 | 102 | 104 |
| pre-land reds | 17 | 1 | 31 | 9 |
| reworks | 37 | 19 | 50 | 24 |
| decision cards | 1 | 0 | 1 | 1 |
| wall min | 11.3 | 15.15 | 19.1 | 21.59 |
| median real suite s (load proxy) | 0.569 | 1.881 | 2.658 | 1.486 |
| arena digest ok | True | True | True | True |

Canonical baseline: {'files': 47, 'files_load_fail_on_base': 8, 'cases_in_loading_files': 106, 'cases_pass_on_base': 17, 'tasks_pass_on_reference': 40, 'tasks': 40}
