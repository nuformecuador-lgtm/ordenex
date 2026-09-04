# Ficha 371 — informe de revisión

**Rama:** `fix/371-corregir-fecha-reprogramacion` · **Revisado sobre HEAD `3e968f27`**
(el encargo decía `dd0cf2d9`; ver hallazgo m1) · **Base de comparación:** `origin/dev`
(`git diff origin/dev...HEAD` = 41 archivos de código y test + 2 de documentación).

**Veredicto: APROBADO.** Ningún hallazgo bloqueante. Cinco hallazgos menores, todos con nombre.

Aviso de método: el MCP `codebase-memory` **no aparece en el conjunto de herramientas de esta
sesión**. La navegación se hizo con `git diff`, lectura de archivos y `grep`. Se dice explícitamente,
como pide el arnés, y no fue motivo para parar.

---

## Checklist

### Especificación y trazabilidad (CHECKPOINTS §Especificación / §Trazabilidad)

- [n/a] `specs/371/{requirements,design,tasks}.md` — la ficha es **`sdd: false`**, así que la regla 2
  de `CLAUDE.md` («SDD obligatorio para toda feature con `sdd: true`») no aplica. No hay `R<n>`
  numerados que mapear y, por tanto, tampoco el mapa `R<n> → test` del checkpoint de trazabilidad.
- [x] `progress/impl_371-corregir-fecha-reprogramacion.md` **existe y está commiteado** (`3e968f27`).
  Sustituye al mapa `R<n> → test` por algo verificable: el contrato del borde, las tres trampas
  esquivadas, 18 mutaciones con su cuenta de tests caídos, y **un límite declarado sin adornos** —la
  mutación que quita el `FOR UPDATE` solo mata una guardia estática, porque el efecto de un lock no
  es observable en una suite secuencial—. Ese párrafo se comprobó y es cierto.
- [x] Las decisiones de contrato del humano están escritas donde se aplican, no solo en la ficha.

### Calidad de código (CHECKPOINTS §Calidad)

- [x] `./init.sh` completo: **no lo corrí yo** (instrucción explícita del encargo). Consta
  `INIT_EXIT=0`, 1707 archivos, 24.326 tests, 26 saltados y localizados, con `.env` presente. El acta
  mira el número de saltados y no solo el exit code, que es lo correcto: sin `.env` la capa de datos
  se salta entera y el gate canta verde igual.
- [x] Corrí yo, sobre el árbol final: **110 tests** de la ficha sin base (6 archivos), **32 contra
  Postgres real** (2 archivos, ejecutados, no saltados) y **175 tests** de los guardias y suites
  compartidas que la ficha toca (8 archivos). Todo verde.
- [x] TypeScript strict; sin `any` sin justificar en el código nuevo.

### Datos y seguridad (CHECKPOINTS §Datos)

- [x] **RLS en la tabla nueva**: `ALTER TABLE "gestion_fecha_reprogramacion_cambio" ENABLE ROW LEVEL
  SECURITY`, sin policies (patrón `orden_dia_reparto_cambio`), y **verificado contra la base
  aplicada** (`relrowsecurity = true`, `count(pg_policies) = 0`), no leyendo el `.sql`.
- [x] Migración con su `down.sql`. Ningún `down.sql` anterior se tocó: el diff no lista ni uno, y hay
  test que lo afirma.
- [x] Sin secretos y sin PII en logs. El aviso del fallo de liberación **no lleva el id de la orden**,
  y hay test que lo comprueba.
- [n/a] Webhooks: la ficha no introduce ninguno.

### Patrón de capas (CHECKPOINTS §Capas)

- [x] Server Action como borde (zod + sesión + fábrica del service); **no** ruta API, que es lo que
  manda `docs/architecture.md` para una mutación interna.
- [x] Service sin HTTP ni Prisma, con reloj inyectable y dependencias por constructor.
- [x] Repositorio solo queries. Las cinco guardas del `WHERE` son SQL, no reglas de negocio
  duplicadas.
- [x] Interfaces en `lib/interfaces/{services,repositories}/`, una por archivo.

### Permisos

- [x] Servicio: `esAccesoTotal(actor.rol)` (maestro/admin) **antes de leer nada** — un rol sin permiso
  no puede ni averiguar el estado de una orden ajena; hay test con los tres roles excluidos que
  comprueba que `findOrdenParaCorreccion` no llega a llamarse.
- [x] UI: el botón cuelga de `accionesDe`, que devuelve `[]` sin `accionesLote`, y la página resuelve
  `accionesLote = esAccesoTotal(rol)` en el servidor.
- [x] `reprogramada` es un estado seleccionable para maestro/admin (`EXCLUDE_POR_ROL` solo excluye
  `pendiente`), así que la pantalla es alcanzable de verdad.

### Multi-país / configuración

- [x] Sin país, moneda ni cuenta incrustados. El «hoy» se resuelve con el calendario de Costa Rica
  del repo (`fechaCalendarioCR` / `startOfDayCR`), nunca con `new Date()` a secas ni con el reloj del
  navegador.

---

## Los ocho puntos del encargo

### 1. La divergencia de la fecha — correcta en las dos capas, y medida

`esFechaCorreccionValida` / `fechaCorreccionSchema` (`lib/types/gestion-orden.ts`) exigen **hoy en
adelante**; `esFechaFutura` / `fechaFuturaSchema` **no se tocan** y siguen exigiendo mañana para el
registro del mensajero. Las dos reglas comparten la misma maquinaria de calendario y la diferencia es
exactamente un día: `fechaCalendarioCR(now)` frente a `mananaCalendarioCR(now)`.

- Borde: `lib/actions/corregir-fecha-reprogramacion.ts` usa `fechaCorreccionSchema`.
- Servicio: revalida con el mismo predicado y reloj inyectable.
- UI: `min={hoyISO}` con el «hoy» **bajado del servidor**, y el texto de ayuda lo dice
  («Puede ser hoy: al corregir sí se admite el día en curso»).

**Mutación propia:** cambiar el mínimo de `fechaCalendarioCR(now)` a `mananaCalendarioCR(now)` deja
**42 tests rojos en 4 archivos**, incluido el caso real 4→3. Revertida.

### 2. La correlación de la gestión vigente — compartida de verdad, no de palabra

`lib/repositories/gestion-reprogramada-vigente.ts` declara `GESTION_REPROGRAMADA_VIGENTE`
(`where` + `orderBy` + `take`) y `findGestionReprogramadaVigente`. El cron la **expande** en su
`select` anidado y la corrección la consume como consulta suelta, además **dentro de su propia
transacción** y no solo en el pre-chequeo.

- **Guardia** (`tests/unit/guards/correccion-fecha-reprogramacion.guardia.test.ts`): prohíbe la
  correlación escrita en línea en **cualquier** archivo de `lib/**`, exige que los dos consumidores la
  importen, y **el detector se prueba a sí mismo** con dos contrapruebas (reconoce una copia; no se
  dispara con otro `orderBy`).
- **Paridad contra Postgres**: el escenario siembra **tres** gestiones —una anulada con fecha señuelo,
  una viva antigua y una viva más reciente— y compara la que elige la correlación compartida con la
  que proyecta el camino del cron (`findOrdenesLiberablesDeOrden`). La más reciente lleva fecha
  **vencida** y la vieja una **futura**, así que equivocarse no devuelve «otra fila plausible»:
  devuelve lista vacía. Eso es lo que hace discriminante la aserción.

**Mutación propia:** `orderBy` de `desc` a `asc` deja rojos «con DOS gestiones vivas…», «PARIDAD…» y
la guardia. Revertida.

### 3. La puerta 276 — se reusa el camino, no se escribe uno paralelo

`liberarOrdenCorregida` es el mismo `resolverContexto` y el mismo bucle `liberarCandidatas` —donde
vive `if (!puedeLiberarse(orden))`— con las candidatas acotadas por PK.
`findOrdenesLiberablesDeOrden` es el **mismo cuerpo** de `buscarLiberables` con un tercer alcance en
la unión `AlcanceLiberacion`; el filtro de fecha, los tres hechos proyectados y la correlación son los
de siempre. El adaptador no puede decidir liberar: la guardia afirma que no menciona `puedeLiberarse`
ni `liberarOrden(`.

Medido contra Postgres, con cada caso y su contrario en la misma corrida:

| escenario | desenlace | estado final de la orden |
|---|---|---|
| visita real + cierre `aprobado`, a hoy | `liberada` | `en_bodega_central`, mensajero a `null`, `prioridad = true`, `liberadaReprogramadaAt` puesto |
| visita real + cierre `solicitado`, a hoy | `espera_cierre` | sigue en `reprogramada`, **y la fecha sí quedó corregida** |
| escritorio (gestión sintética), sin cierre, a hoy | `liberada` | `en_bodega_central` |
| a fecha futura | `espera_fecha` | sigue en `reprogramada` |

### 4. Los tres desenlaces llegan a la pantalla — sí, y el difícil dice qué falta

`liberacion` viaja en el resultado del service, cruza el borde tal cual y la pantalla lo pinta en un
panel **que se queda**: el modal no se cierra al corregir, el botón que escribe desaparece y queda
«Cerrar». El tono cambia por desenlace, y `espera_cierre` no se pinta como un éxito redondo.

El texto de `espera_cierre` —el de las 7 de 31— es:

> «Fecha corregida: del 4 de septiembre al 3 de septiembre. La orden todavía NO vuelve a la bodega:
> falta que se apruebe el cierre donde el mensajero reportó esa reprogramación. En cuanto se apruebe,
> la orden vuelve sola.»

**Juicio:** cumple. Dice (a) que la corrección sí ocurrió, (b) que la orden sigue retenida, (c) qué
falta y quién lo desbloquea, y (d) que no hay que volver a hacer nada. Español claro, sin siglas, sin
nombres de columna y sin fechas en formato ISO a la vista: van en palabras. Los rechazos siguen la
lección de la 241 —cada uno dice su causa y **solo la carrera invita a reintentar**— y el estado se
nombra con su etiqueta legible, no con su `value`.

Los tests del modal escriben los tres textos **a mano** en vez de importarlos del módulo que los
produce, con el motivo escrito en la cabecera. Es exactamente la cicatriz «aserción contra su propia
fuente», cerrada a propósito.

### 5. El rastro, y que no mienta — correcto

- La foto va **antes**: el `SELECT … FOR UPDATE` y después el `UPDATE`. La guardia compara posiciones
  en el archivo; el test contra Postgres lo mide por el efecto (la fila del rastro dice
  `fecha_anterior = 2026-09-04`, no `2026-09-02`).
- **Las dos escrituras van en la MISMA transacción** que la corrección:
  `registrarCambioFechaReprogramacion(tx, …)` y `appendAccion(tx, …)`, las dos con el `tx`, después de
  que el `UPDATE` guardado devuelva exactamente una fila. El `return null` de la carrera va **antes**
  de los dos rastros, así que una corrección que no ocurrió no deja ni una fila en ninguna tabla.
- Choke point único de escritura, con guardia que prohíbe un segundo punto de inserción en `lib/**` y
  que la tabla deje de ser append-only.
- El motivo **no cruza** a `historial_accion` —hay test que serializa la fila y comprueba que no
  aparece— y sí queda en la tabla propia, ya recortado.
- La categoría `hace_desaparecer` está argumentada por lo que de verdad pasa (corregir a hoy puede
  sacar la orden de `reprogramada` en el acto), no por «se pierde la fecha vieja», que era falso y se
  reescribió en los tres sitios donde estaba.

**Mutación propia:** quitar del `WHERE` la guarda por `estatus_id` de la orden deja rojo «una carrera
perdida no deja rastro huerfano» en el archivo de integración. Es decir: **el `WHERE` está probado
donde vive**, no solo con dobles. Revertida.

### 6. La migración — segura, y verificada por ejecución

`ALTER TYPE … ADD VALUE IF NOT EXISTS` más `CREATE TABLE` en el mismo archivo, y por tanto en la misma
transacción de Prisma. Lo que Postgres prohíbe (55P04) es **usar** el valor nuevo en esa transacción;
el `CREATE TABLE` no lo nombra. El test lo verifica sin complacencia: filtra comentarios, exige **cero
sentencias `INSERT`/`UPDATE`/`DELETE`** mirando comienzos de sentencia —para no denunciar el
`ON DELETE RESTRICT` de una FK— y exige que el literal aparezca **exactamente una vez** en todo el
archivo.

Evidencia adicional de que funciona: la suite contra la base aplicada leyó `pg_enum` y encontró los 44
valores, con el nuevo el último y el de la 366 el penúltimo. Eso solo ocurre si la migración se aplicó
de verdad.

`down.sql`: suelta la tabla **antes** de recrear el enum, y la lista previa del `CREATE TYPE` **no se
escribe a mano en la aserción**: se compone del `migration.sql` de la 362 más el valor de la 366, que
son otros archivos, con anti-vacuidad. La precondición del rollback está escrita en el propio archivo
y su fallo es ruidoso, no silencioso.

### 7. Que los tests midan — sí, y las cuatro cicatrices están cerradas

- **El `return` silencioso en integración**: no existe. `fksDeOrden === null` **lanza** con
  instrucciones, y el catálogo de estados incompleto también. Sin base alcanzable el archivo entero se
  salta con `describe.skip`, que se ve en la salida.
- **Aserción contra su propia fuente**: los textos de usuario van a mano en los tests de UI; lo único
  que se importa son las constantes de protocolo (los motivos tipados del `conflict`), que sí son el
  contrato entre service y pantalla.
- **`toEqual` literal**: los que hay son contrato (lista de columnas de la tabla, lista de infractores
  vacía, reparto por categoría con números duros) y están razonados en el sitio.
- **El `WHERE` probado solo con dobles**: cerrado, y confirmado por mi mutación.
- Además: el censo de escrituras de `historial_accion` gana una entrada con **regex de mutación**
  sobre la escritura cruda, que es lo que impide devolverla a un `updateMany` sin ponerse rojo.

**Mis tres mutaciones: cero supervivientes.** Árbol restaurado y verificado limpio (`git status` solo
muestra el `design-etiquetas/` sin rastrear que ya estaba antes).

### 8. Alcance — limpio

No se toca el registro de reprogramación del mensajero (`fechaFuturaSchema` y `esFechaFutura` intactos;
solo se **añaden** símbolos a su lado), ni la columna «Reprogramada para» —se **lee** el
`fechaReprogramacion` del DTO que ya existía—, ni `/novedades`. `db/schema.prisma` solo suma un modelo,
tres relaciones inversas y un valor de enum. `feature_list.json` solo añade la ficha 371. Los cambios
en tests ajenos son de contrato (el doble del repositorio gana el tercer método y, en el archivo
contra Postgres, **delega al repositorio real** en vez de devolver una lista vacía) o de conteo
(43 a 44), nunca de aflojamiento.

---

## Hallazgos

### `menor` m1 — el HEAD del encargo estaba a un commit de distancia

El encargo fija HEAD en `dd0cf2d9`; durante la revisión el árbol ya estaba en **`3e968f27`**
(`docs(371): acta de implementacion y la nota corregida por el motivo`, empujado). Toca
`progress/impl_371-corregir-fecha-reprogramacion.md` (nuevo) y una línea de `status_note`. **No toca
código**, así que la revisión vale para los dos estados. Se anota porque es la familia «el pre-vuelo
caduca»: se comprobó, no se supuso.

Corolario: **el aviso del encargo sobre la `status_note` ya no aplica**. La nota en la rama dice «EL
MOTIVO ES OBLIGATORIO … hereda su MISMA regla, `motivoSchema`», alineada con lo entregado.

### `menor` m2 — el `down.sql` no se ejecutó

CHECKPOINTS pide que «`pnpm run db:rollback` funciona». Aquí está **verificado como texto** contra sus
dos fuentes (la 362 y la 366) y con su orden inverso comprobado, pero **no ejecutado**: correrlo sobre
la base local soltaría la tabla y recrearía el enum con otros árboles de trabajo vivos en la máquina,
que es justo el problema de `base-local-compartida-rompe-gates-ajenos`. Queda dicho para que nadie lo
dé por medido.

### `menor` m3 — el motivo se escribe y hoy nadie lo lee

`gestion_fecha_reprogramacion_cambio` no tiene ningún lector en la aplicación: la fila de
`historial_accion` muestra las dos fechas y el actor, pero **el motivo solo se recupera con SQL**. Es
idéntico al molde 262 (`orden_dia_reparto_cambio` tampoco se lee), así que es coherente y no es un
defecto de esta ficha; conviene que esté nombrado antes de que alguien lo descubra el día que lo
necesite.

### `menor` m4 — el texto del desenlace se queda corto si la liberación revienta

Si la corrección a HOY se escribe y después la liberación lanza, el fallo se absorbe —con aviso y sin
PII, que es lo correcto: revertir perdería el arreglo que el coordinador acaba de hacer— y el
desenlace devuelto es `espera_fecha`. La pantalla dice entonces «La orden espera a ese día: vuelve
sola a la bodega cuando llegue» sobre un día que **ya es hoy**: cierto en el fondo, porque la corrida
de las 00:00 CR es la red, pero impreciso hasta en un día. Es un camino de excepción (caída de base) y
está documentado en el código. Se anota; no se pide cambiar.

### `menor` m5 — dos cosas de cierre, no de implementación

- El título del caso de la migración dice «sus **siete** columnas» y la aserción lista **ocho**.
  Cosmético.
- Falta la entrada en `progress/history.md`, que en este repo se añade al cerrar la ficha (sigue
  `in_progress`). No es deuda del implementer: es el paso siguiente del leader.

---

## Veredicto

**APROBADO.** La ficha entrega lo que su encargo pedía, esquiva las tres trampas que la habrían hecho
inútil o silenciosamente falsa, y —lo que más pesa— **sus tests miden**: tres mutaciones propias,
elegidas contra las tres propiedades caras (la fecha mínima, la correlación con el cron y la guarda de
estado del `UPDATE`), murieron todas, y una de ellas solo la caza el archivo contra Postgres. Los
cinco hallazgos son menores y ninguno devuelve trabajo al implementer.
