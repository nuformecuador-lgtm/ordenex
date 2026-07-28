# Implementación 136 — Etiquetas PDF consolidadas en la carga por API

> Rama: `chore/cierre-deudas-buckets-121-136`. Este doc lo escribe el cierre de los 3
> bloqueantes del review (`progress/review_136.md`), que es también el artefacto que faltaba
> (T4.3). El código de la 136 se había mergeado a `dev` sin pasar por review; aquí se cierra
> la laguna.

## Qué se cerró del review

### BLOQ-1 — el PDF no tenía cota (OOM/timeout que perdía los `num_guia`)

**Invariante fijado: la carga por API NUNCA puede romperse por la generación del PDF.**

El `try/catch` del borde solo cubre excepciones JS; un OOM o un timeout de plataforma no lo
son (matan el proceso), y ocurrían **después** del commit de las órdenes → 500/504 en vez del
200 de R12, con los `num_guia` perdidos para el integrador (al reintentar, `duplicada`).

Por eso el mecanismo elegido **decide antes de empezar**, en vez de intentar recuperarse: el
trabajo que no se arranca no puede desbordar la function.

1. **Tope duro configurable** `ETIQUETAS_MAX_POR_PDF` (default **300**, techo duro 1000,
   `lib/config/etiquetas.ts`). Se aplica en **dos capas**:
   - **Borde** (`route.ts`): compara `summary.ordenes.length` —cota superior del número de
     etiquetas, porque las imprimibles son un subconjunto— y por encima del tope degrada a
     `etiquetasPdf: { error }` explicativo **sin tocar DB ni Storage**. Es el guard que
     sostiene el invariante.
   - **Service** (`EtiquetasLotePdfService`): repite el guard con
     `EtiquetasLoteExcedeTopeError` antes de construir nada (defensa en profundidad para
     cualquier otro llamador).
2. **`compress: true` en jsPDF**. Medido con las deps reales: **262.8 KB → 3.3 KB por
   etiqueta (~80×)** y menos RSS. El tamaño deja de ser el factor limitante; el que queda
   (~18 ms/etiqueta) lo acota el tope.
3. **`runtime = "nodejs"` y `maxDuration = 60`** explícitos en la ruta (antes no declaraba
   ninguno y `vercel.json` no fija `maxDuration`, así que regía el default de plataforma, que
   podía cortar la respuesta después del commit). 60 s cubren la inserción del lote más un
   PDF de 300 etiquetas (~5.6 s de render) con margen.

**Números medidos** (deps reales, este repo, con `compress`): ~18 ms y ~3.3 KB por etiqueta;
RSS ~312 MB para 400 etiquetas. Sin `compress` eran ~263 KB/etiqueta → los 5000 del tope de
`MAX_CHUNK_ROWS` daban ~1.3 GB y ~90 s.

**Menores del review cerrados aquí:** TTL de la URL firmada clampeado a 24 h (antes aceptaba
cualquier positivo) y el `console.error` del best-effort ya no vuelca el error crudo — solo el
**tipo**, porque el mensaje puede arrastrar datos de la orden si el fallo viene del render
(design §8).

### BLOQ-2 — tareas `[x]` con artefacto inexistente
- **T0.2:** `.env.example` documenta ahora `ETIQUETAS_BUCKET`, `ETIQUETAS_SIGNED_URL_TTL_SECONDS`
  y la nueva `ETIQUETAS_MAX_POR_PDF`, con defaults y comentario.
- **T4.3:** este archivo, con el mapa R1–R18 → test de abajo.

### BLOQ-3 — R7 sin test asertivo
`tests/unit/pdf/etiquetas-pdf-lote.test.ts` mockea `qrcode` y `bwip-js/node`, justo las libs
cuya server-safety afirma R7. Se **conserva** (es útil y rápido: afirma qué valor codifica cada
código) y se añade **aparte** `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts`, sin mocks, que
rasteriza de verdad bajo Node y valida el PDF resultante.

### Menor — aislamiento entre tiendas
`EtiquetaGuiaService` no filtraba por dueño ni por rol: la garantía descansaba solo en el
borde. Ahora el rol `apiKey` solo ve órdenes cuyo `tienda_id` es su usuario dedicado (una
orden ajena se reporta `no_encontrada`, que no revela su existencia); los roles de sesión
mantienen el comportamiento abierto de la feature 32. `EtiquetaRow` gana `tiendaId`.

### Menor — drift de identidad
Todo el código y los tests de la 136 se comentaban como "Feature 112" (que es otra feature:
webhook payload `data`). Corregido a "Feature 136". No se tocó `feature_list.json`.

## Archivos

**Modificados (cierre del review):** `app/api/ordenes/api-key/carga/route.ts`,
`lib/config/etiquetas.ts`, `lib/pdf/etiquetas-pdf-lote.ts`,
`lib/services/EtiquetasLotePdfService.ts`, `lib/interfaces/services/IEtiquetasLotePdfService.ts`,
`lib/services/EtiquetaGuiaService.ts`, `lib/repositories/OrdenRepository.ts`,
`lib/interfaces/repositories/IOrdenRepository.ts`, `.env.example`,
`specs/136-etiquetas-pdf-carga-api/tasks.md`.

**Tests modificados/creados:** `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` (nuevo),
`tests/unit/pdf/etiquetas-pdf-lote.test.ts`, `tests/unit/config/etiquetas-config.test.ts`,
`tests/unit/services/etiquetas-lote-pdf-service.test.ts`,
`tests/unit/services/etiqueta-guia-service.test.ts`, `tests/integration/carga-api-etiquetas.test.ts`.

**De la implementación original (sin cambios de contrato):**
`lib/interfaces/services/IEtiquetasLotePdfService.ts`, `lib/storage/*` (reuso features 21/22).

Sin migración ni tabla nueva: el PDF es un derivado que vive en Storage (design §8), así que no
hay RLS que añadir.

## Mapa R → test

> `pdf` = `tests/unit/pdf/etiquetas-pdf-lote.test.ts` (con mocks de rasterizado) ·
> `smoke` = `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` (sin mocks) ·
> `svc` = `tests/unit/services/etiquetas-lote-pdf-service.test.ts` ·
> `int` = `tests/integration/carga-api-etiquetas.test.ts` ·
> `cfg` = `tests/unit/config/etiquetas-config.test.ts` ·
> `guia` = `tests/unit/services/etiqueta-guia-service.test.ts`

| R | Test |
| --- | --- |
| R1 | `pdf::genera un PDF con una pagina por etiqueta` + `svc::sube un PDF con una pagina por orden creada del lote (R1/R3)` |
| R2 | `pdf::genera un PDF con una pagina por etiqueta` (assert `/MediaBox [0 0 283.4x 283.4x]`) + `smoke::produce un PDF valido con las libs reales bajo Node` |
| R3 | `pdf::genera un PDF con una pagina por etiqueta` (cuenta 3 `/Type /Page`) **+ el puente que faltaba**: `svc::sube un PDF con una pagina por orden creada del lote (R1/R3)` — entran 3 `ordenIds`, se cuentan las páginas del PDF que llega a Storage con el builder REAL |
| R4 | `pdf::cada pagina incluye los campos de la orden` — **ya no es parcial**: cubre los **nueve** datos del requisito (guía, remisión, destinatario, teléfono, dirección, los 4 niveles de ubicación, producto, monto y tienda). Los content streams van deflateados por `compress`, así que el test los infla |
| R5 | `pdf::el QR codifica la URL /paquete/<numGuia>` + `smoke::las dependencias de rasterizado corren en Node y devuelven PNG` |
| R6 | `pdf::el barcode codifica el num_guia en CODE128` + `smoke::las dependencias de rasterizado corren en Node y devuelven PNG` |
| R7 | **cerrado (BLOQ-3)**: `smoke::las dependencias de rasterizado corren en Node y devuelven PNG (R5/R6/R7)`, `smoke::produce un PDF valido con las libs reales bajo Node (R1-R7)`, `smoke::no toca el DOM: no hay document ni window en el entorno del builder (R7)` |
| R8 | `svc::sube el PDF con contentType application/pdf al bucket (R8)` |
| R9 | **sin test ejecutable** (infra): el bucket privado es la tarea ops T0.1, hoy SIN hacer. Verificado por inspección: cero `getPublicUrl` en `app/` + `lib/`; la entrega es siempre por URL firmada |
| R10 | `svc::retorna la signed URL y el TTL (R10)` + `int::incluye etiquetasPdf con url y TTL cuando se crean ordenes (R10/R17)` |
| R11 | `svc::el path aisla por usuarioId y es unico por lote (R11)` |
| R12 | `int::etiquetasPdf trae { error } y responde 200 cuando el service lanza (R12)` + `svc::propaga el error si el upload falla` + **el modo que faltaba (BLOQ-1)**: `int::lote por encima del tope: 200 con los num_guia intactos y etiquetasPdf { error } (BLOQ-1/R12)` |
| R13 | `int::etiquetasPdf es null cuando no se crea ninguna orden (R13)` |
| R14 | `svc::retorna null cuando no hay etiquetas imprimibles (R14)` + `svc::retorna null cuando generarEtiquetas responde forbidden (R14)` + `int::etiquetasPdf es null cuando el service no halla etiqueta imprimible (R14)` |
| R15 | **sin test ejecutable** (requisito negativo). Verificado por inspección: cero referencias a etiquetas en `app/api/ordenes/carga-masiva/` y en `lib/services/BulkOrdenService.ts`; el cableado vive solo en el endpoint de la API key. Regresión cubierta por `tests/integration/api/ordenes-api-key-carga.route.test.ts` (10/10) |
| R16 | `int::mantiene 401 sin key sin generar PDF (R16)` + `int::mantiene 403 con key sin permiso sin generar PDF (R16)` |
| R17 | `int::preserva los campos existentes del summary (R17)` + `int::lote por encima del tope...` (el summary llega intacto también en la degradación) |
| R18 | `cfg::usa defaults cuando las env no estan` + `cfg::respeta ETIQUETAS_BUCKET / TTL de env` + `cfg::respeta ETIQUETAS_MAX_POR_PDF de env` + `cfg::acota ETIQUETAS_MAX_POR_PDF al techo duro` + `cfg::cae al default con un ETIQUETAS_MAX_POR_PDF invalido o no positivo` + `cfg::acota el TTL de la URL firmada a un maximo` |

### Tests del cierre que no mapean a un `R<n>` del spec

| Qué fija | Test |
| --- | --- |
| Tope: no se construye ni se sube nada por encima del límite | `svc::no construye ni sube el PDF cuando el lote supera el tope de etiquetas (BLOQ-1)` |
| Tope: el error solo lleva números (apto para log) | `svc::el error del tope solo lleva numeros (sin PII), apto para log (BLOQ-1)` |
| Tope: el borde exacto del límite sí genera | `svc::genera el PDF cuando el lote iguala EXACTAMENTE el tope`, `int::lote justo EN el tope: si genera el PDF` |
| El log del best-effort no filtra datos de la orden | `int::no loguea el mensaje crudo del error: podria traer datos de la orden (design §8)` |
| Aislamiento entre tiendas del canal `apiKey` | `guia::una API key NO obtiene la etiqueta de una orden de otra tienda`, `guia::una API key SI obtiene la etiqueta de sus propias ordenes`, `guia::en un lote mixto, la API key solo recibe las etiquetas de su tienda`, `guia::la ruta por num_guia tampoco expone la orden de otra tienda a una API key`, `guia::los roles de sesion NO se filtran por dueño (comportamiento de la feature 32)` |

## Verificación ejecutable

```
$ pnpm exec tsc --noEmit
(sin salida: 0 errores)

$ pnpm exec vitest run tests/unit/config/etiquetas-config.test.ts \
    tests/unit/pdf/etiquetas-pdf-lote.test.ts \
    tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts \
    tests/unit/services/etiquetas-lote-pdf-service.test.ts \
    tests/unit/services/etiqueta-guia-service.test.ts \
    tests/integration/carga-api-etiquetas.test.ts \
    tests/integration/api/ordenes-api-key-carga.route.test.ts
Test Files  7 passed (7)
     Tests  62 passed (62)
```

Suite completa y gate del arnés:

```
$ ./init.sh
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 144 problems (0 errors, 144 warnings)
✓ lint paso
-> pnpm run test
 Test Files  515 passed (515)
      Tests  5209 passed (5209)
   Duration  126.07s
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Los 144 warnings de lint son preexistentes del repo (ninguno en archivos de la 136); el review
previo contabilizaba 146, así que el cierre no añade ninguno y retira dos.

## Deuda que queda viva (no la cierra este trabajo)

- **T0.1 — crear el bucket privado `etiquetas-guia` en Supabase Storage: tarea humana de ops,
  SIN hacer.** Mientras no exista, R8/R9/R10 solo están verificados contra fakes y la respuesta
  real del endpoint traerá siempre `etiquetasPdf: { error }` (el upload falla). Es la razón por
  la que T0.1 sigue sin marcar en `tasks.md`.
- **Sin E2E.** CHECKPOINTS lo pide para "ingesta de órdenes", pero Playwright encaja mal en un
  endpoint por API key (mismo precedente que la feature 88). Cubierto por integración.
- **Elección del default 300.** Es conservador respecto al presupuesto medido (300 ≈ 5.6 s de
  los 60 s de `maxDuration`). Si un integrador real necesita lotes mayores, se sube por env
  hasta 1000 sin tocar código; por encima de eso habría que cambiar de enfoque (PDF por
  fragmentos o generación asíncrona con job), que es un rediseño, no un ajuste.
