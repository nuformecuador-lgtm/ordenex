# Feature 158 — Tasks

> `requirements.md` (R1-R64) · `design.md` (§0-§15).
> Zona **fullstack**: la implementación se secuencia **backend (F1/F1B) → frontend (F2/F2B)**. Dentro
> de cada fase, `[P]` marca lo que puede ir en paralelo con sus hermanas de la misma fase (no tocan los
> mismos archivos).
> Regla del repo: **un commit por task lógica**; nada se da por hecho sin `./init.sh` y tests en verde.
>
> ⚠️ **La feature está por encima de su estimación `high`.** `design.md` §15 propone un **corte en dos
> entregas** (F1+F2 = entrega 1, camino del mensajero; F1B+F2B = entrega 2, camino del admin) y
> demuestra que el intermedio **no deja nada roto**. Si el humano acepta el corte, las fases B se
> mueven a su propio PR sin cambiar ni una task. **La decisión es suya, no del spec.**

---

## Fase 0 — Puerta · ✅ **CERRADA el 2026-07-30**

> Las respuestas están escritas **EN el spec** (`design.md` §0 y el bloque de decisiones de
> `requirements.md`), no sólo en la bitácora: es la lección «CORRECCIÓN 1» de `progress/current.md`.

- [x] **T0.1** Cerrar **Q-A**, **Q-B** y **Q-D**.
      → **Q-A = LOS DOS reportan** («los dos ya que los dos manipulan paquetes»): el mensajero desde
      `en_reparto` (#44, ya declarada) y el admin desde 5 estados de bodega/tránsito (5 aristas nuevas).
      → **Q-B = causa tipada de 3 valores + evidencia 1..N OBLIGATORIA SIEMPRE**, también en
      `perdido`/`robado`; `motivo` obligatorio siempre. Objeción planteada y desestimada por el humano:
      **no se re-litiga** (consecuencia declarada en `requirements.md` y `design.md` §0.2).
      → **Q-B idioma = ESPAÑOL** (`danado`, `perdido`, `robado`); rompe a propósito la coherencia con
      `causa_devolucion`, que está en inglés (§0.3).
      → **Q-D = SÍ se deshace**, en ventana controlada. **Revierte parcialmente la 154** (`incidente: []`)
      de forma explícita y fechada (§0.5).
- [x] **T0.2** Confirmar **Q-G**. → **el append escribe `origen_tipo = incidente`** y se alinea el `via`
      de #44. Verificado que no altera el conteo de intentos (160) ni obliga a tocar
      `ORIGEN_TIPOS_CON_GESTION` (§0.8). **Rompe 2 tests: ver T1.6b.**
- [x] **T0.3** Confirmar **Q-E**. → **fuera de alcance**, con follow-up EXPLÍCITO: «crédito de
      indemnización en el ledger por tienda» (feature 43). **La ficha la registra el leader.**
- [x] **T0.4** Confirmar **Q-F**. → **NO se reescriben los `down.sql` previos.** Se corre
      `tests/integration/db` COMPLETO y se actualiza cualquier test previo que cruce la lista de un down
      contra el SEED vigente. Verificado además que ningún down previo recrea `wallet_origen_tipo`.
- [x] **T0.5** *(nueva)* Cerrar **la aprobación del camino del admin**. → se reusa **el PATRÓN** de los
      cierres (enum `CierreEstado`, dos colas, motivo sólo al rechazar), **NO la tabla**; **el egreso se
      dispara AL APROBAR**; y **quien reporta no aprueba**. Verificado que `cierre_bodega` no sirve (no
      tiene detalle por orden) y que una fila de `gestion_orden` tampoco (§9.7, bug del corte diario).

### ✅ T0.6-T0.8 — CERRADAS el 2026-07-30 (segunda ronda de la puerta)

- [x] **T0.6** **Q-H = modal por orden en el módulo de órdenes**, abierto desde la acción de fila
      (precedentes: `RecuperarABodegaModal` de la 100 y `DeshacerAsignacionModal` de la 149). **Q-I =
      página propia `/incidentes`**, espejo de `cierres-admin` (precedente: `cierres-bodega-admin`).
      Las dos por la recomendación del `design.md` §10. **T2.7 y T2.8 DESBLOQUEADAS.**
- [x] **T0.7** [P] **Q-J = fuera de alcance con follow-up escrito** — el mensajero cuya orden pasa a
      `incidente` NO recibe aviso y la orden desaparece de «Mis asignaciones» en silencio; queda dicho
      en voz alta, no disimulado. **Q-K = NO se toca `mensajero_asignado_id`** (confirmada la asunción
      del diseño), así que **R60 y §13.2 se quedan como están** y no hay que persistir la asignación
      previa.
- [x] **T0.8** [P] **Q-L = DOS PRs.** PR 1 = camino del MENSAJERO (Fase 1 + Fase 2, R1-R36). PR 2 =
      camino del ADMIN (Fase 1B + Fase 2B, R37-R64). Corte de `design.md` §15.2, que demuestra que no
      deja nada funcional roto en el intermedio.
      ⚠️ **Nota de vocabulario:** esta pregunta se planteó primero con la palabra «entrega» y se
      malentendió — en este dominio «entrega» es lo que hace un mensajero con un paquete. En este spec
      «PR» significa PR y nada más.

---

## Fase 1 — Backend (camino del MENSAJERO)

### Datos y catálogos

- [ ] **T1.1** Migración `db/migrations/<ts>_incidente_indemnizacion/` con `migration.sql` + `down.sql`
      (design §3.4): dos `ALTER TYPE … ADD VALUE IF NOT EXISTS` + `ALTER TABLE gestion_orden ADD
      COLUMN indemnizacion DECIMAL(12,2)`; el down suelta la columna y recrea los dos enums (con el
      drop/recreate de los DOS índices que referencian `wallet_movimiento.categoria`).
      *Depende de:* —.
      *Hecho cuando:* `pnpm run db:migrate` aplica sin error; `pnpm run db:rollback` revierte y una
      segunda `db:migrate` vuelve a aplicar (round-trip up→down→up) contra la base local; el UP no
      contiene `INSERT`/`UPDATE` ni toca RLS.
- [ ] **T1.2** `db/schema.prisma`: `GestionResultado + incidente` (`:563`),
      `WalletMovimientoCategoria + egreso_indemnizacion` (`:856`), `GestionOrden.indemnizacion` y
      `GestionOrden.causaIncidente` (`:592-616`) y el enum `GestionCausaIncidente` con
      **`danado` / `perdido` / `robado`** (Q-B cerrada).
      *Depende de:* T1.1.
      *Hecho cuando:* `prisma generate` corre limpio, `prisma migrate status` no reporta drift, y el
      comentario del enum nuevo **deja escrito por qué va en español** aunque `causa_devolucion` esté en
      inglés (§0.3), con la misma fórmula «decisión consciente, no abrir tickets de consistencia» que usa
      `db/schema.prisma:572-577`.
- [ ] **T1.3** [P] SEED/tipos de dominio: `WALLET_MOVIMIENTO_CATEGORIA_SEED`
      (`lib/types/wallet.ts:27`) con el valor nuevo (doble candado intacto).
      *Depende de:* T1.2.
      *Hecho cuando:* `tsc` en verde y un test afirma que el SEED contiene `egreso_indemnizacion`.
- [ ] **T1.4** [P] `lib/types/causa-incidente.ts` calcado de `lib/types/causa-devolucion.ts`: SEED
      cerrado de **3 valores en español** + `satisfies` + `_EnsureExhaustive`, sin «Otro».
      *Depende de:* T1.2.
      *Hecho cuando:* el build rompe si el enum y el SEED divergen (comprobado a mano quitando un
      valor) y hay test de la lista cerrada (R9: exactamente 3, los 3 esperados, ninguno más).
- [ ] **T1.5** Test estático de la migración
      (`tests/integration/db/incidente-indemnizacion-migration.test.ts`), patrón
      `wallet-egreso-migration.test.ts`: UP aditivo, down recrea ambos enums sin los valores nuevos,
      `USING` cast presente, índices recreados, sin RLS.
      *Depende de:* T1.1.
      *Hecho cuando:* pasa, y **`pnpm vitest run tests/integration/db` completo queda en verde**
      (regla del lote: un value de enum nuevo puede romper los tests de migraciones previas).

### Flujo de la gestión

- [ ] **T1.6** Arista de deshacer, `via` de #44 y clasificación exhaustiva, en
      `lib/types/order-status-transiciones.ts`: declarar **#53** `incidente → en_reparto` vía
      `deshacer_gestion` rol `mensajero` (Q-D), cambiar el `via` de **#44** de `gestion` a `incidente`
      (Q-G), reescribir el comentario de `ESTADOS_TERMINALES` (`:239-241`) dejando la **reversión
      fechada** sin borrar la decisión de la 154, y declarar `ESTADOS_ESPERADOS.incidente = ["incidente"]`
      en `lib/services/CierreDiaService.ts:78`.
      *Depende de:* T1.2.
      *Hecho cuando:* R13/R14/R15 tienen test: se deshace con `cierre_id IS NULL`; conflicto si ya
      está en un cierre o si el actor no es el autor; ningún otro camino (cron SLA, liberación al
      aprobar, recuperación manual, ajuste admin, reasignación, ruteo) puede sacar la orden de
      `incidente`; y `incidente` **sigue** en `ESTADOS_TERMINALES`.
- [ ] **T1.6b** *(nueva — deuda mecánica de T1.6)* Reescribir los tests del mapa que **rompen a
      propósito**, uno por uno, según la tabla de `design.md` §14: `connectividad.test.ts:87-93`,
      `guardia.test.ts:209-216`, `:364-380`, `:266-272`, `:384-389` y el fixture
      `tests/fixtures/inventario-transiciones-140.ts` (recuento 41→42 y `via` de #44 en esta entrega;
      42→52 si las 11 aristas van juntas). Verificar además
      `registrar-cambio-estado.guardia.test.ts`.
      *Depende de:* T1.6.
      *Hecho cuando:* ninguno quedó BORRADO ni relajado — cada uno **afirma lo contrario con su razón
      escrita** (patrón con el que la 156 trató los tests de la 154) — y `pnpm vitest run
      tests/unit/domain tests/unit/repositories` está en verde.
- [ ] **T1.6c** *(nueva)* Mover la familia `incidente` de `FAMILIAS_SIN_PRODUCTOR` a
      `PUNTOS_DE_ESCRITURA` en `tests/unit/repositories/orden-historial-cobertura.test.ts:210-213,259-265`,
      con el símbolo REAL que la emite. El propio archivo lo ordena en `:207-209`.
      *Depende de:* T1.8.
      *Hecho cuando:* el test pasa, `FAMILIAS_SIN_PRODUCTOR` queda en `["recoleccion_tienda"]` y la unión
      de los dos conjuntos sigue cubriendo el enum exactamente.
- [ ] **T1.7** Borde zod: quinta variante `incidente` en `gestionarUnionSchema`
      (`lib/types/gestion-orden.ts:121`) con `causaIncidente` (enum cerrado), `motivo` obligatorio y
      `evidencias` **reusando `evidenciasSchema` (1..N, obligatoria SIEMPRE, Q-B)**.
      *Depende de:* T1.4.
      *Hecho cuando:* tests de schema cubren R9/R10/R11: causa fuera de lista o ausente → error por
      campo; **lista de evidencias vacía → error, para las TRES causas**; y los campos nuevos NO se
      aceptan en las otras cuatro ramas (blindaje de la `discriminatedUnion`).
- [ ] **T1.8** `MisAsignacionesService.gestionar`: `case "incidente"` en `buildGestionData` (`:484`) y
      alta de `incidente` en la lista de resultados que suben evidencia (`:347-351`). Sin tocar
      guardias, bloqueo 1-a-1 ni compensación de Storage.
      *Depende de:* T1.7.
      *Hecho cuando:* R6/R7/R8 con test: transición atómica a `incidente`; rechazo sin efectos desde
      un estado que no es `en_reparto`, con orden ajena o con mensajero bloqueado; **cero objetos en el
      bucket** cuando el envío se rechaza; y rastro en el historial con `origen_tipo = incidente` (Q-G).
- [ ] **T1.9** [P] Test de "el incidente no mueve dinero" (R17) sobre las funciones puras
      `pagoPorResultado`, `ingresoBodegaPorResultado` y `derivarIngresoOrden`.
      *Depende de:* T1.2.
      *Hecho cuando:* los tres devuelven cero/vacío para `incidente` y el test lo fija (hoy sale de un
      `return` por defecto: sin test, una feature futura lo cambia sin enterarse).
- [ ] **T1.10** [P] `CierreGrupos` de 5 claves (`lib/interfaces/services/ICierreDiaService.ts:147`) y
      los mapeos de service que lo pueblan (`CierreDiaService`, `CierresAdminService:141`).
      *Depende de:* T1.2.
      *Hecho cuando:* R16/R18 con test: una gestión `incidente` del día entra en el cierre solicitado,
      recibe su fila de `cierre_detail` y aparece en su grupo propio en ambos detalles.

### Aprobación, captura y egreso

- [ ] **T1.11** Contrato de entrada: `aprobarCierreSchema` con `indemnizaciones[]`
      (`lib/types/cierres-admin.ts:20`), reusando `montoPositivoSchema` (`lib/types/wallet.ts:130`).
      *Depende de:* T1.2.
      *Hecho cuando:* R20/R24 con test de borde: monto vacío, 0, negativo, con 3 decimales o con coma
      → `validation_error`; el contrato sin `indemnizaciones` sigue siendo válido (R36).
- [ ] **T1.12** Guardias en `CierresAdminService.aprobarCierre` (`:185`): cobertura EXACTA de las
      gestiones `incidente` del cierre + alcance (design §6.2).
      *Depende de:* T1.11.
      *Hecho cuando:* R19/R21/R25 con test: falta un monto → `validation_error`; sobra un `gestionId`
      o no es `incidente` o es de otro cierre → `validation_error`; cierre fuera de alcance →
      `no_encontrada`; cierre sin incidentes → aprueba como hoy.
- [ ] **T1.13** `WalletIndemnizacionFeedService` nuevo + su interfaz, hermano de
      `WalletMensajeroFeedService`: lee de la `tx` la suma de `gestion_orden.indemnizacion` de las
      gestiones `incidente` del cierre y devuelve 0 o 1 movimiento.
      *Depende de:* T1.2.
      *Hecho cuando:* test unitario con doble de `tx`: suma correcta money-safe (Decimal/STRING), 0
      incidentes → lista vacía (R27), movimiento con `tipo/categoria/origen_tipo/origen_id` exactos
      (R26).
- [ ] **T1.14** `ResolverCierreInput.indemnizaciones` + escritura guardada y emisión en la MISMA `tx`
      de `CierresAdminRepository.resolverCierre` (`:404-429`), tras los feeds 42/43/44, sólo en la
      rama `aprobado`. Inyección del feed nuevo en el composition root
      (`lib/actions/cierres-admin.ts:62`).
      *Depende de:* T1.12, T1.13.
      *Hecho cuando:* R22/R23/R28/R29 con test: aprobar persiste montos y emite UN egreso; un fallo
      en cualquier paso deja TODO sin aplicar; rechazar no escribe montos ni movimientos; reintentar
      la aprobación no duplica el egreso (idempotencia por el índice único parcial).
- [ ] **T1.15** [P] Guard de productores de `egreso_indemnizacion` (**R29 reescrito**): test estructural
      que verifica que la categoría se emite **sólo desde los puntos declarados de `lib/`**, nombrados
      explícitamente (patrón `tests/unit/repositories/cierre-detail-inmutable.test.ts`). En esta entrega
      el conjunto declarado tiene **UN** emisor; en F1B pasa a **DOS** (T1.27).
      *Depende de:* T1.14.
      *Hecho cuando:* el test falla si aparece un emisor no declarado, y la lista declarada es explícita
      (no un `some()` permisivo).
- [ ] **T1.16** [P] Wallet — desglose backend: `indemnizacion` en `DesgloseEgresosAgregado`
      (`lib/interfaces/repositories/IWalletMovimientoRepository.ts:58`), en `agregarPorCategoria`
      (`lib/repositories/WalletMovimientoRepository.ts:114`), en `DesgloseEgresosDTO`
      (`lib/types/wallet.ts:117`) y en el `total` de `WalletEgresoService.verDesgloseEgresos` (`:116`).
      *Depende de:* T1.3.
      *Hecho cuando:* R32 con test: el total incluye la indemnización y sigue siendo STRING money-safe.
- [ ] **T1.17** [P] Test de no-reversabilidad (R30): un movimiento `egreso_indemnizacion` con origen
      `cierre_dia` no es egreso administrativo y la reversa lo rechaza.
      *Depende de:* T1.14.
      *Hecho cuando:* pasa sin haber tocado `WalletEgresoService`.
- [ ] **T1.18** Cierre de fase backend del camino del mensajero: `./init.sh` + suite completa en verde,
      `tests/integration/db` **completo** incluido (regla del lote, Q-F); mapa R→test actualizado en
      `progress/impl_158-incidente-indemnizacion.md`.
      *Depende de:* T1.1-T1.17.
      *Hecho cuando:* no queda ningún R de las secciones A-H (R1-R36) sin test citado, y los tests
      reescritos de T1.6b/T1.6c están justificados por escrito en el impl.

---

## Fase 1B — Backend (camino del ADMIN) · arranca con F1 en verde

> **Alcance nuevo del 2026-07-30 (R37-R64).** Si el humano acepta el corte de §15, esta fase y F2B son
> la **entrega 2** y viven en su propio PR. Ninguna task de aquí bloquea nada de F1/F2.

### Datos y catálogos del admin

- [ ] **T1.19** Migración `db/migrations/<ts>_orden_incidente/` con `migration.sql` + `down.sql`
      (design §12.2): `ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'orden_incidente'` +
      `CREATE TABLE "orden_incidente"` y `"orden_incidente_evidencia"` con FKs, índices, el **índice
      único PARCIAL** `(orden_id) WHERE estado <> 'rechazado'` y **RLS habilitada sin policies**.
      *Depende de:* T1.18.
      *Hecho cuando:* `pnpm run db:migrate` aplica; `pnpm run db:rollback` revierte y una segunda
      `db:migrate` vuelve a aplicar (round-trip up→down→up contra la base local); y el `down.sql`
      **migra `origen_tipo` con `USING` en las TRES tablas que usan el tipo** (`wallet_movimiento`,
      `wallet_tienda_movimiento`, `pago_mensajero_movimiento`) — olvidar una deja el tipo `_old`
      colgando y el down falla.
- [ ] **T1.20** `db/schema.prisma`: `WalletOrigenTipo + orden_incidente`, modelos `OrdenIncidente` y
      `OrdenIncidenteEvidencia` (design §12.1) con las relaciones inversas en `Orden` y `Usuario`.
      *Depende de:* T1.19.
      *Hecho cuando:* `prisma generate` limpio, `migrate status` sin drift, y el comentario del modelo
      **cita la razón de no ser una `gestion_orden`** (§9.7, bug del corte diario) para que nadie lo
      "simplifique" después.
- [ ] **T1.21** [P] SEED/tipos: `WALLET_ORIGEN_TIPO_SEED` (`lib/types/wallet.ts:55`) con el valor nuevo,
      doble candado intacto.
      *Depende de:* T1.20.
      *Hecho cuando:* `tsc` verde y test que afirma que el SEED contiene el valor y que el build rompe
      si divergiera (comprobado a mano quitándolo).
- [ ] **T1.22** [P] Test estático de la migración del admin
      (`tests/integration/db/orden-incidente-migration.test.ts`): UP aditivo, las dos tablas con RLS, el
      índice único parcial presente, el down recrea el enum con los **6** previos y suelta las tablas,
      precondición documentada (R37/R39/R40).
      *Depende de:* T1.19.
      *Hecho cuando:* pasa y **`pnpm vitest run tests/integration/db` completo sigue verde**.

### Mapa de estados del admin

- [ ] **T1.23** Declarar en `lib/types/order-status-transiciones.ts` las **10 aristas** restantes:
      entradas **#48-#52** (los 5 orígenes → `incidente`, `via: "incidente"`) e inversas **#54-#58**,
      con el `rol` calcado de las vecinas según la tabla de `design.md` §12.3.
      *Depende de:* T1.20.
      *Hecho cuando:* R61/R62 con test — las 10 son legales, `incidente` sigue TERMINAL y alcanzable, el
      resto del catálogo sigue ilegal desde `incidente`, el recuento del fixture queda en **52 / 50** y
      los dos tests de conectividad genéricos siguen verdes **sin tocarlos**.
- [ ] **T1.24** Actualizar el fixture `tests/fixtures/inventario-transiciones-140.ts` con las 10 filas
      nuevas transcritas a mano y el recuento; y los asserts de recuento de `guardia.test.ts`.
      *Depende de:* T1.23.
      *Hecho cuando:* «el mapa declara exactamente las aristas del inventario» pasa, que es el test que
      garantiza que no se olvidó ninguna.

### Reporte, aprobación y egreso del admin

- [ ] **T1.25** Borde zod `lib/types/incidente.ts`: `reportarIncidenteSchema` (causa del enum cerrado,
      motivo no vacío, `evidencias` 1..N reusando `evidenciasSchema`), `aprobarIncidenteSchema`
      (`montoPositivoSchema`), `rechazarIncidenteSchema` (motivo no vacío).
      *Depende de:* T1.20.
      *Hecho cuando:* R45/R46/R50/R55 con test de borde: causa fuera de lista, motivo vacío, lista de
      fotos vacía, monto vacío/0/negativo/3 decimales/con coma → `validation_error`.
- [ ] **T1.26** `IncidenteAdminRepository.reportar` (design §12.5): `$transaction` con el
      `orden.updateMany` **guardado por los 5 estados** + `deletedAt: null`, el `create` del incidente en
      `solicitado`, las N evidencias y el `appendCambioEstado` con `origen_tipo = incidente`.
      *Depende de:* T1.23, T1.25.
      *Hecho cuando:* R41/R42/R43/R44/R47 con test: transición atómica desde cada uno de los 5 estados;
      desde cualquier otro estado o con la orden borrada → **cero efectos** (ni fila, ni transición, ni
      historial); segundo reporte vivo → rechazado **por el índice único parcial** (test de integración,
      no sólo por la comprobación previa); y cero movimientos de dinero.
- [ ] **T1.27** `WalletIndemnizacionIncidenteFeed` + `IncidenteAdminRepository.resolver`: `updateMany`
      guardado por `estado = 'solicitado'` + alcance, escritura del monto, y emisión de **UN** egreso
      `egreso_indemnizacion` con `origen_tipo = orden_incidente`, todo en la MISMA `tx`. El feed **lee de
      la base lo que la tx acaba de escribir**, no recibe el monto por parámetro.
      *Depende de:* T1.26.
      *Hecho cuando:* R52/R53 con test: aprobar emite 1 movimiento con `tipo/categoria/origen_tipo/
      origen_id` exactos y monto igual al persistido; un fallo en cualquier paso deja TODO sin aplicar;
      reintentar no duplica (índice único parcial de la 42); y **el guard de T1.15 pasa a declarar DOS
      emisores** (R29 reescrito), no uno permisivo.
- [ ] **T1.28** `IncidenteAdminService`: alcance por rol/zona en el WHERE del repo, **R51 (quien reporta
      no aprueba)**, subida secuencial y **compensada** de las N evidencias antes de la transacción
      (molde de `MisAsignacionesService:340-372`), y las dos colas de listado.
      *Depende de:* T1.27.
      *Hecho cuando:* R48/R49/R51 con test: `adminSatelite` de otra zona → sin filtrar datos; rol no
      autorizado → `forbidden`; **autor == resolutor → `conflict` sin efectos**; y un fallo de subida no
      deja objetos huérfanos en el bucket.
- [ ] **T1.29** Reversión (design §13.2): `rechazar` y `retractar` — leen el estado de origen con
      **`IOrdenHistorialRepository.findOrigenesReversion` (feature 149, reusado tal cual)**, lo validan
      contra el conjunto CERRADO de los 5, resuelven su id y devuelven la orden ahí, todo en la misma
      `tx` que marca el incidente.
      *Depende de:* T1.28.
      *Hecho cuando:* R54/R57/R58/R59/R60 con test: destino = origen real (uno por cada uno de los 5);
      historial sin origen o con un origen fuera del conjunto → `conflict` **sin mover nada**;
      `aprobado` → reversión rechazada con mensaje propio; rechazo sin motivo → `validation_error`; y
      `mensajero_asignado_id`/`asignado_at` quedan **byte-idénticos** a antes del reporte.
- [ ] **T1.30** [P] Aislamiento del camino del admin (R38/R56/R63): tests de que un incidente de admin
      **no** hace que `CorteDiarioRepository.findMensajerosConActividadSinCierre` devuelva a su autor,
      **no** entra en `RankingRepository.contarEntregadasPorMensajero`, **no** se vincula a ningún cierre
      del día ni altera sus totales, **no** toca el ledger por tienda, y que una orden **no** puede
      acumular dos egresos de indemnización por ninguna combinación de los dos caminos.
      *Depende de:* T1.27.
      *Hecho cuando:* los cinco pasan y el de la doble indemnización está escrito como invariante, no
      como comentario.
- [ ] **T1.31** Server Actions `lib/actions/incidentes.ts` + composition root (inyección de repos,
      `SignedUrlProvider`, storage y el feed nuevo), con el mismo `withErrorHandler` y el mismo mapeo
      `ZodError → validation_error` que `lib/actions/cierres-admin.ts`.
      *Depende de:* T1.29.
      *Hecho cuando:* `tests/integration/actions/incidentes-action.test.ts` cubre los cuatro verbos
      (reportar/aprobar/rechazar/retractar) con sus resultados de dominio.
- [ ] **T1.32** Cierre de fase F1B: `./init.sh` + suite completa en verde, `tests/integration/db`
      completo; mapa R→test de R37-R64 en el impl.
      *Depende de:* T1.19-T1.31.
      *Hecho cuando:* no queda ningún R de I-M sin test citado.

---

## Fase 2 — Frontend del camino del MENSAJERO (arranca con la Fase 1 en verde)

- [ ] **T2.1** Panel del mensajero (`GestionarOrdenPanel.tsx`): `type Resultado` (`:50`),
      `RESULTADO_BOTONES` (`:63`) con "Reportar incidente" visualmente separado, rama en `buildRaw`
      (`:227`) y `buildFormData` (`:261`), `CausaIncidenteField` + `causa-incidente-options.ts`
      (etiquetas en español para los 3 valores).
      *Depende de:* T1.18.
      *Hecho cuando:* R33/R12/R10 con test de componente: aparece la opción; el gate de guía sigue
      exigiéndose; **el selector de fotos se exige en las TRES causas** (Q-B) y el copy dice qué
      fotografiar cuando no hay paquete; el envío inválido muestra error por campo sin llamar a la
      action; el envío válido manda el `FormData` esperado.
- [ ] **T2.2** [P] Detalle del cierre del mensajero (`CierreDiaModule.tsx`): grupo "Incidentes"
      (sin montos de dinero).
      *Depende de:* T1.18.
      *Hecho cuando:* R18 con test de componente; el grupo vacío no se pinta (patrón actual).
- [ ] **T2.3** Detalle del admin (`cierre-detalle-shared.tsx:30,37,176,742`): etiquetas, orden de
      grupos y columnas del grupo `incidente` (causa, motivo, evidencias, monto o `—`).
      *Depende de:* T1.18.
      *Hecho cuando:* R18 con test de componente y las evidencias se abren firmadas como en el resto.
- [ ] **T2.4** Sub-modal de captura al aprobar (`CierresAdminModule.tsx:187,461`), espejo del de
      rechazo: una fila por incidente, confirmación deshabilitada mientras falte o sea inválido algún
      monto, errores del servidor pintados por fila.
      *Depende de:* T2.3.
      *Hecho cuando:* R34 con test de componente: sin incidentes aprueba directo (R36); con
      incidentes no deja confirmar hasta completar; envía `{ cierreId, indemnizaciones }`.
- [ ] **T2.5** [P] Wallet (`wallet-labels.ts:31` + `DesgloseEgresosCard.tsx:15`): etiqueta del
      concepto, fila "Indemnizaciones" y copy del título de la tarjeta (deja de ser sólo
      "administrativos").
      *Depende de:* T1.18.
      *Hecho cuando:* R31/R32 con test de componente: el concepto aparece en el libro, en el filtro de
      categoría y en el desglose, con montos renderizados TAL CUAL (sin `parseFloat`).
- [ ] **T2.6** Cierre de fase frontend del camino del mensajero: `./init.sh` + suite completa (incluidos
      tests de componente) en verde; mapa R→test completo (R1-R36) en
      `progress/impl_158-incidente-indemnizacion.md`.
      *Depende de:* T2.1-T2.5.
      *Hecho cuando:* el reviewer puede recorrer cada R hasta un test concreto.

---

## Fase 2B — Frontend del camino del ADMIN (arranca con F1B en verde)

> **T0.6 (Q-H y Q-I) BLOQUEA esta fase entera.** Las tasks se escriben contra la recomendación del
> diseño; si el humano decide otra cosa, cambia el sitio, no el contenido.

- [ ] **T2.7** Modal de reporte `app/(app)/ordenes/_components/ReportarIncidenteModal.tsx`, abierto desde
      la acción de fila del listado, visible **sólo** si el estado de la orden está en los 5 y el rol lo
      permite. Calcado de `RecuperarABodegaModal` (100) y `DeshacerAsignacionModal` (149). Causa en radios
      (`causa-incidente-options.ts`, reusado de T2.1), motivo obligatorio y selector de 1..N fotos con los
      mismos límites que el panel del mensajero.
      *Depende de:* T1.32, T0.6.
      *Hecho cuando:* R45/R46 con test de componente: no aparece en estados fuera de los 5 ni para roles
      no autorizados; no deja enviar sin causa, sin motivo o sin al menos una foto; y el envío válido
      llama a la action con la forma esperada.
- [ ] **T2.8** Cola de aprobación `app/(app)/incidentes/` + `IncidentesAdminModule.tsx`, espejo de
      `CierresAdminModule`: **dos** `DataTable` («Pendientes de decisión» + «Histórico»), modal de detalle
      con causa, motivo, evidencias **firmadas** y datos de la orden; sub-modal de aprobación con el
      `Input` de monto (confirmar deshabilitado mientras el monto no sea válido, mismo criterio
      `montoValido` que el servidor) y sub-modal de rechazo con motivo obligatorio, calcado de
      `CierresAdminModule:471-513`. Entrada nueva en `lib/auth/menu-visibility.ts`.
      *Depende de:* T1.32, T0.6.
      *Hecho cuando:* R49/R50/R54 con test de componente: las dos colas se pintan; no deja aprobar con
      monto inválido; no deja rechazar sin motivo; los montos se renderizan **TAL CUAL** (sin
      `parseFloat`); y el menú sólo lo muestra a los roles autorizados.
- [ ] **T2.9** [P] **R51 en la interfaz**: en un incidente reportado por el propio actor, las acciones de
      decisión aparecen deshabilitadas con el motivo visible («no podés aprobar un incidente que
      reportaste vos»), y el servidor lo vuelve a rechazar.
      *Depende de:* T2.8.
      *Hecho cuando:* test de componente + el test de servidor de T1.28 citados juntos en el mapa: la
      regla está en los **dos** lados, no sólo en el cliente.
- [ ] **T2.10** Cierre de fase F2B: `./init.sh` + suite completa en verde; mapa R→test completo (R1-R64).
      *Depende de:* T2.7-T2.9.
      *Hecho cuando:* el reviewer puede recorrer cada uno de los 64 R hasta un test concreto.

---

## Verificación final (definición de "hecho" de la feature)

- [ ] **T3.1** Prueba de humo manual del camino del MENSAJERO, documentada en el impl: mensajero reporta
      un incidente con causa `robado` y **una foto** → la orden queda `incidente` y no se puede mover;
      deshace y vuelve a `en_reparto`; reporta otra vez y solicita cierre → el incidente aparece en el
      detalle; el admin aprueba capturando el monto → aparece UN egreso `egreso_indemnizacion` en la
      wallet, con el monto exacto, y el desglose lo suma.
- [ ] **T3.2** *(nueva)* Prueba de humo manual del camino del ADMIN, documentada en el impl: admin reporta
      un incidente sobre una orden en `en_bodega_central` → la orden queda `incidente` y aparece en
      «Pendientes de decisión»; **el mismo admin NO puede aprobarlo**; otro admin lo rechaza → la orden
      **vuelve a `en_bodega_central`** y no hay movimiento; se reporta de nuevo y el segundo admin lo
      aprueba con monto → UN egreso `egreso_indemnizacion` con `origen_tipo = orden_incidente`, y
      reintentar la aprobación **no** duplica.
- [ ] **T3.3** Round-trip de migraciones sobre la base local: `pnpm run db:rollback` + `pnpm run
      db:migrate` sin error para **las dos** migraciones, con los datos de las pruebas de humo BORRADOS
      antes (la precondición de los dos `down` es que ninguna fila use los valores nuevos).
- [ ] **T3.4** `feature_list.json` (158 → `done`) y `progress/current.md` actualizados; nada de
      código de producción sin su commit `feat(158-incidente-indemnizacion): …`.
- [ ] **T3.5** *(nueva)* Verificar que el **follow-up de Q-E** («crédito de indemnización en el ledger por
      tienda», feature 43) quedó registrado por el leader, y que Q-J tiene respuesta o ficha.
