# Feature 119 — Evidencias de gestión: de 1 a 1..N fotos · requirements.md

> Zona: fullstack · Complexity: high · Rama: `feature/119-evidencias-multiples-fotos`
> depends_on: 75 (done) · Fuente de verdad: `feature_list.json#119`.

## Contexto (estado actual, NO es requisito)

Hoy la evidencia de una gestión es **una sola foto**: `gestion_orden.evidencia_storage_path`
+ `evidencia_content_type` (`db/schema.prisma:461-462`). El flujo `gestionar`
(`lib/services/MisAsignacionesService.ts:257-354`) sube 1 archivo al bucket privado
`gestion-evidencias` ANTES de la transacción y limpia con `storage.remove([path])` si la tx
falla (`:337-339`). El borde lee 1 `File` del `FormData` (`lib/actions/mis-asignaciones.ts:200-201,
257-260`) validado por `gestionarSchema` (`lib/types/gestion-orden.ts:110-148`, MIME jpeg/png/webp
+ tamaño en `lib/config/gestion.ts:14-41`). El panel usa un `<input type="file">` único por rama
(`app/(app)/mis-asignaciones/_components/GestionarOrdenPanel.tsx:418-514`). La evidencia se exige
en **entregada / rechazada / devuelta** (la 75 añadió `devuelta`); `reprogramada` no lleva foto.

Consumidores que HOY leen `evidencia_storage_path` (fuera del alcance de esta feature, ver R11):
cierre del día (37) `lib/services/CierreDiaService.ts:148-152`, cierres admin (38)
`lib/services/CierresAdminService.ts:126-130`, cierres bodega (40) `CierresBodegaAdminService.ts:74-78`,
y la API de lectura (106) `lib/repositories/OrdenRepository.ts:1182-1202`.

## Requisitos (EARS)

### Modelo de datos y migración

- **R1** — El sistema DEBE persistir las evidencias de una gestión en una tabla nueva
  `gestion_orden_evidencia` con las columnas `gestion_id` (FK → `gestion_orden.id`),
  `storage_path`, `content_type` e `indice`, en relación **1:N** (una gestión, 0..N evidencias).

- **R2** — CUANDO se registran N evidencias en una gestión, el sistema DEBE asignar a cada fila un
  `indice` entero contiguo `0..N-1` según el ORDEN en que llegaron, y ese `indice` DEBE ser único
  por `gestion_id` (no puede haber dos filas con el mismo `(gestion_id, indice)`).

- **R3** — CUANDO se aplica la migración (backfill), para CADA `gestion_orden` con
  `evidencia_storage_path` NO nulo el sistema DEBE crear **exactamente una** fila en
  `gestion_orden_evidencia` con `indice = 0`, copiando `storage_path` y `content_type` desde las
  columnas actuales. Las gestiones sin evidencia (path nulo) NO generan ninguna fila.

- **R4** — La tabla nueva DEBE nacer con Row Level Security habilitada y sin policies (solo service
  role), y la migración DEBE incluir su `down.sql` que la revierte (drop de la tabla) sin borrar ni
  alterar las columnas ni los datos preexistentes de `gestion_orden`.

### Contrato de gestión (backend)

- **R5** — El sistema DEBE aceptar en la entrada de `gestionar` una lista de evidencias
  (`EvidenciaArchivo[]`) en los resultados **entregada, rechazada y devuelta**; el resultado
  **reprogramada** NO lleva evidencias.

- **R6** — SI en un resultado que exige evidencia (entregada/rechazada/devuelta) la lista tiene
  menos de 1 elemento, ENTONCES el sistema DEBE rechazar la gestión con `validation_error` en el
  campo de evidencia, sin subir nada al storage ni escribir en la base.

- **R7** — SI la lista de evidencias supera el máximo configurado (por defecto **3**), ENTONCES el
  sistema DEBE rechazar la gestión con `validation_error`, sin subir nada al storage ni escribir en
  la base.

- **R8** — SI **alguna** de las evidencias no cumple la validación de tipo MIME
  (`image/jpeg` | `image/png` | `image/webp`) o supera el tamaño máximo por archivo, ENTONCES el
  sistema DEBE rechazar la gestión con `validation_error`, sin subir nada al storage ni escribir en
  la base. La validación se aplica **por archivo** (una sola foto inválida invalida el envío).

### Atomicidad storage ↔ DB (el corazón de la feature)

- **R9** — CUANDO una gestión con evidencias se registra con éxito, el sistema DEBE haber subido las
  N fotos al bucket privado y haber insertado en una **única transacción de base de datos** la fila
  `gestion_orden` + sus N filas `gestion_orden_evidencia` + la transición de estado de la orden
  (todo-o-nada).

- **R10** — SI falla la subida de **UNA** de las N evidencias al storage, ENTONCES el sistema DEBE
  borrar del storage las evidencias ya subidas de esa misma gestión y NO persistir NADA en la base
  (rollback TOTAL: ni gestión, ni filas de evidencia, ni transición de estado). El fallo se propaga
  como error, no como resultado de dominio.

- **R11** — SI la transacción de base de datos falla DESPUÉS de subir las N evidencias, ENTONCES el
  sistema DEBE borrar del storage las N evidencias subidas de esa gestión (best-effort) y no dejar
  ninguna fila persistida.

- **R12** — El sistema DEBE conservar en `gestion_orden.evidencia_storage_path` /
  `evidencia_content_type` la evidencia de `indice 0` (portada) de cada gestión nueva, escrita en la
  MISMA transacción que las filas de `gestion_orden_evidencia`, para que los consumidores actuales
  (cierres 37/38/40, API 106) sigan mostrando la portada sin cambios. (Decisión de columnas:
  design.md §2.)

- **R13** — CUANDO una gestión con evidencias se registra con éxito, el sistema DEBE poder devolver
  las URLs firmadas (TTL acotado) de sus N evidencias, y NUNCA el `storage_path` crudo ni el nombre
  del bucket.

### Frontend (panel del mensajero)

- **R14** — DONDE el mensajero gestiona una orden como entregada, rechazada o devuelta, la UI DEBE
  permitir seleccionar **múltiples** fotos de evidencia (hasta el máximo de R7).

- **R15** — MIENTRAS el mensajero tiene fotos seleccionadas, la UI DEBE mostrar una **previsualización**
  de cada foto y permitir **quitar** cada una individualmente antes de enviar.

- **R16** — SI el mensajero intenta seleccionar más fotos de las permitidas (R7) o una foto que no
  cumple MIME/tamaño (R8), ENTONCES la UI DEBE impedir el envío y mostrar el error correspondiente,
  sin llamar a la Server Action.

- **R17** — MIENTRAS no haya al menos una foto en una rama que la exige (entregada/rechazada/
  devuelta), la UI DEBE impedir el envío de la gestión (mismo criterio que R6, validado en cliente).

## Trazabilidad (cada R → test; el implementer completa `progress/impl_119...md`)

| R  | Verificación esperada |
| -- | --- |
| R1/R2 | Test estático de `migration.sql` (tabla + columnas + FK + `@@unique(gestion_id, indice)`) + unit del repo que inserta N filas con `indice 0..N-1` |
| R3 | Test estático del backfill (SELECT ... WHERE evidencia_storage_path IS NOT NULL → indice 0) |
| R4 | Test estático: `ENABLE ROW LEVEL SECURITY` sin `CREATE POLICY`; `down.sql` con `DROP TABLE` y sin tocar `gestion_orden` |
| R5/R6/R7/R8 | Unit de `gestionarSchema` (array min 1 / max N / MIME+tamaño por archivo) por rama |
| R9 | Unit del repo `crearGestionYTransicionar`: gestión + N evidencias + transición en un `$transaction` |
| R10 | Unit del service: subida #k falla → `storage.remove` con las k-1 previas y repo NO invocado |
| R11 | Unit del service: repo lanza → `storage.remove` con las N y error propagado |
| R12 | Unit del repo: `evidencia_storage_path/_content_type` = evidencia índice 0 en el mismo insert |
| R13 | Unit del service: `createSignedUrls` con TTL de config; resultado sin path crudo |
| R14/R15/R16/R17 | Test de componente `GestionarOrdenPanel` (multi-select, previews, quitar, tope, bloqueo de envío) |

## Preguntas abiertas

1. **Consumidores de lectura (cierres 37/38/40 y API 106):** esta feature mantiene la **portada**
   (índice 0) en las columnas viejas para que sigan funcionando sin cambios (R12). Mostrar las N
   fotos en esas vistas y en la API 106 (que ya habla de "esa(s) evidencia(s)" en plural) se propone
   como **follow-up fuera de alcance**. ¿Se confirma que en este ciclo esos consumidores siguen
   viendo solo la portada?
2. **Orden de las fotos:** se asume que el `indice` refleja el orden de selección del mensajero y no
   tiene semántica de "principal vs secundaria" más allá de que índice 0 es la portada. ¿Correcto?
3. **Máximo de fotos:** RESUELTA (gate F1.4) — **3** por defecto, sobreescribible por variable de
   entorno `GESTION_MAX_EVIDENCIAS` (patrón `lib/config/gestion.ts`).
4. **`content_type` en el backfill:** si existiera alguna gestión histórica con `storage_path` NO
   nulo pero `content_type` nulo, el backfill usa un fallback (`image/jpeg`). ¿Aceptable, o se
   prefiere `content_type` NULLABLE en la tabla nueva?
