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
