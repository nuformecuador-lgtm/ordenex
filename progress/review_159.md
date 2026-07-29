# Review — Feature 159: quitar la sugerencia de mensajeros de la carga masiva

> Revisor: reviewer (agente). Fecha: 2026-07-29.
> Worktree: `R:/job/singularis/projects/ordenex-wt-159-review`, rama `review/159-verificacion`
> = `origin/dev` @ `0ed3125` (merge del PR #193; commit de trabajo `b2181e7`).
>
> **Caso atípico: el código YA ESTÁ EN `dev`.** Este review no bloquea un merge que ya
> ocurrió; describe **trabajo pendiente encima de `dev`**. Cada hallazgo se enuncia como
> "lo que falta por hacer", con archivo y línea.

---

## 1. Veredicto

**RECHAZADO** — 5 bloqueantes.

El retiro **mecánico** está bien hecho: no queda un solo identificador de la sugerencia en
producción (verificado con un escaneo independiente de 685 archivos / 78.978 líneas), la
migración y su `down.sql` son correctos y honestos, el gate de asignabilidad sobrevive
intacto y la suite entera pasa. Pero la feature **no está completa respecto a su spec**:

1. se ejecutó la alternativa **A3, que `design.md §6` descarta explícitamente** (borrar el
   resumen del lote entero), lo que deja **R12 sin implementar**;
2. eso se llevó por delante la cobertura de **R22(d)** y **R22(g)**, que existen justamente
   para impedirlo (`design.md §6/A5`);
3. **R1, R2, R3, R7, R9, R11 no tienen ningún test**: el mapa `R<n> → test` de la regla 4 de
   `CLAUDE.md` no se puede cerrar;
4. **R10** se resolvió por la opción (a) del gate Q1 sin que exista registro de la decisión
   humana (no hay `progress/impl_159.md`).

Que se saltara el proceso no vuelve incorrecto lo que sí hizo. Pero lo que falta no es
papeleo: es una función de UI retirada sin autorización y cobertura de test perdida.

---

## 2. Verificación ejecutable (números reales, medidos por mí)

`./init.sh` completo, tras `pnpm db:generate`. El worktree traía un cliente Prisma stale:
sin regenerar, `typecheck` escupe ~200 errores `TS2305 Module @prisma/client has no
exported member ...` — falso negativo conocido, no imputable a la 159.

| Gate | Resultado |
|---|---|
| `pnpm run typecheck` | **0 errores** |
| `pnpm run lint` | **0 errores, 10 warnings** |
| `pnpm test` | **543/543 archivos, 5655/5655 tests, 0 fallos** (147,19 s) |
| migraciones con `down.sql` | todas |
| `./init.sh` | `== init OK ==` |

Coincide exactamente con la referencia de `dev` (543 / 5655 / 0 / 10). La 159 **no rompió
nada**: todo lo que quedó en pie, pasa.

**Guard nuevo — comprobado, no asumido.** Repliqué la lógica de
`tests/unit/guards/sin-mensajero-sugerido.test.ts` fuera del repo: recorre **685 archivos /
78.978 líneas** de `app/`, `lib/`, `components/`, `hooks/` + `db/schema.prisma`, **0 hits**, y
el patrón dispara con una línea plantada que reintroduce `mensajeroSugeridoId`.
**No es un guard que pase siempre.** Ignora `.claude`, `node_modules`, `.next`, `dist`,
`coverage`, `build`. Sí es de los que leen `fs.readdirSync` en vez de `git ls-files`: un
archivo local no versionado con extensión `.ts`/`.tsx`/`.prisma` dentro de esas cuatro
raíces lo hace fallar (mismo defecto que su hermano `no-embalaje.test.ts`; deuda del repo,
no de esta feature).

---

## 3. Trazabilidad R1–R22 → test (construida desde cero; no había bitácora)

| R | Qué exige | Test que lo verifica | Estado |
|---|---|---|---|
| R1 | tabla `orden` sin columna/índice/FK | — | **SIN TEST** |
| R2 | el rollback restituye estructura con los mismos nombres y `ON DELETE SET NULL ON UPDATE CASCADE` | — | **SIN TEST** |
| R3 | la migración aplica sobre datos no nulos sin tocar `mensajero_asignado_id` | — | **SIN TEST** |
| R4 | schema sin la relación en ambos extremos | `tests/unit/guards/sin-mensajero-sugerido.test.ts:86` (escanea `db/schema.prisma`) | OK |
| R5 | fila con la clave se crea, sin error de campo | `tests/unit/services/bulk-orden-service.test.ts:500` | OK |
| R6 | mismo `RowResult` que la fila sin la clave | `bulk-orden-service.test.ts:500` (parcial) | **parcial** |
| R7 | no se consulta el catálogo de mensajeros | — | **SIN TEST** |
| R8 | el contrato de creación en lote no admite el campo | `bulk-orden-service.test.ts:512` + guard sobre `lib/` | OK |
| R9 | vía API key: mismo `RowResult` y mismo HTTP con y sin la clave | — | **SIN TEST** |
| R10 | OpenAPI declara la propiedad `deprecated` + "aceptada e ignorada" | — | **NO CUMPLIDO** (se borró; opción a) |
| R11 | `openapi-spec.ts` y el yaml dicen lo mismo de `CargaRow` | — | **SIN TEST** (cierto de facto) |
| R12 | tras la carga, mostrar el resumen de las órdenes creadas | — | **NO CUMPLIDO** |
| R13 | ninguna acción de "sugerir asignación" ni selector | `OrdenesCargaResumenPaso.test.tsx:71`, `CargaMasivaChunks.test.ts:92`, guard | OK |
| R14 | sin selección aleatoria de mensajeros | `GenerarGuiaModal.test.tsx:92-101` + borrado del `Math.random` | OK |
| R15 | el indicador de pasos no anuncia asignación | `OrdenesCargaMasivaButton.test.tsx:181,200` | OK |
| R16 | columna "Mensajero" = asignado, para cualquier estado único | `OrdenesPage.test.tsx:174` (solo la cabecera del juego por defecto) | **parcial** |
| R17 | sin asignado → marcador de dato ausente | — | **SIN TEST** |
| R18 | identificadores prohibidos fuera de producción | `sin-mensajero-sugerido.test.ts:86` | OK |
| R19 | no existe la Server Action | `sin-mensajero-sugerido.test.ts:110` | OK |
| R20 | símbolos huérfanos eliminados | guard (solo `asignarMensajeroSugerido`) | **parcial** (y se borró de más) |
| R21 | el gate de asignabilidad sigue operativo | `asignabilidad-coordenadas.test.ts`, `guia-asignacion-gate-coordenadas.test.ts`, `asignacion-satelite-gate-coordenadas.test.ts` | OK |
| R22(a) | troceado + dedup por `num_remision` | `CargaMasivaChunks.test.ts:35,44,56` | OK |
| R22(b) | remapeo de la línea original | `CargaMasivaChunks.test.ts:64` | OK |
| R22(c) | lote con HTTP no-ok | `CargaMasivaChunks.test.ts:109` | OK |
| R22(d) | resumen del lote acotado a la tienda del actor, sin campos internos | — | **COBERTURA ELIMINADA** |
| R22(e) | agrupado de "Generar guía" + encadenado a etiquetas/manifiesto | `GenerarGuiaModal.test.tsx`, `OrdenesListadoEtiquetasChain.test.tsx` | OK |
| R22(f) | flujo de manifiesto de la carga masiva | `ManifiestoFlujos.test.tsx:193,213`, `OrdenesCargaResumenPaso.test.tsx` | OK (sobre componente huérfano) |
| R22(g) | rechazo por rol de las acciones del resumen | — | **COBERTURA ELIMINADA** |

**Resumen: 14 de 22 requisitos con test real. 8 sin cobertura verificable** (R1, R2, R3, R7,
R9, R10, R11, R12), 2 con cobertura perdida (R22 d/g) y 3 parciales (R6, R16, R20).

---

## 4. Hallazgos bloqueantes

### BLOQUEANTE-1 — R12 no está implementado: se borró el resumen del lote (alternativa A3, descartada en el design)

`design.md §5.1` decía textualmente: *"`OrdenesCargaResumen.tsx` conserva **una sola**
responsabilidad: mostrar en una tabla las órdenes recién creadas"*, y `§6/A3` descarta borrar
el paso entero por ser *"pérdida de función disfrazada de limpieza"*. El commit hizo justo A3:

- `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx` — **borrado entero** (242 líneas).
- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx:45` — `type Step = "upload" | "preview"`
  (el spec pedía tres pasos, el tercero renombrado a "resultado", R15 + `design.md §5.2`).
- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx:189-192` — tras confirmar,
  `handleOpenChange(false)`: el modal **cierra**. El único reporte que queda es el toast de
  `:175-176` (`Carga: N creadas, M duplicadas, K con error`), un texto de conteos, no "el resumen
  de las órdenes creadas" que exige R12.
- `lib/services/AsignacionMensajeroService.ts`, `lib/interfaces/services/IAsignacionMensajeroService.ts`
  y `lib/actions/mensajeros.ts` — borrados enteros, incluido `resumenCargaMasiva`, que el
  design marcaba como superviviente (`§2.3`: renombrar a `ResumenCargaMasivaService`).
- `lib/repositories/OrdenRepository.ts` / `lib/interfaces/repositories/IOrdenRepository.ts` —
  se borró `findResumenByNumRemisiones`, que `design.md §2.2` marca **"sobrevive"** en la misma
  tabla en que marca los otros tres métodos para borrado.

**Falta por hacer:** o (a) reponer el resumen en solo lectura tal como lo describe
`design.md §5.1` (componente + `resumenCargaMasiva` + `findResumenByNumRemisiones`, sin los dos
campos de sugerido), o (b) llevar Q2 a la puerta humana, obtener por escrito la decisión de
colapsar el modal a dos pasos y **reescribir R12/R15 y `design.md §5`** en consecuencia. Lo que
no puede quedarse es el estado actual: el código contradice el spec vigente.

### BLOQUEANTE-2 — R22(d) sin cobertura: se borró la del resumen acotado a la tienda del actor

`tests/unit/repositories/orden-repository.asignacion.test.ts` (223 líneas) y
`tests/unit/services/asignacion-mensajero-service.test.ts` (284 líneas) se borraron **enteros**.
`design.md §7` mandaba conservar de ellos los 5 `describe` de `findResumenByNumRemisiones` y los
casos de `resumenCargaMasiva` (forbidden por rol, acotado a la tienda del actor), precisamente
porque **no son de la sugerencia**. R22(d) existe para hacerlo verificable y hoy no lo cubre nada.

**Falta por hacer:** con BLOQUEANTE-1 resuelto por la vía (a), restituir esos `describe`. Si el
humano elige la vía (b), R22(d) debe eliminarse del requirements con la misma firma.

### BLOQUEANTE-3 — R22(g) sin cobertura: se borró el rechazo por rol de las acciones del resumen

`tests/integration/actions/mensajeros-action.test.ts` (181 líneas) se borró entero, incluidos los
casos `unauthenticated` / `validation_error` / `ok` de `resumenCargaMasiva` que `design.md §7`
mandaba conservar renombrando el archivo a `carga-masiva-resumen-action.test.ts`. Además
`tests/unit/services/rol-admin-satelite-authz.test.ts` perdió sus dos `describe` de
`adminSatelite` (ese borrado sí es legítimo: probaban `listarMensajeros`, que ya no existe).

**Falta por hacer:** lo mismo que BLOQUEANTE-2.

### BLOQUEANTE-4 — R1, R2, R3 sin ningún test; el round-trip real contra Postgres NO se hizo

`db/migrations/20260728120000_drop_orden_mensajero_sugerido/` está **bien escrita**: el UP respeta
el orden FK → índice → columna con `IF EXISTS` en las tres (`migration.sql:18,20,22`), el DOWN el
orden inverso con los nombres exactos y `ON DELETE SET NULL ON UPDATE CASCADE`
(`down.sql:12,14,16-19`), y la cabecera del `down.sql:6-10` **declara explícitamente que
restituye la estructura y no los datos** — que es exactamente la honestidad que pedía Q5.

Pero:

- **No existe** `tests/integration/db/drop-mensajero-sugerido-migration.test.ts` (task T6). El
  texto de ambos archivos no está blindado: alterar el orden de las sentencias no rompe nada.
  (`tests/integration/db/carga-masiva-schema.test.ts` sigue verde sin tocarlo, como preveía
  `design.md §0.3`; y `notificacion-migration.test.ts:313` / `zonas-migration.test.ts:213`
  añadieron bien la exclusión de la carpeta nueva en su invariante de orden.)
- **Del round-trip real no hay ninguna evidencia, en ninguna dirección.** No hay
  `progress/impl_159.md` con salida de `pnpm run db:migrate` / `pnpm run db:rollback`, y este
  worktree ni siquiera tiene `.env` (tuve que pasar un `DATABASE_URL` ficticio para poder correr
  `prisma generate`). **Lo doy por NO EJECUTADO.** R3 —"aplica sobre una base con valores no
  nulos sin tocar `mensajero_asignado_id`"— es exactamente el tipo de cosa que solo se demuestra
  corriéndola.

**Falta por hacer:** (1) el test de texto de la migración (T6); (2) correr `db:migrate` +
`db:rollback` + `db:migrate` contra una base con `mensajero_sugerido_id` no nulo y pegar la
salida. **Antes de que esto salga a producción**, porque el `DROP` es irreversible en datos.

*(Nota menor sobre el `down.sql`: `ADD CONSTRAINT` no admite `IF NOT EXISTS` en Postgres, así que
un DOWN aplicado dos veces falla en `:16`, mientras que sus otros dos statements sí son
idempotentes. Es el patrón del resto del repo; lo dejo anotado, no lo exijo.)*

### BLOQUEANTE-5 — R7, R9, R11 sin ningún test (regla 4 de `CLAUDE.md`)

- **R7** (no consultar el catálogo de mensajeros durante el lote): `findMensajerosByIds` salió de
  la interfaz (`lib/interfaces/repositories/IOrdenRepository.ts`, antes `:455-456`) y de
  `precargar` (`lib/services/BulkOrdenService.ts:558`, hoy un `await` simple). Pero
  `findMensajerosByZona` y `findMensajeroIdsValidosByZona` **siguen en la interfaz** y ningún test
  asserta que `cargarMasiva` no los llame: reintroducir la consulta no rompería nada. Falta un
  `expect(repo.findMensajerosByZona).not.toHaveBeenCalled()` en
  `tests/unit/services/bulk-orden-service.test.ts`.
- **R9** (contrato público, vía API key): `tests/unit/services/bulk-orden-service.carga-api.test.ts`
  **solo perdió líneas** (5 borradas, 0 añadidas); el caso nuevo que pedían `design.md §7` y la task
  T16 no se escribió. Falta el caso "misma fila con y sin `mensajero_sugerido_id` → mismo
  `RowResult` y mismo HTTP".
- **R11** (paridad OpenAPI ↔ espejo en `docs/`): `tests/unit/api/openapi-contrato-en-reparto.test.ts`
  solo compara los **4 enums de estado** (`:93-104`); no mira las propiedades de `CargaRow`. Falta
  el assert de paridad de `CargaRow` entre `lib/api/openapi-spec.ts` y
  `docs/api/api-key-openapi.yaml`.

---

## 5. Contrato público de integradores (Q1 / R10 / R11)

**Lo que se hizo: la opción (a) — borrar la propiedad —, no la (b) que recomendaba el spec.**

- `lib/api/openapi-spec.ts` — se eliminaron las 4 líneas de `mensajero_sugerido_id` de `CargaRow`
  (antes `:479-482`).
- `docs/api/api-key-openapi.yaml` — se eliminaron las 3 líneas espejo (antes `:507-509`).

**Coherencia entre ambos: correcta.** Los dos artefactos dicen exactamente lo mismo (la propiedad
no está en ninguno) y ambos conservan su `additionalProperties: { type: string }`
(`openapi-spec.ts:480`), así que **no hay breaking change en runtime**: un integrador que siga
mandando la clave sigue recibiendo `2xx` y la fila se crea. `filaCargaSchema`
(`lib/types/carga-masiva.ts:73`) sigue sin ser `.strict()` — el ancla de la 143 se respetó, y el
caso está asertado en `tests/unit/services/bulk-orden-service.test.ts:500`.

Lo que falla es el proceso y R10 tal como está escrito:

- R10 dice *"El documento OpenAPI publicado DEBE declarar la propiedad `mensajero_sugerido_id` de
  `CargaRow` como obsoleta"*. Hoy no la declara: la borró. La requirements.md prevé el caso
  (*"Sujeto a la decisión de la puerta F1.4"*) y `design.md §4` dice que si el humano elige (a),
  **R10 se sustituye** por su negativo. Pero **no hay registro de que el humano eligiera nada**: no
  existe `progress/impl_159.md` y la task T0 exigía "la decisión queda escrita con su fecha y
  autor". La decisión la tomó el implementador solo.
- Consecuencia práctica, la que le importa al integrador: con (a) **el cambio semántico viaja en
  silencio**. Quien hoy manda `mensajero_sugerido_id` no recibe ninguna señal de que el campo dejó
  de tener efecto; simplemente desapareció de la documentación. Es exactamente el coste que
  `design.md §4` le imputa a la opción (a).

**Falta por hacer:** registrar la decisión de Q1 con fecha y autor y, o bien reescribir R10, o bien
reponer la propiedad con `deprecated: true` + descripción "aceptado e ignorado por el servidor" en
los dos artefactos. Y en cualquiera de los dos casos, el test de R11.

---

## 6. `OrdenesCargaResumenPaso.tsx` y el manifiesto de la 148 — verificado

- El archivo **sigue en pie**: `app/(app)/ordenes/_components/OrdenesCargaResumenPaso.tsx`.
- El botón de manifiesto **no se rompió**: `:53-60` mantiene el `DescargarManifiestoButton` con
  `flujo="carga_masiva"` y `seleccion={{ numRemisiones: numRemisionesNuevas }}`, con su guarda
  `nuevasCount > 0` (R17 de la 148) y su comentario de trazabilidad intacto.
- El único cambio fue quitar la prop `onDone` y el montaje de `OrdenesCargaResumen` — que es justo
  lo que pedía la task T21.
- Sus dos tests siguen verdes: `tests/components/OrdenesCargaResumenPaso.test.tsx` y
  `tests/components/ManifiestoFlujos.test.tsx:193,213`.

**`menor` (deuda preexistente y ajena, confirmada):** el componente **sigue huérfano**. Sus únicos
consumidores son esos dos tests; nadie lo monta en producción (`OrdenesCargaMasivaButton` no lo
importa). Era la deuda que Q3 documenta y la 159 no la creó — pero conviene decirlo entero: al
borrar el paso 3 del modal (BLOQUEANTE-1), la 159 eliminó el sitio natural donde ese contenedor se
iba a enganchar. El manifiesto de la carga masiva sigue sin salida en la UI real, y ahora sin hueco
donde ponerlo. Merece su ficha propia, como recomendaba Q3.

---

## 7. ¿Se llevó por delante cobertura de otra cosa? — archivo por archivo

| Borrado | Veredicto |
|---|---|
| `lib/services/AsignacionMensajeroService.ts` | **Se llevó `resumenCargaMasiva`**, que no es de la sugerencia → BLOQUEANTE-1/2 |
| `lib/interfaces/services/IAsignacionMensajeroService.ts` | ídem |
| `lib/actions/mensajeros.ts` | **Se llevó la acción `resumenCargaMasiva`** → BLOQUEANTE-1 |
| `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx` | **Pérdida de función (R12)** → BLOQUEANTE-1 |
| `tests/unit/repositories/orden-repository.asignacion.test.ts` | **Se llevó los 5 `describe` de `findResumenByNumRemisiones`** → BLOQUEANTE-2 |
| `tests/unit/services/asignacion-mensajero-service.test.ts` | **Se llevó los casos de `resumenCargaMasiva`** → BLOQUEANTE-2 |
| `tests/integration/actions/mensajeros-action.test.ts` | **Se llevó el rechazo por rol del resumen** → BLOQUEANTE-3 |
| `tests/components/OrdenesCargaResumen.test.tsx` | consecuencia de BLOQUEANTE-1 |
| `IOrdenRepository.findMensajerosByIds` / `asignarMensajeroSugerido` / `countOrdenesDeTienda` | **Legítimo.** Solo servían al flujo retirado (R20) |
| `rol-admin-satelite-authz.test.ts` — 2 `describe` | **Legítimo.** Probaban `listarMensajeros`, que ya no existe |
| `orden-repository.bulk.test.ts` — `describe` de `findMensajerosByIds` | **Legítimo** |
| `orden-repository.test.ts`, `bulk-orden-service*.test.ts`, `ManifiestoFlujos`, `OrdenesApartado`, `OrdenesListadoBloqueoCierre`, `OrdenesListadoEtiquetasChain`, `OrdenesRevisionMaestro`, `etiqueta-guia-service`, `guia-asignacion-service`, `orden-service`, `orden-geocode-enqueue`, `orden-historial-cobertura` | **Legítimo.** Ajuste mecánico de fixtures; ningún assert ajeno perdido (revisado en el diff) |
| `AsignabilidadCoordenadasService` + interfaz + los 3 tests del gate | **INTACTOS** (R21 ✓). Solo se limpió el comentario `:5-9` que citaba `asignarMensajeroSugerido` |
| `GenerarGuiaModal.tsx` | Retirado el agrupado con/sin sugerido; el agrupado GAM/no-GAM y el encadenado a etiquetas/manifiesto **siguen cubiertos** (R22(e) ✓) |

Conclusión: de las cinco superficies que desaparecieron enteras, **tres se llevaron cobertura
ajena** (las del resumen del lote) y **dos se fueron con razón** (`AsignacionMensajeroService` en su
parte de sugerencia y `orden-repository.asignacion` en su parte de `asignarMensajeroSugerido` /
`countOrdenesDeTienda`).

---

## 8. Hallazgos menores

- **`menor` — comentarios que citan símbolos que ya no existen** (la task T15 exigía literalmente
  *"ningún comentario del repo cita un símbolo inexistente"*):
  - `lib/interfaces/repositories/IOrdenRepository.ts:621` — *"Acotado por `tiendaId` —igual que `findResumenByNumRemisiones`—"*
  - `lib/repositories/OrdenRepository.ts:1464` — *"mismo `where` que `findResumenByNumRemisiones`, R29"*
  - `lib/services/ManifiestoService.ts:150` — *"la acotacion que hace el resumen del lote (`resumenCargaMasiva`)"*
  - `db/schema.prisma:466` — *"distinto del sugerido"*, sobre una columna que ya no existe
  - `app/(app)/ordenes/_components/GenerarGuiaModal.tsx:103` — *"R20: preselección inicial (sugerido u sin mensajero)"*, describe un comportamiento que el propio commit eliminó
  - `lib/services/GuiaAsignacionService.ts:184` — *"mensajero (sugerido confirmado u override)"*
- **`menor` — `lib/types/asignacion-mensajero.ts` no se renombró.** Sobrevive con un único export
  (`MensajeroDTO`, `:9-14`) y un nombre de archivo que ya no describe su contenido. La task T10 pedía
  `lib/types/mensajero.ts`. Sus dos importadores son `lib/interfaces/repositories/IUserRepository.ts:2`
  y `lib/repositories/UserRepository.ts:18`. El archivo sí lleva una cabecera nueva que explica por
  qué sobrevive, lo cual mitiga.
- **`menor` — R6 asertado a medias.** `tests/unit/services/bulk-orden-service.test.ts:508-511`
  envuelve el assert en `if (r.status === "ok")` y compara contra el literal `"creada"`, no contra el
  `RowResult` de la misma fila sin la clave. R6 dice "exactamente el mismo `RowResult`": faltan
  `estatus` y `numGuia`.
- **`menor` — R16/R17 sin test de render.** `app/(app)/ordenes/_components/ordenes-columns.tsx:162-166`
  quedó correcto (`row.relaciones?.mensajeroAsignado?.nombre ?? SIN_DATO`) y
  `app/(app)/ordenes/_components/OrdenesListado.tsx:348-351` colapsó bien al ternario de
  `reprogramada`, pero `tests/unit/components/ordenes-columns.test.tsx` no toca la columna
  "Mensajero" y ningún test filtra por un estado único para comprobar que ya no cambia el juego de
  columnas. La task T22 pedía "un test cubre las dos ramas".
- **`menor` — R20 guardado a un tercio.** La lista `PROHIBIDOS`
  (`tests/unit/guards/sin-mensajero-sugerido.test.ts:37-45`) incluye `asignarMensajeroSugerido` pero
  no `findMensajerosByIds` ni `countOrdenesDeTienda`: reintroducirlos no dispara el guard.
- **`menor` — el guard usa `fs.readdirSync`, no `git ls-files`.** Basura local no versionada bajo
  `app/`, `lib/`, `components/` o `hooks/` con extensión de texto lo hace fallar. Deuda del patrón,
  compartida con `no-embalaje.test.ts`.

---

## 9. Checklist de `CHECKPOINTS.md`, punto por punto

**Especificación**
- [x] `specs/159-quitar-sugerencia-mensajeros/requirements.md` con R1–R22 en EARS.
- [x] `design.md` con alternativas descartadas y su porqué (A1–A5, ejemplares).
- [ ] **`tasks.md`: 0 de 29 tasks marcadas `[x]`** (T0–T28, todas sin marcar).

**Trazabilidad**
- [ ] **Cada `R<n>` mapea a al menos un test concreto** — fallan R1, R2, R3, R7, R9, R10, R11, R12;
      R22(d) y R22(g) perdieron el suyo.
- [ ] **`progress/impl_159.md` no existe**, luego tampoco el mapa `R<n> → test`.

**Calidad de código**
- [x] `pnpm run typecheck` — 0 errores (tras `pnpm db:generate`).
- [x] `pnpm run lint` — 0 errores, 10 warnings.
- [x] `pnpm test` — 5655/5655.
- [x] E2E: la 159 no añade flujo crítico, retira uno. No aplica.

**Datos y seguridad (Supabase)**
- [x] No hay tabla nueva. `orden` conserva su RLS habilitada sin policies desde
      `20260709130100_ordenes`; ninguna policy citaba la columna, así que el `DROP` no altera la
      postura de seguridad (verificado, coincide con `design.md §1.2`).
- [~] Migración versionada y con `down.sql`: **sí**, y honesto. Pero `pnpm run db:rollback` **no se
      demostró** contra Postgres (BLOQUEANTE-4).
- [x] Ningún secreto hardcodeado; el diff no toca configuración ni credenciales.
- [x] Webhooks: no aplica, la 159 no toca ninguno.

**Patrón de capas** — [x] Correcto. El retiro respetó las cuatro capas: el service dejó de resolver,
el repositorio dejó de exponer, la interfaz dejó de declarar y la UI dejó de montar. Ninguna query se
filtró a un componente ni ningún `Request`/`Response` a un service.

**Permisos** — [x] Sin cambios de superficie. Se eliminó una Server Action; no se añadió ninguna ruta
ni se degradó ninguna validación.

**Multi-país / configuración** — [x] No se hardcodeó país, moneda ni cuenta.

**Verificación final**
- [x] `./init.sh` termina en verde.
- [ ] `progress/review_159.md` con veredicto `OK` — **este archivo, veredicto RECHAZADO**.
- [ ] **No hay entrada en `progress/history.md`** para la 159.

---

## 10. Estado de proceso (contexto, no bloqueante en sí mismo)

- `feature_list.json` — la 159 sigue en `"status": "spec_ready"` con `"branch": null`, pese a estar
  mergeada en `dev` desde el 2026-07-29 07:00.
- `depends_on: 156`, y la **156 sigue en `spec_ready`**: la 159 entró **antes que su dependencia**.
  Consecuencia concreta a tener presente al implementar la 156: `GenerarGuiaModal.tsx` **ya no tiene**
  ni preselección ni los bloques con/sin mensajero sugerido (`:103-110`, `:249-258`), porque la 159
  hizo ese trabajo por su cuenta. La 156 encontrará parte de su terreno ya movido y su spec debe
  releerse contra el código actual, no contra el que asumía.
- No existen `progress/impl_159.md` ni entrada en `progress/history.md`.

---

## 11. Qué hace falta para que esto pase a `OK`

En orden:

1. Llevar **Q1, Q2, Q3 y Q5** a la puerta humana y **escribir las decisiones con fecha y autor** en
   `progress/impl_159.md`. De Q2 depende si BLOQUEANTE-1 se resuelve reponiendo el resumen o
   reescribiendo R12/R15 y `design.md §5`.
2. Según esa decisión: reponer `OrdenesCargaResumen` + `resumenCargaMasiva` +
   `findResumenByNumRemisiones` (y con ellos R22(d) y R22(g)), o reescribir el spec y borrar R12,
   R22(d) y R22(g) del requirements con la firma del humano.
3. Escribir los tests que faltan: migración (R1/R2/R3), no-consulta del catálogo (R7), vía API key con
   y sin la clave (R9), paridad `CargaRow` TS ↔ yaml (R11), render de la columna "Mensajero" en sus
   dos ramas (R16/R17).
4. Correr el round-trip real de la migración contra Postgres con datos no nulos y pegar la salida.
   **Antes del deploy a producción.**
5. Limpiar los seis comentarios que citan símbolos inexistentes (§8).
6. Cerrar `tasks.md` marcando lo hecho y escribir el mapa `R<n> → test` en `progress/impl_159.md`.
7. Actualizar `feature_list.json` (status + branch) y añadir la entrada a `progress/history.md`.

Nada de esto lo arregla el reviewer: vuelve al implementer.

---

**Veredicto final: RECHAZADO** (5 bloqueantes). El código en `dev` es correcto en lo que hace y no
rompió nada — 5655/5655 en verde —, pero la feature no está completa: falta la función de UI que R12
exige, la cobertura de R22(d)/R22(g) que se llevó por delante, y ocho requisitos sin un solo test que
los verifique.
