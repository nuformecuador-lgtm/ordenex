# Review — Feature 227 (hilo de notas por orden entre tienda y mensajero)

Reviewer independiente. Worktree `C:/w227`, rama `feature/227-hilo-notas-orden`, base `origin/dev @ a145cab8`.
Fecha: 2026-08-15.

## VEREDICTO: **RECHAZADO**

Un solo bloqueante, y no es de diseno ni de trazabilidad: **el gate completo esta ROJO y el archivo
que lo pone rojo es un test de esta misma feature**. Todo lo demas que revise esta bien: los 37
requisitos tienen test y los 37 verifican lo que dicen verificar (los abri uno a uno), las cinco
invariantes se conservan, la ventana asimetrica esta implementada correctamente y las siete
mutaciones que escribi murieron todas.

---

## Checklist

### Especificacion
- [x] `specs/227-hilo-notas-orden/requirements.md` — 37 requisitos EARS (R1-R36 + R38). R37 retirado, numero no reutilizado.
- [x] `design.md` — nueve alternativas descartadas con motivo (A1-A9).
- [x] `tasks.md` — 30 tasks, todas marcadas. **Pero T5.3 (init.sh completo … Hecho: verde) esta marcada en falso** (ver B1).

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto: **37/37 VERIFICADOS POR MI** abriendo el test y comprobando que mide ESE requisito. Detalle abajo.
- [x] `progress/impl_227.md` contiene el mapa `R<n> -> test`.

### Calidad de codigo
- [x] `pnpm run typecheck` — verde (medido por mi en el gate completo).
- [x] `pnpm run lint` — verde (65 warnings, **0 errors**).
- [ ] **`pnpm test` — ROJO.** 1 archivo fallido de 1105: `tests/integration/db/orden-nota-migration.test.ts`. **B1.**
- [n/a] E2E: la feature no toca auth, pagos, recaudo, ingesta ni webhooks (clausula condicional de CHECKPOINTS).

### Datos y seguridad
- [x] RLS habilitada en `orden_nota`, **sin policies**, verificado leyendo `pg_class.relrowsecurity` y `pg_policies` contra Postgres real.
- [x] Migraciones versionadas y reversibles: M1 y M2 tienen `down.sql`; los dos se ejecutan de verdad en los tests.
- [x] Sin secretos hardcodeados.
- [n/a] Webhooks: no hay.

### Patron de capas
- [x] Server Action = borde (actor + zod + `withErrorHandler`), sin queries.
- [x] `OrdenNotaService` sin Prisma, sin `next/headers`, construible con dobles.
- [x] `OrdenNotaRepository` solo Prisma, cero permisos, cero proyeccion.
- [x] Interfaces en `lib/interfaces/{services,repositories}/`.

### Permisos
- [x] Autorizacion en el service (unica capa: la tabla no tiene policies debajo).
- [x] Mutaciones por Server Action, no por `app/api/` (A5 descartada con motivo).

### Multi-pais
- [x] Sin hardcode nuevo de pais/moneda/cuenta. `America/Costa_Rica` en el formateador es el patron ya establecido del repo (7 archivos previos), no deuda de esta feature.

### Verificacion final
- [ ] **`./init.sh` NO termina en verde** (EXIT 1).
- [x] `progress/review_227.md` existe (este archivo).
- [ ] Falta la entrada en `progress/history.md` (cierre del leader).

---

## HALLAZGOS

### B1 — BLOQUEANTE. El gate completo esta rojo por un test de la propia 227: deadlock de Postgres entre los tres tests de DB nuevos

`./init.sh` (redirigido a fichero, exit leido aparte) termina en **EXIT 1**:

    Test Files  1 failed | 1104 passed (1105)
         Tests  14136 passed | 13 skipped (14149)
      Duration  455.50s
    x 'pnpm run test' fallo

**No es una corrida degradada** (1105 archivos, sin "unhandled errors" de workers; el conteo es
coherente con los 1104 que reporto el implementer). Y **no son los dos flakes conocidos**:
`TableroOperativo` y `wallet-tiendas-desglose` pasaron en esta corrida. El unico rojo es:

    FAIL tests/integration/db/orden-nota-migration.test.ts > 227 / M1 - el DDL REAL contra Postgres (R26, R28, R30)
    PrismaClientKnownRequestError: Raw query failed. Code: 40P01. Message: se ha detectado un deadlock
      en medir tests/integration/db/orden-nota-migration.test.ts:188
      en enTransaccionRevertida tests/integration/db/_postgres-real.ts:132

**Reproducido y acotado.** Los tres archivos de DB que la feature anade escriben en
`public."usuario"` y `public."orden"` dentro de transacciones largas y concurrentes; los locks de FK
sobre los catalogos se toman en distinto orden y Postgres mata una de las transacciones:

| Corrida | Resultado |
| --- | --- |
| cada archivo en AISLADO (M1, M2) | verde 3/3 |
| pareja M1 + M2 | verde 3/3 |
| **trio M1 + M2 + `orden-nota.int.test.ts`** | **rojo 2 de 3 corridas** (40P01) |
| lote de 13 archivos de la feature | rojo 2 de 3 corridas |
| **`./init.sh` completo** | **ROJO** |

Los tres participantes son NUEVOS de esta feature: `tests/integration/db/orden-nota-migration.test.ts`,
`tests/integration/db/orden-mensajero-meta-drop-nota-migration.test.ts` y
`tests/integration/repositories/orden-nota.int.test.ts`. En `dev` no existian, asi que el rojo es
atribuible a la 227.

**Por que es bloqueante y no "un flake mas".** Dos motivos, y el segundo es el peor:

1. CHECKPOINTS exige `pnpm test` verde y `./init.sh` verde. Hoy no lo estan.
2. Cuando el deadlock salta, el `beforeAll` revienta y vitest marca **13 tests como skipped**, no
   como fallidos. Esos 13 son precisamente los que verifican **R26** (RLS y cero policies), **R28**
   (el indice compuesto) y **R30** (el CASCADE ejercitado). Es decir: la mitad de las veces la
   evidencia de tres requisitos **no se ejecuta**, y el archivo lo reporta como skipped. Ese es el
   patron que este repo ya conoce (suite que omite y parece casi verde) instalado dentro de la
   propia feature.

**Que falta para cumplirlo.** Serializar el acceso de estos tres archivos a las tablas reales de
`public` — un lock de aviso (`pg_advisory_xact_lock`) tomado al principio de cada `medir`, o
`fileParallelism` desactivado para ellos, o crear las filas de apoyo en el esquema temporal en vez
de en `public`. Vuelve al implementer; NO lo arreglo yo. La correccion tiene que quedar demostrada
con el trio corriendo junto **al menos 5 veces seguidas en verde**, no una.

### m1 — menor. `tasks.md` T5.3 afirma un gate verde que no lo esta

"T5.3 — init.sh COMPLETO antes del PR. Hecho: verde". No lo es. La bitacora es mas honesta
(dice "2 rojos, flakes ajenos"), pero ese diagnostico tambien resulto incompleto: los dos flakes
citados pasaron en mi corrida y aparecio el rojo propio. Se corrige junto con B1.

### m2 — menor. `tasks.md` T4.8 afirma que `MarcarLuegoToggle.test.tsx` pasa "sin modificarlo"

Si esta modificado (-6 lineas): se retiro el `vi.mock("@/lib/actions/notas-privadas-mensajero")`,
obligatorio porque el modulo se borro. **El cambio es correcto y no altera comportamiento**
(verificado leyendo el diff completo). Lo que esta mal es la afirmacion. El otro archivo citado,
`tests/integration/repositories/orden-mensajero-meta.int.test.ts`, si esta intacto (`git diff` vacio).

### m3 — menor, heredado y ACEPTADO. R23: el conteo de PRODUCCION del drop sigue PENDIENTE

R23 pide "citando el conteo de filas afectadas medido contra produccion". La cabecera de M2 cita el
conteo LOCAL (0, tabla enteramente vacia), **declara en mayusculas que ese cero no informa sobre
produccion** y deja el conteo real como **PENDIENTE**, a medir por quien tenga credencial antes de
aplicar alli. **No hay ninguna cifra inventada** — que es lo correcto bajo la regla 6 del arnes. Lo
dejo como precondicion de despliegue, no como defecto de codigo: **M2 no se aplica a produccion
hasta que ese conteo este corrido y pegado en la bitacora**.

### m4 — menor. Ninguna task esta commiteada

`git log` de la rama = el commit base. Los 72 modificados + 26 nuevos estan sin commitear.
`docs/conventions.md` pide "un commit por task logica completada". Es el modo de trabajo conocido de
este repo (el leader commitea), pero queda dicho.

### m5 — menor. Falta la entrada en `progress/history.md`

CHECKPOINTS lo exige para pasar a `done`. Es tarea de cierre del leader.

---

## LAS CINCO CONTRADICCIONES DECLARADAS POR EL IMPLEMENTER — MI JUICIO

**1. `borrarNotaSchema` = {ordenId, notaId} en vez del {notaId} de design 3 -> ACEPTADA. Es mas restrictivo, no menos.**
Verificado contra el codigo: `IOrdenNotaRepository` no tiene ningun metodo que resuelva la orden de
una nota, y `OrdenNotaService.borrar` sigue la misma secuencia que `publicar` (cargar orden ->
pertenencia -> ventana). Con solo `notaId` esos pasos serian inejecutables y **R35 y R10/R11 quedarian
sin aplicar en borrar** — la afirmacion del implementer es cierta. El `ordenId` no relaja nada: el
`autorId` sigue saliendo de la sesion y el where del `updateMany` es
`{ id, ordenId, autorId, deletedAt: null }`, estrictamente mas estrecho que el `{ id, autorId,
deletedAt: null }` del design. Ademas cierra un agujero real que el design tenia: sin `ordenId`, un
autor dentro de su ventana en la orden A podia borrar su nota de la orden B con la ventana cerrada.
Cubierto por el test de integracion "el mismo id desde OTRA orden tampoco" (borradasDeOtraOrden = 0).
**Actualizar design 3 al cerrar.**

**2. R28 "una sola consulta" -> ACEPTADA en sustancia; la clausula Testeable queda relajada. No bloqueante.**
El texto normativo de R28 es "leer el hilo completo con UNA sola consulta … NO DEBE emitir una
consulta por nota". Eso se cumple exactamente: `listarPorOrden` se llama **1 vez** para un hilo de 3
notas. Lo que no se cumple es la clausula Testeable literal ("la lectura produce exactamente una
llamada"), porque el paso 2 del design (`findOrdenParaHilo`) es la autorizacion y es obligatorio. El
test afirma algo mas fuerte que la clausula: total = 2 y **no crece con el tamano del hilo**, que es
la propiedad que R28 protege (N+1). Juzgo que el requisito esta cumplido; lo que sobra es la
clausula. **Reescribir la Testeable de R28 al cerrar, para que no quede como deuda tacita.**

**3. Constantes de la ventana vigiladas y no unificadas -> SUFICIENTE, con condicion.**
Es cierto que `lib/types/ventana-hilo-notas.ts` reescribe "devuelta" y "en_reparto" en vez de
promover los const privados que pedia design 2.2. Pero la guardia T3.6 **no compara literales
escritos a mano**: importa `VENTANA_ESCRITURA` como valor y extrae los cortes de pantalla
ESTRUCTURALMENTE del fuente de `OrdenRepository.novedadWhere` y
`MisAsignacionesService.listarMisAsignaciones` (empareja parentesis/llaves, resuelve el identificador
a su literal, y **revienta** si el patron deja de casar en vez de dar verde). Lo verifique leyendo la
guardia y con mi mutacion A: mover la ventana la pone roja. **La divergencia no puede pasar callada,
que es lo que el design queria evitar.** Es cierre por vigilancia y no por construccion — mas debil,
pero no un agujero. Condicion: dejarlo ESCRITO en design 2.2 (se opto por vigilar, no por unificar),
para que la proxima lectura del design no lo lea como incumplimiento.

**4. Los dos tests fantasma -> la correccion NO ablando la trazabilidad, la ENDURECIO.**
El spec citaba `tests/components/PosOrderCard*.test.tsx` (R21) y `tests/components/AsignacionDetalle`
"(existente)" (R25); ninguno de los dos existia. Los archivos creados son reales y muerden:
`AsignacionDetalle.test.tsx` no busca texto suelto, exige que "Notas" sea un `<dt>` y que su
`nextElementSibling` sea el `<dd>` con el contenido. Las celdas de `tasks.md` ahora nombran los
archivos REALES y los marcan como NUEVOS. Correcto: el spec mentia y se corrigio hacia arriba.

**5. SWR en vez de useEffect -> SI lo admitia el design.**
design 5 dice literalmente "refresca desde el servidor (router.refresh() **o re-invocacion de la
accion de lectura**)". `mutate()` de SWR es exactamente re-invocar la accion de lectura. Ademas hay
precedente en el repo (el hilo de chat) y el motivo del cambio es duro (el useEffect disparaba un
error de react-hooks). Verificado que la clave lleva el `ordenId` y que no hay `refreshInterval`.

---

## LAS CINCO INVARIANTES — COMPROBADAS UNA A UNA

1. **`listarMisAsignaciones` sigue leyendo EXACTAMENTE por_recoger y en_reparto.** Guardia T3.6,
   censo CERRADO en las dos direcciones (toEqual(["en_reparto","por_recoger"]) + toHaveLength(2)),
   extraido del fuente. Verde.
2. **`orden.notas` intacta.** `git diff db/schema.prisma` no la toca. El service ni la lee: el test
   R25 comprueba que la proyeccion de `findOrdenParaHilo` tiene EXACTAMENTE
   [deletedAt, estatusValue, mensajeroAsignadoId, tiendaId] y que el contrato del repo no tiene
   ninguna via de escritura sobre `orden`. Mas `AsignacionDetalle.test.tsx` para la mitad de UI.
3. **`marcar_luego` y el @@unique([usuarioId, ordenId]) intactos.** No aparecen en el diff del
   schema. La guardia de retirada lo afirma sobre el modelo Prisma, y el test de M2 lo mide **contra
   Postgres en los tres momentos** (antes del up, tras el up, tras el down): el UNIQUE sigue
   rechazando duplicados y `marcar_luego` conserva su valor por fila.
4. **Cero notificacion y cero indicador.** Lei el diff de las tres pos-card: solo se QUITAN el badge
   "Mi nota" y el preview; no se anade ninguno. Cero referencias a `lib/notificaciones` en la
   feature. Lo unico nuevo en superficie es el boton "Notas" en la fila de acciones de /novedades.
5. **Las notas privadas de la 116 se borran, no se exponen.** M2 es UNA sentencia
   (DROP COLUMN "nota"), sin SELECT/INSERT previo; M1 no nombra `orden_mensajero_meta`. Dos
   guardias lo afirman sobre el SQL EJECUTABLE (sin comentarios), no sobre la prosa.

---

## LAS MIGRACIONES: EJECUTADAS DE VERDAD, NO POR REGEX

Comprobado leyendo los dos tests: ambos leen el `migration.sql` y el `down.sql` **reales**, los
parten por punto y coma, y los ejecutan **sentencia a sentencia** con `$executeRawUnsafe` en un
esquema temporal (CREATE SCHEMA t227_<uuid>) dentro de `enTransaccionRevertida` (patron
`tests/integration/db/_postgres-real.ts`), con `public` en el search_path para que las FK apunten a
las tablas reales. Despues leen `information_schema.columns`, `pg_constraint.confdeltype`,
`pg_indexes`, `pg_class.relrowsecurity` y `pg_policies`, insertan filas propias, ejercitan el
CASCADE y el RESTRICT de verdad, y corren el `down.sql` real. **No es el defecto que hizo rechazar
la feature 212.** Lo confirme ademas por mutacion (D y D2, abajo): el bloque de motor se pone rojo
cuando se toca el SQL.

El conteo del drop: LOCAL = 0 (tabla vacia), y la cabecera declara el de produccion como
**PENDIENTE**, sin cifra inventada. Correcto (ver m3).

---

## MIS MUTACIONES — 7 escritas, 7 MUERTAS

Todas distintas de las 8 del implementer. Cada archivo se restauro desde copia previa y se verifico
con `cmp` byte a byte; `git status` volvio a 72 archivos.

| # | Mutacion | Archivo | Resultado |
| --- | --- | --- | --- |
| A | **Ventana INVERTIDA entre roles** (adminTienda: en_reparto, mensajero: devuelta) | `lib/types/ventana-hilo-notas.ts` | **10 ROJOS**: la matriz rol x estatus de R14, el puedeEscribir por rol, R35 y la guardia de R38 |
| B | **borrar ignora al autor**: fuera `autorId` del where del updateMany | `OrdenNotaRepository.ts` | **2 ROJOS** en el test de integracion contra Postgres real (R31 y R32). El doble semantico del unit test no lo veria — lo caza la capa correcta |
| C | **La lectura aplica la ventana de escritura** (listar devuelve forbidden fuera de ventana) | `OrdenNotaService.ts` | **4 ROJOS**, entre ellos «devuelve el hilo completo con la orden ya fuera de devuelta» (R15) |
| D | **down.sql de M2 deja de reponer la columna** (ADD COLUMN -> SELECT 1) | M2 `down.sql` | **ROJO** por dos tests de texto; ademas el bloque de motor aborta |
| D2 | **down.sql repone la columna NOT NULL con default vacio** (drop no reversible a la estructura original) | M2 `down.sql` | **3 ROJOS**, incluido «el up retira la columna y el down la repone nullable» (R23), **ejecutado contra Postgres**: confirma que el bloque de motor corre |
| E | **Fuga del cuerpo borrado**: `proyectarNota` devuelve `fila.cuerpo` siempre | `OrdenNotaService.ts` | **3 ROJOS** (R34 y R31) |
| F | **Borrado no idempotente**: fuera `deletedAt: null` del where | `OrdenNotaRepository.ts` | **2 ROJOS** (R31 en integracion + la guardia R2) |
| G | **Boton de eliminar en notas AJENAS y en modo solo lectura** | `HiloNotasOrden.tsx` | **1 ROJO** (R19) |

Reversion verificada archivo por archivo:

    IDENTICO: lib/types/ventana-hilo-notas.ts
    IDENTICO: lib/services/OrdenNotaService.ts
    IDENTICO: lib/repositories/OrdenNotaRepository.ts
    IDENTICO: db/migrations/20260815140000_orden_mensajero_meta_drop_nota/down.sql
    IDENTICO: components/shared/HiloNotasOrden.tsx
    IDENTICO: lib/types/orden-nota.ts
    git status --short | wc -l  ->  72   (igual que al empezar)

---

## TRAZABILIDAD R -> test — 37/37 VERIFICADOS POR MI

No me fie de `tasks.md`: abri cada test y comprobe que mide ESE requisito. Ninguno cae en el defecto
de la feature 215 (un test que mide otra capa).

| R | Verificado en | Que comprobe yo |
| --- | --- | --- |
| R1 | service | doble SEMANTICO (no mockResolvedValue): tras publicar hay N+1 y las N previas conservan cuerpo/autor/instante. No afirma lo que el mock decidio |
| R2 | guardia frontera | censo CERRADO de operaciones de interfaz Y clase (nivel de llaves, no indentacion) + ningun update/updateMany/upsert toca `cuerpo` + contraprueba del detector |
| R3 | integracion Postgres | dos notas con created_at IDENTICO; desempate por id; dos lecturas dan la misma secuencia; y NO es el orden de insercion |
| R4 | service | rol congelado leido por la CONTRAPARTE, para que la lectura no dependa del rol nuevo del autor |
| R5 | service | input contaminado con autorId y rolAutor ajenos; el crear recibe los de la sesion |
| R6 | actions | tres cuerpos en blanco distintos sobre el SERVICE REAL; cero filas |
| R7 | actions | 200 acepta, 201 rechaza, y el tope se mide sobre el texto CRUDO (199 letras mas 2 espacios = rechazado) |
| R8 | actions | resultado de dominio, crear no llamado, cero filas huerfanas |
| R9 | service | pertenencia por actor.usuarioId; el repo solo recibe ordenId |
| R10 | service | toEqual entre ajena e inexistente (mismo objeto) mas orden borrada logicamente igual; el hilo ajeno ni se lee |
| R11 | service | asignado ok / otro mensajero rechazado / sin mensajero rechazado, **tambien en lectura** |
| R12 | service | maestro, admin y adminSatelite en las TRES operaciones; findOrdenParaHilo ni se llega a llamar |
| R13 | actions | los tres dobles del service sin ninguna llamada |
| R14 | service | matriz de 10 casos (2 roles x 5 estatus) con conteo de filas en cada rechazo, mas por_recoger que no abre ventana, mas puedeEscribir por rol. **Mi mutacion A** |
| R15 | service | hilo completo en en_reparto, entregada y rechazada. **Mi mutacion C** |
| R16 | UI | autor mas elemento time con el ISO exacto, mas data-propia, mas clases distintas, mas la etiqueta de nota propia |
| R17 | UI | onRefrescar 1 vez tras publicar y 2 tras borrar; borrador vaciado sin inyectar la nota a mano |
| R18 | UI | tres rechazos tipados: motivo en el alert, sin refresco, borrador conservado, hilo sin cambios |
| R19 | UI | con y sin puedeEscribir, y con el hilo vacio. **Mi mutacion G** |
| R20 | guardia retirada | 10 archivos inexistentes mas 13 simbolos ausentes en todo el arbol, con lista CERRADA de excepciones que caduca |
| R21 | service mas 3 cards | la clave notaPrivada no esta en el DTO, y las tres vistas sin indicador. Ademas verifique en el git diff que **no se anadio ningun badge nuevo** |
| R22 | guardia mas test M2 | sobre el SQL EJECUTABLE (comentarios fuera), ni el up ni el down leen o copian |
| R23 | test M2 (Postgres real) | el up quita, el down repone NULLABLE, el resto de columnas quieto. **Mis mutaciones D y D2** |
| R24 | test M2 mas int 115 | el UNIQUE rechazando duplicados y marcar_luego por fila en los TRES momentos; orden-mensajero-meta.int.test.ts con git diff vacio |
| R25 | service mas UI | proyeccion minima sin el campo notas, contrato del repo sin ninguna escritura sobre orden, y la pareja etiqueta/valor en el detalle |
| R26 | test M1 (Postgres real) | relrowsecurity true y pg_policies en cero |
| R27 | actions | tres entradas mal formadas, errores por campo, sin stack traces, service sin llamar |
| R28 | service mas test M1 | 1 llamada a listarPorOrden para 3 notas, total 2 y constante, mas el indice (orden_id, created_at) **en ese orden** leido de pg_indexes |
| R29 | guardia frontera | console a secas prohibido, catch vacio, y PII interpolada en textos de rechazo, con contraprueba |
| R30 | test M1 (Postgres real) | 2 notas antes / 0 despues / 0 huerfanas, mas el confdeltype de CASCADE leido de pg_constraint |
| R31 | service mas integracion | la fila SIGUE en la base con autor, cuerpo e instante; el resto del hilo en su sitio |
| R32 | service mas integracion | contraparte y maestro rechazados, mas **UN solo UPDATE y NINGUN SELECT previo** sobre orden_nota, medido sobre el SQL emitido. **Mi mutacion B** |
| R33 | service | inexistente / ajena / de otra orden / ya borrada devuelven el MISMO objeto. **Mi mutacion F** |
| R34 | service mas UI | el serializado de la nota no contiene el texto borrado, y el hueco se pinta en su posicion con autor y hora. **Mi mutacion E** |
| R35 | service | tienda en en_reparto, mensajero en devuelta, y estatus terminal; mas la CONTRAPRUEBA dentro de la ventana (sin ella el test pasaria con un service que rechazara siempre) |
| R36 | guardia T3.6 | censo cerrado extraido del fuente de MisAsignacionesService |
| R38 | guardia T3.6 | cruce ventana x pantalla, con no-vacuidad contra ORDER_STATUS_SEED y contraprueba sobre un fuente mutado. **Mi mutacion A** |

R37 no existe: se retiro a la ficha 228 y su numero no se reutiliza. Verificado que ninguna
referencia lo reusa.

---

## Codigo muerto de la 116

Barrido propio sobre `lib/`, `app/`, `components/`, `scripts/`, `db/` y `tests/`: **cero codigo
vivo**. Los 6 hits en produccion son comentarios historicos que explican que la columna y el campo
se retiraron; los 2 en tests son la guardia (que nombra por definicion los simbolos prohibidos) y el
test de ausencia de R21, declarado como excepcion CERRADA y con caducidad. Sin imports huerfanos (el
icono StickyNote salio de las tres cards). **Cero anotaciones @sin-superficie nuevas**: la guardia de
superficie se cerro con los montajes reales, no con una marca de excepcion.

---

## Que falta para que esto sea APROBADO

1. **Arreglar B1**: eliminar el deadlock entre los tres tests de DB nuevos. Demostrarlo con el trio
   corriendo junto **5 veces seguidas en verde** y con `./init.sh` completo en EXIT 0 (redirigido a
   fichero, exit leido aparte), comparando el total de archivos.
2. Corregir **m1** y **m2** en `tasks.md`.
3. Anotar en `design.md` las tres desviaciones aceptadas: seccion 3 (borrarNotaSchema), la clausula
   Testeable de R28, y seccion 2.2 (constantes vigiladas, no unificadas).
4. Cierre del leader: entrada en `progress/history.md` y el conteo de produccion de M2 (**m3**) antes
   de aplicar la migracion alli.

Nada de esto toca la logica de la feature: la 227 esta bien construida. Lo que falla es su propio
banco de pruebas.

---
---

# SEGUNDA PASADA (2026-08-16) — VEREDICTO: **APROBADO**

Reviso SOLO el delta. La trazabilidad de los 37 requisitos y mis 7 mutaciones de la primera pasada
siguen en pie: nada de eso se toco (los tres archivos de test nuevos conservan sus 16 + 13 + 5 = 34
`it()`, exactamente los mismos que conte en la primera pasada).

## B1 — CERRADO

El remedio esta en `tests/integration/db/_postgres-real.ts` (+37 lineas): `serializarEscriturasReales(tx)`,
un `pg_advisory_xact_lock` con clave fija. Comprobado punto por punto lo que se me pidio:

- **(a) El lock es la PRIMERA sentencia de la transaccion en los TRES archivos.** Verificado leyendo
  el cuerpo de cada `medir(tx)`: `orden-nota-migration.test.ts:191`,
  `orden-mensajero-meta-drop-nota-migration.test.ts:218` y `orden-nota.int.test.ts:90`. En los tres,
  la linea siguiente es la primera que toca algo (`CREATE SCHEMA` / `new OrdenNotaRepository`). No
  hay ni una sentencia antes. No es cosmetico.
- **(b) Ningun test dejo de ejecutarse.** Cero `.skip`, `.todo`, `.only`, `concurrent` o
  `sequential` nuevos; `vitest.config` sin tocar; `fileParallelism` intacto. Lo unico que hay es el
  `describeSiHayBase` (guarda de `DATABASE_URL`) que ya existia y que ya revise en la primera pasada.
  El unico archivo de test TRACKED modificado en esta pasada es `_postgres-real.ts`.
- **(c) La fidelidad de lo medido no cambia.** `public` sigue en el `search_path`, las dos FK siguen
  apuntando a `usuario`/`orden` REALES y el DDL ejecutado sigue siendo el `migration.sql` /
  `down.sql` REAL, sentencia a sentencia. El lock de aviso no bloquea ninguna tabla: no altera lo
  que el motor responde.
- **(d) El conteo del trio es 34, ni uno menos** — el mismo de antes del arreglo. El verde no se
  compro quitando evidencia.

Medido por mi, no heredado:

    trio, 5 corridas seguidas:  EXIT 0 x5 | Tests 34 passed (34) x5 | 40P01 = 0 | skipped = 0
    ./init.sh completo:         EXIT 0 (leido con $? aparte)
                                Test Files 1105 passed (1105) | Tests 14149 passed (14149)
                                0 skipped | 0 lineas FAIL | == init OK ==

1105 archivos = el mismo total que medi en la primera pasada, asi que no es corrida degradada.

## MI MUTACION SOBRE EL PROPIO REMEDIO — MUERTA

Quite `serializarEscriturasReales(tx)` de `tests/integration/repositories/orden-nota.int.test.ts`
(dejando el simbolo referenciado con un `void` para no cambiar nada mas) y corri el trio 5 veces:

| Corrida | Resultado |
| --- | --- |
| 1 | EXIT 0 — 34 passed |
| 2 | EXIT 0 — 34 passed |
| **3** | **EXIT 1** — 29 passed, **5 skipped**: `DriverAdapterError: se ha detectado un deadlock` en `orden-nota.int.test.ts` |
| 4 | EXIT 0 — 34 passed |
| **5** | **EXIT 1** — 21 passed, **13 skipped**: `Raw query failed. Code: 40P01` en `orden-nota-migration.test.ts` |

**2 de 5 rojos, con el mismo deadlock y el mismo sintoma de tests omitidos.** Es la prueba de que el
lock es lo que arregla esto y no una casualidad de scheduling: basta con que UNO de los tres no lo
tome para que el ciclo vuelva. Revertido y verificado con `cmp`: `IDENTICO`. El trio vuelve a
`3 passed / 34 passed`.

El razonamiento del comentario tambien lo comparto: reintentar un `40P01` habria dejado el ciclo
vivo y el sintoma escondido; serializar la seccion critica lo elimina.

## m1, m2, m5 — dicen la verdad

- **m1 (T5.3).** Corregida y honesta sin coartadas: escribe que la casilla **estuvo marcada EN
  FALSO**, que `./init.sh` terminaba en EXIT 1, y que el diagnostico de «flakes ajenos» era
  **incompleto** porque en mi corrida esos dos pasaron y afloro un rojo propio. La evidencia que cita
  (1105/14149, 0 skipped) coincide con la que acabo de medir yo.
- **m2 (T4.8).** Corregida: reconoce que `MarcarLuegoToggle.test.tsx` SI esta modificado (−6 lineas)
  y que la afirmacion original era falsa; distingue bien andamiaje (`vi.mock` de un modulo borrado)
  de comportamiento (ninguna asercion del toggle se toco). Es exactamente lo que yo medi en el diff.
- **m5 (`history.md`).** Leida con los mismos ojos que el resto: **no afirma nada que no sea cierto.**
  Verifique una a una las afirmaciones comprobables —37 requisitos, R37 retirado a la 228, la ventana
  asimetrica y su motivo, el corte de la 167 sin tocar, los 13 tests que quedaban en `skipped`, el
  lock como primera sentencia, el descarte deliberado del reintento, la desviacion de
  `borrarNotaSchema`, las constantes cerradas por vigilancia y no por unificacion, y la ausencia
  deliberada de notificacion e indicador— y todas se sostienen. La deuda de despliegue (m3) esta
  escrita sin suavizar: **M2 no se aplica a produccion sin el `count` medido y pegado.**

## Hallazgos nuevos

Ninguno. **No hay bloqueantes.**

Queda abierto a proposito, y ya estaba acordado: **m3** (conteo de produccion del drop, deuda de
despliegue anotada en `history.md` y en la cabecera de M2) y **m4** (la rama sigue sin commit, lo
cierra el leader).
