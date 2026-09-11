# Feature 410 — Tareas

> Requisitos en `requirements.md`, diseño en `design.md`.
> **Orden obligatorio: backend → frontend.** `[P]` = puede ir en paralelo con las de su misma tanda.
> **El gate de esta ficha es `./init.sh` COMPLETO** (migraciones + `db/schema.prisma` +
> `package.json`): `--rapido` se niega solo. Y sin `DATABASE_URL` resoluble los tests de
> `tests/integration/db` se **saltan** — mira los `skipped`, no solo el veredicto.

---

## T0 · Puerta previa (bloquea todo lo demás)

- [x] **T0.1 — La 409 está mergeada en `dev` y expone la presentación.**
      *Hecho:* existe una función pura invocable desde el servidor con la forma
      `presentacionDe(fila) → { titulo, cuerpo, destino } | null` (o equivalente), y se anota aquí su
      ruta y su firma real. **Si la 409 solo la resuelve dentro del mapeador a DTO, esta ficha se
      detiene y se pregunta al humano** (`design.md §2`).
- [x] **T0.2 — Los nombres definitivos de los dos eventos nuevos de la 409** quedan anotados aquí
      (los que ocupan las dos primeras filas del catálogo de `design.md §3`).
      *Hecho:* los dos identificadores del enum escritos, copiados de `db/schema.prisma` en `dev`.
- [x] **T0.3 — Pedir a la 409 el CONTEO de avisos pendientes por (usuario, evento).** Se está
      especificando ahora y puede incluirlo. **No bloquea**: es la mitad numerada de R52.
      *Hecho:* respuesta anotada aquí. **Si llega**, el push lleva el número. **Si no llega**, el
      texto va en singular y sin cantidad, y se escribe esa elección en `progress/impl_410.md` para
      que no parezca un olvido.

### Las tres respuestas de T0, anotadas aquí (2026-09-10, backend)

| | |
| --- | --- |
| **T0.1** | `presentacionDe(fila: FilaDeAviso): PresentacionDeAviso \| null` en `lib/notificaciones/presentacion-aviso.ts:86`. **Pura y del servidor** — verificado leyendo el archivo, no el grafo. Se consume tal cual; ni un literal duplicado. ⚠️ Su `rolLector` es el rol de **quien lee**, no `destinatario_rol`: los tres avisos del mensajero llegan con esa columna en NULL |
| **T0.2** | `novedades_sin_gestionar` y `devoluciones_represadas`. El enum tiene **13** valores, no 11 como decía el borrador del design |
| **T0.3** | **SÍ llegó.** `IVigenciaAvisoAgregado.cifra(evento, actor)` resuelve la cifra viva acotada al ámbito; el drenador construye ese `Actor` con `{usuarioId, rol, zonaId}` del destinatario. **El push de los dos agregados lleva el número dentro.** Sin conteo —los otros seis, o si el resolutor falla— sale en singular y sin cantidad; con cifra 0 **no se envía nada** (se apagó solo) |

> **Las ocho preguntas abiertas están CERRADAS** (`requirements.md` › «Decisiones cerradas»,
> 2026-09-10). No hay nada que consultar antes de empezar salvo T0.1-T0.3.

---

## Tanda 1 · Base de datos (bloquea 2, 3 y 4)

- [x] **T1.1 — Modelos `PushSuscripcion` y `PushEnvioDia` en `db/schema.prisma`** (`design.md §4.1/§4.2`).
      *Hecho:* `pnpm run typecheck` pasa y `prisma validate` no protesta.
      *Ojo:* `endpoint` es `@unique`; el cupo es `@@unique([usuarioId, evento, diaCr])`; ambas con
      `onDelete: Cascade` sobre `usuario`.
- [x] **T1.2 — Migración `<ts>_push_suscripcion`** con `pnpm run db:migrate:create` + `down.sql`
      escrito a mano. Incluye `ENABLE ROW LEVEL SECURITY` **sin policies** en las dos tablas.
      *Hecho:* `pnpm run db:migrate` aplica y `pnpm run db:rollback` revierte, **las dos cosas
      ejecutadas**, con la salida pegada en `progress/impl_410.md`.
      *Ojo:* nunca editar la migración después de aplicarla — lo añadido luego no llega a esa base.
- [x] **T1.3 — Migración `<ts+1>_job_tipo_push_web`, EN CARPETA APARTE** (`ALTER TYPE "job_tipo" ADD
      VALUE IF NOT EXISTS 'push_web'`), con su `down.sql` que **recrea el enum con los 9 valores
      previos** en el mismo orden y borra antes las filas `jobs` de ese tipo.
      *Hecho:* aplica y revierte. **No se toca ningún `down.sql` anterior**: son fotos históricas.
      *Ojo:* va sola porque Postgres no deja usar un valor de enum en la transacción que lo creó (55P04).
- [x] **T1.4 [P] — Tests de integración contra Postgres real** para: `endpoint` único, upsert por
      endpoint reasigna el usuario, borrar el usuario arrastra suscripciones y cupos, el cupo diario
      rechaza el segundo `INSERT` del mismo (usuario, evento, día), y RLS habilitada en ambas tablas.
      *Hecho:* los tests pasan **con la base viva** y `HAY_BASE_DE_DATOS` no los salta (verificado en
      la salida). Cubre R7, R16-R18, R22, R47.
      *Ojo:* un `if (!fks) return;` reporta *passed* sin comprobar nada — matar cada test con una
      mutación antes de creerlo.
- [x] **T1.5 — El cupo diario sobrevive a DOS EMISIONES SIMULTÁNEAS (R7).** Test aparte porque es la
      propiedad que justifica el diseño: `Promise.all` de dos emisiones del mismo (usuario, evento,
      jornada) sobre **dos conexiones**, y se afirma **exactamente una** fila de cupo y **exactamente
      un** encolado.
      *Hecho:* pasa contra Postgres real. Mutación obligatoria: sustituir el `INSERT` por
      `SELECT`-y-luego-`INSERT` → el test se pone rojo (que es justo la carrera que el índice único
      cierra).

## Tanda 2 · Contratos y configuración `[P]` entre sí

- [x] **T2.1 [P] — `lib/config/push.ts`**: `loadPushConfig()`, `pushConfigurado()`,
      `PushNoConfiguradoError`. Espejo de `lib/config/email.ts`.
      *Hecho:* test unitario que, sin las variables, comprueba que `pushConfigurado()` es `false` y
      que **nada lanza**; y que un mensaje de error cita el **nombre** de la variable y jamás su
      valor. Cubre R29-R31.
- [x] **T2.2 [P] — `.env.example`**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, con el
      comentario de cómo se generan y la advertencia de darlas de alta **por entorno** en Vercel.
      *Hecho:* solo nombres, ningún valor.
- [x] **T2.3 [P] — `lib/interfaces/external/IPushSender.ts`** con `PushOutcome`
      (`ok` | `caducada` | `transitorio` | `rechazada`).
      *Hecho:* typecheck. El tipo no expone `endpoint` ni claves en `detalle`.
- [x] **T2.4 [P] — `lib/interfaces/repositories/IPushSuscripcionRepository.ts`.**
      *Hecho:* typecheck.
- [x] **T2.5 [P] — `lib/notificaciones/push-elegibles.ts`** — el catálogo de `design.md §3` como
      `satisfies Record<NotificacionEvento, PerfilPush>`, **sin `default` y sin `??`**.
      *Hecho:* un test comprueba que cada evento no elegible devuelve «no elegible», y **una mutación
      que añada un evento al enum sin entrada rompe el typecheck** (verificado a mano y anotado).
      Cubre R1-R4.
      *Ojo, y va con nombre para que no se «arregle» por parecer un error:* `geocodificacion_caida`
      es elegible **solo para `maestro`**; el `admin` conserva su aviso en la campana y **no** recibe
      push (`design.md §3.1`, decisión D4). Un test lo fija: marcarlo elegible para `admin` tiene que
      ponerse rojo.

## Tanda 3 · Emisión (depende de 1 y 2)

- [x] **T3.1 — `INotificacionRepository.crear` pasa a `Promise<string | null>`** y
      `NotificacionRepository.crear` devuelve el id creado; `emitirFilas` adapta su condición.
      *Hecho:* typecheck verde en todo el árbol (incluidos los dobles de test, que **deben** romper y
      arreglarse uno a uno) y la suite de notificaciones existente sigue pasando sin cambiar su
      comportamiento. Cubre `design.md §6.1`.
- [x] **T3.2 — `lib/repositories/PushSuscripcionRepository.ts`**: upsert por endpoint, borrar por
      endpoint, borrar por id, listar por usuarios, y **tomar el cupo del día** (INSERT que devuelve
      si ganó).
      *Hecho:* tests de integración de T1.4 apuntando ya al repositorio real.
- [x] **T3.3 — Resolución de destinatarios (`design.md §8`)** en el repositorio, derivada del **mismo**
      predicado de visibilidad, con el filtro `usuario.estado = 'activo'`.
      *Hecho:* test de integración que compara **conjunto contra conjunto** contra lo que
      `listarParaUsuario` devuelve a cada usuario sembrado, con filas de rol sin alcance, acotadas por
      tienda, acotadas por zona y dirigidas a un usuario. Mutar el `WHERE` lo pone rojo. Cubre R24-R26.
- [x] **T3.4 — `lib/notificaciones/notificacion-repo-con-push.ts`** (el decorador): tras un `crear`
      con id, evalúa elegibilidad → toma cupo → encola `push_web` con
      `dedupeKey = "push:<notificacionId>"` y `maxIntentos = 3`. Todo envuelto en `emitirBestEffort`.
      *Hecho:* unit con repositorio y cola dobles: (a) evento elegible encola una vez; (b) segunda
      llamada el mismo día no encola; (c) evento no elegible no encola; (d) un fallo al encolar **no**
      propaga y queda registrado con su operación y causa. Cubre R5-R7, R27, R28, R35.
- [x] **T3.5 — Cablear `repoReal()` en `lib/notificaciones/notificadores.ts`** con `conPushWeb(...)`.
      *Hecho:* **una guardia** que afirma que el repositorio que `repoReal()` construye está decorado
      y que **los diez** `notificar<X>Real` pasan por él. Mutación obligatoria: devolver el
      repositorio sin decorar → la guardia se pone roja. Es la familia «el composition root que no
      inyecta»: no vale comprobar que se importa, hay que ver que **alguien lo pasa**.
- [x] **T3.5b — Guardia del PRODUCTOR FUTURO (R51).** La misma guardia (o su hermana) recorre el
      árbol y afirma que **ningún** binding de producción de `notificadores.ts` construye
      `new NotificacionRepository(...)` por su cuenta: todos resuelven por `repoReal()`.
      *Hecho:* mutación obligatoria — añadir un `notificarXReal` que se salte `repoReal()` → **roja**.
      Sin esto, el noveno productor que alguien escriba dentro de seis meses se queda sin push **en
      silencio**, que es exactamente el fallo que el decorador vino a cerrar.
- [x] **T3.6 — Dependencia `web-push`** (+ tipos) y `lib/push/web-push-sender.ts`, único archivo que
      conoce la librería; traduce a `PushOutcome` y **nunca lanza** por un desenlace HTTP.
      *Hecho:* unit con `fetch`/cliente doble para 201, 404, 410, 429, 500 y error de red → cada uno
      a su `PushOutcome`. Cubre R33/R34.
      *Ojo:* esto obliga al gate completo (`package.json` + `pnpm-lock.yaml`).
- [x] **T3.7 — `lib/services/PushWebService.ts`**: lee la notificación por id; si no existe, o está
      leída, o está descartada → **termina** sin enviar (R8); resuelve presentación (`null` → termina
      y registra, `design.md §9`); resuelve destinatarios; itera suscripciones con un `try` por
      suscripción; aplica la tabla de desenlaces (`caducada` → borrar y **no** reintentar;
      `transitorio` → propagar para el backoff de la cola; `ok` → sella `ultimo_envio_ok_at`).
      *Hecho:* unit con dobles cubriendo los seis desenlaces + el caso «una suscripción falla y las
      otras dos se entregan igual» (R26) + «sin configuración → termina, no lanza» (R30).
- [x] **T3.7b — El texto no promete un número que no ha contado (R52).** Si T0.3 trajo el conteo, el
      push lleva la cifra; si no, sale en singular y **sin cantidad**.
      *Hecho:* dos tests con literales **fijados a mano** (contrato), no derivados de la función que
      los compone —comparar un texto contra su propia fuente está siempre verde—. Mutación
      obligatoria: hacer que el cuerpo afirme una cantidad sin conteo disponible → rojo.
- [x] **T3.8 — Registrar el handler `push_web` en `app/api/cron/procesar-jobs/route.ts`.**
      *Hecho:* una guardia comprueba que **todo** valor de `JobTipo` tiene handler registrado (un tipo
      sin handler es un job que falla para siempre en silencio). Cubre R36.
- [x] **T3.9 — `lib/actions/push.ts`**: `obtenerClavePublicaPush()`, `registrarSuscripcionPush(input)`,
      `eliminarSuscripcionPush(endpoint)`. Validación zod en el borde; el **usuario sale de la sesión**
      y nunca de la entrada (R50); sin sesión → `unauthenticated`.
      *Hecho:* unit con `getActor` doble: sin sesión no escribe nada; un `usuarioId` inyectado en la
      entrada **se ignora**; un endpoint mal formado da `validation_error`. Cubre R50.

## Tanda 4 · Service worker (depende de 2; `[P]` con la tanda 3)

- [x] **T4.1 [P] — Manejador `push` en `public/sw.js`**, dentro de la rama de producción: parseo
      defensivo, textos de reserva, `tag`, `data.destino`, icono.
      *Hecho:* guardia en `tests/unit/guards/` que **ejecuta** `public/sw.js` en un `new Function`
      con globales tapados (arnés ya existente en `pwa-relevo-y-purga.guardia.test.ts`) y dispara un
      `push` con payload bueno, payload ilegible y sin payload. Cubre R37, R38, R41, R42.
- [x] **T4.2 [P] — Manejador `notificationclick`**: cerrar, buscar ventana, `focus()` + `navigate()`,
      o `openWindow()`.
      *Hecho:* la misma guardia comprueba los dos caminos y que **no** se abre una segunda pestaña
      cuando ya hay una. Mutación obligatoria: quitar `focus()` → roja. Cubre R39, R40.
- [x] **T4.3 — Literal del mensaje al cliente** en `lib/pwa/actualizacion.ts` + `public/sw.js`.
      *Hecho:* guardia que comprueba que no divergen (precedente `ordenex:relevo-ahora`).
- [x] **T4.4 [P] — `public/icons/badge-72.png`** (D8): el **mismo glifo de paquete** que usa
      `design-notificaciones/Push.dc.html` —el icono `package` de `lucide`, ya dependencia— en
      **blanco sobre transparente, 72×72**. Android solo usa el canal alfa: un PNG a color sale como
      una mancha blanca.
      *Hecho:* el archivo existe, el `push` lo referencia y la guardia del service worker afirma que
      la ruta del `badge` apunta a un archivo que **existe en el árbol**. Si el asset no se produce,
      se **omite** el campo `badge` (nunca se deja apuntando a un 404) y se anota la deuda.

## Tanda 5 · Frontend (depende de 3 y 4)

- [ ] *(FRONTEND — tanda 5, otro agente sobre esta misma rama)* **T5.1 — `hooks/usePushSuscripcion.ts`**: soporte del navegador, estado del permiso, suscripción
      de **este** dispositivo, activar y desactivar.
      *Hecho:* unit en jsdom con `navigator.serviceWorker` / `Notification` / `PushManager` dobles:
      **al montar NO se llama a `requestPermission`** (R10, aserción sobre el no-llamado);
      `denied` no vuelve a pedirlo (R12); desactivar llama a `unsubscribe()` **y** a la acción de
      borrado (R15).
- [ ] *(FRONTEND — tanda 5)* **T5.2 — `components/shared/PushOptIn.tsx`**: los tres estados de R14, la explicación previa,
      el texto de recuperación para `denied` y la instrucción de **instalar en la pantalla de inicio**
      cuando el navegador no ofrece `PushManager` (R45).
      *Hecho:* unit que renderiza los cuatro casos (no soportado / sin activar / activado / bloqueado)
      y comprueba los literales **fijados a mano como contrato**, no generados por la propia fuente.
      *Ojo:* nada de «SLA» ni siglas en el texto visible.
      *Ojo, y es medido (D6):* la instrucción de instalar va **en el hueco exacto del control**, no en
      una ayuda ni en un pie. Son **3 de 18 mensajeros** los que solo entran desde iOS y a los que ese
      hueco vacío les parecería una avería. Un test afirma que en el caso «no soportado» **hay** texto
      accionable en el sitio del control, no ausencia.
- [ ] *(FRONTEND — tanda 5)* **T5.3 — Montarlo en el panel de la campana** (`NotificationsBell.tsx`, 1 import + 1 línea) y en
      el perfil. **Es el archivo que toca la 409: hacerlo con la 409 ya mergeada.**
      *Hecho:* unit del panel que lo encuentra renderizado; la suite existente de la campana sigue
      verde.
- [ ] *(FRONTEND — tanda 5)* **T5.4 — Un solo sonido (R43)**: la app escucha el mensaje del service worker, revalida la
      campana y **suprime su tono** para ese incremento.
      *Hecho:* unit de hook: llega el mensaje → hay revalidación y **cero** llamadas al tono; llega un
      incremento normal sin mensaje → el tono suena. Mutar la supresión lo pone rojo.
- [ ] *(FRONTEND — tanda 5)* **T5.5 — Baja al cerrar sesión**: el `LogoutButton` da de baja la suscripción de este
      dispositivo **antes** de `logout()`, y el fallo **no** impide salir.
      *Hecho:* unit donde la baja rechaza y aun así se llama a `logout()` y se navega. Cubre R19, R20.

## Tanda 6 · Cierre

- [x] **T6.1 — Las 11 mutaciones de `design.md §15`**, aplicadas una a una, cada una con el número de
      tests que pone en rojo y el archivo donde saltó.
      *Hecho:* la tabla escrita en `progress/impl_410.md`. Una mutación superviviente es un hallazgo,
      no una nota al pie. **Y el informe de mutaciones se autocomprueba**: si el arnés dice 11/11
      muertas sin haber ejecutado un test, no vale.
- [ ] *(INCOMPLETA A PROPOSITO: 41 de los 52 estan mapeados en `progress/impl_410_backend.md` §3; los 11 del frontend quedan DECLARADOS con su tarea, no olvidados)* **T6.2 — Mapa `R<n> → test`** para los **52** requisitos (R1-R52), en `progress/impl_410.md`.
      *Hecho:* ni un requisito sin test concreto; el reviewer rechaza si falta alguno.
- [x] **T6.2b — Los dos avisos SIN CUBRIR quedan escritos donde se lean.** «Su cierre fue rechazado»
      (sin bloqueo) y «tu reparto de mañana» **no se entregan** en esta ficha porque no existen como
      evento (D1, `design.md §3.2`).
      *Hecho:* dicho en `progress/impl_410.md` y en la nota de estado de la ficha, para que nadie los
      dé por hechos leyendo `design-notificaciones/Push.dc.html`, donde **sí** aparecen dibujados.
- [x] **T6.3 — `./init.sh` COMPLETO en verde**, con `INIT_EXIT` escrito **dentro** del log (un `echo`
      posterior tapa el código de salida) y sin canalizar por `tail` (trunca el fichero en origen).
      *Hecho:* log pegado, con el número de `skipped` de `tests/integration/db` a la vista.
- [ ] *(NO HECHA: este agente no tiene acceso a Vercel. BLOQUEANTE para que el canal funcione en produccion — sin las claves no sale ningun push, y por R30 en silencio)* **T6.4 — Alta de las tres variables VAPID en Vercel, POR ENTORNO** (producción y *preview* por
      separado; una variable compartida apunta al proyecto equivocado en uno de los dos).
      *Hecho:* anotado quién las dio de alta y en qué entorno. La privada **no** se pega en ningún
      informe.
- [ ] *(NO HECHA: hace falta un telefono real, las claves de T6.4 y el control de la tanda 5. Queda como LIMITE ABIERTO — es la unica prueba de que el canal existe)* **T6.5 — Comprobación en un teléfono real**: instalar la PWA, activar el control, provocar un
      aviso elegible, ver llegar el push con la app **cerrada**, tocarlo y aterrizar en el destino.
      *Hecho:* descrito paso a paso con el resultado. **Es la única prueba de que el canal existe**:
      todo lo anterior es jsdom, Postgres y un arnés. Si no se puede hacer, se declara como límite
      abierto en la ficha, no se da por bueno.
- [ ] *(a MEDIAS: `progress/impl_410_backend.md` escrita y commiteada; falta la bitacora del frontend y la entrada en `progress/history.md`, que es del leader)* **T6.6 — Bitácora**: `progress/impl_410.md` y entrada en `progress/history.md`, **commiteadas**
      (el informe describe el disco, no un commit: verificar el blob en la rama).
