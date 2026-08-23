# Feature 271 — Diseño

> Lee antes `requirements.md`. Este archivo decide **cómo**, y sólo se aparta de él para explicar por
> qué una alternativa razonable se descartó.

---

## §1 — La forma del cambio, en una frase

**No hay tabla nueva, no hay columna nueva y no hay migración de datos.** Lo único que toca la base es
**una migración de enum** para dos valores de `NotificacionEvento` (§9.2). Todo lo demás es un
**cambio de predicado** —de «¿tiene alguno de estos estados?» a «¿cuántos, y cuántos de ellos son
re-solicitables?»— más el cableado de ese predicado a **dos superficies que hoy no lo consultan**
(asignación de reparto, central y satélite) y la corrección de **tres fallos mudos** que el cambio
vuelve alcanzables.

### §1.1 — Lo que se levanta

| Ancla | Hoy | Después |
| --- | --- | --- |
| `CierreDiaService.ts:506` | `existeCierreSolicitado` → `conflict`. Impide el 2.º `solicitado`. | Se sustituye por el gate **LIBRE/BLOQUEADO** (§4). |
| `CorteDiarioRepository.ts:12` | `ESTADOS_CIERRE_ABIERTOS` **resta** del corte a quien tiene cierre abierto. | Deja de restar. La constante desaparece (§6). |
| `OrdenRepository.ts:328` | `ESTADOS_CIERRE_BLOQUEAN_GESTION = ["vencido","rechazado"]`. | Sustituida por el conteo N/V (§2). |
| `OrdenRepository.ts:3224` | `findMensajerosConCierreAbierto`, **privado**, `Set<string>`. | Se **transforma** en el contador público (§2). No se crea un predicado nuevo al lado. |

---

## §2 — El predicado: un contador, no una lista de estados

### §2.1 — Un helper puro con la regla, y sólo la regla

`lib/utils/bloqueo-cierre.ts` (nuevo, **puro**: sin Prisma, sin borde, patrón `colas-cierre.ts`):

```ts
export interface ConteoCierresAbiertos {
  /** N — cierres del mensajero sin aprobar. */
  n: number;
  /** V — cuántos de esos N son RE-SOLICITABLES (`vencido` o `rechazado`). */
  v: number;
}

/** LA REGLA (feature 271, dictada el 2026-08-23): libre si N<=1 y V=0. */
export function estaBloqueadoPorCierres(c: ConteoCierresAbiertos): boolean {
  return c.n >= 2 || c.v >= 1;
}

export const CIERRE_ESTADOS_ABIERTOS = ["solicitado", "vencido", "rechazado"] as const;
export const CIERRE_ESTADOS_RESOLICITABLES = ["vencido", "rechazado"] as const;
```

**Por qué un helper puro y no un método más del repositorio:** la regla se afirma en tests de tabla
(las 7 filas de la tabla de verdad) sin base de datos, y la consultan **el servidor y la pantalla**
sin que la segunda tenga que re-derivarla (**R10**). Es el mismo patrón con el que `colas-cierre.ts`
resolvió «un criterio, dos capas».

### §2.2 — El contador, en el repositorio

`findMensajerosConCierreAbierto` deja de ser `private` y de devolver `Set<string>`:

```ts
// OrdenRepository — transformación de `:3224`, NO un método nuevo al lado.
async contarCierresAbiertosPorMensajero(
  ids: string[],
): Promise<Map<string, ConteoCierresAbiertos>>;
```

**Una sola consulta** para el lote entero: `groupBy(["mensajeroId","estado"])` con
`where: { mensajeroId: { in: ids }, estado: { in: CIERRE_ESTADOS_ABIERTOS } }`. Usa el índice
`(mensajero_id, estado)` que ya existe (`schema.prisma:1102`), y de un grupo por estado salen N y V
sin segunda ida a la base. Un mensajero sin filas **no aparece** en el `Map`; el llamador lo lee como
`{ n: 0, v: 0 }`.

Sobre él, dos derivados públicos:

```ts
/** Los BLOQUEADOS del lote (gestionar/cobrar Y recibir reparto). Sustituye a `findMensajerosBloqueadosParaGestion`. */
async findMensajerosBloqueadosPorCierres(ids: string[]): Promise<Set<string>>;

/** El detalle de UN mensajero, para el aviso: N, V, cuál toca y quién lo resuelve. */
async findBloqueoDetalle(mensajeroId: string): Promise<BloqueoDetalle>;
```

### §2.3 — El renombrado no es cosmético

`findMensajerosBloqueadosParaGestion` **pasa a llamarse** `findMensajerosBloqueadosPorCierres`. El
nombre viejo decía **para qué** bloqueaba, y esa era su virtud (feature 241): un service de asignación
no podía llamarlo sin escribir «ParaGestion» en una acción que no gestiona. Ese alcance **cambia**, y
dejar el nombre viejo mientras la asignación lo consulta es exactamente la incoherencia que la 241
persiguió. El nombre nuevo dice **por qué** bloquea, no para qué, porque ahora bloquea **todo**.

**Y con la decisión de Q1, el mecanismo del tipo deja de estorbar y pasa a ayudar.** La 241 protegía
la asimetría con el `Pick<IOrdenRepository, …>`: mientras el método no estuviera en él, ese service
**no podía** consultarlo aunque el doble de test lo ofreciera. Con la excepción de recolección viva,
ese mecanismo **no habría servido** —`asignarDesdeBodega` y `asignarRecoleccion` viven en el **mismo**
`GuiaAsignacionService` y comparten `Pick`, así que el tipo no podía distinguirlas—. Resuelta Q1, la
distinción desaparece: **las dos deben consultarlo**, el método vuelve al `Pick` de los dos services
de asignación, y no hace falta ninguna guardia que proteja una excepción que ya no existe.

**Un solo predicado, todas las superficies.** Si mañana alguien quiere volver a exceptuar algo,
tendrá que sacarlo del `Pick` **y** escribir por qué, que es exactamente la fricción que se busca.

### §2.4 — El detalle que alimenta los avisos

```ts
export interface BloqueoDetalle {
  bloqueado: boolean;
  /** N */ cierresAbiertos: number;
  /** V — los que el mensajero puede reenviar por su cuenta. */ cierresPorReenviar: number;
  /** El MÁS VIEJO (R11). `null` si N = 0. */
  aResolverPrimero: {
    cierreId: string;
    estado: "solicitado" | "vencido" | "rechazado";
    solicitadoAt: Date;
    /**
     * La JORNADA que ese cierre cierra, en fecha de Costa Rica (§10.1-bis, R57-R60).
     * NO es `solicitadoAt` ni `createdAt`: para un `vencido` van un día por delante.
     * `null` = no hay jornada fiable -> el texto OMITE la fecha (R60).
     */
    jornadaCR: string | null;
    /** Quién tiene la pelota: el mensajero si es re-solicitable, la administración si es `solicitado`. */
    resuelve: "mensajero" | "administracion";
  } | null;
}
```

Orden **`solicitadoAt` ascendente, desempate por `id` ascendente** (**R11**). El desempate no es
paranoia: el corte crea cierres en bucle dentro del mismo segundo, y `solicitado_at` tiene
`@default(now())` por fila pero la resolución puede repetirse. Un orden inestable haría que «el que
toca resolver» cambiara entre dos cargas de la misma pantalla.

---

## §3 — Modelo de datos

### §3.1 — Lo que NO se toca, y por qué importa decirlo

- **Ninguna tabla nueva.** No hay `RLS` que añadir (`docs/architecture.md`: «tablas nuevas sin RLS»
  es anti-patrón; aquí no hay ninguna).
- **Ninguna columna nueva en `cierre_dia`.** En particular **ninguna `fecha_jornada`**: es el modelo
  que el humano descartó, y `requirements.md` explica por qué no vuelve.
- **Ningún índice nuevo.** El contador de §2.2 usa `(mensajero_id, estado)`, que existe desde la 41.
- **Ningún índice único que imponga «un cierre abierto por mensajero».** Hoy no existe (verificado:
  cero `CREATE UNIQUE INDEX` sobre `cierre_dia` en todo `db/migrations/`) y **no se crea**: sería
  imponer en la base el invariante que **R9 deroga**.
- **Ningún backfill.** Ninguna fila existente cambia al desplegar (**R55**).

### §3.2 — Lo único que toca la base

Una migración **aditiva de enum**, en `db/migrations/<ts>_notificacion_evento_bloqueo_cierre/`:

```sql
ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'cierre_dia_vencido';
ALTER TYPE "notificacion_evento" ADD VALUE IF NOT EXISTS 'mensajero_bloqueado_por_cierres';
```

- **`notificacion_entidad_tipo` NO se toca:** `cierre_dia` ya está en el inventario
  (`schema.prisma:2090`) y es la entidad correcta para los dos eventos.
- **Va sola y con timestamp propio.** Postgres no permite usar un valor de enum recién añadido en la
  misma transacción que lo añadió (`55P04`) y Prisma Migrate corre cada `migration.sql` en una.
  Precedente: 253, 262, 240, 237, 239.
- **`down.sql` — la pregunta obligatoria de este repo, hecha y respondida.** «¿El down de la
  migración que **creó** el enum recrea-con-lista o sólo dropea?»
  · `20260727120000_notificacion/down.sql` (la que lo creó): **sólo dropea** (`DROP TYPE IF EXISTS`),
    porque allí se van también las tablas. **NO se toca**: es una foto histórica.
  · `20260820210000_notificacion_evento_postulacion_recurso/down.sql` (253) y
    `20260822140000_notificacion_evento_dia_reparto_corregido/down.sql` (262): **recrean con lista**,
    y su lista es «el enum antes de SU migración», que sigue siendo cierta. **NO se tocan**
    («migración editada en sitio = drift»).
  · **Éste** es el único down que debe conocer la lista de hoy: recrea `notificacion_evento` con los
    **seis** valores vigentes (los 4 de la 146 + el de la 253 + el de la 262) y **no toca**
    `notificacion_entidad_tipo`.
- **Precondición ruidosa del down:** ninguna fila de `notificacion` con `evento` en los dos valores
  nuevos. Si la hay, el `USING` del `ALTER COLUMN` **falla y aborta el rollback**. Es el
  comportamiento correcto: esas filas son avisos que un mensajero puede no haber leído. **Ni un
  `DELETE` ni un `UPDATE` para «hacer sitio».**
- **Índices que mencionan la columna:** `notificacion_entidad_idx` y `notificacion_dedupe_key`
  (`UNIQUE … NULLS NOT DISTINCT WHERE entidad_id IS NOT NULL`). En los dos, el enum entra como
  **columna** y no en un predicado contra literal, así que `ALTER COLUMN … TYPE` los reconstruye
  solo. Que el `NULLS NOT DISTINCT` y el `WHERE` parcial **sobrevivan no se supone**: se mide contra
  Postgres real, igual que hicieron la 253 y la 262 (tarea **T10.4**).

---

## §4 — Solicitar cierre

`CierreDiaService.solicitarCierre` queda con **cuatro** ramas, en este orden:

```
1. rol != mensajero                                   -> forbidden
2. hay cierre RE-SOLICITABLE (vencido o rechazado)    -> RE-SOLICITUD (§5). EXENTA del gate.
3. BLOQUEADO (N>=2, V=0)                              -> conflict con motivo explicado (R15)
4. flujo de creación de la 37, intacto                -> crea el 2.º `solicitado` (R13/R14)
```

- **La rama 2 va primero y sigue exenta** de «sin pendientes» y del gate nuevo: es el anti-deadlock de
  111/R9. Si no fuera primero, un mensajero con `N=2, V=1` no tendría salida (**R16**).
- **La rama 3 sustituye a `existeCierreSolicitado`** (`:506`). Ya no pregunta «¿tienes uno?» sino
  «¿estás bloqueado?». Con `N=1, V=0` responde que no, y por eso el segundo cierre se crea (**R13**).
- **La rama 4 no cambia ni una línea de dinero.** Precondición de pendientes, `MSG_VACIO`,
  `computeTotales`, `derivarPagos`, `derivarIngresoBodega` y `crearCierre` quedan como están. Lo que
  hace que el segundo cierre se lleve **sólo lo de hoy** es el `where: { cierreId: null }` que ya
  existe (`CierreDiaRepository.ts:686`) — **R14 sale gratis, no se programa**.

**El motivo de la rama 3 es texto compuesto, no fijo** (**R15**, **R43**): lo produce el mismo
formateador que el aviso (§10.1), a partir de `BloqueoDetalle`.

---

## §5 — La re-solicitud: una rama, no dos

Hoy hay dos ramas gemelas (`existeCierreVencido` → `transicionarVencidoASolicitado`, y su copia para
`rechazado`) y **eligen por estado, no por edad**. Con dos cierres re-solicitables eso rompe dos
cosas a la vez: el orden «del más viejo al más nuevo» (**R18**) y el conteo de filas (**M2**).

**Se unifican en una:**

```ts
// ICierreDiaRepository
/** El cierre RE-SOLICITABLE más viejo del mensajero, o null. */
findCierreResolicitableMasViejo(mensajeroId: string): Promise<{ id: string; estado: CierreEstado } | null>;

/** Transiciona ESE cierre a `solicitado`. Guardado por (id, estado). `count === 1` o nada. */
transicionarASolicitado(cierreId: string, estadoEsperado: CierreEstado): Promise<boolean>;
```

El `updateMany` pasa a llevar **`id` en el `where`**:
`where: { id: cierreId, estado: estadoEsperado }` → como `id` es la clave primaria, `count` sólo
puede ser `0` o `1`. **`count === 1` vuelve a significar lo que dice** (**R19**), y el anti-TOCTOU por
estado se conserva intacto.

- **`transicionarVencidoASolicitado` y `transicionarRechazadoASolicitado` desaparecen**, no se
  parchean. Dejar una de las dos «por si acaso» conserva el `updateMany` sin `id`, que es el fallo.
- **Money-safe (R20):** el `data` sigue siendo `{ estado: 'solicitado' }` y nada más.
- **El aviso de la re-solicitud recibe el `cierreId` que acaba de transicionar** —ya lo tiene en la
  mano— en vez de releerlo con `findCierreSolicitado`. **Eso cierra M9** (**R56**):
  `findCierreSolicitado` deja de usarse para componer avisos, porque su `orderBy createdAt desc`
  devuelve el cierre equivocado en cuanto hay dos `solicitado`.

**Sobre el caso «dos `vencido`»:** no se escribe ningún caso de test para él. Es **inalcanzable** por
el invariante derivado (**R17**), y un test de un estado imposible es un test que nunca puede fallar
por la razón correcta. El caso que **sí** se prueba, con los cuatro pasos, es **dos `rechazado`**
(tarea **T3.4**).

---

## §6 — El corte diario

`CorteDiarioRepository.findMensajerosConActividadSinCierre` pierde su tercer paso: la consulta a
`cierre_dia` y el `filter(!bloqueados.has(...))` de `:105-116` **se borran**, y con ellos la constante
`ESTADOS_CIERRE_ABIERTOS` de `:12`. El método pasa a devolver la unión de (a) actividad sin cerrar y
(b) órdenes que barrer, **sin restar a nadie**.

**No se añade ninguna condición nueva** (**S3**, matizado por el humano):

- Un mensajero **que aún no estaba bloqueado** y que no cerró su día recibe su `vencido`. Es como
  aparecen los casos 5 y 6.
- Un mensajero **ya bloqueado** entra en el bucle, pero **no tiene nada que cerrar**: el corte que lo
  bloqueó ya barrió sus órdenes a `sin_gestionar` en la misma transacción y vinculó sus gestiones. La
  guarda «algo pasó» de `crearCierre` (`CierreDiaRepository.ts:695`) hace `rollback → null` y
  `vencidosCreados` no sube (**R22**). **Esto es lo que hace que R17 se sostenga solo.**
- Un mensajero con un `solicitado` de ayer que **trabajó hoy** y no cerró: entra, tiene gestiones con
  `cierre_id` nulo, y **recibe su segundo cierre**. Es exactamente el caso del cierre `79cb2c0f`.

**Coste:** el corte evalúa más mensajeros que antes. Se mide en la tarea **T3.5** y se acota: el bucle
hace 3 consultas por mensajero evaluado antes de decidir, y el universo son los mensajeros con
actividad, no todos.

---

## §7 — Las superficies: cuál cambia y cuál NO

> Esta tabla es el corazón del riesgo. **El incidente del 18/08 fue tocar «el bloqueo» creyendo que se
> tocaba sólo la asignación** y apagar de paso gestionar, recoger, escoger, deshacer y la recolección
> en tienda. Aquí se enumeran **todos** los call sites, uno por uno.

### §7.1 — Gestionar y cobrar — **cambia el predicado, NO el conjunto de superficies**

| Call site | Acción | Antes | Después |
| --- | --- | --- | --- |
| `MisAsignacionesService.ts:175` | entregar / escoger / recoger | `vencido`∨`rechazado` | **regla N/V** |
| `CierreDiaService.ts:592` | `deshacerGestion` | `vencido`∨`rechazado` | **regla N/V** |
| `RecoleccionTiendaService.ts:101` | recolectar en tienda (cobra) | `vencido`∨`rechazado` | **regla N/V** |
| `lib/actions/cierre-dia.ts:100` | `estadoBloqueoMensajero` (aviso) | booleano | **`BloqueoDetalle`** (§2.4) |

Las tres primeras sólo cambian **a qué predicado llaman**. **Ninguna superficie se añade ni se quita
aquí**, y ese es el punto: con `N=1, V=0` (cierre `solicitado`) siguen permitidas (**R26**), que es la
mitad de la regla de la 241 que **sobrevive**.

⚠️ **`RecoleccionTiendaService.ts:42` (`MSG_BLOQUEADO`) se queda corto y entra en §10.3.** Dice
*«Tenés un cierre pendiente sin resolver»*, y con la regla nueva hay un caso —acumulación, `N ≥ 2`,
`V = 0`— en el que **no hay nada sin resolver por parte del mensajero**: sus dos cierres están
enviados y esperando al administrador. Un mensaje que le atribuye una tarea que no tiene lo manda a
buscar un botón que no existe.

### §7.2 — Recibir trabajo nuevo — **las TRES escrituras empiezan a bloquear**

> Esto es lo que **revierte** la regla firmada del 20/08, y desde la resolución de **Q1** (2026-08-23)
> alcanza también la recolección. **No hay excepción, no hay asimetría, no hay «solo reparto».**

| Call site | Qué es | Cambio |
| --- | --- | --- |
| `GuiaAsignacionService.asignarDesdeBodega` (`:332-347`) | asignación de **reparto**, bodega central | **Se repone una guarda** de bloqueo, con el predicado N/V, **antes** de cualquier escritura. Todo-o-nada con el `detalle` por orden que ya usan las demás guardas (**R28/R30**). |
| `AsignacionSateliteService.asignar` (`:106-120`) | asignación de **reparto**, bodega satélite | **Idem** (**R29**). Es **donde ocurrió el incidente del 18/08**. |
| `GuiaAsignacionService.asignarRecoleccion` (`:462-466`, acción `lib/actions/ordenes-guia.ts:125`) | asignación de **recolección** en tienda | **Idem** (**R31**). El bloque «R7 RETIRADA» de esas líneas es el hueco exacto donde vuelve la guarda. |
| `lib/actions/ordenes-guia.ts:165` `listarMensajerosParaAsignacion` | selector del maestro (alimenta los **dos** modales) | Vuelve a devolver bloqueados, con el nombre **`bloqueadosIds`** (**R32**). |
| `lib/actions/recepcion-satelite.ts:290` `listarMensajerosSatelite` | selector del adminSatélite | **Añade** `bloqueadosIds`. Hoy **no devuelve nada** de esto: es la mitad que faltaba. |

**Por qué el campo se llama `bloqueadosIds` y no `bloqueadosParaRepartoIds`:** porque ya no hay dos
respuestas. Un nombre que califica el alcance invita a preguntarse cuál es el otro alcance, y en este
caso no lo hay.

**La única superficie que NO bloquea, y por qué:** `FiltrosEntregas.tsx:72` usa la misma acción como
**filtro del listado** (**R33**). Filtrar no es asignar: un mensajero bloqueado sigue teniendo órdenes
en la mano que alguien necesita buscar, y esconderlo del filtro las volvería inalcanzables.

⚠️ **La guarda de recolección NO nace en el vacío.** Dos líneas más abajo del hueco, en
`GuiaAsignacionService.ts:468`, esa misma acción ya consulta `findMensajerosConOrdenesEn` para
aplicar la **regla de dedicación** (feature 157): quien lleva reparto no recibe recolección, porque
*«reparto y recolección se excluyen mutuamente»*. Es una regla **separada** de este bloqueo y esta
ficha **no la toca**, pero explica por qué la excepción no protegía nada: reparto y recolección son la
**misma jornada de trabajo**, así que dejar entrar una de las dos a un mensajero bloqueado le daba
exactamente el trabajo que no puede ejecutar.

⚠️ **El `NOT EXISTS` del UPDATE crudo.** La 241 lo quitó de `asignarSateliteLote` porque lectura y
escritura decían cosas distintas y el adminSatélite recibía «Actualiza la lista y vuelve a
intentarlo», que era falso. **No se repone.** La guarda vive en el service, una sola vez, y el
repositorio sigue sin mirar cierres. Si alguien quiere defensa en profundidad en el SQL, tiene que
reponer **el mismo** criterio y probarlo contra Postgres — y este spec dice que **no lo haga**: dos
escrituras del criterio es cómo nació el incidente.

### §7.3 — Lo que se borra de la prosa, y por qué se dice aquí

Este diseño llegó a tener una §7.3 titulada *«Recibir asignaciones de RECOLECCIÓN — NO cambia.
Asimetría DELIBERADA»*, con una guardia de test dedicada a **impedir** que alguien bloqueara la
recolección. **Todo eso se borra**, no se matiza: una excepción documentada como deliberada es lo más
difícil de revertir que hay en este repo —la regla de la 241 lo demuestra—, y dejarla escrita «por
historia» garantiza que el próximo lector la aplique.

Lo que sí queda escrito es el registro del cambio de decisión (§12/A7), en el mismo sitio donde viven
las alternativas descartadas.

### §7.4 — El aviso informativo de la bodega satélite — **cambia el dato, no el veto**

`existeBodegaSateliteBloqueada` (`OrdenRepository.ts:3310`) consume hoy
`findMensajerosConCierreAbierto`, que desaparece como tal. Pasa a leer el contador (§2.2):
`cierresAbiertos` = cuántos mensajeros tienen `N ≥ 1` (mismo significado que hoy, nombre heredado
incluido), y **se añade** `mensajerosBloqueadosIds` con la regla N/V.

**`bloqueada` sigue siendo SÓLO el `CierreBodega` propio** (**R34**). La causa (i) —«algún mensajero
de la zona tiene un cierre»— **sigue retirada**: congelaba la bodega entera, compañeros sin cierres
incluidos, por el cierre de una persona. Esta ficha bloquea **al mensajero**, no a la bodega.

---

## §8 — Lo que la administración ve (R48)

**Problema medido:** `rechazado` no está en `ESTADOS_COLA_CIERRE_DIA` (`colas-cierre.ts:32`), así que
un mensajero puede contar `N=2` y la administración ver **una fila**. Y aprobar el más viejo es
justamente lo que lo desbloquea.

**DECISIÓN DEL HUMANO (`Q2`, 2026-08-23): `rechazado` NO entra en la cola. `ESTADOS_COLA_CIERRE_DIA`
NO SE TOCA.**

Razón: **la bodega ya decidió sobre ese cierre.** La cola es «pendiente de **mi** decisión», y un
`rechazado` está esperando al **mensajero**. Meterlo ahí cambia lo que la cola significa, y de paso
tocaría un módulo que leen **tres** pantallas.

**Lo que sí se hace, y es lo que R48 pide de verdad:** en la fila del cierre, la administración ve que
**ese mensajero está bloqueado y por qué** —cuántos cierres arrastra y cuál toca resolver primero—,
con el mismo `BloqueoDetalle` que alimenta los avisos (§2.4). El dato viaja con la fila; no hace falta
una cola nueva ni una pantalla nueva.

⚠️ **Y se escribe explícitamente, porque es la conclusión equivocada que invita a sacar:** que un
`rechazado` no esté en la cola **NO deja al mensajero sin rescate**. `forzarSolicitudVencido` acepta
`vencido` **y** `rechazado` (`ESTADOS_REABRIBLES`, `CierresAdminRepository.ts:80`), así que la
administración conserva la salida aunque la fila no figure en la lista de pendientes (**R49**).

`ESTADOS_COLA_SOLICITADO` (bodega e incidentes) tampoco se toca: es otro corte y otra ficha.

---

## §9 — Los avisos

### §9.1 — Lo que hoy no existe, medido

- El corte **no emite ninguna notificación** (0 filas a las 00:03 del 22/08). `CorteDiarioService` ni
  siquiera recibe un notificador.
- El mensajero **no recibe ninguna notificación de cierre, nunca**: `emitirCierreDiaPorAprobar` sólo
  emite a roles de administración.
- El soporte para dirigir a un usuario **ya existe** (`destinatarioUsuarioId`, XOR con
  `destinatarioRol`), y lo usan `carga_masiva_terminada` y `dia_reparto_corregido`.

### §9.2 — Dos eventos nuevos, ni uno ni cuatro

| Evento | Cuándo | Destinatarios | Entidad (`entidad_id`) | Requisitos |
| --- | --- | --- | --- | --- |
| `cierre_dia_vencido` | El corte crea un `vencido` | **el mensajero** (`usuarioId`) **+** la bodega responsable (`maestro`, `admin`, `adminSatelite` de la zona destino) | el cierre `vencido` recién creado | R38, R39 |
| `mensajero_bloqueado_por_cierres` | El mensajero solicita y queda en `N ≥ 2` | **el mensajero** + la bodega responsable | **el cierre que acaba de crearse** (el que lo dejó en N≥2) | R40, R41 |

**Por qué dos y no uno:** las dos causas piden **acciones distintas**. Con `vencido` la pelota está en
el tejado del mensajero («reenvíalo»); con `N≥2` está en el de la administración («aprueben el más
viejo»). Un evento único obligaría a distinguirlas por el texto, y el **tipo de evento es lo que la
campana usa para agrupar y para deduplicar**.

**Por qué dos y no cuatro** (uno por destinatario): el emisor de este repo produce **N filas por
evento**, una por destinatario, con el mismo `evento` y `entidad_id` (patrón de `emitirOrdenRechazada`,
`:135`). Partirlo por destinatario duplicaría el inventario cerrado sin ganar nada.

**El rechazo (R42) reutiliza `mensajero_bloqueado_por_cierres`** con `entidad_id` = el cierre
rechazado. No pide un tercer valor de enum. *(`Q3` resuelta el 2026-08-23: **el aviso de rechazo entra
en alcance**, así que este productor se implementa.)*

### §9.3 — La dedupe, y por qué aquí NO estorba

`emitirFilas` (`emitir.ts:92`) hace no-op si ya hay una **no leída** para el mismo
`(evento, entidadId, destinatario)`, y por debajo hay un índice único que absorbe la carrera.

- **El mismo hecho no se repite:** re-emitir por el mismo cierre no crea una segunda fila.
  Es lo que R44 quiere en su primera mitad.
- **Un hecho nuevo sí avisa,** aunque el anterior siga sin leer, **porque la entidad es el CIERRE y no
  el mensajero**. Dos bloqueos distintos son dos cierres distintos → dos `entidad_id` → la clave única
  no colisiona. Es la misma lección que la 262 aprendió con `orden_dia_reparto_cambio`: elegir mal la
  entidad convierte «avisar dos veces» en un silencio estructural.
- **Consecuencia asumida:** si el mensajero **lee** el aviso y sigue bloqueado, no se le repite. La
  pantalla —que sí es persistente— es la que sostiene el estado; la campana avisa del **hecho**.

### §9.4 — Cableado, y el cron no se rompe

- `CorteDiarioService` recibe un notificador **inyectable y opcional** (patrón `CorteDiarioLogger`,
  `:33`). Emite **una vez por cierre creado**, dentro del bucle y **después** de que `crearCierre`
  devuelva un id (nunca por un `null`).
- Toda emisión va envuelta en `emitirBestEffort` (`lib/notificaciones/notificadores.ts:42`): un fallo
  se registra y **no propaga** (**R47**). El corte es money-critical y no puede caer por un aviso.
- Los textos viven **sólo** en `lib/notificaciones/emitir.ts` (§4.6 de la 146). Si una cadena de
  notificación aparece fuera de ese archivo, es un bug.

---

## §10 — Los textos

### §10.1 — Un formateador, tres consumidores

`BLOQUEO_AVISO` es hoy **texto fijo** y **dice algo que dejará de ser cierto** («Sí puedes seguir
recibiendo asignaciones»). Pasa a ser una **función** en `lib/constants/bloqueo-mensajero.ts`:

```ts
export function avisoBloqueo(d: BloqueoDetalle, opciones: { conCta: boolean }): string;
```

Consumidores, y qué cambia en cada uno:

| Consumidor | Hoy | Después |
| --- | --- | --- |
| `RepartoModule.tsx` (`:392` toast, `:600` panel) | constante importada | `avisoBloqueo(detalle, { conCta: true })` |
| `RecogerModule.tsx:128` | constante importada | idem |
| `RecoleccionModule.tsx:213` | constante importada | idem |
| `CierreDiaModule.tsx:175` | **copia propia** sin CTA | `avisoBloqueo(detalle, { conCta: false })` |

**La copia del `CierreDiaModule` desaparece.** Su razón de existir era el remate («Ve a Cierre del
día», redundante estando ya allí), y eso ahora es un parámetro. Mantener dos fuentes de un texto que
**cuenta cosas** (N, V, cuál toca) es garantizar que divergirán (**R52**).

### §10.1-bis — LA JORNADA DE UN CIERRE: un derivador, dos fuentes, una omisión (R57–R61)

> **Defecto real, medido, que este spec tenía.** Los literales decían «el más antiguo, **el del 22 de
> agosto**», y ese dato saldría de `created_at`. Contra el cierre `79cb2c0f`: `created_at` en Costa
> Rica = **2026-08-22**; jornada real (fecha de sus 3 gestiones vinculadas) = **2026-08-21**.
> **Un día de desfase, y no es esa fila:** el corte corre a las 00:0x de la madrugada **siguiente** a
> la jornada que cierra, así que **todo `vencido` nace fechado un día por delante**. Y son los
> `vencido` los que más avisos generan.

`lib/utils/jornada-cierre.ts` (nuevo, **puro**), **un solo derivador** para los avisos y la pantalla
(**R61**):

```ts
/** `null` = no hay jornada fiable; el texto OMITE la fecha (R60). */
export function derivarJornada(entrada: {
  /** Fechas CR de las gestiones vinculadas NO anuladas. Vacío = cierre sin gestiones. */
  diasCRDeGestiones: readonly string[];
  /** Fecha CR de `cierre_dia.created_at`. */
  diaCRDeCreacion: string;
}): string | null;
```

**Fuente A (primaria, R57) — las gestiones vinculadas.** `gestion_orden.created_at` es el instante en
que **el mensajero registró la gestión**, existe y está indexado (`schema.prisma:884`, `:915`). Se
toman las del cierre con `anulada_at IS NULL` y se pasan a fecha de Costa Rica.

- Todas en **el mismo día CR** → **ése es la jornada**. Es el caso normal, y lo será aún más con esta
  ficha: `cierre_id IS NULL` reparte el trabajo por día porque el corte corre cada noche.
- En **más de un día CR** → **se omite la fecha** (**R60**). No hay *una* jornada, y elegir una de las
  dos sería decidir por el mensajero cuál de sus dos días le estamos nombrando.

**Fuente B (fallback, R58) — cierre SIN ninguna gestión: `created_at` en CR menos un día.**

Y **no es una heurística: es la misma fórmula que usa el corte**. `diaQueElCorteCierra(now)`
(`CorteDiarioService.ts:64`) es exactamente `startOfDayCR(now) − 1 día`, y `created_at ≈ now` en esa
misma transacción. Reproduce el ancla del corte para **cualquier** hora de disparo, incluido el caso
del **cron adelantado** que ese mismo archivo documenta en `:55-58`: si dispara a las 23:5x CR del día
D, el corte cierra `D−1` y `created_at` CR es `D`, así que `D − 1 día = D−1`. Coincide.

**Por qué el fallback está bien acotado — invariante derivado.** Un cierre **sin ninguna gestión
vinculada sólo puede haberlo creado el corte**:

1. La vía de creación exige gestiones: `findGestionesPendientes` vacío → `MSG_VACIO`
   (`CierreDiaService.ts:512`), y aun pasando, la guarda «algo pasó» hace rollback
   (`CierreDiaRepository.ts:695`).
2. El corte **sí** puede crear uno money-neutral: 0 gestiones + ≥1 orden barrida a `sin_gestionar`
   (feature 109/R8). Es exactamente el caso del fallback.
3. Una gestión ya vinculada **no puede desaparecer**: la ventana de deshacer muere en cuanto
   `gestion.cierreId !== null` (guarda 4 de `deshacerGestion`).

Así que la rama B no necesita preguntar «¿lo creó el corte?»: **cero gestiones ya lo responde**.

**Lo que NO se usa como fuente, y es la trampa de esta ficha (R59): `orden.fecha_reparto`.**
Es el modelo que el humano descartó, y aquí falla por partida doble: una orden reprogramada se libera
con `fecha_reparto = null` (`LiberacionReprogramadaRepository.ts:95`) y se reasigna a otro día; y el
propio barrido del corte **admite `fecha_reparto IS NULL`** en su predicado
(`CierreDiaRepository.ts:577-580`), así que las órdenes de un cierre money-neutral pueden no tener
ninguna fecha que leer.

**Tampoco sirve `cierre_sin_gestion`** (feature 264), que era el candidato obvio para el caso sin
gestiones: su `created_at` (`schema.prisma:1832`) es el instante del barrido —el mismo `now` ya
desfasado— y sus columnas congeladas son guía, remisión, destinatario, producto, tienda, zona y
estatus de origen. **Ninguna fecha de la jornada.** Comprobado antes de elegir el fallback.

### §10.2 — Los literales propuestos (contrato — ver `Q6`)

Lenguaje claro, sin siglas, sin monto ni datos de nadie (**R45/R46**).

⚠️ **Los cinco perdieron la frase «Sí puedes seguir recogiendo en tiendas»** al resolverse **Q1**.
Es **falsa** desde esa decisión, y **no se sustituye por nada**: el mensaje queda «no puedes entregar,
cobrar ni recibir trabajo nuevo», y punto. Un aviso que permite más de lo que el servidor acepta es
justo el fallo que la 241 documentó al revés (allí prohibía de más; aquí permitiría de más), y el
efecto es peor: el mensajero va a la tienda a recoger y el servidor lo rechaza en el mostrador.

⚠️ **Las fechas que aparecen abajo son de la JORNADA, no del nacimiento del cierre** (§10.1-bis). El
cierre `79cb2c0f` del ejemplo nació el **22**; el mensajero trabajó el **21**, y **21** es lo que dice
el texto. Cuando `derivarJornada` devuelve `null`, la oración de la fecha **desaparece entera** y el
resto del aviso se lee igual de bien: por eso la fecha va siempre en aposición al final y nunca en
mitad de una frase que la necesite para tener sentido.

**1 · Bloqueado por acumular (`N ≥ 2`, `V = 0`) — al mensajero:**
> «Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar, cobrar ni recibir
> trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo, el del 21 de agosto.»
>
> *sin jornada fiable:* «Tienes 2 cierres esperando aprobación. Mientras tanto no puedes entregar,
> cobrar ni recibir trabajo nuevo. Se desbloquea cuando la bodega apruebe el más antiguo.»

**2 · Bloqueado con algo que reenviar (`V ≥ 1`, `N = 1`) — al mensajero:**
> «Tienes un cierre sin enviar a aprobación. Mientras tanto no puedes entregar, cobrar ni recibir
> trabajo nuevo. Envíalo a aprobación con el botón de abajo.»
>
> *(No lleva fecha: sólo tiene un cierre y lo tiene delante, con su botón. Nombrarlo por fecha aquí
> no desambigua nada.)*

**3 · Bloqueado con las dos cosas (`N ≥ 2` y `V ≥ 1`) — al mensajero:**
> «Tienes 2 cierres sin resolver y 1 de ellos no se ha enviado a aprobación. Mientras tanto no puedes
> entregar, cobrar ni recibir trabajo nuevo. Envía el que falta y espera a que la bodega apruebe el
> más antiguo, el del 21 de agosto.»
>
> *sin jornada fiable:* «… Envía el que falta y espera a que la bodega apruebe el más antiguo.»

**4 · El corte creó un cierre vencido:**
> al mensajero: «Tu cierre del 21 de agosto venció sin enviarse a aprobación. No puedes entregar,
> cobrar ni recibir trabajo nuevo hasta que lo envíes.»
> *sin jornada fiable:* «Tu cierre del día venció sin enviarse a aprobación. …»
> a la bodega: «El cierre de un mensajero venció sin enviarse a aprobación.»
>
> ⚠️ Éste es **el aviso que más se emite y el que peor salía**: nace del corte, o sea del caso en que
> `created_at` va desfasado siempre. Decirle «tu cierre del 22» a quien trabajó el 21 —y que además
> lee el aviso el día 22— era mandarlo a buscar un cierre que no reconoce.

**5 · Un mensajero quedó bloqueado por acumular — a la bodega:**
> «Un mensajero quedó bloqueado por acumular cierres sin aprobar. Aprueba el más antiguo, el del 21
> de agosto, para que pueda volver a trabajar.»
>
> *sin jornada fiable:* «Un mensajero quedó bloqueado por acumular cierres sin aprobar. Aprueba el
> más antiguo para que pueda volver a trabajar.»

**«Trabajo nuevo» y no «entregas nuevas»,** a propósito: cubre las dos clases —reparto y
recolección— sin enumerarlas ni obligar al mensajero a saber cómo las llama el sistema.

**Nota de trazabilidad, y es una regla del proyecto:** estos literales se afirman en test **escritos a
mano y completos**, nunca comparados contra `avisoBloqueo(...)`. Un texto comparado contra la función
que lo genera está **siempre verde**. Es lo que ya hacen a propósito
`tests/components/CierreDiaModule.test.tsx:565` y `RepartoModule.test.tsx:1142`.

### §10.3 — La prosa que hay que reescribir (R50/R51)

| Archivo | Qué dice hoy | Qué tiene que decir |
| --- | --- | --- |
| `OrdenRepository.ts:3187-3193` | «RECIBIR ASIGNACIONES NO SE BLOQUEA NUNCA — y por eso ninguna superficie de asignación lo llama» | La regla 271: **recibir trabajo nuevo sí se bloquea** al acumular, reparto **y** recolección; lo que sobrevive de la 241 es sólo que `solicitado` a secas no bloquea. |
| `OrdenRepository.ts:301-328` (bloque de `ESTADOS_CIERRE_BLOQUEAN_GESTION`) | «Son TRES cosas distintas y sólo dos se tocan aquí… 2. RECIBIR ASIGNACIONES — NUNCA se bloquea» | Las tres cosas siguen siendo tres, con el reparto movido de lado, y **qué parte de la 241 sobrevive**. |
| `lib/constants/bloqueo-mensajero.ts:1-24` | «Sí puedes seguir recibiendo asignaciones» | El formateador, sin ninguna promesa de actividad permitida. |
| `AsignacionSateliteService.ts:40-43` y `:106-120` | «su ausencia es el mecanismo» | El predicado **vuelve** al `Pick`, y por qué. |
| `GuiaAsignacionService.ts:332-347` | «SE QUEDA RETIRADA» | La guarda vuelve, **para las tres** asignaciones. |
| `GuiaAsignacionService.ts:462-466` | «R7 RETIRADA … Ningún estado de cierre impide mandar a un mensajero a recolectar — recibir trabajo no se bloquea» | La guarda vuelve **aquí también** (Q1). Y `:410-414` ya dice «basta rol mensajero **y no estar bloqueado por cierre**»: esa línea, hoy caducada, **vuelve a ser cierta**. |
| `RecoleccionTiendaService.ts:39-42` (`MSG_BLOQUEADO`) | «Tenés un cierre pendiente sin resolver» | Debe cubrir también la **acumulación**, donde el mensajero no tiene nada que resolver. Pasa a componerse con el mismo formateador (§10.1). |
| `MisAsignacionesService.ts:504` | «Que ASIGNARLE órdenes no se bloquee es otra cosa: recibirlas no cobra» | Recibirlas **sí** se bloquea. |
| `CierreDiaModule.tsx:127-176`, `cierre-dia.ts:76-92`, `MisAsignacionesService.ts:55-57, :165-177` | «recibir asignaciones no se bloquea nunca» | Idem. |

Se protege con una **guardia de texto**: `tests/unit/guards/regla-241-caducada.guardia.test.ts` busca
en `lib/` y `app/` las frases caducadas —«NUNCA se bloquea», «recibir trabajo no se bloquea», «Sí
puedes seguir recibiendo asignaciones», «puedes seguir recogiendo en tiendas»— y **falla si sobrevive
alguna** (**R51**). Es la contramedida directa a «la prosa de este repo miente más que su código, y
nada la vigila».

---

## §11 — Contratos de entrada/salida que cambian

Todo son **Server Actions** (`lib/actions/`), ninguna ruta API nueva: son mutaciones y lecturas
internas del propio proyecto (`docs/architecture.md`, tabla «Server Actions vs Route Handlers»).

```ts
// lib/actions/cierre-dia.ts — estadoBloqueoMensajero
- { status: "ok"; bloqueado: boolean }
+ { status: "ok"; bloqueo: BloqueoDetalle }        // §2.4

// lib/actions/ordenes-guia.ts — listarMensajerosParaAsignacion
  { status: "ok"; mensajeros; conRepartoIds; conRecoleccionIds
+   ; bloqueadosIds: string[] }                    // R32. Se aplica a los DOS modales (Q1).

// lib/actions/recepcion-satelite.ts — listarMensajerosSatelite
  { status: "ok"; mensajeros }
+   ; bloqueadosIds: string[] }                    // R32

// LAS TRES asignaciones: asignarDesdeBodega, AsignacionSateliteService.asignar
//                        y asignarRecoleccion
+ { status: "conflict"; detalle: [{ ordenId, motivo: MSG_MENSAJERO_BLOQUEADO }] }   // R28/R29/R30/R31

// CierreDiaService.solicitarCierre
  { status: "conflict"; motivo }                   // motivo COMPUESTO desde BloqueoDetalle (R15)
+ { status: "ok"; via: "resolicitado" }            // sustituye a "vencido_solicitado" | "rechazado_solicitado"
```

**`via: "resolicitado"`** unifica los dos valores anteriores, consecuencia de §5. El borde y el toast
dejan de distinguir un caso que ya no se decide por estado sino por edad. Los consumidores del campo
son la UI del cierre y sus tests.

`CierreDiaModuleProps`: `bloqueado: boolean` → `bloqueo: BloqueoDetalle`, y `tieneVencido` /
`tieneRechazado` se derivan de él (hoy se calculan aparte, desde `cierresPasados`) — dos fuentes para
la misma pregunta es cómo se desincronizan.

---

## §12 — Alternativas descartadas

### A1 — Una columna `fecha_jornada` en `cierre_dia`, un cierre por día *(DESCARTADA por el humano)*

Era el modelo del **spec anterior, que se borró entero**. Se descarta y no vuelve:

1. **La reprogramación lo rompe.** Una orden reprogramada se libera con `fecha_reparto = null`
   (`LiberacionReprogramadaRepository.ts:95`) y se reasigna a otro día. Derivar la jornada del cierre
   desde `orden.fecha_reparto` deja la gestión de hoy —que lleva dinero— colgando de una fecha ya
   movida.
2. **Sobra.** `cierre_id IS NULL` ya reparte el trabajo (`CierreDiaRepository.ts:686`). El cierre de
   ayer se llevó lo de ayer **sin que nadie escriba una fecha**.
3. **Cuesta migración, backfill y un invariante nuevo** (unicidad `(mensajero, jornada)`) para
   resolver un problema que la regla N/V resuelve con una consulta de conteo.

### A2 — Persistir una columna `bloqueado` en `usuario`

Un booleano que alguien mantiene al crear, aprobar, rechazar y vencer cierres. **Descartada:** son
**cinco** escritores en cuatro servicios distintos, y el primero que se olvide deja al mensajero
bloqueado para siempre o suelto cobrando sin cierre. El repo ya rechazó exactamente esto en la 41
(«sin flag persistido», `cierre-dia.ts:78`). Derivar cuesta **una consulta indexada** (**R12**).

### A3 — Un tope numérico en el predicado actual (`count > 1`) sin distinguir V

Es lo que hubo entre el 2026-08-18 y el 2026-08-20, y **no era un umbral: era el predicado apagado**,
porque el invariante R30 hacía `count > 1` inalcanzable. Aunque ahora sí sería alcanzable,
**descartada** porque no expresa la regla: con `N=1, V=1` (caso 5) da «libre», y el humano dictó
«bloqueado **al instante**». N y V son **dos** números, no uno.

### A4 — Meter `rechazado` en `ESTADOS_COLA_CIERRE_DIA` *(propuesta del autor, DESCARTADA por el humano)*

Era la vía barata para R48: una constante en un módulo puro, leída por las dos capas. **El humano la
descartó** (`Q2`, 2026-08-23): **la bodega ya decidió sobre ese cierre**, y la cola significa
«pendiente de mi decisión». Además tocaba un módulo que leen tres pantallas para arreglar un problema
de **una**. Lo que se hace en su lugar está en §8: el estado de bloqueo viaja en la fila.

### A8 — Derivar la jornada del cierre de `created_at` a secas

Es lo que este spec hacía **sin darse cuenta**, y el defecto es medible: `79cb2c0f` nació el
**2026-08-22** y su jornada es el **2026-08-21**. **Descartada** porque el corte corre después de
medianoche por definición, así que el desfase no es un caso raro: es **todos** los `vencido`. Ver
§10.1-bis para las dos fuentes que lo sustituyen.

### A9 — Derivar la jornada de `orden.fecha_reparto` de las órdenes del cierre

Parecía la fuente semántica correcta. **Descartada por dos razones independientes**, y es el mismo
error del modelo `fecha_jornada` (A1) por otra puerta: (a) una orden reprogramada se libera con
`fecha_reparto = null` y se reasigna a otro día, así que la columna **se mueve** debajo del cierre ya
creado; y (b) el propio predicado de barrido del corte **admite `fecha_reparto IS NULL`**
(`CierreDiaRepository.ts:577-580`), de modo que un cierre money-neutral puede no tener ni una fecha
que leer. Una fuente que a veces es `null` y a veces cambia sola no puede fechar un aviso.

### A5 — Reponer el `NOT EXISTS` en el UPDATE crudo de `asignarSateliteLote`

Defensa en profundidad en el SQL, además de la guarda del service. **Descartada:** es **literalmente**
lo que produjo el incidente del 18/08 —lectura y escritura con criterios distintos sobre la misma
acción, y un mensaje al adminSatélite que era falso y no se arreglaba reintentando—. Dos escrituras
del mismo criterio en dos capas es cómo una regla se rompe en silencio. Un solo sitio, con test de
integración contra Postgres (**T4.2**, cruzada con el selector en **T4.5**).

### A7 — Bloquear **sólo el reparto** y dejar entrar la recolección *(escrita, y REVERTIDA por el humano)*

**Llegó a estar en este spec como decisión firme, con §7.3 propia y una guardia de test que la
defendía.** El humano la revirtió el mismo día: *«Error mío, en realidad no puede recibir
recolecciones porque son dos tareas diferentes, una cosa es ir a repartir y otra diferente es recoger
en tienda, un mensajero no puede hacer las dos gestiones, solo una a la vez.»*

**Por qué no vuelve**, más allá de que esté decidido:

1. **La regla de dedicación ya lo decía.** `findMensajerosConOrdenesEn` (feature 157) declara reparto
   y recolección **mutuamente excluyentes**, y esa comprobación vive **dentro de la propia
   `asignarRecoleccion`** (`GuiaAsignacionService.ts:468`). Son la misma jornada: dejar entrar una de
   las dos a un mensajero bloqueado le daba trabajo que igualmente no podía ejecutar.
2. **Recolectar cobra.** `RecoleccionTiendaService` ya bloquea el **acto** de recolectar. Permitir
   **recibir** lo que no se puede **ejecutar** deja al mensajero con paquetes asignados y un rechazo
   en el mostrador de la tienda.
3. **Obligaba a que el aviso mintiera a medias.** Los cinco textos llevaban «Sí puedes seguir
   recogiendo en tiendas», que sólo era cierto para la asignación y falso para la ejecución.

Se registra aquí, y **sólo aquí**: la §7.3 que la justificaba se borró entera a propósito (§7.3
actual explica por qué).

### A6 — Un `notificacion_evento` único (`cierre_bloqueo`) con el motivo en el texto

Ahorra un valor del inventario cerrado. **Descartada:** el evento es lo que la campana usa para
agrupar y deduplicar, y las dos causas piden acciones **opuestas** (una la resuelve el mensajero, la
otra la administración). Meter la diferencia en la descripción la vuelve invisible para todo lo que no
sea leer la frase.

---

## §13 — Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| 1 | **Repetir el 18/08:** tocar «el bloqueo» y apagar/encender de más. | §7 enumera **todos** los call sites, uno por uno, con «cambia / no cambia». El archivo `cierre-bloqueo-asimetria.test.ts` reescrito (**T4.6**) cruza gestionar y recibir en un sitio, con el repositorio real. Y como **ya no hay excepción**, la superficie a vigilar es «todas», que es más fácil de sostener que «todas menos una». |
| 2 | **El conteo N/V es un `WHERE`,** y los tests de servicio usan dobles que no ven el SQL. Medido 4 veces en este repo: una mutación del `WHERE` sobrevive en verde. | Test de **integración contra Postgres con datos sembrados** para el contador, con **contraprueba por mutación** (**T10.1**). |
| 3 | **Un texto comparado contra su propia fuente está siempre verde.** | Literales escritos a mano en los tests (§10.2), como ya hacen los dos tests citados. |
| 4 | **El corte evalúa más gente** y es un cron con presupuesto. | **T3.5** mide la corrida antes y después sobre datos sembrados. |
| 5 | **Bloquear reparto Y recolección deja al mensajero sin nada que hacer**, y a la bodega sin ese repartidor un día de pico. Con Q1 resuelta el alcance del riesgo **creció**. | La bodega tiene el aviso accionable (R41) y la salida es aprobar, que es una acción de segundos. El humano aceptó la consecuencia explícitamente («aunque esto no depende de él no importa igual queda bloqueado») y luego **amplió** el alcance a sabiendas. |
| 6 | **La migración de enum no es reversible con datos.** | `down.sql` con precondición ruidosa y **sin `DELETE`** (§3.2), medido contra Postgres real (**T10.4**). |
| 7 | **`prisma migrate` en base local compartida** entre worktrees pone rojo el gate de features vecinas. | Se corre el gate completo tras mergear, no en paralelo con otra tanda que migre. |
| 8 | **La fecha del aviso puede mentir un día**, y es el dato por el que el mensajero identifica el cierre. Ya estaba mal en la primera versión de estos literales. | Derivador único (§10.1-bis) con **test que fija el caso medido**: jornada 21, cierre nacido el 22, el texto dice **21** (**T6.9**). Y regla de omisión antes que de invención (**R60**). |

---

## §14 — Dónde vive cada requisito

| Requisitos | Dónde |
| --- | --- |
| R1–R12 | §2 (helper puro + contador + detalle) |
| R13–R20 | §4 (gate) y §5 (re-solicitud unificada) |
| R21–R24 | §6 (corte) |
| R25–R27 | §7.1 |
| R28–R34 | §7.2, §7.3, §7.4 |
| R35–R37 | §15 (M7) |
| R38–R47 | §9 |
| R48–R49 | §8 |
| R50–R52 | §10 |
| R53–R56 | §5 (M9), §6 (guarda «algo pasó»), §3.1 (sin backfill) |
| R57–R61 | §10.1-bis (el derivador de la jornada) |

---

## §15 — M7: aprobar libera sólo lo de SU cierre

`CierresAdminRepository.ts:1417` selecciona las órdenes a liberar por
`{ mensajeroAsignadoId, estatusId: sin_gestionar }`. Con dos cierres, aprobar el 1.º vacía también la
mano del 2.º (**M7**).

**La fuente correcta ya existe:** `cierre_sin_gestion` (feature 264) guarda, por cierre, **qué órdenes
barrió**. El `where` pasa a acotarse a esos `ordenId`, conservando **todas** las guardas actuales
(`estatusId = sin_gestionar`, `deletedAt: null`, el `updateMany` guardado y el choke point del
historial):

```ts
where: {
  id: { in: <ordenIds de cierre_sin_gestion de ESTE cierre> },
  mensajeroAsignadoId: cierre.mensajeroId,   // se CONSERVA: propiedad, no selección
  estatusId: sinGestionarEstatusId,
  deletedAt: null,
}
```

**El caso de los cierres viejos, que es el que se olvida:** `cierre_dia.sin_gestion_registrado`
(`schema.prisma:1086`) marca con `false` los cierres **anteriores** al registro, cuya lista es
irrecuperable. La migración de la 264 puso `false` exactamente a los que **no** estaban en los tres
estados abiertos, así que **todo cierre aprobable hoy lo tiene en `true`**. Aun así, el código
comprueba la bandera: con `false` **conserva el comportamiento actual** (por mensajero) en vez de
liberar cero órdenes en silencio. Un `[]` implícito ahí sería un fallo mudo nuevo, y esta ficha existe
para cerrar tres, no para abrir el cuarto.
