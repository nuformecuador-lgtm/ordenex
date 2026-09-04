# Ficha 370 — informe de implementación

**Rama:** `fix/370-separar-nuevas-de-reintentos` · **Zona:** fullstack (backend → frontend,
secuenciado) · **Plan aprobado:** `C:/Users/ArqDev/.claude/plans/tengo-un-problema-que-logical-moore.md`

## Qué resuelve

Quien hace las asignaciones no podía **separar** lo que espera en bodega: las órdenes que ya salieron
con un mensajero y volvieron, y las que solo tienen la guía generada, **llegan al mismo estado**.
Nueve arcos distintos desembocan en `en_bodega_central` (`lib/types/order-status-transiciones.ts`):
unos desde `en_preparacion` por generación de guía, otros desde `reprogramada`, `devuelta` o
`sin_gestionar`. El estado, por diseño, no lleva la historia — la lleva `orden_historial_estado`, que
nadie consultaba desde la pantalla de asignación.

**La mitad ya existía y no se tocó:** la columna «Intentos» (`ordenes-columns.tsx:110-116`) y el badge
«Prioritaria» ya dejaban *ver* la diferencia fila a fila. Lo que faltaba era **partir el listado** para
poder asignar por lote.

## El criterio: elegido midiendo, no razonando

**«Existe una transición histórica a `en_reparto`».** Append-only e inmutable: no se puede apagar.

Se compararon tres señales candidatas contra producción (2026-09-03) y **divergen**:

| ¿salió a `en_reparto`? | ¿tiene gestión no anulada? | órdenes |
|---|---|---|
| no | no | 324 |
| **sí** | **no** | **76** |
| sí | sí | 606 |

Esas **76** salieron, nadie las gestionó y el cron las cortó a `sin_gestionar`. Ya tuvieron proceso,
así que el criterio intuitivo («¿tiene gestión?») clasificaría mal un **11%**, y justo las órdenes
problemáticas.

Descartadas con números, no por gusto:

- **`orden.prioridad`** — parecía perfecta en la foto del día (21 de 21 en la central), pero sobre
  toda la historia solo se enciende en **23 de las 606** con gestión (4%), y `deshacerAsignacionLote`
  la devuelve a bodega sin restaurarla.
- **`intentosEntrega`** — declarada **no filtrable server-side** (`lib/types/orden.ts:424-425`), ancla
  en cierre **aprobado** y no cuenta `sin_gestionar` (agujero declarado en
  `lib/types/orden-historial.ts:210-214`).
- `intentos_contacto` (lo pulsa la tienda), `asignado_at` y `fecha_reparto` (**siempre NULL** en
  bodega), `liberada_reprogramada_at` (1 de 4 caminos).

**Riesgo comprobado antes de construir:** si una orden hubiera salido físicamente sin que se
escribiera su fila `→ en_reparto`, quedaría como «nueva» y **no hay estado actual que la rescate**.
Medido: **0 órdenes** con gestión no anulada y sin esa fila. La evidencia append-only está completa.

## Decisiones del humano

1. Aplica a **las dos bodegas** (en satélite viven 44 de las 48 órdenes nuevas; en la central, 2 de 21).
2. Una orden asignada cuya asignación se deshizo **antes de salir** cuenta como **nueva**.
3. El control es un **filtro propio**, no una ampliación de `reasignables`.

## Desviación deliberada del plan aprobado: las etiquetas

El plan decía «Intentos previos». **Se cambió a «Salida a reparto»** («Todas» / «Ya salió» / «Nunca
ha salido»), y ninguna etiqueta dice «intento».

**Motivo:** la columna «Intentos» está en esa misma tabla y cuenta otra cosa. Las 76 órdenes tienen
`Intentos = 0` **y sí salieron**. Con el nombre del plan, la fila habría dicho `0` y el filtro que sí:
una contradicción aparente sin forma de saber a cuál creer. El plan preveía «explicarlo en la ayuda
del filtro»; renombrar ataca la causa en vez del síntoma. Hay un test que se pone rojo si alguien
vuelve a poner «intento» en una etiqueta.

## El contrato

| | |
|---|---|
| Clave pública | `salio_a_reparto` |
| Valores | `ya_salio` / `nunca_salio` |
| Fuente única | `SALIO_A_REPARTO_VALORES` (`lib/types/orden.ts:175`) |
| Clave del `where` | `salioAReparto?: "ya" \| "nunca"` |
| Ausencia de la clave | no filtra: salen los dos grupos |

El valor viaja **escalar**, no como lista (el borde lo declara `z.enum`, y una lista sería
`validation_error`). El centinela **«Todas» es de la UI y no del contrato**: se traduce a *omitir la
clave*, porque «no filtrar» solo se expresa sin ella. La lista blanca del cliente sale de **la misma
constante** que valida el servidor, así que no hay un segundo dominio que pueda quedarse atrás.

## Archivos

**Backend** (`91024147`, `0b88110e`)
- `lib/types/orden.ts:175` (dominio cerrado), `:232` (campo zod dentro de `.strict()`)
- `lib/utils/filtros-listado-ordenes.ts:119` — `salidaAReparto()`, la traducción compartida
- `lib/interfaces/repositories/IOrdenRepository.ts:253`, `:308`, `:890`
- `lib/repositories/OrdenRepository.ts:1109` `criterioSalidaAReparto` (Prisma) y `:1118`
  `condicionSalidaAReparto` (SQL crudo); aplicados en `:1477` (`list()`) y `:1184`
  (`condicionesSatelite`, que lo lleva a las **tres** consultas del satélite)
- `lib/services/OrdenService.ts:229`, `lib/services/RecepcionSateliteService.ts:122`

**Frontend** (`979c25a7`, `cd9eca0e`)
- `app/(app)/ordenes/_components/ordenes-filtros-def.ts` — clave, centinela, etiquetas y el
  `FilterDef` (`kind: "single"`), insertado entre `reasignables` y `eliminados`; opt-in por defecto
  `false`
- `app/(app)/ordenes/_components/seleccion-a-filter.ts:65-81` — la rama escalar con lista blanca
- `app/(app)/ordenes/page.tsx:139,170` — puerta de rol (el `adminTienda` no despacha)
- `app/(app)/ordenes/_components/OrdenesListado.tsx:220,285,819,843` — prop y **dep del `useMemo`**
- `app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros.ts:152,198`

**Sin migración.** El `EXISTS` corre sobre `@@index([ordenId, estatusDestinoId])`, que ya existía.

## Cómo se decidió que las dos rutas no pueden divergir

La central consulta con la API de modelo de Prisma (su `where` es un objeto) y el satélite con
`$queryRaw` (se lo exige su `ORDER BY` por rango de grupo). Ninguna admite a la otra sin escribir un
traductor entero de `where` a SQL, así que **hay dos emisores**. Como «están escritos al lado» no es
una garantía ejecutable, la garantía es **un test que corre los DOS dialectos sobre las MISMAS filas y
exige el mismo conjunto**. Si un día divergen, ese test cae.

## Verificación

- **Gate completo `./init.sh`: `INIT_EXIT=0`** — 1699 archivos, 24.181 tests, **26 saltados** y
  localizados (`AnaliticaPage` 17 + `AnaliticaShell` 9), preexistentes. **Ninguna suite de integración
  se saltó**: el `.env` estaba presente, y `salida-a-reparto-sql-real.test.ts` aparece **ejecutado y
  verde dentro del log del gate**. (Se comprueba el número de `skipped`, no solo el `INIT_EXIT`:
  un gate sin `.env` salta las suites de base y canta verde igual.)
- El rápido **se niega** en esta rama y con razón: el diff toca `lib/types/`.
- **Mutaciones — ninguna sobrevivió.** 6 en la tanda de backend, 8 en la de frontend, y **13 más
  aplicadas de forma independiente por el reviewer** sobre el árbol real, restaurando tras cada una:

  | Mutación | Qué cayó |
  |---|---|
  | `none` → `every` | las órdenes con cero historial se colaban en «ya salió» |
  | invertir el sentido (cada dialecto por separado) | los dos grupos complementarios |
  | cambiar el estado destino **solo en Prisma** | el test de equivalencia de dialectos |
  | anclar en «tiene gestión» en vez del historial | ⭐ el caso `sin_gestionar` (las 76) |
  | anclar en `orden.prioridad` | los casos que la desmienten |
  | quitarlo de `listarCompleto` | «la descarga dice lo mismo que la pantalla» |
  | quitarlo del satélite | los casos de satélite |
  | quitarlo de la **vigencia de la selección** | sobre qué filas se puede ACTUAR |
  | etiqueta con «intento» | la guardia del vocabulario |
  | valor como lista en vez de escalar | el borde |
  | dejar viajar el centinela «Todas» | «no filtrar es omitir la clave» |
  | control encendido por defecto | «no se declara si no se pide» |
  | quitar la dep del `useMemo` | el caso de rerender |

- **Comprobación en pantalla, con números**: central → «Ya salió» **19**, «Nunca ha salido» **2**;
  satélite → **4** y **44**.

## Riesgos y lo que NO entra

- **El filtro y la columna discrepan a propósito** en las 76: «Ya salió» con «Intentos» a `0`. El
  renombrado hace que se lean como dos datos distintos y no como una contradicción. **Residuo
  aceptado:** el plan pedía además un texto de ayuda en el filtro, y hoy `FilterDef` no tiene campo
  para tooltip; añadirlo sería tocar el componente compartido, fuera del alcance de esta ficha.
- **La puerta de rol de `page.tsx:139` no la cubre ningún test** — hueco **preexistente e idéntico** al
  de «Reasignables», no introducido aquí. Queda declarado, no tapado.
- No se toca `reasignables`, ni la columna «Intentos» ni su regla de conteo. Cerrar el agujero de
  `sin_gestionar` en ese contador sigue siendo ficha aparte, ya declarada abierta en el repo.
- Ni columna, ni badge, ni resalte nuevos. Ninguna migración.
