# design.md — ordenes: carga masiva (botón + modal) (feature 14)

## Resumen

Composición pura en el frontend: un botón en `/ordenes` abre un `Modal` (feature 13)
que contiene el `BulkUpload` (feature 9) apuntando al endpoint `POST
/api/ordenes/carga-masiva` (feature 15). Sin backend, sin componentes genéricos
nuevos, sin cambios en los genéricos existentes.

## Piezas reales que se componen (verificadas en repo)

- **`components/shared/BulkUpload.tsx`** — `BulkUploadProps`: `endpoint?`,
  `accept: UploadFileType[]` (`"csv"|"xlsx"|"xls"`), `fields: TemplateField[]`
  (`{ key; label?; example? }`), `templateFileName?`, `fieldName?` (default `"file"`),
  `maxSizeBytes?`, `onSuccess?(result: BulkUploadResult)`, `onError?(error: BulkUploadError)`,
  `label?`. Ya trae sus propios botones "Descargar plantilla" y "Cargar archivo", su
  input de archivo, su validación de tipo/tamaño en cliente y hace el `POST`
  `multipart/form-data` con `FormData.append(fieldName, file)`. `BulkUploadResult =
  { status: number; data?: unknown }`; `BulkUploadError = { message: string; status?: number }`.
- **`components/shared/Modal.tsx`** — `ModalProps`: `open`, `onOpenChange`, `title`,
  `description?`, `children?`, `confirmLabel?`, `cancelLabel?`, `confirmVariant?`,
  `hideCancel?`, `onConfirm?`, `onCancel?`, `onError?`, `closeOnConfirm?`,
  `dismissible?`, `className?`. Con `onConfirm` ausente, `handleConfirm` no encuentra
  thenable y, con `closeOnConfirm` por defecto `true`, invoca `onOpenChange(false)`:
  el botón de pie actúa como **cierre**.
- **`hooks/useToast.ts`** / **`providers/ToastProvider.tsx`** — `useToast()` devuelve
  `{ show, success, error, info, warning, dismiss }`. El `ToastProvider` ya envuelve
  toda la sección en `app/(app)/layout.tsx`; no hay que montarlo de nuevo.
- **`app/(app)/ordenes/page.tsx`** — Client Component con SWR, clave
  `["ordenes:list", page, pageSize]`, fetcher sobre `listarOrdenes`.

## Decisiones técnicas

### D1 — Wrapper de cliente local `OrdenesCargaMasivaButton`

Se crea **`app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx`** (`"use client"`),
colocado junto a `ordenes-columns.tsx`. Encapsula:

- Estado local `const [open, setOpen] = useState(false)`.
- El `Button` disparador (nombre "Carga masiva") → `onClick={() => setOpen(true)}`.
- El `Modal` contenedor + el `BulkUpload` como `children`.
- Los callbacks `onSuccess`/`onError` (toast + refresh).

**Por qué un wrapper y no inline en `page.tsx`:** mantiene `page.tsx` enfocado en la
lista, aísla la lógica de toasts/mutate para testearla con testing-library sobre un
componente montable, y respeta R19 (composición local, no genérico nuevo).
`page.tsx` solo renderiza `<OrdenesCargaMasivaButton />` en una fila de cabecera
sobre el `DataTable` (R1).

### D2 — Modal como contenedor puro (R6)

`BulkUpload` ya tiene su acción de subida; añadir un `onConfirm` que también suba
duplicaría la acción. Se monta el `Modal` así:

```
<Modal
  open={open}
  onOpenChange={setOpen}
  title="Carga masiva de órdenes"
  hideCancel                    // sin botón "Cancelar"
  confirmLabel="Cerrar"         // el único botón de pie cierra el modal
  // sin onConfirm  -> el clic en "Cerrar" cae en onOpenChange(false)
  // dismissible por defecto true -> Escape/overlay también cierran (R7)
>
  <BulkUpload … />
</Modal>
```

Resultado: un solo botón de pie "Cerrar", ninguna acción de confirmación que compita
con "Cargar archivo" de `BulkUpload`.

### D3 — Configuración de `BulkUpload` (R8–R12)

```
<BulkUpload
  endpoint="/api/ordenes/carga-masiva"
  accept={["csv", "xlsx"]}
  fieldName="file"
  templateFileName="plantilla-ordenes-carga-masiva.csv"
  fields={ORDENES_BULK_FIELDS}
  onSuccess={handleSuccess}
  onError={handleError}
  label="Archivo de órdenes"
/>
```

`ORDENES_BULK_FIELDS: TemplateField[]` (constante local en el wrapper), en el orden
del contrato del endpoint (spec feature 15, "Columnas del archivo"):

| # | key | obligatoria (endpoint) | example sugerido |
|---|-----|------------------------|------------------|
| 1 | `num_remision` | sí | `REM-0001` |
| 2 | `destinatario` | sí | `Juan Pérez` |
| 3 | `telefono` | sí | `0999999999` |
| 4 | `provincia` | sí | `Pichincha` |
| 5 | `canton` | sí | `Quito` |
| 6 | `distrito` | no | `Iñaquito` |
| 7 | `direccion` | no | `Av. Amazonas N34-451` |
| 8 | `producto` | sí | `Camiseta talla M` |
| 9 | `notas` | no | `Entregar en la tarde` |
| 10 | `monto_cobrar` | no | `25.90` |
| 11 | `mensajero_sugerido_id` | no | `` (vacío) |

Los `example` son de presentación en la plantilla; el `label` puede igualar `key` o
un texto legible; lo verificable por test es la lista y el orden de `key`.

### D4 — Refresh de la lista vía SWR `mutate` (R13)

La clave SWR de `page.tsx` es un array con `page`/`pageSize`, así que no se puede
mutar por clave exacta sin conocerlos. Se usa el **matcher de claves** de
`useSWRConfig`:

```
const { mutate } = useSWRConfig();
// en handleSuccess:
await mutate(
  (key) => Array.isArray(key) && key[0] === "ordenes:list",
  undefined,           // revalida sin dato optimista
  { revalidate: true },
);
```

Esto revalida todas las páginas cacheadas de la lista sin acoplar el wrapper al
`page`/`pageSize` actuales. El wrapper y la page comparten el mismo `SWRConfig`
(mismo árbol de React), por lo que el matcher alcanza la caché de la lista.

### D5 — Toasts de resultado (R14–R16)

```
function handleSuccess(result: BulkUploadResult) {
  const s = parseResumen(result.data); // { total, creadas, duplicadas, conError } | null
  void mutate(matcher, undefined, { revalidate: true }); // R13
  const msg = s
    ? `Carga: ${s.creadas} creadas, ${s.duplicadas} duplicadas, ${s.conError} con error`
    : "Carga procesada";
  if (!s || s.conError > 0) toast.warning(msg); // R15
  else toast.success(msg);                       // R14
  // R17 [ABIERTO-1]: NO se cierra el modal (no se llama setOpen(false))
}

function handleError(error: BulkUploadError) {
  toast.error(`No se pudo cargar el archivo: ${error.message}`); // R16
}
```

`parseResumen` es un guard defensivo local sobre `result.data` (que llega `unknown`):
si tiene forma `{ creadas, duplicadas, conError }` numérica, la usa; si no, devuelve
`null` y se cae a `warning` (R15).

### D6 — Accesibilidad (R2, R18)

Se delega en `Modal` (aria-modal, focus-trap, restauración de foco) y en `BulkUpload`
(label del input). El botón disparador usa `Button` de `@/components/ui/button` con
texto visible "Carga masiva" (nombre accesible). No se reimplementa nada.

## Contratos de E/S

- **Salida al endpoint:** la construye `BulkUpload` (no este código): `POST`
  `multipart/form-data`, campo `file`. Este spec solo fija `endpoint`, `accept`,
  `fieldName`, `fields`.
- **Entrada desde el endpoint (para el toast):** cuerpo JSON
  `{ total, creadas, duplicadas, conError, filas[] }` (spec feature 15, R30); llega
  como `result.data: unknown` y se valida con `parseResumen` (D5).

## Estilo / convenciones

- Client Components (`"use client"`), TypeScript strict, sin `any` (usar guards sobre
  `unknown`). Nombres en inglés para el componente, textos de UI en español
  (consistente con `BulkUpload`/`Modal`). Iconos de `lucide-react` opcionales.

---

## Alternativa descartada

**A1 — Meter el botón, el estado y los callbacks directamente en `page.tsx`
(sin wrapper).** Ventaja: un archivo menos y acceso directo al `mutate` de la SWR
local con la clave exacta. **Descartada porque:** (1) mezcla la responsabilidad de la
lista con la de la carga en un mismo componente, engordando `page.tsx`; (2) el test
tendría que montar toda la página (con `listarOrdenes`, `DataTable`, `Pagination`)
para verificar el flujo de carga, en vez de un componente pequeño y aislado; (3) el
`mutate` por clave exacta acopla el disparo a `page`/`pageSize`, mientras que el
matcher de `useSWRConfig` (D4) revalida todas las páginas cacheadas sin ese
acoplamiento. El wrapper local (D1) da mejor testabilidad y separación con costo
mínimo, sin volverse un genérico (respeta R19).

**A2 — Usar `onConfirm` del Modal para disparar la subida** (Modal con botón
"Cargar"). **Descartada porque** `BulkUpload` ya posee su botón "Cargar archivo" y su
máquina de estados (selected/uploading/success/error): duplicar la acción en el pie
del modal generaría dos caminos de subida divergentes y romper el contrato interno de
`BulkUpload`. Por eso el Modal se usa como contenedor puro (D2, R6).
