# Feature 38 — Admin: "Cierres del día (aprobar/rechazar)" · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 37 (`done`) · branch: `feature/38-cierres-admin`

> **F1.4 APROBADA por el humano el 2026-07-12** (todas las recomendadas; SUPERSEDE "## Preguntas abiertas"):
> - **(a) Rechazo INMUTABLE:** el cierre pasa a `rechazado` y las `gestion_orden` NO se desvinculan
>   (`cierre_id` intacto, snapshot preservado); el desbloqueo/re-solicitud del mensajero es de la feature 41.
> - **(b) Detalle:** REUSAR `CierreDetalleGestion` + `WITH_DETALLE` + firma de evidencia de la 37; añadir solo
>   `findGestionesByCierre` (WHERE `cierre_id = X`).
> - **(c) Vista:** cola de `solicitado` + HISTÓRICO de `aprobado`/`rechazado` del alcance del admin.
> - **(d) Concurrencia:** transición con `updateMany ... WHERE id=X AND estado='solicitado' AND <alcance>`;
>   `count===0` → `conflict`.
> - **(e) Auditoría (ÚNICO cambio de schema):** migración ADITIVA en `cierre_dia` → `resuelto_por` (FK usuario,
>   `ON DELETE SET NULL`), `resuelto_at`, `motivo_rechazo` (OBLIGATORIO al rechazar); con `down.sql`, RLS intacta.
> - **(f) E2E:** sí, Playwright del flujo (escrito, ejecución diferida).
> - **(g) De a UNO** con el detalle a la vista (no lote).
> Estado: `in_progress`.

## Alcance (qué SÍ hace la 38)

Módulo "Cierres del día" del **administrador de una bodega**: el **admin maestro** (rol
`maestro`) para la bodega central/GAM y el **adminSatelite** para su bodega. Muestra TODAS
las solicitudes de cierre (`cierre_dia`, feature 37) que le hicieron sus mensajeros, con el
**detalle completo** de cada orden del cierre (gestión, evidencias en foto, montos, métodos
de pago, motivos) y los totales por método. Permite **APROBAR** o **RECHAZAR** cada cierre
`solicitado`, transicionándolo a `aprobado`/`rechazado` (valores de enum ya reservados por
la 37).

## Fuera de alcance (lo hace otra feature — NO construir aquí)

- **Pago al mensajero por zona** en el cierre → feature 39.
- **Cierre de bodega satélite → central** → feature 40.
- **Bloqueos** del mensajero/bodega, obligatoriedad y **vencidos** (cron 00:00) → feature 41.
- **Wallet / caja** y movimientos → features 42–45.

La 38 SOLO transiciona `solicitado` → `aprobado`/`rechazado` (+ auditoría). Las
**consecuencias** (desbloquear al mensajero, alimentar la caja/wallet) son de 41/42.

## Datos base (verificados en `dev`, feature 37)

- `resolveActorFromSession()` → `Actor { usuarioId, rol }` (`lib/auth/resolve-actor.ts`).
- `model CierreDia` (`db/schema.prisma`): `mensajeroId`, `estado` (`CierreEstado`:
  `solicitado`/`aprobado`/`rechazado`), `destinoTipo` (`CierreDestinoTipo`:
  `bodega_central`/`bodega_satelite`), `destinoZonaId`, totales snapshot
  (`totalEfectivo`/`totalSimpe`/`totalTransferencia`/`totalGeneral`, `Decimal(12,2)`),
  `solicitadoAt`. Índices `[mensajeroId]`, `[destinoTipo, destinoZonaId]` (creado por la 37
  con el comentario "feature 38: filtra por rol+zona destino"), `[estado]`. RLS habilitada
  sin políticas (solo service role).
- `GestionOrden.cierreId` (FK nullable): las gestiones incluidas en un cierre lo referencian.
  El detalle por orden se deriva de estas filas.
- Alcance por zona: `ZonaRepository.findCentralZonaId()` (id de la zona central o `null`),
  `OrdenRepository.findUsuarioZonaId(usuarioId)` (zona del actor o `null`).
- Detalle reutilizable de la 37: `CierreGestionPendienteRow` (repo) → `CierreDetalleGestion`
  (service DTO), proyección `WITH_DETALLE` y firma de evidencia con `ISignedUrlProvider`
  (bucket privado de la feature 36).

---

## Requisitos (EARS)

### Acceso y autorización

- **R1** — El sistema DEBE exponer el módulo "Cierres del día" ÚNICAMENTE a los roles
  `maestro` y `adminSatelite`; la página valida el actor server-side y, si el rol no es
  ninguno de esos dos (o no hay sesión), DEBE responder `notFound` (patrón features 33/36/37).
  *Testeable:* acceso con `mensajero`/`adminTienda`/`admin`/sin sesión → not found.

- **R2** — El sistema DEBE resolver el alcance de los cierres visibles server-side por
  rol+zona: SI el actor es `maestro`, ENTONCES DEBE ver ÚNICAMENTE los cierres con
  `destinoTipo = bodega_central`; SI el actor es `adminSatelite`, ENTONCES DEBE ver
  ÚNICAMENTE los cierres con `destinoTipo = bodega_satelite` **y** `destinoZonaId` igual a su
  zona (`findUsuarioZonaId`). Un admin NUNCA DEBE ver cierres de otra bodega/zona.
  *Testeable:* con cierres de varias zonas/tipos sembrados, cada rol recibe solo su subconjunto.

- **R3** — SI el actor es `adminSatelite` y no tiene `zonaId` asignada, ENTONCES el sistema
  DEBE mostrar el módulo vacío con un aviso accionable y NO DEBE devolver ningún cierre
  (patrón `RecepcionSateliteService` R5). *Testeable:* adminSatelite sin zona → lista vacía + `sinZona`.

### Listado de cierres

- **R4** — El sistema DEBE listar los cierres en estado `solicitado` dentro del alcance del
  actor (R2), como cola de "pendientes de decisión", cada uno con su metadata (mensajero,
  `solicitadoAt`, destino) y sus totales snapshot por método + general. *Testeable:* la
  respuesta trae los cierres `solicitado` del alcance con sus totales.

- **R5** — El sistema DEBE permitir al admin consultar, en solo lectura, un histórico de los
  cierres ya resueltos (`aprobado`/`rechazado`) dentro de su mismo alcance (R2), con su estado
  y totales. `prov. F1.4-c` *Testeable:* un cierre aprobado aparece en el histórico del admin de su bodega/zona.

### Detalle del cierre (money-critical)

- **R6** — CUANDO el admin abra un cierre, el sistema DEBE mostrar el detalle COMPLETO de cada
  orden incluida (todas las `gestion_orden` con `cierre_id` = ese cierre): datos de la orden
  (num_guía, num_remisión, destinatario, dirección, zona/provincia/cantón/distrito, producto,
  tienda), el `resultado` y los campos según resultado (monto y método si `entregada`; fecha de
  reprogramación y motivo si `reprogramada`; motivo si `devuelta`; motivo y evidencia si
  `rechazada`). El detalle DEBE derivarse de las gestiones vinculadas (reuso del DTO
  `CierreDetalleGestion` de la 37, no un DTO nuevo). `prov. F1.4-b`
  *Testeable:* el detalle del cierre lista sus gestiones con los campos correctos por resultado.

- **R7** — DONDE una gestión del cierre tenga evidencia en foto, el sistema DEBE exponerla
  mediante **URL firmada de corta duración**, nunca el `storage_path` crudo ni una URL pública
  (patrón features 21/22/36/37). *Testeable:* la respuesta trae URL firmada; el path crudo no se filtra.

- **R8** — El sistema DEBE mostrar, por cada orden `entregada`, el `montoRecibido` con su
  `metodoPago`, y DEBE mostrar los totales por método (`efectivo`/`SIMPE`/`transferencia`) y el
  total general tomados del **snapshot** del cierre (congelados por la 37, R14). *Testeable:*
  los totales mostrados coinciden con `total_efectivo/simpe/transferencia/general` del cierre.

- **R9** — El sistema DEBE manejar todos los montos como Decimal de escala 2 serializados a
  **string** cruzando la frontera Server Action → cliente (nunca `number`/`parseFloat`).
  *Testeable:* los montos del DTO son strings con escala 2; no hay pérdida de precisión.

### Aprobar / rechazar

- **R10** — CUANDO el admin apruebe un cierre `solicitado` dentro de su alcance, el sistema
  DEBE transicionarlo a `aprobado`. *Testeable:* aprobar un cierre solicitado → `estado = aprobado`.

- **R11** — CUANDO el admin rechace un cierre `solicitado` dentro de su alcance, el sistema
  DEBE transicionarlo a `rechazado` y DEBE exigir un **motivo de rechazo** no vacío que se
  persiste con el cierre. `prov. F1.4-a` *Testeable:* rechazar sin motivo → `validation_error`;
  rechazar con motivo → `estado = rechazado` y el motivo queda guardado.

- **R12** — El sistema DEBE hacer la transición idempotente/concurrencia-segura: DEBE aplicarla
  ÚNICAMENTE si el cierre sigue en estado `solicitado` (guardia en el `WHERE` del `updateMany`,
  patrón feature 37/33); SI el cierre ya fue resuelto (`aprobado`/`rechazado`) por otro admin o
  por el mismo, ENTONCES el sistema NO DEBE re-aplicar la transición y DEBE devolver `conflict`
  sin efectos. `prov. F1.4-d` *Testeable:* segunda aprobación/rechazo del mismo cierre → `conflict`, sin cambios.

- **R13** — SI el admin intenta aprobar/rechazar un cierre fuera de su alcance (otro
  `destinoTipo`, otra `destinoZonaId`, o inexistente), ENTONCES el sistema DEBE rechazar la
  operación sin efectos (`forbidden`/`no_encontrada`), sin filtrar la existencia del cierre.
  *Testeable:* adminSatelite de zona A intenta resolver un cierre de zona B → sin efectos.

- **R14** — CUANDO se resuelva un cierre (aprobar o rechazar), el sistema DEBE registrar QUIÉN
  lo resolvió (`resueltoPor` = actor) y CUÁNDO (`resueltoAt`), para trazabilidad money/audit.
  `prov. F1.4-e` *Testeable:* tras resolver, el cierre guarda el id del admin actor y la marca de tiempo.

### Límites y seguridad

- **R15** — La transición de la 38 NO DEBE producir efectos fuera de su alcance: NO DEBE
  desbloquear al mensajero, NO DEBE alimentar wallet/caja y NO DEBE desvincular las
  `gestion_orden` del cierre (`cierre_id` permanece intacto). Esas consecuencias son de las
  features 41/42. `prov. F1.4-a` *Testeable:* tras aprobar/rechazar, las `gestion_orden` del
  cierre mantienen su `cierre_id` y no cambia ningún otro estado del sistema.

- **R16** — El módulo DEBE ser de solo lectura salvo la propia transición (aprobar/rechazar):
  listar y ver detalle NO DEBEN mutar cierres, gestiones ni órdenes. *Testeable:* listar/ver
  detalle no cambia ninguna fila.

- **R17** — SI la implementación añade columnas de auditoría/motivo a `cierre_dia`
  (`prov. F1.4-e`), la migración DEBE ser versionada y reversible (con `down.sql`), mantener la
  **RLS** de la tabla y `pnpm run db:rollback` DEBE revertirla limpiamente. SI F1.4 opta por la
  transición pura sin auditoría, NO se requiere migración. *Testeable:* round-trip up → down → up
  en la DB de test; RLS sigue habilitada.

---

## Tabla de trazabilidad (R → test previsto)

| R | Prueba prevista (el implementer fija la ruta en `progress/impl_38-*.md`) |
| --- | --- |
| R1 | integración action/página: rol ≠ maestro/adminSatelite → notFound |
| R2 | unit service: maestro→bodega_central; adminSatelite→bodega_satelite+su zona; ajeno excluido |
| R3 | unit service: adminSatelite sin zona → vacío + `sinZona` |
| R4 | unit service: lista `solicitado` del alcance con totales snapshot |
| R5 | unit service: cierre resuelto aparece en histórico del alcance |
| R6 | unit service: detalle deriva las gestiones del cierre con campos por resultado |
| R7 | unit service (doble `ISignedUrlProvider`): evidencia → URL firmada, no path |
| R8 | unit service: totales mostrados == snapshot del cierre |
| R9 | unit service: montos serializados a string escala 2 (Decimal) |
| R10 | integración repo/DB: aprobar solicitado → aprobado |
| R11 | unit service: rechazo sin motivo → validation_error; con motivo → rechazado + motivo |
| R12 | integración repo/DB: doble resolución → conflict (updateMany WHERE estado='solicitado') |
| R13 | unit service: cierre fuera de alcance → forbidden/no_encontrada, sin efectos |
| R14 | integración: cierre resuelto guarda resueltoPor + resueltoAt |
| R15 | integración: tras resolver, `gestion_orden.cierre_id` intacto; sin otros efectos |
| R16 | unit service: listar/ver detalle no muta |
| R17 | integración migración: RLS habilitada + rollback up/down verde (si hay migración) |
| — E2E `prov. F1.4-f` | Playwright: admin ve cierre solicitado → abre detalle → aprueba/rechaza → pasa a histórico |

---

## Preguntas abiertas (F1.4 — decisiones que el humano debe cerrar)

Cada una con **recomendación** del spec_author y alternativa. NO se cierran aquí.

- **(a) Efecto del RECHAZO sobre gestiones y motivo.** *Recomendado:* el rechazo transiciona
  el cierre a `rechazado` de forma **inmutable** — NO desvincula las `gestion_orden`
  (`cierre_id` intacto), preservando el detalle y el snapshot para auditoría; el desbloqueo y la
  re-solicitud del mensajero son de la **feature 41** (no invadir). Además, el **motivo de
  rechazo es OBLIGATORIO** (R11), para que la 41/mensajero sepa qué corregir.
  *Alternativa:* al rechazar, **desvincular** las gestiones (`cierre_id = null`) para que el
  mensajero pueda re-solicitar de inmediato (feature 37 lista por `cierre_id IS NULL`).
  *Por qué se descarta la alternativa por defecto:* rompe la inmutabilidad del snapshot
  money-critical (design 37 §5.C) y deja el cierre rechazado sin detalle derivable; además pisa
  la responsabilidad de desbloqueo/re-solicitud de la 41. **Riesgo conocido de la recomendación:**
  hasta que caiga la 41, un mensajero con un cierre rechazado queda "trabado" (sus gestiones
  siguen con `cierre_id`); es la frontera de alcance esperada.

- **(b) DTO/servicio de detalle.** *Recomendado:* **REUSAR** el `CierreDetalleGestion` DTO, la
  proyección `WITH_DETALLE` y la firma de evidencia de la feature 37; solo se añade un método de
  repo `findGestionesByCierre(cierreId)` (WHERE `cierre_id = X`, gemelo de
  `findGestionesPendientes` que usa `cierre_id IS NULL`). *Alternativa:* un DTO admin propio —
  se descarta por duplicar el contrato de detalle sin aportar campos nuevos.

- **(c) Qué ve el admin.** *Recomendado:* vista principal = cola de `solicitado` (pendientes de
  decisión) **más** un histórico de solo lectura de `aprobado`/`rechazado` de su alcance (R4/R5).
  *Alternativa:* solo `solicitado`. *Por qué:* el admin necesita consultar lo ya resuelto
  (money/audit) sin salir del módulo.

- **(d) Concurrencia.** *Recomendado:* transición vía `updateMany ... WHERE id = X AND estado =
  'solicitado'`; si el `count` afectado es 0 → `conflict` (ya resuelto), sin leer-luego-escribir
  (R12). *Alternativa:* leer-comprobar-escribir sin guardia — se descarta por race entre dos
  admins de la misma bodega.

- **(e) Auditoría / esquema.** *Recomendado:* añadir a `cierre_dia` columnas **`resuelto_por`**
  (FK `usuario`, nullable), **`resuelto_at`** (DateTime, nullable) y **`motivo_rechazo`**
  (String, nullable) — migración aditiva con `down.sql`, RLS intacta (R14/R17). *Alternativa:*
  transición pura sin columnas nuevas (usar `updated_at`) — se descarta porque pierde QUIÉN
  aprobó/rechazó un cierre de caja (money-critical) y dónde guardar el motivo de rechazo.
  **Esta es la única decisión que implica cambio de schema.**

- **(f) E2E.** *Recomendado:* AÑADIR un E2E Playwright del flujo (admin ve solicitado → detalle
  → aprobar/rechazar → histórico), checkpoint de flujo de dinero (patrón features 33/34/36/37).
  *Alternativa:* solo unit/integración.

- **(g) Aprobar/rechazar en lote o de a uno.** *Recomendado:* **de a uno**, con el detalle a la
  vista (una decisión money-critical por cierre, con evidencias). *Alternativa:* acción en lote
  — se descarta por defecto (aprobar caja sin ver el detalle es riesgoso); puede reconsiderarse
  para aprobación masiva en una feature futura.
