# Ficha 377 — informe de implementación (BACKEND)

## ⭑ ESTADO FINAL — 2026-09-07, escrito por el LEADER

> **Todo lo que viene después de esta sección se escribió a mitad de camino**, cuando el backend
> había terminado y faltaban T7 y T9. Donde diga «T7 pendiente», «R8 a medias» o «T9 no se pudo
> hacer», **está caducado**. Se conserva sin editar porque es el rastro honesto de cómo se cerró
> la ficha, no porque siga siendo cierto.

**La ficha está COMPLETA.** Las dos mitades que faltaban se cerraron el mismo día:

### T7 — hecha (commit `f8d33d3a`)
El toast de guardar zona dice ahora las dos cifras. **R8 y R11 dejan de estar a medias: la
pantalla ya no calla.** Textos finales, con el cero callado (`> 0`, no `>= 0`) y sin jerga
—ni «retenidas», ni «custodia», ni «sin dueño»—:

| reconciliadas / retenidas | toast |
| --- | --- |
| 12 / 3 | `Zona actualizada (12 órdenes reubicadas). 3 órdenes no cambiaron de zona porque su paquete ya está en una bodega.` |
| 0 / 3 | `Zona actualizada. 3 órdenes no cambiaron de zona porque su paquete ya está en una bodega.` |
| 1 / 1 | `Zona actualizada (1 orden reubicada). 1 orden no cambió de zona porque su paquete ya está en una bodega.` |
| 12 / 0 | `Zona actualizada (12 órdenes reubicadas)` — **literal, como antes de la ficha** |
| 0 / 0 | `Zona actualizada` — **literal** |

Cubierto por `tests/components/CrearZonaFormReconciliacion.test.tsx`, describe «Toast de guardar
zona — órdenes que se quedaron en su bodega (377/T7)». Los 4 casos de la 366 quedan intactos.
Once casos en el archivo, seis mutaciones aplicadas y revertidas.

**Hallazgo honesto del implementador, que se conserva:** el caso de R13 **no** cae con una
mutación de un solo punto —la rama de crear nunca asigna el campo *y además* `mensajeGuardado`
corta en `esEditar`—, así que mide la combinación, no cada mitad.

### T9 — hecha por el LEADER, y es LUZ VERDE
La re-medición que el implementador no pudo hacer (no tiene acceso a la base). **Medido contra
producción en solo lectura el 2026-09-07:**

| | valor |
| --- | --- |
| Órdenes `en_bodega_satelite` | **37** (la cifra vieja de 47 está caducada) |
| Órdenes `en_ruta_bodega_satelite` | **215** |
| Órdenes desalineadas (total) | **0** |
| **Órdenes desalineadas EN EL ESTANTE** | **0** |

**Por qué importaba y por qué es un go:** este cambio **congela, no repara**. Si hubiera habido
alguna orden ya en el estante con la zona vieja estampada, excluirla de la reconciliación la
dejaría así para siempre. No hay ninguna.

### Gate final
`./init.sh` completo, **`INIT_EXIT=0` leído de dentro del log**: 1770/1770 archivos,
**25 295 tests**, 26 `skipped` preexistentes y ajenos (17 de `AnaliticaPage` + 9 de
`AnaliticaShell`), cero saltados en `integration/db` y los 132 archivos contra Postgres
ejecutados. Los +7 tests exactos sobre la medida del backend son los de T7.


> `CHECKPOINTS.md > Trazabilidad` exige este archivo con el mapa `R<n> → test`. La tabla completa
> vive además en `specs/377-bodega-satelite-sin-dueno/tasks.md`; aquí está consolidada junto a lo
> que se midió, lo que se decidió y lo que queda vivo.

**Rama:** `fix/377-bodega-satelite-sin-dueno` (desde `origin/dev` en `13456760`, con la 376 ya
mergeada) · **Zona:** fullstack, **entrega de backend** · **Fecha:** 2026-09-07

## Qué arregla, en una línea

La reconciliación de zona de la 366 (`ZonaRepository.update`) no filtraba por estado, así que una
orden **ya en el estante** de una bodega satélite podía cambiar de zona: desaparecía del listado de
la bodega que tiene el paquete, esa bodega ya no podía asignarla (`zona_ajena`), la otra la veía sin
tenerla, y desde `en_bodega_satelite` **no hay ninguna transición de salida** hacia otra bodega.

**La distinción, que es la ficha entera:** en tránsito (`en_ruta_bodega_satelite`) el paquete lo
tiene la central y reconciliar es correcto —desbloquea la recepción: 41 de 42 órdenes represadas el
2026-09-03—, y eso **se conserva intacto**. En el estante, no.

## Archivos

**Producción**

- `lib/utils/estados-bodega-satelite.ts` — constante `ESTADOS_PAQUETE_EN_ESTANTE` + predicado
  `paqueteEnEstanteSatelite()`. Las tres tuplas que ya existían quedan literalmente iguales.
- `lib/repositories/ZonaRepository.ts` — `whereBaseElegible()` (refactor puro del `WHERE` de la
  366) + el corte `estatus.value notIn ESTANTE` en el `findMany` + el `count` complementario.
- `lib/interfaces/repositories/IZonaRepository.ts`, `lib/interfaces/services/IZonaService.ts`,
  `lib/services/ZonaService.ts`, `lib/types/zona.ts` — el campo
  `ordenesRetenidasEnBodegaSatelite` fluye hasta la Server Action (que ya reenviaba tal cual y no
  cambió).
- `lib/services/CorregirDatosClienteService.ts` — **Q3**, la segunda puerta.

**Tests**

- `tests/integration/db/zona-reconciliacion-ordenes.test.ts` — el fixture aprende a variar el
  estado (T2) + 11 casos nuevos (T5).
- `tests/unit/repositories/zona-repository.test.ts` — 5 casos de orquestación (T4).
- `tests/unit/services/zona-service.test.ts`, `tests/integration/actions/zonas-action.test.ts` — el
  campo nuevo, con números distintos entre sí (T6).
- `tests/unit/services/corregir-datos-cliente-bodega-satelite.test.ts` (nuevo) — 7 casos (T10/Q3).

**Sin migración, sin columnas, sin RLS, sin índices, sin una arista nueva en `TRANSICIONES`.**

## El hueco de verificación que esta ficha cierra

`tests/integration/db/zona-reconciliacion-ordenes.test.ts` creaba **las 17 órdenes con el mismo
`FKS.estatusId`** —un `findFirst` sin `orderBy`, arbitrario y no determinista—: el eje del estado
nunca se variaba, y por eso este defecto entró en `dev` con la suite en verde. Ahora `crearOrden`
acepta `estatusValue` y lo resuelve con `findUniqueOrThrow` (revienta con nombre y apellido si el
catálogo no está sembrado; nunca un `if (!x) return;` que reporte `passed`). Los 17 casos previos
**no cambiaron ni un `expect`**.

## Cómo se verificó

- **`./init.sh --rapido` se negó**, como estaba previsto: `lib/types/zona.ts` casa
  `RUTAS_SENSIBLES`. `INIT_EXIT=1` leído de dentro de `/tmp/gate-377-rapido.log`.
- **`./init.sh` completo, verde.** `INIT_EXIT=0` **leído de dentro** del log
  (`/tmp/gate-377-completo.log`, línea 11718), no del código de salida del shell.
  **1770/1770 archivos, 25 288 tests, 26 `skipped`.** Los 26 están contados uno a uno: 17 en
  `AnaliticaPage.test.tsx` y 9 en `AnaliticaShell.test.tsx`, preexistentes y ajenos. El log dice
  «DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan»: **cero
  saltados en `integration/db`**.
- **Siete mutaciones aplicadas a mano y revertidas**, con los conteos medidos:

  | Mutación | Rojos | Casos que se caen |
  | --- | --- | --- |
  | quitar `estatus.value notIn ESTANTE` del `findMany` | 6 | «en el estante NO se mueve», «la bodega que TIENE el paquete lo sigue viendo» |
  | `notIn` → `in` en ese `findMany` | 24 | los 11 de la 366 **y** 8 de la 377: el corte no se puede invertir a costa de la 366 |
  | quitar `estatus.value in ESTANTE` del `count` | 8 | «sin nada en el estante, 0», «los dos conteos son DISJUNTOS» |
  | `ESTADOS_CUSTODIA_SATELITE` en vez de `ESTADOS_PAQUETE_EN_ESTANTE` | 3 | «en tránsito SÍ se reconcilia» — la confusión que el docstring avisa |
  | quitar `cierreDetalles: { none: {} }` de `whereBaseElegible` | 3 | el «YA FACTURADA» de la 366: el refactor no dejó ningún corte sin vigilar |
  | apagar el `if` del gate de Q3 | 3 | los tres casos de R15 |
  | quitar la comparación de zona del gate de Q3 | 1 | «corregir el distrito DENTRO de la misma zona sigue permitido» (R16) |

  **Un hallazgo honesto:** «el conteo cuenta lo que dice contar» (R9) **NO** se cae al quitar la
  cláusula de estado del `count`, y es correcto: sus cuatro órdenes están todas en el estante, así
  que el `where` base ya deja 1 con o sin la cláusula. Ese caso mide el `where` BASE, no la
  cláusula. Quien lo cubre son R10 y R7. Está escrito así en el docstring del archivo, para que
  nadie lo lea como una garantía que no da.

## Decisiones — ⚠️ NINGUNA FIRMADA POR EL HUMANO

Las tres son **del leader**, tomadas al mandar implementar el 2026-09-07, y así están escritas
también en `specs/377-bodega-satelite-sin-dueno/requirements.md`.

- **Q2 = SÍ se informa** el conteo de retenidas (R8-R11). **Diverge del precedente de la 366**, que
  dijo que no a un segundo conteo. Motivo: dejar órdenes con la zona vieja a propósito y no decirlo
  es la familia de fallo mudo que ya costó cinco fichas aquí. Vuelta atrás: quitar el campo.
- **Q3 = se cierra DENTRO de esta ficha**, prohibiendo *solo* lo que hace daño: la corrección manual
  que **cambiaría la zona** de una orden en el estante (R15). No se metió `en_bodega_satelite` en
  `ESTADOS_SIN_CORRECCION` —habría bloqueado también nombre, teléfono, producto, notas, peso y
  dirección de las órdenes que hoy están en estante— y no se eligió «solo avisar»: el aviso que ya
  existe habla de **importes**, y si quien corrige confirma, la orden queda igual de inalcanzable y
  ahora con una firma encima. Vuelta atrás: un `if`.
  ⚠️ Esto **deroga a propósito** el «`CorregirDatosClienteService` — ni una línea» del `design.md`
  §7/§10.
- **Q1 sigue ABIERTA y es del humano.** No se decidió ni se implementó nada que la presuponga.
- **Q4 fuera**: `DeshacerAsignacionService` no se tocó.

## Lo que NO se hizo, y por qué

- **T7 (el mensaje del toast) — fuera del alcance del backend_dev.** Vive en
  `app/(app)/configuracion/tarifas/_components/CrearZonaForm.tsx`, que es UI. El número **ya llega**
  hasta la Server Action y hay un test que lo mide; falta pintarlo.
  **Consecuencia viva: sin T7, R8 está a medias — el servidor informa y la pantalla todavía calla**,
  que es justo el fallo mudo que Q2 quería cerrar. R11 (no bloquear, no pedir confirmación) está
  probado en el servidor; su mitad de pantalla también es T7.
- **T9 (re-medición en producción) — no se pudo hacer desde aquí:** este agente no tiene el MCP de
  Supabase en su conjunto de herramientas. Es **previa al despliegue**, no a la implementación. La
  cifra del `design.md` (47 en estante / 215 en tránsito / **0 con deriva**, 2026-09-07) queda
  **CADUCADA**: hay que re-medirla antes de la release, y **si la deriva ya no es 0, parar** — este
  cambio congela esas órdenes como están en vez de repararlas.

## Mapa R → test

`db/zona` = `tests/integration/db/zona-reconciliacion-ordenes.test.ts` (Postgres real);
`unit/repo` = `tests/unit/repositories/zona-repository.test.ts`; `unit/svc` =
`tests/unit/services/zona-service.test.ts`; `action` =
`tests/integration/actions/zonas-action.test.ts`; `unit/q3` =
`tests/unit/services/corregir-datos-cliente-bodega-satelite.test.ts`.

| R | Test |
| --- | --- |
| R1 | `db/zona` «⭑ 377/R1: la bodega que TIENE el paquete lo sigue viendo en su listado, y la otra no» — ejercita el SQL REAL de `condicionesSatelite` (`findRecepcionSatelitePaginada`) en las dos zonas |
| R2 | `db/zona` «⭑ 377/R2/R6: una orden EN EL ESTANTE …» |
| R3 | `db/zona` «⭑ 377/R3: una orden EN TRANSITO … SI se reconcilia» |
| R4 | `db/zona` «⭑ 377/R4: cuenta el estado ACTUAL, no el historico» |
| R5 | `db/zona` «⭑ 377/R5: el corte viejo sigue vivo bajo el nuevo» + los 17 casos de la 366 |
| R6 | `db/zona` «⭑ 377/R2/R6 …» (cero filas de historial) + `unit/repo` «⭑ R8: el conteo se hace TAMBIEN cuando no hay nada que mover» |
| R7 | `db/zona` «⭑ 377/R7: los dos conteos son DISJUNTOS» + `unit/repo` «⭑ R7 … ACUMULA por grupo» + `unit/svc` «⭑ 377/R7/R8» |
| R8 | `db/zona` «⭑ 377/R7 …» + `action` «⭑ 366/R12 + 377/R8 … LOS DOS conteos». **Mitad de pantalla: T7, pendiente** |
| R9 | `db/zona` «⭑ 377/R9 … EXACTAMENTE lo que dice contar» + `unit/repo` «⭑ R2/R9: las dos consultas comparten el `where` base» |
| R10 | `db/zona` «⭑ 377/R10 …» + `unit/svc` «⭑ 377/R10 … CERO (no lo omite)» |
| R11 | `db/zona` «⭑ 377/R2/R6 …»: devuelve `ok` y guarda con retenidas > 0; no hay rama que bloquee. **Mitad de pantalla: T7, pendiente** |
| R12 | `db/zona` «⭑ 377/R12: repetir el guardado informa las MISMAS retenidas y 0 reconciliadas» |
| R13 | `db/zona` «⭑ 377/R13: `create()` ni reconcilia ni retiene» + `unit/repo` «⭑ R13 …» |
| R14 | `tests/unit/utils/estados-bodega-satelite.test.ts` y el inventario de transiciones, verdes **sin aparecer en el diff** |
| R15 | `unit/q3` «⭑ rechaza y NO escribe, aunque venga CONFIRMADA», «⭑ el rechazo GANA al aviso de importes», «el motivo nombra la BODEGA» |
| R16 | `unit/q3` «⭑ … DENTRO de la misma zona sigue permitido», «⭑ … el nombre o el telefono sigue permitido» |

**T8 comprobado:** ninguno de los cuatro archivos que el `design.md` §7 declara intocables
(`estados-bodega-satelite.test.ts`, `zona-reconciliacion-no-retarifa.guardia.test.ts`, el inventario
de transiciones, `deshacer-asignacion-zona-satelite.int.test.ts`) aparece en el diff de la rama, y
los cuatro están verdes en el gate.

## Salida de las herramientas

```
pnpm run typecheck   -> tsc --noEmit, sin una línea de salida (limpio)
pnpm run lint        -> 157 problems (0 errors, 157 warnings) — todas preexistentes.
                        En mis archivos: 'normalizeName' sin usar en ZonaRepository (ya estaba) y
                        tres `_param` en el test de Q3 (copia literal del patrón del archivo
                        hermano `corregir-datos-cliente-geo-retirada.test.ts`).
./init.sh --rapido   -> INIT_EXIT=1  «esto exige el gate completo» (lib/types/zona.ts)
./init.sh            -> INIT_EXIT=0  · 1770 archivos · 25 288 tests · 26 skipped (ajenos)
```

## Veredicto

Backend completo y medido contra Postgres real, con las dos puertas cerradas y el gate completo en
verde; **queda pendiente T7 (la frase del toast, UI) —sin ella R8 informa por dentro y calla por
fuera— y T9, la re-medición en producción antes de desplegar.**
