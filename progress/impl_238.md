# impl 238 — confirmación física de los paquetes al aprobar el cierre

Rama `feature/238-confirmacion-fisica-cierre`, base `origin/dev` = `fc17148e`.
Spec: `specs/238-confirmacion-fisica-cierre/{requirements,design,tasks}.md` (R1–R44, T0–T6).

---

## T0.1 — Medición contra producción, 2026-08-19

Vía **MCP de Supabase, solo lectura**, contra el proyecto de producción. La consulta de `design.md`
§9 es la primera; las otras dos son la **autocomprobación**, sin la cual los ceros no significan
nada.

### (a) Cierres `solicitado` y cuánto tendría que escanear cada uno

```sql
-- design.md §9, tal cual
WHERE c."estado" = 'solicitado'
```

**Resultado: cero filas.**

⚠️ **Un cero de una cola vacía no dice nada**, así que se midió el universo antes de creérselo:

| medida | valor |
| --- | --- |
| cierres, por estado | **12, TODOS `aprobado`** — ninguno en `solicitado`, `vencido` ni `rechazado` |
| gestiones vivas, por resultado | `entregada` 16 · `devuelta` 12 · `reprogramada` 12 · `rechazada` 8 · `incidente` **2** |
| gestiones que VUELVEN, vivas, con cierre | **32** (12+8+12, cuadra) |
| órdenes vivas | **141** |

O sea: el cero de (a) es **«no hay cola ahora mismo»**, no «no hay datos». Hay 12 cierres reales y
32 gestiones que la feature tendría que hacer escanear.

**Consecuencia, que es la que importa:** nadie se encuentra el botón de aprobar bloqueado de golpe
el día del despliegue, porque no hay ningún cierre esperando aprobación. **D8 (avisar a bodega)
deja de bloquear el despliegue**, aunque sigue siendo buena práctica avisar.

⏳ **Es una foto y caduca.** Un cierre solicitado aparece en cuanto un mensajero cierre su día.
**Re-medir justo antes de desplegar**, no antes de mergear.

### (b) Gestiones que vuelven con `orden.num_guia IS NULL` — el número que decide **D3**

**Cero**, y esta vez con universo detrás: **32** gestiones que vuelven vivas, **0** sin número de
guía; y **141** órdenes vivas, **0** sin número de guía.

**La población de D3 no existe hoy.** El comportamiento seguro de **R13** —bloquear y decirlo, nunca
omitir en silencio— **se mantiene como red**, porque el coste de tenerlo es una rama de código y el
de no tenerlo es un paquete que se aprueba sin escanear.

### (c) Incidentes por cierre — para dimensionar la línea de exclusión

Como la cola está vacía, se dimensionó sobre **los 12 cierres ya aprobados**, que es la carga real
que la feature habría tenido:

| | |
| --- | --- |
| cierres medidos | 12 |
| gestiones a escanear, total | 32 |
| por cierre: mínimo / media / **máximo** | 0 / 2,7 / **14** |
| **cierres SIN nada que escanear** | **3 de 12** |
| incidentes totales | 2, repartidos en 2 cierres |

**Tres cosas que esto le dice al diseño, y ninguna estaba en el spec:**

1. **El caso «sin retornables» no es teórico: es 1 de cada 4.** T2.3 y T4.1 lo tratan como un camino
   de igual rango —se aprueba sin ventana— y la medición lo respalda: en 3 de 12 cierres la pantalla
   nueva **no debe aparecer en absoluto**. Un camino que se ejercita el 25 % de las veces no puede
   quedarse en un `else`.
2. **El techo de la ventana es 14 guías**, no 2 ni 3. La lista agrupada de T4.2 tiene que ser usable
   con catorce filas y con bodega escaneando de pie: eso empuja a que el progreso («faltan N») y el
   motivo del bloqueo se vean **sin desplazar**, no al final de la lista.
3. **Los incidentes existen** (2, en 2 cierres distintos), así que **la línea de exclusión de R34 se
   va a ver de verdad** — no es una rama muerta. Y en esos dos cierres conviven con retornables, que
   es justo el caso que T2.4 pide con claves de error disjuntas.

---

## T0.2 — Decisiones firmadas

**Ya estaban firmadas y escritas** en `specs/238-confirmacion-fisica-cierre/requirements.md`
§«PUERTA HUMANA PASADA — 2026-08-19». Se transcriben aquí para que la bitácora sea autosuficiente,
**sin cambiarlas**:

- **D1 — se persiste una marca por gestión**: `gestion_orden.confirmada_fisica_at`, nullable, escrita
  **solo dentro de la transacción**. La granularidad coincide con el acto, reutiliza una tabla que ya
  tiene RLS y cae donde ya escribe la indemnización. **No** se añade `confirmada_fisica_por`: quién
  confirmó es el `resuelto_por` del mismo cierre, y una copia sería una segunda verdad.
- **D2 — NO se puede aprobar con faltantes declarados**, sin escapatoria. La salida cuando un paquete
  no llegó **ya existe y es la correcta**: rechazar el cierre con motivo, que se lo devuelve al
  mensajero. **Consecuencia aceptada: un solo paquete perdido devuelve el cierre entero**, y es
  deliberado — es la fricción que hace que los paquetes aparezcan.
- **D3 — resuelta por medición**, ver (b): la población no existe, R13 se queda como red.
- **D8 — resuelta por medición**, ver (a): deja de bloquear el despliegue.

**Consecuencia de D2 que el spec exige hacer visible en pantalla**: si bodega no puede aprobar, tiene
que entender **por qué** y **qué guías faltan** sin adivinar. Un bloqueo mudo se lee como una app
rota.

---

## T0.3 — El aviso a bodega

**No bloquea T1, y tras (a) tampoco bloquea el despliegue** (no hay cierres en cola que se encuentren
el gesto cambiado de un día para otro). Queda como **acción del humano antes de desplegar**, no como
tarea de código: a partir del despliegue, aprobar exige tener los paquetes delante.

---

# Backend — T1, T2 y T3 (2026-08-19)

Rama `feature/238-confirmacion-fisica-cierre`, encima de `678f031c` (T0). **Sin commitear.**
Alcance: **T1, T2, T3** + las tres mutaciones que el spec pide en T5 (T5.2/T5.3/T5.4).
**T4 (la pantalla) NO se toco**, y no hizo falta tocar `app/` ni una linea para que el arbol
compile — ver la seccion «Lo que queda abierto para T4».

## T1 — El punto unico y la lectura

### Archivos

| Archivo | Que |
| --- | --- |
| `lib/types/gestion-retorno.ts` | **NUEVO.** `RETORNA_A_BODEGA` (`satisfies Record<GestionResultado, boolean>`), `RESULTADOS_QUE_VUELVEN` **derivado** y `vuelveABodega()`. Modulo puro: solo el `type` del enum, borrado en compilacion. |
| `lib/interfaces/repositories/ICierresAdminRepository.ts` | `GestionRetornableDelCierre` + `findGestionesRetornablesDelCierre`. |
| `lib/repositories/CierresAdminRepository.ts` | La implementacion, molde literal de `findGestionesIncidenteDelCierre`. |
| `tests/unit/types/gestion-retorno.test.ts` | **NUEVO** (8 casos). |
| `tests/unit/guards/confirmacion-incidentes-excluidos.guardia.test.ts` | **NUEVO** (7 casos), con autocomprobacion. |
| `tests/unit/repositories/cierres-admin-retornables.test.ts` | **NUEVO** (11 casos), doble que **aplica** el predicado. |
| `tests/integration/db/cierres-admin-retornables-sql-real.test.ts` | **NUEVO** (5 casos) — el WHERE **ejecutado contra Postgres**. |

### Dos decisiones que no estaban en el spec

**1. El `WHERE` se prueba DONDE VIVE — dos niveles, no uno.** El spec pedia
`cierres-admin-retornables.test.ts`. Ese archivo existe y su doble **aplica** el predicado a filas
(no afirma su forma), pero sigue siendo una re-implementacion mia de la semantica de Postgres: lo
que ni el doble ni ningun test de servicio pueden demostrar es que el `where` que Prisma traduce
—incluida la condicion sobre la **relacion** `cierre`, que se convierte en un JOIN— seleccione de
verdad esas filas. Por eso hay **ademas** un archivo que siembra el corpus en la base local dentro
de una transaccion que **siempre se revierte** y ejecuta el metodo real. Las mutaciones **M7** y
**M13** lo matan por los dos lados.

Ese archivo **no puede pasar en verde sin comprobar nada**: sin base alcanzable se SALTA (se ve en
la salida), y con base pero sin catalogo **falla con un mensaje que dice que hay que sembrar**. No
hay ni un `if (!fks) return;`.

**2. La guardia de copia unica es de LISTA REGISTRADA, no de «no aparezca nunca».** El censo del
arbol encontro **una coincidencia legitima**: `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`
(`lib/types/orden-historial.ts`, feature 215) tiene **los mismos tres valores por casualidad** y
responde a otra pregunta («¿esta visita cuenta como intento de entrega?»). Esta **registrada con su
motivo** en la guardia, precisamente para que nadie la confunda con esta ni «reuse» la equivocada.
Si algun dia un resultado nuevo contara como intento pero no volviera a bodega, las dos listas
**tienen que divergir**.

**Sobre el N+1 (medicion de T0.1, techo = 14 gestiones por cierre):** la lectura trae
`{ gestionId, numGuia, resultado }` en **una sola consulta**, con `orden.numGuia` como columna de
la misma proyeccion. Pintar 14 filas cuesta 1 consulta, no 15. Hay un caso que lo afirma contando
llamadas.

## T2 — El borde y la cobertura en el servicio

| Archivo | Que |
| --- | --- |
| `lib/types/cierres-admin.ts` | `confirmacionFisicaSchema` + `aprobarCierreSchema.confirmacionFisica` con `.default([])`. |
| `lib/actions/cierres-admin.ts` | La Server Action pasa la lista **tal cual** (4.o argumento). |
| `lib/interfaces/services/ICierresAdminService.ts` | `ConfirmacionFisicaInput` + 4.o parametro opcional. |
| `lib/services/CierresAdminService.ts` | Los **seis** mensajes con nombre + `validarConfirmacionFisica`, **antes** de la cobertura de indemnizaciones y **antes** de tocar el repo. |
| `tests/unit/types/cierres-admin-confirmacion-schema.test.ts` | **NUEVO** (12 casos). |
| `tests/unit/services/cierres-admin-confirmacion-fisica.test.ts` | **NUEVO** (16 casos). |
| `tests/unit/services/cierres-admin-service.test.ts` | +3 casos de alcance (T2.5). |
| `tests/integration/actions/cierres-admin-action.test.ts` | +2 casos; **1 literal ampliado** (ver abajo). |

### Tres cosas que conviene leer antes de revisar

**(a) «Sin retornables» se trato como camino de igual rango, no como `else`.** Medido: 3 de 12
cierres. Tiene **tres** casos propios en la suite del servicio —se aprueba con el payload de
siempre; el servicio hace **una** lectura y ni una consulta extra; y una confirmacion que sobra
**se rechaza**, no se ignora— mas dos en el borde zod.

**(b) La lectura de incidentes de R11 es PEREZOSA.** El pseudocodigo del design consultaba los
incidentes dentro del bucle. Escrito asi seria una consulta por entrada desconocida. Se resuelve
con un memo local: **como mucho una** lectura, y **cero** en el camino feliz.

**(c) Un `toEqual` literal ampliado, no aflojado.**
`tests/integration/actions/cierres-admin-action.test.ts:131` afirmaba
`toHaveBeenCalledWith(CIERRE_ID, MAESTRO, [])`. **Ese literal ES el contrato del borde** (dice que
la accion pasa exactamente lo que el schema produjo, sin coercion), asi que se **amplio** a
`(CIERRE_ID, MAESTRO, [], [])` en vez de sustituirlo por `expect.anything()`: con un comodin en el
cuarto hueco se dejaria de vigilar justo lo que R15 fija —que «sin el campo» llega como lista
**vacia** y no como `undefined`—.

### Desviacion tipografica declarada

Los seis mensajes van **sin tildes** («Falta confirmar la recepcion...»), mientras el design los
escribe con tildes. Motivo: sus **cinco hermanos de la 158 viven tres lineas mas arriba en el mismo
archivo y tampoco las llevan**, y la mezcla dentro del mismo modal se leeria peor que la ausencia.
El texto es palabra por palabra el del spec. **Si T4 prefiere lo contrario, se cambian los seis a
la vez y tambien los cinco de la 158** — no se hace a medias.

## T3 — La migracion y la escritura dentro de la transaccion

| Archivo | Que |
| --- | --- |
| `db/migrations/20260819170000_gestion_orden_confirmacion_fisica/` | **NUEVA**: `migration.sql` + `down.sql`. |
| `db/schema.prisma` | `confirmadaFisicaAt DateTime? @map("confirmada_fisica_at")`. |
| `lib/interfaces/repositories/ICierresAdminRepository.ts` | `ConfirmacionFisicaGestion` + `confirmacionFisica` **obligatorio** en la rama `aprobado`, **`never`** en `rechazado`. |
| `lib/repositories/CierresAdminRepository.ts` | `ConfirmacionFisicaNoAplicableError` + el bloque, entre `devolucionRechazadas` (139) y el anclaje (239). |
| `tests/unit/repositories/cierres-admin-confirmacion-fisica.test.ts` | **NUEVO** (13 casos), doble que **honra el `where`**. |
| `tests/integration/db/confirmacion-fisica-migration.test.ts` | **NUEVO** (18 casos: 15 estaticos + 3 contra la base real). |
| `tests/integration/db/wallet-idempotencia.test.ts` | +1 caso (T3.5) + dos stores que honran sus guardas. |
| `tests/unit/guards/confirmacion-sin-lectores.guardia.test.ts` | **NUEVO** (8 casos), con autocomprobacion. |
| `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts` | T3.7: `tx.gestionOrden.updateMany` pasa a describir **dos** bloques con **dos** suites. |
| `tests/unit/repositories/cierres-admin-indemnizacion.test.ts` | T3.8: identificacion **por significado** + 1 caso nuevo con los dos bloques vivos. |

### T3.1 — La migracion, verificada de ida y vuelta contra `localhost:5432`

Timestamp **`20260819170000`**, posterior a `20260819160000_orden_retiro_ayuda` (la ultima en
`dev`). **Produccion no se toco.** Salida real, en este orden:

```
$ npx prisma migrate status
Following migration have not yet been applied:
20260819170000_gestion_orden_confirmacion_fisica

$ npx prisma migrate deploy
Applying migration `20260819170000_gestion_orden_confirmacion_fisica`
All migrations have been successfully applied.

$ pnpm run db:rollback
Aplicando rollback: 20260819170000_gestion_orden_confirmacion_fisica
Script executed successfully.
Script executed successfully.
Rollback completado: 20260819170000_gestion_orden_confirmacion_fisica

# la columna DESAPARECIO de information_schema:
columna: []
# y la migracion vuelve a figurar como PENDIENTE:
Following migration have not yet been applied:
20260819170000_gestion_orden_confirmacion_fisica

$ pnpm run db:rollback        # SEGUNDA vez: el `IF EXISTS` la hace idempotente
Rollback completado: 20260819170000_gestion_orden_confirmacion_fisica

$ npx prisma migrate deploy
All migrations have been successfully applied.
columna: [{"column_name":"confirmada_fisica_at","data_type":"timestamp without time zone",
           "is_nullable":"YES","column_default":null}]

# R20 sobre datos REALES de la base local:
gestiones: [{"total":"15","con_marca":"0"}]
```

`pnpm exec prisma generate` corrido despues. **Aviso: el servidor de dev de `localhost:3000` sigue
vivo y con el cliente Prisma anterior en memoria; hay que reiniciarlo** para que vea
`confirmadaFisicaAt`.

### T3.2 — El peaje del tipo, y donde rompio

`confirmacionFisica` obligatorio en la rama `aprobado` **rompio el typecheck en 26 sitios de 7
archivos de test**, que es exactamente la senal buscada. Se pago con **una linea mecanica por call
site** (`confirmacionFisica: []`), igual que la 239 pago la suya. **Ninguna asercion cambio** en
esos archivos: `cierres-admin-anclaje-devolucion.test.ts` y `cierres-admin-caja-cod.test.ts` siguen
verdes con su diff reducido a esa linea.

### T3.9 — Ningun feed lee la columna nueva ni `orden.estatus_id` (R41)

Revisados los cinco feeds + la caja COD. **Cero apariciones** de `confirmadaFisicaAt` /
`confirmada_fisica_at` y **cero** de `estatusId` / `estatus_id` en los seis. Sus proyecciones son
explicitas y estrechas:

| Feed | `select` |
| --- | --- |
| `WalletFeedService` | `{ ordenId, resultado }` |
| `WalletTiendaFeedService` | `{ ordenId, resultado, montoRecibido }` |
| `WalletMensajeroFeedService` | `{ mensajeroId, totalPagoMensajero, totalEfectivo }` |
| `WalletIndemnizacionFeedService` | `{ indemnizacion }` |
| `CajaCodFeedService` | `{ monto }` |

`cierres-admin-caja-cod.test.ts` (que **mide el orden** de las llamadas) y las suites de
idempotencia estan **verdes**, con el unico diff de la linea de T3.2.

## Mutaciones — cada afirmacion, con su rojo citado

Aplicadas **una a una**, `vitest` ejecutado y leido en cada una, restauradas y verificadas por
`sha256`. El hash «despues» coincide con el «antes» en **las trece**.

| # | Que se rompe | sha256 antes / mutado / despues | Rojo REAL (mensaje citado) |
| --- | --- | --- | --- |
| **M1** (T5.2) | Se retira la guardia de cobertura del servicio | `c09b2b69` / `7bb70aac` / `c09b2b69` | **14 casos** caen. `confirmacion VACIA con tres paquetes que vuelven: rechaza y NO toca el repo` → `Error: esperaba validation_error y llego ok` |
| **M2** (T5.3) | Se quita `cierreId` del WHERE de la **escritura** | `0f527ee9` / `222b3007` / `0f527ee9` | `TESTIGO del cierreId: una gestion de OTRO cierre no se marca` → `AssertionError: promise resolved "'updated'" instead of rejecting` |
| **M3** (T5.4) | `incidente: true` en `RETORNA_A_BODEGA` | `a017850f` / `2847bc33` / `a017850f` | **8 casos** en 3 archivos. `gestion-retorno.test.ts > R3: incidente esta DECLARADO como no-retornable` → `AssertionError: expected true to be false`; y el SQL real: `el SQL real devuelve las tres clases que vuelven y NADA mas` → `expected [ ...(5) ] to deeply equal [ ...(4) ]` |
| **M4** | Se quita `resultado` del WHERE de la **escritura** | `0f527ee9` / `278ae385` / `0f527ee9` | `TESTIGO del resultado: un INCIDENTE del MISMO cierre no se marca` → `promise resolved "'updated'" instead of rejecting` (2 casos) |
| **M5** | El `data` gana una segunda clave (`indemnizacion: null`) | `0f527ee9` / `73439c7e` / `0f527ee9` | `R19: el data lleva EXACTAMENTE confirmadaFisicaAt` → `expected [ 'confirmadaFisicaAt', ...(1) ] to deeply equal [ 'confirmadaFisicaAt' ]` |
| **M6** | Se retira el `throw` de fallo cerrado | `0f527ee9` / `bbb08c8d` / `0f527ee9` | **4 casos** → `promise resolved "'updated'" instead of rejecting` |
| **M7** | El alcance sale del WHERE de la **lectura** | `0f527ee9` / `b7321e35` / `0f527ee9` | **4 casos**, incluido el SQL real: `R6: el alcance del SATELITE no ve el cierre central` → `expected [ { ...(3) }, { ...(3) }, { ...(3) }, ...(1) ] to deeply equal []` |
| **M8** | El servicio manda `[]` al repo en vez de la lista | `c09b2b69` / `578efd72` / `c09b2b69` | `confirmadas TODAS...: aprueba y pasa SOLO los ids al repo` → `expected [] to deeply equal [ Array(3) ]` |
| **M9** | Se planta `["devuelta","rechazada","reprogramada"]` en `CierresAdminService.ts` | `c09b2b69` / `19358927` / `c09b2b69` | Guardia T1.2: `ningun archivo de produccion fuera del registro declara su propia lista` → `Estos archivos declaran su propia lista... expected [ Array(1) ] to deeply equal []` |
| **M10** | Se planta un lector con aritmetica de fechas sobre la marca | `c09b2b69` / `51390848` / `c09b2b69` | Guardia T3.6: **2 casos** → `R21: esta marca NO es un reloj...` |
| **M11** | La rama pierde la guarda `res.count === 1` (idempotencia) | `0f527ee9` / `8f34bf99` / `0f527ee9` | `wallet-idempotencia > 238/R22: re-aprobar da conflict...` → `AssertionError: expected 2 to be 1` |
| **M12** | El bloque se mueve **detras** del anclaje (239) | `0f527ee9` / `cb99aab7` / `0f527ee9` | `la marca se escribe ANTES del anclaje` → `expected [ 'anclar', 'confirmar' ] to deeply equal [ 'confirmar', 'anclar' ]` |
| **M13** | Se quita `resultado` del WHERE de la **lectura** | `0f527ee9` / `07aefe6e` / `0f527ee9` | **4 casos**; el SQL real: `expected [ ...(6) ] to deeply equal [ ...(4) ]` |

### Un hallazgo de la mutacion M3 que hay que decir tal cual

**T5.4 dice «caen los casos de T1.1 y T2.2». Cayeron los de T1.1 — y NO los de T2.2.** La suite del
servicio usa dobles del repositorio, asi que el conjunto esperado se lo da el test y
`RETORNA_A_BODEGA` no interviene: **es estructuralmente incapaz de ver esa mutacion**. Quien la mata
son el modulo puro y el **repositorio**, que es donde la regla se aplica —y ahi la matan **tres**
archivos, incluido el que corre contra Postgres—. La decision firmada queda protegida; lo que no es
cierto es que la proteja la suite que el spec nombraba.

## Mapa `R<n>` → test (lo que cubre este backend)

| Req | Test |
| --- | --- |
| R1 | `tests/unit/types/gestion-retorno.test.ts` — «los CINCO resultados estan declarados» |
| R2 | idem «es exactamente devuelta/rechazada/reprogramada» + `cierres-admin-retornables.test.ts` + `cierres-admin-retornables-sql-real.test.ts` |
| R3 | `gestion-retorno.test.ts` — «incidente esta DECLARADO como no-retornable» (**M3**) · `cierres-admin-retornables*.test.ts` — «los incidente no salen» · `cierres-admin-confirmacion-fisica.test.ts` (service) — «un incidente no entra ni bloquea» |
| R4 | `cierres-admin-retornables.test.ts` — «una gestion cuya orden YA cambio de estatus sigue en el conjunto» |
| R5 | typecheck (`satisfies Record<...>`) + guardia `confirmacion-incidentes-excluidos` («conserva la red de compilacion») |
| R6 | `cierres-admin-retornables.test.ts` + `-sql-real.test.ts` — «fuera de alcance = inexistente» (**M7**) |
| R7 | `cierres-admin-confirmacion-fisica.test.ts` (service) — «confirmacion VACIA ... rechaza» (**M1**) |
| R8 | idem — en TODOS los rojos, `repo.resolverCierre` **no** se llamo |
| R9 | idem — «el error va en el que FALTA» |
| R10 | idem — «gestion AJENA» y «confirmada dos veces» |
| R11 | idem — «mensaje propio, distinto del de ajena» |
| R12 | idem — «una guia que NO es la de ese paquete» + borde zod |
| R13 | idem — «sin numero de guia bloquea con su mensaje» · `cierres-admin-retornables*.test.ts` — «viaja null y NO se omite» |
| R14 | idem — «con las DOS rotas, responde el de la confirmacion fisica»; y el repo sin llamar en cada rojo |
| R15 | idem — «SIN el cuarto argumento se trata como lista vacia» · `cierres-admin-confirmacion-schema.test.ts` · action test |
| R16 | idem — tres casos de «sin nada que devolver» · schema · action |
| R17 | `cierres-admin-confirmacion-fisica.test.ts` (repo) — «marca EXACTAMENTE las confirmadas» |
| R18 | idem — «count insuficiente LANZA» y «NADA queda aplicado» (**M6**) |
| R19 | idem — «el data lleva EXACTAMENTE confirmadaFisicaAt» (**M5**) + guardias money-safe verdes sin tocar |
| R20 | `confirmacion-fisica-migration.test.ts` — «nullable, sin default» y «las gestiones previas quedan en NULL» (contra la base real) |
| R21 | `tests/unit/guards/confirmacion-sin-lectores.guardia.test.ts` (**M10**) |
| R22 | `tests/integration/db/wallet-idempotencia.test.ts` — «re-aprobar da conflict ... UNA sola marca» (**M11**) |
| R23 | `cierres-admin-confirmacion-fisica.test.ts` (repo) — «toda gestion ANCLADA quedo confirmada» + «la marca se escribe ANTES del anclaje» (**M12**); `cierres-admin-anclaje-devolucion.test.ts` verde, sin cambiar ninguna asercion |
| R24 | idem — «rechazar no ejecuta el bloque» + typecheck (`confirmacionFisica?: never`) |
| R25 | idem — «guardia del cierre perdida: conflict y ni una marca» |
| R26 | idem, por construccion: `forzarSolicitudVencido` no es una resolucion y no toca este camino (design §6); la aprobacion posterior pasa por la puerta completa, que es lo que miden R7/R8 |
| R38 | `cierres-admin-service.test.ts` — «el adminSatelite recibe la MISMA exigencia» + «sin zona: no_encontrada sin leer el conjunto» |
| R40 | `aprobacion-escrituras-cubiertas.guardia.test.ts` — inventario con los **dos** bloques y sus **dos** suites |
| R41 | T3.9 (arriba) + `cierres-admin-caja-cod.test.ts` y las suites de idempotencia verdes |
| R42 | idem, frente 2, tras re-apuntar la indemnizacion **por significado** (T3.8) |
| R43 | `confirmacion-fisica-migration.test.ts` («down de UNA sentencia, IF EXISTS») + el round-trip real de arriba |
| R44 | `cierres-admin-confirmacion-fisica.test.ts` (repo) — «el mensaje lleva SOLO el id del cierre» |

**Sin cubrir en esta tanda (por diseno):** R27-R37 (pantalla, T4) y R39 (T5.1 — ver abajo).

## Lo que queda abierto para T4

1. **No hizo falta tocar la pantalla.** `CierresAdminModule.tsx` pasa un objeto literal a
   `aprobarCierre(input: unknown)`, asi que un campo nuevo **opcional** en el schema no rompe su
   typecheck. **El arbol compila con la pantalla intacta** — y eso es exactamente el riesgo que el
   spec declara: hoy el servidor **ya exige** la confirmacion y la pantalla **no la manda**, asi que
   **todo cierre con devoluciones esta bloqueado hasta que T4 aterrice**. T2+T3+T4 **tienen que ir
   en el mismo PR**.
2. **Contratos que T4 consume, ya congelados:** `RETORNA_A_BODEGA` / `vuelveABodega` para decidir
   que filas pinta; `confirmacionFisica: { gestionId, numGuia }[]` en el payload de la accion; y las
   claves de `fieldErrors`, que son **ids de gestion** y **no colisionan** con las de indemnizacion
   (afirmado con dos casos, no razonado).
3. **Tipografia de los seis mensajes** (ver T2). Si T4 pone tildes en el copy de la ventana, hay
   que cambiar los seis del servicio **y los cinco de la 158** a la vez.
4. **T5.1 (R39) no se hizo y hay una discrepancia que decidir.** El spec lo situa en
   `tests/unit/services/cierre-bodega-service.test.ts`, pero ahi vive el servicio del **mensajero**
   (solicitar); `aprobarCierreBodega` vive en `CierresBodegaAdminService`, y sus **tres** hermanos
   («la 42/43/44 no llega al nivel 2», «el contra-entrega tampoco») estan en
   `tests/unit/services/cierres-bodega-admin-service.test.ts`. Verificado de paso, que es lo que la
   afirmacion necesita: `CierreBodegaRepository` y `CierresBodegaAdminRepository` tienen **cero**
   apariciones de `confirmadaFisicaAt` y `confirmacionFisica`.
5. **El servidor de dev tiene el cliente Prisma viejo** (ver T3.1): hay que reiniciarlo antes de
   probar la pantalla a mano.

## Verificacion — salida real

```
$ pnpm exec tsc --noEmit
(sin salida; TSC_EXIT=0)

$ pnpm exec eslint <los 21 .ts/.tsx modificados o anadidos>
(sin salida; EXIT=0)

$ pnpm exec vitest run <las 23 suites que este cambio relaciona>
 Test Files  23 passed (23)
      Tests  343 passed (343)

$ pnpm exec vitest related --run lib/repositories/CierresAdminRepository.ts \
    lib/services/CierresAdminService.ts lib/types/gestion-retorno.ts \
    lib/types/cierres-admin.ts lib/actions/cierres-admin.ts \
    lib/interfaces/repositories/ICierresAdminRepository.ts
 Test Files  97 passed (97)
      Tests  1448 passed (1448)

$ pnpm run test:guardias
 Test Files  122 passed (122)
      Tests  1787 passed (1787)
```

**El gate completo (`./init.sh`) NO se corrio aqui**: lo corre el leader con el arbol quieto — el
gate y un subagente que muta el arbol no van en paralelo.

**Veredicto:** T1, T2 y T3 completas y verificadas por mutacion (13 mutaciones, 13 rojos leidos y
citados); el bloqueo del servidor esta vivo y **la pantalla (T4) es ahora la unica pieza que falta
para que un cierre con devoluciones se pueda aprobar**.

---

# Addenda backend — tildes y R39 (2026-08-19, tras la revision del leader)

Dos encargos cortos, los dos cerrados. **Sin commitear.**

## A · Los once mensajes llevan tilde

Decision del leader, resolviendo la que quedo abierta en la tanda anterior: **con tildes**, los
seis de la 238 y los cinco vecinos del mismo bloque, a la vez. El motivo esta escrito **donde se
toma**, en el comentario del bloque de `CierresAdminService.ts`: estos textos salen por
`fieldErrors` a la pantalla de bodega y **los lee una persona con el paquete en la mano**; el
2026-08-07 este repo encontro siete etiquetas mal escritas que doce mil tests daban por buenas
—entre ellas «Ordenes creadas»—, porque ninguna suite miraba el texto que lee un humano.

### Que cambio exactamente

De los **once** mensajes del bloque, **siete** necesitaban tilde y **cuatro ya estaban bien**:

| Constante | Antes | Ahora |
| --- | --- | --- |
| `MSG_INDEMNIZACION_FALTANTE` (158) | «…de indemnizacion…» | «…de indemnización…» |
| `MSG_CONFIRMACION_FALTANTE` (238) | «…la recepcion…» | «…la recepción…» |
| `MSG_CONFIRMACION_AJENA` (238) | «Esta gestion…» | «Esta gestión…» |
| `MSG_CONFIRMACION_DUPLICADA` (238) | «…se confirmo…» | «…se confirmó…» |
| `MSG_CONFIRMACION_GUIA_DISTINTA` (238) | «La guia leida…» | «La guía leída…» |
| `MSG_CONFIRMACION_SIN_GUIA` (238) | «…numero de guia… Avisa…» | «…número de guía… Avisá…» |
| `MSG_CATALOGO_ANCLAJE` (239) | «…el catalogo… esta incompleto…» | «…el catálogo… está incompleto…» |
| `MSG_MOTIVO_REQUERIDO` (38) | — | ya correcto, **sin tocar** |
| `MSG_INDEMNIZACION_AJENA` (158) | — | ya correcto, **sin tocar** |
| `MSG_INDEMNIZACION_DUPLICADA` (158) | — | ya correcto, **sin tocar** |
| `MSG_CONFIRMACION_INCIDENTE` (238) | — | ya correcto, **sin tocar** |

### El censo de superficies, que era el riesgo real

Se busco **cada uno de los once textos** por el arbol (`lib/`, `app/`, `components/`, `tests/`,
`e2e/`). Tres hallazgos que decidieron el alcance:

1. **`MSG_MOTIVO_REQUERIDO` tiene OCHO superficies** —tres servicios, tres componentes, dos specs
   de Playwright y un test de componente—. **No necesitaba tilde**, asi que no se toco ninguna. Si
   la hubiera necesitado, habria sido una ficha propia, no un efecto colateral de esta.
2. **`MSG_CATALOGO_ANCLAJE` parecia compartir texto con doce servicios** («catalogo de estados
   incompleto (seed pendiente)», que vive en `mensajes-incidente-admin.ts`,
   `mensajes-deshacer-asignacion.ts`, `GuiaAsignacionService`, `RecepcionSateliteService`,
   `AsignacionSateliteService`, `MisAsignacionesService`, `CierreDiaService`…). **No lo comparte**:
   su frase es propia («No se puede aprobar: el catálogo de estados está incompleto…») y **no tiene
   ninguna otra superficie ni ninguna asercion literal**. Por eso se pudo tildar sin arrastrar a
   los doce. **Esos doce siguen sin tildes y son deuda declarada, ajena a esta feature.**
3. **Ningun test comparaba estos textos contra la constante importada** (los once son `const`
   privadas del modulo, no exportadas), asi que no hubo que deshacer ningun «verde siempre».

### Dos mensajes que NADIE miraba, y ahora si

El censo encontro un agujero que el encargo no pedia pero que lo hacia inutil: dos de los siete
cambiados **no tenian ninguna asercion literal**, asi que se podian escribir mal —o borrar— sin
que la suite se enterara.

- `MSG_INDEMNIZACION_FALTANTE` solo lo miraba `toMatch(/falta el monto/i)`, **ciego justo a la
  parte que se escribe mal**. Se le anadio el `toBe` del texto completo en
  `tests/unit/services/cierres-admin-indemnizacion.test.ts`.
- `MSG_CATALOGO_ANCLAJE` **no lo miraba nadie**: la suite de la 239 solo comprobaba
  `status === "validation_error"`. Se le anadio el literal en `tests/unit/services/cierres-admin-service.test.ts`.

Los otros cinco ya estaban afirmados literalmente en la suite de la 238.

### Mutacion M14 — «se quitan las tildes de los once»

Aplicada quitando los diacriticos **solo de los literales** del bloque (no de los comentarios),
`vitest` ejecutado, salida leida, restaurada y verificada por `sha256`.

| sha256 antes / mutado / despues | Resultado |
| --- | --- |
| `33b5bd73` / `cd44a8ce` / `33b5bd73` | **8 casos rojos** en 3 archivos. Cada uno de los **siete** mensajes cambiados tiene al menos un caso que cae. |

Rojo citado tal cual:

```
FAIL tests/unit/services/cierres-admin-confirmacion-fisica.test.ts >
     R13: una gestion que vuelve SIN numero de guia bloquea con su mensaje propio
AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ]
- Expected
+ Received
  [
-   "Este paquete no tiene número de guía y no se puede confirmar. Avisá a un administrador.",
+   "Este paquete no tiene numero de guia y no se puede confirmar. Avisa a un administrador.",
  ]
```

y el que antes no existia:

```
AssertionError: expected 'Falta el monto de indemnizacion de es…'
              to be 'Falta el monto de indemnización de es…' // Object.is equality
```

### El resto del texto visible de esta tanda

Revisado: **no hay mas texto visible** en el diff del backend. Lo unico que queda sin tildes a
proposito es el mensaje de `ConfirmacionFisicaNoAplicableError` («confirmacion fisica no aplicable
a una gestion del cierre <id>»), que **no es texto de pantalla**: es el mensaje de una excepcion de
programacion/carrera que va a logs, hermano literal de `IndemnizacionNoAplicableError`, y su
contenido esta fijado por R44 (solo el id del cierre, sin PII).

## B · T5.1 (R39) — el cierre de bodega no hereda nada

**Puesto donde vive**, no donde lo situaba el spec.

**Discrepancia con `tasks.md`, declarada para el reviewer:** T5.1 dice
`tests/unit/services/cierre-bodega-service.test.ts`, pero ahi vive el servicio del **MENSAJERO**
(solicitar el cierre de bodega). `aprobarCierreBodega` vive en `CierresBodegaAdminService`, y sus
**tres hermanos** —«la 42 no llega al nivel 2», «la 43/44 tampoco», «el contra-entrega tampoco»—
estan en `tests/unit/services/cierres-bodega-admin-service.test.ts`. El caso nuevo se pone **junto a
ellos**, que es donde un lector lo va a buscar. **No es una tarea sin hacer.**

### El caso, y por que no es vacuo

`tests/unit/services/cierres-bodega-admin-service.test.ts`, tres casos con **tres frentes
distintos**:

1. **UNA sola llamada al repositorio, y es la transicion.** Se listan los metodos del doble con
   `mock.calls.length > 0` y se exige `["resolverCierreBodega"]`. Si alguien hiciera que el nivel 2
   exigiera la confirmacion, **tendria que leer el conjunto esperado de algun sitio**, y esa lectura
   seria una llamada mas.
2. **El input de la transicion es EXACTAMENTE el de siempre**: cuatro claves, ninguna de
   confirmacion. El literal es el contrato; una clave nueva lo pone rojo. El doble se **tipa** con
   `ResolverCierreBodegaInput` para que la comparacion sea contra lo que el servicio manda de
   verdad.
3. **Censo de texto** sobre `CierresBodegaAdminService`, `CierresBodegaAdminRepository` y
   `CierreBodegaRepository`: **cero** apariciones de `confirmacionFisica`, `confirmadaFisicaAt` y
   `confirmada_fisica_at`. Es el frente que caza el intento mas probable —«reutilizar» aqui la
   marca de la 238 sin pensar en que el paquete ya se confirmo en el nivel 1—.

La **razon de fondo** queda escrita en el propio caso: el nivel 2 agrega `cierre_dia` **ya
aprobados**, y cada uno paso por su confirmacion en el nivel 1; pedirla otra vez seria pedir
escanear dos veces el mismo paquete. Ademas ninguno de los dos repositorios del nivel 2 toca `orden`
ni el choke point.

### Mutaciones M15a y M15b — el caso se sabe romper

| # | Que se rompe | sha256 antes / mutado / despues | Rojo REAL |
| --- | --- | --- | --- |
| **M15a** | El nivel 2 «hereda» la 238: se anade `confirmacionFisica: []` al input de `resolverCierreBodega` | `cc172a7e` / `e2a17846` / `cc172a7e` | **2 casos.** `expected { id: 'cb1', ...(4) } to deeply equal { id: 'cb1', ...(3) }` y `lib/services/CierresBodegaAdminService.ts nombra confirmacionFisica: el nivel 2 no confirma paquetes (R39)` |
| **M15b** | Antes de aprobar, el nivel 2 **lee** algo mas del cierre | `cc172a7e` / `83aa8233` / `cc172a7e` | `expected [ 'findCierreBodegaConDetalle', ...(1) ] to deeply equal [ 'resolverCierreBodega' ]` |

El tercer caso (la aridad de `aprobarCierreBodega`) **se declara debil en su propio comentario**: un
parametro con default no la moveria. Esta ahi como senal barata, no como la prueba — la prueba son
(1) y (2).

## Verificacion de la addenda — salida real

```
$ pnpm exec tsc --noEmit
(sin salida; TSC OK)

$ pnpm exec eslint <los 6 archivos tocados en esta addenda>
(sin salida; ESLINT_EXIT=0)

$ pnpm exec vitest run <las 27 suites relacionadas, incluidas las de nivel 2 y las de componente>
 Test Files  27 passed (27)
      Tests  454 passed (454)

$ pnpm run test:guardias
 Test Files  122 passed (122)
      Tests  1787 passed (1787)
```

**Mapa `R<n>` → test, anadido:** **R39** → `tests/unit/services/cierres-bodega-admin-service.test.ts`
— «aprobar un CierreBodega NO pide confirmacion fisica» (mutaciones **M15a** y **M15b**).

**Veredicto de la addenda:** los once mensajes tildados con las siete correcciones que hacian falta
y **dos textos que nadie miraba ahora tienen su literal**; R39 cerrado donde vive, con dos
mutaciones que lo matan. Sigue faltando **solo T4**.

---

# Fix backend — el caso de R20 era verde por el estado ambiental (2026-08-19)

Rojo del gate en `tests/integration/db/confirmacion-fisica-migration.test.ts`. **El defecto estaba
en el test, no en el codigo**, y el codigo NO se toco. **Sin commitear.**

## Que estaba mal

El caso afirmaba, sobre la base real:

```sql
SELECT count(*) FILTER (WHERE "confirmada_fisica_at" IS NOT NULL) ...
  FROM "gestion_orden" WHERE "created_at" < TIMESTAMP '2026-08-19 00:00:00'
```
```ts
expect(Number(filas[0].con_marca)).toBe(0);
```

Eso codifica «gestion **creada** antes de la feature ⇒ **nunca** marcada», y es **falso por
diseno**: un cierre solicitado la semana pasada se aprueba hoy y sus gestiones —creadas antes— se
marcan hoy. **Ese es el camino feliz de la feature.**

Pasaba solo porque nadie la habia ejercido. En cuanto el leader aprobo un cierre real en la base
local (recorrido de T5.6) quedaron **12 gestiones marcadas**, todas creadas en julio/agosto, y el
caso cayo. En produccion habria caido con la **primera aprobacion de bodega**.

Es la cara opuesta del test que pasa sin datos: **un test verde por el estado ambiental**. Lo
escribi yo y no lo vi porque lo corri contra una base donde la feature aun no se habia usado.

## Que dice R20 de verdad, y que se afirma ahora

R20 es una propiedad de **la migracion** —no inventa confirmaciones, no hay backfill—, no una
propiedad de todo lo que pase despues. Se traduce en **dos invariantes** que siguen siendo ciertas
**con la feature en uso**:

1. **Ninguna marca es anterior a la migracion.** Distingue «lo escribio la app» de «lo invento un
   backfill»: un `UPDATE` masivo que copiara, por ejemplo, `cierre_dia.resuelto_at` de los cierres
   ya aprobados dejaria marcas con fecha **anterior a que la columna existiera**. El instante de
   referencia sale de `_prisma_migrations.finished_at`.
2. **Ninguna marca vive fuera de un cierre aprobado.** Es la invariante de la **escritura** (R17):
   la marca solo nace dentro de la transaccion de aprobacion, guardada por `estado = 'solicitado'`
   y que lo deja en `aprobado`.

### Por que LAS DOS, y no una — que era la pregunta

- **(1) sola no basta:** no ve un backfill ejecutado **despues** de la migracion; sus marcas
  llevarian `now()` y pasarian el filtro.
- **(2) sola no basta, y esto NO es hipotetico:** la medicion de T0.1 encontro en produccion **12
  cierres, los 12 `aprobado`, y 0 `solicitado`**. Un `UPDATE` a ciegas sobre esa base marcaria
  gestiones de cierres aprobados y seria **invisible** para (2).

Juntas cubren las dos formas que tiene el fallo de aparecer. Ninguna de las dos se relajo a
`toBeGreaterThanOrEqual(0)` ni se acoto a un corpus sembrado que esquivara el problema.

### Estabilidad de (2), verificada y no supuesta

(2) solo seria fragil si un cierre pudiera **salir** de `aprobado` dejando marcas detras.
Comprobado en `CierresAdminRepository`: `resolverCierre` esta guardado por
`ESTADOS_RESOLUBLES = ["solicitado"]` y la valvula de escape por
`ESTADOS_REABRIBLES = ["vencido", "rechazado"]` (`:61`). **Un cierre aprobado no vuelve a moverse**,
asi que la invariante no puede volverse falsa por uso normal.

### La anti-vacuidad, conservada y reforzada

Era la parte buena del caso viejo y se mantiene, en **tres** niveles:

1. **Hay gestiones que mirar** (`total > 0`), como antes.
2. **La migracion figura aplicada con su `finished_at`.** Sin esa fila, el `JOIN` de (1) no casaria
   y el contador daria cero **sin comparar nada** — un modo de vacuidad nuevo que el caso viejo no
   tenia. Se afirma explicitamente.
3. **Una AUTOCOMPROBACION que planta los dos backfills de mentira** dentro de una transaccion que
   **siempre se revierte**, y comprueba que los dos contadores los cazan. Las dos auditorias —la
   real y la plantada— llaman a **la misma funcion**: si cada una escribiera su SQL, podrian dejar
   de medir lo mismo sin que nada lo delatara.

### Un detalle de tipos que no es cosmetico

`confirmada_fisica_at` es `timestamp without time zone` (Prisma escribe UTC) y
`_prisma_migrations.finished_at` es `timestamptz`. Compararlos a pelo los convierte con el
**TimeZone de la sesion** —medido en esta base: **`America/Bogota`**—, y la comparacion se desviaria
cinco horas. El `AT TIME ZONE 'UTC'` los pone en el mismo marco. Queda escrito junto a la consulta.

## Mutaciones — las dos, con salida real

### M-DB · un backfill REAL en la base local (lo que pidio el leader)

`UPDATE` sobre **una** gestion sin marca, poniendole `2026-01-01` (fecha anterior a la migracion);
vitest corrido; deshecho y verificado. El **archivo de test no cambio** entre las tres corridas, y
su `sha256` lo demuestra: es la prueba de que el verde final no se consiguio tocando el test.

| | Estado de la base | `sha256` del test |
| --- | --- | --- |
| antes | `total 15, marcadas 12, primera 2026-08-20T00:02:14.828Z` | `f781118b` |
| con el backfill | `total 15, marcadas 13, primera 2026-01-01T00:00:00.000Z` | `f781118b` (sin tocar) |
| despues | `total 15, marcadas 12, primera 2026-08-20T00:02:14.828Z` | `f781118b` |

Rojo citado tal cual:

```
FAIL tests/integration/db/confirmacion-fisica-migration.test.ts >
     R20/R17: ninguna marca es anterior a la migracion ni vive fuera de un cierre aprobado
AssertionError: hay marcas con fecha ANTERIOR a que la columna existiera:
                eso solo lo produce un backfill: expected 1 to be +0 // Object.is equality
- Expected
+ Received
- 0
+ 1
```

Cayeron **dos** casos: el real y la autocomprobacion. Tras deshacer el `UPDATE`: **19 passed**.

### M16 · el modo de vacuidad, cazado por la autocomprobacion

Se rompe el `JOIN` de referencia (`migration_name = $1 || '_inexistente'`) para que el contador de
(1) de **siempre cero**.

| sha256 antes / mutado / despues | Resultado |
| --- | --- |
| `f781118b` / `418930f4` / `f781118b` | El caso REAL queda **verde** (vacuamente) y la **AUTOCOMPROBACION lo caza**: `AssertionError: expected 0 to be greater than 0` |

Eso es exactamente para lo que esta la autocomprobacion: sin ella, una auditoria mal escrita
—o una base sin la fila de la migracion— habrian dado verde para siempre.

## Revision del resto del archivo (y de los demas)

Preguntado a cada caso: **¿depende de que nadie haya usado la feature?**

| Caso | Depende del uso | Por que |
| --- | --- | --- |
| `R17/R20: existe, es NULLABLE y no tiene DEFAULT` | **No** | lee `information_schema`: forma del esquema, no datos |
| `no se creo ningun indice sobre la columna` | **No** | lee `pg_indexes` |
| los 15 casos estaticos (`migration.sql` / `down.sql` / `schema.prisma`) | **No** | regex sobre archivos |
| `R20/R17` (el reescrito) | **No** | las dos invariantes son ciertas con la feature en uso, y la anti-vacuidad no exige ni prohibe que haya marcas |
| `cierres-admin-retornables-sql-real.test.ts` (los 5) | **No** | siembra su propio corpus y afirma **solo sobre los ids que creo**, dentro de un cierre que acaba de crear; los datos ambientales no pueden colarse |

Lo que **si** sigue siendo ambiental —y es deliberado— es la exigencia de que la base tenga
catalogo y gestiones: sin eso, esos archivos **fallan con un mensaje que lo dice**, nunca pasan en
verde sin comprobar nada.

## Verificacion

```
$ pnpm exec tsc --noEmit
(sin salida; TSC OK)

$ pnpm exec eslint tests/integration/db/confirmacion-fisica-migration.test.ts
(sin salida; ESLINT_EXIT=0)

$ pnpm exec vitest run tests/integration/db/confirmacion-fisica-migration.test.ts
 Test Files  1 passed (1)
      Tests  19 passed (19)          # con las 12 marcas REALES en la base, no a pesar de ellas

$ pnpm exec vitest run tests/integration/db/
 Test Files  107 passed (107)
      Tests  1401 passed (1401)
```

**Mapa `R<n>` → test, corregido:** **R20** → `tests/integration/db/confirmacion-fisica-migration.test.ts`
— «existe, es NULLABLE y no tiene DEFAULT» + «ninguna marca es anterior a la migracion ni vive
fuera de un cierre aprobado» (mutaciones **M-DB** y **M16**). La redaccion anterior del mapa —«las
gestiones previas quedan en NULL»— describia el caso viejo y **ya no es lo que se afirma**.

**Veredicto:** el caso pasa **con** la base en su estado realista (un cierre aprobado, 12 marcas) y
se rompe ante un backfill plantado. La base local quedo como estaba.
