# requirements.md — ordenes: carga masiva (botón + modal) (feature 14)

> En la vista de órdenes (`/ordenes`) se añade un **botón** que abre un **Modal**
> (feature 13, `components/shared/Modal.tsx`) cuyo cuerpo contiene el componente
> genérico **`BulkUpload`** (feature 9, `components/shared/BulkUpload.tsx`),
> configurado para subir el archivo al endpoint de la feature 15
> (`POST /api/ordenes/carga-masiva`). Es **pura composición** de piezas ya
> existentes: NO se crea backend ni componentes genéricos nuevos.
>
> Zona: frontend · Complejidad: low · depends_on: 9 (BulkUpload). Consume además
> feature 13 (`Modal`), feature 11 (`useToast`) y el endpoint feature 15.
> Reutiliza sin modificar: `components/shared/BulkUpload.tsx`,
> `components/shared/Modal.tsx`, `hooks/useToast.ts`, `providers/ToastProvider.tsx`
> (ya montado en `app/(app)/layout.tsx`) y el SWR de `app/(app)/ordenes/page.tsx`
> (clave `["ordenes:list", page, pageSize]`).

## Alcance

- Añadir un disparador (botón) y su modal contenedor a la vista `/ordenes`.
- Componer `BulkUpload` dentro del `Modal` con las props reales de cada componente.
- Refrescar la lista de órdenes y notificar el resultado tras una carga.

**Fuera de alcance:** el endpoint (`app/api/ordenes/carga-masiva/route.ts`, feature
15), el parseo/validación del archivo, cualquier cambio en los componentes
genéricos `BulkUpload`/`Modal`/`Toast`, la pantalla de resumen/edición de filas y
el selector de mensajero (feature 16). Este spec NO toca `src/`/`app` de backend ni
`lib/`; solo la vista de órdenes y un wrapper de cliente local.

---

## Requisitos (EARS)

### Disparador (botón) en `/ordenes`

- **R1** — El sistema DEBE renderizar en la vista `/ordenes` un botón con el nombre
  accesible **"Carga masiva"**, ubicado en una fila de cabecera por encima de la
  tabla de órdenes (`DataTable`).
- **R2** — El botón DEBE ser un control accesible: `type="button"`, alcanzable por
  teclado y con nombre accesible estable (verificable por rol `button` + name).
- **R3** — CUANDO el usuario active el botón (clic o teclado), el sistema DEBE abrir
  el modal de carga masiva (pasar a estado `open = true`), de modo que aparezca un
  elemento con rol `dialog`.

### Modal contenedor

- **R4** — CUANDO el modal esté abierto, el sistema DEBE mostrarlo con el título
  **"Carga masiva de órdenes"** (asociado como `aria-labelledby` por el `Modal`).
- **R5** — CUANDO el modal esté abierto, su cuerpo (`children`) DEBE contener el
  componente `BulkUpload` (verificable por la presencia del input de archivo y de
  los botones "Descargar plantilla" y "Cargar archivo" que `BulkUpload` renderiza).
- **R6** — El modal DEBE usarse como **contenedor puro**: NO DEBE exponer una acción
  de confirmación propia que duplique la subida. El pie del modal DEBE ofrecer un
  único control de cierre etiquetado **"Cerrar"** y NO DEBE recibir `onConfirm`
  (se monta con `hideCancel={true}` y `confirmLabel="Cerrar"`; al no haber
  `onConfirm`, ese botón solo cierra el modal). Verificable: existe exactamente un
  botón de pie "Cerrar" y NO existe un botón "Confirmar" ni "Cargar" duplicado en el
  pie.
- **R7** — CUANDO el usuario active el control "Cerrar" (o, MIENTRAS el modal esté
  abierto, presione `Escape` o haga clic en el overlay, por `dismissible` por
  defecto), el sistema DEBE cerrar el modal (`onOpenChange(false)`), de modo que el
  `dialog` deje de renderizarse.

### Configuración de `BulkUpload` (props reales)

- **R8** — El sistema DEBE montar `BulkUpload` con `endpoint="/api/ordenes/carga-masiva"`
  (la ruta del Route Handler de la feature 15).
- **R9** — El sistema DEBE montar `BulkUpload` con `accept={["csv", "xlsx"]}` (los
  dos formatos que acepta el endpoint; `UploadFileType` admite `"csv" | "xlsx" | "xls"`).
- **R10** — El sistema DEBE montar `BulkUpload` con `fieldName="file"` (nombre del
  campo `multipart` que espera el endpoint; coincide con el default de `BulkUpload`).
- **R11** — El sistema DEBE montar `BulkUpload` con `fields` igual a las 11 columnas
  del contrato de entrada del endpoint, **en este orden**: `num_remision`,
  `destinatario`, `telefono`, `provincia`, `canton`, `distrito`, `direccion`,
  `producto`, `notas`, `monto_cobrar`, `mensajero_sugerido_id` (cada una como
  `TemplateField` con su `key`; `label`/`example` opcionales de presentación).
  Verificable: las `props.fields` recibidas por `BulkUpload` tienen esas `key` en ese
  orden.
- **R12** — El sistema DEBE pasar `templateFileName="plantilla-ordenes-carga-masiva.csv"`
  para que la plantilla descargada tenga un nombre de dominio (no el genérico
  `plantilla.csv`).

### Resultado de la carga (`onSuccess` / `onError`)

- **R13** — CUANDO `BulkUpload` invoque `onSuccess(result)` (subida HTTP exitosa), el
  sistema DEBE refrescar la lista de órdenes revalidando las claves SWR de la vista
  (`mutate` sobre las claves `["ordenes:list", …]`), de modo que la tabla refleje las
  órdenes recién creadas.
- **R14** — CUANDO `BulkUpload` invoque `onSuccess(result)`, el sistema DEBE mostrar
  un toast (feature 11) con el desglose del resumen leído de `result.data`
  (`{ total, creadas, duplicadas, conError, filas }`): al menos `creadas`,
  `duplicadas` y `conError`. Verificable: se invoca `useToast().success`/`warning`
  con un mensaje que incluye esos conteos.
- **R15** — SI el resumen de `result.data` reporta `conError > 0` (o `data` ausente/no
  parseable), ENTONCES el toast de éxito DEBE usar la variante `warning` (o
  equivalente de aviso) en lugar de `success`, para señalar carga parcial; EN OTRO
  CASO DEBE usar `success`.
- **R16** — CUANDO `BulkUpload` invoque `onError(error)` (fallo HTTP o de red), el
  sistema DEBE mostrar un toast de variante `error` cuyo mensaje incluya
  `error.message`, y NO DEBE refrescar la lista.
- **R17** — **[ABIERTO-1]** ¿Cerrar el modal automáticamente al éxito?
  **Propuesta por defecto: NO.** El modal permanece abierto tras `onSuccess` para que
  el usuario vea el `Alert` de éxito interno de `BulkUpload` y el toast con el
  desglose; el cierre es manual (R7). Verificable: tras `onSuccess`, el `dialog`
  sigue presente y `onOpenChange(false)` no fue invocado por el flujo de éxito.

### Accesibilidad y alcance

- **R18** — El sistema DEBE delegar en `Modal` la semántica accesible del diálogo
  (`aria-modal`, focus-trap, restauración de foco) y en `BulkUpload` la del formulario
  de archivo; este spec solo verifica el nombre accesible del botón (R2), la
  aparición/desaparición del rol `dialog` (R3/R7) y el título (R4). NO DEBE
  reimplementar accesibilidad de esos genéricos.
- **R19** — El sistema DEBE lograrse por **composición**: NO DEBE modificar
  `BulkUpload`, `Modal`, `Toast`/`ToastProvider` ni el endpoint. Todo el código nuevo
  vive en la vista `/ordenes` y en un wrapper de cliente local bajo
  `app/(app)/ordenes/_components/`. Verificable por revisión: el diff no toca esos
  archivos genéricos ni backend.

---

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en `tasks.md`
(`tests/components/OrdenesCargaMasivaButton.test.tsx`, Vitest + @testing-library +
userEvent, `// @vitest-environment jsdom`), mockeando el `fetch` global (sin llamada
real al endpoint) y espiando `useToast` y `mutate` de SWR.

---

## Decisiones cerradas (humano, 2026-07-10)

- **[RESUELTO-1] NO cerrar el modal al éxito** (R17). El modal permanece abierto tras
  `onSuccess` para que el usuario vea el `Alert` interno de `BulkUpload` y el toast con
  el desglose; el cierre es manual (R7).
- **[RESUELTO-2] Botón "Carga masiva", solo texto**, en una fila de cabecera alineada a
  la derecha sobre el `DataTable` (R1). Sin ícono.
- **[RESUELTO-3] Sin `maxSizeBytes` en cliente**: el backend es la autoridad de límites
  (endpoint R28); el cliente no duplica el límite para evitar divergencia.
- **[RESUELTO-4] Toast de resultado solo con totales** (`creadas`/`duplicadas`/`conError`,
  R14); el detalle por fila con error es de la feature 16.
