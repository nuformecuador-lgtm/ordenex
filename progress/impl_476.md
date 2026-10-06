# impl 476 — Informe de picking por WhatsApp (BACKEND, F0–F4)

- Rama: `feature/476-informe-picking-whatsapp`, nacida de `origin/dev` = `8ca0314e` (contiene la 474 y la
  475; `git merge-base --is-ancestor 8ca0314e HEAD` → OK).
- Sin migraciones, sin `db/schema.prisma`, sin `lib/types/` (el DTO va en `picking/tipos.ts`, como la 475).
- Grafo `codebase-memory`: usado para localizar (handlers del motor); el contrato se leyó en los archivos
  reales (`tipos.ts`, `catalogo.ts`, `EjecucionEnvioService.ts`, `ParametrosInforme.tsx`).
- T0.2: la 475 añadió `DescriptorPanel`/`PanelParametros` pero NO la rama `error` de `ResultadoInforme`
  ni el catálogo `tiendas_fulfillment` → hago aquí §3.1 (rama `error`) y sustituyo §3.2 por el panel
  `picking` (ver Desvíos).

## Archivos

Nuevos
- `lib/whatsapp-envios/informes/picking/tipos.ts` — SOLO tipos (apto para cliente): `FilaPicking`,
  `EntradaPorTienda`, `TiendaPicking`, `TiendaFulfillment`, `TiendaPickingDTO`, `ListarTiendasPickingResult`.
- `lib/whatsapp-envios/informes/picking/parametros.ts` — `parametrosPickingSchema` (strict: `tiendaId`
  `string.trim().min(1)`, `diasAtraso` entero 1..30 default 2), `diasAtrasoSchema`, `MENSAJES_PICKING`,
  `PARAMETROS_PICKING_POR_DEFECTO` (`{ tiendaId: "", diasAtraso: 2 }`), límites.
- `lib/whatsapp-envios/informes/picking/modelo.ts` — PURO: `construirModeloPicking`, `contarPorTienda`,
  `diasEnPreparacion`, `estaAtrasada`, `identificadorDeOrden`, `nombreArchivoPicking`, `compararCodigo`,
  `CLAVES_VARIABLES_PICKING`, `NOMBRE_SIN_PRODUCTO`. Reutiliza `parsearProducto` (345) y su clave;
  replica `deduplicarPorClave`/`formaVisible` (alternativa E del design).
- `lib/whatsapp-envios/informes/picking/pdf.ts` — `maquetarPicking(modelo, medir)` (puro, operaciones por
  página), `pdfDePicking`, `renderizarPicking`, `imprimible`, `partirEnLineas`, `ROTULOS_HELVETICA`.
- `lib/whatsapp-envios/informes/picking/informe.ts` — `crearInformePicking(deps?)`, `resumenTiendasPicking`,
  `motivoTiendaNoValida`, `motivoSinOrdenes`, `CLAVE_INFORME_PICKING`.
- `lib/interfaces/repositories/IPickingRepository.ts`, `lib/repositories/PickingRepository.ts`.
- `lib/actions/informe-picking.ts` — `listarTiendasPicking(input, deps?)` (Server Action, solo maestro).
- Tests: ver mapa R → test.

Modificados
- `lib/whatsapp-envios/informes/tipos.ts` — `ResultadoInforme` gana `{ tipo: "error"; motivo }`;
  `PanelParametros = "transito" | "picking"`.
- `lib/services/EjecucionEnvioService.ts` — tras la rama `vacio`: `if (r.tipo === "error") return
  this.terminar(e.id, "error", r.motivo);` (una línea).
- `lib/whatsapp-envios/informes/catalogo.ts` — registra `crearInformePicking()` (repo perezoso).
- `lib/whatsapp-envios/informes/formato.ts` — recibe `fechaLargaCR` (antes en `transito/pdf.ts`) y suma
  `fechaCortaCR`; `transito/pdf.ts` la importa de aquí (sin cambio de comportamiento).
- `app/(app)/configuracion/envios-whatsapp/_components/ParametrosInforme.tsx` — SOLO un `case "picking"`
  de reserva (texto «el selector de tienda todavía no está disponible») para que el `never` compile.
  La rama real es de frontend_dev (ver Contrato).
- `tests/unit/whatsapp-envios/catalogo-informes.test.ts` (474) — la lista de claves suma `picking`, y la
  regla «defaults válidos» lleva UNA excepción afirmada: el picking falla SOLO en `tiendaId`.

## Contrato para frontend_dev (F5)

1. **Descriptor**: el informe `picking` declara UN descriptor
   `{ campo: "picking", tipo: "panel", panel: "picking", campos: ["tiendaId", "diasAtraso"], etiqueta:
   "Parámetros del picking", ayuda: "Solo aparecen las tiendas con fulfillment. Cada tienda va en su propio envío." }`.
   El panel recibe TODOS los `valores` (así lee `diasAtraso` para los conteos) y los errores
   `parametros.tiendaId` / `parametros.diasAtraso`. Sustituye la reserva `case "picking"` de
   `ParametrosInforme.tsx` por el componente (p. ej. `ParamsPicking` / `SelectorTiendaPicking`).
2. **Acción**: `listarTiendasPicking({ diasAtraso })` de `@/lib/actions/informe-picking` →
   `ListarTiendasPickingResult` (`@/lib/whatsapp-envios/informes/picking/tipos`):
   - `{ status: "ok", tiendas: { tiendaId, nombre, ordenes, atrasadas }[] }` — ya ordenadas por nombre;
   - `{ status: "unauthenticated" } | { status: "forbidden" } | { status: "validation_error", fieldErrors: { diasAtraso: [...] } }`.
   Volver a pedir al cambiar `diasAtraso` (válido 1..30). Lista vacía → «No hay tiendas con fulfillment».
3. **Valores de partida**: `{ tiendaId: "", diasAtraso: 2 }`. Guardar sin tienda → `parametros.tiendaId`
   «Elige la tienda del picking.»; `diasAtraso` inválido → `parametros.diasAtraso`
   «Escribe un número entero de días entre 1 y 30.» (`MENSAJES_PICKING`).
4. **Superficie**: la acción lleva `/** @sin-superficie 476: … */`. Al montarla desde el panel, la guardia
   `superficie-de-uso` exigirá QUITAR esa anotación (caduca sola). Importar solo `picking/tipos.ts` y la
   acción desde el cliente (nunca `picking/pdf.ts`: arrastra la fuente embebida).
5. Destinatarios: el informe no es apto para `adminTienda` (la 474 ya lo rechaza en `destinatarios`).

## Mapa R → test

| R | Test |
| --- | --- |
| R1 | `tests/unit/whatsapp-envios/informe-picking.test.ts` «476/R1»; `catalogo-informes.test.ts` (474) |
| R2 | `informe-picking.test.ts` «476/R2» (schema); `tests/unit/services/whatsapp-envio-service-picking.test.ts` «476/R2» (guardar → `parametros.tiendaId` / `parametros.diasAtraso`) |
| R3 | int `tests/integration/db/picking-resumen-tiendas.test.ts` (solo adminTienda+fulfillment, orden, N=2/N=5, cruce selector = generar, «decision del leader»: estado ≠ activo no sale); `informe-picking.test.ts` «476/R3»; `informe-picking-actions.test.ts` «476/R3»; `picking-modelo.test.ts` «476/R3» (misma definición de atrasada) |
| R4 | `tests/unit/actions/informe-picking-actions.test.ts` «476/R4» (sin sesión, 5 roles → sin construir el repo) |
| R5 | `whatsapp-envio-service-picking.test.ts` «476/R5» (rol y usuario adminTienda, informe REAL del catálogo) |
| R6 | int `picking-ordenes-en-preparacion.test.ts` «R6/R26», «R6: tienda sin fulfillment», «R6/R3 entradas» |
| R7 | `informe-picking.test.ts` «476/R7» (4 casos, + inactiva); `tests/unit/services/ejecucion-envio-informe-error.test.ts` (motor: error terminal, sin entregas/PDF/Meta); int «R7/R8 por el catálogo»; int «R7 (decision del leader)» (inactivo/bloqueado/pendiente → error «no está activa») |
| R8 | `informe-picking.test.ts` «476/R8»; int «R7/R8 por el catálogo» |
| R9 | int «R30/R9» (`updated_at`/estado intactos, historial sin filas nuevas, +1 día sigue, movida ya no) |
| R10, R11 | `tests/unit/whatsapp-envios/picking-modelo.test.ts` «476/R10», «476/R11» |
| R12 | `picking-modelo.test.ts` «476/R12» |
| R13 | `picking-modelo.test.ts` «476/R13»; `picking-pdf.test.ts` «Sin producto indicado» |
| R14 | `picking-modelo.test.ts` «476/R14»; int «R14» (última transición hacia en_preparacion; sin historial → creación) |
| R15 | `picking-modelo.test.ts` «476/R15» |
| R16 | `tests/unit/whatsapp-envios/picking-pdf.test.ts` «476/R16» (encabezado + humo `%PDF` y nº de páginas) |
| R17 | `picking-pdf.test.ts` «476/R17»; `picking-modelo.test.ts` «476/R17» |
| R18 | `picking-modelo.test.ts` «476/R18» |
| R19 | `picking-pdf.test.ts` «476/R19»; `picking-modelo.test.ts` (orden de la lista) |
| R20 | `picking-pdf.test.ts` «476/R20» |
| R21 | `picking-pdf.test.ts` «476/R21» (500 órdenes/80 productos, límite inferior, fila «(continúa)» con 400) |
| R22 | `picking-pdf.test.ts` «476/R22» (U+1D560 → «?», aviso, conteo por dato, D6 cobertura/Helvetica) |
| R23 | `picking-modelo.test.ts` «476/R23» |
| R24 | `informe-picking.test.ts` «R24» |
| R25 | `informe-picking.test.ts` «476/R25»; `picking-modelo.test.ts` «476/R25-R28» |
| R26 | int «R6/R26» (`BS-3`, `NA-107`, `NA-1069` en orden natural); int «R30/R9» (desde/hasta) |
| R27 | `informe-picking.test.ts` «476/R27»; `picking-pdf.test.ts` «R27» |
| R28 | `informe-picking.test.ts` «476/R28»; `picking-modelo.test.ts` |
| R29 | `tests/unit/repositories/picking-repository.test.ts` «476/R29» (UNA `$queryRaw` con 1 y con 60) |
| R30 | int «R30/R9» (`INFORMES_WHATSAPP.get("picking")` con `getPrismaClient` redirigido a la tx) |

## Mutaciones

Medidas aquí (sin base), con arnés autocomprobado: baseline verde (80 tests), contenido del archivo
comprobado tras aplicar, nº de tests ejecutados leído de la salida, restauración y baseline final verde,
`git status` limpio. **20/20 mueren.**

| # | Mutación (archivo) | Resultado |
| --- | --- | --- |
| U1 | motor sin `if (r.tipo === "error")` (`EjecucionEnvioService.ts`) | MUERE (2 failed) |
| U2 | `dias > diasAtraso` → `>=` (`modelo.ts`) | MUERE |
| U3 | días por horas (floor 24 h) en vez de calendario CR | MUERE (3) |
| U4 | no sumar cantidades del mismo producto en la orden | MUERE |
| U5 | forma visible: empate gana la mayor | MUERE |
| U6 | `aptoParaAdminTienda: true` (`informe.ts`) | MUERE (3) |
| U7 | tienda sin fulfillment → `vacio` en vez de `error` | MUERE (5) |
| U8 | PDF aunque la plantilla no lleve documento | MUERE |
| U9 | `imprimible` no sustituye | MUERE (3) |
| U10 | pie «Página X de X» | MUERE |
| U11 | sin cabecera de tabla repetida al saltar de página | MUERE |
| U12 | acción construye el repo ANTES de mirar el rol | MUERE (11) |
| U13 | productos por unidades ascendente | MUERE (2) |
| U14 | `productos` cuenta «Sin producto indicado» | MUERE (3) |
| U15 | resumen sin ordenar por nombre | MUERE (2) |
| U16 | identificador sin «(guía N)» | MUERE |
| U17 | ficha sin «×k» | MUERE (2) |
| U18 | sin bloque de atrasadas | MUERE (4) |
| U19 | fila «(continúa)» descarta el resto de fichas | MUERE |
| U20 | `remision_hasta` = la primera | MUERE (2) |

**MEDIDAS CONTRA POSTGRES (2026-10-05, checkout principal, base local).** Arnés: cambios de la ronda en
el ÍNDICE (`git add`), cada mutación aplicada por reemplazo exacto (patrón único), `git diff --stat` leído,
los 2 archivos de integración corridos con `--reporter=json` (10 tests, **0 skipped** en todas),
`git checkout -- <archivo>` y `git diff --stat` vacío tras cada una. Base inicial y final: 10/10 verdes.
**11/11 mueren.**

| # | `git diff --stat` | Ejecutados | Rojos |
| --- | --- | --- | --- |
| M1 | `PickingRepository.ts \| 1 -` | 10, 0 skipped | 4: «R6/R26», «R6/R3 entradas», «R30/R9», «solo adminTienda… N=2/N=5» |
| M2 | `PickingRepository.ts \| 1 -` | 10, 0 skipped | 2: «R6: tienda sin fulfillment», «R6/R3 entradas» |
| M3 | `PickingRepository.ts \| 2 +-` | 10, 0 skipped | 4: «R6/R26», «R6/R3 entradas», «R30/R9», «solo adminTienda…» |
| M4 | `PickingRepository.ts \| 2 +-` | 10, 0 skipped | 5: «R6/R26», «R6: sin fulfillment», «R30/R9», «R7/R8 por el catálogo», «conteo del selector = generar» |
| M5 | `PickingRepository.ts \| 2 +-` | 10, 0 skipped | 2: «solo adminTienda…», «decision del leader» (selector) |
| M6 | `informe.ts \| 2 +-` | 10, 0 skipped | 1: «R30/R9» |
| M7 | `PickingRepository.ts \| 2 +-` | 10, 0 skipped | 3: «R14», «R30/R9», «solo adminTienda… N=2/N=5» |
| M8a | quitar `estado: "activo"` de `tiendasFulfillment` (`PickingRepository.ts \| 2 +-`) | 10, 0 skipped | 1: «decision del leader» (selector) |
| M8b | quitar `!tienda.activo` del `if` de `generar` (`informe.ts \| 2 +-`) | 10, 0 skipped | 1: «R7 (decision del leader)» |
| M8c | `activo: u.estado === "activo"` → `activo: true` (`PickingRepository.ts \| 2 +-`) | 10, 0 skipped | 1: «R7 (decision del leader)» |
| M9 | volver a MEMOIZAR el repo en `depsDeProduccion` (el bug; `informe.ts \| 3 ++-`) | 10, 0 skipped | 2: «R7/R8 por el catálogo», «R7 (decision del leader)» (P2028) |

Ninguna sobrevivió: no hizo falta endurecer tests. M6 se aplicó sobre la línea nueva (sin memo).

Tabla original de pendientes (ya medidas arriba):

| # | Ubicación exacta | Mutación | Debe poner ROJO |
| --- | --- | --- | --- |
| M1 | `lib/repositories/PickingRepository.ts`, `seleccionEnPreparacion`, línea `AND s."value" = 'en_preparacion'` | borrar la línea | `picking-ordenes-en-preparacion` «R6/R26» (sale `NA-1`, en_bodega_central) |
| M2 | misma función, línea `AND t."fulfillment" = true` | borrar la línea | «R6: tienda sin fulfillment» y «R6/R3 entradas» (sale `c1`) |
| M3 | misma función, `WHERE o."deleted_at" IS NULL` | cambiar por `WHERE true` | «R6/R26» (sale `NA-2`, borrada) |
| M4 | `ordenesEnPreparacion`, `Prisma.sql\`AND o."tienda_id" = ${tiendaId}\`` | cambiar por `Prisma.empty` | «R6/R26» (salen órdenes de B y E) |
| M5 | `lib/repositories/PickingRepository.ts`, `tiendasFulfillment`, `fulfillment: true` del `where` | quitarlo | `picking-resumen-tiendas` (aparece la tienda C) |
| M6 | `informe.ts`, `depsDeProduccion`: `new PickingRepository(getPrismaClient())` | un repo cuyo `ordenesEnPreparacion` devuelva `[]` | «R30/R9» (llega `vacio`) |
| M7 | `seleccionEnPreparacion`, `MAX(hh."created_at")` | `MIN(...)` | «R14» (a2 entraría hace 8 días) |

Comandos (con `DATABASE_URL`; sin base se SALTAN — mirar `skipped`):

```
pnpm exec vitest run tests/integration/db/picking-ordenes-en-preparacion.test.ts tests/integration/db/picking-resumen-tiendas.test.ts
```

## Desvíos

1. **D4 con la rama `error` (design §3.1), no con una excepción.** Medido en el motor: si `generar` lanza,
   la ejecución queda en `generando` (`EjecucionEnvioService.ts:128`), el job reintenta y el historial
   nunca muestra un motivo; R7 pide «terminar en error con un motivo». La rama es aditiva: tipo + una
   línea en el motor. Un fallo de LECTURA sigue lanzando (reintentable).
2. **Panel `picking` en vez del catálogo `tiendas_fulfillment` (design §3.2).** La 475 creó los paneles
   para esto (su comentario en `tipos.ts` nombra «476: picking»), y el selector necesita `diasAtraso`
   del formulario para los conteos: un descriptor `seleccion` solo recibe SU valor; un panel recibe
   todos. Coste: una reserva de 7 líneas en `ParametrosInforme.tsx` para que el `never` compile.
3. **`tiendaId` con `min(1)`, no `.uuid()`.** zod 4 exige UUID RFC estricto; el repo valida ids con
   `min(1)` (`idSchema` de la 474). Que la tienda exista se comprueba al generar (R7).
4. **Días en TS, no en SQL (design §4.3).** El resumen del selector no calcula días en SQL: el repo
   devuelve el instante de entrada y `contarPorTienda` usa `diasEnPreparacion`/`estaAtrasada`, las MISMAS
   del PDF (convención de la 475). Dos lecturas fijas para el resumen (tiendas + entradas), sin N+1.
5. **Acción en `lib/actions/informe-picking.ts` y DTO en `picking/tipos.ts`** (no en
   `envios-whatsapp.ts` / `lib/types/envios-whatsapp.ts`): mismo patrón que la 475 y evita tocar
   `lib/types/` (cimientos → gate completo).
6. **Rótulos en negrita con Helvetica; el resto con la fuente embebida** (D6). Un test exige que todo
   texto Helvetica sea `seguroEnFuenteEstandar` y que todo texto embebido esté en su cobertura.
7. **`catalogo-informes.test.ts` (474) enmendado**: «defaults válidos» tiene UNA excepción afirmada
   (picking, solo `tiendaId`), consecuencia directa de design §4.2.
8. **Cerrado por el leader (2026-10-05):** una tienda con `usuario.estado` distinto de `activo` NO sale en
   el selector (`tiendasFulfillment`: `where { fulfillment: true, estado: "activo", rol adminTienda }`) y
   `generar` para ella devuelve `{ tipo: "error", motivo: "La tienda «X» no está activa: revisa el envío." }`
   (mismo desenlace que «sin fulfillment»). `TiendaPicking` gana `activo`. La SELECCION SQL
   (`seleccionEnPreparacion`) NO se toca: las entradas de una tienda inactiva no llegan a ningún sitio
   (el resumen solo cuenta las tiendas que devuelve `tiendasFulfillment`, y `generar` corta antes).

## Ronda leader contra Postgres (2026-10-05, checkout principal `int-476`)

**Bug: «R7/R8 por el catálogo» rojo con `informe picking: tiendaDelPicking falló`.**
- Causa real (`error.cause`): `PrismaClientKnownRequestError` **P2028** «Transaction already closed: A query
  cannot be executed on a transaction that was rolled back», en `PickingRepository.tiendaDelPicking`.
- Por qué: `depsDeProduccion()` en `informe.ts` MEMOIZABA `{ repo: new PickingRepository(getPrismaClient()) }`
  con `??=`. El informe registrado en el catálogo es un singleton de módulo, así que el repo quedaba atado
  al cliente de la PRIMERA llamada. En la integración, «R30/R9» redirige `getPrismaClient` a SU transacción
  (revertida al acabar) y «R7/R8» llegaba después con el repo viejo. Aislado, «R7/R8» pasaba (medido).
  No era el SQL ni `PickingRepository`. En producción `getPrismaClient()` es un singleton y no se
  manifestaba, pero era estado oculto innecesario.
- Arreglo mínimo: `depsDeProduccion` construye el repo en cada `generar` (sin memo; sigue sin abrir conexión
  al importar; `getPrismaClient()` devuelve el singleton). La 475 (`transito/informe.ts:65`) tiene el MISMO
  patrón memoizado: fuera de alcance, no tocado (mismo riesgo, solo en tests).
- Motivo en el log: `JobQueueService.mensajeError` guarda en `jobs.last_error` SOLO `error.message` (500 c.);
  el `cause` se perdía. `leer()` ahora añade el motivo SANEADO: `informe picking: <op> falló (<NombreClase>
  <codigo>)`, p. ej. `(PrismaClientKnownRequestError P2028)`. Nunca el `message` de la causa (el de Prisma
  copia la invocación con argumentos); el código solo si casa `^[A-Za-z0-9_]{1,20}$`. Función exportada
  `detalleDeCausa`; test unit «el mensaje lleva el motivo SANEADO…».

**Inactivas** — ver Desvíos 8.

Archivos de esta ronda: `lib/whatsapp-envios/informes/picking/{informe,tipos}.ts`,
`lib/repositories/PickingRepository.ts`, `lib/interfaces/repositories/IPickingRepository.ts`,
`tests/integration/db/{_picking-476,picking-ordenes-en-preparacion.test,picking-resumen-tiendas.test}.ts`,
`tests/unit/repositories/picking-repository.test.ts`, `tests/unit/services/ejecucion-envio-informe-error.test.ts`,
`tests/unit/whatsapp-envios/informe-picking.test.ts`.

Verificación de esta ronda (salida real):
- Integración 476: `Tests 10 passed (10)`, 0 skipped (antes 8; +1 test por archivo).
- `pnpm run typecheck` → exit 0. `pnpm run lint` → `✖ 235 problems (0 errors, 235 warnings)`, exit 0
  (igual que antes; `eslint` sobre los 10 archivos tocados: sin avisos).
- `pnpm exec vitest related --run <los 10 archivos>` → `Test Files 205 passed (205)`, `Tests 2635 passed (2635)`.
- `pnpm exec vitest run guard` → `Test Files 274 passed (274)`, `Tests 3764 passed (3764)` (con base: 0 skipped).

## Verificación (salida real, 2026-10-05)

- `pnpm run typecheck` → `tsc --noEmit` sin errores (exit 0).
- `pnpm run lint` → `✖ 235 problems (0 errors, 235 warnings)`, exit 0; ningún aviso en archivos de la 476.
- `pnpm exec vitest related --run <14 archivos de lib/ y app/ tocados>` → `Test Files 1 failed | 207 passed | 7 skipped (215)`,
  `Tests 1 failed | 2740 passed | 17 skipped`. El rojo: `tests/components/ParamsTransito.test.tsx` «m1 — un panel sin
  rama…» usaba `panel: "picking"` como ejemplo de panel DESCONOCIDO; ahora lo es `futuro` (commit `59412ed6`).
  Re-corrido aislado: verde.
- `pnpm exec vitest run guard` (todas las guardias) → primera vez 1 rojo: `clave-remision-solo-lectura` (el
  `ORDER BY o."clave_remision"` del repo nuevo); `PickingRepository` entra en su lista blanca con motivo (solo
  ORDEN, R26; commit `f1fc3fab`). Segunda vez: `Test Files 272 passed | 2 skipped (274)`, `Tests 3745 passed | 19 skipped`.
- Archivos de la 476 + motor + ParamsTransito: `Test Files 24 passed | 2 skipped (26)`, `Tests 257 passed | 8 skipped`.
  **Los 2 saltados son las integraciones de la 476** (`picking-ordenes-en-preparacion`, `picking-resumen-tiendas`):
  este worktree no tiene `DATABASE_URL`. Las corre el leader (comando arriba) y mide M1–M7.
- `./init.sh` no corrido (regla 5 y orden del leader); el rápido sale **normal**, no ampliado: no toca
  migraciones, `db/schema.prisma` ni `lib/types/`.

Veredicto: backend de la 476 hecho y verde en unit/guardias/typecheck/lint, 20/20 mutaciones sin base muertas;
falta que el leader corra las 2 integraciones contra Postgres y mida M1–M7.

Veredicto (ronda leader): bug P2028 arreglado (repo sin memo + motivo saneado en `last_error`), inactivas
fuera del selector y en `error`, integración 10/10 sin saltos y 11/11 mutaciones contra Postgres muertas.
---

# FRONTEND (F5, frontend_dev, rama `fe/476`)

Partida: `origin/feature/476-informe-picking-whatsapp` (`c8170741`) + `origin/dev` mergeado («Already up to date»).
Grafo: no hizo falta; los símbolos venían nombrados en el contrato y se leyeron en los archivos reales.

## Archivos

- `app/(app)/configuracion/envios-whatsapp/_components/ParamsPicking.tsx` (nuevo): el panel `picking`.
- `app/(app)/configuracion/envios-whatsapp/_components/picking-textos.ts` (nuevo): textos y mensajes puros.
- `app/(app)/configuracion/envios-whatsapp/_components/ParametrosInforme.tsx`: la reserva `case "picking"` pasa a
  `ParamsPicking` (con `ayuda`, `onNormalizar` y los errores de sus `campos`).
- `components/ui/radio-group.tsx`: `RadioGroupOption.detalle?` opcional (texto a la derecha de la fila, dentro de su
  `<label>`, así entra en el nombre accesible); sin él, el render es idéntico al de antes.
- `lib/actions/informe-picking.ts`: QUITADA la anotación `@sin-superficie` (ya la monta el panel).
- `tests/components/ParamsPicking.test.tsx` (nuevo): 15 tests.

## Comportamiento

- UNA tienda (D1): `RadioGroup` de una sola elección con las tiendas de `listarTiendasPicking`, en el orden recibido.
- Junto a cada tienda: «N órdenes · M atrasadas» (M en píldora ámbar si > 0). Al cambiar N válido re-pide tras 400 ms;
  mientras, cada fila dice «calculando…» (los conteos del N anterior NO se dan por buenos). Una respuesta de un N
  anterior se DESCARTA (número de petición + `vivo`).
- N inválido: «Escribe un número entero de días entre 1 y 30.» junto al número; no se pide nada y las filas solo
  muestran las órdenes (las atrasadas dependen de N).
- Sin tiendas: «No hay tiendas con fulfillment. Cuando una tienda tenga fulfillment activo, aparecerá aquí.»
- `forbidden`/`unauthenticated`: «Solo un maestro puede ver las tiendas del picking.» (no re-pide en bucle).
- Error de carga: aviso + «Reintentar».
- Tienda guardada que ya no está en la lista: aviso rojo y ninguna marcada (el valor no se toca por su cuenta).
- Errores de «Guardar» (`parametros.tiendaId`, `parametros.diasAtraso`) junto a su campo, hasta que se toca el panel.
- m4: si falta `diasAtraso` en lo guardado, se completa con 2 por `onNormalizar`, no por `onCambiar`.
- 390 px: el número va a `h-11` (44 px, objetivo táctil de `FormularioMovil`) y `h-8` desde `sm`; la frase del número
  hace `flex-wrap`; el conteo de cada fila es `shrink-0` y el nombre se encoge.

## Mapa R → test (pantalla, `tests/components/ParamsPicking.test.tsx`)

| R | Test |
|---|---|
| R3 solo las tiendas de la acción, por nombre, con órdenes y atrasadas | «pide la lista con el N del formulario y pinta UNA opción por tienda, en el orden recibido» |
| R3 una sola tienda (D1) | «elegir una tienda manda SOLO su id (una sola elección)» |
| R3 atrasadas según el N del formulario | «al cambiar N vuelve a pedir y recalcula…», «descarta una respuesta que llega TARDE…», «mientras llega la lista del N nuevo…» |
| R3 vacío / error / tienda caída | describe «R3 — estados de la lista» |
| R4 (pantalla) no maestro | «sin permiso (no maestro): lo dice en claro y no vuelve a pedir» |
| R2 (pantalla) errores por campo | describe «R2 de pantalla — errores junto a su campo» (3 tests) |
| m4 (475) partida sin «cambios» | describe «m4 (revisión 475)…» (2 tests) |
| Panel registrado en `ParametrosInforme` | «el descriptor `picking` monta el panel real» |

## Mutaciones medidas (aplicada → `diff` comprobado → rojo → revertida → verde)

| # | Mutación en `ParamsPicking.tsx` | Resultado |
|---|---|---|
| F1 | «no re-pedir al cambiar N»: `yaPedido` sin `&& lista.dias === n` | ROJA: 3 tests (recalcula / tarde / calculando) |
| F2 | «no descartar respuestas tardías»: quitar `if (!vivo \|\| id !== ultimaPeticion.current) return;` del éxito | ROJA: 1 test («descarta una respuesta que llega TARDE…») |

Revertidas ambas: 15/15 verdes.

## Diferencias con la maqueta (`ParamsPicking.dc.html`, `FormularioMovil.dc.html`)

1. **Radio en vez de casillas** (D1 aprobada): una tienda por envío; título «Tienda», no «Tiendas».
2. **«0 atrasadas» se muestra** (la maqueta lo omite en Sicommer): R3 pide órdenes Y atrasadas de cada tienda, y así se
   ve que el recálculo al cambiar N ocurrió. La píldora ámbar queda solo para M > 0.
3. **Intro**: «Cada tienda va en su propio envío, con su propio PDF» en vez de «Cada tienda recibe su propio PDF» (D1).
4. **Ayuda del número**: «junto a su remisión» en vez de «junto a su guía» (D2: en preparación no hay guía).
5. **Ayuda de la tienda**: la del descriptor del backend + «Una tienda sin nada en preparación no genera PDF ese día.»
6. **Móvil**: la maqueta pone «25 en preparación» sin atrasadas; aquí el mismo «N órdenes · M atrasadas» que en escritorio.
7. Estados que la maqueta no pinta (cargando, vacío, error, sin permiso, tienda caída, «calculando…»): añadidos.

## Verificación (salida real)

- `tsc --noEmit` → exit 0 (`progress/typecheck_476_frontend.log`).
- `eslint` sobre los 6 archivos tocados → exit 0, sin avisos.
- `vitest run tests/components/ParamsPicking.test.tsx` → 15/15.
- `vitest related --run` (archivos tocados + guardia `superficie-de-uso`) → `progress/related_476_frontend.log`:
  `Test Files 278 passed | 1 skipped (279)`, `Tests 4179 passed | 19 skipped`, `INIT_EXIT=0` (amplio porque
  `radio-group.tsx` lo usan 8 pantallas; los saltados son los INERTES ya conocidos de `AnaliticaPage`). La guardia
  `superficie-de-uso` verde con la anotación quitada.
- **T5.2 (capturas en navegador) NO hecha**: este worktree no tiene `.env`/base ni dev server propio (memoria «dos dev
  servers se pisan»). Queda para el leader: escritorio y 390 px del panel con tres tiendas.
- Sin `node_modules` en el worktree y sin poder crear el junction (el aislamiento del agente rechaza `mklink`/`New-Item`):
  vitest, tsc y eslint corrieron con los binarios de `../../../node_modules`, que Node resuelve subiendo directorios.

Veredicto frontend: panel del picking montado, 15 tests y 2 mutaciones rojas; falta la verificación visual (T5.2).

## Menores de la revisión (fix/476-pdf)

- m2: el sello del pie del PDF de picking se recorta con «…» (`recortarAlAncho`) al hueco que deja «Página X de Y», que sale siempre entero; la medida real de jsPDF se expone como `medidorDe(doc)`. Test «m2: una tienda de 200 caracteres…» en `picking-pdf.test.ts` (anchos con jsPDF y la fuente embebida); mutación «`texto: sello` sin recortar» muerta (1 rojo). El pie de tránsito no lleva datos (texto fijo + fecha, ~60 mm de 186): sin riesgo, sin cambio.
- Gate de los menores: `tsc --noEmit` exit 0; `eslint` de los 7 archivos exit 0; `vitest related --run` → `Test Files 204 passed | 6 skipped (210)`, `Tests 2685 passed | 16 skipped` (los saltados: integración sin `DATABASE_URL` en el worktree).
- m1 (de la 475): ver `progress/impl_475.md`; `detalleDeCausa` pasa a `lib/whatsapp-envios/informes/causa.ts` (picking lo reexporta).
