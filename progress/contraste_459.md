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
