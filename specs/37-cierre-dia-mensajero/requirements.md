# Feature 37 — Mensajero: "Cierre del día" · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 36 (`done`) · branch: `feature/37-cierre-dia-mensajero`

> **F1.4 APROBADA por el humano el 2026-07-11** (ver "## Decisiones F1.4 (APROBADAS)"
> abajo, que SUPERSEDE "Preguntas abiertas"). Casi todo quedó en la opción recomendada;
> la ÚNICA ampliación es (h): SÍ se muestran los cierres PASADOS (histórico). Estado: `in_progress`.

## Decisiones F1.4 (APROBADAS 2026-07-11)

- **(a)** Tabla NUEVA `cierre_dia` + FK `cierre_id` (nullable) en `gestion_orden` (se setea al solicitar).
  Migración + `down.sql` + **RLS**.
- **(b)** El "día" agrupa las `gestion_orden` del mensajero que aún NO están en un cierre (`cierre_id IS NULL`),
  NO por fecha calendario. (El corte de medianoche es de la feature 41, no acá.)
- **(c)** Precondición: solo puede solicitar cierre si NO tiene órdenes pendientes (`en_espera_aceptacion`
  ni `en_reparto`); si tiene, error claro "aún tienes órdenes por gestionar".
- **(d) SIN estado 'abierto' previo**: el módulo muestra las gestionadas pendientes de cierre derivadas al
  vuelo; al pulsar **"Solicitar cierre"** se CREA el `cierre_dia` en estado **`solicitado`**. Enum
  `cierre_estado` = `solicitado` (+ `aprobado`/`rechazado` reservados para la feature 38). Al solicitar, se
  fija `cierre_id` en las `gestion_orden` incluidas (todo-o-nada).
- **(e)** El `cierre_dia` GUARDA el destino derivado: `destino_tipo` (central/satélite) + `destino_zona_id`,
  resuelto SERVER-SIDE por la zona del mensajero usando el resolver existente `IZonaRepository.findGamZonaId()`
  (NO leer `zona.esGam` directo — hay drift). Si la zona del mensajero es la GAM → central/maestro; si no →
  adminSatelite de esa zona.
- **(f) SNAPSHOT**: al solicitar, se CONGELAN en el `cierre_dia` los totales por método de pago (efectivo/
  SIMPE/transferencia) y el total general (Decimal). Base estable para la aprobación (38) y la wallet (42).
- **(g) SÍ E2E** (Playwright) del flujo: gestionar todo → ver totales → solicitar cierre (escrito, ejecución
  diferida, patrón del repo).
- **(h) SÍ listar cierres PASADOS**: el módulo muestra el cierre en curso (derivado) + un HISTÓRICO de los
  `cierre_dia` del mensajero (solicitados/aprobados/rechazados) con su detalle y totales.
- **(i)** Reprogramadas/devueltas/rechazadas cuentan **$0** (solo `entregada` aporta `montoRecibido`).

## Alcance (qué SÍ hace la 37)

Módulo "Cierre del día" del rol `mensajero`. (1) Acumula las órdenes que el mensajero
ya gestionó en "Mis asignaciones" (feature 36) y aún no están en un cierre; (2) muestra el
detalle exacto por resultado (entregada / reprogramada / devuelta / rechazada) con el
detalle completo de cada orden, el dinero recogido por orden y los **totales por método de
pago** (efectivo / SIMPE / transferencia) + total general; (3) permite **Solicitar cierre**
solo cuando el mensajero gestionó TODAS sus órdenes asignadas, creando una **solicitud** de
cierre ruteada al administrador de la bodega según la zona del mensajero (bodega central /
maestro si la zona es GAM; adminSatelite de la zona en caso contrario).

## Fuera de alcance (lo hace otra feature — NO construir aquí)

- **Aprobar / rechazar** el cierre por el administrador → **feature 38**.
- **Pago al mensajero por zona** en el cierre → **feature 39**.
- **Cierre de bodega satélite → central** → **feature 40**.
- **Bloqueos** del mensajero/bodega, **obligatoriedad** y **corte de medianoche / vencidos**
  (cron 00:00) → **feature 41**.
- **Wallet / caja** y movimientos → **features 42–45**.

La 37 deja el enum de estado del cierre con los valores que la 38 necesitará
(`aprobado`/`rechazado`), pero **solo produce** cierres en estado `solicitado`.

## Actores y datos base (verificados)

- `resolveActorFromSession()` → `Actor { usuarioId, rol }` (`lib/auth/resolve-actor.ts`).
- Gestiones: tabla `gestion_orden` (feature 36, `db/schema.prisma`): `ordenId`,
  `mensajeroId`, `resultado` (`GestionResultado`), `montoRecibido` (Decimal? — solo
  `entregada`), `metodoPago` (`MetodoPagoValue`: `efectivo`/`SIMPE`/`transferencia` — solo
  `entregada`), `evidenciaStoragePath`, `motivo`, `fechaReprogramacion`, `createdAt`.
- "Gestionó TODAS": el mensajero NO tiene órdenes con
  `mensajero_asignado_id = actor` en estado `en_espera_aceptacion` ni `en_reparto`
  (`lib/types/order-status.ts`); todas resueltas a `entregada`/`reprogramada`/`devuelta`/`rechazada`.
- Zona del mensajero: `usuario.zonaId`; GAM se resuelve server-side con
  `IZonaRepository.findGamZonaId()` (patrón feature 30); mensajeros/adminSatelite por zona
  con `OrdenRepository.findMensajerosByZona` / `findUsuarioZonaId` (feature 33/34).

---

## Requisitos (EARS)

### Acceso y autorización

- **R1** — El sistema DEBE exponer el módulo "Cierre del día" ÚNICAMENTE al rol
  `mensajero`; la página valida el actor server-side y, si `rol !== 'mensajero'`, DEBE
  responder `notFound` (patrón features 33/36). *Testeable:* acceso con otro rol → not found.

- **R2** — El sistema DEBE resolver siempre el conjunto de gestiones y la solicitud sobre el
  actor autenticado; un mensajero NO DEBE poder ver ni solicitar el cierre de otro mensajero.
  *Testeable:* el service filtra por `mensajeroId = actor.usuarioId`; intento con id ajeno → sin datos.

### Detalle acumulado del día

- **R3** — MIENTRAS el mensajero tenga gestiones (`gestion_orden`) suyas aún NO incluidas en
  un cierre (`cierre_id IS NULL`), el sistema DEBE listarlas en el módulo agrupadas por
  `resultado`: entregadas, reprogramadas, devueltas y rechazadas. `prov. F1.4-b`
  *Testeable:* dado un set mixto de gestiones sin cierre, la respuesta agrupa por resultado.

- **R4** — El sistema DEBE mostrar, por cada orden gestionada, su detalle completo: datos de
  la orden (num_guia, num_remisión, destinatario, dirección, zona/provincia/cantón/distrito,
  producto, tienda) y los campos de la gestión según su resultado (monto y método si
  `entregada`; fecha de reprogramación y motivo si `reprogramada`; motivo si `devuelta`;
  motivo y evidencia si `rechazada`). *Testeable:* el DTO por orden incluye los campos del resultado.

- **R5** — DONDE una gestión tenga evidencia en foto (`evidenciaStoragePath`), el sistema
  DEBE exponerla mediante **URL firmada de corta duración**, nunca el path crudo ni una URL
  pública (patrón features 21/22/36). *Testeable:* la respuesta trae URL firmada; el path crudo no se filtra.

### Dinero y totales (money-critical)

- **R6** — El sistema DEBE mostrar el dinero recogido por cada orden ENTREGADA
  (`montoRecibido`) con su método de pago. *Testeable:* cada fila `entregada` expone monto+método.

- **R7** — El sistema DEBE calcular y mostrar los **totales por método de pago**
  (`efectivo`, `SIMPE`, `transferencia`) como la suma de `montoRecibido` de las gestiones con
  `resultado = entregada` agrupadas por `metodoPago`, más el **total general**. `prov. F1.4-f`
  *Testeable:* con montos conocidos por método, cada total y el general cuadran exactamente.

- **R8** — El sistema DEBE tratar las gestiones `reprogramada`, `devuelta` y `rechazada` como
  **$0** en los totales (no tienen `montoRecibido` ni `metodoPago`). *Testeable:* un set sin
  entregadas produce todos los totales = 0.00.

- **R9** — El sistema DEBE manejar todos los montos como Decimal de escala 2 y los totales
  DEBEN ser exactos (sin error de punto flotante). *Testeable:* suma de `0.10` repetidos y
  montos con decimales cuadra al centavo.

### Precondición de cierre

- **R10** — MIENTRAS el mensajero tenga al menos una orden asignada sin gestionar
  (`mensajero_asignado_id = actor` en estado `en_espera_aceptacion` o `en_reparto`), el
  sistema DEBE impedir "Solicitar cierre" y DEBE informar que debe gestionar todas sus
  órdenes primero. `prov. F1.4-c` *Testeable:* con 1 orden en `en_reparto`, solicitar → error `conflict` sin crear cierre.

- **R11** — SI el mensajero no tiene ninguna gestión pendiente de cierre (`cierre_id IS
  NULL`), ENTONCES el sistema DEBE impedir crear un cierre (no se cierra un día vacío).
  *Testeable:* sin gestiones pendientes, solicitar → error sin crear fila.

- **R12** — SI ya existe una solicitud de cierre del mensajero en estado `solicitado`,
  ENTONCES el sistema DEBE impedir crear otra. `prov. F1.4-d` *Testeable:* segunda solicitud consecutiva → `conflict`.

### Solicitar cierre y ruteo

- **R13** — CUANDO el mensajero pulse "Solicitar cierre" y se cumplan R10–R12, el sistema
  DEBE crear una solicitud de cierre en estado `solicitado` que agrupe TODAS sus gestiones
  pendientes, vinculando cada una a la solicitud (`gestion_orden.cierre_id`). `prov. F1.4-a`
  *Testeable:* tras solicitar, existe 1 cierre `solicitado` y todas las gestiones referencian su id.

- **R14** — CUANDO se cree la solicitud, el sistema DEBE **snapshotear** en la solicitud los
  totales por método de pago y el total general calculados en ese instante (R7). `prov. F1.4-f`
  *Testeable:* los totales snapshot del cierre coinciden con la suma de sus gestiones al crearlo.

- **R15** — CUANDO se cree la solicitud, el sistema DEBE derivar server-side el destino a
  partir de la zona del mensajero: SI `zona.esGam` es verdadero (`findGamZonaId()`), el
  destino DEBE ser la **bodega central** (admin maestro); SI NO, el destino DEBE ser la
  **bodega satélite** de esa zona (adminSatelite de la zona). El destino DEBE persistirse en
  la solicitud (para la feature 38). `prov. F1.4-e`
  *Testeable:* mensajero de zona GAM → destino central; de zona no-GAM → destino satélite con su zona.

- **R16** — SI el mensajero no tiene `zonaId` asignada, ENTONCES el sistema DEBE rechazar la
  solicitud con un mensaje accionable y NO DEBE crear el cierre. *Testeable:* mensajero sin
  zona → `validation_error`; no se crea fila.

- **R17** — MIENTRAS no se pulse "Solicitar cierre", el sistema NO DEBE modificar el estado
  de las órdenes ni de las gestiones (el módulo es de solo lectura hasta solicitar).
  *Testeable:* listar no cambia `orden.estatus_id` ni `gestion_orden`.

### Historial y datos

- **R18** — El sistema DEBE permitir al mensajero ver sus propias solicitudes de cierre
  pasadas con su estado (`solicitado`/`aprobado`/`rechazado`) y sus totales. `prov. F1.4-g`
  *Testeable:* tras crear un cierre, aparece en la lista de cierres del mensajero.

- **R19** — La tabla nueva de cierres DEBE tener **RLS habilitada** (sin políticas
  anon/authenticated; solo service role), patrón `gestion_orden`/`orden`. *Testeable:* la
  migración habilita RLS; test de integración de migración lo verifica.

- **R20** — La migración que crea la tabla, el enum y la FK en `gestion_orden` DEBE ser
  versionada y reversible: DEBE incluir `down.sql` y `pnpm run db:rollback` DEBE revertirla
  limpiamente. *Testeable:* round-trip up → down → up en la DB de test.

---

## Tabla de trazabilidad (R → test previsto)

| R | Prueba prevista (el implementer fija la ruta en `progress/impl_37-*.md`) |
| --- | --- |
| R1 | integración action/página: rol ≠ mensajero → notFound |
| R2 | unit service: filtra por `actor.usuarioId`; id ajeno → vacío |
| R3 | unit service: agrupa gestiones sin `cierre_id` por resultado |
| R4 | unit service: DTO por orden con campos según resultado |
| R5 | unit service (doble de `ISignedUrlProvider`): evidencia → URL firmada, no path |
| R6 | unit service: fila entregada expone monto+método |
| R7 | unit service: totales por método + general cuadran |
| R8 | unit service: set sin entregadas → totales 0.00 |
| R9 | unit service: suma de decimales exacta (Decimal) |
| R10 | unit service: orden pendiente → `conflict`, no crea |
| R11 | unit service: sin gestiones pendientes → error, no crea |
| R12 | unit service: cierre `solicitado` existente → `conflict` |
| R13 | integración repo/DB: crea cierre + vincula gestiones (`cierre_id`) |
| R14 | integración: totales snapshot == suma de gestiones |
| R15 | unit service (doble `findGamZonaId`): GAM→central; no-GAM→satélite+zona |
| R16 | unit service: mensajero sin zona → `validation_error`, no crea |
| R17 | unit service: listar no muta orden/gestión |
| R18 | integración: cierre creado aparece en lista del mensajero |
| R19 | integración migración: RLS habilitada en `cierre_dia` |
| R20 | integración migración: rollback up/down verde |
| — E2E `prov. F1.4-g` | Playwright: gestionar todas → ver totales → Solicitar cierre → aparece `solicitado` |

---

## Preguntas abiertas (F1.4 — decisiones que el humano debe cerrar)

Cada una con **recomendación** del spec_author y alternativa. NO se cierran aquí.

- **(a) Modelo del cierre.** *Recomendado:* tabla NUEVA `cierre_dia` (mensajero, estado,
  destino derivado, totales-snapshot) + FK nullable `cierre_id` en `gestion_orden`, seteada
  al solicitar. *Alternativa:* cierre derivado on-the-fly sin tabla. *Por qué tabla:* las
  features 38/40/41 necesitan persistir aprobación, bloqueos y vencidos sobre una entidad.

- **(b) Alcance del "día".** *Recomendado:* agrupar las `gestion_orden` del mensajero aún sin
  `cierre_id` (no por fecha calendario). *Alternativa:* por fecha calendario. La feature 41
  añadirá el corte de medianoche; aquí no se implementa.

- **(c) Precondición.** *Recomendado:* solo se puede solicitar cuando NO hay órdenes en
  `en_espera_aceptacion`/`en_reparto` (R10). *Confirmar* el texto del mensaje de bloqueo.

- **(d) Estado del cierre y estado previo "abierto".** *Recomendado:* enum `cierre_estado`
  con `solicitado` (creado por la 37) + `aprobado`/`rechazado` ya presentes para la 38; **sin**
  estado previo "abierto/en preparación" (el listado del día se deriva de `cierre_id IS NULL`
  y el cierre nace `solicitado`). *Alternativa:* un estado `abierto` persistido por mensajero.
  *Sub-pregunta:* ¿a lo sumo UN cierre `solicitado` por mensajero a la vez? *Recomendado: sí (R12).*

- **(e) Destino del "solicitar cierre".** *Recomendado:* derivar de `zona.esGam`
  (`findGamZonaId`) y persistir `destino_tipo` (`bodega_central`/`bodega_satelite`) +
  `destino_zona_id` en el cierre; la feature 38 filtra por rol+zona sin fijar un admin
  concreto. *Alternativa:* fijar además `destino_admin_id` (un adminSatelite puntual) — se
  descarta por defecto porque puede haber varios admins por bodega.

- **(f) Totales.** *Recomendado:* **snapshotear** los totales por método + general en el
  cierre al solicitar (dinero congelado para la aprobación de la 38) y además derivar el
  detalle de las gestiones vinculadas. *Alternativa:* derivarlos siempre on-the-fly (riesgo de
  divergencia si una gestión cambiara luego). *Money-critical.*

- **(g) E2E.** *Recomendado:* AÑADIR un E2E Playwright del flujo de cierre (checkpoint de flujo
  crítico de dinero, patrón features 33/34/36). *Alternativa:* solo unit/integración.

- **(h) Ver cierres pasados.** *Recomendado:* sí, lista de solo lectura de los cierres propios
  con estado y totales (R18). *Confirmar* si en la 37 basta con mostrar el recién creado.

- **(i) Reprogramadas/devueltas/rechazadas y dinero.** *Recomendado (confirmar):* cuentan
  como **$0** (sin `montoRecibido`), solo aportan al detalle, no a los totales (R8).
