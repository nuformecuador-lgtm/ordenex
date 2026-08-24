# Review — feature 262 · corregir el día de reparto de una orden ya asignada

> Revisión **completa** (la ficha nunca se había revisado) sobre `dev` en **`c63c7235`**.
> Cubre las **cuatro** tandas: PR #463 (backend), #465 (modales), #472 (backend del historial),
> #474 (UI del historial).
>
> Fuentes leídas: `specs/262-corregir-dia-reparto/{requirements,design,tasks}.md`,
> `progress/impl_262_{backend,frontend,historial,historial_ui}.md`, `CHECKPOINTS.md`,
> `docs/{architecture,conventions,verification}.md`, y el código de las cuatro tandas.
>
> **Todo lo que dice este documento se midió aquí, no se heredó de las bitácoras.** El gate se
> volvió a correr, los tests de integración se corrieron aparte para comprobar que no se saltan, y
> las mutaciones que se citan se ejecutaron de nuevo, una a una, sobre el árbol limpio.

---

## Veredicto

# ⛔ RECHAZADO

**4 bloqueantes · 6 menores.** Ninguno es de diseño ni de calidad del código escrito: la
implementación es sólida y las cinco cosas que la ficha declara son ciertas. Lo que falla es que
**un requisito (R32) no tiene ningún test que muerda —medido, no supuesto—** y que **el cierre de la
ficha no está hecho**: F6 no se ha ejecutado, `tasks.md` está casi entero sin marcar y no hay
entrada en `progress/history.md`.

---

## 1 · Verificación ejecutable (hecha por el reviewer, no leída)

### `./init.sh` COMPLETO — **VERDE**

Corrido en esta sesión con `INIT_EXIT=$?` **escrito dentro del log** (en este repo un `echo`
posterior ya tapó un gate rojo):

```
✓ typecheck paso
✓ lint paso              (99 warnings preexistentes, 0 errores)
 Test Files  1324 passed (1324)
      Tests  17878 passed | 26 skipped (17904)
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

El aviso de «migraciones sin down.sql» es **preexistente** (tres carpetas de la feature 92) y no lo
introduce esta ficha: las **dos** migraciones nuevas traen su `down.sql`.

### Los tests de integración corren de verdad, no se saltan

Los 26 `skipped` del gate podrían esconder toda la mitad de Postgres. Se comprobó aparte:

```
$ pnpm exec vitest run tests/integration/db/correccion-dia-reparto.int.test.ts \
    tests/integration/db/correccion-dia-reparto-efectos.int.test.ts \
    tests/integration/db/correccion-dia-reparto-historial.int.test.ts \
    tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts
 Test Files  4 passed (4)
      Tests  57 passed (57)          <-- cero skipped
```

Y ninguno de los cuatro abre con un `if (!algo) return;`: los tres de la 262 **revientan con
mensaje** si falta el catálogo, la zona ajena, el actor o el SQL capturado
(`throw new Error(...)`, verificado en los `beforeAll` y en el bloque del `EXPLAIN`).

### Mutaciones re-ejecutadas por el reviewer (árbol limpio antes y después de cada una)

| Mutación inyectada | Resultado medido | Qué demuestra |
| --- | --- | --- |
| **M-w** — una SEGUNDA escritura del día sin `asignado_at` en `OrdenRepository.ts` | **MUERE**: `fecha-reparto-acompana-asignado-at.guardia` (d3) → «expected 2 to be 1» | La guardia nueva **sí se pone roja** con el defecto que dice vigilar (**R29**) |
| **M-ab** — `cambioId: c.cambioId` → `c.ordenId` en el servicio | **MUERE** (2 rojos), incluido «R50: DOS correcciones del lote => DOS avisos» | El aviso de la segunda corrección no se pierde en silencio |
| **M-ab2** — `entidadId` fijo en el emisor | **MUERE** (2 rojos), incluido el de los dos sentidos (**R55**) | El doble **aplica la dedupe de verdad** (ver §4) |
| **M-f6** — retirar `@pendiente-262-f6` | **MUERE**: `historial-correccion-dia.guardia` (f) | La deuda de F6 no se puede borrar por descuido |
| **M-r** — «la única salida **FUE** un `UPDATE` a mano» → «no hizo falta tocar produccion» | **MUERE**: `d5-revertida` (e) nombra la pieza que falta | **R34/R35**: el cierre de la 261 exige el hecho en pasado |
| **M-ac** — pintar la corrección con `estatusLabel` | **MUERE** (2 archivos, 6 rojos) | **R39** |
| **⚠️ Sonda de R32** — la corrección **borra las paradas de la ruta optimizada** dentro de su propia transacción | **SOBREVIVE**: `vitest related lib/repositories/OrdenRepository.ts` → **245 archivos, 3302 tests, 0 rojos** | **R32 no tiene ningún test que muerda** (bloqueante 1) |

---

## 2 · Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `requirements.md` con requisitos EARS numerados `R1`…`R56`.
- [x] `design.md` con alternativas descartadas y su porqué (§11 + las del alcance añadido, A16-A24).
- [ ] **`tasks.md` con todas las tasks marcadas `[x]` → NO.** 1 de 46 marcada (`B0.1`). → **BLOQUEANTE 3**.

### Trazabilidad
- [ ] **Cada `R<n>` mapea a al menos un test concreto → NO.** `R32` no. → **BLOQUEANTE 1**.
- [x] Las bitácoras contienen el mapa `R<n> → test`, repartido entre las cuatro tandas.

### Calidad de código
- [x] `pnpm run typecheck` sin errores.
- [x] `pnpm run lint` sin errores (99 warnings preexistentes).
- [x] `pnpm test` verde (17.878 pasan).
- [n/a] E2E Playwright: **este repo no tiene harness de e2e** — los tres `e2e/*.spec.ts` que la tanda
  de UI editó **no se ejecutan**, y su bitácora lo dice. El checkpoint se declara **inaplicable**; el
  riesgo que cubriría lo cubre `F6`, que **no se ha hecho** (**BLOQUEANTE 2**).

### Datos y seguridad (Supabase)
- [x] **RLS activa** en `orden_dia_reparto_cambio`, comprobada **leyendo `pg_class.relrowsecurity` de
  la base** y no el `.sql` que la escribe (tres tests: RLS activa, sin policies, misma postura que
  `orden_historial_estado`).
- [x] Las **dos** migraciones traen `down.sql`. El del rastro dice en voz alta que es destructivo; el
  de los enums recrea los **dos** tipos con los **CINCO** valores previos y **no lleva ni un
  `DELETE`/`UPDATE`** para «hacer sitio» (**R54**, con test).
- [x] **Los `down.sql` de la 146 y la 253 NO se tocaron** — verificado con `git diff` sobre todo el
  rango. Y hay test que afirma que el de la 146 **sólo dropea** y que el de la 253 sigue listando
  **cuatro**.
- [~] `pnpm run db:rollback` existe y los dos `down.sql` se ejercitaron, pero el script sólo revierte
  la carpeta de nombre más alto → **menor (d)**.
- [x] Ningún secreto hardcodeado.
- [n/a] Webhooks: la ficha no añade ninguno — y el `migration.sql` del rastro deja escrito que no se
  usó `orden_historial_estado` precisamente porque ese choke point emite el webhook de estado.

### Patrón de capas
- [x] Server Action sin queries ni negocio.
- [x] Servicio sin HTTP (se instancia con dobles en 45 tests).
- [x] Repositorio sólo consultas; el choke point del rastro sólo inserta.
- [x] Interfaces en `lib/interfaces/{repositories,services}/`.
- [x] **Verificado el «único sitio que inserta»** (criterio de `B4` que ninguna bitácora pegó):
  `grep` sobre `lib/`, `app/`, `scripts/`, `tests/` → **una sola** escritura sobre
  `ordenDiaRepartoCambio`.

### Permisos
- [x] Autorización server-side; zona del `adminSatelite` resuelta en el servidor y repetida en el
  `WHERE` (anti-TOCTOU).
- [x] Los modales reciben datos por props (`fechasDiaReparto` baja de la página).
- [x] Mutación por Server Action, no por API route.

### Multi-país / configuración
- [x] Ni país, ni moneda, ni cuenta hardcodeados. El día sale de `lib/utils/fecha-cr.ts`, que ya era
  la única definición.

### Verificación final
- [x] `./init.sh` verde (re-corrido aquí).
- [ ] `progress/review_262.md` con veredicto OK → **este documento, y el veredicto es RECHAZADO**.
- [ ] **Entrada en `progress/history.md` → NO EXISTE.** → **BLOQUEANTE 4**.

---

## 3 · Mapa `R<n> → test`, verificado uno a uno

`✔` = el test existe, corre y **muerde** (comprobado leyendo la aserción, y en los casos marcados
⭑ además por mutación ejecutada en esta revisión).

| R | Test que lo defiende | |
| --- | --- | --- |
| R1 | `correccion-dia-reparto.int` · «la fila queda con el día nuevo y todo lo demás IDÉNTICO» (compara la fila entera) | ✔ |
| R2 | `.test` dos `now` → dos fechas · `corregir-dia-reparto-action.test` sin `dia` falla | ✔ |
| R3 | `.test` «el pasado NO es expresable» (afirma el **conjunto** de salidas) · el borde sin `.default` | ✔ |
| R4 | `.test` «sin día de reparto» · `.int` «una orden SIN día no se corrige» | ✔ |
| R5 | `.test` los dos motivos **distintos** · `.int` sin mensajero / sin día | ✔ |
| R6 | `.test` 3 admitidos + 5 rechazados **nombrando el estado** · `carga-del-mensajero.guardia` (censo de 8 miembros, 3 preguntas) | ✔ |
| R7 | `.test` «ya está en el día elegido» + comparación por fecha calendario · `.int` el `<>` del `WHERE` + el `CHECK` de la base | ✔ |
| R8 | `.test` CERO llamadas al writer · `.int` caso 4: ni una corregida, cero filas de rastro | ✔ |
| R9 | `.int` las cinco guardas del `WHERE`, una a una, contra Postgres real | ✔ |
| R10 | `CambiarDiaRepartoModal.test` · **literal a mano** («El lote quedó para el reparto de mañana, 23 de agosto.»), no contra `confirmacionDiaReparto` | ✔ |
| R11 | `.test` maestro/admin/adminSatelite sí; mensajero/adminTienda `forbidden` sin leer nada | ✔ |
| R12 | `.test` `sin_zona` + zona ajena `forbidden` · `.int` caso 5 **con control positivo** (`zonaId=null` sí la alcanza) | ✔ |
| R13 | `CambiarDiaRepartoListados.test` · 3 estados en `/ordenes` + 4 casos satélite; las **puertas** de las dos páginas no aparecen en el diff | ✔ |
| R14 | `.test` el `Pick` no expone el predicado (`@ts-expect-error`) + comportamiento con un repo que ni lo tiene | ✔ |
| R15 | `.test` `forbidden` antes de leer nada | ✔ |
| R16 | `CambiarDiaRepartoModal.test` · cada orden con su remisión y su día **en palabras**, dos con días distintos + la que no tiene | ✔ |
| R17 | censo del fuente de los **dos** modales + «los días que muestra son los que RECIBE» (fecha de 2027) · `dia-reparto-textos.test` (2) sobre el módulo entero | ✔ |
| R18 | censo del fuente con **anti-vacuidad**; es lo único que mata M-x en su forma fuerte | ✔ |
| R19 | 6 casos, motivo real por orden, **con contraprueba** (la carrera sí invita a reintentar) | ✔ |
| R20 | `.int` «UNA fila de rastro por orden, con las dos fechas, el actor y el motivo» | ✔ |
| R21 | borde: trim + min(10) + max(300) · `.test` el motivo llega intacto al writer | ✔ |
| R22 | `.int` casos 3 y 4 (cero filas al abortar) | ✔ |
| R23 | `.int` «append-only también en la base» (`information_schema`) · el modelo sin `updated_at`/`deleted_at` | ✔ |
| R24 | `.int` «`fecha_anterior` es el día REAL de CADA fila» + aserción de **forma** del `FOR UPDATE` sobre el SQL emitido | ✔ |
| R25 | `…-efectos.int` · cero filas de historial, cero gestiones, intentos intactos | ✔ |
| R26 | `…-efectos.int` · `pg_class.relrowsecurity` **leído de la base** | ✔ |
| R27 | `.int` `asignado_at` idéntico · guardia (d2)/(d3) | ⭑✔ |
| R28 | `.int` el `WHERE` exige día y mensajero · guardia (d2) | ✔ |
| R29 | guardia (d1)-(d4) con **autocomprobación sobre el SQL FINAL** (el del `RETURNING` ancho, no el borrador de §6.1) | ⭑✔ M-w muere sólo en (d3) |
| R30 | `…-efectos.int` · el predicado del corte, en los **dos** sentidos | ✔ |
| R31 | `…-efectos.int` · la guarda de la 261 con el valor **que la base devolvió**, y `rastro=1 / historial=0 / gestiones=0` | ✔ |
| **R32** | **`B15` (correr suites ajenas) + `F6` (no hecha)** | ⛔ **NO** — bloqueante 1 |
| R33 | guardia (d1) cota ≥7 + (d3) excepción **exactamente una** | ⭑✔ |
| R34 | `d5-revertida` (e) con las **ocho** piezas del cierre | ⭑✔ |
| R35 | la mitad (e) **sigue viva**, no relajada a `toBe(true)`, con el caso «el detector NO se conforma con la nota VIEJA» | ✔ |
| R36 | `git diff --numstat` sobre `specs/261-…`: **19+0 y 20+0**, cero borrados (re-verificado) | ✔ |
| R37 | `orden-historial-fusion` (`toEqual` de la lista entera + no-vacuidad) · `…-historial.int` (M-ak con control positivo) | ✔ |
| R38 | `dia-reparto-textos.test` (5) **literales a mano** · `HistorialOrdenTimeline.test` con `not.toMatch(/\d{4}-\d{2}-\d{2}/)` · `.int` con `SET LOCAL TIME ZONE` **y la aserción de que tomó efecto** | ✔ |
| R39 | `HistorialOrdenTimeline.test` recorriendo **todas** las etiquetas del catálogo **con contraprueba** · guardia (b) con anti-vacuidad · `orden-historial-union` | ⭑✔ |
| R40 | `orden-historial-fusion` 6 casos (empate exacto, invertir listas) · `.int` **tres filas del mismo instante** desempatadas por `id` | ✔ |
| R41 | `orden-historial-fusion` (los repos devuelven al revés) · guardia (d): el componente no tiene `.sort(`, `.reverse(` ni `new Date(` | ✔ |
| R42 | `orden-historial-union.test` · **cinco `@ts-expect-error`** + el `never` del `default` + `RANGO_POR_CLASE` exhaustivo. Se verifica **compilando**: el `typecheck` del gate es su corrida | ✔ |
| R43 | `rastreo-frontera.guardia` **intacta** (`git diff` vacío en el rango) + **control positivo** en `.int` con doble no-vacuidad | ✔ |
| R44 | `orden-historial-fusion` · **5 con visibilidad** ven la corrección con su motivo, **4 sin ella** → «el rastro **NI SE LEE**» (`not.toHaveBeenCalled`), no «respeta permisos» | ✔ |
| R45 | `orden-historial-fusion` (b) con el resultado **campo a campo a mano** · `orden-historial-service.test` sin una aserción cambiada · el literal-contrato del repo que **CRECE** | ✔ |
| R46 | `notificacion-dia-reparto-corregido.test` · una fila al mensajero asignado · el servicio emite tras confirmar | ✔ |
| R47 | la fecha en palabras **con contraprueba** de que el texto no es fijo | ✔ |
| R48 | sin PII **y** el contexto «no tiene hueco» donde meter el motivo (4 claves exactas) | ✔ |
| R49 | el notificador que lanza sigue devolviendo `ok` · el fallo queda **loggeado con causa** | ✔ |
| R50 | dos correcciones → dos avisos, **con contraprueba** de que con el `ordenId` el segundo se pierde | ⭑✔ |
| R51 | ni una fila dirigida a un **rol** | ✔ |
| R52 | `notificacion-productores-wiring.test` (lista **literal**, seis, con su razón escrita) · el test de la migración | ✔ |
| R53 | el down con los **CINCO** previos de cada enum + los dos downs anteriores afirmados intactos | ✔ |
| R54 | «el down NO borra ni reescribe NINGUNA fila» | ✔ |
| R55 | los dos sentidos · `…-efectos.int` (R31 sigue probándose sin aviso) | ✔ |
| R56 | ausencia en el diff de `lib/types/dia-reparto.ts` y `lib/utils/dia-reparto.ts` (re-verificada sobre el rango completo) + el borde **sin** `.default` | ✔ |

**55 de 56 verificados. Falta R32.**

---

## 4 · Los cuatro puntos que el encargo mandó mirar con lupa

### (a) El aviso que se pierde en silencio la segunda vez — **CORRECTO**

`notificacion_dedupe_key` es UNIQUE con `NULLS NOT DISTINCT` y `NotificacionRepository.crear`
absorbe el `P2002` devolviendo `false` (`:116-118`, leído). La ficha usa como entidad **la fila del
rastro** (`entidadId: ctx.cambioId`), no la orden.

**Lo que había que comprobar y se comprobó:** el doble de
`tests/unit/services/notificacion-dia-reparto-corregido.test.ts` (`RepoFake`) **aplica la dedupe de
verdad** — su `existeNoLeidaPara` busca sobre las filas ya creadas por `(evento, entidadId,
destinatario)`, que es exactamente la terna del índice, y `emitirFilas` la consulta antes de crear.
**Y la contraprueba existe**: «con el MISMO `entidadId` el segundo SE PIERDE» → `segunda === 0`.
Las dos mutaciones (en el servicio y en el emisor) se re-ejecutaron aquí y **matan**.

### (b) Consumidores con `toEqual` literal INLINE — **uno, ya declarado; no hay más de esa clase**

Se recorrieron los **seis** archivos de `tests/` que nombran `estatusDestinoValue`. Los seis se
actualizaron **haciendo crecer** el literal; **ninguno** se relajó a `objectContaining` ni perdió una
aserción:

- `orden-historial-repository.test.ts` — el que el inventario de §14.5 no tenía (declarado en
  `impl_262_historial.md` §3.2). Literal crecido con `clase: "transicion"`.
- `orden-historial-service.test.ts` — el único cambio de aserción es un
  `filter(clase === "transicion")` antes de leer `origenTipo`; el `toEqual` de las dos filas enteras
  sigue en pie.
- `HistorialOrdenTimeline`, `HistorialOrdenSheet`, `EstatusBadgeRetiroFulfillment`,
  `orden-historial-action` — fixtures que ganan `clase`.

**Aparece un séptimo, de otra clase y menor:**
`tests/unit/services/notificacion-notificadores-reales.test.ts` enumera **a mano** los composition
roots y los services cuyo default es el no-op, y **no ganó el sexto notificador**. No se relajó ni se
puso rojo: se quedó incompleto. → **menor (b)**.

### (c) Los `down.sql` de enum — **CORRECTOS**

- El nuevo **recrea con la lista vigente**: cinco valores en `notificacion_evento` (incluido
  `postulacion_recurso_pendiente`) y cinco en `notificacion_entidad_tipo` (incluido
  `postulacion_recurso`).
- Los de la **146** y la **253** no aparecen en el `git diff` del rango. Verificado.
- El `down.sql` **no lleva `DELETE` ni `UPDATE`**; la precondición ruidosa está escrita y tiene test.
- El nombre de la carpeta no rompe el `carpetaQueTerminaEn` de la 253, y hay un test que lo afirma.
- El test de la migración además comprueba **contra Postgres real** que tras el `ALTER COLUMN` el
  `notificacion_dedupe_key` conserva su `NULLS NOT DISTINCT` y su `WHERE` parcial.

### (d) Guardias que no pueden fallar — **la nueva SÍ falla con su defecto**

Además de M-w (arriba), la guardia del día lleva **autocomprobación en las dos direcciones** sobre la
**forma FINAL del SQL** —con el `RETURNING` ancho, que es la que de verdad está en el árbol— y su
contraprueba (`"asignado_at" = NULL` añadido cambia la huella por **dos** vías a la vez). Y
`columnasAsignadas` se prueba contra textos de control: «lee lo que hay, no una respuesta fija».

---

## 5 · Lo que la ficha declara, contrastado contra el código

| Lo declarado | Veredicto |
| --- | --- |
| **1. `accionesPara` es una UNIÓN CON CONTEO, no una intersección** — desviación de `design.md` §4.2 resuelta por el leader | **CIERTO.** `OrdenesListado.tsx:731-756` acumula por `accion.key`, marca `parcial`, devuelve la etiqueta con su conteo y pasa a `onRun` **el subconjunto elegible**, no la selección entera. La satélite sí lleva `disabled` por estado mixto. El spec lleva la **nota fechada 2026-08-22** conservando el párrafo anterior. **R16 sigue vivo**, con test propio, y hay test de la selección mixta que afirma **lo que llega al modal** dentro del `role="dialog"`. |
| **2. El mecanismo de tres capas sustituye a la rotura deliberada de `B24`** | **CIERTO y honesto.** (i) unión + `never` → `tsc` rojo; (ii) `historial-correccion-dia.guardia`, 24 tests con autocomprobación en las dos direcciones; (iii) la anotación con su cláusula (f). Y la bitácora **dice explícitamente que NO es una forcing function** —«ninguna comprobación automática puede obligar a nadie a abrir la app»—, que es la frase correcta y no un adorno. |
| **3. `@pendiente-262-f6` NO se retiró** | **CIERTO.** Presente en `HistorialOrdenTimeline.tsx:30` con motivo ≥40 caracteres nombrando F6. **M-f6 re-ejecutada aquí: la guardia se pone roja.** |
| **4. Tres desviaciones del bloque historial** (tercer repo obligatorio en 19 sitios · `B29` en el test de Postgres real · `R44` con 5+4 roles) | **LAS TRES CIERTAS Y BIEN RAZONADAS.** El tercer repo obligatorio convierte un cableado olvidado en rojo de `typecheck` en vez de en un drawer que enseña menos de lo que hay. `B29` va en Postgres real porque el falso de `rastreo-publico.int` es un `Pick` que **no tiene** la tabla del rastro: la ausencia habría sido trivial. Y `autorizar` tiene, medido, **cinco** caminos con visibilidad y **cuatro** sin ella. |
| **5. `B14` cierra el riesgo de la 261 y `d5-revertida` exige las OCHO piezas** | **CIERTO.** `PIEZAS_DEL_CIERRE` tiene 8 entradas; la mitad (e) sigue viva, con su autocomprobación **y** con el caso «el detector NO se conforma con la nota VIEJA». `git diff --numstat` del spec de la 261: **sólo adiciones**. |

---

## 6 · Hallazgos

### ⛔ BLOQUEANTE 1 — `R32` no tiene ningún test que muerda (medido con una mutación)

**R32:** «La corrección NO DEBE alterar la **ruta optimizada** del mensajero ni los indicadores de su
portal.»

El mapa de `tasks.md` y el de `impl_262_backend.md` lo asignan a **`B15` + `F6`**. `B15` no es un
test: es «correr las suites de ruta y corte sin tocarlas», y **ni siquiera está evidenciada** —su
criterio de hecho pide «los cuatro puntos verificados y escritos, con la **lista de archivos
corridos**», y esa lista no aparece en ninguna de las cuatro bitácoras—. `F6` no se ha hecho.

**Lo que se midió aquí.** Se inyectó dentro de `corregirDiaRepartoLote`, en su misma transacción,
exactamente el defecto que R32 prohíbe:

```ts
await tx.rutaOptimizadaParada.deleteMany({
  where: { ordenId: { in: movidas.map((m) => m.id) } },
});
```

y se corrió `pnpm exec vitest related --run lib/repositories/OrdenRepository.ts`:

```
 Test Files  245 passed (245)
      Tests  3302 passed | 17 skipped (3319)
```

**Cero rojos.** La corrección puede empezar a borrar la ruta del mensajero y ninguna de las 3.302
pruebas se entera. Es un hermano exacto del defecto que apareció hoy en la 265: el escenario está
montado, pero nadie afirma la propiedad.

Y no es teoría: `tests/integration/db/correccion-dia-reparto-efectos.int.test.ts:298` lleva escrito
en su comentario **«ni gestión, ni historial, ni ruta»** y a continuación cuenta `rastro`,
`historial` y `gestiones` — **la ruta no**. El comentario promete la aserción que falta.

**Qué falta para cumplirlo:** una aserción que muerda. Lo barato y suficiente es sumar la ruta al
mismo conteo de ese archivo (que `ruta_optimizada` y `ruta_optimizada_parada` del mensajero no
cambien tras corregir) y, para la otra mitad —«los indicadores de su portal»—, que los contadores que
`MisAsignacionesService` deriva no se muevan. La sonda de arriba sirve como prueba de que la
aserción nueva muerde: con ella puesta, tiene que morir.

### ⛔ BLOQUEANTE 2 — `F6` («ver la app») no se ha ejecutado, y el spec la declara no opcional

Las **cuatro** bitácoras la dejan a deber, y la última acota bien por qué lo suyo **no la sustituye**:
lo de `impl_262_historial_ui.md` §6 fue una página de fixtures en `next dev`, no la app con datos
reales, ni preview, ni las tres cuentas.

Lo que queda sin verificar en la app es exactamente lo que la suite no puede ver, y esta ficha lo
tiene concentrado:

- el desbloqueo de una orden **`en_reparto`** tras corregirla a hoy (**R31**, el caso que motivó la ficha);
- que el `adminSatelite` corrige desde `/recepcion-satelite` y **no ve** una orden de otra zona (**R12/R13**);
- que la entrada de corrección sale **en su sitio cronológico** en «Ver historial», también con
  `adminTienda` sobre una orden suya (**R37**-**R39**, **R44**, límite 8);
- que el aviso llega a la campana **en ≤60 s**, dice la fecha, y **maestro/admin/tienda no reciben
  nada** (**R46**-**R48**, **R51**);
- que el rastreo público **no** muestra la corrección (**R43**);
- y la pregunta de copy que la propia tanda de UI dejó abierta: si «Día de reparto / Del 21 de agosto
  al 22 de agosto» se lee como un **cambio** o como un **rango de dos días**.

En este repo mirar la app encontró **siete** textos rotos que doce mil tests daban por buenos. Que la
deuda esté anotada junto al código y bajo guardia está bien hecho, pero **no es haberla hecho**.

**Qué falta:** la pasada de F6 tal y como la enumera `tasks.md`, con capturas o transcripción en
`progress/impl_262_frontend.md` **y el rastro leído en la base** después de la prueba.

### ⛔ BLOQUEANTE 3 — `tasks.md`: 45 de 46 sin marcar, y dentro hay trabajo real pendiente

`CHECKPOINTS.md` lo exige literalmente. Hoy sólo `B0.1` está marcada. **No es sólo contabilidad**:
repasando una a una, lo que de verdad falta es

- **`B15`** — hecha de facto (las suites están verdes) pero **sin su evidencia escrita**: falta la
  lista de archivos corridos, y es justo la task de la que cuelga **R32**.
- **`B0.2` / `C3`** — re-medir `M1` contra producción antes de desplegar. Es del leader y **caduca**:
  los números del 2026-08-22 04:27 CR ya no valen.
- **`C7`** — `P4` (¿la tienda lee el motivo?) y `P5` (¿el `adminSatelite` lee el rastro que escribe?)
  siguen **sin llevar a la puerta humana**, y el spec dice que se preguntan **antes** de desplegar,
  «no después de que una tienda lea el primer motivo».
- **`F6`** — bloqueante 2.
- **`C5`** — migrar la base local tras mergear; con **dos** migraciones y el orden entre ellas
  importando, conviene dejarlo dicho hecho.

El resto —B1-B14, B16-B29, F1-F5, F7-F8, C1, C2, C4, C6— **sí está hecho y ha quedado verificado en
esta revisión**: márquense.

### ⛔ BLOQUEANTE 4 — no hay entrada de la 262 en `progress/history.md`

`grep '262' progress/history.md` sólo devuelve una coincidencia, y es «262.8 KB» de otra ficha.
`CHECKPOINTS.md > Verificación final` lo pide. Es barato de arreglar y por eso no tiene excusa.

---

### menor (a) — un comentario del componente contradice al código tres líneas más abajo

`app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx:140` dice «el punto es un **ANILLO HUECO**
(`border-2` + `bg-background`)», y el `className` real usa **`bg-popover`** — precisamente porque
`bg-background` era el defecto que la tanda de UI encontró mirando el navegador (§6 de su bitácora,
commit `3532dc00`). El comentario de abajo lo explica bien; el de arriba se quedó con el valor viejo.
En este repo un comentario que miente miente **con autoridad**, y justo donde alguien va a ir a
buscar la regla.

### menor (b) — un censo ajeno de notificadores se quedó incompleto (no relajado)

`tests/unit/services/notificacion-notificadores-reales.test.ts` enumera a mano los composition roots
(«`lib/actions/X.ts` inyecta el notificador real») y la lista de services cuyo default es el no-op
(`PostulacionMensajeroService`, `CierreDiaService`, `BulkOrdenService`). La 262 añadió el **sexto**
notificador y **no entró en ninguna de las dos listas**. No se puso rojo porque las listas son
explícitas y no derivadas.

Impacto real bajo: la propiedad («el default es el no-op») **sí** está afirmada en la suite propia de
la ficha (`correccion-dia-reparto.test` · «el DEFAULT del notificador es el no-op»). Pero ese censo
existe para ser el sitio donde se mira **todo junto**, y hoy dice cinco donde hay seis.

### menor (c) — dos migraciones comparten el timestamp `20260822140000` (roce con la 265)

`db/migrations/20260822140000_notificacion_evento_dia_reparto_corregido` (262) y
`db/migrations/20260822140000_ruta_secuencia_fuente` (265). Prisma ordena por **nombre de carpeta**,
así que el orden sigue siendo determinista y **nada está roto hoy**: la de la 262 va antes por orden
alfabético y su dependencia real —que `…130000_orden_dia_reparto_cambio` exista primero— se cumple
igual. Pero el criterio que `B17` escribió («migración propia y separada, **con timestamp
posterior**») deja de ser legible en el listado, y el desempate pasa a depender de la primera letra
del nombre. Se dice porque es la clase de detalle que se descubre en rojo seis meses después. **Es lo
único de la 265 que roza a esta ficha**; por lo demás no se solapan.

### menor (d) — `pnpm run db:rollback` ya no alcanza a las migraciones de esta ficha

Descubierto y documentado por la propia tanda de backend (§7.6): el script revierte **la carpeta de
nombre más alto**, no la última fila aplicada. Con la migración de la 265 mergeada después, un
`db:rollback` hoy revierte **lo de la 265**, no lo de la 262. Los dos `down.sql` de esta ficha se
ejercitaron (y el de los enums tiene su test contra Postgres real), así que la reversibilidad está
demostrada — lo que no funciona es el **comando**. Deuda preexistente, no de esta ficha; se anota
porque `CHECKPOINTS.md` lo nombra.

### menor (e) — `B4` pedía pegar el `grep` del árbol y no se pegó

Su criterio de hecho era «**no existe ningún otro sitio** que inserte en esa tabla (`grep` del árbol
pegado en `progress/`)». No está en ninguna bitácora. **Se verificó en esta revisión** y es cierto:
una sola escritura sobre `ordenDiaRepartoCambio` en todo el árbol. Queda constancia aquí; no hace
falta repetirlo.

### menor (f) — el `status_note` de la 262 en `feature_list.json` es un muro

Unos 2.400 caracteres en una sola línea. La convención de este repo es 3-6 líneas técnicas, con el
detalle viviendo en `progress/`. No afecta al código; se dice para que al cerrar la ficha se recorte
en vez de crecer.

---

## 7 · Lo que NO es un hallazgo, dicho para que nadie lo vuelva a levantar

- **`M-h` y `M-n` sobreviven**, y están **declaradas como equivalentes** con su demostración por
  parejas (`M-h+M-j` y `M-f+M-n` sí matan). La guarda redundante `"fecha_reparto" IS NOT NULL` se
  conserva **con su porqué escrito en el código**. Eso es exactamente lo que hay que hacer con una
  mutación equivalente: decirla, no disimularla.
- **`M-p` no muere por el test de la zona horaria**, y la bitácora lo dice en vez de fingir lo
  contrario: el parámetro va sin tipo y Postgres lo infiere de la columna `date`. La forma con texto
  y `::date` se conserva y se sostiene con una **aserción de forma** sobre el SQL emitido, declarada
  como tal.
- **El `adminSatelite` escribe un rastro que no puede leer** (límite 7, `P5`). Es una consecuencia
  **declarada y buscada**, no un agujero. Sigue abierta como pregunta y entra en `C7`.
- **Ningún test de integración de la ficha se salta en silencio**, y ninguno abre con
  `if (!algo) return;`. Comprobado archivo por archivo y corrido aparte: 57 pasan, 0 se saltan.

---

## 8 · Qué hace falta para que esto sea `OK`

1. Un test que **muerda** para **R32** (la sonda del bloqueante 1 sirve para probar que muerde).
2. **F6** ejecutada y escrita, con el rastro leído en la base.
3. `tasks.md` marcado, con `B15` evidenciada, y `B0.2`/`C3` y `C7` resueltas antes de desplegar.
4. Una entrada de la 262 en `progress/history.md`.

Los seis menores no bloquean, pero (a) y (b) son de un renglón cada uno y conviene llevárselos en la
misma pasada.

---

*Revisión ejecutada el 2026-08-23 sobre `dev` `c63c7235`. El árbol se devolvió limpio tras cada
mutación (`git status --short` vacío, verificado al terminar).*
