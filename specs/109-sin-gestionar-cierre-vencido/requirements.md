# Feature 109 — Orden sin gestionar: cierre vencido + reasignación prioritaria · requirements.md

Zone: `fullstack` · complexity: `high` · depends_on: 41 (`done`), 111 (`done`), 49 (`done`), 101/110 (`done`), 38 (`done`) · branch: `feature/109-sin-gestionar-cierre-vencido`

> Requisitos en notación EARS. Cada `R<n>` mapea a un test concreto (ver `tasks.md`; el
> reviewer rechaza si falta trazabilidad). **Money-critical:** el snapshot de un cierre
> (`vencido`/`solicitado`/resuelto) es INMUTABLE (features 37/39/56/69); esta feature NUNCA
> recalcula ni re-snapshotea totales. **`sin_gestionar` es money-neutral:** no genera
> `gestion_orden`, ni pago al mensajero, ni cobro a la tienda.
>
> **Gate F1.4 + re-gate CERRADOS (2026-07-22). El humano cerró el modelo; NO quedan decisiones
> abiertas.** Q1/Q3/Q4/Q5/Q6/Q7 LOCKED. **Modelo FINAL del cierre (GLOBAL, todos los cierres):**
> solo `aprobado` es TERMINAL; `solicitado`, `vencido` y `rechazado` son estados ABIERTOS =
> BLOQUEANTES. Rechazar deja el cierre en `rechazado` (conserva el nombre, `motivo_rechazo` y la
> auditoría `resuelto_por/at`, como hoy) PERO `rechazado` ahora BLOQUEA al mensajero y es
> RE-SOLICITABLE (`rechazado → solicitado`, espejo EXACTO de `vencido → solicitado` de la 111). La
> liberación de `sin_gestionar` a bodega sigue SOLO al APROBAR. SIN migración del enum
> `CierreEstado` (reusa los 4 valores).

---

## Contexto verificado (símbolos reales, no supuestos)

- **Catálogo de estatus:** `order_status` es una TABLA de valores (el enum Postgres
  `order_status_value` fue eliminado en `20260714123909_reconcile_fks_drop_order_status_value`).
  Agregar un estatus = `INSERT ... WHERE NOT EXISTS` (patrón `20260715120000_..._recibido_origen`)
  + añadir el valor a `ORDER_STATUS_SEED` (`lib/types/order-status.ts`).
- **Choke point de transiciones (49):** `appendCambioEstado(tx, entradas)`
  (`lib/repositories/registrar-cambio-estado.ts`). TODA escritura de `orden.estatus_id` pasa por
  ahí en su misma tx. `origen_tipo` es un enum Postgres nativo real
  (`orden_historial_origen_tipo`, 18 valores hoy); ampliarlo = `ALTER TYPE ... ADD VALUE`
  (patrón `20260722130000_cancelacion_api_por_key`).
- **Corte diario (41):** `CorteDiarioService.ejecutarCorte` +
  `CorteDiarioRepository.findMensajerosConActividadSinCierre`. Hoy solo detecta mensajeros con
  `gestion_orden.cierre_id IS NULL` y crea `cierre_dia estado='vencido'` vinculando esas
  gestiones (`CierreDiaRepository.crearCierre`, que hace `rollback → null` si vincula 0
  gestiones). Corre por Vercel Cron en `/api/cron/corte-diario` (401 sin `CRON_SECRET`).
- **Bloqueo del mensajero (41/111):** derivado, sin flag — hoy bloqueado ⇔ tiene `cierre_dia` con
  `estado IN ('solicitado','vencido')`. Símbolos reales: `OrdenRepository.ESTADOS_CIERRE_BLOQUEANTES
  = ["solicitado","vencido"]` (`lib/repositories/OrdenRepository.ts:113`), consumido por
  `findMensajerosBloqueados` (:1740) y el SQL crudo anti-TOCTOU de asignación (:1717,
  `c."estado" IN ('solicitado','vencido')`). Bloqueo TOTAL (recibir + gestionar + recoger + escoger
  + deshacer, 111). **Modelo FINAL: el conjunto bloqueante pasa a `{solicitado,vencido,rechazado}`
  en TODOS esos sitios** (R29).
- **Resolución del cierre (38/111):** `CierresAdminRepository.resolverCierre` transiciona
  `solicitado → aprobado/rechazado` (`ESTADOS_RESOLUBLES = ["solicitado"]`; 111/R15 RETIRÓ
  `vencido`). Un `vencido` llega a `solicitado` por `CierreDiaRepository.transicionarVencidoASolicitado`
  (mensajero, vía `CierreDiaService.solicitarCierre` + Server Action `lib/actions/cierre-dia.ts`) o
  por la válvula `CierresAdminRepository.forzarSolicitudVencido` (111/R16). Al APROBAR,
  `resolverCierre` alimenta wallets. **Modelo FINAL: `rechazar` sigue dejando el cierre en
  `rechazado` (mismo `resolverCierre`, conserva `resuelto_por/at`/`motivo_rechazo`), pero ahora
  `rechazado` BLOQUEA (R29) y es RE-SOLICITABLE (`rechazado → solicitado`, R28), espejo del
  `vencido`.**
- **Enum `CierreEstado`:** ya tiene los 4 valores `solicitado/aprobado/rechazado/vencido`
  (migración de la 41). El modelo FINAL reutiliza los 4 → esta feature NO agrega ni modifica el enum
  `CierreEstado` (no toca `cierre-estado-*-migration`). `rechazado` NO queda huérfano: es alcanzable
  (rechazar) y re-solicitable (R28).
- **Invariante generalizado (extiende 111/R10):** un mensajero NUNCA tiene 2 cierres ABIERTOS a la
  vez; a lo sumo UNO en `{solicitado,vencido,rechazado}`. Todas las transiciones
  (`vencido→solicitado`, `rechazado→solicitado`, el corte crea `vencido`) son 1→1 y no crean filas
  (R30).
- **Prioridad de reasignación (101/110):** `orden.prioridad` (boolean, default `false`). Se
  enciende (`true`) al volver una orden a bodega para reasignar (SLA 99, reprogramada 46/90,
  recuperación manual 100/110) en el MISMO `updateMany` guardado por estado; se apaga al asignar
  mensajero desde bodega (17/30/34). El listado de reasignación ordena `prioridad DESC` primero.
- **Volver a bodega por zona (99/100):** `resolverDestinoCierre(orden.zonaId, centralZonaId)`
  (`lib/utils/bodega-responsable.ts`) elige `en_bodega` (central) vs `en_bodega_satelite`
  (satélite); la transición limpia `mensajero_asignado_id`/`asignado_at` y pasa por el choke point
  (`RecuperacionBodegaRepository.recuperarABodega` es el molde exacto).

---

## A) Estatus `sin_gestionar` y migraciones aditivas

**R1** — El sistema DEBE soportar `sin_gestionar` como nuevo valor del catálogo `order_status`,
con la fuente única de verdad `ORDER_STATUS_SEED` (`lib/types/order-status.ts`) alineada a la
tabla; el seed idempotente lo siembra por `value`.

**R2** — La migración que agrega `sin_gestionar` DEBE ser ADITIVA e idempotente (`INSERT ...
WHERE NOT EXISTS`) y traer su `down.sql`, que SOLO borra el valor si ninguna `orden` ni
`orden_historial_estado` lo referencia; NO DEBE alterar RLS ni columnas preexistentes (patrón
`recibido_origen`).

**R3** — El sistema DEBE agregar al enum `orden_historial_origen_tipo` los valores
`corte_sin_gestionar` (transición del corte, R6) y `liberacion_sin_gestionar` (liberación al
resolver, R18), de forma ADITIVA (`ALTER TYPE ... ADD VALUE IF NOT EXISTS`) con su `down.sql`
(recrea el enum sin los dos valores nuevos, precondición: ninguna fila los usa), y reflejarlos en
`ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (`lib/types/orden-historial.ts`).

## B) Corte diario extendido — creación de `sin_gestionar`

**R4** — CUANDO se ejecuta el corte diario (paso de día), el sistema DEBE, por cada orden que
siga en `en_reparto` (sin importar cuánto tiempo lleve), transicionarla a `sin_gestionar`.

**R5** — MIENTRAS una orden esté en `en_espera_aceptacion` (u otro estado distinto de
`en_reparto`), el corte diario NO DEBE transicionarla a `sin_gestionar` (la regla aplica
EXCLUSIVAMENTE a `en_reparto`).

**R6** — CUANDO el corte transiciona una orden `en_reparto → sin_gestionar`, el sistema DEBE
hacerlo a través de `appendCambioEstado` (choke point 49) en la misma transacción, con
`actor_usuario_id = null` (sistema/cron) y `origen_tipo = corte_sin_gestionar`.

**R7** — CUANDO un mensajero tenga al menos una orden transicionada a `sin_gestionar` por el
corte, el sistema DEBE asegurar que ese mensajero queda con un cierre `vencido` que lo bloquee
(reutilizando el bloqueo derivado de 41/111): si el corte ya le crea un `vencido` por sus
gestiones pendientes, se reutiliza ESE cierre; si no tenía gestiones pendientes, se crea igual.

**R8** — SI un mensajero solo tiene órdenes en `en_reparto` y NINGUNA `gestion_orden` pendiente
de cierre, ENTONCES el corte DEBE crear igualmente un cierre `vencido` money-neutral (totales
snapshot en `0.00`, sin `cierre_detail`, sin gestiones vinculadas) cuyo único fin es bloquear al
mensajero y retener sus órdenes `sin_gestionar` (no aplica el `rollback → null` de `crearCierre`
que hoy exige ≥1 gestión vinculada).

**R9** — SI el corte diario se ejecuta más de una vez la misma jornada, ENTONCES NO DEBE
re-transicionar órdenes ya en `sin_gestionar` (guarda por `estatus_id = en_reparto`) ni crear
cierres `vencido` duplicados (una segunda corrida no encuentra órdenes `en_reparto` ni gestiones
sin vincular para ese mensajero) — idempotencia.

**R10** — El corte extendido NO DEBE crear un segundo cierre bloqueante para un mensajero que ya
tenga un cierre ABIERTO en `solicitado`, `vencido` o `rechazado` (la exclusión del corte,
`CorteDiarioRepository`, se amplía a los 3 estados abiertos), preservando el invariante
generalizado (R30).

## C) Money-neutralidad de `sin_gestionar`

**R11** — MIENTRAS una orden esté en `sin_gestionar`, el sistema NO DEBE crear ninguna
`gestion_orden` para ella, NI generar pago al mensajero, NI cobro a la tienda; `sin_gestionar` es
money-neutral y NO cuenta como intento de entrega.

**R12** — El sistema NO DEBE contar una transición a `sin_gestionar` como intento de entrega en el
derivador de intentos (49/47, que cuenta destinos `devuelta`) ni alterar el denominador del
ranking del mensajero (76).

**R13** — CUANDO se APRUEBA un cierre `vencido` cuyas únicas órdenes son `sin_gestionar` (0
gestiones vinculadas), el sistema NO DEBE emitir ningún movimiento de wallet (caja 42, ledger
tienda 43, libro mensajero 44): el cierre money-neutral no alimenta liquidación.

## D) Congelamiento de órdenes de un cierre sin aprobar

**R14** — MIENTRAS el cierre asociado a una orden `sin_gestionar` NO esté `aprobado` (esté en
`solicitado`, `vencido` o `rechazado`), el sistema DEBE mantener esa orden CONGELADA: NO DEBE
reasignarla a ningún mensajero ni liberarla a bodega. Un rechazo NO descongela: deja el cierre en
`rechazado` (bloqueante, R27); la orden sigue congelada hasta que el cierre se APRUEBE (el
mensajero re-solicita, R28, hasta la aprobación).

**R15** — MIENTRAS una orden esté en `sin_gestionar`, el sistema NO DEBE incluirla en los listados
de reasignación de bodega (apartado `en_bodega` de `/ordenes`, apartado "Recibidas"
`en_bodega_satelite` de `/recepcion-satelite`), porque `sin_gestionar` no es un estado de bodega
(congelamiento por construcción).

## E) Liberación a bodega por zona al APROBAR el `vencido`

**R16** — CUANDO se APRUEBA (`aprobado`) el cierre de un mensajero que tiene órdenes en
`sin_gestionar`, el sistema DEBE transicionar cada una de esas órdenes a `en_bodega` o
`en_bodega_satelite` según la zona de la ORDEN (misma regla `resolverDestinoCierre` de 99/100,
Q4), limpiando `mensajero_asignado_id` y `asignado_at`, dentro de la MISMA transacción de la
aprobación. La liberación ocurre EXCLUSIVAMENTE al aprobar; un RECHAZO NO libera (R27).

**R17** — CUANDO una orden `sin_gestionar` se libera a bodega (R16), el sistema DEBE fijar
`orden.prioridad = true` en la MISMA escritura que la transición, para que se reasigne ese día de
forma prioritaria a otro mensajero o al mismo, igual que reprogramadas/devueltas (features
101/110).

**R18** — CUANDO se libera una orden `sin_gestionar` a bodega (R16), el sistema DEBE registrar la
transición a través de `appendCambioEstado` (choke point 49) con `actor_usuario_id` = el admin
que resolvió y `origen_tipo = liberacion_sin_gestionar`.

**R19** — La liberación de las órdenes `sin_gestionar` (R16) DEBE correr SOLO en la rama de
aprobación (`nuevoEstado = 'aprobado'`, `count === 1`) y ser concurrencia-segura e idempotente:
`updateMany` guardado por `estatus_id = sin_gestionar` (+ propiedad del mensajero del cierre); si
afecta 0 filas (orden ya movida / segunda corrida / carrera), NO DEBE transicionar ni tocar
`prioridad`, sin efectos parciales.

**R20** — Un cierre de mensajero SIN órdenes `sin_gestionar` (cierre normal) NO DEBE verse
afectado por la liberación (R16): al aprobarlo, el `updateMany` guardado afecta 0 filas y es un
no-op; el flujo de aprobación existente (wallets 42/43/44) queda SIN CAMBIOS.

## F) Invariantes, choke point y seguridad

**R21** — El sistema DEBE preservar el invariante GENERALIZADO (R30, extiende 111/R10): un
mensajero NUNCA DEBE presentar 2 cierres ABIERTOS (`{solicitado,vencido,rechazado}`) a la vez; el
corte no crea un `vencido` si ya existe un cierre abierto (R10) y las re-solicitudes
(`vencido→solicitado`, `rechazado→solicitado`) son 1→1 sin crear filas.

**R22** — TODAS las transiciones de estatus introducidas por esta feature (`en_reparto →
sin_gestionar`, `sin_gestionar → en_bodega`/`en_bodega_satelite`) DEBEN pasar por
`appendCambioEstado` (49) en su misma transacción; ninguna escribe `orden.estatus_id` fuera del
choke point (regla de trazabilidad 49/§3.3).

**R23** — Ninguna ruta de esta feature (corte extendido, creación del `vencido`, liberación al
resolver) DEBE recalcular ni mutar los totales snapshot de ningún cierre ya creado, cualquiera sea
su estado (money-critical, features 37/39/56/69).

**R24** — El manejo de errores del corte extendido DEBE seguir las convenciones (sin `catch`
vacíos; error relevante notificado por el canal definido) y NO DEBE registrar en logs
`CRON_SECRET` ni PII/secretos; los motivos de dominio son textos fijos i18n-ready.

## G) Reflejo en la UI

**R25** — El sistema DEBE exponer una etiqueta legible en español para `sin_gestionar` en el mapa
de presentación de estatus (`ORDER_STATUS_LABELS`/`estatusLabel`), de modo que las listas de
órdenes y la línea de tiempo del historial (49) la muestren sin `value` crudo.

**R26** — El sistema NO DEBE reordenar ni resaltar por `prioridad` en superficies ajenas a la
reasignación de la bodega dueña (110/R10): una orden `sin_gestionar` congelada no aparece en esos
listados, y solo tras liberarse (a `en_bodega`/`en_bodega_satelite` con `prioridad = true`) entra
en el resalte prioritario existente (101/R8).

## H) `rechazado` bloqueante y re-solicitable (modelo FINAL, GLOBAL)

**R27** — CUANDO el administrador RECHAZA un cierre, el sistema DEBE dejarlo en `rechazado`
(conservando el nombre, `motivo_rechazo` y la auditoría `resuelto_por`/`resuelto_at`, como hoy) y
`rechazado` DEBE ser un estado ABIERTO = BLOQUEANTE: el mensajero SIGUE bloqueado (total) y, si el
cierre tenía órdenes `sin_gestionar`, éstas NO se liberan (siguen congeladas, R14). Rechazar YA NO
desbloquea (cambia el efecto de bloqueo respecto a 38/111 de hoy).

**R28** — MIENTRAS un mensajero tenga un cierre en `rechazado`, el sistema DEBE permitirle
RE-SOLICITARLO mediante la transición `rechazado → solicitado` (espejo EXACTO de
`vencido → solicitado`, 111): money-safe (cambia ÚNICAMENTE `estado`; NO recalcula/re-snapshotea
totales ni alimenta wallets), escritura GUARDADA por estado (`WHERE mensajero_id = actor AND estado
= 'rechazado'`); si afecta 0 filas (carrera / ya resuelto) DEBE devolver `conflict` sin efectos. La
transición DEBE estar disponible tanto para el mensajero (vía `solicitarCierre`) como, para el caso
abandonado, para la válvula del admin (`forzarSolicitud`, generalizada a `{vencido,rechazado}`,
111/R16). El desbloqueo definitivo ocurre SOLO al APROBAR (que además libera `sin_gestionar`, R16).

**R29** — El sistema DEBE tratar `rechazado` como estado BLOQUEANTE en TODOS los puntos donde hoy
se usa `estado ∈ {solicitado,vencido}`: el predicado derivado (`ESTADOS_CIERRE_BLOQUEANTES` +
`findMensajerosBloqueados` + el SQL crudo anti-TOCTOU de asignación) y la EXCLUSIÓN del corte
diario (`CorteDiarioRepository`), pasando el conjunto a `{solicitado,vencido,rechazado}` sin
divergencias.

**R30** — El sistema DEBE preservar el INVARIANTE GENERALIZADO (extiende 111/R10): un mensajero
NUNCA DEBE tener 2 cierres ABIERTOS (`{solicitado,vencido,rechazado}`) simultáneamente. Se sostiene
por: el corte no crea `vencido` si ya hay un abierto (R10) y las re-solicitudes
(`vencido→solicitado`, `rechazado→solicitado`) transicionan el único cierre abierto sin crear filas
(R28).

## I) Reflejo en la UI del cierre re-solicitable

**R31** — MIENTRAS un mensajero tenga un cierre `rechazado` (o `vencido`), la vista "Cierre del
día" DEBE ofrecerle una acción diferenciada para RE-SOLICITARLO (enviar a aprobación), con
INDEPENDENCIA del gate de creación (`puedesSolicitar`), espejo del CTA del `vencido` (111/R13); y
la vista debe comunicar que un cierre `rechazado` NO es terminal (bloquea hasta re-solicitar y
aprobar), no "resuelto". En `/cierres-admin`, un `rechazado` permanece en el histórico (el admin ya
actuó) pero se rotula como BLOQUEANTE hasta que el mensajero lo re-solicite.

---

## Trazabilidad (mapa preliminar R → tipo de test)

| R | Verificación esperada | Zona |
| --- | --- | --- |
| R1 | unit/type: `ORDER_STATUS_SEED` incluye `sin_gestionar`; seed idempotente | B |
| R2 | integración: migración up/down round-trip; RLS/columnas intactas; down guardado | B |
| R3 | integración: `ALTER TYPE ADD VALUE` de los 2 orígenes; down recrea enum; `SEED` alineado | B |
| R4 | unit/integración: corte transiciona `en_reparto → sin_gestionar` | B |
| R5 | unit: `en_espera_aceptacion` NO se transiciona | B |
| R6 | unit: transición vía `appendCambioEstado`, actor null, `origen_tipo = corte_sin_gestionar` | B |
| R7 | unit: mensajero con `sin_gestionar` queda con un `vencido` (reusa o crea) | B |
| R8 | unit/integración: 0 gestiones + `en_reparto` → crea `vencido` money-neutral (no `null`) | B |
| R9 | integración: segunda corrida no re-transiciona ni duplica vencidos (idempotencia) | B |
| R10 | unit: no crea 2.º cierre si ya hay `vencido`/`solicitado` | B |
| R11 | unit/integración: `sin_gestionar` sin `gestion_orden`/pago/cobro | B |
| R12 | unit: `contarIntentos` no cuenta `sin_gestionar` (destino ≠ `devuelta`) | B |
| R13 | integración: aprobar `vencido` money-neutral → 0 movimientos de wallet | B |
| R14 | unit/integración: orden `sin_gestionar` congelada hasta APROBAR (rechazo no la libera) | B |
| R15 | unit/componente: `sin_gestionar` ausente de los listados de reasignación | B/F |
| R16 | integración: APROBAR → `sin_gestionar → en_bodega`/`en_bodega_satelite` por zona, sin mensajero, misma tx | B |
| R17 | unit/integración: liberación fija `prioridad = true` en la misma escritura | B |
| R18 | unit: liberación vía `appendCambioEstado`, actor=admin, `origen_tipo = liberacion_sin_gestionar` | B |
| R19 | unit: liberación SOLO en rama `aprobado`; `updateMany` guardado por `estatus_id = sin_gestionar`; count 0 → no-op | B |
| R20 | integración: cierre normal aprobado → liberación no-op; wallets sin cambios | B |
| R21 | integración: ninguna secuencia deja `vencido` + `solicitado` coexistir | B |
| R22 | unit/cobertura: las 2 transiciones pasan por el choke point (append en la misma tx) | B |
| R23 | unit/integración money: snapshots inmutables ante todas las rutas de 109 | B |
| R24 | integración: error del corte no filtra secreto; motivos sin PII | B |
| R25 | componente: `estatusLabel('sin_gestionar')` legible; timeline sin `value` crudo | F |
| R26 | componente: `sin_gestionar` no resalta/reordena fuera de la reasignación de bodega | F |
| R27 | integración: rechazar → `rechazado` (con `resuelto_por/at`/`motivo`); mensajero SIGUE bloqueado; `sin_gestionar` NO liberadas | B |
| R28 | integración: `rechazado → solicitado` (mensajero y válvula) money-safe, guardado (count 0 → conflict); solo cambia `estado` | B |
| R29 | unit: `ESTADOS_CIERRE_BLOQUEANTES` + SQL anti-TOCTOU + exclusión del corte = `{solicitado,vencido,rechazado}` | B |
| R30 | integración: ninguna secuencia deja 2 cierres abiertos coexistir (invariante generalizado) | B |
| R31 | componente: CTA re-solicitar en `rechazado`/`vencido`; `/cierres-admin` rotula `rechazado` como bloqueante | F |

---

## Decisiones del gate F1.4 + re-gate — CERRADAS (2026-07-22). NO quedan decisiones abiertas.

> El humano cerró el MODELO completo. Todas las Q quedaron LOCKED. El modelo final del cierre es
> GLOBAL (todos los cierres): solo `aprobado` es terminal; `solicitado/vencido/rechazado` son
> abiertos=bloqueantes; rechazar deja `rechazado` (bloquea + re-solicitable). Ninguna decisión
> abierta pendiente.

- **Q1 = LOCKED.** Asociación orden↔cierre por `mensajero_asignado_id`. SIN columna nueva.
- **Q2 = CERRADA (modelo final).** La liberación de `sin_gestionar` (`prioridad=true`, por zona)
  ocurre SOLO al APROBAR (R16/R19). Al RECHAZAR, el cierre queda en `rechazado` — que ahora BLOQUEA
  y es RE-SOLICITABLE (`rechazado → solicitado`, R27/R28) — y las `sin_gestionar` NO se liberan
  (siguen congeladas, R14); el mensajero re-solicita hasta que el admin APRUEBE. (Reemplaza la
  variante intermedia "reabrir a `vencido`": ahora `rechazado` conserva su nombre y auditoría.)
- **Q3 = LOCKED.** Extender `CierreDiaRepository.crearCierre` (gated por input opcional; 37 sin
  afectar) + mover la transición `en_reparto → sin_gestionar` a la misma tx.
- **Q4 = LOCKED.** Destino de bodega por zona de la ORDEN (`resolverDestinoCierre(orden.zonaId,…)`).
- **Q5 = LOCKED.** Nombres `corte_sin_gestionar` / `liberacion_sin_gestionar`; 1 migración con 2
  `ADD VALUE IF NOT EXISTS`.
- **Q6 = LOCKED.** Un único barrido de `en_reparto` por mensajero, unificado con la detección de
  gestiones pendientes.
- **Q7 = LOCKED.** Reusar el render existente de `/cierres-admin` (sin pantalla nueva); rotular
  `rechazado` como bloqueante (R31).
- **Q8 (alcance de la re-apertura) = CERRADA como GLOBAL.** El modelo aplica a TODOS los cierres
  (no scoped): `rechazado` bloquea y es re-solicitable siempre. `rechazado` NO queda huérfano
  porque es alcanzable y re-solicitable.

## Preguntas abiertas (menores, fuera de F1.4)

- **P1 — Notificación de negocio.** ¿El corte debe notificar al mensajero/bodega que sus órdenes
  pasaron a `sin_gestionar`? La 41 dejó la notificación de negocio del `vencido` fuera de alcance;
  se mantiene el mismo criterio (follow-up).
- **P2 — Mensajero sin zona al liberar.** Si al resolver la orden `sin_gestionar` no puede derivar
  bodega (zona nula), _recomendación:_ omitir esa orden con log de aviso (mismo criterio que la 41
  P2), sin bloquear la resolución del cierre.
