# Review 236 — Ayuda a la tienda: pestaña propia en `/novedades` y lectura del hilo

> ⚠️ **ESTE ACTA TIENE DOS PARTES, Y LAS DOS VALEN.** Lo que sigue es el **RECHAZO original**
> (2026-08-19), que se conserva íntegro: es el registro de que esto pasó y de qué se midió para
> encontrarlo. El **veredicto vigente** está al final, en §«ADENDA — re-verificación de los tres
> arreglos». **Vigente: OK.**

> **Reviewer.** Rama `feature/236-ayuda-tienda-novedades`, 3 commits sobre `origin/dev` = `7c65be9c`.
> 48 archivos, +7249 / −1130. Acta escrita de forma **incremental**.
> **`./init.sh` NO se corrió aquí, a propósito:** el gate completo lo corre el leader con el árbol
> quieto. Lo que sí se corrió, y está medido abajo: typecheck, lint, 24 suites y **3 mutaciones
> propias** (una a una, revertidas con `sha256` comprobado).

---

## VEREDICTO

**RECHAZADO — por trazabilidad, no por código.**

**El código y los tests están bien y no hay que tocarlos.** Lo que falla son **tres afirmaciones del
papeleo que no se sostienen contra el árbol**, y una de ellas es la que el arnés lleva tres fichas
repitiendo: una fila del mapa `R<n> → test` que apunta a un archivo **que nunca ha existido en
ninguna rama**. Se arregla en tres bloques de Markdown, sin abrir un solo `.ts`.

Los tres puntos que el encargo pedía mirar con lupa —el corte del servidor, la guardia que **subió**
de intersección a igualdad, y las tres `@sin-superficie`— **los verifiqué por mi cuenta y aguantan**.

---

## Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con **47 requisitos EARS** numerados `R1`-`R47`, nueve decisiones (`D1`-`D9`) y la puerta humana pasada el 2026-08-19 (D6, D3 y D8 firmadas por el humano; el resto por el leader).
- [x] `design.md` con **seis** alternativas descartadas y su porqué (§10 A-F), no una.
- [~] `tasks.md`: **T0.1** y **T8.3** siguen sin marcar. **No es defecto del implementer:** T0.1 dice literalmente «bloquea el despliegue, no T1» (re-medir producción antes de desplegar) y T8.3 es del leader (`feature_list.json` + gate completo + SHA contra `origin/dev`). **Quedan como condición para pasar a `done`.**

### Trazabilidad
- [x] Los **54** pares `archivo.test.ts › «caso»` citados en las dos bitácoras **existen todos**: comprobado archivo por archivo y nombre por nombre (comparación insensible a tildes) contra el árbol de `tests/`. **Cero casos inventados.** Es el mejor resultado de esta pila.
- [ ] **BLOQUEANTE-1** — `tasks.md:374` mapea **R45** a un archivo que no existe ni ha existido nunca.
- [ ] **BLOQUEANTE-3** — **R41-R46 no tienen fila** en el mapa `R<n> → test` de **ninguna** de las dos bitácoras. `CHECKPOINTS.md` lo exige explícitamente.

### Calidad de código
- [x] `pnpm exec tsc --noEmit` → **exit 0**, corrido por mí sobre el árbol quieto.
- [x] `eslint` sobre los 48 archivos de la rama → **0 errores, 1 aviso**. El aviso (`_input` sin usar, `habilitar-novedad-service.test.ts:61`) **es preexistente**: verificado en `git show 7c65be9c:<archivo>`.
- [x] Tests: **24 suites corridas por mí, todas verdes** (detalle abajo). Con la base local **tal cual**, con las 3 órdenes en `ayuda_tienda` con notas del recorrido humano.
- [n/a] E2E: no hay harness Playwright en el repo y la feature no toca auth, pagos, recaudo, ingesta ni webhooks. Cubierto por el recorrido manual de T7.7 (`progress/recorrido_236.md`).

### Datos y seguridad
- [x] **Ninguna tabla, columna, migración ni política RLS nuevas** — y es una decisión escrita (`design.md` §1.1), no un olvido. Verificado: el diff no toca `prisma/`, `migrations/` ni el catálogo de estados.
- [x] Sin secretos hardcodeados. Sin webhooks nuevos.

### Patrón de capas
- [x] Las cuatro Server Actions (`lib/actions/novedades.ts`) resuelven actor, validan zod y delegan al service. **Cero queries.**
- [x] `NovedadesService` no conoce HTTP. `OrdenRepository` sólo ejecuta Prisma.
- [x] Los contratos nuevos viven en `lib/interfaces/{repositories,services}/`.

### Permisos
- [x] `page.tsx:31-34` valida `actor.rol !== "adminTienda"` y hace `notFound()` **antes** de leer nada.
- [x] `NovedadesModule` es cliente y recibe **todo por props**; no fetchea datos sensibles.
- [x] Las cuatro lecturas son Server Actions, no rutas de API.

### Multi-país
- [x] Ningún país, moneda ni cuenta hardcodeados.

### Verificación final
- [ ] `./init.sh` completo: **pendiente del leader**, con el árbol quieto.
- [x] Este acta existe.
- [ ] Entrada en `progress/history.md`: pendiente (leader, T8.3).

---

## Lo que el encargo pidió mirar con lupa — medido, no recitado

### 1 · El corte del servidor · **AGUANTA**

- **`count` y `find` comparten predicado POR CONSTRUCCIÓN, no por dos copias.** `countNovedadesByTienda` (`OrdenRepository.ts:3080`) y `findNovedadesByTienda` (`:3105`) llaman **los dos** a `this.novedadWhere(tiendaId, grupo)` con el mismo `grupo` recibido. No hay un segundo `where` escrito en ningún sitio.
- **El evaluador hace LAS DOS cosas.** `casa()` (`orden-repository.novedades.test.ts:62`) aplica el predicado a filas sintéticas **y revienta** ante cualquier forma que no entienda. Se auto-prueba en el bloque 0 contra respuestas conocidas y contra las tres formas rechazadas (`OR`, clave hermana, `in`).
- **Lo comprobé con una mutación propia (RV3):** con el `OR` de ayer repuesto, el evaluador lanza `Error: el predicado de novedades tiene claves inesperadas [OR, deletedAt, tiendaId]…` en 3 casos y caen **13 tests**. **No responde `false` en silencio.**
- **El test contra Postgres real CORRE, no se salta.** `tests/integration/db/novedades-predicado-sql-real.test.ts` da **4 passed** contra `localhost:5432` en 1,07 s, corrido por mí. El salto es `describe.skip` **de archivo entero** (aparecería como *skipped*, con nombre): **no** hay ningún retorno temprano que reporte «passed» sin comprobar nada, que es el patrón que este repo ya sufrió. Las aserciones son `.resolves` sobre lecturas reales: un SQL inválido las rechaza. Y lleva su propia anti-vacuidad sobre el número de grupos.

### 2 · La guardia `hilo-ventana-alcanzable` · **SUBIÓ DE VERDAD, y sigue atada al predicado**

- **¿Es más fuerte?** Sí. La vieja exige **intersección no vacía**; la nueva (`236/R36`) exige **igualdad exacta** entre `ESTATUS_POR_GRUPO` proyectado por `GRUPOS_NOVEDAD` y `VENTANA_ESCRITURA.adminTienda`. Igualdad implica intersección no vacía: estrictamente más fuerte. Y la **asimetría está escrita**: para el mensajero se conserva la inclusión, con `por_recoger` nombrado como el que sobra a propósito.
- **¿Sigue atada al predicado real, o compara dos constantes?** **Atada.** `estatusDeNovedades()` lee el **valor** del mapa, pero dos casos del bloque 0 leen el **texto fuente real** de `OrdenRepository.ts`: `novedadWhereUsaElMapa()` (el cuerpo **indexa** `ESTATUS_POR_GRUPO`) y `literalesDeEstatusEnNovedadWhere()` (el cuerpo **no contiene ningún literal de estatus**, ni directo ni escondido tras un `const`). Con las dos, leer el mapa es leer el predicado.
- **La atadura la ejercí en RV3:** mi mutación usó `ESTATUS_POR_GRUPO.devolucion` con **punto** en vez de corchete y la guardia **igual cayó** (`236/R5: novedadWhere TOMA su estatus del mapa`). El detector no se conforma con que el nombre del mapa aparezca en el cuerpo.
- **La afirmación «con la mutación (c) el caso viejo sigue verde y sólo cae la igualdad nueva» — VERIFICADA por mí** (RV1). Con `ayuda_tienda` fuera de la ventana del `adminTienda`, el caso `cada rol tiene al menos un estatus alcanzable en su pantalla donde puede publicar` queda **VERDE**, y caen las tres nuevas. Exactamente lo que la bitácora dice. Ellos citaron «2 failed / 13 passed» y yo mido «3 failed / 15 passed»: la diferencia es el caso de T6.6, escrito después de esa corrida. No es discrepancia.

### 3 · Las tres `@sin-superficie` · **CABLEADAS DE VERDAD, no sólo importadas**

Verificado en el código, no en la bitácora:

| Export | Import | **Ejecución real** |
| --- | --- | --- |
| `listarAyudaTiendaAction` | `page.tsx:6`, `NovedadesModule.tsx:10` | `page.tsx:37` (pre-fetch pág. 1, dentro del `Promise.all`) **y** `NovedadesModule.tsx:160` como `recursos.listarPagina`, **invocada** en `cambiarPagina()` (`:322`) |
| `listarAyudaTiendaCompletoAction` | `NovedadesModule.tsx:11` | `:161` como `recursos.listarCompleto`, **invocada** en `obtenerFilas` del `DescargarDatasetButton` (`:385`) |
| `COLUMNAS_DESCARGA_AYUDA` · `filaDescargaAyuda` · `TITULO_DESCARGA_AYUDA` | `:35-37` | `:162-164`, bajadas como props `titulo` y `columnas` y usadas en `filasDesdeResultado(...)` (`:382-386`) |

No hay un import huérfano poniendo la guardia verde: los cinco símbolos entran por `RECURSOS_POR_GRUPO[grupo]`, que es lo que el componente **ejecuta**. `superficie-de-uso.guardia.test.ts`, corrido por mí: verde. Y en el árbol no queda ninguna anotación viva.

### 4 · Las dos limitaciones declaradas — juzgadas

- **La guardia de T6.6 no ve un cable desactivado.** Con el montaje envuelto en `false &&`, el texto del componente sigue en el archivo y el censo estático sigue verde. **Aceptable, y bien declarado.** La guardia cubre el fallo **histórico y real** (el commit que **borró** el montaje) y ahí sí cae; el cable suelto lo cubren los **8 casos de componente** de `NovedadesHilo.test.tsx`, que caen ruidosamente. Las dos redes no se solapan y ninguna sobra. **No merece aserción extra:** una que detectara esa forma concreta sería un censo de sintaxis arbitraria (mañana sería otro operador, o un flag); lo que de verdad protege R27 y R28 es el test de componente, y está. → **menor, informativo**.
- **M4 corrió encima de M3.** **La rehíce en aislado (RV2) y su conclusión SE SOSTIENE**: con el subtítulo de ayer repuesto sobre árbol limpio cae exactamente un caso, `NovedadesPage.test.tsx › R14`, con el mismo mensaje. El sha de partida limpio es `db08194f…` y no el `6cac6485…` que la tabla cita — precisamente lo que su nota de honestidad declaraba. **La nota era correcta y el resultado es válido.** → **no es un hallazgo**.

### 5 · D8 · **LOS DOS CAMINOS CUBIERTOS**

- Contrato: el `ok` gana `rescatada: boolean` **obligatorio y sin default**, así que un olvido de propagación rompe el typecheck en vez de dejar a la pantalla afirmando el caso feliz por omisión.
- Servidor: `HabilitarNovedadService.ts:99` devuelve `{ ...publicada, rescatada: rescate.status === "ok" }`. El `forbidden` opaco del rescate **no** se traduce a motivo y **no** convierte la publicación en fallo. Correcto.
- Tests de servicio: el caso `sobre una devolucion ANCLADA (devuelta): publica la nota y NO mueve el estatus` (camino `false`), el `235/R8: publica la nota … y RESCATA` (camino `true`) y el `236/D8: rescatada distingue los dos desenlaces, y no es una constante`.
- Tests de pantalla: `R24: rescatada -> avisa que volvió a la ruta, la fila sale y el total baja` y `R25: si el rescate NO se aplicó, la pantalla no afirma que la devolvió y la fila se queda`. El segundo afirma las dos mitades del aviso, que el toast de éxito y el de error **no** se llamaron, y que **la fila sigue** (recuento del destinatario más ausencia del estado vacío). Emparejado en las dos direcciones.
- **La pestaña de devoluciones**, donde el rescate es no-op: cubierta **por composición**, no por un caso end-to-end propio. `NovedadesModule.habilitar` **no bifurca por grupo**, así que un `rescatada:false` deja la fila esté en la pestaña que esté; y el servicio tiene su caso sobre una `devuelta`. Lo declarado en `impl_236_frontend.md` §4 es exacto, y el cambio es **más veraz** que la conducta de ayer, en la que la fila desaparecía por optimismo y reaparecía al recargar. → **menor, sin acción**.

### 6 · El estado vacío · **NO PASA POR VACUIDAD**

Cada ausencia va emparejada con su presencia, leído caso por caso:

- `R16: la pestaña de ayuda vacía HABLA` (`NovedadesTabs.test.tsx:141`) afirma los **dos textos literales**, que **no** hay lista de ayuda montada y que **no** hereda el vacío del vecino — y acto seguido, tras `cleanup()`, **monta el mismo panel CON una orden** y afirma que la lista **sí** aparece y que el texto del vacío **se va**. Sin ese control positivo las tres negativas pasarían con el panel sin montar. Está.
- `T4.2: cada panel tiene SUS nombres accesibles, no los del otro` hace el **espejo exacto** en la pestaña de devolución: cuatro ausencias en un lado, cuatro presencias en el otro.
- El mismo criterio está aplicado en R21, R22/R23, R26, R29, R30 y R38, y los casos que verifiqué lo cumplen.

### 7 · Trazabilidad · **54/54 casos citados existen; 1 archivo citado NO existe**

Ver los bloqueantes.

---

## Verificación ejecutada por el reviewer

```
$ pnpm exec tsc --noEmit                                  -> exit 0
$ eslint <48 archivos de la rama>                         -> 0 errores, 1 aviso PREEXISTENTE

$ vitest run <las 15 suites de la feature>
   Test Files  15 passed (15)
        Tests  242 passed (242)                            13,75 s

$ vitest run tests/integration/db/novedades-predicado-sql-real.test.ts
   Test Files  1 passed (1)  ·  Tests  4 passed (4)        contra localhost:5432 — NO saltado

$ vitest run <7 suites de R41-R46, ninguna tocada por la rama>
   dinero-sin-centimos · ordenes-columnas-money-safe · orden-nota-frontera ·
   superficie-de-uso · anclaje-vs-intentos · deriva-primer-intento · RepartoAyuda
   Test Files  7 passed (7)  ·  Tests  110 passed (110)

$ vitest run tests/unit/services/orden-nota-service.test.ts    (el test REAL de R45)
   Test Files  1 passed (1)  ·  Tests  23 passed (23)
```

**Rutas que la rama NO toca**, verificado con `git diff --name-only 7c65be9c HEAD`: catálogo de estados, migraciones, portal del mensajero, `DevolucionSlaService`, `lib/types/ventana-hilo-notas.ts` y los contadores de intentos. **Ninguna.** Es la mitad sustantiva de R41-R46.

**R47:** censo de `console.` sobre los 11 archivos de `app/` y `lib/` tocados → **cero ocurrencias**.

---

## Mutaciones corridas POR EL REVIEWER

Una a una, **revertida antes de la siguiente**, con `sha256[:16]` comprobado a la vuelta.

| # | Mutación | sha256[:16] antes → mutado → después | Resultado medido |
| --- | --- | --- | --- |
| **RV1** | Quitar `ayuda_tienda` de `VENTANA_ESCRITURA.adminTienda` (`lib/types/ventana-hilo-notas.ts`) | `5fe37ae1…` → `088de275…` → `5fe37ae1…` | **3 failed / 15 passed.** Caen `236/R36: los estatus que la TIENDA alcanza son EXACTAMENTE su ventana`, `235/R34: ayuda_tienda es el ÚNICO estado…` y `236/R36: los DOS roles… tienen su hilo MONTADO`. **`cada rol tiene al menos un estatus alcanzable…` queda VERDE** → la propiedad **subió**, no se relajó. |
| **RV2** | El subtítulo vuelve al de ayer (`novedad-grupo-textos.ts`) — **M4 rehecha en aislado** | `db08194f…` → `a849c798…` → `db08194f…` | **1 failed / 74 passed.** `NovedadesPage.test.tsx › R14: el subtítulo nombra LAS TRES superficies y ya no dice el de ayer — Unable to find an element with the text: Las órdenes en las que tus mensajeros piden ayuda…` **La conclusión de M4 se sostiene sobre árbol limpio.** |
| **RV3** | Devolver el `OR` de ayer a `novedadWhere`, ignorando `grupo` (`OrdenRepository.ts`) | `8712d9b2…` → `7bf64850…` → `8712d9b2…` | **13 failed.** El evaluador **REVIENTA**: `Error: el predicado de novedades tiene claves inesperadas [OR, deletedAt, tiendaId]: el evaluador solo entiende { tiendaId, deletedAt, estatus: { value } }` (×3), más los censos de forma y `236/R5: novedadWhere TOMA su estatus del mapa`. **No pasa en silencio.** |

`git status --short` tras cada revert: sólo este acta. **El árbol queda limpio y quieto para el gate del leader.**

---

## Hallazgos

### `BLOQUEANTE-1` — el mapa de R45 cita un test que NUNCA ha existido

`specs/236-ayuda-tienda-novedades/tasks.md:374`

```
| R45 | `tests/unit/types/ventana-hilo-notas.test.ts` **verde sin tocar** (T7.1) |
```

Ese archivo **no existe**, y `git log --oneline --all -- tests/unit/types/ventana-hilo-notas.test.ts` sale **vacío**: no existe hoy, no está en `origin/dev` y no ha existido nunca en ninguna rama. Es el fallo recurrente de esta pila, por cuarta ficha seguida.

**Qué NO es:** no es un requisito sin cobertura. R45 —«no cambiar la ventana de escritura de ningún rol»— **sí** está cubierto, por dos sitios que verifiqué:

- `tests/unit/services/orden-nota-service.test.ts:380` — `expect(VENTANA_ESCRITURA).toEqual({ adminTienda: [...], mensajero: [...] })`: un literal **cerrado** sobre las dos listas. **Es el contrato**, no un espejo. Corrido por mí: 23 passed. **No tocado por la rama.**
- `lib/types/ventana-hilo-notas.ts` no aparece en el diff de la rama.

**Qué falta para cumplirlo:** que esa fila cite `tests/unit/services/orden-nota-service.test.ts` (más el refuerzo de `hilo-ventana-alcanzable`). **Una línea de Markdown. Cero código.**

### `BLOQUEANTE-2` — una corrida de verificación de la bitácora no se reproduce

`progress/impl_236_frontend.md:289-295` declara como salida real:

```
$ pnpm exec vitest run tests/components/RepartoAyuda.test.tsx \
    tests/unit/types/ventana-hilo-notas.test.ts \
    tests/unit/services/rescate-ayuda-service.test.ts
 Test Files  3 passed (3)
      Tests  54 passed (54)
```

Ese mismo comando, corrido por mí en este mismo árbol:

```
 Test Files  2 passed (2)
      Tests  33 passed (33)
```

Sólo dos de los tres filtros casan un archivo, porque el segundo no existe (BLOQUEANTE-1). **Los números publicados —3 archivos, 54 tests— no pueden haber salido de ese comando.** Este repo ya tiene escrito lo que cuesta un arnés que reporta sin ejecutar; una línea así contamina la credibilidad de toda la bitácora. Por eso volví a medir a mano lo grueso de las dos (guardias, suites y tres mutaciones), y **todo lo demás sí se reproduce**.

**Qué falta:** re-correr el comando con rutas que existan y pegar la salida real, o retirar la línea.

### `BLOQUEANTE-3` — R41-R46 no están en el mapa `R<n> → test` de ninguna bitácora

`CHECKPOINTS.md` › Trazabilidad exige que `progress/impl_<feature>.md` contenga el mapa. El de `impl_236.md` cubre R2, R3, R4, R5, R6, R7, R9, R10, R11, R17, R26, R29, R36, R37, R38, R39, R40 y R47; el de `impl_236_frontend.md` cubre R1, R2, R6, R8, R12 a R16, R18 a R39 y R47. **R41, R42, R43, R44, R45 y R46 no aparecen en ninguno de los dos.**

Agrava: `tasks.md` T7.1 está marcada hecha con «**Hecho:** la lista de suites y su resultado en `progress/impl_236.md`». **Esa lista no está en `impl_236.md`**, ni por nombre ni por resultado. Una tanda marcada hecha cuyo entregable declarado no existe.

**Qué NO es:** R41-R46 **se cumplen en sustancia**, y lo medí yo: ninguna de las rutas que esos requisitos protegen aparece en el diff de la rama, y las 7 suites que las vigilan están **verdes sin modificarse** (110 tests). El riesgo real hoy es cero; lo que falta es que quede escrito dónde se comprueba, para el día que alguien lea el mapa en vez de re-medir.

**Qué falta:** seis filas en el mapa de `impl_236.md`, con su suite y su resultado. **Cero código.**

### `menor` — la guardia de T6.6 no detecta un cable desactivado
Declarado y bien argumentado por el implementer. Cubierto por los 8 casos de componente de `NovedadesHilo.test.tsx`. No merece aserción extra (§4).

### `menor` — «Habilitar» en la pestaña de devoluciones ya no quita la fila
Efecto colateral de D8, declarado en `impl_236_frontend.md` §4. **Es más veraz que la conducta de ayer.** Cubierto por composición, no por un caso end-to-end en esa pestaña. La ficha **240** retira ese botón de esas cards. Sin acción.

### `menor` — T0.1 y T8.3 siguen sin marcar
Correcto por diseño: T0.1 bloquea el **despliegue**, no el merge; T8.3 es del leader. **Condición para pasar a `done`, no defecto de la implementación.**

---

## Lo que queda fuera de esta revisión, y con qué remite

- **`./init.sh` completo** — lo corre el leader, con el árbol quieto. Yo corrí typecheck, lint y 24 suites; **nada de lo que toqué quedó rojo ni mutado**.
- **T0.1, la re-medición contra producción** — antes de desplegar, no antes de mergear. Si ese día ya hay órdenes en `ayuda_tienda`, la ficha pasa de prospectiva a correctiva.
- **El SHA contra `origin/dev` justo antes del PR** — `dev` se mueve; el pre-vuelo caduca.
- **El punto 12** («Habilitar» en las cards que vienen de un cierre) — trasladado a **una celda** de `ACCIONES_POR_GRUPO`, con su dueño escrito. Remite: **ficha 240**.
- **«Rechazar», que sigue siendo maqueta con aviso por toast** — remite: **ficha 240**.
- **Reprogramar y rechazar desde ayuda** — remite: **ficha 237**.
- **La 237 y la 240 comparten `ACCIONES_POR_GRUPO`, `NovedadesModule` y ahora también `HabilitarNovedadResult`.** No se trabajan en paralelo con esta ni entre sí.

---
---

# ADENDA — re-verificación de los tres arreglos (2026-08-19)

> El acta de arriba **no se toca**: es el registro del rechazo y de lo que se midió para llegar a él.
> Esta adenda sólo comprueba los tres arreglos y fija el veredicto vigente.

## VEREDICTO VIGENTE: **OK**

**Cero bloqueantes.** Los tres se cerraron **sin tocar una línea de código** y los tres **dicen la
verdad**, comprobado contra el árbol y contra el runner, no contra la bitácora.

---

## Lo comprobado

### `git diff` de esta tanda: **sólo Markdown** ✅

```
 progress/impl_236_frontend.md             | 42 ++++++++++++++++++++++++++++---
 specs/236-ayuda-tienda-novedades/tasks.md |  7 +++++-
 2 files changed, 45 insertions(+), 4 deletions(-)
```

Ni un `.ts`, ni un `.tsx`. Todo lo que revisé y di por bueno sigue siendo bit a bit lo mismo.

### `BLOQUEANTE-1` · CERRADO ✅

La fila de R45 en `tasks.md:379` ahora cita **`tests/unit/services/orden-nota-service.test.ts:380`**.
Verificado en las tres dimensiones que importan:

- **existe** — el archivo está en el árbol;
- **la línea es lo que la fila dice** — `sed -n '380p'` da literalmente
  `expect(VENTANA_ESCRITURA).toEqual({ adminTienda: ["devuelta", "ayuda_tienda"], mensajero: ["en_reparto", "ayuda_tienda"] })`.
  Es un `toEqual` **cerrado sobre las dos listas**, no un espejo de su propia fuente: **es el contrato**;
- **se ejecuta y pasa** — dentro de la corrida de 15 archivos de abajo. Y **no está tocado por la rama**.

Y la fila **deja escrito** que antes citaba un archivo que **nunca existió en ninguna rama**, en vez
de disfrazarlo de cambio de ruta. Eso es lo correcto: el que lo lea dentro de seis meses sabrá que
hubo un fantasma, no un renombrado.

### `BLOQUEANTE-2` · CERRADO ✅

El bloque de `impl_236_frontend.md` publica ahora `2 passed (2) / 33 tests`. **Re-ejecuté el comando
corregido, tal cual está escrito**, y da exactamente eso:

```
$ pnpm exec vitest run tests/components/RepartoAyuda.test.tsx \
    tests/unit/services/rescate-ayuda-service.test.ts
 Test Files  2 passed (2)
      Tests  33 passed (33)
```

**Una salida publicada que se reproduce.** Y la nota explica la causa exacta —`vitest` ignora en
silencio un filtro que no casa ningún archivo, no falla— que es precisamente por qué el fallo pudo
sobrevivir hasta la revisión. Que lo diga sin suavizarlo («indistinguible de una inventada») es lo
que hace útil la nota.

### `BLOQUEANTE-3` · CERRADO ✅

R41-R46 tienen su sección propia en `impl_236_frontend.md`, con las **dos mitades**. Y T7.1 en
`tasks.md` ya no promete una lista que no estaba: la lista está, con las siete suites nombradas.

**Comprobé que ninguna cita es otro fantasma** — barrí **todos** los nombres de suite que aparecen en
las filas de R41-R46 de **los dos** documentos, incluidos los que ya estaban en `tasks.md` y que el
arreglo no tocó:

| Nombre citado | Resuelve a |
| --- | --- |
| `dinero-sin-centimos` | `tests/unit/guards/dinero-sin-centimos.guardia.test.ts` |
| `ordenes-columnas-money-safe` | `tests/unit/guards/ordenes-columnas-money-safe.guardia.test.ts` |
| `orden-nota-frontera` | `tests/unit/guards/orden-nota-frontera.guardia.test.ts` |
| `superficie-de-uso` | `tests/unit/guards/superficie-de-uso.guardia.test.ts` |
| `anclaje-vs-intentos` | `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` |
| `deriva-primer-intento` | `tests/unit/guards/deriva-primer-intento.guardia.test.ts` |
| `RepartoAyuda.test.tsx` | `tests/components/RepartoAyuda.test.tsx` |
| `order-status-transiciones` (R42, en `tasks.md`) | `tests/unit/domain/order-status-transiciones.guardia.test.ts` **+** `.connectividad.test.ts` |
| «las dos guardias de criterio de intento» (R46) | `tests/unit/services/intentos-entrega-criterio-unico.test.ts` **+** `tests/unit/types/criterio-intento-entrega.test.ts` |
| «suites de `DevolucionSlaService`» (R43) | `devolucion-sla-service` · `devolucion-sla-dinero` · `devolucion-sla-repository` |
| `orden-nota-service.test.ts:380` (R45) | existe, y la línea es la que dice |

**Todas corridas, de una vez, por mí:**

```
 Test Files  15 passed (15)
      Tests  381 passed (381)      6,20 s
```

Y **ninguna tocada por la rama**: `git diff --name-only 7c65be9c HEAD` sobre esas rutas sale vacío.
Las dos mitades de R41-R46 —el diff que no las toca y las suites verdes sin modificarse— quedan
medidas por segunda vez, ahora por el reviewer.

---

## Observación menor, sin acción

La fila de **R42** en la tabla nueva de `impl_236_frontend.md` se apoya sólo en el argumento del diff
(«no toca el catálogo de estados ni ninguna migración») y no nombra suite. **No es un hueco:** la fila
de R42 en `tasks.md` sí nombra `order-status-transiciones`, que existe, se ejecuta y está verde sin
modificarse (lo verifiqué arriba). R42 tiene su test concreto; simplemente vive en el otro documento.
Si algún día se unifican los dos mapas, ahí es donde hay que juntarlos.

---

## Estado final

- **Bloqueantes: 0.** Se levanta el rechazo.
- **Menores, todos sin acción:** la ceguera de la guardia de T6.6 al cable desactivado (cubierta por
  los 8 casos de componente), «Habilitar» que ya no quita la fila en la pestaña de devoluciones
  (más veraz que ayer; la retira la **240**), y la fila de R42 de arriba.
- **Sigue pendiente del leader, como estaba:** `./init.sh` completo con el árbol quieto, **T0.1** (re-medir
  producción **antes de desplegar**, no antes de mergear), **T8.3** (`feature_list.json`, la **228**
  declarada superada, entrada en `progress/history.md`) y el SHA contra `origin/dev` justo antes del PR.
- **Árbol:** limpio. Las tres mutaciones del reviewer siguen revertidas con `sha256` comprobado; lo
  único modificado son los dos Markdown del arreglo y este acta.
