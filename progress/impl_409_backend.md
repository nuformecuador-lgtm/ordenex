# 409 — Bitácora del BACKEND

> Rama `feat/409-panel-notificaciones-accionable`, nacida de `origin/dev` @ **`aff769d8`**
> (`docs(409): spec del panel accionable, y la ficha arranca`).
> Alcance: **sólo backend**. El panel, la campana y la pestaña de `/novedades` por URL son del
> agente de frontend, sobre esta misma rama. Ver §8 («qué queda para el frontend»).

---

## §0 — Fase 0: lo que se comprobó ANTES de escribir una línea

### T0.1 — Los literales del contrato visual, copiados (no reescritos)

De `design-notificaciones/Main.dc.html` y `Campana.dc.html`, y fijados como contrato de test:

| Literal | Dónde vive ahora |
| --- | --- |
| `"5 novedades esperan tu decisión"` | `catalogo-avisos.ts` → `tituloNovedadesSinGestionar` |
| `"12 órdenes esperan volver a su tienda"` | `catalogo-avisos.ts` → `tituloDevolucionesRepresadas` |
| `"La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente."` | `emitir.ts` → `textoNovedadesSinGestionar` |
| `"La más antigua lleva 6 días en bodega. Coordiná la devolución."` | `emitir.ts` → `textoDevolucionesRepresadas` |
| `"Gestionar novedades"`, `"Ver devoluciones"`, `"Enviar a central"` | `catalogo-avisos.ts`, columna de etiquetas |
| `"Revisar cierre"`, `"Ver mi cierre"`, `"Ver mi reparto"`, `"Ver suscripción"` | ídem |
| `"hace 40 min"`, `"hace 2 h"`, `"ayer"`, `"hace 2 d"` | `lib/utils/tiempo-relativo.ts` |

⚠️ **Una desviación deliberada del mockup, y es la del spec.** El `.dc.html` escribe «A los 5 días
se **rechazan** automáticamente» (plural); `design.md` §4.3 y el mapa `R39` del `requirements.md`
fijan **«se rechaza automáticamente»** (singular, concordando con «la más antigua»). Se sigue el
spec, que es lo normativo.

### T0.2 — Las tres comprobaciones en el ARCHIVO REAL, no en el grafo

| Qué | Dónde | Veredicto |
| --- | --- | --- |
| `marcarNotificacionLeida` **no tiene punto de entrada** | sólo aparece en comentarios: `lib/actions/notificaciones.ts:9`, `tests/integration/actions/notificaciones-action.test.ts:71,152,229`, `tests/unit/guards/superficie-de-uso.guardia.test.ts:593`. **Cero ocurrencias de código.** | confirmado; no se recablea |
| `notificacion_dedupe_key` | `db/migrations/20260727120000_notificacion/migration.sql:89-92` — `UNIQUE(evento, entidad_id, destinatario_rol, destinatario_usuario_id) NULLS NOT DISTINCT WHERE entidad_id IS NOT NULL`. **`tienda_id` y `zona_id` NO están.** | confirmado, y es lo que decide todo el diseño |
| `ROL_AUTORIZADO = "adminSatelite"` | `lib/services/EnvioDevolucionCentralService.ts:19`, con el corte en la línea 58 (`if (actor.rol !== ROL_AUTORIZADO) return { status: "forbidden" }`) | confirmado; de ahí salen los **dos** destinos de `devoluciones_represadas` |

**Nota de método (regla 7 de `CLAUDE.md`).** El MCP `codebase-memory` **no estaba en el conjunto de
herramientas de esta sesión**, así que la localización se hizo con `grep`/`glob` y **toda**
conclusión se verificó leyendo el archivo real. Se dice explícitamente porque la regla lo pide.

---

## §1 — Archivos creados y modificados

### Nuevos

| Archivo | Qué es |
| --- | --- |
| `lib/notificaciones/catalogo-avisos.ts` | **El catálogo**: `Record<NotificacionEvento, …>` exhaustivo (13 eventos), `accionDeAviso(evento, rol)`, los dos agregados y sus compositores de título. Módulo PURO |
| `lib/notificaciones/presentacion-aviso.ts` | **`presentacionDe(fila) → { titulo, cuerpo, destino } \| null`** + `etiquetaDeAtajo`. Módulo PURO — es la puerta previa de la **ficha 410** |
| `lib/utils/tiempo-relativo.ts` | `tiempoRelativo(desde, ahora)`; el «ayer» se decide por día calendario CR |
| `lib/config/avisos-diarios.ts` | `DIAS_REPRESAMIENTO = 3`, con la medición de producción escrita al lado |
| `lib/config/devolucion-sla.ts` | `DIAS_RECHAZO_AUTOMATICO = 5`, `HORAS_REINTENTO = 24` — **la única fuente** del plazo |
| `lib/interfaces/repositories/IAvisoAgregadoRepository.ts` | contrato de las cinco consultas |
| `lib/repositories/AvisoAgregadoRepository.ts` | sólo Prisma: resumen de novedades por tienda, resumen de represadas por zona y global, y las dos cifras vivas |
| `lib/interfaces/services/IAvisosDiariosService.ts` | contrato + el resumen SIN PII de la corrida |
| `lib/services/AvisosDiariosService.ts` | el proceso diario: agrupación, umbral inyectado, homogeneidad de plazos, best-effort por destinatario |
| `lib/interfaces/services/IVigenciaAvisoAgregado.ts` | contrato del resolutor de la cifra viva |
| `lib/services/VigenciaAvisoAgregadoService.ts` | resuelve la cifra viva **acotada al ámbito del actor** |
| `app/api/cron/avisos-diarios/route.ts` | Controller: sólo HTTP + `CRON_SECRET` + composition root |
| `db/migrations/20260911120000_notificacion_evento_avisos_agregados/{migration,down}.sql` | +2 valores en cada enum, con su `down.sql` |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | +`novedades_sin_gestionar`, +`devoluciones_represadas` en `NotificacionEvento`; +`novedades_sin_gestionar_dia`, +`devoluciones_represadas_dia` en `NotificacionEntidadTipo` |
| `lib/types/notificacion.ts` | los 4 valores espejo, los 6 campos **aditivos y opcionales** del DTO, y `porHacer` en los dos resultados |
| `lib/notificaciones/emitir.ts` | +2 emisores, +4 textos (3 formas del plazo + el de represadas), +2 contextos |
| `lib/notificaciones/notificadores.ts` | +2 firmas, +2 `*Con`, +2 `*Real`, y la intersección del `notificadorNoOp` ampliada |
| `lib/interfaces/repositories/INotificacionRepository.ts` | `NotificacionRow` gana `evento` |
| `lib/repositories/NotificacionRepository.ts` | `SELECT_LISTADO` proyecta `evento`. **`predicadoVisibilidad` NO se toca** (R64) |
| `lib/services/NotificacionService.ts` | `listar` resuelve clase, título, detalle, `cuando`, atajo y `porHacer`; oculta los agregados con cifra 0; falla hacia MOSTRAR |
| `lib/actions/notificaciones.ts` | `buildService()` **inyecta** `VigenciaAvisoAgregadoService`. Las 4 firmas de las acciones, intactas |
| `lib/services/DevolucionSlaService.ts` | sus dos ventanas DERIVAN de `lib/config/devolucion-sla.ts` (mismo comportamiento, una sola fuente) |
| `vercel.json` | `{ "path": "/api/cron/avisos-diarios", "schedule": "0 13 * * *" }` |
| `tests/unit/services/notificacion-service.test.ts` | ampliado con R8, R9, R31, R55, R56, R57, R58 |
| `tests/unit/services/notificacion-notificadores-reales.test.ts` | ampliado: camino real de los 2 notificadores, el censo de services y los 2 composition roots |

**NO se tocó:** `components/shared/NotificationsBell.tsx`, `hooks/useNotificaciones.ts`,
`app/(app)/novedades/**`, `tests/components/**`, `feature_list.json`, `progress/current.md`, ni
ninguno de los **siete** `down.sql` anteriores de estos enums.

---

## §2 — Las tres decisiones que este backend tomó, y por qué

### 2.1 — El alcance va DENTRO del `entidad_id` (el hallazgo de la ficha)

`notificacion_dedupe_key` **no incluye `tienda_id` ni `zona_id`**, y `crear` absorbe el `P2002`
devolviendo `false`. Con `entidad_id = diaCR` a secas, la clave sería
`('novedades_sin_gestionar', '<día>', 'adminTienda', NULL)` **para todas las tiendas**: la primera
de la corrida se llevaría el aviso y **todas las demás quedarían mudas — sin error, sin log y sin
nada**. Por eso:

```
novedades_sin_gestionar   entidadId = `${tiendaId}:${diaCR}`
devoluciones_represadas   entidadId = `${ambito}:${diaCR}`   ambito ∈ { "global" } ∪ { zonaId }
```

Se mide contra Postgres real, y **con la clave REAL también en los dobles unitarios**: los dobles
de esta carpeta que meten el alcance en su clave son MÁS PERMISIVOS que la base y no verían el
fallo. Ver la mutación M1 y la M2 de §6.

### 2.2 — El resolutor de vigencia: default que LANZA, no no-op

El design pide «dependencia obligatoria, sin default no-op». Hacerlo un parámetro **requerido**
habría roto `tests/integration/actions/notificaciones-action.test.ts`, que R65 manda dejar **sin
editar** (tres `new NotificacionService(repo)`). La salida: parámetro opcional con
**`vigenciaNoResuelta`**, que **lanza** nombrando el cableado que falta — nunca devuelve un número.

Por qué eso NO reproduce «el composition root que no inyecta»: un default que devolviera `0`
apagaría los agregados siempre y uno que devolviera `1` no los apagaría nunca, los dos en silencio.
Éste es ruidoso, y R58 lo traduce en «el aviso se muestra». Además hay un test que afirma que
**alguien lo PASA** (sobre el fuente sin imports ni comentarios), que es la protección real.

### 2.3 — Los seis campos nuevos del DTO son OPCIONALES

R34 exige que «un DTO construido con sólo los campos vigentes siga tipando», y el design promete
que «ningún consumidor deja de compilar». Las dos cosas sólo son ciertas con campos opcionales:
`tests/components/NotificationsBell.test.tsx` construye literales de `NotificacionDTO`, y con
campos requeridos dejaría de compilar **hoy**, antes de que el frontend lo reescriba.
El servidor los puebla **siempre**; el frontend puede leerlos con confianza.
`porHacer` sí es **requerido** en los dos resultados: nadie los construye fuera del servicio.

---

## §3 — Mapa `R<n> → test`

> Los literales de texto se afirman **a mano**, nunca contra la función que los compone.

### Cubiertos por este backend

| R | Test |
| --- | --- |
| R1 | `tests/unit/notificaciones/catalogo-avisos.test.ts` › «las claves del catalogo son exactamente los valores del enum de Prisma» (+ no compila si falta una) |
| R2 | ídem › «`cierre_dia_vencido` es ACCIONABLE para el mensajero e INFORMATIVA para la bodega» y «`devoluciones_represadas` lleva DOS destinos distintos segun el rol» |
| R3 | ídem › «toda entrada accionable declara atajo o `null` EXPLICITO» |
| R4 | ídem › «`geocodificacion_caida` … es el unico de TODO el catalogo» |
| R5 | `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` › «cada destino … es una ruta del menu de ese rol» |
| R6 *(mitad del catálogo)* | ídem › «solo aparecen parametros de la lista blanca» — **la otra mitad (la página lee el parámetro) es del frontend, T6.5** |
| R8 | `tests/unit/services/notificacion-service.test.ts` › «2 accionables + 3 informativas + 1 accionable con cifra viva CERO -> porHacer === 2» |
| R9 | ídem › «marcar todas como leidas no baja porHacer» |
| R31 | ídem › «un aviso de hace 2 h llega con `cuando` ya en palabras» |
| R33 | `tests/unit/utils/tiempo-relativo.test.ts` (10 casos, con los dos bordes de «ayer» a las 23:59 y 00:01 CR) |
| R34 | `tests/unit/types/notificacion-dto-aditivo.test.ts` + `pnpm run typecheck` |
| R35, R36 | `tests/unit/notificaciones/novedades-sin-gestionar-aviso.test.ts` › «cuarenta novedades producen UNA fila» |
| R37 | ídem › «(a) lote homogeneo de cinco dias — literal escrito a mano» |
| R38 | `tests/integration/db/aviso-agregado-repository.test.ts` › «(d) `masAntiguaAt` es el `anclaje_devolucion`, NO el `created_at`» (+ «(d bis) gana el anclaje MAS RECIENTE») |
| R39 | `tests/unit/services/devolucion-sla-plazo-unica-fuente.test.ts` (3 asertos: configuración, **comportamiento del cron** 4 d 23 h / 5 d 00 h, y una sola fuente) + el literal en `novedades-sin-gestionar-aviso.test.ts` |
| R40 | `novedades-sin-gestionar-aviso.test.ts` › «(c) plazos MEZCLADOS» + `tests/unit/services/avisos-diarios-service.test.ts` › «todas de cinco dias pero UNA en el tope -> mezclado» |
| R41 | `tests/integration/db/novedades-sin-gestionar-aviso-dedupe.test.ts` › «dos corridas el MISMO día dejan UNA fila; el día siguiente, DOS» |
| R42 | ídem › «dos tiendas con novedades el mismo día -> DOS filas» + la mutación y su control |
| R43 | `avisos-diarios-service.test.ts` › «no se llama al notificador cuando el resumen viene vacio» |
| R44 | `novedades-sin-gestionar-aviso.test.ts` › «ni guia, ni remision, ni direccion, ni telefono, ni destinatario, ni monto» |
| R45 | `aviso-agregado-repository.test.ts` › «(e) con umbral 3, la de 2 dias NO entra y la de 4 dias SI» (con control positivo anti-vacío) |
| R46 | ídem › «(f) una orden en `devolviendo_a_tienda` con NUEVE dias NO entra» |
| R47 | `tests/unit/notificaciones/devoluciones-represadas-aviso.test.ts` › «maestro y admin … la entidad `global:<dia>`» |
| R48 | ídem › «el destinatario lleva la zona» + `avisos-diarios-service.test.ts` › «dos zonas y el global: tres avisos, cada uno con su ambito» |
| R49 | `avisos-diarios-service.test.ts` (el ámbito global lleva el total, la zona el suyo) |
| R50 | `devoluciones-represadas-aviso.test.ts` › «literal escrito a mano» |
| R51 | `tests/integration/db/devoluciones-represadas-aviso-dedupe.test.ts` (4 casos + mutación + control) |
| R52 | `avisos-diarios-service.test.ts` › «una zona con cero no recibe aviso, las demas si» |
| R53 | ídem › los tres casos del umbral inyectado, incluido «el fuente del servicio no contiene el literal» |
| R54 | `devoluciones-represadas-aviso.test.ts` › «ni guia … ni tienda, ni monto» |
| R55, R56 | `notificacion-service.test.ts` › «cifra 0 -> ni se ve ni cuenta, y NO se crea fila de lectura ni de descarte» y «la MISMA fila vuelve a salir cuando la cifra sube» |
| R57 | ídem › «la fila se emitio con 5 y el resolutor dice 3: el titulo dice 3» + `tests/unit/services/vigencia-aviso-agregado.test.ts` (el ámbito sale del ACTOR) |
| R58 | `notificacion-service.test.ts` › «el resolutor lanza: el agregado sale, cuenta, y el resto del listado tambien» |
| R59 | `tests/unit/api/avisos-diarios-route.test.ts` (5 casos de 401 sin efectos) |
| R60 | `avisos-diarios-service.test.ts` › «tres tiendas, la segunda lanza: 2 emisiones, 1 fallo registrado y la corrida termina» + los dos casos «absorbe el fallo … y lo REGISTRA» de `notificacion-notificadores-reales.test.ts` |
| R61 | `avisos-diarios-route.test.ts` › «exactamente las claves declaradas», «ninguna clave … nombra un identificador», «un campo nuevo … NO cruza solo» |
| R62 | `notificacion-notificadores-reales.test.ts` › «app/api/cron/avisos-diarios/route.ts inyecta LOS DOS notificadores reales» + la guardia derivada del árbol + «lib/actions/notificaciones.ts inyecta el RESOLUTOR DE VIGENCIA» |
| R63 | `tests/integration/db/notificacion-evento-avisos-agregados-migration.test.ts` (20 casos: el up, el down, **los siete downs anteriores intactos**, y el índice sobreviviendo a la reconstrucción) |
| R64 | `tests/unit/repositories/notificacion-visibilidad.test.ts` — **verde sin editarla** (`git diff HEAD~1` sobre ese archivo: vacío) |
| R65 | `tests/integration/actions/notificaciones-action.test.ts` — **verde sin editarla** (ídem) |

### De la parte de FRONTEND (declarados, no olvidados)

`R7`, `R10`–`R30`, `R32`, `R66` y la **segunda mitad de R6**. Van en
`progress/impl_409_frontend.md`. En concreto, el bloque que el frontend tiene que **añadir a la
guardia ya existente** `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts`: «por cada
destino con `?`, el fuente de la página de destino lee ese parámetro» — hoy no está porque
`app/(app)/novedades/page.tsx` todavía no lo lee (T6.5) y el aserto sería rojo por una razón ajena.

---

## §4 — La migración, y la pregunta obligatoria de este repo

- **Aditiva**: 4 × `ALTER TYPE … ADD VALUE IF NOT EXISTS`. Sin tablas, sin columnas, sin índices,
  sin RLS nueva y sin backfill.
- **Va sola y con timestamp propio** (`20260911120000`): Postgres no deja usar un valor de enum
  recién añadido en la transacción que lo añadió (`55P04`).
- **`down.sql`** recrea los DOS tipos con **11 eventos y 9 entidades**, la lista leída de
  `db/schema.prisma` de **`origin/dev` @ `aff769d888a0c893e48be6bd7c3144a97ec87c20`** — con los dos
  valores de la 403 y los dos de la 401 **dentro**. Sin un solo `DELETE`, con la precondición
  ruidosa escrita.
- **Los siete `down.sql` anteriores: NO SE TOCÓ NINGUNO.** Cada uno es una foto de su momento y
  todas siguen siendo ciertas; el test de migración lo afirma uno a uno y además comprueba que
  ninguno menciona los valores de esta ficha.

⚠️ **T2.5, pendiente para el momento del PR.** Estas dos listas hay que **volver a leerlas contra
`origin/dev`** justo antes de abrir el PR. Si otra ficha añade un valor a estos enums y entra en
`dev` antes que ésta, revertir con la lista vieja lo **borraría en silencio** — le pasó a la 401
con la 403. Comprobado hoy contra `aff769d8`; el frontend o el leader tienen que repetirlo.

**Ejercitada de verdad contra la base local** (`localhost:5432/ordenex`, confirmado con
`prisma migrate status` sin exponer credencial):

```
prisma migrate deploy   -> aplicada
pnpm run db:rollback    -> «Rollback completado: 20260911120000_notificacion_evento_avisos_agregados»
prisma migrate deploy   -> aplicada de nuevo
prisma migrate status   -> «Database schema is up to date!»
```

---

## §5 — El gate

`./init.sh` **COMPLETO**, porque el diff toca `lib/types/**` y `db/schema.prisma` y el modo rápido
se niega solo. El código de salida va escrito **DENTRO** del log (`INIT_EXIT=$?` inmediatamente
después del comando): el `exit code` que devuelve el runner **no sirve** —lo tapa cualquier `echo`
posterior—, y en este mismo trabajo la primera corrida, que fue **roja**, llegó anunciada como
«exit code 0».

### Corrida final — VERDE

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (408 fichas), cupo por zona respetado (in_progress=3) y specs en su sitio
✓ typecheck paso
✓ lint paso                       (183 warnings preexistentes, 0 errores; ninguno de esta ficha)
✓ DATABASE_URL resuelta: los 158 archivos de tests contra Postgres SI se ejecutan
 Test Files  1876 passed (1876)
      Tests  27276 passed | 26 skipped (27302)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1876 ejecutado(s), todos en el baseline conocido)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

### Los `integration/db` CORRIERON — no se saltaron

`.env` copiado del checkout principal **tras comprobar que su `DATABASE_URL` activa apunta a
`localhost:5432/ordenex`** y no a Supabase (la línea de Supabase está comentada). Está gitignorado
(`.gitignore:50`) y **no** entra en ningún commit.

- El gate lo dice antes de correr: **«los 158 archivos de tests contra Postgres SI se ejecutan»**.
- Contados en la salida: **236 archivos bajo `tests/integration/db/` ejecutados con `✓`**, ninguno
  saltado. Los 26 `skipped` de la suite son de otras familias, no de `integration/db`.
- Los **cuatro** archivos de `integration/db` de esta ficha, con sus casos:

```
✓ tests/integration/db/aviso-agregado-repository.test.ts                    (11 tests)
✓ tests/integration/db/novedades-sin-gestionar-aviso-dedupe.test.ts          (5 tests)
✓ tests/integration/db/devoluciones-represadas-aviso-dedupe.test.ts          (6 tests)
✓ tests/integration/db/notificacion-evento-avisos-agregados-migration.test.ts (20 tests)
```

### La corrida ANTERIOR fue ROJA, y qué era

`INIT_EXIT=1`, «rojos NUEVOS respecto del baseline: 9 archivos». **Siete eran míos**, y todos del
mismo tipo: **censos LITERALES que se ponen rojos a propósito** cuando el inventario de eventos
crece. Que se pusieran rojos **es la prueba de que el inventario sigue cerrado**, así que se
actualizan con su motivo escrito —lo que hicieron la 253, la 262, la 271, la 333, la 403 y la 401—,
nunca se relajan ni se meten en `tests/baseline-rojos.json`:

| Archivo | Qué pedía |
| --- | --- |
| `tests/unit/services/notificacion-productores-wiring.test.ts` | las dos listas literales del enum: +2 eventos y +2 entidades, con su comentario |
| `tests/integration/db/no-migration-102.test.ts` | declarar la carpeta `_notificacion_evento_avisos_agregados` en `MIGRACIONES_NOTIFICACIONES_POSTERIORES` |
| las **cinco** `notificacion-evento-*-migration.test.ts` (253, 262, 271, 333, 403) | sus listas «los posteriores AL FINAL», que ahora incluyen los cuatro valores de esta ficha |

Y **una era un hallazgo de verdad**, no un censo:

> `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` (239/R16) exige que la **LECTURA** que
> deriva el ancla de una devolución viva en **UN SOLO** módulo, y `AvisoAgregadoRepository` había
> escrito **su propia copia** del `where`. La guardia tenía razón, y aquí importa especialmente: el
> aviso le **dice a la tienda** cuántos días lleva su novedad, así que con dos derivaciones podría
> decir «3 días» sobre una orden a la que el cron le cuenta 5. La proyección pasa a declararse UNA
> vez —**`PROYECCION_ANCLAJE_DEVOLUCION`**, exportada de `DevolucionSlaRepository`, que es el módulo
> que la propia guardia designa— y la comparten los dos lectores. **Sin cambio de comportamiento**:
> las suites de la 99/239/276 siguen verdes sin editarlas.

**La novena era ajena y flaky**, y se midió antes de decirlo:
`tests/integration/db/seed-zonas-cruza-por-codigo.test.ts` › «un distrito ausente se crea y guarda
su `codigo_dta`». **Pasa aislado.** Su `codigoNuevo` es `${CODIGO_CANTON}9${random 0..9}` —diez
valores posibles—, así que dos casos del mismo archivo pueden chocar y el segundo crea 0. Es una
colisión aleatoria de esa suite, no deuda de nadie: **no se toca y no entra en el baseline**. En la
corrida final salió verde.

---

## §6 — Las nueve mutaciones obligatorias

> **Corrida VÁLIDA: la segunda.** La primera se descartó entera y conviene decir por qué, porque es
> una trampa nueva: el arnés revertía con `git checkout -- <archivo>` sobre archivos que estaban
> **modificados pero NO commiteados**, así que los devolvió a `HEAD` **llevándose la implementación
> por delante**. Las mediciones de M2, M3 y M7 quedaron contaminadas —los tests fallaban porque el
> módulo ya no exportaba los emisores, no por la mutación— y `emitir.ts` y `NotificacionService.ts`
> hubo que reescribirlos. La segunda corrida parte del commit `5211a566`, con **todo commiteado**, y
> el arnés imprime el `git diff --stat` de cada mutación antes de correr y verifica la reversión
> después. **Línea base sin mutar: 12 archivos, 178 tests, todos verdes.**

| # | Mutación | Tests rojos | Los que nombran el requisito |
| --- | --- | --- | --- |
| M1 | quitar el `tiendaId` del `entidad_id` de novedades | **3** | `…-dedupe` › «dos tiendas … DOS filas»; `novedades-sin-gestionar-aviso` › «el `entidadId` es exactamente `<tiendaId>:<diaCR>`» y «DOS tiendas el MISMO dia reciben DOS avisos» → **R42** |
| M2 | quitar el ámbito del `entidad_id` de represadas | **5** | `devoluciones-represadas-aviso` › «el destinatario lleva la zona y la entidad es `<zonaId>:<dia>`» y «DOS zonas el MISMO dia dan DOS filas»; `…-dedupe` › «una corrida deja 2 filas de administración + 1 por zona» y «el día siguiente vuelve a avisar» → **R51** |
| M3 | la entidad de novedades pierde el día (= el fallo de la 262 con `orden`) | **5** | `…-dedupe` › «dos corridas el MISMO día dejan UNA fila; el día siguiente, DOS» → **R41** |
| M4 | borrar los dos argumentos del composition root, **dejando el import** | **2** | «app/api/cron/avisos-diarios/route.ts inyecta LOS DOS notificadores reales» y la guardia derivada «cada `notificar*Real` … lo PASA algún fichero» → **R62** |
| M5 | `porHacer` cuenta las no leídas | **4** | R8 (los dos casos), R9 «marcar todas como leidas no baja porHacer», y R58 → **R8/R9** |
| M6 | el resolutor de vigencia devuelve siempre `1` | **1** | `vigencia-aviso-agregado` › «`novedades_sin_gestionar` se pide con el usuarioId de la tienda» → **R57** |
| M7 | `DIAS_RECHAZO_AUTOMATICO` pasa a 6 | **4** | por **las dos vías**: literal (`novedades-sin-gestionar-aviso` › «(a) lote homogeneo de cinco dias» y `devolucion-sla-plazo-unica-fuente` › «los dos valores, escritos a mano») **y comportamiento del cron** (`…-plazo-unica-fuente` › «una `wrong_address` de 5 d 00 h SI escala» y la suite VIGENTE de la 276 › «2b. la MISMA orden a los 5 dias SI escala») → **R39** |
| M8 | ignorar el tope de intentos al decidir la homogeneidad | **1** | `avisos-diarios-service` › «todas de cinco dias pero UNA en el tope -> mezclado» → **R40** |
| M9 | añadir `devolviendo_a_tienda` al predicado de represadas | **1** | `aviso-agregado-repository` › «(f) una orden en `devolviendo_a_tienda` con NUEVE dias NO entra» → **R46** |

**Supervivientes: NINGUNO.** Las nueve se mataron.

Dos honestidades sobre el conteo, porque un número grande no siempre es mejor:

- **M6 sólo mata UN test**, y es el correcto. R55/R56 se prueban en `NotificacionService` con un
  resolutor **doble**, así que mutar el resolutor REAL no puede tocarlos: quien vigila al real es su
  propio test. Mutar el doble no probaría nada del código de producción.
- **M8 y M9 matan uno cada una** porque son requisitos de una sola frase con un solo aserto que los
  nombra. Lo que importa es que ese aserto **existe y se pone rojo**, no cuántos arrastra.

---

## §7 — Lo que NO se pudo hacer, con nombre

| Tarea | Estado |
| --- | --- |
| **T7.4** — ver el panel en un navegador, en los dos temas | **No aplicable a este agente**: no hay panel todavía. Es del frontend, y su spec (T7.4) lo mantiene |
| **T7.5** — medir producción en solo lectura (`por_devolver` y `por_devolver_a_tienda`) | **NO EJECUTADA**. Este agente no tiene el MCP de Supabase en su conjunto de herramientas y no hay otra vía de solo lectura contra producción desde el worktree. **Sigue siendo puerta de despliegue**: el umbral de 3 días y la decisión de no vigilar `por_devolver_a_tienda` descansan en la medición del 2026-09-10, que hay que confirmar antes de desplegar |
| **T2.5** — reescribir las listas del `down.sql` contra `origin/dev` **en el momento del PR** | Hecha hoy contra `aff769d8`. **Hay que repetirla** justo antes de abrir el PR (§4) |
| **MCP `codebase-memory`** | No disponible en esta sesión; se usó `grep` y se verificó todo en el archivo real (§0) |

---

## §8 — Qué queda listo para el FRONTEND

### El DTO, campo a campo

```ts
interface NotificacionDTO {
  // vigentes, intactos
  id: string; notification_type: "alert" | "box" | "warning";
  description: string; anexo?: string; read: boolean; createdAt: string;

  // nuevos (opcionales en el TIPO por R34; el servidor los puebla SIEMPRE)
  evento?: NotificacionEvento;
  accionable?: boolean;                 // ← parte el panel en los dos bloques (R16)
  titulo?: string;                      // ← lo que va en negrita; en los agregados, con la cifra VIVA
  detalle?: string | null;              // ← la línea de contexto. NUNCA lleva «Anexo:»
  cuando?: string;                      // ← «hace 2 h», «ayer»… YA resuelto en el servidor
  atajo?: { href: string; etiqueta: string } | null;
}
```

Y el resultado del listado gana **`porHacer: number`** (requerido).

### El atajo

Viene resuelto por par (evento, rol del actor). `null` significa **no pintes botón**, y son dos
casos distintos que el frontend no necesita distinguir: informativo, o accionable sin pantalla que
acerque (`geocodificacion_caida`, el único). La `etiqueta` es el **nombre accesible** del botón.

### El conteo de accionables

`porHacer` cuenta lo **accionable y VIGENTE** en el mismo conjunto que devuelve `items`, **sin mirar
la lectura**. Propiedades que el panel puede dar por ciertas:

- «Marcar leídas» **no** lo cambia (R14/R9);
- descartar un accionable lo baja en uno **porque la fila desaparece de `items`** (R15);
- un agregado con cifra 0 **ni sale en `items` ni cuenta** (R55);
- `porHacer ≤ items.length ≤ 50` (`PAGE_SIZE`), igual que `noLeidas` desde la 146.

**El tono** (161) tiene que pasar a recibir **`porHacer`**, no `noLeidas` (Q8, R30).

### El tiempo relativo

`cuando` llega **en palabras y ya resuelto** (`hace un momento` / `hace N min` / `hace N h` /
`ayer` / `hace N d`). El componente **no debe** leer el reloj: `createdAt` sigue viajando sólo para
el `title` del elemento. La guardia T6.3 es del frontend.

### Lo que el frontend todavía tiene que hacer para cerrar R5/R6

`app/(app)/novedades/page.tsx` debe leer `?superficie=` (lista blanca contra `GRUPOS_NOVEDAD`,
nunca un `as`) y `NovedadesTabs` reenviarlo al `defaultValue` que `TabsGroup` **ya soporta**. El
catálogo **ya emite** `/novedades?superficie=devolucion`, y la lista blanca de parámetros de la
guardia ya lo admite; falta el aserto de que la página lo lee.

---

## §9 — Qué queda listo para la FICHA 410 (su puerta previa)

```ts
// lib/notificaciones/presentacion-aviso.ts — módulo PURO
presentacionDe(fila: {
  evento: NotificacionEvento;
  descripcion: string;
  anexo: string | null;
  rolLector: RolValue;      // el rol de QUIEN LA VA A LEER, no `destinatario_rol`
  cifraViva?: number | null;
}): { titulo: string; cuerpo: string | null; destino: string | null } | null
```

- **Invocable desde el servidor**: sin sesión, sin DTO, sin `Actor` y sin React. Un test comprueba
  que el módulo no importa React, ni `next/*`, ni `@/lib/db`, ni repositorios, ni servicios, y que
  no lee el reloj.
- **Devuelve `null`** cuando no hay nada que empujar: un agregado cuya cifra viva ya no es mayor que
  cero. Es el aviso «apagado solo» — no se pinta, no se cuenta y **no se empuja**.
- **`cifraViva === null`** significa «no se pudo resolver» y se presenta igual, sin número (R58).
  Confundirlo con el `0` apagaría avisos vivos.
- `etiquetaDeAtajo(evento, rol)` da el nombre del botón, o `null`.
- El servicio de la campana **usa esta misma función**, así que push y panel no pueden divergir; hay
  un test que lo afirma.
- ⚠️ Ojo al `rolLector`: `cierre_dia_vencido` y `mensajero_bloqueado_por_cierres` le llegan al
  mensajero como fila **dirigida a usuario** (`destinatario_rol` NULL), y es justo para él para
  quien son accionables. El drenador tiene que resolver el rol del **destinatario del push**.

---

## §10 — Veredicto

**El backend de la 409 está entregado y verificado**: `./init.sh` completo en verde
(`INIT_EXIT=0`, 27.276 tests, **158 archivos contra Postgres ejecutados de verdad**), 44 requisitos
backend con test propio, las nueve mutaciones obligatorias muertas y **cero supervivientes**; queda
el frontend, y T7.5 —medir producción en solo lectura— sigue siendo puerta de despliegue.

Commits: `5211a566` (implementación) · `be40bfc4` (el precio de los enums) · éste (la bitácora).
