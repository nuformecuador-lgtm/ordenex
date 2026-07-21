# Review — Feature 92 · Optimización de ruta del mensajero (mitad BACKEND)

Worktree `ordenex-f92`, rama `feature/92-optimizacion-ruta-mensajero`, commit `172a835`
sobre base `origin/dev` @ `5244cf3`. Revisor: agente `reviewer`. Fecha: 2026-07-20.

Alcance revisado: **R1–R8, R10–R28, R33–R40**. R9, R25 (captura GPS en navegador) y R29–R32
son de la feature 93 y se verifica que **no** estén implementados aquí.

> **Toda cifra de este documento sale de un comando ejecutado por el revisor.** Nada se cita
> de la bitácora del implementador sin re-medirlo.

---

## 1. Checklist de CHECKPOINTS.md

### Especificación
- [x] `specs/92-.../requirements.md` con requisitos EARS numerados R1..R40.
- [x] `specs/92-.../design.md` con alternativas descartadas y su porqué (§4.1 alternativa D,
      §9.B una-columna-en-`orden`).
- [ ] **`tasks.md` con todas las tasks marcadas `[x]` → FALLA.** Medido: 0 marcadas,
      23 sin marcar (T0–T22). Ver hallazgo B1.

### Trazabilidad
- [x] Cada `R<n>` del alcance mapea a al menos un test concreto que existe y pasa.
- [x] `progress/impl_92.md` contiene el mapa `R<n> → test` completo.

### Calidad de código
- [x] `pnpm typecheck` — 0 errores (verificado independientemente por el leader tras el commit).
- [x] `pnpm lint` — medido: **143 problems (0 errors, 143 warnings)**. 0 errores, sin
      warnings nuevos respecto del baseline.
- [ ] `pnpm test` en verde → **FALLA por deuda AJENA preexistente**, no por esta feature.
      Ver §4: el conjunto de tests rojos en HEAD es idéntico al del baseline (36 = 36,
      diferencia vacía). Hallazgo m1.
- [x] Flujos críticos: no aplica E2E nuevo (no toca auth, pagos, recaudo ni webhooks).

### Datos y seguridad (Supabase)
- [x] RLS activada **sin policies** en las dos tablas nuevas — verificado contra Postgres real.
- [x] Migraciones versionadas y reversibles; round-trip UP → DOWN → RE-UP ejecutado por el
      revisor (§3).
- [x] Ningún secreto hardcodeado: grep de patrones PEM y de API key de Google sobre `lib/` y
      `app/` (excluyendo tests) → **0 coincidencias**.
- [x] Webhooks: no aplica (no se añade ninguno).

### Patrón de capas
- [x] Controller sin queries ni lógica: el único archivo de `app/` es el registro del handler
      en `app/api/cron/procesar-jobs/route.ts`.
- [x] Services sin HTTP: `OptimizacionRutaService` y `AsignabilidadCoordenadasService` no
      conocen `Request`/`Response`; el HTTP vive en `lib/clients/google-route-optimization.ts`.
- [x] Interfaces en `lib/interfaces/` separadas por categoría (`external/`, `repositories/`,
      `services/`).

### Permisos y multi-país
- [x] `sincronizarRuta` valida rol en el servidor **antes de parsear** el payload.
- [x] Mutación interna vía Server Action, no fetch a API route.
- [x] Sin hardcode de país, moneda ni cuenta.

### Verificación final
- [ ] `./init.sh` en verde → falla por los rojos preexistentes (m1).
- [x] `progress/review_92.md` existe (este archivo).
- [ ] Entrada en `progress/history.md` → pendiente (paso del leader tras el review).

---

## 2. Verificación por MUTACIÓN de los 4 invariantes críticos

Precedente que motiva esta sección: en la feature 82 hubo guardias que corrían sobre un mock y
no protegían nada. Se rompió el código de producción a propósito, se midió, y se **restauró**.
`git status --short` y `git diff --stat` al final: **ambos vacíos** (árbol limpio, cero residuo).

| # | Invariante | Mutación aplicada | Resultado |
| --- | --- | --- | --- |
| 1 | `estado='failed'` es el ÚNICO predicado de "intentos agotados" | predicado cambiado a `intentos >= maxIntentos` | **ROJO — 3 tests fallan** |
| 2 | `orden.geocodeStatus` es la fuente de verdad (no `jobs`) | se elimina la rama R3; el clasificador cae a consultar solo `jobs` | **ROJO — 4 tests fallan** |
| 3a | Espacios de claves DISJUNTOS `:debounce:` / `:inmediato:` | el namespace del inmediato pasa a ser el del debounce | **ROJO — 2 tests, en los 2 archivos** |
| 3b | La clave de debounce lleva VENTANA TEMPORAL (trampa Q4 de la 91) | se elimina el componente de ventana de la clave | **ROJO — 4 tests fallan** |
| 4 | R14 — no fuga de secretos ni PII | el catch de red pasa a emitir el mensaje del error subyacente | **ROJO — 1 test falla** |

**Los 4 invariantes (5 ensayos contando 3a/3b) están genuinamente protegidos.** Ninguna
guardia es decorativa. Detalle relevante de cada una:

1. El test que se pone rojo es explícitamente normativo: "`processing` con
   intentos === maxIntentos NO es agotado", con una aserción negativa sobre
   `geocodificacion_agotada`. El razonamiento del spec es correcto y está verificado en el
   código: `claimBatch` incrementa `intentos` **al reclamar**, así que `intentos >= maxIntentos`
   bloquearía órdenes que corren su último intento y todavía pueden resolverse.
2. El test asserta además que el encolado **no** se llama — es decir, protege específicamente
   el bucle de re-encolado que **pagaría a Google cada vez**. Es la guardia correcta, no una
   comprobación de forma.
3. Sin la ventana temporal, la fila `done` (que no se purga) dejaría la clave ocupada para
   siempre y toda recogida posterior se descartaría en silencio. La ventana existe y está
   fijada por test. Y sin namespaces disjuntos, el `ON CONFLICT DO NOTHING` tragaría en
   silencio la reoptimización de la gestión.
4. El bloque `describe("R14 …")` usa una lista de prohibidos con token, projectId, host,
   coordenadas literales y `ordenId`, y la aplica a **todos** los desenlaces (429/500/401/403,
   fallo de red) y a **todos** los errores lanzados. `google-sa-token.test.ts` tiene su gemelo
   con email, clave privada, la cadena "BEGIN PRIVATE KEY" y el token, y además asserta que el
   JWT firmado no aparece en ningún mensaje. La PII de dirección y coordenadas nunca entra al
   payload del job: el encolado manda **solo** el `mensajeroId`. El schema zod de respuesta
   **no** lleva `.passthrough()` — el incidente de la 91 no se repite.

---

## 3. Round-trip de migraciones — REPETIDO por el revisor

**Sí corrió de verdad, de forma independiente.** Postgres 16 en docker desechable
(`ordenex-rev92-pg`, puerto 55932), **nunca** contra la DB del `.env`: se aplicó vía `psql`
dentro del contenedor, sin Prisma y sin leer `.env` en ningún momento. `.env` intacto al
terminar; contenedor eliminado.

Cada `migration.sql` se aplicó **en su propia transacción** (`psql --single-transaction`), que
es exactamente lo que hace Prisma Migrate — sin eso, la prueba de 55P04 no valdría nada.

```
UP     -> 60 migraciones aplicadas sin error
          job_tipo    = liberar_reprogramadas, geocodificacion, optimizacion_ruta
          ruta_estado = vigente, desactualizada
          ruta_optimizada        : rowsecurity=true, policies=0
          ruta_optimizada_parada : rowsecurity=true, policies=0
          indices = 6 . FKs = 3 . job_tipo_old presente = 0

DOWN   -> ambos down.sql OK
          job_tipo = liberar_reprogramadas, geocodificacion   (sin optimizacion_ruta)
          residuo ruta_estado  = 0     residuo tablas      = 0
          residuo job_tipo_old = 0     residuo indices     = 0
                                       residuo constraints = 0

RE-UP  -> ambas migraciones re-aplicadas sin error

DOWN#2 -> repetido CON una fila viva jobs.tipo='optimizacion_ruta':
          el DELETE previo del down.sql funciona; el ALTER TYPE ... USING no revienta.
```

**55P04 confirmado empíricamente**, no asumido. Ejecutando en una sola transacción el
`ALTER TYPE ADD VALUE` junto a un consumo del valor nuevo:

```
ERROR: unsafe use of new value "optimizacion_ruta" of enum type job_tipo
HINT:  New enum values must be committed before they can be used.
```

La migración aislada de R40 es, por tanto, **necesaria**, no ceremonial. El `down.sql` del enum
**recrea** el tipo (Postgres no soporta `DROP VALUE`), criterio idéntico al de la 91.

---

## 4. Regresiones — medición rigurosa

La suite completa de este repo es **flaky bajo carga**: tres ejecuciones completas dieron 12,
12 y 18 archivos rojos. Los archivos que fluctúan son todos tests de componentes
(`testing-library` con `findBy*`/`waitFor`, sensibles a timing). Por eso una comparación
"N rojos antes vs N rojos después" no concluye nada.

Comparación **determinista**: se ejecutó la unión de los 18 archivos rojos observados, aislada,
con el reporter JSON, en HEAD y en un worktree limpio del baseline `5244cf3` (node_modules
compartido por junction), y se comparó el conjunto de tests fallidos **por nombre completo**:

```
fallos HEAD: 36 | fallos BASE: 36
=== SOLO EN HEAD (regresiones candidatas) ===   (vacio)
=== SOLO EN BASE ===                            (vacio)
```

**Cero regresiones. El conjunto de fallos es idéntico, test a test.**

Casos que merecían comprobación explícita:

- `tests/unit/actions/mis-asignaciones-action.test.ts` **es un archivo que la 92 modificó** y
  está rojo. Verificado en el baseline aislado: falla **igual** (1 failed, 20 passed), en el
  mismo test ("R22: entrega con monto <= 0"). El diff de la 92 sobre ese archivo es puramente
  aditivo sobre un doble de test (añade el bloque `ruta`) y no toca el test que falla. **No es
  regresión.**
- `generar-gastos-fijos-route.test.ts` sigue rojo: deuda **ajena de la feature 90** (afirma un
  `/api/cron/liberar-reprogramadas` en `vercel.json` que la 90 sustituyó por
  `/api/cron/procesar-jobs`). Confirmado; no debe arreglarse aquí.

### Tests de la feature, aislados (medido)

```
13 archivos unitarios       -> Test Files 13 passed (13) . Tests 173 passed (173)
 5 archivos de integracion  -> Test Files  5 passed  (5) . Tests  46 passed  (46)
--------------------------------------------------------------------------------
TOTAL                       -> 18 archivos . 219 tests . 219 verdes
```

Coincide exactamente con lo declarado en la bitácora.

---

## 5. Alcance — no hay fuga hacia el frontend

El diff contra `app/` devuelve **exactamente 1 archivo**:
`app/api/cron/procesar-jobs/route.ts` (el registro del handler).

Archivos `.tsx` tocados: **solo 3, y los 3 son tests** (`EscanerRecoger.test.tsx`,
`MisAsignacionesModule.test.tsx`, `MisAsignacionesPage.test.tsx`), modificados únicamente para
ampliar dobles con los campos nuevos del contrato. **Cero componentes nuevos, cero UI nueva,
cero hooks.** No existe `hooks/useUbicacionActual.ts` (T17 es de la 93). Confirmado.

---

## 6. Contrato para la feature 93 — completo y usable

Hoy no tiene consumidor (mismo caso que la 91 con las coordenadas), así que solo los tests lo
ejercitan. Verificado punto por punto:

1. **`MiAsignacionDTO.secuenciaRuta: number | null`** — `IMisAsignacionesService.ts:36`. OK
2. **`ruta: { estado, calculadaAt, origenFuente, paradasSinOptimizar }`** — `RutaResumenDTO` en
   `IMisAsignacionesService.ts:44-59`, expuesto en `ListarMisAsignacionesResult`
   (`gestion-orden.ts:160`). `origenFuente` es una unión cerrada
   `"gps" | "ultima_conocida" | "centroide" | null`. OK
3. **`porGestionar` sale YA ORDENADO del service** — el reordenado vive en
   `MisAsignacionesService` (`:134`), no en el repositorio. Posición asc primero; las que no
   tienen posición van al final **conservando** su `createdAt desc` gracias a la estabilidad de
   `Array.sort` (ES2019). **`porRecoger` no se ordena en ningún punto** (solo se hace `push`):
   R29 se respeta, el orden heredado queda intacto. OK
4. **`sincronizarRuta({ ubicacion? })`** en `lib/actions/ruta-mensajero.ts`: **síncrona**
   (hace `await service.ejecutar(...)`, no encola), `forbidden` si rol distinto de `mensajero`,
   `conflict` antes del intervalo mínimo. 11 tests, incluido "el rol se comprueba ANTES de
   parsear" (un payload inválido de un rol ajeno da `forbidden`, no `validation_error` — el
   orden correcto) y "un error DESCONOCIDO no se disfraza de conflict". OK
5. **Los 3 services de asignación** devuelven `conflict` con `detalle` por orden y `motivo` de
   los 5 estados no-asignables, **todo-o-nada por lote** — cubierto por
   `guia-asignacion-gate-coordenadas.test.ts` y `asignacion-satelite-gate-coordenadas.test.ts`,
   ambos verdes y ambos sensibles a las mutaciones 1 y 2. OK

---

## 7. Los 2 tests heredados modificados — NO se aflojaron

Precedente vigilado: el PR #75 aflojó un test. Revisado con lupa.

- **`procesar-jobs-geocodificacion.test.ts`** — la aserción `handlers.size === 2` se sustituye
  por la igualdad con el **conjunto exacto** de claves registradas. **Queda estrictamente más
  fuerte.** El `size` numérico no detectaba la **sustitución** de un tipo por otro (registrar A
  en vez de B mantiene el conteo); la igualdad de conjunto sí detecta la pérdida, la
  sustitución y el alta no declarada. Endurecimiento real, no cosmético.
- **`zonas-migration.test.ts`** — solo se añaden dos entradas a la allow-list de carpetas
  (`_job_tipo_optimizacion_ruta`, `_ruta_optimizada`). **La aserción no cambia**: sigue siendo
  el mismo `>=` sobre timestamps. Es el mismo mantenimiento que hicieron la 90 y la 91. OK

---

## 8. Las 2 decisiones autónomas del implementador — ambas CORRECTAS

- **`shipmentIndex` opcional con default 0.** La premisa es **cierta**: la codificación
  proto3-JSON de Google omite los campos con valor por defecto, de modo que un `shipmentIndex`
  igual a 0 **no aparece** en la respuesta. Declararlo obligatorio rompería toda ruta que
  empiece por la primera parada — es decir, casi todas. Hay test dedicado y explícito
  ("TRAMPA PROTO3-JSON: `shipmentIndex` AUSENTE significa 0, no 'campo faltante'"), que envía
  una primera visita vacía y espera la secuencia completa. Decisión correcta, no fuga de
  alcance. El riesgo residual (confundir "ausente" con un 0 legítimo) queda acotado por las
  tres validaciones estructurales: índice fuera de rango, índice repetido y cobertura
  incompleta; las tres lanzan.
- **Un 4xx que no sea 401/403 lanza `RutaPeticionRechazadaError` en vez de `transitorio`.**
  Correcta. Un 400 es un fallo propio (modelo mal formado); tratarlo como transitorio lo
  condenaría a 5 reintentos **facturados** y a un dead-letter sin diagnóstico. Test: "HTTP 400
  -> RutaPeticionRechazadaError (ruidoso, NO disfrazado de transitorio)". La taxonomía de R15
  se respeta: 401/403 -> `config_invalida`; 429 y 5xx -> `transitorio`; red/timeout ->
  `transitorio`.

---

## 9. Deps nuevas: requeridas, no opcionales

- `GuiaAsignacionService` (`:71`) y `AsignacionSateliteService` (`:55`) reciben
  `private readonly asignabilidad: IAsignabilidadCoordenadasService` **posicional y sin `?`**.
  El grep de `asignabilidad?` sobre ambos devuelve **0 coincidencias**. Una fábrica futura que
  lo olvide **no compila**; el gate no puede desactivarse en silencio. OK
- `MisAsignacionesService` recibe `rutaRepo` **requerido**, al final de la lista (no rompe el
  orden existente). OK
- `GestionOrdenRepository` (`:81`) tiene `jobRepo` **con default** (`= new JobRepository(prisma)`),
  no estrictamente requerido. Matiz importante: el default **no** es `undefined` ni un no-op,
  sino una implementación **real** enlazada al mismo cliente Prisma. Por tanto el modo de fallo
  que preocupaba (una fábrica futura desactiva el outbox en silencio) **no puede ocurrir**:
  omitir el argumento sigue encolando de verdad. Se registra como menor (m2) por divergir de lo
  esperado, no como riesgo.

---

## 10. Coste — acotados presentes

Verificados en `OptimizacionRutaService.ts`, todos con test en
`optimizacion-ruta-service.test.ts`:

| Guarda | Efecto | Ubicación |
| --- | --- | --- |
| **R20** obsolescencia (`job.createdAt` anterior a `ruta.calculadaAt`) | 0 llamadas | `:93` |
| **R34** intervalo mínimo del botón manual | 0 llamadas | `:106` |
| **R35** 0 o 1 parada con coordenadas | 0 llamadas (persiste la secuencia trivial) | `:125` |
| **R36** misma huella de conjunto + mismo origen y ruta `vigente` | 0 llamadas | `:163-171` |
| **R37** órdenes sin coordenadas | se excluyen, no abortan | `:118` |
| **R38** tope `RUTA_MAX_PARADAS` | se recorta, no se paga el exceso | `:150` |

Detalle bien resuelto: la huella de R36 **ordena los ids antes de hashear** (identifica el
conjunto, no el orden de lectura) y **redondea el origen a 4 decimales, unos 11 m**, para que
el jitter del GPS parado en un semáforo no invalide la huella y dispare una llamada facturada.
Es un cuidado real de coste, no una casilla marcada.

---

## 11. Hallazgos

### BLOQUEANTE

**B1 — `tasks.md` no tiene ninguna task marcada `[x]`.**
Medido: 0 de 23 marcadas (T0–T22 siguen en `[ ]`). `CHECKPOINTS.md` lo exige de forma explícita
e inequívoca ("todas las tasks estan marcadas `[x]`"), y es un criterio que este review está
mandatado a verificar.

Qué falta para cumplirlo:

1. Marcar `[x]` las tasks efectivamente entregadas en este commit: **T0–T16, T20, T21, T22**.
2. **T17, T18 y T19 son de la feature 93** (hook de geolocalización, módulo del mensajero,
   toasts del gate). No deben marcarse `[x]` aquí; deben quedar anotadas como diferidas a la 93,
   igual que la bitácora ya hace con R9/R29–R32. Dejarlas en `[ ]` sin nota deja el fichero
   ambiguo para quien retome la 93.
3. Ojo con T22: su criterio de "Hecho" dice "`pnpm test` sin errores", que hoy **no se cumple**
   por deuda ajena (m1). Al marcarla hay que anotar la excepción medida, no darla por verde en
   silencio.

Es un defecto de **bookkeeping**, no de código: **no requiere reimplementar nada** y toda la
verificación técnica pasó. Pero es un checkpoint que falla, y el veredicto se rige por eso.

### Menores

**m1 — `./init.sh` y `pnpm test` no terminan en verde.**
Deuda **preexistente y ajena**, demostrada: el conjunto de tests fallidos en HEAD es idéntico al
del baseline `5244cf3` (36 = 36, diferencia vacía, comparado por nombre completo). No debe
arreglarse en esta feature. Se registra porque el checkpoint queda formalmente incumplido y
porque conviene que el leader decida qué hacer con esta deuda antes de que siga creciendo (ya
arrastra desde la 90). Añadido: **la suite es flaky bajo carga** (12/12/18 archivos rojos en
tres corridas). Eso hace que "N rojos" sea una métrica inútil para futuros reviews y merece
feature propia de estabilización.

**m2 — `GestionOrdenRepository.jobRepo` tiene default en vez de ser requerido.**
Ver §9. El default es una implementación real, así que no puede desactivar el outbox en
silencio. Divergencia de criterio respecto de las otras deps nuevas, sin riesgo asociado.

**m3 — `lib/actions/mis-asignaciones.ts` conserva dos `console.log("xyz AAA*", actor)`.**
Verificado con `git show 5244cf3:...`: **ya estaban en `dev`** (líneas 101 y 104), la 92 no los
introdujo, y la bitácora los reporta correctamente sin arrastrarlos. Pero están en un archivo
que esta feature **sí** toca, imprimen el `actor` completo en producción, y el propio T22 pide
decisión del leader. Es higiene de logging con arista de PII: conviene resolverlo ya.

**m4 — Falta la entrada en `progress/history.md`.**
Paso del leader posterior al review; se anota para que no se pierda.

---

## 12. Observaciones a favor (no son hallazgos)

- La bitácora del implementador resultó **exacta** en todas las cifras que re-medí: 219 tests
  propios en verde, lint 143 con 0 errores, RLS y residuos del round-trip. No infló nada.
- El implementador **tenía razón** al contradecir el baseline caduco del briefing, y lo
  documentó midiendo en vez de afirmando. Se confirma el patrón ya visto en las features 78, 73
  y 91.
- Los comentarios normativos en cabecera de `AsignabilidadCoordenadasService` y de
  `optimizacion-ruta-encolado` citan archivo y línea del código verificado. Las mutaciones
  confirman que esas cabeceras describen invariantes **reales**, no intenciones.

---

## Veredicto

# RECHAZADO

**1 bloqueante · 4 menores.**

El rechazo es **exclusivamente** por **B1** (`tasks.md` con 0 de 23 tasks marcadas), un
checkpoint explícito de `CHECKPOINTS.md`. **No hay ningún defecto de código.**

Todo lo sustantivo pasó y se verificó de forma independiente: los 5 ensayos de mutación se
pusieron **rojos** (los 4 invariantes críticos protegen de verdad), el round-trip de migraciones
corrió contra un Postgres desechable con **0 residuos** y 55P04 confirmado empíricamente, la
trazabilidad `R -> test` está completa para R1–R8/R10–R28/R33–R40 con 219 tests verdes, hay
**0 regresiones** demostradas test a test, no hay fuga de alcance al frontend, el contrato para
la 93 está completo, los 2 tests heredados quedaron más fuertes o iguales (nunca más flojos) y
las 2 decisiones autónomas del implementador son correctas y están fundamentadas.

Corrección esperada del implementer: actualizar `tasks.md` (marcar T0–T16 y T20–T22; anotar
T17–T19 como diferidas a la feature 93; documentar la excepción medida de T22). Es un cambio de
documentación. Hecho eso, esta feature queda **OK** sin necesidad de re-verificar código.
