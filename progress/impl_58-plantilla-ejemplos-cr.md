# impl 58 — plantilla carga masiva: la plantilla XLSX descargada debe poder re-subirse

## ROOT CAUSE REAL (corrección de una entrega previa defectuosa)

Síntoma: la plantilla XLSX descargable de carga masiva de órdenes NO se podía
volver a subir sin editar. La fila de ejemplo se rechazaba con
`distrito: "distrito requerido: la zona de la orden se deriva del distrito"`.

Causa exacta (NO era la geografía; los valores de ejemplo San José/San José/Carmen
son válidos y tienen zona — verificado contra el catálogo real):

- `lib/utils/xlsx-template.ts` → `headerFor(field)` sufijaba la cabecera de los
  campos `required:true` con `" *"` (constante `REQUIRED_SUFFIX`, introducida por la
  feature 51). El único campo `required:true` del repo es `distrito`
  (`app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx`).
- exceljs escribía el TEXTO `"distrito *"` en la celda de cabecera. Al reparsear
  (`lib/parsers/spreadsheet.ts`) el header se leía como `"distrito *"`, y el schema
  (`lib/types/carga-masiva.ts` `filaCargaSchema`) busca la clave `"distrito"` → no
  casa → el VALOR "Carmen" (que estaba en su celda, correcto) quedaba huérfano →
  `distrito` llegaba `""` → error de fila.
- `csv-template.ts` NO tenía el sufijo (usa `label ?? key`), por eso el CSV sí
  funcionaba; el XLSX es el default de descarga, por eso el usuario lo vio.
- El test de round-trip previo no lo cazó porque solo validaba `findMissingHeaders`,
  que chequea `REQUIRED_HEADERS = [num_remision, destinatario, telefono, provincia,
  canton]` — **distrito no está** en esa lista (es obligatorio por-fila, no por-cabecera).

### Por qué la entrega previa (revert #54) no arregló nada
La entrega previa cambió los VALORES de ejemplo de un archivo **muerto**
(`app/(app)/ordenes/_components/carga-masiva-fields.ts`), un duplicado de
`ORDENES_BULK_FIELDS` que NADIE consumía salvo el test geo. La constante VIVA vive
inline en `OrdenesCargaMasivaButton.tsx`. Además el problema nunca fue geográfico:
era el texto de la cabecera. Resultado: bug intacto.

## FIX aplicado

1. `lib/utils/xlsx-template.ts` — `headerFor` ahora devuelve SIEMPRE la clave
   máquina (`field.label ?? field.key`) sin sufijo; se eliminó `REQUIRED_SUFFIX`.
   El campo `required?: boolean` se conserva como marca SEMÁNTICA (no altera el
   texto de la cabecera). Doc actualizada: la obligatoriedad se comunica en la UI
   (el `Alert` del botón), nunca en el header del archivo (rompía el round-trip).
2. `components/shared/BulkUpload.tsx` — comentario del campo `required` reescrito
   al nuevo contrato: header = clave máquina siempre; obligatoriedad en la UI.
3. `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` — reforzado desde
   la constante REAL `ORDENES_BULK_FIELDS`:
   - XLSX/CSV: asserta que CADA `field.key` aparece VERBATIM en los headers
     re-parseados (falla con "distrito *").
   - XLSX: round-trip COMPLETO de datos: `parseSpreadsheet(...).rows[0].distrito ===
     "Carmen"` y `filaCargaSchema.parse(rows[0]).distrito === "Carmen"` (el valor
     obligatorio llega al backend con su clave correcta).
4. `tests/unit/utils/xlsx-template.test.ts` — el test "feature 51" que exigía el
   sufijo `" *"` (enforzaba el bug) se reescribió como guard del nuevo contrato:
   `required` NO altera la cabecera.
5. Código muerto eliminado: BORRADO
   `app/(app)/ordenes/_components/carga-masiva-fields.ts`; el test
   `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts` repunta su import a la
   constante REAL de `OrdenesCargaMasivaButton.tsx` (sigue verde).

NO se tocó `lib/parsers/spreadsheet.ts`, `lib/types/carga-masiva.ts`,
`lib/services/BulkOrdenService.ts` ni el backend de carga (feature 15).

## Verificación (con números)
- `npx tsc --noEmit`: **0 errores** (cliente Prisma ya regenerado).
- `npx vitest run tests/integration/carga-masiva-plantilla-roundtrip.test.ts
  tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts`: **9/9 verde**.
- `npx vitest run` (suite completa): **2330/2330 verde** (baseline 2327 + 3 tests
  nuevos de round-trip). Sin regresiones.
- Prueba de tierra (script temporal en scratchpad, ya borrado):
  `buildXlsxTemplate(ORDENES_BULK_FIELDS)` → `parseSpreadsheet(buffer,"xlsx")`:
  - HEADERS: `["num_remision","destinatario","telefono","provincia","canton","distrito","direccion","producto","notas","monto_cobrar","mensajero_sugerido_id"]`
    (header `distrito` SIN asterisco).
  - `rows[0].distrito === "Carmen"`.

---

## Follow-up UI: modal resumen (fix de layout, sin lógica)

Síntoma: tras la carga masiva, el modal avanza al paso "resumen"
(`OrdenesCargaResumen` → `DataTable` de 8 columnas). El `Modal` estaba capado en
ancho (`max-w-md`, 448px) y sin manejo de alto/overflow, así que la tabla ancha se
desbordaba y el contenido alto se salía del viewport sin scroll (Popup centrado con
`-translate-y-1/2`).

Fix en 2 capas (solo CSS/estructura Tailwind; API del `Modal` intacta):

1. `components/shared/Modal.tsx`
   - `Dialog.Popup`: se añadió `max-h-[calc(100dvh-2rem)]` (dvh para móvil, con
     margen). El `cn(..., className)` se conserva, así que el consumidor puede seguir
     overrideando el ancho.
   - Header (título/descripción): `shrink-0` para que no encoja ni scrollee.
   - Cuerpo `{children}`: pasa de `<div>` pelado a `<div className="min-h-0 flex-1
     overflow-auto">`. Es el ÚNICO bloque que scrollea (vertical y horizontal). En un
     modal corto no estira de más porque el Popup no tiene alto fijo: `flex-1` solo
     reparte espacio sobrante cuando el contenido supera `max-h`.
   - Footer (botones): `shrink-0` para que quede fijo abajo.
   - No se tocaron props, comportamiento async/confirm/dismissible, ni tests: los
     tests de `Modal.test.tsx` no asertaban estas clases, siguen verdes.

2. `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx`
   - `className` condicional al `step`: `max-w-4xl sm:max-w-5xl` en `"resumen"`,
     `undefined` en `"upload"` (mantiene `max-w-md`). tailwind-merge hace que el ancho
     del resumen override al default. El `w-[calc(100%-2rem)]` del Popup sigue
     limitando en móvil.

Select dentro de la tabla: `components/ui/select.tsx` renderiza su lista en
`SelectPrimitive.Portal` → el popup del Select NO lo recorta el `overflow-auto` del
cuerpo del modal. Sin hacks.

NO se tocó `DataTable.tsx` (el overflow lo resuelve el cuerpo del Modal),
`OrdenesCargaResumen.tsx`, backend ni la plantilla.
