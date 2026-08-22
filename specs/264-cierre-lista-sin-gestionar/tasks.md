# Feature 264 — Tasks

Convenciones: `[P]` = paralelizable con las tasks de su mismo bloque; `dep:` = no arranca
hasta que esa esté hecha. Cada task lleva su criterio de **hecho** (verificable, no
«revisado»). **Ningún subagente corre la suite completa** (`AGENTS.md > Regla del gate`):
`backend_dev`/`frontend_dev` corren `typecheck`, `lint` y `vitest related --run <sus
archivos>`; el gate lo corre el leader.

⚠️ **El gate de esta feature es `./init.sh` COMPLETO.** `--rapido` se niega solo: el diff toca
`db/migrations/**`, `db/schema.prisma` y archivos con `cierre` en el nombre (lista de dinero).
No es un aviso, es un `fail`.

✅ **Las ocho preguntas abiertas están resueltas** (humano, 2026-08-22) y viven como R27–R34 o
como límites declarados. No queda nada que preguntar antes de implementar.

---

## Bloque BACKEND

### B1 — Modelo + migración `cierre_sin_gestion`
`db/schema.prisma`, `db/migrations/<ts>_cierre_sin_gestion/{migration.sql,down.sql}`

- Modelo `CierreSinGestion` tal como está en `design.md §2.1` (seis descriptivos,
  `estatus_origen_id` nullable, `@@unique([cierreId, ordenId])`, `@@index([ordenId])`,
  `@@map("cierre_sin_gestion")`), más los lados inversos en `CierreDia`, `Orden` y
  `OrderStatus`.
- `migration.sql` escrito a mano con el molde de `cierre_detail`: tabla, dos índices, tres FK
  `ON DELETE RESTRICT ON UPDATE CASCADE`, `ENABLE ROW LEVEL SECURITY` **sin policies**, y el
  `INSERT … SELECT` del backfill acotado a `estado IN ('solicitado','vencido','rechazado')`
  **con el `LEFT JOIN LATERAL` que recupera `estatus_origen_id` del historial** (R33).
- **[Q3]** `cierre_dia.sin_gestion_registrado BOOLEAN NOT NULL DEFAULT true` (campo
  `sinGestionRegistrado` en el modelo `CierreDia`) + el `UPDATE … SET false WHERE estado NOT
  IN ('solicitado','vencido','rechazado')` (R27/R29).
- `down.sql` con `DROP TABLE "cierre_sin_gestion";` **y** el `ALTER TABLE "cierre_dia" DROP
  COLUMN "sin_gestion_registrado";`.
- **Hecho:** `pnpm exec prisma validate` en verde, `pnpm exec prisma migrate diff` sin
  diferencias pendientes entre schema y SQL, y round-trip **ejecutado** (`pnpm run db:migrate`
  → `pnpm run db:rollback` → `pnpm run db:migrate`) con la salida pegada en
  `progress/impl_264.md`. Ni una columna `DECIMAL` en la tabla.

### B2 — Cobertura estática de la migración `[P]` · dep: B1
`tests/integration/db/cierre-sin-gestion-migration.test.ts` (nuevo)

Patrón `cierre-detail-migration.test.ts` (lee `migration.sql`/`down.sql` por regex, con
`sinComentarios()` para las aserciones de ausencia).

- Tabla, pkey, unique `(cierre_id, orden_id)`, índice por `orden_id`, las tres FK con
  `RESTRICT`, `ENABLE ROW LEVEL SECURITY` (**R23**), y `DROP TABLE` en el down (**R24**).
- El backfill: menciona los tres estados abiertos **y NO menciona `aprobado`** (**R25/R26**),
  filtra `deleted_at IS NULL`, resuelve `sin_gestionar` por `order_status.value` y trae el
  `LEFT JOIN LATERAL` sobre `orden_historial_estado` con `origen_tipo =
  'corte_sin_gestionar'` y `ORDER BY … created_at DESC LIMIT 1` (**R33**) — `LEFT`, no `JOIN`.
- La marca: `ADD COLUMN "sin_gestion_registrado" BOOLEAN NOT NULL DEFAULT true` y el `UPDATE`
  que la baja a `false` fuera de los tres estados abiertos (**R27/R29**); el `down.sql` la
  suelta (**R24**).
- **Ausencia comprobada sobre el SQL ejecutable:** ni `DECIMAL`, ni `monto`, ni `pago`, ni
  `tarifa`, ni `ingreso`, ni `comision` en el `CREATE TABLE` (**R10**).
- **Hecho:** el archivo corre en verde y **muere con M6 y M7** (bloque M).

### B3 — Escritura del vínculo en la transacción del corte · dep: B1
`lib/repositories/CierreDiaRepository.ts` (bloque `corteSinGestionar`, ~`:558-606`)

- El pre-`SELECT` de cada vuelta proyecta además `numGuia`, `numRemision`, `destinatario`,
  `producto`, `tienda: { select: { nombre } }`, `zona: { select: { nombre } }`.
- Tras el `updateMany`, si `movidas.count > 0`: `tx.cierreSinGestion.createMany({ data,
  skipDuplicates: true })` con `estatusOrigenId = origenEstatusId` **de esa vuelta**.
- Ni una línea toca totales, `pago_mensajero`, `ingreso_bodega_rechazo` ni el snapshot.
- **Hecho:** casos nuevos en `tests/unit/repositories/cierre-dia-repository.test.ts` que
  cubren **R2** (se escribe en la misma tx, con las mismas filas que el `updateMany` movió),
  **R3** (tx revertida ⇒ cero filas), **R4** (una vuelta `en_reparto` y otra `ayuda_tienda`,
  cada fila con SU origen) y **R6** (`crearCierre` sin `corteSinGestionar` ⇒ cero filas).

### B4 — Lectura en el repositorio del detalle · dep: B1
`lib/repositories/CierresAdminRepository.ts` (`findCierreByIdEnAlcance`, `:1007-1045`),
`lib/interfaces/repositories/ICierresAdminRepository.ts`

- Tercera consulta dentro del `Promise.all` existente: `where: { cierreId }`, `orderBy:
  [{ numGuia: "asc" }, { numRemision: "asc" }]`, `select` sin `createdAt`.
- El tipo de retorno gana `sinGestion: CierreSinGestionRow[]`.
- **Hecho:** `tests/unit/repositories/cierres-admin-repository.test.ts` cubre la forma del
  retorno y el `orderBy` (**R12**); typecheck en verde en los dos consumidores del método.

### B5 — Contrato de servicio y mapeo a DTO · dep: B4
`lib/interfaces/services/ICierresAdminService.ts`, `lib/services/CierresAdminService.ts`

- `CierreOrdenSinGestion`, `ordenesSinGestion` **y `sinGestionRegistrado`** en
  `CierreDetalleAdminServiceResult` (`design.md §6`), con el comentario que dice **por qué**
  no lleva dinero y **por qué los dos campos viajan juntos** (`[]` + `false` = «no lo
  sabemos», no «ninguna»).
- Mapeo directo, sin firmar URLs, sin tocar `totalesIngreso`, `ganancia`, `pagoTienda` ni
  `desgloseIngresoBodegaRechazos`.
- **Hecho:** casos en `tests/unit/services/cierres-admin-service.test.ts` para **R9** (los
  ocho campos, con `numGuia: null` y `estatusOrigen: null` como casos vivos), **R8** (fuera
  de alcance ⇒ `no_encontrada`, sin lista y sin consultar el detalle) y **R27** (un cierre
  marcado `false` emite `sinGestionRegistrado: false` con `ordenesSinGestion: []`).

### B6 — Guardia «esta lista no toca dinero» `[P]` · dep: B5
`tests/unit/guards/cierre-sin-gestion-sin-dinero.guardia.test.ts` (nuevo)

Recorre el árbol (no importa lo que vigila, como el resto de guardias) y exige que **ni la
interfaz `CierreOrdenSinGestion` ni el modelo `CierreSinGestion`** contengan campos cuyo
nombre esté en el vocabulario de dinero del repo (`monto`, `pago`, `cobro`, `ingreso`,
`tarifa`, `comision`, `flete`, `indemnizacion`, `total`) ni ningún `Decimal`.

- **Hecho:** verde hoy y **roja con M7**. Si no se pone roja, la guardia no vale: reescribirla
  antes de seguir.

### B7 — El SQL de verdad, contra Postgres · dep: B4
`tests/integration/db/cierre-sin-gestion-sql-real.test.ts` (nuevo)

Molde exacto de `tests/integration/db/cierres-admin-retornables-sql-real.test.ts`:
`describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip`, `crearPrismaDeTest`,
`enTransaccionRevertida`, `fksDeOrden` (con **error ruidoso** si no hay catálogo, nunca un
`return` silencioso), `serializarEscriturasReales` como primera sentencia.

Corpus: **un cierre `vencido` con órdenes barridas** más los señuelos, uno por condición del
`WHERE`:

| semilla | qué demuestra |
| --- | --- |
| 2 órdenes barridas de ESTE cierre | **R1/R7**: salen las dos |
| 1 barrida de OTRO cierre del mismo mensajero | **R7**: no se cuela |
| 1 barrida de otro mensajero | **R7**: no se cuela |
| 1 sin guía (`num_guia = null`) | **R9/R12**: viaja `null` y ordena estable |
| 1 con la orden ya LIBERADA (estatus a bodega, `mensajero_asignado_id = NULL`) | **R5**: la fila sigue apareciendo |
| 1 cuyo `orden.destinatario` se cambia después de sembrar | **R11**: se devuelve el congelado, no el vivo |

- **Hecho:** verde con base alcanzable, **SKIPPED** (visible en la salida) sin ella, y
  **muerto por M1, M2 y M3** (bloque M). La salida de las tres mutaciones va a
  `progress/impl_264.md`.

### B8 — La aprobación sigue moviendo exactamente el mismo dinero `[P]` · dep: B3
`tests/unit/services/cierres-admin-service.aprobar.sin-gestion.test.ts` (nuevo)

Dos aprobaciones del **mismo** cierre semilla, una con filas de `cierre_sin_gestion` y otra
sin ellas: los movimientos emitidos a los cinco feeds deben ser **iguales campo a campo**
(**R22**). La liberación de las órdenes `sin_gestionar` no cambia (sigue siendo la de la 109)
y las filas del vínculo **no se borran** (**R5**).

- **Hecho:** verde, y **rojo con M8**.

### B9 — [Q1] El mismo par de campos en el camino del MENSAJERO `[P]` · dep: B1
`lib/interfaces/services/ICierreDiaService.ts`, `lib/services/CierreDiaService.ts`,
`lib/repositories/CierreDiaRepository.ts` (el detalle propio, ~`:760`),
`lib/interfaces/repositories/ICierreDiaRepository.ts`

- `VerCierrePasadoServiceResult` gana `ordenesSinGestion` y `sinGestionRegistrado`.
- Consulta gemela a la de B4, colgada del `cierre_id` ya acotado por `mensajero_id` en el
  WHERE: **no se añade guardia nueva ni se filtra en memoria**.
- Ni una URL firmada, ni un monto, ni un cambio en `grupos` ni en los totales del mensajero.
- **Hecho:** casos en `tests/unit/repositories/cierre-dia-repository.test.ts` y
  `tests/unit/services/` del cierre del día que cubren **R30** por el lado de los datos: el
  detalle propio trae la lista del cierre y **solo** la de ese cierre; un cierre ajeno sigue
  cayendo en `no_encontrada` sin distinguirse.

---

## Bloque FRONTEND

> Arranca cuando **B5** está hecho (el prop existe y está tipado). F1–F4 son de un solo
> archivo de componente, así que entre sí van en secuencia.

### F1 — Sección «Órdenes sin gestionar» · dep: B5
`app/(app)/cierres-admin/_components/cierre-factura.tsx`

- Props `ordenesSinGestion?: CierreOrdenSinGestion[]` y `sinGestionRegistrado?: boolean`
  (default `true`) en `CierreFacturaDetalleProps`.
- Nueva `<section aria-label="Órdenes sin gestionar">` **hermana** de la de pestañas y
  **antes** del pie (`design.md §3`), con encabezado, píldora de conteo (tono `warning`) y la
  nota fija.
- **Los tres estados de `design.md §3.1`**: lista + conteo; nada; o **el aviso** «Este cierre
  es anterior al registro de órdenes sin gestionar: no se conserva la lista.» cuando
  `sinGestionRegistrado === false` (**R28**) — con lista vacía y con lista, el aviso manda.
- Filas **no desplegables y sin acciones** (`<div>` de rejilla, no `<button aria-expanded>`,
  **R31**), tres columnas: Guía (`—` si `null`), Destinatario con `remisión · producto`
  debajo, Tienda. El estado de origen se pinta traducido junto al producto y **se omite** si
  llega `null` (**R32**). **Sin `slice` ni tope** (**R34**).
- Rótulos como constantes en la zona de etiquetas del archivo (i18n-ready), igual que
  `FILA_GUIA_COL` y compañía.
- `break-inside-avoid` en el encabezado de la sección y en cada fila (feature 223).
- **Hecho:** `TAB_TONO`, `ORDEN_RESULTADOS`, `RESULTADO_LABEL` y `RESULTADO_VACIO` **no se
  tocan** (`git diff` lo demuestra) y el `tablist` sigue emitiendo cinco `role="tab"`.

### F2 — [Q1] Cablear las DOS superficies · dep: F1, B9
`app/(app)/cierres-admin/_components/CierresAdminModule.tsx`,
`app/(app)/cierre-dia/_components/CierreDiaModule.tsx`

- Admin (`:1116`): `ordenesSinGestion={detalle.ordenesSinGestion}` y
  `sinGestionRegistrado={detalle.sinGestionRegistrado}`.
- Mensajero (`:857`): las **mismas dos props** desde el detalle propio (B9). El estado local
  que hoy guarda `detalleGrupos` pasa a guardar también estos dos campos.
- **Hecho:** las dos pantallas pintan la sección con el mismo cierre semilla. El componente es
  uno: que pintara en una y callara en otra es el error corregido en la 263 (**R30**).

### F3 — Tests de componente · dep: F1
`tests/components/CierreFacturaSinGestionar.test.tsx` (nuevo, `// @vitest-environment jsdom`)

Con un detalle sembrado **con 3 órdenes sin gestionar y 1 entrega**:

- **R13** la sección existe con su nombre accesible; **R14** hay exactamente cinco `role="tab"`;
  **R15** con `[]` **y `sinGestionRegistrado: true`** la sección **no** está en el DOM;
  **R16** el conteo visible dice `3`; **R17** la nota aparece con su **texto literal**;
  **R18** están Guía / Destinatario / Tienda y **no** están «Cobrado», «Recibido», «Ingreso
  total», «Pago al mensajero», «Ver evidencia» dentro de la sección.
- **R28 — los tres estados, en tres casos separados.** Con `sinGestionRegistrado: false` y
  `[]`: **aparece el aviso** con su texto literal y **no** aparece ningún texto que sugiera
  «ninguna». Comprobar además que ese caso **no** se renderiza igual que el de R15: son dos
  DOM distintos, y ésa es toda la feature Q3.
- **R31** dentro de la sección no hay ni un `role="button"`, ni un `<a>`, ni un
  `aria-expanded`. **R32** una fila con `estatusOrigen: null` **no** contiene «—» en el lugar
  del estado (se compara el texto de ESA fila, no el de la sección). **R34** con 60 órdenes
  sembradas se pintan **60** filas.
- **R19/R20/R21 — el bloque de dinero.** Los montos se comparan contra **literales
  esperados**, no contra las props que los generan: el pie sigue diciendo el mismo «Total
  recaudado» y «1 entregas», los KPI y renglones (general, métodos, ingreso, pago al
  mensajero, ganancia, pago a tienda, ingreso de bodega) valen lo mismo, y el KPI de conteo
  dice **1**, no 4, **bajo el rótulo «Gestiones»** (Q4: el rótulo es parte del requisito —
  «Órdenes: 1» con tres órdenes debajo es el error de lectura que R21 prohíbe).

⚠️ **Prohibido** el caso «con lista vacía los montos no cambian» como cobertura de R19/R20:
es verde por construcción (es el estado de hoy) y no protege nada (`design.md §8.3`).
⚠️ **Prohibido** comparar un rótulo contra la constante que lo emite: se compara contra el
texto literal visible.

- **Hecho:** verde, y **rojo con M4 y M5**.

### F4 — Inventario de contraste `[P]` · dep: F1
`tests/unit/guards/factura-contraste.guardia.test.ts`

La guardia mantiene un inventario **cerrado** de pares (tinta, fondo) de las dos hojas: hay
que dar de alta los de la sección nueva (píldora `warning`, nota `muted-foreground`).

- **Hecho:** la guardia en verde **sin** relajar su criterio ni ampliar su lista de
  exclusiones; el par nuevo entra con su medida, no con una excepción.

### F5 — [Q1] Guardia: toda superficie que renderice el detalle pasa las props `[P]` · dep: F2
`tests/unit/guards/cierre-detalle-superficies.guardia.test.ts` (nuevo)

Recorre el árbol buscando **todos** los usos de `<CierreFacturaDetalle` en `app/**` y exige
que cada uno pase `ordenesSinGestion` **y** `sinGestionRegistrado` (**R30**). Las props son
opcionales en el tipo por los dobles de test, así que **el typecheck no caza este olvido**:
por eso la guardia existe y por eso recorre archivos en vez de importar (ninguna selección por
grafo de imports la traería, `docs/verification.md`).

- **Hecho:** verde con las dos superficies cableadas y **roja con M10**.

### F6 — [Q4] El KPI dice lo que cuenta `[P]` · dep: F1
`app/(app)/cierres-admin/_components/cierre-factura.tsx` + los tests/E2E que lo localizan

- `FACTURA_ORDENES_KPI_LABEL` pasa de `"Órdenes"` a `"Gestiones"` (**R21**). El número **no
  cambia**: sigue sumando `ORDEN_RESULTADOS`.
- Actualizar los localizadores que buscan el texto viejo: `pnpm exec vitest related --run` de
  este archivo, más `rg "Órdenes"` en `tests/components/` y `e2e/` para no dejar un
  localizador muerto (los E2E no corren en el gate, pero un localizador roto ahí es una
  trampa para quien los ejecute a mano).
- **Hecho:** ningún test busca ya el rótulo viejo y el conteo sigue valiendo lo mismo.

---

## Bloque M — Mutaciones (obligatorio, no opcional)

Protocolo por mutación: aplicar el cambio a mano → correr **solo** el test indicado → pegar la
salida **ROJA** en `progress/impl_264.md` → `git checkout --` del archivo → confirmar verde.
Sin salida pegada, la mutación **no se hizo** (en este repo ya hubo un arnés que reportó 9/9
supervivientes sin ejecutar un test).

| # | Mutación | Debe ponerse ROJO |
| --- | --- | --- |
| **M1** | Quitar `where: { cierreId }` de la consulta nueva (B4) | B7 |
| **M2** | Cambiar el `orderBy` por `{ createdAt: "desc" }` | B7 (R12) |
| **M3** | Devolver `orden.destinatario` vivo en vez del congelado | B7 (R11) |
| **M4** | Sumar `ordenesSinGestion.length` al conteo del pie (`… N entregas`) **o** concatenarlas a `grupos.entregada` | F3 |
| **M5** | Sumar `ordenesSinGestion.length` al KPI `Órdenes` | F3 (R21) |
| **M6** | Añadir `'aprobado'` al `WHERE` del backfill | B2 (R26) |
| **M7** | Añadir una columna `monto_cobrar DECIMAL(12,2)` a la tabla y su campo al DTO | B2 y B6 (R10) |
| **M8** | Hacer que el feed de wallet lea también `cierre_sin_gestion` | B8 (R22) |
| **M9** | Ignorar `sinGestionRegistrado` y tratar `false` como «no hay órdenes» (no pintar nada) | F3 (R28) — **es la mutación de Q3: si no pone rojo, el silencio ambiguo volvió** |
| **M10** | Quitar las dos props del `<CierreFacturaDetalle>` del módulo del mensajero | F5 (R30) |
| **M11** | `ordenesSinGestion.slice(0, 10)` antes de pintar | F3 (R34) |

Si alguna mutación **no** pone rojo su test, el test es decorativo: se reescribe **antes** de
continuar y se anota en `progress/impl_264.md` qué se cambió y por qué.

---

## Mapa `R<n> → test`

| R | Test |
| --- | --- |
| R1 | `cierre-sin-gestion-sql-real.test.ts` (las filas del cierre existen y se leen) |
| R2 | `cierre-dia-repository.test.ts` — «escribe el vínculo en la misma tx del barrido» |
| R3 | `cierre-dia-repository.test.ts` — «tx revertida deja cero vínculos» |
| R4 | `cierre-dia-repository.test.ts` — «cada fila lleva el estatus de origen de SU vuelta» |
| R5 | `cierre-sin-gestion-sql-real.test.ts` (orden liberada) + `…aprobar.sin-gestion.test.ts` |
| R6 | `cierre-dia-repository.test.ts` — «solicitar cierre (flujo 37) no escribe vínculos» |
| R7 | `cierre-sin-gestion-sql-real.test.ts` (señuelos: otro cierre, otro mensajero) |
| R8 | `cierres-admin-service.test.ts` — «fuera de alcance ⇒ no_encontrada, sin lista» |
| R9 | `cierres-admin-service.test.ts` — «el DTO lleva los ocho campos, con nulls vivos» |
| R10 | `cierre-sin-gestion-sin-dinero.guardia.test.ts` + `cierre-sin-gestion-migration.test.ts` |
| R11 | `cierre-sin-gestion-sql-real.test.ts` (descriptivo congelado ≠ vivo) |
| R12 | `cierre-sin-gestion-sql-real.test.ts` (orden determinista, `null` estable) |
| R13 | `CierreFacturaSinGestionar.test.tsx` — «pinta la sección con su nombre accesible» |
| R14 | `CierreFacturaSinGestionar.test.tsx` — «el tablist sigue teniendo cinco pestañas» |
| R15 | `CierreFacturaSinGestionar.test.tsx` — «sin órdenes no hay sección» |
| R16 | `CierreFacturaSinGestionar.test.tsx` — «dice cuántas son» |
| R17 | `CierreFacturaSinGestionar.test.tsx` — «explica que no tienen dinero» (texto literal) |
| R18 | `CierreFacturaSinGestionar.test.tsx` — «tres columnas, y ninguna de dinero» |
| R19 | `CierreFacturaSinGestionar.test.tsx` — «el pie no se mueve» (literales + M4) |
| R20 | `CierreFacturaSinGestionar.test.tsx` — «los KPI y renglones no se mueven» (literales + M4) |
| R21 | `CierreFacturaSinGestionar.test.tsx` — «el KPI cuenta solo gestiones y se rotula Gestiones» (+ M5) |
| R22 | `cierres-admin-service.aprobar.sin-gestion.test.ts` (+ M8) |
| R23 | `cierre-sin-gestion-migration.test.ts` — «ENABLE ROW LEVEL SECURITY» |
| R24 | `cierre-sin-gestion-migration.test.ts` (DROP en el down) + round-trip real en B1 |
| R25 | `cierre-sin-gestion-migration.test.ts` — «backfill de los tres estados abiertos» |
| R26 | `cierre-sin-gestion-migration.test.ts` — «el backfill NO menciona aprobado» (+ M6) |
| R27 | `cierres-admin-service.test.ts` — «emite `sinGestionRegistrado` tal cual» + `cierre-sin-gestion-migration.test.ts` (columna con default) |
| R28 | `CierreFacturaSinGestionar.test.tsx` — «no registrado pinta el aviso, y no se parece a no-hubo-ninguna» (+ **M9**) |
| R29 | `cierre-sin-gestion-migration.test.ts` — «el UPDATE marca `false` fuera de los tres estados abiertos» |
| R30 | `cierre-detalle-superficies.guardia.test.ts` (+ **M10**) + B9 por el lado de los datos |
| R31 | `CierreFacturaSinGestionar.test.tsx` — «la sección no tiene botones, enlaces ni desplegables» |
| R32 | `CierreFacturaSinGestionar.test.tsx` — «sin estado de origen no se pinta un guion» |
| R33 | `cierre-sin-gestion-migration.test.ts` — «el backfill recupera el origen por LEFT JOIN LATERAL del historial» |
| R34 | `CierreFacturaSinGestionar.test.tsx` — «60 órdenes ⇒ 60 filas» (+ **M11**) |

## Cierre de la feature

1. `./init.sh` **completo** (obligatorio, ver arriba) — el leader, no los subagentes.
2. `progress/impl_264.md` con: archivos tocados, salida real de los tests, el mapa
   `R<n> → test` y **las once salidas rojas** del bloque M.
3. PR hacia `dev` con `gh pr create --base dev`. Recordar que el check de Vercel es un build y
   **no ejecuta un solo test**: el veredicto es el del gate, no el color del PR.
