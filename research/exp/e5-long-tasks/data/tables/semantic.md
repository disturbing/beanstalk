| run | pair | both being written at once (s) | holding the same file at once (s) | common source files touched at any time | landed order |
|---|---|---|---|---|---|
| S: 40 singles, seed 7 / queue | t002+t022 | 2.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 7 / queue | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| S: 40 singles, seed 7 / queue | t011+t018 | 7.3 | 0.0 | src/shipping/service.ts | t011 then t018 |
| S: 40 singles, seed 7 / queue | t023+t036 | 6.4 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| S: 40 singles, seed 7 / queue | t028+t032 | 8.7 | 0.3 | src/types.ts | t028 then t032 |
| S: 40 singles, seed 7 / v2 | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 7 / v2 | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| S: 40 singles, seed 7 / v2 | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| S: 40 singles, seed 7 / v2 | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| S: 40 singles, seed 7 / v2 | t028+t032 | 0.0 | 0.0 | src/shipping/service.ts, src/types.ts | t028 then t032 |
| S: 40 singles, seed 11 / queue | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 11 / queue | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| S: 40 singles, seed 11 / queue | t011+t018 | 11.0 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| S: 40 singles, seed 11 / queue | t023+t036 | 2.6 | 0.0 | src/billing/invoice.ts | t036 then t023 |
| S: 40 singles, seed 11 / queue | t028+t032 | 12.3 | 1.1 | src/types.ts | t028 then t032 |
| S: 40 singles, seed 11 / v2 | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| S: 40 singles, seed 11 / v2 | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| S: 40 singles, seed 11 / v2 | t011+t018 | 0.0 | 0.0 | - | t018 then t011 |
| S: 40 singles, seed 11 / v2 | t023+t036 | 0.0 | 0.0 | - | t023 then t036 |
| S: 40 singles, seed 11 / v2 | t028+t032 | 0.0 | 0.0 | src/notifications/templates.ts, src/shipping/service.ts, src/types.ts | t028 then t032 |
| A: 16 compounds / queue | L01+L02 | 30.8 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| A: 16 compounds / queue | L04+L12 | 19.1 | 0.0 | - | L04 then L12 |
| A: 16 compounds / queue | L05+L11 | 27.6 | 41.1 | src/billing/invoice.ts, src/billing/tax.ts | L05 then L11 |
| A: 16 compounds / queue | L07+L14 | 18.2 | 9.7 | src/config.ts, src/types.ts | L14 then L07 |
| A: 16 compounds / queue | L08+L12 | 25.1 | 0.0 | src/shipping/service.ts | L08 then L12 |
| A: 16 compounds / v2 | L01+L02 | 51.3 | 56.1 | src/billing/handlers.ts, src/lib/pagination.ts, src/notifications/queue.ts, src/notifications/templates.ts, src/orders/checkout.ts | L01 then L02 |
| A: 16 compounds / v2 | L04+L12 | 16.2 | 0.0 | - | L04 then L12 |
| A: 16 compounds / v2 | L05+L11 | 34.0 | 0.0 | src/billing/service.ts | L11 then L05 |
| A: 16 compounds / v2 | L07+L14 | 11.7 | 0.0 | src/config.ts, src/types.ts | L14 then L07 |
| A: 16 compounds / v2 | L08+L12 | 22.5 | 0.0 | - | L08 then L12 |
| A2: 16 compounds, repeat / queue | L01+L02 | 61.6 | 62.8 | src/billing/handlers.ts, src/lib/pagination.ts, src/orders/checkout.ts, src/orders/handlers.ts, src/orders/service.ts | L01 then L02 |
| A2: 16 compounds, repeat / queue | L04+L12 | 15.0 | 0.0 | - | L04 then L12 |
| A2: 16 compounds, repeat / queue | L05+L11 | 33.4 | 0.0 | - | L11 then L05 |
| A2: 16 compounds, repeat / queue | L07+L14 | 15.5 | 0.0 | src/config.ts, src/types.ts | L14 then L07 |
| A2: 16 compounds, repeat / queue | L08+L12 | 21.0 | 0.0 | - | L08 then L12 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t011+t018 | 84.6 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| B: 40 singles, drift x7 / queue [modelled: touches stretched with the session] | t028+t032 | 118.9 | 55.7 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t005+t031 | 0.0 | 0.0 | - | t005 then t031 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t011+t018 | 84.6 | 0.0 | src/notifications/templates.ts | t018 then t011 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t023+t036 | 0.0 | 0.0 | src/billing/invoice.ts | t023 then t036 |
| B: 40 singles, drift x7 / queue [touches as they happened] | t028+t032 | 118.9 | 109.9 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t023+t036 | 200.1 | 0.0 | - | t023 then t036 |
| B: 40 singles, drift x7 / v2 [modelled: touches stretched with the session] | t028+t032 | 255.8 | 37.7 | src/types.ts | t028 then t032 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t002+t022 | 0.0 | 0.0 | - | t002 then t022 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t005+t031 | 0.0 | 0.0 | src/lib/money.ts | t005 then t031 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t011+t018 | 0.0 | 0.0 | - | t011 then t018 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t023+t036 | 200.1 | 0.0 | - | t023 then t036 |
| B: 40 singles, drift x7 / v2 [touches as they happened] | t028+t032 | 255.8 | 86.0 | src/types.ts | t028 then t032 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L01+L02 | 133.9 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L04+L12 | 76.6 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L05+L11 | 125.3 | 54.3 | src/billing/tax.ts | L05 then L11 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L07+L14 | 68.7 | 3.6 | src/config.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / queue [modelled: touches stretched with the session] | L08+L12 | 94.9 | 0.0 | src/shipping/service.ts | L08 then L12 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L01+L02 | 133.9 | 96.4 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L04+L12 | 76.6 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L05+L11 | 125.3 | 107.6 | src/billing/tax.ts | L05 then L11 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L07+L14 | 68.7 | 102.1 | src/config.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / queue [touches as they happened] | L08+L12 | 94.9 | 0.0 | src/shipping/service.ts | L08 then L12 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L01+L02 | 143.8 | 0.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L04+L12 | 75.8 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L05+L11 | 139.6 | 42.0 | src/billing/tax.ts | L11 then L05 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L07+L14 | 238.6 | 34.3 | src/config.ts, src/db/migrations/index.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / v2 [modelled: touches stretched with the session] | L08+L12 | 94.7 | 0.0 | - | L08 then L12 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L01+L02 | 143.8 | 106.0 | src/billing/handlers.ts, src/routes.ts | L01 then L02 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L04+L12 | 75.8 | 0.0 | - | L04 then L12 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L05+L11 | 139.6 | 99.7 | src/billing/tax.ts | L11 then L05 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L07+L14 | 238.6 | 119.5 | src/config.ts, src/db/migrations/index.ts, src/types.ts | L14 then L07 |
| C: 16 compounds, drift x4 / v2 [touches as they happened] | L08+L12 | 94.7 | 0.0 | - | L08 then L12 |
