# review_208 — Pago multiple por entrega (modelo y calculo del recaudo)

> Reviewer, 2026-08-12. Rama `feature/208-pago-multiple-entrega`, trabajo SIN COMMITEAR en el
> checkout principal, compartido con otra sesion. No se corrio `git checkout` / `stash` / `reset`.
> No se aplico ni se revirtio ninguna migracion contra la base local.

## Veredicto ronda 1: **RECHAZADO** — ronda 2 (abajo): **APROBADO**

Un (1) bloqueante. Todo lo demas esta bien y verificado de primera mano: el gate completo esta
verde y no degradado, el mapa `R -> test` cubre los 33 requisitos con tests reales, y la
aritmetica money-critical de `computeTotales` resiste mutacion, incluida una mutacion sutil que
el implementer NO habia probado.

---

## 1. Checklist de CHECKPOINTS.md

### Especificacion
- [x] `specs/208-pago-multiple-entrega/requirements.md` con R1..R33 en EARS.
- [x] `design.md` con cuatro alternativas descartadas y su porque (parrafo 5, A/B/C/D).
- [x] `tasks.md`: T1..T17 marcadas `[x]`. T18 (bookkeeping) sin marcar, es del leader por
      instruccion explicita.

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto. **Los 33.**
- [x] `progress/impl_208.md` contiene el mapa `R -> test`, por bloques A/B/C/D.

### Calidad de codigo
- [x] `pnpm run typecheck` verde.
- [x] `pnpm run lint` verde (0 errors, 60 warnings preexistentes y ajenas).
- [x] `pnpm test` verde: **1078 files / 13524 tests passed**, 0 failed, 0 skipped,
      0 unhandled errors, 563.86 s. Corrida NO degradada (1078 archivos = el total esperado).
      El implementer reporto 13519; los +5 son de la otra sesion, no de la 208.
- [~] E2E de flujo critico: **no hay E2E nuevo**. Defendible (la 208 no expone superficie de UI;
      el desglose no se puede capturar hasta la 209) y los E2E preexistentes de entrega/cierre
      pasan sin cambios, pero el camino MIXTO queda sin E2E. Ver hallazgo menor 5.

### Datos y seguridad (Supabase)
- [x] `gestion_orden_pago` lleva `ENABLE ROW LEVEL SECURITY` sin ninguna `CREATE POLICY`
      (solo service role), igual que `gestion_orden` / `gestion_orden_evidencia`.
- [ ] **Migracion versionada y REVERSIBLE: el `down.sql` existe pero NUNCA se ejecuto, ni el up
      tampoco. `pnpm run db:rollback` no se ha demostrado.** Ver BLOQUEANTE 1.
- [x] Ningun secreto hardcodeado.
- [x] Sin webhooks nuevos (n/a).

### Patron de capas
- [x] La Server Action solo parsea `FormData` y delega; no hay queries ni reglas de negocio.
- [x] `MisAsignacionesService` no conoce HTTP; la revalidacion `Prisma.Decimal` (R18) y
      `metodoPagoCompatibilidad` (R19) estan en la capa correcta.
- [x] `GestionOrdenRepository` solo ejecuta el `createMany` dentro de la tx; sin logica.
- [x] Interfaces en `lib/interfaces/repositories/` y `lib/interfaces/services/`.

### Permisos / multi-pais
- [x] Mutacion por Server Action, no por API route. Sin cambios de permisos.
- [x] Sin pais, moneda ni cuenta hardcodeados.

### Verificacion final
- [x] `./init.sh` completo en verde (corrido por el reviewer, no por la bitacora).
- [x] `progress/review_208.md` existe (este).
- [ ] Entrada en `progress/history.md`: pendiente (T18, leader).

---

## 2. Lo que verifique yo, no lo que dice la bitacora

### 2.1 La base local quedo INTACTA — CONFIRMADO

`pnpm exec prisma migrate status` (solo lectura):

```
The migrations have not yet been applied:
20260811140000_liquidacion_reparto
20260812120000_gestion_orden_pago

The migration from the database are not found locally in prisma/migrations:
20260728120000_orden_historial_origen_deshacer_asignacion
```

La migracion de la 208 figura como NO aplicada, y las dos causas de divergencia que el
implementer alega son reales y ajenas a esta feature. No se reseteo nada. El reviewer tampoco
toco la base.

### 2.2 Mutacion de `computeTotales` — REPRODUCIDA

sha256 del archivo antes de tocarlo:
`6b73aefaa6f032eb20cd254fe52d4f4f5e3b18d6ada54339b54ec8b77c4c8d3a`.

**Mutacion (a), toda linea al balde `efectivo`** (la de la bitacora):
`13 failed | 15 passed` en 3 archivos. Entre ellos:

- `cierre-totales.test.ts :: "suma solo entregadas con monto, por metodo"`, test **PREVIO** a la
  208: `efectivo` "10.50" pasa a "17.00".
- los **5** de `cierre-dia-service-totales-mixtos.test.ts`, incluido
  `"con P = 6.000 y E = 5.000, se le entregan 5.000 y quedan 1.000 pendientes"`. La `E` del
  `min(P, E)` se infla de 5000.00 a 8000.00: dinero mal pagado a una persona, detectado.

**Mutacion (d), MIA, no estaba en la lista del implementer: baldes `SINPE` y `transferencia`
INTERCAMBIADOS.** Es la mas peligrosa de las tres porque **no altera el total general** ni la
invariante de suma (R28), asi que un test que solo mirara `general` la dejaria pasar.
Resultado: `9 failed | 19 passed`, incluidos caso 1, caso 6 (cada balde = suma de SU metodo),
caso 7 (paridad R27) y el `totalEfectivo` de la mixta. **No hay agujero.**

Arbol restaurado: sha256 identico (`6b73aef...`) y los 3 archivos vuelven a `28 passed (28)`.

### 2.3 R27 (paridad al centavo) — GENUINO

`cierre-totales-pagos.test.ts` reimplementa el calculo ESCALAR previo a la 208 como oraculo
independiente y suma en **centimos enteros** (no en `Prisma.Decimal`, que seria compararlo consigo
mismo), sobre un conjunto generado filtrado a gestiones de metodo unico, que es lo que el backfill
R6/R7 produce, con aserciones anti-vacuidad (`expect(escalares.general).not.toBe("0.00")`).
Correcto.

### 2.4 R30 (nada de `number` / `parseFloat` sobre montos) — CUMPLIDO, con un matiz

- `computeTotales`, `lineas-pago.ts` y el tramo nuevo del repositorio usan `Prisma.Decimal` y
  `toFixed(2)` y nada mas. La guardia `pagos-aritmetica-decimal.guardia.test.ts` lo barre con
  contraprueba y control de no-vacuidad, y acota el repositorio al bloque nuevo con una
  justificacion escrita (el archivo trae `.toNumber()` preexistentes sobre `peso`, `lat`, `lng`).
- El borde (`pagos-recaudo.ts`) opera en `number` y centimos enteros **a proposito y
  correctamente**: `lib/types/gestion-orden.ts` viaja al bundle del navegador y no puede importar
  `@prisma/client`. Eso queda fuera de lo que R30 enumera ("calculo de totales, persistencia de
  lineas y revalidacion del servicio") y es consistente con el `Number(montoRecibido)` preexistente
  de la action (`lib/actions/mis-asignaciones.ts:210`).
- Matiz: ver hallazgo menor 4.

### 2.5 R29 — CUBIERTO

`cierre-dia-service-totales-mixtos.test.ts` fija `totalEfectivo = "5000.00"` para una entrega mixta
de 8.000, deriva el `min(P, E)` con esa `E` y afirma explicitamente el contrafactual ("con la `E`
INFLADA del modelo viejo se le pagaria de mas"). Las 5 aserciones se ponen rojas con las dos
mutaciones que probe.

### 2.6 Identificadores del SQL — verificados contra el arbol

Comprobado que existen de verdad: el enum `"metodo_pago_value"` (`20260711150000_...`, con
`SIMPE` renombrado a `SINPE` en `20260723120000_...`, lo que **preserva el orden ordinal** y por
tanto sostiene R22), la columna `gestion_orden.created_at`, y `gen_random_uuid()` con precedente
en 5+ migraciones. El orden del enum en `db/schema.prisma:645` (`efectivo`, `SINPE`,
`transferencia`) coincide con el nativo, asi que `orderBy: { metodo: "asc" }` da el orden
determinista que R22 exige.

---

## 3. Hallazgos

### BLOQUEANTE 1 — La migracion nunca toco un motor de Postgres, y el repo tenia la via para hacerlo sin aplicarla

**Que falla.** R1, R2, R4, R6, R7 y R9 son hechos del MOTOR y estan sostenidos exclusivamente por
`tests/integration/db/gestion-orden-pago-migration.test.ts`, que es una bateria de regex sobre el
TEXTO de `migration.sql` y `down.sql`. Ese archivo no demuestra:

- **R6/R7 (el backfill).** Es DML que reescribe datos de produccion. Lo unico afirmado es que el
  `WHERE` contiene tres condiciones como cadena. Que inserte exactamente UNA fila por gestion
  cobrada, y CERO por las de monto nulo, monto 0 o metodo nulo, no lo prueba ninguna regex.
- **R2.** Que el `UNIQUE (gestion_id, metodo)` RECHACE el duplicado.
- **R4.** Que `relrowsecurity = true` quede efectivamente en la tabla.
- **R1.** Que el `ON DELETE CASCADE` cascadee.
- **R9.** Que el `down.sql` deje `gestion_orden` EXACTAMENTE como estaba.

**Por que no lo salva la coartada.** La bitacora (parrafo 6.1) dice que `prisma migrate dev` pedia
RESETEAR por una divergencia ajena y que se aborto. La divergencia es real y el aborto fue
correcto, no hay que forzar nada; pero **no es la unica via**. Este repo tiene, desde la feature
205, el helper `enTransaccionRevertida` en `tests/integration/db/_postgres-real.ts` y el molde
completo en `tests/integration/db/liquidacion-reparto-migration.test.ts`, que ejecuta el
`migration.sql` REAL dentro de un esquema temporal, en una transaccion que SIEMPRE se revierte,
**sin aplicar la migracion a ninguna base y sin tocar `_prisma_migrations` ni `public`**. Ese
precedente es la migracion inmediatamente anterior en `db/migrations/`, esta igual de "pendiente"
en la base local que la de la 208, y sus tests pasaron verdes en mi corrida completa: la
divergencia del historial no impide ese camino en absoluto.

**Por que es bloqueante y no menor.** `docs/verification.md` lo pide literalmente ("Verifica
migraciones aplicando y revirtiendo en un entorno de prueba"; "Verifica RLS con un test que
intente acceder sin permiso y confirme el rechazo"), `CHECKPOINTS.md` exige que
`pnpm run db:rollback` funcione, y la regla del reviewer dice que un test que no verifica el
requisito que dice cubrir es hallazgo bloqueante. Sumado a que esto es un backfill money-critical,
y a que la feature entera, incluidos los tres `select: { pagos: ... }` nuevos, **no se ha
ejecutado jamas contra una base de datos**, no se puede dar por verificado.

**Que falta para cumplirlo.** Un bloque B en
`tests/integration/db/gestion-orden-pago-migration.test.ts`, con el molde de
`liquidacion-reparto-migration.test.ts`: esquema temporal mas `enTransaccionRevertida`, clonar
`gestion_orden` con `INCLUDING ALL`, sembrar las cuatro filas que R6/R7 distinguen (monto > 0 con
metodo, monto NULL, monto 0, metodo NULL), ejecutar el `migration.sql` REAL y medir el conteo y el
contenido de `gestion_orden_pago`; ademas el rechazo del duplicado (R2), `relrowsecurity` (R4), el
CASCADE (R1) y que el `down.sql` REAL deje el esquema y los datos de `gestion_orden` identicos
(R9). Se salta solo si no hay `DATABASE_URL`, nunca "passed" por vacio.

---

### menor 1 — La bitacora afirma de mas sobre `metodo_pago` en la forma escalar

`impl_208.md` parrafo 6.2 dice: "Para la forma escalar legacy el valor escrito es identico al de
hoy". Es cierto **solo** para `montoRecibido > 0`. Para `montoRecibido = 0` con el escalar
`efectivo` que hoy fuerza `GestionarOrdenPanel.tsx:331`, `normalizarPagos` devuelve `[]` y
`metodoPagoCompatibilidad([])` escribe `NULL` donde hoy se escribe `efectivo`.

**No es un defecto**: R14 mas R19 lo exigen, esta testeado (`mis-asignaciones-pagos ::
"CERO lineas (sin cobro) -> metodoPago NULL, no efectivo"`) y la ficha 208 lo aprueba
explicitamente ("AVISO ACEPTADO AL APROBAR... se aprobo a sabiendas, no es un defecto que
reportar"). Lo que hay que corregir es la FRASE de la bitacora, que induce a leer una paridad
total que no existe.

Efecto colateral a dejar escrito para la **210**: tras la migracion, la columna deprecada queda
con dos semanticas conviviendo. Las entregas sin cobro HISTORICAS conservan `efectivo` (el
backfill R7 no las toca ni las limpia) y las NUEVAS escriben `NULL`. Sin impacto en ningun total
(R25 y R26 las ignoran), pero quien retire la columna debe saberlo.

### menor 2 — `cierre_maestro` no existe: es un defecto del SPEC, no de la cobertura

Confirmado: en `db/schema.prisma` no hay ningun modelo `cierre_maestro`; el segundo con los tres
`total_*` es `CierreBodega` (feature 40). R32 y `design.md` parrafo 6 (y su tabla) lo nombran mal.

**No invalida la cobertura de R32.** La guardia `pagos-frontera.guardia.test.ts` no supone
nombres: recorre TODOS los `model` del schema, filtra los que contienen `total_efectivo` y exige
que el conjunto sea **exactamente** `["CierreBodega", "CierreDia"]` ("el censo de modelos con
totales por metodo esta CERRADO"), mas la forma `Decimal(12,2)` de cada columna y la ausencia de
una cuarta. Es una cobertura mejor que la que el spec pedia.

Basta con **corregir el texto** de `requirements.md` R32 y de `design.md` parrafo 6
(`cierre_maestro` pasa a `cierre_bodega`). Se puede hacer en el PR de la 208.

### menor 3 — `lib/utils/lineas-pago.ts` esta JUSTIFICADO, no es alcance de mas

21 lineas, una sola funcion pura, ninguna firma publica nueva, ningun consumidor fuera de las dos
proyecciones. Sustituye una duplicacion REAL del serializador money-critical de `Decimal` a string
de escala 2, que el design daba por resuelta con un helper que en realidad estaba copiado como
funcion privada en `CierreDiaRepository` y en `CierresAdminRepository`. Dos copias son dos
oportunidades de divergir de escala en el camino que fija la `E` del `min(P, E)`. La guardia de
aritmetica afirma que los dos lectores pasan por el ("la serializacion del desglose sale de UN
solo sitio"). Desvio documentado en la bitacora. **Aprobado como esta.**

### menor 4 — La guardia de R30 no vigila el tramo del servicio, que R30 nombra

`pagos-aritmetica-decimal.guardia.test.ts` vigila cuatro tramos: los tres utils enteros y el bloque
`if (gestion.pagos` del repositorio. R30 enumera tambien "revalidacion del servicio", y el
`reduce` con `Decimal.plus` de `MisAsignacionesService` (R18) NO esta en el censo. El
comportamiento si esta cubierto (`mis-asignaciones-pagos :: "R30: una suma con decimales que en
float NO cuadraria SI cuadra en Decimal"`), asi que R30 no queda sin test; pero un `+` introducido
ahi manana no lo caza ninguna guardia estatica. Anadir el bloque del servicio al censo, con el
mismo acotamiento por bloque que se uso para el repositorio.

### menor 5 — Sin E2E del camino mixto

`CHECKPOINTS.md` pide E2E para flujos de pagos y recaudo. La 208 no tiene superficie de UI y el
desglose no se puede capturar hasta la 209, asi que un E2E del camino mixto es literalmente
inescribible hoy; los E2E preexistentes (`mis-asignaciones`, `cierre-dia`, `cierres-admin`,
`cierre-bodega-satelite`) cubren el camino escalar y no cambian. Aceptable **si queda escrito en
el PR** que el E2E del cobro mixto es entregable de la 209, no deuda huerfana.

### menor 6 — Bookkeeping pendiente (T18)

`feature_list.json` tiene la 208 en `in_progress` y no hay entrada en `progress/history.md`. Es
tarea del leader por instruccion explicita, pero los checkpoints correspondientes no estan
cumplidos todavia y no se puede pasar a `done` sin ellos.

### menor 7 — El gate cubre menos de lo que aparenta en esta maquina (ajeno a la 208)

`jq` no esta instalado, asi que los pasos 3 y 4 de `init.sh` (regla max-2-por-zona y "specs
presentes para features sdd en vuelo") se omiten con `warn` y no aparecen en la salida. La corrida
llega a `== init OK ==` sin haberlos evaluado nunca. Conviene saberlo; no es de esta feature.

---

## 4. Mapa `R -> test`: COMPLETO (33/33)

Verificado archivo por archivo, no por la tabla de la bitacora. Muestreo profundo en R11-R19
(`gestion-orden-pagos-schema`, `mis-asignaciones-pagos` de action y de service), R21-R23
(`cierre-pagos-lectura`, 19 casos sobre los TRES caminos, mas la guardia de proyeccion con
contraprueba y censo cerrado de productores de la fila), R24-R30 (`cierre-totales-pagos`, 8 casos
mas las dos guardias) y R31-R33 (`cierre-dia-service`, `pagos-frontera.guardia` con censo
DESCUBIERTO del arbol y control de no-vacuidad por archivo). R1-R10 tienen sus 19 aserciones en
`gestion-orden-pago-migration.test.ts`.

**Ningun test vacio, ninguno sin asserts, ninguno que afirme algo distinto de lo que su `R` dice.**
Varios traen controles anti-vacuidad y contrapruebas explicitas, que es mas de lo que el arnes
exige.

La objecion del BLOQUEANTE 1 **no es de trazabilidad**, R1-R10 tienen test, sino de SUFICIENCIA:
esos tests miden el texto del SQL, no su efecto, y para un backfill money-critical eso no alcanza
teniendo el molde de la 205 a mano.

---

## 5. Para volver al implementer

Una sola cosa, acotada: el **bloque B contra Postgres real** del BLOQUEANTE 1, con el molde de
`tests/integration/db/liquidacion-reparto-migration.test.ts`. No hay que aplicar la migracion, no
hay que resetear la base y no hay que arreglar la divergencia del historial.

De propina, mientras esta ahi: menor 4 (ampliar el censo de la guardia de aritmetica al tramo del
servicio) y las correcciones de texto de menor 1 (parrafo 6.2 de la bitacora) y menor 2
(`cierre_maestro` pasa a `cierre_bodega` en `requirements.md` R32 y `design.md` parrafo 6).

Lo demas esta bien hecho. La parte que mas importaba, el reparto por metodo que fija la `E` del
pago al mensajero, aguanta mutacion, incluida una que el implementer no habia probado.

---
---

# RONDA 2 — re-revision tras las correcciones (2026-08-12)

## Veredicto final: **APROBADO**

El bloqueante esta cerrado y los tres menores tambien. Verificado de primera mano, no aceptado de
la bitacora. Quedan cuatro residuos menores, ninguno bloqueante, listados al final.

---

## R2.1 — El bloqueante: CERRADO

`tests/integration/db/gestion-orden-pago-migration.test.ts` pasa de 21 a **31 tests**. Corrido por
mi: **31 passed (31)**, con los **10 del bloque B EJECUTADOS, no saltados** (aparecen uno a uno en
el reporter, con tiempos propios; `describe.skip` habria dado 10 `skipped` y la corrida completa
reporta 0). Lo comprobado:

**Ejecuta SQL de verdad, no es regex con otra cara.** El bloque llama a `$executeRawUnsafe` /
`$queryRawUnsafe` sobre el `upSql` y el `downSql` LEIDOS DEL ARCHIVO, sentencia a sentencia
(`aplicarDdl`), dentro de `enTransaccionRevertida` sobre un esquema temporal `t208_<uuid>` con un
clon `LIKE public."gestion_orden" INCLUDING ALL`. Las mediciones salen del catalogo
(`pg_class.relrowsecurity`, `pg_policies`, `pg_index`, `pg_constraint.confdeltype`) y de los
MENSAJES de error reales de Postgres, no del texto del `.sql`.

Tres detalles que no son de adorno y que verifique en el codigo:
- El `search_path` se fija **por DDL**: el UP con `public` a la vista (necesita el enum
  `metodo_pago_value` y `gen_random_uuid()`), el DOWN **sin** `public`, para que su
  `DROP TABLE IF EXISTS` no alcance la tabla real el dia que la migracion este desplegada.
- Cada violacion esperada corre dentro de un `SAVEPOINT` y se captura como MENSAJE. Sin eso, el
  primer error abortaria la transaccion entera y el resto de mediciones moriria con el.
- El CASCADE se ejerce en su propio savepoint y se deshace, para que la comparacion de datos de R9
  siga midiendo la siembra completa. El test lo afirma (`lineasTrasDeshacer` = 3).

**Mutaciones reproducidas por mi** (sha256 de `migration.sql` antes: `371d6ef4…`):

| Mutacion | Resultado |
| --- | --- |
| FK `ON DELETE CASCADE` -> `RESTRICT` (sutil: el DDL sigue siendo valido, la tabla se crea igual y el backfill funciona) | **3 rojos**, dos de ellos del bloque B, con el mensaje propio del test: *"borrar la gestion padre FALLO: la FK no borra en cascada"*. Eso solo puede venir de un `DELETE` ejecutado de verdad contra Postgres. |
| quitar `AND "monto_recibido" > 0` del backfill | **4 rojos**: el estatico de R7 y **tres del bloque B** (R6 conjunto exacto, R7 cero lineas excluidas, y el conteo del CASCADE) |

`migration.sql` restaurado, sha256 identico (`371d6ef4…`) y el archivo vuelve a `31 passed (31)`.

**La base local sigue INTACTA.** Medido con el mismo harness (`crearPrismaDeTest`), sonda creada y
borrada:

```
esquemas_t208 = []            <- el bloque B no deja residuo
tabla_en_public = []          <- gestion_orden_pago NO existe en public
filas_gestion_orden = 44      <- las 44 de siempre
en _prisma_migrations = []    <- la 208 sigue sin aplicarse
```

Y `HAY_BASE_DE_DATOS` **no esta saltando nada en silencio**: si lo estuviera, los 10 tests del
bloque B saldrian `skipped`, y tanto la corrida del archivo como el `./init.sh` completo reportan
**cero skipped**. La prueba definitiva es que las dos mutaciones pusieron rojos del bloque B: un
bloque saltado no se pone rojo.

---

## R2.2 — Los tres menores: CERRADOS

**menor 1 (bitacora §6.2).** Corregida. Dice ahora que con la forma escalar y `montoRecibido > 0`
el valor es el mismo, y **explicita el caso en que NO lo es** (entrega sin cobro: `'efectivo'` pasa
a `NULL`), marcandolo como aprobado a sabiendas. Y anota para la 210 la consecuencia de las **dos
semanticas** conviviendo en la columna deprecada (historicas con `'efectivo'`, nuevas con `NULL`),
con el razonamiento de por que eso es municion para retirarla. Es exactamente lo que faltaba.

**menor 2 (`cierre_maestro`).** Corregido en `requirements.md` R32 y en la tabla de `design.md`
parrafo 6, los dos con nota fechada que explica el cambio y remite a la guardia.

*Juicio sobre la errata que se deja a proposito en R8 y en `tasks.md`:* **es aceptable, no hay que
corregirla.** En esos dos sitios `cierre_maestro` aparece dentro de una LISTA DE TABLAS QUE LA
MIGRACION NO DEBE TOCAR. Nombrar de mas en una prohibicion no debilita nada: la prohibicion sobre
una tabla inexistente se cumple vacuamente y las tres reales (`cierre_dia`, `cierre_bodega`,
`cierre_detail`) siguen cubiertas, tanto en el test estatico como en la guardia de frontera, que
barre las cuatro. Distinto era R32, donde el nombre designaba el objeto que el requisito PROTEGE:
ahi la errata si apuntaba a nada. La decision queda escrita en la nota de R32, que es lo que evita
que el proximo lector la tome por un descuido.

**menor 3 (guardia de R30).** Hay quinto tramo:
`lib/services/MisAsignacionesService.ts (revalidación de la suma, R18)`, acotado por llaves
balanceadas para no barrer la aritmetica pre-208 del archivo. Trae anclas de no-vacuidad
(`new Prisma.Decimal(p.monto)`, `sumaPagos.equals(`, `status: "validation_error"`), una asercion
de que el extractor no se lleva el archivo entero medida por la asimetria del `+`, y un test
propio de que la segunda barrera acumula con `Decimal.plus` y compara con `equals`.

**Mutacion reproducida por mi** (sha256 antes: `2533ef10…`): sustitui la revalidacion del servicio
por `reduce((acc, p) => acc + Number(p.monto), 0)` con comparacion `!==`. La guardia pasa a
**4 failed | 11 passed**, incluidos el control de no-vacuidad, el barrido de los cinco tramos, el
test especifico de la segunda barrera y la contraprueba. Archivo restaurado, sha256 identico
(`2533ef10…`), guardia verde.

---

## R2.3 — La limitacion declarada («base ya migrada»): el argumento es SOLIDO

El implementer declara que el bloque B no ejerce el caso en que `public` ya tenga la migracion
aplicada, y argumenta que no le hace falta la normalizacion del clon que si necesitaba el molde de
la 205. **Lo revise sentencia a sentencia y el argumento se sostiene.**

Por que la 205 SI la necesitaba: su UP hace `ALTER TABLE "liquidacion_pago" ADD COLUMN reparto_id`.
Un clon tomado de un `public` ya migrado trae la columna, y el `ADD COLUMN` muere con «ya existe».
De ahi que su molde aplique el `down.sql` al clon antes de medir.

Por que la 208 NO la necesita:

1. **El UP no toca `gestion_orden`.** Sus cinco sentencias son `CREATE TABLE`, dos `CREATE INDEX`,
   un `ALTER TABLE gestion_orden_pago ADD CONSTRAINT`, un `ALTER TABLE gestion_orden_pago ENABLE
   RLS` y un `INSERT`. Ninguna altera la tabla clonada. El clon `LIKE public."gestion_orden"
   INCLUDING ALL` es por tanto **identico este o no migrada `public`**: no hay foto que normalizar.
2. **Todo resuelve contra el esquema temporal**, que va primero en el `search_path`: la tabla
   nueva, sus indices, su FK y los dos lados del `INSERT ... SELECT`.
3. **No hay colision de nombres posible.** En Postgres los nombres de tabla e indice son por
   ESQUEMA y los de constraint por TABLA, asi que
   `gestion_orden_pago_gestion_id_metodo_key` del esquema temporal no choca con el homonimo de
   `public` aunque exista.

No lo dejo como riesgo asumido. La unica nota que merece la pena, y va dirigida a quien EDITE ese
archivo en el futuro: **la ausencia de normalizacion del clon deja de ser inocua en cuanto una
migracion posterior anada un `ALTER TABLE "gestion_orden"` al UP.** Hoy no lo hay; conviene que
quede dicho en el docstring del bloque B, no en el PR.

---

## R2.4 — Gate: verde, y la salvedad de `jq` CONFIRMADA

`./init.sh` completo, corrido por mi:

```
! jq no esta instalado (recomendado para validar feature_list.json)
✓ typecheck paso
✓ lint paso
 Test Files  1078 passed (1078)
      Tests  13545 passed (13545)
   Duration  412.32s
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Cero `unhandled errors`, cero `skipped`, 1078 archivos: la corrida NO esta degradada y el conteo es
real. Coincide con lo declarado (13545). Cero rojos, incluidos los archivos de la otra sesion
—que sigue escribiendo en este checkout y ha anadido `HabilitarNovedadModal.tsx` desde la ronda 1—.

**La salvedad de `jq` es cierta y es la que mas facil se cuela:** el warn sale en la linea 1, donde
nadie mira, y los pasos 3 y 4 (`max-2-por-zona` y `specs presentes para features sdd en vuelo`)
**no se evaluan**; `== init OK ==` no los cubre. El implementer lo declara honestamente. Los
reevalue yo por mi cuenta sobre `feature_list.json`:

- `in_progress` = **2**: `196` (fullstack) y `208` (backend). Una por zona, dentro del limite.
- Specs faltantes para features `sdd` en vuelo: **ninguna**.

Los dos pasos habrian pasado. Pero conviene que el leader lo sepa: en esta maquina el gate afirma
menos de lo que su ultima linea sugiere.

---

## R2.5 — Mapa `R -> test`: SIGUE COMPLETO (33/33), y mejor

La tabla del bloque A de `impl_208.md` ahora distingue **A** (estatico) de **B** (Postgres real) y
R1, R2, R4, R6, R7 y R9 ganan cobertura de comportamiento ademas de la textual. R3, R5, R8 y R10
siguen solo con la estatica, que es lo correcto: son afirmaciones sobre lo que el SQL **no dice**
(sin columna `referencia`, sin `ALTER` de las tablas de cierre, sin `CHECK` de la suma), y eso se
verifica sobre el texto, no sobre el motor. R11-R33 no cambian respecto de la ronda 1, donde ya los
verifique uno a uno.

Ningun requisito sin test, ningun test vacio.

---

## R2.6 — Residuos que quedan (ninguno bloqueante)

1. **menor — `pnpm run db:rollback` sigue sin ejecutarse nunca para esta migracion.** El bloque B
   ejecuta el `down.sql` REAL contra Postgres, que es la parte especifica de la 208 y la unica que
   esta feature escribe. Lo que no se ha ejercido es el envoltorio de
   `scripts/db-rollback.ts` (`prisma db execute --file` mas el `DELETE FROM "_prisma_migrations"`),
   que es generico, preexistente y no cambia aqui. Residuo delgado; lo doy por aceptable.
2. **menor — sin E2E del camino mixto.** Sigue igual que en la ronda 1: hoy es inescribible (no hay
   UI que capture el desglose hasta la 209). Dejarlo escrito en el PR como entregable de la 209,
   no como deuda huerfana.
3. **menor — bookkeeping (T18) pendiente.** `feature_list.json` tiene la 208 en `in_progress` y no
   hay entrada en `progress/history.md`. Es del leader; sin eso no puede pasar a `done`.
4. **menor, ajeno a la 208 — `jq` ausente**, ver R2.4. El gate omite dos comprobaciones sin que se
   note. Vale la pena instalarlo o convertir el `warn` en `fail`.

---

## R2.7 — Estado del arbol al cerrar la revision

Todo lo que toque quedo devuelto, verificado por sha256:

| Archivo | sha256 | Estado |
| --- | --- | --- |
| `lib/utils/cierre-totales.ts` | `6b73aefa…` | identico a la ronda 1 |
| `db/migrations/20260812120000_gestion_orden_pago/migration.sql` | `371d6ef4…` | restaurado |
| `lib/services/MisAsignacionesService.ts` | `2533ef10…` | restaurado |

La sonda temporal (`tests/integration/db/__probe208.test.ts`) fue borrada. El unico archivo que
este reviewer anade al arbol es `progress/review_208.md`. No se corrio `git checkout`, `git stash`
ni `git reset`, y no se toco ningun archivo de la otra sesion.
