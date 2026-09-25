# 461 — Contraste en producción (R38)

Lo corre el leader por el MCP de Supabase, solo lectura, con el SQL de `specs/461-cobro-a-tienda-y-nombres-claros/design.md` §13.

## ANTES (2026-09-25, sin la 459 ni la 461 desplegadas)
- C461-0 (candidatos del backfill, sin excluir aún los que va a reclasificar la 459): **Nuform, 203 filas, 25.769.034,50**.
  Son exactamente los 203 de `progress/reclasificacion_459/lista_aprobada.csv`.
- **Orden de migraciones comprobado:** `20260925120300_reclasificar_cobros_459` → `20260925130000_…462` →
  `20260926120200_cobro_tienda_461_completar_caja`. El backfill de la 461 excluye los reclasificados (su
  `NOT EXISTS … cobro_manual_reclasificado`), así que tras la 459 los candidatos pasan a **0**.
- **Salvaguarda:** si la reclasificación de la 459 no cuadra, aborta (suma de control), `migrate deploy` falla y el
  build se detiene ANTES de la 461: esos 203 nunca pueden acabar contados como ganancia.
- Pagos a tienda y a mensajero con asiento a 00:00Z (T2): **0 filas** (Q3 de la auditoría, 2026-09-25).

## DESPUÉS (tras desplegar) — pendiente
Esperado: C461-0 = 0 filas; C461-1 con `diferencia_r8` = 0,00 y `diferencia_r7` = 0,00, SIN excepción;
C461-2 sin filas; la ganancia igual a la de después de la 459 (no hay candidatos); C5 (mensajeros) idéntico.
Si algo no cuadra, se detiene la release.
