# Implementación — Feature 159, cierre de los 5 bloqueantes del review

> Rama `fix/159-cierre` (sale de `origin/dev`). Fecha: 2026-07-29.
> Entrada: `progress/review_159.md` (veredicto RECHAZADO, 5 bloqueantes).
> El código de la 159 ya estaba mergeado en `dev` (PR #193, commit `b2181e7`); esto es
> trabajo **encima** de `dev`, no un merge que se bloquea.

---

## 0. Puertas humanas (lo que faltaba registrar)

La task **T0** exigía que las decisiones de las puertas quedaran escritas con fecha y
autor. No existían por escrito. Se registran aquí:

| Q | Decisión | Autor / fecha |
|---|---|---|
| **Q2** — ¿el resumen del lote sobrevive como paso propio del modal? | **SÍ, se restituye.** El `b2181e7` había ejecutado la alternativa **A3**, que `design.md §6` descarta. | **Humano**, 2026-07-29 (instrucción de cierre) |
| **Q1** — contrato público (`mensajero_sugerido_id` en `CargaRow`) | **(a) borrar la propiedad** — de facto, ejecutada por el implementador de `b2181e7` sin registro. **No se revierte:** ver §5, R10. | **Humano**, 2026-07-29: "R10 ya no tiene arreglo retroactivo; no intentes revertirlo" |
| **Q3** — ¿se borra `OrdenesCargaResumenPaso.tsx`? | **NO** (recomendación del spec). Sigue huérfano; deuda **abierta**, ver §6. | recomendación del spec, no revocada |
| **Q5** — ¿respaldo de los valores antes del `DROP`? | **(a) aceptar la pérdida**, declarada en la cabecera del `down.sql`. Ya estaba así en `b2181e7` y el test nuevo lo blinda. | recomendación del spec, no revocada |

---

## 1. BLOQ-1 — Restituido el resumen de la carga masiva (R12)

El `b2181e7` borró el resumen entero: componente (242 líneas), servicio, interfaz,
Server Action, tipos y el método de repositorio que `design.md §2.2` marcaba como
**"sobrevive"**. El modal quedó en 2 pasos y del resumen solo sobrevivía un toast de
conteos. **Se restituye, limpio de la sugerencia de mensajero.**

Recuperado del historial (`8e34fbc`, el commit anterior a `b2181e7`) y podado:

| Archivo | Qué se restituyó | Qué NO volvió |
|---|---|---|
| `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx` | la tabla de las órdenes creadas + los estados carga/error/vacío | el `<Select>` por fila, `seleccionInicial` **con su `Math.random`** (R14), `opcionesPorZona`, `toMensajeroOptions`, `SIN_ASIGNAR_LABEL`, `handleRowChange`, `handleConfirmar`, `submitting`/`submittingRef`, el botón "Sugerir asignación" (R13), el `Alert` de error de mensajeros, la columna "Mensajero", el `useSWRConfig`/`mutate` y la prop `onDone` |
| `lib/repositories/OrdenRepository.ts` + su interfaz | `findResumenByNumRemisiones`, `WITH_RESUMEN`, `toResumenDTO` | los dos campos de sugerido de la proyección y del DTO |
| `lib/services/ResumenCargaMasivaService.ts` (**renombrado**, design §2.3) | `resumenCargaMasiva` | `listarMensajeros`, la asignación sugerida, el helper `distinct`, y la dependencia de `IUserRepository` (ya no la necesita) |
| `lib/interfaces/services/IResumenCargaMasivaService.ts` (**renombrado**) | `ResumenCargaMasivaServiceResult` + el método | los otros dos métodos y sus tipos de resultado |
| `lib/actions/carga-masiva-resumen.ts` (**renombrado**, R19) | la Server Action `resumenCargaMasiva` | las otras dos Server Actions |
| `lib/types/carga-masiva-resumen.ts` (**renombrado** desde `asignacion-mensajero.ts`, T10) | `ResumenCargaOrdenDTO`, `resumenCargaSchema`, `ResumenCargaInput` | `mensajeroSugeridoId` / `mensajeroSugeridoNombre` del DTO, `asignarMensajeroSchema`, `AsignarMensajeroInput` |
| `lib/types/mensajero.ts` (**nuevo**, T10) | `MensajeroDTO`, que sobrevive por `IUserRepository`/`RankingService` | — |
| `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` | el **tercer paso**, ahora `"resultado"` (R15): `Step`, `PASOS`, `PASO_DESCRIPCION` y el render | el paso `"asignacion"`, su etiqueta "Asignar mensajero" y el `onDone` |

**Las dos condiciones del encargo, verificadas:**

- **Sin reintroducir el mensajero sugerido.** El guard `tests/unit/guards/sin-mensajero-sugerido.test.ts`
  sigue verde. Es más: al ampliarlo (§4, R20) **destapó un comentario más** que citaba un
  símbolo inexistente, en `lib/interfaces/repositories/IOrdenRepository.ts:561` — corregido.
- **Sin romper el manifiesto de la 148.** `OrdenesCargaResumenPaso.tsx` **no se tocó**;
  sus dos tests (`OrdenesCargaResumenPaso.test.tsx`, `ManifiestoFlujos.test.tsx`) pasan
  sin diff. El modal monta `OrdenesCargaResumen` **directo**, como manda `design.md §5.2`,
  no el contenedor. Consecuencia: el contenedor sigue huérfano — deuda de Q3, §6.

### Adaptación colateral (1 archivo)

`tests/components/OrdenesCargaMasivaNotificacion.test.tsx` (feature 146/R39) esperaba
al cierre del modal como forma de esperar al fin de la carga. Ahora la carga termina en
el paso 3: se cambia esa espera por el montaje del resumen y **se le añade el doble del
componente**. Ningún assert del aviso se perdió (los 7 `it` del archivo siguen).

---

## 2. BLOQ-2 y BLOQ-3 — Cobertura recuperada del historial (R22 d/g)

Regla aplicada: **se recupera lo que sigue verificando algo vivo; se descarta lo que
probaba un método que ya no existe.** Un test que no puede fallar es tan malo como no
tenerlo.

### Recuento

| Archivo borrado (en `8e34fbc`) | `it` que tenía | Recuperados | Descartados | Archivo nuevo |
|---|---|---|---|---|
| `tests/unit/repositories/orden-repository.asignacion.test.ts` (223 l.) | 9 | **5** | 4 | `tests/unit/repositories/orden-repository.resumen-carga.test.ts` (6 `it`: 5 + 1 nuevo) |
| `tests/unit/services/asignacion-mensajero-service.test.ts` (284 l.) | 9 | **2** | 7 | `tests/unit/services/resumen-carga-masiva-service.test.ts` (3 `it`: 2 + 1 nuevo) |
| `tests/integration/actions/mensajeros-action.test.ts` (181 l.) | 13 | **4** | 9 | `tests/integration/actions/carga-masiva-resumen-action.test.ts` (5 `it`: 4 + 1 nuevo) |
| `tests/components/OrdenesCargaResumen.test.tsx` (375 l.) | 14 | **4** | 10 | `tests/components/OrdenesCargaResumen.test.tsx` (11 `it`: 4 + 7 nuevos) |
| **Total** | **45** | **15** | **30** | **25 `it`** |

### Qué se descartó, bloque por bloque, y por qué

> Criterio único: **el método/flujo que el bloque ejercita ya no existe en producción**,
> así que el test no podría fallar por una regresión — solo por no compilar. Su función
> de guardia la cumple ahora el guard de R18/R20, que sí falla si alguien los reintroduce.

**`orden-repository.asignacion.test.ts` — 4 descartados**
1. `asignarMensajeroSugerido`: "updateMany con where id in + tiendaId + deletedAt:null" —
   el método se borró (R20), y el guard ya prohíbe su nombre.
2. `asignarMensajeroSugerido`: "devuelve 0 sin llamar updateMany cuando ordenIds vacio" — ídem.
3. `countOrdenesDeTienda`: "cuenta ordenes que pertenecen a tiendaId y no borradas" —
   método borrado (R20); era el guard todo-o-nada de la asignación sugerida, que ya no ocurre.
4. `countOrdenesDeTienda`: "devuelve 0 sin consultar cuando ordenIds vacio" — ídem.

**`asignacion-mensajero-service.test.ts` — 7 descartados**
5. `listarMensajeros`: "rol autorizado -> ok con la lista del repo" (`it.each` de 3 roles) —
   el método del servicio se borró; su único consumidor era el select del resumen.
   ⚠️ **`IUserRepository.listMensajeros` sigue vivo** (lo usa `RankingService`) y **conserva
   su propia cobertura** en `tests/unit/repositories/user-repository*`: aquí no se pierde nada.
6. `listarMensajeros`: "rol no autorizado -> forbidden sin llamar al repo" — ídem.
7–11. Los 5 de `asignarMensajeroSugerido` (forbidden por rol, R18 lista vacía, R13
   mensajero inválido, R14 todo-o-nada por tienda, R15 agrupado por mensajeroId) — el
   método del servicio se borró entero (R19/R20).

**`mensajeros-action.test.ts` — 9 descartados**
12–14. Los 3 de `listarMensajeros` (unauthenticated / forbidden / ok) — Server Action borrada.
15–20. Los 6 de `asignarMensajeroSugerido` (unauthenticated, forbidden, `ordenId` vacío,
   lista vacía válida, ok, `validation_error` con `fieldErrors`) — Server Action borrada (R19).

**`OrdenesCargaResumen.test.tsx` — 10 descartados**
21–22. "carga los mensajeros vía Server Action" y "si `listarMensajeros` falla, los selects
   quedan deshabilitados" — no hay selects ni carga de mensajeros (R13).
23. "el select de la fila solo ofrece mensajeros de la zona de la orden" — no hay select.
   **La zona sí sobrevive** como columna, y su assert se conservó (fusionado en
   "muestra el resto de columnas de datos").
24. "respeta el `mensajeroSugeridoId` y sortea uno de la zona (R27)" — es literalmente el
   `Math.random` que R14 prohíbe. Su **inverso** sí está cubierto: "R14: renderizar el
   resumen no consulta el azar en ningún punto".
25. "cambiar el select de una fila no afecta a las demás (R26)" — no hay selects.
26–27. Los 2 de "sugerir asignación" (llamada + `mutate` + `onDone`; exclusión de filas sin
   mensajero) — el botón y la acción no existen (R13). El `mutate` del listado **no se
   pierde**: lo hace ahora `OrdenesCargaMasivaButton` tras la carga real y su test lo cubre.
28–29. Los 2 de "fallo de asignación" (`status !== ok` y excepción) — no hay asignación.
   Su equivalente vivo (fallo de la **carga del resumen**) sí está cubierto, con dos casos
   nuevos: `forbidden` y promesa rechazada.
30. "el botón confirmar se deshabilita / anti doble-submit (R30)" — no hay botón ni submit.

### Lo que se recuperó, y lo que se le añadió

- **R22(d)** — `orden-repository.resumen-carga.test.ts`: los 5 `describe`/`it` de
  `findResumenByNumRemisiones` (acotado por `tiendaId` + `deletedAt: null`, mapeo de
  `Decimal`, no expone internos, unicidad de `num_remision`, lista vacía sin consultar),
  con el `select` esperado ajustado. **Nuevo:** un caso que asserta que **ni el `select`
  ni la salida** traen clave alguna que case con `/mensajero/i`.
- **R22(d)** — `resumen-carga-masiva-service.test.ts`: `adminTienda -> ok` (con el assert
  de que la tienda es **siempre la del actor**, nunca la del input) y `forbidden` para los
  otros 4 roles. **Nuevo:** propaga el resultado del repo tal cual.
  El doble del repo se acotó a `Pick<IOrdenRepository, "findResumenByNumRemisiones">`: el
  original arrastraba ~55 stubs de la interfaz completa que nadie ejercitaba.
- **R22(g)** — `carga-masiva-resumen-action.test.ts`: `unauthenticated`, `forbidden`,
  `validation_error` y `ok`. **Nuevo:** `validation_error` con una remisión vacía en la lista.

---

## 3. BLOQ-4 — Test de la migración (R1, R2, R3) · **round-trip real NO ejecutado**

Nuevo: `tests/integration/db/drop-mensajero-sugerido-migration.test.ts` (19 `it`),
modelado sobre `orden-indices-filtros-migracion.test.ts` / `zonas-migration.test.ts`.
Cubre, sobre las **sentencias** (no el texto crudo, para que la cabecera explicativa no
cuente):

- **UP (R1):** exactamente 3 sentencias, cada una literal y con `IF EXISTS`, y el
  **orden FK → índice → columna** verificado por posición; sin `CASCADE`.
- **R3 (parte estática):** ninguna sentencia menciona `mensajero_asignado_id`; el UP no
  ejecuta ningún DML; no toca tablas ni RLS.
- **DOWN (R2):** 3 sentencias en **orden inverso**, con los nombres exactos, `TEXT`
  nullable y `ON DELETE SET NULL ON UPDATE CASCADE`; una por cada una del UP.
- **Q5:** la cabecera del `down.sql` sigue declarando que **no restaura los datos**.
- **R4:** `schema.prisma` sin la columna, sin el `@@index` y sin la relación en sus dos
  extremos; y `mensajeroAsignadoId` **sigue** declarado.
- Registro de la carpeta en el invariante de orden de `zonas-migration.test.ts` y
  `notificacion-migration.test.ts`.

**Verificado por mutación:** invertir el orden del UP y cambiar `ON DELETE SET NULL` por
`ON DELETE CASCADE` en el DOWN → **4 tests en rojo**. Revertido.

> ### ⛔ Lo que sigue SIN verificarse: el round-trip real contra Postgres
>
> **NO se ejecutó `pnpm run db:migrate` / `db:rollback` / `db:migrate`** contra una base
> con `mensajero_sugerido_id` no nulo. Motivo: **este worktree no tiene `.env`** (`./init.sh`
> lo avisa: `! no hay .env`) y no hay `DATABASE_URL` disponible.
>
> Lo que el test nuevo demuestra es que el **texto** de los dos archivos es correcto y
> está blindado. Lo que **no** demuestra:
> - que el UP corra sin error sobre datos reales (**R3** en su parte ejecutable);
> - que el DOWN restituya de verdad columna, índice y FK (**R2**);
> - que ningún objeto de la base quede huérfano.
>
> **Sigue siendo obligatorio antes del deploy a producción**, porque el `DROP COLUMN`
> es irreversible en datos. La 159 ya está en `dev`: esto es deuda **viva**, no futura.
>
> *(Nota heredada del review, no exigida: `ADD CONSTRAINT` no admite `IF NOT EXISTS` en
> Postgres, así que aplicar el DOWN dos veces falla en su tercera sentencia. Es el patrón
> del resto del repo; se deja anotado.)*

---

## 4. BLOQ-5 — R7, R9 y R11 con test

- **R7 — no se consulta el catálogo de mensajeros.** Dos casos nuevos, uno por vía:
  `bulk-orden-service.test.ts` ("R7: procesar un lote NO consulta el catalogo") y
  `bulk-orden-service.carga-api.test.ts` ("R7: la via API tampoco..."). Ambos assertan
  `not.toHaveBeenCalled()` sobre **las cuatro** lecturas que la interfaz sigue exponiendo
  (`findAllMensajeros`, `findMensajeroIdsValidos`, `findMensajerosByZona`,
  `findMensajeroIdsValidosByZona`), no solo la que el review nombró.
  **Mutación:** añadir `await this.repo.findMensajerosByZona(...)` a `precargar` → **2 tests
  en rojo**, uno por vía. Revertido.
- **R9 — misma fila con y sin la clave, vía API key.** Partido en sus dos mitades:
  - *service* (`bulk-orden-service.carga-api.test.ts`): mismo `status` y **`summary`
    entero idéntico** (no solo `resultado === "creada"`), más "la clave no llega a la
    persistencia" (R8);
  - *borde* (`tests/integration/api/ordenes-api-key-carga.route.test.ts`): mismo **HTTP 200**
    y mismo JSON con y sin la clave, y la clave **llega intacta al service** — la descarta
    `filaCargaSchema` (no `.strict()`, ancla de la 143), no el borde.
- **R11 — paridad de `CargaRow`.** Nuevo `tests/unit/api/openapi-carga-row-paridad.test.ts`
  (8 `it`): mismas propiedades **y en el mismo orden**, mismo `required`, mismo `type` por
  propiedad, mismo estado `deprecated` por propiedad, y `additionalProperties` idéntico,
  entre `lib/api/openapi-spec.ts` y `docs/api/api-key-openapi.yaml`.
  **Mutación:** añadir `mensajero_sugerido_id` solo al objeto TS → **4 tests en rojo**. Revertido.

### Extras cerrados de paso (eran `menor` en el review, no bloqueantes)

- **R6 asertado entero:** el caso previo comparaba contra el literal `"creada"`. Nuevo
  caso que compara el `RowResult` **completo** (y el `summary`) de la misma fila con y sin
  la clave, que es lo que R6 dice.
- **R16/R17 con test de render:** 4 casos nuevos en `tests/unit/components/ordenes-columns.test.tsx`
  (columna única "Mensajero"; con asignado muestra el **nombre**, no el id; sin asignado
  muestra `—`; y el juego alternativo `reprogramada` dice lo mismo).
- **R20 guardado entero:** `PROHIBIDOS` del guard pasa de 7 a **9** identificadores —
  entran `findMensajerosByIds` y `countOrdenesDeTienda`, que R20 nombra uno a uno y que
  antes se podían reintroducir sin que nada saltara. **Mutación:** verificado que el guard
  falla con cada uno. Revertido.
- **T15 (comentarios que citan símbolos inexistentes):** al restituir el resumen, tres de
  los seis que el review listó **volvieron a ser ciertos** (`IOrdenRepository`,
  `OrdenRepository`, `ManifiestoService` citan `findResumenByNumRemisiones` /
  `resumenCargaMasiva`, que existen otra vez). De los otros tres, `GenerarGuiaModal.tsx` y
  `GuiaAsignacionService.ts` ya estaban limpios (grep de `sugerid` sobre `app/`, `lib/`,
  `components/`, `hooks/`: 0 hits fuera de los nuevos). Se corrigieron `db/schema.prisma:468`
  y el que destapó el guard ampliado, `IOrdenRepository.ts:561`.
- **Guard reforzado por el otro lado:** un `it` nuevo asserta que el resumen del lote
  **sigue en pie** (4 archivos + el método del repo). Si alguien vuelve a borrarlo "de
  paso", como pasó en `b2181e7`, ahora la suite lo dice. **Mutación:** borrar
  `lib/actions/carga-masiva-resumen.ts` → rojo. Revertido.

---

## 5. R10 — INCUMPLIDO, deuda declarada (no se revierte)

R10 pedía: *"El documento OpenAPI publicado DEBE declarar la propiedad
`mensajero_sugerido_id` de `CargaRow` como obsoleta y describirla como aceptada e
ignorada por el servidor."*

**No se cumplió y ya no tiene arreglo retroactivo.** El `b2181e7` ejecutó la opción (a)
de `design.md §4` —borrar la propiedad de los dos artefactos— sin pasar por la marca
`deprecated` previa que R10 exigía, y **sin registro de decisión humana**. La 159 ya está
mergeada en `dev`: la documentación publicada ya no la declara. Reponerla ahora con
`deprecated: true` no informaría del cambio "en el sitio donde el integrador mira" — solo
resucitaría una propiedad muerta para volver a borrarla, que es peor que asumir el coste.

**Decisión humana (2026-07-29): no se revierte.** Se deja escrito el coste real, que es
el que `design.md §4` le imputa a la opción (a):

> **el cambio semántico viajó en silencio.** Un integrador que hoy siga enviando
> `mensajero_sugerido_id` sigue recibiendo `2xx` y su orden se crea —no hay breaking
> change en runtime: `filaCargaSchema` no es `.strict()` y `CargaRow` conserva
> `additionalProperties: { type: string }`—, pero **nunca recibió señal alguna** de que el
> campo dejó de tener efecto. Simplemente desapareció de la documentación.

**Q4 sigue abierta y ahora importa más:** no se sabe si hay integradores activos enviando
la clave. Si los hay, el aviso tiene que ser por fuera del documento (comunicación
directa), porque el documento ya no puede darlo.

Lo que sí queda blindado es el **sustituto** que `design.md §4` fija para la opción (a):
`openapi-carga-row-paridad.test.ts` verifica que la propiedad no está en **ninguno** de
los dos artefactos, que ambos siguen diciendo exactamente lo mismo, y que
`additionalProperties` sigue permitiéndola (quitarlo **sí** sería romper el contrato).

---

## 6. Deuda que queda viva (no la abre esta rama, no la cierra)

1. **El round-trip real de la migración** — §3. **Bloqueante para producción.**
2. **R10 / Q4** — §5. El cambio semántico ya viajó sin aviso.
3. **`OrdenesCargaResumenPaso.tsx` sigue huérfano (Q3).** El modal monta
   `OrdenesCargaResumen` **directo**, como manda `design.md §5.2`; el contenedor —y con él
   el botón de manifiesto de la **feature 148**— sigue sin consumidor de producción. Es
   deuda **preexistente y ajena** a la 159 (la documentaba Q3 antes de este trabajo).
   Ahora, con el tercer paso repuesto, **vuelve a existir el hueco natural donde
   engancharlo**, cosa que el estado de `b2181e7` había eliminado. Merece su ficha propia,
   como recomendaba Q3; engancharlo aquí habría sido alcance nuevo sin spec.
4. **El guard usa `fs.readdirSync`, no `git ls-files`.** Basura local no versionada bajo
   `app/`, `lib/`, `components/` o `hooks/` con extensión de texto lo hace fallar. Deuda
   del patrón, compartida con `no-embalaje.test.ts`; ajena a esta feature.
5. **`feature_list.json` / `progress/history.md`** — el registro de la 159 lo cierra el
   leader; esta rama solo deja la bitácora y `tasks.md`.

---

## 7. Trazabilidad `R<n> → test` (los 22, sin huecos ocultos)

| R | Test que lo verifica | Estado |
|---|---|---|
| R1 | `tests/integration/db/drop-mensajero-sugerido-migration.test.ts` › "UP — retira FK, indice y columna, EN ESE ORDEN (R1)" (4 `it`) | **estático** (round-trip pendiente, §3) |
| R2 | ídem › "DOWN — restituye la ESTRUCTURA en orden inverso (R2)" (6 `it`) | **estático** (round-trip pendiente, §3) |
| R3 | ídem › "R3 — la migracion no toca dato alguno, ni el mensajero ASIGNADO" (3 `it`) | **estático** (round-trip pendiente, §3) |
| R4 | `tests/unit/guards/sin-mensajero-sugerido.test.ts:87` + migración › "R4: `schema.prisma` no declara…" | OK |
| R5 | `tests/unit/services/bulk-orden-service.test.ts` › "una columna `mensajero_sugerido_id`… se ignora" | OK |
| R6 | ídem › "R6: el RowResult es EXACTAMENTE el de la misma fila sin la clave" | OK |
| R7 | ídem › "R7: procesar un lote NO consulta el catalogo" + `bulk-orden-service.carga-api.test.ts` › "R7: la via API tampoco…" | OK |
| R8 | `bulk-orden-service.test.ts` (`not.toHaveProperty`) + `carga-api` › "R8: la clave no llega a la persistencia" + guard sobre `lib/` | OK |
| R9 | `bulk-orden-service.carga-api.test.ts` › "R9: la MISMA fila con y sin…" + `tests/integration/api/ordenes-api-key-carga.route.test.ts` › "carga API: mensajero sugerido retirado (159/R9)" | OK |
| R10 | — | **INCUMPLIDO**, sin arreglo retroactivo (§5). Su sustituto: `openapi-carga-row-paridad.test.ts` › "159/R10 (sustituido…)" |
| R11 | `tests/unit/api/openapi-carga-row-paridad.test.ts` › "159/R11 — CargaRow…" (5 `it`) | OK |
| R12 | `tests/components/OrdenesCargaResumen.test.tsx` (11 `it`) + `OrdenesCargaMasivaButton.test.tsx` › "confirma → … y resumen del lote" + guard › "el resumen del lote SIGUE en pie" | OK |
| R13 | `OrdenesCargaResumen.test.tsx` › "no ofrece ningún selector…" y "la tabla no tiene columna de mensajero"; `OrdenesCargaResumenPaso.test.tsx`; `CargaMasivaChunks.test.ts`; guard | OK |
| R14 | `OrdenesCargaResumen.test.tsx` › "R14: renderizar el resumen no consulta el azar" + `GenerarGuiaModal.test.tsx` | OK |
| R15 | `OrdenesCargaMasivaButton.test.tsx` › "R15: el indicador anuncia 3 pasos y ninguno es de asignación" | OK |
| R16 | `tests/unit/components/ordenes-columns.test.tsx` › "R16: con mensajero asignado muestra su NOMBRE" y "R16: el otro juego de columnas (reprogramada) dice lo MISMO" + `OrdenesPage.test.tsx` | OK |
| R17 | `ordenes-columns.test.tsx` › "R17: sin mensajero asignado muestra el marcador de dato ausente" | OK |
| R18 | `tests/unit/guards/sin-mensajero-sugerido.test.ts` (9 identificadores) | OK |
| R19 | ídem › "no existe la Server Action de asignacion de mensajero sugerido (R19)" | OK |
| R20 | ídem (`findMensajerosByIds` y `countOrdenesDeTienda` ya en `PROHIBIDOS`) | OK |
| R21 | `asignabilidad-coordenadas.test.ts`, `guia-asignacion-gate-coordenadas.test.ts`, `asignacion-satelite-gate-coordenadas.test.ts` (**sin tocar**) | OK |
| R22(a)(b)(c) | `tests/components/CargaMasivaChunks.test.ts` | OK |
| R22(d) | `tests/unit/repositories/orden-repository.resumen-carga.test.ts` + `tests/unit/services/resumen-carga-masiva-service.test.ts` | **recuperado** |
| R22(e) | `GenerarGuiaModal.test.tsx`, `OrdenesListadoEtiquetasChain.test.tsx` | OK |
| R22(f) | `ManifiestoFlujos.test.tsx`, `OrdenesCargaResumenPaso.test.tsx` | OK |
| R22(g) | `tests/integration/actions/carga-masiva-resumen-action.test.ts` | **recuperado** |

**21 de 22 con test.** El único sin cobertura es **R10**, incumplido y declarado en §5.
R1/R2/R3 tienen cobertura **estática** y su parte ejecutable está declarada en §3.

---

## 8. Verificación (`./init.sh`, salida real)

```
-> pnpm run typecheck        ✓ 0 errores
-> pnpm run lint             ✓ 0 errores, 10 warnings   (los mismos 10 de `dev`)
-> pnpm run test             ✓ 575 archivos / 6286 tests / 0 fallos   (164,00 s)
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

Referencia de `dev`: **569 archivos / 6218 tests**. Delta: **+6 archivos de test, +68 tests**.
Los 6 archivos nuevos son `OrdenesCargaResumen.test.tsx`, `orden-repository.resumen-carga.test.ts`,
`resumen-carga-masiva-service.test.ts`, `carga-masiva-resumen-action.test.ts`,
`drop-mensajero-sugerido-migration.test.ts` y `openapi-carga-row-paridad.test.ts`.

`git status --porcelain` vacío tras el commit (el guard recorre `fs.readdir`: basura local
lo pone en rojo).
