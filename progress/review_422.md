# Ficha 422 — Revisión

> PR **#789**, rama `feat/422-preferencia-push-recordada` @ `44c1fbf4`, base `origin/dev` @ `23c33f07`.
> Worktree propio de revisión en ruta corta (`R:/wt/rev422`, detached), `pnpm install --frozen-lockfile`
> + `prisma generate` dentro, `.env` copiado (sha256 `0501fee3…`, idéntico al del árbol principal) y
> **borrado al terminar**. Nunca se usó `git checkout --`: cada mutación se revirtió con copia
> byte a byte y `sha256sum -c`.

**VEREDICTO: RECHAZADO.** Dos bloqueantes, los dos con la misma raíz y los dos **medidos**, no
razonados: se puede escribir una superficie nueva que se dé de baja sin declarar su intención (R10),
y se puede meter un **segundo `Notification.requestPermission()`** en el árbol (R16), con
**typecheck en verde y las 145 guardias / 2091 casos en verde**. El resto de la ficha está por
encima de la media del repo: el gate completo reproduce cifra por cifra, las mutaciones del backend
y del frontend se sostienen al reaplicarlas, y la propiedad de seguridad de la 410 (R19) está
protegida contra Postgres por un test que esta ficha **añadió** y que muere al mutarla.

---

## 1. Checklist

### Especificación
- [x] `specs/422-preferencia-push-recordada/requirements.md` — 26 requisitos EARS numerados R1–R26.
- [x] `design.md` — cuatro alternativas descartadas con su porqué (§3.3, §3.4, §11 A–D).
- [x] `tasks.md` — **todas** en `[x]` salvo **T6.2**, declarada abierta en el propio archivo con el
      motivo escrito («mide contra producción y aplica la migración allí»). Declarada abierta por el
      encargo: **no cuenta como task sin marcar**.

### Trazabilidad
- [x] Los 26 requisitos mapean a un test con nombre. Mapa en `tasks.md` §Trazabilidad,
      `progress/impl_422_backend.md` §6 (R1–R13, R16, R17, R22, R24) y
      `progress/impl_422_frontend.md` §8 (R14–R26).
- [x] Ninguno mapea a un test vacío: auditados los tres archivos nuevos grandes
      (`PushReactivacion.test.tsx` 21 casos, `usuario-preferencia.test.ts` 14,
      `usuario-preferencia-migration.test.ts` 19) y **no hay un solo `if (!x) return;`** que deje un
      caso verde sin comprobar nada (medido con grep: cero coincidencias).
- [ ] **R10 — el test que lo cubre tiene un agujero medido.** Ver B1 y B2.
- [x] Las bitácoras contienen el mapa `R<n> → test`. (Se escribió partido en dos archivos en vez del
      `impl_422.md` que pide `tasks.md`; justificado en el encabezado del segundo.)

### Verificación ejecutable — corrida por el reviewer, no leída de la bitácora
- [x] `./init.sh` **completo** (el rápido se niega solo: el diff toca `db/schema.prisma` y
      `db/migrations/**`), con `INIT_EXIT=$?` escrito **dentro** del log:

```
✓ typecheck paso
✖ 184 problems (0 errors, 184 warnings)   → ✓ lint paso
 Test Files  1950 passed (1950)
      Tests  28325 passed | 26 skipped (28351)
   Duration  588.32s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1950 ejecutado(s))
✓ .env presente
== init OK ==
INIT_EXIT=0
```

- [x] **Las cifras cuadran exactamente con las declaradas**: 1950 archivos, 28.325 tests, 26
      `skipped` y los dos archivos de siempre (`AnaliticaPage.test.tsx` 17 + `AnaliticaShell.test.tsx` 9).
- [x] **Cero saltados de `tests/integration/db/`** (grep sobre el log: `0`). La capa de datos se
      ejecutó de verdad; el `.env` estaba puesto antes de arrancar.
- [x] Los 184 avisos de lint son **0 errores** y preexistentes de `dev`.

### Checkpoints (`CHECKPOINTS.md`), punto por punto
- [x] Requisitos EARS numerados · [x] design con alternativa descartada · [x] tasks `[x]` (T6.2 declarada).
- [x] Cada `R<n>` mapea a un test concreto — **con la salvedad de R10 (B1/B2)**.
- [x] `typecheck` sin errores · [x] `lint` sin errores · [x] `pnpm test` verde.
- [~] **E2E**: no aplica. No hay harness de Playwright ejecutable en este repo (los specs existentes
      dicen «NOT EXECUTED»), y la ficha no toca auth/pagos/recaudo/ingesta/webhooks: toca el canal de
      avisos. Riesgo cubierto por la vía de los tests de integración contra Postgres.
- [x] **RLS activada** en la tabla nueva: `ALTER TABLE "usuario_preferencia" ENABLE ROW LEVEL SECURITY`
      (`migration.sql:95`), y afirmado **contra el motor** (`relrowsecurity = true`, sin policies,
      patrón `push_suscripcion`/`jobs`) en `usuario-preferencia-migration.test.ts`.
- [x] **Migración reversible**: `down.sql` es un `DROP TABLE IF EXISTS` que arrastra PK, índice único,
      FK y RLS, con lo que se pierde escrito en voz alta. *No ejecuté `pnpm run db:rollback`*: la base
      local es **compartida** entre worktrees y dejar la tabla caída pondría rojo el gate de las demás
      fichas vivas. Verificado por lectura y por los casos `suelta la tabla, y NADA MAS` y
      `ningun down.sql ANTERIOR fue tocado`.
- [x] **Ningún secreto hardcodeado** (barrido del diff: las tres coincidencias son la palabra «token»
      en la lista de jerga prohibida, `password_hash` en un INSERT de test y un endpoint falso).
- [x] Webhooks: no aplica. **Idempotencia** donde sí aplica: `fijarAvisosPush` es un `upsert` por
      índice único, y el backfill lleva `ON CONFLICT DO NOTHING`.
- [x] **Capas**: el repositorio solo ejecuta Prisma; la interfaz vive en `lib/interfaces/repositories/`;
      la acción resuelve el actor de la **sesión** (nunca de la entrada) y baja a repositorio. El salto
      del `Service` está declarado y argumentado en design §6.2 y es el mismo que `lib/actions/push.ts`
      ya hacía con `PushSuscripcionRepository`: no hay regla de negocio que aislar.
- [x] **Permisos**: el layout valida en el servidor vía `resolveActorFromSession()`; `PushReactivacion`
      recibe el dato **por props** y no fetchea nada sensible; las mutaciones son Server Actions.
- [x] **Multi-país**: no se hardcodea país, moneda ni cuenta.
- [x] **Sin hardcode de contexto**: ningún `usuarioId` viaja por el cuerpo (410/R50); los dos schemas
      siguen siendo `strict()`.
- [ ] `progress/review_422.md` con veredicto OK — **este archivo, y el veredicto es RECHAZADO**.
- [ ] Entrada en `progress/history.md` — **no existe todavía**. Es lo normal en este repo: las entradas
      se añaden al **cerrar** la ficha (`chore(NNN): cerrada…`), no en el PR. Anotado para el cierre,
      **no es un hallazgo contra el implementador**.

---

## 2. Hallazgos

### B1 · BLOQUEANTE — El censo de las dos guardias lee 4 de las 7 raíces de código: `providers/` queda fuera

`RAICES_DEL_CENSO = ["app", "components", "hooks", "lib"]` — la misma constante en
`tests/unit/guards/push-intencion-de-baja.guardia.test.ts:37` y en
`tests/unit/guards/push-alta-punto-unico.guardia.test.ts:36`. Pero el repo tiene código de aplicación
en **`providers/`** (2 archivos: `ToastProvider.tsx` y `TemaProvider.tsx`), y no es un rincón
cualquiera: **`ToastProvider` es el componente que envuelve a `<PushReactivacion />` en el layout de
esta misma ficha**.

**Medido**, no razonado. Inyectando en `providers/ToastProvider.tsx`:

```ts
export async function tercerAdios() {
  await darDeBajaDeEsteDispositivo("cierre-de-sesion");
}
export async function segundoCaminoDelAlta(reg: ServiceWorkerRegistration) {
  await Notification.requestPermission();
  await reg.pushManager.subscribe({ userVisibleOnly: true });
}
```

Resultado:

```
$ pnpm run typecheck            → TSC_EXIT=0
$ pnpm exec vitest run tests/unit/guards/
 Test Files  145 passed (145)
      Tests  2091 passed (2091)
VITEST_EXIT=0
```

Lo que esto rompe, con nombre y apellido:

- **R10** — «el sistema NO DEBE ofrecer ninguna forma de darse de baja sin declararlo: una superficie
  nueva que no diga por qué se da de baja NO DEBE poder existir». Puede existir.
- **R16** — «DEBE seguir existiendo **una sola** llamada a esa petición en todo el árbol». Hay dos, y
  la guardia dice que hay una. Ésta es la que más duele: un «no» del navegador es casi irreversible,
  y la guardia existe justo para que nadie pueda pedir el permiso sin gesto.
- **R15/R17** — el argumento estructural del diseño es «`pushManager.subscribe(` aparece **una sola
  vez**, y dentro de `alta-push.ts`, que es donde vive la comprobación del permiso». Hay un segundo
  `subscribe` sin comprobación y el censo no lo ve.
- **R24/R6** — las otras dos aserciones de G2 (`<PushReactivacion` una vez y solo en el layout; la
  preferencia fuera del camino del envío) las gobierna **la misma lista de raíces**, así que heredan
  el mismo punto ciego.

**Qué falta para cumplirlo.** Añadir `"providers"` a `RAICES_DEL_CENSO` en las dos guardias, y —para
que esto no vuelva a caducar— una autocomprobación que derive o compare las raíces contra los
directorios de primer nivel con código de aplicación (hoy quedan también fuera `scripts/` y `e2e/`;
`scripts/` es código que el build type-checkea). Es una edición pequeña en dos archivos de test, pero
sin ella R10 y R16 no tienen test que los sostenga en todo el árbol, que es lo que ambos dicen.

---

### B2 · BLOQUEANTE — G1 es ciega al alias en el import: una tercera superficie **dentro** de `components/` se cuela

Aun arreglando B1, queda una segunda vía. El detector de G1 busca
`/darDeBajaDeEsteDispositivo\s*\(/g` sobre el texto sin comentarios, así que un **import renombrado**
lo esquiva: el nombre original aparece en la cláusula `import`, donde no le sigue un `(`, y la llamada
se escribe con el alias.

**Medido** sobre un archivo **alcanzable de verdad** (`components/shared/AvisoVersionNueva.tsx`, que
el layout del portal ya monta — así que ni siquiera la guardia de «superficie inalcanzable» lo caza):

```ts
import { darDeBajaDeEsteDispositivo as bajar } from "@/lib/pwa/baja-push";
...
  void bajar("cierre-de-sesion");
```

```
$ pnpm run typecheck            → TSC_EXIT=0
$ pnpm exec vitest run tests/unit/guards/
 Test Files  145 passed (145)
      Tests  2091 passed (2091)
VITEST_EXIT=0
```

> Nota de rigor: con un **archivo nuevo** (`components/shared/BotonTercero.tsx`) sin alias, G1 **sí**
> lo caza (1 rojo: `ningun archivo … se sale de la lista blanca`), y con alias lo cazaba **otra**
> guardia, pero por un motivo distinto —`ningún componente es inalcanzable desde una raíz de ruta`—
> que desaparece en cuanto la superficie está de verdad enchufada. Por eso la prueba decisiva se hizo
> sobre un componente ya montado: ahí no queda ninguna red.

Lo que se pierde es exactamente la capa que el propio encabezado de la guardia dice ser: «Lo que el
compilador NO puede exigir es que alguien haya PENSADO cuál de los dos motivos corresponde. Un tercer
llamante compila perfectamente escribiendo "cierre-de-sesion" por copiar-pegar, y el desenlace es
mudo». El tipo sigue obligando a pasar **un** motivo —la mitad buena del diseño sigue en pie— pero
nadie tiene que escribir **por qué ése**, que es la mitad que G1 aporta.

**Qué falta para cumplirlo.** La forma barata y a prueba de alias: censar el **import** en vez de (o
además de) la llamada. El nombre `darDeBajaDeEsteDispositivo` aparece **siempre literal** en la
cláusula `import`, incluso renombrado, así que basta con exigir que solo los dos archivos de la lista
blanca importen de `@/lib/pwa/baja-push`. Alternativa equivalente: resolver el alias local antes de
contar. Y añadir la autocomprobación del caso, como ya tienen los otros cinco.

---

### m1 · menor — `tasks.md` atribuye a M2 un rojo que M2 no produce

La fila **M2** de la tabla de mutaciones dice que quitar `Notification.permission !== "granted"` de
`alta-push.ts` debe poner rojo `alta-push.test.ts` **y** `PushReactivacion.test.tsx › la preferencia
puesta no se salta el permiso`. Reaplicada por mí, M2 da **3 rojos** y `PushReactivacion.test.tsx`
**se queda verde** (21 casos, todos pasan):

```
× y la comprobacion del permiso esta ANTES del `subscribe` en ese archivo   (G2)
× con el permiso en «default» NO se suscribe                                 (alta-push)
× con el permiso en «denied» tampoco, y tampoco se pide                      (alta-push)
Tests  3 failed | 63 passed (66)
```

Y es **correcto que sea así**: el componente corta por su cuenta en el paso (3) antes de llamar a
`alta-push`, así que la mutación de una capa no puede caer en la otra. Nadie mintió —el backend dejó
esa mitad explícitamente deferida y el frontend no ejecutó M2— pero la tabla de `tasks.md` queda con
una expectativa que el árbol no cumple. **La propiedad que M2 defiende sí está entera**, y lo medí
por separado:

| mutación mía | rojos |
| --- | --- |
| quitar el corte del permiso **solo en `PushReactivacion`** | **2** (`con «default»/«denied», la preferencia puesta NO se salta la comprobación`) |
| quitarlo **en las dos capas a la vez** (el estado peligroso de verdad) | **5** en 3 archivos |

Arreglo: corregir la celda M2 de `tasks.md`, o partirla en M2a/M2b.

### m2 · menor — P3 sigue abierta; mi lectura es que **el tuteo es el correcto**

La frase nueva quedó en tuteo («Si **cierras** sesión…») y el diseño la proponía en voseo. Medido en
el árbol: el resto de `PushOptIn.tsx` es tuteo entero («Te avisamos», «tengas», «abre los ajustes»),
y el voseo vive en **otro** sitio —el catálogo de avisos (`lib/notificaciones/catalogo-avisos.ts:358`
lo declara explícitamente) y `CierreDiaService`—. No hay ninguna regla de registro escrita en `docs/`.
Mezclar los dos registros **dentro de la misma tarjeta** se lee como un descuido; mantener el tuteo
ahí es la decisión correcta. Lo que queda de verdad abierto no es esta frase, sino la incoherencia de
registro **entre el control y los avisos**, que es anterior a esta ficha y no debería resolverse aquí.
El test fija el literal **escrito a mano** y no importado de `TEXTOS`, así que cambiarlo un día se
notará.

### m3 · menor — la entrada de `progress/history.md` no está

Ver checklist. Es del cierre, no del PR.

---

## 3. Lo que se pidió juzgar con criterio

### 3.1 El peaje del layout: **+1 consulta por página, +0 ms de reloj** (medido)

Instrumenté Prisma con `log: [{emit:"event", level:"query"}]` contra la base local:

| | consultas |
| --- | --- |
| `UserRepository.findById` (lo que ya había) | **1** — `SELECT … FROM usuario WHERE id = $1 LIMIT 1`, 1,98 ms |
| `UsuarioPreferenciaRepository.avisosPushDe` (lo nuevo) | **1** — `SELECT id, avisos_push FROM usuario_preferencia WHERE usuario_id = $1 LIMIT 1`, 2,59 ms |
| `resolveActorFromSession` → `usuario.findUnique({include:{rol:true}})` | **2** (Prisma emite la relación aparte) |

O sea, el layout autenticado pasa de **~4 consultas por carga a ~5**. La quinta es una **lectura por
índice único** sobre una tabla estrecha con como mucho una fila por persona (hoy, en producción, la
tabla no existe aún y `push_suscripcion` tiene 1 fila), y va **dentro del `Promise.all` que ya
existía**, así que el coste en reloj es `max(1,98 , 2,59)` y no la suma: **el peaje en latencia es
cero y el peaje en carga de base es +25 % de consultas del layout**. La decisión de meterla en el
`Promise.all` en vez de encadenarla es correcta y está escrita en el archivo con su porqué. **De
acuerdo con el diseño**: una acción de lectura desde el cliente habría costado una ida y vuelta HTTP
completa por carga para el mismo dato.

Lo único que dejo anotado, sin ser hallazgo: nadie mide que siga en paralelo. Encadenarla mañana no
pondría nada rojo. No pido test para eso —sería fijar una forma, no una propiedad— pero el comentario
del archivo es hoy toda la defensa.

### 3.2 La decisión del backend que el spec no cubre (§8.1): **de acuerdo**

Si anotar la preferencia falla dentro de `registrarSuscripcionPush`, la acción sigue devolviendo `ok`
y el fallo queda registrado con su operación y su causa. El argumento es correcto **y es medible, que
es lo que lo separa de una preferencia de estilo**: quien llama (`lib/pwa/alta-push.ts`) **deshace la
suscripción del navegador** cuando el registro no sale `ok`. Propagar convertiría un fallo en una
columna que —por R6— **no decide a dónde sale un push** en la pérdida de avisos de un dispositivo
perfectamente registrado. El orden también es el correcto: la suscripción primero, la preferencia
después. Y no es una decisión suelta: tiene su propio test y **muere si alguien la revierte** — quité
el `try/catch` y salió 1 rojo, `si ANOTAR la preferencia falla, el registro sigue siendo «ok» y queda
el fallo escrito`. Es además simétrico de R12 por el lado del alta.

### 3.3 El backfill: existe, es idempotente y su medición está escrita

- Existe: `INSERT … SELECT DISTINCT usuario_id FROM push_suscripcion` con `avisos_push = TRUE`
  (`migration.sql:84-87`).
- Idempotente: `ON CONFLICT ("usuario_id") DO NOTHING`, apoyado en el índice único que la misma
  migración crea dos sentencias antes. Reaplicarlo no revienta ni pisa una decisión posterior.
- Aditivo: no hay `ALTER` de nada preexistente y no crea ningún tipo (no aplica la lección del enum
  recreado con lista); ningún `down.sql` anterior fue tocado — y hay un caso que lo afirma.
- Medición escrita: el `SELECT` de **antes** y el de **después** están en tres sitios (design §2.4,
  `migration.sql:71-79`, `impl_422_backend.md §5`), con el número de hoy declarado: **1 suscripción /
  1 persona**, y el criterio `filas = puestas = intactas = personas`.
- La tercera columna (`updated_at = created_at`) no es decorativa: **depende** de que el `update` del
  repositorio no reescriba `created_at`, y eso tiene su propio caso contra Postgres. Sin él, esa
  comprobación estaría verde siempre.
- **No ejecuté nada contra producción**, como se pidió. T6.2 queda abierta para el despliegue.

### 3.4 Los dos inventarios ajenos: **ampliados, no relajados**

- `tests/fixtures/api-key-dependencias-usuario.ts`: **+1 entrada**, `UsuarioPreferencia.usuario`, con
  categoría `no_alcanzable` y su motivo escrito. No se tocó ninguna entrada previa. La guardia exige
  que el conjunto de claves **coincida exactamente** con las FK del esquema, así que no había forma de
  pasar sin declararla; y la clasificación se sostiene: los dos únicos caminos que crean esa fila
  exigen navegador con sesión de pantalla, y una cuenta dedicada no entra por el formulario de login.
- `tests/integration/db/schema-drift-saneamiento.test.ts`: la lista pasa de **NUEVE a DIEZ** con
  `usuario_preferencia` y el título del caso se actualiza. Es un `toEqual` sobre la lista completa
  —añadir un nombre que la base no tuviera lo pondría rojo—, así que ampliarla **no** la afloja.

---

## 4. La regla que no se puede haber roto, y lo que sí aguanta

Todo lo de esta sección se aplicó **de una en una**, se revirtió con `sha256sum -c` y lleva su
`VITEST_EXIT` / `TSC_EXIT` medido.

### 4.1 410/R19 — **aguanta, y es la mejor pieza de la ficha**

Mutación mía de control (diseñada para morir): en `PushSuscripcionRepository.eliminarDeUsuario`,
quitar el `endpoint` del `WHERE` para que la baja toque **todas** las suscripciones de la persona.

```
× dar de baja UN dispositivo deja vivo el otro de la misma persona
 Test Files  1 failed (1) · Tests  1 failed | 13 passed (14) · VITEST_EXIT=1
```

**Murió.** Y conviene decir de dónde viene ese rojo: es el caso que **esta ficha añadió**
(`tests/integration/db/usuario-preferencia.test.ts`), con dos suscripciones reales de la misma
persona contra Postgres y su control positivo (`antes` tiene 2). Antes de esta ficha, ese `WHERE`
solo lo veían dobles —y un doble no ve el SQL, medido cuatro veces en este repo—. La 422 no solo no
erosiona R19: **le pone la primera red de verdad que ha tenido.**

### 4.2 La reactivación no pide permiso, y la preferencia no se salta la comprobación

| mutación | rojos |
| --- | --- |
| **M3** — que la reactivación llame a `requestPermission()` con el permiso en «default» | **3**: `R16: en NINGÚN escenario se llama a la petición`, `con «default» … NO se salta la comprobación`, y G2 `una sola aparicion, y esta en activar()` |
| corte del permiso quitado **solo en `PushReactivacion`** | **2** |
| corte del permiso quitado **en las dos capas** | **5** en 3 archivos |

La preferencia **no entra** en `suscribirYRegistrarEsteDispositivo` (leído en el archivo), y el
componente la comprueba en el paso (1) antes de mirar nada del navegador. Dos cortes independientes,
cada uno con su rojo propio. **Con la salvedad de B1**: G2 sostiene «una sola vez en todo el árbol»
sobre 4 de las 7 raíces.

### 4.3 Reactivación silenciosa — aguanta

`return null` siempre; el archivo no importa ni toasts ni notificaciones. Tres casos lo fijan, uno de
ellos montando el componente **dentro** del `ToastProvider` para que un toast saliera como texto real
en vez de reventar por falta de contexto, y otro repitiéndolo **en el camino de fallo**. M7 (pintar un
aviso) los mata: 3 rojos, reproducido por el frontend.

### 4.4 La intención se resuelve ANTES del corte por «sin suscripción» (R11) — aguanta

Leído en el archivo (`baja-push.ts:133`, primera línea de la función, con el porqué al lado) y
**M4 reaplicada**:

```
× la intencion se resuelve ANTES del corte por «sin suscripcion» (R11)     (G1)
× apagar sin suscripción viva borra la preferencia igual                    (baja-push)
× y ni siquiera hace falta que haya service worker                          (baja-push)
× leer el registro del service worker puede fallar, y tampoco lanza         (baja-push)
× R11: y lo hace igual aunque este dispositivo ya no tenga suscripción viva (hook)
 Tests  5 failed | 58 passed (63) · VITEST_EXIT=1
```

Cinco rojos en tres archivos, y uno de ellos es **estructural** (la guardia compara posiciones en el
texto), no de comportamiento. Bien cerrado.

### 4.5 M9 — el límite es legítimo, y lo comprobé en vez de creérmelo

El frontend declaró que M9 da **un solo rojo** y que el caso del re-render no la caza porque la lista
de dependencias impide que el efecto se repita. **Es cierto, y es un límite legítimo, no un hueco.**
Reaplicada M9 (quitar el `useRef`):

```
× el doble montaje del modo estricto de React NO dispara un segundo intento
 Tests  1 failed | 20 passed (21)
```

Y fui un paso más allá para saber si el caso del re-render es un test muerto. **No lo es**: quitando
el `useRef` **y** la lista de dependencias a la vez, se pone rojo:

```
× el doble montaje del modo estricto … NO dispara un segundo intento
× ni lo dispara un re-render del layout con las mismas props
 Tests  2 failed | 19 passed (21)
```

O sea: el punto único de fallo real de R23 es el `useRef`, y lo cubre el caso del modo estricto; el
del re-render es defensa en profundidad que dispara en el compuesto, y el control positivo («dos
cargas sí intentan dos veces») impide el falso verde de «no intenta nunca». **Decirlo en vez de
maquillarlo fue lo correcto, y el juicio es que basta.** M11f —añadida por él— cubre además la
propiedad que de verdad importaba y que nadie le pidió: que el interruptor no pueda mentir cuando el
servidor rechaza el registro. Bien traída.

---

## 5. Lo declarado abierto, tratado como tal (no son hallazgos)

- **T6.2** — medición del backfill contra producción. Abierta por decisión del encargo; el `SELECT` y
  el criterio están escritos y no ejecuté nada contra producción.
- **Comprobación visual** — no hay navegador en este entorno; tampoco en el mío. Queda sin medir que
  el service worker esté **activo** en el instante en que el layout monta; si no lo está, el camino
  sale por `sin-soporte` en silencio y se reintenta en la siguiente carga, que es el peor caso y es
  benigno.
- **P3** — mi lectura está en m2: **tuteo**.

---

## 6. Qué falta, exactamente, para que esto sea OK

1. **B1** — añadir `"providers"` a `RAICES_DEL_CENSO` en
   `tests/unit/guards/push-intencion-de-baja.guardia.test.ts` y
   `tests/unit/guards/push-alta-punto-unico.guardia.test.ts`, con una autocomprobación que impida que
   la lista vuelva a quedarse corta cuando aparezca una raíz nueva.
2. **B2** — hacer G1 a prueba de alias: censar el **import** desde `@/lib/pwa/baja-push` (el nombre
   original aparece siempre literal en la cláusula `import`, aunque se renombre), con su
   autocomprobación.
3. Reaplicar los dos intrusos que yo usé (alias en un componente ya montado; llamada directa desde
   `providers/`) y **pegar el rojo** en la bitácora. Sin ese rojo pegado, R10 y R16 siguen sin test.
4. **m1** — corregir la celda M2 de `tasks.md`.
5. Gate completo otra vez (el diff seguirá tocando `db/migrations/**`).

Nada de esto toca el código de producción: son dos archivos de test y una tabla. El diseño, la
migración, el repositorio, la costura de la intención y la reactivación están bien y **no hay que
rehacer nada de eso**.

---

## Veredicto

**RECHAZADO** — por B1 y B2. Dos requisitos (R10 y R16) cuya única defensa declarada es una guardia
que, medida, deja pasar lo que dice impedir. Todo lo demás —los 26 requisitos restantes, el gate
completo reproducido cifra por cifra, las 16 mutaciones (11 backend + 5 frontend) más las 9 mías,
410/R19 protegido contra Postgres por primera vez, la RLS, la reversibilidad, la idempotencia del
backfill y los dos inventarios ajenos ampliados sin relajar— está en orden.
