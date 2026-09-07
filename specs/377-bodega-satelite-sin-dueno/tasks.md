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

- [ ] `lib/utils/estados-bodega-satelite.ts`: añadir
      `export const ESTADOS_PAQUETE_EN_ESTANTE = ["en_bodega_satelite"] as const satisfies readonly OrderStatusValue[]`
      con el docstring de `design.md` §3.1 — que dice explícitamente **por qué
      `en_ruta_bodega_satelite` NO está**, y que **no confundir con `ESTADOS_CUSTODIA_SATELITE`**, que
      está dos declaraciones más arriba y significa otra cosa (evidencia histórica, no custodia actual).
- [ ] Exportar también el tipo derivado si hace falta para el `notIn`/`in` tipado.
- [ ] NO tocar `ESTADOS_CUSTODIA_SATELITE`, `ESTADOS_FUERA_DEL_LISTADO_SATELITE`,
      `ESTADOS_BODEGA_SATELITE` ni `alcanceDerivadoDelGrafo()`.

**Hecho cuando:** `tsc` limpio y `tests/unit/utils/estados-bodega-satelite.test.ts` sigue verde
**sin haberlo editado** (R14: la constante nueva es inerte para el cierre del grafo).

## T2 — El fixture de integración aprende a variar el estado `[P]`

**Depende de:** nada. Va en paralelo con T1 y T3; es la precondición de T5 y es **el hueco que dejó
entrar este defecto**, así que se hace aunque todo lo demás se retrasara.

- [ ] `tests/integration/db/zona-reconciliacion-ordenes.test.ts`: `crearOrden` acepta
      `estatusValue?: OrderStatusValue`. Si viene, se resuelve con
      `tx.orderStatus.findUniqueOrThrow({ where: { value: estatusValue }, select: { id: true } })`.
      **Fallo RUIDOSO si el catálogo no está sembrado** — nunca un `if (!x) return;`, que reporta
      `passed` sin comprobar nada (lección ya pagada en este repo).
- [ ] Si NO viene, cae a `FKS.estatusId` **exactamente como hoy**: los 17 casos existentes no se
      editan ni cambian de comportamiento.
- [ ] Dejar dicho en el docstring del archivo que `FKS.estatusId` sale de un `findFirst` sin
      `orderBy` (`_postgres-real.ts:285-296`) y por tanto es **arbitrario y no determinista**: sirve
      de relleno para los casos que no miran el estado, y **no vale** para ningún caso que sí lo mire.

**Hecho cuando:** los 17 casos previos siguen verdes con `git diff` que no toca ni un `expect`, y un
caso de humo nuevo que pasa `estatusValue: "en_bodega_central"` crea la orden con ese estado y no con
el de `FKS`.

## T3 — Contrato del repositorio `[P]`

**Depende de:** nada (solo tipos).

- [ ] `lib/interfaces/repositories/IZonaRepository.ts`: `UpdateZonaResult` gana
      `ordenesRetenidasEnBodegaSatelite: number`, con el docstring de `design.md` §5.1 (incluida la
      nota de que los dos conjuntos son **disjuntos**, no anidados).
- [ ] La firma de `update` NO cambia. `create` NO cambia (R13).

**Hecho cuando:** `tsc` marca en rojo exactamente los sitios que faltan por actualizar (T4, T6) y
ninguno más.

## T4 — El corte y el conteo, dentro de la transacción que ya existe

**Depende de:** T1, T3.

- [ ] `lib/repositories/ZonaRepository.ts`: extraer el `where` de elegibilidad a una función local
      `whereBaseElegible(distritoIds, zonaResueltaId)` (`design.md` §3.3) con **exactamente** las
      condiciones de hoy —`distritoId in`, `zonaId: { not }`, `deletedAt: null`,
      `cierreDetalles: { none: {} }`, `gestiones: { none: {...} }`— y sin ninguna de estado. Este paso
      es **refactor puro**: no cambia el comportamiento.
- [ ] Añadir al `findMany` de elegibles la condición
      `estatus: { value: { notIn: [...ESTADOS_PAQUETE_EN_ESTANTE] } }` (R2).
- [ ] Añadir, **antes** del `findMany` y **siempre** (también cuando no haya nada que mover), el
      `tx.orden.count({ where: { ...base, estatus: { value: { in: [...ESTADOS_PAQUETE_EN_ESTANTE] } } } })`
      acumulando en `ordenesRetenidasEnBodegaSatelite` (R8/R9).
- [ ] El `loteId` y `resolverActorCongelado` siguen resolviéndose **una sola vez por guardado** y solo
      si hay algún grupo con zona resuelta (366/R11 intacto). Un guardado que solo retiene no escribe
      ninguna fila de historial (R6).
- [ ] El retorno lleva los dos números.
- [ ] Comentario en el sitio: por qué en tránsito SÍ y en estante NO, citando `design.md` §1 y el
      §8 de la 366. Quien lea ese `WHERE` dentro de un año tiene que encontrar la razón ahí.

**Hecho cuando (unit, `tests/unit/repositories/zona-repository.test.ts`):** con dobles, un guardado que
resuelve zona nueva devuelve los dos conteos por separado y `create()` no invoca nada de este flujo
(R13). **Ojo:** el unit con dobles NO prueba el corte — eso es T5.

## T5 — El eje del estado, medido contra Postgres real

**Depende de:** T2, T4. Es la task que cierra el hueco de verificación; sin ella la ficha no está hecha.

Casos nuevos en `tests/integration/db/zona-reconciliacion-ordenes.test.ts`, todos con
`estatusValue` explícito:

- [ ] **R2 — en el estante NO se mueve:** orden con `estatusValue: "en_bodega_satelite"`, sin cierre,
      sin gestión, no borrada, cuyo distrito resuelve otra zona ⇒ tras `update()` su `zonaId` **no
      cambia** y no hay fila de `historial_accion` por ella (R6).
      *Mutación obligatoria:* quitar `estatus: { value: { notIn: ... } }` del `where` debe poner este
      caso en **rojo**.
- [ ] **R3 — en tránsito SÍ se mueve:** la misma orden con `estatusValue: "en_ruta_bodega_satelite"`
      ⇒ SÍ se reconcilia, y deja su fila de historial. Es el caso que **defiende la 366**.
      *Mutación obligatoria:* cambiar `notIn` por `in` debe poner este caso en **rojo**. Los dos casos
      juntos son los que hacen que el corte no se pueda ni quitar ni invertir en silencio.
- [ ] **R5 — el corte viejo sigue vivo bajo el nuevo:** una orden `en_bodega_central` (fuera del
      estante) **con** una gestión vigente `entregada` ⇒ sigue sin reconciliarse. Prueba que la
      condición nueva se SUMÓ y no sustituyó a ninguna.
- [ ] **R4 — cuenta el estado ACTUAL, no el histórico:** una orden que tiene en
      `orden_historial_estado` una entrada con destino `en_bodega_satelite` pero cuyo estado ACTUAL es
      `en_reparto` ⇒ **SÍ se reconcilia**. Es el caso que impide que alguien "arregle" esto mirando el
      historial en vez del estado, y el que distingue `ESTADOS_PAQUETE_EN_ESTANTE` de
      `ESTADOS_CUSTODIA_SATELITE`.
- [ ] **R9 — el conteo cuenta lo que dice contar:** en un mismo `update()`, sembrar (i) una orden en
      estante elegible por lo demás ⇒ cuenta 1; (ii) una orden en estante **ya en la zona correcta**
      ⇒ no cuenta; (iii) una orden en estante **con detalle de cierre** ⇒ no cuenta; (iv) una orden en
      estante de un distrito que resuelve **cero** zonas ⇒ no cuenta. Resultado:
      `ordenesRetenidasEnBodegaSatelite === 1`.
- [ ] **R7 — los dos conteos son disjuntos:** un guardado con 2 órdenes movibles y 3 en estante ⇒
      `ordenesReconciliadas === 2` y `ordenesRetenidasEnBodegaSatelite === 3`, y las 3 conservan su
      `zonaId`.
- [ ] **R10 — sin nada en estante, cero:** repetir el caso base de la 366 ⇒ retenidas `0`.
- [ ] **R12 — estable ante repeticiones:** llamar `update()` dos veces con el mismo payload teniendo
      una orden en estante ⇒ la segunda llamada devuelve `ordenesReconciliadas: 0` y **el mismo**
      `ordenesRetenidasEnBodegaSatelite` que la primera, sin filas de historial nuevas.
- [ ] **R13 — `create()` no retiene ni reconcilia:** crear una zona con una orden en estante que
      derivaría a ella ⇒ nada cambia y `CrearZonaResult` sigue sin el campo.
- [ ] **R1 (end-to-end del invariante) — el listado y la asignación:** tras el `update()` que mueve el
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

- [ ] `lib/interfaces/services/IZonaService.ts`: `ActualizarZonaServiceResult` gana
      `ordenesRetenidasEnBodegaSatelite` en la rama `"ok"` (`design.md` §5.2).
- [ ] `lib/services/ZonaService.ts`: `actualizar` reenvía el campo **tal cual**, sin interpretarlo ni
      derivar nada de él. Sin cambios de autorización (`maestro`-only).
- [ ] `lib/types/zona.ts`: `ActualizarZonaResult` gana el mismo campo. ⚠️ Este archivo dispara el gate
      completo (ver la trampa 2 de arriba).
- [ ] `lib/actions/zonas.ts`: sin cambios de lógica; confirmar que el campo fluye sin `any`.

**Hecho cuando (unit, `tests/unit/services/zona-service.test.ts` + `tests/integration/actions/zonas-action.test.ts`):**
con un repo doble que devuelve `{ ordenesReconciliadas: 5, ordenesRetenidasEnBodegaSatelite: 3 }`, el
service y la action devuelven los dos números sin tocarlos.

## T7 — UI: el mensaje del guardado

**Depende de:** T6.

- [ ] `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx`: `mensajeGuardado` pasa a recibir
      también las retenidas y cubre la tabla de `design.md` §5.4.
- [ ] Texto en español, sin jerga. **No puede decir «sin dueño»** (describe un defecto que este cambio
      ya impide) y tiene que nombrar la causa en términos operativos, del estilo «se quedaron en la
      bodega que ya las tiene». Con `0` retenidas, el mensaje queda **exactamente igual que hoy**.
- [ ] **Sin modal, sin confirmación previa, sin bloqueo** (R11). No se toca el modal de conflicto de
      zona central que ya existe.

**Hecho cuando (component test):** guardar con `{ reconciliadas: 12, retenidas: 3 }` pinta las dos
frases; con `{ 12, 0 }` pinta solo la de reubicadas (texto idéntico al de hoy); con `{ 0, 0 }` pinta
`Zona actualizada`; crear zona nunca pinta ninguna de las dos.

## T8 — Guardias: demostrar que lo que no se toca, no se tocó

**Depende de:** T4, T7.

- [ ] `tests/unit/utils/estados-bodega-satelite.test.ts` verde **sin editarlo** (R14).
- [ ] `tests/unit/guards/zona-reconciliacion-no-retarifa.guardia.test.ts` verde **sin editarlo**: esta
      ficha reduce lo que la reconciliación toca, nunca lo amplía.
- [ ] Los tests del inventario de transiciones (`tests/fixtures/inventario-transiciones-140.ts` y sus
      consumidores) verdes **sin editarlos**: cero aristas nuevas (R14).
- [ ] `tests/integration/db/deshacer-asignacion-zona-satelite.int.test.ts` verde sin editarlo: el
      colateral de la Q4 sigue exactamente como estaba, ni mejor ni peor.

**Hecho cuando:** ninguno de los cuatro archivos aparece en el `git diff` de la rama.

## T9 — Medición previa al despliegue (no es opcional)

**Depende de:** todo lo anterior. Se hace **justo antes** de abrir la release, no al escribir el spec.

- [ ] Re-medir en producción, en solo lectura: cuántas órdenes hay en `en_bodega_satelite`, cuántas en
      `en_ruta_bodega_satelite`, y **cuántas tienen hoy deriva de zona** (su distrito resuelve una zona
      distinta de la estampada). Decir los tres números en el PR.
- [ ] Si el conteo de deriva ya NO es 0, **parar y avisar**: hay órdenes huérfanas creadas entre la
      aprobación del spec y el despliegue, y este cambio las congela como están en vez de repararlas.
      Reparar es una decisión aparte (intervención directa, como la del 2026-09-03), no un efecto de
      este código.

**Hecho cuando:** los tres números están escritos en el PR con su fecha, y la cifra del 2026-09-07
(47 / 215 / 0) queda marcada como **caducada**, no como vigente.

---

## Trazabilidad R → test

| Requisito | Task | Test que lo prueba |
| --- | --- | --- |
| R1 | T4, T5 | T5 «el listado y la asignación» (la orden sigue con `zonaId = A`, que es lo que comparan `condicionesSatelite` y `AsignacionSateliteService:206`) |
| R2 | T4 | T5 «en el estante NO se mueve» (+ mutación: quitar el `notIn` lo pone rojo) |
| R3 | T4 | T5 «en tránsito SÍ se mueve» (+ mutación: `notIn`→`in` lo pone rojo) |
| R4 | T4 | T5 «cuenta el estado ACTUAL, no el histórico» |
| R5 | T4 | T5 «el corte viejo sigue vivo bajo el nuevo» + los 17 casos previos de la 366, verdes sin editar |
| R6 | T4 | T5 «en el estante NO se mueve» (aserción de cero filas de `historial_accion`) |
| R7 | T4, T6 | T5 «los dos conteos son disjuntos» + T6 unit (el service reenvía sin tocar) |
| R8 | T4, T6, T7 | T5 «los dos conteos son disjuntos» + T7 component test (las dos frases) |
| R9 | T4 | T5 «el conteo cuenta lo que dice contar» (los cuatro sub-casos) |
| R10 | T4, T7 | T5 «sin nada en estante, cero» + T7 (`{0,0}` deja el mensaje de hoy) |
| R11 | T7 | T7 component test: guardar con retenidas > 0 no abre ningún modal ni bloquea el envío |
| R12 | T4 | T5 «estable ante repeticiones» |
| R13 | T4 | T5 «`create()` no retiene ni reconcilia» + unit de T4 |
| R14 | T1, T8 | T8: `estados-bodega-satelite.test.ts` e inventario de transiciones verdes **sin aparecer en el diff** |

## Dependencias, de un vistazo

```
T1 [P] ─┐
T2 [P] ─┼─> T4 ─> T5 ─┐
T3 [P] ─┘     └─> T6 ─┴─> T7 ─> T8 ─> T9
```

`[P]` = T1, T2 y T3 son independientes entre sí y pueden ir a la vez. **T4 en adelante es una cadena.**
Y el trabajo NO se puede paralelizar con la ficha 376 (trampa 1).
