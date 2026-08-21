# Feature 255 — cotización por API key · bitácora de implementación (backend)

Rama: `feature/255-cotizacion-api-key` · worktree `C:/w255` · salida de `origin/dev` (`8070b508`).
Spec aprobado por el humano el 2026-08-21 (decisiones D1–D6 en `requirements.md`).

---

## T0.1 — Baseline ANTES de tocar nada

Medido el 2026-08-21 sobre `8070b508`, árbol limpio salvo `specs/255-cotizacion-api-key/`
(sin commitear todavía).

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck C:\w255
> tsc --noEmit
```

**0 errores.** Verde.

### `pnpm run lint`

```
✖ 97 problems (0 errors, 97 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

**0 errores, 97 warnings preexistentes** (todas `@typescript-eslint/no-unused-vars` sobre
parámetros `_`-prefijados en tests). Verde a efectos del gate.

### Las tres guardias de `design.md` §8

`pnpm exec vitest run tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts tests/unit/guards/dinero-sin-centimos.guardia.test.ts tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts`

```
 Test Files  3 passed (3)
      Tests  45 passed (45)
   Duration  3.45s
```

**45/45 verdes, 0 rojos previos.** Cualquier rojo posterior en estos tres archivos es atribuible
a esta feature.

### Conteo de rojos previos: **0**

En los tres ejes medidos (typecheck, lint, guardias de §8) el baseline es limpio. No hay ningún
rojo preexistente que heredar ni que descontar.

---

## T9 — el middleware NO se toca (R48)

```
$ git diff middleware.ts
(vacío)
```

`PUBLIC_ROUTES` intacto. El subpath nuevo pasa porque `middleware.ts:32` ya declara
`"/api/ordenes/api-key"` en `SELF_AUTH_ROUTES` y `matches()` compara por PREFIJO. La guardia de
la feature 229, que congela posicionalmente las tres listas del middleware, sigue **verde sin
editarla** (incluida en la corrida de `tests/unit/guards/` de abajo).

## T14 — la feature no toca el esquema

```
$ git diff --stat db/
(vacío)
$ git status --short db/
(vacío)
```

Sin cambios en `db/schema.prisma` y sin carpeta nueva en `db/migrations/`.

**Los ítems de migración y de RLS de `CHECKPOINTS.md` NO APLICAN a esta feature**, y no es un
olvido: la 255 no crea tablas, no altera columnas, no añade índices y no introduce ninguna
superficie RLS nueva. Todo lo que lee ya existía (`design.md` §1): el árbol geográfico
(features 15/24), la tabla `tarifas` (features 42/69) y el actor de la key (feature 88).

### Guardias, tras las tareas T1–T4

```
$ pnpm exec vitest run tests/unit/guards/
 Test Files  63 passed (63)
      Tests  930 passed (930)
```

63 archivos, 930 tests, **0 rojos**. Igual que el baseline.

---

## Archivos creados / modificados

### Creados (11)

| Archivo | Tarea |
| --- | --- |
| `lib/utils/monto-cotizacion.ts` | T1 |
| `lib/services/geo-resolucion.ts` | T2 (MUDANZA) |
| `lib/types/cotizacion.ts` | T3 |
| `lib/interfaces/services/ICotizacionOrdenService.ts` | T5 |
| `lib/services/CotizacionOrdenService.ts` | T5-T7B |
| `lib/services/mensajes-cotizacion.ts` | T8 |
| `app/api/ordenes/api-key/cotizacion/route.ts` | T8 |
| `tests/unit/utils/monto-cotizacion.test.ts` | T1 |
| `tests/unit/types/cotizacion.test.ts` | T3 |
| `tests/unit/services/cotizacion-orden-service.test.ts` | T5-T7B |
| `tests/integration/cotizacion-api-key.test.ts` | T8/T13 |

### Modificados (9)

| Archivo | Naturaleza del cambio |
| --- | --- |
| `lib/services/BulkOrdenService.ts` | **solo imports + borrado** (T2): -1/+9 imports, -159 el bloque movido |
| `lib/interfaces/repositories/ITarifaVigentePorTiendaRepository.ts` | +17, metodo nuevo (T4) |
| `lib/repositories/TarifaVigentePorTiendaRepository.ts` | +36, **cero borrados** (T4) |
| `lib/api/openapi-spec.ts` | +octavo path (T11) |
| `docs/api/api-key-openapi.yaml` | +octavo path, espejo (T11) |
| `tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts` | 7 -> 8 paths **a proposito** (T12) |
| `tests/unit/guards/dinero-sin-centimos.guardia.test.ts` | +diente 6 + prosa (T10) |
| `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` | +78, **cero borrados** (T4) |
| 6 dobles estructurales en 5 archivos de otras suites | +1 linea cada uno - ver nota |

### Nota declarada: las 11 lineas en dobles de otras suites

Añadir un metodo **requerido** a `ITarifaVigentePorTiendaRepository` (T4, decision D6) rompe el
**typecheck** de todo objeto literal tipado como esa interfaz. Son 6 dobles en 5 archivos:
`bulk-orden-service.test.ts` (x2), `bulk-orden-service.carga-api.test.ts`,
`bulk-orden-service.carga-lote.test.ts`, `rol-admin-satelite-authz.test.ts`,
`gestion-desde-ayuda-cierre.test.ts`.

**11 inserciones, 0 borrados. Ni una afirmacion, ni un `expect`, ni un comportamiento tocado.**

Se declara de frente porque roza el criterio de T2, y conviene la distincion exacta:

- **T2 (la MUDANZA de `resolveGeo`) NO necesito editar ni un test.** Su criterio se cumple al pie, y
  se verifico **mecanicamente**: se extrajeron del `HEAD` los rangos movidos, se les quito el
  `export ` añadido y el `diff` contra el modulo nuevo dio **vacio**. Ni una cadena, ni una rama, ni
  un orden de comprobacion cambian.
- Lo que forzo las 11 lineas es **T4**, cuyo criterio propio es mas estrecho -"las dos afirmaciones
  de ausencia de `status` de la feature 69 siguen verdes sin editarlas, igual que el test que exige
  el `TODO:` por grep"- y **se cumple integro**.
- Las suites de la carga **nunca se pusieron rojas**: Vitest no typechequea, y corrieron verdes con
  la interfaz ya ampliada y antes de tocar los dobles. Lo que se puso rojo fue `pnpm run typecheck`.

Se descarto la alternativa de una interfaz aparte (`ITarifaCotizablePorTiendaRepository`):
`design.md` §4 y T4 dicen literalmente "extender `ITarifaVigentePorTiendaRepository`", y desviarse
de un spec que paso una puerta humana no es una decision de implementacion. Se descarto tambien
declararlo **opcional** (`resolveTarifaCotizablePorTienda?`), que si habria evitado las 11 lineas:
convertiria un fallo de wiring **de dinero** en un `undefined` en runtime - exactamente lo que el
constructor de `BulkOrdenService` documenta que quiso evitar al exigir `tarifaRepo`.

---

## Deuda declarada: la ventana 255 <-> 70 (`design.md` §4)

`resolveTarifaCotizablePorTienda` filtra `status: "activo"`; el resolver de liquidacion
(`resolveTarifaPorTienda`) **no**, y sigue sin filtrarlo porque esa decision es de la **feature 70**,
que esta bajo gate.

**Consecuencia, mientras las dos coexistan:** una tarifa `inactivo` **cotizara** distinto (409, "no
hay tarifa vigente") de como **liquidara** el cierre (contra la tarifa inactiva).

**Hoy es teorico:** la 70 midio **CERO** tarifas inactivas en produccion. Se declara para que, el dia
que exista la primera, se sepa donde mirar.

**Salida nombrada:** cuando la 70 cierre y el resolver compartido filtre `status`, este metodo se
colapsa en aquel y se borra. Queda escrito en el docstring del propio metodo.

Por que filtrar es seguro AQUI y no lo era alli: en la cotizacion un `null` **no degrada a un cobro
cero**, dispara el `409` de R13. Filtrar no puede producir un precio falso; produce una negativa
explicita.

## Decision de NO-E2E (`design.md` §8)

`CHECKPOINTS.md` exige Playwright para los flujos criticos de **ingesta de ordenes**. Este borde **no
ingesta nada**: no crea ordenes, no consume guias, no tiene UI, y su superficie es un contrato JSON
autenticado por key. Lo cubre `tests/integration/cotizacion-api-key.test.ts` sobre el route handler
con dependencias inyectadas - el mismo patron que `handleCargaApi`.
**Se declara aqui para que no se lea como un olvido.**

---

## Mapa `R<n> -> test` - los 56

Archivos: **FMT** `tests/unit/utils/monto-cotizacion.test.ts` · **TYP**
`tests/unit/types/cotizacion.test.ts` · **COT**
`tests/unit/services/cotizacion-orden-service.test.ts` · **INT**
`tests/integration/cotizacion-api-key.test.ts` · **REPO**
`tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` · **G230**
`tests/unit/guards/dinero-sin-centimos.guardia.test.ts` · **GAPI**
`tests/unit/api/openapi-177-paths-pdf-y-carga-id.test.ts`

| R | Test |
| --- | --- |
| R1 | INT · `devuelve 401 sin header Authorization, y no consulta tarifa ni geografia` |
| R2 | INT · `una key inexistente devuelve el MISMO 401 que la ausencia de key` |
| R3 | INT · `devuelve 403 cuando el usuario dedicado de la key no esta activo` |
| R4 | INT · `ignora un tiendaId del cuerpo y cotiza siempre contra el dueño de la key` |
| R5 | COT · estructural `no existe ninguna comprobacion de "tiene api key" tras autenticar` (service + ruta) |
| R6 | INT · `devuelve 422 con fieldErrors ante un cuerpo no-JSON y ante un schema invalido` |
| R7 | INT · `acepta el MISMO cuerpo que POST /carga sin recortarlo` + TYP (claves extra ignoradas) |
| R8 | INT · `422 con lote vacio y con lote por encima de MAX_CHUNK_ROWS` + TYP |
| R9 | COT · `devuelve numRemision tal cual si viene y null si no viene` |
| R10 | COT · `dos filas con el mismo num_remision se cotizan las dos y ninguna es duplicada` |
| R11 | COT · `resuelve la tarifa UNA sola vez por peticion, no una por fila` |
| R12 | REPO · `R12: resolveTarifaCotizablePorTienda filtra deletedAt null Y status activo, la mas reciente` |
| R13 | INT · `409 con mensaje explicito cuando la tienda no tiene tarifa cotizable, sin filas` |
| R14 | COT · `con tarifa ausente no llega a resolver la geografia de ninguna fila` |
| R15 | COT · `nunca emite un importe cero por ausencia de tarifa` + `la rama tarifa===null de derivarIngresoOrden es inalcanzable desde la cotizacion` |
| R16 | INT · `el mensaje del 409 no contiene key, hash ni datos de la fila` |
| R17 | COT (T6.1) · `resuelve provincia -> canton -> distrito y toma la zona del distrito` |
| R18 | COT (T6.2) · `distrito no encontrado en el canton` |
| R19 | COT (T6.3) · `distrito ambiguo en el canton` |
| R20 | COT (T6.4) · `el distrito X no tiene zona asignada` |
| R18-R20 | COT (T6.4b) · `los tres mensajes son byte-identicos a los que emite cargarViaApi` (ejecuta la carga REAL y compara) |
| R21 | INT · `200 con la fila sin cobertura marcada y el resto cotizado` |
| R22 | COT · `una fila en error no trae bloque costos` |
| R23 | COT (T7.1) · `cada fila cubierta emite los escenarios entregado y devuelto` |
| R24 | COT (T7.2) · `delega en derivarIngresoOrden dos veces` (espia) + estructural sin `mul/div/times/dividedBy/mod` |
| R25 | COT (T7.3) · `elige la columna GAM segun el esCentral de la zona del distrito de ESA fila` (lote mixto) |
| R26 | COT · `el escenario entregado emite exactamente flete, iva, comision, ivaComision y total` |
| R27 | COT · `el escenario devuelto emite exactamente flete, iva, comision y total, sin ivaComision` |
| R28 | COT (T7.4) · `devuelto.comision es el cero explicito y nunca falta ni es null` |
| R29 | COT · `asume cobraComision true` + GAPI · `255/R29 - la descripcion del endpoint declara el supuesto` |
| R30 | COT (T7.5) · `entregado.total = monto_cobrar menos los cuatro conceptos` |
| R31 | COT (T7.6) · `devuelto.total es negativo e igual a -(flete + iva)` - el caso -1578 del humano |
| R32 | COT · `sin monto_cobrar la comision es cero y entregado.total sale negativo` |
| R33 | COT · estructural `cero Number(/parseFloat(/parseInt( sobre importes en el service` |
| R34 | INT · `cada importe aparece una sola vez y solo formateado (ningun campo crudo escala 2)` |
| R35 | FMT · tabla de contrato, filas 1-14 (parametrizado) |
| R36 | FMT · `usa monedaConfig` (config sobreescrita => el formato cambia) + estructural (el fuente no escribe simbolo ni separadores) |
| R37 | FMT · fila 8 y fila 14 (signo DELANTE del simbolo) |
| R38 | FMT · filas 1, 2 y 13 (`menos cero` no se emite) |
| R39 | FMT · fila 10 (acarreo que cambia el nº de digitos) + COT · `el service no redondea` |
| R40 | G230 · diente 2 verde con la ruta nueva dentro del barrido de `app/**` |
| R41 | G230 · **diente 6** `salidas de maquina` (censo + contraprueba) |
| R42 | G230 · dientes 1 y 5 verdes, **sin excepciones nuevas** |
| R43 | INT (T13.1) · `una cotizacion no invoca ningun metodo de escritura del repositorio` (Proxy: el set de invocados === las 3 lecturas) |
| R44 | INT (T13.2) · `no consume ningun num_guia` |
| R45 | INT (T13.3) · `no escribe ninguna fila de auditoria` |
| R46 | INT · `la respuesta trae total, cotizadas, conError y el indice 1-based por fila` |
| R47 | GAPI · `255/R47 - el canal por API key publica OCHO endpoints, en el objeto TS y en el .yaml` |
| R48 | Guardia 229 verde **sin editar** + `git diff middleware.ts` vacio (T9) |
| R49 | INT · `ni la key ni su hash aparecen en la respuesta` + estructural (la ruta no loguea el header) |
| R50 | Suites de `cargarViaApi` y del route de carga, **verdes sin que cambie ni una afirmacion**. Matiz, para que esta fila no se lea sola y contradiga al diff: la MUDANZA de T2 no necesito tocar ningun test; lo que si se amplio son **6 dobles** de `ITarifaVigentePorTiendaRepository` en 5 archivos (**+11 lineas, 0 borrados**), porque T4 añadio un metodo **requerido** a esa interfaz y eso rompe el *typecheck* de todo objeto literal tipado como ella. Ni un `expect`, ni un valor esperado, ni un comportamiento cambiaron. Detalle completo en "las 11 lineas en dobles de otras suites", mas arriba. |
| R51 | INT · `la respuesta trae el bloque totales del lote con los escenarios entregado y devuelto` |
| R52 | COT (T7B.1) · `el bloque de lote espeja la forma de una fila` |
| R53 | COT (T7B.2) · `un lote mixto suma SOLO las filas cotizadas: la fila sin cobertura no aporta ni un cero` |
| R54 | COT (T7B.3) · `emite filasSumadas y filasExcluidas, y su suma es el total` + coherencia con `cotizadas`/`conError` de la raiz |
| R55 | COT (T7B.4) · `el total del lote se acumula en Prisma.Decimal antes de formatear` (los centimos solo cuadran si la suma es exacta) + estructural (ni `replace(` sobre el simbolo, ni `Number(` en el acumulador) |
| R56 | COT (T7B.5) · `un lote donde NINGUNA fila cotiza emite totales en cero` + INT · `ese caso responde 200, no 409` |

**Los 56 requisitos tienen al menos un test nombrado.**

---

## T16 - Gate

### `./init.sh --rapido` -> **se nego, como estaba previsto**

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/interfaces/repositories/ITarifaVigentePorTiendaRepository.ts
    lib/repositories/TarifaVigentePorTiendaRepository.ts
    lib/types/cotizacion.ts
✗ esto exige el gate completo. Corre: ./init.sh
```

Es un `fail`, no un aviso: el diff toca `lib/types/**` y dos archivos con nombre de dinero
(`tarifa`). Se corrio el completo.

### `./init.sh` completo

```
 Test Files  7 failed | 1254 passed (1261)
      Tests  71 failed | 16636 passed | 26 skipped (16733)
   Duration  453.25s
```

### Los 71 rojos NO son de esta feature. Atribucion medida:

**Todos los rojos viven en `tests/integration/db/`**, que son tests contra un Postgres real:

```
tests/integration/db/analytics-daily-job.test.ts
tests/integration/db/busqueda-comportamiento.test.ts
tests/integration/db/busqueda-sincronizacion-columna.test.ts
tests/integration/db/busqueda-usa-indice.test.ts
tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts
tests/integration/db/postulacion-recurso-migration.test.ts
```

**La prueba, en tres piezas:**

1. **La suite entera SIN ese directorio esta limpia:**

```
$ pnpm exec vitest run --exclude "tests/integration/db/**"
 Test Files  1148 passed (1148)
      Tests  15203 passed | 26 skipped (15229)
```

   **0 rojos.** Todo lo que no toca la base real pasa.

2. **La causa es de estado de la BASE LOCAL, no de codigo:**
   `no existe la relacion «postulacion_recurso»` y
   `The column (not available) does not exist in the current database`.
   Las migraciones que crean esas tablas **ya estan en el repo**
   (`20260820200000_postulacion_recurso`, `20260820210000_notificacion_evento_postulacion_recurso`,
   `20260731160000_orden_busqueda_trgm`, `20260808120000_orden_busqueda_producto`);
   lo que falta es **aplicarlas al Postgres local**.

3. **Son anteriores a esta rama:** esas migraciones entraron en `e69efc94` (feature 253), que es
   **ancestro** del punto de partida de esta rama (`8070b508`). Ya fallaban en el branch point.
   Y **este diff no toca ni un archivo de `tests/integration/db/`, ni `db/schema.prisma`, ni añade
   ninguna migracion** (T14, verificado con `git diff --stat db/` vacio).

**No se corrio `pnpm db:migrate`**: mutaria una base local real compartida con ~25 worktrees de
otras tareas, y reparar el entorno no es parte de esta feature. Queda señalado para quien aterrice
la rama.

### Las 7 suites de la 255, juntas

```
$ pnpm exec vitest run <los 7 archivos de la feature>
 Test Files  7 passed (7)
      Tests  149 passed (149)
```

### Resumen del gate

| Eje | Baseline (T0.1) | Ahora | Delta |
| --- | --- | --- | --- |
| `pnpm run typecheck` | 0 errores | **0 errores** | **0** |
| `pnpm run lint` | 0 errores / 97 warnings | **0 errores / 97 warnings** | **0** |
| `tests/unit/guards/` | 930 verdes | **935 verdes** (+5 del diente 6) | **0 rojos** |
| Suite sin `tests/integration/db/` | - | **15203 verdes, 0 rojos** | **0 rojos** |
| `tests/integration/db/` | rojo de origen (base sin migrar) | rojo, misma causa | **0 atribuibles** |

**Rojos atribuibles a la feature 255: 0.**
