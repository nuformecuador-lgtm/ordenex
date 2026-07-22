# Feature 110 — Design

Extiende el flag `orden.prioridad` (feature 101) a las otras dos vías de retorno a bodega para
reasignar: liberación de reprogramadas (46/90) y recuperación manual (100). Zona backend. Reusa el
patrón EXACTO de la 101; sin migración; money-neutral; concurrencia-seguro.

## Modelo de datos

- **Sin cambios.** La columna `orden.prioridad` (BOOLEAN NOT NULL DEFAULT false) ya existe desde la
  feature 101. No hay tabla nueva, ni cambio de columna, ni RLS nueva, ni migración Prisma.
  `db/schema.prisma` NO se toca; no se crea directorio en `db/migrations/`.

## Decisión técnica

Encender `prioridad = true` añadiéndolo al objeto `data` del `updateMany` **ya existente y guardado
por estado** de cada repositorio, replicando lo que la 101 hizo en
`DevolucionSlaRepository.liberarDevueltaSla`:

1. `lib/repositories/LiberacionReprogramadaRepository.ts` → método `liberarOrden`: agregar
   `prioridad: true` al `data` (junto a `estatusId`, `mensajeroAsignadoId: null`, `asignadoAt: null`,
   `liberadaReprogramadaAt`). El `updateMany` sigue guardado por `estatusId = reprogramada` +
   `deletedAt: null`. El `appendCambioEstado` (actor NULL, `origen_tipo = liberacion_reprogramada`)
   queda intacto dentro del `if (result.count > 0)`.

2. `lib/repositories/RecuperacionBodegaRepository.ts` → método `recuperarABodega`: agregar
   `prioridad: true` al `data` (junto a `estatusId`, `mensajeroAsignadoId: null`, `asignadoAt: null`).
   El `updateMany` sigue guardado por `estatusId = devuelta` + `deletedAt: null`. El
   `appendCambioEstado` (actor = admin, `origen_tipo = recuperacion_manual`) queda intacto.

Ambos cambios son de una línea dentro de un `data` que ya se escribe: no hay escritura extra, la
guarda por estado da la idempotencia (R3) y la atomicidad/concurrencia (R4), y no toca dinero ni
otros campos (R6).

### Comentarios stale a corregir (parte de esta feature)

- `RecuperacionBodegaRepository.recuperarABodega` (doc del método): hoy dice "Feature 101/R3: la
  recuperación MANUAL NO enciende `orden.prioridad` ... el `data` deliberadamente NO la toca".
  Debe actualizarse a "Feature 110: la recuperación manual SÍ enciende `prioridad` (misma superficie
  de reasignación que la liberación por SLA)".
- `DevolucionSlaRepository.liberarDevueltaSla` (doc del método): la frase "la recuperación MANUAL de
  la feature 100 NO tocan `prioridad` (R3)" queda stale; ajustar la nota para referir a la 110.
  Sin cambio funcional en este repo.

## Rutas / endpoints / contratos I/O

- **Sin endpoints nuevos.** Las dos operaciones se disparan por vías existentes: la liberación de
  reprogramadas por el job recurrente de la 90 (`app/api/cron/liberar-reprogramadas`, sin cambios) y
  la recuperación manual por la Server Action de la 100 (sin cambios).
- **Contratos de entrada intactos.** Los inputs `LiberarOrdenInput` y `RecuperarABodegaInput` NO
  cambian (el encendido es un literal `true` en el `data`, no un parámetro nuevo). El retorno de
  ambos métodos sigue siendo `boolean`. Los DTO de listado NO cambian (la 101 ya expone `prioridad`).

## Alternativa descartada

**Encender `prioridad` en una escritura separada, después de la transición** (un segundo
`orden.update`/`updateMany` por id, en el service o tras el `liberarOrden`/`recuperarABodega`), o
mediante un trigger/`DEFAULT` en DB sobre el cambio de estado.

*Descartada porque:* (a) rompe la atomicidad y la seguridad ante concurrencia — una segunda escritura
puede pisar el `prioridad = false` que fija la reasignación (`asignarBodegaLote`/`asignarSateliteLote`)
si otra bodega asigna en paralelo, o encender el flag sobre una orden que ya salió del estado de
origen por carrera con el cron SLA; (b) pierde la idempotencia derivada de la guarda por estado
(R3): la segunda escritura no está guardada por el mismo `where`; (c) diverge del patrón probado de
la 101, que ya demostró que el encendido debe vivir dentro del `data` del `updateMany` guardado; (d)
un trigger/DEFAULT en DB añade lógica de negocio fuera de la capa de repositorio, contra el patrón de
capas y sin `down.sql` trivial. La opción elegida (una línea en el `data` existente) es estrictamente
más simple y ya validada por la 99/101.

## Notas de arquitectura

- Cambio contenido en la capa Repository (solo queries Prisma), sin lógica de negocio nueva ni HTTP.
- El consumo (sort `prioridad DESC` primero + resalte de fila) es 100% reuso de la 101 en
  `OrdenRepository` para `en_bodega` / `en_bodega_satelite`; esta feature no lo toca (R10).
- No hay hardcode de país/moneda; no se filtra PII ni secretos en logs.
