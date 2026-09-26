# Ficha 457 — tareas

> **Reescrito el 2026-09-25.** Orden: **Fase 0 → 1 (base) → 2 (tipos y clasificación) → 3 (repo, puerto,
> descripciones, comprobante) → 4 (servicio) → 5 (actions) → 6 (UI) → 7 (ayuda y asistente) → 8 (guardias e
> historial) → 9 (cierre)**. `[P]` = paralelizable con sus hermanas del mismo bloque (sin archivos en común).
> Un commit por tarea (`feat(457): …`, `test(457): …`, `docs(457): …`); verificar el blob commiteado antes
> de dar un bloque por cerrado. Implementan `backend_dev` (0–5, 8) y `frontend_dev` (6, 7), en ese orden.

> **Cierre (2026-09-26, tras la revisión `progress/review_457.md`):** cada tarea hecha lleva `[x]` y su
> evidencia (SHA, test o log). **B2 de la revisión (R79):** el recorrido por rol entró con el merge de
> `origin/feature/457-recorrido` (`b1272ce2`): [`progress/recorrido_457.md`](../../progress/recorrido_457.md)
> y sus capturas en `progress/recorrido_457/`; su único FALLO (F1, la M8 de producción) se arregló en
> `e4c191fb`. Quedan abiertas SOLO T9.5 y T9.6, del leader y posteriores al despliegue.

## Reglas para todas las tareas

- **Punto de partida:** `dev` CON la 461 mergeada. Primer paso del worktree: `git checkout --detach <SHA
  de dev que dé el leader>` y comprobar el merge-base (el worktree de agente nace de `dev`, no de la rama
  en curso). Si la 461 no está en `dev`, se para: escribir esta ficha sobre `dev` sin la 461 deja dos CHECK
  y dos `down` que se pisan.
- **Gate:** la ficha toca migraciones, `db/schema.prisma` y `lib/types/`: **`./init.sh` COMPLETO**, con
  `INIT_EXIT=$?` escrito dentro del log, sin `tail` en tubería, mirando que `tests/integration/db` no tenga
  archivos saltados (sin `.env` se saltan y el gate dice «OK»). **Gate y mutaciones nunca a la vez.**
- **Base propia:** clon `CREATE DATABASE ordenex_457 TEMPLATE ordenex` + `prisma migrate deploy`; `.env`
  del worktree apuntando al clon (copiado sin imprimirlo; borrado al terminar).
- **La fotografía** (`caja-caracterizacion-459.test.ts`) corre verde al empezar y al terminar cada bloque
  **sin tocar sus literales**. Si hiciera falta cambiar uno, se para y se pregunta: es dinero.
- **Test que se reescribe:** se lista en `progress/impl_457.md` con el requisito que lo sustituye (los de
  `design.md` §12). Ninguno desaparece sin reemplazo.
- **Migraciones a mano** (P3006); ninguna aplicada se edita; timestamps posteriores al último de
  `origin/dev` el día de escribirlas. **No escribir `feature_list.json`** desde el worktree. **No commitear**
  el informe sin pedirlo.

---

## FASE 0 — Caracterizar lo que NO puede cambiar (sin código de producción) · `backend_dev`

- [x] **T0.1** Correr `tests/integration/db/caja-caracterizacion-459.test.ts` y
  `caja-invariante-tiendas.test.ts` sobre el SHA de partida: verdes, `skipped = 0`. Anotar en
  `progress/fase0_457.md` los literales de HOY (cifra, entradas, salidas, ganancia, `deTerceros`, capital,
  saldos y desgloses de las tiendas del escenario, filas por libro) y el SHA. *Hecho:* la nota existe. (R77)
  *Evidencia:* `0d0c6ac1` — `progress/fase0_457.md` §T0.1 (26/26 verdes sobre `c9c4b005`, literales anotados).
- [x] **T0.2** Mutaciones de control (a)–(e) de `design.md` §13 con autocomprobación (diff de UNA línea,
  `git diff` ≠ 0, solo los tests nombrados, rojo con el nombre del caso y número de tests ≠ 0, `git
  checkout`, `git diff --stat` vacío). *Hecho:* informe en `progress/fase0_457.md`; ninguna superviviente
  sin explicar. (R70–R73, R77)
  *Evidencia:* `0d0c6ac1` — `progress/fase0_457.md` §T0.2: (a)–(d) rojas; (e) superviviente EXPLICADA (equivalente medido por la 459; el candado de la 457 lo mata la mutación 5).
- [x] **T0.3** [P] **(LEADER, no el agente)** Medición en producción por el MCP de Supabase, solo lectura:
  M1–M8 de `design.md` §14 → `progress/contraste_457.md` (ANTES). *Hecho:* M3 y M4 copiados literalmente
  (deciden las listas de T1.2/T1.3); M5 dice si el bucket existe; M1 confirma el saldo de Nuform; M8 con
  `diferencia_r7 = diferencia_r8 = 0,00`. **Bloquea T1.x.** (R78)
  *Evidencia:* `07301f36` (leader) — `progress/contraste_457.md` «ANTES»: M1, M2, M5, M6 y M7 de producción. M3/M4 salieron de `dev` (producción aún sin 459/461) y M8 se corre tras desplegar con la C457-1 (`e4c191fb`, sección «SQL M8 para después del despliegue»).
- [x] **T0.4** Medir en la base LOCAL (clon) M3 y M4 y compararlos con producción y con `design.md` §3.3.
  *Hecho:* coinciden con las listas de la 461, o la diferencia queda escrita y explicada. (R75)
  *Evidencia:* `0d0c6ac1` — `progress/fase0_457.md` §T0.4: 23/14/13/61/23 y los dos CHECK = listas de §3.3.

*Dependencias:* T0.1 → T0.2; T0.3 (leader) en paralelo; T0.4 tras T0.3.

---

## FASE 1 — Base de datos · `backend_dev`

- [x] **T1.1** Mirar `origin/dev` y fijar los dos timestamps (posteriores al último). *Hecho:* anotados en
  `progress/impl_457.md`.
  *Evidencia:* `ae87cb46` — `progress/impl_457.md` §2 (`20260927120000`, `20260927120100`, tras `20260926120500`).
- [x] **T1.2** Migración 1 `…_abono_tienda_457_enums` (+ `down.sql`): ocho `ADD VALUE IF NOT EXISTS` sobre
  los cinco tipos; `down` = `pg_temp.quitar_valores_de_enum_457` (la función de
  `20260926120000_cobro_tienda_461_enums/down.sql:39-150` copiada byte a byte salvo el sufijo), aplicada a
  los cinco tipos. *Hecho:* `prisma migrate deploy` y `db:rollback` locales limpios; con una fila que use
  un valor nuevo, el rollback falla sin borrar. (R75)
  *Evidencia:* `ae87cb46` — `progress/impl_457.md` §2, ciclo real up→down→up; `abono-tienda-457-migration.test.ts` (e).
- [x] **T1.3** Migración 2 `…_abono_tienda_457_tablas_y_checks` (+ `down.sql`): `abono_tienda`,
  `abono_tienda_anulacion` (DDL de `prisma migrate diff`), índices, FKs RESTRICT, CHECK del documento (monto
  > 0, motivo no vacío, par del comprobante), RLS, los dos CHECK tipo↔categoría AMPLIADOS (`design.md` §3.3,
  partiendo de lo medido en T0.4); `down` con RAISE si hay filas, CHECK a las listas de la 461, `DROP
  TABLE`. *Hecho:* aplicada en local; up→down→up limpio. Depende de T1.2. (R75, R76)
  *Evidencia:* `ae87cb46` — `progress/impl_457.md` §2 (md5 de los CHECK idénticos tras volver a subir); test (b)/(c)/(d)/(f).
- [x] **T1.4** `db/schema.prisma`: enums, modelos `AbonoTienda`/`AbonoTiendaAnulacion`, relaciones e
  inversas en `Usuario`; `prisma generate`. *Hecho:* sin drift (procedimiento de la 381).
  *Evidencia:* `ae87cb46` — `db/schema.prisma`; `prisma migrate deploy` en cada clon («All migrations have been successfully applied»).
- [x] **T1.5** `tests/integration/db/abono-tienda-457-migration.test.ts` (molde `cobro-tienda-461-migration`):
  enums valor a valor contra el estado previo reconstruido; CHECK rechazan los pares invertidos (23514);
  RLS activa en las dos tablas; exactamente dos índices únicos en `abono_tienda`; la función del `down` es
  la de la 461 salvo sufijo; `down` con un abono presente falla sin borrar; sin abonos vuelve al estado
  previo; `TIPO_POR_CATEGORIA_TIENDA` coincide con el CHECK. *Hecho:* verde y rojo con una mutación
  (mutación 14 de §13). (R75, R76)
  *Evidencia:* `ae87cb46`/`eb36c2dc` — `tests/integration/db/abono-tienda-457-migration.test.ts` (a)–(f); mutación 14 roja (anexo T9.1 de `progress/fase0_457.md`).
- [x] **T1.6** Censos de migraciones POSTERIORES (`grep 20260926120500 tests/`): +2 carpetas;
  `caja-tesoreria-migration` 23→25. *Hecho:* todos verdes.
  *Evidencia:* `4f47226c`/`8bcab3ab` — `progress/impl_457.md` §8 (censos POSTERIORES) y §9 (los dos censos de origen que faltaban).

*Dependencias:* T0.3/T0.4 → T1.1 → T1.2 → T1.3 → T1.4 → T1.5 → T1.6.

---

## FASE 2 — Tipos y clasificación (el compilador guía) · `backend_dev`

- [x] **T2.1** SEEDs: `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED`, `WALLET_MOVIMIENTO_CATEGORIA_SEED`,
  `WALLET_ORIGEN_TIPO_SEED`, `DocumentoCajaDTO.tipo`, `HISTORIAL_ACCION_TIPOS`, `HISTORIAL_ACCION_ENTIDADES`
  (+ `CATEGORIA_POR_ACCION`, `ACCION_LABELS`, `ENTIDAD_LABELS`, etiqueta de entidad). *Hecho:* typecheck
  rojo exactamente en los `Record` totales de `design.md` §4.2, que las tareas siguientes ponen en verde.
  *Evidencia:* `4f47226c` — SEEDs y `Record` totales; typecheck verde en los gates (`progress/gate_457_backend.log`).
- [x] **T2.2** [P] `NATURALEZA_POR_CATEGORIA` (+2 `terceros`), `LIQUIDEZ_POR_CATEGORIA` (+2 `efectivo`),
  `TIPO_POR_CATEGORIA_TIENDA`, `CONTRAPARTIDA_EN_CAJA` (las dos parejas), `CUBETA_POR_CATEGORIA`
  (`aFavor`/`cargos`), `FUENTE_CAJA`, `FUENTE_TIENDA`. *Hecho:* `tests/unit/utils/caja-derivacion-457.test.ts`
  verde (±M en Entró/Salió/cifra/terceros; ganancia y capital fijos; identidad R7 sobre 500 subconjuntos
  con semilla fija); `caja-clasificacion-459.guardia` verde con sus literales intactos y +2 contrapruebas;
  `desglose-tienda.test.ts`, `aporte-por-orden.test.ts`, `caja-tesoreria.test.ts`, `finanzas-diario.test.ts`
  (+1 caso) verdes. Mutaciones 2, 3 y 4 de §13 → rojo. (R19, R24, R39, R49)
  *Evidencia:* `4f47226c` — `caja-derivacion-457.test.ts`, `caja-clasificacion-459.guardia` (+3 contrapruebas); mutaciones 2, 3 y 4 rojas (anexo T9.1).
- [x] **T2.3** [P] `lib/analytics/metrics.ts`: `dinero_en_caja` (+2, descripción), `cuenta_por_pagar_tienda`
  (+2); `ganancia_ordenex` y `egresos` NO. *Hecho:* `metrics-caja-naturaleza.guardia` con 7/25/9 y
  `ganancia_ordenex` en 16, `egresos` en 10. (R52)
  *Evidencia:* `4f47226c` + `99fb7610` (m1: `tests/unit/analytics/metrics-cuenta-por-pagar-tienda-457.test.ts`, mutación H roja).
- [x] **T2.4** [P] `lib/utils/comprobante.ts`: `PREFIJO_COMPROBANTE.abono_tienda = "abonos-tienda"`.
  *Hecho:* test de `rutaDeComprobante("abono_tienda", …)` con la carpeta y sin ids. (R27)
  *Evidencia:* `eb36c2dc` — `tests/unit/services/caja-abono-tienda-feed.test.ts` «T2.4» (`rutaDeComprobante("abono_tienda", …)`: carpeta y sin ids).
- [x] **T2.5** `lib/types/abono-tienda.ts`: schemas de `design.md` §7 (`.strict()`, referencia en
  SINPE/transferencia, `claveIdempotenciaSchema`, `fechaPagoSchema`, `comprobanteSchema` reutilizado),
  DTO y resultados. *Hecho:* `tests/unit/types/abono-tienda-schema.test.ts` (R4–R9, R12, R13, R34, R35).
  *Evidencia:* `4f47226c` — `tests/unit/types/abono-tienda-schema.test.ts`.

*Dependencias:* T1.4 → T2.1 → {T2.2, T2.3, T2.4} → T2.5.

---

## FASE 3 — Repositorio, puerto, descripciones · `backend_dev`

- [x] **T3.1** [P] `IAbonoTiendaRepository` + `AbonoTiendaRepository` (`crear` con historial
  `abono_tienda_registrado`, `anular` con `abono_tienda_anulado`, `obtenerPorClave`, `obtenerPorId`,
  `estadoDeDocumentos`); P2002 → resultado. *Hecho:* integración en Postgres real que mata una mutación
  del `WHERE` de `obtenerPorId`; guardia del censo del historial con las dos entradas `recibe_tx`. (R61–R63)
  *Evidencia:* `4f47226c`/`eb36c2dc` — `tests/integration/db/abono-tienda-457-repositorio.test.ts` (dos tiendas: mata un `WHERE` que no filtre); guardia del historial +2 `recibe_tx`.
- [x] **T3.2** [P] `ICajaAbonoTiendaFeedService` + `CajaAbonoTiendaFeedService` (literales dentro; molde
  `CajaPagoPorCuentaFeedService`). *Hecho:* test de lista EXACTA de categorías (`ingreso_abono_tienda`,
  `egreso_reverso_abono_tienda`) y origen `abono_tienda`; las guardias de la 173 sobre
  `CajaPagoTiendaFeedService` intactas. (R17, R31)
  *Evidencia:* `eb36c2dc` — `tests/unit/services/caja-abono-tienda-feed.test.ts` (lista cerrada).
- [x] **T3.3** [P] `lib/utils/descripcion-abono.ts` (tienda, caja, anulación). *Hecho:*
  `descripcion-abono.test.ts`: con/sin referencia, nombre de tienda en caja, prefijo de anulación, sin
  forma de uuid. (R21)
  *Evidencia:* `4f47226c` — `tests/unit/utils/descripcion-abono.test.ts`.

*Dependencias:* T2.5 → {T3.1, T3.2, T3.3}.

---

## FASE 4 — Servicio · `backend_dev`

- [x] **T4.1** `AbonoTiendaService.registrar` en el orden de `design.md` §5.1 (fechas de §5.1.6). *Hecho:*
  `tests/unit/services/abono-tienda-service.test.ts`: rol antes de leer; tienda inexistente/no tienda; tienda
  inactiva admitida; `sin_deuda`; `excede` con la deuda; candado ANTES de leer el saldo (orden de llamadas);
  las cuatro escrituras con el MISMO `montoStr` y el MISMO instante (inicio del día CR de `fechaPago`);
  `ya_registrado` con el saldo de la tienda del original; compensación del archivo en cada desenlace no-ok.
  Mutaciones 1, 5 (unitaria: orden) y 6 → rojo. (R2, R10, R11, R14–R18, R20, R25, R28–R30, R66)
  *Evidencia:* `4f47226c` + `6fe2acd0` (R25: la clave antes de la regla, design §5.1 actualizado en `fe368180`) + `e1084535` (m3: el saldo bajo el candado por el `tx`) — `abono-tienda-service.test.ts`; mutaciones 1, 5 y 6 rojas (anexo T9.1).
- [x] **T4.2** `AbonoTiendaService.anular`. *Hecho:* `abono-tienda-anulacion.test.ts`: monto del documento
  (la petición trae `monto: "1.00"` y se ignora); instante = inicio del día CR de la anulación (reloj
  inyectado) para los dos contra-asientos; débito `abono_tienda_anulado` + egreso terceros; `ya_anulado`;
  `no_encontrado`; `forbidden` antes de leer; comprobante intacto. Mutaciones 7 y 8 → rojo. (R31–R40)
  *Evidencia:* `4f47226c` — `abono-tienda-anulacion.test.ts`; mutaciones 7 y 8 rojas; el candado de la anulación contra Postgres real en `062f26c7` (m2).
- [x] **T4.3** [P] `AbonoTiendaService.obtenerComprobante`. *Hecho:* `abono-tienda-comprobante.test.ts`:
  acceso total; tienda dueña; tienda ajena = inexistente; `sin_comprobante`; TTL de la config; formatos y
  tamaño del comprobante compartido. (R26, R42–R44)
  *Evidencia:* `4f47226c` — `abono-tienda-comprobante.test.ts`.

*Dependencias:* Fase 3 → T4.1 → T4.2; T4.3 [P] con T4.2.

---

## FASE 5 — Server Actions e integración · `backend_dev`

- [x] **T5.1** `lib/actions/abono-tienda.ts`: las tres acciones de `design.md` §7 con `buildService()` que
  inyecta el puerto de caja REAL, `LiquidacionPagoRepository` (candado), storage y URL firmada del bucket
  compartido. *Hecho:* `tests/unit/actions/abono-tienda-action.test.ts` (sesión antes del schema; validación;
  lectura del `File` del `FormData`; lista EXACTA de exportaciones = tres, R40) y
  `tests/integration/db/abono-tienda-457.test.ts` que pasa POR LA ACTION y encuentra en Postgres el
  documento, el crédito, el ingreso y el historial con el mismo string y el mismo instante; tras anular, la
  constancia, el débito, el egreso y su historial; R19/R39 medidos con `derivarCaja` sobre filas reales; R22
  (cero filas ajenas); R74 (`sumarVigentesPorTienda`, `listarPagosDeTienda`, el backfill de la 173 y las
  consultas de las migraciones de datos de la 459/461 no lo ven). (R1, R17–R23, R31, R74)
  *Evidencia:* `4f47226c`/`eb36c2dc` + `d325ec44` (m5: R74 ejecuta el backfill de la 173 en seco) — `abono-tienda-action.test.ts`, `abono-tienda-457.test.ts`.
- [x] **T5.2** [P] `tests/integration/db/abono-tienda-457-concurrencia.test.ts`: abono ∥ abono sobre la misma
  deuda (la segunda ve el saldo nuevo → `excede`/`sin_deuda`); abono ∥ pago a tienda y abono ∥ pago de un
  gasto (serializan por la misma fila); dos anulaciones → una. *Hecho:* verde y rojo sin el candado
  (mutación 5). (R16, R36, R38)
  *Evidencia:* `eb36c2dc` + `062f26c7` (m2) + `e1084535` (m3, pool de una conexión) — `abono-tienda-457-concurrencia.test.ts`; mutación 5 roja.
- [x] **T5.3** `WalletService`: `tipoDeDocumentoOriginal` con la rama del abono; `LectoresDocumentosCaja.abonos`;
  composition root en `lib/actions/wallet.ts` inyecta `AbonoTiendaRepository`. *Hecho:* `wallet-service.test.ts`
  (+ dobles de los 8 archivos con `LectoresDocumentosCaja`); integración por `listarMovimientosAction`:
  `documento.tipo === "abono_tienda"` en la original, `null` en el reverso. Mutación 10 → rojo. (R41)
  *Evidencia:* `4f47226c` — `wallet-service.test.ts`, integración «R41»; mutación 10 roja.
- [x] **T5.4** `caja-invariante-tiendas.test.ts`: +2 pasos («la tienda B le paga a Ordenex» sobre saldo en
  contra sembrado con un cobro; «su anulación»), R7 y R8 al céntimo tras cada paso, comprueba que hay filas.
  *Hecho:* verde; mutación 1 → rojo. (R23)
  *Evidencia:* `c88c4eb9` — `caja-invariante-tiendas.test.ts` +3 pasos; mutación 1 roja.
- [x] **T5.5** Fotografía verde sin tocar literales; typecheck y lint verdes; gate completo; revisión
  backend. *Hecho:* `INIT_EXIT=0`; `progress/impl_457.md` con la tabla R→test del backend y la lista de
  tests reescritos.
  *Evidencia:* `7ecdeb89` — `progress/gate_457_backend.log` (`INIT_EXIT=0`, 0 saltados en `integration/db`); `progress/impl_457.md` §6/§8.

*Dependencias:* Fase 4 → T5.1 → {T5.2, T5.3} → T5.4 → T5.5.

---

## FASE 6 — La UI mínima · `frontend_dev` (depende de la Fase 5)

- [x] **T6.1** Rótulos: `CATEGORIA_LABEL` (+2), `ORIGEN_LABEL` (+1), `DOCUMENTO_CAJA_NOMBRE` (+1),
  `CATEGORIA_TIENDA_LABEL` (+2), `CATEGORIA_MI_WALLET_LABEL` (+2), **`ORIGEN_TIENDA_LABEL` (+1: no lo exige
  el compilador)**, pistas de las dos cabeceras (`design.md` §2). *Hecho:* `wallet-labels.test.ts`,
  `desglose-tienda-labels.test.ts`, `mi-wallet-labels.test.ts` (dos diccionarios distintos en los dos
  conceptos; `ESCRIBEN_EN_LA_TIENDA` + `abono_tienda`), descargas de los tres libros con los literales
  nuevos y sin uuids. Mutación 11 → rojo. (R45–R48, R50)
  *Evidencia:* `efe15944`/`72d02fb3` — `wallet-labels`, `desglose-tienda-labels`, `mi-wallet-labels`, `DesgloseTiendaAbono457.test.tsx`; mutación 11 roja.
- [x] **T6.2** `nombres-wallet-461.guardia.test.ts`: reservados → `NOMBRES_TOMADOS_457` con el caso «cada
  uno es el valor de exactamente su clave»; contrapruebas con un reservado ficticio; retirados intactos.
  *Hecho:* verde; con un tomado en otra clave → rojo. (R53)
  *Evidencia:* `efe15944` — `nombres-wallet-461.guardia.test.ts` («457/R53»).
- [x] **T6.3** `wallet-conceptos-manuales.ts`: octavo concepto (`design.md` §8.1/§8.2), rama de destino,
  `libroDelConcepto`, `nombreEnElLibroDeLaTienda`, `cabeceraDelConcepto`, `FRASE_DEL_EFECTO`. *Hecho:*
  `wallet-conceptos-manuales.test.ts` (ocho nombres, tres grupos, `entra` con tres, frase y cabecera
  literales; el gasto fijo sigue fuera). (R54, R55, R67)
  *Evidencia:* `efe15944` — `wallet-conceptos-manuales.test.ts` («⭑ FICHA 457»).
- [x] **T6.4** `RegistrarMovimientoCajaDialog.tsx`: `esAbono`, `pideMetodo`, campos, fecha sin ventana,
  `formDataAbono()`, respuestas (`sin_deuda`/`excede` bajo su campo con el importe del servidor;
  `ya_registrado` como éxito; `comprobante_no_guardado`), textos `TEXTO_ABONO`, props `conceptoInicial`,
  `tiendaFija`, `etiquetaBoton`. Medir si `listarSaldosTiendas` incluye tiendas inactivas (L2) y anotarlo.
  *Hecho:* `wallet-registrar-movimiento-dialog.test.tsx`: payload exacto del abono; los otros seis payloads
  byte a byte; con `tiendaFija` el selector queda deshabilitado y no se pide el catálogo; un solo toast en
  `ya_registrado`. Mutación 9 → rojo. Depende de T6.3. (R56–R58)
  *Evidencia:* `efe15944` + `edea9870` (m7: `ya_registrado` dice el importe) — `wallet-registrar-movimiento-dialog.test.tsx`; mutación 9 roja; L2 medido en `progress/impl_457.md` §11.2.
- [x] **T6.5** [P] `DocumentoCajaAcciones.tsx`: rama `abono_tienda` (anular + comprobante). *Hecho:*
  `tests/components/WalletLedgerAcciones457.test.tsx`: «Anular…» y «Ver comprobante» solo en la original
  vigente; «Anulado»; nada en el reverso; `anularAbonoTiendaAction({ abonoId, motivo })` SIN monto; rótulos
  y dueño literales en tabla y descarga; refresco tras anular. Depende de T6.1. (R41, R48, R60)
  *Evidencia:* `72d02fb3` — `tests/components/WalletLedgerAcciones457.test.tsx`.
- [x] **T6.6** `PagoTiendaAcciones.tsx`: botón «Registrar pago de la tienda a Ordenex» solo con
  `signo === "negativo"`, que monta el diálogo con `conceptoInicial`/`tiendaFija` y `onRegistrado =
  refrescarEstaTienda`. *Hecho:* `tests/components/PagoTiendaAccionesAbono457.test.tsx` (sin botón con
  saldo cero o a favor; props; tras registrar se releen desglose, comprobantes y tabla de saldos);
  `wallet-tiendas-pago.test.tsx` intacto. Mutación 13 → rojo. Depende de T6.4. (R59)
  *Evidencia:* `efe15944`/`72d02fb3` — `tests/components/PagoTiendaAccionesAbono457.test.tsx`; `wallet-tiendas-pago.test.tsx` intacto; mutación 13 roja.
- [x] **T6.7** [P] Historial: la pantalla filtra y muestra los dos tipos. *Hecho:*
  `tests/components/HistorialAccionesAbonoTienda457.test.tsx`. (R64)
  *Evidencia:* `72d02fb3` — `tests/components/HistorialAccionesAbonoTienda457.test.tsx`.
- [x] **T6.8** Fotografía verde, gate completo, revisión frontend. *Hecho:* `INIT_EXIT=0`;
  `progress/impl_457_frontend.md` con la tabla R→test y la lista de tests reescritos.
  *Evidencia:* `0ab05a1d` — `progress/gate_457_frontend.log` (`INIT_EXIT=0`); la tabla R→test de la UI vive en `progress/impl_457.md` §11 (no en un `impl_457_frontend.md` aparte).

*Dependencias:* T6.1 → T6.2 ; T6.3 → T6.4 → T6.6 ; T6.5 [P] tras T6.1 ; T6.7 [P] ; → T6.8.

---

## FASE 7 — La ayuda y el asistente · `frontend_dev` (depende de la Fase 6)

- [x] **T7.1** `docs/ayuda/oficina/wallet-caja.md`, `oficina/wallet-tiendas.md`, `tienda/mi-wallet.md`
  según `design.md` §11 (frases literales, frontmatter `actualizado` y `fuentes`). *Hecho:*
  `tests/unit/asistente/contexto-457.test.ts` verde por rol (maestro/admin: caja y tiendas; adminTienda:
  mi wallet; mensajero/adminSatelite/adminTienda: sin la caja); `contexto-461.test.ts:78` reescrito (el
  grupo con tres conceptos), listado; `nombres-wallet-461.guardia` sobre `docs/ayuda/**` en verde; guardias
  `ayuda-*` y `asistente-*` verdes. (R68, R69)
  *Evidencia:* `f312a6f5` — `tests/unit/asistente/contexto-457.test.ts`; guardias `ayuda-*`/`asistente-*` verdes en el gate.
- [x] **T7.2** Cuatro preguntas reales al asistente en local (`design.md` §11) con el mismo
  `instruccionesDelSistema(rol)` + `contextoPara(docs, rol)` que arma `/api/asistente`. *Hecho:* respuestas
  correctas y con los nombres nuevos anotadas en `progress/impl_457_frontend.md`.
  *Evidencia:* `fd471b7e` — `progress/impl_457.md` §11.4 (cuatro preguntas); el corte a 1024 tokens se arregló en `a05cd58b` (techo 2048).

---

## FASE 8 — Guardias de alcance y lo que D3 protegía · `backend_dev` (puede ir en paralelo con 6–7)

- [x] **T8.1** `catalogo-y-choke-point.test.ts`: conteos 63/41/24; `not.toContain("abono_tienda_registrado")`
  → `toContain` con el comentario de la reapertura (2026-09-24, ficha 457). *Hecho:* verde; con el tipo
  quitado del catálogo, rojo. (R61–R64)
  *Evidencia:* `4f47226c` — `catalogo-y-choke-point.test.ts` («⭑ FICHA 457», 63/41/24).
- [x] **T8.2** `tests/unit/guards/abono-tienda-alcance.guardia.test.ts` (`design.md` §12): censo de
  productores de `abono_tienda` (solo el servicio), puerto de caja obligatorio y llamado en el mismo
  método, un solo concepto del diálogo que acredite a una tienda. *Hecho:* tres mutaciones rojas (un
  segundo productor; quitar la llamada a la caja; un concepto más con `categoriaTienda` de crédito) y
  control de no-vacuidad. Mutación 12 → rojo. (R65, R67)
  *Evidencia:* `4f47226c`/`efe15944` — `abono-tienda-alcance.guardia.test.ts` (1)(2)(3) con contrapruebas; mutación 12 roja.
- [x] **T8.3** Integración: Σ `abono_tienda` del libro = Σ `ingreso_abono_tienda` de la caja por
  `origen_id`, tras registrar y tras anular (Σ anulado = Σ reverso); comprueba que hay filas. *Hecho:*
  verde. (R65)
  *Evidencia:* `eb36c2dc` — `abono-tienda-457.test.ts` «R65 (T8.3)».

---

## FASE 9 — Cierre

- [x] **T9.1** Repetir la fase 0 con el árbol final: las 14 mutaciones de `design.md` §13 rojas y la
  fotografía verde sin tocar sus literales. *Hecho:* anexo en `progress/fase0_457.md`. (R77)
  *Evidencia:* anexo T9.1 de `progress/fase0_457.md` (las 14 repetidas sobre el árbol final, las 14 rojas; fotografía y invariante verdes sin tocar literales).
- [x] **T9.2** `progress/impl_457.md`: tabla R1–R79 → test con rutas reales (R77–R79 con su evidencia en
  `progress/`); lista completa de tests reescritos con su R.
  *Evidencia:* `progress/impl_457.md` §6 + §11 + §12 (R79 → `progress/recorrido_457.md`; R78 → `progress/contraste_457.md`).
- [x] **T9.3** Recorrido por rol de `design.md` §17 (maestro, admin, adminTienda, mensajero) en local
  sembrado, un solo dev server, con Playwright ad hoc. *Hecho:* `progress/recorrido_457.md` + capturas con
  números en `progress/recorrido_457/`. (R79)
  *Evidencia:* `b1272ce2` — `progress/recorrido_457.md` + `progress/recorrido_457/` (47 OK, 1 FALLO = F1, arreglado en `e4c191fb`; 5 N/V por el bucket). Es la B2 de la revisión.
- [x] **T9.4** `./init.sh` COMPLETO con `INIT_EXIT=$?` dentro del log, sin `tail`, 0 saltados en
  `integration/db`. *Hecho:* verde.
  *Evidencia:* `progress/gate_457_cierre.log` (`INIT_EXIT=0`, 2258/2258 archivos, 0 saltados en `integration/db`); la primera corrida roja por una parada global de ~30 s, aislada 3/3 verde, en `progress/gate_457_cierre_a.log` y `progress/impl_457.md` §12.6.
- [ ] **T9.5** **(LEADER)** Antes de desplegar: confirmar el bucket `wallet-comprobantes` en preview y prod
  (M5); tras desplegar, M3/M4/M6/M8 y RLS de `design.md` §14 «después» en `progress/contraste_457.md`;
  errores de runtime en la hora siguiente = 0. Tras el primer pago real de Nuform: M1 y M8. (R78)
  **Abierta: post-despliegue, del leader.**
- [ ] **T9.6** **(LEADER)** Anotar en el spec de la 458 los acoples de `design.md` §15 (nombres, D6, D7, D9)
  y la entrada en `progress/history.md`.
  **Abierta: post-despliegue, del leader.**

## Dependencias

```
0:  T0.1 → T0.2 ; T0.3 (leader) ∥ ; T0.4 tras T0.3
1:  T0.3/T0.4 → T1.1 → T1.2 → T1.3 → T1.4 → T1.5 → T1.6
2:  T1.4 → T2.1 → T2.2 [P], T2.3 [P], T2.4 [P] → T2.5
3:  T2.5 → T3.1 [P], T3.2 [P], T3.3 [P]
4:  Fase 3 → T4.1 → T4.2 ; T4.3 [P] con T4.2
5:  Fase 4 → T5.1 → T5.2 [P], T5.3 → T5.4 → T5.5
6:  Fase 5 → T6.1 → T6.2 ; T6.3 → T6.4 → T6.6 ; T6.5 [P] tras T6.1 ; T6.7 [P] ; → T6.8
7:  Fase 6 → T7.1 → T7.2
8:  Fase 5 → T8.1, T8.2, T8.3 [P] (en paralelo con 6–7)
9:  T9.1 → T9.2 → T9.3 → T9.4 ; T9.5 y T9.6 (leader) tras el despliegue
```
