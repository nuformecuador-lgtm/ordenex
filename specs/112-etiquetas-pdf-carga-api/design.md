# Feature 112 — Diseño técnico

> Cubre R1–R18 de `requirements.md`. Reusa piezas ya existentes (feature 32 y 88);
> no introduce tabla nueva ni migración (el PDF es un derivado, vive en Storage).

## 1. Decisiones dadas (cerradas con el humano)

1. **Disparo:** solo la carga vía API `POST /api/ordenes/api-key/carga`
   (`handleCargaApi` → `BulkOrdenService.cargarViaApi`, rol `apiKey`), que ya asigna
   `num_guia` en la transacción de creación. NO se toca `carga-masiva/chunk` →
   `cargarMasiva` (crea con `num_guia = NULL`, sin guía no hay etiqueta). (R15)
2. **Generación:** server-side, en el runtime Node del endpoint (ya usa Prisma, no
   es edge). (R7)
3. **Almacenamiento:** un único PDF consolidado por lote, multipágina. (R1–R3)
4. **Respuesta:** URL firmada (signed URL con TTL) en el cuerpo. (R10)

## 2. Arquitectura (Controller → Service → dependencias)

```
app/api/ordenes/api-key/carga/route.ts        (Controller / borde HTTP)
  ├─ cargarViaApi(...) -> CargaViaApiSummary   (feature 88, sin cambios internos)
  └─ EtiquetasLotePdfService.generarYAlmacenar(ordenIds, actor)   (best-effort)
        ├─ IEtiquetaGuiaService.generarEtiquetas   -> EtiquetaGuiaDTO[]   (feature 32)
        ├─ buildEtiquetasLotePdf(dtos)             -> Uint8Array          (lib/pdf)
        ├─ IFileStorage.upload({path, bytes, contentType})               (feature 21)
        └─ ISignedUrlProvider.createSignedUrl(path, ttl)                 (feature 22)
```

El endpoint envuelve el summary y añade `etiquetasPdf`. `BulkOrdenService` NO se
acopla a Storage (queda como servicio de dominio puro).

## 3. Configuración nueva — `lib/config/etiquetas.ts`

Patrón de `lib/config/gestion.ts` (env con default, sin hardcode, R18):

```ts
export interface EtiquetasConfig {
  ETIQUETAS_BUCKET: string;          // default "etiquetas-guia" (privado)
  SIGNED_URL_TTL_SECONDS: number;    // default 3600 (1 h)
}
```

- `ETIQUETAS_BUCKET` ← `process.env.ETIQUETAS_BUCKET?.trim() || "etiquetas-guia"`.
- `SIGNED_URL_TTL_SECONDS` ← `readPositiveInt("ETIQUETAS_SIGNED_URL_TTL_SECONDS", 3600)`.

## 4. Builder server-side del PDF — `lib/pdf/etiquetas-pdf-lote.ts`

Función pura async:

```ts
export async function buildEtiquetasLotePdf(
  etiquetas: EtiquetaGuiaDTO[],
): Promise<Uint8Array>;
```

- Replica la maqueta de `app/(app)/ordenes/_components/etiquetas-pdf.ts`
  (feature 32): página 100 × 100 mm (`SIZE_MM = 100`, `MARGIN = 6`), cabecera
  (GUÍA grande + REMISIÓN), campos con `drawField` (destinatario, teléfono,
  dirección, ubicación/geografía, producto, monto a cobrar, tienda), y abajo QR
  (26 mm) + barcode CODE128. (R2, R4)
- **QR:** `await qrcode.toDataURL(buildPaqueteUrl(etiqueta.numGuia))` → PNG data URL
  en Node. El origin lo resuelve `buildPaqueteUrl` desde `NEXT_PUBLIC_APP_URL`. (R5)
- **Barcode:** `bwip-js` genera CODE128 de `etiqueta.barcodeValue` como PNG →
  data URL. (R6)
- **PDF:** `jspdf` en Node; las imágenes se pasan como data URL (no canvas del DOM).
- Una página por etiqueta (`addPage` a partir de la segunda). El binario final se
  obtiene como `Uint8Array` (`doc.output("arraybuffer")` → `new Uint8Array(...)`).
- Devuelve un PDF de 0 páginas nunca: el llamador garantiza `etiquetas.length > 0`.

### Reuso del layout (decisión)

El generador de cliente (feature 32) usa `document.createElement`, `qrcode.react` y
`jsbarcode` sobre canvas del DOM: NO corre en Node. Se decide **NO** extraer un
módulo compartido `lib/etiquetas/pdf-layout.ts` en esta feature, por dos razones:
(1) las fuentes de imagen difieren de raíz (canvas DOM vs data URL pure-JS), así que
lo "compartible" se reduce a constantes de layout y helpers de texto; (2) extraer y
re-cablear el generador de cliente amplía el blast radius a código de otra feature
(32, done) sin ganancia clara. Se documenta el riesgo de divergencia visual y se
mitiga con un test de snapshot estructural del builder server (nº de páginas,
tamaño, campos presentes). Si en el futuro un tercer consumidor necesita el layout,
se refactoriza entonces.

## 5. Servicio orquestador — `lib/services/EtiquetasLotePdfService.ts`

Interface `lib/interfaces/services/IEtiquetasLotePdfService.ts`:

```ts
export interface EtiquetasLotePdfResultado {
  path: string;
  signedUrl: string;
  expiraEnSegundos: number;
}
export interface IEtiquetasLotePdfService {
  generarYAlmacenar(
    ordenIds: string[],
    actor: Actor,
  ): Promise<EtiquetasLotePdfResultado | null>;
}
```

Implementación con DI por constructor (testeable sin red ni DOM):

```ts
constructor(
  etiquetaService: IEtiquetaGuiaService,
  storage: IFileStorage,
  signedUrls: ISignedUrlProvider,
  ttlSeg: number,
  build: (dtos: EtiquetaGuiaDTO[]) => Promise<Uint8Array> = buildEtiquetasLotePdf,
)
```

Flujo de `generarYAlmacenar(ordenIds, actor)`:

1. `res = await etiquetaService.generarEtiquetas({ ordenIds }, actor)`.
   Si `res.status !== "ok"` o `res.etiquetas.length === 0` → `return null`. (R14)
2. `bytes = await build(res.etiquetas)`. (R1–R6)
3. `path = \`${actor.usuarioId}/${randomUUID()}.pdf\``. (R11)
4. `await storage.upload({ path, bytes, contentType: "application/pdf" })`. (R8)
5. `signedUrl = await signedUrls.createSignedUrl(path, ttlSeg)`. (R10)
6. `return { path, signedUrl, expiraEnSegundos: ttlSeg }`.

El servicio NO captura errores internamente (deja que el borde decida best-effort):
la política try/catch vive en el endpoint (§6), evitando `catch` vacíos (convención).

## 6. Cableado en el endpoint — `app/api/ordenes/api-key/carga/route.ts`

- Extender `CargaApiDeps`:

  ```ts
  export interface CargaApiDeps {
    autenticar?: ...;
    bulkService?: IBulkOrdenService;
    etiquetasService?: IEtiquetasLotePdfService;   // nuevo, inyectable en tests
  }
  ```

- Builder `buildEtiquetasService()`: instancia `EtiquetaGuiaService(new
  OrdenRepository(prisma))`, `SupabaseFileStorage(undefined, etiquetasConfig.ETIQUETAS_BUCKET)`,
  `SupabaseSignedUrlProvider(undefined, etiquetasConfig.ETIQUETAS_BUCKET)` y el TTL de config.

- Tras `cargarViaApi` OK, dentro del mismo `withErrorHandler`:

  ```ts
  const summary = cargaResult.summary;
  type EtiquetasPdf =
    | { url: string; expiraEnSegundos: number }   // éxito (R10)
    | { error: string }                           // fallo visible (R12)
    | null;                                       // nada que generar (R13/R14)
  let etiquetasPdf: EtiquetasPdf = null;
  if (summary.ordenes.length > 0) {
    try {
      const svc = deps.etiquetasService ?? buildEtiquetasService();
      const out = await svc.generarYAlmacenar(
        summary.ordenes.map((o) => o.id),
        auth.actor,
      );
      // out === null => no había etiquetas imprimibles: `null`, no es error (R14).
      etiquetasPdf = out
        ? { url: out.signedUrl, expiraEnSegundos: out.expiraEnSegundos }
        : null;
    } catch (err) {
      // Best-effort (R12): la carga ya está commiteada; NO se revierte. El fallo se
      // hace VISIBLE en la respuesta (no `null`); se registra con contexto pero el
      // mensaje al cliente es genérico (sin PII/secretos).
      console.error("etiquetas-pdf-lote: fallo best-effort", err);
      etiquetasPdf = { error: "no se pudo generar el PDF de etiquetas del lote" };
    }
  }
  return { ...summary, etiquetasPdf };
  ```

- Contrato de salida (R10/R12/R13/R17):

  ```jsonc
  {
    "total": 3, "creadas": 2, "duplicadas": 1, "conError": 0,
    "filas": [...], "ordenes": [...],
    "etiquetasPdf": { "url": "https://.../signed?token=...", "expiraEnSegundos": 3600 }
    // fallo de generación/almacenamiento (R12):  "etiquetasPdf": { "error": "no se pudo generar el PDF de etiquetas del lote" }
    // sin órdenes creadas / sin etiquetas imprimibles (R13/R14):  "etiquetasPdf": null
  }
  ```

- La generación ocurre DESPUÉS de la autenticación/autorización, dentro del bloque
  que solo se alcanza con `auth.status === "ok"` y carga `ok`; los caminos 401/403 y
  el `forbidden` de la carga retornan antes, sin tocar Storage. (R16)

## 7. Contratos I/O (resumen)

| Operación | Entrada | Salida |
| --- | --- | --- |
| `buildEtiquetasLotePdf` | `EtiquetaGuiaDTO[]` (≥1) | `Uint8Array` (PDF, N páginas) |
| `generarYAlmacenar` | `ordenIds: string[]`, `actor` | `{ path, signedUrl, expiraEnSegundos }` \| `null` |
| Endpoint (respuesta) | body de carga (sin cambios) | `CargaViaApiSummary` + `etiquetasPdf` |

## 8. Datos y seguridad

- **Sin tabla / sin migración:** el PDF es un derivado efímero; no se persiste
  metadato en Postgres, así que no hay RLS que añadir. (Anti-patrón "tabla sin RLS"
  no aplica: no hay tabla.)
- **Bucket privado** `etiquetas-guia`: creado por Ops (tarea humana). Lectura solo
  vía URL firmada con service role. (R9)
- **Sin secretos hardcodeados:** bucket y TTL por env (§3). Origin del QR por
  `NEXT_PUBLIC_APP_URL`.
- **Logs:** el `console.error` best-effort registra el error de infraestructura sin
  volcar PII de la orden ni la API key (convención de manejo de errores).

## 9. Alternativas descartadas

### A. Generar dentro de `BulkOrdenService.cargarViaApi` (en la transacción)
Acoplaría el servicio de dominio a Storage y al render de PDF, y ataría la
generación (lenta, con I/O externo) a la transacción de creación de órdenes:
un fallo de Storage o un timeout de firma podría abortar/alargar la transacción y
revertir órdenes válidas. Descartada por violar separación de capas y contradecir
R12 (best-effort, la carga ya commiteada no se revierte). El orquestador vive en el
borde, después del commit.

### B. Un PDF por orden (N objetos en Storage) + array de URLs
Simplifica el render pero contradice la decisión (c) cerrada con el humano (un solo
PDF consolidado por lote) y multiplica los round-trips de upload/firma por orden,
encareciendo la respuesta del endpoint. Descartada.

### C. Extraer `lib/etiquetas/pdf-layout.ts` compartido cliente/servidor ahora
Ver §4: las fuentes de imagen (canvas DOM vs data URL pure-JS) divergen de raíz;
compartir aportaría poco y ampliaría el blast radius a la feature 32 (done).
Descartada por ahora; se deja como refactor futuro si aparece un tercer consumidor.

### D. Devolver el PDF en base64 embebido en la respuesta (sin Storage)
Evita el bucket pero infla la respuesta (un lote grande = MBs de base64), no permite
re-descarga posterior y contradice la decisión (d) (URL firmada) y (c)
(almacenamiento en Storage). Descartada.
