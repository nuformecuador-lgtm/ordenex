# Ficha 459 — Tareas

Cuatro bloques en orden: **0 → A → B → C**, más el cierre **Z**. A, B y C son entregables por
separado (design §15): A no lleva migración; B sí; C solo existe cuando haya lista aprobada.
`[P]` = paralelizable con sus hermanas del mismo bloque (sin archivos en común). Un commit por tarea
(`feat(459): …`, `test(459): …`), y verificar el blob commiteado antes de dar un bloque por cerrado.

## Reglas para todas las tareas

- **Primer paso del worktree:** `git checkout --detach <SHA de dev que dé el leader>` y comprobar el
  merge-base (el worktree de agente nace de `dev`, no de la rama en curso).
- **Gate:** todos los bloques tocan `lib/types/wallet.ts` (cimiento) y B/C migraciones: **`./init.sh`
  COMPLETO**, con `INIT_EXIT=$?` escrito dentro del log, sin `tail` en tubería, mirando que
  `tests/integration/db` no tenga ficheros saltados (sin `.env` se saltan y el gate dice «OK»).
- **Gate y mutaciones nunca a la vez** sobre el mismo árbol.
- **La fotografía de la fase 0** corre verde al empezar y al terminar cada bloque **sin tocar sus
  literales**, salvo el bloque con nombre propio «lo que esta ficha cambia a propósito» (T A.3). Si
  hiciera falta cambiar otro literal, se para y se pregunta: es dinero.
- **Test que se retira o se reescribe:** se lista en `progress/impl_459.md` con el requisito que lo
  sustituye. Ninguno desaparece sin reemplazo.
- **Migraciones a mano** (P3006); **ninguna migración aplicada se edita**; timestamps posteriores al
  último de `origin/dev` en el momento de escribirlas.
- **No escribir `feature_list.json`** desde el worktree.


## Estado (2026-09-24, `feature/459-fix`)

`[x]` = hecho y con su evidencia en el repo. Lo que sigue en `[ ]` NO es del implementer: es del
**LEADER** o del **HUMANO**, y falta su evidencia en `progress/`.

| Tarea | Dueño | Evidencia / lo que falta |
| --- | --- | --- |
| T0.1–T0.3, T Z.1 | implementer | `progress/impl_459_fase0.md` (el nombre lo fijó el encargo; `tasks.md` decía `fase0_459.md`) + su **anexo T Z.1** con el árbol final |
| T0.5, T A.10, T B.18, T C.7 | implementer | gates completos: backend en `progress/impl_459.md` § Verificación (su log no se commiteó), `progress/gate_459_frontend.log` y `progress/gate_459_fix.log` (`INIT_EXIT=0`); recorrido por rol `progress/recorrido_459.md` + `progress/recorrido_459/` (40/45 OK; sus dos fallos F1 y F2 corregidos en `feature/459-fix`) |
| T A.1–T A.9, T B.2–T B.17, T C.4–T C.6 | implementer | `progress/impl_459.md` (backend) y `progress/impl_459_frontend.md` (frontend) |
| T B.1 | LEADER | hecho: nota al final de `progress/impl_459.md` |
| T Z.2 | implementer | tabla R → test con rutas reales al final de `progress/impl_459.md` |
| T0.4, T C.3, T Z.3 | **LEADER** | FALTA `progress/contraste_459.md` (hoy la línea base vive al final de `design.md`) |
| T C.1 | **LEADER** | FALTA `progress/reclasificacion_459/candidatos.csv` con sus sumas de control |
| T C.2 | **HUMANO** (lo escribe el leader) | `lista_aprobada.csv` existe; FALTA `progress/reclasificacion_459/aprobacion.md` (quién, cuándo, filas, suma y la decisión explícita de las tres filas marcadas; revisión m5) |
| T Z.4 | **LEADER** | FALTA: specs de la 457/458 y `docs/release.md` |

---

## BLOQUE 0 — Caracterizar lo que NO puede cambiar (sin código de producción)

- [x] **T0.1** Constructor del escenario de design §12.1 en
  `tests/integration/db/_fixtures/caja-459.ts`, sembrando por los servicios reales (cierre con dos
  tiendas y comisión con céntimos, orden prepagada entregada, rechazo con cobro aprobado, pago a tienda
  y su anulación, reparto a mensajero y anulación de un pago, cobro de un costo, sueldo y reverso,
  gasto variable, ajustes, gasto fijo aprobado, premio y anulación, indemnización).
  *Hecho:* siembra dos veces seguidas sin error ni duplicados.
- [x] **T0.2** `tests/integration/db/caja-caracterizacion-459.test.ts`: literales de saldo y desglose
  de cada tienda, ganancia, `ComposicionGananciaDTO`, `DesgloseEgresosDTO`, cuenta por pagar y libro
  de cada mensajero, y filas escritas por cada camino en cada libro; bloque aparte con nombre propio
  que fija `entradas`, `enCaja` y `deTerceros` de HOY. *Hecho:* verde contra el SHA de `dev` anotado;
  `skipped = 0`. Depende de T0.1. (R92–R96)
- [x] **T0.3** Mutaciones (las 14 de design §12.2) con autocomprobación. *Hecho:*
  `progress/fase0_459.md` con, por mutación, el diff de una línea, el comando, la salida roja con el
  nombre del caso y el número de tests ejecutados (≠ 0), y `git diff --stat` vacío al final. Ninguna
  superviviente sin explicar. Depende de T0.2.
- [ ] **T0.4** [P] **(LEADER, no el agente)** Contraste de línea base en producción por el MCP de
  Supabase, solo lectura: C0–C7 de design §11. *Hecho:* `progress/contraste_459.md` con las salidas
  literales; `diferencia_r8` y `diferencia_r7` en 0,00 y C2 sin filas. Si no, se para antes del
  bloque A.
- [x] **T0.5** Gate completo + commit. *Hecho:* `INIT_EXIT=0` en el log.

## BLOQUE A — La derivación y la tarjeta (sin migración) · depende de 0

- [x] **T A.1** `NaturalezaMovimiento` gana `capital` (`lib/types/wallet.ts`); `CajaResumenDTO` gana
  los campos de design §2.6; `DUENO_LABEL` y `DUENO_PUNTO` ganan `capital`. *Hecho:* typecheck verde
  (los `Record` totales obligan); sin categorías de capital todavía, ninguna fila es `capital`.
- [x] **T A.2** `LIQUIDEZ_POR_CATEGORIA` y la derivación de design §2.2 en
  `lib/utils/caja-tesoreria.ts` (cuatro `derivarBalance`, «De Ordenex», reparto sobre «De Ordenex»);
  `caja-derivaciones.guardia` de 3 a 4 llamadas con el comentario de la ficha. *Hecho:*
  `tests/unit/utils/caja-derivacion-459.test.ts` verde con las cifras de M6 como literales (columnas
  2 y 3 de design §2.4) e identidad R7 sobre subconjuntos con semilla fija; mutación «un cargo como
  `efectivo`» → rojo. (R1–R7, R10, R11)
- [x] **T A.3** Reescribir el bloque «lo que esta ficha cambia a propósito» de la fotografía con los
  literales nuevos, calculados a mano en un comentario del test (nunca con la función probada). El
  resto de la fotografía, intacto. *Hecho:* fotografía verde; el diff del test toca solo ese bloque.
- [x] **T A.4** Estado de la caja: `WalletService.verResumenCaja` pasa `haySaldoInicialVigente` (en
  este bloque, un lector que devuelve siempre `false`, con un `TODO(459-B)` que la guardia de T B.12
  prohíbe dejar) y `primerDia` (`WalletMovimientoRepository.primerDiaDeLaCaja`). *Hecho:*
  `wallet-service.test.ts` con los dos estados y libro vacío (`flujoDesde: null`); test de integración
  del `WHERE`/`MIN` contra la base. (R14)
- [x] **T A.5** [P] `lib/utils/invariante-tiendas.ts` (`TIPO_POR_CATEGORIA_TIENDA`,
  `CONTRAPARTIDA_EN_CAJA`) y la guardia `caja-clasificacion-459.guardia.test.ts` con sus cinco
  afirmaciones y contraprueba. *Hecho:* verde; dos mutaciones (par invertido; categoría de terceros
  sin pareja) → rojo. (R9, R90)
- [x] **T A.6** [P] `finanzas-diarias.ts` (`ingresos` = entradas de efectivo) y `metrics.ts`
  (descripción de `dinero_en_caja`). *Hecho:* `finanzas-diario.test.ts` y
  `metrics-caja-naturaleza.guardia` verdes; test de que `dinero_en_caja` por cubo = cifra de la
  tarjeta sobre el mismo conjunto. (R12, R13)
- [x] **T A.7** Textos de design §3.3–§3.4 en `wallet-labels.ts`; fuera el aviso y la pista viejos.
  *Hecho:* `caja-textos-459.guardia.test.ts` verde con contraprueba (la fuente de hoy la pone roja).
  (R16, R24)
- [x] **T A.8** `CajaResumenCard` y `BarraComposicionCaja` según design §3.1: rótulo por estado,
  pistas, líneas de negativo, región «Saldo inicial y aportes», frase «Las tiendas le deben…», barra y
  mensajes solo en «saldo». *Hecho:* `CajaResumenCard.test.tsx` y `CajaComposicionBarra.test.tsx`
  con los dos estados × filtros × signos; `DineroIdentidadesEnPantalla` con la identidad de tres
  sumandos; `wallet-page.test.tsx` con el barrido STRING ampliado a conciencia. Depende de T A.7.
  (R15, R17–R20, R22, R23, R25, R26, R28, R7 en pantalla)
- [x] **T A.9** [P] `cargar-kpis.ts` (sin superficie): rótulo de la cifra de caja desde la misma
  función que la tarjeta; pista de «Por pagar a tiendas» sin la afirmación del bruto. *Hecho:* sus
  tests verdes; guardia `@sin-superficie` intacta.
- [x] **T A.10** Fotografía verde (salvo el bloque ya reescrito), gate completo, revisión, recorrido
  pasos 1, 2 y 11 del guion (design §16). *Hecho:* `INIT_EXIT=0`; capturas con números en
  `progress/recorrido_459/`.

## BLOQUE B — Pago por cuenta y saldo inicial / aporte · depende de A

- [x] **T B.1** (LEADER) Re-medir C6 en producción y lo mismo en la base local; comprobar que ninguna
  migración pendiente de `dev` toca los tres enums de la wallet, los dos CHECK ni las tablas de la
  wallet. *Hecho:* nota en `progress/impl_459.md` con las listas y la conclusión.
- [x] **T B.2** Migración 1 `…_caja_459_enums` + `down.sql` (design §4.1, listas de T B.1, aviso de
  «foto del día», precondición ruidosa, índices y CHECK que nombran cada tipo). *Hecho:* `prisma
  migrate deploy` y `db:rollback` locales limpios.
- [x] **T B.3** Migración 2 `…_historial_accion_459` + `down.sql` dinámico (design §4.2). *Hecho:*
  aplicada y revertida en local **y** sobre una copia sin los valores de SF-001; con una fila que use un
  valor nuevo, el rollback falla sin borrar.
- [x] **T B.4** Migración 3 `…_pago_por_cuenta_y_capital` + `down.sql` (design §4.3): cuatro tablas,
  FKs RESTRICT, índices, CHECK, RLS, los dos CHECK tipo↔categoría ampliados; `db/schema.prisma`
  (modelos, relaciones en `Usuario`, valores de enum) y `prisma generate`. *Hecho:* sin drift
  (procedimiento de la 381). Depende de T B.2, T B.3.
- [x] **T B.5** `tests/integration/db/caja-459-migration.test.ts`: listas de enum valor a valor contra
  el estado reconstruido con las migraciones reales previas; los CHECK rechazan los pares invertidos
  (23514); RLS activa en las cuatro tablas; cada documento tiene exactamente 2 índices únicos; rollback
  con filas nuevas falla sin borrar; sin ellas vuelve al estado previo; `TIPO_POR_CATEGORIA_TIENDA`
  coincide con el CHECK. *Hecho:* verde y rojo con una mutación (quitar un valor de una lista de
  `down`). (R98, R99)
- [x] **T B.6** Clasificación de los conceptos nuevos en todos los `Record` y listas de design §5
  (incluido `ORIGEN_TIENDA_LABEL`, que el compilador no obliga, y `metrics.ts`). *Hecho:* typecheck
  verde; `caja-clasificacion-459`, `caja-composicion-exhaustiva`, `metrics-caja-naturaleza` verdes;
  test que recorre `WALLET_ORIGEN_TIPO_SEED` y exige rótulo en `ORIGEN_TIENDA_LABEL` para los orígenes
  que escriben en el libro de la tienda; fotografía sin cambios. Depende de T B.4.
- [x] **T B.7** [P] Comprobante: `lib/config/wallet-comprobante.ts`, `BUCKETS`, `lib/utils/comprobante.ts`
  (validación pura y ruta aleatoria). *Hecho:* `wallet-comprobante.test.ts` (tipos, 4 MB, ruta sin
  ids); nota de operaciones «crear `wallet-comprobantes` privado en local, preview y prod ANTES de
  desplegar B». (R54, R55)
- [x] **T B.8** [P] Descripciones puras `lib/utils/descripcion-pago-por-cuenta.ts`. *Hecho:* test con
  y sin referencia, con nombre de tienda en caja, con prefijo de anulación, sin forma de uuid. (R43)
- [x] **T B.9** Puertos `CajaPagoPorCuentaFeedService` y `CajaAporteCapitalFeedService` (literales
  dentro) + repositorios `PagoPorCuentaTiendaRepository` y `AporteCapitalRepository` (crear y anular
  con su historial, un tipo por método; `obtenerPorClave`, `obtenerPorId`, `estadoDeDocumentos`,
  `haySaldoInicialVigente`) + historial (`lib/types/historial-accion.ts`, etiquetas, conteos).
  *Hecho:* test de lista exacta de categorías de cada puerto; `catalogo-y-choke-point` y guardias del
  censo verdes con los conteos nuevos; integración que mata una mutación del `WHERE` de
  `haySaldoInicialVigente`. Depende de T B.6. (R53, R78)
- [x] **T B.10** `PagoPorCuentaTiendaService` (registrar, anular, obtener comprobante) en el orden de
  design §6.1. *Hecho:* `pago-por-cuenta-tienda-service.test.ts`: rol antes de leer; tienda
  inexistente / no tienda / inactiva; candado ANTES de leer el saldo (orden de llamadas); las cuatro
  escrituras con el mismo `montoStr` y el mismo instante; `ya_registrado`; saldo negativo devuelto;
  compensación del archivo en cada desenlace no-ok; anulación con monto del documento, fecha de hoy CR
  (reloj inyectado), `ya_anulado`, `no_encontrado`, comprobante intacto. Depende de T B.7–T B.9.
  (R29–R43, R46–R52, R56, R57)
- [x] **T B.11** `AporteCapitalService` (design §6.2). *Hecho:* `aporte-capital-service.test.ts`:
  clase obligatoria; fecha futura rechazada y sin ventana hacia atrás; saldo inicial con fecha posterior
  al primer día → rechazado con el último día admitido; segundo saldo inicial → `ya_hay_saldo_inicial`;
  anulación; ningún método devuelve un importe sugerido. [P] con T B.10. (R68–R76, R27)
- [x] **T B.12** Actions `lib/actions/pago-por-cuenta-tienda.ts` y `lib/actions/aporte-capital.ts`
  (zod `.strict()`, `FormData`, `buildService()` con puertos y storage REALES); el lector real de
  `haySaldoInicialVigente` sustituye al de T A.4. *Hecho:* tests de action (sesión, validación, lectura
  del `File`, lista exacta de exportaciones); `tests/integration/db/pago-por-cuenta-tienda.test.ts` y
  `tests/integration/db/aporte-capital.test.ts` que pasan POR LA ACTION y encuentran en Postgres el
  documento, las filas de los libros y el historial; el estado de la caja cambia al registrar y al
  anular el saldo inicial; guardia: no queda ningún `TODO(459-B)`. (R14, R21, R29, R39, R68, R72, R97)
- [x] **T B.13** Concurrencia: `pago-por-cuenta-tienda-concurrencia.test.ts` (pago por cuenta ∥ pago
  a tienda sobre la misma tienda: serializan; dos anulaciones: un contra-asiento) y dos saldos
  iniciales simultáneos (uno solo). *Hecho:* verde y rojo si se quita el candado. (R42, R50, R70)
- [x] **T B.14** Invariante con todo: `caja-invariante-tiendas.test.ts` sobre el escenario de 0 más
  pago por cuenta y anulación, saldo inicial, aporte y anulación. *Hecho:* R7 y R8 al céntimo tras
  cada paso; comprueba que hay filas; rojo con la mutación «reverso del pago por cuenta como propio».
  (R8, R89)
- [x] **T B.15** Diálogo: catálogo de 7 conceptos en tres grupos, `FRASE_DEL_EFECTO`, clases de destino
  nuevas, campos por concepto, `FormData` solo con sus claves, pista de R62, aviso de R63; el cobro de
  un costo sin cambios salvo su frase. *Hecho:* `wallet-conceptos-manuales.test.ts` y
  `wallet-registrar-movimiento-dialog.test.tsx` ampliados (el payload del cobro no gana ni una clave;
  el monto del saldo inicial arranca vacío); tests de la 334/381 que cambian por el reordenado,
  listados con su sustituto. (R59–R64, R27)
- [x] **T B.16** [P] Libro de la caja: `documento` en `WalletMovimientoDTO` resuelto en lote,
  «Anular…» / «Anulado» / «Ver comprobante». *Hecho:* `WalletLedgerAcciones459.test.tsx` (acciones solo
  en originales vigentes, nunca en contra-asientos ni reclasificados); test de número de consultas (una
  por tipo de documento presente); la descarga no gana columnas con ids. (R45, R65–R67, R77, R100)
- [x] **T B.17** [P] `/mi-wallet` y `/wallet/tiendas`: rótulo, pistas y origen de los conceptos de la
  tienda. *Hecho:* `mi-wallet-page.test.tsx` (ningún pago por cuenta se lee «Cobro de Ordenex»);
  descargas sin ids. (R44)
- [x] **T B.18** Fotografía verde sin tocar literales, gate completo, revisión, recorrido pasos 3–10
  por maestro, admin, adminTienda y mensajero. *Hecho:* `INIT_EXIT=0`; capturas y números en
  `progress/recorrido_459/`; nota de release «crear el bucket; migrar preview y prod».

## BLOQUE C — Reclasificación de los 203 · depende de B y de la aprobación del humano

- [ ] **T C.1** (LEADER) Correr C3 y C4 en producción y volcar `progress/reclasificacion_459/candidatos.csv`
  con las sumas de control (se esperan 203 / 25.769.034,50). *Hecho:* archivo commiteado y sumas
  anotadas.
- [ ] **T C.2** (HUMANO) Revisión fila a fila: «pago por cuenta» o «cobro de un costo» para cada una,
  con decisión explícita en «COMPRA 40 LEMME BURN», «ABONO TARJETA NUFORM CARLOS CASTILLO» y
  «FACEBOOK IVA». *Hecho:* `progress/reclasificacion_459/lista_aprobada.csv` y `aprobacion.md` (quién,
  cuándo, filas, suma). **Nada de lo que sigue empieza sin esto.** (R88)
- [ ] **T C.3** (LEADER) C1-bis con la lista: cifras esperadas «después». *Hecho:* en
  `progress/contraste_459.md`.
- [x] **T C.4** Migración `<ts>_reclasificar_cobros_459` (plantilla de design §10.2, lista entre
  marcas) + `down.sql`; guardia `reclasificacion-459-lista.guardia.test.ts` (lista = CSV aprobado: ids,
  tiendas, montos, número y suma). *Hecho:* la guardia verde, y roja con una fila cambiada en la
  migración. (R80, R88)
- [x] **T C.5** `tests/integration/db/reclasificacion-459-migration.test.ts` (design §10.2, último
  párrafo): R81–R86 y la invariante antes y después. *Hecho:* verde, con las mutaciones «sin la
  comprobación de monto» y «sin el `ON CONFLICT`» en rojo.
- [x] **T C.6** [P] Rótulo del origen `cobro_manual_reclasificado` en el libro y sin acciones en esas
  filas. *Hecho:* test del libro y de su descarga. (R87)
- [x] **T C.7** Gate completo, revisión. *Hecho:* `INIT_EXIT=0`.

## CIERRE Z

- [x] **T Z.1** Repetir la fase 0 con el árbol final: mismas mutaciones rojas y fotografía verde sin
  tocar sus literales (salvo el bloque de T A.3). *Hecho:* anexo en `progress/fase0_459.md`.
- [x] **T Z.2** `progress/impl_459.md` con la tabla R → test de design §17 y rutas finales; R1–R100
  todas con test (R79 y R91 con su evidencia en `progress/`).
- [ ] **T Z.3** (LEADER) Tras cada despliegue: contraste C0–C2, C5, C7 en producción; diferencias en
  0,00, C2 sin filas, C5 idéntico a la línea base; errores de runtime en la hora siguiente = 0.
  *Hecho:* `progress/contraste_459.md` con «antes» y «después» de A, B y C. **Si alguna diferencia no
  es 0,00, no se sigue con el siguiente bloque.** (R91)
- [ ] **T Z.4** (LEADER) Actualizar los specs de la 457 y la 458 con los acoples de design §14, y
  anotar en `docs/release.md` los pasos de operaciones (bucket, migraciones, contraste). *Hecho:* las
  dos fichas citan esta y sus mediciones rancias quedan marcadas para re-medir.

## Dependencias

```
T0.1 → T0.2 → T0.3 ;  T0.4 (leader) en paralelo ; T0.5
A:  T A.1 → T A.2 → T A.3 → T A.4 ;  T A.5 [P] ; T A.6 [P] ; T A.7 → T A.8 ; T A.9 [P] ; → T A.10
B:  T B.1 → T B.2 → T B.3 → T B.4 → T B.5 → T B.6 → T B.9 → {T B.10, T B.11} → T B.12 → T B.13 → T B.14
    T B.7 [P], T B.8 [P] antes de T B.10 ;  T B.15 tras T B.12 ; T B.16 [P], T B.17 [P] tras T B.6 ; → T B.18
C:  T C.1 → T C.2 (humano) → T C.3 → T C.4 → T C.5 ; T C.6 [P] ; → T C.7
Z:  tras cada bloque, T Z.3 ; al final T Z.1 → T Z.2 ; T Z.4 en cuanto B esté en dev
```
