# 409 — Bitácora del FRONTEND

> Rama `feat/409-panel-notificaciones-accionable-frontend`, nacida de
> `origin/feat/409-panel-notificaciones-accionable` @ **`fa8a72ef`** (la rama del backend, que
> seguía ocupada por otro worktree: por eso una rama hija y no un checkout).
> Alcance: **R7, R10–R30, R32, R66 y la mitad de página de R6**. Los otros 44 requisitos son del
> backend y están declarados con nombre en `progress/impl_409_backend.md`; no se rehicieron.

---

## §0 — Lo que se leyó antes de escribir una línea

`CLAUDE.md`, `AGENTS.md`, `docs/conventions.md`, `docs/architecture.md`, `docs/verification.md`,
`DESIGN.md`, el spec completo (`requirements.md` 66 requisitos, `design.md` §2/§3/§7/§8/§9,
`tasks.md` fase 6), `progress/impl_409_backend.md` §8, y el contrato visual commiteado:
`design-notificaciones/Main.dc.html` y `Campana.dc.html`.

⚠️ **El MCP `codebase-memory` no estaba en el conjunto de herramientas de este agente** (las
definiciones se cargan al arrancar la sesión). Se dice explícitamente, como pide el encargo: la
búsqueda se hizo con `grep`/`glob` y **leyendo los archivos reales**, que es justo la comprobación
que el grafo no sustituye.

### Lo que se verificó en el ARCHIVO REAL antes de decidir nada

| Qué | Dónde | Veredicto |
| --- | --- | --- |
| `TabsGroup` ya acepta `defaultValue` | `components/shared/TabsGroup.tsx:83` y `:96` (`defaultValue ?? firstEnabled`) | **Cierto**: `undefined` cae a la primera pestaña habilitada. 0 líneas de cambio ahí |
| El patrón de `searchParams` opcional en una page | `app/page.tsx:50-58` (`searchParams?: Promise<…>` + `(await searchParams) ?? {}`) | **Cierto**, y es el que se copia: `tests/components/NovedadesPage.test.tsx` llama `NovedadesPage()` **sin argumentos** y tiene que seguir compilando |
| El catálogo emite `/novedades?superficie=devolucion` | `lib/notificaciones/catalogo-avisos.ts:236` | **Cierto** |
| La guardia ya admite `superficie` en su lista blanca | `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` | **Cierto**, y dejaba escrito que la mitad de la página la cierra el frontend (T6.5) |
| Los hex del mockup tienen token | `app/globals.css:177-182` y `:310-316` | **Cierto y exacto**: `#fee2e2` = `--color-danger-soft`, `#b91c1c` = `--danger-strong`, `#fef3c7`/`#92400e` = warning, `#eff6ff`/`#1d4ed8` = info. No se copió ni un hex |
| `--spacing` no se redefine | `app/globals.css` (sin `--spacing`) | **Cierto**: `w-100` = 100 × 0.25rem = **400 px** (R22) |

---

## §1 — Archivos tocados

**Producción (4):**

| Archivo | Cambio |
| --- | --- |
| `components/shared/NotificationsBell.tsx` | reescritura: píldora «N por hacer», panel de 400 px, filtro de dos píldoras, dos bloques con encabezado, atajo, sin «Anexo:», sin pie |
| `hooks/useNotificaciones.ts` | `NotificacionesData` gana `porHacer`; degradación a `0` ante error |
| `app/(app)/novedades/page.tsx` | lee `?superficie=` con lista blanca zod contra `GRUPOS_NOVEDAD` |
| `app/(app)/novedades/_components/NovedadesTabs.tsx` | prop opcional `superficieInicial` → `defaultValue` |

**Tests (7 archivos: 4 nuevos, 3 ampliados):**

| Archivo | Estado |
| --- | --- |
| `tests/components/NotificationsBell.test.tsx` | ampliado (43 tests) y **actualizado en los 9 casos cuyo contrato cambia la 409** — ver §4 |
| `tests/integration/actions/novedades-pestana-por-url.test.ts` | **nuevo** (7 tests) |
| `tests/unit/guards/notifications-bell-sin-reloj.guardia.test.ts` | **nuevo** (4 tests) |
| `tests/unit/guards/notifications-bell-tokens.guardia.test.ts` | **nuevo** (7 tests) |
| `tests/unit/guards/notifications-bell-ancho.guardia.test.ts` | **nuevo** (4 tests) |
| `tests/components/NovedadesTabs.test.tsx` | +3 tests (R7); los 7 vigentes, intactos |
| `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` | +3 tests: la **mitad de página de R6** que el backend dejó apuntada (T6.5) |

**No se tocó** el backend de esta ficha, ni `components/shared/TabsGroup.tsx`, ni `PageHeader.tsx`,
ni `hooks/useTonoAlIncrementar.ts` (cambia su ARGUMENTO en la campana, no el hook), ni
`hooks/usePreferenciaSonido.ts`, ni `feature_list.json`, ni `progress/current.md`.

---

## §2 — Las decisiones que no estaban dibujadas, y por qué

### 2.1 — «Requieren tu acción» sale DOS veces en el panel, y son dos cosas distintas

R16 pide el bloque bajo ese encabezado y R25 pide una píldora de filtro con ese mismo nombre. Con
los dos escritos igual, un `getByText("Requieren tu acción")` encuentra dos nodos y el test no
puede distinguirlos — y peor: un lector de pantalla tampoco.

Se resolvió **por rol, no retorciendo los textos**:

- cada bloque es una `<section aria-labelledby>` con un `<h3>` → rol **`region`** con su nombre
  accesible, así que `getByRole("region", { name: "Requieren tu acción" })` es inequívoco y el
  orden se afirma por posición en el DOM (R16);
- las píldoras del filtro llevan su cifra dentro del nombre, con el separador del contrato visual:
  **«Requieren tu acción · 2»** y **«Todas · 3»**.

### 2.2 — La píldora de filtro se deshabilita cuando no hay nada accionable

Filtrar a un panel en blanco no es un estado: es un callejón. Con `porHacer = 0` el control queda
deshabilitado (mismo trato que «Marcar leídas» sin no leídas) en vez de inventar un texto de vacío
que el contrato visual no tiene. **No se inventó ningún literal fuera del mockup.**

### 2.3 — El rótulo «Marcar todas como leídas» NO se acortó a «Marcar leídas»

El `.dc.html` lo dibuja corto, pero **R28 protege el comportamiento vigente de ese control** y su
rótulo actual es lo que afirman tres tests de la 146 que tienen que seguir verdes **sin editarse**.
Acortarlo habría roto tres suites vigentes a cambio de cero requisitos. Queda dicho aquí y no
escondido: **es una desviación deliberada del mockup**, la misma clase de decisión que el backend
tomó con el singular de «se rechaza automáticamente».

### 2.4 — El bloque informativo pierde el icono de tipo (y gana el punto del mockup)

`Main.dc.html` fija «bloque informativo: punto, título, instante». El icono semántico queda en el
bloque accionable, donde la pastilla lo hace legible. Consecuencia declarada: el aserto de
146/R49 sobre los tres iconos ahora se mide sobre avisos **accionables** (§4).

### 2.5 — El atajo es un `Link` dentro de un `Popover.Close`

Navegación real (anchor, con su `href`, abrible en otra pestaña) y cierre del panel en el mismo
control. Una guardia afirma que **todo `<Link` del archivo va dentro de un `render={<Link`**: un
`Link` suelto navegaría dejando el popover abierto sobre la pantalla de destino.

---

## §3 — Mapa `R<n> → test` (los míos)

> Los literales se afirman **a mano** en todos los casos. Ninguno se compara contra la constante
> que lo genera: eso está siempre verde y en este repo ya dejó pasar un tope que la app rechazaba.

| R | Test | Aserto que se pone ROJO si el código está mal |
| --- | --- | --- |
| **R6** (mitad de la página) | `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` › «cada destino con `?` apunta a una pagina que lee ESE parametro» | por cada destino con query, abre el fuente de la página de destino y exige `searchParams` **y** el nombre del parámetro. Mutación «inventar `?estado=x`» ⇒ rojo |
| **R7** | `tests/integration/actions/novedades-pestana-por-url.test.ts` (3 casos) + `tests/components/NovedadesTabs.test.tsx` (3 casos) | `?superficie=devolucion` ⇒ la pestaña con `aria-selected="true"` es **«En devolución»** (literal a mano), la de entrada pasa a `false`, y el panel montado es el de **su** superficie. Un caso toma el `href` **tal y como lo emite el catálogo** y lo mete en la URL: cierra el círculo con R6 |
| **R10** | `NotificationsBell.test.tsx` › «R10: con cero por hacer no se pinta distintivo alguno» | dos informativas **sin leer** ⇒ `aria-label` es `"Notificaciones"` a secas, no hay texto `/por hacer/i` y el disparador **no tiene contenido de texto** |
| **R11** | ídem › «409/R11+R13: el distintivo cuenta lo ACCIONABLE» | 2 accionables **leídos** + 1 informativa sin leer ⇒ `getByText("2 por hacer")`. Contando lecturas diría «1»; contando filas, «3» |
| **R12** | ídem › «409/R12: por encima del tope» | `porHacer: 120` ⇒ `getByText("+99 por hacer")` y `"120 por hacer"` ausente |
| **R13** | ídem (mismo caso que R11) | `aria-label === "Notificaciones, 2 por hacer"` y **no contiene** «sin leer» |
| **R14** | ídem › «R14: «Marcar leídas» NO cambia el conteo» | tras marcar (y con el servidor devolviendo las mismas filas ya leídas) sigue diciendo «2 por hacer» |
| **R15** | ídem › «R15: descartar un accionable baja el conteo en uno» | «2 por hacer» ⇒ «1 por hacer» sin recargar, con `descartarNotificacion("a")` llamado |
| **R16** | ídem › «R16: dos bloques, con sus encabezados y en ese ORDEN» | el servidor manda la informativa PRIMERA y aun así `["Requieren tu acción", "Para tu información"]` por posición en el DOM |
| **R17** | ídem › «R17: el accionable con atajo…» + «409/R17: icono de su tipo, título, contexto e instante» | título, detalle, `"hace 2 h"` y el enlace «Gestionar novedades» dentro del MISMO `li`; y los tres iconos con su nombre accesible |
| **R18** | ídem › «R18: el accionable SIN atajo…» | el aviso de mapas caídos está **dentro** de la región «Requieren tu acción», sin `link` y con un único botón: «Descartar notificación» |
| **R19** | ídem › «R19: en el bloque informativo no hay botón de acción» | en esa región, `queryAllByRole("link")` = 0 y todos los botones son de descartar; y el control positivo: el atajo SÍ existe, en el otro bloque |
| **R20** | ídem › «409/R17…sin la palabra «Anexo:»» + «409/R20: una fila que TRAE anexo» | `queryByText(/Anexo:/)` es `null`, y una fila con `anexo: "REM-99"` no lo pinta |
| **R21** | ídem › «R21: el atajo navega a su destino declarado y cierra el panel» | `href === "/novedades?superficie=devolucion"`, el espía registra ese destino y el panel desaparece del DOM |
| **R22** | `tests/unit/guards/notifications-bell-ancho.guardia.test.ts` | `w-100` **sobre el `Popover.Popup`** (no en un chip suelto), `w-80` ausente y `max-w-[calc(100vw-2rem)]` presente |
| **R23** | `NotificationsBell.test.tsx` › «R23: un bloque sin avisos…» | sólo informativas ⇒ la región «Requieren tu acción» no existe **ni su encabezado**; y la otra sí (control positivo) |
| **R24** | 146/R44, **vigente y sin editar** | listado vacío ⇒ `"No tienes notificaciones."` y ninguna lista |
| **R25** | `NotificationsBell.test.tsx` › «R25: el filtro oculta el bloque informativo» | «Requieren tu acción · 2» oculta la región informativa; «Todas · 3» la devuelve. Las dos cifras, a mano |
| **R26** | ídem › «R26: hay un «Descartar notificación» por aviso en los DOS bloques» | uno por región |
| **R27** | `tests/unit/guards/notifications-bell-tokens.guardia.test.ts` | ni `#rrggbb`, ni `rgb(`, ni paleta cruda, ni `text-navy`; los tres semánticos con su par `-soft`/`-strong`/`dark:bg-*/15`; y **controles enfocables contados contra anillos de foco** (7 = 7) |
| **R28** | las suites vigentes de 146/161/208 que **no se editaron** (§4) | siguen verdes tal cual |
| **R29** | `NotificationsBell.test.tsx` › «R29: no hay pie…» | `/Ver todas las notificaciones/` es `null` y no hay enlace `/Ver todas/` |
| **R30** | ídem › describe del tono (2 casos) + 161/R19 actualizado | subir **no leídas** de 0 a 2 sin subir lo accionable **no suena**; subir lo accionable **sí**, una sola vez, y con las filas **leídas** |
| **R32** | `tests/unit/guards/notifications-bell-sin-reloj.guardia.test.ts` | ni `Date.now(`, ni `new Date(`, ni `toLocaleDateString`/`toLocaleTimeString`/`Intl.RelativeTimeFormat`, en la campana **y** en el hook; y el control positivo: pinta `notificacion.cuando` y usa `createdAt` sólo como `title` |
| **R66** | `tests/integration/actions/novedades-pestana-por-url.test.ts` (4 casos) | `?superficie=chorizo` ⇒ «Ayuda solicitada», encabezado pintado (o sea, sin `notFound`) y panel montado; sin parámetro, igual; `?superficie=` vacío y parámetro repetido, igual; y el control positivo del array cuyo primer valor sí vale |

---

## §4 — Las nueve pruebas vigentes que SÍ cambiaron, una a una

> Regla aplicada: *«Literal: contrato o polizón»*. Antes de tocar un aserto se miró si **ESE**
> literal era el contrato. Los nueve que cambian son los que la 409 **deroga explícitamente**; los
> demás quedaron intactos. **No se borró ni un test**, no se relajó ni un aserto (todos siguen
> siendo igualdades con literal escrito a mano) y el archivo pasó de 34 a **43 tests**.

| Test vigente | Qué afirmaba | Qué requisito de la 409 lo deroga |
| --- | --- | --- |
| 146/R41 «distintivo con la cantidad de no leídas» | `"2"` y `aria-label` «2 sin leer» | **R11 + R13**: el distintivo dice lo que hay POR HACER, con palabras, y su nombre accesible NO puede hablar de mensajes sin leer |
| 146/R42 «+99 con más de 99 no leídas» | `"+99"` sobre `noLeidas` | **R12**, sobre la cifra de R8 |
| 146/R49 (mitad del anexo) | `"Anexo: REM-1"` | **R20**: esa palabra no vuelve al panel. La otra mitad (los tres iconos con su nombre accesible) **se conserva**, medida ahora sobre avisos accionables (§2.4) |
| 146/R50 (datos iniciales) | `aria-label` «1 sin leer» | **R13** |
| 161/R19 «suena cuando suben las no leídas» | tono por `noLeidas` | **R30 / decisión Q8**: un solo criterio para el mismo número |
| 161/R11-R24 ×2 «no suena al montar» | `getByText("2")` / «1 sin leer» | **R11/R13** (el comportamiento medido —no sonar al montar— es el mismo) |
| 161/R20 ×2 «marcar leídas / descartar no suenan» | `getByText("2")` | **R11** (idem: el comportamiento sigue siendo el mismo) |
| 161/R14 «silenciado no suena» | `getByText("1")` | **R11** |

**Siguen verdes SIN editarse** (R28): 146/R40 ×3 (origen de los datos), R43 (sin distintivo a
cero), R44 (estado vacío), R45 ×2 («Marcar todas como leídas» y su deshabilitado), R46
(descartar), R47 ×3 (refresco, `refreshInterval` de config, sin realtime), R48 ×3 (degradación),
R50 (alias de tipo), 161/R24 (recuperación tras fallo), 161/R18 y 161/R16-R18 (nombres accesibles
del interruptor de sonido y persistencia).

Cambios de infraestructura del archivo, no de asertos: el helper `ok()` puebla `porHacer` (campo
**requerido** del resultado tras la 409), se añaden `accionable()` / `informativa()` y un mock de
`next/link` que **corta la navegación que jsdom no implementa y registra el destino**.

---

## §5 — Mutaciones: doce aplicadas, doce muertas, **cero supervivientes**

Arnés en `scratchpad/mutaciones.py`: cada mutación se escribe **en el archivo real**, se corre la
suite y se revierte desde una copia. Antes de medir nada corre el **control con el árbol limpio**
(43 / 15 / 17 en verde) y aborta si no está verde — un arnés que reporta sin haber ejecutado un
test ya mintió dos veces en este repo.

| # | Mutación | Veredicto | Tests en rojo |
| --- | --- | --- | --- |
| M1 | devolverle `noLeidas` al hook del tono (R30) | **MUERTA** | 2 |
| M2 | que el distintivo vuelva a contar no leídas (R10–R13) | **MUERTA** | 4 |
| M3 | devolver la etiqueta «Anexo:» al panel (R20) | **MUERTA** | 2 |
| M4 | renombrar el encabezado del bloque accionable (R16/R23/R25) | **MUERTA** | 5 |
| M5 | pintar botón de atajo aunque el aviso no lo declare (R18) | **MUERTA** | 1 |
| M6 | que el filtro no oculte el bloque informativo (R25) | **MUERTA** | 1 |
| M7 | recalcular el instante con el reloj del cliente (R32) | **MUERTA** | 1 |
| M8 | pegar el hex del mockup en vez del token (R27) | **MUERTA** | 2 |
| M9 | volver al panel estrecho `w-80` (R22) | **MUERTA** | 2 |
| M10 | que la página no pase la superficie leída de la URL (R7/R66) | **MUERTA** | 3 |
| M11 | que `NovedadesTabs` no reenvíe la prop al `TabsGroup` (R7) | **MUERTA** | 5 |
| M12 | aceptar cualquier valor de la URL con un `as` en vez de la lista blanca (R66) | **MUERTA** | 2 |

**Supervivientes: ninguno.**

---

## §6 — Gate

### El rápido se negó solo, y está medido

```
== Arnes SDD :: init (modo: rapido) ==
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    db/migrations/20260911120000_notificacion_evento_avisos_agregados/down.sql
    db/migrations/20260911120000_notificacion_evento_avisos_agregados/migration.sql
    db/schema.prisma
    lib/types/notificacion.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

Es lo que el spec §9 anticipaba: el diff de la rama contra `origin/dev` incluye el esquema, la
migración y `lib/types/`, que son del backend. **El gate de esta ficha es el completo.**

### `./init.sh` completo — **`INIT_EXIT=0`**

`INIT_EXIT` va escrito **dentro** del log (`echo "INIT_EXIT=$?" >> log`), no leído del comando: a
la corrida del backend de esta misma ficha una salida ROJA le llegó anunciada como «exit code 0».
El log no se canalizó por `tail` (eso trunca el fichero en origen y deja el rojo sin nombre).

```
 Test Files  1880 passed (1880)
      Tests  27319 passed | 26 skipped (27345)
   Duration  843.60s
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1880 ejecutado(s), todos en el baseline conocido)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

### Los `skipped`, mirados uno a uno (no sólo el `INIT_EXIT`)

- **`✓ DATABASE_URL resuelta: los 158 archivos de tests contra Postgres SI se ejecutan`** — se
  copió el `.env` del checkout principal al worktree **tras comprobar que su `DATABASE_URL` activa
  apunta a `localhost:5432`** (los hosts de Supabase del archivo están comentados; se verificó con
  las credenciales enmascaradas, sin leerlas).
- **236 archivos de `tests/integration/db/` ejecutados de verdad** (contados sobre el log: los 238
  del directorio menos los dos que no son `.test.ts`). **Cero saltados.**
- Los **26 `skipped` son de otras dos suites y son previos a esta ficha**: `AnaliticaPage.test.tsx`
  (17) y `AnaliticaShell.test.tsx` (9). Ni uno solo es de `integration/db`.
- Los cuatro archivos contra Postgres que sostienen esta ficha **corrieron**:
  `aviso-agregado-repository` (11), `novedades-sin-gestionar-aviso-dedupe` (5),
  `devoluciones-represadas-aviso-dedupe` (6), `notificacion-evento-avisos-agregados-migration`
  (20).
- **Ningún `40P01`**: no hubo contención con otros agentes sobre la base local en esta corrida.

### Mis archivos, en la corrida completa

```
 ✓ tests/components/NotificationsBell.test.tsx (43 tests) 10334ms
 ✓ tests/components/NovedadesTabs.test.tsx (10 tests) 2640ms
 ✓ tests/components/NovedadesPage.test.tsx (8 tests) 573ms      <- vigente, SIN editar
 ✓ tests/integration/actions/novedades-pestana-por-url.test.ts (7 tests) 669ms
 ✓ tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts (9 tests) 13ms
 ✓ tests/unit/guards/notifications-bell-tokens.guardia.test.ts (7 tests) 13ms
 ✓ tests/unit/guards/notifications-bell-ancho.guardia.test.ts (4 tests) 11ms
 ✓ tests/unit/guards/notifications-bell-sin-reloj.guardia.test.ts (4 tests) 10ms
```

`pnpm typecheck` limpio y `pnpm lint` con **0 errores** (183 warnings, todos previos: ninguno en
los siete archivos de esta tanda).

⚠️ **Aviso arrastrado, no introducido aquí**: `! migraciones sin down.sql:
20260814120000_ruta_optimizada_trazado, 20260814140000_ruta_parada_tramo,
20260814160000_ruta_tramo_vivo_at`. Es previo a esta ficha y sale igual en `dev`.

---

## §7 — Lo que queda ABIERTO, con nombre

1. **T7.4 — nadie ha visto este panel en un navegador.** Es el límite declarado del spec §9 y
   sigue vigente: jsdom no mide contraste, ni desbordes, ni el alto de una fila con un texto
   largo. **No se levantó un dev server a propósito**: en esta sesión hay otros agentes trabajando
   y este repo ya midió que dos servidores se pisan. Queda como **puerta antes de dar la ficha por
   hecha**, con el lote que pide la tarea: ≥ 20 avisos, con atajo, **sin** atajo, informativos y un
   texto largo, en los **dos** temas.
2. **T7.5 — la medición en producción en solo lectura** (`por_devolver` y `por_devolver_a_tienda`)
   es del backend y sigue siendo puerta de despliegue. No la toca esta bitácora.
3. **Defectos del backend encontrados: ninguno.** El DTO llegó con los seis campos poblados, el
   `atajo` resuelto por par (evento, rol) y `porHacer` requerido en el resultado; el único ajuste
   defensivo del lado cliente es el `?? 0` del fetcher, que existe para los **dobles de las suites
   vigentes** (donde el campo aún no existe), no para tapar un hueco del servidor.
4. **Pre-vuelo de la migración, re-medido al abrir el PR** (es la trampa «el pre-vuelo caduca»):
   `git diff aff769d8 origin/dev -- db/schema.prisma db/migrations` sale **vacío** con `origin/dev`
   en `d21c5e6f`, o sea que la lista del `down.sql` que escribió el backend **sigue siendo cierta**
   contra el `dev` de hoy. Si `dev` se mueve otra vez antes del merge, hay que repetir esa medida.
5. **Colisión con la 408 (mergeada en `dev` mientras corría esta ficha): ninguna.** Tocó
   `app/(app)/cierres-admin/_components/*` y `cierre-labels.ts`; esta ficha, `components/shared/`,
   `hooks/` y `app/(app)/novedades/`. Es lo que el diseño §8 había previsto.

---

## §8 — Commits

- `2407d097` — la campana, el panel y sus tres guardias (T6.1–T6.4)
- `3771bd03` — la pestaña de `/novedades` por URL y la mitad de página de R6 (T6.5)
- éste — la bitácora. T7.6: el informe describe el disco, no un commit, así que el blob
  commiteado se verifica en la rama antes de dar la ficha por entregada.

## §9 — Veredicto

**El frontend de la 409 está entregado y verificado**: `./init.sh` completo en verde
(**`INIT_EXIT=0`**, 1.880 archivos, 27.319 tests, **236 archivos contra Postgres ejecutados de
verdad y cero saltados** de `integration/db`), los 24 requisitos de frontend con test propio y con
los literales del contrato visual afirmados a mano, **doce mutaciones aplicadas y doce muertas,
cero supervivientes**. Queda abierto lo de §7, y lo primero de esa lista es **ver el panel en un
navegador** (T7.4).
