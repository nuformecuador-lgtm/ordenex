# 413 — Bitácora de implementación

> Ficha **backend**, `sdd: true`. Rama `feat/413-aviso-reparto-de-manana`, desde `origin/dev`
> @ `01d280ae10d20ac168af995bf64501fdb59c1100`. Worktree propio en `R:/wt/wt413` (ruta corta).
> Gate: **`./init.sh` COMPLETO** — el diff toca `db/schema.prisma`, `db/migrations/**`,
> `lib/types/**` y `vercel.json`, así que `--rapido` se niega solo.

---

## 0. Lo que hay que leer primero, porque cambia el spec

**El spec decía «13 eventos y 11 entidades». Hoy son CATORCE y DOCE.** Esa cifra era la foto del
2026-09-10, antes de que la **412** se mergeara. Leído contra `db/schema.prisma` de `origin/dev`
@ `01d280ae` el 2026-09-11:

| enum | valores en `origin/dev` | tras esta ficha |
| --- | ---: | ---: |
| `notificacion_evento` | **14** (con `cierre_dia_rechazado`) | 15 |
| `notificacion_entidad_tipo` | **12** (con `cierre_dia_rechazo`) | 13 |

Es exactamente el motivo por el que `T2.3` obliga a **leer** la lista y no a recordarla: revertir
con la lista del spec habría **borrado en silencio** los dos valores de la 412 — le pasó a la 401
con la 403. Las listas correctas están en el `down.sql` y en el test de migración, las dos con el
SHA y la fecha anotados.

---

## 1. Fase 0 — T0.1: las seis comprobaciones, en el archivo real

Hechas sobre el árbol, no sobre el grafo. Ninguna obligó a parar.

| # | Qué | Dónde, con línea | Resultado |
| --- | --- | --- | --- |
| (a) | `orden.fecha_reparto` es `@db.Date` | `db/schema.prisma:660` (el spec decía 658; el archivo creció con la 412) | ✅ `DateTime? @map("fecha_reparto") @db.Date` |
| (b) | `DIA_REPARTO = ["hoy","manana"]` | `lib/types/dia-reparto.ts:18` | ✅ exactamente dos tokens |
| (c) | `notificacion_dedupe_key` incluye `destinatario_usuario_id` | `db/migrations/20260727120000_notificacion/migration.sql:89-92` | ✅ `UNIQUE (evento, entidad_id, destinatario_rol, destinatario_usuario_id) NULLS NOT DISTINCT WHERE entidad_id IS NOT NULL` |
| (d) | los estados del portal son `por_recoger`, `en_reparto`, `ayuda_tienda` | `lib/services/MisAsignacionesService.ts:86-93` y su llamada a `findMisAsignaciones` (:241-243) | ✅ los tres |
| (e) | `lib/notificaciones/push-elegibles.ts` existe en `origin/dev` | sí, 9.764 bytes | ✅ **camino 1 de T6.2**: se añade la entrada y su test |
| (f) | `findMensajerosBloqueadosPorCierres(ids)` sigue existiendo, en lote, derivando de `estaBloqueadoPorCierres` | `IOrdenRepository.ts:2183`, `OrdenRepository.ts:4674`, `lib/utils/bloqueo-cierre.ts:73` | ✅ `(ids: string[]) => Promise<Set<string>>` |

**Medición de columnas, contra `information_schema` y no contra el schema** (solo lectura, base
local, 2026-09-11):

```
notificacion     | entidad_tipo | notificacion_entidad_tipo
notificacion     | evento       | notificacion_evento
push_envio_dia   | evento       | notificacion_evento      <-- LA QUE SE OLVIDA
TOTAL: 3
```

## 2. Fase 0 — T0.3: el `EXPLAIN` de las dos consultas

⚠️ **CORRIDO CONTRA LA BASE LOCAL, NO CONTRA PRODUCCIÓN.** No tengo credencial de producción en
este entorno (`DATABASE_URL` apunta a `localhost:5432/ordenex`, verificado con
`prisma migrate status`, que dice el host sin exponer la credencial). Se declara como lo que es.
La base local tenía **70 filas** en `orden`.

```
=== GROUP BY por mensajero (la corrida del cron) ===
  GroupAggregate  (cost=11.15..11.17 rows=1 width=45)
    Group Key: mensajero_asignado_id
    ->  Sort  (cost=11.15..11.15 rows=1 width=37)
          ->  Seq Scan on orden  (cost=0.00..11.14 rows=1 width=37)
                Filter: ((deleted_at IS NULL) AND (mensajero_asignado_id IS NOT NULL)
                     AND (fecha_reparto > '2026-09-11'::date) AND (estatus_id = ANY (...)))

=== count por mensajero (la cifra viva, RUTA CALIENTE) ===
  Aggregate  (cost=8.29..8.30 rows=1 width=8)
    ->  Index Scan using orden_mensajero_asignado_id_idx on orden  (cost=0.27..8.29 rows=1 width=0)
          Index Cond: (mensajero_asignado_id = '...')
          Filter: ((deleted_at IS NULL) AND (fecha_reparto > '2026-09-11'::date) AND (...))
```

**Lectura, con el matiz de la 411 escrito al lado:** la consulta que importa —la **cifra viva**, la
que corre en cada sondeo de 60 s— ya entra por **índice** (`orden_mensajero_asignado_id_idx`). El
`GROUP BY` del cron elige `Seq Scan`, y **eso es correcto barato, no barato por el índice**: con 70
filas el planificador no tiene motivo para otra cosa, y esa consulta corre **una vez al día**. El
matiz de la 411 aplica entero: *con el volumen actual el planificador puede elegir `Seq Scan`, así
que este plan no describe producción con su volumen real*. **Conclusión: no hace falta ficha de
índice**, y si hiciera falta sería una migración aditiva de una línea, no ésta.

---

## 3. Archivos creados y modificados

### Nuevos (13)

| Archivo | Qué es |
| --- | --- |
| `lib/constants/reparto-mensajero-estados.ts` | `ESTADOS_REPARTO_MENSAJERO` + su tipo. Módulo puro |
| `lib/config/aviso-reparto-manana.ts` | `HORA_CR: 19`, la ruta del cron y la conversión, **con la medición del 2026-09-11 al lado del valor** |
| `lib/interfaces/repositories/IRepartoMananaRepository.ts` | contrato del repositorio (2 métodos) |
| `lib/repositories/RepartoMananaRepository.ts` | sólo queries Prisma, **un solo `where` privado** |
| `lib/interfaces/services/IRepartoMananaAvisoService.ts` | contrato del proceso + forma del resumen |
| `lib/services/RepartoMananaAvisoService.ts` | el proceso: cero, bloqueo, best-effort |
| `app/api/cron/aviso-reparto-manana/route.ts` | controller: HTTP + secreto + conteos |
| `db/migrations/20260914120000_notificacion_evento_reparto_manana/migration.sql` | los dos `ADD VALUE IF NOT EXISTS` |
| `db/migrations/20260914120000_notificacion_evento_reparto_manana/down.sql` | recrea los dos tipos, **retipando las TRES columnas** |
| `tests/unit/guards/estados-reparto-mensajero-unica-fuente.guardia.test.ts` | R2 |
| `tests/unit/guards/dia-reparto-tokens.guardia.test.ts` | el supuesto que protege la palabra «mañana» |
| `tests/unit/guards/cron-hora-cr.guardia.test.ts` | R9/R10/R11 |
| `tests/unit/notificaciones/reparto-manana-aviso.test.ts` | R5/R15/R28/R29 |
| `tests/unit/services/reparto-manana-service.test.ts` | R6/R12/R18/R34/R37/R42 |
| `tests/unit/api/aviso-reparto-manana-route.test.ts` | R33/R35 |
| `tests/integration/db/reparto-manana-repository.test.ts` **[PG]** | R1/R3/R4 |
| `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` **[PG]** | R7/R14/R22/R23/R24 |
| `tests/integration/db/notificacion-evento-reparto-manana-migration.test.ts` **[PG]** | R38 |

### Modificados (21)

`db/schema.prisma` (+1 valor en cada enum, con su comentario) · `lib/types/notificacion.ts` (tipos
espejo) · `lib/notificaciones/catalogo-avisos.ts` (+entrada, +`tituloRepartoManana`,
`EVENTOS_AGREGADOS` pasa a **3**) · `lib/notificaciones/emitir.ts` (+`textoRepartoManana`,
+`emitirRepartoManana`, +contexto) · `lib/notificaciones/notificadores.ts` (+firma, +`*Con`,
+`*Real`, `notificadorNoOp` ampliado) · `lib/notificaciones/push-elegibles.ts` (+entrada) ·
`lib/services/VigenciaAvisoAgregadoService.ts` (+rama, +repositorio por constructor) ·
`lib/actions/notificaciones.ts` (cableado) · `lib/services/MisAsignacionesService.ts` (anotación de
tipo, **sin cambio de comportamiento**) · `vercel.json` (+1 cron) · y **13 archivos de test**, de
los que **7 son inventarios cerrados ajenos** que esta ficha amplía a mano con su motivo (§6.4 y
§8): las 5 suites de migración hermanas, `no-migration-102.test.ts` y
`notificacion-productores-wiring.test.ts`.

---

## 4. La desviación del design que hay que leer: T1.1

El design pedía que `MisAsignacionesService` **importara** `ESTADOS_REPARTO_MENSAJERO` y se lo
pasara a `findMisAsignaciones(...)`. **No se puede, y el motivo está medido, no razonado:**

`tests/unit/guards/carga-del-mensajero.guardia.test.ts` (235/262) —una guardia **vigente**, que
nació de dos agujeros reales que costaban dinero y operación— **lee el fuente del portal** y exige
que esa llamada reciba una **lista literal** cuyos elementos sean literales de texto o
identificadores declarados con un literal **en ese mismo módulo**. Su lector (`valorDe`) **revienta**
con un spread, con un índice o con un import. Pasarle la constante la habría puesto **ROJA**.

**Lo que se hizo en su lugar, y es más fuerte que lo que pedía el design:** el amarre va por las dos
vías que sí caben, y **las dos se ponen rojas solas**.

1. **En compilación** — las tres `const` del portal van anotadas con `EstadoRepartoMensajero`
   (derivado de la tupla). Quitar un valor de la tupla deja `MisAsignacionesService.ts` **sin
   compilar**.
2. **En test** — la guardia de esta ficha **extrae la lista del FUENTE del portal** (la misma
   técnica que la guardia de la 235, **no** la constante que el portal importa) y la compara
   miembro a miembro con la tupla. Un cuarto estatus en el portal ⇒ **rojo**.

Leer la constante desde el portal para compararla consigo misma habría sido la «aserción contra su
propia fuente»: siempre verde, y dejaría pasar justo el fallo que R2 existe para cazar.

El repositorio del aviso **sí** la importa, y la guardia afirma además que **no nombra ni uno de los
tres literales** — que es lo que mata la mutación obligatoria de R2.

`carga-del-mensajero.guardia.test.ts` sigue **verde sin editarla**.

---

## 5. Mapa `R<n> → test`, cruzado contra los tests REALMENTE ejecutados

⚠️ **Los `[PG]` van contra Postgres real y TODOS corrieron** (no `skipped`): el worktree tiene copia
del `.env` del árbol principal, que se **borra al terminar** y **nunca se commitea** (`.env*` está
en `.gitignore`).

| R | Test que lo cubre | Estado |
| --- | --- | --- |
| R1 | `tests/integration/db/reparto-manana-repository.test.ts` **[PG]** — «3 para mañana + 2 para hoy + 1 borrada ⇒ 3» y «el `GROUP BY` reparte por mensajero» | ✅ |
| R2 | `tests/unit/guards/estados-reparto-mensajero-unica-fuente.guardia.test.ts` | ✅ |
| R3 | `reparto-manana-repository.test.ts` **[PG]** — reloj 23:50 CR, y las dos mitades por separado | ✅ |
| R4 | `reparto-manana-repository.test.ts` **[PG]** — otro mensajero, estado fuera del universo, sin día | ✅ |
| R5 | `tests/unit/notificaciones/reparto-manana-aviso.test.ts` — 40 órdenes ⇒ `crear` **una** vez | ✅ |
| R6 | `tests/unit/services/reparto-manana-service.test.ts` — emisión dirigida **a usuario** | ✅ |
| R7 | `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` **[PG]** — dos mensajeros ⇒ **2 filas** | ✅ |
| R8 | `tests/unit/repositories/notificacion-visibilidad.test.ts` (ampliada) | ✅ |
| R9 | `tests/unit/guards/cron-hora-cr.guardia.test.ts` — **una** entrada, y una sola | ✅ |
| R10 | `cron-hora-cr.guardia.test.ts` — convierte a CR y compara con `HORA_CR` | ✅ |
| R11 | `cron-hora-cr.guardia.test.ts` — fuera de 22:00–06:00 | ✅ |
| R12 | `reparto-manana-service.test.ts` — dos corridas, la MISMA entidad | ✅ |
| R13 | `tests/unit/services/notificacion-service.test.ts` (ampliada) — emitida con 5, resolutor 3 ⇒ título dice **3** | ✅ |
| R14 | `reparto-manana-aviso-dedupe.test.ts` **[PG]** — subir el número ⇒ sigue **1** fila | ✅ |
| R15 | `reparto-manana-aviso.test.ts` — la `descripcion` sin ningún dígito de conteo | ✅ |
| R16 | `notificacion-service.test.ts` (ampliada) — resolutor que lanza ⇒ el ítem sale | ✅ |
| R17 | `tests/unit/services/vigencia-aviso-agregado.test.ts` (ampliada) — `adminTienda` ⇒ **lanza** | ✅ |
| R18 | `reparto-manana-service.test.ts` — el de cero no recibe, los demás sí | ✅ |
| R19 | `notificacion-service.test.ts` (ampliada) — cifra 0 ⇒ no sale, **sin** fila de lectura | ✅ |
| R20 | `notificacion-service.test.ts` (ampliada) — 0 ⇒ oculto, 3 ⇒ visible, `crear` no se llama | ✅ |
| R21 | `vigencia-aviso-agregado.test.ts` (la cota avanza) **+** `reparto-manana-repository.test.ts` **[PG]** (con esa cota el conteo da **0**) | ✅ |
| R22 | `reparto-manana-aviso-dedupe.test.ts` **[PG]** — dos corridas ⇒ **1** fila | ✅ |
| R23 | `reparto-manana-aviso-dedupe.test.ts` **[PG]** — dos noches ⇒ **2** filas | ✅ |
| R24 | `reparto-manana-aviso-dedupe.test.ts` **[PG]** — dos `crear` concurrentes ⇒ 1 fila, sin error | ✅ |
| R25 | `tests/unit/notificaciones/catalogo-avisos.test.ts` (ampliada) + `pnpm run typecheck` | ✅ |
| R26 | `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` **vigente, SIN TOCARLA** (su bucle recorre el catálogo entero) + caso propio en `catalogo-avisos.test.ts` | ✅ |
| R27 | `catalogo-avisos.test.ts` (ampliada) — literales a mano para `n = 1`, `7` y `40` | ✅ |
| R28 | `reparto-manana-aviso.test.ts` — literal a mano con la fecha en palabras | ✅ |
| R29 | `reparto-manana-aviso.test.ts` — sin guía, remisión, dirección, teléfono, tienda ni `₡` | ✅ |
| R30 | `pnpm run typecheck` + `push-elegibles.test.ts` + `catalogo-avisos.test.ts` | ✅ |
| R31 | `tests/unit/notificaciones/push-elegibles.test.ts` (ampliada) — `si` / `["mensajero"]`, y ningún otro rol | ✅ **el archivo SÍ existía** (T0.1-e), así que se tomó el camino 1 |
| R32 | — | lo garantiza la 410; esta ficha no toca el canal. El módulo de push es puro: no tiene con qué crear una notificación, y hay un aserto que lo dice |
| R33 | `tests/unit/api/aviso-reparto-manana-route.test.ts` — 401 sin efectos, también con el secreto ausente | ✅ |
| R34 | `reparto-manana-service.test.ts` — el 2.º lanza ⇒ 2 emisiones, 1 fallo, la corrida termina | ✅ |
| R35 | `aviso-reparto-manana-route.test.ts` — claves exactas, y un id nuevo **no cruza** | ✅ |
| R36 | `tests/unit/services/notificacion-notificadores-reales.test.ts` (ampliada) — sobre el USO EFECTIVO | ✅ |
| R37 | `reparto-manana-service.test.ts` — sin cliente transaccional, default no-op | ✅ |
| R38 | `tests/integration/db/notificacion-evento-reparto-manana-migration.test.ts` **[PG]** | ✅ |
| R39 | `notificacion-visibilidad.test.ts` — los casos vigentes **siguen verdes sin editarlos**; los nuevos se AÑADEN al final | ✅ |
| R40 | las suites de 146/246/261/271/409/412 siguen verdes (gate completo, §7) | ✅ |
| R41 | `notificacion-service.test.ts` (ampliada) — actor con el aviso ⇒ **1** llamada; sin él ⇒ **0** | ✅ |
| R42 | `reparto-manana-service.test.ts` — el 2.º bloqueado ⇒ **2** emisiones | ✅ |
| R43 | `vigencia-aviso-agregado.test.ts` (ampliada) — la cifra viva no consulta cierres | ✅ |

**43 de 43 requisitos con test.** Ninguno queda sin cubrir: R31 **sí** se pudo cubrir porque
`push-elegibles.ts` ya estaba en `dev`, y R32 es de la 410 por diseño (queda declarado, no marcado
como propio).

### `[PG]` ejecutados, no saltados

| Archivo | Casos |
| --- | ---: |
| `tests/integration/db/reparto-manana-repository.test.ts` | **10** |
| `tests/integration/db/reparto-manana-aviso-dedupe.test.ts` | **8** |
| `tests/integration/db/notificacion-evento-reparto-manana-migration.test.ts` | **27** |

**Cero `skipped` de `integration/db`.** Si el gate reportara `↓ tests/integration/db` o la línea
`! sin DATABASE_URL`, la ficha **no estaría verificada**; ver §7.

---

## 6. Contrapruebas: matar el test antes de creerlo

### 6.1 — La siembra desactivada (T3.2, obligatoria)

Se desactivó la siembra del caso R1 de `reparto-manana-repository.test.ts` y se corrió:

```
× ⭑ R1: 3 para mañana + 2 para hoy + 1 borrada para mañana ⇒ el conteo da 3
AssertionError: la siembra no llegó a la base: expected +0 to be 6
Tests  1 failed | 9 passed (10)
```

**Falla, no pasa por vacío.** Restaurado con copia byte a byte y **SHA256 verificado**:
`153d93d2d5936fec24a7abc052651ef0981dd72184a09b1288008b1f2aeebe0c` antes y después; 10/10 verde tras
restaurar.

### 6.2 — Anti-vacuidad permanente, dentro de los propios archivos

Los tres `[PG]` llevan casos que se quedan **para siempre** y demuestran que el contador distingue
sembrado de vacío: «sin sembrar nada, el conteo da CERO y el mensajero no aparece en el resumen»,
«sin emitir nada, contar da CERO», «los dos usuarios existen y son distintos», y el que comprueba
que la columna `DATE` guardó el día pedido y no otro.

### 6.3 — ⚠️ EL HALLAZGO: mi barrido dejaba basura, y puso rojas 5 suites ajenas

Durante la corrida de mutaciones, **M2 (dirigir el aviso a un ROL)** escribió una fila
`reparto_manana` con `destinatario_rol = 'mensajero'` y `destinatario_usuario_id = NULL`. Mi
barrido del caso concurrente —el único que escribe fuera de una transacción revertida— filtraba por
`destinatarioUsuarioId: mensajeroA`, **así que no la vio**. Sobrevivió en la base local compartida y
puso **ROJOS 15 casos de 5 suites de migración ajenas** con `22P02` (sus `down.sql` recrean el enum
con su lista histórica y no pueden castear un valor posterior). Un rojo con mi nombre en archivos
que no toqué.

**La 412 había dejado escrita media lección** (un barrido por `entidad_id` deja viva la fila de la
mutación «quitar el día»); ésta es **la otra mitad**. El barrido pasa a ser **por `evento`**, que es
lo único que ninguna mutación cambia, con el porqué medido escrito dentro del test. La regla, en una
línea: **un barrido que sólo limpia lo que el código SANO escribe es justo el que falla cuando hace
falta.**

La fila se borró (verificado: `quedan: 0`) y las 5 suites volvieron a verde.

### 6.4 — Los inventarios CERRADOS ajenos: se AMPLÍAN a mano (no es deuda ajena)

Cinco suites de migración hermanas llevan un inventario **cerrado** de los valores del enum **en la
base aplicada**, y su propio comentario dice que **se amplía a mano, no se relaja ni se deriva**
(«una lista que se lee a sí misma está siempre verde y no dice nada»). Lo hizo la 401 con la 403 y
la 412 con la 409; le toca a ésta:

`notificacion-evento-{bloqueo-cierre, dia-reparto-corregido, gasto-fijo, postulacion-recurso,
webhook-suscripcion}-migration.test.ts` ⇒ **+`reparto_manana`** y **+`reparto_manana_dia`**, cada uno
con su comentario. **98/98 verde** tras ampliarlos.

⚠️ **Esto NO es el rojo conocido de la 421** (etiquetas duplicadas por falta de `nspname`). Mis dos
suites nuevas filtran por `nspname = 'public'` y son inmunes de entrada; las siete hermanas que no
lo hacen quedan **como estaban**, sin tocar.

---

## 7. Mutaciones: **17 plantadas, 17 muertas**

⚠️ **Con mutación de CONTROL, y corrió la PRIMERA.** En este repo un arnés de mutaciones reportó
9/9 supervivientes **dos veces sin haber ejecutado un test**. `M0` está diseñada para morir; si
hubiera «sobrevivido», el resto del informe no valdría nada.

Cada mutación: respaldo → parche → tests → restauración **con SHA256 verificado** (el runner aborta
si no coincide). Log completo con conteos.

| # | Mutación | Qué debía romper | Resultado medido |
| --- | --- | --- | --- |
| **M0** | **CONTROL**: el título siempre en plural | R27 | **MUERTA** — `1 failed \| 17 passed (18)` |
| M1 | la cota del servicio +6 h (= el helper de columnas `timestamp`) | R3/R6 | **MUERTA** — `1 failed \| 15 passed (16)` |
| M1b | la misma cota, en la cifra viva | R13/R21 | **MUERTA** — `2 failed \| 36 passed (38)` |
| M2 | **el aviso a un ROL** en vez de a un usuario | **R7** | **MUERTA** — `7 failed \| 17 passed (24)`, incluido «dos mensajeros reciben CADA UNO el suyo» |
| M3 | **quitar el día del `entidad_id`** | **R23** | **MUERTA** — `6 failed \| 18 passed (24)` |
| M4 | el resolutor devuelve siempre `1` | R19/R21 | **MUERTA** — `3 failed \| 35 passed (38)` |
| M5 | devolver `0` para un rol que no es mensajero | **R17** | **MUERTA** — `2 failed \| 36 passed (38)` |
| M6 | **duplicar la lista de estados** en el repositorio | **R2** | **MUERTA** — `2 failed \| 4 passed (6)` |
| M7a | `0 19 * * *` (la hora CR en el cron) | **R10** | **MUERTA** — `1 failed \| 9 passed (10)` |
| M7b | `0 5 * * *` (= 23:00 CR, franja nocturna) | **R11** | **MUERTA** — `3 failed \| 7 passed (10)` |
| M8 | **persistir el número** en la `descripcion` | **R15** | **MUERTA** — `4 failed \| 20 passed (24)` |
| M9 | borrar el argumento del notificador real **dejando el import** | **R36** | **MUERTA** — `3 failed \| 43 passed (46)`, incluida la guardia derivada de «ningún `notificar*Real` sin composition root» |
| M9b | lo mismo con el repositorio del resolutor de vigencia | R13/R36 | **MUERTA** — `1 failed \| 33 passed (34)` |
| M10 | **no consultar el bloqueo** antes de emitir | **R42** | **MUERTA** — `2 failed \| 14 passed (16)` |
| M11 | meter el bloqueo **dentro** del resolutor (una consulta de más en caliente) | **R43/R41** | **MUERTA** — `7 failed \| 31 passed (38)` |
| M12 | quitar la entrada de `push-elegibles` | R30/R31 | **MUERTA por TYPECHECK** — `TS1360: does not satisfy the expected type 'Record<NotificacionEvento, PerfilPush>'` |
| M13 | quitar la entrada del catálogo de avisos | R25/R30 | **MUERTA por TYPECHECK** — `TS2741: Property 'reparto_manana' is missing … but required in type 'Record<NotificacionEvento, EntradaCatalogo>'` |

**Supervivientes: ninguno.** Las 11 mutaciones obligatorias del `design §13` están todas, más 6
propias (el control, la cota de la cifra viva, el repositorio del resolutor y los dos `Record`
exhaustivos).

### Dos apuntes honestos sobre el método

1. **M1/M1b se plantaron como `+ 6 h` inline**, que es el **equivalente exacto** de
   `inicioDelDiaCREnUtc(fechaCalendarioCR(now))`, para no tener que tocar además la línea del
   `import` (una mutación, un reemplazo). Mide lo mismo: el desplazamiento de seis horas.
2. **El test `[PG]` de R3 recibe la cota como parámetro**, así que quien mata el cambio de helper
   son los tests de servicio y de vigencia (M1 y M1b, arriba, los dos rojos). Lo que el `[PG]`
   prueba —y ningún doble puede— es la semántica del `>` contra una columna `@db.Date` real con el
   reloj a las 23:50 CR, y que a las 00:01 CR el conteo cae a 0. **Las dos piezas juntas cubren R3;
   ninguna sola bastaba.** Queda dicho en vez de tapado.

---

## 8. Gate COMPLETO

`./init.sh` (no `--rapido`, que **se niega solo** con este diff), con `INIT_EXIT` escrito **dentro**
del log y sin canalizar por `tail`.

### Corrida 1 — **ROJA**, y lo que destapó

```
Test Files  2 failed | 1939 passed (1941)
     Tests  3 failed | 28161 passed | 26 skipped (28190)
ROJOS NUEVOS (2 archivo(s) que no estan en el baseline)
INIT_EXIT=1
```

⚠️ **El comando que envolvió al gate reportó «exit code 0».** El veredicto real —`INIT_EXIT=1`—
sólo existe porque se escribió **dentro** del log. Es la tercera vez en este repo.

Los tres rojos eran **míos**, y los tres del mismo tipo: **inventarios CERRADOS que cada ficha
amplía a mano**, exactamente como los de §6.4. No son deuda ajena ni el rojo conocido de la 421:

| Archivo | Qué pedía |
| --- | --- |
| `tests/integration/db/no-migration-102.test.ts` | declarar mi carpeta de migración en `MIGRACIONES_NOTIFICACIONES_POSTERIORES`, **con su motivo** |
| `tests/unit/services/notificacion-productores-wiring.test.ts` (×2) | `reparto_manana` y `reparto_manana_dia` en los dos inventarios literales, con su productor y su entidad explicados |

Ampliados a mano, con su comentario. **No se relajó ninguno**, no se derivó ninguno del enum (una
lista que se lee a sí misma está siempre verde) y **no se tocó `tests/baseline-rojos.json`**.

### Corrida 2 — **VERDE**

```
Test Files  1941 passed (1941)
     Tests  28164 passed | 26 skipped (28190)
== init OK ==
INIT_EXIT=0
```

**Los 26 `skipped` son los de siempre y ni uno más**, verificado uno por uno:

```
✓ tests/components/AnaliticaPage.test.tsx  (64 tests | 17 skipped)
✓ tests/components/AnaliticaShell.test.tsx (15 tests |  9 skipped)
```

**Y la capa de datos SÍ se probó:**

| Medida | Valor |
| --- | ---: |
| archivos de `tests/integration/db/` **ejecutados** | **255** |
| archivos de `tests/integration/db/` **saltados** (`↓`) | **0** |
| línea `! sin DATABASE_URL: … NO se van a ejecutar` | **ausente** |

(El único `grep` de «sin DATABASE_URL» del log es el **nombre** de un caso de
`modulo-puro.guardia.test.ts`, no la advertencia del arnés.)

Mis tres `[PG]`, ejecutados en el gate:

```
✓ tests/integration/db/reparto-manana-repository.test.ts             (10 tests)
✓ tests/integration/db/reparto-manana-aviso-dedupe.test.ts           ( 8 tests)
✓ tests/integration/db/notificacion-evento-reparto-manana-migration.test.ts (27 tests)
```

`pnpm run typecheck`: **limpio, 0 errores**.
`pnpm run lint`: **0 errores**, 184 warnings — todos preexistentes (`no-unused-vars` con prefijo
`_` en suites ajenas), **ninguno en un archivo de esta ficha**.

---

## 9. Casillas de `tasks.md`: lo que NO se pudo hacer, y por qué

- **T7.2 (puerta de despliegue: mirar la campana en los dos temas) — CASILLA VACÍA, A PROPÓSITO.**
  En este entorno **no hay navegador**: no puedo levantar la app, autenticarme como mensajero ni
  mirar el panel, y jsdom no mide desbordes ni contraste. Marcarla sin haberlo visto convertiría una
  declaración honesta en una mentira. **Queda como puerta de despliegue pendiente para el humano**,
  con lo que hay que mirar: título con la cifra («Tenés 5 órdenes para mañana»), la línea de
  contexto con la fecha, y el botón «Ver mi reparto» llevando a `/mis-asignaciones`.
- **T0.3 (`EXPLAIN` en producción) — HECHA CONTRA LA BASE LOCAL**, no contra producción, por falta
  de credencial en este entorno. Los dos planes están en §2 con esa limitación escrita y con el
  matiz de la 411. No bloquea: su resultado sólo decidía si hacía falta una ficha de índice, y no
  hace falta.

---

## 10. Veredicto

**La 413 está implementada, medida y verificada: gate COMPLETO en verde (`INIT_EXIT=0`, 28.164
tests, 26 `skipped` y CERO de `integration/db`), los 43 requisitos con test, 17 mutaciones plantadas
y 17 muertas —con la de CONTROL muriendo la primera, que es la única prueba de que el arnés ejecutó
algo—, y una sola casilla vacía a propósito: T7.2, la puerta de despliegue, porque en este entorno
no hay navegador.**
