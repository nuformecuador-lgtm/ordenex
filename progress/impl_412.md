# 412 — Bitácora de implementación

> Spec: `specs/412-aviso-cierre-rechazado/` (26 requisitos, sin preguntas abiertas).
> Rama `feat/412-aviso-cierre-rechazado`, worktree propio.
> Zona **backend**. Gate: **`./init.sh` COMPLETO** (el rápido se niega solo: el diff toca
> `db/migrations/**`, `db/schema.prisma`, `lib/types/**` y archivos con nombre de dinero).

---

## §0 — Pre-vuelo

### T0.1 — Producción: CERO cierres rechazados en toda la historia

**Medido por el humano el 2026-09-11.** Desde el arranque comercial del 2026-08-27:
**78 `aprobado`, 5 `solicitado`, 0 `rechazado`.** Luego tampoco ha habido ningún segundo rechazo.

El número tira en **dos direcciones opuestas, y las dos cuentan**:

- **(a) La ficha es PREVENTIVA**, como la 417 y la 418. **Nadie verá un cambio al desplegar**, y
  eso no es un defecto: es la medida de su riesgo. Un cero aquí significa «aún no ha pasado», no
  «no puede pasar» — producción se vació el 2026-08-25 y el negocio arrancó el 27.
- **(b) El agujero 2 del spec sigue siendo un fallo REAL y VIVO del código de hoy.** La entidad del
  aviso de bloqueo es el cierre y la re-solicitud reutiliza la misma fila: el segundo rechazo no
  avisaría nunca, en silencio. Que no haya ocurrido **lo hace más barato de arreglar ahora**,
  porque no hay ninguna fila previa que migrar ni ningún aviso vivo que respetar.

⚠️ **No se volvió a medir para «confirmar»**, como pide la tarea.

### T0.2 — Orden con la 410: **rama A**

`lib/notificaciones/push-elegibles.ts` **existe en `dev`** y `push_envio_dia` está en
`db/schema.prisma` (modelo `PushEnvioDia`, con su migración `20260912120000_push_suscripcion`).
La 410 entró **antes** que ésta, así que aplica la **rama A** de T6.1: esta ficha **añade la línea**
al catálogo de push y el typecheck la exige.

- `origin/dev` al arrancar: **`b4ee84128fd086710dd3f27e6d8d62c3a31e868d`** (2026-09-11).
- Enums medidos allí: **13 eventos, 11 entidades**.

### T0.3 — Los cinco hechos de `design.md §1`, reconfirmados EN EL ARCHIVO REAL

El grafo del MCP se usó primero (regla 7) y **devolvió de más, como avisa el `CLAUDE.md`**: situó
`avisarBloqueoPorRechazo` en `CierresAdminService.ts:277-295` cuando en el archivo real estaba en
`:297-315`. El grafo dice DÓNDE mirar; el archivo dice QUÉ hay. Los cinco, leídos en el archivo:

| # | Hecho | Dónde, en el árbol de `b4ee8412` |
| --- | --- | --- |
| 1 | `if (!bloqueo.bloqueado) return;` — el aviso se salta entero si no bloquea | `lib/services/CierresAdminService.ts:307` |
| 2 | La entidad del aviso de bloqueo es el CIERRE: `entidadTipo: "cierre_dia"`, `entidadId: ctx.cierreId`, destinatario `{tipo:"usuario"}` | `lib/notificaciones/emitir.ts:646-653` |
| 3 | `crear` ABSORBE el `P2002` | `lib/repositories/NotificacionRepository.ts:181-183` |
| 4 | `transicionarASolicitado` REUTILIZA la fila (`updateMany` sobre el mismo `id`, `data` = sólo `estado`) | `lib/repositories/CierreDiaRepository.ts:638-644` |
| 5 | `resolverCierre` escribe `resueltoAt: new Date()` en la misma sentencia que mueve el estado | `lib/repositories/CierresAdminRepository.ts:1765` |

**Una corrección al spec, sin consecuencias:** el spec dice que `crear` absorbe el `P2002`
«devolviendo `false`». Hoy devuelve **`null`** — la 410 cambió la firma a
`Promise<string | null>` (`emitirFilas` mira `!== null`). **La sustancia es idéntica**: el choque
con el índice único es un no-op silencioso, que es de lo que depende todo el razonamiento de la
entidad. No se paró la ficha por esto.

---

## §1 — Archivos creados / modificados

### Producción

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | +`cierre_dia_rechazado` en `NotificacionEvento`, +`cierre_dia_rechazo` en `NotificacionEntidadTipo`, con el comentario de por qué la entidad lleva el instante |
| `db/migrations/20260913120000_notificacion_evento_cierre_rechazado/migration.sql` | **nuevo** — dos `ALTER TYPE … ADD VALUE IF NOT EXISTS`, sola y con timestamp propio (`55P04`) |
| `db/migrations/20260913120000_notificacion_evento_cierre_rechazado/down.sql` | **nuevo** — recrea los dos tipos con la lista previa y retipa **TRES** columnas (§3) |
| `lib/types/notificacion.ts` | +1 valor en cada tipo espejo |
| `lib/notificaciones/catalogo-avisos.ts` | entrada 14: accionable, atajo `{href:"/cierre-dia", etiqueta:"Ver mi cierre"}`, `destinatarios:["mensajero"]`, sin `porRol` |
| `lib/notificaciones/emitir.ts` | +`textoCierreRechazadoMensajero`, +`CierreRechazadoContexto`, +`emitirCierreDiaRechazado`, +`DestinatariosBloqueo`; `emitirMensajeroBloqueado` respeta `ctx.destinatarios` |
| `lib/notificaciones/notificadores.ts` | +`CierreRechazadoNotificador`, +`notificarCierreDiaRechazadoCon`, +`notificarCierreDiaRechazadoReal`, ampliado `notificadorNoOp` |
| `lib/notificaciones/push-elegibles.ts` | +1 línea: `cierre_dia_rechazado: { push: "si", roles: ["mensajero"] }` |
| `lib/constants/bloqueo-mensajero.ts` | `NO_PUEDES` pasa de privada a **exportada**, sin cambiar su valor |
| `lib/interfaces/repositories/IOrdenRepository.ts` · `lib/repositories/OrdenRepository.ts` | +`findJornadaDeCierre(cierreId)` |
| `lib/services/CierresAdminService.ts` | `avisarBloqueoPorRechazo` → `avisarDelRechazo` (tres unidades best-effort independientes); +`findJornadaDeCierre` al `Pick`; +1 parámetro de constructor **al final**, con default no-op |
| `lib/services/CierreDiaService.ts` | pasa `destinatarios: "mensajero_y_bodega"` (el campo es obligatorio) |
| `lib/actions/cierres-admin.ts` | **composition root**: pasa `notificarCierreDiaRechazadoReal` |

**No se tocó**, como manda el spec: `NotificacionRepository`, `predicadoVisibilidad`,
`NotificacionService`, `presentacion-aviso.ts`, `NotificationsBell.tsx`,
`estaBloqueadoPorCierres`, la salida de `avisoBloqueo`, **ningún `down.sql` anterior** y
**`feature_list.json`**.

### Tests

**Nuevos:** `tests/unit/notificaciones/cierre-rechazado-aviso.test.ts`,
`tests/unit/notificaciones/mensajero-bloqueado-aviso.test.ts`,
`tests/integration/db/cierre-rechazado-aviso-dedupe.test.ts`,
`tests/integration/db/cierre-rechazado-jornada-sql-real.test.ts`,
`tests/integration/db/notificacion-evento-cierre-rechazado-migration.test.ts`.

**Ampliados:** `cierres-admin-aviso-rechazo.test.ts` (reescrito: afirmaba el comportamiento que
esta ficha cambia), `notificacion-notificadores-reales.test.ts`, `bloqueo-textos.test.ts`,
`catalogo-avisos.test.ts`, `push-elegibles.test.ts`, `notificacion-service.test.ts`,
`atajo-aviso-ruta-visible.guardia.test.ts`, `notificacion-bloqueo-otro-cierre-avisa.test.ts`
(sólo el argumento nuevo obligatorio) y **cuatro dobles de `IOrdenRepository`** que ganan
`findJornadaDeCierre` (`orden-service`, `bulk-orden-service` ×2, `rol-admin-satelite-authz`).

---

## §2 — Mapa `R<n> → test` (CONFIRMADO)

| R | Test | Qué se pone rojo |
| --- | --- | --- |
| R1 | `unit/services/cierres-admin-aviso-rechazo.test.ts` → «mensajero NO bloqueado: el aviso SALE igual, UNA vez» | mover la emisión dentro del `if (bloqueo.bloqueado)` (**M3**) |
| R2 | `unit/notificaciones/cierre-rechazado-aviso.test.ts` → «UNA sola fila… NINGUNA de rol» | añadir un destinatario de rol |
| R3 | `cierres-admin-aviso-rechazo.test.ts` → bloque «412/R3», 5 desenlaces (`conflict`, `fuera_de_alcance`, motivo vacío, rol, satélite sin zona) | emitir sin que la escritura confirme |
| R4 | `cierres-admin-aviso-rechazo.test.ts` → «el aviso del RECHAZO lanza → sigue `ok` y queda REGISTRADO» + «`resolverCierre` NO recibe notificador ni cliente transaccional» | propagar el fallo o meter el aviso en la tx |
| R5 | `cierres-admin-aviso-rechazo.test.ts` → bloque «412/R5», los dos sentidos | envolver los dos avisos en un solo `emitirBestEffort` |
| R6 | `unit/services/notificacion-notificadores-reales.test.ts` → «inyecta LOS DOS notificadores reales», sobre el fuente **sin imports ni comentarios** | borrar el argumento dejando el import (**M5**) |
| R7 | `integration/db/cierre-rechazado-aviso-dedupe.test.ts` → «rechazo → re-solicitud → rechazo deja DOS filas» | entidad = `cierreId` (**M1**) o `:diaCR` (**M2**) |
| R8 | mismo archivo → «dos emisiones del MISMO rechazo dejan UNA fila» | quitar la guardia de dedupe |
| R9 | mismo archivo → «dos emisiones CONCURRENTES sobre CONEXIONES DISTINTAS dejan UNA fila» | sustituir el índice por un `if` previo |
| R10 | mismo archivo → «dos mensajeros… CADA UNO el suyo» | sacar el cierre del `entidad_id` |
| R11 | `integration/db/cierre-rechazado-jornada-sql-real.test.ts` → 6 casos | anclar en `created_at` (**M8**) |
| R12 | `cierre-rechazado-aviso.test.ts` → «SIN jornada fiable» + «una jornada que no se puede poner en palabras» | inventar una fecha |
| R13 | `cierre-rechazado-aviso.test.ts` → «la acción es REVISAR, CORREGIR y VOLVER A ENVIAR» + `guards/atajo-aviso-ruta-visible.guardia.test.ts` | cambiar la frase o el destino |
| R14 | `cierre-rechazado-aviso.test.ts` → «TERMINA con la frase» + `bloqueo-textos.test.ts` → guardia de árbol «la frase existe UNA SOLA VEZ» | quitarla (**M6b**) o **copiarla** (**M7**) |
| R15 | `cierre-rechazado-aviso.test.ts` → «sin bloqueo NO contiene “Mientras tanto” ni “no puedes”» | ponerla siempre (**M6a**) |
| R16 | `cierre-rechazado-aviso.test.ts` → «el contexto NO TIENE campo de motivo» + «motivo-cebo con teléfono y monto» + «sin anexo» | meter el motivo (**M10**) |
| R17 | `cierres-admin-aviso-rechazo.test.ts` → «al bloqueo se le pasa `solo_bodega`» + «UNA sola emisión dirigida al mensajero» | pasar `mensajero_y_bodega` (**M4**) |
| R18 | `unit/notificaciones/mensajero-bloqueado-aviso.test.ts` → bloque «412/R18» (3 filas de administración, texto y entidad de hoy, ninguna de usuario) | cambiarle algo a la bodega |
| R19 | `mensajero-bloqueado-aviso.test.ts` → bloque «412/R19» + «la ÚNICA diferencia es esa fila» + suites de la 271 verdes sin editar | cambiar el productor de la solicitud |
| R20 | `unit/notificaciones/catalogo-avisos.test.ts` (las claves = el enum de Prisma, ahora 14) + `pnpm run typecheck` | borrar la entrada ⇒ no compila |
| R21 | `guards/atajo-aviso-ruta-visible.guardia.test.ts` → «el destino de `cierre_dia_rechazado` existe Y lo ve el mensajero» | declarar `/cierres-admin` |
| R22 | `unit/services/notificacion-service.test.ts` → «cuenta en `porHacer` y trae su botón» | declararlo informativo |
| R23 | `unit/notificaciones/push-elegibles.test.ts` → «es del MENSAJERO, y de NINGÚN otro perfil» + `typecheck` | añadir un rol, o no decidir ⇒ no compila |
| R24 | `integration/db/notificacion-evento-cierre-rechazado-migration.test.ts` → «retipa LAS TRES columnas» + «CONTROL: el down corre ENTERO y los DOS índices SOBREVIVEN» | quitar una columna (**M9**) |
| R25 | mismo archivo → «ABORTA RUIDOSAMENTE» + «la fila SIGUE AHÍ» + «NO borra ni reescribe ninguna fila» | meter un `DELETE` para «hacer sitio» |
| R26 | `unit/repositories/notificacion-visibilidad.test.ts` y las suites de autorización de `cierres-admin`, **verdes sin editarlas** | tocar el predicado o la autorización |

---

## §3 — La trampa de esta ficha: el `down.sql` retipa **TRES** columnas

`notificacion_evento` ya **no** lo usa una sola columna. La 410 añadió `push_envio_dia.evento` y su
migración (`20260912120000`) es **ANTERIOR** a la mía (`20260913120000`), así que **en un rollback
real esa tabla EXISTE** cuando a mi `down.sql` le llega el turno.

La lista **se enumeró, no se supuso** (consulta de solo lectura contra la base local, 2026-09-11):

```
notificacion   | entidad_tipo | notificacion_entidad_tipo
notificacion   | evento       | notificacion_evento
push_envio_dia | evento       | notificacion_evento      <-- LA QUE SE OLVIDA
```

**Los ocho `down.sql` anteriores NO se tocaron** (146, 253, 262, 271, 333, 403, 401, 409): son
fotos históricas y todas siguen siendo ciertas. Un test lo afirma uno por uno, y además afirma que
**ninguno de los ocho retipa `push_envio_dia`** — y que eso es CORRECTO, porque `db:rollback` va
hacia atrás y esa tabla nace después de todos ellos.

**T2.5 — aplicada y revertida en local** (host confirmado antes: `localhost:5432`, base `ordenex`):

```
prisma migrate deploy   -> Applying migration `20260913120000_notificacion_evento_cierre_rechazado`
pnpm run db:rollback    -> Rollback completado
  (tras el down: notificacion_evento = 13 valores, notificacion_entidad_tipo = 11,
   notificacion_dedupe_key conserva NULLS NOT DISTINCT y WHERE (entidad_id IS NOT NULL),
   push_envio_dia_cupo conserva (usuario_id, evento, dia_cr))
prisma migrate deploy   -> reaplicada; `migrate status` = "Database schema is up to date!"
```

---

## §4 — Mutaciones: el rojo, con su conteo

Cada mutación se aplicó con **copia byte a byte** (`shutil.copy2`) y se revirtió **desde esa copia**,
comparando SHA antes/después. **En ningún momento se usó `git checkout --`**.

Las salidas son reales: cada bloque es la corrida de vitest con la mutación puesta.

| # | Mutación | Suite | Resultado |
| --- | --- | --- | --- |
| **M1** | entidad = `cierreId` (sin el instante) | dedupe + emisor | **5 failed \| 22 passed (27)** — `R7: … expected +0 to be 1` |
| **M2** | entidad = `${cierreId}:${diaCR}` | dedupe | **2 failed \| 4 passed (6)** — R7 y R9 rojos |
| **M3** | emisión dentro del `if (bloqueo.bloqueado)` | servicio | **2 failed \| 26 passed (28)** — `expected "vi.fn()" to be called 1 times, but got 0 times` |
| **M4** | `mensajero_y_bodega` en la rama del rechazo | servicio | **4 failed** — `expected 'mensajero_y_bodega' to be 'solo_bodega'` |
| **M5** | borrar el argumento del composition root **dejando el import** | notificadores reales | **2 failed \| 31 passed (33)** — y el import seguía vivo en la línea 18 |
| **M6a** | poner la frase de bloqueo SIEMPRE | textos | **5 failed** — R15 rojo |
| **M6b** | quitarla SIEMPRE | textos | **3 failed** — R14 rojo |
| **M7** | **copiar** `NO_PUEDES` a `emitir.ts` en vez de importarla | guardia de árbol | **2 failed \| 52 passed (54)** |
| **M8** | anclar la fecha en `cierre_dia.created_at` | jornada SQL real | **5 failed** — `expected '2026-08-22' to be '2026-08-21'` |
| **M9** | quitar el `ALTER TABLE "push_envio_dia"` del `down.sql` | migración | **2 failed \| 24 passed (26)** — `Code: 2BP01 … no se puede eliminar tipo notificacion_evento_old porque otros objetos dependen de él` |
| **M10** | meter el `motivo_rechazo` en el texto del aviso | emisor | **1 failed \| 20 passed (21)** — el motivo-cebo aparece en la descripción |

**Supervivientes declarados: ninguno.** Las diez mutaciones obligatorias del `design.md §12`
producen rojo.

### Lo que M7 demuestra, y es el motivo de que exista la guardia de árbol

Con `NO_PUEDES` **copiada** en vez de importada, la salida es **idéntica byte a byte**: el archivo
de literales (`cierre-rechazado-aviso.test.ts`) siguió **VERDE**. Sólo la guardia de árbol la cazó.
Una aserción sobre la salida no puede distinguir una copia de un import, y una copia es como se
desincronizan dos textos que dicen lo que el servidor hace.

### Lo que M9 demuestra

El `2BP01` es literalmente el que `db/schema.prisma` anuncia junto a `PushEnvioDia`. Y hay un
detalle que obliga al caso de CONTROL: con la mutación, **el caso de R25 (`rejects.toThrow()`)
seguía verde** — fallaba, pero por otro motivo. Sin el control «sin filas nuevas, el down corre
ENTERO», la trampa de esta ficha habría pasado desapercibida.

---

## §5 — Autocomprobación de los tests de integración (T7.2)

**Con datos → verde; sin datos → ROJO.** No pasan «por vacío».

- El caso de R7, mutando el propio test para que **la primera emisión no se ejecute**:
  `1 failed | 5 passed (6)` — `expected +0 to be 1`. Revertido con copia byte a byte.
- Los tres archivos de integración **fallan ruidosamente** si la base está alcanzable y vacía
  (`throw new Error("hay DATABASE_URL pero la tabla \`orden\` esta vacia…")`), nunca con un
  `return` silencioso.
- El archivo de dedupe lleva además dos asertos de anti-vacuidad propios: «sin sembrar nada,
  contar da CERO» y «el mensajero del caso existe y la siembra engancha».

### Un fallo REAL encontrado en mi propia limpieza, y arreglado

Al aplicar **M1**, la corrida dejó **una fila huérfana** en la base local compartida: el barrido del
caso de R9 borraba por `entidad_id: { startsWith: '<cierre>:' }`, y la fila **mutada** —cuyo
`entidad_id` ya no lleva el `:`— **sobrevivía**. Un barrido que sólo limpia lo que el código **sano**
escribe es justo el que falla cuando hace falta. Se purgó la fila y el barrido pasa ahora por
`(evento, destinatario)`. Queda escrito en el propio test.

---

## §6 — T7.4 · Observación en local, con un rechazo provocado

⚠️ **No hay Playwright ni navegador en este entorno**, así que **no se «vio la app»**. Lo que sí se
hizo, y es lo más cercano verificable: recorrer **el camino REAL** contra el Postgres local —
`CierresAdminService.rechazarCierre` construido como lo construye el composition root, con
`notificarCierreDiaRechazadoCon(new NotificacionRepository(prisma))` (la **misma función** que usa el
binding de producción) — y leer después lo que alimenta el panel,
`NotificacionService.listar(actorMensajero)`. Todo lo sembrado se limpió; la base quedó en 0 filas.

**Las cuatro observaciones que pedía la tarea, medidas:**

| # | Qué | Medido |
| --- | --- | --- |
| 1 | El mensajero lee **UN SOLO** aviso, accionable, con su botón | `porHacer: 1`, `avisos de rechazo que ve: 1`, `accionable: true` |
| 2 | El botón lo deja en `/cierre-dia` | `atajo: {"href":"/cierre-dia","etiqueta":"Ver mi cierre"}` |
| 3 | El **segundo** rechazo del mismo cierre produce un **segundo** aviso | `porHacer: 2`, 2 filas: `<cierre>:2026-09-11T15:09:38.060Z` y `<cierre>:2026-09-11T15:09:38.213Z` — **mismo cierre, dos instantes** |
| 4 | El distintivo cuenta **uno**, no dos | tras el 1.er rechazo `porHacer = 1`; filas de este evento dirigidas a un **ROL: 0** |

El texto que leyó, tal cual salió de la base:

> Tu cierre del 21 de agosto fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación.
> Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo.

**⚠️ Y mirar el camino real encontró lo que la suite no.** Los primeros dos intentos **no emitieron
nada** y dejaron un best-effort fallido: `findCierreByIdEnAlcance` lanzaba
`CierreDetalleFaltanteError` («falta el detalle congelado de la orden … feature 69/R14»). **No era
un defecto del código: era mi siembra**, que vinculaba gestiones sin escribir el snapshot
`cierre_detail` que en producción escribe `crearCierre` en la misma transacción. Corregida la
siembra, el camino real emite. Queda anotado porque **el aviso depende de que esa lectura
funcione**, y el modo de fallo es exactamente el de esta familia: rechazo `ok`, aviso mudo, un log
en el servidor y nadie mirando.

**Producción no puede verificar nada de esta ficha, y hay que decirlo antes de desplegar.** Con 0
cierres rechazados, mirar producción tras el despliegue devolverá **cero avisos nuevos** — y eso
será **lo correcto, no un síntoma**. Quien cierre la ficha buscando la confirmación allí concluirá
mal.

---

## §7 — Salida real del gate (T7.3)

Ver `§7.1`. El log completo, con `INIT_EXIT=` escrito **dentro**, se generó en el worktree
(`gate-412.log`, no commiteado).

### §7.1 — `./init.sh` COMPLETO

<!--GATE-->

---

## §8 — Lo que queda fuera, y dos hallazgos

**Fuera de alcance, declarado en el spec y respetado:**

- El rechazo de un cierre de **BODEGA** (`CierresBodegaAdminService.rechazarCierreBodega`): hoy no
  emite nada, y es simétrico a este agujero. **Ficha POSIBLE, no deuda de ésta** (D2 del humano).
- Traducir el motivo del rechazo (ficha 408) y la contradicción del comprobante (ficha 414).
- El canal de push (410): esta ficha sólo aporta **una línea de catálogo**.
- `estaBloqueadoPorCierres` y la salida de `avisoBloqueo`: no se tocó ni un carácter.

**Hallazgo 1 — el log best-effort PIERDE la causa.** `ConsoleErrorLogger.logError` registra
`err.stack ?? err.message` (`lib/errors/logger.ts:15`), y `emitirBestEffort` mete el error original
en `cause`. El stack **no contiene la cadena de causas**, así que en el servidor sólo se lee
«notificacion "cierre_dia_rechazado" fallo (best-effort)» **sin decir por qué**. Me costó tres
corridas diagnosticar el `CierreDetalleFaltanteError` del §6. Es comportamiento **de la 146**, no de
esta ficha, y arreglarlo tocaría el logger de todo el repo: **se reporta, no se toca aquí**.

**Hallazgo 2 — T6.2, avisar a la 410 del valor nuevo del enum.** La 410 ya está mergeada y
desplegada, así que no hay nadie a quien avisar «antes»; queda dicho **por escrito en el PR**: esta
ficha añade `cierre_dia_rechazado` a `notificacion_evento`, lo declara elegible para el `mensajero`
en `push-elegibles.ts`, y **su `down.sql` es el primero del repo que tiene que retipar
`push_envio_dia.evento`** — regla que hereda toda migración de enum posterior.

**Rojo ajeno conocido:** `notificacion-evento-avisos-agregados-migration.test.ts` (ficha **421**)
puede enrojecer con las etiquetas del enum duplicadas, porque su consulta filtra por `typname` sin
fijar el esquema. **Mi test nuevo no lo hereda**: fija `n.nspname = 'public'` a propósito, y queda
comentado en el archivo.

---

## §9 — Veredicto

<!--VEREDICTO-->
