# 458 — Tareas

Organizadas por ficha hija (`design.md` §9). Cada hija: rama propia desde `dev`, worktree con
`checkout --detach <SHA de dev>` + comprobación de merge-base como primer paso, spec breve derivado
de este (los R que cubre) antes de tocar código, `progress/impl_458-<hija>.md` con el mapa R → test,
revisión y entrada en `progress/history.md`. `[P]` = paralelizable con la anterior dentro de la
misma hija. Nada se da por hecho sin su gate (`./init.sh --rapido`, o completo donde se indica).

## Reglas que valen para TODAS las hijas

- **Antes y después:** la fotografía de 458-0 (`wallet-caracterizacion-458.test.ts`) corre en
  verde al empezar y al terminar cada hija, sin tocar sus literales. Si una hija necesita cambiar
  un literal, se para y se pregunta: es dinero.
- **No en paralelo:** gate y mutaciones nunca a la vez sobre el mismo árbol.
- **Test que se retira:** si se borra o reescribe un componente, sus tests se listan en el informe
  con el R que los sustituye; ninguno desaparece sin reemplazo.
- **Log del gate:** `INIT_EXIT=$?` escrito dentro del log, sin `tail` en tubería; se miran los
  `skipped` de `tests/integration/db` (sin `.env` se saltan y el gate dice «OK»).
- **Commit por tarea** (`feat(458-x): …`), y verificar el blob commiteado antes de dar la hija por
  cerrada.

---

## 458-0 — Caracterización (backend, sin código de producción)

- [ ] **T0.1** Constructor del escenario de §8.1 en `tests/integration/db/_fixtures/wallet-458.ts`
  (cierre con COD/flete/comisión/IVA/pago al mensajero; rechazo con cobro aprobado; pago a tienda y
  su anulación; reparto a mensajero y anulación de un pago; cobro de un costo; sueldo y su reverso;
  gasto variable; ajustes; cobro de gasto fijo aprobado; premio y su anulación; consolidación de
  bodega parcial). *Hecho:* siembra dos veces seguidas sin error ni duplicados.
- [ ] **T0.2** `wallet-caracterizacion-458.test.ts`: afirma como literales `CajaResumenDTO`,
  `ComposicionGananciaDTO`, `DesgloseEgresosDTO`, saldo y desglose de cada tienda, cuenta por pagar
  de cada mensajero y pendiente de la bodega; un caso con nombre propio fija que `enCaja` incluye el
  flete (§1.8). *Hecho:* verde contra el SHA de `dev` anotado en el informe; `skipped = 0`.
  Depende de T0.1.
- [ ] **T0.3** Mutaciones (≥ 10, lista en `design.md` §8.2), una a una: aplicar → correr solo T0.2
  → rojo con el nombre del caso → revertir → verde. *Hecho:* `progress/impl_458-0.md` con, por
  mutación, comando, salida roja y `git diff --stat` vacío al final; ninguna mutación superviviente
  sin explicar. Depende de T0.2.
- [ ] **T0.4** [P] (lo hace el LEADER, no el agente) Medición del doble conteo en producción por el
  MCP de Supabase en solo lectura (§8.3) y cruce con `progress/medicion_457.md`. *Hecho:*
  `progress/hallazgo_458_doble_conteo.md` con la consulta, el número y la frase para el humano (P10,
  P15).
- [ ] **T0.5** Gate rápido + commit. *Hecho:* `INIT_EXIT=0` en el log.

## 458-1b — Pago por cuenta de una tienda (fullstack, urgente) · depende de 458-0

- [ ] **T1b.1** Leer cómo recrean su enum los `down.sql` de la 381 (tienda) y de la 173 (caja).
  *Hecho:* nota en el informe con la forma elegida para el `down.sql` nuevo.
- [ ] **T1b.2** Migración `<ts>_pago_por_cuenta_tienda`: `egreso_pago_por_cuenta_tienda` y
  `pago_por_cuenta`, CHECK `tipo ↔ categoria` de los dos libros recreados; `down.sql` con la lista
  vigente completa menos el valor nuevo y fallo explícito si hay filas con él. *Hecho:*
  `prisma migrate deploy` y `db:rollback` en local verdes; test de migración (molde
  `wallet-tienda-cobro-migration.test.ts`); `tests/integration/db` sin `skipped`. Depende de T1b.1.
- [ ] **T1b.3** Migración `<ts>_wallet_anotacion_idempotencia` (§2.1, §2.7), RLS sin policies,
  `down.sql`. *Hecho:* igual que T1b.2. [P] con T1b.2 en redacción; se aplican en orden.
- [ ] **T1b.4** `Record` totales: `NATURALEZA_POR_CATEGORIA` (terceros), `CATEGORIA_LABEL`,
  `CATEGORIA_TIENDA_LABEL`, `CUBETA_POR_CATEGORIA` («pagado»), `FUENTE_TIENDA`; revisar
  `lib/analytics/metrics.ts`. *Hecho:* typecheck verde; `caja-composicion-exhaustiva`,
  `metrics-caja-naturaleza` y la fotografía de 458-0 en verde sin tocar literales.
- [ ] **T1b.5** `PagoPorCuentaTiendaService` + repositorio + interfaz + `registrarPagoPorCuentaTiendaAction`
  (zod `.strict()`: `tiendaId` uuid, `beneficiario` no vacío, `monto` STRING, `motivo`,
  `referencia?`, `fecha?`, `clave`); las dos filas + anotación + clave en UNA transacción; sin tope
  (P14). *Hecho:* unit del servicio (roles, borde, enrutado) y
  `tests/integration/db/pago-por-cuenta-tienda.test.ts` (dos libros, efecto en `derivarCaja`:
  caja −monto, de las tiendas −monto, ganancia igual; reintento con la misma clave = una sola vez)
  — cubre R93, R48.
- [ ] **T1b.6** Diálogo ACTUAL: sexto concepto en `wallet-conceptos-manuales.ts` con destino propio,
  campo «A quién se le pagó», frase «Sale dinero de la caja…» y la del cobro «No sale dinero…».
  *Hecho:* `wallet-registrar-movimiento-dialog.test.tsx` y `wallet-conceptos-manuales.test.ts`
  ampliados; el payload del cobro no gana claves (R37 de la 381 intacto).
- [ ] **T1b.7** [P] `/mi-wallet` y `/wallet/tiendas`: la fila `pago_por_cuenta` se lee «Pago que
  Ordenex hizo por tu cuenta a <beneficiario>» (tienda) / «Pago por cuenta de la tienda a
  <beneficiario>» (acceso total), leyendo el beneficiario por el enlace de §2.6. *Hecho:* test de
  R95 en `mi-wallet-page.test.tsx`; ninguna fila de este tipo dice «Cobro de Ordenex».
- [ ] **T1b.8** Gate COMPLETO (hay migración), recorrido paso 5b sin «Así queda», revisión.
  *Hecho:* `INIT_EXIT=0`; capturas en `progress/recorrido_458-1b/`; paso de release anotado
  (migrar preview y prod).

## 458-1 — Cimientos (backend) · depende de 458-0 y 458-1b

- [ ] **T1.1** Migración `<ts>_wallet_comprobante_anulacion` (§2.2, §2.3) con CHECK XOR, UNIQUE,
  RLS y `down.sql`. *Hecho:* deploy + rollback locales; test de migración; `skipped = 0`.
- [ ] **T1.2** [P] `lib/config/wallet-comprobante.ts` (bucket, tipos, tamaño, TTL) + `BUCKETS`.
  *Hecho:* test de config; nota de release «crear `wallet-comprobantes` privado en local, preview y
  prod ANTES de desplegar» en el informe.
- [ ] **T1.3** [P] `rangoDelPeriodoCR` y formateador de fecha CR en `lib/utils/`. *Hecho:*
  `wallet-fecha-cr.test.ts` con bordes 23:30 y 00:30 CR (R16).
- [ ] **T1.4** [P] `OrigenLegibleService` en lote (§3.3), mapas `Record<WalletOrigenTipo,…>` y DTO
  con `origenTipo: WalletOrigenTipo`. *Hecho:* test por origen; test de número de consultas (una
  por tipo presente); caso `gestion_orden` en el libro de la tienda (R5–R9).
- [ ] **T1.5** [P] Resolutor «A quién» / «Registró» (§3.4). *Hecho:*
  `tests/integration/db/libro-caja-a-quien.test.ts` con una fila por origen; nombres, nunca ids.
- [ ] **T1.6** [P] `conceptosConMovimientos` (repo + servicio + action). *Hecho:*
  `tests/integration/db/wallet-conceptos-con-movimientos.test.ts` contra la base: periodo, cuenta,
  sin el propio filtro de concepto; `egreso_gasto`/`ajuste_debito` ausentes sin filas (R13, R14).
- [ ] **T1.7** [P] `cierresDeLaCuenta` (tienda con nombre de mensajero, mensajero) y borde
  `cierreId: uuid` con el `WHERE` siempre acotado a la cuenta. *Hecho:*
  `tests/integration/db/wallet-cierres-selector.test.ts`: un cierre de otra cuenta devuelve cero
  filas (R11, R12), y una mutación que quita la cuenta del `WHERE` pone el test rojo.
- [ ] **T1.8** Saldo corrido en repositorio (ventana, §3.2), `EstadoCuentaService` (tienda,
  mensajero, bodega por UNION), `CHIP_POR_MOVIMIENTO` total, totales netos (P3) y comprobación de
  R22. *Hecho:* `saldos-corridos.test.ts` y `estado-cuenta-saldo-corrido.test.ts` contra la base
  (orden estable R23, corrido de la cuenta completa con chip R21, R22 con y sin anulaciones);
  guardia de totalidad del chip. Depende de T1.3.
- [ ] **T1.9** Anulación uniforme (§4.3): servicio + `anularMovimientoAction`; `reversarEgreso`
  escribe motivo y deja de caer al id (C4.3, R4); contra-asiento del pago por cuenta (R96); lectura
  de reversos anteriores como «motivo no registrado» (R66). *Hecho:*
  `wallet-anulacion-service.test.ts` (R58–R64, R96) y
  `tests/integration/db/wallet-anulacion-concurrencia.test.ts` (dos anulaciones simultáneas = un
  contra-asiento); tras anular, la fotografía vuelve a sus literales (R63). Depende de T1.1.
- [ ] **T1.10** Comprobantes (§4.1): registrar con `FormData`, adjuntar después, ver con URL firmada
  tras comprobar alcance; limpieza del objeto si la transacción falla. *Hecho:*
  `wallet-comprobante-service.test.ts` (tipo, tamaño, fallo de subida no registra, fallo de registro
  borra, UNIQUE impide el segundo) y `tests/integration/db/wallet-comprobante-alcance.test.ts`
  (tienda ve lo suyo y nada más, R70–R73). Depende de T1.1, T1.2.
- [ ] **T1.11** «Así queda» (§4.4): `EFECTO_POR_TIPO` (misma tabla que el enrutado),
  `efecto-movimiento.ts` puro sobre `derivarCaja`, `previsualizarMovimientoAction`. *Hecho:*
  `efecto-movimiento.test.ts` (un caso por tipo, incluido «no cambia», R42–R43, R97) y
  `caja-derivaciones.guardia` verde.
- [ ] **T1.12** Bordes existentes de sueldo, gasto variable y ajustes: `contraparteNombre`
  (obligatorio en sueldo y gasto variable, P5), `referencia?`, `clave?`, comprobante; anotación en
  la misma transacción. *Hecho:* tests de actions y servicios existentes verdes + casos nuevos; sin
  `clave` el comportamiento es byte a byte el de hoy.
- [ ] **T1.13** [P] Comentarios T1–T4 de §1.6 en `db/schema.prisma` y `lib/types/`. *Hecho:* diff
  solo de comentarios en esos archivos.
- [ ] **T1.14** Fotografía antes/después, gate COMPLETO, revisión. *Hecho:* `INIT_EXIT=0`; literales
  de 458-0 intactos.

## 458-2 — Detalles y guardias, sobre las pantallas ACTUALES (fullstack) · depende de 458-0 (+ lecturas T1.4, T1.6, T1.7)

- [ ] **T2.0** Si 458-1 no ha entregado T1.4/T1.6/T1.7, traerlas aquí (misma interfaz) y dejar a
  458-1 reutilizarlas. *Hecho:* decisión anotada en el informe; ninguna lectura duplicada.
- [ ] **T2.1** Clase 1: selector de cierre con búsqueda (`SelectorBuscable` mínimo o `Select` si la
  lista es corta) en el desglose de tienda y de mensajero; fuera el campo de texto, su ayuda y
  `DESGLOSE_TIENDA_FILTRO_LABEL.cierrePlaceholder`; guardia `wallet-sin-campo-id` con contraprueba.
  *Hecho:* tests de las dos pantallas (R10–R11) + guardia verde; contraprueba con la fuente de hoy
  roja (R85, R89).
- [ ] **T2.2** Clase 2: origen legible (con enlace según rol) en las 6 superficies (2 tablas de
  tienda, 1 de mensajero, libro de caja, detalle de fila de la composición y sus descargas);
  guardia `wallet-origen-total`. *Hecho:* `wallet-origen-legible.test.ts`,
  `wallet-origen-enlace.test.tsx`; guardia + contraprueba (R5–R8, R86).
- [ ] **T2.3** Clase 3: los 3 filtros de concepto desde `conceptosConMovimientos`, con cuenta y
  conservando el elegido en 0 (R15); fuera los comentarios T5; guardia `wallet-conceptos-sin-seed`.
  *Hecho:* tests de los tres filtros; guardia + contraprueba (R13–R15, R87).
- [ ] **T2.4** Clase 4: `EnlaceCierre` sin uuid en su nombre accesible (se nombra por día y
  mensajero); guardia de render `wallet-sin-uuid` sobre todas las superficies. *Hecho:* guardia
  verde; contraprueba con el `EnlaceCierre` de hoy roja (R1, R2, R88, R89).
- [ ] **T2.5** [P] R90 (pista de «Cargos» con cobros) y R92 (T5–T8 de §1.6); guardia
  `wallet-textos-458`. *Hecho:* guardia + contraprueba.
- [ ] **T2.6** [P] D6: tras pagar o anular en `/wallet/tiendas`, invalidar por predicado el desglose
  de ESA tienda (cualquier página y filtros) y la página de saldos donde está su fila. *Hecho:*
  `WalletRefrescoDirigido.test.tsx`: la fila muestra el saldo nuevo y el botón «Registrar pago» se
  deshabilita tras pagar todo; no se relee ninguna otra tienda (R29).
- [ ] **T2.7** Recorrido pasos 1, 6, 7, 10 sobre las pantallas actuales + gate rápido + revisión.
  *Hecho:* tabla con números en `progress/recorrido_458-2/`; `INIT_EXIT=0`.

## 458-3 — Registro y detalle (fullstack) · depende de 458-1, 458-1b; la entrada «pago recibido» de 457

- [ ] **T3.1** `components/shared/SelectorBuscable` (popover + input): vacío, cargando, error, foco
  opaco, teclado. *Hecho:* test de componente y de accesibilidad básica.
- [ ] **T3.2** `components/shared/wallet/RegistrarMovimientoDialog`: catálogo `Record` total por
  tipo en tres grupos + enlace a plantillas; campos por tipo; payload solo con sus claves; `clave`
  al abrir; preselección de cuenta y tipo. *Hecho:*
  `wallet-registrar-movimiento-dialog.test.tsx` reescrito (R35–R41, R46, R48, R94); los tests de
  la 334/381 que se retiran, listados con su sustituto.
- [ ] **T3.3** «Así queda» en el diálogo: pide la previsualización con retardo, estados cargando y
  error sin cifras (R44), frases «no cambia», aviso de saldo en contra (R97). *Hecho:* tests de
  R42–R44, R97; barrido money-safe sin `Number(`/`parseFloat(` en la carpeta.
- [ ] **T3.4** [P] Comprobante en el formulario (tipo y tamaño avisados antes de enviar; el servidor
  decide). *Hecho:* tests de R67–R68.
- [ ] **T3.5** `DetalleMovimientoPanel` (Sheet) + `AnularMovimientoDialog` (motivo obligatorio,
  «ya estaba anulado»). *Hecho:* tests de R54 (contenido), R58–R61.
- [ ] **T3.6** Sustituir `RegistrarMovimientoCajaDialog` en `/wallet`. *Hecho:*
  `wallet-page.test.tsx` verde; el efecto de cada tipo en la fotografía idéntico (R47).
- [ ] **T3.7** Entrada «Pago recibido de una tienda» enchufada a la action de la 457. *Bloqueada
  hasta que la 457 esté en `dev`.* *Hecho:* test de enrutado y de «Así queda» del tipo.
- [ ] **T3.8** Recorrido pasos 2, 3, 5, 5b + gate rápido + revisión.

## 458-4 — Estados de cuenta (fullstack) · depende de 458-3 y 457

- [ ] **T4.1** `components/shared/estado-cuenta/` (tarjetas con frase, tabla extracto con saldo
  inicial, chips, periodo, anulados tachados con motivo, «Ver»). *Hecho:* `EstadoCuenta.test.tsx`
  y `EstadoCuentaAnulados.test.tsx` (R18–R25, R66).
- [ ] **T4.2** [P] `/wallet/tiendas/[tienda]` + el listado enlaza; acciones «Registrar pago
  recibido», «Cobrar un costo», «Pagar a la tienda» (deshabilitado con motivo). *Hecho:*
  `EstadoCuentaAcciones.test.tsx` (R26–R28, R38); `notFound` para rol sin acceso o tienda
  inexistente (R74).
- [ ] **T4.3** [P] `/wallet/mensajeros/[mensajero]`: estado de cuenta, pago (reparto) y anulación de
  pagos desde la wallet. *Hecho:* tests de R65; `/cierres-admin` sigue anulando (test existente).
- [ ] **T4.4** [P] `/wallet/satelites/[bodega]`: estado de cuenta + conciliación. *Hecho:*
  `EstadoCuentaSatelite.test.tsx` + tests de la 431 verdes (R30).
- [ ] **T4.5** `/mi-wallet` como estado de cuenta en solo lectura, desde el lado de la tienda, con
  comprobantes. *Hecho:* `mi-wallet-page.test.tsx` ampliado (R32–R34, R71, R95);
  `mi-wallet-335.guardia` verde (sin actions de escritura).
- [ ] **T4.6** Descarga del estado de cuenta con saldo corrido. *Hecho:* test de columnas;
  `columnas-sensibles.guardia` verde (R31, R3).
- [ ] **T4.7** Refresco dirigido tras registrar/anular desde el estado de cuenta. *Hecho:*
  `WalletRefrescoDirigido.test.tsx` ampliado (R29, R45).
- [ ] **T4.8** Recorrido pasos 4–10 + adminTienda + mensajero sin acceso; gate rápido; revisión.

## 458-5 — Libro de caja (fullstack) · depende de 458-3 · [P] con 458-4

- [ ] **T5.1** Columnas Fecha · Movimiento y motivo · A quién · Monto · Registró · Ver, y la
  aserción de `WalletDescarga.test.tsx` reescrita en el MISMO commit. *Hecho:* tests de R51–R53;
  descarga sin ids.
- [ ] **T5.2** Filtros Todo/Entra/Sale, «A quién», concepto con cuenta y periodo CR; tarjetas del
  conjunto filtrado. *Hecho:* `wallet-page.test.tsx` ampliado (R49, R50, R55, R16).
- [ ] **T5.3** Panel «Ver» + anular + «Cómo quedó»; refresco del libro, tarjetas, composición y
  desglose. *Hecho:* tests de R54, R56.
- [ ] **T5.4** [P] Colas de gasto fijo y de rechazo, composición y plantillas sin cambios. *Hecho:*
  sus tests existentes verdes sin modificarlos (R57, R76, R80, R81).
- [ ] **T5.5** Recorrido COMPLETO por rol (`design.md` §10) con la tabla maqueta vs app; gate
  completo; revisión final de la 458. *Hecho:* `progress/recorrido_458-5/` con números;
  `INIT_EXIT=0`; todas las R de `requirements.md` con su test en algún `progress/impl_458-*.md`.

---

## Fuera de estas hijas (decisión del humano pendiente)

- **P15 — los 203 cobros históricos de Nuform.** Si el humano elige A o B, se abre una ficha
  propia con su spec (lista de filas revisada, suma de control antes y después, medición en
  producción en solo lectura antes de desplegar). No va en ninguna hija de la 458.
- **P10 — doble conteo.** Si se decide corregirlo, ficha propia de dinero.
