# 413 — Informe de revisión

> Ficha `backend`, `sdd: true`. PR **#785**, rama `feat/413-aviso-reparto-de-manana`
> @ `b5373478`, base `origin/dev` @ `01d280ae`.
> Worktree de revisión **propio** en `R:/wt/rev413` (ruta corta), `pnpm install --frozen-lockfile`
> mas `prisma generate` dentro, con copia del `.env` del árbol principal (SHA256 verificado) para
> que `integration/db` **no se salte**.
> **Nada se dio por bueno leyendo la bitácora**: cada afirmación de abajo se remidió aquí.

---

## Veredicto

# OK

**Ningún hallazgo bloqueante.** Los cinco puntos de riesgo que traía el encargo —el `down.sql`, la
trampa de la fecha, el arnés de mutaciones, el barrido que ensució la base compartida y el gate— se
remidieron **de forma independiente** y **los cinco se sostienen**. Los cuatro hallazgos son `menor`
y ninguno pide código: tres son puertas del humano ya declaradas y uno es una etiqueta.

---

## 1. El `down.sql` — lo primero, y está CORRECTO

El implementador dice que **corrigió el spec** (14 eventos y 12 entidades, no los 13 y 11 del
design, que era la foto anterior al merge de la 412). **Es cierto, y se verificó contra la base, no
contra el esquema.**

| Comprobación | Método | Resultado |
| --- | --- | --- |
| Valores hoy en `origin/dev` | `git show origin/dev:db/schema.prisma` | **14** eventos, **12** entidades |
| Valores en la base REAL | `pg_enum` + `pg_type` + `pg_namespace`, con `nspname='public'` | **15** y **13** (= 14/12 **mas los dos de esta ficha**, ya aplicada en local), luego la base previa es **14/12** |
| El `down.sql` los enumera TODOS | `diff` conjunto a conjunto contra `origin/dev` | **IDÉNTICOS**, ni uno perdido |
| `cierre_dia_rechazado` y `cierre_dia_rechazo` (la 412) | presentes en las dos listas del down | correcto: **no se borran en silencio** |

**Las TRES columnas, medidas con `information_schema` y no supuestas:**

```
notificacion   | entidad_tipo | notificacion_entidad_tipo
notificacion   | evento       | notificacion_evento
push_envio_dia | evento       | notificacion_evento
TOTAL: 3        <-- NO ha aparecido una cuarta
```

El `down.sql` retipa las tres, y las dos del enum de eventos van **antes** de su `DROP TYPE`.

### El down EJERCITADO, con mutación propia

No basta con que el test lo diga. **Le quité al `down.sql` el bloque de `push_envio_dia`** y corrí
la suite de migración:

```
x R38: el down retipa LAS TRES columnas, no dos — incluida `push_envio_dia.evento`
x R38: CONTROL — sin filas de los valores nuevos, ese MISMO down corre ENTERO ...
Raw query failed. Code: 2BP01. Message: no se puede eliminar tipo notificacion_evento_old
porque otros objetos dependen de él
Tests  2 failed | 25 passed (27)
```

El `2BP01` es **de Postgres de verdad**, no de un doble. Restaurado con copia byte a byte y
**SHA256 verificado** (`3c9c292b...d213cb` antes y después); 27/27 verde tras restaurar.

**`EVENTOS_PREVIOS` y `ENTIDADES_PREVIAS` del test están escritos A MANO**, con el número de ficha
al lado de cada valor — **no derivados del `down.sql`**. No es una aserción contra su propia fuente.

### Los `down.sql` anteriores: NO se tocaron

El diff de la rama acotado a los `down.sql` de migraciones devuelve **un solo archivo: el nuevo**.
Las nueve fotos históricas quedan intactas.

---

## 2. La trampa de la fecha — la ventana SÍ está defendida

`orden.fecha_reparto` es `@db.Date`, así que **`startOfDayCR` es el helper correcto** y los
`inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` serían el error. El código usa `startOfDayCR`
en los **dos** puntos donde se decide la cota:

- `lib/services/RepartoMananaAvisoService.ts:75`
- `lib/services/VigenciaAvisoAgregadoService.ts:192`

**Maté la elección**, y no con el `+6 h` inline del implementador sino **cambiando el helper de
verdad** en los dos sitios:

```
x la cota que pide al repositorio es la medianoche UTC del día CR en curso (@db.Date)
x se pide con actor.usuarioId y con la cota de HOY, y devuelve esa cifra
x con el reloj en las 00:01 CR del 12, la cota AVANZA sola
Tests  3 failed | 99 passed (102)
```

**Se rompe.** La ventana está defendida en los dos lados: la emisión y la cifra viva. Restaurado con
SHA256 verificado.

**Matiz que el implementador declara y confirmo:** el test `[PG]` recibe la cota **como parámetro**,
así que quien mata el cambio de helper son los tests de servicio y de vigencia, no el `[PG]`. Lo que
el `[PG]` aporta —y ningún doble puede— es la semántica del `>` contra una columna `@db.Date` real.
**Las dos piezas juntas cubren R3; ninguna sola bastaba.** Está dicho en la bitácora en vez de
tapado, y es la lectura correcta.

---

## 3. Las mutaciones — el arnés SÍ ejecutó

En este repo un arnés reportó 9/9 supervivientes **dos veces sin correr un test**. Así que
**replanté una muestra y planté controles propios**. Todas reproducen los conteos declarados:

| Mutación | Declarado | Remedido por mí |
| --- | --- | --- |
| M7a `0 19 * * *` (hora CR en el cron) | 1 failed / 9 passed (10) | **idéntico** |
| M7b `0 5 * * *` (= 23:00 CR, franja nocturna) | 3 failed / 7 passed (10) | **idéntico** |
| M10 no consultar el bloqueo (R42) | 2 failed / 14 passed (16) | **idéntico** |
| M2 el aviso a un ROL (R7) | 7 failed / 17 passed (24) | 5 rojos en la suite `[PG]` |
| M12 quitar la entrada de `push-elegibles` | muerta por TYPECHECK `TS1360` | **`TS1360` literal** |
| M13 quitar la entrada del catálogo | muerta por TYPECHECK `TS2741` | **`TS2741` literal** |

**Los dos `Record` exhaustivos son ciertos, no una excusa.** Quitando las entradas, el typecheck
escupe exactamente `TS2741: Property 'reparto_manana' is missing ... but required in type
Record<NotificacionEvento, EntradaCatalogo>` y `TS1360: ... does not satisfy the expected type
Record<NotificacionEvento, PerfilPush>`. R25/R30/R31 **impiden compilar**, como exige el spec.

**Mutaciones propias que planté además de las suyas** (las cuatro murieron): quitar el retipado de
`push_envio_dia` del down; quitar un valor de `ESTADOS_REPARTO_MENSAJERO`; meter un **cuarto**
estatus en el portal; y pasar la constante a `findMisAsignaciones`.

---

## 4. EL HALLAZGO que había que juzgar: el barrido que ensució la base

El implementador declara que **su propio barrido dejó basura y puso ROJOS 15 casos de 5 suites
ajenas** (`22P02`), y que lo arregló barriendo por `evento`. **Las dos mitades verificadas:**

**(a) El barrido nuevo, contra el código MUTADO.** Planté M2 (el aviso a un ROL, que escribe
`destinatario_usuario_id = NULL`) y medí la base antes y después:

```
ANTES:            FILAS reparto_manana EN LA BASE: 0
CORRIDA CON M2:   Tests  5 failed | 3 passed (8)      <-- R7 rojo, como debe
DESPUÉS:          FILAS reparto_manana EN LA BASE: 0  <-- LIMPIA
```

**Sí limpia.** El barrido es por `evento: "reparto_manana"` **sin acotar por destinatario ni por
entidad**, que es lo único que ninguna mutación cambia. La lección está escrita dentro del test.

**(b) Las cinco suites hermanas corren limpias hoy.** Las cinco, más `no-migration-102` y
`notificacion-productores-wiring`:

```
Test Files  7 passed (7)
     Tests  125 passed (125)
```

**El hallazgo es real, el diagnóstico es correcto y el arreglo funciona.** Y la regla que deja
escrita —*un barrido que sólo limpia lo que el código SANO escribe es justo el que falla cuando hace
falta*— es la mitad que le faltaba a la lección de la 412.

---

## 5. Los tres huecos declarados — juicio

### 5.1 · T1.1 (no se cumplió como lo pedía el design) — ACEPTABLE, y el motivo está MEDIDO

El design pedía que `MisAsignacionesService` **importara** la constante. El implementador dice que
no puede porque `carga-del-mensajero.guardia.test.ts` (235/262) reventaría. **Lo comprobé pasándole
la constante de verdad:**

```
tests/unit/guards/carga-del-mensajero.guardia.test.ts (17 tests | 4 failed)
Error: guardia carga-del-mensajero: lib/services/MisAsignacionesService.ts:
...ESTADOS_REPARTO_MENSAJERO no es ni un literal ni un identificador simple.
```

**Es cierto.** Seguir el design habría puesto ROJA una guardia vigente. Y **maté las dos vías
sustitutas por separado**:

| Vía | Mutación | Resultado |
| --- | --- | --- |
| 1 · compilación | quitar `ayuda_tienda` de la tupla | `MisAsignacionesService.ts(109,7): error TS2322` |
| 2 · guardia | **cuarto** estatus en el portal | guardia 413 **ROJA**; typecheck **0 errores** |

**Las dos se ponen rojas solas y son COMPLEMENTARIAS**: la guardia caza exactamente lo que la
anotación de tipo no puede ver —un estatus de más en el portal—, que es el fallo que R2 existe para
cazar. La desviación deja el amarre **más fuerte**, no más débil.
`carga-del-mensajero.guardia.test.ts` y `atajo-aviso-ruta-visible.guardia.test.ts` siguen
**intactas** (diff vacío).

### 5.2 · T7.2 vacía — ACEPTABLE como puerta del humano (`menor`)

**El propio texto de T7.2 autoriza la casilla vacía**: *«Si no se hace, la casilla queda VACÍA;
marcarla sin haberlo visto convierte una declaración honesta en una mentira.»* No hay navegador en
el entorno y jsdom no mide desbordes ni contraste.

**Y el riesgo funcional NO queda descubierto**, que es lo que decide si el hueco vale: el destino
del atajo lo verifica `atajo-aviso-ruta-visible.guardia.test.ts` —**sin tocarla**, porque recorre
`CATALOGO_AVISOS` entero, así que la entrada nueva entra sola— comprobando que la ruta **existe en
`SIDEBAR_ITEMS` y es visible para `mensajero`**; y los literales del título van a mano (R27). Lo que
queda sin cubrir es **sólo lo visual** (desborde y contraste en los dos temas). Es un hueco real
pero estrecho, y está declarado con lo que hay que mirar escrito.

### 5.3 · T0.3 contra la base LOCAL, no producción — la conclusión SE SOSTIENE (`menor`)

La conclusión (la consulta caliente ya entra por `orden_mensajero_asignado_id_idx`, no hace falta
ficha de índice) se midió sobre **70 filas**. La preocupación es legítima —en este repo ya pasó que
el planificador elegía `Seq Scan` por tablas pequeñas y la conclusión «es barato» tenía otro
motivo— pero **aquí el sesgo va en la dirección favorable**:

- los dos índices **existen** (verificado en la base: `orden_mensajero_asignado_id_idx` y
  `orden_mensajero_asignado_at_fecha_reparto_idx`), y los crea una migración, así que están también
  en producción;
- una tabla **pequeña** empuja al planificador **hacia** `Seq Scan`, no hacia el índice. Que con 70
  filas ya elija `Index Scan` para el `count` por mensajero es el caso **pesimista**; con volumen
  real y un predicado selectivo por `mensajero_asignado_id` la elección del índice es **más**
  probable, no menos;
- el `GROUP BY` que sí eligió `Seq Scan` corre **una vez al día**.

**No pude medir producción yo tampoco**: en esta sesión **no tengo herramienta de Supabase en mi
conjunto** (sólo `codebase-memory`), y el `DATABASE_URL` de prod es *sensitive*. Lo dejo dicho en vez
de fingir que lo comprobé. **No bloquea**: lo único que decidía era si hacía falta una ficha de
índice, y si hiciera falta sería una migración aditiva de una línea en otra ficha.

---

## 6. El cron

| Comprobación | Resultado |
| --- | --- |
| **Una sola** entrada para `/api/cron/aviso-reparto-manana` | **1** (10 crons en total, **cero rutas duplicadas**) |
| Hora | `0 1 * * *` UTC = **19:00 CR** (UTC menos 6 fijo) |
| La guardia la vigila | mata `0 19 * * *` (R10) y `0 5 * * *` (R11), remedido |
| El mensajero **bloqueado NO** recibe el aviso (coherencia con la 271) | R42, y **M10 remedida**: 2 failed / 14 passed (16) |
| La regla del bloqueo no se reescribe | reusa `findMensajerosBloqueadosPorCierres`, que deriva de `estaBloqueadoPorCierres` (271/R10) |
| La segunda corrida descartada lleva **el umbral que la reabriría** | `design.md` §4.3: 15–20 % de las asignaciones, o más de una tardía por mensajero y noche |

---

## 7. Inventarios ajenos: se AMPLIARON, no se relajaron

Siete inventarios cerrados de otras suites (5 de migración, `no-migration-102` y
`notificacion-productores-wiring`).

| Comprobación | Resultado |
| --- | --- |
| `toEqual` degradado a `toMatchObject` | **ninguno** (diff de `tests/` sin una sola línea añadida con `toMatchObject`) |
| Inventario derivado del enum en vez de escrito a mano | **ninguno**; las listas siguen literales, con el número de ficha en el comentario |
| `it.skip` / `.only` / `.todo` nuevos | **ninguno** |
| Líneas borradas en `tests/` | **4**, y las **cuatro son REFUERZOS**: `toBeGreaterThanOrEqual(14)` a `(15)` (dos veces), `EVENTOS_AGREGADOS` de 2 a **3** entradas, y «son NUEVE elegibles» a «**DIEZ**» |
| `tests/baseline-rojos.json` | **INTACTO** (diff vacío) |
| `notificacion-visibilidad.test.ts` | sólo se **añade** al final; cero líneas borradas |

---

## 8. El gate — corrida COMPLETA propia

`./init.sh` (modo completo; el diff toca `db/migrations/`, `db/schema.prisma`, `lib/types/` y
`vercel.json`, así que `--rapido` se niega solo), con `INIT_EXIT` escrito **dentro** del log y **sin
canalizar por `tail`**. Árbol **byte a byte idéntico** al commit antes de correr (diff contra `HEAD`
vacío) y **ninguna mutación viva**.

```
== Arnes SDD :: init (modo: completo) ==
typecheck paso
184 problems (0 errors, 184 warnings)
Test Files  1941 passed (1941)
     Tests  28164 passed | 26 skipped (28190)
== init OK ==
INIT_EXIT=0
```

**Coincide con lo reportado, cifra por cifra:**

| Medida | Reportado | Mi corrida |
| --- | --- | --- |
| `INIT_EXIT` | 0 | **0** |
| archivos de test | 1941 | **1941** |
| tests | 28.164 | **28.164** |
| `skipped` | 26 | **26** — 17 `AnaliticaPage` y 9 `AnaliticaShell`, verificado uno a uno |
| archivos de `integration/db` **ejecutados** | 255 | **255** |
| `integration/db` **saltados** | 0 | **0** |
| línea de aviso `sin DATABASE_URL` | ausente | **ausente** |
| `lint` | 0 errores | **0 errores**, 184 warnings preexistentes |

El rojo ajeno conocido de la **421** (etiquetas del enum duplicadas) **no apareció**: las dos suites
nuevas fijan `nspname = 'public'` y son inmunes de entrada. **No se persiguió ni se baselineó.**

---

## 9. Trazabilidad — los 43 requisitos

Recorridos **abriendo el archivo y leyendo el aserto**, no el mapa de la bitácora. Los 43 tienen
test con aserto real. Verificados **por mutación** (no sólo por lectura): R2, R3, R7, R10, R11, R13,
R15, R21, R22, R23, R25, R30, R31, R36, R38, R42.

Puntos donde miré con lupa que el aserto no fuera vacuo:

- **R27** — literales **a mano** para n = 1, 7 y 40 («Tenés 1 orden para mañana» y «Tenés 7 órdenes
  para mañana»), **no** comparados contra `tituloRepartoManana`. Es el singular y el plural, que es
  justo lo que una comparación contra su propia fuente dejaría pasar.
- **R15** — quita la fecha del texto y afirma que no queda ningún dígito, más «el texto es EL MISMO
  tenga 1 orden o 40». No es un `toContain` complaciente.
- **R36** — afirma sobre el **fuente sin imports ni comentarios** y con un `toMatch` de la
  construcción del service con `notificarRepartoMananaReal` dentro: caza «importado pero no pasado»,
  que es el fallo que dejó dos notificadores muertos en este árbol con la suite en verde.
- **R26** — lo cubre `atajo-aviso-ruta-visible.guardia.test.ts` **sin tocarla**: recorre
  `CATALOGO_AVISOS` entero, así que la entrada nueva queda vigilada sola. La forma más fuerte.

---

## 10. Checkpoints (`CHECKPOINTS.md`), punto por punto

| Checkpoint | Estado |
| --- | --- |
| `requirements.md` con EARS numerados | OK — 43, R1 a R43 |
| `design.md` con alternativa descartada y su porqué | OK — **cinco**: §4.3 y §§12.1 a 12.4 |
| `tasks.md` **todas** marcadas | **29 de 30**; **T7.2 vacía a propósito** — ver 5.2 y hallazgo `menor` 2 |
| Cada requisito mapea a test concreto | OK salvo el matiz de R32 (hallazgo `menor` 1) |
| `progress/impl_413.md` con el mapa de requisitos a tests | OK — §5 |
| `pnpm run typecheck` | OK — **0 errores** |
| `pnpm run lint` | OK — **0 errores** |
| `pnpm test` | OK — 28.164 pasan |
| E2E si toca flujo crítico | **N/A** — no toca auth, pagos, recaudo, ingesta ni webhooks; y no hay harness E2E en este repo |
| RLS en tabla nueva | **N/A** — **no hay tabla nueva**: la migración es `ADD VALUE` en dos enums, sin tablas, columnas, índices ni backfill |
| Migración con `down.sql` reversible | OK — y **ejercitada contra Postgres** (§1) |
| Sin secretos hardcodeados | OK — el secreto sale de `loadCronConfig()`; búsqueda en el diff sin coincidencias |
| Webhooks validan firma y son idempotentes | **N/A** (no hay webhook nuevo). El endpoint de cron sí valida secreto (**401 sin efectos**) y es **idempotente por el índice único**, no por un `if` |
| Controller sin queries ni negocio | OK — `route.ts` sólo HTTP, secreto y conteos; delega en el service |
| Service sin HTTP | OK — `RepartoMananaAvisoService` no conoce `Request` ni `Response` |
| Repository sólo Prisma | OK — `RepartoMananaRepository`, con **un solo `where` privado** compartido por los dos métodos |
| Interfaces en `lib/interfaces/` por categoría | OK — `repositories/IRepartoMananaRepository.ts` y `services/IRepartoMananaAvisoService.ts` |
| Páginas protegidas validan permisos en servidor | **N/A** — ficha backend, sin página nueva |
| Sin hardcode de país, moneda ni cuenta | OK — búsqueda en el diff sin coincidencias |
| `./init.sh` en verde | OK — **`INIT_EXIT=0`** (§8) |
| `progress/review_413.md` con veredicto OK | OK — este archivo |
| Entrada en `progress/history.md` | pendiente — ver hallazgo `menor` 4 |

---

## 11. Hallazgos

### `menor` 1 — R32 no tiene aserto propio de SU enunciado

R32 dice «El push de este aviso NO DEBE crear ninguna notificación adicional». El caso etiquetado
`R32` en `push-elegibles.test.ts` afirma en realidad **la elegibilidad** (`push` vale `si` y los
roles son `["mensajero"]`), que es **el contenido de R31**. Lo que sostiene R32 es el comentario.

**Por qué NO bloquea:** `requirements.md` §11 mapea R32 a **«—»** explícitamente («lo garantiza la
410; esta ficha no toca el canal»), así que es un hueco **sancionado por el spec aprobado**, no un
olvido. Y es **estructuralmente cierto**, verificado: `lib/notificaciones/push-elegibles.ts` importa
**sólo tipos** (`import type` de `RolValue` y de `NotificacionEvento`) — no tiene con qué crear nada
en runtime.

**Sugerencia (no exigencia):** renombrar ese caso a R31, o añadirle un aserto de que el módulo no
tiene dependencia de runtime.

### `menor` 2 — T7.2 sin marcar: queda una puerta de despliegue viva

Es la única casilla vacía, y **el propio texto de T7.2 la autoriza**. El riesgo funcional está
cubierto (§5.2); lo descubierto es **sólo lo visual**: título con la cifra, línea de contexto con la
fecha y el botón «Ver mi reparto» llevando a `/mis-asignaciones`, **en los dos temas**.

**Acción: del humano, antes o justo después de desplegar.** No devuelve la ficha al implementador.

### `menor` 3 — T0.3 sin medir producción

Declarado con honestidad en la bitácora §2, con el matiz de la 411 al lado. La conclusión se
sostiene porque el sesgo de una tabla pequeña va **en contra** del índice, no a favor (§5.3). **Yo
tampoco pude medir producción**: no tengo herramienta de Supabase en esta sesión.

### `menor` 4 — `progress/history.md` sin entrada

Lo pide `CHECKPOINTS.md`. **No es defecto de esta ficha**: es la convención del repo — la rama de la
412 tampoco lo tocó, y `history.md` se actualiza **en lote por el leader al cerrar** (commit
`d64281a9`, «la bitacora historica recoge las ocho fichas de hoy»).

**Acción: del leader, al cerrar.**

---

## 12. Lo que se verificó y NO estaba en el encargo

- **Capas**: controller, service y repository separados y sin filtraciones (§10).
- **Sin secretos ni hardcode de país o moneda** en el diff de `lib/` y `app/`.
- **R35 enumera la respuesta campo a campo** en vez de devolver el resumen entero, para que un id
  futuro **no cruce solo** a una respuesta que puede acabar en un log. Es una buena decisión.
- **Guardias vigentes intactas**: `carga-del-mensajero` y `atajo-aviso-ruta-visible`, diff vacío.
- **El árbol quedó limpio** tras mis nueve mutaciones: todas restauradas con copia byte a byte y
  **SHA256 verificado**, `git status` vacío y diff contra `HEAD` vacío antes del gate.
  **En ningún momento se usó `git checkout --`.**

---

## 13. Recomendación

**Mergear.** La ficha está medida donde importa: el `down.sql` no borra nada de la 412 y lo prueba
contra Postgres; la ventana de seis horas está defendida por el lado correcto —`@db.Date`, que es la
puerta contraria a la habitual— y se cae si se cambia el helper; el arnés de mutaciones **sí
ejecutó** (seis remedidas, conteos idénticos, y los dos errores de TypeScript literales); y el
hallazgo del barrido no sólo es real sino que su arreglo **resiste la mutación que lo destapó**.

Queda **una puerta viva para el humano**: mirar la campana del mensajero en los dos temas (T7.2).
