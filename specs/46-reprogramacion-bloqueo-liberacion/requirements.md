# Feature 46 — Reprogramación: bloqueo y liberación programada — requirements.md

> FASE 2 / detalle del flujo del mensajero (feature 36). Cuando el mensajero
> REPROGRAMA una orden (gestión `reprogramada` con fecha), la orden queda
> BLOQUEADA hasta esa fecha; al llegar la fecha se LIBERA automáticamente a la
> bodega responsable para enviarse ese día, y se AVISA de la liberación.
>
> `zone=fullstack`, `complexity=high`, un ciclo (backend_dev → frontend_dev), un PR.
> Money/operacionalmente sensible: bloqueo y liberación son server-side y verificables.
> Depende de la feature 36 (gestión: reprogramar con fecha y motivo).

## Contexto reutilizado (verificado en el código de `dev`, NO se re-crea)

- `gestion_orden.resultado = reprogramada` deja la orden en estatus `reprogramada`
  (`ORDER_STATUS_SEED`, `lib/types/order-status.ts`) vía
  `GestionOrdenRepository.crearGestionYTransicionar` (INSERT gestión + UPDATE
  `orden.estatusId` + limpia `usuario.orden_en_gestion_id`, todo en una tx). La
  fecha vive en `gestion_orden.fecha_reprogramacion` (`@db.Date`, nullable) y el
  motivo en `gestion_orden.motivo`. **La orden conserva `mensajero_asignado_id`**
  del intento previo (la gestión no lo limpia).
- Bodega responsable derivada de la zona: `IZonaRepository.findCentralZonaId()` +
  `lib/utils/bodega-responsable.ts` (`resolverDestinoCierre`). Ruteo
  `en_bodega` (central) / `en_bodega_satelite` (satélite) por `orden.zonaId`
  (features 30/33/54/55).
- Infra de cron de la feature 41: `app/api/cron/corte-diario/route.ts`
  (auth `Authorization: Bearer <CRON_SECRET>`, delega en service, sin PII en logs),
  `lib/config/cron.ts` (`loadCronConfig`), `vercel.json` (`schedule "0 6 * * *"` =
  06:00 UTC = 00:00 America/Costa_Rica, UTC-6 sin horario de verano).
- Guardas de asignación/envío existentes: `GuiaAsignacionService`
  (`generarGuia`, `asignarDesdeBodega`, `rutearABodegaSatelite`; maestro, feature 17/30),
  `AsignacionSateliteService` (`asignar`; adminSatelite, feature 34). Ambas ya validan
  el estatus de ORIGEN y devuelven `{ status: "conflict", detalle }` sin efectos.
- Flujo de envío del mensajero: `MisAsignacionesService` (`recogerAsignaciones`,
  `gestionar`); origen de "recoger" = `en_espera_aceptacion`, de "gestionar" = `en_reparto`.

## Requisitos (EARS)

### Bloqueo (mientras la orden está reprogramada y la fecha no llega)

- **R1** — MIENTRAS una orden esté en estatus `reprogramada` con
  `fecha_reprogramacion > hoy` (America/Costa_Rica), el sistema DEBE tratarla como
  **bloqueada**: no reasignable ni enviable por ningún rol.

- **R2** — CUANDO el maestro intente `generarGuia` o `asignarDesdeBodega` sobre un
  lote que incluya una orden en estatus `reprogramada`, el sistema DEBE rechazar el
  lote completo SIN efectos (todo-o-nada) devolviendo `{ status: "conflict" }` con un
  `detalle` por orden cuyo `motivo` sea el tipado de bloqueo por reprogramación
  (constante compartida, p. ej. `MSG_ORDEN_REPROGRAMADA_BLOQUEADA`).

- **R3** — CUANDO el adminSatelite intente `asignar` (feature 34) un lote que incluya
  una orden en estatus `reprogramada`, el sistema DEBE rechazar el lote SIN efectos
  devolviendo `{ status: "conflict" }` con `detalle` cuyo `motivo` sea el tipado de
  bloqueo por reprogramación.

- **R4** — MIENTRAS una orden esté en estatus `reprogramada`, el sistema DEBE impedir
  su recogida y su gestión (no es estatus de ORIGEN válido de `recogerAsignaciones`
  ni de `gestionar`), rechazando SIN efectos. (Bloqueo de "envío" inherente a la
  máquina de estados; se verifica explícitamente.)

- **R5** — El bloqueo (R1–R4) DEBE aplicarse en el servidor (servicios de dominio),
  nunca depender de que la UI oculte la acción.

### Disparador temporal (job cron de liberación)

- **R6** — CUANDO se invoque `GET /api/cron/liberar-reprogramadas` SIN el header
  `Authorization: Bearer <CRON_SECRET>` correcto (o con `CRON_SECRET` no configurado),
  el sistema DEBE responder `401` SIN ejecutar ningún efecto (ni construir el service).

- **R7** — CUANDO se invoque `GET /api/cron/liberar-reprogramadas` con el
  `CRON_SECRET` correcto, el sistema DEBE ejecutar la liberación y responder `200`
  con un resumen agregado SIN PII (conteos: órdenes liberadas, órdenes omitidas).

- **R8** — El endpoint de liberación DEBE programarse en `vercel.json` con
  `schedule "0 6 * * *"` (06:00 UTC = 00:00 America/Costa_Rica), el MISMO horario y el
  MISMO `CRON_SECRET` que el corte diario (feature 41).

- **R9** — El sistema DEBE evaluar "hoy" en la zona horaria America/Costa_Rica
  (UTC-6, sin horario de verano) al comparar `fecha_reprogramacion`.

### Selección y liberación

- **R10** — CUANDO se ejecute la liberación, el sistema DEBE seleccionar EXACTAMENTE
  las órdenes que cumplen: estatus = `reprogramada` **AND** `deleted_at IS NULL`
  **AND** la `fecha_reprogramacion` de su gestión `reprogramada` vigente (la más
  reciente) `<= hoy` (CR).

- **R11** — MIENTRAS `fecha_reprogramacion > hoy` (CR), el sistema NO DEBE liberar la
  orden (permanece bloqueada, R1).

- **R12** — CUANDO el sistema libere una orden, el sistema DEBE transicionarla a:
  `en_bodega` si `orden.zonaId` es la zona central (`findCentralZonaId()`), o
  `en_bodega_satelite` en caso contrario (bodega responsable derivada de
  `orden.zonaId`, reutilizando el ruteo de las features 30/33). *(Camino por defecto,
  sujeto a la pregunta abierta (a).)*

- **R13** — CUANDO el sistema libere una orden, el sistema DEBE, en una operación
  atómica por orden: (i) fijar el estatus destino (R12), (ii) limpiar
  `mensajero_asignado_id` (handoff limpio a la bodega, coherente con `en_bodega` de
  `generarGuia`), y (iii) registrar la marca de liberación (`liberada_reprogramada_at`)
  con el instante de la corrida.

- **R14** — SI la liberación de una orden falla, ENTONCES el sistema DEBE continuar
  con el resto (resiliencia por orden, patrón bucle de `CorteDiarioService`),
  contabilizar la omitida y NO abortar la corrida completa.

### Aviso de liberación

- **R15** — CUANDO una orden haya sido liberada hoy (CR), el sistema DEBE evidenciarla
  como "liberada hoy" en la vista de la **bodega responsable** (badge/sección
  derivada de `liberada_reprogramada_at::date = hoy` CR + estatus destino + zona),
  SIN crear una tabla de notificaciones. *(Sujeto a pregunta abierta (d).)*

- **R16** — El aviso (R15) DEBE dirigirse a la bodega responsable: el maestro para las
  órdenes de la zona central (`en_bodega`); el adminSatelite de la zona para las
  satélite (`en_bodega_satelite`). NO se avisa al mensajero previo (ya no es dueño de
  la orden tras R13).

### Idempotencia

- **R17** — CUANDO el job se re-ejecute el mismo día (o cualquier día posterior), el
  sistema NO DEBE volver a liberar una orden ya liberada NI duplicar su aviso. La
  idempotencia se DERIVA de la transición de estatus: una orden liberada ya no está
  en `reprogramada`, por lo que R10 no vuelve a seleccionarla (patrón de idempotencia
  derivada de la feature 41, sin tabla de dedupe).

### Datos, seguridad y capas

- **R18** — El sistema DEBE persistir la marca `orden.liberada_reprogramada_at`
  (`timestamptz`, nullable) mediante una migración Prisma versionada CON su `down.sql`,
  que pase el round-trip (`db:migrate` → `db:rollback`). No se crea tabla nueva (no
  aplica RLS nueva; la RLS de `orden` no cambia).

- **R19** — El job de liberación NUNCA DEBE loguear el `CRON_SECRET` ni PII; solo
  conteos agregados (patrón feature 41/R24).

- **R20** — La implementación DEBE respetar el patrón de capas: el route handler solo
  hace HTTP + auth por `CRON_SECRET` y delega; la lógica de negocio vive en un service
  testeable sin HTTP ni Prisma; las queries viven en un repository. El bloqueo (R2/R3)
  se añade dentro de los servicios de dominio existentes (17/34), no en el borde HTTP.

### Fuera de alcance (confirmado)

- **R21** — Esta feature NO modela el contador de intentos de entrega ni el historial
  de estados de la orden. El escalado a rechazo por reintentos es la feature 47 y la
  trazabilidad/historial es la feature 49. La 46 solo referencia que se harán después.

## Criterios de aceptación

- `./init.sh` termina en verde (typecheck + lint + tests).
- Cada `R1`–`R21` mapea al menos a un test concreto (ver `tasks.md`); el reviewer
  rechaza si falta alguno.
- Round-trip de la migración de `liberada_reprogramada_at` (up → down) verificado.
- Al menos un test E2E cubre el flujo crítico (reprogramar → bloqueo → cron libera →
  visible en bodega), por ser flujo operacional/recaudo-adyacente.

## Preguntas abiertas (F1.4) — requieren decisión humana en la puerta de aprobación

Cada pregunta lista la **recomendación** (camino por defecto ya redactado en los
requisitos) y una alternativa. Si el humano elige la alternativa, se ajustan los R
indicados.

- **(a) Estatus destino de la LIBERACIÓN** — afecta R12/R13.
  - *Recomendación:* volver a `en_bodega` (central) o `en_bodega_satelite` (satélite)
    según la bodega responsable derivada de `orden.zonaId` + `findCentralZonaId()`
    (reusa el ruteo 30/33), limpiando `mensajero_asignado_id` para que la bodega
    re-asigne vía el flujo 17/34. Es coherente con la semántica de `en_bodega`
    (sin mensajero) y no acopla la liberación a un mensajero que pudo cambiar de zona.
  - *Alternativa:* re-`en_espera_aceptacion` con el MISMO mensajero previo
    (`mensajero_asignado_id` intacto). Más directo para el mensajero, pero rompe el
    handoff por bodega, ignora bloqueos de cierre del mensajero (feature 41) y asume
    que sigue disponible/en zona.

- **(b) DISPARADOR temporal** — afecta R6/R7/R8.
  - *Recomendación:* endpoint cron NUEVO `/api/cron/liberar-reprogramadas`, con el
    mismo `schedule "0 6 * * *"` y el mismo `CRON_SECRET` de la 41. Separa
    responsabilidades (corte de cierres vs. liberación de órdenes), aísla fallos y
    mantiene cada job pequeño y testeable por separado.
  - *Alternativa:* plegar la liberación dentro del job `corte-diario` existente. Un
    solo cron, pero mezcla dos dominios (dinero/cierres vs. estado de órdenes), un
    fallo en uno arrastra al otro y complica el resumen/observabilidad.

- **(c) Alcance del BLOQUEO** — afecta R1–R5.
  - *Recomendación:* una orden en estatus `reprogramada` con `fecha_reprogramacion >
    hoy` (CR) NO es reasignable (guardas en `generarGuia`/`asignarDesdeBodega` del
    maestro y `asignar` del satélite) ni enviable (recoger/gestionar, inherente al
    origen). Error tipado: `conflict` con `motivo` constante compartido
    (`MSG_ORDEN_REPROGRAMADA_BLOQUEADA`). Nota: por construcción `reprogramada` ya NO
    es un origen válido de asignación; el guardia explícito lo hace visible, tipado y
    testeable (defensa en profundidad).
  - *Alternativa:* no añadir guardia explícito y confiar solo en el rechazo genérico
    "estado de origen no permitido". Menos código, pero mensaje ambiguo y sin
    constante testeable dedicada.

- **(d) Mecanismo del AVISO de liberación** — afecta R15/R16.
  - *Recomendación:* visibilidad DERIVADA (badge/sección "liberadas hoy" en la vista
    de la bodega responsable) a partir de `liberada_reprogramada_at::date = hoy` (CR).
    Sin tabla de notificaciones nueva. Destinatario: la bodega (maestro central /
    adminSatelite de la zona), no el mensajero previo.
  - *Alternativa:* registro persistente de notificación (tabla nueva con RLS + estado
    leído/no leído). Más rico (historial, marcado como leído), pero sobre-ingeniería
    para un badge derivado y añade tabla + RLS + mantenimiento.

- **(e) Idempotencia del job** — afecta R10/R17.
  - *Recomendación:* condición de selección `estatus = reprogramada AND deleted_at IS
    NULL AND fecha_reprogramacion <= hoy` (CR); lo ya liberado se marca implícitamente
    al salir del estatus `reprogramada` (una re-corrida no lo re-selecciona), más la
    marca `liberada_reprogramada_at` como auditoría/aviso. Sin tabla de dedupe
    (patrón feature 41, alternativa A3 descartada allí).
  - *Alternativa:* tabla de ejecuciones/dedupe por fecha (`liberacion_run(fecha)`).
    Innecesaria: la transición de estatus ya garantiza idempotencia; añade superficie
    y RLS.

- **(f) Contador de intentos e historial** — afecta R21.
  - *Recomendación:* CONFIRMAR fuera de alcance. La 46 no modela el contador de
    intentos (feature 47) ni el historial de estados (feature 49); solo referencia
    que se implementan después.
  - *Alternativa:* adelantar aquí un contador mínimo. Se descarta para no invadir el
    alcance de 47/49 ni introducir un modelo que esas features rediseñarían.
