# Feature 400 — bitácora BACKEND

> Rama `feat/400-fallo-config-no-bloquea-asignacion`. Alcance: **solo backend**.
> La fase 3 de `tasks.md` (T13, T13b, T14, T15, T16, T16b, T17) es **frontend** y NO se tocó.

---

## T0 — Confirmado en el árbol real (no en el grafo), 2026-09-09

El índice del MCP `codebase-memory` sí estaba disponible y se usó para localizar
`esAsignable`/`gateCoordenadas`/`EstadoAsignabilidad`, pero **los seis puntos se verificaron
abriendo el archivo**, que es lo que manda la regla 7 de `CLAUDE.md`:

| Punto del spec | Estado real |
| --- | --- |
| `AsignabilidadCoordenadasService.evaluar`, paso R5 por `estado === 'failed'` | ✅ existía, en `:96-100` como dice el spec |
| `GeocodificacionService` `case "config_invalida"` | ✅ existía, lanzaba `GeocodeIntentoFallidoError(outcome.detalle)` |
| guarda de credencial ausente (`GOOGLE_MAPS_API_KEY === null`) | ✅ existía, lanzaba `GeocodeNoConfiguradoError()` |
| `JobQueueService.mensajeError` recorta a 500 desde el principio | ✅ `MAX_ERROR_LEN = 500`, `raw.slice(0, MAX_ERROR_LEN)` |
| `JobDTO.lastError` en `IJobRepository` | ✅ `lastError: string \| null` |
| mapa `MOTIVO_A_MENSAJE` + guard de la 368 | ✅ los dos existen, con la forma que el spec describe |

**Ninguna corrección del spec fue necesaria.** El único matiz medido y no dicho en el spec: el
texto legado del fallo de configuración son **dos**, no uno (`REQUEST_DENIED` del cliente y
`GOOGLE_MAPS_API_KEY no esta configurada` de `GeocodeNoConfiguradoError`). El backfill (T18)
reconoce los dos; el `design.md` §7 solo nombraba el primero.

## T1 — Fotografía de producción: **NO EJECUTADA, y no por olvido**

La medición exige el **MCP de Supabase** (`DATABASE_URL` de prod es `sensitive`). **Ese MCP no
está en mi conjunto de herramientas** en esta sesión: solo tengo `codebase-memory`. No hay otra
vía de solo-lectura contra producción desde aquí.

**Queda para el leader**, con los tres números de T1. Recordatorio del spec: el resultado
esperado hoy es **0 jobs `failed`, 0 `pending`** con el texto legado — si aparece alguno, el
corte se repitió y hay que avisar antes de seguir.

---

## Archivos

### Creados
- `lib/geo/fallo-config-geocode.ts` — el marcador (T2)
- `scripts/backfill-marcador-config-geocode.ts` — reparación idempotente de un solo uso (T18)
- `tests/unit/geo/fallo-config-geocode.test.ts` (T2)
- `tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts` (T5)
- `tests/unit/services/geocodificacion-marcador-contrato.test.ts` (T6)
- `tests/integration/db/backfill-marcador-config-geocode.test.ts` (T19)

### Modificados
- `lib/services/GeocodificacionService.ts` — `GeocodeConfigInvalidaError` nuevo y marcado;
  `GeocodeNoConfiguradoError` marca; `GeocodeIntentoFallidoError` queda **solo** para
  transitorio, con su docstring reescrito (T3, T23)
- `lib/interfaces/services/IAsignabilidadCoordenadasService.ts` — `asignable_sin_ubicacion`,
  `EstadoAsignable`, `EstadoBloqueante` (T7)
- `lib/services/AsignabilidadCoordenadasService.ts` — paso nuevo en el árbol, `esAsignable` con
  dos valores, cabecera NORMATIVA y docstrings reescritos (T8, T9, T23)
- `lib/interfaces/services/IGuiaAsignacionService.ts`,
  `lib/interfaces/services/IAsignacionSateliteService.ts`,
  `lib/types/orden-guia.ts`, `lib/types/recepcion-satelite.ts` — `sinUbicacion?: number` en
  `ok`/`partial` (T10b)
- `lib/services/GuiaAsignacionService.ts`, `lib/services/AsignacionSateliteService.ts` — el
  conteo, sobre el mismo `Map` que ya se recorría (T10b)
- Tests extendidos: `asignabilidad-coordenadas`, `guia-asignacion-gate-coordenadas`,
  `asignacion-satelite-gate-coordenadas`, `geocodificacion-service`,
  `optimizacion-ruta-degradacion`

### T10 — ¿hubo que tocar los writers?
Para R6/R7/R10, **no**: los dos preguntan `esAsignable(estado)` y el estado nuevo pasa solo.
Lo verificado está en los dos gate-tests. Lo que **sí** cambió es por T10b (el conteo de R31):
`gateCoordenadas` pasa de devolver `DetalleConflicto[]` a `{ bloqueadas, sinUbicacion }`. Es un
helper **privado**: no toca ningún contrato compartido, y R27 (que prohíbe cambiar
`IJobRepository`) queda intacto — lo comprueba el guard de T5.

### T4 — literales de error viejos, decididos uno a uno
| Aserción | Decisión |
| --- | --- |
| `expect(error.message).toContain("GOOGLE_MAPS_API_KEY")` | **Se conserva**: ESE literal ERA el contrato (dice cuál es la config que falta, lo único accionable). La 400 solo le antepone el prefijo, así que sigue conteniéndolo. |
| `rejects.toBeInstanceOf(GeocodeIntentoFallidoError)` en el caso `config_invalida` | **Se actualiza a `GeocodeConfigInvalidaError`**, a mano y a propósito: esa aserción afirmaba que REQUEST_DENIED y un fallo de red eran el mismo desenlace, que es literalmente el bug. Se le añade la mitad negativa (`not.toBeInstanceOf(GeocodeIntentoFallidoError)`). |
| `rejects.toBeInstanceOf(GeocodeIntentoFallidoError)` en los transitorios | **Sin cambios**: sigue siendo cierto y ahora significa algo más estrecho. |

Ninguna aserción se sustituyó por «comparar contra la constante que la genera».

---

## Mapa R → test (los que cubre el backend)

| R | Test |
| --- | --- |
| R1 | `tests/unit/services/asignabilidad-coordenadas.test.ts::400/R1 — un job muerto por configuracion NUESTRA deja asignar sin ubicacion` (los tres estados) |
| R2 | idem `::400/R2 — sin marcador, la clasificacion vigente NO cambia ni una coma` (texto legado sin prefijo, `lastError` `null`, y mención del marcador en medio) |
| R3 | idem `::400/R3 — el paso nuevo va DESPUES de los que no tocan la cola y ANTES de los que clasifican por estado` (con coordenadas no se consulta `findByDedupeKeys`; el marcador gana a la rama por estado) |
| R4 | idem `::400/R4 — la ORDEN manda…`, parametrizado sobre `ZERO_RESULTS` / `INVALID_REQUEST` / `SIN_DIRECCION` |
| R5 | idem `::400/R5 — sin job, y con job \`done\`, el comportamiento vigente no cambia` |
| R6 | `guia-asignacion-gate-coordenadas.test.ts::400/…::400/R6` y `asignacion-satelite-gate-coordenadas.test.ts::400/…::400/R6` |
| R7 | los dos anteriores, `::400/R7: la escritura NO lleva latitud, longitud, geocodeStatus ni geocodedAt` (doble que lanza si se le pasan) |
| R8 | `geocodificacion-service.test.ts::400/R8 — guardarResultado escribe aunque la orden YA tenga mensajero` — con el **repositorio real** y un `prisma.orden.updateMany` doblado que captura el `where` literal |
| R9 | `optimizacion-ruta-degradacion.test.ts::400/R9 (92/R37, R28)` (4 casos) |
| R10 | `asignabilidad-coordenadas.test.ts::400/R10` + los dos gate-tests (`JSON.stringify(r)` no contiene `asignable_sin_ubicacion`) |
| R11 | `tests/unit/services/geocodificacion-marcador-contrato.test.ts::400/R11 — las DOS causas propias recorren el camino entero…` + `geocodificacion-service.test.ts::400/R11` (las dos causas) |
| R12 | `tests/unit/geo/fallo-config-geocode.test.ts::400/R12` (detalle de 2000 → recorte a 500 → sigue detectándose) + el caso de punta a punta en el contrato |
| R13 | `tests/unit/guards/marcador-fallo-config-declaracion-unica.guardia.test.ts` (declaración única + los dos imports + 3 contrapruebas) |
| R14 | `tests/unit/geo/fallo-config-geocode.test.ts::400/R14` (literal afirmado a mano, sin dígitos ni `@`) |
| R15 | Tests vigentes que siguen verdes: «el payload crudo persistido en la cache NO arrastra la direccion en claro» y «el mensaje de error no revela la credencial ni la direccion». `lib/clients/google-geocode.ts` **no se tocó** (`git diff` lo acredita) |
| R16 | `geocodificacion-marcador-contrato.test.ts::400/R16 — las causas AJENAS siguen bloqueando, una por una` (8 parametrizados × 2 estados + `handler no registrado`) + `geocodificacion-service.test.ts::400/R16` (×3) |
| R17 | `tests/integration/db/backfill-marcador-config-geocode.test.ts::R17: marca las candidatas, y correrlo DOS veces deja el marcador UNA sola vez` y `::R17: tras el backfill, el GATE REAL ya deja pasar la orden de la fila reparada` |
| R18 | idem `::R18: no cambia estado, intentos, run_after, dedupe_key, payload ni updated_at` y `::R18: NINGUNA fila testigo cambia su last_error` |
| R26 | Cubierto por R4 (y por R20, que es frontend). Los casos vigentes de dirección irresoluble siguen verdes sin tocarse |
| R27 | El guard de T5, bloque `400/T5 — R27`: `JobDTO` conserva `lastError` y tiene **exactamente** los 12 campos de siempre; el contrato de la cola no conoce el vocabulario de la geocodificación. Sin migración (`git diff` no toca `db/`) |
| R28 | **Requisito de NO-hacer.** Acreditado por `git diff`: no aparece el cron, ni el notificador, ni ningún reencolado. La única mención de "reencolado" en el diff es un comentario del backfill que declara que **eso es la 401** |
| R29 | **Requisito de NO-hacer.** `git diff` no toca `geocode_precision` / `geocodePrecision` en ninguna línea (verificado con `git diff -U0 \| grep`) |
| R30 | El guard de T5, bloque `400/T5 — R30`: la cabecera del gate cita el paso nuevo y la fecha; el párrafo de «intentos agotados ⇔ failed» lleva el matiz vigente; el docstring de `esAsignable` ya no afirma que `asignable` sea el único |
| R31, R32, R33, R35 | `guia-asignacion-gate-coordenadas.test.ts` y `asignacion-satelite-gate-coordenadas.test.ts`, bloques `400/R31`…`400/R35` — **la mitad de servicio**. La mitad de UI (el número en el DOM del modal) es T16b, de `frontend_dev` |

### Requisitos que NO cubre esta entrega (son frontend, fase 3 de `tasks.md`)
**R19, R20, R21, R22, R23, R24, R25, R34, R36** y la mitad de DOM de **R31-R33/R35**.
Tareas pendientes: **T13, T13b, T14, T15, T16, T16b, T17**.

Lo que les dejo listo y tipado: el estado `asignable_sin_ubicacion` en la unión, los tipos
`EstadoAsignable`/`EstadoBloqueante` (que es lo que hace exhaustivo el `Record` de T13), y el
campo `sinUbicacion?: number` en los cuatro tipos (`AsignarBodegaServiceResult`,
`AsignarSateliteServiceResult`, `AsignarBodegaResult`, `AsignarSateliteResult`).

⚠️ Aviso para `frontend_dev`: `app/(app)/_components/geocodificacion-motivo-messages.ts` sigue
usando `Map<string, string>` y **compila igual** con el estado nuevo. Que el árbol esté verde
NO significa que T13 esté hecho.

---

## Verificación

### Gate — `./init.sh --rapido` se negó, como el spec predijo
```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/types/orden-guia.ts
    lib/types/recepcion-satelite.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

### Gate — `./init.sh` completo (T21), con el árbol quieto
```
 Test Files  1832 passed (1832)
      Tests  26408 passed | 26 skipped (26434)
   Duration  994.96s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1832 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```
- `pnpm run typecheck` → limpio (sin salida).
- `pnpm run lint` → dentro del gate, sin hallazgos.
- El aviso de `down.sql` es **preexistente** (tres migraciones de la 265, agosto). Esta ficha no
  añade ninguna migración.

### Los `skipped`, mirados de verdad
**26 saltados, y ninguno es mío.** Están en `tests/components/AnaliticaPage.test.tsx` (17) y
`tests/components/AnaliticaShell.test.tsx` (9), preexistentes.

**`tests/integration/db/` corrió entero: 224 archivos.** El del backfill aparece en el log como
`✓ tests/integration/db/backfill-marcador-config-geocode.test.ts (6 tests) 466ms`. (Hubo que
copiar el `.env` del árbol principal al worktree: sin él, esa carpeta se salta entera y el
«init OK» no habría significado nada.)

### Mutaciones — 7 aplicadas, 7 muertas
Cada una: copia de seguridad del archivo → mutación → corrida → restauración desde la copia
(sin `git checkout`, para no arrastrarme nada de otra sesión).

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | `GeocodeConfigInvalidaError` deja de marcar (`super(detalle)`) | **6 rojos** en `geocodificacion-marcador-contrato` + `geocodificacion-service` |
| M2 | El predicado del paso nuevo del gate se anula (`false && …`) | **14 rojos** en contrato + `asignabilidad-coordenadas` + la integración del backfill |
| M3 | `esAsignable` vuelve a aceptar solo `"asignable"` | **15 rojos** en los dos gate-tests + `asignabilidad-coordenadas` |
| M4 | Se borra el conteo de `sinUbicacion` en **el writer de bodega** | **4 rojos**, y el archivo del satélite **queda verde** — exactamente el fallo asimétrico que `design.md` §9 quería poder distinguir |
| M5 | `OptimizacionRutaService` deja de excluir las paradas sin coordenadas | **3 rojos** en `optimizacion-ruta-degradacion` (T11) |
| M6 | El `UPDATE` del backfill pierde su `NOT LIKE marcador` (idempotencia) | **2 rojos** en la integración: marcador duplicado y una testigo tocada |
| M7 | `OrdenGeocodeRepository.guardarResultado` añade `mensajeroAsignadoId: null` a su `WHERE` | **1 rojo** (R8): el test compara el `where` **literal**, no `objectContaining` |

Ninguna sobrevivió.

---

---

# Segunda tanda — cierre de reservas de la revisión (2026-09-09)

`progress/review_400.md` aprobó con reservas: cero bloqueantes, diez menores. El leader me asignó
tres. Lo demás de la revisión —el gate exacto, las dos desviaciones y el backfill probado e
idempotente de verdad— no se tocó.

## `menor-1` — el eslabón de ARRIBA del tipado, cerrado (PRIORITARIO)

**El hallazgo era correcto y era mío.** El guardia `400/T13` anclaba en la anotación del mapa
(`Record<EstadoBloqueante, string>`), que es el eslabón de abajo. Pero la exhaustividad de R25
cuelga de dos, y el de arriba —que `EstadoBloqueante` siga **derivándose** con
`Exclude<EstadoAsignabilidad, EstadoAsignable>`— no lo protegía nadie. `MUT-2` del reviewer lo
midió: reescribirlo a mano con los cinco literales y añadir un sexto estado bloqueante dejaba
**typecheck limpio y 1999 tests verdes**.

Arreglo: **dos aserciones y una contraprueba** en el guardia que ya existe
(`tests/unit/guards/geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts`, bloque
`400/T13`), leyendo `lib/interfaces/services/IAsignabilidadCoordenadasService.ts`:

1. la parte derecha de `export type EstadoBloqueante = …;` es **exactamente**
   `Exclude<EstadoAsignabilidad, EstadoAsignable>`;
2. esa declaración **no contiene ni una comilla ni ninguno de los siete estados** — o sea, no es
   una lista escrita a mano. Con no-vacuidad explícita (`expect(declaracion).not.toBeNull()`),
   porque si el detector devolviera `null` las dos aserciones pasarían por vacío.

### MUT-2 reproducida, y muerta

Aplicada tal cual la describe el informe (derivación → cinco literales a mano, + un sexto estado
`geocodificacion_cuota_agotada` en `EstadoAsignabilidad` sin mensaje en el mapa):

- **`pnpm run typecheck` → LIMPIO.** Confirmado: el compilador no puede ver esto, tal como decía
  el reviewer. Ahí es donde vivía el silencio.
- **El guardia → 2 rojos**, en el mismo archivo:

```
× menor-1: `EstadoBloqueante` se DERIVA con `Exclude`, nunca se escribe a mano
  AssertionError
  Expected: "Exclude<EstadoAsignabilidad, EstadoAsignable>"
  Received: "| "direccion_no_geocodificable" | "geocodificacion_agotada" | "geocodificacion_en_curso" | "geocodificacion_encolada" | "geocodificacion_no_encolable""

× menor-1: y su declaración no contiene NI UN literal de estado (eso sería la lista a mano)
  AssertionError: expected '| "direccion_no_geocodificable" | "ge…' not to contain '"'

 Test Files  1 failed (1)
      Tests  2 failed | 13 passed (15)
```

Restaurado desde copia de seguridad (no con `git checkout`, para no arrastrar nada de otra sesión).

## `menor-2` — salió gratis al tocar el guardia, así que está cerrado

El coordinador lo dejó opcional («si te sale gratis»). Salió: `tipoDelMapa` y el detector nuevo
pasan ahora el código por `quitarComentarios` de `tests/fixtures/sin-comentarios.ts` —el quitador
único del repo, el que usan 171 suites—, así que `String.match` ya no puede leer un comentario
señuelo en vez de la declaración real.

**MUT-1c reproducida y muerta**: comentario señuelo con la anotación buena encima, y la real como
`Record<EstadoBloqueante | string, string>`.

```
× `MOTIVO_A_MENSAJE` se declara como `Record<EstadoBloqueante, string>`
  Expected: "Record<EstadoBloqueante, string>"
  Received: "Record<EstadoBloqueante | string, string>"

 Test Files  1 failed (1)
      Tests  1 failed | 14 passed (15)
```

De paso, el barrido de `Record<string, string>` / `Map<string, string>` también corre ahora sobre
el código sin comentarios: la cabecera del módulo **nombra** las formas prohibidas para explicar
por qué lo están, y denunciar esa explicación obligaría a borrarla.

## `menor-3` — `ejecutarCli` del backfill, probado antes de que toque producción

Nuevo: `tests/unit/scripts/backfill-marcador-config-geocode-cli.test.ts` (14 tests), patrón de
`backfill-caja-tesoreria-cli.test.ts`. Toda la I/O va inyectada, así que no hace falta ni DB ni
proceso hijo. Cubre:

- **sin `--apply` no se llama a `$executeRaw` ni una vez** —la única escritura del script—, con
  no-vacuidad (`$queryRaw` sí se llamó dos veces, así que el cero no es «no corrió nada»);
- **una errata en el flag se RECHAZA con código 2**, parametrizado sobre `--aply`, `--applY`,
  `-apply`, `--apply-todo` y `aplicar`, y también `--apply --forzar`. Ese era el modo de fallo
  peligroso: quien escribe mal el flag creería haber aplicado el backfill mientras el script corre
  como simulación, imprime un número y sale con 0;
- **la conexión es perezosa**: con argumentos inválidos, `crearCliente` no se llama;
- **la salida dice el número** (lo que hay que poder decirle al humano antes de tocar producción) y
  el desglose por estado, `pending` incluidos;
- **nada de lo impreso contiene la URL de la base ni su contraseña**;
- importar el módulo no imprime, no cambia `process.exitCode` y no toca la base.

**Dos mutaciones, las dos muertas:**

| Mutación | Resultado |
| --- | --- |
| `const aplicar = entorno.argv.includes("--apply")` → `= true` | **2 rojos**: los dos casos de «sin `--apply` no escribe» |
| El rechazo de argumentos desconocidos se anula (`if (false && …)`) | **6 rojos**: los cinco flags con errata + el caso combinado |

## `menor-8` — el spec, al día con las correcciones

- **`design.md` §7**: nota de corrección — los textos legados son **dos**, no uno. El de
  `REQUEST_DENIED` y el de `GOOGLE_MAPS_API_KEY no esta configurada`. Un `WHERE` que solo mirara el
  primero dejaría fuera los jobs muertos por credencial ausente, que son igual de nuestros. Y el
  bullet del alcance del `WHERE` ahora nombra los dos fragmentos.
- **`requirements.md`, fila R8**: el test vive contra `OrdenGeocodeRepository` (el repositorio
  **real**, con `updateMany` doblado que captura el `where` literal), no contra el service — porque
  lo que R8 afirma **es** el `WHERE`, y un doble del repositorio no lo ve.
- **`requirements.md`, fila R15**: `google-geocode.test.ts` **no se extendió** y no hacía falta: su
  caso vigente ya barre `REQUEST_DENIED` pese a llamarse «transitorio».

## `menor-4` — cerrado: fuera el `.env`, dentro el `export`

`.env` **borrado del worktree**. El gate de esta tanda corrió con `DATABASE_URL` **exportada**
desde el árbol principal, sin copiar el archivo (`docs/verification.md` lo prohíbe expresamente).
El valor no se imprime en ningún sitio: el guion solo ecoa su longitud y su prefijo.

## Lo que sigue sin hacerse, y por qué

- **`menor-5` / T17** — deuda declarada, se cierra en el despliegue. Falta ver los casos 1 y 2 con
  datos reales y **mirar el toast real**: la frase concatenada pasa de 180 caracteres y en los
  tests el toast es un doble.
- **`menor-7`** (ficha en `feature_list.json` + entrada en `progress/history.md`) — del leader.
- **`menor-6`, `menor-9`, `menor-10`** — declarados en la revisión, sin acción por mi parte.
- **T20** (dry-run del backfill contra producción) — depende del despliegue. Ahora, además, con su
  punto de entrada probado.

## Gate de la segunda tanda

`./init.sh` **completo** (el rápido se niega solo: la rama toca `lib/types/`), con `DATABASE_URL`
**exportada** y **sin `.env` en el worktree**. Log en `/tmp/init-400-final.log`.

```
 Test Files  1833 passed (1833)
      Tests  26477 passed | 26 skipped (26503)
   Duration  669.86s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1833 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
! no hay .env. Crea uno a partir de .env.example
== init OK ==
INIT_EXIT=0
```

- `pnpm run typecheck` → limpio.
- El aviso de `down.sql` es preexistente (tres migraciones de la 265, agosto).
- **El aviso `! no hay .env` es exactamente lo que se buscaba**: el gate lo dice, y aun así
  `integration/db` corrió **entera — 224 archivos, 0 rojos** — porque `DATABASE_URL` iba
  exportada. Es la prueba de que `menor-4` se cierra sin perder cobertura.
- **26 saltados, los mismos de siempre y ajenos**: `AnaliticaPage.test.tsx` (17) y
  `AnaliticaShell.test.tsx` (9).
- Los cuatro archivos de esta tanda, verdes en el log:
  `backfill-marcador-config-geocode.test.ts` (6), `backfill-marcador-config-geocode-cli.test.ts`
  (14), `geocodificacion-motivo-por-orden-mismo-modulo.guardia.test.ts` (15, eran 12),
  `marcador-fallo-config-declaracion-unica.guardia.test.ts` (14).

### Dos corridas descartadas antes de esta, y por qué se descartaron

No las escondo porque las dos enseñan algo que va a volver a pasar:

1. **La primera exportó una `DATABASE_URL` inválida.** El `.env` de este repo entrecomilla el
   valor con **comillas simples** y mi extracción solo quitaba las dobles, así que exporté una URL
   que empezaba por `'`. Efecto: las suites de `integration/db` **fallaron al conectar** —no se
   saltaron, fallaron—, con 62 archivos rojos. El guion ahora quita las dos formas y **aborta si
   el prefijo no es `postgres`**, antes de gastar los 17 minutos.
2. **La segunda la invalidé yo al editar el guion mientras corría.** `bash` relee el archivo por
   offset entre comandos, así que la edición se ejecutó desde una posición vieja: el log quedó
   truncado y con dos corridas encima. El veredicto era irreproducible, así que se tira entero —
   un gate cuya procedencia no puedo explicar no vale como evidencia. **No se edita un guion que
   está corriendo.**

El gate que se reporta arriba es una corrida limpia, de principio a fin, sobre un guion que no se
tocó (`gate-400-final.sh`).

---

## Notas y deuda

1. **El spec no está commiteado.** `specs/400-fallo-configuracion-geocodificador-no-bloquea/`
   existe en el árbol principal pero **sin commitear en ninguna rama**; por eso no viaja en este
   commit. Que lo commitee quien corresponda antes de que el reviewer lo necesite.
2. **T20 queda abierta** (depende del despliegue): correr el `--dry-run` contra producción.
   Resultado esperado, 0 candidatas. **Puerta humana solo si sale > 0.** El script imprime el
   número sin escribir nada; escribir exige `--apply` explícito.
3. **El marcador es un prefijo de 16 caracteres** que se come parte de los 500 de `last_error`.
   Medido: irrelevante para el diagnóstico (los mensajes reales rondan los 80 caracteres).
4. **Dos textos legados, no uno** (ver T0). El backfill reconoce los dos; `design.md` §7 solo
   nombraba el de `REQUEST_DENIED`.

---

## T1 — Fotografía de producción (ejecutada por el leader, en SOLO LECTURA)

**Medida el 2026-09-10 a las 00:22:16 UTC** vía el MCP de Supabase (`DATABASE_URL` de prod es
`sensitive`). El implementador no pudo ejecutarla: ese MCP no está en su conjunto de herramientas.

| Qué | Valor |
| --- | --- |
| Jobs `geocodificacion` en `pending` / `failed` / `processing` | **0 / 0 / 0** |
| De ellos, con el `last_error` legado del fallo de configuración | **0** |
| Órdenes vivas sin `latitud`/`longitud`, **sin** `geocode_status` | **0** |
| Órdenes vivas sin `latitud`/`longitud`, **con** `geocode_status` determinista | **2** (ambas `ZERO_RESULTS`) |
| Último geocode con éxito | **2026-09-09 23:01:04 UTC** |

**Lectura:** la credencial sigue funcionando (último éxito ~1 h 20 min antes de la medición) y el
corte del 8-sep NO se ha repetido: cero jobs vivos con el marcador de fallo de configuración. Las 2
órdenes sin coordenadas son el caso LEGÍTIMO que esta ficha deja bloqueado a propósito —dirección
irresoluble, no fallo nuestro—; eran 1 a las 15:41 UTC y apareció una segunda durante la tarde.

**Confirma lo que ya decía la corrección del spec:** hoy no hay nada que desbloquear, así que T20
(dry-run del backfill tras el despliegue) debe encontrar **0 candidatas**. Si encontrara más, es que
el corte se repitió y hay que avisar antes de seguir.

Consultas usadas (solo lectura, sin escribir nada):

```sql
select count(*) from jobs where tipo='geocodificacion' and estado='pending';   -- y failed / processing
select count(*) from jobs where tipo='geocodificacion' and estado<>'done'
  and (last_error like '%REQUEST_DENIED%' or last_error like '%no esta configurada%');
select case when geocode_status is null then 'sin geocode_status'
            else 'determinista: ' || geocode_status end, count(*)
  from orden where deleted_at is null and latitud is null group by 1;
select max(created_at) from geocode_cache;
```
