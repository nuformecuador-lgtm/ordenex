# El lote vacío deja de ser un éxito — cerrado en el schema

**Fecha:** 2026-08-05 · **Rama:** `chore/guardia-acciones-huerfanas`

## El hueco

El PR #299 descubrió en «Asignar mensajero» que `asignarBodegaSchema.ordenIds` era
`z.array(z.string().min(1))` **sin cota inferior en el array**, y que
`GuiaAsignacionService.asignarDesdeBodega` arranca con
`if (ordenIds.length === 0) return { status: "ok", resultados: [] }`. Con las dos
piezas juntas, `{ ordenIds: [] }` cruzaba el borde y volvía como `ok` con 0
resultados: la UI cantaba **«Mensajero asignado a 0 orden(es)»** — un falso éxito
por una acción que no hizo nada. El #299 lo tapó **en la UI** (aviso +
`confirmDisabled`) y dejó el schema abierto.

`lib/types/orden-guia.ts` tenía **tres** schemas con ese mismo patrón, no uno.
Aquí se cierra en la raíz.

## Schemas cerrados (3, todos en `lib/types/orden-guia.ts`)

| Schema | Acción | Servicio que trataba el vacío como éxito | Estado previo de la UI |
|---|---|---|---|
| `rutearSateliteSchema` | `rutearABodegaSatelite` | `GuiaAsignacionService.ts:556` | `RutearSateliteModal` lanzaba un `validation_error` propio antes de llamar — el hueco no era alcanzable, pero estaba |
| `asignarBodegaSchema` | `asignarDesdeBodega` | `GuiaAsignacionService.ts:278` | tapado en la UI por el PR #299; el schema seguía abierto |
| `generarGuiaSchema` | `generarGuia` | `GuiaAsignacionService.ts:202` | **sin guarda ninguna**: `GenerarGuiaModal:89` llama con lo que le den y hubiera cantado «Guía generada para 0 orden(es)» |

Los tres pasan a `z.array(z.string().min(1)).min(1)`.

**Sobre el tercero (`generarGuiaSchema`), que no venía en el encargo:** es el mismo
patrón, el mismo falso éxito y —al revés de lo que sugería su nombre de «caso
menor»— el **único de los tres sin guarda alguna en la UI**. El criterio del
encargo («ciérralos si son de lote y su servicio trata el vacío como éxito») le
aplica de lleno. Lo único que lo protegía era `OrdenesListado.accionesPara`, que
devuelve `[]` con selección vacía; eso es una casualidad del padre, no un
contrato. Además el test de componente que existía —*«un lote vacío se confirma
igual con `ordenIds: []` (el borde decide, no la UI)»*— argumenta **a favor**:
el borde decide, y ahora decide que no. Ese test mockea la action, así que sigue
verde sin tocarlo.

**Sobre el formato:** `.min(1)` **sin mensaje propio**, que es como lo declaran
todas las demás acciones de lote del repo (`recogerSchema`, `recibirLoteSchema`,
`etiquetaGuiaSchema`, `asignarRecoleccionSchema`, `deshacerAsignacionSchema`,
`manifiestoSchema`…). Ninguna pone mensaje en el `.min(1)` del array, y con
motivo: la UI traduce `validation_error` a un literal fijo en
`guia-decision-error-messages.ts`, así que el texto de zod no llega nunca al
usuario. El porqué va en un comentario sobre el schema, patrón de
`recepcion-satelite.ts:89`.

## Schemas que se dejan abiertos, y por qué

Barrido de `lib/types/**` + `lib/actions/**` buscando arrays sin cota. Los que
quedan aceptando lista vacía **no son lotes de acción**:

| Schema | Por qué se queda abierto |
|---|---|
| `cierres-admin.ts:83` `indemnizaciones: z.array(...).default([])` | no es el objetivo de la acción, es un detalle opcional: un cierre sin indemnizaciones es el caso normal |
| `zona.ts:31` `tarifas: z.array(...).default([])` | una zona se crea legítimamente sin tarifas |
| `zona.ts:107` `include: z.array(z.enum(["tarifas"])).optional()` | lista de expansiones de una lectura; vacía = no expandas nada |
| `recepcion-satelite.ts:55-57` `estados` / `cantones` / `distritos` | filtros de un listado; vacío = sin filtrar. Cerrarlos rompería la consulta sin filtros |
| `whatsapp-webhook.ts` `entry` / `changes` / `messages` / `statuses` | payload ENTRANTE de Meta. Meta manda `entry` sin `messages` de forma rutinaria; rechazarlo sería devolverle un 4xx a un webhook legítimo |

Sin novedad en `lib/actions/**`: el único array inline
(`deshacer-asignacion.ts:29`) ya traía `.min(1)`.

## El `if (length === 0)` del servicio: se queda

Con el schema cerrado, los tres `if (ordenIds.length === 0) return { status:
"ok", resultados: [] }` quedan **inalcanzables desde la action**. **No se
borran**: siguen siendo defensa en profundidad para quien llame al service
directamente (otros services, tests unitarios), y de hecho
`tests/unit/services/guia-asignacion-service.test.ts` los ejerce por esa vía.
Cada uno lleva ahora un comentario de dos líneas diciendo que el borde ya lo
impide y por qué se conserva igualmente.

## Tests

`tests/integration/actions/ordenes-guia-action.test.ts` — donde ya viven los
casos de borde de estas tres actions. Un caso por schema cerrado, con el patrón
del repo (service falso + espía en cero):

| Schema cerrado | Test |
|---|---|
| `generarGuiaSchema` | *«lote vacio -> validation_error en el borde, sin tocar el service › generarGuia»* |
| `asignarBodegaSchema` | *«… › asignarDesdeBodega»* |
| `rutearSateliteSchema` | *«… › rutearABodegaSatelite»* |

Cada uno afirma las tres cosas: `status === "validation_error"`,
`fieldErrors.ordenIds` presente, y `service.<metodo>` **no llamado** — que es lo
que distingue «lo para el borde» de «lo absorbe el service y devuelve ok».

El caso viejo *«ordenIds vacio es valido (lote vacio); un id vacio no lo es»*
afirmaba justo lo contrario para `generarGuia`. Se partió: la mitad que sigue
siendo cierta (*«un id vacio dentro del lote -> validation_error»*) se conserva
con su espía añadido; la mitad que describía el hueco se sustituye por el caso
nuevo.

## Verificación por mutación

Quitando el `.min(1)` **del array** en los tres schemas (`z.array(z.string()
.min(1)).min(1)` → `z.array(z.string().min(1))`, 3 ocurrencias):

```
 × generarGuia 5ms
 × asignarDesdeBodega 1ms
 × rutearABodegaSatelite 1ms
AssertionError: expected 'ok' to be 'validation_error'   (x3)
 Tests  3 failed | 32 passed (35)
```

**ROJO, uno por schema, y solo esos tres.** Restaurado y verificado por hash:
`git hash-object lib/types/orden-guia.ts` → `ebd723b3df110ebfa3a615be45e36d50dacd427b`
antes y después de la mutación.

## Gates

| Gate | Salida |
|---|---|
| `pnpm exec vitest run tests/integration/actions/ordenes-guia-action.test.ts` | `Test Files 1 passed (1) · Tests 35 passed (35)` |
| `pnpm exec vitest related --run lib/types/orden-guia.ts lib/services/GuiaAsignacionService.ts` | `Test Files 21 passed (21) · Tests 329 passed (329)` |
| `pnpm exec vitest run` de los 4 consumidores de UI/servicio (`GenerarGuiaModal`, `AsignarBodegaModal`, `RutearSateliteModal`, `guia-asignacion-service`) | `Test Files 4 passed (4) · Tests 105 passed (105)` |
| `pnpm run typecheck` | limpio, sin salida |
| `pnpm exec eslint <los 3 archivos>` | limpio, exit 0 |

`./init.sh` **no** se corrió (fuera del encargo; queda para el cierre del PR).

## Veredicto

Los tres lotes vacíos de `orden-guia` mueren ahora en el borde con
`validation_error` sin tocar el servicio, verificado por mutación; el resto de
arrays sin cota del repo son filtros y payloads entrantes, y se quedan como están.
