# 410 — Bitácora del FRONTEND (tanda 5)

> Rama `feat/410-notificaciones-push-frontend`, nacida de **`origin/feat/410-notificaciones-push`
> @ `bd7e35ce`** (`docs(410): bitacora del backend, casillas de tasks.md y el log del gate`).
> Alcance: **solo la tanda 5** — T5.1 a T5.5, más el mapa de mis once requisitos y el gate.
> El canal (backend) es de `progress/impl_410_backend.md` y **no se ha tocado**.

## §0 — Lo primero que se comprobó: que no falta ni un commit del backend

El fallo que esto viene a evitar es el de hoy mismo en otra ficha: una rama de frontend que nace
**un commit antes** del último del backend y cuyo PR se mergea sin él, sin ninguna señal.

```
git rev-parse HEAD                                   -> bd7e35ce (al crear la rama)
git log --oneline HEAD..origin/feat/410-notificaciones-push   -> VACIO
git log --oneline origin/feat/410-notificaciones-push..HEAD   -> VACIO
```

Las **dos** direcciones, no solo una: la primera es la que dice que no me dejo nada suyo fuera.
Repetido antes de abrir el PR (§6).

### Nota de método (regla 7 de `CLAUDE.md`), dicha en voz alta

**El MCP `codebase-memory` SÍ estaba en mi conjunto de herramientas, y apenas lo usé.** La
localización se hizo leyendo los archivos reales (`grep`/`find` y lectura completa antes de editar).
Se dice porque la regla pide empezar por el grafo. La otra mitad de esa regla —«el archivo dice QUÉ
hay»— sí se cumplió sin excepción: ninguna afirmación de este informe sale de un índice, todas salen
de leer el archivo o de ejecutar.

---

## §1 — Archivos

### Nuevos

| Archivo | Qué es |
| --- | --- |
| `lib/pwa/push-navegador.ts` | **Módulo puro**: soporte del navegador, la clave pública a bytes, las claves de una suscripción y la etiqueta del dispositivo. No escribe en consola a propósito (R23) |
| `lib/pwa/baja-push.ts` | La baja de **este** dispositivo en un solo sitio. **No lanza nunca** (R20) y no deja salir el `endpoint` ni dentro del mensaje de un error |
| `hooks/usePushSuscripcion.ts` | El estado del canal en este dispositivo, y el **único** `requestPermission()` del árbol |
| `hooks/usePushEnVentana.ts` | Escucha `MENSAJE_PUSH_RECIBIDO` del service worker: revalida la campana y marca el incremento como «ya sonado» (R43) |
| `components/shared/PushOptIn.tsx` | El control: los tres estados de R14, la explicación previa, la recuperación de `denied` y **la instrucción de instalar** (R45) |
| `tests/fixtures/navegador-push.ts` | El doble del navegador (service worker, `PushManager`, `Notification`), compartido por los tres archivos de test que lo necesitan |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `components/shared/NotificationsBell.tsx` | +1 import, +1 línea (`<PushOptIn />`) y el cableado de `usePushEnVentana` al tono |
| `hooks/useTonoAlIncrementar.ts` | Segundo argumento **opcional**: `suprimirTonoDeEsteIncremento?()`. Sin él, comportamiento idéntico al de la 161 |
| `app/_components/LogoutButton.tsx` | Da de baja este dispositivo **antes** de `logout()` (R19/R20) |
| `lib/actions/push.ts` | **Se retiran las tres anotaciones `@sin-superficie`**: su motivo caducó al montar el control |
| `specs/410-notificaciones-push/tasks.md` | Casillas T5.1-T5.5 y T6.2 |

**NO se tocó:** nada del backend (`lib/services/**`, `lib/repositories/**`, `lib/notificaciones/**`,
`public/sw.js`, `db/**`), ni `feature_list.json`, ni `progress/current.md`, ni un solo test ajeno.
Los dos archivos de test nuevos que rozan superficies ajenas (`NotificationsBell.push.test.tsx`,
`LogoutButton.push.test.tsx`) van **aparte** de los existentes precisamente para no tocarlos: los 60
casos de `NotificationsBell.test.tsx`, `LogoutButton.test.tsx` y `useTonoAlIncrementar.test.tsx`
siguen pasando **sin una línea de cambio**.

---

## §2 — Las cinco decisiones que este frontend tomó, y por qué

### 2.1 — El permiso se pide en UN solo sitio, y el efecto de montaje no es ese sitio

`Notification.requestPermission()` aparece **una vez en todo el árbol**, dentro de `activar()`. El
efecto de montaje **lee** `Notification.permission` (leer no es pedir) y pregunta si este dispositivo
tiene suscripción. Un «no» del navegador es casi irreversible, así que adelantarlo por comodidad
costaría el canal para siempre en media plantilla — y en iOS `requestPermission` exige un gesto, o
sea que al cargar ni siquiera funcionaría.

La aserción que lo sostiene es **sobre el no-llamado**, y se espera al estado final antes de
afirmarla para que no sea un «aún no le ha dado tiempo».

### 2.2 — ⚠️ El orden es CANAL antes que SOPORTE, y no es un detalle de estilo

Cuando el navegador no trae `PushManager` (iPhone sin instalar) el control no se puede ofrecer, y en
su hueco va la instrucción de instalar. Pero **si además no hay claves VAPID, no va nada**: mandar a
alguien a instalar la app para un canal que no existe es hacerle dar un paso que no le sirve.

Hoy eso **no es hipotético**: T6.4 sigue sin hacer, así que en producción `clavePublica` es `null` y
el panel queda exactamente como estaba. En cuanto las claves entren, el control y la instrucción
aparecen solos, sin desplegar nada (R32: la clave se resuelve en tiempo de ejecución).

### 2.3 — La supresión del tono es una MARCA QUE CADUCA, no una bandera

R43 pide que un push recibido con la ventana visible no suene dos veces. La forma obvia —una bandera
«sáltate el próximo tono»— tiene un fallo mudo: si el push es de un aviso **no accionable**, el
contador no se mueve, la bandera no se consume y **se come el siguiente tono**, que era de otra cosa.

Aquí la marca es un instante, se consume en el primer incremento y **expira a los 10 s**
(`VENTANA_SUPRESION_TONO_MS`). El peor caso pasa a ser «un tono de más» en lugar de «todos los tonos
de menos». Hay un caso de test que ejercita justo eso.

### 2.4 — El compilador de React obligó a cambiar la forma de la supresión, y el cambio es mejor

La primera versión pasaba el `ref` de `usePushEnVentana` a `useTonoAlIncrementar` y lo mutaba allí.
`pnpm run lint` la rechazó con **dos errores** (`Cannot modify local variables after render
completes` / `This value cannot be modified`): un parámetro no se muta. Se sustituyó por una función
estable `suprimirTonoDeEsteIncremento()` que muta **su propio** ref dentro de su hook. Queda un solo
dueño de la decisión, que es lo que había que hacer de todas formas.

### 2.5 — La etiqueta del dispositivo es una LISTA BLANCA, no un user-agent recortado

`push_suscripcion.etiqueta` se guarda. Recortar el user-agent metería en la base el modelo del
teléfono y la versión exacta del navegador, o sea un rastro que identifica a la persona. La función
compone «Chrome en Android» a partir de una lista de nombres conocidos y, si no reconoce nada,
devuelve `undefined` y la fila se queda sin etiqueta. Un test afirma que `SM-A546E` y `131.0` **no**
salen.

---

## §3 — Mapa `R<n> → test` (los 11 que me tocan)

> Los literales visibles se afirman **A MANO**, nunca importando `TEXTOS` del componente: comparar un
> texto contra la función que lo compone diría «el componente dice lo que dice» y estaría siempre
> verde.
>
> `HOOK` = `tests/unit/hooks/usePushSuscripcion.test.tsx` (16) · `TONO` =
> `tests/unit/hooks/usePushEnVentana.test.tsx` (12) · `NAV` =
> `tests/unit/pwa/push-navegador.test.ts` (15) · `BAJA` = `tests/unit/pwa/baja-push.test.ts` (10) ·
> `OPT` = `tests/components/PushOptIn.test.tsx` (14) · `PANEL` =
> `tests/components/NotificationsBell.push.test.tsx` (8) · `SALIR` =
> `tests/components/LogoutButton.push.test.tsx` (6). **81 casos nuevos en 7 archivos.**

| R | Test |
| --- | --- |
| **R10** | `HOOK` › «al montar con TODO a favor, `requestPermission` NO se ha llamado ni una vez» y «leer el permiso ya concedido tampoco lo pide» + `OPT` › «encenderlo pide el permiso al navegador (y no antes)», que afirma el no-llamado **con el control ya pintado** |
| **R11** | `HOOK` › «al activar: pide permiso, se suscribe con la clave pública y registra en el servidor» (+ `userVisibleOnly` y la clave en bytes) + `OPT` › el mismo camino desde el interruptor |
| **R12** | `HOOK` › «al montar con el permiso denegado el estado es «bloqueado»» y «pulsar activar en ese estado NO llama a `requestPermission`» + `OPT` › «el interruptor queda inerte … y tocarlo NO vuelve a pedir nada» y «en el sitio de la explicación va la RECUPERACIÓN» (literal a mano) + su mutación |
| **R13** *(mitad cliente)* | `HOOK` › «`clavePublica: null` NO es un error: es el estado «sin canal»», «una lectura FALLIDA cae también hacia «sin canal»», «sin `PushManager` … es «no soportado», NO «sin canal»» y «sin `PushManager` Y sin canal manda el canal» + `OPT` › «`clavePublica: null` deja el hueco vacío del todo» **con su control positivo** + `PANEL` › «sin canal configurado el panel queda EXACTAMENTE como estaba» + `NAV` › las cinco combinaciones de soporte |
| **R14** | `OPT` › «caso «sin activar»…», «caso «activado»…», «el interruptor queda inerte y con su nombre de estado» — los tres nombres escritos a mano — + `HOOK` › «con una suscripción ya viva aquí, el estado es «activado»» y «sin suscripción aquí, «sin activar»» |
| **R15** *(mitad cliente)* | `HOOK` › «llama a `unsubscribe()` Y a la acción de borrado…» y «si la baja falla en el servidor, el control no se queda mintiendo «activado»» + `BAJA` › «borra la fila en el servidor Y se da de baja en el navegador» + `OPT` › «apagarlo da de baja este dispositivo en el servidor y en el navegador» |
| **R19** *(mitad cliente)* | `SALIR` › «borra la suscripción de este navegador y solo después llama a `logout()`» (afirma el **orden** y que el endpoint es el de ESTE navegador) + `BAJA` › «el SERVIDOR va primero» |
| **R20** *(mitad cliente)* | `SALIR` › «la acción de borrado rechaza: se sale, se navega, y se registra qué falló» + su **mutación** («si la baja NO fallara, tampoco habría registro») + `BAJA` › los cuatro caminos de fallo, ninguno lanza |
| **R43** *(mitad app)* | `TONO` › «la campana REVALIDA en el acto», «el tono propio NO suena para ese incremento», «MUTACIÓN: sin la supresión, ese mismo incremento SÍ sonaría», «el incremento siguiente vuelve a sonar», «una marca que NUNCA se consume CADUCA» + `PANEL` › «el mensaje del service worker dispara una lectura nueva del listado» y su mutación con otro mensaje |
| **R45** | `OPT` › «sin `PushManager` no hay interruptor, pero SÍ la instrucción de instalar» (las dos frases, palabra por palabra) y «la instrucción va EN EL HUECO DEL CONTROL» + `PANEL` › la misma comprobación **dentro del panel de la campana** |
| **R46** *(mitad cliente)* | `HOOK` › «sin suscripción aquí, «sin activar» — y la campana no se entera de nada» + `PANEL` › «sin canal configurado … la campana sigue entera» + `TONO` › «sin service worker en el navegador, la campana sigue funcionando igual» + `BAJA` › «sin suscripción en este dispositivo no se llama a nadie, y NO es un fallo» |

**Extra, no pedido por ningún requisito pero necesario para no mentir:** `NAV` › «NO deja pasar el
modelo del teléfono ni la versión» (R23 aplicado a la etiqueta) y `BAJA` › «un error que lleva el
endpoint dentro se registra SIN él» (R23 aplicado al log).

---

## §4 — El gate

`./init.sh` **COMPLETO**, que es el que esta ficha exige (el diff de la rama toca `db/migrations/**`,
`db/schema.prisma` y `package.json`: el rápido se niega solo, por partida triple).

`INIT_EXIT` va escrito **DENTRO** del log (`progress/gate_410_frontend.log`), inmediatamente después
del comando, y **no se canalizó por `tail`**. El exit code que devuelve el runner no vale: hoy cinco
gates ROJOS llegaron anunciados como «exit code 0».

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (412 fichas), cupo por zona respetado (in_progress=2) y specs en su sitio
✓ typecheck paso
✓ lint paso                     (184 warnings, 0 errores — los MISMOS 184 que traía la rama del backend)
✓ DATABASE_URL resuelta: los 163 archivos de tests contra Postgres SI se ejecutan
 Test Files  1919 passed (1919)
      Tests  27766 passed | 26 skipped (27792)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1919 ejecutado(s), todos en el baseline conocido)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

### Los `integration/db` CORRIERON — con número

`.env` copiado del checkout principal **tras comprobar que su `DATABASE_URL` activa apunta a
`localhost:5432/ordenex`** y no a Supabase (esa línea está comentada, verificado enmascarando la
credencial). Está gitignorado y no entra en ningún commit.

- **248 archivos bajo `tests/integration/db/` ejecutados con `✓`, y CERO saltados.** Contados sobre
  el log de la corrida, no sobre el aviso previo del gate.
- Los **26 `skipped`** de la suite son de otras familias (`AnaliticaPage` 17 + `AnaliticaShell` 9),
  ninguno de `integration/db`.
- Mis siete archivos, con sus casos, en esa misma corrida:

```
✓ tests/unit/hooks/usePushSuscripcion.test.tsx       (16 tests)
✓ tests/unit/hooks/usePushEnVentana.test.tsx         (12 tests)
✓ tests/unit/pwa/push-navegador.test.ts              (15 tests)
✓ tests/unit/pwa/baja-push.test.ts                   (10 tests)
✓ tests/components/PushOptIn.test.tsx                (14 tests)
✓ tests/components/NotificationsBell.push.test.tsx    (8 tests)
✓ tests/components/LogoutButton.push.test.tsx         (6 tests)
```

**Sin claves VAPID, que es lo normal aquí.** `.env` tiene **cero** ocurrencias de `VAPID`
(comprobado), así que la suite entera corre con el canal **sin configurar** y nada lanza. Ninguno de
mis 81 casos necesita esas claves: las que hacen falta se inyectan por el doble de
`obtenerClavePublicaPush`.

**Preparar el árbol costó dos cosas que conviene dejar escritas**, porque un worktree nuevo no las
trae: (a) `pnpm install --frozen-lockfile` **propio del worktree** —el `node_modules` enlazado por
junction al checkout principal hace que pnpm pida purgarlo y reinstalarlo entero, que es
exactamente lo que no se debe aceptar con otros árboles vivos—; y (b) `pnpm run db:generate`, porque
el cliente de Prisma del checkout principal no conocía `PushSuscripcion` ni `PushEnvioDia` y el
typecheck salía rojo con **11 errores que no eran de nadie**.

---

## §5 — Las doce mutaciones

> **Arnés con autocomprobación**, por la lección del que reportó 9/9 sin ejecutar un test. Corre
> contra el árbol **COMMITEADO** (`408ae49f`) y: (a) aborta si el árbol no está limpio antes de
> empezar; (b) exige que el texto a mutar exista **y** que el `git diff --stat` no salga vacío;
> (c) aborta si una corrida ejecuta **0 tests**; (d) revierte con `git checkout -- .` y **vuelve a
> comprobar** que el árbol quedó limpio antes de seguir. El script es de un solo uso y no se
> commitea.
>
> **Línea base sin mutar: 81 tests en los 7 archivos objetivo, 0 rojos.**

| # | Mutación | Rojos | Dónde saltó |
| --- | --- | --- | --- |
| M-F1 | pedir el permiso **al montar** | **9 / 81** | `HOOK` (los dos casos de R10 y otros) → **R10** |
| M-F2 | quitar la guarda de «denegado» en `activar()` | **1 / 81** | `HOOK` › «pulsar activar en ese estado NO llama a `requestPermission`» → **R12** |
| M-F3 | `desactivar()` sin llamar a la baja | **3 / 81** | `HOOK` + `OPT` → **R15** |
| M-F4 | **el hueco del control se queda VACÍO en un iPhone sin instalar** | **3 / 81** | `OPT` (los dos casos de R45) + `PANEL` → **R45** |
| M-F5 | ofrecer el control aunque NO haya canal | **2 / 81** | `OPT` + `PANEL` → **R13** |
| M-F6 | quitar la supresión del tono | **4 / 81** | `TONO` → **R43** |
| M-F7 | la campana deja de montar el control | **6 / 81** | `PANEL` → **T5.3** |
| M-F8 | salir sin dar de baja este dispositivo | **3 / 81** | `SALIR` → **R19** |
| M-F9 | dejar salir el `endpoint` dentro del mensaje de un error | **1 / 81** | `BAJA` › «un error que lleva el endpoint dentro se registra SIN él» → **R23** |
| M-F10 | propagar el fallo de la baja en vez de registrarlo | **4 / 81** | `SALIR` + `HOOK` + `BAJA` → **R20** |
| M-F11 | mirar el soporte con `in` en vez del valor | **1 / 81** | `NAV` › «un `serviceWorker` DECLARADO pero `undefined`…» → **R13** |
| M-F12 | volver a anotar `@sin-superficie` en una acción que YA tiene superficie | **1 / 18** | `tests/unit/guards/superficie-de-uso.guardia.test.ts` |

**Supervivientes: NINGUNO.**

Dos honestidades sobre el conteo:

- **M-F2, M-F9 y M-F11 matan UN test cada una, y es el correcto.** Son decisiones de una sola frase
  con un solo aserto que las nombra. Lo que importa es que ese aserto existe y se pone rojo, no
  cuántos arrastra.
- **M-F12 es la que prueba que borrar las tres anotaciones era obligatorio**, y no una limpieza
  opcional: volver a poner una sola pone roja la guardia, porque una excepción que sobrevive a su
  motivo es basura que crece.

Nada se re-midió después: desde la corrida de mutaciones solo han cambiado `tasks.md` y este
informe, que no son objetivo de ninguna.

---

## §6 — Lo que queda ABIERTO, con nombre

| Qué | Estado |
| --- | --- |
| **T6.4** — alta de las tres variables VAPID en Vercel, **por entorno** | **NO HECHA.** No tengo acceso a Vercel. **Es bloqueante para que el canal funcione en producción**: sin claves, `obtenerClavePublicaPush()` devuelve `null`, el control **no se ofrece** y no sale ningún push — correcto por R30, pero silencioso. Producción y *preview* por separado: una variable marcada en los dos a la vez apunta al proyecto equivocado en uno |
| **T6.5** — comprobación en un teléfono real | **NO HECHA, y es la única prueba de que el canal existe.** Todo lo que hay aquí es jsdom con un navegador de mentira. Necesita además T6.4 |
| **T5.3, mitad «perfil»** | **NO ENTREGADA porque esa pantalla NO EXISTE.** Medido: `find app -name page.tsx` da 33 rutas y ninguna es un perfil de la persona (`configuracion/**` es de administración y el mensajero no entra ahí). El panel de la campana vive en `PageHeader`, o sea en **todas** las pantallas autenticadas y para los cinco roles: el control ya es alcanzable para las 39 personas. No se inventa una pantalla para cumplir una casilla |
| **T6.6** | La bitácora del frontend es ésta y va commiteada. Falta **solo** la entrada en `progress/history.md`, que es del leader |

### Una observación sobre el backend, que NO se ha tocado

`public/sw.js` usa **voseo** en los textos de reserva del push («Tenés un aviso nuevo. Abrí la app
para verlo.») mientras que toda la interfaz de la campana usa **tuteo** («No tienes notificaciones»,
«Marcar todas como leídas»). Mis textos van en tuteo, para no mezclar registros dentro del mismo
panel. La reserva del service worker solo se ve cuando el contenido de un push no se puede
interpretar, así que no es urgente — pero es una inconsistencia real y **se deja dicha en vez de
arreglarla por mi cuenta**, que es lo que toca con un archivo que no es de mi tanda.

### Lo que este frontend NO puede probar, y se dice

Que un push llegue de verdad depende de servicios de terceros (Google, Mozilla, Apple) que ninguna
suite de este repositorio toca, y de un service worker que **en `localhost` se autodestruye** por
diseño (R42). Todo lo verificado aquí es jsdom con un navegador de mentira. **Nadie ha visto todavía
un push en un teléfono.**

---

## §7 — Veredicto

Los once requisitos de la tanda 5 están cubiertos con test concreto, las doce mutaciones murieron y
el gate completo termina en `INIT_EXIT=0` con 1919 archivos, 27766 tests y los 248 de
`integration/db` ejecutados sin uno solo saltado. El control se ofrece **solo** donde hay canal, el
permiso sale **solo** del gesto de la persona, y el hueco donde iría el interruptor **nunca se queda
vacío** en un iPhone sin instalar. **El canal sigue sin existir en producción hasta que alguien dé de
alta las claves VAPID (T6.4) y lo vea llegar a un teléfono (T6.5).**
