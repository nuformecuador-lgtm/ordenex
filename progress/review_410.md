# review 410 — el canal de push web (backend + frontend)

- **Revisado:** PR **#781**, rama `feat/410-notificaciones-push-frontend`, base `dev`.
  **Cabeza revisada: `e28203b8`** (los cinco commits del encargo: `886ff7ce`, `bc00ff3c`,
  `bd7e35ce`, `408ae49f`, `e28203b8`). Base común con `dev`: `ca697141`.
- **Método:** en el worktree de la rama, con `.env` y `node_modules` propios. `./init.sh`
  **completo** corrido por mí con `INIT_EXIT` escrito DENTRO del log
  (`progress/gate_review_410.log`), sin canalizar por `tail`. Las **ocho mutaciones** las apliqué
  yo, revirtiendo y comprobando árbol limpio entre cada una. Las **migraciones las ejercité yo**
  (up entonces down entonces up) contra `localhost:5432/ordenex`, midiendo los dos enums antes y
  después. **No edité una sola línea de producción ni `feature_list.json`.**
- **`dev` avanzó 10 commits** desde la base. Comprobado: **cero migraciones nuevas**, y los enums
  `JobTipo` y `NotificacionEvento` de `origin/dev` son **idénticos** a los de `ca697141`.
  `git merge-tree origin/dev <rama>` termina sin conflictos (exit 0).

---

# VEREDICTO: **RECHAZADO**

**2 bloqueantes de requisito + 1 de checkpoint.** El canal está bien construido —el decorador, el
espejo del predicado, la tabla de desenlaces y el hueco de iOS son correctos, y lo demostré matando
mutaciones—, pero **dos de los 52 requisitos no tienen un test que los verifique**, y en los dos
casos lo demostré con una mutación que **sobrevive** a la suite entera de la ficha.

| # | Bloqueante | Una línea |
| --- | --- | --- |
| **B1** | **R7 — la exclusión estructural no está probada** | Sustituir la toma de cupo por un comprobar-antes (SELECT y luego INSERT, sin exclusión) deja **157/157 verdes**, y el caso de la carrera pasa **5 de 5 veces** |
| **B2** | **R51 — la guardia del cableado tiene un punto ciego** | Un productor nuevo **fuera de `notificadores.ts`** que construya su propio `NotificacionRepository` deja **213 archivos de guardias y 3.124 tests en verde**: se queda sin push **en silencio**, que es exactamente lo que R51 prohíbe |
| **B3** | **CHECKPOINTS — `tasks.md` no está entera** | 37 marcadas y **3 sin marcar**: T6.4 (claves VAPID en Vercel, que el propio implementador declara **bloqueante para producción**), T6.5 (teléfono real) y T6.6 (falta `progress/history.md`) |

**B1 y B2 son del implementador y se arreglan sin tocar código de producción** (el código de
producción es correcto: lo que falta es el test que lo defienda). **B3 no es suyo**: T6.4 y T6.5
necesitan Vercel y un teléfono, y T6.6 es del leader.

---

## Checklist de `CHECKPOINTS.md`

### Especificación
- [x] `requirements.md` con **52** requisitos EARS numerados R1 a R52.
- [x] `design.md` con alternativas descartadas y su porqué (A1 el notificador por productor, A2 el
      envío en línea, A3 un job por suscripción, A5 firmar VAPID a mano, A6 reusar la dedupe del aviso).
- [ ] **`tasks.md` con todas las tasks marcadas: NO.** 37 marcadas, 3 sin marcar (**B3**). Las tres
      llevan su motivo escrito **dentro de la casilla**, que es lo correcto, pero el checkpoint pide
      todas marcadas.

### Trazabilidad
- [x] Cada requisito mapea a un test concreto: **41 en `progress/impl_410_backend.md` seccion 3** y
      **11 en `progress/impl_410_frontend.md` seccion 3**. Recorrí los 52 uno a uno.
- [ ] **Dos de esos mapeos no resisten: R7 y R51** (B1, B2). El test existe y tiene asertos, pero
      **no verifica lo que dice verificar** — que es, literalmente, el criterio de rechazo de
      `docs/verification.md`.
- [x] Las dos bitácoras existen y van commiteadas en la rama (verificado sobre el blob, no sobre el
      disco).

### Calidad de código
- [x] `pnpm run typecheck` verde en mi corrida.
- [x] `pnpm run lint` verde (184 warnings, 0 errores; ninguno en un archivo de la ficha).
- [~] `pnpm test`: ver «El gate» abajo. **INIT_EXIT=1 en mi corrida, por 1 rojo que NO es de esta
      ficha** y que pasa aislado 2 de 2.
- [n/a] E2E: no hay arnés de Playwright en este repo y los specs existentes lo declaran NOT EXECUTED.
      El riesgo equivalente lo cubre **T6.5**, que queda abierta con nombre.

### Datos y seguridad
- [x] **RLS medida en la base viva**, no leída del SQL: `relrowsecurity` es true y hay **0 policies**
      en `push_suscripcion` y en `push_envio_dia`. Patrón `jobs` / `notificacion`, correcto (R47).
- [x] Las dos migraciones tienen su `down.sql` y **las revertí yo** (detalle abajo).
- [x] Ningún secreto en el repo: `.env.example` documenta los **tres nombres** VAPID y **ninguno
      lleva valor**; ningún archivo de código asigna una clave a un literal.
- [n/a] Webhooks: esta ficha no añade ninguno.

### Patrón de capas
- [x] `PushSuscripcionRepository` y `PushNotificacionReader`: solo Prisma, ni una regla.
- [x] `PushWebService`: ni Request, ni Response, ni headers; todo entra por constructor.
- [x] `lib/actions/push.ts`: Server Actions, no rutas API internas.
- [x] Interfaces separadas por categoría: `external/IPushSender.ts`,
      `repositories/IPushSuscripcionRepository.ts`, `services/IPushWebService.ts`.

### Permisos
- [x] **R50 verificado:** los dos schemas son `strict()` y el `usuarioId` sale de la sesión
      (`resolveActorFromSession`); mandar un `usuarioId` en el cuerpo da `validation_error`.

### Multi-país / configuración
- [x] Ni país, ni moneda, ni cuenta hardcodeados. La jornada es `fechaCalendarioCR`, la misma unidad
      que ya usan los avisos periódicos.

### Verificación final
- [ ] `./init.sh` en verde: **en mi corrida no** (1 rojo ajeno, ver abajo).
- [x] `progress/review_410.md` existe (este archivo).
- [ ] Entrada en `progress/history.md`: **falta** (T6.6, del leader).

---

## El gate: dos corridas, y el rojo no es de esta ficha

`./init.sh` **completo** (el diff toca migraciones, `db/schema.prisma` y `package.json`: el rápido
se niega por partida triple). `INIT_EXIT` escrito dentro del log.

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 163 archivos de tests contra Postgres SI se ejecutan
 Test Files  1 failed | 1918 passed (1919)
      Tests  1 failed | 27765 passed | 26 skipped (27792)
✗ hay rojos NUEVOS respecto del baseline
   - tests/integration/repositories/historico-conversaciones.int.test.ts
INIT_EXIT=1
```

⚠️ **El runner anunció «exit code 0».** El veredicto real está DENTRO del log, como manda el arnés.

**El rojo es contención de la base compartida, no de la 410.** El caso que falla es
«321 / R36: un termino que no casa nada devuelve la lista vacia», y lo que casó fue una fila
sembrada por la propia ficha 321 (`num_remision` con prefijo `rem-321-`): datos de otra corrida
sobre la **misma base local**. Es la familia «base local compartida rompe gates ajenos», no un fallo
del canal de push.

**Las dos corridas aisladas, las dos verdes:**

```
corrida 1: Test Files 1 passed (1) · Tests 27 passed (27) · 1.44s
corrida 2: Test Files 1 passed (1) · Tests 27 passed (27) · 1.23s
```

**Y lo que el encargo pedía comprobar expresamente: los 2BP01 están resueltos DENTRO de esta rama.**
En mi log del gate hay **cero** ocurrencias de 2BP01 y **cero** de 40P01, y los siete
`notificacion-evento-*-migration` salen en verde:

```
✓ notificacion-evento-webhook-suscripcion-migration.test.ts   (22 tests)
✓ notificacion-evento-geocodificacion-caida-migration.test.ts (27 tests)
✓ notificacion-evento-avisos-agregados-migration.test.ts      (20 tests)
✓ notificacion-evento-dia-reparto-corregido-migration.test.ts (22 tests)
✓ notificacion-evento-bloqueo-cierre-migration.test.ts        (15 tests)
✓ notificacion-evento-gasto-fijo-migration.test.ts            (20 tests)
✓ notificacion-evento-postulacion-recurso-migration.test.ts   (19 tests)
```

**Y los 20 archivos de la ficha, corridos por mí sobre el árbol limpio: 238/238 verdes**
(157 del backend en 13 archivos, 81 del frontend en 7).

---

# BLOQUEANTES

## B1 · `BLOQUEANTE` · R7: ningún test se pone rojo si la exclusión deja de ser estructural

R7 dice, con todas las letras: «la exclusión DEBE ser estructural (una restricción de unicidad),
**no una comprobación previa que una carrera pueda burlar**».

**El código de producción es correcto.** `PushSuscripcionRepository.tomarCupoDelDia` inserta y
traduce P2002 a `false`; no hay SELECT previo. Eso lo leí y lo confirmo.

**Lo que no existe es el test.** Sustituí la implementación por la que R7 prohíbe —comprobar antes y
decidir con lo leído— y la suite entera de la ficha no se entera. La mutación, en
`lib/repositories/PushSuscripcionRepository.ts`:

    const previo = await this.prisma.pushEnvioDia.findFirst({
      where: { usuarioId: toma.usuarioId, evento: toma.evento, diaCr: toma.diaCr },
      select: { id: true },
    });
    if (previo !== null) return false;
    try { await this.prisma.pushEnvioDia.create({ ... }); } catch { /* se ignora */ }
    return true;   // quien leyó cero se cree con derecho a empujar

| Corrida con la mutación puesta | Resultado |
| --- | --- |
| `push-cupo-carrera` + `push-canal-restricciones` + `notificacion-repo-con-push` | **26/26 verdes** |
| `push-cupo-carrera` sola, **5 veces seguidas** | **4/4 verdes, las cinco veces** |
| Los **13 archivos** del backend de la ficha | **157/157 verdes** |

### Mi juicio sobre la honestidad declarada: es correcta, y se queda corta

El implementador escribió (backend, seccion 6):

> «el caso principal afirma "exactamente un cupo, exactamente un encolado", y eso se cumpliría
> también si las dos llamadas se hubieran serializado solas. Lo que demuestra que la ventana existe
> de verdad es el segundo caso, el de la mutación SELECT-y-luego-INSERT, que usa una barrera
> explícita y afirma [true, true].»

**La primera mitad es exacta**, y mi medición la convierte de hipótesis en hecho: en esta máquina
las dos llamadas **se serializan siempre** (5 de 5), así que el caso principal **nunca llega a medir
la ventana**. No es que «podría no medirla»: no la mide.

**La segunda mitad no prueba lo que dice.** El segundo caso **no ejecuta el código de producción**:
reproduce el SELECT y el INSERT **a pelo, con SQL escrito dentro del test**. Lo que demuestra es una
propiedad **del motor y del índice** —que la ventana existe y que el índice único la cierra—, y eso
es cierto y vale la pena. Pero es indiferente a lo que haga `tomarCupoDelDia`: mi mutación lo deja
verde. Dicho de otro modo, el segundo caso **no es el control del primero**; es un caso aparte sobre
Postgres. El eslabón que falta —«y el código de producción es el que se apoya en ese índice»— no lo
afirma nadie.

### Qué falta, en concreto

Un caso que **interponga la barrera dentro del camino real**. `PushSuscripcionRepository` recibe un
`Pick<PrismaClient, "pushSuscripcion" | "pushEnvioDia">`, así que hay costura: envolver ese cliente
de modo que **`pushEnvioDia.create` espere a que las dos conexiones hayan llegado** antes de
ejecutar, y llamar a `tomarCupoDelDia` desde las dos a la vez.

- Con el código bueno: los dos `create` corren a la vez, uno se lleva P2002, resultado **un cupo y
  un encolado**, verde.
- Con comprobar-antes: los dos ya decidieron `true` antes de la barrera, resultado **dos encolados**,
  rojo.

La barrera va en `create` y no en `findFirst` **a propósito**: `create` lo llaman las dos versiones,
así que el caso no puede quedarse colgado contra la implementación buena.

## B2 · `BLOQUEANTE` · R51: la guardia solo mira `lib/notificaciones/notificadores.ts`

R51: «Un productor nuevo que no pase por él **DEBE poner en rojo una guardia**: NO DEBE quedarse sin
push en silencio.»

**Lo que sí funciona, y lo maté yo:**

| Mutación mía | Rojos |
| --- | --- |
| `repoReal()` devuelve el repositorio SIN decorar | **3** — los dos casos de forma **y el del camino REAL ejecutado** |
| Un productor 13.º **dentro de `notificadores.ts`** con su propio repositorio | **5** — 4 de `push-cableado-unico` mas el censo de `notificacion-notificadores-reales` |

**Lo que no funciona.** Creé el mismo productor **en otro archivo**
(`lib/notificaciones/notificador-satelite.ts`):

    export const notificarCierreDiaPorAprobarSateliteReal: CierreNotificador = async (ctx) =>
      notificarCierreDiaPorAprobarCon(new NotificacionRepository(getPrismaClient()))(ctx);

El evento `cierre_dia_por_aprobar` **es elegible** para `admin` y `adminSatelite`, así que ese
productor avisaría en la campana y **jamás empujaría**. Resultado de `pnpm run test:guardias`:

```
 Test Files  213 passed (213)
      Tests  3124 passed (3124)
```

**213 archivos de guardias en verde con el canal saltado.** Es, línea por línea, el fallo que esta
ficha existe para cerrar —«2 de 7 notificadores muertos con la suite en verde»— y la guardia lo deja
pasar porque **lee un solo archivo** (`RUTA_NOTIFICADORES`), no el árbol.

**Y hay un caso vivo hoy que el mismo censo tiene que recoger:** `lib/notificaciones/emitir.ts`
línea 267 construye su propio `NotificacionRepository(tx)` dentro de `emisorNotificacionReal`. Hoy
es inofensivo —emite `orden_rechazada`, que **no** es elegible, y además el decorador se retira solo
cuando hay `tx` (R27)—, pero **nada afirma que eso siga siendo verdad**: el día que un evento
elegible se emita dentro de una transacción, no habrá push y no fallará nada.

### Qué falta, en concreto

Convertir la guardia en un **censo con lista blanca sobre `lib/` y `app/`** (el patrón que este repo
ya usa en media docena de guardias): toda aparición de `new NotificacionRepository(` fuera de las
entradas declaradas —`notificadores.ts` dentro de `repoReal()`, `emitir.ts` con su motivo escrito y
`lib/actions/notificaciones.ts` por ser solo lectura— pone rojo. Y con su autocomprobación, que esta
guardia ya sabe hacer: inyectar el archivo intruso en el recorrido y comprobar que lo caza.

## B3 · `BLOQUEANTE` de checkpoint · `tasks.md` no está entera (y no es del implementador)

- **T6.4, las tres variables VAPID en Vercel, por entorno.** Sin ellas `obtenerClavePublicaPush()`
  devuelve `null`, el control **no se ofrece** y no sale ni un push. Por R30 eso es **correcto y
  silencioso**, o sea que mergear esto entrega **cero valor observable** hasta que alguien con acceso
  a Vercel las dé de alta, **en Production y en Preview por separado**.
- **T6.5, un teléfono real.** Es la única prueba de que el canal existe. Todo lo verificado aquí
  —incluido lo que verifiqué yo— es jsdom, Postgres y un arnés que ejecuta `public/sw.js` en un
  `new Function`. **Nadie ha visto todavía un push en un teléfono.**
- **T6.6, falta la entrada en `progress/history.md`.**

---

# MENORES

**m1 · La lista de nueve valores del `down.sql` del enum es un literal, y su test también.**
`push-migration` › «recrea el enum con los NUEVE valores previos» compara el `CREATE TYPE` del
archivo contra **una lista escrita a mano en el propio test**. Los dos son la misma foto: si otra
ficha añade un valor a `job_tipo` y entra en `dev` antes que ésta, el `down.sql` **lo borraría en
silencio** y el test seguiría verde. Hoy **no pasa** —lo medí: el enum vivo es exactamente esos nueve
mas `push_web`, y `dev` no ha añadido ninguno—, y el aviso está escrito en el `down.sql`, en el test
y en la bitácora. Pero la protección es prosa. Una consulta a `pg_enum` comparando la lista contra
**el enum vivo menos `push_web`** lo automatiza y se pone roja sola el día que `dev` se mueva.

**m2 · `pnpm run db:rollback` solo revierte la última carpeta POR NOMBRE.** Lo medí: tras revertir
`20260912120100_job_tipo_push_web`, la segunda llamada vuelve a elegir **la misma carpeta** y muere
con «ERROR: la sintaxis de entrada no es válida para el enum job_tipo: push_web». Es una limitación
**del script**, no de estos `down.sql`, correctamente declarada en la bitácora. R49 se cumple para la
última migración; la anterior hay que ejecutarla con `prisma db execute`.

**m3 · Voseo en `public/sw.js` frente al tuteo de toda la campana.** El cuerpo de reserva dice
«Tenés un aviso nuevo. Abrí la app para verlo.» mientras el panel dice «No tienes notificaciones» y
«Te avisamos en este teléfono…». **Mi juicio: NO merece ficha propia.** Son dos constantes, solo se
ven cuando un push no se puede interpretar, y hay trabajos ya en cola que tocan ese archivo o su
entorno (T6.4 y T6.5, y las fichas 412 y 413 cuando entren al catálogo). Que se arregle en el primero
de ellos; abrir una ficha para dos literales es más ceremonia que trabajo.

**m4 · La `status_note` de la 410 en `feature_list.json` sigue prometiendo los dos avisos que la
ficha NO entrega.** T6.2b dice «dicho en `progress/impl_410.md` y en la nota de estado de la ficha».
Lo comprobé sitio por sitio:

| Sitio | ¿Está dicho? |
| --- | --- |
| `design.md` seccion 3.2 | **SÍ** — tabla con los dos, «SIN CUBRIR · ficha aparte» |
| `requirements.md` (decisión D1) | **SÍ** — con nombre y apellido |
| `progress/impl_410_backend.md` seccion 7 | **SÍ**, y es la sección que el mensaje del commit manda leer |
| `feature_list.json`, `status_note` de la 410 | **NO** — sigue diciendo «Mensajero: su cierre rechazado, quedo bloqueado, **su reparto de mañana**, le cambiaron el dia» sin ninguna salvedad |

**El implementador hizo lo correcto no tocando `feature_list.json`.** Lo que falta es una línea del
leader. Atenuante medido: las fichas **412** (`spec_ready`) y **413** (`pending`) existen y sus
`status_note` dicen «DESTAPADA AL ESPECIFICAR LA 410», así que la información está en el estado, pero
en la ficha hermana y no en la que alguien lee cuando abre el lienzo.

**m5 · `tests/components/NotificationsBell.test.tsx` (suite de la 409) ahora escupe «cookies was
called outside a request scope» en sus casos.** `PushOptIn` llama a la Server Action real dentro del
panel. Los tests **pasan** —el error se traga, la clave cae a `null` y el control no se pinta—, pero
eso significa que en esos casos el control es **inerte**, y el ruido en el log es de los que enseñan
a no leer el log. El doble ya existe: `tests/fixtures/navegador-push.ts`.

**m6 · Un reintento del job `push_web` vuelve a enviar a las suscripciones que ya habían entregado.**
`ejecutar` lanza si **alguna** suscripción quedó transitoria, y al reintentar `usuariosConCupoDe`
devuelve el mismo conjunto: el dispositivo que sí recibió vuelve a vibrar. La etiqueta de R41 colapsa
la tarjeta en la bandeja, así que la persona ve **una**, pero suena dos veces. Roza R6 por el borde.

**m7 · El contacto por defecto de VAPID (`mailto:soporte@` del dominio) es la única aparición de esa
dirección en el repo.** Es el buzón de abuso que los servicios de push usan para avisarnos. Al hacer
T6.4, dar de alta `VAPID_SUBJECT` con un buzón que exista de verdad.

---

## Lo que verifiqué yo, requisito por requisito

**Recorrí los 52.** De ellos, **50 tienen un test que de verdad los verifica** y **2 no**: R7 (B1) y
R51 (B2, parcial: cubre el productor dentro del archivo, no fuera).

Lo que **medí o ejecuté yo mismo**, más allá de leer el mapa:

| Qué | Cómo | Resultado |
| --- | --- | --- |
| **R6** | mutación: P2002 también gana el cupo | **2 rojos** en `push-canal-restricciones` y `push-cupo-carrera` |
| **R7** | mutación: comprobar-antes, sin exclusión | **SUPERVIVIENTE, 157/157 verdes** → **B1** |
| **R24/R25** | mutación: quitar la rama de ZONA de `predicadoDestinatariosDeAviso` | **2 rojos** en `push-destinatarios-equivalencia` |
| **R33** | mutación: `caducada` no borra la suscripción | **1 rojo** — «la suscripcion se BORRA y el trabajo TERMINA» |
| **R39** | mutación: quitar `focus()` de `public/sw.js` | **3 rojos** en `pwa-push.guardia` |
| **R45 (iOS)** | mutación: el caso «no soportado» devuelve `null` | **3 rojos exactos** (abajo) |
| **R51 (a)** | mutación: `repoReal()` sin decorar | **3 rojos** |
| **R51 (b)** | productor 13.º dentro de `notificadores.ts` | **5 rojos** |
| **R51 (c)** | productor 13.º **en otro archivo** | **0 rojos, 3.124 tests verdes** → **B2** |
| **D4** | mutación: `geocodificacion_caida` también al `admin` | **1 rojo** — «el admin NO recibe push, aunque la campana SI le mande el aviso». La asimetría está defendida |
| **R29/R30** | medido: ocurrencias de VAPID en `.env` | **0** en el worktree **y 0 en el checkout principal**. La suite entera —238 tests de la ficha— corre con el canal **sin configurar** y **nada lanza**. Confirmada la lección de la 400 |
| **R47** | medido contra la base viva (`pg_class` y `pg_policy`) | RLS activada y **0 policies** en las dos tablas |
| **R49** | up, down y up otra vez, ejecutados por mí | detalle abajo |
| **R9 / R52** | leído el test | los literales del cuerpo se afirman **a mano**; el archivo **no importa `presentacionDe`**. La trampa «aserción contra su propia fuente» **no está** |
| **R24** (dobles) | leído el test | la equivalencia se mide **contra Postgres**, conjunto contra conjunto, con **control positivo antes** (el conjunto de la campana tiene que ser no vacío) y **falla ruidosamente** si la tabla `orden` está vacía. No hay «test verde sin datos» |

### La mutación de iOS, reaplicada: **3 rojos, exactamente los declarados**

```
× R45: en un navegador sin PushManager, en su sitio va la instrucción de instalar   (NotificationsBell.push)
× sin PushManager no hay interruptor, pero SÍ la instrucción de instalar            (PushOptIn)
× la instrucción va EN EL HUECO DEL CONTROL: es el único contenido que el componente pinta (PushOptIn)
 Test Files  2 failed | 1 passed (3)
      Tests  3 failed | 35 passed (38)
```

El hueco está cubierto y **en el sitio exacto**: el componente devuelve la instrucción en lugar de
`null`, con las dos frases afirmadas palabra por palabra, y el caso «es el único contenido que el
componente pinta» impide que mañana alguien la mueva a un pie. Las tres mensajeras que solo entran
desde iPhone encuentran algo accionable donde las otras 36 encuentran el interruptor.

### Las suscripciones muertas: se retiran de verdad

`WebPushSender` traduce **404 y 410** a `caducada` (429 y 5xx a transitorio, el resto a rechazada);
`PushWebService` llama a `eliminarPorId`, que es un `deleteMany` —no un `delete`, para que una
corrida concurrente que ya la borró no convierta una limpieza en un fallo del job— y **no reintenta**.
Quitar el borrado pone rojo el caso que lo nombra. La cola no acumula basura.

---

## Las dos migraciones y sus `down.sql`: **ejercitadas por mí**

Los dos hallazgos del implementador son **ciertos**, y los dos los medí.

### (a) `push_envio_dia.evento` es la SEGUNDA columna del esquema que usa `notificacion_evento`

Medido contra la base viva:

```
columnas que usan notificacion_evento => notificacion.evento y push_envio_dia.evento
```

Antes de esta ficha era **una**. Consecuencia: los `down.sql` que amplían ese enum lo **recrean**
retipando una sola columna, así que con la tabla de push viva el DROP TYPE del tipo viejo muere con
2BP01. **No tocó ninguno de esos cinco `down.sql`, y hace bien:** `db:rollback` va de la última hacia
atrás y la de push es **posterior**, así que cuando les llega el turno la tabla ya no existe. Lo que
arregló son sus **controles de test** —que ejecutan un down histórico contra la base de HOY— con
`soltarDependientesPosterioresDelEnumDeEventos(tx)`, dentro de una transacción revertida.
**Correcto.** La obligación para el futuro —retipar **las dos** columnas— queda escrita en
`db/schema.prisma`, pegada al modelo (líneas 3515 a 3529), y el modo de fallo si se olvida es
**ruidoso**, que es el correcto. En mi gate: **cero 2BP01** y los siete tests de enum en verde.

### (b) Su propio `down.sql` moría por el índice parcial de la 401, y lo suelta y recrea

**Ejecutado, no razonado.** `pnpm run db:rollback` dio «Rollback completado:
20260912120100_job_tipo_push_web». Estado medido **inmediatamente después**:

```
job_tipo            => liberar_reprogramadas, geocodificacion, optimizacion_ruta, webhook_estado,
                       whatsapp_template_sync, whatsapp_chat_envio, analitica_rollup_diario,
                       analitica_invalidacion_cache, whatsapp_bienvenida     (9, sin push_web)
indice de la 401    => CREATE INDEX jobs_geocodificacion_estado_updated_idx ON public.jobs
                       USING btree (estado, updated_at) WHERE (tipo = 'geocodificacion')
notificacion_evento => los 13 valores, INTACTOS
```

El índice parcial **se recreó con su predicado retipado contra el `job_tipo` nuevo**: el paso extra
funciona. Después, el `down.sql` de `push_suscripcion` a mano (por m2):

```
tablas push         => ninguna (las dos fuera)
notificacion_evento => los 13 valores, INTACTOS
```

Y la reaplicación: `prisma migrate deploy` dio «All migrations have been successfully applied» y
`prisma migrate status` dio «Database schema is up to date!». **La base quedó como estaba**, y los 20
archivos de la ficha vuelven a dar **238/238**.

### La pregunta del encargo, contestada: revertir NO borra valores de enum ajenos

- **`notificacion_evento`**: el `down.sql` de push **no lo toca** —no creó ese enum, solo lo usaba—.
  Medido antes y después de los dos pasos: **13 valores, los mismos**. Cero riesgo.
- **`job_tipo`**: su `down.sql` **sí** recrea el tipo con una lista de nueve. Comparé esa lista
  contra el enum **vivo** y contra `origin/dev`: el enum vivo es **exactamente esos nueve mas
  `push_web`**, y `dev` —pese a sus 10 commits— **no ha añadido ninguna migración ni ningún valor**.
  **Hoy no se pierde nada**, y lo comprobé ejecutándolo. El riesgo para mañana es real pero está
  declarado en tres sitios; lo anoto como **m1** porque la protección es prosa y podría ser una
  consulta.

---

## Las decisiones cerradas, comprobadas (no las reporto como hallazgo)

- **`geocodificacion_caida` SOLO al maestro (D4):** la asimetría existe, está explicada en el
  catálogo con seis líneas de porqué, y **hay un test que se pone rojo si alguien la «arregla»**: lo
  maté yo (1 rojo). El `admin` sigue viendo el aviso en su campana; la 401 no se toca.
- **El cupo se toma INSERTANDO:** el código lo hace. Lo que falta es el test que lo defienda (B1).
- **`clavePublica: null` significa «no hay canal» y no es error:** confirmado en el hook (estado
  `sin-canal`), en la acción (devuelve ok con la clave en null) y en el componente (devuelve `null`,
  sin pintar un error). Una lectura **fallida** cae también hacia «sin canal»: prometer menos y
  cumplir.
- **Un decorador, no ocho inyecciones:** confirmado. `repoReal()` es la única línea, los doce
  `notificar*Real` la usan, y los **ocho eventos elegibles** tienen su `notificar*Real` allí. Ningún
  emisor de un evento elegible se usa fuera de `lib/notificaciones/`. El punto ciego es B2.

## El menor declarado de T5.3, juzgado

**Correcto, y bien resuelto.** Verifiqué la medida: buscar `page.tsx` bajo `app` da **34 rutas**
(eran 33; `dev` añadió una) y **ninguna es un perfil de la persona** — `mi-wallet` es la cartera del
mensajero y `configuracion/` es administración. El panel de la campana vive en `PageHeader`, o sea en
todas las pantallas autenticadas y para los cinco roles. **No inventarse una pantalla para cumplir
una casilla es la decisión correcta**, y queda escrita con su medida en la casilla y en la bitácora.

---

## Qué hace falta para que esto pase a OK

1. **B1** — un caso que interponga una barrera **en `pushEnvioDia.create`** y llame a
   `tomarCupoDelDia` desde dos conexiones a la vez; con comprobar-antes tiene que salir **rojo**. Se
   comprueba matando la misma mutación que dejé descrita arriba.
2. **B2** — ampliar `push-cableado-unico.guardia.test.ts` a un **censo con lista blanca sobre `lib/`
   y `app/`**, con su autocomprobación, y declarar en esa lista `emitir.ts` con su motivo.
3. **B3** — T6.4 (claves VAPID en Vercel, **por entorno**), T6.5 (un teléfono real) y la entrada en
   `progress/history.md`. **No son del implementador.**

Nada de esto toca una línea de producción: el canal, tal y como está escrito, es correcto.
