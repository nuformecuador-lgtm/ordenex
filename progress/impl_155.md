# impl_155 (FRONTEND + cierre) — Creación bifurcada por bodega + retiro de `en_fulfillment`

> Rama: `feature/155-creacion-bifurcada` · Worktree: `.claude/worktrees/lote-135`
> Spec: `specs/155-creacion-bifurcada-fulfillment/` (R1–R43) · Fase: **B (frontend)**
> Fecha: 2026-07-29 · Base de esta fase: `cecc6c9` (fin de la fase backend)
> **Detalle del backend: `progress/impl_155_backend.md`.** Este archivo NO lo repite: cubre el
> bloque 6, la mitad `.tsx` del bloque 8 y el cierre (T8.3), y consolida el mapa R1–R43.

---

## 1. Veredicto en una línea

**Feature cerrada en código.** El rojo deliberado que dejó la fase backend está resuelto: `./init.sh`
termina **en verde** (typecheck limpio, 0 errores de lint, **573 archivos / 6329 tests, 0 fallos**), el
literal retirado ya no aparece en ningún archivo de `app/`, `lib/`, `components/`, `hooks/`,
`scripts/`, `tests/` ni `e2e/` fuera de **3 archivos allowlisteados con justificación individual**, y
los 43 requisitos tienen test. Quedan **dos deudas de verificación heredadas del backend** (§6), que
esta fase no puede saldar y no saldó.

---

## 2. El rojo heredado: verificado ANTES de tocar nada

La fase backend prometió un rojo concreto. Se comprobó, no se asumió:

```
$ pnpm run typecheck            # ANTES de esta fase
app/(app)/ordenes/_components/EstatusBadge.tsx(15,3): error TS2353 ... 'en_fulfillment' ... Record<…, string>
app/(app)/ordenes/_components/EstatusBadge.tsx(45,3): error TS2353 ... 'en_fulfillment' ... Record<…, BadgeVariant>
app/(app)/ordenes/_components/EstatusBadge.tsx(82,3): error TS2353 ... 'en_fulfillment' ... Partial<Record<…, string>>
   -> 3 errores, los 3 en 1 archivo, en las lineas 15/45/82. COINCIDE con lo prometido.

$ pnpm exec vitest run tests/components
 Test Files  2 failed | 107 passed (109)
      Tests  2 failed | 1121 passed (1123)
 FAIL EstatusBadgeCatalogoV2.test.tsx > "tiene una etiqueta por cada uno de los 20 values, sin sobrantes"
 FAIL EstatusBadgeEnReparto.test.tsx  > "el mapa cubre los 20 values del catalogo, sin sobrantes"
   -> 2 tests de componente. COINCIDE con lo prometido.
```

No hubo cliente Prisma stale: el worktree ya lo tenía generado y `pnpm db:generate` no fue necesario.

---

## 3. Censo del literal: la worklist real, medida

El censo se ejecutó con el **mismo recorrido y la misma regex** que el guard (`fs.readdir` sobre los 7
`SCAN_DIRS`, `\ben_fulfillment\b`), no con `git grep`. Estado **al empezar** esta fase:

| Archivo | Ocurrencias | Destino |
| --- | --- | --- |
| `app/(app)/ordenes/_components/EstatusBadge.tsx` | 3 (15, 45, 82) | T6.1 — limpiado |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` | 2 (108, 304) | T6.2 — limpiado |
| `app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx` | 4 (57, 69, 169, 170) | T6.2 — limpiado |
| `tests/components/EscanerRecepcion.test.tsx` | 1 | T8.2 — limpiado |
| `tests/components/EstatusBadgeEnReparto.test.tsx` | 3 | T8.2 — limpiado |
| `tests/components/ManifiestoFlujos.test.tsx` | 1 | T8.2 — limpiado |
| `tests/components/OrdenesListadoBloqueoCierre.test.tsx` | 3 | T8.2 — limpiado |
| `tests/components/OrdenesRevisionMaestro.test.tsx` | 5 | T8.2 — limpiado |
| `tests/integration/db/order-status-enum-migration.test.ts` | 1 | **allowlist** (ya estaba, por la 135) |
| `tests/integration/db/rename-order-status-migration.test.ts` | 4 | **allowlist** (entrada nueva) |

Estado **al terminar**: exactamente esos 2 archivos de migración más el propio guard (que contiene los
patrones y ya estaba allowlisteado). **Cero ofensores.**

### 3.1 Tres discrepancias con lo que el spec/la bitácora del backend anticipaban

1. **`ordenes-columns.tsx` no tenía nada que limpiar.** T6.2 pide "el comentario de
   `ordenes-columns.tsx:192`". Hoy la línea 192 es el JSDoc de la columna "Liberada el" y el archivo
   **no contiene el literal**: `git log -S` muestra que **la feature 159**
   (`b2181e7 refactor(159): retira el flujo del mensajero sugerido`) ya se llevó ese comentario
   (`* Variante de columnas para estados PREVIOS a la asignación (\`en_fulfillment\`,`). Las 3
   ocurrencias de "fulfillment" que quedan en ese archivo (157, 159, 161) son el **monto de tarifa**,
   que `requirements.md` advierte expresamente no confundir. **No se tocó el archivo.**
2. **`ESTADOS_MENSAJERO_SUGERIDO` ya no existe.** T6.2 lo cita en `OrdenesListado.tsx:71`; la 159 lo
   retiró junto con el flujo completo del mensajero sugerido. Y `ESTADOS_ASIGNACION` ya venía limpio
   desde la 156: solo sobrevivía el **comentario histórico** que explicaba por qué el value había
   salido del conjunto. Se reescribió ese comentario; la constante no cambió.
3. **La allowlist necesitó 2 entradas, no 3.** La bitácora del backend (§8.4) predijo tres, incluida
   la del test de su propia migración. No hizo falta: ese test construye el literal por concatenación
   (`["en","fulfillment"].join("_")`) y su `migrationDirFor("_order_status_retiro_en_fulfillment")` no
   dispara la frontera de palabra (el carácter previo es `_`). Una de las tres entradas
   (`order-status-enum-migration.test.ts`) **ya estaba** desde la 135; solo se le amplió el
   comentario. La única entrada nueva es `rename-order-status-migration.test.ts`.

La mitad `.ts` de T8.2 estaba **efectivamente hecha**: se verificó archivo por archivo que
`guia-asignacion-service.test.ts` (que la task decía con 28 ocurrencias),
`orden-repository.guia.test.ts`, `guia-asignacion-gate-coordenadas.test.ts`,
`recepcion-satelite-service.test.ts`, `webhook-estado-encolado.test.ts`, `order-status.test.ts` y
`e2e/reprogramacion-liberacion.spec.ts` tienen **0 ocurrencias**.

---

## 4. Qué se cambió en esta fase

### 4.1 T6.1 — `EstatusBadge.tsx` (R28, R41)

Se retiran las 3 entradas: `ORDER_STATUS_LABELS`, `ORDER_STATUS_VARIANT` y el **refuerzo de acento
propio** de `ORDER_STATUS_CLASS`. Ni `satisfies` ni el tipado `Record<OrderStatusValue, …>` se
relajan: siguen siendo la red que rompe el build si un value del catálogo queda sin clasificar.

Consecuencia de presentación que hay que saber: `en_reparto` **pierde su gemelo**. Desde la 153 los dos
compartían byte a byte la misma cadena de 4 tokens de marca, y el test de la 153 comparaba uno contra
otro. Ese espejo ya no existe, así que el caso pasa a afirmar los 4 tokens **directamente** sobre
`en_reparto` (misma red: si la entrada del `Partial` desaparece, los tokens desaparecen del DOM) y se
añade un caso nuevo que recorre el catálogo entero y exige que `en_reparto` sea el **único** portador
del acento — de modo que reintroducir un gemelo no pase inadvertido.

**R41 ya estaba implementado** en el componente (`isKnownStatus` → variante neutra + value crudo). Lo
que faltaba era el caso que lo demuestre, y es lo que aporta el archivo nuevo (§4.3).

### 4.2 T6.2 — listado y revisión del maestro (R32)

- **`OrdenesRevisionMaestro.tsx`**: se retira el `<OrdenesApartado titulo="En fulfillment" …>`
  completo, con su `actionLabel="Generar guía"` y su `onAction`. `en_preparacion` queda como **único**
  apartado de revisión con acción por lote. Se reescriben los 2 comentarios de cabecera que lo
  nombraban y se añade la nota de la 155.
- **`OrdenesListado.tsx`**: se retira el `case` del `switch` de `accionesDe` (era un fall-through hacia
  `en_preparacion`). Un value que el build no conoce cae ahora al `default`, que devuelve `[]`: sin
  acciones por lote y checkbox bloqueado con su motivo. Se reescribe el comentario histórico de
  `ESTADOS_ASIGNACION`.
- **`ordenes-columns.tsx`**: **no se tocó** (§3.1.1). Es un imán de drift que ya se revirtió dos
  veces; no había nada que cambiar, así que no se cambió nada.

Ninguno de estos tres cambios rompía el build (el `switch` es sobre `string | undefined` y
`estatusValue` es `string`): es limpieza de **comportamiento**, y por eso lleva tests propios.

### 4.3 T8.2 — los 5 `.tsx` (+1 archivo nuevo)

| Archivo | Qué se hizo |
| --- | --- |
| `EstatusBadgeCatalogoV2.test.tsx` | conteo del catálogo 20 → **19**, con la nota de que es la primera baja. El conteo se mantiene escrito a mano: es la red que caza un sobrante en runtime, que el `Record` no ve. |
| `EstatusBadgeEnReparto.test.tsx` | se retira la comparación contra el gemelo (§4.1); tokens afirmados directamente + caso nuevo de "único portador del acento". |
| `EscanerRecepcion.test.tsx` | el caso `estado_invalido` usaba el value retirado para demostrar que el toast muestra la **etiqueta legible**; se sustituye por `en_preparacion` (estado vigente que tampoco es recibible en una bodega satélite). Lo que el caso afirma no cambia. |
| `ManifiestoFlujos.test.tsx` | `estatusValue` del fixture genérico → `en_preparacion`. Ningún caso asevera sobre ese campo. |
| `OrdenesListadoBloqueoCierre.test.tsx` | fuera del catálogo mínimo y del mapa de ids; el `it.each` de 156/R28 pasa de 2 filas a 1 (queda un solo estado de "generar guía"). **Se añaden 4 casos** de R32/R41 sobre `accionesDe`. |
| `OrdenesRevisionMaestro.test.tsx` | ver abajo. |
| `EstatusBadgeRetiroFulfillment.test.tsx` | **NUEVO**: 8 casos de R28 + R41 (§4.4). |

`OrdenesRevisionMaestro.test.tsx` es la cirugía mayor: el apartado retirado era el que tenía **2
órdenes** de fixture (`REM-F1`/`REM-F2`) y varios casos dependían de tener más de una fila en un mismo
apartado (selección múltiple, "un disparador de historial por fila"). Se **mudaron las dos órdenes** a
`en_preparacion` (`REM-P1`/`REM-P2`) y se retargetearon los casos, de modo que **no se pierde
cobertura**. Dos `it` quedaron **duplicados exactos** tras el retarget (los dos "Generar guía" de R18 y
las dos filas del `it.each` de R29, que eran gemelos por estado): se consolidaron en uno conservando
la aserción más fuerte de cada par (`generarGuiaMock` no se llama solo por abrir el modal). El caso
`R15` de "dos secciones separadas" pasó a ser el caso **155/R32** que afirma lo contrario: que la
sección retirada **no se monta**.

### 4.4 Tests nuevos de esta fase (13 casos)

`tests/components/EstatusBadgeRetiroFulfillment.test.tsx` (nuevo, 8 casos):

- **155/R28** (4): no es clave del mapa ni del seed; ninguna etiqueta vale la etiqueta retirada; los 19
  values vigentes sí tienen etiqueta (el retiro no se llevó a nadie más); ya no lleva el acento.
- **155/R41** (4): el value retirado se pinta **crudo** con la presentación neutra **exacta** (igualdad
  de clases contra `en_preparacion`, que es `secondary` sin acento); un value cualquiera desconocido
  degrada igual; `estatusLabel` también cae al crudo; y —el caso más literal del requisito— **una fila
  de historial que referencia el value retirado no rompe la línea de tiempo**: se monta
  `HistorialOrdenTimeline` con el rastro que deja la migración (`retirado → en_preparacion`, familia
  `ajuste_estado`, sin actor, con su motivo) y se verifica que la vista se pinta y el motivo es visible.

`OrdenesListadoBloqueoCierre.test.tsx` (4 casos, dos `it.each` × 2):

- **155/R32/R41**: junto a una orden accionable, la del estado retirado/desconocido queda bloqueada con
  el motivo "no tiene acciones por lote" (el bloqueo es por fila, su vecina sigue seleccionable); y una
  página **solo** con órdenes en ese estado **no monta ni la columna de selección** — se lista la fila
  (la vista no se rompe) pero sin casillas inertes ni acciones.

`OrdenesRevisionMaestro.test.tsx` (1 caso): **155/R32** afirma las **dos** mitades del requisito por
separado — (a) sin apartado (ni región con ese nombre accesible ni la etiqueta en la vista) y (b) sin
acciones por lote ("Generar guía" queda con **un** disparador en toda la vista, y vive en el apartado
que hereda la acción).

> Nota de diseño de ese caso: la primera versión afirmaba la **lista completa y ordenada** de regiones.
> Se descartó: el `ToastProvider` monta su propia región ("Notificaciones") y la aserción acabaría
> acoplada a un contenedor ambiental que nada tiene que ver con R32.

### 4.5 T8.1 — el guard de censo extendido (R33)

`OLD_VALUES` pasa de **6 a 7** entradas. Es la **primera ampliación** del censo: la 153 había hecho un
*swap* (6 antes, 6 después). El value nuevo no es un rename: **no tiene sucesor**.

Se añaden además 2 casos que blindan la extensión:

- el censo del value retirado **no marca** a `en_preparacion` (su sucesor de facto) ni a **ningún**
  nombre de carpeta de `db/migrations` — y las carpetas se **leen del disco**, con una aserción extra
  de que la comprobación no es vacua (hay >1 carpeta que sí nombra el value). Así, el día que alguien
  cree una carpeta con otra forma, el caso lo dice en vez de callarse;
- los 7 values del censo son **disjuntos** del catálogo vigente: el censo vigila el literal, este caso
  vigila que el catálogo no lo reintroduzca por otra puerta.

**Allowlist — justificación una a una de las entradas relacionadas con este value:**

| Entrada | Por qué conserva el literal |
| --- | --- |
| `censo-order-status-rename.test.ts` | es el propio guard: contiene los patrones de búsqueda. Ya estaba. |
| `order-status-enum-migration.test.ts` | afirma los **8 literales históricos** del enum `order_status`, entre ellos el retirado. Es la foto del enum ANTES de los `ADD VALUE` posteriores y se declara **fija a propósito** (no se deriva del seed vigente), así que no puede seguir al catálogo cuando este pierde un value. Ya estaba en la allowlist por la 135; se le amplió el comentario. |
| `rename-order-status-migration.test.ts` | **entrada nueva.** Cobertura estática de la migración histórica de la feature 28, que renombró el value **predecesor**: afirma por regex el `UPDATE` del UP y el inverso del DOWN, y ambos nombran el literal. Es una migración ya aplicada: su texto es inmutable, así que el literal no se puede limpiar de aquí sin dejar de verificar esa migración. |

**Todo lo demás se limpió, no se allowlisteó**, como manda `design.md §7`.

### 4.6 Un hallazgo lateral: interacción entre dos guards

Al justificar la entrada nueva de la allowlist escribí, en comentarios, el nombre de la carpeta de la
migración histórica. Eso puso **rojo a otro guard**: `tests/unit/guards/no-embalaje.test.ts` (feature
28/R6/R7) prohíbe la palabra del value predecesor en todo el árbol salvo su propia whitelist.

**Se resolvió reescribiendo mis comentarios**, no ampliando la whitelist del otro guard: un comentario
mío no es motivo para abrir un agujero en una red ajena. Los comentarios dicen ahora "el value
predecesor" y el caso de frontera de palabra lee las carpetas reales del disco en vez de escribir una
ruta a mano.

Volvió a saltar una segunda vez, ya al **documentar el hallazgo** en `tasks.md`: ese guard recorre
también `specs/`, y de este spec **solo `design.md` está whitelisteado** (por la 153-160), no
`tasks.md`. Misma resolución: reescribir. Queda anotado porque **es una trampa doble para el próximo
que toque el censo de este value**: no solo el código, también la prosa del spec enciende el otro
guard, y su whitelist es por archivo, no por carpeta. (`progress/` sí está en sus `IGNORED_DIRS`, por
eso esta bitácora puede nombrarlo.)

---

## 5. Mapa `R<n> → test` (R1–R43, completo)

Fase **B** = frontend (esta). Fase **A** = backend; para esas filas, el detalle por caso está en
`progress/impl_155_backend.md §5` y **no se repite aquí**: se da el archivo y el marcador con el que se
encuentra. Todos los archivos y marcadores citados se verificaron por grep.

| R | Fase | Test |
| --- | --- | --- |
| R1 | A | `destino-creacion.test.ts` "…el flag es el UNICO predicado…" · `bulk-orden-service.test.ts` (una columna `estatus` en el archivo no altera nada) |
| R2 | A | `destino-creacion.test.ts` rama (a) · `orden-service.test.ts` "155/R2…" · `bulk-orden-service.test.ts` "155/R16…" |
| R3 | A | `destino-creacion.test.ts` rama (b) · `orden-repository.creacion-bifurcada.test.ts` "155/R3…" |
| R4 | A | `bulk-orden-service.test.ts` "R4/R15/R18: lee fulfillment … UNA vez por LOTE, no por fila" · `bulk-orden-service.carga-api.test.ts` "155/R4…" |
| R5 | A | `orden-service.test.ts` "155/R5…" (estatusId arbitrario ignorado + estatusId inexistente ignorado) |
| R6 | A | `destino-creacion.test.ts` (función pura; las dos ramas difieren en las TRES propiedades) |
| R7 | A | `orden-service.test.ts` "R7: catalogo sin el value de la rama resuelta -> validation_error que lo NOMBRA, sin crear" · `bulk-orden-service.test.ts` "R7/R20…" |
| R8 | A | `orden-repository.creacion-bifurcada.test.ts` "R8: usa la MISMA secuencia atomica del resto del sistema, con la guarda idempotente" (+ el caso de la segunda pasada) |
| R9 | A | `orden-service.test.ts` "R9: la creacion NUNCA asigna mensajero (en ninguna de las dos ramas)" · `orden-repository.creacion-bifurcada.test.ts` |
| R10 | A | `orden-service.test.ts` "R10: deja historial de creacion con la familia de la via (creacion_manual)" · `orden-repository.creacion-bifurcada.test.ts` "R10: la numeracion va ANTES del historial…" · `orden-repository.carga-api.test.ts` |
| R11 | A | `orden-repository.creacion-bifurcada.test.ts` describe "155/R11" (6 casos: `create`, `create` con guía, las 2 rutas de lote, cero por duplicada, no-op sin dirección) |
| R12 | A | `orden-repository.creacion-bifurcada.test.ts` describe "155/R12" (3 casos: falla historial / encolado / numeración) |
| R13 | A | `orden-service.test.ts` "R13: maestro creando PARA una tienda evalua el flag de ESA tienda, no el suyo" (+ el de admin) |
| R14 | A | `orden-service.test.ts` "R14: adminTienda con fulfillment=false -> nace en por_recolectar_en_tienda CON guia" |
| R15 | A | `orden-service.test.ts` suite `crear` preexistente (rol no autorizado, `tiendaId` obligatorio, duplicado → `conflict`) + el caso de `estatusId` inexistente |
| R16 | A | `bulk-orden-service.test.ts` describe "155/R16" (los 2 casos: flag `true` sin guía, flag `false` con guía) |
| R17 | A | `bulk-orden-service.test.ts` "R17: el dryRun de la rama (b) NO consume ninguna guia (no toca el repositorio)" + la suite de dry-run preexistente |
| R18 | A | `bulk-orden-service.test.ts` "R18: el estatus resuelto se reporta tambien en duplicadas intra-archivo, sin numerar" |
| R19 | A | `bulk-orden-service.carga-api.test.ts` describe "155/R19" (consulta el flag del dueño de la key) |
| R20 | A | idem (guía asignada y reportada por orden) + el happy path preexistente |
| R21 | A | `bulk-orden-service.carga-api.test.ts` describe "155/R21" · `orden-repository.creacion-bifurcada.test.ts` describe "155/R21" |
| R22 | A | `order-status-transiciones.guardia.test.ts` "R22: ya NO es legal que una orden NAZCA en en_ruta_bodega_central (estado fijo de la API)" · `bulk-orden-service.test.ts` describe "155/R22" |
| R23 | A | `ordenes-api-key-carga.route.test.ts` "R23: el resto del contrato de respuesta queda intacto al sumar `manifiesto`" + la suite 88/98 preexistente |
| R24 | A | `manifiesto-service.test.ts` describe "155/R24" (TIENDA → CENTRAL; flujo declarado y seleccionable) · `ordenes-api-key-carga.route.test.ts` describe "155/R24" (armado por el servicio único) |
| R25 | A | `ordenes-api-key-carga.route.test.ts` "R25: si el manifiesto LANZA, la carga NO se revierte: 200, ordenes intactas y error visible" + el caso de `forbidden` |
| R26 | A | `destino-creacion.test.ts` "R26: el lote NO emite manifiesto (no hay movimiento fisico que documentar)" · `ordenes-api-key-carga.route.test.ts` "R26: la rama (a) NO emite manifiesto…" |
| R27 | A | `order-status.test.ts` describe "155/R27" (fuera del seed; los 17 previos intactos) · `seed-order-status.test.ts` describe "155/R27" (el sembrado no lo incluye) |
| R28 | **A + B** | A: `order-status-transiciones.guardia.test.ts` describe "155/R27/R28 — BAJAS EJECUTADAS" (6 casos: grafo, aristas, exhaustividad viva). **B: `EstatusBadgeRetiroFulfillment.test.tsx` describe "155/R28"** (4 casos: los 3 mapas del chip + el acento) · `EstatusBadgeEnReparto.test.tsx` "155/R28: es el UNICO value del catalogo con el acento de marca" · `EstatusBadgeCatalogoV2.test.tsx` "…19 values, sin sobrantes" |
| R29 | A | `guia-asignacion-service.test.ts` "156/R4 — origen UNICO en_preparacion" y "156/R16" (los casos del value retirado **reemplazados** por orígenes no permitidos, no borrados) |
| R30 | A | `ordenes-config.test.ts` describe "155/R30" (3 casos, incluido el censo de `process.env` en `app/` y `lib/`) |
| R31 | A | `destino-creacion.test.ts` describe "155/R31" · `order-status-transiciones.guardia.test.ts` "R31: ESTADOS_CREACION tiene EXACTAMENTE dos values" + "R31: nacer en cualquier otro estado del catalogo es ilegal" |
| **R32** | **B** | `OrdenesRevisionMaestro.test.tsx` "155/R32: NO monta el apartado del estado de fulfillment retirado" (afirma las 2 mitades: sin apartado y sin acciones por lote) · `OrdenesListadoBloqueoCierre.test.tsx` "155/R32: …queda bloqueada con su motivo" (×2) y "155/R32: …no monta ni la columna de seleccion" (×2) |
| **R33** | **B** | `censo-order-status-rename.test.ts`: el censo de los 7 values (recorre `app/`, `lib/`, `components/`, `hooks/`, `scripts/`, `tests/`, `e2e/`) · "OLD_VALUES tiene 7 entradas…" · "155/R33: el censo del value retirado NO marca a `en_preparacion` ni a ningun nombre de carpeta de migracion" · "155/R33: los values del censo son DISJUNTOS del catalogo vigente" |
| R34 | A | `order-status-retiro-en-fulfillment-migration.test.ts` describe "155/R34" (5 casos: vivas y borradas, sin tocar guía/mensajero/prioridad, idempotencia) |
| R35 | A | idem, describe "155/R35" (5 casos: 1 fila por orden, `ajuste_estado`, sin actor, motivo literal, orden de los pasos) |
| R36 | A | idem, describe "155/R36" (2 casos) |
| R37 | A | idem, describe "155/R37" (4 casos, incluido "el propio rastro impide el borrado") |
| R38 | A | idem, describe "155/R38" (7 casos: round-trip con y sin historial, no retrocede lo que avanzó, borra solo el rastro) |
| R39 | A | idem, describe "155/R39" (2 casos) |
| R40 | A | idem, describe "155/R40" (3 casos: sin tablas de jobs/notificaciones, solo 3 tablas escritas, sin triggers) |
| **R41** | **B** | `EstatusBadgeRetiroFulfillment.test.tsx` describe "155/R41" (4 casos: chip neutro EXACTO con el value retirado, con un desconocido cualquiera, `estatusLabel` al crudo, y **la fila de historial en `HistorialOrdenTimeline` que no rompe la vista**) · `EstatusLabel.test.ts` "cae al value crudo si el estado es desconocido" · `OrdenesListadoBloqueoCierre.test.tsx` (la fila se lista sin acciones) |
| R42 | A | `openapi-contrato-en-reparto.test.ts` describe "155/R42" (5 casos: enum TS, enum del `.yaml` espejo, prosa, ejemplos) |
| R43 | A | `openapi-contrato-en-reparto.test.ts` describe "155/R43" (conteo, los 9 previos siguen, el nuevo entra) · `orden-webhook-enqueue.test.ts` describe "155/R43" |

**Ningún requisito queda sin test.** Los 3 que eran de esta fase (R32, R33, R41) están cubiertos por 13
casos nuevos; R28 quedó repartido entre las dos fases (grafo en A, presentación en B).

---

## 6. Salida real de la verificación (final)

```
$ pnpm run typecheck
> tsc --noEmit
   -> sin salida: 0 errores. (Antes de esta fase: 3.)

$ pnpm run lint
✖ 10 problems (0 errors, 10 warnings)
   -> los MISMOS 10 warnings preexistentes que ya declararon la 154, la 156 y la fase backend
      de la 155 (react-hooks/exhaustive-deps y no-unused-vars). CERO nuevos.

$ pnpm test
 Test Files  573 passed (573)
      Tests  6329 passed (6329)

$ ./init.sh
== Arnes SDD :: init ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✓ lint paso
-> pnpm run test
 Test Files  573 passed (573)
      Tests  6329 passed (6329)
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
   -> EXIT=0
```

**Trazabilidad de las cifras:** base de la rama 569 archivos / 6218 tests → fin de la fase backend
572 / 6316 (con 2 rojos) → **fin de esta fase 573 / 6329, 0 rojos**. Esta fase suma **+1 archivo** (el
de R28/R41) y **+13 tests netos** (17 casos nuevos menos los 4 que desaparecieron al consolidar
duplicados exactos y al reducir dos `it.each` que se quedaron con una sola fila).

El árbol quedó **limpio** (`git status --porcelain` vacío tras el commit), que es requisito del guard
de censo: recorre `fs.readdir`, no `git ls-files`, así que cualquier archivo sin trackear lo pondría
rojo.

---

## 7. Qué NO se verificó, y las deudas que siguen abiertas

**De esta fase:**

1. **Nada en un navegador real.** No se levantó `next dev`. Los componentes se verificaron con
   `jsdom` + Testing Library. En particular, la **igualdad de clases** con la que se afirma "chip
   neutro" (R41) valida las clases que `cn`/twMerge produce, no el color renderizado.
2. **Playwright no se ejecutó** (`pnpm run test:e2e`). Esta fase no tocó ningún `.spec.ts` de `e2e/`;
   se verificó que ya estaban limpios del literal.
3. **La UI de filtros por estado.** `design.md §10` anota el riesgo de que el catálogo se liste desde
   `order_status` y un value huérfano aparezca en el filtro sin label. R41 cubre la **degradación**
   (se mostraría el value crudo, sin romper), pero **no se comprobó** que el selector de estados no
   ofrezca una opción para una fila de catálogo que sobreviva en producción. El riesgo es cosmético y
   solo se materializa si el `DELETE` condicional queda no-op (§7.4).

**Heredadas del backend, NO saldadas por esta fase (se repiten porque siguen vivas y pesan):**

4. ~~**Nada se corrió contra Postgres real.**~~ **SALDADA el 2026-07-29 por el leader**, en
   paralelo a esta fase (de ahí que quedara escrita como viva). El round-trip
   `deploy → rollback → deploy` se ejecutó contra `localhost:5432` / base `ordenex` sobre una base
   **con 47 órdenes en `en_fulfillment`**, con conteos antes/después y checksum de la tabla `orden`.
   Cumple el *Hecho cuando* literal de T5.1 (2.ª pasada del UP = **0 filas en los 3 pasos**) y de
   T5.2 (el rollback deja la base **exactamente** como estaba: 47/3 órdenes, 108 filas de historial,
   mismo checksum). Verificado además **por mutación**: quitarle al DOWN el filtro del rastro lo pone
   en rojo. **Registro completo con números, mutaciones y limitaciones en
   `progress/roundtrip_155_migracion.md`.** Lo que sigue sin medirse está ahí, en su §«Lo que este
   round-trip NO demuestra» — en particular la rama de **base limpia** del paso 3.
5. **El `DELETE` del catálogo es no-op en cuanto se migra UNA orden** (el rastro de R35 referencia el
   value en `estatus_origen_id`). Es correcto y está testeado, pero significa que "el value
   desaparece de la tabla" **no es una promesa** de esta migración en producción.
   **Confirmado por medición el 2026-07-29:** en el round-trip real el catálogo se quedó en 21 filas
   y `en_fulfillment` **sobrevivió** al UP. Es la rama que se dará en producción.
6. **El censo de R39 sobre datos reales está sin hacer**: no se consultó producción.
7. **El wiring real del manifiesto del canal API** (`buildManifiestoService` con Prisma) no se
   ejerció; un fallo ahí saldría como `manifiesto: { error }` en producción, no como test rojo.
8. **El aviso a integradores** del cambio incompatible de estado inicial es una acción de producto y
   sigue pendiente.
9. **Deuda del enum de OpenAPI** (backend §7.4): la lista lleva desde la feature 109 sin incorporar
   values que una orden del integrador sí puede alcanzar. Fuera de alcance, sigue declarada.

**Nada de esta fase tocó `lib/`, `db/`, `app/api/` ni ninguna migración.** No se encontró ningún bug
del backend que reportar.

---

## 8. Estado de las tasks

Marcadas en `tasks.md`: **T6.1, T6.2, T8.1, T8.2, T8.3**. Cada una cumple su *Hecho cuando* literal;
las salvedades de T6.2 (los dos ficheros/constantes que ya no existían, §3.1) quedan escritas arriba y
anotadas en la propia task en vez de darse por hechas en silencio.
