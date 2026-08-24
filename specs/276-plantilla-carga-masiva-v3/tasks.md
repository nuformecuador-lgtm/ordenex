# Feature 276 — Tasks

Convenciones: `[P]` = paralelizable con las demás `[P]` del mismo bloque.
**B\*** = backend (`lib/`, tests de servicio/tipos), **F\*** = frontend
(`app/(app)/`, tests de componente).

Referencia: `requirements.md` (R1–R34), `design.md`.

---

## Bloque 0 — Base compartida (bloqueante)

- [x] **B1 — Parser puro de `canton_distrito`**
  - Archivos: `lib/utils/canton-distrito.ts` (**nuevo**),
    `lib/utils/direccion-destinatario.ts` (**se elimina** al final, en B6).
  - Contenido: `FORMATO_CANTON_DISTRITO`, `CantonDistritoPartes`,
    `ParseCantonDistritoResult`, `parseCantonDistrito(valor)` según `design.md §3`.
    Cuerpo copiado de `separarCantonDistrito` + la guarda de vacío.
  - Restricción: sin Prisma / `next/*` / Supabase / `process.env`.
  - Cubre: R12–R21.
  - **Hecho cuando**: `pnpm typecheck` pasa y `grep -rn "next/\|@prisma\|process.env" lib/utils/canton-distrito.ts` no devuelve nada.
  - **Bloquea a**: B2, B3, B4, F1.

- [x] **B2 — Tests del parser** [P]
  - Archivos: `tests/unit/utils/canton-distrito.test.ts` (**nuevo**).
  - Un caso por requisito, citando su `R<n>`: separación normal (R12), espacios y
    acentos conservados (R13), **sin `(` → distrito = cantón (R14)**, sin cerrar
    (R15), **paréntesis vacíos → distrito = cantón (R16)**, texto tras `)` (R17),
    cantón vacío (R18), valor vacío/solo espacios (R19), nunca lanza para ninguna
    entrada string (R20). Incluye la equivalencia `Cartago` ≡ `Cartago (Cartago)`.
  - **Hecho cuando**: todos pasan y cada uno cita su `R<n>`.

---

## Bloque B — Backend

- [x] **B3 — Cabecera y schema de fila**
  - Archivos: `lib/types/carga-masiva.ts`, `tests/unit/types/carga-masiva.test.ts`.
  - `REQUIRED_HEADERS` de R7; `filaCargaSchema` pierde `direccion_destinatario` y
    gana `provincia`/`canton_distrito`/`direccion` como paso-a-través.
    Sin `.strict()`, `findMissingHeaders` sigue por presencia.
  - Cubre: R7, R8, R10, R11, R30.
  - **Hecho cuando**: un test nuevo afirma que
    `findMissingHeaders(["num_remision","destinatario","telefono","direccion_destinatario"])`
    devuelve `["provincia","canton_distrito","direccion"]`, y otro que una fila
    con una columna extra (`motivo_error`) sigue validando.
  - Depende de: B1.

- [x] **B4 — Extractor de la vía sesión**
  - Archivos: `lib/services/BulkOrdenService.ts`.
  - Sustituir `geoInputDesdeDireccionUnificada` por `geoInputDesdeCantonDistrito`
    (`design.md §4`), incluida la nota de por qué NO se unifica con el extractor
    de la vía API key.
  - Cubre: R22–R26.
  - **Hecho cuando**: `grep -n "direccion_destinatario" lib/services/BulkOrdenService.ts` no devuelve nada.
  - Depende de: B1, B3.

- [x] **B5 — Tests de servicio de la vía sesión**
  - Archivos: `tests/unit/services/bulk-orden-service.carga-lote.test.ts`,
    `tests/unit/services/bulk-orden-service.test.ts`.
  - Filas de prueba pasan a las 3 columnas. Casos nuevos: provincia vacía →
    error en el campo `provincia` (R23); `canton_distrito` mal formado → error en
    su campo y SIN llamar a `resolveGeo` (R26); `direccion` vacía → fila válida
    con dirección `""` (R25); `direccion` con `/` y paréntesis internos →
    persistida literal (R24).
  - Cubre: R22–R27.
  - **Hecho cuando**: pasan y ningún test de la suite arma ya una fila v2.
  - Depende de: B4.

- [x] **B6 — Guardia de la vía API key + retirada del módulo v2**
  - Archivos: `tests/unit/services/bulk-orden-service.carga-api.test.ts`,
    `tests/unit/types/cotizacion.test.ts` (revisar), borrado de
    `lib/utils/direccion-destinatario.ts` y de
    `tests/unit/utils/direccion-destinatario.test.ts`.
  - Añadir un test que afirme que una carga por API key con
    `provincia`/`canton`/`distrito`/`direccion` sigue creando la orden, y que una
    que mande `canton_distrito` NO resuelve geografía por esa vía (R29).
  - Cubre: R28, R29.
  - **Hecho cuando**: `grep -rn "direccion_destinatario\|direccion-destinatario" lib app tests` no devuelve nada y `pnpm typecheck` pasa.
  - Depende de: B4, F1, F2 (es el último en borrar el módulo viejo).

---

## Bloque F — Frontend

- [x] **F1 — Columnas de la plantilla**
  - Archivos: `app/(app)/ordenes/_components/carga-masiva-fields.ts`.
  - Las 10 columnas de R1 en orden, claves máquina sin `label` ni sufijo (R2),
    con ejemplo cada una (R3). Ejemplo geográfico: `Cartago` +
    `Cartago (Occidental)`.
  - Cubre: R1, R2, R3, R5.
  - **Hecho cuando**: el test de round-trip de plantilla (F4) pasa.
  - Depende de: B1.

- [x] **F2 — Validación de cabecera y ayuda en pantalla**
  - Archivos: `app/(app)/ordenes/_components/OrdenesCargaUpload.tsx`,
    `tests/components/OrdenesCargaUpload.test.tsx`.
  - `direccion_destinatario` pasa a ser el **detector de archivo v2**: si aparece
    en la cabecera y faltan obligatorias, mensaje "la plantilla cambió…" (R9).
    Texto de ayuda reescrito a las 3 columnas y al formato `Cantón (Distrito)`
    (R31), importando `FORMATO_CANTON_DISTRITO`.
  - Cubre: R8, R9, R31.
  - **Hecho cuando**: un test sube una cabecera v2 y afirma el mensaje de
    plantilla cambiada, y otro sube una cabecera a la que solo le falta
    `direccion` y afirma el mensaje genérico.
  - Depende de: B3, F1.

- [x] **F3 — Export de errores y chips** [P]
  - Archivos: `app/(app)/ordenes/_components/carga-masiva-export-errores.ts`
    (solo comentarios: "8 columnas" → "10"),
    `tests/components/CargaMasivaExportErrores.test.ts`.
  - Cubre: R32, R33.
  - **Hecho cuando**: el test afirma 11 cabeceras (10 + `motivo_error`) en orden.
  - Depende de: F1.

- [x] **F4 — Round-trips y ejemplo geográfico**
  - Archivos: `tests/integration/carga-masiva-plantilla-roundtrip.test.ts`,
    `tests/integration/carga-masiva-errores-roundtrip.test.ts`,
    `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts`,
    `tests/unit/utils/xlsx-rows.test.ts`.
  - El de ejemplos-geo pasa a leer `provincia` + `parseCantonDistrito(canton_distrito)`
    y a cruzar contra el catálogo del seed (R4).
  - Cubre: R4, R11, R32.
  - **Hecho cuando**: descargar la plantilla → parsearla → validar cabecera no
    reporta ninguna columna ausente, y el ejemplo resuelve a un distrito con zona.
  - Depende de: F1, F3, B3.

---

## Cierre

- [ ] **T1 — Gate**
  - `./init.sh --rapido` en verde (typecheck + lint + tests relacionados + guardias).
  - Confirmar que el modo rápido NO se niega (esta feature no toca migraciones,
    `db/schema.prisma`, `lib/types/` de dinero ni configuración de build —
    `lib/types/carga-masiva.ts` sí está bajo `lib/types/`: **si el guardia manda
    al completo, correr `./init.sh` completo**, no negociarlo).
  - Depende de: todas.

---

## Mapa R → test (R34)

| R | Test |
|---|---|
| R1, R2, R3, R5 | `carga-masiva-plantilla-roundtrip.test.ts` (F4) |
| R4 | `carga-masiva-ejemplos-geo.test.ts` (F4) |
| R6 | `bulk-orden-service.carga-lote.test.ts` — ninguna fila aporta país (B5) |
| R7, R8, R10 | `tests/unit/types/carga-masiva.test.ts` (B3) |
| R9 | `OrdenesCargaUpload.test.tsx` (F2) |
| R11 | `carga-masiva-errores-roundtrip.test.ts` (F4) |
| R12–R21 | `tests/unit/utils/canton-distrito.test.ts` (B2) |
| R22–R27, R27b | `bulk-orden-service.carga-lote.test.ts`, `bulk-orden-service.test.ts` (B5) |
| R28, R29 | `bulk-orden-service.carga-api.test.ts` (B6) |
| R30 | `tests/unit/types/carga-masiva.test.ts` (B3) |
| R31 | `OrdenesCargaUpload.test.tsx` (F2) |
| R32, R33 | `CargaMasivaExportErrores.test.ts` (F3) |
