# Ficha 371 — informe de implementación

**Rama:** `fix/371-corregir-fecha-reprogramacion` · **Zona:** fullstack (backend → frontend,
secuenciado) · **Molde:** ficha 262 (`CorreccionDiaRepartoService`).

## Qué resuelve

Un mensajero reprograma una orden y elige mal el día. Hasta ahora **no había ninguna pantalla** para
corregir esa fecha: la orden quedaba esperando al día equivocado y no había arreglo.

**Caso real que la origina:** guía **49906911**, gestión `reprogramada` con
`fecha_reprogramacion = 2026-09-04` cuando el motivo escrito decía «se cambió la ruta para mañana» y
se registró el 2 de septiembre. No estaba atascada —se soltaba sola— pero al día equivocado.

## Lo medido antes de diseñar

- **La fecha no se copia a ninguna parte.** `cierre_detail` congela zona, tarifa y destinatario pero
  **no** `fecha_reprogramacion`; todos los lectores la leen viva. **Corregirla no altera ningún
  documento emitido.** Eso es lo que permite corregir aunque el cierre esté aprobado.
- Una gestión `reprogramada` **no lleva dinero**: 0 de 160 con pago al mensajero o ingreso por rechazo.
- La analítica y el ranking **no** leen esta columna.
- De las **31** órdenes que esperan hoy: **24 se liberarían al instante** si se corrigieran a hoy (18
  visita real con cierre aprobado + 6 de escritorio) y **7 seguirían esperando** su cierre.

## Decisiones del humano

1. **Solo `maestro` y `admin`.** El mensajero avisa; el coordinador corrige (criterio del molde 262,
   que excluye al mensajero con motivo escrito).
2. **Corregir a HOY libera de inmediato**, sin esperar al cron de medianoche.
3. **Se puede corregir aunque el cierre esté aprobado**, mientras la orden siga en `reprogramada`.
   18 de 31 lo están: excluirlas dejaría a la mayoría sin arreglo.
4. **El motivo es obligatorio.** El leader lo había dejado fuera para acotar alcance y el humano lo
   revirtió: *«el motivo sí tiene que ir, básicamente es la misma gestión que reprogramar»*. Por eso
   hereda su **misma** regla (`motivoSchema`, no vacío), no un mínimo propio inventado.

## Las tres trampas que había que esquivar

### 1. La validación habría hecho inútil la ficha

`esFechaFutura` (`lib/types/gestion-orden.ts`) exige **>= mañana**. El caso real —corregir del 4 al 3
**estando a día 3**— habría sido rechazado por la propia pantalla que viene a arreglarlo.

La corrección admite **hoy en adelante** (`esFechaCorreccionValida` / `fechaCorreccionSchema`,
`lib/types/gestion-orden.ts:196,219`); el registro original **no se toca** y sigue exigiendo mañana.
Es una divergencia deliberada y está escrita en los dos sitios. La UI lo dice al usuario: *«Puede ser
hoy: al corregir sí se admite el día en curso.»*

**Mutación que lo guarda:** cambiar el mínimo de `>= hoy` a `> hoy` tumba **10 tests**, incluido el
caso 4→3.

### 2. La gestión vigente: dos expresiones habrían divergido en silencio

El cron elige la gestión con `resultado: reprogramada, anuladaAt: null, orderBy createdAt desc,
take 1`. Si la corrección hubiera reescrito esa correlación, un día apuntarían a **gestiones
distintas**: se corregiría una fecha que el cron no mira, y **nada fallaría**.

Se extrajo a `lib/repositories/gestion-reprogramada-vigente.ts` (`GESTION_REPROGRAMADA_VIGENTE`), que
el cron **expande** en su `select` anidado y la corrección consume por
`findGestionReprogramadaVigente`. Hay **guardia** que prohíbe a cualquier archivo de `lib/**`
reescribirla en línea, y **test de paridad contra Postgres** que siembra dos gestiones vivas y
comprueba que los dos caminos eligen la misma.

### 3. La puerta 276 se respeta, no se salta

`puedeLiberarse` (`LiberacionReprogramadaService.ts:53-56`) libera si la gestión **no** es visita
real, **o** si su cierre está `aprobado`. La raíz: liberar una visita real antes de aprobar su cierre
devolvería la orden con el contador de intentos atrasado — el 4.º intento que la 276 cerró.

«Corregir a hoy libera de inmediato» significa **disparar la liberación que ya existe**, que decide
con esa regla; no se escribió una liberación paralela. Por eso el resultado lleva un discriminante de
**tres** valores y no de dos.

## El contrato

`corregirFechaReprogramacion({ ordenId, fecha, motivo })` —
`lib/actions/corregir-fecha-reprogramacion.ts:116`

    | { status: "ok"; ordenId; gestionId; fechaAnterior; fechaNueva;
        liberacion: "liberada" | "espera_cierre" | "espera_fecha" }
    | { status: "conflict"; motivo }
    | { status: "forbidden" }
    | { status: "validation_error"; fieldErrors }   // fecha | motivo | ordenId | estatus
    | { status: "unauthenticated" }

**Los tres desenlaces, contados al usuario** (lo más importante de esta pantalla). Prefijo común
«Fecha corregida: del \<anterior\> al \<nueva\>», en palabras, y luego:

- **`liberada`** — «La orden ya volvió a la bodega y se le puede asignar mensajero.»
- **`espera_cierre`** — «La orden todavía NO vuelve a la bodega: falta que se apruebe el cierre donde
  el mensajero reportó esa reprogramación. En cuanto se apruebe, la orden vuelve sola.»
- **`espera_fecha`** — «La orden espera a ese día: vuelve sola a la bodega cuando llegue.»

Van en un panel que **se queda** —el modal no cierra al corregir—, no en un aviso que se desvanece.
Si el coordinador corrigiera a hoy y la pantalla solo dijera «listo», miraría el listado, vería la
orden igual de bloqueada y no entendería nada: habríamos cambiado una confusión por otra.

## El rastro: dos, y no se pisan

1. **Tabla `gestion_fecha_reprogramacion_cambio`** — el detalle **con su motivo**. Molde exacto de
   `OrdenDiaRepartoCambio` (262): gestión, orden, `fecha_anterior`, `fecha_nueva`, actor, motivo,
   `created_at`, con **CHECK en base** `fecha_nueva <> fecha_anterior` (una «corrección» que no cambia
   nada no es un hecho que registrar) y choke point único de escritura
   (`lib/repositories/registrar-cambio-fecha-reprogramacion.ts`).
2. **Fila en `historial_accion`** — la pantalla transversal de quién-hizo-qué (362), con las dos
   fechas en `valorAnterior`/`valorNuevo`. No podía llevar el motivo: esos campos son `VarChar(60)`
   de vocabulario cerrado.

Las dos escrituras van **en la misma transacción** que la corrección: si falla, no queda rastro
huérfano. Y **la fecha anterior se fotografía con `FOR UPDATE` ANTES del `UPDATE`** — tomarla después
haría que el rastro mintiera sin que nadie se enterara.

**La categoría del tipo nuevo es `hace_desaparecer`, y su argumento se corrigió.** Entra ahí porque
corregir a hoy puede sacar la orden de `reprogramada` en el acto —deja de estar donde el coordinador
la tenía, misma familia que `orden_eliminada`—, **no** porque se pierda la fecha vieja. La primera
versión decía eso último **en tres sitios** y era falso: la fecha anterior queda guardada en la tabla
nueva. Se reescribieron los tres.

## La migración

`db/migrations/20260903150000_correccion_fecha_reprogramacion/` — `ALTER TYPE ... ADD VALUE` **y**
`CREATE TABLE` en la misma transacción. **Es seguro**: lo que Postgres prohíbe (55P04) es *usar* el
valor nuevo en la transacción que lo añadió, no añadirlo junto a DDL que no lo nombra. Verificado: el
valor aparece **una sola vez** en toda la migración, en su propio `ADD VALUE`.

Aditiva: no altera ninguna tabla, columna ni índice preexistente, y no escribe ni una fila de datos.
Ningún `down.sql` anterior se tocó.

## Verificación

- **Gate completo `./init.sh`: `INIT_EXIT=0`** — 1707 archivos, 24.326 tests, **26 saltados y 0
  archivos** (`AnaliticaPage` 17 + `AnaliticaShell` 9, preexistentes). El `.env` estaba presente, así
  que las suites contra Postgres **corrieron**. (Se mira el número de `skipped`, no solo el
  `INIT_EXIT`: sin `.env` esas suites se saltan enteras y el gate canta verde igual.)
- **18 mutaciones, ninguna sobrevivió** — 9 en backend y 9 en frontend:

  | Mutación | Qué cayó |
  |---|---|
  | corregir con la orden fuera de `reprogramada` | 7 tests / 3 archivos |
  | saltarse `puedeLiberarse` | 9 / 4, incluido el real de la 276 |
  | no liberar nunca (dejarlo al cron) | 7 / 2, los tres desenlaces |
  | elegir la gestión más antigua | 3 / 2, incluida la paridad con el cron |
  | aceptar fechas anteriores a hoy | 7 / 4 |
  | quitar la fila de historial | 5 / 3, incluido el censo de escrituras |
  | mover la foto de la fecha anterior DESPUÉS del `UPDATE` | 10 / 2 |
  | quitar el motivo del contrato | 8 / 3 |
  | ⭐ mínimo del campo de `>= hoy` a `> hoy` | **10**, incluido el caso real 4→3 |
  | `case "reprogramada"` → `return []` | 4 del listado |
  | colapsar `espera_cierre` en el mensaje de `espera_fecha` | 2 |
  | quitar el `min` del input / el aviso de fecha actual | 2 y 3 |
  | rechazo mudo (`setRechazo(null)`) | 5 |

- **Límite declarado sin adornos:** la mutación de quitar el `FOR UPDATE` solo mata **una guardia
  estática**. El efecto de un lock no es observable en una suite secuencial; ningún test de
  comportamiento puede cazarlo, y decirlo es más honesto que fingir cobertura.

## Riesgos y lo que NO entra

- **La base local queda migrada** al aplicar esto: cualquier otro worktree de la máquina verá
  typecheck rojo por exhaustividad del catálogo hasta que mergee o regenere. Efecto conocido de las
  migraciones de enum en este repo.
- No se toca el registro de reprogramación del mensajero, ni la columna «Reprogramada para», ni el
  flujo de `/novedades`.
- **Una orden por vez**: no hay corrección por lote. El caso no lo pide.
- Sin notificación al mensajero de que su fecha se corrigió. La 262 sí avisa; aquí quedó fuera de
  alcance y es candidata a ficha aparte si el coordinador la echa en falta.
