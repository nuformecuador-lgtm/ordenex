# Feature 102 — Ingreso de bodega por rechazos SLA visible + aviso a tienda/bodega — design.md

> El CÓMO técnico. Todo el diseño respeta el gate F1.4: **visibilidad derivada**, sin infra de
> notificaciones, sin mover dinero, objetivo **sin migración**. Se REUSA el snapshot de 56
> (`ingreso_bodega_rechazo`, `total_ingreso_bodega_rechazos`) y el historial INMUTABLE de 49/99
> (`orden_historial_estado.origen_tipo = "escalado_devuelta_sla"`). Orquestación:
> **backend_dev → frontend_dev** (no implementer monolítico).

## 1. Idea central

El "ingreso de bodega por rechazos" ya está congelado por gestión (56). Lo único que falta para
separarlo en **SLA (cron 99)** vs **manual (mensajero)** es la CLASIFICACIÓN por gestión, y esa
clasificación ya existe de forma inmutable en `orden_historial_estado.origen_tipo`. Por tanto:

- La separación es una **partición money-safe** de montos ya congelados por una etiqueta
  inmutable → **no hay columna nueva, no hay migración, no se toca dinero**.
- El "aviso" a la tienda y a la bodega es **derivar y mostrar** sobre pantallas existentes.

## 2. Clasificación `esRechazoSla` (backend, derivada del join)

Fuente de verdad (verificada): la gestión sintética que crea `DevolucionSlaRepository.escalarDevueltaSla`
enlaza su transición en `orden_historial_estado` con `gestion_orden_id = <gestión>` y
`origen_tipo = "escalado_devuelta_sla"`. Un rechazo manual escribe `origen_tipo = "gestion"`.
El enum vive en `lib/types/orden-historial.ts`; la relación es `GestionOrden.historialEstados`
(`OrdenHistorialEstado.gestion` / `gestionOrdenId`), verificada en `db/schema.prisma`.

Predicado (R1/R2):

```
esRechazoSla(gestion) := EXISTS(
  orden_historial_estado h
  WHERE h.gestion_orden_id = gestion.id
    AND h.origen_tipo = 'escalado_devuelta_sla'
)
```

En Prisma, extendiendo el `select` de la gestión con la relación acotada:

```ts
// añadir a GESTION_ADMIN_SELECT (CierresAdminRepository):
historialEstados: {
  where: { origenTipo: "escalado_devuelta_sla" },
  select: { id: true },
  take: 1,
}
// -> esRechazoSla = row.historialEstados.length > 0
```

## 3. Modelo de datos — SIN migración (justificado, R3/R17)

**No se añade ninguna columna, tabla ni enum.** Justificación de por qué es imprescindible-cero:

- El **monto** por gestión (`gestion_orden.ingreso_bodega_rechazo`) YA está congelado (56).
- La **clasificación** (SLA/manual) YA está congelada de forma inmutable en
  `orden_historial_estado.origen_tipo` (append-only, feature 49; el modelo declara la FK a la
  gestión `onDelete: Restrict`, por lo que el enlace no se corrompe).
- El **subtotal SLA** es `Σ ingreso_bodega_rechazo WHERE esRechazoSla` — una función pura de dos
  entradas inmutables. Derivarlo en lectura es tan estable como leer una columna snapshoteada,
  porque sus insumos no mutan (R7). Snapshotearlo en una columna nueva sería redundante y exigiría
  migración + backfill contra el objetivo del gate.

> Si en implementación apareciera un motivo REAL para snapshotear el subtotal (p. ej. Q4 aprobada
> = mostrarlo en la LISTA de cierres con volumen alto y sin índice viable), la migración sería
> aditiva (`cierre_dia.total_ingreso_bodega_rechazos_sla DECIMAL(12,2) NOT NULL DEFAULT 0`) con su
> `down.sql`. Se DEJA como alternativa, no como diseño base. Base = derivación sin migración.

## 4. Contratos I/O (extensiones aditivas de tipos, money-safe)

### 4.1 Flag por gestión
- `CierreGestionPendienteRow` (`ICierreDiaRepository`): `+ esRechazoSla: boolean`.
- `CierreDetalleGestion` (`ICierreDiaService`): `+ esRechazoSla: boolean` (default `false` en la
  vista en vivo del mensajero, que no lo usa — R11).

### 4.2 Desglose del cierre (detalle admin)
- Nuevo util puro `lib/utils/desglose-rechazos-sla.ts`:
  ```ts
  // Money-safe (R4/R5/R18): Prisma.Decimal, salida STRING escala 2. Pura, testeable sin DB.
  export function desglosarIngresoBodegaPorOrigen(
    gestiones: { ingresoBodegaRechazo: string | null; esRechazoSla: boolean }[],
  ): { totalSla: string; totalManual: string; total: string };
  ```
- `CierreDetalleAdminServiceResult.ok` (`ICierresAdminService`): `+ desgloseIngresoBodegaRechazos:
  { sla: string; manual: string; total: string }`. El `total` DEBE coincidir con
  `cierre.totalIngresoBodegaRechazos` snapshoteado (R5, aserción de test).

### 4.3 Superficie de la tienda (rechazos por SLA)
- Nuevo DTO `lib/types/rechazo-sla-tienda.ts` → `RechazoSlaTiendaDTO`:
  ```ts
  interface RechazoSlaTiendaDTO {
    id: string;             // orden.id
    numGuia: number | null; // placeholder si null (patrón NovedadDTO)
    numRemision: string;
    destinatario: string;
    monto: string | null;   // monto de 56 (Q1 default); null = pendiente de cierre (Q2 default)
  }
  ```
  100% serializable (sin `Prisma.Decimal`/`Date`), patrón `NovedadDTO`.

## 5. Integración backend (backend_dev)

### 5.1 Cierres admin (desglose SLA/manual)
- `CierresAdminRepository.GESTION_ADMIN_SELECT`: `+ historialEstados` acotado (ver §2).
  `toPendienteRowDesdeSnapshot` mapea `esRechazoSla = g.historialEstados.length > 0`.
- `CierresAdminService.verCierreDetalle`: tras armar `grupos`, llamar
  `desglosarIngresoBodegaPorOrigen(found.gestiones)` y devolver `desgloseIngresoBodegaRechazos`.
  NO recomputa el total del cierre (lo lee del snapshot); solo asegura la identidad SLA+manual=total
  (R5/R6). El `toDetalleDTO` (en `CierreDiaService`) propaga `esRechazoSla` al DTO de gestión (R9).
- Alcance satélite: `verCierreDetalle` ya resuelve alcance por rol (maestro/admin → central;
  adminSatelite → su zona). El desglose viaja por el mismo camino → R10 sin superficie nueva.

### 5.2 Tienda (rechazos por SLA)
- Nuevo método de repo en `IOrdenRepository` (molde de `findDevueltasByTienda`/`countDevueltasByTienda`):
  `findRechazadasSlaByTienda(tiendaId, { skip, take })` + `countRechazadasSlaByTienda(tiendaId)`.
  Predicado (R12/R13/R15): `estatus = "rechazada"` + tienda del actor + `deleted_at IS NULL` +
  EXISTS historial `origen_tipo = "escalado_devuelta_sla"` con destino `rechazada` de esa orden.
  El monto (Q1 default = 56) sale del `ingreso_bodega_rechazo` de la gestión sintética SLA de esa
  orden (la de `origen_tipo = escalado_devuelta_sla`); `null` mientras no esté snapshoteada (Q2).
- Nuevo `lib/services/RechazosSlaTiendaService.ts` (rol `adminTienda`, acota SIEMPRE a
  `actor.usuarioId`; otro rol → `forbidden`, patrón `NovedadesService`). Solo lectura.
- Nueva Server Action `lib/actions/rechazos-sla-tienda.ts` (`'use server'`, lee cookies/sesión,
  patrón `listarNovedadesAction`). NO route handler (mutación/lectura interna → Server Action).

## 6. Integración frontend (frontend_dev)

### 6.1 Cierres admin — desglose SLA/manual
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`: reusar
  `IngresoBodegaRechazosTotal` (o un componente hermano) para mostrar DOS líneas — "por SLA" y
  "manual" — junto al total existente; etiquetas i18n-ready nuevas (p. ej.
  `INGRESO_BODEGA_RECHAZOS_SLA_LABEL`). En la sección `rechazada` (`columnasPara`), añadir una
  marca/badge por fila "SLA" cuando `g.esRechazoSla` (R9). Money-safe: montos llegan como STRING.
- Consumen el desglose: `CierresAdminModule` (central) y `ConsolidacionBodegaModule` /
  `CierresBodegaAdminModule` (bodega satélite/maestro) — todos ya importan de `cierre-detalle-shared`.

### 6.2 Tienda — sección "Rechazos por SLA" (Q3 default = dentro de `/novedades`)
- `app/(app)/novedades/`: añadir una sección/pestaña de solo-lectura "Rechazadas por SLA"
  (componente privado, datos por props desde el Server Component tras validar `adminTienda`), que
  lista `RechazoSlaTiendaDTO` con guía/destinatario/monto. Reusa `Pagination` y el patrón de
  re-fetch por Server Action de `NovedadesModule`. Estado vacío legible. `null` en monto → "pendiente
  de cierre" (Q2 default).

## 7. Alternativa(s) descartada(s) — OBLIGATORIO

1. **Columna nueva `es_rechazo_sla` en `gestion_orden` (o `total_ingreso_bodega_rechazos_sla` en
   `cierre_dia`) snapshoteada al crear el cierre.** Sería el espejo "natural" del patrón 56.
   **DESCARTADA:** exige migración + `down.sql` + backfill y DUPLICA información que ya está
   congelada de forma inmutable (`orden_historial_estado.origen_tipo` + `ingreso_bodega_rechazo`).
   La clasificación derivada del historial NUNCA muta (append-only, FK `onDelete: Restrict`), así
   que la derivación en lectura es tan estable como una columna, y respeta el objetivo del gate
   "sin migración". Se reserva SOLO como fallback si Q4 (subtotal en la LISTA con volumen) lo
   volviera imprescindible.
2. **Tabla/feed de notificaciones + campana/badge/email para "avisar" a tienda y bodega.**
   **DESCARTADA por el gate F1.4:** el mecanismo aprobado es visibilidad derivada. Además
   introduciría estado persistido (leído/no-leído), RLS nueva y un canal de entrega — todo fuera de
   alcance para exponer un dato que ya vive en el snapshot y el historial.
3. **Mostrar el ingreso de bodega por rechazo en el ledger de `/mi-wallet` de la tienda.**
   **DESCARTADA (por defecto):** el `cobroRechazado` de 56 NO es dinero de la tienda (es ingreso de
   la BODEGA) y no existe como categoría del ledger de tienda; meterlo ahí simularía un movimiento
   de saldo inexistente. La superficie correcta es una lista derivada informativa. (Queda ligada a
   Q1: si el humano decide que el monto relevante es el `flete_devolucion`, esa alternativa
   revive y `/mi-wallet` sería la superficie.)

## 8. Riesgos y notas

- **Money-safe:** el subtotal SLA y el monto de la tienda usan `Prisma.Decimal` y salen como STRING
  escala 2. Los tests afirman el tipo STRING y la identidad `sla + manual === total` (R5).
- **No romper 56/39:** el desglose es un carril de LECTURA paralelo; los tests de regresión afirman
  que `total_ingreso_bodega_rechazos`, `total_pago_mensajero` y los totales recibidos NO cambian
  (R6). No se abre ninguna transacción de escritura.
- **Índice del join:** `orden_historial_estado` NO tiene índice por `gestion_orden_id`. En el
  DETALLE del cierre (filas acotadas) es aceptable. Para la lista de la tienda (filtra por origen
  sobre el historial de la orden) el conjunto es acotado y paginado; si el plan lo pide, evaluar un
  índice aditivo `(gestion_orden_id)` en la migración de 49 — se marca como verificación, NO como
  cambio base (evitar migración salvo evidencia de ruta caliente).
- **Consistencia con Q1/Q2:** R14 y la superficie de tienda se implementan sobre las
  recomendaciones por defecto (monto de 56 anclado al snapshot; sección en `/novedades`). Si el
  humano decide distinto en el gate, el impacto es local (predicado del repo de tienda + label) y se
  re-redacta ANTES de implementar.
- **`/cierre-dia` intacto:** la vista del mensajero NO recibe el desglose (R11); no se toca
  `CierreDiaService.listarCierreDia` más allá de propagar `esRechazoSla` (que allí queda `false`).
