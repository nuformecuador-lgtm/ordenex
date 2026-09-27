# 459 — Contraste en producción (T Z.3, R91)

Lo corre el leader por el MCP de Supabase, solo lectura, con el SQL de design §11. **Regla R91:** cualquier
diferencia distinta de 0,00, o C2 con filas, detiene el despliegue del bloque siguiente.

## ANTES (línea base, 2026-09-24, sin la 459 desplegada)

| Medida | Valor |
|---|---|
| cifra de hoy (fórmula vieja) | 24.653.587,47 |
| cifra nueva | 16.582.814,00 |
| ganancia | −4.405.636,53 |
| de las tiendas, hoy | 29.059.224,00 |
| de las tiendas, nueva | 20.988.450,53 |
| capital | 0,00 |
| Σ saldos de tiendas | −4.780.583,97 |
| cobros de un costo (203) | 25.769.034,50 |
| **diferencia R8** | **0,00** |
| **diferencia R7** | **0,00** |
| C2, contrapartidas cierre a cierre | **0 filas** |

## ANTES (día de la release, 2026-09-26 22:46 CR; paso A9 de `docs/release.md`)

MCP de Supabase, solo `SELECT`, SQL de design §11 sin cambios. Producción todavía sin la 459.

| Medida | Valor |
|---|---|
| C0 conceptos sin clasificar | **0 filas** |
| C1 entro_hoy · entro_nueva · salio | 39.972.184,22 · 31.206.946,00 · 12.733.110,00 |
| C1 cifra_hoy · cifra_nueva | 27.239.074,22 · 18.473.836,00 |
| C1 ganancia · capital | −3.967.871,78 · 0,00 |
| C1 de_tiendas_hoy · de_tiendas_nueva | 31.206.946,00 · 22.441.707,78 |
| C1 cargos_a_tiendas | 8.765.238,22 |
| C1 suma_saldos | −3.327.326,72 |
| C1 cobros_costo (n) · reclasificados (n) | 25.769.034,50 (203) · 0,00 (0) |
| **C1 diferencia_r8 · diferencia_r7** | **0,00 · 0,00** |
| C2 contrapartidas cierre a cierre | **0 filas** |
| C4 sumas de control | **203 / 25.769.034,50** (solo Nuform); 200 «pago» / 24.904.801,30; del 2026-08-28 al 2026-09-22 |
| C5 mensajeros (se compara después: debe ser idéntico) | `pago_devengado`/`devengo` 166 filas 3.696.400,00 · `pago_efectivo`/`pago` 162 filas 3.687.000,00 |
| C7 primer día de la caja | 2026-08-28, 1.395 movimientos |

Criterios del recuadro A9: R7 = R8 = 0,00 ✓ · C2 0 filas ✓ · C4 = 203 / 25.769.034,50 ✓.
Con los números de hoy, «después de C» ya no es −9.186.220,50 sino **18.473.836,00 − 25.769.034,50 =
−7.295.198,50** y `de_tiendas_nueva` pasará a −3.327.326,72 = `suma_saldos` (vale la igualdad).

## DESPUÉS DE A (fórmula nueva desplegada) — pendiente del despliegue
Esperado: diferencias R7 y R8 en 0,00; C2 sin filas; la ganancia igual a la de antes.

## DESPUÉS DE B (tipos y tablas nuevas) — pendiente del despliegue
Esperado: igual que A; C0 sin categorías sin clasificar; bucket `wallet-comprobantes` creado (privado).

## DESPUÉS DE C (reclasificación de los 203) — pendiente del despliegue
Esperado: cifra nueva −9.186.220,50; de las tiendas −4.780.583,97 = Σ saldos; R8 0,00; ganancia sin cambio;
C4 con 203 filas y 25.769.034,50 reclasificados.

### Salidas de la línea base que completan T0.4 (2026-09-25)
- C0 (conceptos sin clasificar): **0 filas**.
- C6 (catálogos y CHECK): los de M3/M4 de `progress/medicion_457.md`; el bucket `wallet-comprobantes` **no existe** todavía.
- C7 (primer día de la caja, hora de Costa Rica): **2026-08-28**, 1.288 movimientos.
- C3/C4 (candidatos): 203 filas, 25.769.034,50 → `progress/reclasificacion_459/candidatos.csv` (T C.1).
- T C.2: aprobación del humano en `progress/reclasificacion_459/aprobacion.md`.
- T C.3 (esperado después de C): arriba, en «DESPUÉS DE C».
