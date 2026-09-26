# 458 — Medición en producción (design §14)

Solo lectura, por el MCP de Supabase. Producción todavía sin la 458.

## ANTES (2026-09-26)

| Consulta | Resultado | Esperado |
|---|---|---|
| Q458-1: cobros por rechazo aprobados | **35**, flete + IVA **95.824,00**; los 35 tienen línea de caja y débito en la tienda | 35 / 95.824,00 ✓ |
| Q458-2: reversos de gasto sin motivo (se pintarán «motivo no registrado») | **0** | informativo |
| Q458-4: grupos del mismo instante con más de 20 filas | **0** | 0 ✓ |

Aviso: design §13 dice que el bucket `wallet-comprobantes` «ya existe desde la 459». **Es falso**: no existe ni en preview ni en prod (M5 de `contraste_457.md`). Se crea el día de la release (docs/release.md).

## DESPUÉS DEL DESPLIEGUE — pendiente
Q458-3 = la C457-1 (`progress/contraste_457.md`) con `es_cargo` ampliado a `egreso_reverso_flete_devolucion` y `egreso_reverso_iva_flete_devolucion`. Se espera R7 = R8 = 0,00 y la cifra principal igual a la de antes.
