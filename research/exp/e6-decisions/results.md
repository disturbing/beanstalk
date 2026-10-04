### Headline

| run | variant | greens | dropped | drops | wall min | cost $ | cards | red validations | correct (effective) | correct (canonical) | load avg start → end |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus-v2fair-sonnet-12-s7 | v2 | 35 | 5 | declined by decision D001 1; unresolved conflict 4 | 11.3 | 5.29 | 1 | 1 | True | True | - |
| e6-keep-sonnet-12-s7 | e6 | 40 | 0 | - | 17.8 | 5.07 | 8 | 0 | True | False | 34.51 → 6.23 |
| e6-contract-sonnet-12-s7 | e6 | 40 | 0 | - | 21.0 | 4.86 | 7 | 0 | True | False | 21.17 → 21.46 |
| e6-contract-sonnet-12-s7-r2 | e6 | 40 | 0 | - | 17.6 | 5.14 | 6 | 0 | True | False | 40.37 → 17.59 |

### Minutes / $ to the k-th green

First-green clock (`kth_green.py`), then the final-green clock (a task's last promotion, only tasks green at the end) for the tail.

| run | 20th | 30th | 35th | 38th | 40th | 35th (final clock) | 38th (final clock) | 40th (final clock) |
|---|---|---|---|---|---|---|---|---|
| opus-v2fair-sonnet-12-s7 | 7.3 / 4.79 | 9.7 / 5.21 | 11.3 / 5.29 | not reached | not reached | 11.3 / 5.29 | not reached | not reached |
| e6-keep-sonnet-12-s7 | 7.4 / 3.35 | 9.8 / 4.31 | 10.9 / 4.31 | 12.4 / 4.62 | 17.8 / 5.07 | 10.9 / 4.31 | 12.4 / 4.62 | 17.8 / 5.07 |
| e6-contract-sonnet-12-s7 | 6.8 / 2.77 | 10.2 / 4.10 | 11.3 / 4.42 | 13.5 / 4.53 | 21.0 / 4.86 | 11.3 / 4.42 | 13.5 / 4.53 | 21.0 / 4.86 |
| e6-contract-sonnet-12-s7-r2 | 7.4 / 3.30 | 9.1 / 4.15 | 11.2 / 4.76 | 13.4 / 5.02 | 17.6 / 5.14 | 11.2 / 4.76 | 13.4 / 5.02 | 17.6 / 5.14 |

### Invocations / cost by kind

| run | initial | rework | reexec | rescue | author | fixer | total $ |
|---|---|---|---|---|---|---|---|
| opus-v2fair-sonnet-12-s7 | 40 / 2.54 | 37 / 2.75 | 0 / 0.00 | 0 / 0.00 | 0 / 0.00 | 0 / 0.00 | 5.29 |
| e6-keep-sonnet-12-s7 | 40 / 2.17 | 16 / 1.85 | 5 / 0.66 | 0 / 0.00 | 8 / 0.39 | 0 / 0.00 | 5.07 |
| e6-contract-sonnet-12-s7 | 40 / 2.13 | 17 / 1.95 | 2 / 0.14 | 2 / 0.29 | 7 / 0.35 | 0 / 0.00 | 4.86 |
| e6-contract-sonnet-12-s7-r2 | 40 / 2.27 | 21 / 2.24 | 2 / 0.11 | 2 / 0.21 | 6 / 0.31 | 0 / 0.00 | 5.14 |

### Decisions in opus-v2fair-sonnet-12-s7

| card | min | pair | trigger | mode | winner | outcome | loser's tests | re-executions | final status arriving / landed |
|---|---|---|---|---|---|---|---|---|---|
| D001 | 9.9 | t032 meets t005 | preland | oracle | t005 | declined | - | 0 | dropped / green |

### Decisions in e6-keep-sonnet-12-s7

| card | min | pair | trigger | mode | winner | outcome | loser's tests | re-executions | final status arriving / landed |
|---|---|---|---|---|---|---|---|---|---|
| D001 | 2.7 | t022 meets t002 | start | oracle | t002 | keep-landed | none needed | 0 | green / green |
| D002 | 4.2 | t011 meets t018 | preland | oracle | t018 | keep-landed | none needed | 1 | green / green |
| D003 | 5.4 | t031 meets t005 | start | oracle | t005 | keep-landed | amended | 0 | green / green |
| D004 | 7.0 | t036 meets t023 | start | oracle | t023 | keep-landed | amended | 0 | green / green |
| D005 | 7.2 | t011 meets t007 | preland | oracle | t007 | keep-landed | amended | 1 | green / green |
| D006 | 7.2 | t032 meets t028 | preland | oracle | t028 | keep-landed | none needed | 1 | green / green |
| D007 | 10.1 | t032 meets t005 | preland | oracle | t005 | keep-landed | amended | 1 | green / green |
| D008 | 13.7 | t032 meets t033 | preland | oracle | t033 | keep-landed | amended | 1 | green / green |

### Decisions in e6-contract-sonnet-12-s7

| card | min | pair | trigger | mode | winner | outcome | loser's tests | re-executions | final status arriving / landed |
|---|---|---|---|---|---|---|---|---|---|
| D001 | 2.8 | t022 meets t002 | start | oracle | t002 | keep-landed | none needed | 0 | green / green |
| D002 | 4.0 | t018 meets t011 | preland | oracle | t011 | keep-landed | none needed | 1 | green / green |
| D003 | 4.9 | t031 meets t005 | start | oracle | t005 | keep-landed | amended | 0 | green / green |
| D004 | 6.3 | t036 meets t023 | start | oracle | t023 | keep-landed | amended | 0 | green / green |
| D005 | 7.9 | t032 meets t028 | preland | oracle | t032 | adopt-arriving | amended | 0 | green / green |
| D006 | 11.4 | t032 meets t005 | preland | oracle | t032 | adopt-arriving | amended | 0 | green / green |
| D007 | 16.5 | t032 meets t033 | preland | oracle | t033 | keep-landed | amended | 1 | green / green |

### Decisions in e6-contract-sonnet-12-s7-r2

| card | min | pair | trigger | mode | winner | outcome | loser's tests | re-executions | final status arriving / landed |
|---|---|---|---|---|---|---|---|---|---|
| D001 | 2.5 | t022 meets t002 | start | oracle | t002 | keep-landed | none needed | 0 | green / green |
| D002 | 3.8 | t018 meets t011 | preland | oracle | t011 | keep-landed | none needed | 1 | green / green |
| D003 | 5.5 | t031 meets t005 | start | oracle | t005 | keep-landed | amended | 0 | green / green |
| D004 | 6.7 | t036 meets t023 | start | oracle | t023 | keep-landed | amended | 0 | green / green |
| D005 | 9.0 | t032 meets t005 | preland | oracle | t032 | adopt-arriving | amended | 0 | green / green |
| D006 | 13.3 | t032 meets t033 | preland | oracle | t033 | keep-landed | amended | 1 | green / green |

### Couplings in opus-v2fair-sonnet-12-s7: 0 of 5 designed detected

| pair | kind | card | informed reworks naming the partner | final status |
|---|---|---|---|---|
| t002/t022 | designed | no card | 0 | green / green |
| t005/t031 | designed | no card | 0 | green / green |
| t011/t018 | designed | no card | 0 | green / green |
| t023/t036 | designed | no card | 0 | green / dropped |
| t028/t032 | designed | no card | 0 | green / dropped |
| t005/t032 | natural | D001 (preland, declined) | 2 | green / dropped |
| t032/t033 | natural | no card | 0 | dropped / green |
| t003/t023 | natural | no card | 0 | dropped / green |

### Couplings in e6-keep-sonnet-12-s7: 5 of 5 designed detected

| pair | kind | card | informed reworks naming the partner | final status |
|---|---|---|---|---|
| t002/t022 | designed | D001 (start, keep-landed) | 0 | green / green |
| t005/t031 | designed | D003 (start, keep-landed) | 0 | green / green |
| t011/t018 | designed | D002 (preland, keep-landed) | 0 | green / green |
| t023/t036 | designed | D004 (start, keep-landed) | 0 | green / green |
| t028/t032 | designed | D006 (preland, keep-landed) | 0 | green / green |
| t005/t032 | natural | D007 (preland, keep-landed) | 0 | green / green |
| t032/t033 | natural | D008 (preland, keep-landed) | 0 | green / green |
| t003/t023 | natural | no card | 0 | green / green |
| t007/t011 | other | D005 (preland, keep-landed) | - | green / green |

### Couplings in e6-contract-sonnet-12-s7: 5 of 5 designed detected

| pair | kind | card | informed reworks naming the partner | final status |
|---|---|---|---|---|
| t002/t022 | designed | D001 (start, keep-landed) | 0 | green / green |
| t005/t031 | designed | D003 (start, keep-landed) | 0 | green / green |
| t011/t018 | designed | D002 (preland, keep-landed) | 0 | green / green |
| t023/t036 | designed | D004 (start, keep-landed) | 0 | green / green |
| t028/t032 | designed | D005 (preland, adopt-arriving) | 0 | green / green |
| t005/t032 | natural | D006 (preland, adopt-arriving) | 0 | green / green |
| t032/t033 | natural | D007 (preland, keep-landed) | 0 | green / green |
| t003/t023 | natural | no card | 0 | green / green |

### Couplings in e6-contract-sonnet-12-s7-r2: 4 of 5 designed detected

| pair | kind | card | informed reworks naming the partner | final status |
|---|---|---|---|---|
| t002/t022 | designed | D001 (start, keep-landed) | 0 | green / green |
| t005/t031 | designed | D003 (start, keep-landed) | 0 | green / green |
| t011/t018 | designed | D002 (preland, keep-landed) | 0 | green / green |
| t023/t036 | designed | D004 (start, keep-landed) | 0 | green / green |
| t028/t032 | designed | no card | 0 | green / green |
| t005/t032 | natural | D005 (preland, adopt-arriving) | 1 | green / green |
| t032/t033 | natural | D006 (preland, keep-landed) | 0 | green / green |
| t003/t023 | natural | no card | 0 | green / green |

### Final correctness

| run | suite green | green tasks passing effective tests | green tasks passing canonical tests | amended tasks | unexplained canonical failures | committed tests intact |
|---|---|---|---|---|---|---|
| opus-v2fair-sonnet-12-s7 | True | 35 / 35 | 35 / 35 | - | none | - |
| e6-keep-sonnet-12-s7 | True | 40 / 40 | 37 / 40 | t011, t031, t032, t036 | none | True |
| e6-contract-sonnet-12-s7 | True | 40 / 40 | 36 / 40 | t005, t028, t031, t032, t036 | none | False |
| e6-contract-sonnet-12-s7-r2 | True | 40 / 40 | 36 / 40 | t005, t031, t032, t036 | none | True |
