# Feature 136 — Tasks

> Checklist discreto y verificable. `[P]` = paralelizable con otras `[P]` del mismo
> bloque (sin conflicto de archivos). Cada task lleva su criterio de "hecho". La
> trazabilidad `R<n> → test` se consolida al final y se copia a
> `progress/impl_136.md`.

## Bloque 0 — Preparación (Ops / entorno)

- [ ] **T0.1** [P] Crear bucket privado `etiquetas-guia` en Supabase Storage (tarea
  humana). **Hecho:** el bucket existe, es privado, y el service role puede
  `upload`/`createSignedUrl` sobre él.
- [x] **T0.2** [P] Documentar en `.env.example` las variables `ETIQUETAS_BUCKET` y
  `ETIQUETAS_SIGNED_URL_TTL_SECONDS` (con defaults). **Hecho:** ambas variables
  documentadas en `.env.example` con su valor por defecto (3600 / "etiquetas-guia"),
  más `ETIQUETAS_MAX_POR_PDF` (tope de etiquetas por PDF, default 300).
  *(Marcada `[x]` en falso en su momento: el review la encontró sin hacer y se
  ejecutó de verdad al cerrar BLOQ-2.)*

## Bloque 1 — Config y builder (paralelizables entre sí)

- [x] **T1.1** [P] Crear `lib/config/etiquetas.ts` (patrón `lib/config/gestion.ts`):
  `ETIQUETAS_BUCKET` (default `"etiquetas-guia"`) y `SIGNED_URL_TTL_SECONDS`
  (default `3600`), leídos de env con `readPositiveInt`/trim. **Hecho:**
  `etiquetasConfig` exporta ambos valores; typecheck verde. (R18)
  - Test: `tests/unit/config/etiquetas-config.test.ts` —
    `usa defaults cuando las env no estan` y `respeta ETIQUETAS_BUCKET / TTL de env`.

- [x] **T1.2** [P] Crear `lib/pdf/etiquetas-pdf-lote.ts` con
  `buildEtiquetasLotePdf(etiquetas: EtiquetaGuiaDTO[]): Promise<Uint8Array>`:
  100 × 100 mm por página, una por etiqueta, cabecera + campos + QR
  (`qrcode.toDataURL(buildPaqueteUrl(numGuia))`) + barcode (`bwip-js` CODE128 de
  `barcodeValue`) con `jspdf` en Node (imágenes como data URL). **Hecho:** genera un
  `Uint8Array` no vacío; sin dependencias de DOM. (R1–R7)
  - Test: `tests/unit/pdf/etiquetas-pdf-lote.test.ts` —
    `genera un PDF con una pagina por etiqueta` (R2/R3, verifica nº de páginas),
    `el QR codifica la URL /paquete/<numGuia>` (R5, mockeando `qrcode.toDataURL` y
    afirmando el argumento = `buildPaqueteUrl`),
    `el barcode codifica el num_guia en CODE128` (R6, mockeando `bwip-js`),
    `cada pagina incluye los campos de la orden` (R4).

## Bloque 2 — Servicio orquestador (depende de T1.2)

- [x] **T2.1** Crear interface `lib/interfaces/services/IEtiquetasLotePdfService.ts`
  (`IEtiquetasLotePdfService` + `EtiquetasLotePdfResultado`). **Hecho:** interface
  exportada; typecheck verde.

- [x] **T2.2** Crear `lib/services/EtiquetasLotePdfService.ts` con DI por
  constructor (`IEtiquetaGuiaService`, `IFileStorage`, `ISignedUrlProvider`, `ttlSeg`,
  builder inyectable con default `buildEtiquetasLotePdf`). Método
  `generarYAlmacenar(ordenIds, actor)`: pide DTOs → si vacío/`forbidden` retorna
  `null`; arma PDF; sube (`contentType: "application/pdf"`, path
  `<usuarioId>/<uuid>.pdf`); firma URL; retorna `{ path, signedUrl, expiraEnSegundos }`.
  **Hecho:** typecheck verde; no captura errores internamente (best-effort en el
  borde). (R8, R10, R11, R14)
  - Test: `tests/unit/services/etiquetas-lote-pdf-service.test.ts` (fakes de las 4
    deps) —
    `sube el PDF con contentType application/pdf al bucket` (R8),
    `el path aisla por usuarioId y es unico por lote` (R11),
    `retorna la signed URL y el TTL` (R10),
    `retorna null cuando no hay etiquetas imprimibles` (R14),
    `retorna null cuando generarEtiquetas responde forbidden` (R14),
    `propaga el error si el upload falla` (base para el best-effort del borde, R12).

## Bloque 3 — Cableado en el endpoint (depende de T1.1, T2.2)

- [x] **T3.1** Extender `app/api/ordenes/api-key/carga/route.ts`: añadir
  `etiquetasService?` a `CargaApiDeps`, builder `buildEtiquetasService()`, y tras
  `cargarViaApi` OK con `summary.ordenes.length > 0` generar el PDF en `try/catch`
  best-effort; envolver la respuesta como `{ ...summary, etiquetasPdf }` con
  `etiquetasPdf: { url, expiraEnSegundos } | null`. **Hecho:** typecheck/lint verde;
  respuesta 200 en todos los caminos de carga OK. (R10, R12, R13, R15, R16, R17)
  - Test: `tests/integration/carga-api-etiquetas.test.ts` (inyectando `autenticar`,
    `bulkService` y `etiquetasService` fakes) —
    `incluye etiquetasPdf con url y TTL cuando se crean ordenes` (R10/R17),
    `etiquetasPdf trae { error } y responde 200 cuando el service lanza` (R12, fake
    que lanza),
    `etiquetasPdf es null cuando no se crea ninguna orden` (R13, summary con
    `ordenes: []`, el service fake NO se invoca),
    `mantiene 401 sin key y 403 con key sin permiso sin generar PDF` (R16, el
    `etiquetasService` fake NO se invoca),
    `preserva los campos existentes del summary` (R17).

## Bloque 4 — Verificación y cierre (depende de todo lo anterior)

- [x] **T4.1** Correr `pnpm run typecheck`, `pnpm run lint`, `pnpm test`. **Hecho:**
  feature 136 verde en typecheck/lint/test; los tests existentes del endpoint de
  carga por API siguen verdes (regresión R16). Las fallas restantes de la suite son
  drift pre-existente ajeno (SINPE→SIMPE, enum orden_historial), no de esta feature.
- [x] **T4.2** Verificar que la carga masiva por sesión (`carga-masiva/chunk`) NO
  cambió: revisar que no hay diffs en `cargarMasiva` ni en su ruta. **Hecho:** solo
  se tocó `app/api/ordenes/api-key/carga/route.ts`; `cargarMasiva` intacto. (R15)
- [x] **T4.3** Escribir el mapa `R<n> → test` en `progress/impl_136.md`. **Hecho:**
  `progress/impl_136.md` existe con el mapa R1–R18 → test, los tests añadidos al
  cerrar el review y la deuda viva. *(Marcada `[x]` en falso en su momento: el
  archivo no existía; se escribió de verdad al cerrar BLOQ-2.)*

## Bloque 5 — Cierre del review (RECHAZADO, 3 bloqueantes)

> `progress/review_136.md`. El código estaba mergeado en `dev` sin review previo.

- [x] **T5.1** **BLOQ-1** — acotar la generación del PDF para que la carga por API no
  pueda romperse por ella. **Hecho:** tope duro configurable `ETIQUETAS_MAX_POR_PDF`
  (default 300, techo 1000) aplicado en el borde (antes de tocar DB/Storage) y
  repetido en el service (`EtiquetasLoteExcedeTopeError`); `compress: true` en jsPDF
  (262.8 KB → 3.3 KB por etiqueta); `runtime = "nodejs"` y `maxDuration = 60`
  explícitos en la ruta. Por encima del tope: HTTP 200, `num_guia` intactos y
  `etiquetasPdf: { error }` explicativo. (R12)
  - Test: `carga-api-etiquetas.test.ts › lote por encima del tope: 200 con los
    num_guia intactos y etiquetasPdf { error } (BLOQ-1/R12)` y `› lote justo EN el
    tope: si genera el PDF`; `etiquetas-lote-pdf-service.test.ts › no construye ni
    sube el PDF cuando el lote supera el tope`, `› el error del tope solo lleva
    numeros`, `› genera el PDF cuando el lote iguala EXACTAMENTE el tope`.
- [x] **T5.2** **BLOQ-3** — smoke test de R7 sin mocks. **Hecho:**
  `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` ejercita `qrcode` y
  `bwip-js/node` reales bajo Node y valida el PDF (cabecera, trailer, `%%EOF`,
  páginas, MediaBox, XObjects de imagen, texto). El test con mocks se conserva. (R7)
- [x] **T5.3** Notas menores del review. **Hecho:** TTL clampeado a 24 h; el log del
  best-effort ya no vuelca el error crudo (solo el tipo); `EtiquetaGuiaService`
  filtra por dueño cuando el actor es `apiKey`, con test de la invariante; comentarios
  "Feature 112" → "Feature 136".
- [x] **T5.4** Cerrar los requisitos que el review marcó como PARCIALES. **Hecho:**
  R3 gana el puente end-to-end "N órdenes creadas → N páginas"
  (`etiquetas-lote-pdf-service.test.ts › sube un PDF con una pagina por orden creada
  del lote`) y R4 pasa de asertar 4 datos a los 9 que exige el requisito.

## Mapa de trazabilidad R → test (borrador)

> **El mapa canónico y actualizado vive en `progress/impl_136.md`** (incluye los tests
> añadidos al cerrar el review y corrige R3/R4, que aquí figuraban como cubiertos y el
> review encontró parciales). Esta tabla se conserva como el borrador que fue.

| R | Test |
| --- | --- |
| R1 | `etiquetas-pdf-lote.test.ts › genera un PDF con una pagina por etiqueta` |
| R2 | `etiquetas-pdf-lote.test.ts › genera un PDF con una pagina por etiqueta` (tamaño página) |
| R3 | `etiquetas-pdf-lote.test.ts › genera un PDF con una pagina por etiqueta` (nº páginas) |
| R4 | `etiquetas-pdf-lote.test.ts › cada pagina incluye los campos de la orden` |
| R5 | `etiquetas-pdf-lote.test.ts › el QR codifica la URL /paquete/<numGuia>` |
| R6 | `etiquetas-pdf-lote.test.ts › el barcode codifica el num_guia en CODE128` |
| R7 | `etiquetas-pdf-lote.test.ts` (corre en Node/jsdom-off, sin DOM) |
| R8 | `etiquetas-lote-pdf-service.test.ts › sube el PDF con contentType application/pdf` |
| R9 | T0.1 (bucket privado) + service usa bucket de config; sin URL pública en el código |
| R10 | `etiquetas-lote-pdf-service.test.ts › retorna la signed URL y el TTL` + integración |
| R11 | `etiquetas-lote-pdf-service.test.ts › el path aisla por usuarioId y es unico por lote` |
| R12 | `carga-api-etiquetas.test.ts › etiquetasPdf trae { error } y responde 200 cuando el service lanza` |
| R13 | `carga-api-etiquetas.test.ts › etiquetasPdf es null cuando no se crea ninguna orden` |
| R14 | `etiquetas-lote-pdf-service.test.ts › retorna null cuando no hay etiquetas / forbidden` |
| R15 | T4.2 (sin diff en `cargarMasiva`) |
| R16 | `carga-api-etiquetas.test.ts › mantiene 401/403 sin generar PDF` + suite existente |
| R17 | `carga-api-etiquetas.test.ts › preserva los campos existentes del summary` |
| R18 | `etiquetas-config.test.ts › usa defaults / respeta env` |
