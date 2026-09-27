# Feature 454 — Diseño técnico

> Requisitos en `requirements.md`; censo medido en `medicion.md` (las referencias `Dn`, `Un`, `Pn`, `Nn` son
> sus filas). Líneas citadas: archivo real del 2026-09-23 (el índice del grafo está rancio en líneas).
> Aquí se deciden las preguntas técnicas 1, 3, 4 y 6 del censo; la 5 la decidió el humano (el rastreo muestra
> la pendiente al instante) y la 8 se descarta.

---

## 0. Decisiones, en una tabla

| # | Pregunta | Decisión | Por qué, en una línea |
|---|---|---|---|
| **DA** | (censo 1) ¿Se escribe una fila de historial por gestión o se cambia el predicado de intentos? | **Ninguna fila al gestionar.** La fila se escribe **al aprobar** (la transición real). La 6.ª condición de `whereIntentosVigentes` gana una **segunda vía de inclusión**: el evento `gestion_registrada`. | Una fila `en_reparto → en_reparto` la rechaza el choke point y mentiría a rastreo, analítica y webhooks. La devolución se aplica con familia `anclaje_devolucion`, que la guardia 239/R16 prohíbe meter en `ORIGEN_TIPOS_VISITA_REAL`; sin segunda vía, las `devuelta` dejarían de contar (conteo a 0 → no se llega al tope → no se cobra). |
| **DB** | (censo 3) ¿Dónde vive la ayuda si deja de ser estado? | En una tabla de eventos **append-only**, `orden_evento`. «Ayuda abierta» es una **derivación** (§4), no una marca. | Discusión explícita de la D1 de la 236 en §4.3: se respeta su principio (nada que apagar) y se revisa su letra (el discriminante deja de ser una igualdad de estado pura). |
| **DC** | (censo 4) Contrato de webhooks | Se **conserva** `orden.estado_actualizado` (ahora al aprobar) y se **añaden** `orden.gestion_registrada`, `orden.gestion_anulada`, `orden.gestion_corregida`, `orden.ayuda_solicitada`, `orden.ayuda_resuelta`. Se **retiran** del contrato `ayuda_tienda` y `devolucion_por_confirmar`. | Renombrar el evento que ya existe rompe a todos sin ganancia; renombrar códigos es la 455. Las dos mitades de la ayuda siguen visibles (268/R1: «van juntas o no van»). Nombre final: Pregunta abierta 1. |
| **DD** | (censo 6) ¿El aviso N1 sale al gestionar o al aprobar? | **Al registrar la gestión**, una vez. Se retira el disparo desde el choke point. | Es el mismo instante que hoy: cero regresión de tiempo. El humano pidió notificaciones al instante. |
| **DE** | ¿Cómo se sabe que una gestión está pendiente? | **Derivación única** (§3): evento `gestion_registrada` ∧ no anulada ∧ cierre no aprobado (∧ orden en `en_reparto` a nivel orden). | Sin columna mutable en `orden` ni en `gestion_orden`: la aprobación, el deshacer y la salida de estado la cierran por construcción. |
| **DF** | Concurrencia sin la guarda de estado que hoy da el `updateMany` | **Bloqueo de la fila de `orden` (`SELECT … FOR UPDATE`) + re-lectura en una sentencia posterior** en todos los escritores que deciden por «pendiente»/«ayuda abierta». | En READ COMMITTED una subconsulta `NOT EXISTS` dentro de un `UPDATE` no ve filas confirmadas después del inicio de la sentencia; la segunda sentencia sí (§5). |
| **DG** | D6 — ¿la 139 selecciona por cierre o por mensajero? | Por **gestión**: se excluyen las `rechazada` cuya gestión vigente más reciente está en **otro cierre no aprobado**; el mensajero queda como **guarda de propiedad**. | Seleccionar solo por cierre dejaría sin ruta de vuelta los rechazos de escritorio de la 240 (su gestión no tiene cierre nunca desde la 337) y los escalados del cron. |
| **DH** | ¿Qué pasa con lo gestionado antes del despliegue? | **Rama legada nombrada**: una gestión sin evento `gestion_registrada` se comporta exactamente como hoy (aprobar no la reaplica; deshacer y corregir usan las aristas actuales). | Un mensajero que gestionó a las 17:00 y el despliegue sale a las 17:15 tiene que poder deshacer a las 17:30. Población medible; se retira en otra ficha cuando sea cero. |
| **DI** | Enums | **Ningún valor nuevo** en `orden_historial_origen_tipo`. Enum nuevo `orden_evento_tipo`. Valor nuevo `webhook_evento` en `job_tipo` (migración propia). | Tocar el enum del historial obliga a pelear con los `down.sql` que lo recrean con lista cerrada (memoria del repo); aquí no hace falta. |

---

## 1. Modelo de datos

### 1.1 Tabla nueva `orden_evento` (append-only)

Hechos sobre una orden que **no son transiciones de estado**. Precedente directo: `orden_dia_reparto_cambio`
(262) y `orden_traspaso_mensajero` (427), que la línea de tiempo ya pinta como clases propias y que tampoco
escriben `orden_historial_estado`.

| Columna | Tipo | Nulo | Nota |
|---|---|---|---|
| `id` | `text` (uuid) PK | no | |
| `orden_id` | `text` FK → `orden.id` `RESTRICT` | no | |
| `tipo` | `orden_evento_tipo` | no | ver 1.2 |
| `gestion_orden_id` | `text` FK → `gestion_orden.id` `RESTRICT` | sí | NOT NULL para los tres `gestion_*` (CHECK) |
| `familia_aplicacion` | `orden_historial_origen_tipo` | sí | NOT NULL solo en `gestion_registrada` (CHECK); valores admitidos por CHECK: `gestion`, `incidente`, `gestion_tienda_ayuda` |
| `resultado` | `gestion_resultado` | sí | snapshot: en `gestion_registrada` el registrado; en `gestion_corregida` el nuevo |
| `resultado_anterior` | `gestion_resultado` | sí | solo `gestion_corregida` |
| `mensajero_id` | `text` FK → `usuario.id` | sí | el mensajero asignado en ese instante |
| `actor_usuario_id` | `text` FK → `usuario.id` | no | siempre hay una persona (ningún cron escribe aquí) |
| `actor_rol` | `rol_value` (el enum de roles que ya usa la 427) | no | **congelado** (427/R26) |
| `motivo` | `text` | sí | la causa tipificada o el motivo de la corrección; nunca PII |
| `created_at` | `timestamp(3)` default `now()` | no | |

Índices:
- `@@index([ordenId, createdAt])` — línea de tiempo, rastreo, «último evento de ayuda».
- `UNIQUE (gestion_orden_id) WHERE tipo = 'gestion_registrada'` — un solo registro por gestión; es además el
  índice que sirve al `EXISTS` de la 6.ª condición de intentos y del predicado de pendiente.
- `@@index([gestionOrdenId])` para anulada/corregida (consulta del evento por gestión).

RLS: `ALTER TABLE "orden_evento" ENABLE ROW LEVEL SECURITY;` **sin políticas**, patrón literal de
`20260917120000_orden_traspaso_mensajero/migration.sql:115` (la app entra por el servidor con su propia
sesión; la autorización de negocio vive en los servicios).

### 1.2 Enum nuevo `orden_evento_tipo`

`gestion_registrada`, `gestion_anulada`, `gestion_corregida`, `ayuda_solicitada`, `ayuda_rescatada`,
`ayuda_habilitada_api`.

- TS: `ORDEN_EVENTO_TIPO_SEED` en `lib/types/orden-evento.ts` con el mismo doble cierre que
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (`satisfies` + `_EnsureExhaustive`).
- Rescatar por el mensajero y habilitar por la tienda comparten tipo (`ayuda_rescatada`): el hecho es uno y
  quién lo hizo lo dice `actor_rol` (mismo argumento que 235/R8). La API tiene tipo propio porque el actor
  (usuario de la key) es indistinguible de la tienda (mismo argumento que 266/A3).

### 1.3 `job_tipo` gana `webhook_evento`

Migración **sola** (Postgres no deja usar un valor de enum en la transacción que lo añade — patrón de
`20260912120100_job_tipo_push_web`). `down.sql`: comprobar primero cómo lo hacen los `down.sql` de las
migraciones hermanas de `job_tipo`; **no se tocan** los previos (son fotos históricas) y se documenta el efecto del rollback encadenado
(memoria «Enum nuevo y los down.sql previos»).

### 1.4 Lo que NO cambia en el esquema

- `orden`, `gestion_orden`, `cierre_dia`, `orden_historial_estado`: **ni una columna**.
- `orden_historial_origen_tipo`: sin valores nuevos. Las familias `solicitud_ayuda_tienda`,
  `rescate_ayuda_tienda`, `habilitacion_api` y `anclaje_devolucion` **se quedan** (hay filas históricas);
  las tres primeras pierden su productor (comentario fechado en el SEED, patrón `creacion_manual`).
- `order_status`: los dos valores salen del SEED; la fila de catálogo se borra solo si nadie la referencia
  (en producción sobrevive huérfana, como `en_fulfillment` y `pendiente`).

### 1.5 Migraciones (escritas a mano)

> `pnpm run db:migrate:create` **no funciona** en este repo (P3006 en la shadow db). El DDL se obtiene con
> `prisma migrate diff --from-migrations db/migrations --to-schema-datamodel db/schema.prisma --script` (con la
> shadow configurada como hoy) y se pega a mano; el DML es manual.

| # | Carpeta | Contenido |
|---|---|---|
| M1 | `<ts>_job_tipo_webhook_evento` | `ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'webhook_evento';` sola. |
| M2 | `<ts+1>_orden_evento` | `CREATE TYPE orden_evento_tipo`, `CREATE TABLE orden_evento` + CHECKs + índices + RLS. `down.sql`: `DROP TABLE`, `DROP TYPE`. |
| M3 | `<ts+2>_retiro_ayuda_tienda_devolucion_por_confirmar` | Backfill + retiro condicional (§1.6). |

`<ts>` > `20260921120000` (la última de `dev` hoy); comprobar contra `origin/dev` al abrir el PR (el pre-vuelo
caduca).

### 1.6 M3 — backfill y retiro (patrón 155)

Orden de pasos del UP (idempotente: una segunda pasada afecta 0 filas):

1. **Rastro** en `orden_historial_estado`, una fila por orden viva en cada estado (incluidas las borradas
   lógicamente): `estatus_origen_id` = el estado de hoy, `estatus_destino_id` = `en_reparto`, actor `NULL`,
   familia `ajuste_estado`, motivo literal `migracion 454: retiro de ayuda_tienda` /
   `migracion 454: retiro de devolucion_por_confirmar`. Sin `gestion_orden_id`.
2. **Evento de ayuda**: por cada orden de `ayuda_tienda`, un `orden_evento` `ayuda_solicitada` con
   `actor_usuario_id`/`actor_rol` de la última fila de familia `solicitud_ayuda_tienda` de esa orden,
   `mensajero_id` = `orden.mensajero_asignado_id` y `motivo` = `migracion 454: ayuda pedida el <fecha original>`.
   `created_at = now()` — **el mismo instante** que el rastro del paso 1 (misma transacción), y por eso la
   ayuda queda abierta: la derivación exige que no haya transición **estrictamente posterior** (§4.1). Si
   alguna orden no tiene fila de solicitud (dato imposible por construcción), la migración **falla** con un
   `RAISE EXCEPTION` en vez de inventar el actor.
3. **Evento de registro**: por cada orden de `devolucion_por_confirmar`, un `gestion_registrada` para su
   gestión `devuelta` vigente más reciente (actor = `gestion.mensajero_id`, rol `mensajero`, familia `gestion`,
   `created_at = gestion.created_at`). Si no la tiene, `RAISE EXCEPTION`.
4. **Backfill** de `orden.estatus_id` a `en_reparto` (solo esa columna, sin `updated_at` a mano).
5. **Retiro condicional** de los dos valores del catálogo: `DELETE … WHERE NOT EXISTS` sobre `orden`,
   `orden_historial_estado` (origen y destino) y `cierre_sin_gestion.estatus_origen_id`. En producción es
   no-op.

Sin webhooks, notificaciones ni jobs (R42): es SQL puro y no pasa por `appendCambioEstado`.

**DOWN** (en orden inverso, y probado en `tests/integration/db`):

0. **Devolver al modelo anterior las gestiones pendientes** que existan en ese momento (si no, el código viejo
   las vería gestionables y el corte las barrería — R41): para cada orden con gestión pendiente, `estatus_id`
   = destino del modelo viejo (`devuelta` → `devolucion_por_confirmar`, el resto identidad) + fila de historial
   familia `gestion` (o `incidente` / `gestion_tienda_ayuda` según `familia_aplicacion`), actor el del evento,
   `gestion_orden_id` enlazado. Y para cada orden con ayuda abierta: `estatus_id = ayuda_tienda` + fila
   `solicitud_ayuda_tienda` con el actor del evento.
1. Repone los dos valores del catálogo si faltan (`INSERT … WHERE NOT EXISTS`).
2. Devuelve a su origen solo las órdenes marcadas por el rastro del UP **cuya última fila de historial sigue
   siendo ese rastro** (nada les pasó después).
3. Borra el rastro del UP (por su motivo literal).
4. (M2 down) `DROP TABLE orden_evento`, `DROP TYPE orden_evento_tipo`.

Pérdida declarada del DOWN: los eventos de anulación/corrección y las ayudas ya rescatadas desaparecen con la
tabla (la anulación sigue en `gestion_orden.anulada_at`, la corrección en la bitácora y en la gestión).

**Ventana de despliegue.** La migración corre en el build, antes de que el código nuevo sirva tráfico. Una
gestión `devuelta` o una ayuda registradas por el código viejo en esa ventana dejarían órdenes en los estados
retirados. Mitigación: tarea T5.4 — **re-ejecutar el backfill idempotente tras el despliegue** (vía MCP de
Supabase, memoria «DATABASE_URL de prod es sensitive») y comprobar 0 órdenes en los dos estados.

---

## 2. Transiciones (feature 140)

La legalidad es **por par** origen→destino (el `via` no participa, `order-status-transiciones.ts:26-35`).

**Bajas** (mueren con su último productor o con su estado):
`#59 en_reparto→devolucion_por_confirmar`, `#60 devolucion_por_confirmar→devuelta`,
`#61 devolucion_por_confirmar→en_reparto`, `#62 en_reparto→ayuda_tienda`, `#63 ayuda_tienda→en_reparto`,
`#64 ayuda_tienda→sin_gestionar`, `#65 ayuda_tienda→reprogramada`, `#66 ayuda_tienda→rechazada`, y las
entradas `devolucion_por_confirmar`/`ayuda_tienda` de `TRANSICIONES`.

**Alta**: `en_reparto → devuelta`, `via: "anclaje_devolucion"`, `rol: "admin (aprobar cierre)"`. Es el par de
la vieja #14, **pero no la reabre**: la #14 era la gestión del mensajero llevando a `devuelta` al instante
(cobro prematuro); esta la produce **solo** la aprobación, que es exactamente lo que la 239 pedía. El comentario
de `:213-219` se reescribe fechado.

**Metadatos que cambian** (no la legalidad): `#12/#13/#15/#44` pasan a `rol: "mensajero (aplicado al aprobar
el cierre)"`; se añaden entradas de metadato `en_reparto→reprogramada|rechazada` con `via:
"gestion_tienda_ayuda"` (mismo par que #13/#15; la guardia de inventario 140 las cuenta).

**Se conservan con productor legado** (DH): `#31/#32/#33/#53` (deshacer de gestiones legadas), `#34/#35/#36`
(defensa legada, como hoy) y `#69` (corrección de una gestión legada ya aplicada).

---

## 3. El predicado único de «gestión pendiente» (DE)

Módulo nuevo `lib/repositories/gestion-pendiente.ts`, **punto único** (patrón `whereIntentosVigentes`), con tres
formas del **mismo** predicado y una guardia que prohíbe reescribirlo en otro sitio:

```ts
// gestión pendiente de confirmar
export function whereGestionPendiente(): Prisma.GestionOrdenWhereInput {
  return {
    anuladaAt: null,
    eventos: { some: { tipo: "gestion_registrada" } },
    OR: [{ cierreId: null }, { cierre: { estado: { not: "aprobado" } } }],
  };
}
// orden con gestión pendiente (nivel orden)
export function whereOrdenConGestionPendiente(): Prisma.OrdenWhereInput {
  return { estatus: { value: "en_reparto" }, gestiones: { some: whereGestionPendiente() } };
}
// fragmento SQL crudo, para los repos que escriben con $queryRaw (corte, traspaso)
export const SQL_ORDEN_SIN_GESTION_PENDIENTE: Prisma.Sql; // NOT EXISTS (...) sobre "o"."id"
```

- **No mira `mensajero_id`** a propósito: si alguna vía desconocida moviera de mensajero una orden con gestión
  pendiente, la dirección segura es **bloquear** al nuevo (visible, arreglable) y no dejarle gestionar por
  segunda vez (dinero doble).
- `cierre.estado <> 'aprobado'` incluye `rechazado` (R13) y `vencido` (R59).
- «En mano» = `en_reparto` ∧ `NOT whereOrdenConGestionPendiente`.

Consumidores que pasan de igualdad de estado a este predicado (tabla completa en §11): guardia de
gestionabilidad y `escogerParaGestion` (U1), listado/KPI/mapa/ruta del portal (U2, P5, D11), precondición de
cierre (U3), corte (D4), traspaso (U5), corrección de día (U6), carga del mensajero (U7, U8), tablero (P9).

---

## 4. La ayuda como evento (DB)

### 4.1 La derivación

```
ayuda_abierta(o) ⇔ o.estatus = en_reparto
                 ∧ ¬ orden_con_gestion_pendiente(o)
                 ∧ e := último orden_evento de o con tipo ∈ {ayuda_solicitada, ayuda_rescatada, ayuda_habilitada_api}
                       (orden: created_at desc, id desc)
                 ∧ e.tipo = ayuda_solicitada
                 ∧ ¬∃ h ∈ orden_historial_estado(o) : h.created_at > e.created_at
```

Lo que la cierra, **sin que nadie tenga que acordarse**:

| Salida | Por qué se cierra |
|---|---|
| Recuperar / Habilitar / habilitar por API | evento de cierre explícito (es el propósito del gesto) |
| La tienda gestiona desde la ayuda (237) | nace una gestión pendiente |
| Corte nocturno | transición a `sin_gestionar` (estado ≠ `en_reparto` y fila de historial posterior) |
| Aprobación de la gestión de la tienda | transición al estado aplicado |
| Cualquier vuelta posterior a `en_reparto` (nuevo ciclo) | hay filas de historial posteriores a la solicitud |
| Traspaso, cambio de día | **no la cierran** (no escriben historial): paridad con hoy (R28) |

Módulo `lib/repositories/ayuda-abierta.ts`, punto único, con forma Prisma y fragmento SQL. El «último evento»
se resuelve con `DISTINCT ON (orden_id)` sobre `@@index([ordenId, createdAt])`.

**Concurrencia (caso límite, cubierto).** Si una transición concurrente se confirma después de la solicitud pero
su transacción empezó antes, su `created_at` puede ser anterior al de la solicitud; entonces la orden ya no está
en `en_reparto` y la primera condición la cierra. En un ciclo posterior las filas son inequívocamente
posteriores.

### 4.2 Escritores

- `SolicitudAyudaService.solicitar`: nota primero (como hoy, R3 de la 235) → `registrarAyudaSolicitada`
  (bloqueo de fila, re-lectura: en `en_reparto`, asignada al actor, sin pendiente, sin ayuda abierta) →
  liberar puntero. Se retira `transicionarAyuda`.
- `rescatarOrdenAyuda` (Recuperar y Habilitar): `registrarAyudaRescatada` guardado por `ayuda_abierta`.
- `ApiHabilitacionService` rama A: `registrarAyudaHabilitadaApi` + fila de `orden_habilitacion_api` con
  `cambioDeEstado: false`, `estadoResultante: "en_reparto"`. La respuesta HTTP gana `ayudaCerrada: true|false`
  (contrato nuevo, R24/R36). Rama B sin cambios.
- `GestionDesdeAyudaService` (237): registra una **gestión pendiente** (`familia_aplicacion =
  gestion_tienda_ayuda`, actor la persona de la tienda) guardada por `ayuda_abierta` bajo bloqueo de fila. Sin
  transición. Conserva el bloqueo por reserva (261/R29-R30).

### 4.3 La D1 de la 236, discutida

La D1 firmada dice: «cada grupo de `/novedades` es una igualdad con el estado actual; ninguna marca persistida».
Su razón, escrita en `novedad-grupo.ts:57-61`: `orden.ayuda` y `orden.gestion_aprobada` eran **booleanos
mutables al lado del estado** y **alguna salida se olvidaba de apagarlos** (fuga permanente en `/novedades`).

- **Se respeta el principio.** No hay nada que apagar: `orden_evento` es append-only y la ayuda deja de estar
  abierta por **cualquier** transición de estado (§4.1), que es exactamente la propiedad que hacía seguro al
  estado. Una salida futura desde `en_reparto` que nadie haya previsto la cierra igual, porque escribe
  historial.
- **Se revisa la letra.** El discriminante del grupo `ayuda` deja de ser una igualdad de estado y pasa a ser la
  derivación de §4.1. `ESTATUS_POR_GRUPO` se sustituye por `PREDICADO_POR_GRUPO` (`devolucion` sigue siendo
  `estatus = devuelta`; `ayuda` pasa a ser `ayuda_abierta`) y la exclusión mutua de grupos (R9 de la 236)
  sigue siendo de tipo: una orden con ayuda abierta está en `en_reparto` y nunca en `devuelta`.
- **Coste declarado.** La propiedad «el compilador obliga a decidir» (el `satisfies Record<OrderStatusValue…>`)
  se pierde para la ayuda. Se compensa con la guardia `ayuda-abierta-unica-fuente.guardia.test.ts`: ningún
  archivo fuera del módulo menciona `ayuda_solicitada` en un `where`.

---

## 5. Protocolo de concurrencia (DF)

Todo escritor que decide por «pendiente» o «ayuda abierta» sigue la misma receta dentro de su `$transaction`:

1. `SELECT "id" FROM "orden" WHERE "id" IN (…) FOR UPDATE` — bloquea las filas.
2. **Sentencia nueva** que evalúa el predicado (en READ COMMITTED ve todo lo confirmado antes de ella).
3. Escribe solo sobre lo que pasó el paso 2, repitiendo la guarda de estado en el `WHERE`.

Escritores afectados: registrar gestión (mensajero y tienda), deshacer, solicitar/rescatar/habilitar ayuda,
corte nocturno (`crearCierre` con `corteSinGestionar`), traspaso, corrección de día. La aprobación no necesita
bloqueo nuevo: su `UPDATE … WHERE estatus_id = en_reparto … RETURNING` es la guarda.

Por qué no basta un `UPDATE … WHERE NOT EXISTS(…)`: si la otra transacción solo **inserta** en `gestion_orden`
sin tocar la fila de `orden`, el `UPDATE` del corte no espera a nadie y su subconsulta, evaluada con la foto del
inicio de la sentencia, no ve la gestión recién confirmada: barrería una orden gestionada y la aprobación
posterior podría cobrarle un rechazo (D4). Con el paso 1 ambos compiten por el mismo candado.

---

## 6. Registro de la gestión (A)

`GestionOrdenRepository.crearGestionYTransicionar` se sustituye por `registrarGestionPendiente` (el nombre viejo
promete una transición que ya no hace). En una transacción:

1. Bloqueo de la fila + re-lectura (§5): `en_reparto`, `mensajero_asignado_id = mensajero`, no borrada, sin
   pendiente, sin ayuda abierta. Si falla → `null` (el servicio responde `conflict`, R4) **sin efectos**, y el
   servicio compensa las evidencias subidas (patrón 237/R25).
2. `insertarGestionConHijas` (sin cambios).
3. `orden_evento` `gestion_registrada` (`familia_aplicacion = gestion | incidente`, actor y rol).
4. Liberar el puntero 1-a-1 (como hoy).
5. Encolar `webhook_evento` del evento (outbox, misma tx) y, si el resultado es `rechazada`, emitir N1 (DD).
6. `encolarOptimizacionInmediata` (como hoy; la orden deja de ser parada por R6).

**No** hay `orden.update` ni `appendCambioEstado`. `ESTATUS_POR_RESULTADO` (`gestion-destino.ts`) pasa a ser el
mapa **de aplicación**: `devuelta → "devuelta"` (vuelve la identidad; el pre-estado desaparece) y
`ESTATUS_DEVOLUCION_POR_CONFIRMAR` se borra.

---

## 7. La aplicación al aprobar (B)

### 7.1 Dónde

`CierresAdminRepository.resolverCierre`, rama `aprobado`, orden final:

```
feeds de dinero (42 → 43 → 173 → 44 → 158)              ← sin tocar
liberación sin_gestionar / tope (109/276)                ← sin tocar
▶ APLICACIÓN DE GESTIONES (nuevo; sustituye al anclaje)  ← antes de la 139, por R10
devolución de rechazadas (139)                           ← selección ajustada (§8)
confirmación física (238)                                ← sin tocar
bitácora 362                                             ← sin tocar
```

`cierres-admin-caja-cod.test.ts` mide el orden de los feeds: el bloque nuevo va **después** de todos ellos, así
que no debe mover ninguna aserción de orden (si se pone rojo, es regresión). El test de 238 «la marca se escribe
ANTES del anclaje» cambia de sentido (el anclaje ya no está al final): se reescribe con nota fechada.

Liberación y aplicación son independientes: una orden barrida no tiene gestión vigente de este cierre (el corte
no barre órdenes con gestión pendiente, §9), y el caso 3 de `cierre-sin-gestion-tope-sql-real.test.ts` lo mide.

### 7.2 Forma

```
si aprobado:
 1. G = tx.gestionOrden.findMany({ cierreId, anuladaAt: null,
                                   eventos: some { tipo: gestion_registrada } },
                                 select { id, ordenId, resultado, mensajeroId,
                                          registro: { familiaAplicacion, actorUsuarioId } })
    → vacío: no-op sin más consultas
 2. V = findMany({ ordenId in G.ordenIds, anuladaAt: null, eventos some registrada },
                 orderBy [ordenId asc, createdAt desc])  → la más reciente por orden (R57)
 3. aplicables = G ∩ «es la más reciente de su orden»
 4. por destino d (ESTATUS_POR_RESULTADO): 
      movidas_d = $queryRaw UPDATE orden SET estatus_id = d
                   WHERE id IN (…) AND estatus_id = en_reparto AND deleted_at IS NULL
                   RETURNING id                                   ← guarda + idempotencia (R9/R12)
 5. appendCambioEstado(tx, solo movidas, con la familia y actor de R8, gestionOrdenId = g.id)
```

- `RETURNING` y no `updateMany`: el bloque de anclaje de la 239 appendeaba para **todas** las anclables si
  `count > 0`; aquí cada fila de historial corresponde a una orden realmente movida.
- El choke point emite solo, como hoy, el webhook `orden.estado_actualizado` (los cinco destinos ya están en
  `EVENTOS_PUBLICOS`) y el WhatsApp de bienvenida no aplica (familia `recoleccion`).
- **Parámetro obligatorio.** `ResolverCierreInput` rama `aprobado` gana `aplicacionGestiones: { enRepartoId;
  destinoPorResultado: Record<GestionResultado, string> }` **requerido** y pierde `anclajeDevolucion`. El
  servicio resuelve los ids antes; si falta alguno, **rechaza la aprobación entera** (fallo cerrado, 239/R9).
- Gestiones legadas (sin evento) quedan fuera por el paso 1: R14.
- Gestión corregida: su `resultado` ya es `rechazada` (sello de la 398) → se aplica `rechazada` con familia
  `gestion` y actor el mensajero (la visita la hizo él y es lo que la hace contar como intento, 398/R15). Quién
  decidió el rechazo queda en el evento `gestion_corregida` y en la bitácora `cierre_dia_gestion_corregida`.

### 7.3 Carreras

| # | Carrera | Estado |
|---|---|---|
| 1 | Dos gestiones de la misma orden en dos cierres | Paso 2-3: solo la más reciente (R57). Con R3 no pueden nacer dos pendientes; la población viva es legada. |
| 2 | Re-aprobación / doble submit | El `updateMany` del cierre está guardado por `ESTADOS_RESOLUBLES`; y el `UPDATE … estatus_id = en_reparto` no encuentra nada la segunda vez. |
| 3 | Deshacer ↔ aprobar | El deshacer exige `cierre_id IS NULL`; la aprobación solo ve gestiones con cierre. |
| 4 | Corrección ↔ aprobar | La corrección exige cierre en `ESTADOS_ABIERTOS` en su `WHERE` (sin cambio). |
| 5 | Corte ↔ registro | §5. |

---

## 8. Devolución de rechazadas (139) — DG

Hoy (`CierresAdminRepository.ts:2120-2127`) selecciona `{ mensajeroAsignadoId: cierre.mensajeroId, estatusId:
rechazada }`. Se añade **una** condición:

```
AND NOT EXISTS (la gestión `rechazada` vigente más reciente de la orden pertenece a un cierre
                distinto de este y no aprobado)
```

- Entran: las aplicadas en esta aprobación, las del tope de esta aprobación, los rechazos de escritorio (240,
  gestión sin cierre para siempre desde la 337), los escalados del cron (sin cierre o con el cierre que los
  vinculó), y cualquier legada cuyo cierre ya se aprobó.
- Sale: la `rechazada` legada de **otro cierre abierto** del mismo mensajero (el fallo mudo M7 de la 271, en
  su forma de la 139).
- `mensajeroAsignadoId` se conserva como **guarda de propiedad**, igual que hizo la 271 con la liberación.
- Por qué no «solo por cierre», que es lo que el humano pidió en su formulación literal: los rechazos de
  escritorio y los escalados no tienen (o no tienen todavía) cierre, y quedarían en `rechazada` sin nadie que
  los mueva — el paquete no volvería nunca a la tienda. La selección es **por gestión**; el mensajero ya no
  selecciona, solo prueba propiedad.

---

## 9. Corte nocturno (D4)

`CierreDiaRepository.crearCierre` (`:922-1023`):

- El bucle de **dos orígenes** (`en_reparto`, `ayuda_tienda`) pasa a **uno**: `en_reparto` en mano (con o sin
  ayuda abierta). `corteSinGestionar.ayudaEstatusId` desaparece del input.
- Pre-`SELECT … FOR UPDATE` → segunda sentencia con `whereOrdenConGestionPendiente` negado y el mismo
  `noReservadaParaDespues` → `updateMany` guardado por `estatusId = en_reparto` e `id IN (…)`.
- `cierre_sin_gestion.estatus_origen_id` = `en_reparto` para todas (Pregunta abierta 4).
- `CorteDiarioRepository.findMensajerosConPendientes` (`:59`, `:111`) usa el mismo predicado: un mensajero cuyo
  único trabajo del día está gestionado no recibe cierre `vencido` **por pendientes**, aunque sí por sus
  gestiones sin cierre, igual que hoy (`vinculadas.count`).

---

## 10. Intentos de entrega (D3) — DA

`whereIntentosVigentes` (`OrdenHistorialRepository.ts:192-218`), 6.ª condición:

```ts
// antes
historialEstados: { some: { ordenId, origenTipo: { in: [...ORIGEN_TIPOS_VISITA_REAL] } } },
// después
OR: [
  { historialEstados: { some: { ordenId, origenTipo: { in: [...ORIGEN_TIPOS_VISITA_REAL] } } } }, // legadas y aplicadas
  { eventos: { some: { tipo: "gestion_registrada" } } },                                            // gestiones de calle nuevas
],
```

- **Por qué la segunda vía y no otra cosa.** Tras la ficha, una `devuelta` nueva tiene una sola fila de
  historial y es de familia `anclaje_devolucion` (D8 exige esa familia). Meter `anclaje_devolucion` en
  `ORIGEN_TIPOS_VISITA_REAL` lo prohíbe la guardia `anclaje-vs-intentos.guardia.test.ts:182-191` (239/R16) y
  acopla dos criterios cuyos errores van en direcciones opuestas. Cambiar la familia de la aplicación de
  `devuelta` a `gestion` obligaría a tocar la lectura del ancla del cron (D8). La segunda vía no toca ninguno
  de los dos.
- **Sigue siendo lista de inclusión.** `gestion_registrada` solo lo escriben las dos vías de calle; una guardia
  nueva (`sinteticas-sin-evento-registro.guardia.test.ts`) afirma que ninguno de los productores sintéticos
  (escalado, tope, reprogramación y rechazo de escritorio, corrección) escribe ese evento.
- **Las otras cinco condiciones no se tocan** (resultado en lista, no anulada, con cierre, cierre aprobado,
  grano por cierre). Antes de la aprobación una gestión no cuenta (su cierre no está aprobado): mismo número
  que hoy en todo instante.
- `contarIntentosVigentesEnLoteCon` y los consumidores (tope 276, portal, hoja de cierres, eliminabilidad)
  heredan el cambio sin tocarse. La sonda de visita real de `LiberacionReprogramadaRepository.ts:161-165` **no**
  necesita la segunda vía: una `reprogramada` aplicada tiene fila `gestion` o `gestion_tienda_ayuda`.
- Las guardias `intentos-entrega-criterio-unico.test.ts` y `criterio-intento-entrega.test.ts` se actualizan con
  nota fechada para la forma nueva de la condición; su **intención** (un solo criterio, lista de inclusión)
  no cambia.
- Rendimiento: el `EXISTS` nuevo entra por el índice único parcial de `orden_evento(gestion_orden_id)`.

---

## 11. Superficies: qué cambia en cada consumidor del censo

| Censo | Archivo | Cambio |
|---|---|---|
| U1 | `MisAsignacionesService.ts:115,503,756-772` | «gestionable» = §3 + §4; el repo re-verifica bajo bloqueo (§6). |
| U2/P5 | `MisAsignacionesService.ts:256-323`; `OrdenRepository.findParadasEnReparto` (`:3230`); `reparto-mensajero-estados.ts:52-55` | `porGestionar` = en mano sin ayuda; `conAyuda` = ayuda abierta; las pendientes no se listan (R6). Paradas = en mano sin ayuda. |
| D11 | `GestionOrdenRepository.ts:36,120` (`sumMontoCobrarGestionadas`) | La condición `estatus ∉ {en_reparto, ayuda_tienda}` pasa a «no está en mano» (= estatus ≠ `en_reparto` **o** con gestión pendiente). Disjuntos por construcción; misma suma que hoy (R53). `contarEntregadas`: confirmar que cuenta por gestión y no por estado (T1.12). |
| U3 | `CierreDiaService.ts:68,563-568`; `CierreDiaRepository.contarOrdenesPendientesGestion` (`:739`) | `ESTADOS_PENDIENTES` se sustituye por «`por_recoger` **o** en mano» con el mismo filtro de día. |
| U4 | `CierreDiaService.ts:122-142,740-787`; `CierreDiaRepository.ts:1441-1536` | Rama nueva: anular + evento `gestion_anulada` + webhook, sin transición, bajo bloqueo. Rama legada: la de hoy. `ESTADOS_ESPERADOS.devuelta` pierde `devolucion_por_confirmar`. «Es de la tienda» se lee de `familia_aplicacion` (nuevo) o de la familia del historial (legado). |
| D10 | `CierresAdminRepository.corregirResultadoGestionEnCierre` (`:1567-1756`) | Rama nueva (orden en `en_reparto` con esta gestión pendiente): pasos 0-2, 5 y 6 de hoy + evento `gestion_corregida` + webhook; **sin** pasos 3-4. Rama legada (orden en `entregada`): la de hoy, intacta. |
| U5 | `TraspasoMensajeroService.ts:73`; `OrdenRepository` (`:4760-4804`) | `ESTADOS_TRASPASABLES = ["en_reparto"]` + «sin gestión pendiente» bajo bloqueo. Las de ayuda abierta siguen siendo traspasables (R28). |
| U6 | `CorreccionDiaRepartoService.ts:56` | Igual: su lista actual menos `ayuda_tienda` (que pasa a ser `en_reparto`) + «sin gestión pendiente». |
| U7/U8 | `GuiaAsignacionService.ts:140`; `lib/actions/ordenes-guia.ts:226`; `RepartoMananaRepository.ts:98` | Carga = en mano. |
| U9 | `exclude-por-rol.ts:33`; `OrdenesListado.tsx`; `EstatusBadge.tsx` | Fuera los dos valores; el DTO del listado gana `gestionPendiente: { resultado } | null` (R29). |
| U10 | `lib/utils/estados-bodega-satelite.ts:196` | Fuera los dos valores. |
| U11 | `novedad-grupo.ts:63-69`; `OrdenRepository.novedadWhere` | `PREDICADO_POR_GRUPO` (§4.3). |
| U12/U13 | `ventana-hilo-notas.ts:57,62`; `chat-contactos.ts` | La ventana del `adminTienda` (y el contacto del chat) pasa de `estatus ∈ {devuelta, ayuda_tienda}` a `estatus = devuelta ∨ ayuda_abierta`. La guardia `hilo-ventana-alcanzable.guardia` debe seguir verde. |
| P4 | `AvisoAgregadoRepository.ts:81,195` | Grupo `ayuda` por la derivación (R65). |
| P6 | `webhook-eventos.ts` | Fuera `ayuda_tienda` de `EVENTOS_PUBLICOS`; comentario fechado. |
| P7/P8 | `AnaliticaRollupRepository.ts:110-133`; `AnaliticaOperativaVivaRepository.ts` | Sin cambio de código. El estado al corte y el tiempo de ciclo se desplazan a la aprobación: consecuencia declarada del modelo (R62). |
| P9 | `TableroDiaRepository.ts:298-374`; `tablero-dia.ts` | Fuera los dos valores de `BUCKET_POR_ESTATUS`; el bucket `en_reparto` sin resultado ya excluye las gestionadas (`r.resultado IS NULL`): se afirma con test. |
| N1 | `lib/notificaciones/emitir.ts:204-285` | DD: `emitirOrdenRechazada` se llama desde el registro; `emisorNotificacionReal` deja de filtrar por `gestion` (sin disparador desde el choke point). |
| Rastreo | `RastreoPublicoRepository.ts:44`; `rastreo-publico.ts:75-126`; `RastreoPublicoService.ts:133-141` | §12.3. `HITO_POR_ESTATUS` pierde los dos valores y nace `HITO_POR_ESTATUS_RETIRADO` (`devolucion_por_confirmar → no_entregado`, `ayuda_tienda → en_reparto`), que `hitoDeEstatus` consulta antes del defecto (R40). |
| API | `ApiOrdenLecturaService.ts:233-242`; `OrdenRepository.ts:777-779`; `openapi-spec.ts` | `gestiones[]` gana `pendienteConfirmacion: boolean` (§12.2). |
| 425 | `CierreDiaRepository.marcarDesdeAyudaTienda` | «Desde ayuda» se lee del evento (nuevo) o del historial (legado). |
| Otros de `lib/types` | `cohorte-carga.ts`, `order-status-eliminables.ts`, `correccion-datos-cliente.ts`, `novedad.ts`, `novedad-habilitar.ts`, `gestion-desde-ayuda.ts`, `gestion-retorno.ts`, `gestion-orden.ts`, `habilitacion-api.ts` | Cada uno: quitar el valor o sustituir la igualdad por la derivación. Criterio de hecho: `grep` de los dos literales en `lib/`, `app/`, `components/` = solo comentarios fechados y el mapa de retirados. |

---

## 12. Publicación

### 12.1 Webhooks (DC)

- **Evento de estado**: sin cambios de mecanismo. `orden.estado_actualizado` se emite desde el choke point; lo
  que cambia es **cuándo** llega para los cinco resultados (al aprobar) y que ya no llega `ayuda_tienda` ni el
  `en_reparto` del rescate.
- **Eventos de orden** (nuevos): job `webhook_evento`, payload **mínimo** `{ ordenEventoId }` (sin PII, R33),
  `dedupeKey = webhook_evento:<ordenEventoId>` (un hecho = un job; no hace falta el instante porque el id ya es
  único), `maxIntentos = MAX_INTENTOS_WEBHOOK`. Se encola **en la misma tx** que el evento, solo si el dueño
  tiene suscripción activa (misma consulta que `webhook-estado-encolado.ts:119-123`).
- **Cuerpo** (lo arma el handler al entregar): `{ evento, eventoId, ocurridoAt, data }` con
  `evento ∈ { orden.gestion_registrada, orden.gestion_anulada, orden.gestion_corregida, orden.ayuda_solicitada,
  orden.ayuda_resuelta }` y `data = { numGuia, numRemision, gestionId?, resultado?, resultadoAnterior?, motivo
  (causa tipificada, nunca texto libre), mensajero (ApiMensajeroDTO), pendienteConfirmacion?, via? ("mensajero"
  | "tienda" | "api", solo en ayuda_resuelta), evidenciasUrl? }` — mismas convenciones que la 256/268/404.
- **Servicio**: `WebhookEventoOrdenService`, hermano de `WebhookEstadoService`, que **reusa** sender, firma,
  resolución de suscripción y circuito de pausa (403) importándolos; no copia ninguno.
- **Riesgo de cola**: un tipo nuevo compite en el lote de 10 del drenador (memoria «inanición por lote de 10»).
  Se mide `max(updated_at)` por tipo en el recorrido.

### 12.2 API key — detalle de orden

`gestiones[]`: las pendientes aparecen con `estadoResultante: null` (su primera transición enlazada aún no
existe) y `pendienteConfirmacion: true`; tras aprobar, `estadoResultante` = el destino aplicado y
`pendienteConfirmacion: false`. OpenAPI: el ejemplo que hoy dice `"estadoResultante": "devolucion_por_confirmar"`
(`openapi-spec.ts:1566`) se reescribe.

### 12.3 Rastreo público

`RastreoPublicoRepository` añade a su consulta la gestión pendiente vigente (si existe) con solo su
`resultado` y `created_at`. El servicio agrega al final de la lista un hito `{ hito: hitoDeEstatus(destino del
resultado), pendiente: true, fecha }` y la página lo pinta como «<etiqueta del hito> — pendiente de
confirmación». Tras la aprobación, la fila de historial produce el hito confirmado y la pendiente ya no existe.
No sale ni actor, ni motivo, ni mensajero (frontera 229; `rastreo-frontera.guardia` debe seguir verde).

### 12.4 Línea de tiempo

`OrdenHistorialEntradaDTO` gana la clase `evento_orden` (`tipo`, `resultado`, `resultadoAnterior`,
`actorNombre`, `actorRol` congelado, `createdAt`). Rompe a propósito `RANGO_POR_CLASE` y el `switch` exhaustivo
de `HistorialOrdenTimeline.tsx` (precedente 427): hay que decidir dónde cae en el empate y cómo se pinta.
Autorización por rol: la de hoy (`OrdenHistorialService`).

### 12.5 Pantallas

Ninguna pantalla nueva: son señales (chip) y listas que cambian de fuente. Si el `frontend_dev` propone una
pantalla nueva, pasa antes por `/design` (memoria del repo). Textos: sin «SLA» (memoria), y sin renombrar
estados (la 455).

---

## 13. Impacto en SF-001 (en `dev`, sale con esta ficha)

| Pieza | Impacto |
|---|---|
| Cierres de bodega satélite (431, `CierreBodegaRepository.crearCierreBodega`, `CierresBodegaAdminRepository.resolverCierreBodega`) | **Ninguno**: agrupan `cierre_dia` ya aprobados y no tocan órdenes (medición U15). Se afirma con un test de no-regresión (R61). |
| Conciliación de bodega (`20260919120100_cierre_bodega_conciliacion`) | Lee totales de cierres aprobados; el dinero no cambia (R49). Verificar en T1.22. |
| Aprobación de `cierre_dia` por el `adminSatelite` | Pasa por `resolverCierre` con alcance `bodega_satelite`: la aplicación corre igual. Test con alcance satélite. |
| UI satélite (`SateliteOrdenesListado`, `CambiarDiaRepartoSateliteModal`, `recepcion-satelite`) | Quitar los dos estados; chip de pendiente. |
| Recepción de devoluciones en satélite | Sin cambio: `devuelta` sigue llegando al aprobar, como desde la 239. |
| Release | La 454 sale **con** SF-001 y solo por orden del humano: gate completo sobre `dev` con las dos, y recorrido de todos los roles. |

---

## 14. Contraste histórico (solo lectura)

`scripts/contraste-454.sql` (consultas `SELECT` puras, ejecutables por el MCP de Supabase contra producción y
con `psql` en local) y `scripts/contraste-454.ts` (corredor local que las ejecuta y compone el informe).
Población: cierres `aprobado` desde el 2026-08-25. Cada bloque da un número de diferencias que tiene que ser
**0 o estar explicado fila a fila** en `progress/contraste_454.md`.

| Bloque | Qué compara |
|---|---|
| K1 Aplicación | Por cada gestión de calle vigente de un cierre aprobado: destino que produciría la lógica nueva (`ESTATUS_POR_RESULTADO` nuevo, más reciente por orden) vs destino real de su primera transición enlazada (con `devolucion_por_confirmar` + anclaje leídos como `devuelta`). Diferencias esperables y a explicar: anuladas, dos gestiones vivas, correcciones #69. |
| K2 Intentos | Por orden con gestiones: conteo con la 6.ª condición vieja vs la nueva, simulando que las gestiones de calle tuvieran evento de registro. Debe ser igual. |
| K3 Tope | Por cada fila de `cierre_sin_gestion` de un cierre aprobado: decisión «tope/bodega» recalculada con el conteo en el instante de esa aprobación vs lo que ocurrió (`rechazo_tope_intentos` o `liberacion_sin_gestionar`). |
| K4 Rechazos cobrados | Gestiones `rechazada` con `ingreso_bodega_rechazo > 0` en cierres aprobados, y gestiones sintéticas de tope/escalado: número y suma idénticos (el modelo no crea ni quita ninguna). |
| K5 Corte | Por cada `corte_sin_gestionar`: ¿la orden tenía una gestión de calle vigente creada antes del corte y con cierre no aprobado en ese instante? Debe ser 0 (el corte de hoy no las barre porque ya no están en `en_reparto`; el nuevo tampoco). Y a la inversa: órdenes gestionadas antes de un corte que no se barrieron — el predicado nuevo debe excluirlas todas. |
| K6 Devolución 139 | Por cada `devolucion_rechazada`: ¿la selección nueva la habría incluido? Diferencias = rechazadas de otro cierre abierto (M7). |
| K7 Liberación reprogramadas | Por cada `liberacion_reprogramada`: elegibilidad recalculada (vigente, cierre aprobado, visita real) vs ocurrida. |
| K8 Dinero | Por cierre aprobado: los feeds leen solo `gestion_orden` y `cierre_dia` (afirmado por guardia de código, `feeds-no-leen-estatus.guardia.test.ts`); se recalcula la suma de `gestion_orden` que alimenta cada feed y se compara con los movimientos emitidos. Debe ser idéntica. |

---

## 15. Alternativas descartadas

### A · Mantener un pre-estado por resultado (`entrega_por_confirmar`, …)
Generalizar la 239 con cinco pre-estados. **Descartada**: es lo contrario de lo pedido (el humano elimina
estados, no los multiplica), y cada pre-estado reabre la lista de superficies que no rompen el build
(239 §8) cinco veces. Además la orden dejaría de estar «En reparto» para la tienda, que es la lectura acordada.

### B · Una columna en `orden` («gestión pendiente» / «ayuda abierta»)
Barata de leer. **Descartada por la D1 de la 236 y por su historia**: `orden.ayuda` y `orden.gestion_aprobada`
fugaron porque una salida olvidó apagarlas. Con la derivación, la aprobación, el corte y cualquier transición
futura cierran por construcción.

### C · Meter `anclaje_devolucion` en `ORIGEN_TIPOS_VISITA_REAL`
Una línea para que las `devuelta` cuenten. **Descartada**: la guardia 239/R16 lo prohíbe con razón (fusiona el
criterio de intentos con el del ancla, cuyos errores van en direcciones opuestas) y la próxima «optimización» de
uno cambiaría al otro en silencio. La segunda vía (§10) no fusiona nada.

### D · Tabla `gestion_pendiente` con `UNIQUE(orden_id)`
Daría la exclusión «una pendiente por orden» con una restricción de base. **Descartada**: es una marca
persistida con varias salidas (aprobar, deshacer, carreras de dos gestiones) que tendrían que borrarla; es el
patrón B con otro nombre. La exclusión la da el protocolo de §5.

### E · Escribir la fila de historial al gestionar con `en_reparto → en_reparto`
Mantendría intacta la 6.ª condición. **Descartada**: el choke point la rechaza (no hay auto-aristas, nota de la
427 en `orden-historial.ts:480-481`), emitiría un `orden.estado_actualizado` falso y el rastreo pintaría un hito
repetido.

### F · Renombrar `orden.estado_actualizado` a `orden.estado_cambiado`
**Descartada aquí** (Pregunta abierta 1): rompe a todo consumidor sin aportar información; los renombres son de
la 455.

### G · Feature flag para desplegar por mitades
**Descartada**, mismo argumento que la 239 §10-D: el estado de las órdenes en vuelo depende de qué mitad estaba
activa cuando se gestionaron; apagarlo no las devuelve. Un PR, un despliegue.

---

## 16. Rojos esperados y rojos que son regresión

**Por diseño** (se actualizan con nota fechada, nunca «contra su propia fuente»):
- Catálogo congelado (`buckets-estatus.guardia`, conectividad, `rastreo-hitos-exhaustivo.guardia`,
  `rastreo-sin-estatus-crudo.guardia`, `EstatusBadgeCatalogoV2.test.tsx`): 22 → 20 valores.
- `tests/fixtures/inventario-transiciones-140.ts` y guardias de transiciones: −8 aristas, +1 alta, metadatos.
- Todo test que afirma «tras gestionar, la orden está en <resultado>» o `ayuda_tienda`: pasa a `en_reparto`
  con gestión pendiente / ayuda abierta. Son las aserciones marcadas `[INTERMEDIO]` en la Fase 0.
- `webhook-eventos.test.ts`: fuera `ayuda_tienda`.
- La guardia de 238 «la marca se escribe ANTES del anclaje».
- Las dos guardias del criterio de intento: forma nueva de la 6.ª condición (§10).

**Regresión** (se arregla el código, no el test):
- Cualquier test de la **Fase 0** que no esté marcado `[INTERMEDIO]`.
- Feeds de dinero, idempotencia de wallet, `cierres-admin-caja-cod.test.ts`.
- `anclaje-vs-intentos.guardia.test.ts` (entera).
- `hilo-ventana-alcanzable.guardia`, `orden-nota-frontera.guardia`, `rastreo-frontera.guardia`,
  `origenes-admitidos-en-cierre.guardia`, `aprobacion-escrituras-cubiertas.guardia`.

---

## 17. Riesgos

1. **La aprobación es la transacción más cargada del sistema** y gana un bloque más. Medir su duración en el
   recorrido con un cierre de 14 gestiones (techo medido en la 238).
2. **Cambio de contrato** para integradores (DC): aviso previo con audiencia medida (memoria «puerta de
   despliegue: mide la audiencia»).
3. **Retraso percibido del estado** para la tienda y la analítica: es la semántica pedida; la señal «pendiente
   de confirmación» lo hace legible.
4. **Ventana de despliegue** (§1.6): re-ejecutar el backfill.
5. **Dos ramas (nueva/legada) conviviendo**: cada consumidor que decide por «¿tiene evento de registro?» tiene
   test de las dos ramas. La población legada se mide y se extingue.
6. **Base local compartida** entre worktrees: la migración de esta ficha pone rojo el gate de otras (memoria);
   avisar antes de migrar la base local.

---

## 18. Documentación que esta ficha deja al día

- `specs/239-devolucion-espera-cierre/design.md` §1.2, §2, §3 → superadas con fecha (el pre-estado muere; el
  anclaje se generaliza).
- `specs/235-*`, `specs/236-*` (D1), `specs/237-*`, `specs/266-*`, `specs/268-*` → nota fechada de lo que la 454
  revisa.
- Comentarios de `orden-historial.ts` (familias sin productor), `order-status.ts`, `gestion-destino.ts`,
  `webhook-eventos.ts`, `novedad-grupo.ts`, `CierreDiaService.ts:55-68`: reescritos con fecha, no borrados.
- `docs/release.md` (o la nota de la release): aviso a integradores y re-ejecución del backfill.
