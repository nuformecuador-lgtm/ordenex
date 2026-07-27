# Feature 142 — Tasks

Convenciones: `[P]` = paralelizable con las demás `[P]` del mismo bloque.
Las tareas **B\*** son de backend (`lib/`, `app/api/`, tests de servicio) y las
**F\*** de frontend (`app/(app)/`, tests de componente). Se delegan a subagentes
distintos; los bloques B y F solo se sincronizan en B1 (dependencia dura) y en T1.

Referencia de requisitos: `requirements.md` (R1–R40). Diseño: `design.md`.

---

## Bloque 0 — Base compartida (bloqueante)

- [x] **B1 — Parser puro de `direccion_destinatario`**
  - Archivos: `lib/utils/direccion-destinatario.ts` (**nuevo**)
  - Contenido: `FORMATO_DIRECCION_DESTINATARIO`, `DireccionDestinatarioPartes`,
    `ParseDireccionResult`, `parseDireccionDestinatario(valor: string)` según
    `design.md §4`.
  - Restricción: sin imports de Prisma / `next/*` / Supabase / `process.env`
    (debe ser importable desde el navegador).
  - Cubre: R11–R28.
  - **Hecho cuando**: el módulo compila con `strict`, no importa nada de servidor
    y `pnpm typecheck` pasa.
  - Depende de: nada. **Bloquea a**: B2, B3, B5, F2.

- [x] **B2 — Tests unitarios del parser**
  - Archivos: `tests/unit/utils/direccion-destinatario.test.ts` (**nuevo**)
  - Un caso (o grupo) por requisito, con el nombre describiendo el
    comportamiento: menos de 3 `/` (R13), exactamente 3 (R14), más de 3 con `/`
    y espacios internos preservados (R15), `/` final (R16), espacios sobrantes en
    cada segmento y dentro del paréntesis (R17), extracción cantón/distrito
    (R18), sin paréntesis (R19), paréntesis vacío (R20), sin cerrar (R21), texto
    tras `)` (R22), provincia vacía (R23), cantón vacío (R24), campo vacío (R25),
    dirección literal vacía aceptada (R26), país vacío / cualquiera → mismo
    resultado (R12), sin normalización de acentos/mayúsculas (R27), nunca lanza
    (R28).
  - **Hecho cuando**: todos los casos pasan y cada uno cita su `R<n>` en el
    nombre o en un comentario.
  - Depende de: B1.

---

## Bloque B — Backend

- [x] **B3 — Cabecera obligatoria y schema de fila**
  - Archivos: `lib/types/carga-masiva.ts`
  - `REQUIRED_HEADERS = [num_remision, destinatario, telefono, direccion_destinatario]`;
    `filaCargaSchema` pierde `provincia`/`canton`/`distrito`/`direccion` y gana
    `direccion_destinatario` (string trim, default `""`).
  - Cubre: R6, R7, R9 (parcial).
  - **Hecho cuando**: `findMissingHeaders(['num_remision','destinatario','telefono','provincia','canton','distrito','direccion'])`
    devuelve `['direccion_destinatario']` en un test nuevo/actualizado.
  - Depende de: B1.

- [x] **B4 — Extractores de geografía por vía en el service**
  - Archivos: `lib/services/BulkOrdenService.ts`
  - Añadir `GeoInput`, `geoInputDesdeDireccionUnificada` (usa el parser) y
    `geoInputDesdeColumnasSeparadas` (contrato feature 88); `resolveFila` recibe
    el extractor; `cargarMasiva` pasa el unificado y `cargarViaApi` el separado;
    `createData.direccion` sale de `geoInput.direccion`.
  - **`resolveGeo` NO se modifica** (ni firma ni mensajes).
  - Cubre: R29, R30, R33–R38.
  - **Hecho cuando**: el diff de `resolveGeo` es vacío y
    `tests/unit/services/bulk-orden-service.carga-api.test.ts` pasa **sin
    tocarlo** (guard de R38).
  - Depende de: B1, B3.

- [x] **B5 — Reescritura de los tests de servicio (vía sesión)**
  - Archivos: `tests/unit/services/bulk-orden-service.test.ts`
  - Migrar las fixtures a `direccion_destinatario`; conservar los casos de
    geografía no encontrada / ambigua / distrito sin zona con sus mensajes
    actuales (R34–R36); añadir: fila con dirección impareseable → `resultado:
    "error"` con clave `direccion_destinatario` (R29); lote mixto donde las filas
    válidas se crean igual (R30); paridad `dryRun` vs. firme (R31); conteo en
    `conError` del summary (R32); dirección literal vacía → `null` persistido
    (R37); `peso` sigue sin persistirse (R39).
  - **Hecho cuando**: la suite del archivo pasa y cubre los R listados.
  - Depende de: B4.

- [x] **B6 [P] — Guard de no-regresión de la vía API key**
  - Archivos: `tests/unit/services/bulk-orden-service.carga-api.test.ts`
    (solo añadir, no reescribir)
  - Añadir un caso explícito: una fila con `provincia`/`canton`/`distrito`
    separados y **sin** `direccion_destinatario` se crea igual por `cargarViaApi`.
  - Cubre: R38.
  - **Hecho cuando**: el caso pasa y el resto del archivo sigue intacto.
  - Depende de: B4.

- [x] **B7 [P] — Verificar que el borde HTTP no cambia**
  - Archivos: `app/api/ordenes/carga-masiva/chunk/route.ts`,
    `app/api/ordenes/api-key/carga/route.ts`,
    `tests/integration/api/ordenes-carga-masiva-chunk.route.test.ts`
  - No debe requerir cambios de código. Confirmar que la suite de ambos
    endpoints pasa sin modificaciones.
  - Cubre: R31 (parcial), R40.
  - **Hecho cuando**: `git diff` de ambos `route.ts` está vacío y sus tests pasan.
  - Depende de: B4.

- [x] **B8 [P] — Confirmar ausencia de migración**
  - Archivos: `db/` (solo verificación)
  - **Hecho cuando**: no hay carpeta nueva bajo `db/migrations/` ni diff en
    `db/schema.prisma` (R40).
  - Depende de: nada.

---

## Bloque F — Frontend

- [x] **F1 — Nueva definición de columnas de la plantilla**
  - Archivos: `app/(app)/ordenes/_components/carga-masiva-fields.ts`
  - `ORDENES_BULK_FIELDS` = 8 campos en el orden exacto de R1, sin `label`, con
    `example` por campo (`design.md §5`).
  - Cubre: R1, R2, R3, R5.
  - **Hecho cuando**: `ORDENES_BULK_FIELDS.map(f => f.key)` es exactamente
    `["destinatario","telefono","direccion_destinatario","monto_cobrar","producto","num_remision","peso","notas"]`.
  - Depende de: nada (no necesita B1).

- [x] **F2 — Mensaje de corte duro en el paso de subida**
  - Archivos: `app/(app)/ordenes/_components/OrdenesCargaUpload.tsx`
  - Cuando `findMissingHeaders` incluye `direccion_destinatario`, el mensaje de
    error añade la indicación de descargar la plantilla nueva; revisar el texto
    del `hint` para que no prometa columnas geográficas separadas.
  - Cubre: R8.
  - **Hecho cuando**: el mensaje se ve en el test de F4 y no se envía ningún
    chunk al servidor en ese caso.
  - Depende de: B3.

- [x] **F3 [P] — Verificar que los helpers de presentación no cambian**
  - Archivos: `carga-masiva-parser.ts`, `carga-masiva-chunks.ts`,
    `carga-masiva-clasificacion.ts`, `carga-masiva-error-chips.ts`
  - Son agnósticos del nombre de campo; confirmar que no requieren cambios y que
    los chips agrupan correctamente el error nuevo por tipo (R32).
  - **Hecho cuando**: `git diff` de los cuatro archivos está vacío y
    `tests/components/CargaMasivaErrorChips.test.ts` pasa.
  - Depende de: nada.

- [x] **F4 — Tests de componente del paso de subida**
  - Archivos: `tests/components/OrdenesCargaUpload.test.tsx`
  - Actualizar `HEADERS_OK` al set nuevo; añadir: archivo con las 4 columnas
    viejas y sin `direccion_destinatario` → error de cabecera con mensaje que
    apunta a la plantilla nueva y sin request al endpoint (R7, R8); archivo con
    columnas extra desconocidas además de las obligatorias → se procesa (R10).
  - **Hecho cuando**: la suite del archivo pasa.
  - Depende de: F1, F2.

---

## Bloque C — Round-trip y ejemplo de la plantilla (cierra backend + frontend)

- [x] **C1 — Reescritura del round-trip de plantilla**
  - Archivos: `tests/integration/carga-masiva-plantilla-roundtrip.test.ts`
  - Conservar: cabecera = clave máquina, cada clave verbatim en XLSX y CSV,
    `findMissingHeaders` vacío tras re-parsear. Sustituir el caso del `distrito`
    por: el valor de ejemplo de `direccion_destinatario` llega verbatim bajo su
    clave y `parseDireccionDestinatario` lo resuelve a las 4 partes. Añadir el
    guard de **orden exacto** de las 8 columnas.
  - Cubre: R1, R2, R3.
  - **Hecho cuando**: la suite del archivo pasa.
  - Depende de: B1, F1.

- [x] **C2 — Reescritura del guard de geografía del ejemplo**
  - Archivos: `tests/unit/scripts/carga-masiva-ejemplos-geo.test.ts`
  - Obtiene la terna aplicando `parseDireccionDestinatario` al ejemplo de
    `direccion_destinatario` y mantiene las dos aserciones contra los XLSX del
    seed (terna existe en el catálogo / distrito con zona).
  - Cubre: R4.
  - **Hecho cuando**: la suite pasa. **Si falla**, se sustituye el ejemplo por
    otra terna real del seed (ver `design.md > Preguntas abiertas #4`) y se
    actualiza F1 en consecuencia.
  - Depende de: B1, F1.

---

## Bloque T — Cierre

- [x] **T1 — Verificación ejecutable completa**
  - Correr `./init.sh`, `pnpm typecheck`, `pnpm lint` y la suite completa de
    tests en el worktree.
  - **Hecho cuando**: todo en verde y el delta de tests fallidos respecto al
    baseline de la rama es 0.
  - Depende de: B2, B5, B6, B7, B8, F3, F4, C1, C2.

- [x] **T2 — Mapa de trazabilidad `R<n> → test`**
  - Archivos: `progress/impl_142-plantilla-carga-masiva-v2.md`
  - Tabla con una fila por requisito R1–R40: requisito → archivo de test →
    nombre del caso. Ningún requisito puede quedar sin test.
  - **Hecho cuando**: los 40 requisitos aparecen mapeados y el reviewer puede
    ejecutar cada caso citado por nombre.
  - Depende de: T1.
