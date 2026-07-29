# Feature 158 — Tasks

> `requirements.md` (R1-R36) · `design.md` (§1-§11).
> Zona **fullstack**: la implementación se secuencia **backend (F1) → frontend (F2)**. Dentro de cada
> fase, `[P]` marca lo que puede ir en paralelo con sus hermanas de la misma fase (no tocan los
> mismos archivos).
> Regla del repo: **un commit por task lógica**; nada se da por hecho sin `./init.sh` y tests en verde.

---

## Fase 0 — Puerta (BLOQUEANTE, antes de tocar código)

- [ ] **T0.1** Cerrar con el humano **Q-A** (quién reporta), **Q-B** (causa tipada + evidencia, e
      idioma de los valores del enum) y **Q-D** (¿se deshace un incidente?).
      *Hecho cuando:* las tres decisiones quedan escritas en `progress/current.md` y, si difieren de
      la recomendación, este spec se corrige ANTES de implementar.
      *Bloquea:* T1.2, T1.4, T1.5, T1.6.
- [ ] **T0.2** [P] Confirmar **Q-G** (familia de historial `incidente` vs `gestion`) contra el spec
      de la 154, y si procede acordar el ajuste del metadato `via` de la arista.
      *Hecho cuando:* queda anotado qué `origen_tipo` escribe el append, y la 154 no lo contradice.
      *Bloquea:* T1.6.
- [ ] **T0.3** [P] Confirmar **Q-E** (¿crédito a la tienda?) — si es "sí", NO se implementa aquí: se
      registra como feature nueva en el backlog.
      *Hecho cuando:* hay respuesta escrita; si es "sí", existe la ficha de follow-up.
- [ ] **T0.4** [P] Confirmar **Q-F** (down.sql previos).
      *Hecho cuando:* está decidido si `20260713140000_.../down.sql` se reescribe (y, en ese caso,
      también su test) o se deja punto-en-el-tiempo.

---

## Fase 1 — Backend

### Datos y catálogos

- [ ] **T1.1** Migración `db/migrations/<ts>_incidente_indemnizacion/` con `migration.sql` + `down.sql`
      (design §3.4): dos `ALTER TYPE … ADD VALUE IF NOT EXISTS` + `ALTER TABLE gestion_orden ADD
      COLUMN indemnizacion DECIMAL(12,2)`; el down suelta la columna y recrea los dos enums (con el
      drop/recreate de los DOS índices que referencian `wallet_movimiento.categoria`).
      *Depende de:* —.
      *Hecho cuando:* `pnpm run db:migrate` aplica sin error; `pnpm run db:rollback` revierte y una
      segunda `db:migrate` vuelve a aplicar (round-trip up→down→up) contra la base local; el UP no
      contiene `INSERT`/`UPDATE` ni toca RLS.
- [ ] **T1.2** `db/schema.prisma`: `GestionResultado + incidente` (`:551`),
      `WalletMovimientoCategoria + egreso_indemnizacion` (`:844`), `GestionOrden.indemnizacion`
      (`:580`) y —si Q-B = sí— el enum `GestionCausaIncidente` + su columna.
      *Depende de:* T1.1, T0.1.
      *Hecho cuando:* `prisma generate` corre limpio y `prisma migrate status` no reporta drift.
- [ ] **T1.3** [P] SEED/tipos de dominio: `WALLET_MOVIMIENTO_CATEGORIA_SEED`
      (`lib/types/wallet.ts:27`) con el valor nuevo (doble candado intacto).
      *Depende de:* T1.2.
      *Hecho cuando:* `tsc` en verde y un test afirma que el SEED contiene `egreso_indemnizacion`.
- [ ] **T1.4** [P] (Si Q-B = sí) `lib/types/causa-incidente.ts` calcado de
      `lib/types/causa-devolucion.ts`: SEED cerrado de 3 valores + `satisfies` + `_EnsureExhaustive`.
      *Depende de:* T1.2, T0.1.
      *Hecho cuando:* el build rompe si el enum y el SEED divergen (comprobado a mano quitando un
      valor) y hay test de la lista cerrada.
- [ ] **T1.5** Test estático de la migración
      (`tests/integration/db/incidente-indemnizacion-migration.test.ts`), patrón
      `wallet-egreso-migration.test.ts`: UP aditivo, down recrea ambos enums sin los valores nuevos,
      `USING` cast presente, índices recreados, sin RLS.
      *Depende de:* T1.1.
      *Hecho cuando:* pasa, y **`pnpm vitest run tests/integration/db` completo queda en verde**
      (regla del lote: un value de enum nuevo puede romper los tests de migraciones previas).

### Flujo de la gestión

- [ ] **T1.6** Arista de deshacer y clasificación exhaustiva: `incidente → en_reparto` vía
      `deshacer_gestion` en `lib/types/order-status-transiciones.ts` (si Q-D = sí) y
      `ESTADOS_ESPERADOS.incidente` en `lib/services/CierreDiaService.ts:78`.
      *Depende de:* T1.2, T0.1, T0.2.
      *Hecho cuando:* R13/R14/R15 tienen test: se deshace con `cierre_id IS NULL`; conflicto si ya
      está en un cierre; ningún otro camino (cron SLA, liberación al aprobar, recuperación manual,
      ajuste admin) puede sacar la orden de `incidente`.
- [ ] **T1.7** Borde zod: quinta variante `incidente` en `gestionarUnionSchema`
      (`lib/types/gestion-orden.ts:121`) con causa/motivo/evidencias según Q-B.
      *Depende de:* T1.4.
      *Hecho cuando:* tests de schema cubren R9/R10/R11 y demuestran que los campos nuevos NO se
      aceptan en las otras cuatro ramas.
- [ ] **T1.8** `MisAsignacionesService.gestionar`: `case "incidente"` en `buildGestionData` (`:474`)
      y, si aplica, alta en la lista de resultados con evidencia (`:333`). Sin tocar guardias,
      bloqueo 1-a-1 ni compensación de Storage.
      *Depende de:* T1.7.
      *Hecho cuando:* R6/R7/R8 con test: transición atómica a `incidente`; rechazo sin efectos desde
      un estado que no es `en_reparto`, con orden ajena o con mensajero bloqueado; rastro en el
      historial con la familia acordada en T0.2.
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
- [ ] **T1.15** [P] Guard de "un solo productor" (R29): test estructural que verifica que
      `egreso_indemnizacion` se emite desde un único punto de `lib/` (patrón
      `tests/unit/repositories/cierre-detail-inmutable.test.ts`).
      *Depende de:* T1.14.
      *Hecho cuando:* el test falla si aparece un segundo emisor.
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
- [ ] **T1.18** Cierre de fase backend: `./init.sh` + suite completa en verde, `tests/integration/db`
      incluido; mapa R→test actualizado en `progress/impl_158-incidente-indemnizacion.md`.
      *Depende de:* T1.1-T1.17.
      *Hecho cuando:* no queda ningún R de las secciones A-F sin test citado.

---

## Fase 2 — Frontend (arranca con la Fase 1 en verde)

- [ ] **T2.1** Panel del mensajero (`GestionarOrdenPanel.tsx`): `type Resultado` (`:50`),
      `RESULTADO_BOTONES` (`:63`) con "Reportar incidente" visualmente separado, rama en `buildRaw`
      (`:227`) y `buildFormData` (`:261`), `CausaIncidenteField` + `causa-incidente-options.ts`.
      *Depende de:* T1.18.
      *Hecho cuando:* R33/R12 con test de componente: aparece la opción; el gate de guía sigue
      exigiéndose; el envío inválido muestra error por campo sin llamar a la action; el envío válido
      manda el `FormData` esperado.
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
- [ ] **T2.6** Cierre de fase frontend: `./init.sh` + suite completa (incluidos tests de componente)
      en verde; mapa R→test completo (R1-R36) en `progress/impl_158-incidente-indemnizacion.md`.
      *Depende de:* T2.1-T2.5.
      *Hecho cuando:* el reviewer puede recorrer cada R hasta un test concreto.

---

## Verificación final (definición de "hecho" de la feature)

- [ ] **T3.1** Prueba de humo manual documentada en el impl: mensajero reporta un incidente → la
      orden queda `incidente` y no se puede mover; solicita cierre → el incidente aparece en el
      detalle; el admin aprueba capturando el monto → aparece UN egreso `egreso_indemnizacion` en la
      wallet, con el monto exacto, y el desglose lo suma.
- [ ] **T3.2** `pnpm run db:rollback` + `pnpm run db:migrate` sobre la base local sin error (round-trip
      de T1.1 revalidado al final, con datos de la prueba de humo BORRADOS antes: la precondición del
      down es que ninguna fila use los valores nuevos).
- [ ] **T3.3** `feature_list.json` (158 → `done`) y `progress/current.md` actualizados; nada de
      código de producción sin su commit `feat(158-incidente-indemnizacion): …`.
