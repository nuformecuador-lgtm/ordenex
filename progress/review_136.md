# Review — Feature 136 (Etiquetas PDF consolidadas en la carga por API)

> Reviewer (`model: opus`), 2026-07-25. Este doc lo **transcribe el leader**: el agente completó la
> verificación pero la conexión se cortó cuatro veces al escribir el archivo. El veredicto y los
> hallazgos son los que devolvió el agente, sin alterar. Mismo precedente que `review_139`.
>
> Contexto: el código de la 136 ya estaba mergeado en `dev` (y por tanto desplegado) **sin haber
> pasado nunca por review**. Este documento cierra esa laguna de verificación.

## VEREDICTO: RECHAZADO — 3 bloqueantes

## Bloqueantes

### BLOQ-1 — El PDF no tiene cota: OOM/timeout que pierde los `num_guia`
`lib/pdf/etiquetas-pdf-lote.ts:102-109` + `app/api/ordenes/api-key/carga/route.ts:101`

Una página por etiqueta, sin límite superior, hasta `MAX_CHUNK_ROWS = 5000`
(`lib/config/carga-masiva.ts:36`), y `new jsPDF(...)` (línea 103) se construye **sin `compress`**.

Medido con las deps reales: **~13 ms y ~279 KB por etiqueta, ~1.5 MB RSS/etiqueta**
(n=200 → 2594 ms / 54.5 MB / RSS 396 MB). Extrapolado al tope admitido: **~1.4 GB de PDF y ~65 s**.

El fallo ocurre **después** del commit de las órdenes, y ahí el `try/catch` de `route.ts:152-158`
**NO aplica** (un OOM o un timeout de plataforma no es una excepción JS capturable): el integrador
recibe **500/504 en vez del 200 que exige R12**, y **pierde los `num_guia`** de órdenes que sí se
crearon — al reintentar le salen como `duplicada`.

Agravantes: ningún test cubre lote grande; la ruta no declara `runtime` ni `maxDuration`, y no hay
`maxDuration` en `vercel.json`.

### BLOQ-2 — Tareas marcadas `[x]` con artefacto inexistente
`specs/136-etiquetas-pdf-carga-api/tasks.md:13-15` (T0.2) y `:90-91` (T4.3)

- **T0.2** dice documentar `ETIQUETAS_BUCKET` y `ETIQUETAS_SIGNED_URL_TTL_SECONDS` en `.env.example`:
  **no están** (grep repo-wide: sólo aparecen en código, spec y tests).
- **T4.3** da por escrito `progress/impl_136.md`: **no existe** → falla el checkpoint
  "`impl_<feature>.md` contiene el mapa R→test".

### BLOQ-3 — R7 sin test asertivo (server-safety de las deps)
`tests/unit/pdf/etiquetas-pdf-lote.test.ts:18-28`

El test **mockea `qrcode` y `bwip-js/node`** — justo las dos librerías cuya server-safety afirma el
requisito. Nunca se ejecutan en la suite. Verificado a mano (builder real bajo tsx/Node, PDFs
válidos) → es **hueco de cobertura, no defecto funcional**; se cierra con un smoke test sin mocks.

## Requisitos sin test

**R7** (BLOQ-3), **R9**, **R15**.

R9 y R15 no son testeables en código (R9 = privacidad del bucket, tarea ops T0.1; R15 es negativo).
Verificados por inspección: cero `getPublicUrl` en `app/` + `lib/`; cero referencias a etiquetas en
`app/api/ordenes/carga-masiva/` ni en `lib/services/BulkOrdenService.ts`.

## Trazabilidad R → test

> `pdf` = `tests/unit/pdf/etiquetas-pdf-lote.test.ts` · `svc` = `tests/unit/services/etiquetas-lote-pdf-service.test.ts`
> `int` = `tests/integration/carga-api-etiquetas.test.ts` · `cfg` = `tests/unit/config/etiquetas-config.test.ts`

| R | Test |
| --- | --- |
| R1 | `pdf::genera un PDF con una pagina por etiqueta` |
| R2 | `pdf::genera un PDF con una pagina por etiqueta` (assert `/MediaBox [0 0 283.4x 283.4x]`) |
| R3 | `pdf::genera un PDF con una pagina por etiqueta` (cuenta 3 `/Type /Page`) — **parcial**: el puente "N órdenes creadas → N páginas" no se cubre end-to-end |
| R4 | `pdf::cada pagina incluye los campos de la orden` — **parcial**: asserta 4 de 9 datos (destinatario, producto, tienda, remisión); faltan teléfono, dirección, ubicación, monto, guía |
| R5 | `pdf::el QR codifica la URL /paquete/<numGuia>` |
| R6 | `pdf::el barcode codifica el num_guia en CODE128` |
| R7 | **SIN TEST** (BLOQ-3) |
| R8 | `svc::sube el PDF con contentType application/pdf al bucket (R8)` |
| R9 | **SIN TEST** (infra, T0.1) |
| R10 | `svc::retorna la signed URL y el TTL (R10)` + `int::incluye etiquetasPdf con url y TTL cuando se crean ordenes (R10/R17)` |
| R11 | `svc::el path aisla por usuarioId y es unico por lote (R11)` |
| R12 | `int::etiquetasPdf trae { error } y responde 200 cuando el service lanza (R12)` + `svc::propaga el error si el upload falla` — **sólo el modo "excepción JS"**; ver BLOQ-1 |
| R13 | `int::etiquetasPdf es null cuando no se crea ninguna orden (R13)` |
| R14 | `svc::retorna null cuando no hay etiquetas imprimibles (R14)` + `svc::retorna null cuando generarEtiquetas responde forbidden (R14)` + `int::etiquetasPdf es null cuando el service no halla etiqueta imprimible (R14)` |
| R15 | **SIN TEST** (verificado por inspección + 10/10 verdes en `tests/integration/api/ordenes-api-key-carga.route.test.ts`) |
| R16 | `int::mantiene 401 sin key sin generar PDF (R16)` + `int::mantiene 403 con key sin permiso sin generar PDF (R16)` |
| R17 | `int::preserva los campos existentes del summary (R17)` |
| R18 | `cfg::usa defaults cuando las env no estan` + `cfg::respeta ETIQUETAS_BUCKET / TTL de env` |

## Verificación

`tsc --noEmit` 0 errores · `pnpm run lint` 0 errores / 146 warnings (todos preexistentes, ninguno en
archivos de la 136) · tests de la feature **33/33 PASS** (5 archivos) + regresión del endpoint 10/10 ·
`./init.sh` verde (exit 0, 514 archivos, 5190 tests).

## Notas menores

- **Aislamiento entre tiendas: OK hoy, pero frágil.** Los `ordenIds` salen de `summary.ordenes`, sólo
  filas `creada` con `tiendaId = actor.usuarioId` (`BulkOrdenService.ts:292,330,360`); las duplicadas
  se excluyen y el path es `<usuarioId>/<uuid>.pdf`. Pero `lib/services/EtiquetaGuiaService.ts:28-31`
  **no filtra por dueño ni por rol de forma explícita**: toda la garantía descansa en el borde.
  Endurecer para `apiKey` y fijar la invariante con un test.
- **TTL sin cota superior** (`lib/config/etiquetas.ts:23`): `readPositiveInt` acepta cualquier positivo
  (el default 3600 sí es sano) → clampear a un máximo. Y `route.ts:156` loguea el objeto `err` crudo:
  si el fallo viene del render, el mensaje podría arrastrar datos de la orden, contra lo prometido en
  design §8 (la respuesta al cliente sí es una constante genérica, y hay test que asserta que no
  contiene el secreto).
- **Drift de identidad.** Todo el código y los tests de la 136 se comentan como "Feature 112" (que es
  otra feature: webhook payload `data`), el commit que los introdujo se titula
  `feat(chat: wp integration)` (`d197b5d`), y la descripción de la 136 en `feature_list.json:1350`
  aún dice que el fallo devuelve `etiquetasPdf: null`, contradiciendo R12 (`{ error }`; manda el spec).
- **Sin E2E** pese a que CHECKPOINTS lo pide para "ingesta de órdenes" (mismo precedente que la 88;
  Playwright encaja mal en un endpoint por API key). Y con el bucket aún inexistente en producción
  (T0.1), **R8/R9/R10 sólo están verificados contra fakes**: hoy la respuesta real siempre traería
  `{ error }`.

---

# RE-REVIEW — cierre de los 3 bloqueantes (2026-07-25)

> Reviewer (model opus), rama chore/cierre-deudas-buckets-121-136, commits
> 3dc59ec..75461ba (5) sobre fbbecbb. El dictamen de arriba se conserva como historial.

## VEREDICTO: APROBADO-CON-NOTAS — 0 bloqueantes

## Bloqueantes: los tres CERRADOS

### BLOQ-1 — CERRADO (verificado con medicion propia)

- **Guard en el borde ANTES de cualquier trabajo pesado**: `route.ts:197`
  (`summary.ordenes.length > topeEtiquetas` -> `{ error }` explicativo). Se evalua antes de
  `buildEtiquetasService()` (`:202`), asi que en el camino de degradacion **no se construyen**
  ni el cliente de Storage ni el repo, ni se toca DB/Storage. `summary.ordenes` es cota
  superior real de las etiquetas (las imprimibles son subconjunto): el argumento se sostiene.
- **Defensa en profundidad** en `EtiquetasLotePdfService.ts:63-65`
  (`EtiquetasLoteExcedeTopeError`), antes de `build` (`:68`).
- **Config** `lib/config/etiquetas.ts:73-77`: default 300, clamp a [1, 1000], env invalida ->
  default. Cubierto por 4 tests de `cfg`.
- **`compress: true`** (`lib/pdf/etiquetas-pdf-lote.ts:112`), `runtime = "nodejs"` y
  `maxDuration = 60` (`route.ts:45,52`); `vercel.json` no fija `maxDuration` -> manda la ruta.
- **Medicion propia** (deps reales, este repo, builder real):
  n=50 -> 22.0 ms/etiqueta; n=300 -> 19.1 ms/etiqueta, 5.74 s, PDF 1.13 MB, RSS 301 MB;
  n=1000 (techo duro) -> 19.3 ms/etiqueta, 19.3 s, PDF 3.8 MB, RSS 319 MB.
  **El default 300 cabe con margen amplio**: ~5.7 s de los 60 s, dejando ~54 s para la
  insercion del lote. Incluso el techo duro (1000 -> 19 s, RSS plano por GC) es defendible.
  Confirmado tambien el ~80x de `compress` (3.8 KB/etiqueta vs los ~279 KB medidos sin el).

### BLOQ-2 — CERRADO

- `.env.example:26-38`: las tres variables (ETIQUETAS_BUCKET, ETIQUETAS_SIGNED_URL_TTL_SECONDS,
  ETIQUETAS_MAX_POR_PDF) documentadas con default.
- `progress/impl_136.md` existe, con el mapa R1-R18 -> test. **Verificado test a test**: todos
  los nombres de la tabla existen y asertan lo que la tabla dice (los ejecute, ver abajo).
- `tasks.md` corregida con nota honesta de que T0.2/T4.3 estaban [x] en falso; bloque 5
  (T5.1-T5.4) anadido. Unica casilla viva sin marcar: **T0.1 (ops, crear el bucket)**, fuera
  de alcance de este review por indicacion explicita.

### BLOQ-3 — CERRADO

`tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` no mockea nada: importa `qrcode` y
`bwip-js/node` reales, asserta firma PNG de ambos, y con el builder real valida cabecera PDF,
trailer, startxref, marca de fin, 2 paginas, MediaBox 283.4, XObjects de imagen y el texto
**inflando** los streams. El entorno es Node de verdad (`vitest.config.ts` ->
`environment: "node"`), y el propio test lo fija (`typeof document === "undefined"`).

## Foco pedido

1. **Invariante**: se sostiene para el modo que lo rompia (trabajo no acotado). El unico hueco
   residual es I/O sin timeout, ver M1.
2. **Test de lote grande** (`carga-api-etiquetas.test.ts:176-209`): asserta **200**, `creadas`,
   longitud de `ordenes`/`filas`, **igualdad de la lista completa de num_guia**, `{ error }`
   con el tope y la palabra num_guia, sin el secreto, **y `generarYAlmacenar` NO invocado**.
   Complementado por el borde exacto del tope (`:211-227`). Prueba de verdad, no de fachada.
3. **R3/R4 ya no parciales** (verificado contra los tests, no contra el reporte): R4 asserta
   los **nueve** datos inflando los content streams (`etiquetas-pdf-lote.test.ts:147-190`);
   R3 gana el puente `svc::sube un PDF con una pagina por orden creada del lote` con el builder
   REAL contando `/Type /Page` en los bytes que llegan a Storage. Ver M2/M3.
4. **Endurecimiento de `EtiquetaGuiaService`**: `esVisiblePara` (`EtiquetaGuiaService.ts:36-39`)
   devuelve `true` para todo rol distinto de `apiKey`, asi que la impresion de cliente
   (feature 32) y `/paquete/<numGuia>` no cambian; ambos consumidores resuelven el actor con
   `resolveActorFromSession`, que **nunca** produce `apiKey` (grep sin coincidencias). Tests de
   la 32 (accion + modal + service) verdes. El filtro es correcto: `cargarViaApi` fija
   `tiendaId = actor.usuarioId` (`BulkOrdenService.ts:292`), luego el camino feliz no se degrada.
5. **`impl_136.md`**: la tabla R1-R18 corresponde a tests que existen y asertan lo que dice.

## Checklist

- [x] Trazabilidad: R1-R8, R10-R14, R16-R18 con test asertivo. R9 y R15 sin test ejecutable
      (infra / requisito negativo), verificados por inspeccion; R9 ademas apoyado por
      `supabase-file-storage.test.ts:37` ("nunca solicita una URL publica").
- [x] `progress/impl_136.md` contiene el mapa R -> test.
- [x] Tasks marcadas [x] salvo T0.1 (ops, excluida por indicacion del leader).
- [x] `./init.sh` verde **corrido por mi**: typecheck 0 errores; lint 0 errores / 144 warnings
      (preexistentes); **515 archivos / 5209 tests PASS** (190.94 s); exit 0.
- [x] Tests de la feature + consumidores de la 32 corridos aparte: 9 archivos / 76 tests PASS.
- [x] Seguridad: sin secretos hardcodeados; sin tabla nueva (no aplica RLS); config por env;
      capas separadas (borde traduce, service sin HTTP, repo solo query); log saneado.
- [ ] E2E: no hay (deuda conocida, mismo precedente que la 88).
- [ ] `progress/history.md`: sin entrada de la 136 (la escribe el leader al cerrar).

## Hallazgos (todos `menor`, ninguno bloqueante)

- **M1 `menor` — el invariante no es literalmente absoluto: I/O sin timeout.**
  `lib/storage/SupabaseFileStorage.ts:47` (y el proveedor de URL firmada) no pasan
  `AbortSignal` ni timeout. Con <=300 etiquetas el trabajo ya esta acotado, pero un upload
  colgado consume los 60 s de `maxDuration` **despues** del commit -> 504 y la misma perdida
  de num_guia que denunciaba BLOQ-1. Probabilidad baja y causa distinta (red, no tamano), por
  eso no bloquea; cerrarlo pide un timeout corto en `upload`/`createSignedUrl`.
- **M2 `menor` — assert numerico debil en R4.** `textoDelPdf`
  (`tests/unit/pdf/etiquetas-pdf-lote.test.ts:74-91`) concatena el PDF **en crudo** mas lo
  inflado, asi que `expect(s).toContain("1042")` podria pasar por casualidad (offsets de la
  xref). Los asserts de cadena (AnaDestinatario, ZonaTest...) si son inequivocos, y el smoke
  asserta la guia contra texto **solo inflado**, asi que R4 queda cubierto igualmente.
- **M3 `menor` — R3 sigue sin ser end-to-end.** El puente cuenta paginas con el builder real,
  pero el `IEtiquetaGuiaService` es un fake: "N ordenes creadas en DB -> N paginas" no se
  demuestra sin DB. Aceptable dado que el endpoint no tiene E2E.
- **M4 `menor` — drift spec<->codigo.** `design.md` §3 sigue describiendo `EtiquetasConfig` con
  dos campos y no menciona el tope, `compress` ni `maxDuration`, que hoy son decisiones de
  diseno centrales. El spec deberia reflejarlas.
- **M5 `menor` (ops, no imputable al implementer) — T0.1 sin hacer.** Mientras el bucket
  privado `etiquetas-guia` no exista en Supabase, **R8/R9/R10 solo estan verificados contra
  fakes** y la respuesta real del endpoint traera siempre `etiquetasPdf: { error }`. No cuenta
  como bloqueante de este review, pero la feature no puede pasar a `done` sin ello.
- **M6 `menor` — `progress/history.md` sin entrada de la 136** (tarea del leader al cerrar).

## Verificacion ejecutada por el reviewer

```
./init.sh   -> exit 0 | typecheck OK | lint 0 errors / 144 warnings
               | 515 archivos, 5209 tests PASS (190.94 s)
vitest run (7 archivos de la 136 + accion y modal de la 32) -> 9 archivos, 76 tests PASS
medicion propia del builder (tsx, deps reales):
  300 etiquetas  -> 5.74 s / 1.13 MB / RSS 301 MB
  1000 etiquetas -> 19.3 s / 3.84 MB / RSS 319 MB   (techo duro por env)
```
