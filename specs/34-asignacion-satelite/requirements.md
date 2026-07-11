# Feature 34 — Bodega satélite: asignación a mensajeros de su zona · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 33 (`done`), 17 (`done`), 24 (`done`) ·
branch: `feature/34-asignacion-satelite`

> Estado: `in_progress` (F2.0). **F1.4 APROBADA por el humano el 2026-07-11** — TODAS las 6
> decisiones en la opción RECOMENDADA (ver "## Decisiones F1.4 (APROBADAS)" abajo, que SUPERSEDE
> "## Preguntas abiertas para F1.4"). Los R1–R20 ya estaban redactados sobre esas recomendaciones,
> así que no hay cambios de requisito; solo se cierran las decisiones.

## Decisiones F1.4 (APROBADAS 2026-07-11)

- **(a) Servicio PARALELO `AsignacionSateliteService`** (NO generalizar `asignarDesdeBodega`): servicio
  nuevo para el adminSatelite, separado del `GuiaAsignacionService` del maestro (no toca el contrato
  probado de la 17); reusa los repos por zona.
- **(b) RENOMBRAR** `OrdenRepository.findMensajerosGam`/`findMensajeroIdsValidosGam` (+ interfaz
  `IOrdenRepository`) → `findMensajerosByZona`/`findMensajeroIdsValidosByZona` (más honesto: filtran por
  la zona pasada). Actualizar TODOS los llamadores de la feature 30 (`GuiaAsignacionService`) sin cambiar
  su comportamiento (el maestro sigue pasando la zona GAM).
- **(c) EXTENDER el módulo `recepcion-satelite`** (feature 33): la sección "Recibidas" gana la acción
  "Asignar" (o una sub-sección "Asignar"). Todo el flujo satelital del adminSatelite en un solo lugar.
- **(d) Asignación por LOTE con UN mensajero**, patrón `AsignarBodegaModal` (feature 17): seleccionar
  varias órdenes `en_bodega_satelite` y asignarlas todas a UN mensajero de su zona.
- **(e) Casos de error TIPADOS**: `estado_invalido` (orden no en `en_bodega_satelite`), `zona_ajena`
  (orden de otra zona), `mensajero_invalido` (mensajero no es de la zona del adminSatelite),
  `sin_zona` (adminSatelite sin zona), `no_encontrada`. Lote **todo-o-nada** (transaccional).
- **(f) AÑADIR E2E** (Playwright) del flujo satélite `recibida → asignar → en_espera_aceptacion`
  (escrito, ejecución diferida, patrón del repo `e2e/*.spec.ts`).

Notación EARS. Cada requisito es testeable y mapeable a un test concreto (ver "Tabla de
trazabilidad"). El "actor" se resuelve server-side vía `resolveActorFromSession` →
`{ usuarioId, rol }` (patrón features 6/15/17/30/33/36). El rol autorizado en este módulo es
**exclusivamente `adminSatelite`**, y SIEMPRE acotado a las órdenes y mensajeros de **su** zona
(`usuario.zonaId`, resuelto por `OrdenRepository.findUsuarioZonaId(usuarioId)`).

### Contexto de código real (anclas, no inventar)

- **Estados YA existentes — esta feature NO agrega ninguno.** `en_bodega_satelite` (feature 33,
  13.º valor de `ORDER_STATUS_SEED`) es el estado de ORIGEN; `en_espera_aceptacion` (feature 17)
  es el DESTINO. Las órdenes ruteadas a satélite ya tienen `num_guia` (features 30/17) → la 34
  **NO genera guía**, solo fija `mensajero_asignado_id` y transiciona el estado.
- **Mecanismo de asignación análogo (feature 17/30):** `GuiaAsignacionService.asignarDesdeBodega`
  (`IGuiaAsignacionService`) transiciona `en_bodega` → `en_espera_aceptacion` fijando
  `mensajero_asignado_id`, con guardia por estado de origen, solo rol `maestro` y zona GAM
  (`findGamZonaId` + `findMensajeroIdsValidosGam`), escribiendo con `asignarBodegaLote`. La 34
  necesita el ANÁLOGO para el `adminSatelite`: origen `en_bodega_satelite`, zona del adminSatelite
  (`findUsuarioZonaId`), mensajeros de ESA zona, rol `adminSatelite` (ver Pregunta abierta (a)).
- **Filtro de mensajeros por zona (feature 30) — ya genérico por `zonaId`:**
  `OrdenRepository.findMensajerosGam(zonaId)` y `findMensajeroIdsValidosGam(ids, zonaId)`
  (`IOrdenRepository`) reciben un `zonaId` cualquiera (el nombre dice "Gam" pero filtran por la
  zona pasada: `where: { rol: { value: "mensajero" }, zonaId }`). La 34 los reusa pasando la zona
  del adminSatelite (ver Pregunta abierta (b) sobre renombrar).
- **Zona del adminSatelite (feature 33):** `OrdenRepository.findUsuarioZonaId(usuarioId)` resuelve
  la zona server-side (NUNCA desde el cliente); `adminSatelite` con `zonaId = NULL` → módulo vacío
  + `sin_zona` (patrón `RecepcionSateliteService`, R5 de la 33).
- **Escritura guardada por estado + zona (feature 33):** `OrdenRepository.recibirEnSatelite`
  aplica el UPDATE SOLO si la orden sigue en el estado de origen y es de la zona (guardia en el
  `WHERE`, concurrencia-segura). `asignarBodegaLote` (17) NO guarda por estado/zona en el `WHERE`
  (valida antes en el service); la 34 requiere el patrón guardado de `recibirEnSatelite` (ver
  design §2 y Pregunta abierta (a)).
- **UI base (feature 33):** `app/(app)/recepcion-satelite/` — página que valida `adminSatelite`
  server-side (`notFound` si no) y pre-fetch por Server Action; `RecepcionSateliteModule` con
  secciones "Por recibir" / "Recibidas". La sección **"Recibidas"** (órdenes `en_bodega_satelite`)
  es la base sobre la que la 34 añade la acción "Asignar" (ver Pregunta abierta (c)).
- **Patrón de lote (feature 17):** `AsignarBodegaModal` asigna UN mensajero para todo el lote
  seleccionado (`asignarDesdeBodega({ ordenIds, mensajeroId })`); el modal "por orden con
  override" es `GenerarGuiaModal` (ver Pregunta abierta (d)).

---

## Autorización y alcance por zona

- **R1** — El módulo de asignación de la bodega satélite DEBE ser accesible ÚNICAMENTE por un actor
  con rol `adminSatelite`. CUANDO el actor tenga cualquier otro rol, el sistema DEBE responder de
  forma que NO exponga el módulo (`notFound` en la página, patrón feature 33; `forbidden` en el
  service). CUANDO no haya actor autenticado, el sistema DEBE responder `unauthenticated` en el
  borde ANTES de tocar el service o los datos.
- **R2** — El alcance de datos y de mensajeros de la asignación DEBE derivarse de `usuario.zonaId`
  del `adminSatelite` autenticado, resuelto server-side por `usuarioId`
  (`findUsuarioZonaId`), NUNCA de un parámetro del cliente. El `adminSatelite` NUNCA DEBE poder
  asignar órdenes de una zona distinta de la suya, ni asignarlas a mensajeros de otra zona.
- **R3** — SI el `adminSatelite` autenticado tiene `zonaId = NULL` (sin zona asignada), ENTONCES el
  sistema DEBE mostrar el módulo vacío con un aviso accionable ("no tienes una zona asignada") y
  DEBE rechazar toda asignación (`sin_zona`), SIN efectos en datos.

## Listado de órdenes asignables y de mensajeros de la zona

- **R4** — El módulo DEBE listar, como órdenes asignables, las órdenes en estado
  `en_bodega_satelite` cuyo `orden.zonaId` sea la zona del `adminSatelite` autenticado, excluyendo
  órdenes borradas (`deleted_at`). Estas son las mismas órdenes de la sección "Recibidas" de la
  feature 33, ahora con una acción de asignación disponible.
- **R5** — Para elegir el destino de la asignación, el sistema DEBE ofrecer ÚNICAMENTE mensajeros
  con rol `mensajero` cuya `zonaId` sea la zona del `adminSatelite` (filtrado server-side por la
  zona del actor). El sistema NUNCA DEBE ofrecer ni aceptar mensajeros de otra zona.
- **R6** — SI la zona del `adminSatelite` no tiene ningún mensajero asignado, ENTONCES el sistema
  DEBE mostrar un estado vacío accionable ("no hay mensajeros en tu zona") y DEBE impedir confirmar
  la asignación, SIN efectos en datos.

## Asignación de mensajero (transición `en_bodega_satelite` → `en_espera_aceptacion`)

- **R7** — CUANDO el `adminSatelite` confirma la asignación de un lote de órdenes en
  `en_bodega_satelite` de su zona a un mensajero de su zona, ENTONCES el sistema DEBE transicionar
  cada orden del lote a `en_espera_aceptacion` fijando `mensajero_asignado_id` con el mensajero
  elegido, y DEBE confirmar el resultado del lote.
- **R8** — MIENTRAS ejecuta la asignación, el sistema NO DEBE generar ni reasignar `num_guia` (las
  órdenes ya lo tienen desde el ruteo a satélite, features 30/17) y NO DEBE introducir estados de
  catálogo nuevos: usa exclusivamente `en_bodega_satelite` (origen) y `en_espera_aceptacion`
  (destino), ya existentes.
- **R9** — SI el `mensajeroId` recibido no corresponde a un usuario con rol `mensajero` de la zona
  del `adminSatelite`, ENTONCES el sistema DEBE rechazar la asignación con un motivo claro
  (`mensajero_invalido`), SIN efectos en datos (defensa en profundidad sobre R5).
- **R10** — La asignación de un lote DEBE ser todo-o-nada: SI ALGUNA orden del lote no está en
  `en_bodega_satelite`, o no es de la zona del actor, o no existe / está borrada, ENTONCES el
  sistema DEBE rechazar el lote completo con un detalle por orden (`conflict`, motivo por
  `ordenId`), SIN transicionar ninguna orden del lote.
- **R11** — SI alguna orden del lote tiene `orden.zonaId` distinto de la zona del `adminSatelite`,
  ENTONCES el sistema DEBE rechazarla con motivo `zona_ajena` (dentro del detalle de R10), SIN
  efectos en datos.
- **R12** — SI alguna orden del lote no está en `en_bodega_satelite` (estado de origen incorrecto,
  p. ej. `en_ruta_bodega_satelite` aún sin recibir, o ya `en_espera_aceptacion`), ENTONCES el
  sistema DEBE rechazarla con motivo `estado_invalido` (indicando el estado actual, dentro del
  detalle de R10), SIN efectos en datos.

## Autorización, transaccionalidad y guardias (backend)

- **R13** — El service de asignación satélite DEBE revalidar el rol `adminSatelite` (defensa en
  profundidad sobre R1) y responder `forbidden` si no coincide, ANTES de tocar datos.
- **R14** — La asignación DEBE ser una transición atómica y concurrencia-segura: el sistema DEBE
  aplicar el cambio de estado y `mensajero_asignado_id` SOLO sobre las órdenes que sigan en
  `en_bodega_satelite`, no borradas y con `orden.zonaId` igual a la zona del actor (guardia por
  estado de origen + zona en la propia escritura, patrón `recibirEnSatelite` de la feature 33);
  una asignación concurrente de la misma orden NO DEBE producir doble efecto ni sobrescribir un
  mensajero ya fijado en otra zona.
- **R15** — La mutación DEBE ejecutarse como Server Action (`lib/actions/`), NO como llamada a una
  ruta API interna (arquitectura: mutaciones internas). El borde DEBE validar la entrada con zod
  (`ordenIds`, `mensajeroId`) y resolver `unauthenticated` (R1) antes de invocar el service.

## No-regresión y verificabilidad

- **R16** — Esta feature NO DEBE modificar el flujo del maestro (features 17/30), la recepción por
  QR (feature 33) ni el módulo del mensajero (feature 36): los contratos y firmas de esos módulos
  DEBEN permanecer estables (cambios aditivos). En particular, `GuiaAsignacionService.asignarDesde-
  Bodega` (rol `maestro`, zona GAM, origen `en_bodega`) DEBE seguir funcionando sin cambios de
  comportamiento observables.
- **R17** — Tras la transición a `en_espera_aceptacion`, la orden DEBE quedar lista para ser
  consumida por el módulo del mensajero (feature 36, acción "Recoger" → `en_reparto`) de forma
  IDÉNTICA a las asignaciones de la central (decisión F1.4-j de la 36). La 34 NO DEBE tocar la 36.
- **R18** — SI se decide cubrir el flujo crítico con E2E (ver Pregunta abierta (f)), ENTONCES DEBE
  existir un test E2E (Playwright) que verifique el flujo de asignación satélite (adminSatelite
  selecciona órdenes `en_bodega_satelite` de su zona → asigna mensajero de su zona →
  `en_espera_aceptacion`), patrón del repo (escrito, ejecución diferida como
  `e2e/mis-asignaciones.spec.ts`).
- **R19** — Toda entrada externa (identificadores de orden, `mensajeroId`) DEBE validarse y tiparse
  en el borde con zod; ningún `any` DEBE cruzar la frontera; el manejo de errores DEBE devolver
  resultados tipados de dominio (`forbidden` / `sin_zona` / `mensajero_invalido` / `conflict` /
  `validation_error` / `unauthenticated`), sin filtrar internals (convenciones de errores).
- **R20** — Cada requisito (`R1`–`R19`) DEBE quedar mapeado a al menos un test concreto (tabla de
  trazabilidad; el `implementer` la completa con rutas en
  `progress/impl_34-asignacion-satelite.md`).

---

## Tabla de trazabilidad (requisito → test previsto)

| Req | Test previsto (nivel) |
| --- | --- |
| R1  | unit service/action + page: adminSatelite pasa; otro rol → forbidden/notFound; sin sesión → unauthenticated |
| R2  | unit/integration repo+service: alcance por `usuario.zonaId` server-side; no asigna órdenes ni mensajeros de otra zona |
| R3  | unit service: adminSatelite con `zonaId = NULL` → módulo vacío + `sin_zona`, sin efectos |
| R4  | integration repo+service + component: asignables = `en_bodega_satelite` de la zona, sin borradas |
| R5  | unit/integration service: solo mensajeros rol `mensajero` de la zona del actor |
| R6  | unit service + component: zona sin mensajeros → estado vacío accionable, asignar deshabilitado |
| R7  | unit service: lote `en_bodega_satelite` de la zona + mensajero de la zona → `en_espera_aceptacion` con `mensajero_asignado_id` |
| R8  | unit service: no reasigna `num_guia`; no introduce estados nuevos (solo origen/destino existentes) |
| R9  | unit service: `mensajeroId` de otra zona / no-mensajero → `mensajero_invalido`, sin efectos |
| R10 | unit service: lote con una orden inválida → `conflict` con detalle por orden; ninguna transiciona (todo-o-nada) |
| R11 | unit service: orden de otra zona en el lote → `zona_ajena` en el detalle, sin efectos |
| R12 | unit service: orden en estado != `en_bodega_satelite` → `estado_invalido` en el detalle, sin efectos |
| R13 | unit service: rol != adminSatelite → forbidden antes de tocar datos |
| R14 | integration service/repo: update guardado por estado+zona; asignación concurrente sin doble efecto |
| R15 | unit action: mutación vía Server Action; zod valida `ordenIds`/`mensajeroId`; `unauthenticated` en el borde |
| R16 | unit/type: contratos features 17/30/33/36 estables; `asignarDesdeBodega` (maestro) intacto |
| R17 | unit/type: `en_espera_aceptacion` consumible por la 36 igual que central; la 34 no toca la 36 |
| R18 | e2e (si aplica): asignación satélite → `en_espera_aceptacion` |
| R19 | unit action: entradas validadas con zod; resultados tipados; sin filtrar internals |
| R20 | revisión: todos los R con test asociado (reviewer) |

---

## Límites (fuera de alcance de esta feature)

- **Recepción por QR de la satélite → feature 33 (hecha).** Aquí se parte de `en_bodega_satelite`.
- **Módulo del mensajero ("Recoger" → `en_reparto`) → feature 36 (hecha).** No se toca.
- **Cierre / liquidación → feature 37.** No aplica.
- **Ruteo del maestro a satélite y asignación de la central → features 30/17.** No se tocan.
- **NO agrega estados nuevos ni genera `num_guia`.** Solo `en_bodega_satelite` → `en_espera_aceptacion`
  acotado a la zona del `adminSatelite`.

---

## Preguntas abiertas para F1.4 (recomendación + alternativas — el humano decide)

**(a) Estrategia de reúso del mecanismo de asignación.**
- *Recomendación:* método/servicio **paralelo** dedicado al satélite (p. ej.
  `AsignacionSateliteService.asignar(...)` en el dominio de la 33/34, o un método nuevo en el
  servicio de recepción satélite), que REUSA las primitivas de repo (`findUsuarioZonaId`,
  `findMensajeroIdsValidosGam` con la zona del adminSatelite, `findByIdsForTransicion`,
  `findEstatusIdByValue`) + una escritura NUEVA guardada por estado+zona (patrón `recibirEnSatelite`).
  Razón: `asignarDesdeBodega` está cableado a `rol=maestro`, `findGamZonaId` (zona GAM fija), origen
  `en_bodega` y una escritura NO guardada; generalizarla con parámetros de rol/zona-origen/estado/
  escritura mezclaría dos modelos de autorización en un método y arriesgaría el contrato de la 17
  (CHECKPOINTS: contratos estables). DRY se logra a nivel de **repositorio**, separación a nivel de
  **service** por rol.
- *Alternativa (descartada en design):* **generalizar** `asignarDesdeBodega` parametrizando
  estado-origen (`en_bodega` / `en_bodega_satelite`) + fuente de zona (`findGamZonaId` /
  `findUsuarioZonaId`) + rol autorizado (`maestro` / `adminSatelite`). Más DRY en el service, pero
  acopla dos autorizaciones y toca el service de la 17. ¿Paralelo (recomendado) o generalizar?

**(b) Nombres de los repos de mensajeros por zona.**
- *Recomendación:* **generalizar** `findMensajerosGam` → `findMensajerosByZona` y
  `findMensajeroIdsValidosGam` → `findMensajeroIdsValidosByZona` (más honesto: ya filtran por el
  `zonaId` pasado), actualizando los llamadores de la 17/30 (cambio pequeño y aditivo en firma
  semántica; el parámetro sigue siendo un `zonaId`). Evita el nombre engañoso "Gam" al reusarlos
  con la zona del satélite.
- *Alternativa:* **reusar con el nombre actual** (`findMensajerosGam(zonaSatelite)`): cero cambios
  en la 30, pero el nombre miente en el nuevo call-site. ¿Renombrar (recomendado) o reusar tal cual?

**(c) Dónde vive la UI.**
- *Recomendación:* **extender** el módulo `app/(app)/recepcion-satelite/` — la sección "Recibidas"
  (órdenes `en_bodega_satelite`) gana la acción "Asignar" (selección de órdenes + modal de
  mensajero), reusando la validación de rol server-side y el pre-fetch por Server Action ya
  existentes. Menos superficie, un solo módulo del adminSatelite.
- *Alternativa:* un **módulo/ruta nuevos** (p. ej. `/asignacion-satelite`): separa responsabilidades
  pero duplica shell/authz/prefetch. ¿Extender `recepcion-satelite` (recomendado) o ruta nueva?

**(d) Alcance de la asignación (granularidad).**
- *Recomendación:* **por lote con UN mensajero** para todo el lote seleccionado (patrón
  `AsignarBodegaModal` de la 17: `asignar({ ordenIds, mensajeroId })`), con feedback del resultado
  del lote. Es el análogo natural de la asignación desde bodega de la central.
- *Alternativa:* **por orden con override** (patrón `GenerarGuiaModal`: un mensajero sugerido por
  orden + override individual). Más flexible, más UI. ¿Lote único (recomendado) o por-orden con
  override?

**(e) Casos de error / guardias (comportamiento tipado, ya reflejado en R3/R6/R9–R14).**
- *Definición recomendada:* orden no en `en_bodega_satelite` → `estado_invalido` (R12); orden de
  otra zona → `zona_ajena` (R11); mensajero de otra zona / no-mensajero → `mensajero_invalido`
  (R9); adminSatelite sin zona → `sin_zona` (R3); zona sin mensajeros → estado vacío accionable +
  asignar deshabilitado (R6); orden inexistente/borrada dentro del lote → `no_encontrada`/`conflict`
  (R10). Lote todo-o-nada, sin efectos ante cualquier rechazo (R10/R14). ¿Se confirman estos
  comportamientos y nombres de motivo?

**(f) ¿E2E del flujo de asignación satélite?**
- *Contexto:* toca la transición de órdenes (flujo operativo crítico); aprendizaje de las features
  33/36 (ambas añadieron E2E escrito, ejecución diferida).
- *Recomendación:* **SÍ añadir** un E2E (Playwright) del flujo (seleccionar órdenes
  `en_bodega_satelite` de la zona → asignar mensajero de la zona → `en_espera_aceptacion`),
  escrito con ejecución diferida. ¿Se exige E2E o basta unit(service)+integration(action)?
