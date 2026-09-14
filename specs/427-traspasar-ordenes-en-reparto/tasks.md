# 427 — Traspasar a otro mensajero lo que ya lleva encima · Tareas

> **Zona:** `fullstack`. Rama: `feat/427-traspasar-ordenes-en-reparto`.
> Se secuencia **backend → frontend** (tandas 1-6 y luego 7). No se solapan.
>
> **No queda ninguna pregunta abierta.** Las seis decisiones (D1-D6) están cerradas por el humano el
> 2026-09-14 y escritas en `requirements.md`. Lo que fijan para este plan:
> `adminSatelite` **fuera** (D1) · ranking **intacto y aceptado** (D2) · **avisos a los dos**
> mensajeros, dentro de esta ficha (D3) · `ayuda_tienda` **dentro** (D4) · límite de 50 **aceptado**
> (D5) · **una sola** fuente de rastro (D6).
>
> ⚠️ **El gate rápido se niega solo, y está bien que lo haga.** El diff toca `db/migrations/**`,
> `db/schema.prisma` y `lib/types/**`, que son cimientos: **`./init.sh` completo es obligatorio**
> antes de abrir el PR. No se intenta `--rapido` «a ver si pasa».
>
> ⚠️ **`DATABASE_URL` resoluble es obligatorio.** T3, T5 y T10 son el corazón de esta ficha y viven
> en `tests/integration/db/**`: sin base se **saltan** y el gate sale verde sin haber medido nada.
> Mira los `skipped`, no sólo el `INIT_EXIT`.
>
> ⚠️ **Base local compartida:** esta ficha aplica **dos** migraciones. Si otro agente corre su gate
> contra la misma base, se pisan. Coordinar antes de `prisma migrate dev`.

---

## Tanda 1 — Los datos

### T1 · El modelo `OrdenTraspasoMensajero`
**Depende de:** nada. **Archivos:** `db/schema.prisma`.
**Qué:** el bloque de design §4.1 tal cual, con su docstring entero (por qué tabla propia, por qué
no `historial_accion`, por qué no `orden_historial_estado`), los cinco `@@index` y los lados
inversos en `Orden` y `Usuario`.
**Hecho cuando:** `pnpm exec prisma format` y `pnpm run typecheck` verdes, y
`prisma migrate diff --from-config-datasource` no propone nada más que la tabla nueva.

### T2 · La migración de la tabla, con `down.sql`
**Depende de:** T1. **Archivos:** `db/migrations/20260917120000_orden_traspaso_mensajero/`.
**Qué:** design §4.2 — tabla, 4 FK `RESTRICT/CASCADE`, 5 índices, CHECK
`mensajero_nuevo_id <> mensajero_anterior_id`, `ENABLE ROW LEVEL SECURITY`; `down.sql` con el
`DROP TABLE`. **No se toca ningún `down.sql` anterior**: esta migración no crea ningún tipo.
**Hecho cuando:** `pnpm run db:migrate` aplica limpio, `pnpm run db:rollback` la revierte y
`prisma migrate status` no reporta drift.

### T3 · Contra Postgres: la forma de la tabla es la que dice el diseño
**Depende de:** T2. **Archivos:** `tests/integration/db/orden-traspaso-migration.test.ts`.
**Qué:** dentro de transacción revertida: (a) columnas y `NOT NULL`; (b) el CHECK **rechaza** origen
== destino (R7); (c) las cuatro FK son `RESTRICT` — borrar el usuario del mensajero anterior
**falla**; (d) `relrowsecurity` es `true`; (e) los cinco índices existen por nombre; (f) la tabla
**no** tiene `updated_at` ni `deleted_at` (R30).
⚠️ **Prohibido** el `if (!fks) return;`: sin datos para sembrar, el caso **falla**, no se salta.
**Hecho cuando:** pasa con base, y (b) y (c) fallan con el error esperado, no con cualquiera.

### T4 · La migración de los enums de avisos, con su `down.sql`
**Depende de:** nada (carpeta y timestamp propios). **Archivos:**
`db/migrations/20260917120100_notificacion_evento_traspaso/`, `db/schema.prisma` (los tres valores
de enum, con su comentario).
**Qué:** design §4.3. `ADD VALUE IF NOT EXISTS` de `traspaso_ordenes_recibido`,
`traspaso_ordenes_cedido` y `orden_traspaso_lote`. El `down.sql` **recrea los dos tipos** y retipa
**TRES** columnas: `notificacion.evento`, `notificacion.entidad_tipo` y **`push_envio_dia.evento`**.
Las dos listas se escriben **leyendo `db/schema.prisma` del árbol**, no de memoria (hoy 15 eventos y
13 entidades — **cuéntalos**). **No se toca ningún `down.sql` anterior.**
**Hecho cuando:** `db:migrate` y `db:rollback` pasan los dos; la lista del `down` coincide
exactamente con el enum de `dev` **el día en que se escribe**; y queda anotado en `progress/` que
hay que **re-leerla justo antes de abrir el PR** (el pre-vuelo caduca).

### T5 · Contra Postgres: el rollback del enum no destruye la clave de dedupe
**Depende de:** T4. **Archivos:**
`tests/integration/db/notificacion-evento-traspaso-migration.test.ts`.
**Qué:** patrón literal del test gemelo de la 413: tras recrear los tipos, siguen existiendo
`notificacion_dedupe_key` **con su `NULLS NOT DISTINCT` y su `WHERE` parcial**,
`notificacion_entidad_idx` y `push_envio_dia_cupo`. Y la precondición ruidosa: con una fila que use
un valor nuevo, el `down` **aborta** (no borra nada para hacer sitio).
**Hecho cuando:** pasa con base y el caso de la precondición falla **ruidosamente**.

---

## Tanda 2 — La escritura

### T6 · Choke point del rastro **[P]**
**Depende de:** T1. **Archivos:** `lib/repositories/registrar-traspaso-mensajero.ts` (nuevo).
**Qué:** `registrarTraspasoMensajero(tx, filas)` — `tx` como **primer** parámetro (la atomicidad es
del tipo, no de la disciplina), una fila por orden con el `loteId` común, y escrito «este es el único
sitio del árbol que inserta en `orden_traspaso_mensajero`» (patrón `registrar-cambio-dia-reparto.ts`).
**Hecho cuando:** typecheck verde y el tipo del primer parámetro **no** admite un `PrismaClient`
suelto capaz de abrir su propia transacción.

### T7 · Choke point del chat **[P]**
**Depende de:** T1. **Archivos:** `lib/repositories/traspasar-conversaciones.ts` (nuevo).
**Qué:** `traspasarConversaciones(tx, ordenIds, mensajeroDestinoId): Promise<number>` con el
`UPDATE` de design §6.3 — **todas** las conversaciones de esas órdenes, `mensajero_leido_at = NULL`,
sin tocar `ultimo_entrante_at`, sin tocar `orden` ni `telefono_e164`. Devuelve cuántas movió.
**Hecho cuando:** typecheck verde y un unitario afirma que el `WHERE` va por `orden_id IN` y que el
`SET` **no** incluye `ultimo_entrante_at`.

### T8 · `OrdenRepository.traspasarMensajeroLote`
**Depende de:** T6, T7. **Archivos:** `lib/repositories/OrdenRepository.ts`,
`lib/interfaces/repositories/IOrdenRepository.ts`.
**Qué:** la transacción de design §6: pre-lectura `FOR UPDATE … ORDER BY "id"`, un `UPDATE` guardado
por orden (con `fecha_reparto` reescrita **con su propio valor** como parámetro `YYYY-MM-DD`),
`throw` si alguna toca 0 filas, chat, rastro y los **dos** encolados de reoptimización. Devuelve lo
que los avisos necesitan (`loteId`, cuántas órdenes, cuántas conversaciones). Error tipado propio
para la carrera.
**Hecho cuando:** typecheck verde; el `SET` **no** contiene `NOW()::date`, `CURRENT_DATE`,
`AT TIME ZONE` ni `interval`; y `pnpm exec vitest run guard` sigue verde en
`fecha-reparto-acompana-asignado-at` (el censo la ve y la da por buena).

### T9 · Contra Postgres: **el caso real de 31 órdenes, medido**
**Depende de:** T8. **Archivos:** `tests/integration/db/traspaso-mensajero.int.test.ts`.
**Qué:** el test que sostiene la ficha entera. Sembrar dos mensajeros, un lote `en_reparto` con hilo
de chat, otras `entregada` con su `gestion_orden`, y ejecutar el traspaso. Afirmar:
1. las órdenes quedan con `mensajero_asignado_id = destino` (R15) y `asignado_at` **posterior** al
   de antes (R17);
2. `estatus_id`, `fecha_reparto`, `num_guia` y `prioridad` **idénticos** (R16);
3. `chat_conversacion.mensajero_id` = destino en **todas** las conversaciones de esas órdenes, con
   `mensajero_leido_at IS NULL` (R18/R19) y `ultimo_entrante_at` intacto;
4. las gestiones ya registradas por el origen siguen con `mensajero_id = origen`, con su `cierre_id`
   e importes sin cambios (R20);
5. **cero** filas nuevas en `orden_historial_estado` para esas órdenes (R21);
6. `orden_mensajero_meta` intacta (R22);
7. una fila de `orden_traspaso_mensajero` por orden, con origen, destino, actor, **rol congelado**,
   motivo e instante, y **un solo** `lote_id` (R25/R27);
8. cambiar el rol vivo del actor después y releer ⇒ la fila sigue diciendo el rol de entonces (R26);
9. dos filas en `jobs` de tipo `optimizacion_ruta`, una por mensajero (R32);
10. **todo-o-nada**: con una orden `entregada`, de otro mensajero o borrada ⇒ no se mueve ninguna,
    ni conversación, ni rastro, ni jobs (R5/R23/R24/R31);
11. **la carrera**: cambiar el estatus entre la pre-lectura y el `UPDATE` ⇒ el lote revierte entero
    (R24).
⚠️ Nada de dobles aquí: **el `WHERE` se prueba donde vive**. Un test de servicio con dobles pasa en
verde con el `WHERE` mutado — medido cuatro veces en este repo.
**Hecho cuando:** los once puntos pasan con base, y 10 y 11 fallan **por el motivo esperado**.

---

## Tanda 3 — Los avisos (D3)

### T10 · Los dos emisores, con sus textos
**Depende de:** T4. **Archivos:** `lib/notificaciones/emitir.ts`.
**Qué:** `emitirTraspasoRecibido` y `emitirTraspasoCedido` según design §6.5: `tipo: "box"`,
destinatario **usuario**, `entidadTipo: "orden_traspaso_lote"`, **`entidadId = loteId`**, anexo =
nombre del otro mensajero. Textos con singular y plural explícitos («Hay 1 órdenes» es el texto roto
que ninguna suite ve y un humano lee todos los días) y **sin** el motivo ni ningún dato del
destinatario (R40). Los textos viven **sólo** en este archivo (regla 146 §4.6).
**Hecho cuando:** typecheck verde y `grep` de esas frases fuera de `emitir.ts` da cero.

### T11 · El perfil de push de los dos eventos
**Depende de:** T4. **Archivos:** `lib/notificaciones/push-elegibles.ts`.
**Qué:** `traspaso_ordenes_recibido: { push: "si", roles: ["mensajero"] }` y
`traspaso_ordenes_cedido: { push: "no", porQué: … }`, cada uno con su razón escrita según el criterio
del catálogo (plazo + consecuencia real). El `satisfies Record<NotificacionEvento, PerfilPush>` no
compila hasta que los dos estén.
**Hecho cuando:** typecheck verde y un test afirma `esElegiblePush("traspaso_ordenes_recibido",
"mensajero") === true` y `esElegiblePush("traspaso_ordenes_cedido", "mensajero") === false` (R43).

### T12 · Los notificadores reales **[P]**
**Depende de:** T10. **Archivos:** `lib/notificaciones/notificadores.ts`.
**Qué:** las dos firmas, los dos `notificar*Real` (envueltos en `emitirBestEffort`) y los dos no-op
por defecto. Nada depende de `process.env`.
**Hecho cuando:** typecheck verde y `notificacion-notificadores-reales.test.ts` gana sus dos casos:
el real **emite** con un repositorio doble.

### T13 · Tests de los emisores
**Depende de:** T10, T12. **Archivos:** `tests/unit/notificaciones/emitir-traspaso.test.ts`.
**Qué:** **un** aviso por acto y por mensajero, con el número dentro y el nombre del otro en el
anexo (R38/R39); el texto **no** contiene el motivo ni datos del destinatario (R40); dos actos
distintos con el mismo par de mensajeros ⇒ **dos** entidades ⇒ **dos** avisos (R42); el mismo acto
emitido dos veces ⇒ uno solo; singular y plural.
**Hecho cuando:** pasan, y el caso de R42 afirma sobre el `entidadId` (que es el `loteId`), no sobre
el número de llamadas.

---

## Tanda 4 — Las reglas

### T14 · Mensajes y constantes **[P]**
**Depende de:** nada. **Archivos:** `lib/services/mensajes-traspaso.ts` (nuevo).
**Qué:** los tres motivos nuevos (estado no traspasable con el nombre del estado, orden de otro
mensajero, carrera). Los tres existentes (`sin vehículo`, `no asignable`, `bloqueado por cierres`)
**se importan** de `mensajes-bloqueo.ts`, no se copian.
**Hecho cuando:** `grep` de esos tres literales existentes fuera de `mensajes-bloqueo.ts` da cero.

### T15 · `TraspasoMensajeroService`
**Depende de:** T8, T12, T14. **Archivos:**
`lib/interfaces/services/ITraspasoMensajeroService.ts`, `lib/services/TraspasoMensajeroService.ts`.
**Qué:** rol → lote vacío → pre-carga → **origen único derivado** → estados traspasables → guardas
del destino en el orden de design §8 → `loteId` → repo → **avisos fuera de la transacción, en
`try/catch`, sin cambiar el desenlace** (design §6.5). Con las **dos ausencias escritas** (tope de
intentos y gate de coordenadas). Los notificadores entran por constructor con **default no-op**.
**Hecho cuando:** typecheck verde y el servicio no importa nada de `@prisma/client` salvo tipos.

### T16 · Tests del servicio, con dobles
**Depende de:** T15. **Archivos:** `tests/unit/services/traspaso-mensajero-service.test.ts`.
**Qué:** `maestro` y `admin` pasan (R1); `mensajero`, `adminTienda`, `adminSatelite` → `forbidden`
**sin llamar a ningún repo** (R2, y D1 para el satélite); estado no traspasable → `conflict` con el
nombre del estado y **sin escritura** (R5); dos orígenes → `conflict` (R6); destino == origen →
rechazo (R7); destino sin rol/zona, sin vehículo, no asignable, bloqueado por cierres, con
recolección pendiente → cada uno con su motivo y sin escritura (R9-R11/R13); **origen** bloqueado
por cierres → **pasa** (R12); orden con tope agotado y orden sin coordenadas → **pasan** (R14); el
`detalle` lleva una entrada por orden (R24); **los dos notificadores se llaman una vez cada uno tras
un traspaso correcto** (R38/R39); **un notificador que lanza NO cambia el `ok`** (R41).
**Hecho cuando:** todos pasan, la tabla de `forbidden` afirma `not.toHaveBeenCalled()` sobre los
repos, y el caso de R41 afirma `status: "ok"` con el notificador reventando.

### T17 · El censo de «lo que lleva encima el mensajero» gana su noveno miembro
**Depende de:** T15. **Archivos:** `tests/unit/guards/carga-del-mensajero.guardia.test.ts`.
**Qué:** declarar `ESTADOS_TRASPASABLES` en `FAMILIA` con `pregunta: "que ocupa al mensajero"`,
`incluyeAyuda: true` y la razón escrita (D4 + 235/R1). Subir `toHaveLength(8)` a **9** y actualizar
el comentario con la fecha y el motivo, sin tachar la historia previa.
**Hecho cuando:** la guardia pasa, y **se comprueba a mano** que quitando `ayuda_tienda` de la
constante del servicio la guardia se pone **roja**.

---

## Tanda 5 — El borde

### T18 · Server Action `traspasarMensajero`, con los notificadores **inyectados**
**Depende de:** T15. **Archivos:** `lib/actions/traspasar-mensajero.ts`.
**Qué:** `'use server'` + `withErrorHandler` + `resolveActorFromSession` + el zod de design §7.1 +
fábrica del servicio **pasando los dos notificadores reales**. Patrón literal de
`lib/actions/deshacer-asignacion.ts`. Sin PII en logs.
**Hecho cuando:** typecheck verde, `unauthenticated`/`validation_error` se resuelven **antes** de
construir el servicio, y un test del composition root afirma que el servicio recibe los notificadores
**reales** — que alguien los **pase**, no sólo que el módulo los importe (2 de 7 notificadores
murieron así en este repo, con la suite en verde).

### T19 · Tests de la action **[P]**
**Depende de:** T18. **Archivos:** `tests/unit/actions/traspasar-mensajero.test.ts`.
**Qué:** sin sesión → `unauthenticated` sin construir servicio; motivo de 9 caracteres o sólo
espacios → `validation_error` **sin escribir nada** (R28); lote vacío o uuid inválido →
`validation_error`; el input **no admite** un campo de mensajero de origen (R8); caso feliz que
afirma que el `motivo` llega **recortado**.
**Hecho cuando:** todos pasan y el caso de validación afirma que el servicio no se llamó.

---

## Tanda 6 — La línea de tiempo

### T20 · La tercera clase
**Depende de:** T1. **Archivos:** `lib/types/orden-historial.ts`,
`lib/services/OrdenHistorialService.ts`, `lib/repositories/OrdenTraspasoRepository.ts` (nuevo),
`lib/interfaces/repositories/IOrdenTraspasoRepository.ts`.
**Qué:** `OrdenHistorialTraspasoDTO` (design §9), la unión de tres, `RANGO_POR_CLASE` con
`traspaso_mensajero: 2` —**no compila hasta decidirlo**, y eso es el punto—,
`fusionarLineaDeTiempo` con su tercer parámetro, y `findTraspasosByOrden` ordenada
`created_at ASC, id ASC`.
**Hecho cuando:** typecheck verde y ningún `switch` sobre `clase` queda sin rama.

### T21 · Tests de la línea de tiempo **[P]**
**Depende de:** T20. **Archivos:** `tests/unit/services/orden-historial-fusion.test.ts` (ampliar),
`tests/components/HistorialOrdenTimeline.test.tsx`.
**Qué:** la fusión ordena las tres fuentes por instante y desempata por clase (R29); con traspasos
vacío el resultado es idéntico al de hoy (no-regresión); dos traspasos de la misma orden salen los
**dos**, en orden (R30); el componente pinta origen, destino, actor y motivo, y el rol que pinta es
el **congelado** (R26/R29).
**Hecho cuando:** pasan y el caso de no-regresión afirma igualdad con la salida previa.

---

## Tanda 7 — La pantalla (empieza cuando la 6 está hecha)

### T22 · `TraspasarMensajeroModal`
**Depende de:** T18. **Archivos:**
`app/(app)/ordenes/_components/TraspasarMensajeroModal.tsx`,
`app/(app)/ordenes/_components/traspaso-error-messages.ts`.
**Qué:** cuerpo de `DeshacerAsignacionModal` (motivo obligatorio, confirmar deshabilitado hasta que
valide, **una** llamada con el lote completo) + selector de mensajero de `AsignarBodegaModal` con sus
marcadores, **excluyendo al origen**. Textos de design §10. Lenguaje claro, sin siglas.
**Hecho cuando:** typecheck y lint verdes, y el mapeo de errores cubre las siete causas del servicio.

### T23 · La acción en la barra de `/ordenes`
**Depende de:** T22. **Archivos:** `app/(app)/ordenes/_components/OrdenesListado.tsx`.
**Qué:** «Traspasar a otro mensajero» en `case "en_reparto"` y `case "ayuda_tienda"`, junto a
«Cambiar día de reparto». Éxito ⇒ `onSuccess()` que reválida.
**Hecho cuando:** la acción sólo aparece en esos dos estados y sólo con `accionesLote`.

### T24 · Tests de pantalla
**Depende de:** T23. **Archivos:** `tests/components/OrdenesListado.test.tsx` (o el de la barra),
`tests/components/TraspasarMensajeroModal.test.tsx`.
**Qué:** con `maestro` y selección `en_reparto` aparece la acción; con `por_recoger`,
`devolviendo_a_tienda` y `en_bodega_central` **no** (R34); con rol `mensajero` no hay ni casilla ni
acción (R3); la confirmación dice «N órdenes de *origen* a *destino*» (R35); el éxito dice cuántas
órdenes y cuántas conversaciones **y** el aviso de que la ruta del destino se va a recalcular y sus
paradas nuevas van al final (R33/R36); un fallo pinta el mensaje por causa sin ids ni datos del
destinatario (R37).
**Hecho cuando:** pasan y el caso de R33 busca el **texto del aviso**, no la ausencia de error.

### T25 · Verlo funcionando, no sólo en verde
**Depende de:** T24.
**Qué:** levantar la app (un solo dev server), entrar como maestro, filtrar por un mensajero y estado
«en reparto», traspasar 2 órdenes a otro mensajero y comprobar **en pantalla**: el listado las
muestra con el nuevo mensajero; el destino ve el hilo de chat con su historial y **la campana con su
aviso**; el origen ya no ve el hilo y **tiene su propio aviso**; el historial de una de las órdenes
muestra la entrada del traspaso.
**Hecho cuando:** los cinco puntos se ven, con una nota de lo observado en `progress/impl_427.md`.
Doce mil tests en verde no han visto nunca esta pantalla.

---

## Tanda 8 — Cierre

### T26 · Autocomprobación por mutación (se ejecuta de verdad y se pega la salida)
**Depende de:** T3-T25.

| # | Mutación | Esperado |
| --- | --- | --- |
| 1 | Quitar el `UPDATE` de `chat_conversacion` del repo | **ROJO** en T9.3 |
| 2 | Quitar `mensajero_leido_at = NULL` del `SET` del chat | **ROJO** en T9.3 |
| 3 | Quitar `AND "mensajero_asignado_id" = ${origenId}` del `WHERE` | **ROJO** en T9.10 |
| 4 | Poner `"fecha_reparto" = NOW()::date` | **ROJO** en la guardia `fecha-reparto…` (d4) **y** en T9.2 |
| 5 | Quitar `ayuda_tienda` de `ESTADOS_TRASPASABLES` | **ROJO** en T16 y en T17 |
| 6 | Escribir el rol **vivo** en la fila de rastro en vez del congelado | **ROJO** en T9.8 |
| 7 | Mover `registrarTraspasoMensajero` fuera del `$transaction` | **ROJO** en T9.10 |
| 8 | Encolar la reoptimización sólo del destino | **ROJO** en T9.9 |
| 9 | Aplicar la guarda de cierres también al **origen** | **ROJO** en T16 (R12) |
| 10 | Usar el `ordenId` (o el `mensajeroId`) como `entidadId` del aviso | **ROJO** en T13 (R42) |
| 11 | No pasar los notificadores reales en la Server Action (dejar el no-op) | **ROJO** en T18 |
| 12 | Emitir un aviso **por orden** en vez de uno por acto | **ROJO** en T13 y en T16 |

**Hecho cuando:** las doce se ejecutaron, con la salida pegada en `progress/impl_427.md` (no un
resumen: este repo ya tuvo un arnés de mutaciones que reportó 9/9 sin haber corrido un test), el
árbol quedó limpio, y cualquier resultado distinto del esperado se investigó antes de seguir.

### T27 · Gate completo, evidencia y mapa
**Depende de:** T26.
**Qué:** re-leer la lista de enums del `down.sql` de T4 contra `origin/dev` (el pre-vuelo caduca);
`./init.sh` **completo**, con `INIT_EXIT=$?` escrito **dentro** del log y sin canalizar por `tail`.
`progress/impl_427.md` con el mapa `R<n> → test` relleno con nombres reales, los `skipped` revisados
(que no se saltó `integration/db`), la salida de T26 y la nota de T25. **Commitear el informe** junto
al código y **verificar el blob commiteado**.
**Hecho cuando:** el log dice `INIT_EXIT=0`, `git show --stat` de la rama lista el informe y las dos
migraciones, y la lista del `down` coincide con `dev` en el momento del PR.

---

## Mapa de trazabilidad `R<n> → test`

| R | Qué fija | Test |
| --- | --- | --- |
| R1 | `maestro`/`admin` pueden traspasar un lote | **T16** + T9.1 |
| R2 | Cualquier otro rol → `forbidden` sin tocar nada | **T16** (`not.toHaveBeenCalled()`) |
| R3 | El `mensajero` no tiene superficie | **T24** |
| R4 | Traspasables = `en_reparto` + `ayuda_tienda`, y sólo esos | **T16** + **T17** (censo) |
| R5 | Otro estado → rechazo del lote completo, sin efectos | **T16** + **T9.10** |
| R6 | Dos orígenes en el lote → rechazo | **T16** |
| R7 | Destino == origen → rechazo | **T16** + **T3(b)** (CHECK en la base) |
| R8 | El origen se deriva, no se acepta del cliente | **T19** + T16 |
| R9 | Destino con rol y zona correctos | **T16** |
| R10 | Destino con vehículo y en estado que admite trabajo | **T16** (dos casos) |
| R11 | Destino bloqueado por cierres → conflicto | **T16** |
| R12 | Origen bloqueado por cierres → **sí** se traspasa | **T16** + T26 mut. 9 |
| R13 | Destino con recolección pendiente → conflicto | **T16** |
| R14 | Ni el tope de intentos ni la falta de coordenadas bloquean | **T16** (dos casos) |
| R15 | Las órdenes quedan con el destino | **T9.1** |
| R16 | Estado, día, guía y prioridad intactos | **T9.2** + T26 mut. 4 |
| R17 | Se registra el instante de la reasignación | **T9.1** |
| R18 | Todas las conversaciones pasan al destino | **T9.3** + T7 + T26 mut. 1 |
| R19 | Las conversaciones quedan sin leer para el destino | **T9.3** + T26 mut. 2 |
| R20 | Las gestiones ya registradas no cambian de dueño ni de cierre | **T9.4** |
| R21 | Sin transición de estado ni hito público | **T9.5** + guardia `rastreo-hitos-exhaustivo` existente |
| R22 | Las marcas privadas del origen no se tocan | **T9.6** |
| R23 | Todo-o-nada | **T9.10** |
| R24 | Carrera → lote revertido con motivo por orden | **T9.11** + T16 + T26 mut. 3 |
| R25 | Una fila de rastro por orden, con los cinco datos | **T9.7** |
| R26 | Rol del actor congelado | **T9.8** + T21 + T26 mut. 6 |
| R27 | Un `lote_id` por acto | **T9.7** |
| R28 | Motivo obligatorio 10-300, validado antes de escribir | **T19** |
| R29 | El traspaso se ve en la línea de tiempo de la orden | **T21** |
| R30 | Rastro append-only | **T21** (dos traspasos) + **T3(f)** |
| R31 | Atomicidad rastro ↔ movimiento, en los dos sentidos | **T9.10** + T26 mut. 7 |
| R32 | Recálculo programado para los **dos** mensajeros | **T9.9** + T26 mut. 8 |
| R33 | La pantalla avisa de la ruta pendiente del destino | **T24** |
| R34 | La acción sólo en `en_reparto` y `ayuda_tienda`, sólo a maestro/admin | **T24** |
| R35 | La confirmación dice cuántas, de quién y a quién | **T24** |
| R36 | El éxito dice órdenes y conversaciones, y relee | **T24** |
| R37 | Errores accionables, sin ids ni PII | **T24** |
| R38 | **Un** aviso al destino por acto, con cuántas y de quién | **T13** + T16 (se llama) + T26 mut. 12 |
| R39 | **Un** aviso al origen por acto, con cuántas y hacia quién | **T13** + T16 |
| R40 | Los avisos no llevan motivo ni datos del destinatario | **T13** |
| R41 | Un aviso caído no revierte ni ensucia el traspaso | **T16** (notificador que lanza ⇒ `ok`) |
| R42 | Dos actos ⇒ dos avisos, aunque el primero no se lea | **T13** (entidad = `lote_id`) + T26 mut. 10 |
| R43 | Push al destino, no al origen | **T11** + **T5** (la clave de cupo sobrevive al rollback) |

## Paralelizable

`[P]` T6 y T7 entre sí; T14 desde el principio; T4/T5 (enums) en paralelo con T1-T3 (tabla), porque
son carpetas y tipos distintos; T12, T19 y T21 en cuanto exista lo suyo. **La tanda 7 no empieza
hasta que la 6 esté hecha** (la ficha es `fullstack` y se secuencia backend → frontend).

## Antes de implementar

Nada pendiente de decidir: D1-D6 están cerradas (`requirements.md`). Lo único que **caduca** es la
lista de enums del `down.sql` de T4 — se re-lee contra `origin/dev` en T27, antes de abrir el PR.
