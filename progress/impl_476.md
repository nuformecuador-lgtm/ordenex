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
| R3 | int `tests/integration/db/picking-resumen-tiendas.test.ts` (solo adminTienda+fulfillment, orden, N=2/N=5, cruce selector = generar); `informe-picking.test.ts` «476/R3»; `informe-picking-actions.test.ts` «476/R3»; `picking-modelo.test.ts` «476/R3» (misma definición de atrasada) |
| R4 | `tests/unit/actions/informe-picking-actions.test.ts` «476/R4» (sin sesión, 5 roles → sin construir el repo) |
| R5 | `whatsapp-envio-service-picking.test.ts` «476/R5» (rol y usuario adminTienda, informe REAL del catálogo) |
| R6 | int `picking-ordenes-en-preparacion.test.ts` «R6/R26», «R6: tienda sin fulfillment», «R6/R3 entradas» |
| R7 | `informe-picking.test.ts` «476/R7» (3 casos); `tests/unit/services/ejecucion-envio-informe-error.test.ts` (motor: error terminal, sin entregas/PDF/Meta); int «R7/R8 por el catálogo» |
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

**PENDIENTES PARA EL LEADER (necesitan Postgres)** — aplicar UNA, comprobar con `git diff`, correr,
debe salir ROJO, revertir, verde:

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
8. **Abierto (no inventado):** el spec no dice si una tienda con `usuario.estado` distinto de `activo`
   debe salir en el selector; hoy sale si es `adminTienda` con fulfillment.

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
