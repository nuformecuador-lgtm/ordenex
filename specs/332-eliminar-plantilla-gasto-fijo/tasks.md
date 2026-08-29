# Ficha 332 — Eliminar plantillas de gasto fijo · tasks

> Zona `fullstack`, complejidad baja. **Se secuencia backend → frontend** (T1–T13 antes que
> T14–T18). `[P]` = puede ir en paralelo con las otras `[P]` de su mismo bloque.
> `[dep: Tn]` = no arranca hasta que `Tn` esté hecha.
>
> **Antes de empezar, dos cosas que no son opcionales:**
> - **La 85 y la 332 se pisan.** Las dos tocan `GastosFijosPlantillasPanel.tsx`,
>   `GastoFijoPlantillaDialog.tsx` y `lib/types/gasto-fijo-plantilla.ts`. No se implementan en
>   paralelo (ver `design.md §7 R-2` y la Pregunta abierta 1 de `requirements.md`).
> - **El gate rápido no aplica.** El diff toca `db/schema.prisma` y rutas con nombre de dinero:
>   `./init.sh --rapido` **se niega solo**. El gate de esta ficha es `./init.sh` completo.

---

## Bloque 0 — Arranque

### [ ] T0 — Rama desde `dev` y lectura del terreno
- Crear `feature/332-eliminar-plantilla-gasto-fijo` desde `origin/dev` (`git fetch origin dev`).
- Leer enteros, antes de editar: `lib/services/GastoFijoPlantillaService.ts`,
  `lib/repositories/GastoFijoPlantillaRepository.ts`, las dos interfaces,
  `lib/actions/gasto-fijo-plantilla.ts`, `lib/types/gasto-fijo-plantilla.ts` y
  `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx`.
- **Hecho cuando:** la rama existe, `git status` limpio y `pnpm typecheck` sale en 0 errores
  ANTES de tocar nada (línea base: si ya venía roja, se sabe ahora y no al final).

---

## Bloque 1 — Backend: repositorio

### [ ] T1 — `eliminar` en el contrato del repositorio `[dep: T0]`
- `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts`: añadir
  `eliminar(id: string): Promise<boolean>` con su docstring.
- En el MISMO archivo, reescribir la nota de cabecera (l. 7-8, «NO expone `delete` (R25)») con la
  revocación **larga**: la palabra *revoca*, la fecha `2026-08-29`, el motivo y el puntero
  `specs/332-eliminar-plantilla-gasto-fijo`. Éste es el sitio donde la nota va completa; los demás
  llevan una línea con el puntero (T13).
- Reescribir también l. 33 («activa/desactiva… (sin borrado)»).
- **Hecho cuando:** `pnpm typecheck` marca el repositorio concreto como incompleto (falta
  implementar `eliminar`) — ese error ES la señal de que el contrato cambió. (R2/R22)

### [ ] T2 — Implementar `eliminar` en el repositorio `[dep: T1]`
- `lib/repositories/GastoFijoPlantillaRepository.ts`:
  `const res = await this.prisma.gastoFijoPlantilla.deleteMany({ where: { id } }); return res.count > 0;`
- **NO ensanchar** `PlantillaPrismaClient = Pick<PrismaClient, "gastoFijoPlantilla">` (l. 11): esa
  restricción es lo que hace imposible tocar el libro (R8).
- Reescribir las notas de l. 57-59 y l. 96.
- **Hecho cuando:** `pnpm typecheck` en 0 y el método existe con `deleteMany` (no `delete`).
  (R2/R3/R8)

### [ ] T3 — Test del repositorio: el `WHERE` y las tablas que no toca `[dep: T2]`
- Nuevo `tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts` con un doble de Prisma que
  **capture los argumentos** de `deleteMany` (patrón `historicos-paginados-where.test.ts`).
- Casos: (a) «filtra por el id exacto y por ninguna otra columna» — assert
  `{ where: { id: "…" } }` literal; (b) «count 0 → devuelve false»; (c) «el doble sólo expone
  `gastoFijoPlantilla`: cualquier otro acceso revienta el test».
- **Hecho cuando:** los 3 casos pasan y **una mutación del `where` (p. ej. `{}`) los pone rojos** —
  compruébalo, no lo supongas: un test de servicio con `vi.fn()` no ve el `WHERE`. (R3/R8)

---

## Bloque 2 — Backend: tipos, servicio y acción

### [ ] T4 — Schema de borde `[P]` `[dep: T0]`
- `lib/types/gasto-fijo-plantilla.ts`: `eliminarPlantillaSchema = z.object({ id: z.string().uuid() }).strict()`
  + `EliminarPlantillaInput`.
- Reescribir la nota de l. 66.
- **Hecho cuando:** typecheck en 0 y `.strict()` presente (una clave desconocida debe morir en el
  borde). (R6)

### [ ] T5 — Contrato del servicio `[dep: T4]`
- `lib/interfaces/services/IGastoFijoPlantillaService.ts`: `EliminarPlantillaServiceResult`
  (`ok` | `forbidden` | `not_found`) y `eliminarPlantilla(input, actor)`.
- **En el docstring de `eliminarPlantilla` va el contrato con la 333** (R25), con sus tres puntos:
  cancelación en la misma operación atómica, conteo ANTES para la confirmación, y que la 332 no
  decide qué pasa si el número cambia entre medias. Copiar el fondo de `design.md §5`.
- Reescribir las notas de l. 12-14 y l. 59.
- **Hecho cuando:** typecheck marca `GastoFijoPlantillaService` como incompleto. (R25/R22)

### [ ] T6 — Implementar `eliminarPlantilla` en el servicio `[dep: T5, T2]`
- Guard `esAccesoTotal(actor.rol)` **antes** de tocar el repositorio; luego `repo.eliminar(id)`;
  `ok` / `not_found` según el booleano. Sin `obtenerPorId` previo (ver `design.md §2.2`).
- Anotar el riesgo R-1 de `design.md §7` (borrar y recrear rompe la clave de idempotencia) junto
  al método.
- Reescribir las notas de l. 27-28 y l. 74. **Cuidado con l. 108-109:** ahí «no se borra (R25)»
  sostiene la excepción declarada a `170/R29` de la feature 184 — se cambia la premisa citada y
  **se deja el resto del párrafo tal cual** (`design.md §4.2`).
- **Hecho cuando:** typecheck en 0. (R2/R4/R7/R25)

### [ ] T7 — Tests del servicio, incluida la INVERSIÓN del testigo `[dep: T6]`
- `tests/unit/services/gasto-fijo-plantilla-service.test.ts`:
  - actualizar `buildRepo` (l. 38-50) con `eliminar` — es un literal completo de la interfaz y
    revienta el typecheck si no.
  - casos nuevos: «rol sin acceso total → forbidden, sin llamar a `repo.eliminar`» (R4);
    «acceso total → ok y llama a `eliminar` con el id» (R2); «`eliminar` devuelve false →
    not_found, sin lanzar» (R7); «admin → ok (paridad con maestro, feature 94)».
  - **INVERTIR** el `describe` de l. 188-199 («— sin borrado (R25)»): pasa a
    «borrado habilitado — la ficha 332 revoca 45/R25», las aserciones se dan vuelta y el
    comentario conserva que hasta el 2026-08-29 se afirmaba lo contrario, con el puntero.
    **No se borra el bloque** (`design.md §4.3`).
- **Hecho cuando:** `pnpm exec vitest related --run lib/services/GastoFijoPlantillaService.ts`
  verde y el `describe` invertido existe con su nota histórica. (R2/R4/R7)

### [ ] T8 — Server Action `[dep: T6, T4]`
- `lib/actions/gasto-fijo-plantilla.ts`: `EliminarPlantillaActionResult` + `eliminarPlantillaAction`,
  espejo literal de `setActivaPlantillaAction` (sesión → `UnauthenticatedError`; `parse` →
  `VALIDATION_ERROR`; delegación al service dentro de `withErrorHandler`).
- **Sin** anotación `@sin-superficie`: nace con consumidor (T14).
- Reescribir las notas de l. 31 y l. 118.
- **Hecho cuando:** typecheck y lint en 0. (R5/R6)

### [ ] T9 — Tests de la acción `[dep: T8]`
- `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts`: actualizar `fakeService` (l. 34-57,
  literal completo) y añadir: «sin sesión → unauthenticated, sin tocar el service» (R5); «id que no
  es uuid → validation_error, sin tocar el service» (R6); «clave desconocida → validation_error»
  (R6, `.strict()`); «forbidden lo decide el service» (R4).
- **Hecho cuando:** los 4 casos verdes. (R5/R6)

### [ ] T10 — Reparar los dobles que rompe el contrato nuevo `[P]` `[dep: T1, T5]`
- `tests/integration/db/generacion-gastos-fijos.test.ts:81-92` (`fakePlantillaRepo`) es un literal
  completo de `IGastoFijoPlantillaRepository`: añadir `eliminar: vi.fn()`.
- Barrer con typecheck cualquier otro literal completo de las dos interfaces (los `as unknown as`
  de `gasto-fijo-plantillas-{paginado,completo}.test.ts` NO se ven afectados).
- **Hecho cuando:** `pnpm typecheck` en 0 en todo el repo. (—)

### [ ] T11 — Test contra Postgres: el libro sobrevive `[dep: T2]`
- Nuevo `tests/integration/db/gasto-fijo-plantilla-borrado.test.ts`: crear plantilla → crear
  `wallet_movimiento` con `origen_tipo='gasto'`, `origen_id='<id>:2026-09'`,
  `categoria='egreso_gasto_fijo'`, descripción `'<concepto> — 2026-09'` → borrar la plantilla →
  afirmar que el movimiento sigue con `monto`, `fecha_movimiento`, `origen_id` y `descripcion`
  intactos, y que la plantilla ya no está.
- **El test debe FALLAR si el fixture no se pudo crear.** Nada de `if (!x) return;`: en este repo
  ese patrón ya reportó «passed» sin comprobar nada.
- **Hecho cuando:** pasa con `DATABASE_URL` puesta, y el implementer **declara en
  `progress/impl_332.md` si lo corrió o se saltó** (va envuelto en `HAY_BASE_DE_DATOS`). (R8/R9)

### [ ] T12 — Caso de la clave derivada `[P]` `[dep: T10]`
- En `tests/integration/db/generacion-gastos-fijos.test.ts`, caso nuevo: «dos plantillas con el
  MISMO concepto producen `origen_id` distintos» — el testigo de que borrar y recrear no reusa la
  clave de idempotencia (riesgo R-1).
- **Hecho cuando:** el caso pasa y su comentario apunta a `design.md §7 R-1`. (R10)

### [ ] T13 — Comentario del modelo y barrido de notas del backend `[dep: T6, T8]`
- `db/schema.prisma` l. 1815: sustituir «NO se borra (R25)…» por la revocación con fecha, motivo y
  puntero. **Sólo el comentario: el modelo no cambia y NO hay migración.**
- Verificar que quedan cubiertos los sitios 1–13 del censo de `design.md §4.1`.
- **`db/migrations/20260713150000_gasto_fijo_plantilla/` NO SE TOCA** (R24): es una migración
  aplicada, foto de su fecha.
- **Hecho cuando:** `grep -ri "sin borrado\|no se borra\|NUNCA borrar" lib/ db/schema.prisma` no
  devuelve ninguna afirmación vigente sobre plantillas de gasto fijo. (R21/R22/R24)

---

## Bloque 3 — Frontend (arranca con el Bloque 2 cerrado)

### [ ] T14 — Botón «Eliminar» + confirmación en el panel `[dep: T8]`
- `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx`:
  - tercer botón `variant="destructive"` en la columna «Acciones», deshabilitado sólo en su fila
    mientras el borrado está en vuelo (patrón del estado `alternando`);
  - `Modal` de `components/shared/Modal.tsx` con `confirmVariant="destructive"`,
    `confirmLabel="Eliminar"`, título, la plantilla identificada con concepto + `money(p.monto)`
    (STRING, sin `parseFloat`/`Number`), las tres consecuencias y la línea de la alternativa
    «Desactivar». Textos exactos en `design.md §3.2`;
  - handler: `ok` → `toast.success` + `recargar()` + `router.refresh()`; los cuatro errores con
    mensaje propio cada uno; `not_found` además `recargar()`.
- **No tocar** el botón Desactivar/Activar ni su handler (R11).
- **Hecho cuando:** typecheck + lint en 0 y el panel compila con el diálogo cerrado por defecto.
  (R1/R12/R13/R14/R15/R16/R17/R18/R19)

### [ ] T15 — Volver a la página anterior si la página queda vacía `[dep: T14]`
- Tras un borrado con éxito: si la página visible tenía exactamente 1 fila y `page > 1`,
  `setPage(page - 1)`. Sin tocar `components/shared/Pagination.tsx`.
- **Hecho cuando:** existe la condición y el test de T17 la cubre. (R20)

### [ ] T16 — Notas de revocación del frontend `[P]` `[dep: T14]`
- `GastosFijosPlantillasPanel.tsx` l. 66-70 («NUNCA borrar, R25…») y
  `GastoFijoPlantillaDialog.tsx` l. 18 y 23 («Sin borrado (R25)…»): reescribir con el puntero a
  `specs/332-…` y la fecha.
- **Hecho cuando:** `grep -ri "sin borrado\|NUNCA borrar" app/(app)/wallet/` no devuelve ninguna
  afirmación vigente. (R21/R22)

### [ ] T17 — Tests del panel `[dep: T15]`
- `tests/unit/components/wallet-gastos-fijos-panel.test.tsx`: añadir `eliminarPlantillaAction` al
  `vi.mock` del módulo de acciones (l. 24-30) y actualizar el comentario de cabecera (l. 12-15,
  dice «nunca borran»).
- Casos: «cada fila ofrece Eliminar» (R1); «Eliminar abre la confirmación y NO llama a la acción»
  (R12/R13); «la confirmación nombra el concepto y pinta ₡300 desde el STRING» (R14); «enuncia las
  tres consecuencias» (R15); «menciona Desactivar como alternativa» (R16); «Cancelar no llama a la
  acción» (R17); «confirmar llama con `{ id }` y tras `ok` avisa y relee» (R2/R18); «cada error
  muestra su mensaje» ×4 (R19); «borrada la última fila de la página 2, pide la página 1» (R20);
  «Desactivar sigue llamando a `setActiva`» (R11).
- **Hecho cuando:** todos verdes con `pnpm exec vitest related --run <panel>`; si alguno cae por
  timeout, aislarlo antes de declararlo rojo (los 20 s de esta suite se agotan bajo carga).
  (R1/R2/R11–R20)

---

## Bloque 4 — Dejar la revocación por escrito

### [ ] T18 — Apéndice en el spec de la ficha 45 `[P]` `[dep: T13]`
- **AÑADIR** (nunca reescribir) el bloque `⚠️ SUPERSEDED 2026-08-29 por la ficha 332` al final de
  `45/R25` en `specs/45-wallet-gastos-sueldos/requirements.md` y en la línea equivalente de
  `design.md:236`. Texto base en `design.md §4.4`.
- **El texto original de `45/R25` se conserva verbatim.** Si se «deja coherente», se borra la
  prueba de que aquella decisión se tomó a conciencia.
- **Hecho cuando:** el apéndice existe en los dos archivos y `git diff` muestra sólo LÍNEAS
  AÑADIDAS en ellos. (R23)

### [ ] T19 — La guardia de la revocación `[dep: T13, T16, T18]`
- Nuevo `tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts`, bloques:
  - **(0)** autocomprobación: los archivos censados existen, ninguno está vacío, el censo no está
    vacío (cota mínima explícita). *Una guardia estática rota no falla: calla.*
  - **(a)** ningún archivo vivo afirma que las plantillas no se pueden borrar (R21).
  - **(b)** la revocación está escrita con sus cuatro piezas —palabra *revoca*, fecha `2026-08-29`,
    motivo y puntero `specs/332-eliminar-plantilla-gasto-fijo`— en los contratos censados (R22).
  - **(c)** `specs/45/requirements.md` y `design.md` llevan el apéndice con puntero y fecha (R23).
  - **(d)** testigos verbatim del texto original de `45/R25` (R23).
  - **(e)** `db/migrations/**` queda FUERA del censo, con el motivo escrito en el propio archivo de
    la guardia: migración aplicada = foto de su fecha (R24).
  - **(f)** el contrato con la 333 está escrito en el docstring de `eliminarPlantilla` y en
    `specs/332/design.md §5`: cancelar los pendientes y anunciar su número en la confirmación (R25).
- **Hecho cuando:** `pnpm exec vitest run guard` verde **y** cada bloque se ha visto en rojo al
  menos una vez rompiéndolo a mano (borra una pieza, corre, restáurala). Un bloque que nunca se vio
  rojo no prueba nada. (R21–R25)

---

## Bloque 5 — Cierre

### [ ] T20 — Gate completo `[dep: T17, T19, T11, T12]`
- `./init.sh` **completo** (el rápido se niega solo: `db/schema.prisma` + rutas con nombre de
  dinero). Capturar `INIT_EXIT=$?` **dentro** del log, no confiar en el exit code del envoltorio.
- Comparar contra `tests/baseline-rojos.json`: verde = ningún archivo nuevo en rojo. Si alguno cae
  por timeout, aislarlo antes de llamarlo regresión.
- **No correr el gate en paralelo con ningún subagente editando el árbol.**
- **Hecho cuando:** el gate sale verde con su salida pegada en `progress/impl_332.md`.

### [ ] T21 — Bitácora y mapa `R<n> → test` `[dep: T20]`
- `progress/impl_332.md`: archivos tocados, mapa completo `R1..R26 → test` (R26 marcado como
  diferido a la 333, sin test, y **dicho**), salida de los tests, y si T11 corrió o se saltó por
  falta de `DATABASE_URL`.
- **Hecho cuando:** el archivo existe, está **commiteado** (un informe sin commitear se lo lleva el
  primer `git checkout`) y el reviewer puede verificar cada fila sin preguntar nada.

### [ ] T22 — Repaso a mano en el navegador `[dep: T20]` · **lo hace el humano**
- Entrar a `/wallet` con un rol de acceso total, abrir la confirmación de una plantilla y mirar:
  que el concepto y el monto se lean de un vistazo, que las tres consecuencias se entiendan sin
  releer, que la alternativa «Desactivar» no se pierda entre el texto, y que el botón destructivo
  no se confunda con «Desactivar».
- **Hecho cuando:** hay un veredicto escrito. **No se marca por haber pasado los tests:** un
  subagente no puede levantar un navegador, y en este repo un repaso visual de minutos encontró 7
  textos rotos que 12.000 tests daban por buenos.

---

## Archivos que toca esta ficha (para la validación de conflicto del leader)

**Producción:** `db/schema.prisma` (comentario) · `lib/interfaces/repositories/IGastoFijoPlantillaRepository.ts` ·
`lib/repositories/GastoFijoPlantillaRepository.ts` · `lib/interfaces/services/IGastoFijoPlantillaService.ts` ·
`lib/services/GastoFijoPlantillaService.ts` · `lib/types/gasto-fijo-plantilla.ts` ·
`lib/actions/gasto-fijo-plantilla.ts` · `app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx` ·
`app/(app)/wallet/_components/GastoFijoPlantillaDialog.tsx` (comentario).

**Tests:** `tests/unit/services/gasto-fijo-plantilla-service.test.ts` ·
`tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` ·
`tests/unit/components/wallet-gastos-fijos-panel.test.tsx` ·
`tests/unit/repositories/gasto-fijo-plantilla-eliminar.test.ts` (nuevo) ·
`tests/integration/db/gasto-fijo-plantilla-borrado.test.ts` (nuevo) ·
`tests/integration/db/generacion-gastos-fijos.test.ts` ·
`tests/unit/guards/plantilla-gasto-fijo-borrado.guardia.test.ts` (nuevo).

**Specs de otra ficha (sólo apéndice, append-only):** `specs/45-wallet-gastos-sueldos/requirements.md` ·
`specs/45-wallet-gastos-sueldos/design.md`.

**Sin migración.** **Sin cambio de esquema.** **`db/migrations/**` no se toca.**
