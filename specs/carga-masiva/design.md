# design.md — componente carga masiva (feature 9)

## Ubicación y naturaleza

- Archivo: `components/shared/BulkUpload.tsx` (`"use client"`).
- Componente compuesto, UI pura y genérico, sin acoplamiento a dominio (mismo
  criterio que `DataTable`). Reutilizable entre features (feature 14/15 lo
  consumen dentro de un modal), por lo que califica para `components/shared/`
  según `docs/architecture.md` (>= 2 consumidores).
- Reutiliza primitivas existentes: `components/ui/button.tsx` (`Button`),
  `components/ui/input.tsx` (`Input type="file"`), `components/ui/label.tsx`
  (`Label`), `components/ui/alert.tsx` (`Alert`) e íconos de `lucide-react`.
- Utilidad pura separada para generar el CSV: `lib/utils/csv-template.ts`
  (testeable sin DOM, sin React).

## Contrato público (props)

```ts
// components/shared/BulkUpload.tsx

/** Definición parametrizable de una columna de la plantilla (R1, R5, R6). */
export interface TemplateField {
  /** Clave/encabezado de la columna en la plantilla. Debe ser único. */
  key: string;
  /** Etiqueta de cabecera mostrada en el archivo. Por defecto = `key`. */
  label?: string;
  /** Valor de ejemplo opcional para la fila de muestra (R6). */
  example?: string;
}

/** Tipos de archivo admitidos para la SUBIDA (R3). */
export type UploadFileType = "csv" | "xlsx" | "xls";

export interface BulkUploadResult {
  /** Cuerpo ya parseado de la respuesta del endpoint, si lo hubo. */
  data?: unknown;
  /** Código HTTP devuelto por el endpoint. */
  status: number;
}

export interface BulkUploadError {
  /** Mensaje legible del fallo (validación, red o HTTP no exitoso). */
  message: string;
  /** Código HTTP si el fallo provino de una respuesta del servidor. */
  status?: number;
}

export interface BulkUploadProps {
  /** Ruta de la API destino del POST multipart (R2). Sin ella, la subida se deshabilita (R19). */
  endpoint?: string;
  /** Tipos de archivo permitidos para subir (R3). Al menos uno. */
  accept: UploadFileType[];
  /** Definición de columnas de la plantilla, en orden (R1, R5). */
  fields: TemplateField[];
  /** Nombre del archivo de plantilla descargado (R4). Por defecto "plantilla.csv". */
  templateFileName?: string;
  /** Nombre del campo multipart bajo el que viaja el archivo (R12). Por defecto "file". */
  fieldName?: string;
  /**
   * Límite de tamaño en bytes validado en cliente (R23). Si se omite, NO se valida
   * tamaño en cliente; el backend sigue siendo la autoridad final.
   */
  maxSizeBytes?: number;
  /** Callback tras subida exitosa (R14). */
  onSuccess?: (result: BulkUploadResult) => void;
  /** Callback tras fallo de subida (R15). */
  onError?: (error: BulkUploadError) => void;
  /** Texto accesible/título opcional del bloque. */
  label?: string;
}
```

## Decisiones técnicas

### D1 — Formato de plantilla: CSV nativo (sin dependencias) [DECISIÓN CLAVE]

La plantilla descargable se genera como **CSV** mediante una función pura
(`buildCsvTemplate(fields)`), construyendo el texto y descargándolo con un `Blob`
(`type: "text/csv;charset=utf-8"`) + `URL.createObjectURL` + un `<a download>`
sintético.

- **Por qué**: no requiere dependencias nuevas; el proyecto NO tiene ninguna
  librería de Excel instalada (ver `package.json`). Excel y Google Sheets abren
  CSV sin fricción. `docs/architecture.md` penaliza dependencias y sobre-ingeniería.
- El atributo `accept` del input file SÍ puede incluir `xlsx` para permitir subir
  Excel; parsear ese Excel es responsabilidad del backend, no de este componente.
- La extensión por defecto de la plantilla es `.csv`. Si el consumidor pasa
  `templateFileName` con otra extensión, se respeta el nombre pero el contenido
  sigue siendo texto CSV (documentado como limitación).

**Alternativa descartada — generar XLSX binario con librería (`xlsx`/`exceljs`)**:
produce un `.xlsx` real, pero (a) añade una dependencia pesada al bundle cliente
para una tarea que el CSV cubre, (b) contradice la regla anti-sobre-ingeniería, y
(c) ninguna feature consumidora conocida (14/15, ordenes) exige binario Excel para
la *plantilla*. Confirmado por decisión humana (2026-07-09): CSV nativo para todos
los casos, sin dependencia XLSX.

### D2 — Validación de tipo (extensión + MIME) y tamaño

**Regla de tipo (R10, R21, R22):** validación en dos capas al seleccionar archivo.

1. **Extensión (autoridad primaria, R10):** se compara la extensión de `file.name`
   (minúsculas) contra el conjunto derivado de `accept`. Si no coincide → rechazo.
2. **MIME (comprobación adicional, R21/R22):** se lee `file.type`:
   - Si `file.type` es **no vacío** y NO pertenece al conjunto de MIME permitidos
     para `accept`, se rechaza aunque la extensión fuese válida (R21). Motivo:
     defensa extra contra renombrados obvios cuando el navegador sí aporta MIME.
   - Si `file.type` está **vacío o ausente**, NO se rechaza por MIME; la validez la
     decide solo la extensión (R22). Motivo: los navegadores reportan MIME
     inconsistente para `.csv`/`.xlsx` (a veces vacío), y la extensión es
     determinista.

Mapa `UploadFileType` → extensión y MIME(s) aceptados (constante interna):

```ts
const FILE_TYPE_MAP: Record<UploadFileType, { ext: string; mimes: string[] }> = {
  csv:  { ext: ".csv",  mimes: ["text/csv", "application/vnd.ms-excel", "application/csv"] },
  xlsx: { ext: ".xlsx", mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  xls:  { ext: ".xls",  mimes: ["application/vnd.ms-excel"] },
};
```

La validación de contenido real (parsear filas) vive en el backend; el cliente
solo filtra por extensión + MIME.

**Regla de tamaño (R23):** si `maxSizeBytes` está definido y `file.size >
maxSizeBytes`, el archivo se rechaza con error accesible y no se habilita el envío.
Si `maxSizeBytes` es `undefined`, no se valida tamaño en cliente. El backend es la
autoridad final del límite.

### D3 — POST multipart con `fetch` + `FormData`

La subida usa `fetch(endpoint, { method: "POST", body: formData })` con
`FormData` que contiene el archivo bajo `fieldName`. NO se fija manualmente el
header `Content-Type` (el navegador añade el boundary correcto).

- Nota de arquitectura: `docs/architecture.md` dice que las *mutaciones internas*
  van por Server Action, no `fetch` a rutas internas. Aquí el componente es
  **genérico**: recibe `endpoint` por props y no conoce el destino; hacer `fetch`
  multipart es el único camino viable para un componente reutilizable que sube un
  binario a una ruta arbitraria (incluidas rutas API con validación de firma). La
  feature consumidora decide a qué endpoint apunta. Esto se documenta como
  excepción consciente para el reviewer.
- El componente trata la respuesta así:
  - `response.ok === true` → intenta `response.json()` (tolerante a body vacío) →
    `onSuccess({ status, data })` + mensaje `role="status"` (R14).
  - `response.ok === false` → construye `BulkUploadError` con `status` y mensaje →
    `onError` + mensaje `role="alert"` (R15).
  - `fetch` rechaza (red) → `BulkUploadError` sin `status` → `onError` + alert
    (R15). Nunca propaga la excepción (sin `catch` vacío: se envuelve con contexto,
    ver `docs/conventions.md`).

### D4 — Máquina de estados interna

Estado local con `useState`: `status: "idle" | "selected" | "uploading" |
"success" | "error"`, `file: File | null`, `message: string | null`.

Transiciones: `idle → selected` (archivo válido) / permanece `idle` con error de
validación (R10); `selected → uploading` (submit); `uploading → success | error`;
`success/error → selected|idle` al elegir otro archivo (R16).

Reglas de habilitación:
- "Descargar plantilla" habilitado sii `fields.length > 0` y no `uploading`
  (R13, R20).
- "Cargar archivo" habilitado sii hay archivo válido, hay `endpoint`, y no
  `uploading` (R11, R13, R19).

## Estructura de render (accesibilidad)

```
<div> (contenedor, aria-label opcional = props.label)          R17
  <Label htmlFor="bulk-upload-input">…</Label>                 R17
  <Input id="bulk-upload-input" type="file"
         accept={acceptAttr} onChange=… />                     R3, R9
  <p>{file?.name}</p>                                          R9
  <Button onClick=descargarPlantilla>Descargar plantilla</Button>  R5,R20
  <Button onClick=cargar disabled=…>Cargar archivo</Button>    R11,R12,R19
  {uploading && <span role="status">Cargando…</span>}          R13,R18
  {success && <Alert role="status">…</Alert>}                  R14,R18
  {error   && <Alert role="alert" variant="destructive">…</Alert>} R15,R18
</div>
```

El atributo `accept` del input se deriva de `accept: UploadFileType[]` a la lista
de extensiones (`.csv,.xlsx`). La validación en `onChange` usa D2.

## Contratos I/O

- **Entrada de red**: `POST {endpoint}` con `multipart/form-data`; campo
  `{fieldName}` = archivo. Sin otros campos (el componente es genérico).
- **Salida esperada**: cualquier `2xx` = éxito; el body JSON (si existe) se pasa a
  `onSuccess`. Cualquier otro estado = error, con el body/estado en `onError`.
- El componente NO valida el esquema del body (no es entrada de dominio; el
  consumidor decide qué hacer en `onSuccess`).

## Sin cambios de datos

Feature puramente frontend: no hay tablas, migraciones, RLS ni endpoints nuevos.
