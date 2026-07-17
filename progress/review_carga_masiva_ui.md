# Review — carga masiva UI (restyling)

Rama `worktree-carga-masiva-ui` · base `origin/dev` @ `a0957ec`.
Cambio de UI sin spec SDD (`sdd:false`): NO se exige requirements/design/tasks ni
trazabilidad `R<n>→test`. Los checkpoints de Especificación/Trazabilidad son N/A.

## Checklist

- [x] `pnpm typecheck` — 0 errores (medido).
- [x] `pnpm lint` — 0 errores / 140 warnings (medido; warnings preexistentes, ajenos al diff).
- [x] `pnpm test` — sin regresiones atribuibles al diff (ver "Suite").
- [x] Cero `console.log`/`console.debug` en el diff (verificado sobre `git diff origin/dev`).
- [x] Pipeline de carga masiva idéntico (parseo → dry-run por chunks → preview → confirmar → asignación).
- [x] `Modal`: default `md` = `max-w-md` intacto; `className` sigue sobreescribiendo.
- [x] Fix de altura/scroll de la feature 58 intacto.
- [x] `Button`: `default` y `outline` intactos; `brand-outline` por tokens, sin hex.
- [x] Accesibilidad: `<input type="file">` real presente, enfocable y con label.
- [x] Sin pérdida de cobertura encubierta.
- [x] `OrdenesCargaResumenPaso.tsx` intacto (0 cambios).
- N/A RLS / migraciones / webhooks / capas: el diff no toca DB, API ni servicios.

## Verificación de las afirmaciones del implementer

**MIME — CIERTA.** `origin/dev:OrdenesCargaUpload.tsx` validaba solo extensión
(`extensionDe` + `ORDENES_BULK_ACCEPT`) y tamaño; nunca MIME. El viejo
`BulkUpload` sí tenía capa MIME. Pasar `validateMime={false}` desde carga masiva
preserva el comportamiento exacto. El default `true` es seguro: es el más
estricto, conserva la semántica del `BulkUpload` histórico y solo aplica cuando
el navegador aporta un MIME no vacío (R22 sigue cubierto).

**Tests de POST multipart — CIERTO.** Se eliminó el bloque
"subida multipart (R2, R12–R18)", R19 y el R11 de "Cargar archivo": todos
cubrían `endpoint`/POST, código removido por decisión del humano. Único consumidor
de `BulkUpload` es `OrdenesCargaUpload`; nadie usaba `endpoint`. Se reemplazó por
cobertura real del contrato nuevo (`onFileSelected`, `onClear`, `busy`, `error`,
`children`, `hint`, drag&drop, ambos sentidos de `validateMime`, input enfocable).
`Modal.test.tsx` y `button.test.tsx` son puramente aditivos; ningún test ajeno
borrado ni aflojado. `button.test.tsx` añade guardas de regresión explícitas para
`default`/`outline`.

## Pipeline (lo crítico)

`OrdenesCargaUpload.validar()` es idéntico línea por línea: `parseArchivo` →
`findMissingHeaders` → filas 0 → `MAX_ROWS` → `dedupPorRemision` →
`procesarEnChunks({dryRun:true, mensajeroSugeridoId:"", chunkSize, onProgress})`
→ `combinarResultados` → `clasificarBulkSummary` → `onValidated`. `mensajeDeError`
conserva el manejo de `ParseArchivoError` y `ChunkRequestError`. Aceptados/
rechazados equivalentes (`.csv,.xlsx`), mismo `MAX_FILE_BYTES`, reset por
`onClear`/`handleOpenChange` preservado.

## Suite (medido, no citado)

- Flujo completo carga masiva + Modal + Button: **12 archivos, 143 tests, todos verdes**.
- Suite completa: 58 fallos / 3052 pasan. TODOS son `Test timed out in 5000ms`.
- El conjunto de fallos es **inestable sobre el mismo código** (18 → 9 archivos entre
  corridas; 5 → 6 → 7 tests): firma de flake por carga, no de regresión.
- Baseline medido con `git stash` (árbol limpio en `origin/dev`, mismos 9 archivos):
  **5 fallos, mismos timeouts**. Ningún archivo que falla referencia `Modal` ni
  `CargaMasiva`. `HomePageMaestro` pasa en aislado (5/5). `CierreDiaPage` falla
  también en `dev` limpio → preexistente.
- Conclusión: **ningún fallo es atribuible a este diff**.

## Hallazgos

- `menor` — `BulkUpload.tsx:handleSelect`: si no hay archivo (`!selected`) ahora
  retorna sin limpiar `fileName`; antes se reseteaba el estado. Irrelevante en la
  práctica (los navegadores no emiten `change` al cancelar el diálogo).
- `menor` — Mensaje de tamaño excedido pasa de "El archivo excede el tamaño máximo
  permitido." a incluir la unidad legible ("… (20 MB)."). Mejora, pero es un cambio
  de texto dentro de un encargo de presentación.
- `menor` — `OrdenesCargaMasivaButton.tsx`: se añade `description` al Modal
  (subtítulo por paso) e indicador de pasos: es contenido nuevo, no solo estilo.
  Aditivo y sin efecto sobre el flujo.
- `menor` — `text-white` literal en el indicador de pasos y en los chips activos
  (`OrdenesCargaPreview.tsx`) en vez de un token tipo `text-brand-foreground`.
  Es utilidad Tailwind estándar, no hex suelto; no bloquea.
- `menor` — El ancho en pantallas grandes cambia de `75vw` a `1000px` fijo. Es
  exactamente lo pedido por el humano; se registra solo por visibilidad.

Sin hallazgos `BLOQUEANTE`.

## Veredicto

**OK** — APROBADO.
