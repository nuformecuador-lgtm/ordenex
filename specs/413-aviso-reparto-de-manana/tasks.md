# 413 — Tasks

> Ficha **backend**. No hay fase de frontend: el panel, la campana y el atajo son de la 409.
> `[P]` = paralelizable con las tareas marcadas igual **dentro de la misma fase**.
> El criterio de «hecho» de cada tarea es **un aserto que se pone ROJO si el código está mal**.
> Nunca un `grep` sobre un comentario, y nunca un texto comparado contra la función que lo genera.
> ⚠️ **El gate de esta ficha es `./init.sh` COMPLETO**: el diff toca `db/schema.prisma`,
> `db/migrations/**`, `lib/types/**` y `vercel.json`, así que `--rapido` se niega solo.
> **Cero preguntas abiertas.** Las tres las cerró el humano el 2026-09-11 (`requirements.md §12`):
> **19:00 CR** confirmado con medición, **sin** segunda corrida, y el **mensajero bloqueado no recibe
> el aviso** (R42/R43).

---

## Fase 0 — Antes de escribir una línea

- [ ] **T0.1** — Confirmar en el **archivo real** (no en el grafo, que devuelve de más) las cinco
      cosas de las que depende todo el diseño:
      (a) `orden.fecha_reparto` es `@db.Date` (`db/schema.prisma:658`);
      (b) `DIA_REPARTO = ["hoy","manana"]` (`lib/types/dia-reparto.ts:18`);
      (c) `notificacion_dedupe_key` incluye `destinatario_usuario_id`
      (`db/migrations/20260727120000_notificacion/migration.sql:89-92`);
      (d) los estados del portal del mensajero son `por_recoger`, `en_reparto`, `ayuda_tienda`
      (`MisAsignacionesService`);
      (e) `lib/notificaciones/push-elegibles.ts` **existe o no** en `origin/dev` (decide T6.2);
      (f) `OrdenRepository.findMensajerosBloqueadosPorCierres(ids)` sigue existiendo, sigue siendo
      **en lote** y sigue derivando de `estaBloqueadoPorCierres` (`lib/utils/bloqueo-cierre.ts`)
      — de eso depende R42 sin reescribir la regla.
      **Hecho:** las seis anotadas con número de línea en `progress/impl_413.md`. Si alguna no
      coincide, **se para y se avisa**: (a) y (c) cambian el diseño entero.
- [x] **T0.2** — **MEDIDA YA HECHA** (coordinador, 2026-09-11, últimos 14 días): asignaciones por
      franja CR → **06:00–11:00 = 3.183 (89 %)**, 12:00–18:00 = 262, **≥ 19:00 = 148 (~4 %, ~10 al
      día)**. **A las 19:00 ya está asignado el ~96 % del volumen.** Cierra **Q1** (19:00 CR
      confirmado) y **Q3** (segunda corrida descartada).
      **Lo que queda por hacer con ese número —y es T1.2—:** escribirlo **al lado del valor** en
      `lib/config/aviso-reparto-manana.ts`, no en un commit, para que quien mueva la hora vea contra
      qué la mueve.
- [ ] **T0.3 [P]** — `EXPLAIN` en producción (solo lectura) de las dos consultas de §11: el
      `GROUP BY` por mensajero y el `count` por mensajero.
      **Hecho:** los dos planes pegados en el impl, **con el matiz de la 411 escrito al lado** si el
      planificador elige `Seq Scan` (barato por el tamaño, no por el índice).
      *No bloquea: su resultado sólo decide si hace falta una ficha de índice, que no es ésta.*

---

## Fase 1 — Cimientos puros (sin DB, sin cron, sin React)

- [ ] **T1.1 [P]** — `lib/constants/reparto-mensajero-estados.ts` con `ESTADOS_REPARTO_MENSAJERO`, y
      `MisAsignacionesService` pasa a **leerla** en vez de declarar sus tres constantes privadas.
      **Sin cambio de comportamiento.**
      **Hecho:** las suites vigentes de `mis-asignaciones-service` y `RepartoModule` siguen verdes
      **sin editarlas**, y `tests/unit/guards/estados-reparto-mensajero-unica-fuente.guardia.test.ts`
      afirma **1 declaración, 2 lectores**; duplicar la lista en el repositorio la pone roja. **(R2)**
- [ ] **T1.2 [P]** — `lib/config/aviso-reparto-manana.ts` con `HORA_CR: 19` y **la medición de T0.2
      escrita al lado del valor** (la tabla de tres franjas y la frase «a las 19:00 falta por asignar
      el 4 %»), más la conversión `19:00 CR = 01:00 UTC`. Ni el número ni el razonamiento van en el
      commit: van en el archivo.
      **Hecho:** la hora no aparece como literal en el servicio ni en el route handler, y la
      medición está en el fuente con su fecha. **(R9)**
- [ ] **T1.3 [P]** — Guardia `tests/unit/guards/dia-reparto-tokens.guardia.test.ts`:
      `DIA_REPARTO` es **exactamente** `["hoy","manana"]`.
      **Hecho:** añadir un tercer token la pone roja. Es lo que protege la palabra «mañana» del
      título el día que alguien amplíe el selector. **(§2 del design)**
- [ ] **T1.4** — Entrada en `lib/notificaciones/catalogo-avisos.ts`: `reparto_manana` accionable, con
      atajo `/mis-asignaciones` + «Ver mi reparto» y `tituloRepartoManana`.
      **Hecho:** `tests/unit/notificaciones/catalogo-avisos.test.ts` verde con exhaustividad contra
      el enum (**14** eventos, ni uno menos) y literales a mano para `n = 1` y `n = 7`. Quitar la
      clave del `Record` **no compila**. **(R25, R27, R30)**
      *Depende de: T2.1 (el enum tiene que tener el valor).*
- [ ] **T1.5** — El atajo pasa la guardia vigente
      `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` **sin tocarla**.
      **Hecho:** verde; y apuntando el destino a `/wallet` se pone roja. **(R26)**
      *Depende de: T1.4.*

---

## Fase 2 — Base de datos (va antes que el emisor: el enum tiene que existir)

- [ ] **T2.1** — `db/schema.prisma`: +`reparto_manana` en `NotificacionEvento` y
      +`reparto_manana_dia` en `NotificacionEntidadTipo`, **cada uno con su comentario** en el estilo
      de sus ocho precedentes: qué es, quién lo emite, a qué hora, y **por qué el `entidad_id` es el
      día anunciado y no lleva prefijo de mensajero** (el resumen de `design.md §7`).
      **Hecho:** `prisma validate` limpio y el cliente regenerado.
- [ ] **T2.2** — `db/migrations/<ts>_notificacion_evento_reparto_manana/migration.sql` con los dos
      `ADD VALUE IF NOT EXISTS`, creada con `pnpm run db:migrate:create` (**no aplicada todavía**).
      **Hecho:** la carpeta existe con timestamp posterior al de la 409 (`20260911120000`) y el SQL
      no contiene nada más que los dos `ALTER TYPE`.
- [ ] **T2.3** — `down.sql`. **Es la tarea peligrosa de la ficha y tiene TRES comprobaciones:**
      (a) leer los **ocho** downs previos de estos enums y dejar escrito, uno a uno, que recrean con
      lista o sólo dropean, y que **NO SE TOCA NINGUNO** (son fotos de su momento);
      (b) escribir las dos listas **leyendo `db/schema.prisma` de `origin/dev`**, nunca de memoria,
      **con el SHA y la fecha anotados** — y **re-leerlas justo antes de abrir el PR**, porque el
      pre-vuelo caduca y hay dos fichas hermanas vivas sobre el mismo enum (**412** y **410**);
      (c) **enumerar TODAS las columnas** que usan `notificacion_evento`. Hoy es sólo
      `notificacion.evento`; **si la 410 ya está en `dev`, también `push_envio_dia.evento`, y el
      `down` tiene que convertirla o el `DROP TYPE` falla**.
      **Hecho:** las tres comprobaciones escritas dentro del propio `down.sql` como comentario, con
      fecha y SHA. **(R38)**
- [ ] **T2.4** — Aplicar (`pnpm run db:migrate`) y **revertir** (`pnpm run db:rollback`) en local.
      **Hecho:** `tests/integration/db/notificacion-evento-reparto-manana-migration.test.ts` **[PG]**
      verde: tras el `down` quedan los 13 eventos y 11 entidades previos, ninguna columna queda sin
      convertir, y `notificacion_dedupe_key` conserva su `NULLS NOT DISTINCT` y su `WHERE` parcial.
      **(R38)**
      ⚠️ Si el gate lo reporta `skipped` por falta de `DATABASE_URL`, **no está verificado**.
      ⚠️ La base local es compartida entre worktrees: aplicar esta migración pone roja la guardia de
      drift de las demás fichas. Avisar antes, no después.
      *Depende de: T2.1, T2.2, T2.3.*
- [ ] **T2.5** — `lib/types/notificacion.ts`: el valor nuevo en los tipos espejo del enum.
      **Hecho:** `pnpm run typecheck` limpio y ningún consumidor vigente cambia de comportamiento.
      **(R40)**

---

## Fase 3 — El dato (SQL, y aquí es donde se prueba de verdad)

- [ ] **T3.1** — `lib/interfaces/repositories/IRepartoMananaRepository.ts` con los dos métodos de
      `design.md §11`, y su comentario diciendo **que estas consultas son lo que un doble no puede
      ver**.
      **Hecho:** la interfaz compila y nadie la implementa todavía.
- [ ] **T3.2** — `lib/repositories/RepartoMananaRepository.ts`: **un solo `where` privado** detrás de
      los dos métodos, con `startOfDayCR` y `>`, `deletedAt: null`,
      `mensajeroAsignadoId: { not: null }` y `ESTADOS_REPARTO_MENSAJERO`.
      ⚠️ **Leer `design.md §2` antes de escribir la cota.** `fecha_reparto` es `@db.Date`: el helper
      es `startOfDayCR`, **no** `inicioDelDiaCREnUtc`.
      **Hecho:** `tests/integration/db/reparto-manana-repository.test.ts` **[PG]** verde con:
      3 para mañana + 2 para hoy + 1 borrada ⇒ **3**; órdenes de otro mensajero fuera; un estado
      fuera del universo del portal fuera; y **el caso del reloj a las 23:50 CR** (`2026-09-12T05:50Z`)
      con una de `2026-09-12` dentro y una de `2026-09-11` fuera.
      **Contraprueba obligatoria:** con la base sin sembrar el test **falla**; queda anotado en el
      impl que se comprobó.
      **Mutación obligatoria:** cambiar el helper de fecha ⇒ los dos asertos de las 23:50 rojos.
      **(R1, R3, R4)**
      *Depende de: T1.1, T2.4.*

---

## Fase 4 — El aviso (texto, emisor, notificador)

- [ ] **T4.1** — `lib/notificaciones/emitir.ts`: `textoRepartoManana(fechaISO)` +
      `emitirRepartoManana(repo, ctx)` con `tipo: "box"`, `entidadTipo: "reparto_manana_dia"`,
      `entidadId: <fechaRepartoISO>` y `destinatario: { tipo: "usuario", usuarioId }`.
      **El texto persistido NO lleva el número** y **sí lleva la fecha en palabras** (`fechaLegible`).
      **Hecho:** `tests/unit/notificaciones/reparto-manana-aviso.test.ts` verde con el literal
      afirmado **a mano**; la `descripcion` no contiene ninguna cifra de conteo; el texto no contiene
      guía, remisión, dirección, teléfono, nombre ni `₡`; y con 40 órdenes `crear` se llama
      **exactamente una vez**. **(R5, R15, R28, R29)**
      *Depende de: T2.5.*
- [ ] **T4.2** — `lib/notificaciones/notificadores.ts`: `RepartoMananaNotificador`,
      `notificarRepartoMananaCon`, `notificarRepartoMananaReal`, y `notificadorNoOp` ampliado.
      **Hecho:** el camino real se ejercita con un repositorio doble y emite; el `noOp` no escribe
      nada. **(R36 parcial)**

---

## Fase 5 — El proceso (servicio + cron)

- [ ] **T5.1** — `lib/services/RepartoMananaAvisoService.ts`: recorre
      `resumenPorMensajero(startOfDayCR(now))`, **salta los de cero con un `continue` explícito**,
      envuelve **cada** emisión en `emitirBestEffort` y cuenta fallos. Sin HTTP, sin Prisma, sin
      transacciones.
      **Hecho:** `tests/unit/services/reparto-manana-service.test.ts` verde con: mensajero con 5 ⇒
      una emisión dirigida **a usuario**; mensajero con 0 ⇒ `crear` no se llama y los demás sí
      reciben el suyo; tres mensajeros con el segundo lanzando ⇒ 2 emisiones, 1 fallo registrado y la
      corrida **termina**. **(R6, R18, R34, R37)**
      *Depende de: T3.2, T4.2.*
- [ ] **T5.1b** — **El mensajero bloqueado no recibe el aviso (Q2).** El servicio pide **en lote**
      `findMensajerosBloqueadosPorCierres(ids)` con los ids que el `GROUP BY` ya trajo —una consulta
      más por corrida, no por mensajero— y salta a los que estén dentro, con un `continue` explícito
      junto al del cero. **La regla NO se reescribe:** se reutiliza el `Set` que ya deriva de
      `estaBloqueadoPorCierres`. El repositorio entra como `Pick<...>` de un solo método
      (patrón `CorreccionDiaRepartoRepo`), para que el resto no quede consultable por descuido.
      **Hecho:** `tests/unit/services/reparto-manana-service.test.ts` verde con tres mensajeros con
      reparto y **el segundo bloqueado** ⇒ **2** emisiones, y el bloqueado ninguna.
      **Mutación obligatoria:** no consultar el bloqueo ⇒ 3 emisiones y rojo. **(R42)**
      *Depende de: T0.1(f), T5.1.*
- [ ] **T5.2** — `app/api/cron/aviso-reparto-manana/route.ts`: clon del patrón de
      `avisos-diarios` — auth por `CRON_SECRET` **antes de cualquier efecto**, y respuesta enumerando
      **campo a campo** sólo conteos + fecha.
      **Hecho:** `tests/unit/api/aviso-reparto-manana-route.test.ts` verde: sin `Authorization` ⇒ 401
      **y el service no se construye**; secreto ausente ⇒ 401; el cuerpo 200 tiene exactamente las
      claves declaradas y **ninguna con un id**. **(R33, R35)**
- [ ] **T5.3** — Composition root: el route handler **pasa** `notificarRepartoMananaReal` como
      argumento; el default del servicio sigue siendo el no-op.
      **Hecho:** `tests/unit/services/notificacion-notificadores-reales.test.ts` ampliado afirma sobre
      el **uso efectivo** (fuente sin imports ni comentarios) que **alguien lo pasa**. Borrar el
      argumento **dejando el import intacto** la pone roja. **(R36)**
      *Depende de: T5.2.*
- [ ] **T5.4** — `vercel.json`: `{ "path": "/api/cron/aviso-reparto-manana", "schedule": "0 1 * * *" }`
      (= 19:00 CR), con el comentario de la conversión en la cabecera del route handler.
      **Hecho:** `tests/unit/guards/cron-hora-cr.guardia.test.ts` verde: hay **una** entrada para esa
      ruta; la expresión convertida a CR **coincide** con `HORA_CR`; y la hora CR **no cae** en
      22:00–06:00. `0 19 * * *` la pone roja por la primera vía y `0 5 * * *` por la segunda.
      **(R9, R10, R11)**
      *Depende de: T1.2, T5.2.*

---

## Fase 6 — El apagado solo (cifra viva) y el push

- [ ] **T6.1** — `VigenciaAvisoAgregadoService`: rama `reparto_manana` según `design.md §5.1`, con el
      repositorio nuevo por constructor; `EVENTOS_AGREGADOS` gana el valor; `lib/actions/
      notificaciones.ts` `buildService()` lo cablea.
      ⚠️ **El ámbito sale del ACTOR** (`actor.usuarioId`), **nunca del `entidad_id`**. Rol distinto de
      `mensajero` ⇒ **lanza**, no devuelve `0`.
      **Hecho:** `tests/unit/services/vigencia-aviso-agregado.test.ts` ampliado: un `adminTienda`
      pidiendo este evento **lanza** (mutación «devolver 0» ⇒ rojo); y con el reloj en
      `2026-09-12T00:01 CR` las órdenes de `2026-09-12` **ya no cuentan** ⇒ cifra `0`. Y en
      `tests/unit/services/notificacion-service.test.ts`: cifra `3` sobre una fila emitida con «5» ⇒
      el título dice **3**; cifra `0` ⇒ el ítem no sale ni cuenta **sin** fila de lectura ni de
      descarte; resolutor que lanza ⇒ el ítem sale y el resto del listado también; espía del
      resolutor ⇒ **1** llamada con el aviso vivo y **0** sin él.
      ⚠️ **Y el resolutor NO consulta cierres (R43):** el filtro del bloqueo es de **emisión**, no de
      lectura (`design.md §6.1`). Con un doble que **falla si alguien le pide el bloqueo**, la cifra
      viva sale igual. **Mutación:** meter la comprobación aquí ⇒ ese test rojo **y R41 también**,
      por la consulta de más en la ruta caliente.
      **(R13, R16, R17, R19, R20, R21, R41, R43)**
      *Depende de: T3.2, T1.4.*
- [ ] **T6.2** — **Elegibilidad de push.** Dos caminos, y hay que decir cuál se tomó. ⚠️ **La 410
      está en revisión (2026-09-11), así que lo más probable es el primero:**
      · si `lib/notificaciones/push-elegibles.ts` **ya está en `dev`** ⇒ añadir la entrada
        (perfil **usuario/mensajero**) y su test; sin ella el typecheck se pone rojo;
      · si **no existe todavía** ⇒ **no se crea nada**: la decisión ya está escrita en
        `design.md §9` y en el comentario del enum (T2.1), y la 410 la aplicará al rebasar.
      **Hecho:** en el primer caso, `tests/unit/notificaciones/push-elegibles.test.ts` verde. En el
      segundo, **la casilla de R31 queda VACÍA a propósito** y el impl dice por qué. **(R30, R31)**
      *Depende de: T0.1(e), T2.5.*

---

## Fase 7 — Dedupe, cierre y puerta de despliegue

- [ ] **T7.1** — `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` **[PG]**, que es donde
      vive la evidencia de la decisión más delicada de la ficha (`design.md §7`):
      · **dos mensajeros** la misma noche ⇒ **2 filas**;
      · **dos noches consecutivas** ⇒ **2 filas** para el mismo mensajero;
      · **dos corridas del mismo anuncio** ⇒ **1 fila**, también subiendo el número entre ellas;
      · **dos `crear` concurrentes** con la misma entidad ⇒ 1 fila y **ningún error propagado**.
      **Mutaciones obligatorias:** dirigir el aviso a un **rol** ⇒ el primer caso rojo; quitar el día
      del `entidad_id` ⇒ el segundo rojo.
      **Contraprueba:** con la base sin sembrar, los cuatro casos **fallan**.
      **(R7, R14, R22, R23, R24)**
      *Depende de: T4.1, T5.1, T2.4.*
- [ ] **T7.2** — **Puerta de despliegue: mirar la campana de un mensajero con el aviso vivo**, en los
      dos temas, con el número en el título y el botón «Ver mi reparto» llevando a
      `/mis-asignaciones`. jsdom no mide desbordes ni contraste.
      **Hecho:** captura o descripción en `progress/impl_413.md`. **Si no se hace, la casilla queda
      VACÍA**; marcarla sin haberlo visto convierte una declaración honesta en una mentira.
- [ ] **T7.3** — `R8`: un mensajero B **no ve** la fila dirigida al mensajero A.
      **Hecho:** `tests/unit/repositories/notificacion-visibilidad.test.ts` ampliado, y la suite
      vigente del predicado de visibilidad **sigue verde sin editarla**. **(R8, R39)**
- [ ] **T7.4** — Mapa `R<n> → test` completo en `progress/impl_413.md`, **cruzado contra los tests
      realmente ejecutados** (no contra la bitácora), y la lista de mutaciones con su resultado.
      Anotar explícitamente **cuántos `[PG]` corrieron y cuántos se saltaron**.
      **Hecho:** los **43** requisitos con su test, o con el motivo escrito si alguno queda sin
      cubrir (R31 puede quedarlo, ver T6.2).
- [ ] **T7.5** — **Gate COMPLETO en verde**: `./init.sh` (no `--rapido`, que se niega solo), con
      `INIT_EXIT` escrito **dentro** del log —un `echo` al final tapa el código de salida— y sin
      canalizar por `tail`, que trunca el fichero en origen.
      **Hecho:** `INIT_EXIT=0`, el número de tests y el de archivos de `integration/db`
      **ejecutados** pegados en el impl. Un rojo ajeno sólo se acepta si está en
      `tests/baseline-rojos.json` **con su motivo y su fecha**; jamás se añade uno nuevo para pasar.
- [ ] **T7.6** — Commitear **todo**, incluido el informe: un informe que describe el disco no es un
      commit. Verificar el blob commiteado en la rama antes de dar la ficha por entregada.
      **Hecho:** `git status` limpio y el diff de la rama contiene los tres archivos de `specs/413-*`,
      el impl y el código.

---

## Orden y paralelismo, de un vistazo

```
T0.1 ──┬─> T1.1 [P]
       ├─> T1.2 [P]   (lleva dentro el número de T0.2, ya medido)
       ├─> T1.3 [P]
       └─> T0.3 [P]

T2.1 -> T2.2 -> T2.3 -> T2.4 -> T2.5 ──> T1.4 -> T1.5
                                  │
                                  └─> T3.1 -> T3.2 ──> T5.1 -> T5.1b -> T5.2 -> T5.3
                                                   │                       └──> T5.4
                                  T4.1 -> T4.2 ────┘
                                                   └─> T6.1, T6.2
                                                          └─> T7.1 -> T7.2..T7.6
```

**No se paraleliza el gate con nada que mute el árbol:** el gate leería un árbol a medias y su
veredicto no valdría.
