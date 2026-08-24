# review 271 — el segundo cierre se puede solicitar, y acumular dos bloquea

> **Veredicto: RECHAZADO.** Cuatro hallazgos bloqueantes, tres de ellos de la misma familia: **un
> requisito dado por cubierto cuyo test afirma algo adyacente**. El código, en lo que he podido
> comprobar, hace lo que la regla dice; lo que falla es la RED que lo sostiene, y una puerta del
> arnés que ni siquiera está marcada.
>
> Rama revisada: `feature/271-segundo-cierre-y-bloqueo` (`5ed808e8`) contra `dev` (`39115008`).
> Fecha: 2026-08-23. Revisor: subagente `reviewer` (no edita código).

---

## Cómo se verificó esto (y qué NO se verificó)

**Ejecutado por mí, no leído de una bitácora:**

    pnpm exec vitest run tests/integration/db/cierre-bloqueo-nv-sql-real.test.ts
                         tests/integration/db/cierre-aprobacion-libera-solo-lo-suyo.test.ts
                         tests/integration/db/cierre-segundo-vincula-solo-lo-suyo.test.ts
                         tests/integration/db/cierre-aprobar-el-mas-viejo-desbloquea.test.ts
                         tests/integration/db/notificacion-bloqueo-otro-cierre-avisa.test.ts
      -> Test Files 5 passed | Tests 23 passed

    pnpm exec vitest run tests/unit/notificaciones/bloqueo-textos.test.ts
                         tests/unit/utils/bloqueo-cierre.test.ts
                         tests/unit/utils/jornada-cierre.test.ts
                         tests/unit/guards/regla-241-caducada.guardia.test.ts
                         tests/unit/services/cierre-bloqueo-superficies.test.ts
                         tests/unit/services/cierres-admin-aviso-rechazo.test.ts
                         tests/unit/services/notificacion-notificadores-reales.test.ts
                         tests/unit/services/notificacion-productores-wiring.test.ts
                         tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
      -> Test Files 9 passed | Tests 188 passed

**Lo importante de la primera corrida:** los cinco archivos de integración **corrieron de verdad
contra Postgres** — 23 casos ejecutados, cero `skipped`. Este repo tiene escrito lo que cuesta un
test de integración que reporta `passed` sin comprobar nada; aquí el `describe.skip` por falta de
base **no se activó**, así que las aserciones sobre el `WHERE` se ejecutaron.

**NO se corrió `./init.sh`** (encargo explícito: ya está verde, `INIT_EXIT=0`, 1337 archivos /
18.109 tests). **No se aplicaron mutaciones**: el encargo prohíbe editar código, así que donde no he
podido convencerme leyendo lo digo, en vez de dar un sí de cortesía.

---

## Checklist de `CHECKPOINTS.md`

| | Punto | Resultado |
|---|---|---|
| ✅ | `requirements.md` con requisitos EARS numerados | 61 requisitos `R1`–`R61`, tabla de verdad de 7 filas y nueve supuestos humanos cerrados |
| ✅ | `design.md` con al menos una alternativa descartada y su porqué | §12, alternativas `A1`–`A9`; `A1` es el modelo `fecha_jornada` que el humano descartó |
| ❌ | `tasks.md` con **todas** las tasks marcadas `[x]` | **58 tareas, 0 marcadas.** Ver **B1** |
| ⚠️ | Cada `R<n>` mapea a al menos un test concreto | 57 de 61 sí. **R38, R39, R40 y R41 no.** Ver **B2** y **B3** |
| ✅ | `progress/impl_<feature>.md` contiene el mapa `R<n> -> test` | En tres bitácoras; el mapa tiene **filas falsas** (ver **M1**) |
| ✅ | typecheck / lint / test | Gate completo verde declarado por el leader; mis corridas dirigidas, verdes |
| ➖ | E2E para flujos críticos | No hay arnés E2E en este repo. **Sí hubo verificación en navegador con Playwright**: los cuatro portales, seis estados de la tabla de verdad y sus dos ramas mixtas, leídos por `innerText`, con la base restaurada al terminar. Sustituye al checkpoint de forma razonable |
| ✅ | RLS en tablas nuevas | **No hay tabla nueva**: la migración sólo añade dos valores a `notificacion_evento` |
| ✅ | Migración versionada y reversible con `down.sql` | `20260823120000_notificacion_evento_bloqueo_cierre`: `up` aditivo con `IF NOT EXISTS`; `down` que recrea el enum con los SEIS previos, con precondición ruidosa y **sin un solo `DELETE`**; y la pregunta obligatoria de este repo —«¿los `down.sql` previos recrean-con-lista o sólo dropean?»— hecha y respondida sobre los tres, **sin tocar ninguno** |
| ✅ | Sin secretos hardcodeados | Nada nuevo por entorno; la guardia «ningún módulo apaga la emisión según el entorno» sigue verde |
| ➖ | Webhooks con firma e idempotencia | No hay webhook nuevo; el cron conserva su `CRON_SECRET` |
| ✅ | Patrón de capas | Controller sin queries; services sin HTTP; el predicado y los textos en módulos **puros**, con guardia de pureza |
| ✅ | Interfaces en `lib/interfaces/` | `IOrdenRepository`, `ICierreDiaRepository`, `ICierreDiaService`, `ICierresAdminService` al día |
| ✅ | Permisos server-side / Server Actions | Sin cambio de patrón; el detalle del bloqueo se deriva en RSC vía `estadoBloqueoMensajero()` |
| ✅ | Sin hardcode de país/moneda/cuenta | Nada nuevo |
| ❌ | `progress/review_<feature>.md` con veredicto OK | Este archivo. Veredicto **RECHAZADO** |
| ❌ | Entrada en `progress/history.md` | No existe todavía (cierre del leader al mergear) |

---

## El mapa `R<n> → test`, requisito por requisito

Leyenda: **✅** hay test, afirma el requisito y **moriría** si el comportamiento se rompe ·
**⚠️** el test existe pero afirma algo *adyacente*, o cubre sólo una parte · **❌** no hay test que
discrimine el requisito · **➖** sin test **a propósito**, con su razón escrita ·
**?** **no verificable leyendo**.

### Bloque A — el conteo N/V y la regla

| R | Juicio | Por qué |
|---|---|---|
| R1 | ✅ | «T10.1/R1-R8» siembra las 7 filas **en Postgres** y lee `contarCierresAbiertosPorMensajero`, con dos señuelos (tres `aprobado` → N=0; tres abiertos → N=3, sin tope). Es el `groupBy` real, no un doble |
| R2 | ✅ | Tabla de verdad unitaria + filas 1 y 2/3 del SQL |
| R3 | ✅ | Unitaria (casos 4-7) + SQL + `cierre-bloqueo-superficies`, que usa el repositorio **real** sobre un Prisma que agrupa de verdad |
| R4 | ✅ | Unitaria «caso 1» + fila «sin cierres» + el señuelo de los tres `aprobado` |
| R5 | ✅ | Unitaria «caso 2»/«caso 3» + fila «2/3 · un solicitado» + familia A-libre |
| R6 | ✅ | Unitaria «caso 4» + fila «4 · dos solicitado» |
| R7 | ✅ | Unitaria `{n:1,v:1}` + filas «5 · un vencido» y «5-bis · un rechazado». Lo «al instante» lo cierra R12 |
| R8 | ✅ | Última aserción de «T2.4/R19 (M2)»: tras re-solicitar, `findMensajerosBloqueadosPorCierres` **sigue** devolviéndolo |
| R9 | ✅ | Tres pruebas independientes: el gate `existeCierreSolicitado` **desapareció** (no se parcheó), «271/R13» crea el segundo y «271/R21» deja de excluirlo del corte. El SQL siembra dos filas abiertas del mismo mensajero sin que ningún índice lo impida |
| R10 | ⚠️ **?** | Verificado **por lectura**: las cinco superficies de gestión, las tres de asignación, los dos selectores, el gate de creación y la pantalla consultan el mismo predicado. Pero el test citado —«el módulo de la regla es PURO»— **no afirma R10**: afirma que no importa Prisma. Nada impide que una superficie NUEVA re-derive. Ver **M3** |
| R11 | ✅ | Dos casos SQL: inserción en orden inverso al `solicitado_at`, y desempate por `id` **estable entre dos llamadas** |
| R12 | ✅ | `cierre-aprobar-el-mas-viejo-desbloquea`: la consulta del veredicto corre contra un cliente que **lanza** ante cualquier escritura, y el envoltorio está **auto-comprobado**. «Sin escritura adicional» deja de ser una frase |

### Bloque B — solicitar cierre

| R | Juicio | Por qué |
|---|---|---|
| R13 | ✅ | «271/R13» prueba «libre → crea el segundo». El doble devuelve `SIN_BLOQUEO` (N=0), no N=1: el requisito sale de **componer tres tests** (la regla dice que `N=1,V=0` es libre; el SQL dice que un `solicitado` no bloquea; el servicio dice que libre crea). Es una cadena, no una fila falsa, pero conviene saberlo |
| R14 | ✅ | `cierre-segundo-vincula-solo-lo-suyo` **contra Postgres**, con conjunto exacto y dos señuelos (gestión anulada y de otro mensajero) |
| R15 | ✅ | El motivo se afirma por su literal («2 cierres esperando aprobación» + «la bodega apruebe el más antiguo») y `crearCierre` no se llama |
| R16 | ✅ | Parametrizado por `vencido`/`rechazado`, y afirma la exención de verdad: `contarOrdenesPendientesGestion` **ni se llega a llamar** |
| R17 | ➖ conforme | La prohibición está razonada en tres sitios con los tres pasos del argumento. **Comprobado que nadie coló código defensivo**: no hay guarda, conteo ni rama por «dos `vencido`»; la re-solicitud trata los dos estados re-solicitables de forma uniforme y elige por edad |
| R18 | ✅ | Tres casos SQL; uno **cruza** `findBloqueoDetalle` con `findCierreResolicitableMasViejo` (dos repositorios, misma fila): «nombrar uno y mover otro» cerrado con una medición |
| R19 | ✅ | «T2.4/R19 (M2)» reproduce los **cuatro pasos del rechazo** contra Postgres: mueve UNO, el otro sigue `rechazado`, y devuelve **`true`** (el `false` con dos filas ya movidas era el fallo) |
| R20 | ✅ | «T2.6/R20» compara **la fila entera** antes/después: sólo cambia `estado`. Money-safe medido, no prometido |

### Bloque C — el corte diario

| R | Juicio | Por qué |
|---|---|---|
| R21 | ✅ | Los dos casos del repositorio **se invirtieron** en vez de borrarse, y el segundo afirma lo que importa: `prisma.cierreDia.findMany` **no se llama** (la consulta que restaba se fue, no es que devuelva vacío) |
| R22 | ✅ | Tests preexistentes que **sí leí**: `crearCierre null → vencidosCreados 0`, y el rollback «algo pasó» (`id === null` con `orden.updateMany` y el historial **no llamados**) |
| R23 | ✅ | El bucle recorre una lista DISTINCT; el test preexistente afirma `crearCierre` llamado 2 veces para 2 mensajeros |
| R24 | ⚠️ **?** | La primera mitad («no re-vincular una gestión ya vinculada») la cubre el test nuevo de R14 contra Postgres. La segunda («no volver a registrar una orden ya barrida») no tiene test propio: se sostiene por la máquina de estados, y **no pude cerrarla del todo leyendo** |

### Bloque D — gestionar y cobrar

| R | Juicio | Por qué |
|---|---|---|
| R25 | ✅ | `cierre-bloqueo-superficies` cruza **las 5 filas bloqueadas × 3 superficies** (escoger, recolectar, deshacer) con el repositorio **real**; `gestionar` y `recoger` tienen su caso de bloqueo en `mis-asignaciones-service` con doble. Las cinco están |
| R26 | ⚠️ | Las mismas 3 superficies con `N=1,V=0` explícito. Para `gestionar` y `recoger` el caso libre sólo se ejercita con `N=0`: la mitad «con un `solicitado` pendiente SÍ gestiona» —la parte de la regla del 20/08 que esta ficha **no** revierte— no está afirmada para esas dos. Ver **M4** |
| R27 | ✅ | Afirma el motivo por su frase **y** que no se llegó a leer la orden |

### Bloque E — recibir trabajo nuevo

| R | Juicio | Por qué |
|---|---|---|
| R28 | ✅ | B1-bloqueado × 5 filas + `guia-asignacion-service` |
| R29 | ✅ | B2-bloqueado × 5 filas + `asignacion-satelite-service`. Y el predicado **vuelve al `Pick`**, que es donde la 241 escondía la asimetría |
| R30 | ✅ | El `detalle` cubre **las tres** órdenes del lote y `asignarBodegaLote` no se llama |
| R31 | ✅ | B3-bloqueado + un caso que fija el ORDEN: la guarda de cierres va **antes** de la regla de dedicación y **no la sustituye** (con mensajero libre y reparto encima, el rechazo sigue siendo el de dedicación) |
| R32 | ✅ | Las dos mitades existen por separado y salen del mismo predicado: acciones (`ordenes-guia` con `toEqual` exhaustivo, `recepcion-satelite`) y pantalla (los dos modales + el satélite) |
| R33 | ✅ | Caso de comportamiento **+ guardia de árbol** sobre `FiltrosEntregas.tsx` con anti-vacuidad. Es la ausencia deliberada mejor protegida de la ficha |
| R34 | ✅ | Unitario, SQL («T10.1/R34», dos mensajeros en la misma consulta) y componentes |

### Bloque F — aprobar

| R | Juicio | Por qué |
|---|---|---|
| R35 | ✅ | `cierre-aprobacion-libera-solo-lo-suyo` **contra Postgres**; el segundo caso —`sin_gestion_registrado = false`— impide que el arreglo abra un fallo mudo nuevo (liberar cero en silencio) |
| R36 | ✅ | Bloqueado → aprueba el más viejo por el camino real → LIBRE, y sin ninguna escritura en la consulta del veredicto |
| R37 | ✅ | Mismo archivo, con el pago snapshot de la gestión del otro cierre intacto |

### Bloque G — avisos

| R | Juicio | Por qué |
|---|---|---|
| R38 | ❌ **BLOQUEANTE** | **Ningún test afirma que el corte emita nada.** Ver **B2** |
| R39 | ❌ **BLOQUEANTE** | Ídem, y además **nadie afirma quiénes son los destinatarios** de `cierre_dia_vencido`. Ver **B2** |
| R40 | ❌ **BLOQUEANTE** | El emisor sí está probado; **el productor no**. Ver **B3** |
| R41 | ❌ **BLOQUEANTE** | Ídem. Ver **B3** |
| R42 | ✅ | 18 casos con el notificador **inyectado**: emite una vez, al mensajero de la fila y a la zona destino; los **cinco** desenlaces que no escriben no avisan; dos rechazos → dos entidades; y `resolverCierre` **no recibe nada del aviso**, afirmando las claves exactas de su input. Es el patrón que a los otros tres productores les falta |
| R43 | ✅ | Los literales van **a mano y completos** en `bloqueo-textos` y en los cuatro portales, con la aserción negativa de las dos promesas retiradas. Nada se compara contra la función que lo genera |
| R44 | ✅ | Contra Postgres y contra el índice real `notificacion_dedupe_key`: mismo cierre dos veces → 1 fila; otro cierre → 2. Las dos mitades |
| R45 | ✅ | Aserciones negativas (importe, correo, uuid) sobre los **ocho** textos |
| R46 | ✅ | Sin siglas ni nombres de estado, sobre los ocho |
| R47 | ⚠️ **?** | Bien cubierto para el **rechazo** (el aviso que lanza y la relectura que lanza) y para los productores de `CierreDiaService` (vía `emitirBestEffort`). **Para el corte no hay ningún test**, y leyendo aparece un camino que no queda absorbido. Ver **M5** |

### Bloque H — lo que la administración ve

| R | Juicio | Por qué |
|---|---|---|
| R48 | ✅ | Servicio (una sola consulta en lote, sin N+1) + `CierreAdminBloqueoMensajero.test.tsx` con los **tres plurales escritos a mano** |
| R49 | ⚠️ **?** | **La fila del mapa es falsa**: los `cierres-admin-*.test.ts` que cita **doblan** `forzarSolicitudVencido` y no tocan `ESTADOS_REABRIBLES`. Lo que sí verifiqué: la constante y su `where` **no aparecen en el diff**. Es no-regresión por ausencia de cambio, no por test. Ver **M6** |

### Bloque I — la prosa que deja de ser cierta

| R | Juicio | Por qué |
|---|---|---|
| R50 | ⚠️ | **Verificado por lectura y CUMPLIDO**: el bloque de `OrdenRepository.ts` (`:309-349`) y la cabecera de `lib/constants/bloqueo-mensajero.ts` declaran la regla nueva, nombran ficha y fecha, y dicen qué **sobrevive** (`solicitado` a secas no bloquea) y qué se **revierte** (recibir trabajo nuevo, reparto **y** recolección). El test citado, en cambio, afirma sobre un **tercer** archivo. La dirección peligrosa la cubre la guardia de frases caducadas |
| R51 | ❌ **BLOQUEANTE** | La guardia censa `lib/` **y** `app/` con cinco frases, anti-vacuidad **por raíz** y contraprueba ejecutada. Excelente… y **el árbol la incumple fuera de esas dos raíces**. Ver **B4** |
| R52 | ✅ | El `conCta` es la única diferencia, y hay un caso que lo afirma comparando las dos salidas (`conCta === sinCta` en el caso sin CTA) |

### Bloque J — no regresión

| R | Juicio | Por qué |
|---|---|---|
| R53 | ✅ | «T2.6/R20» compara la fila entera; el arreglo de M7 no toca importes |
| R54 | ✅ | Test preexistente leído: `null` + `updateMany` y el `createMany` del historial no llamados |
| R55 | ✅ | El test de migración afirma que el `up` no crea tablas, no altera columnas y no reescribe filas; y que el `down` conserva el `NULLS NOT DISTINCT` y el `WHERE` parcial del índice de dedupe |
| R56 | ✅ | El wiring afirma `findCierreParaAviso` llamado con **`c-1`**, el id que se acaba de tocar; con el `mensajeroId` de antes el caso muere |

### Bloque K — la jornada

| R | Juicio | Por qué |
|---|---|---|
| R57 | ✅ | Unitario (el caso medido `79cb2c0f`) **y** SQL con conversión real de zona horaria, incluido «una gestión ANULADA no cuenta» |
| R58 | ✅ | Unitario + SQL + cruce de mes |
| R59 | ✅ | Guardia de árbol sobre el derivador, con los comentarios retirados: `fechaReparto` no aparece ni una vez en el código |
| R60 | ✅ | Unitario (dos días → `null`, fecha ilegible → `null`, `2026-02-31` no rueda al mes siguiente), SQL, textos —incluida la **coma huérfana**— y componentes |
| R61 | ✅ | Un solo módulo, y **verificado por grep**: `derivarJornada` sólo lo importa `OrdenRepository` y `jornadaDelCorte` sólo `CorteDiarioService`. El test cruza las dos fuentes en el cron normal y en el adelantado |

**Recuento:** 51 ✅ · 6 ⚠️ (R10, R24, R26, R47, R49, R50) · 4 ❌ bloqueantes (R38, R39, R40, R41) ·
1 ➖ conforme (R17).

**«No verificable leyendo» (4):** **R10** (que ninguna superficie futura re-derive), **R24**
(segunda mitad), **R47** (rama del corte) y **R49** (nadie vigila `ESTADOS_REABRIBLES`).

---

# HALLAZGOS

## BLOQUEANTES

### B1 — `tasks.md` tiene 58 tareas y **ninguna** marcada `[x]`

`CHECKPOINTS.md` lo pide por su nombre: *«Existe `specs/<feature>/tasks.md` y todas las tasks estan
marcadas `[x]`»*. Medido sobre el archivo: **58 casillas abiertas, cero cerradas**. Entre ellas
**`T0.1 — NO EMPEZAR sin aprobación humana del spec`**, sin marcar sobre una ficha ya implementada
entera.

No es burocracia. `tasks.md` es el único sitio donde se ve **qué se decidió no hacer**, y hoy no
distingue una tarea cerrada de una que nadie miró. Tres tienen desenlaces distintos que sólo viven
en las bitácoras: `T3.5` (el coste de la corrida del corte, **no medido**), `T11.5` (ver la app,
**sí hecho**, en dos pasadas) y `T6.7` (la guardia de PII, **sustituida** por aserciones negativas).

**Qué falta:** marcar las cerradas y escribir **en el propio `tasks.md`** el desenlace de las que no
lo estén: medida, sustituida o descartada, y por qué.

### B2 — R38 y R39 no tienen ningún test que los afirme: borrar la emisión del corte deja los 18.109 tests en verde

Es la misma familia que el defecto ya corregido en `b6dea0cf` —el composition root que no inyectaba
el notificador—, **una capa más arriba**, y sigue viva. Medido con `grep` sobre todo `tests/`:

- **Ningún test construye `CorteDiarioService` con notificador.** Los dos que lo instancian
  (`corte-diario-service.test.ts:107`, `corte-diario-seleccion.test.ts:134`) pasan **seis**
  argumentos; el notificador es el **séptimo** y se queda con su default no-op. Si alguien borra el
  bloque `await this.notificarVencido({...})` de `CorteDiarioService.ts:224-232`, **no se pone rojo
  nada**.
- **Ningún test importa `emitirCierreDiaVencido`.** Los destinatarios —«al mensajero dueño del
  cierre» (R38) y «a la bodega responsable» (R39), que es *literalmente* lo que los dos requisitos
  exigen— no están afirmados en ninguna parte. Cambiar
  `destinatario: { tipo: "usuario", usuarioId: ctx.mensajeroUsuarioId }` por un rol, o quitar las
  filas de bodega, pasa en verde.
- **Ningún test ejercita `notificarCierreDiaVencidoCon(repoDoble)`**, a diferencia de sus tres
  hermanos de la 146, que sí tienen su caso de «camino real» en
  `notificacion-notificadores-reales.test.ts`.

Lo que **sí** está probado, y es lo que el mapa presenta como cobertura de R38/R39: **el TEXTO** de
los dos avisos (`bloqueo-textos.test.ts` → «4 · … al MENSAJERO», «4-ter · … a la BODEGA») y **la
línea del cableado** en el composition root (guardia de árbol, con su mutación muerta y bien hecha:
distingue importar de pasar). Las dos afirmaciones son ciertas y **ninguna afirma el requisito**: un
texto que nadie emite y un argumento que nadie usa son exactamente el estado del 22/08, cuando el
corte corría mudo con toda la suite en verde.

Y el riesgo no es teórico: es **el aviso que más se emite de toda la ficha y el único que se dispara
solo, cada noche, sin nadie mirando**.

**Qué falta:** (a) un caso que construya `CorteDiarioService` con un notificador doble y afirme una
emisión **por cierre creado** y **ninguna** cuando `crearCierre` devuelve `null`, con el `jornadaCR`
del ancla de esa corrida; (b) un caso sobre `emitirCierreDiaVencido` con repositorio doble que fije
los destinatarios —mensajero + `maestro` + `admin` + `adminSatelite` de la zona destino—, como ya
hace `notificacion-bloqueo-otro-cierre-avisa.test.ts` con el otro evento.

### B3 — R40 y R41: el productor del aviso de «bloqueado por acumular» no se ejercita en ningún test

Mismo mecanismo, distinto productor. `CierreDiaService` recibe el notificador en el **séptimo**
parámetro (`notificarBloqueo`), y **ninguna de las suites que instancian ese service se lo pasa**:
comprobados los diez `new CierreDiaService(` de `tests/`, todos pasan cinco o seis argumentos.
Consecuencia: borrar `await this.avisarBloqueoPorAcumular(cierreId, actor.usuarioId);`
(`CierreDiaService.ts:618`) **no pone rojo nada**.

A favor de la implementación, y por eso este hallazgo pesa menos que B2 aunque cuente igual: el
**emisor** sí está probado de verdad —`notificacion-bloqueo-otro-cierre-avisa.test.ts` emite
`emitirMensajeroBloqueado` contra Postgres, cuenta **4 filas** (mensajero + los tres de bodega), fija
`entidad_id`/`entidad_tipo` y mata la mutación de la entidad—, y el composition root de
`lib/actions/cierre-dia.ts` tiene guardia **sobre el uso efectivo**, no sobre el import. Lo que falta
es el eslabón del medio: **que la solicitud que deja al mensajero en `N ≥ 2` dispare el aviso**, y
que lo haga con el cierre recién creado y no con `aResolverPrimero`. La bitácora de cobertura afirma
haber comprobado ese extremo, y es cierto: lo comprobó **leyendo**, no con un test.

**Qué falta:** un caso que inyecte el séptimo argumento y afirme tres cosas: emite cuando la creación
deja `N ≥ 2`, **no** emite cuando deja `N = 1`, y la entidad es el cierre recién creado.

### B4 — R51 incumplido en el árbol: `feature_list.json` y `progress/current.md` siguen diciendo «solo reparto, no la recolección»

R51: *«Ninguna línea del árbol DEBE seguir afirmando que recibir asignaciones no se bloquea nunca …
ni distinguir reparto de recolección a efectos de bloqueo»*. Y `requirements.md` lo remacha: *«Si
alguien encuentra un resto de la excepción de recolección en el código **o en la prosa**, es basura
de la versión anterior, no una decisión»*.

Dos ficheros del árbol la conservan, y son **los dos primeros que lee la próxima sesión**:

- **`feature_list.json:3306`** (`status_note` de la 271): *«…el bloqueo alcanza TAMBIEN recibir
  asignaciones -- **SOLO REPARTO, no la recoleccion en tienda** (decidido por el humano el
  2026-08-23)»*. Atribuye al humano lo contrario de lo que decidió ese mismo día. La misma nota
  arrastra otras dos frases que el spec ya corrigió: describe **M2** como el caso de «dos `vencido`»
  (que `S2` reformuló sobre «dos re-solicitables») y sigue dando por vigente el invariante `R30`.
- **`progress/current.md:45`**, en el §EN CURSO que `CLAUDE.md` manda leer primero: *«El bloqueo de
  asignaciones es **solo reparto**, no la recolección en tienda.»*

La guardia `regla-241-caducada.guardia.test.ts` no los ve porque censa `lib/` y `app/` —decisión
razonable para código—, pero la ficha y la bitácora de estado **son** el sitio donde una regla
revertida hace más daño: no rompen ningún test y son la instrucción que el siguiente agente va a
seguir. Este repo ya tiene escrito que su prosa miente más que su código.

**Qué falta:** reescribir esas dos entradas con la regla vigente (Q1), y valorar si la guardia debe
censar también `feature_list.json` y `progress/current.md` — que es la forma de que esto deje de
depender de que alguien se acuerde.

---

## MENORES

### M1 — El mapa de trazabilidad presenta como cobertura cosas que no lo son

Además de B2/B3, hay tres filas más que no dicen la verdad. Conviene corregirlas **en la bitácora**,
porque el próximo lector las va a creer:

- **R49** → «`cierres-admin-*.test.ts` (existentes) sobre `ESTADOS_REABRIBLES`». Esos tests
  **doblan** el método y nunca llegan a la constante. Ver **M6**.
- **R50** → «`regla-241-caducada.guardia.test.ts` → *y la regla NUEVA sí está escrita donde vive el
  predicado*». Esa aserción lee `lib/utils/bloqueo-cierre.ts`, **no** los dos archivos que R50
  nombra. La prosa nueva está —la leí— pero el test no la vigila.
- **R10** → «guardia — el módulo de la regla es PURO». Afirma que no importa Prisma; R10 habla de
  que ninguna superficie re-derive.

### M2 — `tieneVencido` / `tieneRechazado` siguen calculándose en el servicio, desde otra fuente, y ya no los lee nadie

`CierreDiaService.listarCierreDia` (`:332`, `:336`) sigue derivando las dos banderas de
`cierresPasados` —el **histórico**—, mientras la pantalla las deriva ahora de
`bloqueo.aReenviarPrimero` (`CierreDiaModule.tsx:416-417`). Ninguna página consume ya las del
servicio. Es un dato muerto que responde **la misma pregunta por un segundo camino**, que es
justamente lo que R10 prohíbe y lo que la ficha acaba de retirar de la UI. Hoy no hace daño porque
nadie lo lee; mañana alguien lo leerá.

### M3 — Nada vigila que una superficie nueva re-derive la regla (R10)

La guardia de `liquidacion-alcance.test.ts` prohíbe los cinco nombres del predicado **sólo en los
archivos de la feature 172**. No hay ninguna guardia de árbol que impida que un service nuevo monte
su propia versión de la regla a partir de una lista de estados. Es exactamente como se llegó a la
asimetría que esta ficha revierte.

### M4 — R26 no está afirmado para `gestionar` ni para `recoger` con `N = 1, V = 0`

Esas dos superficies sólo tienen su caso libre con `N = 0`. La mitad que la 271 **conserva** de la
regla firmada el 20/08 —«un `solicitado` a secas no bloquea»— es justo la que un descuido futuro
puede volver a romper, y ahí no hay red. Para escoger, recolectar y deshacer sí la hay, y con el
repositorio real detrás.

### M5 — R47 en el corte: la propiedad no se sostiene en todos los caminos

`notificarCierreDiaVencidoReal = async (ctx) => notificarCierreDiaVencidoCon(repoReal())(ctx)`:
`repoReal()` se evalúa **fuera** del `emitirBestEffort` que absorbe el fallo. Si resolver el cliente
lanzara, el error subiría hasta el bucle del corte —que **no** envuelve la llamada— y tumbaría la
corrida. Es un patrón heredado de la 146 y compartido por los siete notificadores reales, así que
**no lo introduce esta ficha**; se nombra porque R47 menciona la corrida del corte por su nombre y
porque el corte es money-critical y corre sin nadie mirando.

### M6 — Nadie vigila `ESTADOS_REABRIBLES` (R49)

`CierresAdminRepository.ts:80` sigue con `["vencido","rechazado"]` y su `where` intacto —comprobado:
**no aparecen en el diff**—, así que la no-regresión se cumple. Pero si alguien quitara `rechazado`
mañana, **ningún test se pondría rojo**. Y R48 acaba de sacar al `rechazado` de la cola: la única
salida de ese mensajero pasaría a depender de una lista que nadie mira. El propio `requirements.md`
escribió R49 «explícitamente porque R48 saca al `rechazado` de la cola»; lo que falta es el test que
lo respalde.

### M7 — «Solicitar cierre» puede quedar habilitado para un mensajero bloqueado

`listarCierreDia` calcula `puedesSolicitar` sólo con `pendientes` y `gestiones.length`
(`CierreDiaService.ts:318-327`): **no mira el bloqueo**. Con `N ≥ 2, V = 0` y alguna gestión suelta,
el botón sale habilitado y el servidor responde `conflict`. El estado es estrecho —bloqueado no
puede gestionar, así que una gestión suelta sólo puede venir de la tienda (feature 237)— y la
dirección del error es **la segura** según la lección de la 241: prohibir de más en la UI es peor
que dejar pulsar y explicar. Además el motivo que devuelve el servidor es el bueno, el que cuenta.
Queda anotado, no pedido.

### M8 — Declarados por el implementador, y verificados como ciertos (no se re-descubren)

- **5 de las 7 guardias de composition root a mano siguen con `toContain` sobre el fichero entero**
  (`postulacion-mensajero`, `carga/route`, `postulacion-recurso`, `corregir-dia-reparto`,
  `cierres-admin`). **Confirmado.** Las dos que no: `cierre-dia.ts` (sobre el uso efectivo) y el cron
  (regex sobre la llamada). La guardia **derivada del árbol** las cubre por detrás para la pregunta
  «¿está vivo?», y su límite —que no ve los **sitios**— está medido y escrito.
- **Las variantes «sin jornada fiable» (R60) no se han visto en pantalla.** Cierto; están cubiertas
  por test en los cuatro portales y en el formateador.
- **Cinco textos con voseo sin tildes previos a la 271 en `lib/services/`.** Fuera de alcance por
  decisión humana; ficha aparte.
- **R17 sin test a propósito.** Prohibición razonada, y **sin código defensivo colado**: verificado
  con `grep` sobre `lib/` — no hay guarda, conteo ni rama por «dos `vencido`».
- **Ningún test de otra feature se perdió.** El único archivo borrado es
  `cierre-bloqueo-asimetria.test.ts` (feature 241), y su sustituto conserva sus tres casos «con
  `solicitado` sí se puede» **y el método** (repositorio real sobre un Prisma que agrupa de verdad),
  añadiendo las tres escrituras de asignación. Comprobado caso por caso contra la versión de `dev`.

---

## Lo que esta ficha hace bien, y conviene que quede escrito

No es cortesía: son los patrones que el próximo revisor debería exigir.

1. **Los `WHERE` que llevan dinero se prueban contra Postgres sembrado**, no con dobles —N/V, «el más
   viejo», la re-solicitud de M2, la liberación de M7 y la jornada—, y las 23 aserciones **se
   ejecutaron de verdad** en mi corrida; no se dieron por buenas.
2. **R12 se afirma con un cliente que lanza ante cualquier escritura, y el envoltorio está
   auto-comprobado.** «Sin escritura adicional» deja de ser una frase.
3. **Ni un literal se compara contra la función que lo genera**, y está dicho por qué en la cabecera
   del archivo de textos.
4. **La fecha del aviso no se puede afirmar por la salida en una rama, y se dice así** —mutante
   equivalente— en vez de fabricar un doble con un estado que la base no produce. Es la respuesta
   correcta a esa pregunta, y va acompañada de una guardia de árbol que fija la fuente.
5. **Mirar la app encontró tres defectos de texto que 18.000 tests daban por buenos**, y un cuarto
   que se declaró antes de parchearlo, con su texto consultado al humano.
6. **La migración de enum aplica entera la lección de este repo**: `down` que recrea con la lista de
   hoy, los tres `down` previos auditados y **no tocados**, precondición ruidosa y cero `DELETE`.
7. **Los tres fallos mudos (M2, M7, M9) están cerrados con el método correcto**: los métodos viejos
   no se parchean, desaparecen.

---

## Qué haría falta para pasar a `OK`

1. Marcar `tasks.md` y dejar en él el desenlace de las tareas que no se cerraron (**B1**).
2. Un test que afirme que **el corte emite**, y otro que fije los **destinatarios** de
   `cierre_dia_vencido` (**B2**).
3. Un test que afirme que **la solicitud que deja `N ≥ 2` emite** el aviso, con el cierre recién
   creado como entidad (**B3**).
4. Reescribir la `status_note` de la 271 en `feature_list.json` y el §EN CURSO de
   `progress/current.md` con la regla vigente (**B4**).

Los menores no bloquean, pero **M1** —corregir las filas falsas del mapa— debería ir en el mismo
diff: una bitácora que afirma cobertura que no existe es el mecanismo por el que llegamos aquí.
