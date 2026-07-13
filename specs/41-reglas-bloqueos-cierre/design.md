# Feature 41 — Reglas y bloqueos de cierre — design

> Decisiones técnicas. Partición clara backend/frontend para el implementer. Money-
> critical: NO se recalcula ni muta ningún cierre resuelto (features 37/39/40/56).
> Base de código real inspeccionada; se reutilizan nombres existentes (no se inventan).

## 0. Resumen de la solución

Cuatro piezas, casi todas backend:

1. **Estado `vencido`** en el enum `cierre_estado` (migración aditiva).
2. **Corte diario** (`/api/cron/corte-diario`, Vercel Cron, `CRON_SECRET`): crea
   `cierre_dia estado='vencido'` para los mensajeros con actividad del día sin cierre.
3. **Bloqueo derivado** (mensajero y bodega satélite) como guarda en los servicios de
   asignación existentes (17/30 maestro, 34 satélite).
4. **Reflejo en UI** sobre pantallas existentes (`/cierres-admin`, vista del mensajero,
   vista del adminSatelite). Sin pantallas nuevas.

---

## 1. Modelo de datos

### 1.1 Enum `cierre_estado` — añadir `vencido` (R2)

Fuente única de verdad `lib/types/cierre.ts`:

```ts
export const CIERRE_ESTADO_SEED = [
  "solicitado",
  "aprobado",
  "rechazado",
  "vencido", // feature 41
] as const satisfies readonly PrismaCierreEstado[];
```

Prisma `db/schema.prisma`:

```prisma
enum CierreEstado {
  solicitado
  aprobado
  rechazado
  vencido // feature 41

  @@map("cierre_estado")
}
```

No se agregan columnas: `cierre_dia` ya tiene todo lo necesario (destino, totales
snapshot, `solicitado_at`, `resuelto_por/at`, `motivo_rechazo`). Un `vencido` es un
`cierre_dia` cuyo `estado='vencido'` y cuyo `solicitado_at` = instante del corte
(no lo solicitó un mensajero, lo generó el job). No se añade "generado_por sistema":
`estado='vencido'` ya lo discrimina (se documenta en el schema).

### 1.2 Índice para el bloqueo derivado (R12/R23)

`cierre_dia` ya tiene `@@index([mensajeroId])` y `@@index([estado])`. Para la ruta
caliente de asignación (¿este mensajero está bloqueado?) se añade un índice compuesto:

```prisma
@@index([mensajeroId, estado]) // feature 41: bloqueo derivado del mensajero
```

Para el bloqueo de bodega (R17), regla estricta con DOS causas (OR):
- Causa (i) — cierres de sus mensajeros: ya existe `@@index([destinoTipo, destinoZonaId])`
  en `cierre_dia`; la consulta filtra además por `estado IN ('solicitado','vencido')`
  (predicado sobre el resultado, cubierto por el índice existente + filtro).
- Causa (ii) — su propio `CierreBodega` pendiente: `cierre_bodega` ya tiene
  `@@index([zonaId])` y `@@index([estado])` (feature 40); la consulta filtra
  `zona_id = <zona>` AND `estado = 'solicitado'`. Además existe el índice único parcial
  `WHERE estado='solicitado'` de la feature 40 (garantiza a lo sumo un `CierreBodega`
  solicitado por zona), que hace la comprobación de (ii) O(1). NO se requiere índice
  nuevo para el bloqueo de bodega.

### 1.3 Migración (R3)

`db/migrations/20260712150000_cierre_estado_vencido/` (timestamp posterior al último,
`...140000_ingreso_bodega_rechazos`):

- `migration.sql` (UP):
  - `ALTER TYPE "cierre_estado" ADD VALUE 'vencido';`
    ⚠️ `ALTER TYPE ... ADD VALUE` NO puede correr dentro de una transacción de Prisma
    (patrón "enum-existente" ya conocido en features 17/30/36). El runner de migraciones
    del repo ejecuta el SQL fuera de la transacción para este caso; el implementer debe
    seguir el mismo patrón usado en `20260710150000_order_status_value_enum` (verificar
    ese precedente al implementar).
  - `CREATE INDEX "cierre_dia_mensajero_id_estado_idx" ON "cierre_dia"("mensajero_id","estado");`
- `down.sql` (DOWN): Postgres NO soporta `DROP VALUE` de un enum. El down recrea el tipo
  sin `vencido`:
  1. `DROP INDEX "cierre_dia_mensajero_id_estado_idx";`
  2. Renombrar el enum, crear el enum viejo (3 valores), migrar columnas
     (`cierre_dia.estado`, `cierre_bodega.estado`) al tipo viejo con `USING`, y dropear
     el enum renombrado. Precondición documentada del down: NO deben existir filas con
     `estado='vencido'` (si las hay, el down falla con un error claro — es correcto:
     revertir con datos vencidos vivos no es seguro). Se sigue el patrón de round-trip
     verificado en features 28/37.

RLS: `cierre_dia`/`cierre_bodega` ya tienen RLS habilitada sin policies (solo service
role). La migración NO toca policies (R3).

---

## 2. Backend — corte diario

### 2.1 Route handler `/api/cron/corte-diario` (R5/R11/R24)

`app/api/cron/corte-diario/route.ts` — Controller (patrón `carga-masiva/route.ts` y
`docs/architecture.md`: "Cron interno → Route Handler"):

- `GET` (Vercel Cron invoca GET). Valida `Authorization: Bearer ${process.env.CRON_SECRET}`
  → si no coincide, `401` sin efectos (R5). El secreto vive en variable de entorno,
  nunca en repo ni en logs (R24).
- Delega TODA la lógica en `CorteDiarioService.ejecutarCorte()`. El handler no tiene
  lógica de negocio ni queries.
- Respuesta 200 con un resumen `{ vencidosCreados, mensajerosEvaluados }` (sin PII).
- Errores: `withErrorHandler` + notificación por el canal definido (convenciones); el
  handler nunca filtra el secreto (R24).

`vercel.json` (nuevo, raíz):

```json
{ "crons": [{ "path": "/api/cron/corte-diario", "schedule": "0 6 * * *" }] }
```

`0 6 * * *` = 06:00 UTC = 00:00 America/Costa_Rica (UTC-6, sin horario de verano) (R11).

### 2.2 `CorteDiarioService` (R6-R11/R23) — `lib/services/CorteDiarioService.ts`

Servicio nuevo, lógica de negocio pura (sin HTTP ni Prisma directo). Inyecta:

- `ICorteDiarioRepository` (nuevo) — queries del corte.
- `IZonaRepository` (`findCentralZonaId`) — derivar bodega responsable (R1).
- `ITarifaZonaMensajeroRepository` — snapshot del pago al mensajero (feature 39), reuso.

Flujo `ejecutarCorte()`:

1. `repo.findMensajerosConActividadSinCierre()` → mensajeros con ≥1 `gestion_orden`
   `cierre_id IS NULL` y SIN cierre `solicitado` (R7/R10). Devuelve `{ mensajeroId,
   zonaId }`.
2. Por cada mensajero (con `zonaId != null`, si no → omitir + log, P2):
   - Derivar `destinoTipo`/`destinoZonaId` con la MISMA regla que
     `CierreDiaService.solicitarCierre` (R1) — se extrae a un helper compartido
     `lib/utils/bodega-responsable.ts` (`resolverDestinoCierre(zonaId, centralZonaId)`)
     para eliminar duplicación entre `solicitarCierre` y el corte.
   - Resolver tarifa (feature 39) y snapshot de totales/pago (reuso de `computeTotales`
     + `derivarPagos` + `derivarIngresoBodega`, exportados desde `CierreDiaService` o
     movidos a `lib/utils/cierre-totales.ts` para reuso limpio).
   - `repo.crearCierreVencido({...})` — transacción todo-o-nada (R8/R23): INSERT
     `cierre_dia estado='vencido'` + `UPDATE gestion_orden SET cierre_id=<nuevo> WHERE
     mensajero_id=? AND cierre_id IS NULL` (guardia de propiedad + no-cerradas). Si el
     UPDATE afecta 0 filas (una solicitud concurrente vinculó las gestiones justo
     antes), la tx hace rollback y NO crea el vencido (R9/R10/R23 anti-TOCTOU).
3. Idempotencia (R9): no hay dedupe por fecha; el vínculo `cierre_id` hace que una
   segunda corrida no vea gestiones pendientes → 0 vencidos nuevos.

**Reutilización money-critical:** el snapshot de totales/pago/ingreso usa exactamente
los mismos helpers que `solicitarCierre` (features 37/39/56). Se refactoriza para
compartir (no se duplica la aritmética Decimal). Un `vencido` es indistinguible de un
`solicitado` en cuanto a totales; solo cambia `estado` y el actor (job).

### 2.3 `ICorteDiarioRepository` / `CorteDiarioRepository`

`lib/interfaces/repositories/ICorteDiarioRepository.ts` +
`lib/repositories/CorteDiarioRepository.ts`:

- `findMensajerosConActividadSinCierre(): Promise<{ mensajeroId: string; zonaId: string | null }[]>`
  — `SELECT DISTINCT` mensajeros con `gestion_orden.cierre_id IS NULL`, `LEFT JOIN` para
  excluir los que tienen `cierre_dia estado='solicitado'`. Solo query.
- `crearCierreVencido(input): Promise<string | null>` — transacción (patrón
  `crearCierre`); devuelve el id o `null` si el guard vinculó 0 gestiones.

Reusa `ICierreDiaRepository.crearCierre` como base; para no duplicar, `crearCierreVencido`
puede ser un método hermano en `CierreDiaRepository` con `estado='vencido'` parametrizado.
Decisión: **parametrizar** `crearCierre` con `estado` (default `solicitado`) para que el
corte reuse la misma tx de vinculación de gestiones + snapshot.

---

## 3. Backend — bloqueo derivado en asignación

### 3.1 Consulta de bloqueo (R12/R17)

Método nuevo en `IOrdenRepository` (donde ya viven `findMensajeroIdsValidosByZona`,
`findUsuarioZonaId`, los lote de asignación):

- `findMensajerosBloqueados(mensajeroIds: string[]): Promise<Set<string>>` — de los ids
  dados, cuáles tienen `cierre_dia` con `estado IN ('solicitado','vencido')` (R12/R16).
  Usa el índice `(mensajero_id, estado)`.
- `existeBodegaSateliteBloqueada(zonaId: string): Promise<BodegaBloqueoResult>` — regla
  estricta de R17 (F1.4-Q4): la bodega está bloqueada si se cumple **CUALQUIERA** de las
  dos causas (OR). Devuelve no solo el booleano sino la causa, para que R18/R22 puedan
  diferenciar el motivo. Forma sugerida:
  `{ bloqueada: boolean; porMensajeros: boolean; porCierreBodega: boolean }`.
  - Causa (i) — `EXISTS` sobre `cierre_dia` con `destino_tipo='bodega_satelite'`,
    `destino_zona_id=zonaId`, `estado IN ('solicitado','vencido')`. Usa
    `(destino_tipo, destino_zona_id)`.
  - Causa (ii) — `EXISTS` sobre `cierre_bodega` con `zona_id=zonaId` y
    `estado='solicitado'` (único estado pendiente que produce la feature 40:
    `CierreBodega` comparte el enum `CierreEstado`, se crea con `@default(solicitado)` y
    se resuelve a `aprobado`/`rechazado`; NO existe `vencido` de `CierreBodega` en esta
    feature). Usa `(zona_id)` + índice único parcial `WHERE estado='solicitado'` (feature
    40). **Reutiliza el repo de la feature 40** (`ICierreBodegaAdminRepository` /
    `CierreBodegaRepository`): si ya expone un lookup del `CierreBodega solicitado` por
    zona (p. ej. el que usa `SolicitarCierreBodegaService` para su guardia de unicidad),
    se reutiliza ese método en vez de duplicar la query; si no, se añade un
    `existeCierreBodegaPendiente(zonaId): Promise<boolean>` en ese repo. El implementer
    debe verificar el nombre real del método existente antes de crear uno nuevo.
  `bloqueada = porMensajeros || porCierreBodega`. Ambas comprobaciones pueden resolverse
  en paralelo (`Promise.all`) o en un único round-trip con dos sub-`EXISTS`.

### 3.2 Guarda en `GuiaAsignacionService` (feature 17/30) — R13

En `generarGuia` y `asignarDesdeBodega`, tras validar el lote y ANTES de persistir:
recolectar los `mensajeroId != null` del lote, llamar `findMensajerosBloqueados` y, si
alguno está bloqueado, añadir al `detalle` de conflicto `{ ordenId, motivo:
"mensajero bloqueado por cierre pendiente" }` → retorno `conflict` sin efectos
(todo-o-nada, patrón existente R11/R17 de la feature 17). El ruteo a satélite (órdenes
sin mensajero) NO se bloquea (no asigna mensajero).

### 3.3 Guarda en `AsignacionSateliteService` (feature 34) — R14/R18

Dos guardas nuevas en `asignar`, antes de escribir:

- **Bodega bloqueada (R18, regla estricta F1.4-Q4):** tras resolver `zonaId` (feature 34,
  `AsignacionSateliteService.asignar`), llamar `existeBodegaSateliteBloqueada(zonaId)`.
  Si `bloqueada === true` por CUALQUIERA de las dos causas → retorno nuevo estado
  `bodega_bloqueada`, SIN efectos. El resultado transporta la causa (`porMensajeros` /
  `porCierreBodega`) para que el borde (Server Action feature 34) traduzca el motivo
  accionable de R22: "resuelve los cierres de tus mensajeros" vs "tu cierre de bodega
  hacia la central está pendiente de aprobación". La guarda entra en `asignar` ANTES de
  cualquier escritura del lote (junto a la guarda de mensajero bloqueado), de modo que un
  bloqueo de bodega aborta la operación completa (todo-o-nada).
- **Mensajero bloqueado (R14):** `findMensajerosBloqueados([input.mensajeroId])` → si
  bloqueado, `validation_error`/`conflict` con motivo, SIN efectos.

Anti-TOCTOU (R23): idealmente la condición de bloqueo se integra como `NOT EXISTS`
sub-select dentro del `asignarSateliteLote` / `generarGuiaLote` (mismo `updateMany`),
de modo que un cierre solicitado entre lectura y escritura reduzca el `count` y se
reporte conflicto. Alternativa aceptable si complica el SQL del lote: mantener la guarda
como pre-check + confiar en que el `count !== ordenIds.length` ya detecta carreras de
estado de la orden. **Recomendación:** integrar el `NOT EXISTS` en el `WHERE` del lote
para las asignaciones a mensajero (la ventana de carrera real es estrecha, pero es
money-adjacent).

### 3.4 Desbloqueo (R15/R19)

No requiere código nuevo de "desbloqueo": al ser DERIVADO, en cuanto el cierre pasa a
`aprobado`/`rechazado` deja de contar. La resolución la hace `CierresAdminService`
(feature 38). Para R19 (resolver un `vencido`) se extiende la guardia de transición del
repo de la 38 (`resolverCierre`) para aceptar `vencido` además de `solicitado` como
estado de origen válido (`WHERE estado IN ('solicitado','vencido')`). El resto del flujo
(auditoría `resuelto_por/at`, motivo de rechazo, inmutabilidad) se reutiliza tal cual.

---

## 4. Frontend — reflejo del bloqueo (R20/R21/R22)

Sin pantallas nuevas (F1.4-Q6):

- **`/cierres-admin` (R20):** el listado role-aware existente (features 38/40) ya parte
  por estado (`solicitado` → cola; resueltos → histórico). Se añade `vencido` como
  categoría/etiqueta diferenciada en la cola (los vencidos son resolubles, R19). Cambio
  acotado al service `CierresAdminService` (ya lee por alcance) + el componente de lista.
- **Vista del mensajero (R21):** "Cierre del día"/"Mis asignaciones" muestra un aviso
  cuando el mensajero está bloqueado. El dato `bloqueado` se deriva server-side
  (Server Component / Server Action) con `findMensajerosBloqueados([actor.usuarioId])`.
- **Vista del adminSatelite (R22):** la vista de asignación (feature 34) muestra aviso
  cuando `existeBodegaSateliteBloqueada(zona).bloqueada` es `true`, deshabilitando el
  botón de asignar. El mensaje diferencia la causa según `causa.porMensajeros` /
  `causa.porCierreBodega` (regla estricta R17): "resuelve los cierres de tus mensajeros"
  y/o "tu cierre de bodega hacia la central está pendiente de aprobación".

Componentes: reusar `Toast`/avisos existentes (features 11); los datos sensibles llegan
por props desde el Server Component (patrón `private/`).

---

## 5. Contratos de I/O

### 5.1 `GET /api/cron/corte-diario`
- **Auth:** header `Authorization: Bearer <CRON_SECRET>`. Sin/incorrecto → `401`.
- **200:** `{ vencidosCreados: number, mensajerosEvaluados: number }`.
- **5xx:** error controlado (`withErrorHandler`), notificado por canal, sin secreto.

### 5.2 Asignación (extensión de resultados existentes)
- `GuiaAsignacionService` (R13): `conflict` con `detalle[{ ordenId, motivo }]` (formato
  existente `DetalleConflicto`).
- `AsignacionSateliteService` (R14/R18): nuevo variante de resultado
  `{ status: "bodega_bloqueada"; causa: { porMensajeros: boolean; porCierreBodega: boolean } }`
  (regla estricta R17: al menos una de las dos causas es `true`) y/o
  `conflict`/`validation_error` con `fieldErrors.mensajeroId` para el mensajero bloqueado.
  El borde (Server Action feature 34) traduce `causa` al mensaje accionable de R22.

---

## 6. Alternativas consideradas y descartadas

**A1 — Bloqueo con flag persistido en `usuario` (`bloqueado_por_cierre`) en vez de
derivado.** DESCARTADA. Requiere mantener el flag transaccionalmente en cada
solicitar/aprobar/rechazar/vencer, con riesgo de drift (el flag y el estado real de los
cierres se desincronizan ante cualquier fallo parcial). El derivado (existencia de
`cierre_dia` en estado bloqueante) es siempre consistente por construcción, y con el
índice `(mensajero_id, estado)` la consulta en la ruta de asignación es barata. Se
elige derivado (F1.4-Q3).

**A2 — Estado "vencido" virtual (sin fila), calculado al vuelo.** DESCARTADA. No deja
evidencia auditable en la bodega responsable (la descripción exige "se evidencia en la
bodega responsable"), obligaría a recomputar totales cada vez que se muestra (rompe el
principio de snapshot inmutable money-critical) y complicaría la resolución (Q5). Se
elige crear una fila real `cierre_dia estado='vencido'` con snapshot congelado (F1.4-Q2).

**A3 — Tabla de dedupe por fecha para la idempotencia del corte
(`corte_diario_run(fecha)`).** DESCARTADA por innecesaria: vincular las gestiones al
`vencido` (`cierre_id` deja de ser NULL) hace que una segunda corrida el mismo día no
encuentre trabajo pendiente (R7/R9). Menos superficie, sin tabla ni RLS extra. Si en el
futuro se quiere un registro de ejecuciones del cron para observabilidad, se añade como
follow-up, no como requisito de la 41.

**A4 — Cron vía scheduler externo (GitHub Actions / cron-job.org) golpeando el
endpoint.** DESCARTADA frente a Vercel Cron: introduce un proceso/infra fuera del deploy
de Vercel, con su propia gestión de secretos y disponibilidad. Vercel Cron es nativo del
stack (`docs/architecture.md`), corre en la misma plataforma y se versiona en
`vercel.json`. (F1.4-Q1.)

**A5 — Bloqueo de bodega satélite contando SOLO los cierres de sus mensajeros (causa i),
sin mirar su propio `CierreBodega` hacia la central.** DESCARTADA en la puerta F1.4
(2026-07-12): era la recomendación original, pero el humano eligió la **regla más
estricta** (F1.4-Q4). Se descarta porque dejaría a una satélite seguir asignando trabajo
hacia abajo mientras su propio cierre de bodega (dinero agregado hacia la central) sigue
sin aprobarse, contradiciendo el principio money-critical de "no acumular más operación
sobre dinero sin conciliar". La solución adoptada suma la causa (ii): la bodega está
bloqueada si existe (i) algún `cierre_dia` de sus mensajeros en `solicitado`/`vencido`
de su zona **O** (ii) su propio `CierreBodega` en `solicitado`. Coste: una comprobación
`EXISTS` adicional sobre `cierre_bodega`, cubierta por sus índices existentes de la
feature 40 (incluido el único parcial `WHERE estado='solicitado'`), sin migración nueva.

---

## 7. Partición backend / frontend (para el implementer)

**Backend (backend_dev) — grueso de la feature:**
- Migración `cierre_estado_vencido` + `down.sql` + índice `(mensajero_id, estado)`.
- `lib/types/cierre.ts` (`vencido` en el SEED) + schema Prisma.
- `CorteDiarioService` + `ICorteDiarioRepository`/`CorteDiarioRepository`.
- Route handler `/api/cron/corte-diario` + `vercel.json` + var `CRON_SECRET`.
- Helpers compartidos: `bodega-responsable.ts`, refactor de totales/pago a util reusable.
- `IOrdenRepository`: `findMensajerosBloqueados`, `existeBodegaSateliteBloqueada`
  (regla estricta con causa (i)+(ii), reutilizando el repo de `CierreBodega` de la
  feature 40 para la causa (ii); + implementación) y `NOT EXISTS` en los lote de
  asignación (R23).
- Guardas en `GuiaAsignacionService` y `AsignacionSateliteService`.
- Extensión de la guardia de `resolverCierre` (feature 38) para aceptar `vencido` (R19).
- Extensión de `CierresAdminService` para categorizar `vencido` en la cola (R20).

**Frontend (frontend_dev):**
- `/cierres-admin`: etiqueta/categoría "vencido" en la lista existente (R20).
- Vista del mensajero: aviso de bloqueo (R21).
- Vista del adminSatelite: aviso de bloqueo de bodega + botón asignar deshabilitado (R22).

**Orden sugerido:** migración + tipos → repos/consultas → `CorteDiarioService` + cron →
guardas de asignación → extensión resolución vencido → UI. La UI depende de los flags
derivados del backend.
