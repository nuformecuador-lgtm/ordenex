# Ficha 385 — intentos y fecha de creación en la descarga DETALLADA de cierres

Rama `feat/385-columnas-intentos-y-creacion`, desde `origin/dev` @ `f29d3986`. Worktree aislado.
**Sin migración**: los dos datos ya existen en `orden`. La base no se toca.

## La decisión que había que tomar: ¿de quién son «los intentos»?

En este árbol hay **DOS contadores distintos con dueños distintos**, y el encargo («los
intentos») no nombra ninguno de los dos por sí solo:

| dato | dueño | dónde vive |
| --- | --- | --- |
| `orden.intentos_contacto` | **la TIENDA** | columna `NOT NULL DEFAULT 0`; sube con «+1 intento de contacto» de /novedades. Único escritor del árbol: `{ increment: 1 }` en `OrdenRepository`, sin decremento ni reset (verificado). |
| «intentos de entrega» | **el MENSAJERO** | NO es columna: se deriva contando `orden_historial` (`whereIntentosVigentes` / `contarIntentosVigentesEnLote`). Es el que gobierna el tope de intentos de la feature 276. |

Se implementó el **primero**, que es el que la ficha nombró, y **NO se cambió la fuente por
cuenta propia**. Lo que sí se hizo es que el encabezado no pueda leerse mal:

**`Intentos de contacto de la tienda`** (constante `INTENTOS_CONTACTO_TIENDA_COL`).

Por qué no «Intentos» ni «Intentos de contacto» a secas: cada fila de esta hoja es una
**gestión del MENSAJERO**, con su resultado y su dinero al lado. Un «Intentos» pelado en esa
vecindad se lee como los del mensajero — un número correcto contestando a otra pregunta, que
es el peor género de dato porque nadie lo mira dos veces. El precedente del repo es
`novedades/_components/ayuda-descarga-columnas.ts`, que lleva las DOS columnas juntas
(«Intentos de contacto» + «Intentos de entrega») precisamente porque se confunden; allí la
vecindad ya dice de quién es cada una, aquí la columna viaja sola y tiene que decirlo ella.

El razonamiento entero, con los dos contadores enfrentados, está **en la cabecera del módulo**
(`cierres-gestiones-fundida-descarga-columnas.ts`) y en el TSDoc del campo del DTO, no en este
archivo: es donde se mira cuando alguien vaya a «arreglarlo».

**PARA EL HUMANO, si quería el del mensajero:** es una columna MÁS (no un cambio de fuente en
ésta) y cuesta un conteo sobre `orden_historial` por descarga. Las dos tendrían que salir con
sus dos nombres completos, como en «Ayuda solicitada».

## La fecha

`Fecha de creación de la orden` (`orden.created_at`), en **día calendario de Costa Rica**.

`orden.created_at` es un `timestamp`, no un `@db.Date`, así que se serializa con
`fechaCalendarioCR` en el borde de datos — exactamente como `fechaGestion`, y **no** como
`diaReparto`, que sí puede recortarse por ISO porque es `@db.Date`. Con
`toISOString().slice(0, 10)` toda orden creada después de las 18:00 CR saldría con el día
siguiente. El test lo fija con un instante de las 03:00 UTC (= 21:00 CR del día anterior): con
una hora del mediodía las dos formas coincidirían y el caso pasaría en verde sin comprobar nada.

Dice «de la orden» porque en esta hoja hay ahora CUATRO fechas (cierre, gestión, reparto,
creación) y «Fecha de creación» a secas obligaría a adivinar de qué.

## Orden y ámbito

- La hoja pasa de **29 a 31 columnas**, ámbito `cierres-gestiones` (sin tocar).
- `fechaCreacionOrden` en **5.ª** posición, cerrando el bloque de fechas: las cuatro juntas se
  leen como la línea de tiempo que son (creación → reparto → gestión → cierre).
- `intentosContactoTienda` en **13.ª**, entre «Tienda» y «Resultado». Es dato de la ORDEN, y
  «Resultado» tiene que seguir cerrando el bloque de lo que siempre se puebla: es la celda que
  decide cuáles de las 17 siguientes traen dato.
- **Ninguna columna existente cambia de orden relativo.** Hay un test que lo compara contra la
  lista literal de las 29 de antes, no contra la constante filtrada por sí misma.
- **La hoja de RESUMEN no se toca** (7 y 8 columnas, ámbitos `cierres-pendientes` /
  `cierres-resueltos`), con test propio.

## Lectura de la orden VIVA: por qué es segura aquí

El `select` de `orden` pasa de uno a tres campos. Los tres son seguros por una razón que un
monto no tiene: **ninguno se reescribe con otro valor.** `created_at` es inmutable;
`intentos_contacto` solo sube. Una descarga vieja puede quedarse corta, nunca contradecir lo
que pasó. El dinero sigue viniendo del snapshot congelado (feature 69). Está escrito como
criterio de entrada para cualquier campo futuro, en el test que vigila el `select`.

## Archivos

**Modificados (producción):**
- `lib/interfaces/services/ICierresAdminService.ts` — `CierreGestionDescargaDTO` gana
  `fechaCreacionOrden: string` e `intentosContactoTienda: number`.
- `lib/repositories/CierresAdminRepository.ts` — `GESTION_DESCARGA_SELECT.orden` gana
  `createdAt` e `intentosContacto`; `toGestionDescargaDTO` los proyecta.
- `app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts` — las dos
  columnas, sus dos encabezados y las dos celdas.
- `app/(app)/cierres-admin/_components/DescargarCierresButton.tsx` y
  `DescargarGestionesDialog.tsx` — **solo prosa**: los comentarios que decían «29 columnas» ya
  no eran ciertos. Cero cambios de código.

`CierresBodegaAdminRepository` **no se toca**: reusa `GESTION_DESCARGA_SELECT` y
`componerGestionesDescarga`, que es lo que impide que las dos salidas diverjan (R26 de la 230).

**Modificados (tests):** `tests/unit/descarga/cierres-gestiones-fundida-descarga-columnas.test.ts`,
`tests/unit/descarga/cierres-gestiones-paridad.test.ts`,
`tests/unit/repositories/cierres-gestiones-descarga-dto.test.ts`,
`tests/unit/repositories/cierres-admin-gestiones-where.test.ts`,
`tests/components/descarga/{CierresAdminDescargaDetallada,CierresBodegaDescargaDetallada,CierresDescargaNiveles,DescargarGestionesDialog}.test.tsx`,
`tests/unit/services/{CierresAdminService,CierresBodegaAdminService}.gestiones-completo.test.ts`.

## Mapa requisito → test

La ficha es `sdd: false` (sin spec). Los requisitos se enumeran aquí a partir del encargo.

| R | qué exige | test |
| --- | --- | --- |
| R1 | la hoja de detalle lleva los intentos de la orden | `cierres-gestiones-fundida-descarga-columnas.test.ts` › «declara las 31 columnas en el orden decidido»; `cierres-gestiones-descarga-dto.test.ts` › «los intentos son los de LA TIENDA y el cero viaja como cero» |
| R2 | el encabezado dice DE QUIÉN son los intentos | `cierres-gestiones-fundida…test.ts` › «el encabezado de los intentos dice DE QUIÉN son, y no es un «Intentos» a secas» + «la hoja NO lleva los intentos de ENTREGA, que son otro dato y de otro dueño» |
| R3 | el `0` se emite, no deja la celda vacía | `cierres-gestiones-fundida…test.ts` › «los intentos salen tal cual, y el CERO se emite…»; `cierres-gestiones-descarga-dto.test.ts` › mismo caso, a grano de DTO |
| R4 | la hoja lleva la fecha de creación de la orden | `cierres-gestiones-fundida…test.ts` › «la fecha de creación es la de la ORDEN y no ninguna de las otras tres» |
| R5 | la fecha es calendario de COSTA RICA, no UTC | `cierres-gestiones-descarga-dto.test.ts` › «la fecha de creación de la orden es el día de COSTA RICA, no el del UTC» |
| R6 | la fecha sale como día `YYYY-MM-DD`, sin hora | `cierres-gestiones-fundida…test.ts` › «la fecha de creación sale como día calendario, sin hora que rompa la hoja» |
| R7 | orden declarado respetado; nada existente se mueve | `cierres-gestiones-fundida…test.ts` › «las dos nuevas van en su sitio y NINGUNA existente cambia de orden relativo» |
| R8 | las dos se pueblan SIEMPRE (no son específicas del resultado) | `cierres-gestiones-fundida…test.ts` › «las dos nuevas se pueblan SIEMPRE: no dependen del resultado de la fila» |
| R9 | la hoja de RESUMEN no se toca | `cierres-gestiones-fundida…test.ts` › «la hoja de RESUMEN no se toca: es otro nivel y otro ámbito» |
| R10 | los datos se PIDEN de verdad a la base | `cierres-admin-gestiones-where.test.ts` › «la consulta PIDE de verdad la creación y los intentos de la orden» (lee el `select` que llegó a Prisma, no la constante) |
| R11 | los dos bordes (cierres del día y bodega) emiten lo mismo | `cierres-gestiones-descarga-dto.test.ts` › «los DOS caminos producen la MISMA fila»; `CierresBodegaDescargaDetallada.test.tsx` › las dos columnas llegan por el borde de bodega, con valor |
| R12 | encabezados sin colisión | `cierres-gestiones-fundida…test.ts` › «los encabezados nuevos no se pisan con ninguno de los 29 anteriores» |

## Mutaciones (8 de 8 muertas)

Cada una se aplicó al árbol, se corrió el test y se restauró el archivo desde una copia.

| # | mutación | resultado |
| --- | --- | --- |
| 1 | `fechaCalendarioCR(g.orden.createdAt)` → `g.orden.createdAt.toISOString().slice(0,10)` | **2 rojos** (incl. «…día de COSTA RICA, no el del UTC») |
| 2 | `intentosContactoTienda: g.orden.intentosContacto` → `0` | **2 rojos** |
| 3 | quitar `intentosContacto` del `select` de `orden` | **2 rojos** (el que lee el `select` real + el censo de la proyección) |
| 4 | encabezado → `"Intentos"` | **2 rojos** (incl. el caso que exige que diga de quién son) |
| 5 | `gestion.intentosContactoTienda` → `… \|\| null` (el 0 se vuelve celda vacía) | **1 rojo** |
| 6 | `fechaCreacionOrden: gestion.fechaGestion` (leer la celda de al lado) | **4 rojos** |
| 7 | mover la columna de intentos al FINAL de la hoja | **4 rojos** |
| 8 | añadir la columna a la hoja de RESUMEN | **1 rojo** (el caso de «el resumen no se toca») |

## Verificación

`./init.sh` **completo** (el rápido se niega: la ruta casa nombres de dinero). `INIT_EXIT`
escrito DENTRO del log, en su propia línea.

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 132 archivos de tests contra Postgres SI se ejecutan
 Test Files  1771 passed (1771)
      Tests  25302 passed | 26 skipped (25328)
   Duration  894.20s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1771 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped`, mirados uno a uno:** los 26 son `AnaliticaPage.test.tsx` (17) y
`AnaliticaShell.test.tsx` (9). Preexistentes y ajenos a esta ficha. **Cero** archivos de
`tests/integration/db` saltados — se copió el `.env` de la raíz al worktree antes de correr, y
el log lo dice con el número: 132.

El aviso de `down.sql` es de tres migraciones del 2026-08-14, anteriores a esta rama. **Esta
ficha no escribe ninguna migración.**

## Veredicto

Las dos columnas entregadas, con el encabezado de los intentos diciendo que son de la TIENDA;
gate completo verde (`INIT_EXIT=0`, 25.302 tests, 0 rojos) y 8 de 8 mutaciones muertas.
