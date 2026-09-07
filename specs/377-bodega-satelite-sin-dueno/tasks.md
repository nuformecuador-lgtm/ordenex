# Ficha 377 — Tasks

**Rama:** `fix/377-bodega-satelite-sin-dueno`. **Zona:** fullstack (backend → frontend, secuenciado).

## Antes de empezar: dos trampas operativas medidas

### 1. CONFLICTO DE ARCHIVOS con la ficha 376 — no pueden estar `in_progress` a la vez

Las dos son `fullstack`, las dos editan **`lib/repositories/ZonaRepository.ts`**, y además las dos
tocan `lib/interfaces/repositories/IZonaRepository.ts`, `lib/services/ZonaService.ts`,
`lib/types/zona.ts` y `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx`. La regla 1 del
arnés admite hasta 2 features `in_progress` por zona **siempre sin conflicto de archivos entre ellas**,
así que aquí el límite efectivo es **una**. `./init.sh` lo valida, pero conviene no llegar ahí:
comprobar el estado de la 376 en `feature_list.json` **de `origin/dev`** —no del árbol local— antes de
mover esta ficha a `in_progress`.

La 376 además va a **añadir un valor al enum `historial_accion_tipo`** (migración). Si las dos ramas
viven a la vez en una base local compartida, la migración de una pone rojo el gate de la otra y
`prisma generate` se pisa entre worktrees. Secuenciar, no paralelizar.

### 2. El gate rápido se va a negar, y con razón

El diff toca `lib/types/zona.ts` (`^lib/types/` está en `RUTAS_SENSIBLES` de `init.sh:134`) y
`app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx` (`tarifa` está en
`NOMBRES_DE_DINERO`, `init.sh:135`). **`./init.sh --rapido` va a exigir el completo, y es un `fail`,
no un aviso.** Presupuestar la corrida completa (5-11 min) para el PR desde el principio; no descubrirlo
al final.

## Convención de "hecho"

Una task está terminada cuando compila (`tsc` en strict, sin `any` nuevo), pasa lint, y —si toca el
`WHERE` de la reconciliación— **está medida contra Postgres real** (`tests/integration/db`), no contra
un doble. Los tests de servicio usan dobles y no ven el SQL: un corte que vive en un `WHERE` se prueba
donde vive.

---

## T1 — La constante de dominio `[P]`

**Depende de:** nada.

- [x] `lib/utils/estados-bodega-satelite.ts`: añadir
      `export const ESTADOS_PAQUETE_EN_ESTANTE = ["en_bodega_satelite"] as const satisfies readonly OrderStatusValue[]`
      con el docstring de `design.md` §3.1 — que dice explícitamente **por qué
      `en_ruta_bodega_satelite` NO está**, y que **no confundir con `ESTADOS_CUSTODIA_SATELITE`**, que
      está dos declaraciones más arriba y significa otra cosa (evidencia histórica, no custodia actual).
- [x] Exportar también el tipo derivado si hace falta para el `notIn`/`in` tipado.
- [x] NO tocar `ESTADOS_CUSTODIA_SATELITE`, `ESTADOS_FUERA_DEL_LISTADO_SATELITE`,
      `ESTADOS_BODEGA_SATELITE` ni `alcanceDerivadoDelGrafo()`.

**Hecho cuando:** `tsc` limpio y `tests/unit/utils/estados-bodega-satelite.test.ts` sigue verde
**sin haberlo editado** (R14: la constante nueva es inerte para el cierre del grafo).

## T2 — El fixture de integración aprende a variar el estado `[P]`

**Depende de:** nada. Va en paralelo con T1 y T3; es la precondición de T5 y es **el hueco que dejó
entrar este defecto**, así que se hace aunque todo lo demás se retrasara.

- [x] `tests/integration/db/zona-reconciliacion-ordenes.test.ts`: `crearOrden` acepta
      `estatusValue?: OrderStatusValue`. Si viene, se resuelve con
      `tx.orderStatus.findUniqueOrThrow({ where: { value: estatusValue }, select: { id: true } })`.
      **Fallo RUIDOSO si el catálogo no está sembrado** — nunca un `if (!x) return;`, que reporta
      `passed` sin comprobar nada (lección ya pagada en este repo).
- [x] Si NO viene, cae a `FKS.estatusId` **exactamente como hoy**: los 17 casos existentes no se
      editan ni cambian de comportamiento. (**Medido el 2026-09-07:** esos 17 son los casos que el
      archivo EJECUTA en `dev` — 12 `it(` mas 2 `it.each` que expanden a 3 y a 2. Con los 11 de
      esta ficha el archivo pasa a correr **28**.)
- [x] Dejar dicho en el docstring del archivo que `FKS.estatusId` sale de un `findFirst` sin
      `orderBy` (`_postgres-real.ts:285-296`) y por tanto es **arbitrario y no determinista**: sirve
      de relleno para los casos que no miran el estado, y **no vale** para ningún caso que sí lo mire.

**Hecho cuando:** los 17 casos previos (12 `it(` + 2 `it.each`) siguen verdes con `git diff` que no
toca ni un `expect`, y un
caso de humo nuevo que pasa `estatusValue: "en_bodega_central"` crea la orden con ese estado y no con
el de `FKS`.

## T3 — Contrato del repositorio `[P]`

**Depende de:** nada (solo tipos).

- [x] `lib/interfaces/repositories/IZonaRepository.ts`: `UpdateZonaResult` gana
      `ordenesRetenidasEnBodegaSatelite: number`, con el docstring de `design.md` §5.1 (incluida la
      nota de que los dos conjuntos son **disjuntos**, no anidados).
- [x] La firma de `update` NO cambia. `create` NO cambia (R13).

**Hecho cuando:** `tsc` marca en rojo exactamente los sitios que faltan por actualizar (T4, T6) y
ninguno más.

## T4 — El corte y el conteo, dentro de la transacción que ya existe

**Depende de:** T1, T3.

- [x] `lib/repositories/ZonaRepository.ts`: extraer el `where` de elegibilidad a una función local
      `whereBaseElegible(distritoIds, zonaResueltaId)` (`design.md` §3.3) con **exactamente** las
      condiciones de hoy —`distritoId in`, `zonaId: { not }`, `deletedAt: null`,
      `cierreDetalles: { none: {} }`, `gestiones: { none: {...} }`— y sin ninguna de estado. Este paso
      es **refactor puro**: no cambia el comportamiento.
- [x] Añadir al `findMany` de elegibles la condición
      `estatus: { value: { notIn: [...ESTADOS_PAQUETE_EN_ESTANTE] } }` (R2).
- [x] Añadir, **antes** del `findMany` y **siempre** (también cuando no haya nada que mover), el
      `tx.orden.count({ where: { ...base, estatus: { value: { in: [...ESTADOS_PAQUETE_EN_ESTANTE] } } } })`
      acumulando en `ordenesRetenidasEnBodegaSatelite` (R8/R9).
- [x] El `loteId` y `resolverActorCongelado` siguen resolviéndose **una sola vez por guardado** y solo
      si hay algún grupo con zona resuelta (366/R11 intacto). Un guardado que solo retiene no escribe
      ninguna fila de historial (R6).
- [x] El retorno lleva los dos números.
- [x] Comentario en el sitio: por qué en tránsito SÍ y en estante NO, citando `design.md` §1 y el
      §8 de la 366. Quien lea ese `WHERE` dentro de un año tiene que encontrar la razón ahí.

**Hecho cuando (unit, `tests/unit/repositories/zona-repository.test.ts`):** con dobles, un guardado que
resuelve zona nueva devuelve los dos conteos por separado y `create()` no invoca nada de este flujo
(R13). **Ojo:** el unit con dobles NO prueba el corte — eso es T5.

## T5 — El eje del estado, medido contra Postgres real

**Depende de:** T2, T4. Es la task que cierra el hueco de verificación; sin ella la ficha no está hecha.

Casos nuevos en `tests/integration/db/zona-reconciliacion-ordenes.test.ts`, todos con
`estatusValue` explícito:

- [x] **R2 — en el estante NO se mueve:** orden con `estatusValue: "en_bodega_satelite"`, sin cierre,
      sin gestión, no borrada, cuyo distrito resuelve otra zona ⇒ tras `update()` su `zonaId` **no
      cambia** y no hay fila de `historial_accion` por ella (R6).
      *Mutación obligatoria:* quitar `estatus: { value: { notIn: ... } }` del `where` debe poner este
      caso en **rojo**.
- [x] **R3 — en tránsito SÍ se mueve:** la misma orden con `estatusValue: "en_ruta_bodega_satelite"`
      ⇒ SÍ se reconcilia, y deja su fila de historial. Es el caso que **defiende la 366**.
      *Mutación obligatoria:* cambiar `notIn` por `in` debe poner este caso en **rojo**. Los dos casos
      juntos son los que hacen que el corte no se pueda ni quitar ni invertir en silencio.
- [x] **R5 — el corte viejo sigue vivo bajo el nuevo:** una orden `en_bodega_central` (fuera del
      estante) **con** una gestión vigente `entregada` ⇒ sigue sin reconciliarse. Prueba que la
      condición nueva se SUMÓ y no sustituyó a ninguna.
- [x] **R4 — cuenta el estado ACTUAL, no el histórico:** una orden que tiene en
      `orden_historial_estado` una entrada con destino `en_bodega_satelite` pero cuyo estado ACTUAL es
      `en_reparto` ⇒ **SÍ se reconcilia**. Es el caso que impide que alguien "arregle" esto mirando el
      historial en vez del estado, y el que distingue `ESTADOS_PAQUETE_EN_ESTANTE` de
      `ESTADOS_CUSTODIA_SATELITE`.
- [x] **R9 — el conteo cuenta lo que dice contar:** en un mismo `update()`, sembrar (i) una orden en
      estante elegible por lo demás ⇒ cuenta 1; (ii) una orden en estante **ya en la zona correcta**
      ⇒ no cuenta; (iii) una orden en estante **con detalle de cierre** ⇒ no cuenta; (iv) una orden en
      estante de un distrito que resuelve **cero** zonas ⇒ no cuenta. Resultado:
      `ordenesRetenidasEnBodegaSatelite === 1`.
- [x] **R7 — los dos conteos son disjuntos:** un guardado con 2 órdenes movibles y 3 en estante ⇒
      `ordenesReconciliadas === 2` y `ordenesRetenidasEnBodegaSatelite === 3`, y las 3 conservan su
      `zonaId`.
- [x] **R10 — sin nada en estante, cero:** repetir el caso base de la 366 ⇒ retenidas `0`.
- [x] **R12 — estable ante repeticiones:** llamar `update()` dos veces con el mismo payload teniendo
      una orden en estante ⇒ la segunda llamada devuelve `ordenesReconciliadas: 0` y **el mismo**
      `ordenesRetenidasEnBodegaSatelite` que la primera, sin filas de historial nuevas.
- [x] **R13 — `create()` no retiene ni reconcilia:** crear una zona con una orden en estante que
      derivaría a ella ⇒ nada cambia y `CrearZonaResult` sigue sin el campo.
- [x] **R1 (end-to-end del invariante) — el listado y la asignación:** tras el `update()` que mueve el
      distrito, la orden en estante sigue satisfaciendo el acotamiento de `condicionesSatelite` para
      la zona A (`o."zona_id" = A` ∧ evidencia de custodia) y `orden.zonaId === A`, que es la
      condición exacta que `AsignacionSateliteService:206` compara antes de decir `zona_ajena`.
      Es el requisito de resultado: no basta con que el `WHERE` excluya, hay que ver que la bodega
      **sigue teniendo** la orden.

**Hecho cuando:** los 9 casos corren contra la base de test de Postgres (no contra un doble), y las
**dos mutaciones marcadas como obligatorias** se ejecutaron a mano al menos una vez y pusieron en rojo
el caso que les toca. Dejarlo dicho en el PR; no hace falta un test que pruebe al test.

## T6 — Servicio, tipos y Server Action

**Depende de:** T3 (tipos) y T4 (implementación).

- [x] `lib/interfaces/services/IZonaService.ts`: `ActualizarZonaServiceResult` gana
      `ordenesRetenidasEnBodegaSatelite` en la rama `"ok"` (`design.md` §5.2).
- [x] `lib/services/ZonaService.ts`: `actualizar` reenvía el campo **tal cual**, sin interpretarlo ni
      derivar nada de él. Sin cambios de autorización (`maestro`-only).
- [x] `lib/types/zona.ts`: `ActualizarZonaResult` gana el mismo campo. ⚠️ Este archivo dispara el gate
      completo (ver la trampa 2 de arriba).
- [x] `lib/actions/zonas.ts`: sin cambios de lógica; confirmar que el campo fluye sin `any`.

**Hecho cuando (unit, `tests/unit/services/zona-service.test.ts` + `tests/integration/actions/zonas-action.test.ts`):**
con un repo doble que devuelve `{ ordenesReconciliadas: 5, ordenesRetenidasEnBodegaSatelite: 3 }`, el
service y la action devuelven los dos números sin tocarlos.

## T7 — UI: el mensaje del guardado

**Depende de:** T6.

- [x] `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx`: `mensajeGuardado` pasa a recibir
      también las retenidas y cubre la tabla de `design.md` §5.4.
- [x] Texto en español, sin jerga. **No puede decir «sin dueño»** (describe un defecto que este cambio
      ya impide) y tiene que nombrar la causa en términos operativos, del estilo «se quedaron en la
      bodega que ya las tiene». Con `0` retenidas, el mensaje queda **exactamente igual que hoy**.
- [x] **Sin modal, sin confirmación previa, sin bloqueo** (R11). No se toca el modal de conflicto de
      zona central que ya existe.

**Hecho cuando (component test):** guardar con `{ reconciliadas: 12, retenidas: 3 }` pinta las dos
frases; con `{ 12, 0 }` pinta solo la de reubicadas (texto idéntico al de hoy); con `{ 0, 0 }` pinta
`Zona actualizada`; crear zona nunca pinta ninguna de las dos.

### El texto que quedó (2026-09-07)

La segunda frase se **suma** a la de la 366, no la sustituye: los dos conjuntos son disjuntos y los
dos números importan.

| reconciliadas | retenidas | toast |
| --- | --- | --- |
| 12 | 3 | `Zona actualizada (12 órdenes reubicadas). 3 órdenes no cambiaron de zona porque su paquete ya está en una bodega.` |
| 0 | 3 | `Zona actualizada. 3 órdenes no cambiaron de zona porque su paquete ya está en una bodega.` |
| 1 | 1 | `Zona actualizada (1 orden reubicada). 1 orden no cambió de zona porque su paquete ya está en una bodega.` |
| 12 | 0 | `Zona actualizada (12 órdenes reubicadas)` — **literal, igual que antes de esta ficha** |
| 0 | 0 | `Zona actualizada` — **literal** |
| crear | — | `Zona creada` — **literal** |

La causa se nombra por lo que pasa en la bodega, no por el modelo: ni «retenidas», ni «custodia», ni
«sin dueño». La guarda es `> 0` y no `<= 0` para que el cero NO se diga (R10): un «0 órdenes» en el
caso normal —la enorme mayoría de los guardados— enseña a ignorar el mensaje justo cuando el número
deja de ser 0.

**Los 4 casos de la 366 en `tests/components/CrearZonaFormReconciliacion.test.tsx` quedan intactos**
(son el ancla del texto viejo). Los 7 nuevos comparan el texto **literal**, nunca contra
`mensajeGuardado`: una aserción contra su propia fuente está siempre verde.

**Mutaciones ejecutadas (11 casos en el archivo):**

| Mutación | Rojos | Casos que se caen |
| --- | --- | --- |
| M1 — quitar la frase de retenidas de `mensajeGuardado` | 3 | los tres de R8 |
| M2 — no leer `ordenesRetenidasEnBodegaSatelite` de la respuesta (el cableado) | 3 | los tres de R8 |
| M3 — guarda `> 0` → `>= 0` (el cero habla) | 2 | los dos de R10 |
| M4 — forzar siempre el plural | 1 | «1 retenida va en singular» |
| M5 — `return` antes de `onSaved()` cuando hay retenidas (bloquear) | 1 | el de R11 |
| M6 — leer el campo sin mirar el modo **y** poner la frase antes del `esEditar` | 4 | los tres de R8 + el de R13 |

**Un hallazgo honesto:** el caso de R13 **no** se cae con una mutación de un solo punto. La rama de
crear no asigna nunca `ordenesRetenidas` *y además* `mensajeGuardado` corta en `esEditar`: cada
guarda basta por su cuenta, así que hay que romper las dos (M6) para verlo en rojo. Mide la
combinación, no cada mitad; quien lo lea que no le pida más de lo que da.

## T8 — Guardias: demostrar que lo que no se toca, no se tocó

**Depende de:** T4, T7.

- [x] `tests/unit/utils/estados-bodega-satelite.test.ts` verde **sin editarlo** (R14).
- [x] `tests/unit/guards/zona-reconciliacion-no-retarifa.guardia.test.ts` verde **sin editarlo**: esta
      ficha reduce lo que la reconciliación toca, nunca lo amplía.
- [x] Los tests del inventario de transiciones (`tests/fixtures/inventario-transiciones-140.ts` y sus
      consumidores) verdes **sin editarlos**: cero aristas nuevas (R14).
- [x] `tests/integration/db/deshacer-asignacion-zona-satelite.int.test.ts` verde sin editarlo: el
      colateral de la Q4 sigue exactamente como estaba, ni mejor ni peor.

**Hecho cuando:** ninguno de los cuatro archivos aparece en el `git diff` de la rama.

## T9 — Medición previa al despliegue (no es opcional)

**Depende de:** todo lo anterior. Se hace **justo antes** de abrir la release, no al escribir el spec.

- [x] Re-medir en producción, en solo lectura: cuántas órdenes hay en `en_bodega_satelite`, cuántas en
      `en_ruta_bodega_satelite`, y **cuántas tienen hoy deriva de zona** (su distrito resuelve una zona
      distinta de la estampada). Decir los tres números en el PR.
- [x] Si el conteo de deriva ya NO es 0, **parar y avisar**: hay órdenes huérfanas creadas entre la
      aprobación del spec y el despliegue, y este cambio las congela como están en vez de repararlas.
      Reparar es una decisión aparte (intervención directa, como la del 2026-09-03), no un efecto de
      este código.

**Hecho cuando:** los tres números están escritos en el PR con su fecha, y la cifra vieja
(47 / 215 / 0) queda marcada como **caducada**, no como vigente.

### Medido — 2026-09-07, por el LEADER, contra producción en solo lectura. **LUZ VERDE**

| | valor |
| --- | --- |
| Órdenes `en_bodega_satelite` (en el estante) | **37** |
| Órdenes `en_ruta_bodega_satelite` (en tránsito) | **215** |
| Órdenes desalineadas (total) | **0** |
| **Órdenes desalineadas EN EL ESTANTE** | **0** |

La cifra vieja de **47** en estante queda **CADUCADA**; la vigente es **37**. Con **0 desalineadas**
no hay que parar: este cambio **congela, no repara**, y no existe hoy ninguna orden ya huérfana a la
que congelar. Lo midió el leader porque el agente implementador no tiene el MCP de Supabase.

## T10 — La segunda puerta: la corrección manual de ubicación (Q3, decisión del LEADER)

**Depende de:** T1. **Añadida el 2026-09-07 al mandar implementar.** ⚠️ La decisión de cerrar Q3
dentro de esta ficha es **del leader y NO está firmada por el humano** (ver la sección de decisiones
al final de `requirements.md`). El `design.md` §7 y §10 dicen que `CorregirDatosClienteService` no se
toca: **esta task los deroga a propósito**, y esa derogación es la decisión.

- [x] `lib/services/CorregirDatosClienteService.ts`, paso 6 (justo antes de `data.zonaId =
      distrito.zonaId`): si el paquete está en el estante (`paqueteEnEstanteSatelite`) **y** la zona
      derivada difiere de la estampada, rechazo por `distritoId` nombrando la bodega. Va ANTES del
      gate del dinero: no se ofrece confirmar lo que se va a rechazar igual.
- [x] La condición compara **zona derivada contra zona estampada**, no `cambios.includes("distritoId")`:
      el distrito puede ser el mismo y resolver hoy otra zona —es el escenario de la 366— y ese caso
      también escribe `zona_id`.
- [x] NO se toca `ESTADOS_SIN_CORRECCION` (R16): eso habría bloqueado el nombre, el teléfono, el
      producto, las notas, el peso y la dirección de las órdenes que hoy están en estante.
- [x] `lib/utils/estados-bodega-satelite.ts` exporta `paqueteEnEstanteSatelite()` para que el
      servicio no repita la lista ni la lea al revés.

**Hecho cuando (unit, `tests/unit/services/corregir-datos-cliente-bodega-satelite.test.ts`):** 8
casos. Mutaciones ejecutadas: apagar el gate → 3 rojos; quitar la comparación de zona → 1 rojo (el
caso de R16); añadir `"direccion"` a `CAMPOS_GEOGRAFIA` → rojo el caso de la dirección; meter
`en_bodega_satelite` en `ESTADOS_SIN_CORRECCION` → 6 de los 8.

**Cierre de revisión (2026-09-07).** Dos arreglos sobre esta task, de `progress/review_377.md`:
el texto del rechazo pasa a **español con tildes** (lo lee un maestro en el modal), y se añade el
octavo caso —**corregir SOLO la dirección de una orden en el estante**—, el único camino que la
ficha promete no bloquear y que no tenía asercion propia CON EL PAQUETE EN EL ESTANTE.

---

## Estado real al terminar la implementación (2026-09-07)

| Task | Estado | Nota |
| --- | --- | --- |
| T1 | hecha | `ESTADOS_PAQUETE_EN_ESTANTE` + `paqueteEnEstanteSatelite()`; el test del grafo sigue verde sin editarlo |
| T2 | hecha | `crearOrden` acepta `estatusValue`; los 17 casos de la 366 (12 `it(` + 2 `it.each` -> 3 y 2) no cambiaron ni un `expect`; el archivo pasa de 17 a 28 tests |
| T3 | hecha | `UpdateZonaResult` gana el campo en su rama `ok` (la forma real es la unión NOMBRADA de la 376, no el `{zona, conteo}` del design §5.1) |
| T4 | hecha | `whereBaseElegible` + `notIn`/`count`; 5 casos unit nuevos |
| T5 | hecha | 11 casos nuevos contra Postgres real (9 pedidos + el humo de T2 + el de R4) |
| T6 | hecha | interfaz, service, `lib/types/zona.ts` y la Server Action (que ya reenviaba tal cual) |
| T7 | hecha (frontend, 2026-09-07) | `mensajeGuardado` gana el tercer argumento y la segunda frase; 7 casos nuevos en `tests/components/CrearZonaFormReconciliacion.test.tsx`, 6 mutaciones medidas. **R8 y R11 dejan de estar a medias: la pantalla ya no calla.** El texto de antes de la ficha se conserva LITERAL en los tres casos sin retenidas |
| T8 | hecha | los cuatro archivos siguen verdes y NINGUNO aparece en el diff |
| **T9** | **hecha — medida por el LEADER el 2026-09-07, LUZ VERDE** | Producción en solo lectura: **37** en estante · **215** en tránsito · **0** desalineadas · **0** desalineadas EN EL ESTANTE. La cifra vieja de 47 queda **CADUCADA**. Al ser 0 la deriva, no hay nada que parar ni que reparar |
| T10 | hecha | Q3, decisión del leader |

---

## Trazabilidad R → test

Los títulos son los REALES de los tests escritos. `db/zona` =
`tests/integration/db/zona-reconciliacion-ordenes.test.ts` (contra Postgres real); `unit/repo` =
`tests/unit/repositories/zona-repository.test.ts`; `unit/svc` =
`tests/unit/services/zona-service.test.ts`; `action` =
`tests/integration/actions/zonas-action.test.ts`; `unit/q3` =
`tests/unit/services/corregir-datos-cliente-bodega-satelite.test.ts`; `form` =
`tests/components/CrearZonaFormReconciliacion.test.tsx` (T7, jsdom).

| Requisito | Task | Test que lo prueba |
| --- | --- | --- |
| R1 | T4, T5 | `db/zona` «⭑ 377/R1: la bodega que TIENE el paquete lo sigue viendo en su listado, y la otra no» — ejercita el SQL REAL de `condicionesSatelite` vía `findRecepcionSatelitePaginada`, en las dos zonas |
| R2 | T4, T5 | `db/zona` «⭑ 377/R2/R6: una orden EN EL ESTANTE …» (mutación medida: quitar el `notIn` → 6 rojos) |
| R3 | T4, T5 | `db/zona` «⭑ 377/R3: una orden EN TRANSITO … SI se reconcilia» (mutación medida: `notIn`→`in` → 24 rojos) |
| R4 | T4, T5 | `db/zona` «⭑ 377/R4: cuenta el estado ACTUAL, no el historico» |
| R5 | T4, T5 | `db/zona` «⭑ 377/R5: el corte viejo sigue vivo bajo el nuevo» + los 17 casos de la 366 (12 `it(` + 2 `it.each`), verdes sin editar un solo `expect` |
| R6 | T4, T5 | `db/zona` «⭑ 377/R2/R6 …» (cero filas de `historial_accion` por la retenida) + `unit/repo` «⭑ R8: el conteo se hace TAMBIEN cuando no hay ninguna orden que mover» |
| R7 | T4, T6 | `db/zona` «⭑ 377/R7: los dos conteos son DISJUNTOS» + `unit/repo` «⭑ R7: … el retenido ACUMULA por grupo» + `unit/svc` «⭑ 377/R7/R8: reenvia los DOS conteos del repo TAL CUAL» |
| R8 | T4, T6, T7 | `db/zona` «⭑ 377/R7 …» + `action` «⭑ 366/R12 + 377/R8: actualizar ok reenvia LOS DOS conteos» + **`form` «⭑ R8: con retenidas > 0 el toast dice las DOS cosas, no solo las reubicadas», «⭑ R8: sin ninguna reubicada, la frase de las retenidas aparece igual» y «⭑ R8: 1 retenida va en singular»** (mutaciones medidas: quitar la frase → 3 rojos; no leer el campo de la respuesta → 3 rojos) |
| R9 | T4, T5 | `db/zona` «⭑ 377/R9: el conteo … cuenta EXACTAMENTE lo que dice contar» (los cuatro sub-casos) + `unit/repo` «⭑ R2/R9: las dos consultas comparten el `where` base» |
| R10 | T4, T6, T7 | `db/zona` «⭑ 377/R10: sin ninguna orden en el estante, las retenidas son 0» + `unit/svc` «⭑ 377/R10: … reenvia CERO (no lo omite)» + `form` «⭑ R10: con retenidas = 0 el mensaje es EXACTAMENTE el de antes de esta ficha» y «⭑ R10: sin reubicar y sin retener, «Zona actualizada» a secas» (mutación medida: guarda `> 0` → `>= 0` → 2 rojos) |
| R11 | T4, T7 | `db/zona` «⭑ 377/R2/R6 …»: el `update` devuelve `ok` y guarda la zona con retenidas > 0 — no hay rama que bloquee ni que pida confirmar. La mitad de pantalla es `form` «⭑ R11: retener NO bloquea el guardado, no abre ningún modal y avisa al padre» (mutación medida: `return` antes de `onSaved()` con retenidas > 0 → 1 rojo) |
| R12 | T4, T5 | `db/zona` «⭑ 377/R12: repetir el guardado informa las MISMAS retenidas y 0 reconciliadas» |
| R13 | T4, T5, T7 | `db/zona` «⭑ 377/R13: `create()` ni reconcilia ni retiene» + `unit/repo` «⭑ R13: `create()` no cuenta retenidas» + `form` «⭑ R13: crear zona no pinta el conteo aunque la respuesta lo trajera» (mutación medida: M6, y **solo** M6 — mide la combinación de las dos guardas, ver T7) |
| R14 | T1, T8 | `tests/unit/utils/estados-bodega-satelite.test.ts` y el inventario de transiciones, verdes **sin aparecer en el diff de la rama** |
| R15 | T10 | `unit/q3` «⭑ rechaza y NO escribe, aunque la peticion venga CONFIRMADA», «⭑ sin confirmar, el rechazo GANA al aviso de importes» y «el motivo nombra la BODEGA» (mutación medida: apagar el gate → 3 rojos) |
| R16 | T10 | `unit/q3` «⭑ corregir el distrito DENTRO de la misma zona sigue permitido», «⭑ corregir el nombre o el telefono … sigue permitido» y «⭑ corregir SOLO la DIRECCION de una orden en el estante sigue permitido» (mutaciones medidas: quitar la comparación de zona → 1 rojo; añadir `"direccion"` a `CAMPOS_GEOGRAFIA` → rojo el caso de la dirección) |

## Dependencias, de un vistazo

```
T1 [P] ─┐
T2 [P] ─┼─> T4 ─> T5 ─┐
T3 [P] ─┘     └─> T6 ─┴─> T7 ─> T8 ─> T9
```

`[P]` = T1, T2 y T3 son independientes entre sí y pueden ir a la vez. **T4 en adelante es una cadena.**
Y el trabajo NO se puede paralelizar con la ficha 376 (trampa 1).
