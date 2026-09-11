# 409 — Informe de REVISIÓN

> Rama `feat/409-panel-notificaciones-accionable-frontend` @ **`c9ad1ab8`** (PR **#777**, base `dev`).
> 7 commits, 61 archivos. Revisor: no edita código. Todo lo de abajo lo ejecuté yo en el worktree
> de la rama, con el árbol limpio y verificado antes y después de cada mutación.
>
> ⚠️ **El MCP `codebase-memory` SÍ estaba disponible en esta sesión** (a diferencia de las dos
> bitácoras, que declaran no haberlo tenido). Aun así, toda conclusión de este informe sale de
> **leer el archivo real** y de **ejecutar**, nunca del grafo: la regla 7 de `CLAUDE.md` avisa de
> que el índice miente devolviendo de más.

---

## §1 — Veredicto

**RECHAZADO** — por **un (1) bloqueante de checkpoint**, de trámite, que **no toca una línea de
código de producción**.

Dicho con la misma claridad: **la ingeniería de esta ficha está bien**. 66 de 66 requisitos con
test propio y verificado por mí, las dos mutaciones que me pidieron reaplicar muertas con el conteo
exacto que declaran, el hallazgo que decide la ficha probado contra Postgres real, y cero
debilitamientos en los tests ajenos que se tocaron. Lo que falta es **anotar el estado**, y falta
justo donde más importa: dos tareas **no se ejecutaron** (T7.4 y T7.5) y con `tasks.md` entero en
blanco **no hay forma de distinguir «no hecha» de «no anotada»**.

Coste de la vuelta: minutos. No hay que re-revisar el código.

---

## §2 — Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `specs/409-.../requirements.md` con 66 requisitos EARS numerados `R1`…`R66`. Cero preguntas
      abiertas; las nueve del borrador cerradas por el humano el 2026-09-10 y anotadas en §13.
- [x] `design.md` con alternativas descartadas **y su porqué** — hay **tres**: derivar los avisos
      agregados al leer (§5.1), apagar la fila con un `UPDATE` (§5.2) y `useSyncExternalStore` con
      temporizador en el cliente (§3.4).
- [ ] **`tasks.md` con todas las tareas `[x]` → FALLA.** 36 tareas, **0 marcadas**. Ver §4.B1.

### Trazabilidad
- [x] Cada `R<n>` mapea a **al menos un test concreto y no vacío**. Los 66 verificados por mí,
      uno a uno (§3).
- [x] `progress/impl_409_backend.md` y `progress/impl_409_frontend.md` contienen el mapa
      `R<n> → test`, repartido 44 backend / 24 frontend (la mitad de página de R6 incluida).

### Calidad de código
- [x] `pnpm run typecheck` — pasó en mi corrida del gate.
- [x] `pnpm run lint` — pasó, 0 errores (183 warnings, todos previos).
- [~] `pnpm test` — **1.880 archivos, 27.318 pasados, 26 saltados, 1 rojo AJENO**. Ver §5.
- [x] E2E: **no aplica**. La ficha no toca auth, pagos, recaudo, ingesta de órdenes ni webhooks; y
      este repo no tiene arnés E2E ejecutable (los specs existentes dicen «NOT EXECUTED»).

### Datos y seguridad (Supabase)
- [x] **RLS: no aplica, y está bien que no aplique.** La ficha no crea ninguna tabla ni columna
      (el diff de `db/schema.prisma` son **4 valores de enum y nada más**; `+model` = 0).
      `notificacion` conserva la RLS de la 146.
- [x] Migración versionada y reversible. `20260911120000_notificacion_evento_avisos_agregados`
      lleva su `down.sql`, y el backend ejercitó `migrate deploy` → `db:rollback` → `migrate deploy`
      contra la base local.
- [x] **Ningún secreto hardcodeado.** Barrido del diff en `lib/`, `app/`, `components/`, `hooks/`
      buscando `secret|api_key|password|token` asignados a literal: **cero**. El cron lee
      `CRON_SECRET` vía `loadCronConfig()`.
- [x] Webhooks nuevos: **ninguno**. El route handler del cron valida `Bearer` **antes de cualquier
      efecto** (5 casos de 401, incluido «secreto no configurado») y es **idempotente por
      construcción**: `notificacion_dedupe_key` + entidad `ambito:diaCR`.

### Patrón de capas
- [x] Controller (`app/api/cron/avisos-diarios/route.ts`): solo HTTP, secreto y composition root.
      Ni una query, ni una regla.
- [x] Service (`AvisosDiariosService`, `VigenciaAvisoAgregadoService`): sin `Request`/`Response`/
      `headers`; repositorio, umbral, notificadores y reloj entran por constructor.
- [~] Repository: `AvisoAgregadoRepository` es solo Prisma **salvo** que filtra por antigüedad y
      agrupa **en memoria**. Declarado y bien argumentado. Menor, ver §4.m8.
- [x] Interfaces en `lib/interfaces/repositories/` y `lib/interfaces/services/`, una por archivo.

### Permisos
- [x] `/novedades` sigue resolviendo el rol en el servidor (`resolveActorFromSession`) y haciendo
      `notFound()` a todo lo que no sea `adminTienda`. La lectura de `?superficie=` va **después**
      de esa comprobación.
- [x] `NotificationsBell` recibe todo resuelto; no clasifica, no compone texto, no lee el reloj y
      no conoce rutas por evento. `predicadoVisibilidad` **no se toca** (R64, diff vacío).
- [x] Mutaciones internas por Server Actions; las 4 firmas de `lib/actions/notificaciones.ts`,
      intactas.

### Multi-país / configuración
- [x] Umbral en `lib/config/avisos-diarios.ts` (con la medición al lado), plazo en
      `lib/config/devolucion-sla.ts`, día calendario por `fechaCalendarioCR`, y el cron en **UTC**
      con la conversión escrita (`0 13 * * *` = 07:00 CR). Nada incrustado.

### Verificación final
- [~] `./init.sh` completo: **`INIT_EXIT=1`** por un rojo ajeno y medido como flake. Ver §5.
- [x] `progress/review_409.md`: este archivo.
- [ ] **Entrada en `progress/history.md` → FALTA.** Ver §4.m1.

---

## §3 — Trazabilidad: 66 de 66 verificados POR MÍ

No me fié del mapa de las bitácoras: ejecuté los archivos y leí los asertos. **407 casos** viven en
los 27 archivos de test que la rama toca.

| Bloque | Requisitos | Dónde lo comprobé |
| --- | --- | --- |
| Catálogo | R1–R4 | `catalogo-avisos.test.ts` (13 casos). R1 compara las claves contra el enum de **Prisma**: el enum es la fuente y el catálogo quien debe seguirla, así que no es «aserción contra su propia fuente», es el contrato |
| Rutas y atajos | R5, R6 | `atajo-aviso-ruta-visible.guardia.test.ts` (9 casos), con autocomprobación de que el recorrido encuentra al menos 12 destinos antes de afirmar nada |
| Pestaña por URL | R7, R66 | `novedades-pestana-por-url.test.ts` (7) + `NovedadesTabs.test.tsx` (3 nuevos) |
| La campana cuenta trabajo | R8–R15 | `notificacion-service.test.ts` (lado servidor) + `NotificationsBell.test.tsx` (lado cliente) |
| El panel | R16–R29 | `NotificationsBell.test.tsx` + las 3 guardias de ancho, tokens y reloj |
| El tono | R30 | 2 casos, y la mutación reaplicada por mí (§6.2) |
| Instante relativo | R31–R33 | `tiempo-relativo.test.ts` (10 casos, con los dos bordes de «ayer» a las 23:59 y 00:01 CR) |
| DTO aditivo | R34 | `notificacion-dto-aditivo.test.ts` + `typecheck` |
| Novedades sin gestionar | R35–R44 | `novedades-sin-gestionar-aviso.test.ts`, `avisos-diarios-service.test.ts`, `aviso-agregado-repository.test.ts` (Postgres real) y `novedades-sin-gestionar-aviso-dedupe.test.ts` (Postgres real) |
| Devoluciones represadas | R45–R54 | `devoluciones-represadas-aviso.test.ts`, `avisos-diarios-service.test.ts`, y los **dos** archivos contra Postgres real |
| Se apagan solos | R55–R58 | `notificacion-service.test.ts` + `vigencia-aviso-agregado.test.ts` |
| Emisión diaria | R59–R62 | `avisos-diarios-route.test.ts` (9) + `notificacion-notificadores-reales.test.ts` |
| Datos y seguridad | R63–R66 | `notificacion-evento-avisos-agregados-migration.test.ts` (20 casos contra Postgres real) + las dos suites vigentes **sin editar** |

**R64 y R65 están verdes SIN editarse**, y lo comprobé por diff, no por palabra: el
`git diff --stat dev...HEAD` de `tests/unit/repositories/notificacion-visibilidad.test.ts` y de
`tests/integration/actions/notificaciones-action.test.ts` sale **vacío**.

---

## §4 — Hallazgos

### B1 — `BLOQUEANTE` · `tasks.md` tiene 36 tareas y **ninguna** marcada `[x]`

El conteo de marcas `[x]` es **0**; el de casillas vacías es **36**. Y el historial de
`specs/409-panel-notificaciones-accionable/tasks.md` devuelve **un solo commit**: `aff769d8`, el del
spec. Nadie volvió a tocar el archivo.

**Por qué esto sí importa, y no es burocracia.** Dentro de esas 36 hay **dos que de verdad NO se
ejecutaron** (T7.4, ver el panel en un navegador, y T7.5, medir producción en solo lectura) y una
tercera que caduca (T2.5, releer las listas del `down.sql` contra `origin/dev` al abrir el PR). Con
la lista entera en blanco, **«no hecha» y «no anotada» se leen exactamente igual**, y quien mire
esta ficha dentro de un mes no puede saber cuál es cuál sin releer 750 líneas de bitácora. Es la
familia «ficha `in_progress` = deuda escondida» de este repo.

**Qué falta para cumplirlo:** marcar `[x]` las 33 ejecutadas y **dejar T7.4 y T7.5 sin marcar, con
su motivo escrito en la propia línea**. Cero cambios en código. Cero re-revisión.

### m1 — `menor` · `progress/history.md` no tiene entrada de la 409

Buscar «409» en `progress/history.md` no devuelve nada. Es el último punto de `CHECKPOINTS.md`.
Normalmente lo escribe el leader al cerrar, así que lo dejo como menor y no como parte de B1.

### m2 — `menor` · T7.4: nadie ha visto este panel en un navegador

Declarado con nombre en las dos bitácoras y en `design.md` §9, así que **no es un descuido: es un
límite escrito**. Lo confirmo y lo dejo aquí para que no se pierda al cerrar la ficha.

Lo que jsdom **no** mide y esta ficha estrena: contraste de las tres pastillas semánticas en tema
oscuro (la 208 ya arregló esta misma campana una vez porque iba con `navy` fijo y **desaparecía**),
el alto de una fila con un título largo, el desborde del panel de 400 px en pantallas estrechas, y
el aspecto del bloque de filtro con la píldora deshabilitada. La tarea pide **20 avisos o más**, con
atajo, **sin** atajo, informativos y un texto largo, **en los dos temas**.

### m3 — `menor` · T7.5: la medición en producción sigue sin hacerse, y es puerta de despliegue

El backend la declara «NO EJECUTADA» (no tenía el MCP de Supabase). Sostiene dos decisiones:
`DIAS_REPRESAMIENTO = 3` y **no vigilar `por_devolver_a_tienda`**. Las dos descansan en la medición
del 2026-09-10 (27 órdenes en `por_devolver`, 7 por encima de 3 d). **Antes de desplegar** hay que
confirmar el orden de magnitud **diciendo el número**, y medir `por_devolver_a_tienda`.

Recordatorio del repo: producción se vació a propósito el 2026-08-25; **un cero significa «aún no ha
pasado», no «está roto»**.

### m4 — `menor` · La bitácora del frontend dice «de 34 a 43 tests»; eran **28**

`tests/components/NotificationsBell.test.tsx` tenía **28** casos en el punto de partida (`fa8a72ef`,
idéntico a `dev` para ese archivo) y tiene **43** ahora. La cuenta correcta es **28 a 43**: 21 casos
intactos, 7 renombrados, **15 nuevos, 0 borrados**. No cambia ninguna conclusión, pero un número
mal en una bitácora es el que alguien cita después.

### m5 — `menor` · «tres tests vigentes» afirman «Marcar todas como leídas»; son **dos** sitios

En `dev` el literal aparece en 2 sitios del archivo, y uno de ellos es el helper `abrir()`, que usan
**casi todos** los casos de la suite. O sea: el efecto real de acortar el rótulo es mucho **mayor**
que «tres tests». La decisión es correcta; el conteo no. Ver mi juicio completo en §8.

### m6 — `menor` · Un `adminSatelite` **sin zona** pediría la cifra GLOBAL

`VigenciaAvisoAgregadoService.cifra` resuelve la zona como «la del actor, o `null`» cuando el rol es
`adminSatelite`, y `null` significa **todo el sistema** en `contarRepresadas`. Hoy es inalcanzable
(el predicado de visibilidad de la 146 no le entrega una fila acotada por zona a un satélite sin
zona) y el test lo dice en su comentario. Pero **la seguridad la da otra capa, no este seam**, y el
nombre del caso («no ve el total») promete algo que el aserto no comprueba: lo que comprueba es que
se pide `null`.

### m7 — `menor` · La guardia de R6 (mitad de página) se satisface con el nombre en un comentario

`atajo-aviso-ruta-visible.guardia.test.ts` abre el fuente de la página de destino y exige que
contenga `searchParams` **y** el nombre del parámetro. Un `superficie` escrito solo en un comentario
pasaría. **No es un agujero real** porque el aserto de comportamiento existe y es bueno
(`novedades-pestana-por-url.test.ts` monta la página y el `TabsGroup` **reales** y afirma
`aria-selected`), pero conviene saber cuál de los dos sostiene R6.

### m8 — `menor` · El repositorio filtra y agrupa en memoria

`AvisoAgregadoRepository.filasRepresadas` trae las filas y aplica el umbral en JS. Está **declarado
y bien argumentado** en el propio archivo: la condición es sobre la **última** transición
(`take 1` tras `orderBy desc`) y un `where` relacional casaría con «existe **alguna** fila antigua»,
o sea que una orden que salió de `por_devolver` y volvió hoy entraría como represada de hace
semanas. La población son decenas de filas. Lo anoto solo porque `CHECKPOINTS.md` dice «Repository
solo ejecuta queries Prisma».

### m9 — `menor` · Un aserto de 146/R49 cambió de **clase**, no solo de texto

«Sin anexo no se pinta la línea» pasó de un `queryByText` con la etiqueta a un conteo de nodos `p`
dentro del `li`. **No es más débil** (cazaría incluso un `p` vacío), pero queda acoplado al marcado.
Es el único de los nueve donde el aserto cambió de forma y no solo de literal.

---

## §5 — El gate, corrido por mí

`./init.sh` **completo** (el rápido se niega solo: el diff toca `db/schema.prisma`,
`db/migrations/**` y `lib/types/**`). El código de salida va escrito **DENTRO** del log, no leído
del runner, y el log no se canalizó por `tail`.

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 158 archivos de tests contra Postgres SI se ejecutan
 Test Files  1 failed | 1879 passed (1880)
      Tests  1 failed | 27318 passed | 26 skipped (27345)
✗ hay rojos NUEVOS respecto del baseline
INIT_EXIT=1
```

### El rojo es AJENO y está medido como flake de saturación

`tests/integration/recuperar-contrasena-form.test.tsx` › «muestra confirmación y enlace a login tras
restablecer con éxito». **1 caso de 11.**

- **Qué falló:** `TestingLibraryElementError: Unable to find an element with the text: Contraseña
  actualizada` tras 1803 ms, con el formulario todavía en «Nueva contraseña». Es un **timeout**, no
  una aserción rota: el primero de los dos modos de flake que este repo tiene documentados.
- **La 409 no toca ese archivo**, ni el formulario, ni su acción: el `git diff --stat dev...HEAD`
  de `tests/integration/recuperar-contrasena-form.test.tsx`, de `app/(auth)/` y de
  `lib/actions/auth.ts` sale **vacío**.
- **Aislado pasa: 3 corridas de 3, 11/11 cada una** (19:15:16 y dos seguidas después).
- **Causa medida:** 11 procesos `node` de otros agentes corriendo en paralelo sobre la misma
  máquina y la misma Postgres local mientras yo corría el gate.
- **NO entra en `tests/baseline-rojos.json`**: no es deuda de `dev`, es ruido de mi entorno. Esa
  lista está hoy vacía a propósito y así debe quedarse.

**Ningún `40P01`** en el log (0 ocurrencias). Los tests de esta ficha llaman a
`serializarEscriturasReales`, que es la disciplina anti-deadlock de la 227.

### Los `skipped`, mirados uno a uno (no solo el `INIT_EXIT`)

- **236 archivos de `tests/integration/db/` ejecutados con ✓** en MI log, contados sobre la salida,
  y son **los 236 `.test.ts` que hay en el directorio**. **Cero saltados.**
- Los **26 `skipped`** son **exactamente** `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx`
  (9). **Ni uno es de `integration/db`**: el cruce de `skipped` con `integration/db` sale vacío.
- Los **cuatro archivos que sostienen esta ficha contra Postgres real corrieron enteros**, con sus
  42 casos: `aviso-agregado-repository` (11), `novedades-sin-gestionar-aviso-dedupe` (5),
  `devoluciones-represadas-aviso-dedupe` (6), `notificacion-evento-avisos-agregados-migration` (20).

### Y lo que NO se tocó para pasar el gate

El `git diff --stat dev...HEAD` de `tests/baseline-rojos.json`, `init.sh` y `tests/fixtures/` sale
**vacío**. Ni el baseline de rojos, ni el gate, ni el quitador de comentarios del que dependen 171
guardias. **No se escondió ningún rojo.**

---

## §6 — Las mutaciones que reapliqué YO

Árbol limpio antes y después de cada una, verificado con `git status --short` y `git diff --numstat`.

### 6.1 — El hallazgo que decide la ficha: quitar el `tiendaId` del `entidad_id`

En `lib/notificaciones/emitir.ts`, el `entidadId` del aviso de novedades pasa de llevar la tienda y
el día a llevar **solo el día**.

**3 rojos, exactamente los 3 que declara la bitácora:**

```
× novedades-sin-gestionar-aviso › el `entidadId` es exactamente `<tiendaId>:<diaCR>`
× novedades-sin-gestionar-aviso › DOS tiendas el MISMO dia reciben DOS avisos
× novedades-sin-gestionar-aviso-dedupe › ⭑ dos tiendas con novedades el mismo día -> DOS filas
  Test Files  2 failed | 1 passed (3)
       Tests  3 failed | 29 passed (32)
```

**El tercero es el que vale, y corre CONTRA POSTGRES REAL.** Es el único que ejercita el índice
`notificacion_dedupe_key` de verdad. Sin el `tiendaId` dentro, las dos filas comparten
`('novedades_sin_gestionar', '<día>', 'adminTienda', NULL)` —`tienda_id` **no está** en la clave— y
`NotificacionRepository.crear` **absorbe el `P2002` devolviendo `false`**: la segunda tienda queda
muda **sin error, sin log y sin nada**.

Y el dato que lo hace crítico: **las 27 órdenes represadas de producción son de una sola tienda**,
así que **producción nunca habría cazado ese silencio**. Ese test es la única prueba que existe.

El archivo además trae su propia **mutación a pelo contra el motor** (entidad = el día a secas, y la
segunda tienda devuelve `false` con 0 filas) **y su control positivo** (con el `tiendaId` dentro,
las dos conviven). Es la forma correcta: si el `INSERT` fallara por cualquier otra cosa, el caso de
la mutación estaría verde midiendo su propio ruido.

### 6.2 — El tono: devolverle `noLeidas` al hook

En `components/shared/NotificationsBell.tsx`, `useTonoAlIncrementar` vuelve a recibir `noLeidas` en
vez de `porHacer`.

**2 rojos, los 2 que declara:**

```
× 409/R30 › subir las NO LEÍDAS sin subir lo por hacer NO suena
× 409/R30 › subir lo POR HACER sí suena, una sola vez
  Tests  2 failed | 41 passed (43)
```

El par está bien construido: el negativo solo no bastaría —un hook **desconectado** también lo
pasaría—, y el positivo lo cierra.

### 6.3 — `PROYECCION_ANCLAJE_DEVOLUCION` se declara **una sola vez**

Verificado con un barrido del árbol, no con el grafo:

```
lib/repositories/DevolucionSlaRepository.ts:41    export const PROYECCION_ANCLAJE_DEVOLUCION = {...}
lib/repositories/DevolucionSlaRepository.ts:108        historialEstados: PROYECCION_...   <- lector 1 (el cron)
lib/repositories/AvisoAgregadoRepository.ts:9     import { PROYECCION_ANCLAJE_DEVOLUCION }
lib/repositories/AvisoAgregadoRepository.ts:97         historialEstados: PROYECCION_...   <- lector 2 (el aviso)
```

**Una declaración, dos lectores, cero copias.** El diff de `DevolucionSlaRepository` enseña que la
proyección se **extrajo** del sitio donde ya estaba (misma `where`, mismo `orderBy`, mismo `take`,
mismo `select`), así que no hay cambio de comportamiento: las suites de la 99/239/276 siguen verdes
sin editarse.

Y la guardia que paró al backend tenía razón. El efecto de la segunda derivación habría sido un
aviso diciéndole a la tienda «lleva 3 días» sobre una orden a la que el cron le cuenta 5: **un
texto que miente sobre un plazo con el que la tienda organiza su trabajo**. Que el implementer
resolviera compartiendo el punto único en vez de relajar la guardia es la decisión correcta.

### 6.4 — `?superficie=`: la guardia **abre el fuente del destino**

R6 no es una regla escrita: es un aserto. El último `describe` de
`atajo-aviso-ruta-visible.guardia.test.ts` lee el fuente de `app/(app)/novedades/page.tsx`
—resuelto por un mapa ruta-a-archivo **escrito a mano**, para que un destino sin página falle por
rojo y no por «no encontré archivo»— y exige `searchParams` **y** el nombre del parámetro. Lleva
además su propia mutación (`estadoInventado`) y un aserto de que la validación es lista blanca
contra `GRUPOS_NOVEDAD` y **no** un `as`.

La mitad de comportamiento la cierra `novedades-pestana-por-url.test.ts`, que **monta la pantalla de
verdad** —con su `NovedadesTabs` y su `TabsGroup` reales— y afirma `aria-selected` sobre las
pestañas, en vez de mockear el módulo y medir que la prop llega. La distinción está escrita en la
cabecera del archivo y es la correcta: *la prop podría llegar y `TabsGroup` ignorarla*.

Limitación real: la mitad de guardia se satisface con el nombre en un comentario (m7).

---

## §7 — El `down.sql`: la tercera lectura, hecha por MÍ

T2.5 manda releer las listas contra `origin/dev` **justo antes de abrir el PR**, porque el pre-vuelo
caduca. El backend la hizo dos veces (contra `aff769d8` y contra `2d790a13`) y dejó dicho que
faltaba la tercera. **La hice:**

- `origin/dev` está hoy en **`b84e5c75`**.
- `NotificacionEvento` allí: **11 valores**. `NotificacionEntidadTipo`: **9**.
- Las dos listas del `down.sql` de la 409: **11 y 9, los mismos nombres y en el mismo orden**.

**Coinciden exactamente.** El `down` recrea los enums tal y como están en `dev` hoy, con los dos
valores de la 403 y los dos de la 401 **dentro**: revertir esta migración **no borraría en silencio**
nada de otra ficha. Es la lección que la 401 pagó con la 403.

Lo demás de la migración también lo comprobé: los **siete** `down.sql` anteriores **no se tocaron**
(el test de migración lo afirma uno a uno y además comprueba que ninguno menciona los valores de
esta ficha), el `up` son cuatro `ADD VALUE IF NOT EXISTS` y nada más, el `down` **no lleva ni un
`DELETE`** para «hacer sitio», y su precondición ruidosa está medida: con una fila de un evento
nuevo el down **aborta**, y sin ella corre entero y el índice `notificacion_dedupe_key` **sobrevive
a la reconstrucción** con su `NULLS NOT DISTINCT` y su `WHERE` parcial.

---

## §8 — Los NUEVE literales cambiados: mi juicio

La pregunta era si el contrato cambió por decisión o si el aserto se aflojó para que pasara el
propio. Los miré uno a uno, y también busqué lo que no se declara: **casos borrados**.

**Casos borrados: NINGUNO.** Comparé los nombres de caso del archivo en `fa8a72ef` (= `dev`) con los
de ahora: **28 antes, 43 después**; los 7 nombres que desaparecen tienen los 7 su sucesor evidente
en el mismo `describe`. **21 intactos + 7 renombrados + 15 nuevos.**

| # | Caso vigente | Veredicto |
| --- | --- | --- |
| 1 | 146/R41 «distintivo con la cantidad de no leídas» | **Contrato derogado, y el nuevo es MÁS ESTRICTO.** Los datos pasan a ser 2 accionables **leídos** + 1 informativa **sin leer**: contando lecturas diría «1», contando filas «3», y solo lo correcto da «2». Añade además que el nombre accesible no puede contener «sin leer» |
| 2 | 146/R42 «+99 con más de 99 no leídas» | **Derogado (R12), y MÁS ESTRICTO.** Ahora `noLeidas: 1` y `porHacer: 120`: el caso **demuestra** de qué cifra sale el distintivo, cosa que el original no podía |
| 3 | 146/R49 (mitad del anexo) | **Derogado (R20).** Misma información, sin la etiqueta de jerga, **más** una negativa sobre «Anexo:» **y un caso nuevo** con una fila que **sí trae** anexo: sin él, la negativa pasaría por no haber anexo ninguno. La otra mitad (los tres iconos con su nombre accesible) **se conserva**. Único matiz: m9 |
| 4 | 146/R50 (datos iniciales) | **Derogado (R13).** Solo cambia el literal del nombre accesible |
| 5 | 161/R19 «suena cuando suben las no leídas» | **Derogado (R30 / Q8).** Y lo verifiqué ejecutando la mutación: §6.2 |
| 6-7 | 161/R11-R24 x2 «no suena al montar» | **Solo el literal y los datos.** El comportamiento medido —no sonar al montar— es idéntico |
| 8-9 | 161/R20 x2 «marcar leídas / descartar no suenan» | **Solo el literal** «2» pasa a «2 por hacer». Mismo comportamiento |
| + | 161/R14 «silenciado no suena» | **Solo datos y literal**, y el nuevo dataset además hace que el caso pruebe de verdad el camino silenciado bajo el criterio nuevo |

**Conclusión: nueve derogaciones legítimas, cero asertos aflojados, cero tests borrados.** Los
literales van **escritos a mano** en todos los casos; ningún test importa `TEXTOS`,
`CATALOGO_AVISOS` ni ninguna constante de producción como valor esperado (lo comprobé sobre los
`import` de los archivos). La lección «literal: contrato o polizón» se aplicó al revés de como suele
fallar: donde el literal **ERA** el contrato —los censos de enum de
`notificacion-productores-wiring.test.ts` y los cinco `...-migration.test.ts`— las listas se
**extendieron a mano con su motivo escrito**, no se sustituyeron por su propia fuente.

---

## §9 — La desviación del rótulo «Marcar todas como leídas»: es CORRECTA

El mockup dibuja «Marcar leídas». El componente conserva «Marcar todas como leídas». **Juzgo que
está bien**, y por una razón más fuerte que la que da la bitácora:

R28 protege el **comportamiento vigente** de ese control, y en `dev` el literal está en el helper
`abrir()` de la suite, que usan **casi todos** los casos del archivo. Acortarlo no habría roto «tres
tests»: habría roto la suite entera por una ruta que no tiene nada que ver con la 409, y habría
obligado a editar tests vigentes que R28 manda dejar quietos. **A cambio de cero requisitos.**

Y es una desviación **declarada**, no escondida: está escrita en `progress/impl_409_frontend.md`
§2.3 con su porqué. Eso es exactamente lo que hay que hacer con una desviación del contrato visual.

La otra desviación declarada —«se rechaza automáticamente» en singular, donde el `.dc.html` escribe
«se rechazan»— también es correcta: concuerda con «la más antigua», que es el sujeto real de la
frase, y el spec la fija así en R39.

---

## §10 — Las trampas que fui a buscar, y qué encontré

| Trampa | Resultado |
| --- | --- |
| **Aserción contra su propia fuente** | **No aparece.** Ningún test compara un texto contra la función que lo genera. Los títulos con cifra («5 novedades esperan tu decisión», «12 órdenes esperan volver a su tienda»), el plazo («A los 5 días se rechaza automáticamente.») y el del represamiento van escritos a mano. La configuración se afirma aparte y también a mano (5 y 24) |
| **Literal: contrato o polizón** | **Bien resuelto**, en los dos sentidos. Ver §8 |
| **Los dobles no ven el SQL** | **Bien colocado.** `porHacer` **no depende de ningún `where` nuevo** (se deriva en el servicio sobre la lista ya cargada), así que los dobles sí lo cubren de verdad. Lo que **sí** es SQL —la cifra viva y los resúmenes del cron— vive en `tests/integration/db/` contra Postgres real, y lo vi correr |
| **Test verde sin datos** | **Defendido explícitamente.** Los archivos contra Postgres empiezan afirmando que la tabla `orden` no está vacía, con su mensaje: fallan **ruidosamente** con la base vacía en vez de reportar `passed`. Y R45 lleva **control positivo**: sin el umbral tienen que entrar las dos órdenes, así que una siembra que no llegara pondría el caso rojo en vez de dejarlo pasar por vacío |
| **El composition root que no inyecta** | **Cubierto, y de la forma que caza el fallo real.** Los dos asertos van sobre el **uso efectivo** (fuente sin imports ni comentarios) con un `toMatch` sobre la llamada a `new AvisosDiariosService(...)`, no con un `toContain` que el `import` satisfaría. Hay un segundo para el resolutor de vigencia en `lib/actions/notificaciones.ts`. **Y el default del resolutor LANZA** en vez de devolver 0 o 1: las dos opciones silenciosas eran las peligrosas |
| **El `down.sql` que borra valores posteriores** | **Correcto, y lo re-medí yo.** Ver §7 |
| **El test que vive dentro de lo que borras** | No aplica: la ficha no borra ningún componente ni ningún test |

---

## §11 — `presentacionDe(fila)`: la puerta previa de la 410

Verificado, porque es la dependencia de la ficha siguiente:

- **Pura e invocable desde el servidor.** `lib/notificaciones/presentacion-aviso.ts` importa, en
  runtime, **un solo módulo**: `catalogo-avisos.ts`, que a su vez solo tiene `import type`. Ni
  React, ni `next/*`, ni `@/lib/db`, ni repositorios, ni servicios, ni reloj. Lo comprobé leyendo
  la cadena entera, no solo el archivo de entrada. (El test de pureza mira los imports **directos**;
  la transitividad la verifiqué a mano.)
- **Sin sesión, sin DTO, sin `Actor`**: su entrada es una fila y el **rol de quien la va a leer**.
  La distinción está bien vista y bien documentada: `cierre_dia_vencido` y
  `mensajero_bloqueado_por_cierres` le llegan al mensajero como fila **dirigida a usuario**
  (`destinatario_rol` NULL), y es justo para él para quien son accionables.
- **Los tres estados de `cifraViva` no se confunden**: mayor que cero compone el título, `0`
  devuelve `null` (apagado, R55) y `null` o ausente **se presenta igual sin número** (R58).
  Confundir el último con el `0` apagaría avisos vivos cada vez que fallara una consulta. Hay un
  caso por cada uno.
- **El servicio de la campana usa ESTA función**, no una copia: hay un aserto de que
  `NotificacionService.ts` contiene `presentacionDe(`. Push y panel no pueden divergir.

---

## §12 — Qué falta para que esto sea `OK`

1. **`tasks.md`**: marcar `[x]` las 33 ejecutadas y dejar **T7.4** y **T7.5** sin marcar **con su
   motivo en la línea**. (B1, el único bloqueante)
2. **`progress/history.md`**: añadir la entrada de la 409. (m1)

Nada más. **Ni una línea de código de producción, ni un test.** Cuando eso esté, el veredicto es
`OK`: la trazabilidad está completa y verificada, el gate está verde salvo un flake ajeno y medido,
y las mutaciones obligatorias mueren con el conteo que declaran.

Y antes de dar la ficha por **hecha** (que no es lo mismo que mergeada), quedan las dos puertas que
la propia ficha se puso: **ver el panel en un navegador** (T7.4) y **medir producción en solo
lectura** (T7.5).

---

## §13 — Veredicto final

**RECHAZADO** — 1 bloqueante (B1, de trámite), 9 menores. Ninguno pide tocar código de producción.
