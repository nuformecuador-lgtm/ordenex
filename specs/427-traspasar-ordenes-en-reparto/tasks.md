# 427 — Traspasar a otro mensajero lo que ya lleva encima · Tareas

> **Zona:** `fullstack`. Rama: `feat/427-traspasar-ordenes-en-reparto`.
> Se secuencia **backend → frontend** (tandas 1-5 y luego 6). No se solapan.
>
> ⚠️ **El gate rápido se niega solo, y está bien que lo haga.** El diff toca
> `db/migrations/**`, `db/schema.prisma` y `lib/types/**`, que son cimientos: **`./init.sh`
> completo es obligatorio** antes de abrir el PR. No se intenta `--rapido` «a ver si pasa».
>
> ⚠️ **`DATABASE_URL` resoluble es obligatorio.** T3 y T7 son el corazón de esta ficha y viven en
> `tests/integration/db/**`: sin base se **saltan** y el gate sale verde sin haber medido nada.
> Mira los `skipped`, no sólo el `INIT_EXIT`.
>
> ⚠️ **Base local compartida:** esta ficha aplica una migración. Si otro agente corre su gate contra
> la misma base, se pisan. Coordinar antes de `prisma migrate dev`.

---

## Tanda 0 — Antes de tocar nada

### T0 · Las seis preguntas abiertas, contestadas
**Depende de:** nada. **Bloquea:** todo.
**Qué:** `requirements.md` cierra con Q1-Q6. Necesitan respuesta del humano en la puerta
`spec_ready`. Las que cambian el trabajo si cambian: **Q4** (si `ayuda_tienda` sale, cambian T9, T10
y T11), **Q1** (si entra el `adminSatelite`, es otra tanda entera), **Q3** y **Q6** (añaden
catálogo y migración).
**Hecho cuando:** las seis tienen respuesta escrita en el hilo de aprobación y, si alguna cambia el
alcance, este `tasks.md` se actualiza **antes** de empezar.

---

## Tanda 1 — Los datos

### T1 · El modelo `OrdenTraspasoMensajero`
**Depende de:** T0. **Archivos:** `db/schema.prisma`.
**Qué:** el bloque de design §4.1 tal cual, con su docstring entero (por qué tabla propia, por qué
no `historial_accion`, por qué no `orden_historial_estado`), los cinco `@@index` y los lados
inversos en `Orden` y `Usuario`.
**Hecho cuando:** `pnpm exec prisma format` y `pnpm run typecheck` verdes, y
`prisma migrate diff --from-config-datasource` **no** propone nada más que la tabla nueva.

### T2 · La migración, con `down.sql`
**Depende de:** T1. **Archivos:** `db/migrations/20260917120000_orden_traspaso_mensajero/`.
**Qué:** `migration.sql` (tabla, 4 FK `RESTRICT/CASCADE`, 5 índices, CHECK
`mensajero_nuevo_id <> mensajero_anterior_id`, `ENABLE ROW LEVEL SECURITY`) y `down.sql`
(`DROP TABLE IF EXISTS`). **No se toca ningún `down.sql` anterior**: son fotos de su rama, y esta
migración no crea ningún tipo.
**Hecho cuando:** `pnpm run db:migrate` aplica limpio, `pnpm run db:rollback` la revierte y
`prisma migrate status` no reporta drift.

### T3 · Contra Postgres: la forma de la tabla es la que dice el diseño
**Depende de:** T2. **Archivos:** `tests/integration/db/orden-traspaso-migration.test.ts`.
**Qué:** con `DATABASE_URL` puesta y dentro de transacción revertida: (a) las cinco columnas y sus
`NOT NULL`; (b) el CHECK **rechaza** origen == destino (R7); (c) las cuatro FK son `RESTRICT` —
borrar el usuario del mensajero anterior **falla**; (d) `relrowsecurity` es `true` (RLS); (e) los
cinco índices existen por nombre; (f) la tabla **no** tiene `updated_at` ni `deleted_at` (R30).
⚠️ **Prohibido** el `if (!fks) return;`: sin datos para sembrar el caso **falla**, no se salta.
**Hecho cuando:** pasa con base, y (b) y (c) fallan con el error esperado, no con cualquiera.

---

## Tanda 2 — La escritura

### T4 · Choke point del rastro **[P]**
**Depende de:** T1. **Archivos:** `lib/repositories/registrar-traspaso-mensajero.ts` (nuevo).
**Qué:** `registrarTraspasoMensajero(tx, filas)` — recibe el `tx` como **primer** parámetro (la
atomicidad es del tipo, no de la disciplina), inserta una fila por orden con el `loteId` común, y
lleva escrito «este es el único sitio del árbol que inserta en `orden_traspaso_mensajero`» (patrón
literal de `registrar-cambio-dia-reparto.ts`).
**Hecho cuando:** typecheck verde y el tipo del primer parámetro **no** admite un `PrismaClient`
suelto que pueda abrir su propia transacción.

### T5 · Choke point del chat **[P]**
**Depende de:** T1. **Archivos:** `lib/repositories/traspasar-conversaciones.ts` (nuevo).
**Qué:** `traspasarConversaciones(tx, ordenIds, mensajeroDestinoId): Promise<number>` con el
`UPDATE` de design §6.3 — **todas** las conversaciones de esas órdenes, `mensajero_leido_at = NULL`,
sin tocar `ultimo_entrante_at`, sin tocar `orden` ni `telefono_e164`. Devuelve cuántas movió (es el
`conversaciones` del contrato).
**Hecho cuando:** typecheck verde y un test unitario afirma que el `WHERE` va por `orden_id IN` y
que el `SET` **no** incluye `ultimo_entrante_at`.

### T6 · `OrdenRepository.traspasarMensajeroLote`
**Depende de:** T4, T5. **Archivos:** `lib/repositories/OrdenRepository.ts`,
`lib/interfaces/repositories/IOrdenRepository.ts`.
**Qué:** la transacción de design §6: pre-lectura `FOR UPDATE … ORDER BY "id"`, un `UPDATE` guardado
por orden (con `fecha_reparto` reescrita **con su propio valor** como parámetro `YYYY-MM-DD`),
`throw` si alguna toca 0 filas, chat, rastro y los **dos** encolados de reoptimización
(`encolarOptimizacionDebounce` para origen y destino) — todo dentro del mismo `$transaction`.
Error tipado propio para la carrera (patrón `DeshacerAsignacionConflictoError`).
**Hecho cuando:** typecheck verde; el `SET` **no** contiene `NOW()::date`, `CURRENT_DATE`,
`AT TIME ZONE` ni `interval`; y `pnpm exec vitest run guard` sigue verde en
`fecha-reparto-acompana-asignado-at` (el censo la ve y la da por buena: toca `asignado_at` **y**
`fecha_reparto`).

### T7 · Contra Postgres: **el caso real de 31 órdenes, medido**
**Depende de:** T6. **Archivos:** `tests/integration/db/traspaso-mensajero.int.test.ts`.
**Qué:** el test que sostiene la ficha entera. Sembrar dos mensajeros, un lote de órdenes
`en_reparto` con hilo de chat, otras `entregada` con su `gestion_orden`, y ejecutar el traspaso.
Afirmar, con la base delante:
1. las órdenes del lote quedan con `mensajero_asignado_id = destino` (R15) y con `asignado_at`
   **posterior** al de antes (R17);
2. `estatus_id`, `fecha_reparto`, `num_guia` y `prioridad` **idénticos** a los de antes (R16);
3. `chat_conversacion.mensajero_id` = destino para **todas** las conversaciones de esas órdenes, y
   `mensajero_leido_at IS NULL` (R18/R19), con `ultimo_entrante_at` intacto;
4. las gestiones de las órdenes ya entregadas por el origen siguen con `mensajero_id = origen` y su
   `cierre_id` y sus importes no cambian (R20);
5. **cero** filas nuevas en `orden_historial_estado` para esas órdenes (R21);
6. `orden_mensajero_meta` intacta (R22);
7. una fila de `orden_traspaso_mensajero` por orden, con origen, destino, actor, **rol congelado**,
   motivo e instante, y **un solo** `lote_id` para todas (R25/R27);
8. **rol congelado**: cambiar el rol vivo del actor después y releer ⇒ la fila sigue diciendo el
   rol de entonces (R26);
9. dos filas en `jobs` de tipo `optimizacion_ruta`, una por mensajero (R32);
10. **todo-o-nada**: con una orden del lote en `entregada`, o de otro mensajero, o borrada ⇒ no se
    mueve ninguna, no hay conversación movida, no hay rastro y no hay jobs (R5/R23/R24/R31);
11. **la carrera**: cambiar el estatus de una orden entre la pre-lectura y el `UPDATE` ⇒ el lote
    revierte entero (R24).
⚠️ Nada de dobles aquí: **el `WHERE` se prueba donde vive**. Un test de servicio con dobles pasa en
verde con el `WHERE` mutado — medido cuatro veces en este repo.
**Hecho cuando:** los once puntos pasan con base, y los casos 10 y 11 fallan **por el motivo
esperado**, no por un error de siembra.

---

## Tanda 3 — Las reglas

### T8 · Mensajes y constantes **[P]**
**Depende de:** T0. **Archivos:** `lib/services/mensajes-traspaso.ts` (nuevo).
**Qué:** los tres motivos nuevos (estado no traspasable con el nombre del estado, orden de otro
mensajero, carrera). Los tres existentes (`sin vehículo`, `no asignable`, `bloqueado por cierres`)
**se importan** de `mensajes-bloqueo.ts`, no se copian.
**Hecho cuando:** `grep` de esos tres literales existentes fuera de `mensajes-bloqueo.ts` da cero.

### T9 · `TraspasoMensajeroService`
**Depende de:** T6, T8. **Archivos:** `lib/interfaces/services/ITraspasoMensajeroService.ts`,
`lib/services/TraspasoMensajeroService.ts`.
**Qué:** rol → lote vacío → pre-carga → **origen único derivado** → estados traspasables → guardas
del destino en el orden de design §8 → `loteId` → repo. Con las **dos ausencias escritas** (tope de
intentos y gate de coordenadas) y su porqué, no omitidas. Sin HTTP y sin Prisma: instanciable con
dobles.
**Hecho cuando:** typecheck verde y el servicio no importa nada de `@prisma/client` salvo tipos.

### T10 · Tests del servicio, con dobles
**Depende de:** T9. **Archivos:** `tests/unit/services/traspaso-mensajero-service.test.ts`.
**Qué:** `maestro` y `admin` pasan (R1); `mensajero`, `adminTienda`, `adminSatelite` → `forbidden`
**sin que se llame a ningún repo** (R2); estado no traspasable → `conflict` con el nombre del estado
y **sin escritura** (R5); dos orígenes → `conflict` (R6); destino == origen → rechazo (R7); destino
sin rol/zona, sin vehículo, no asignable, bloqueado por cierres, con recolección pendiente → cada
uno con su motivo propio y sin escritura (R9-R11/R13); **origen** bloqueado por cierres → **pasa**
(R12); orden con el tope de intentos agotado y orden sin coordenadas → **pasan** (R14); el
`detalle` del conflicto lleva una entrada por orden (R24).
**Hecho cuando:** todos pasan y la tabla de `forbidden` afirma `not.toHaveBeenCalled()` sobre los
repos, no sólo el `status`.

### T11 · El censo de «lo que lleva encima el mensajero» gana su noveno miembro
**Depende de:** T9. **Archivos:** `tests/unit/guards/carga-del-mensajero.guardia.test.ts`.
**Qué:** declarar `ESTADOS_TRASPASABLES` en `FAMILIA` con `pregunta: "que ocupa al mensajero"`,
`incluyeAyuda: true` y la razón escrita (235/R1: el paquete sigue en su mano). Subir
`expect(FAMILIA).toHaveLength(8)` a **9** y actualizar el comentario con la fecha y el motivo, sin
tachar la historia previa.
**Hecho cuando:** la guardia pasa, y **se comprueba a mano** que quitando `ayuda_tienda` de la
constante del servicio la guardia se pone **roja** (si no, el miembro no está leyendo lo que dice
leer).

---

## Tanda 4 — El borde

### T12 · Server Action `traspasarMensajero`
**Depende de:** T9. **Archivos:** `lib/actions/traspasar-mensajero.ts`.
**Qué:** `'use server'` + `withErrorHandler` + `resolveActorFromSession` + el zod de design §7.1 +
fábrica del servicio. Patrón literal de `lib/actions/deshacer-asignacion.ts`. Sin PII en logs.
**Hecho cuando:** typecheck verde y `unauthenticated` / `validation_error` se resuelven **antes** de
construir el servicio.

### T13 · Tests de la action **[P]**
**Depende de:** T12. **Archivos:** `tests/unit/actions/traspasar-mensajero.test.ts`.
**Qué:** sin sesión → `unauthenticated` sin construir servicio; motivo de 9 caracteres o sólo
espacios → `validation_error` **sin escribir nada** (R28); lote vacío o uuid inválido →
`validation_error`; el input **no admite** un campo de mensajero de origen (R8); un caso feliz que
afirma que el `motivo` llega **recortado** al servicio.
**Hecho cuando:** todos pasan y el caso de validación afirma que el servicio no se llamó.

---

## Tanda 5 — La línea de tiempo

### T14 · La tercera clase
**Depende de:** T1. **Archivos:** `lib/types/orden-historial.ts`,
`lib/services/OrdenHistorialService.ts`, `lib/repositories/OrdenTraspasoRepository.ts` (nuevo),
`lib/interfaces/repositories/IOrdenTraspasoRepository.ts`.
**Qué:** `OrdenHistorialTraspasoDTO` (design §9), la unión de tres, `RANGO_POR_CLASE` con
`traspaso_mensajero: 2` —**no compila hasta decidirlo**, y eso es el punto—,
`fusionarLineaDeTiempo` con su tercer parámetro, y la lectura `findTraspasosByOrden` ordenada
`created_at ASC, id ASC`.
**Hecho cuando:** typecheck verde y **ningún** `switch` sobre `clase` queda sin rama (el compilador
lo demuestra).

### T15 · Tests de la línea de tiempo **[P]**
**Depende de:** T14. **Archivos:** `tests/unit/services/orden-historial-fusion.test.ts` (ampliar),
`tests/components/HistorialOrdenTimeline.test.tsx`.
**Qué:** la fusión ordena las tres fuentes por instante y desempata por clase (R29); con traspasos
vacío el resultado es idéntico al de hoy (no-regresión); dos traspasos de la misma orden salen los
**dos**, en orden (R30); el componente pinta origen, destino, actor y motivo, y el rol que pinta es
el **congelado** de la fila (R26/R29).
**Hecho cuando:** pasan y el caso de no-regresión afirma igualdad con la salida previa.

---

## Tanda 6 — La pantalla (empieza cuando la tanda 5 está hecha)

### T16 · `TraspasarMensajeroModal`
**Depende de:** T12. **Archivos:**
`app/(app)/ordenes/_components/TraspasarMensajeroModal.tsx`,
`app/(app)/ordenes/_components/traspaso-error-messages.ts`.
**Qué:** cuerpo de `DeshacerAsignacionModal` (motivo obligatorio, confirmar deshabilitado hasta que
valide, **una** llamada con el lote completo) + selector de mensajero de `AsignarBodegaModal` con
sus marcadores, **excluyendo al origen**. Textos de design §10. En el texto de UI: lenguaje claro,
sin siglas.
**Hecho cuando:** typecheck y lint verdes, y el mapeo de errores cubre las siete causas del
servicio.

### T17 · La acción en la barra de `/ordenes`
**Depende de:** T16. **Archivos:** `app/(app)/ordenes/_components/OrdenesListado.tsx`.
**Qué:** «Traspasar a otro mensajero» en `case "en_reparto"` y `case "ayuda_tienda"`, junto a
«Cambiar día de reparto». Éxito ⇒ `onSuccess()` que reválida (patrón de las demás).
**Hecho cuando:** la acción sólo aparece en esos dos estados y sólo con `accionesLote`.

### T18 · Tests de pantalla
**Depende de:** T17. **Archivos:** `tests/components/OrdenesListado.test.tsx` (o el archivo de la
barra de acciones), `tests/components/TraspasarMensajeroModal.test.tsx`.
**Qué:** con sesión `maestro` y selección `en_reparto` aparece la acción; con `por_recoger`,
`devolviendo_a_tienda` y `en_bodega_central` **no** (R34); con rol `mensajero` no hay ni casilla ni
acción (R3); la confirmación dice «N órdenes de *origen* a *destino*» (R35); el éxito dice cuántas
órdenes y cuántas conversaciones **y** el aviso de que la ruta del destino se va a recalcular y sus
paradas nuevas van al final (R33/R36); un fallo pinta el mensaje por causa sin ids ni datos del
destinatario (R37).
**Hecho cuando:** pasan y el caso de R33 busca el texto del aviso, no la ausencia de error.

### T19 · Verlo funcionando, no sólo en verde
**Depende de:** T18.
**Qué:** levantar la app (un solo dev server), entrar como maestro, filtrar por un mensajero y
estado «en reparto», traspasar 2 órdenes a otro mensajero y comprobar **en pantalla**: el listado
las muestra con el nuevo mensajero, el destino ve el hilo de chat con su historial, el origen ya no
lo ve, y el historial de una de las órdenes muestra la entrada del traspaso.
**Hecho cuando:** los cuatro puntos se ven, con una nota de lo observado en `progress/impl_427.md`.
Doce mil tests en verde no han visto nunca esta pantalla.

---

## Tanda 7 — Cierre

### T20 · Autocomprobación por mutación (se ejecuta de verdad y se pega la salida)
**Depende de:** T3-T18.

| # | Mutación | Esperado |
| --- | --- | --- |
| 1 | Quitar el `UPDATE` de `chat_conversacion` del repo | **ROJO** en T7.3 |
| 2 | Quitar `mensajero_leido_at = NULL` del `SET` del chat | **ROJO** en T7.3 |
| 3 | Quitar `AND "mensajero_asignado_id" = ${origenId}` del `WHERE` | **ROJO** en T7.10 |
| 4 | Poner `"fecha_reparto" = NOW()::date` | **ROJO** en la guardia `fecha-reparto…` (d4) **y** en T7.2 |
| 5 | Quitar `ayuda_tienda` de `ESTADOS_TRASPASABLES` | **ROJO** en T10 y en T11 |
| 6 | Escribir el rol **vivo** en la fila de rastro en vez del congelado | **ROJO** en T7.8 |
| 7 | Mover `registrarTraspasoMensajero` fuera del `$transaction` | **ROJO** en T7.10 (rastro sin movimiento) |
| 8 | Encolar la reoptimización sólo del destino | **ROJO** en T7.9 |
| 9 | Aplicar la guarda de cierres también al **origen** | **ROJO** en T10 (R12) |

**Hecho cuando:** las nueve se ejecutaron, con la salida pegada en `progress/impl_427.md` (no un
resumen: este repo ya tuvo un arnés de mutaciones que reportó 9/9 sin haber corrido un test), el
árbol quedó limpio, y cualquier resultado distinto del esperado se investigó antes de seguir.

### T21 · Gate completo, evidencia y mapa
**Depende de:** T20.
**Qué:** `./init.sh` **completo** (el rápido se niega: hay migración y `lib/types/`), con
`INIT_EXIT=$?` escrito **dentro** del log y sin canalizar por `tail`. `progress/impl_427.md` con el
mapa `R<n> → test` de abajo relleno con nombres de archivo y de caso **reales**, los `skipped`
revisados (que no se saltó `integration/db`), la salida de T20 y la nota de T19.
**Commitear el informe** junto al código, y **verificar el blob commiteado**: un informe sin
commitear describe un disco, no una rama.
**Hecho cuando:** el log dice `INIT_EXIT=0`, `git show --stat` de la rama lista el informe y la
migración.

---

## Mapa de trazabilidad `R<n> → test`

| R | Qué fija | Test |
| --- | --- | --- |
| R1 | `maestro`/`admin` pueden traspasar un lote | **T10** + T7.1 |
| R2 | Cualquier otro rol → `forbidden` sin tocar nada | **T10** (`not.toHaveBeenCalled()`) |
| R3 | El `mensajero` no tiene superficie | **T18** |
| R4 | Traspasables = `en_reparto` + `ayuda_tienda`, y sólo esos | **T10** + **T11** (censo) |
| R5 | Otro estado → rechazo del lote completo, sin efectos | **T10** + **T7.10** |
| R6 | Dos orígenes en el lote → rechazo | **T10** |
| R7 | Destino == origen → rechazo | **T10** + **T3(b)** (CHECK en la base) |
| R8 | El origen se deriva, no se acepta del cliente | **T13** (el schema no lo admite) + T10 |
| R9 | Destino con rol y zona correctos | **T10** |
| R10 | Destino con vehículo y en estado que admite trabajo | **T10** (dos casos, motivos propios) |
| R11 | Destino bloqueado por cierres → conflicto | **T10** |
| R12 | Origen bloqueado por cierres → **sí** se traspasa | **T10** + T20 mut. 9 |
| R13 | Destino con recolección pendiente → conflicto | **T10** |
| R14 | Ni el tope de intentos ni la falta de coordenadas bloquean | **T10** (dos casos) |
| R15 | Las órdenes quedan con el destino | **T7.1** |
| R16 | Estado, día, guía y prioridad intactos | **T7.2** + T20 mut. 4 |
| R17 | Se registra el instante de la reasignación | **T7.1** |
| R18 | Todas las conversaciones pasan al destino | **T7.3** + T5 + T20 mut. 1 |
| R19 | Las conversaciones quedan sin leer para el destino | **T7.3** + T20 mut. 2 |
| R20 | Las gestiones ya registradas no cambian de dueño ni de cierre | **T7.4** |
| R21 | Sin transición de estado ni hito público | **T7.5** + guardia `rastreo-hitos-exhaustivo` existente |
| R22 | Las marcas privadas del origen no se tocan | **T7.6** |
| R23 | Todo-o-nada | **T7.10** |
| R24 | Carrera → lote revertido con motivo por orden | **T7.11** + T10 + T20 mut. 3 |
| R25 | Una fila de rastro por orden, con los cinco datos | **T7.7** |
| R26 | Rol del actor congelado | **T7.8** + T15 + T20 mut. 6 |
| R27 | Un `lote_id` por acto | **T7.7** |
| R28 | Motivo obligatorio 10-300, validado antes de escribir | **T13** |
| R29 | El traspaso se ve en la línea de tiempo de la orden | **T15** |
| R30 | Rastro append-only | **T15** (dos traspasos) + **T3(f)** (sin `updated_at`/`deleted_at`) |
| R31 | Atomicidad rastro ↔ movimiento, en los dos sentidos | **T7.10** + T20 mut. 7 |
| R32 | Recálculo programado para los **dos** mensajeros | **T7.9** + T20 mut. 8 |
| R33 | La pantalla avisa de la ruta pendiente del destino | **T18** |
| R34 | La acción sólo en `en_reparto` y `ayuda_tienda`, sólo a maestro/admin | **T18** |
| R35 | La confirmación dice cuántas, de quién y a quién | **T18** |
| R36 | El éxito dice órdenes y conversaciones, y relee | **T18** |
| R37 | Errores accionables, sin ids ni PII | **T18** |

## Paralelizable

`[P]` T4 y T5 entre sí (los dos choke points), T8 desde el principio, T13 y T15 en cuanto exista lo
suyo. Todo lo demás es secuencial por dependencia real; **la tanda 6 no empieza hasta que la 5 esté
hecha** (la ficha es `fullstack` y se secuencia backend → frontend).

## Antes de implementar

T0. Las seis preguntas abiertas mandan sobre este plan: **Q4** cambia T9/T10/T11, **Q1** añadiría
una tanda entera, **Q3** y **Q6** añaden migración y catálogo. Sin respuesta, no se empieza por T1.
