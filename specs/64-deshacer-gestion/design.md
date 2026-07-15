# Feature 64 — Deshacer gestión: devolver una orden a gestión · design.md

> El CÓMO técnico. Decisiones sujetas a las respuestas F1.4 de `requirements.md`; aquí se
> documenta la opción recomendada y su justificación. Todas las referencias a código fueron
> verificadas en la rama `feature/64-deshacer-gestion`.

## 1. Alcance y capas afectadas

| Capa | Archivo (existente / nuevo) | Cambio |
| --- | --- | --- |
| Migración | `db/migrations/<ts>_gestion_orden_anulacion/` (**nuevo**) | `anulada_at` + `anulada_por` + FK + índice parcial + valor de enum `deshacer_gestion`; `down.sql` OBLIGATORIO |
| Schema | `db/schema.prisma` | `GestionOrden.anuladaAt/anuladaPor` + relación `GestionAnuladaPor`; enum `OrdenHistorialOrigenTipo` += `deshacer_gestion` |
| Tipos | `lib/types/orden-historial.ts` | `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` += `deshacer_gestion` (chequeo de exhaustividad) |
| Tipos | `lib/types/cierre.ts` | `DeshacerGestionResult` (+ `unauthenticated`), schema zod del input |
| Interfaces | `lib/interfaces/repositories/ICierreDiaRepository.ts` | +`findGestionParaDeshacer`, +`findUltimaGestionNoAnuladaId`, +`anularGestionYDevolverAGestion` |
| Interfaces | `lib/interfaces/repositories/IOrdenHistorialRepository.ts` | `contarPorDestino` → `contarPorDestinoVigentes` (excluye gestiones anuladas) |
| Interfaces | `lib/interfaces/services/ICierreDiaService.ts` | +`deshacerGestion(gestionId, actor)` + `DeshacerGestionServiceResult` |
| Repository | `lib/repositories/CierreDiaRepository.ts` | `anuladaAt: null` en 2 WHERE + 3 métodos nuevos |
| Repository | `lib/repositories/CorteDiarioRepository.ts` | `anuladaAt: null` en el WHERE del cron |
| Repository | `lib/repositories/OrdenHistorialRepository.ts` | conteo de intentos con exclusión de anuladas |
| Service | `lib/services/OrdenHistorialService.ts` | `contarIntentos` consume el conteo vigente |
| Service | `lib/services/CierreDiaService.ts` | `deshacerGestion` (REGLA: ventana, propiedad, guardias) |
| Action | `lib/actions/cierre-dia.ts` | Server Action `deshacerGestion(gestionId)` + zod |
| UI | `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | Columna de acción por fila + `Modal` de confirmación + `router.refresh()` |
| UI | `lib/interfaces/services/ICierreDiaService.ts` (DTO) | `CierreDetalleGestion` ya lleva `gestionId`: no cambia |

**Sin tabla nueva → sin RLS nueva.** `gestion_orden` ya tiene RLS habilitada sin policies
(solo service role, migración `20260711150000_*`); la migración de esta feature NO la toca.

## 2. Modelo de datos

### 2.1 Columnas de anulación (F1.4-d)

```prisma
model GestionOrden {
  // ...campos existentes...
  anuladaAt  DateTime? @map("anulada_at")  // feature 64/R11: NULL = gestion vigente
  anuladaPor String?   @map("anulada_por") // feature 64/R11: FK -> usuario (quien deshizo)

  anuladaPorUsuario Usuario? @relation("GestionAnuladaPor", fields: [anuladaPor], references: [id], onDelete: SetNull)
}
```

`anulada_at IS NULL` = gestión vigente (patrón `cierre_id IS NULL` de la 37). El par
`anulada_at`/`anulada_por` es el espejo de `cierre_dia.resuelto_at`/`resuelto_por`
(feature 38). `ON DELETE SET NULL` como el actor del historial (49/R21): borrar al usuario
no borra el rastro. **No se añade `updated_at`** ni se toca ningún campo original de la
gestión (R12).

### 2.2 Enum del historial (F1.4-b)

`orden_historial_origen_tipo` += `deshacer_gestion` (12º valor). Precedente reversible:
`20260712150000_cierre_estado_vencido` (añade `vencido` a `cierre_estado`; el `down.sql`
recrea el tipo). Aquí el `down` es **más simple**: una sola columna usa el enum
(`orden_historial_estado.origen_tipo`) y **no tiene DEFAULT**, así que no hay que soltar y
restaurar defaults ni índices parciales con predicado sobre el enum.

### 2.3 Migración (UP)

```sql
-- 1) columnas de anulacion (NULL = gestion vigente).
ALTER TABLE "gestion_orden" ADD COLUMN "anulada_at" TIMESTAMP(3);
ALTER TABLE "gestion_orden" ADD COLUMN "anulada_por" TEXT;
ALTER TABLE "gestion_orden" ADD CONSTRAINT "gestion_orden_anulada_por_fkey"
  FOREIGN KEY ("anulada_por") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "gestion_orden_anulada_por_idx" ON "gestion_orden"("anulada_por");

-- 2) indice PARCIAL de la ruta caliente: gestiones vigentes sin cierre de un mensajero
-- (/cierre-dia + corte diario). Prisma no expresa indices parciales -> a mano
-- (patron orden_liberada_reprogramada_at_idx).
CREATE INDEX "gestion_orden_mensajero_pendiente_idx"
  ON "gestion_orden" ("mensajero_id")
  WHERE "cierre_id" IS NULL AND "anulada_at" IS NULL;

-- 3) 12o valor del enum de origen del historial (R20). ALTER TYPE ... ADD VALUE no puede
-- correr en la misma tx que USE el valor; aqui nadie lo usa (solo se anade).
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'deshacer_gestion';
```

### 2.4 `down.sql` (OBLIGATORIO, `docs/architecture.md`)

Revierte en orden inverso. Precondición documentada: ninguna fila de
`orden_historial_estado` con `origen_tipo = 'deshacer_gestion'` (Postgres no soporta DROP
VALUE: el tipo se recrea y el `USING` cast falla con error claro si existiera una — correcto:
revertir borrando rastro de auditoría no es seguro).

```sql
-- 3) enum: recrear sin 'deshacer_gestion' (la columna origen_tipo NO tiene DEFAULT).
ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";
CREATE TYPE "orden_historial_origen_tipo" AS ENUM (
  'carga_masiva','creacion_manual','generacion_guia','asignacion_bodega','ruteo_satelite',
  'recepcion_satelite','asignacion_satelite','recoleccion','gestion','liberacion_reprogramada','ajuste_estado');
ALTER TABLE "orden_historial_estado" ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";

-- 2) indice parcial.
DROP INDEX IF EXISTS "gestion_orden_mensajero_pendiente_idx";

-- 1) columnas de anulacion (+ FK e indice).
DROP INDEX IF EXISTS "gestion_orden_anulada_por_idx";
ALTER TABLE "gestion_orden" DROP CONSTRAINT IF EXISTS "gestion_orden_anulada_por_fkey";
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "anulada_por";
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "anulada_at";
```

## 3. Exclusión de las gestiones anuladas (R13–R17) — inventario cerrado

Verificado con `rg "gestionOrden\.|gestiones:" lib/`. Consumidores de `gestion_orden` y qué
hace cada uno:

| # | Punto | WHERE hoy | Cambio |
| --- | --- | --- | --- |
| 1 | `CierreDiaRepository.findGestionesPendientes` | `{ mensajeroId, cierreId: null }` | **+ `anuladaAt: null`** |
| 2 | `CierreDiaRepository.crearCierre` (updateMany que VINCULA) | `{ mensajeroId, cierreId: null }` | **+ `anuladaAt: null`** |
| 3 | `CorteDiarioRepository.findMensajerosConActividadSinCierre` | `{ cierreId: null }` | **+ `anuladaAt: null`** |
| 4 | `WalletFeedService` / `WalletTiendaFeedService` / `WalletMensajeroFeedService` | `{ cierreId }` | **sin cambio** (una anulada nunca recibe `cierre_id` gracias a #2) |
| 5 | `CierresAdminRepository` / `CierresBodegaAdminRepository` (detalle admin) | `{ cierreId }` | **sin cambio** (idem) |
| 6 | `LiberacionReprogramadaRepository.findOrdenesLiberables` | orden en `reprogramada` + su última gestión `reprogramada` | **sin cambio funcional**; se añade `anuladaAt: null` al `where` de la relación por defensa (una orden en `reprogramada` no puede tener su última gestión `reprogramada` anulada: deshacerla la devuelve a `en_reparto`) |

El punto **#1 es el que compra R13/R14/R15 completos**: los 4 grupos, `computeTotales`,
`derivarPagos` (39) y `derivarIngresoBodega` (56) consumen todos la MISMA lista, tanto en la
vista en vivo (`listarCierreDia`) como en el snapshot (`solicitarCierre` y `CorteDiarioService`).
No hay que tocar `lib/utils/cierre-totales.ts`.

El punto **#2 es money-critical**: sin él, una gestión anulada recibiría `cierre_id` al
solicitar el cierre y los feeds de wallet (#4) la cobrarían al aprobar. R16 es requisito duro.

## 4. Derivador de intentos sin romper la inmutabilidad (R24–R28, F1.4-a)

**El historial no se toca.** La exclusión es un filtro de LECTURA que aprovecha
`orden_historial_estado.gestion_orden_id` (ya poblado por `crearGestionYTransicionar` en las
2 filas que emite una gestión `devuelta`).

### 4.1 La nulidad del enlace es AMBIGUA (por qué el predicado ingenuo no sirve)

`gestion_orden_id IS NULL` significa dos cosas incompatibles:

| Caso | ¿Debe contar? | Cómo se distingue |
| --- | --- | --- |
| La transición nunca vino de una gestión (`ajuste_estado`, admin) | **SÍ** (R25) | `origen_tipo NOT IN ('gestion','deshacer_gestion')` |
| La gestión existió y **se borró** → la FK `ON DELETE SET NULL` vació el enlace en silencio | **NO** (R26) | `origen_tipo = 'gestion'` + enlace vacío = imposible al escribir → huérfana |

> **ACTUALIZADO al implementar (F1.4-i APROBADA):** esta sección se escribió cuando la FK era
> `ON DELETE SET NULL`. El humano aprobó la pregunta (i) y **la migración
> `20260714170000_orden_historial_gestion_fk_restrict` la devolvió a `ON DELETE RESTRICT`**
> (modelo + SQL). Verificado en la base viva: `confdeltype='r'`, y el `DELETE` de una gestión
> enlazada ahora falla con `23001`. **El análisis de abajo se conserva a propósito**: es el porqué
> del predicado, y ese predicado **sigue siendo obligatorio** — la FK es defensa en profundidad,
> no un reemplazo. Las filas huérfanas que ya existieran, o cualquier futuro aflojamiento de la FK,
> se siguen tratando por lectura.

**La FK `orden_historial_estado_gestion_orden_id_fkey` ERA `ON DELETE SET NULL`** (hoy
`RESTRICT`, ver el aviso de arriba): la `20260713120000_orden_historial_estado` la creó
`RESTRICT` a mano, pero la `20260714123909_reconcile_fks_drop_order_status_value` la recableó a
`SET NULL` para reconciliar con `schema.prisma` (relación opcional sin `onDelete` → default
`SetNull` de Prisma). Por eso el predicado ingenuo
`OR: [{ gestionOrdenId: null }, { gestion: { anuladaAt: null } }]` **es inseguro**: un DELETE
sobre una gestión anulada devolvería su intento al conteo y resucitaría el bug que la feature
mata. El `origen_tipo` desambigua porque una fila `origen_tipo='gestion'` **siempre** nace con
`gestion_orden_id` poblado (`crearGestionYTransicionar`, verificado).

**Dirección del "si no se sabe": la huérfana NO cuenta.** El umbral es un **mínimo legal** de
intentos (`MIN_INTENTOS_ENTREGA`, "mínimo por ley" en `lib/config/reintentos.ts`): contar de
menos → más intentos que el mínimo (inofensivo); contar de más → escalar antes de tiempo →
incumplir el mínimo legal y cobrar `cobroRechazado` (56) mal.

### 4.2 Implementación

```ts
// lib/types/orden-historial.ts — familias que enlazan una gestion (fuente unica)
export const ORIGEN_TIPOS_CON_GESTION = ["gestion", "deshacer_gestion"] as const
  satisfies readonly OrdenHistorialOrigenTipo[];

// lib/repositories/OrdenHistorialRepository.ts
async contarPorDestinoVigentes(ordenId: string, estatusDestinoId: string): Promise<number> {
  return this.prisma.ordenHistorialEstado.count({
    where: {
      ordenId,
      estatusDestinoId,
      // R25: una transicion que NUNCA vino de una gestion (ajuste_estado) SIEMPRE cuenta.
      // R24: una de gestion cuenta SOLO si su gestion sigue vigente.
      // R26: una de gestion SIN enlace es HUERFANA (la FK es ON DELETE SET NULL, no
      //      RESTRICT: un DELETE la vaciaria en silencio) -> NO cuenta.
      // La fila de historial NO se modifica jamas (R23).
      OR: [
        { gestionOrdenId: null, origenTipo: { notIn: [...ORIGEN_TIPOS_CON_GESTION] } },
        { gestion: { anuladaAt: null } },
      ],
    },
  });
}
```

- Se **reemplaza** `contarPorDestino` por `contarPorDestinoVigentes` (nombre explícito) en
  `IOrdenHistorialRepository`: hoy su ÚNICO consumidor es
  `OrdenHistorialService.contarIntentos` (`rg contarPorDestino` → 1 call-site), así que no
  queda método muerto ni riesgo de que un futuro caller elija el equivocado.
- `contarIntentos` alimenta a **`MisAsignacionesService.resolverSeguimientoDevuelta`** (R26:
  reintento vs escalado) **y** a la línea de tiempo (`obtenerHistorial` → `intentos`, R27):
  ambos quedan corregidos con un solo cambio, y por construcción no pueden divergir.
- Índice: la `count` sigue usando `(orden_id, estatus_destino_id)`; el join a `gestion_orden`
  es por PK sobre un puñado de filas.
- `findHistorialByOrden` (la línea de tiempo) **NO filtra**: sigue mostrando TODO, incluida
  la fila `deshacer_gestion`. La verdad histórica se conserva; lo que se corrige es la
  DERIVACIÓN.

## 5. Flujo del deshacer

### 5.1 Contrato (Controller → Service → Repository)

```
CierreDiaModule (cliente)
  └─ Server Action  lib/actions/cierre-dia.ts :: deshacerGestion(gestionId)
       · zod (uuid) en el borde -> validation_error (R10)
       · resolveActorFromSession -> UnauthenticatedError -> unauthenticated (R7)
       · withErrorHandler (patrón del archivo)
       └─ CierreDiaService.deshacerGestion(gestionId, actor)   ← REGLA
            └─ CierreDiaRepository.findGestionParaDeshacer / findUltimaGestionNoAnuladaId
            └─ CierreDiaRepository.anularGestionYDevolverAGestion  ← ÚNICA escritura
```

Server Action (no route handler): mutación interna del propio proyecto
(`docs/architecture.md`, tabla). Reusa `CierreDiaDeps` (`service?`, `getActor?`) del archivo.

I/O:

```
IN:  gestionId: string (uuid)
OUT: { status:"ok"; ordenId: string }
   | { status:"forbidden" }                                  // R8/R9
   | { status:"conflict"; motivo: string }                   // R2/R3/R4/R5/R6
   | { status:"validation_error"; fieldErrors: Record<string,string[]> } // R10
   | { status:"unauthenticated" }                            // R7 (borde)
```

### 5.2 Regla (`CierreDiaService.deshacerGestion`)

1. `actor.rol !== "mensajero"` → `forbidden` (R8), antes de tocar el repo.
2. `findGestionParaDeshacer(gestionId)` → `null` → `forbidden` (R9: no se distingue
   inexistente de ajena, patrón 36/R31).
3. `gestion.mensajeroId !== actor.usuarioId` → `forbidden` (R9).
4. `gestion.cierreId !== null` → `conflict` "esta gestión ya está incluida en un cierre
   solicitado; no se puede deshacer" (R2).
5. `gestion.anuladaAt !== null` → `conflict` "esta gestión ya fue deshecha" (R3).
6. `gestion.orden.deletedAt !== null` → `conflict` (R6).
7. `findUltimaGestionNoAnuladaId(ordenId) !== gestionId` → `conflict` "esta orden tiene una
   gestión más reciente" (R4).
8. **Guardia de estado (R5):** `gestion.orden.estatusValue ∈ ESTADOS_ESPERADOS[resultado]`,
   con la tabla de la §5.3; si no → `conflict` "esta orden ya fue procesada por la bodega; ya
   no se puede deshacer".
9. `estatusEnRepartoId = ordenRepo.findEstatusIdByValue("en_reparto")` → `null` →
   `validation_error` "catálogo de estados incompleto (seed pendiente)" (patrón `gestionar`).
10. `anularGestionYDevolverAGestion({...})` → `false` (carrera: alguna guardia falló dentro
    de la tx) → `conflict`; `true` → `{ status:"ok", ordenId }`.

Deps nuevas del service: `ordenRepo` gana `"findEstatusIdByValue"` en su `Pick`.

### 5.3 Tabla `ESTADOS_ESPERADOS` (regla, vive en el service)

Estado en el que la orden DEBE estar para que su gestión sea deshacible, derivado del
`resultado` (verificado en `crearGestionYTransicionar` + `resolverSeguimientoDevuelta`):

| `resultado` | Estados esperados | Porqué |
| --- | --- | --- |
| `entregada` | `entregada` | destino = `resultado`, sin seguimiento |
| `reprogramada` | `reprogramada` | idem; si el cron ya liberó → `en_bodega*` → conflict (R5) |
| `rechazada` | `rechazada` | idem; si la bodega ya devolvió a origen → `devuelta_origen` → conflict |
| `devuelta` | `en_bodega`, `en_bodega_satelite`, `rechazada`, `devuelta` | 47: la orden NUNCA reposa en `devuelta` (reintento o escalado). `devuelta` se acepta solo por defensa ante filas pre-47 |

### 5.4 Repositorio (`anularGestionYDevolverAGestion`, ÚNICA escritura)

Una sola `$transaction` (R22), con guardias en los WHERE (concurrencia-segura, patrón
`crearCierre`/`recogerLote`). Sentinela interno para forzar rollback → `false` (patrón
`SinGestionesVinculadas`):

```ts
async anularGestionYDevolverAGestion(input: {
  gestionId: string; ordenId: string; mensajeroId: string; actorUsuarioId: string;
  estatusEsperadoId: string;   // id REAL leido de la orden (no un value)
  estatusEnRepartoId: string;
}): Promise<boolean> {
  return this.prisma.$transaction(async (tx) => {
    // 1) R11: anula con rastro. Guardas: sigue sin cierre y sin anular (carrera con
    //    solicitarCierre / doble submit). count 0 -> rollback -> false.
    const anulada = await tx.gestionOrden.updateMany({
      where: { id: gestionId, mensajeroId, cierreId: null, anuladaAt: null },
      data: { anuladaAt: new Date(), anuladaPor: actorUsuarioId },
    });
    if (anulada.count === 0) throw new NoAnulable();

    // 2) R18/R19: devuelve la orden a en_reparto y la reasigna al mensajero autor.
    //    Guarda: la orden sigue EXACTAMENTE en el estado leido (R5) y no esta borrada (R6).
    const movida = await tx.orden.updateMany({
      where: { id: ordenId, estatusId: estatusEsperadoId, deletedAt: null },
      data: { estatusId: estatusEnRepartoId, mensajeroAsignadoId: mensajeroId },
    });
    if (movida.count === 0) throw new NoAnulable();

    // 3) R20/R21/R23: choke point de la 49, en la MISMA tx. Origen = estado real previo.
    await appendCambioEstado(tx, [{
      ordenId, estatusOrigenId: estatusEsperadoId, estatusDestinoId: estatusEnRepartoId,
      actorUsuarioId, origenTipo: "deshacer_gestion", gestionOrdenId: gestionId,
    }]);
    return true;
  }).catch((e) => { if (e instanceof NoAnulable) return false; throw e; });
}
```

Notas:
- `mensajeroAsignadoId: mensajeroId` **incondicional** (R19): es idempotente cuando la
  asignación ya era ese mensajero (entregada/reprogramada/rechazada) y repone la que el
  seguimiento de reintento limpió (`limpiaMensajero: true`, 47/R6). No puede pisar a otro
  mensajero: una reasignación habría cambiado el estado y la guardia #2 fallaría.
- `CierrePrismaClient` ya incluye `"gestionOrden" | "orden" | "$transaction"`; el `tx` del
  callback expone `ordenHistorialEstado`, que es lo que `appendCambioEstado` necesita (mismo
  mecanismo que `GestionOrdenRepository`).
- **El puntero `usuario.orden_en_gestion_id` NO se toca** (R28/R29, F1.4-c): el repo ni
  siquiera necesita `usuario` en su `Pick`.

### 5.5 Lecturas (`findGestionParaDeshacer`, `findUltimaGestionNoAnuladaId`)

```ts
findGestionParaDeshacer(gestionId): Promise<GestionDeshacerRow | null>
// { gestionId, ordenId, mensajeroId, resultado, cierreId, anuladaAt,
//   orden: { deletedAt, estatusId, estatusValue } }
findUltimaGestionNoAnuladaId(ordenId): Promise<string | null>
// gestionOrden.findFirst({ where:{ ordenId, anuladaAt: null }, orderBy:{ createdAt:"desc" } })
```

Sin lógica de negocio en el repo (`docs/architecture.md`): devuelve filas; las 8 reglas de
§5.2 viven en el service.

## 6. UI (R34–R37)

`CierreDiaModule.tsx` (cliente, ya recibe todo por props del Server Component):
- `columnasPara(resultado, verEvidencia, onDeshacer)` gana una columna final "Acciones" con
  `<Button size="sm" variant="outline">Devolver a gestión</Button>` por fila, en las 4
  tablas (R34). El DTO ya trae `gestionId` (`rowKey`).
- Confirmación con el `Modal` de `components/shared/` ya importado (R35), texto:
  "La gestión quedará anulada (queda el registro de quién la hizo) y la orden volverá a tu
  lista para gestionar."
- `await deshacerGestion(gestionId)` → `ok`: `toast.success` + `router.refresh()` (R36,
  mismo patrón que `confirmarSolicitud`); error: `toast.error(mensajeError(result))` sin
  tocar la tabla (R37). `mensajeError` ya existe y sirve `conflict`/`validation_error`.
- Estado local `deshaciendo: string | null` para deshabilitar el botón de la fila en vuelo
  (evita el doble submit; el guard del repo lo cubre igual).

## 7. Alternativas descartadas (obligatorio)

**7.1 Descartada: BORRAR la fila de `gestion_orden` (DELETE) en vez de anularla.**
Es la lectura ingenua de "deshacer". Se descarta por la decisión (2) del humano y por el
diseño append-only del historial (feature 49/ADR): el rastro de quién gestionó, cuándo y
quién lo deshizo es el producto de esta feature, y un DELETE lo destruye.

> **Corrección (2026-07-14):** una versión previa de este design afirmaba que el DELETE era
> "técnicamente imposible" porque `orden_historial_estado.gestion_orden_id` sería
> `ON DELETE RESTRICT`. **Es FALSO.** La `20260713120000_orden_historial_estado` la creó
> `RESTRICT`, pero la `20260714123909_reconcile_fks_drop_order_status_value` la recableó a
> **`ON DELETE SET NULL`** (reconciliación con `schema.prisma`). Cuando se escribió este design,
> el esquema **permitía** el DELETE: no fallaba, y encima vaciaba `gestion_orden_id` **en
> silencio**. Esa premisa falsa se eliminó: la recomendación NO se apoya en una protección que no
> existe. **Epílogo:** el humano aprobó F1.4-(i) y la migración `20260714170000` devolvió esa FK a
> `RESTRICT` (§7.6) — o sea que hoy el DELETE **sí** falla (`23001`), pero por una decisión tomada
> y verificada en esta feature, **no** por la garantía que se creyó tener.

Con el esquema tal como estaba, el DELETE era **peor** que "indeseable", y por un motivo distinto
al que se creía: al vaciar el enlace sin error, convertía las filas de historial de esa gestión en
huérfanas y —con el predicado ingenuo— **devolvía el intento anulado al conteo**, resucitando el
bug que la feature mata (§4.1). La anulación con rastro (`anulada_at`/`anulada_por`) mantiene el
enlace vivo, la auditoría intacta y la derivación correcta. La defensa contra el DELETE quedó
**doble**: el predicado de §4.2 (obligatorio, **no depende de la FK**: cubre las huérfanas que ya
existieran y cualquier futuro aflojamiento) y la FK en `RESTRICT` (§7.6, F1.4-i aprobada).

**7.2 Descartada: materializar el contador de intentos en una columna
`orden.intentos_entrega` y decrementarla al deshacer.**
"Arregla" el hallazgo del contador de forma directa, pero: (a) mata el diseño 47/49 (el
conteo es DERIVADO del historial, fuente única de verdad) e introduce drift permanente entre
la columna y la línea de tiempo; (b) exige backfill de las órdenes vivas y un `down.sql` que
no puede reconstruir el dato; (c) un decremento es una escritura sobre la lógica que dispara
`rechazada` → `cobroRechazado` (56) → dinero: un bug de conteo se convierte en un asiento
equivocado. Elegimos el filtro de lectura (§4): un predicado, cero estado nuevo, cero
backfill, imposible que diverja del historial.

**7.3 Descartada: registrar una fila "de reversa" en el historial (`devuelta → en_reparto`
con un `origen_tipo` de reversa) y derivar los intentos como
`count(destino=devuelta) − count(reversas)`.**
Respeta el append-only, pero el conteo pasa a depender de emparejar filas: cualquier
transición futura que llegue a `devuelta` por otro camino (`ajuste_estado`) o una reversa
huérfana rompe la aritmética en silencio; y todo consumidor del historial tendría que
reimplementar la resta. El join `gestion.anulada_at IS NULL` es **un** predicado explícito,
verificable con un test, y deja el "por qué" en la fila de la gestión (quién/cuándo) en vez
de codificarlo en una diferencia de conteos. Nota: igual emitimos la fila
`deshacer_gestion` — pero como **rastro**, no como insumo aritmético del contador.

**7.4 Descartada: reponer `usuario.orden_en_gestion_id` a la orden al deshacer.**
Parece "más completo" (devuelve la orden directo a la pantalla de gestión), pero obliga a
resolver el caso "el mensajero YA tiene otra orden activa": o se bloquea el deshacer (no
puede corregir su error hasta cerrar la otra orden — castiga justo el caso de uso) o se pisa
el puntero (rompe la invariante 1-a-1 de la 36/R19-R21). Elegimos no tocarlo (R28/R29): la
orden vuelve a `en_reparto` y el mensajero la retoma con `escogerParaGestion`, que ya tiene
la guardia idempotente y concurrencia-segura. Coste: un clic extra.

**7.5 Descartada: permitir deshacer también después de "Solicitar cierre" (p. ej. para el
admin en la feature 38).**
Decisión (1) del humano: los totales del cierre son snapshot (`cierre_dia.total_*`,
money-critical) y al aprobar alimentan wallet/tienda/pago-mensajero (42/43/44). Deshacer ahí
obligaría a recalcular snapshots y/o revertir dinero asentado. El camino correcto ya existe:
el admin **rechaza** el cierre (38).

**7.6 APROBADA (F1.4-i) E IMPLEMENTADA: devolver la FK `gestion_orden_id` a `ON DELETE RESTRICT`.**
Defensa en profundidad del enlace que sostiene el contador (§4.1). El humano **la aprobó**, y entró
**completa** (SQL **y** modelo) en la migración `20260714170000_orden_historial_gestion_fk_restrict`,
separada a propósito de T1 por ser una decisión independiente y reversible por su cuenta.
Verificado en la base viva: `confdeltype='r'`; el `DELETE` de una gestión enlazada falla con `23001`.
Sólo-SQL habría reintroducido el drift que la `20260714123909` vino a eliminar, y el próximo
reconcile lo habría pisado:

```prisma
// db/schema.prisma — OrdenHistorialEstado
gestion GestionOrden? @relation(fields: [gestionOrdenId], references: [id], onDelete: Restrict)
```
```sql
-- UP
ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_gestion_orden_id_fkey";
ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_gestion_orden_id_fkey"
  FOREIGN KEY ("gestion_orden_id") REFERENCES "gestion_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- DOWN: idéntico, restaurando ON DELETE SET NULL (el estado que dejó la 20260714123909).
```

**Por qué el modelo y no solo el SQL:** la `20260714123909` puso `SET NULL` **a propósito**,
reconciliando el SQL con `schema.prisma` (relación opcional sin `onDelete` → default
`SetNull`). Un `RESTRICT` escrito solo en SQL **reintroduce el drift** que esa migración vino
a eliminar y el próximo reconcile lo volvería a pisar en silencio. Alcance a decidir con el
humano: esta FK es una de las **5** que ese lote recableó (las otras: `estatus_origen_id`,
`actor_usuario_id` del mismo historial, `usuario.zona_id`, `usuario.vehiculo_id`,
`tarifa_zona_mensajero.vehiculo_id`) — revisar solo la nuestra es coherente con el alcance de
la 64; revisarlas todas es otra feature. **La feature es correcta con o sin esto**: el
predicado de §4.2 no depende de la FK.

## 8. Riesgos y notas

- **Punto único de falla money-critical:** el `updateMany` de `crearCierre` (§3-#2). Un test
  dedicado (una gestión anulada NO recibe `cierre_id`) es obligatorio; si se olvida, la
  wallet cobra una gestión deshecha.
- **El enlace `gestion_orden_id` NO está protegido por el esquema** (FK `ON DELETE SET NULL`
  desde la `20260714123909`). Riesgo vivo si F1.4-(i) se rechaza: un DELETE sobre
  `gestion_orden` (hoy no lo hace nadie: `rg "gestionOrden\.(delete|deleteMany)"` → 0
  resultados) orfanaría filas de historial en silencio. **Mitigación en esta feature:** el
  predicado de §4.2 trata la huérfana como intento NO vigente (R26), así que el borrado
  degrada de forma segura (más intentos, nunca menos). **Convención para el reviewer:** las
  gestiones no se borran, se anulan; un `delete`/`deleteMany` sobre `gestion_orden` es un
  rechazo automático de review.
- **Test de cobertura de la 49:** `tests/unit/repositories/orden-historial-cobertura.test.ts`
  fija el conjunto CERRADO de call-sites que escriben `orden.estatus_id`. Esta feature añade
  el **#12** (`CierreDiaRepository.anularGestionYDevolverAGestion` → `deshacer_gestion`) y el
  test **debe** actualizarse (romperlo es la señal de que el mecanismo funciona). El chequeo
  de exhaustividad de `lib/types/orden-historial.ts` rompe el build si el SEED no se actualiza.
- **Ties de `created_at`:** las 2 filas de historial de una gestión `devuelta` se insertan en
  la MISMA tx y pueden compartir `created_at` (default `CURRENT_TIMESTAMP` = inicio de tx).
  Por eso las guardias de §5.2 **no** ordenan filas de historial: usan `gestion_orden.created_at`
  (una gestión por tx) y el `estatus_id` real de la orden.
- **Carrera deshacer ↔ solicitar cierre:** ambos escriben `gestion_orden` con WHERE guardado;
  el perdedor ve `count = 0` y aborta (`conflict`), sin efectos parciales. Si `crearCierre`
  gana, el deshacer devuelve "ya está incluida en un cierre" (R2), que es la respuesta correcta.
- **Ventana y bloqueo del mensajero (41):** deshacer con un cierre `solicitado`/`vencido` vivo
  es imposible por construcción — esas gestiones ya tienen `cierre_id` (R2).
- **No se toca `lib/utils/cierre-totales.ts`** (aritmética `Prisma.Decimal`, money-critical):
  la exclusión ocurre aguas arriba, en la lista que alimenta los helpers.
