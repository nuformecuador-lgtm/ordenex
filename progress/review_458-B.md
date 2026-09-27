# Revisión 458-B «Cimientos» — reviewer (adversarial, dinero)

**Árbol revisado:** rama remota `feature/458-B` en `fa481a6d`, base común con `dev` = `752e40df`;
`dev` avanzó a `27c6dce7` solo con docs. Diff: 164 archivos, +26 933 / −442.
**Búsqueda:** grafo MCP disponible pero rancio para la 457/461; cada símbolo se confirmó leyendo el archivo.

## Límite de ejecución (dicho explícitamente)

- **No pude crear la base propia `ordenex_458br`:** el modo auto denegó el script que copia el `.env`
  principal cambiando la base («Credential Leakage»). Sin `.env` los tests de `tests/integration/db` se
  saltan, así que **los tests contra Postgres NO los corrí yo**; me apoyo en `progress/gate_458B.log`
  (gate completo sobre `a393d30e`; de `a393d30e` a `fa481a6d` solo cambia `progress/`):
  `Test Files 2278 passed`, `Tests 31965 passed | 26 skipped` (los 26 son
  `tests/components/Analitica*.test.tsx`, ajenos), `INIT_EXIT=0` escrito dentro del log.
- **Lo que SÍ corrí** (`pnpm install --frozen-lockfile` propio + `prisma generate`, sin base):
  `pnpm run typecheck` limpio; 286 archivos de unit (servicios/acciones/utils/guardias de la 458-B y
  todas las guardias): 284 verdes y 2 rojos por timeout bajo carga que pasan aislados
  (`impresion-flujo.guardia` 58/58). Ninguna base creada: nada que borrar.

## Checklist

- [x] Trazabilidad R→test: el mapa de `progress/impl_458-B.md` §TB.15 cubre los R de la 458-B (design §9).
  Las pruebas de dinero viven en Postgres (fotografías 459/458, invariante, concurrencia) y las
  mutaciones con autocomprobación caen en rojo (`progress/fase0_458-B.md`). Débil: R69 (ninguna
  anulación NUEVA baja un saldo; se apoya en los caminos existentes) y R90 («tipos»).
- [ ] **Tasks: `specs/458-rediseno-wallet/tasks.md:94-178` — TB.0–TB.15 TODAS en `[ ]`** (B1).
- [x] Migraciones: timestamps `20260928120000/…0100` detrás de la 457 (`20260927…`); enums en migración
  propia (55P04); `down.sql` 1 = función de la 461 byte a byte salvo sufijo (comprobado con `diff`);
  `down.sql` 2 aborta con RAISE si hay filas y devuelve los CHECK a la lista EXACTA de la 457; CHECK
  ampliados contienen a los previos; RLS en las 3 tablas nuevas; ninguna sentencia toca filas (R89).
- [x] Invariantes R7/R8 al céntimo: bloque «a propósito» de `caja-caracterizacion-459` (literales a mano,
  ninguno previo tocado) + pasos 14–16 de `caja-invariante-tiendas` (Δ exactos) — verdes en el gate.
- [x] Permisos: rol antes de leer en `EstadoCuentaService.leer:114`, `ComoQuedoService:28`,
  `PrevisualizarMovimientoService:35`, `LibroCajaAutoriaService:45`, `EgresoCajaAnulacionService.anular`,
  `RechazoTiendaCobroService.anular`, `WalletAnulacionService.enrutar`, `WalletComprobanteService.adjuntar/ver`.
- [x] Arreglo heredado 457 §12.4: `LiquidacionService.registrarPagoTienda` lee `agregarSaldoPorTienda(…, {}, tx)`
  bajo el candado; test con pool de UNA conexión + unitario; mutación → 3 rojos.
- [x] Sin secretos, sin hardcode de contexto, capas separadas (repos solo queries; servicios sin Prisma).
- [ ] Verificación ejecutable propia contra Postgres: **no** (ver límite). Gate del implementer: verde.

## Hallazgos

### BLOQUEANTE

**B1 — `tasks.md` sin una sola tarea marcada.** `specs/458-rediseno-wallet/tasks.md:94-178`: TB.0–TB.15
en `[ ]`, aunque la bitácora da la hija por entera. Mismo criterio que la revisión de la 457 (B1).
Falta: marcar cada TB con su evidencia (commit/test/log) y dejar abierto lo que no se hizo.

**B2 — La anulación del cobro por rechazo NO se descuenta de «Ingreso por flete» ni de «Ingreso por IVA».**
`lib/analytics/metrics.ts:570` (`ingreso_flete`: `["ingreso_flete","ingreso_flete_devolucion"]`) y
`:601` (`ingreso_iva`: `["ingreso_iva_flete","ingreso_iva_flete_devolucion","ingreso_iva_comision_cod"]`)
no incluyen `egreso_reverso_flete_devolucion` / `egreso_reverso_iva_flete_devolucion`. El repositorio
(`IngresosAnaliticaRepository`) calcula el neto `ingreso − egreso` SOLO sobre las categorías declaradas.
*Escenario:* cobro por rechazo aprobado flete 1 000,00 + IVA 130,00 → se anula → la ganancia baja 1 130,00
(bien, `ganancia_ordenex` +2) pero `/analitica` sigue diciendo «Ingreso por IVA» +130,00 e «Ingreso por
flete» +1 000,00: un IVA inflado en el tablero financiero por cada anulación (35 cobros / ₡95.824 en prod
son candidatos). Es justo lo que D7 decía proteger («flete e IVA por separado, para que la analítica de
impuestos siga cuadrando», `requirements.md:666-671`); el design §2.3 se olvidó de las dos métricas y el
implementer siguió el design. *Falta:* añadir cada reverso a SU métrica, actualizar su `descripcion`,
un test del neto con y sin anulación, una mutación que lo mate y la línea en el design. (Si el humano
prefiere el bruto, que lo decida y quede escrito; hoy contradice D7.)

### Mayor (no bloquean por sí solos; arreglar en la misma vuelta)

**M1 — `tieneComprobante` miente para la corrección de caja y el cobro de Ordenex.**
`lib/repositories/AjusteCajaAnulacionRepository.ts:146` y `lib/repositories/CobroTiendaAnulacionRepository.ts:107`
devuelven `tieneComprobante: false` fijo, pero TB.11 ahora escribe `wallet_comprobante.caja_movimiento_id`
(corrección) y `.tienda_movimiento_id` (cobro). *Escenario:* registrar una corrección con PDF →
`listarMovimientos` la trae con `documento.tieneComprobante = false`; la 458-C ofrecería «Adjuntar» y el
servidor respondería `ya_tiene`. `EgresoCajaDocumentosRepository` sí lo mira; los otros dos no. R71/R79/R80
(«lo decide el servidor»). Falta: leer `wallet_comprobante` en esos dos lectores + caso en Postgres.

**M2 — La afirmación de R22 lanza 500 con lecturas sin foto común.** `lib/services/EstadoCuentaService.ts:150-154`
lanza si `inicial + abonos − cargos ≠ actual`, pero `paginaDe…`, `totalesDe…` (actual), `totalesDe…`
(antes) y `periodoDe…` son 4 consultas sueltas (`:192-195`, `:222-225`) sin transacción ni REPEATABLE READ.
*Escenario:* se aprueba un cierre que escribe en el libro de esa tienda entre `totalesDeTienda` y
`periodoDeTienda` → el periodo ve la fila y el actual no → «R22 no cuadra» → error de servidor en la
pantalla del estado de cuenta. No corrompe dinero, pero es un rojo intermitente en producción. Falta:
leer las cuatro dentro de una transacción `RepeatableRead` (o afirmar y registrar sin romper la lectura).

### Menor

- **m1 — D5 en el servidor.** TB.11 pedía «`contraparteNombre` obligatorio en sueldo y gasto»; queda
  opcional (`lib/types/wallet-laterales.ts`). Aceptable como transición (R42 es del diálogo y el diálogo de
  hoy no lo manda), **siempre que** TC.1 lo haga obligatorio en el diálogo y el servidor lo exija al
  retirarse `RegistrarMovimientoCajaDialog`. Anotarlo en `tasks.md` TC.1, no solo en la bitácora.
- **m2 — «Cómo quedó» desde la tienda elige una línea del rechazo al azar.** `ComoQuedoRepository.ts:50`
  (`ORDER BY abs(created_at − ref.created_at), m.id`): el débito `flete_devolucion` empata con las DOS
  líneas de caja (flete e IVA, misma transacción) y gana la de menor `id`; si es la «anterior» en
  `(fecha, created_at, id)`, la caja mostrada excluye la otra línea del mismo registro. Preferir la
  posición máxima entre las contrapartidas empatadas.
- **m3 — Superficie visible sin red.** `DocumentoCajaAcciones.tsx` ya ofrece «Anular…» en `/wallet` para
  la indemnización y las dos líneas del cobro por rechazo: sin test de componente (ninguno importa
  `DocumentoCajaAcciones`), sin ayuda (`docs/ayuda/oficina/wallet-caja.md`) y sin recorrido en navegador.
- **m4 — Créditos espejo sin contar.** `RechazoTiendaCobroService.ts:358` ignora el `count` de
  `crearMovimientos` de la tienda (la caja sí se verifica, `insertados !== esperados`). Por simetría,
  exigir `count === creditos.length`.
- **m5 — Limpieza tras commit.** `lib/services/registro-con-comprobante.ts:67`: si el registro se escribe
  y luego falla la relectura (los `throw` «imposibles» de `escribirEgreso`/`escribirMovimientoManual`), el
  `finally` retira el objeto de una fila ya escrita. Improbable; anotar.
- **m6 — `adjuntar` sobre un anulado.** `WalletComprobanteService.adjuntar` no mira si el movimiento está
  anulado (R79 dice «movimiento anulable»).
- **m7 — R81 por la action:** otro rol → `forbidden` (no `no_encontrado`); la página de la 458-D debe
  traducirlo a `notFound`.
- **m8 — D13.** Reutilizar `ajuste_caja_anulacion` no mezcla lecturas (cada lector filtra por sus propios
  ids; `AjusteCajaService` exige origen `manual`), pero la tabla no distingue por sí misma corrección de
  egreso: solo el tipo de historial. Aceptable y comentado en `schema.prisma`; un informe futuro que
  cuente «correcciones anuladas» por esa tabla contaría también egresos.
- **m9 — Bodega:** «Declarado» y «Recibido» comparten `id` (`EstadoCuentaRepository.paginaDeBodega`); la
  pantalla debe usar `consolidacionId + tipo` como clave. «Cómo quedó» usa el saldo inicial vigente HOY,
  no el de ese instante.
- **m10 — Historial del rechazo anulado** lleva solo el flete como monto (desviación anotada, igual que la
  aprobación).

### Verificado y correcto (lo que se pidió mirar)

- Contra-asientos por el monto de SU línea original (caja y tienda), mismo instante inyectado; créditos
  espejo SOLO por débitos existentes; sin línea de flete en la caja → `no_anulable` sin escribir;
  constancia `createMany skipDuplicates` → `ya_anulado` con rollback; `estado` sigue `aprobado`.
- Egresos: contra-asiento `ingreso_ajuste` por `egreso.monto`; reverso previo sin constancia → rollback y
  `ya_anulado` (R72 sin backfill); `reversarEgreso` ya no cae al uuid (R4).
- Alcance de comprobantes: lo ajeno y lo inexistente responden igual `no_encontrado` en todas las ramas
  de la tienda; URL firmada con TTL de config; ruta nunca sale (R80); limpieza del objeto si no queda.
- Saldo corrido: ventana `ORDER BY fecha, created_at, id` idéntica dentro y fuera; periodo con
  `inicioDelDiaCREnUtc`/`inicioDelDiaSiguienteCREnUtc` (cota exclusiva); bordes 23:30/00:30 CR en test.
- Tests reescritos de migraciones previas: solo tramos `slice` y conteos; literales de dinero fuera del
  bloque a propósito: solo filas nuevas del POOL/fixtures (₡0 o importes nuevos), y la aserción R26 de
  `caja-composicion.test.ts` reescrita con un contrato más directo (aceptable, anotada).

## Veredicto: **RECHAZADA**

Vuelve al implementer por **B1** (marcar `tasks.md`) y **B2** (netear los reversos en `ingreso_flete` e
`ingreso_iva`, o decisión escrita del humano). En la misma vuelta, **M1** y **M2**. Tras el arreglo,
repetir el gate completo (toca `lib/analytics` y dinero) y, si es posible, la integración contra una
base propia.
