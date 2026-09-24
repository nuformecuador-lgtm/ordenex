# Ficha 457 — tareas

Orden: **Fase 0 → migraciones → tipos → repos/puerto → servicio → acciones → lectores → guardias
→ gate → recorrido**. `[P]` = paralelizable con sus hermanas del mismo bloque (sin archivos en
común). Un commit por tarea (`feat(457): …`, `test(457): …`). La ficha toca migraciones y
`db/schema.prisma`: **el gate es `./init.sh` COMPLETO**, no `--rapido`.

Primer paso del worktree: `git checkout --detach <SHA de dev que dé el leader>` y comprobar el
merge-base (el worktree de agente nace de `dev`, no de la rama en curso).

---

## FASE 0 — Caracterizar lo que NO puede cambiar (antes de tocar una línea)

Objetivo: dejar fijado, con tests que **se ponen rojos ante una mutación**, el comportamiento actual
de cinco piezas. Resultado a `progress/fase0_457.md`: por cada pieza, el test que la fija, la
mutación aplicada (diff de una línea), la salida ROJA con el nombre del test, y la vuelta a verde.

**Regla de la autocomprobación (el arnés de mutaciones ya mintió dos veces):** cada mutación se
aplica con Edit, se comprueba con `git diff` que el archivo cambió, se corre SOLO el test afectado,
se copia al informe el nombre del test rojo y el número de tests ejecutados (≠ 0), y se revierte con
`git checkout -- <archivo>`. Una mutación «superviviente» sin tests ejecutados no vale.
Nada de gate en paralelo con mutaciones (el gate leería el árbol mutado).

- [ ] **T0.1** [P] **Saldo derivado de la tienda.** Test dorado sobre un libro con TODAS las categorías
  actuales (`derivarSaldoTienda` y `derivarDesgloseTienda`, cabecera = saldo). Mutaciones: cambiar la
  cubeta de `cobro_manual` a `aFavor`; invertir el signo de `debito` en `derivarSaldoTienda`.
  *Hecho:* las dos mutaciones rojas y documentadas.
- [ ] **T0.2** [P] **Composición de la caja.** Test dorado sobre las 17 categorías de hoy:
  `derivarCaja` (enCaja, ganancia, deTerceros, porcentaje, modo), `derivarComposicionGanancia` y
  `derivarFinanzasDiarias`, con las cifras escritas como LITERALES (no calculadas por la misma
  función). Mutaciones: `ingreso_reverso_pago_tienda` → `propio`; `egreso_pago_tienda` → `propio`.
  *Hecho:* rojas y documentadas (R65).
- [ ] **T0.3** [P] **Pago a tienda y su anulación.** Localizar los tests vivos
  (`caja-cadena-pago-anulacion.test.ts`, `liquidacion-anulacion.test.ts`, integración
  `liquidacion-idempotencia`) y comprobar que matan: quitar `emitirEgresoDePago` de
  `registrarPagoTienda`; cambiar `ajuste_credito` por `ajuste_debito` en `escribirContraasiento`;
  quitar el `bloquearBeneficiario` de `registrarPagoTienda` (este último con el test de Postgres real;
  si ninguno lo mata, escribir uno de dos transacciones). *Hecho:* tres rojas (R63).
- [ ] **T0.4** [P] **Cobro manual (381).** `cobro-tienda-service.test.ts` + `wallet-tienda-cobro.test.ts`.
  Mutaciones: categoría `cobro_manual` → `ajuste_debito`; quitar `registrarCobroEnHistorial`.
  *Hecho:* dos rojas (R64).
- [ ] **T0.5** [P] **El dinero de los cierres.** Tests de `WalletTiendaFeedService`,
  `CajaCodFeedService` y del feed de caja del cierre. Mutaciones: `CajaCodFeedService` sin el filtro
  `tipo: "credito"`; el feed de tienda sin `cod_recaudado`. *Hecho:* rojas (R67).
- [ ] **T0.6** **Lectores de «pagado a la tienda».** Test que fije que `sumarVigentesPorTienda`,
  `listarPorTienda` y el backfill de la 173 leen SOLO `liquidacion_pago` (servirá para R68 cuando
  exista `abono_tienda`). *Hecho:* test verde hoy y rojo con una mutación del `where`.
- [ ] **T0.7** **Medición en producción** (la corre el leader con las consultas M1-M7 de
  `design.md §14`) → `progress/medicion_457.md`. *Hecho:* M3 y M4 copiados literalmente; M5 dice si el
  bucket existe; M1 confirma el saldo de Nuform. **Bloquea T1.x** (los `down.sql` dependen de M3).

*Dependencias:* T0.1-T0.6 en paralelo entre sí; T0.7 en paralelo con todas (lo hace el leader).

---

## FASE 1 — Base de datos

- [ ] **T1.1** Medir `pg_enum` y los dos CHECK en la base LOCAL (mismas consultas M3/M4) y compararlos
  con producción. *Hecho:* coinciden, o la diferencia queda escrita y explicada.
- [ ] **T1.2** Migración 1 `…_abono_tienda_enums` (+ `down.sql`) — 4 categorías + origen. *Hecho:*
  `prisma migrate deploy` local limpio; `down.sql` recrea cada enum con la lista de T1.1, con aviso
  de «foto del día», precondición ruidosa y los índices/CHECK que nombran cada tipo (molde
  `20260827120000_premio_ranking_devengo/down.sql` para `wallet_origen_tipo`).
- [ ] **T1.3** Migración 2 `…_historial_accion_abono_tienda` (+ `down.sql`). *Hecho:* idem.
- [ ] **T1.4** Migración 3 `…_abono_tienda` (+ `down.sql`): dos tablas, FKs RESTRICT, índices, CHECK
  (monto, motivo no vacío, comprobante par), RLS, y los dos CHECK tipo↔categoría ampliados.
  *Hecho:* aplicada en local; `down` primero en el rollback.
- [ ] **T1.5** `db/schema.prisma`: modelos, relaciones inversas en `Usuario`, valores de enum;
  `prisma generate`. *Hecho:* sin drift entre migraciones y datamodel (procedimiento de la 381).
- [ ] **T1.6** `tests/integration/db/abono-tienda-migration.test.ts`: listas de enum valor a valor y en
  orden contra el estado reconstruido con las migraciones reales previas; CHECK rechaza los pares
  invertidos (23514); RLS activa; la tabla tiene exactamente 2 índices únicos; rollback con un abono
  presente falla sin borrar; rollback sin abonos vuelve al estado previo. *Hecho:* verde y
  comprobado con una mutación (quitar un valor de una lista de `down`) (R69, R70).

*Dependencias:* T0.7 → T1.1 → T1.2 → T1.3 → T1.4 → T1.5 → T1.6.

---

## FASE 2 — Tipos y clasificaciones (el compilador guía)

- [ ] **T2.1** SEEDs: `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`, `WALLET_MOVIMIENTO_CATEGORIA_SEED`,
  `WALLET_ORIGEN_TIPO_SEED`, `HISTORIAL_ACCION_TIPOS`, `HISTORIAL_ACCION_ENTIDADES`. *Hecho:* typecheck
  rojo exactamente en los `Record` de `design.md §4`.
- [ ] **T2.2** [P] `CUBETA_POR_CATEGORIA`, `NATURALEZA_POR_CATEGORIA`, `FUENTE_CAJA`, `FUENTE_TIENDA`
  según la tabla de `design.md §4`. *Hecho:* typecheck verde en `lib/`; `caja-composicion-exhaustiva`
  y `desglose-tienda.test.ts` verdes con casos nuevos (R18, R36, R52).
- [ ] **T2.3** [P] Rótulos: `CATEGORIA_LABEL`, `ORIGEN_LABEL`, `CATEGORIA_TIENDA_LABEL`,
  **`ORIGEN_TIENDA_LABEL`** (no lo exige el compilador), hints y avisos de las dos cabeceras,
  `ACCION_LABELS`, `CATEGORIA_POR_ACCION`, `ENTIDAD_LABELS`, constructor de etiqueta `abono_tienda`.
  *Hecho:* tests de labels con los textos LITERALES de `design.md §4/§8`; test que recorre
  `WALLET_ORIGEN_TIPO_SEED` y exige clave en `ORIGEN_TIENDA_LABEL` para todo origen que pueda
  escribirse en el libro de tienda (R46-R53, R59).
- [ ] **T2.4** [P] `lib/analytics/metrics.ts`: `dinero_en_caja` y `cuenta_por_pagar_tienda` +2 cada
  una. *Hecho:* `metrics-caja-naturaleza.guardia.test.ts` verde; si exige tocar `egresos`, parar y
  consultar (R55).
- [ ] **T2.5** Schemas zod del borde (`lib/types/abono-tienda.ts`) y DTOs de `design.md §7`,
  reutilizando `montoLiquidacionSchema`, `fechaPagoSchema`, `exigirReferenciaEnPagoElectronico` y
  `LIQUIDACION_REFERENCIA_MAX`; `.strict()` en todos. *Hecho:*
  `tests/unit/types/abono-tienda-schema.test.ts` (R4-R9, R12, R31, R32, R40).

*Dependencias:* T1.5 → T2.1 → {T2.2, T2.3, T2.4} → T2.5.

---

## FASE 3 — Repositorio, puerto, comprobante

- [ ] **T3.1** [P] `IAbonoTiendaRepository` + `AbonoTiendaRepository`: `crear` (documento +
  `abono_tienda_registrado`), `anular` (fila + `abono_tienda_anulado`), `obtenerPorClave`,
  `obtenerPorId`, `listarPorTienda` (anulados incluidos, orden `fecha_pago desc, created_at desc`).
  P2002 → resultado, no excepción. *Hecho:* integración en Postgres real que mata una mutación del
  `WHERE tienda_id` de `listarPorTienda` (R38, R39, R44) y censo de historial actualizado (R56-R58).
- [ ] **T3.2** [P] `ICajaAbonoTiendaFeedService` + `CajaAbonoTiendaFeedService` (literales dentro).
  *Hecho:* test que afirma la lista EXACTA de categorías que nombra (`ingreso_abono_tienda`,
  `egreso_reverso_abono_tienda`) y que usa `origenTipo: "abono_tienda"`.
- [ ] **T3.3** [P] Comprobante: `lib/config/wallet-comprobante.ts` (bucket, MIME, 4 MB, TTL por env),
  entrada en `BUCKETS`, validación pura compartida borde/servicio, ruta aleatoria.
  *Hecho:* `abono-tienda-comprobante.test.ts` parcial (R23, R24).
- [ ] **T3.4** [P] `lib/utils/descripcion-abono.ts` (libro, caja, anulación). *Hecho:*
  `descripcion-abono.test.ts`: con/sin referencia, nombre de tienda en caja, sin uuid (regex) (R20).

*Dependencias:* T2.5 → {T3.1, T3.2, T3.3, T3.4}.

---

## FASE 4 — Servicio

- [ ] **T4.1** `AbonoTiendaService.registrar` en el orden de `design.md §5.1`. *Hecho:*
  `abono-tienda-service.test.ts`: rol antes de leer; tienda inexistente/no tienda; tienda inactiva
  admitida; `sin_deuda`; `excede` con la deuda; candado ANTES de leer el saldo (orden de llamadas);
  las 4 escrituras con el mismo `montoStr`; `ya_registrado`; saldo resultante; compensación del
  archivo en cada desenlace no-ok (R2, R10, R11, R13-R17, R22, R25-R27, R61).
- [ ] **T4.2** `AbonoTiendaService.anular`. *Hecho:* `abono-tienda-anulacion.test.ts`: monto del
  documento, fecha del día CR (reloj inyectado), débito `abono_tienda_anulado` + egreso de terceros,
  `ya_anulado`, `no_encontrado`, `forbidden` antes de leer, comprobante intacto (R28-R36).
- [ ] **T4.3** `AbonoTiendaService.listar*` y `obtenerComprobante`. *Hecho:* alcance por rol; tienda
  ajena = inexistente; `sin_comprobante` (R38-R45).

*Dependencias:* Fase 3 → T4.1 → T4.2; T4.3 [P] con T4.2.

---

## FASE 5 — Server Actions (`lib/actions/abono-tienda.ts`)

- [ ] **T5.1** Las cinco acciones de `design.md §7`, con `buildService()` que inyecta el puerto de caja
  REAL y el storage del bucket nuevo. *Hecho:* `abono-tienda-action.test.ts` (sesión, validación,
  lectura del `File` del `FormData`, lista EXACTA de exportaciones = R37) y
  `tests/integration/db/abono-tienda.test.ts` que pasa POR LA ACCIÓN y encuentra en Postgres las
  filas de documento, libro de tienda, caja e historial (R1, R16-R21; el composition root que no
  inyecta).
- [ ] **T5.2** Concurrencia: `abono-tienda-concurrencia.test.ts` con dos transacciones reales
  (abono ∥ abono sobre la misma deuda: la segunda ve el saldo nuevo; abono ∥ pago a tienda:
  serializan). *Hecho:* verde y rojo si se quita el candado (R15, R35).

*Dependencias:* Fase 4 → T5.1 → T5.2.

---

## FASE 6 — Lo que D3 protegía y el historial

- [ ] **T6.1** Reescribir `catalogo-y-choke-point.test.ts:379-381` según `design.md §10` (comentario
  de la reapertura, `toContain`) y actualizar los conteos duros (33→35 dinero, 21→22 entidades).
  *Hecho:* verde; con el tipo quitado del catálogo, rojo.
- [ ] **T6.2** `tests/unit/guards/abono-tienda-alcance.guardia.test.ts`: censo de productores de
  créditos del libro de tienda, puerto de caja obligatorio y llamado en el mismo método, diálogo sin
  destino que acredite a una tienda. *Hecho:* tres mutaciones rojas (añadir un `categoria:
  "abono_tienda"` en otro servicio; quitar la llamada a la caja; añadir un concepto al diálogo)
  (R60, R62).
- [ ] **T6.3** Integración: Σ `abono_tienda` del libro = Σ `ingreso_abono_tienda` de la caja por
  `origen_id`, tras registrar y tras anular (Σ anulado = Σ reverso). *Hecho:* verde; comprueba que
  hay filas (nada de `if (!filas) return`) (R60).
- [ ] **T6.4** No regresión R68: con un abono presente, `sumarVigentesPorTienda`, `listarPagosDeTienda`
  y el backfill de la 173 no lo ven. *Hecho:* verde sobre Postgres real.

*Dependencias:* Fase 5 → {T6.1, T6.2, T6.3, T6.4} [P].

---

## FASE 7 — Cierre

- [ ] **T7.1** Repetir la Fase 0 con el árbol final: las mismas mutaciones siguen rojas y los tests
  dorados siguen verdes SIN cambiar sus literales (R63-R67). *Hecho:* anexo en `progress/fase0_457.md`.
- [ ] **T7.2** `./init.sh` COMPLETO con `INIT_EXIT=$?` escrito dentro del log, sin `tail`, y
  revisando los `skipped` (sin `.env` se salta `integration/db`). *Hecho:* verde y 0 archivos de
  integración saltados.
- [ ] **T7.3** `progress/impl_457.md` con la tabla R→test de `design.md §15` y rutas finales.
- [ ] **T7.4** Recorrido por rol (guion de abajo) en local con Playwright o a mano, con capturas y
  cifras en `progress/recorrido_457.md`. *Hecho:* cada paso con su resultado esperado comprobado.
- [ ] **T7.5** Operaciones (fuera del código, antes de desplegar): crear el bucket privado
  `wallet-comprobantes` en producción y en preview (Q5), y declarar que esta ficha NO sale a `prod`
  sin la pantalla de la 458 (Q1). *Hecho:* anotado en la ficha y en `progress/current.md`.

---

## Guion de recorrido por rol (T7.4)

Preparación local: `prisma migrate deploy`; una tienda de prueba con saldo en contra (un cobro
manual de 10.000,00 desde «Registrar movimiento» la deja en -10.000,00). Como aún no hay pantalla de
registro (Q1), el registro se hace con un script de un solo uso en el scratchpad que llama a la
Server Action con la sesión de un maestro (no se commitea), o —si ya existe— con la pantalla de la
458. Un solo dev server (no levantar otro si un agente tiene el suyo).

**Maestro**
1. Registrar un pago recibido de 4.000,00, SINPE, referencia «123456», motivo «Abono a fletes de
   septiembre», fecha de ayer, con un PDF de comprobante. → `ok`, saldo -6.000,00.
2. `/wallet`: fila «Pago recibido de tienda», dueño «Tienda», origen «Pago de tienda · <Tienda> ·
   Abono a fletes de septiembre · SINPE · 123456», fecha de ayer. «Ganancia de Ordenex» igual que
   antes del paso 1; «Dinero en caja» y «De las tiendas» +4.000,00. Filtro por concepto ofrece
   «Pago recibido de tienda». Descarga: mismos textos, sin uuids.
3. `/wallet/tiendas` → desglose de la tienda: fila «Pago de la tienda a Ordenex», «A favor» +4.000,00,
   saldo -6.000,00 = saldo de la tabla. La fila no se despliega. Descarga sin uuids.
4. Repetir el paso 1 con la MISMA clave → `ya_registrado`, sin filas nuevas, el PDF duplicado no queda
   en el bucket.
5. Intentar 7.000,00 → `excede`, deuda 6.000,00. Registrar 6.000,00 → saldo 0,00. Intentar otro →
   `sin_deuda`.
6. `/historial-de-acciones`: dos filas «Registró un pago recibido de una tienda», con el nombre de la
   tienda y el importe, SIN el motivo; filtro por ese tipo funciona.
7. Anular el de 4.000,00 con motivo «Referencia equivocada». → saldo -4.000,00; en `/wallet` aparece
   «Pago recibido de tienda anulado» (egreso, dueño Tienda) fechado HOY; ganancia sin cambio; en el
   desglose «Pago de la tienda anulado» en «Cargos». Segundo intento → `ya_anulado`.

**Admin** — repetir 1, 2 y 7 sobre otra tienda: mismas respuestas (paridad maestro/admin).

**adminTienda (la tienda del recorrido)**
8. `/mi-wallet`: ve «Pago de la tienda a Ordenex» con su motivo y método, y «Pago de la tienda
   anulado»; las aclaraciones de «A tu favor» y «Cargos de Ordenex» nombran los pagos y sus
   anulaciones; el saldo cuadra con el de `/wallet/tiendas`. Descarga sin uuids.
9. Lista de sus pagos recibidos y enlace del comprobante: abre el PDF (enlace temporal). Pedir el
   comprobante de un pago de OTRA tienda → «no encontrado». Pedir su lista con un `tiendaId` →
   `validation_error`. Intentar registrar o anular → `forbidden`.

**Mensajero** — cualquiera de las cinco acciones → `forbidden`.
