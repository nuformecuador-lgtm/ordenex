# Impl — Carga masiva UI (frontend puro)

Rama: `worktree-carga-masiva-ui` (base `origin/dev` `a0957ec`). Sin commit.

## Alcance
Cambio de PRESENTACIÓN del flujo de carga masiva. No se tocó `lib/repositories/`,
`lib/services/`, `lib/actions/`, `db/`, ni la lógica pura del pipeline
(`carga-masiva-parser`, `carga-masiva-chunks`, `carga-masiva-clasificacion`,
`carga-masiva-error-chips`, `carga-masiva-fields`, `lib/config/carga-masiva`,
`lib/utils/xlsx-template`).

## Archivos tocados
- `components/ui/button.tsx` — variante `brand-outline` (nueva, aditiva).
- `components/shared/Modal.tsx` — prop `size` + `confirmVariant` ampliada.
- `components/shared/BulkUpload.tsx` — refactor: selector de archivo shared.
- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` — `size="xl"`, stepper.
- `app/(app)/ordenes/_components/OrdenesCargaUpload.tsx` — ahora consume `BulkUpload`.
- `app/(app)/ordenes/_components/OrdenesCargaPreview.tsx` — chips/acciones de marca.
- `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx` — barra global + acción.
- `tests/components/BulkUpload.test.tsx` — reescrito al contrato nuevo.
- `tests/components/Modal.test.tsx` — +9 tests (`size`, `confirmVariant`).
- `tests/components/button.test.tsx` — NUEVO (variante + regresión de existentes).

`OrdenesCargaResumenPaso.tsx` NO se tocó (sigue huérfano, su test sigue verde).

## API final

### `Modal.size`
```ts
export type ModalSize = "sm" | "md" | "lg" | "xl";
size?: ModalSize; // default "md"
```
`sm=max-w-sm`, `md=max-w-md` (histórico → los ~23 consumidores no cambian),
`lg=max-w-2xl`, `xl=max-w-[1000px]`. Se conserva `w-[calc(100%-2rem)]`
(responsive) y el fix de altura/scroll de la feature 58 (`max-h`, `min-h-0
flex-1 overflow-auto`, header/footer `shrink-0`). `className` del consumidor
sigue ganando (tailwind-merge). Además `confirmVariant` admite ahora
`"brand-outline"` (aditivo; default sigue `"default"`).

### `Button` variante `brand-outline`
Fondo `bg-background`, `border-brand`, `text-brand`; hover `bg-brand-soft` +
`text-brand-dark`; `focus-visible:border-brand` + `ring-brand/30`; dark mode
propio. `default` y `outline` NO se tocaron (con test de regresión). Solo se usa
en el flujo de carga masiva.

### `BulkUpload` (shared de carga de archivos)
```ts
{ accept, fields?, templateFileName?, maxSizeBytes?, validateMime?, label?,
  hint?, busy?, error?, onFileSelected, onClear?, children? }
```
Sigue exportando `TemplateField` y `UploadFileType` (los importa
`carga-masiva-fields.ts`; el build depende de ello).

## Qué pasó con el POST multipart
Se ELIMINÓ de `BulkUpload` (junto con `endpoint`, `fieldName`, `onSuccess`,
`BulkUploadResult`, `BulkUploadError`). El componente ya no decide el transporte:
valida tipo/tamaño y entrega el archivo por `onFileSelected`; el consumidor hace
lo suyo. Carga masiva mantiene intacto su pipeline (parseo en navegador +
`procesarEnChunks` dry-run → confirmar), que vive en `OrdenesCargaUpload`.
El componente estaba huérfano, así que no se rompió ningún consumidor.

## Números medidos (antes → después)
- `tsc --noEmit`: 0 → 0.
- `eslint`: 0 errores / 140 warnings → 0 errores / 140 warnings.
- Suite completa: 12 fallos / 3098 pasan → 12 fallos / 3098 pasan (mismos fallos
  ajenos y flakes; verificados en aislado, ninguno mío).
- Archivos del flujo (8 test files): 90 pasan → 114 pasan (+24).
- `console.log` en lo entregado: ninguno.

Nota de entorno: el worktree no traía `.env` y faltaba el cliente Prisma
generado; se corrió `prisma generate` con un `DATABASE_URL` dummy (generate no
conecta) para poder medir el typecheck.
