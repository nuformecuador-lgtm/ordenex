# Review — Feature 159, rama de cierre `fix/159-cierre`

> Revisor: reviewer (agente). Fecha: 2026-07-29.
> Worktree: `R:/job/singularis/projects/ordenex-wt-159-review`, rama `fix/159-cierre`
> (3 commits sobre `origin/dev`: `66fef9b`, `c0caf72`, `26b9f0c`).
> Entrada: `progress/review_159.md` (RECHAZADO, 5 bloqueantes) y `progress/impl_159_cierre.md`.
>
> **Calibración.** El código de la 159 ya está en `dev` (PR #193). Un bloqueante de este
> review **no frena un merge**: describe trabajo pendiente antes de que la feature pueda
> pasar a `done` (y, en el caso de BLOQ-1, antes de que salga a producción).

---

## 1. Veredicto

**APROBADO-CON-NOTAS** para el trabajo de la rama. **2 bloqueantes** vivos, ambos ya
declarados por el implementer y confirmados por mí: la feature **no puede pasar a `done`**
hasta cerrarlos.

Los 5 bloqueantes de `review_159.md` se saldan: **4 enteros** (BLOQ-1 R12, BLOQ-2 R22(d),
BLOQ-3 R22(g), BLOQ-5 R7/R9/R11) y **uno a medias** (BLOQ-4: el test de la migración se
escribió y es sólido; el round-trip real sigue sin ejecutarse). La cobertura recuperada es
real: **21 mutaciones propias, 21 efectivas** (descartados 2 mutantes equivalentes). Ningún
descarte de los 30 se llevó cobertura viva. La bitácora no oculta nada: cada cosa que declara
la verifiqué y salió cierta.

---

## 2. Verificación ejecutable (números medidos por mí)

`./init.sh` completo, tras `pnpm install`. **No hizo falta `pnpm db:generate`**: el cliente
Prisma ya estaba generado por el `postinstall` y no contiene `mensajeroSugerido`. (`pnpm
db:generate` a pelo **falla** en este worktree — `PrismaConfigEnvError: Cannot resolve
environment variable: DATABASE_URL`, no hay `.env`.)

| Gate | Resultado medido | Declarado en la bitácora |
|---|---|---|
| `pnpm run typecheck` | **0 errores** | 0 errores, coincide |
| `pnpm run lint` | **0 errores, 10 warnings** | ídem, coincide |
| `pnpm test` | **575 archivos / 6286 tests / 0 fallos** (172,72 s) | 575 / 6286 / 0, coincide |
| migraciones con `down.sql` | todas | coincide |
| `./init.sh` | `== init OK ==` | coincide |

**Los números cuadran exactamente.** El baseline de `dev` también: `git ls-tree -r origin/dev`
da **569** archivos `tests/**/*.test.ts(x)` frente a **575** en la rama — **+6**, que son
exactamente los 6 archivos de test nuevos del diff. **Ningún archivo de test se borró** en
esta rama, y en los 3 archivos de test modificados no se perdió ni un `it` (2 renombrados,
el resto añadidos).

`git status --porcelain` **vacío**, verificado tres veces (al abrir el review, entre baterías
de mutación y al cerrar).

---

## 3. BLOQ-1 del encargo — la restitución del resumen

### (a) Sin reintroducir nada del mensajero sugerido, y el guard es quien lo impide

Escaneo independiente con `git ls-files` (no `fs.readdirSync`, para descartar el defecto
conocido del patrón): **703 archivos** de `app/`, `lib/`, `components/`, `hooks/` y
`db/schema.prisma`, **0 hits** de los 9 identificadores. También **0 hits** en `docs/`,
`scripts/` y `e2e/`, que el guard no cubre.

**Mutación, los 9 uno a uno** — planté cada identificador en `lib/utils.ts` y corrí el guard:

| identificador plantado | guard |
|---|---|
| `mensajero_sugerido_id`, `mensajeroSugeridoId`, `mensajeroSugerido`, `MensajeroSugerido` | ROJO x4 |
| `asignarMensajeroSugerido`, `ordenesColumnsMensajeroSugerido`, `ESTADOS_MENSAJERO_SUGERIDO` | ROJO x3 |
| `findMensajerosByIds`, `countOrdenesDeTienda` (los que entraron en este cierre) | ROJO x2 |

**9 de 9.** Y el assert inverso también dispara: mover fuera `lib/actions/carga-masiva-resumen.ts`
deja el guard en rojo.

### (b) El manifiesto de la 148 no se rompió

`OrdenesCargaResumenPaso.tsx` **no aparece en el diff** — no se tocó. Conserva el
`DescargarManifiestoButton` con `flujo="carga_masiva"` y `seleccion={{ numRemisiones }}`
(`:55-57`) y su guarda `nuevasCount > 0`. Sus dos tests (`OrdenesCargaResumenPaso.test.tsx`,
`ManifiestoFlujos.test.tsx`) siguen verdes sin diff.

### (c) El componente restituido hace algo real, no es un cascarón

`OrdenesCargaResumen.tsx` (110 líneas) llama a `resumenCargaMasiva`, congela el lote al
montar, y renderiza 8 columnas reales del DTO con estados carga / error / vacío. Detrás hay
cadena completa y con las capas separadas: Server Action (auth + `resumenCargaSchema`) ->
`ResumenCargaMasivaService` (authz `adminTienda`, tienda = la del actor) -> `OrdenRepository.
findResumenByNumRemisiones` (`where` con `tiendaId` + `deletedAt: null`, proyección `WITH_RESUMEN`
sin campo alguno de mensajero). El servicio no conoce HTTP; el repositorio no tiene lógica.

**Mutaciones sobre el componente y su cadena:** `Math.random()` en el render -> ROJO,
botón "Sugerir asignación" -> ROJO, repo sin acotar por tienda -> ROJO, proyección con
`mensajeroAsignadoId` -> ROJO, servicio abierto a `maestro` -> ROJO, servicio consultando
otra tienda -> ROJO, action sin exigir sesión -> ROJO, action sin validar el input -> ROJO.

**Restitución fiel al original.** Comparado contra `8e34fbc` (el commit previo a `b2181e7`),
el `handleConfirmar` es idéntico salvo `setStep("asignacion")` -> `setStep("resultado")`, y el
render idéntico salvo el `onDone` retirado — que es literalmente lo que pedían T19/T20 y
`design.md §5.2`.

**Coherencia de permisos verificada:** `app/(app)/ordenes/page.tsx:55` fija
`puedeCargarMasiva = rol === adminTienda`, exactamente el rol que el servicio autoriza. El
tercer paso repuesto solo lo alcanza quien pasa su authz; no queda ningún rol que llegue al
paso 3 y se coma el `Alert` de error.

---

## 4. El punto delicado — los 30 descartes, uno a uno

Recuperé los 4 archivos borrados de `8e34fbc` y conté sus `it`: **9 + 9 + 13 + 14 = 45**. El
recuento de la bitácora es exacto. Verifiqué los 30 descartes **uno a uno**, no por muestreo.

| # | Bloque descartado | Método/flujo que ejercitaba | Sigue vivo? |
|---|---|---|---|
| 1-2 | `asignarMensajeroSugerido` (repo) | `OrdenRepository.asignarMensajeroSugerido` | **No** — borrado (R20), guard lo prohíbe |
| 3-4 | `countOrdenesDeTienda` (repo) | `OrdenRepository.countOrdenesDeTienda` | **No** — borrado (R20), guard lo prohíbe |
| 5-6 | `listarMensajeros` (service) | `AsignacionMensajeroService.listarMensajeros` | **No** — el service no existe (guard asserta el archivo ausente) |
| 7-11 | `asignarMensajeroSugerido` (service) x5 | ídem, método borrado | **No** |
| 12-14 | `listarMensajeros` (action) x3 | Server Action borrada | **No** — guard asserta que `lib/actions/mensajeros.ts` no existe |
| 15-20 | `asignarMensajeroSugerido` (action) x6 | Server Action borrada (R19) | **No** |
| 21-22 | carga de mensajeros del resumen x2 | `<Select>` por fila, ya inexistente | **No** |
| 23 | select filtrado por zona | el select no existe | **No** (ver nota) |
| 24 | preselección al azar (R27) | es el `Math.random` que R14 prohíbe | **No** |
| 25 | override por fila (R26) | no hay selects | **No** |
| 26-27 | "sugerir asignación" x2 | botón + acción inexistentes | **No** (ver nota) |
| 28-29 | fallo de asignación x2 | no hay asignación | **No** |
| 30 | anti doble-submit del resumen (R30) | no hay botón ni submit | **No** |

**Mi juicio: ninguno de los 30 cubría algo que siga vivo.** Comprobé los cuatro puntos donde
podía haberse escapado algo:

- **#23 (zona).** La zona **sí** sobrevive como columna. Su assert está conservado:
  `expect(screen.getAllByText("Norte")).toHaveLength(2)` en "muestra el resto de columnas de
  datos". No se perdió.
- **#26 (el `mutate` del listado).** Migró de verdad: `OrdenesCargaMasivaButton.test.tsx`
  asserta `expect(mutateMock).toHaveBeenCalledTimes(1)` tras la carga real. No se perdió.
- **#5-6 (`listMensajeros`).** El que muere es el método del **service**. El del repositorio,
  `IUserRepository.listMensajeros`, **sigue vivo** (lo usa `RankingService.ts:64`) y conserva
  cobertura propia: `tests/unit/repositories/user-repository.mensajeros.test.ts` (3 `it`) y
  `tests/unit/services/ranking-service.test.ts`. Comprobado, no asumido.
- **#10 (`R14: todo-o-nada por tienda`).** Era el guard de tenencia **de ese método**. Los dos
  caminos de asignación que sobreviven llevan su propia cobertura, intacta y sin tocar (R21).

**Falso positivo descartado:** `listarMensajerosParaAsignacion` (feature 17) y
`listarMensajerosSatelite` siguen en producción con su propia cobertura; no tienen nada que
ver con el `listarMensajeros` retirado. Los distinguí uno de otro antes de contar.

También verifiqué los 2 `describe` que `b2181e7` quitó de `rol-admin-satelite-authz.test.ts`
(fuera de los 45): probaban `AsignacionMensajeroService.listarMensajeros`, método borrado.
Legítimo, como ya dictaminó el review previo.

### Los 15 recuperados: ninguno pasa trivialmente

Verificado por mutación dirigida a cada uno de los tres archivos recuperados:

| mutación | archivo | resultado |
|---|---|---|
| repo deja de acotar por `tiendaId` | `orden-repository.resumen-carga.test.ts` | **ROJO** |
| proyección vuelve a traer mensajero | ídem | **ROJO** |
| servicio abre a `maestro` | `resumen-carga-masiva-service.test.ts` | **ROJO** |
| servicio consulta OTRA tienda | ídem | **ROJO** |
| action deja de exigir sesión | `carga-masiva-resumen-action.test.ts` | **ROJO** |
| action deja de validar el input | ídem | **ROJO** |
| modal cierra en vez de mostrar el resumen | `OrdenesCargaResumen` + `OrdenesCargaMasivaButton` | **ROJO** |

Nota de calidad: el doble del repo se acotó a `Pick<IOrdenRepository, "findResumenByNumRemisiones">`
en vez de arrastrar ~55 stubs. Es mejor que el original, no peor.

---

## 5. El test de migración: verifica algo real

**Sí, no es regex ceremonial**, dentro del límite conocido (`tests/integration/db/` es estático
sobre el texto, sin Postgres). Lo que hace bien:

- Trabaja sobre **sentencias**, no sobre el texto crudo: la cabecera explicativa no cuenta ni
  desordena los asserts de posición.
- Compara cada sentencia **literal y completa** (`toBe`, no `toMatch`), incluido el
  `ON DELETE SET NULL ON UPDATE CASCADE` del DOWN.
- Asserta el **orden por posición** en ambas direcciones y que no se toma el atajo `CASCADE`.
- Asserta que ninguna sentencia menciona `mensajero_asignado_id` y que el UP no lleva DML
  (que es R3 en su parte demostrable estáticamente).
- Asserta la **cabecera de honestidad** del `down.sql` (Q5).

**Verifiqué además lo que el test no dice: que el DOWN reproduce el original.** Comparado con
`db/migrations/20260710000000_carga_masiva_ordenes/migration.sql:14,17,20`, las tres sentencias
del DOWN coinciden **exactamente** en tipo, nombre de índice, nombre de FK y semántica de la
clave foránea. R2, en su parte textual, es correcto.

**Mis mutaciones (4/4 efectivas):**

| mutación | resultado |
|---|---|
| invertir el orden del UP (columna antes que FK) | **ROJO** (3 tests) |
| `ON DELETE SET NULL` -> `ON DELETE CASCADE` en el DOWN | **ROJO** |
| borrar la advertencia "NO restaura los DATOS" | **ROJO** |
| reintroducir `mensajeroSugeridoId` en `schema.prisma` | **ROJO** |

---

## 6. El guard de identificadores prohibidos (7 -> 9)

- **La lista es completa respecto al spec**: los 7 de R18 + los 2 que R20 nombra y faltaban
  (`findMensajerosByIds`, `countOrdenesDeTienda`). 9 exactos, ni sobra ni falta.
- **Dispara con las 9 plantadas** (sección 3a). Ninguna es letra muerta pese a que varias son
  subcadena de otras.
- **El assert inverso funciona**: borrar cualquiera de los 4 archivos del resumen o el método
  del repositorio deja el guard en rojo.
- **`menor`: la lista NO está asertada.** No hay ningún `expect` sobre `PROHIBIDOS`. Borrar una
  entrada del array deja toda la suite verde: el guard guarda producción, pero nada guarda al
  guard. Un `expect(PROHIBIDOS).toHaveLength(9)` —o, mejor, derivarla de la lista de R18/R20—
  lo cierra en una línea.
- Confirmo la deuda heredada del patrón: usa `fs.readdirSync`, no `git ls-files`. Basura local
  no versionada bajo esas cuatro raíces lo pone en rojo. Ajena a esta feature.

---

## 7. Cobertura R1-R22, verificada por mí

Recorrí los 22 contra el código, no contra la tabla de la bitácora. **21 con test que falla de
verdad; 1 incumplido.**

| R | Verificado por mí | Estado |
|---|---|---|
| R1 | migración: 3 sentencias literales + orden por posición. Mutación -> ROJO | **estático** |
| R2 | DOWN literal, idéntico al original de `20260710000000`. Mutación FK -> ROJO | **estático** |
| R3 | ninguna sentencia toca `mensajero_asignado_id`; UP sin DML | **estático** |
| R4 | guard + migración; mutación (columna de vuelta al schema) -> ROJO | OK |
| R5 | `bulk-orden-service.test.ts` — la fila con la clave se crea | OK |
| R6 | `RowResult` **entero** comparado con y sin la clave (`summary` completo) | OK |
| R7 | `not.toHaveBeenCalled()` sobre **las 4** lecturas del catálogo, por las dos vías. Mutación -> ROJO x2 | OK |
| R8 | `not.toHaveProperty` en persistencia + guard. Mutación (clave de vuelta a `filaCargaSchema`) -> guard ROJO | OK |
| R9 | service (mismo `summary`) + borde (mismo 200, mismo JSON, la clave llega intacta) | OK |
| R10 | — | **INCUMPLIDO** -> BLOQ-2 |
| R11 | paridad TS/yaml (props, orden, `required`, `type`, `deprecated`, `additionalProperties`). Mutación -> ROJO (4 tests) | OK |
| R12 | 11 `it` del componente + cableado del modal. Mutación (modal cierra) -> ROJO | OK |
| R13 | sin combobox, 0 botones, sin columna de mensajero. Mutación (botón plantado) -> ROJO | OK |
| R14 | `spyOn(Math, "random")` + `not.toHaveBeenCalled()`. Mutación -> ROJO | OK |
| R15 | 3 etiquetas, ninguna cita mensajero. Mutación (etiqueta "Asignar mensajero") -> ROJO | OK |
| R16 | nombre, no id; y el juego `reprogramada` dice lo mismo. Mutación -> ROJO (2 tests) | OK |
| R17 | marcador de dato ausente con y sin `relaciones`. Mutación (fallback a vacío) -> ROJO | OK |
| R18 | guard, 9/9 disparan | OK |
| R19 | guard asserta los 3 archivos ausentes | OK |
| R20 | los 3 métodos fuera y **los 3 en `PROHIBIDOS`** | OK |
| R21 | los 3 tests del gate **no aparecen en el diff** — intactos, verificado | OK |
| R22(a)(b)(c) | `CargaMasivaChunks.test.ts`, sin diff en esta rama | OK |
| R22(d) | repo + service recuperados; 4 mutaciones -> ROJO | **recuperado** |
| R22(e) | `GenerarGuiaModal`, `OrdenesListadoEtiquetasChain`, sin diff | OK |
| R22(f) | `ManifiestoFlujos`, `OrdenesCargaResumenPaso`, sin diff | OK (sobre componente huérfano) |
| R22(g) | action recuperada; 2 mutaciones -> ROJO | **recuperado** |

**Total de mutaciones aplicadas por mí: 21 efectivas de 21.** Apliqué 23; descarté 2 por
**mutantes equivalentes**, no por hueco de test: uno resultaba semánticamente idéntico dado el
input del test, y su versión decisiva sí murió; el otro —la clave de vuelta en
`filaCargaSchema`— no lo mata la suite del service pero **sí el guard**, que es la defensa que
la tabla de trazabilidad declara para R8.

---

## 8. `tasks.md` y `git status`

- **26 `[x]` + 3 `[ ]` = 29.** Coincide.
- **Lo sin marcar es justo lo no hecho**, verificado uno a uno:
  - **T1 (censo de arranque)** — no existe `progress/impl_159.md` con la lista archivo:línea.
    Correcto dejarla sin marcar: el resultado está cubierto (guard + escaneos), pero el censo
    *de arranque* que la task pedía no ocurrió.
  - **T4 (aplicar la migración)** — el SQL está escrito y blindado, pero el criterio de "hecho"
    es `pnpm run db:migrate` sobre una base con valores no nulos, y no se corrió.
  - **T5 (rollback)** — no se corrió.
- **Nada marcado se quedó a medias.** Tres marcadas declaran su propio límite en la nota, y lo
  acepto como honestidad, no como marcado falso:
  - **T14** dice explícitamente "ATENCION: R10 queda INCUMPLIDO". Lo que la task exigía (el
    test de paridad) **sí existe** y muere con mutación; lo que no se cumplió es R10.
  - **T28** declara que el criterio literal ("sin ningún `R<n>` sin test") no se cumple. La
    tabla existe y **declara el hueco en vez de ocultarlo**.
  - **T0** se cerró *a posteriori* (la puerta corrió después del código). La nota lo dice con
    esas palabras.
- **`git status --porcelain` vacío.**

---

## 9. Deuda declarada: la verifiqué, no la redescubrí

**El round-trip real NO se ejecutó.** Confirmado: no hay `.env` en el worktree (`./init.sh`
lo avisa), `pnpm db:generate` falla por `DATABASE_URL`, y no hay salida pegada de
`db:migrate` / `db:rollback` en ninguna bitácora.

**Debe bloquear producción: sí, y con un agravante que conviene decir en voz alta.**
`package.json:7` -> `scripts/migrate-deploy.ts`, cuya primera guarda es *"Solo migra el deploy
de PRODUCCION"* (preview solo con `MIGRATE_ON_PREVIEW`). Es decir: **este `DROP COLUMN` no se
ha ejecutado todavía en ningún entorno, y su primera ejecución del mundo sería contra la base
de producción.** No hay red debajo: el `DROP` es irreversible en datos y el `down.sql` —que
tampoco se ha corrido nunca— solo restituye estructura.

`docs/verification.md` lo pide literalmente (*"Verifica migraciones aplicando y revirtiendo en
un entorno de prueba"*) y `CHECKPOINTS.md` exige que `pnpm run db:rollback` **funcione**, no que
esté escrito. **T4 y T5 están bien sin marcar.** Es BLOQ-1.

---

## 10. Hallazgos

### BLOQUEANTE-1 — El round-trip de la migración sigue sin ejecutarse y estrenaría en producción

Lo anterior (sección 9). **Falta por hacer:** levantar una base de prueba con al menos una orden
con `mensajero_sugerido_id` no nulo y correr `db:migrate` -> `db:rollback` -> `db:migrate`,
comprobando con `\d orden` que (1) el UP deja fuera columna, índice y FK; (2) el DOWN los
repone con los mismos nombres y con `ON DELETE SET NULL ON UPDATE CASCADE`; (3) ningún
`mensajero_asignado_id` cambia. Pegar la salida real y marcar T4 y T5. **Antes del deploy a
producción.**

### BLOQUEANTE-2 — R10 sigue incumplido y además sin reconciliar en el spec

No discuto la decisión humana de no revertir el código: la acepto y no pido tocar los
artefactos de OpenAPI. El problema es otro y es barato: **`requirements.md` sigue diciendo lo
contrario de lo que hace el código.** R10 (`:79-82`) todavía reza *"El documento OpenAPI
publicado DEBE declarar la propiedad `mensajero_sugerido_id` de `CargaRow` como obsoleta"*,
mientras el documento la borró. `design.md §4:232-234` deja escrita la salida —*"Si el humano
elige (a), R10 se sustituye por 'el documento OpenAPI publicado NO DEBE declarar la
propiedad'"*— y **esa sustitución no se aplicó en ningún sitio**. La decisión vive solo en
`progress/`, y el spec de referencia queda mintiendo: el próximo agente que lea R10 contra el
código concluirá que hay un bug y "lo arreglará" reponiendo la propiedad.

Consecuencia práctica adicional, ya identificada por el implementer y que suscribo: **Q4 sigue
abierta y ahora decide algo.** Si hay integradores enviando la clave, el aviso tiene que salir
por fuera del documento, porque el documento ya no puede darlo.

**Falta por hacer:** reescribir R10 en `requirements.md` a su forma sustituida, con la firma y
la fecha del humano, y cerrar Q4 (hay integradores / no hay). Coste: dos líneas. No toca código.

### Menores

- **`menor` — la lista `PROHIBIDOS` del guard no está asertada.** Sección 6. Borrar una entrada
  deja la suite verde.
- **`menor` — `OrdenesCargaResumenPaso.tsx` sigue huérfano**, y con él el botón de manifiesto
  de la 148 sigue sin salida en la UI real. **Confirmo que es preexistente y ajeno**: verifiqué
  en `8e34fbc` que el modal ya montaba `OrdenesCargaResumen` **directo** antes de la 159. Lo
  que sí ha cambiado es que el hueco natural donde engancharlo **vuelve a existir**. Merece su
  ficha propia, como recomendaba Q3.
- **`menor` — registro de proceso sin cerrar.** `progress/current.md:306` sigue listando la 159
  como `spec_ready`; no hay entrada en `progress/history.md`; el `status_note` de
  `feature_list.json` todavía describe los 5 bloqueantes como abiertos y cita "cobertura real
  14/22", que ya no es cierto. Es trabajo del leader (la bitácora lo dice en su sección 6.5),
  pero está obsoleto **ahora**. La regla de max-2-por-zona sí se respeta: `in_progress` en
  `fullstack` son 159 y 160, y `./init.sh` lo valida en verde.
- **`menor` — `progress/impl_159.md` no existe.** El mapa `R<n> -> test` vive en
  `impl_159_cierre.md`. `CHECKPOINTS.md` pide `progress/impl_<feature>.md`. Cosmético; lo
  señalo para que el leader decida si renombra o deja constancia del alias.
- **`menor` (heredado, no exigido) — el `down.sql` no es idempotente en su tercera sentencia.**
  `ADD CONSTRAINT` no admite `IF NOT EXISTS` en Postgres: aplicar el DOWN dos veces falla ahí,
  mientras sus otras dos sí son idempotentes. Es el patrón del resto del repo.
- **`menor` (preexistente) — no hay E2E de carga masiva.** `CHECKPOINTS.md` pide E2E para
  flujos críticos e incluye "ingesta de órdenes"; `e2e/` no tiene ningún spec de carga masiva y
  nunca lo tuvo. La 159 no lo empeora: repone un paso que ya existía. Ajeno a esta rama.

---

## 11. `CHECKPOINTS.md`, punto por punto

**Especificación**
- [x] `requirements.md` con R1-R22 en EARS.
- [x] `design.md` con alternativas descartadas (A1-A5).
- [ ] **`tasks.md` con todas las tasks `[x]`: 26 de 29.** Las 3 sin marcar son honestas (T1, T4,
      T5) — pero el checkpoint exige *todas*, así que este punto **no pasa** hasta cerrar BLOQ-1.

**Trazabilidad**
- [ ] **Cada `R<n>` mapea a un test: 21 de 22.** Falla **R10** (incumplido, BLOQ-2).
- [x] El mapa `R<n> -> test` existe (en `progress/impl_159_cierre.md` sección 7) y es fiel: lo
      recorrí entero y no encontré ninguna fila que prometa más de lo que su test hace.

**Calidad de código**
- [x] `pnpm run typecheck` — 0 errores.
- [x] `pnpm run lint` — 0 errores, 10 warnings (los mismos de `dev`).
- [x] `pnpm test` — 6286/6286.
- [~] E2E: no hay E2E de carga masiva; preexistente y ajeno (sección 10).

**Datos y seguridad (Supabase)**
- [x] No hay tabla nueva. `orden` conserva su RLS habilitada sin policies; ninguna policy citaba
      la columna, el `DROP` no altera la postura de seguridad. El test asserta que ninguna
      sentencia toca `ROW LEVEL SECURITY`.
- [ ] **Migración reversible: el `down.sql` existe y es correcto en texto, pero
      `pnpm run db:rollback` NO se ha demostrado.** BLOQ-1.
- [x] Ningún secreto hardcodeado; el diff no toca configuración ni credenciales.
- [x] Webhooks: no aplica, la 159 no toca ninguno.

**Patrón de capas** — [x] Correcto. Action (auth + zod) -> Service (authz + regla de tenencia) ->
Repository (solo query). El service no importa nada de HTTP; el repositorio no decide nada.
Interfaces en `lib/interfaces/{repositories,services}/`.

**Permisos** — [x] `puedeCargarMasiva = rol === adminTienda` (servidor, `page.tsx:55`) coincide
con la authz del service. La mutación sobre el borde (sin sesión -> `ok`) muere. No se añadió
ninguna ruta ni se degradó ninguna validación.

**Multi-país / configuración** — [x] Sin país, moneda ni cuenta hardcodeados.

**Verificación final**
- [x] `./init.sh` termina en verde, medido por mí.
- [ ] `progress/review_159_cierre.md` con veredicto `OK` — **este archivo: APROBADO-CON-NOTAS,
      2 bloqueantes.**
- [ ] **No hay entrada en `progress/history.md`.**

---

## 12. Qué falta para que la 159 pase a `done`

1. Correr el round-trip real de la migración y pegar la salida; marcar T4 y T5. **Bloquea
   producción** (sección 9).
2. Reconciliar R10 en `requirements.md` con la decisión humana ya tomada, y cerrar Q4.
3. Asertar la lista `PROHIBIDOS` del guard (una línea).
4. Cerrar el registro: `progress/current.md`, `progress/history.md` y el `status_note` de
   `feature_list.json`. Trabajo del leader.
5. Abrir ficha propia para `OrdenesCargaResumenPaso.tsx` / manifiesto de la 148 (Q3).

Nada de esto lo arregla el reviewer.

---

**Veredicto final: APROBADO-CON-NOTAS** — 2 bloqueantes, ambos declarados de antemano por el
implementer y confirmados por mí. El trabajo de esta rama es sólido: salda 4 de los 5
bloqueantes enteros y el quinto a medias, recupera cobertura que **sí** puede fallar (21 de mis
21 mutaciones efectivas la mataron), **ninguno de los 30 descartes se llevó nada vivo**, y la
suite entera pasa en 575 archivos / 6286 tests / 0 fallos. Lo que queda no es papeleo en el
caso de BLOQ-1: es un `DROP COLUMN` irreversible que nadie ha ejecutado nunca y que estrenaría
en producción.
