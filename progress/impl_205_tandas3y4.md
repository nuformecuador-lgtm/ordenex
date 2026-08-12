# Feature 205 — Bitácora de implementación, TANDAS 3 y 4

Rama `feature/205-pago-mensajero-desde-wallet`. Alcance: **T3.1 → T3.4** (el servicio) y
**T4.1 → T4.3** (el borde). La tanda 5 (UI) **no se empezó**: es de `frontend_dev`.
Contrato: `specs/205-pago-mensajero-desde-wallet/{requirements,design,tasks}.md`.
Continúa `progress/impl_205_tanda0.md` y `progress/impl_205_tandas1y2.md`.

---

## Archivos creados / modificados

| Archivo | Tarea | Qué |
| --- | --- | --- |
| `lib/types/liquidacion-reparto.ts` | T4.1 | **creado** — 2 schemas `.strict()` + 6 DTO + 2 resultados |
| `lib/types/liquidacion.ts` | T4.1 | **editado** — 4 `export` (nada más): `montoLiquidacionSchema`, `fechaPagoSchema`, `exigirReferenciaEnPagoElectronico`, `camposComunesDelPago` |
| `lib/interfaces/services/ILiquidacionService.ts` | T3.1/T3.2 | **editado** — `LiquidacionTx` + delegado del reparto, 2 resultados de dominio, 2 métodos |
| `lib/services/LiquidacionService.ts` | T3.1/T3.2 | **editado** — escritor único, previsualizar, registrar, 3 privados, 3 errores/tipos internos |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` | T3.1 | **editado** — `CierreNoAprobadoDTO` + `listarCierresNoAprobados` (ver «hueco del spec» abajo) |
| `lib/repositories/LiquidacionPagoRepository.ts` | T3.1 | **editado** — la implementación de esa lectura |
| `lib/actions/liquidacion.ts` | T4.2 | **editado** — 2 Server Actions, 2 tipos, el cableado del repositorio del acto |
| `tests/unit/services/liquidacion-reparto-service.test.ts` | T3.3 | **creado** — 57 casos |
| `tests/unit/guards/liquidacion-reparto-bloqueos.guardia.test.ts` | T3.4 | **creado** — 16 casos |
| `tests/unit/actions/liquidacion-reparto-actions.test.ts` | T4.3 | **creado** — 20 casos |
| `tests/unit/types/liquidacion-reparto-schema.test.ts` | T4.1/T4.3 | **creado** — 16 casos (design §12 lo nombra) |
| `tests/unit/repositories/liquidacion-pago-repository.test.ts` | T3.1 | **editado** — +5 casos: el WHERE de la lectura nueva |
| `tests/unit/guards/liquidacion-money-safe.test.ts` | T4.1 | **editado** — censo +1, visto en ROJO antes |
| `tests/unit/actions/liquidacion-action.test.ts` | T4.3 | **editado** — doble +2 métodos y la lista de exportaciones **5 → 7** |
| `tests/unit/services/liquidacion-anulacion.test.ts` | T3.1 | **editado** — dobles + la lista CERRADA de métodos del servicio **11 → 17** |
| `tests/unit/services/liquidacion-caja-puerto.test.ts` | T3.2 | **editado** — aridad del constructor **5 → 6** + contraprueba de QUÉ es la sexta |
| `tests/unit/services/liquidacion-service.test.ts` | T3.1 | **editado** — SOLO cableado: ni un assert tocado (R51) |
| `tests/unit/services/caja-cadena-pago-anulacion.test.ts` | T3.2 | **editado** — SOLO cableado |
| `tests/integration/db/liquidacion-idempotencia.test.ts` | T3.2 | **editado** — SOLO cableado |

**Nada de UI, nada de labels, nada de `app/**` ni `components/**`.**

---

## Los tres tests ajenos que se pusieron ROJOS solos, y por qué eso es la noticia

Ninguno de los tres se «arregló»: los tres son mecanismos de la 172/173 que existen para obligar
a mirar, y los tres hicieron su trabajo.

1. **`liquidacion-caja-puerto.test.ts`** — «el constructor pide CINCO dependencias». Rojo con la
   sexta. Se sube a 6 **y se le añade la contraprueba que faltaba**: se lee el constructor y se
   exige que la sexta sea `repartoRepo: ILiquidacionRepartoRepository`. Antes solo contaba; ahora
   dice también *qué* cuenta, así que colar un repositorio de caja en esa posición no pasaría.
2. **`liquidacion-anulacion.test.ts`** — la lista CERRADA de métodos del servicio (incluidos los
   privados). Rojo con los seis nombres nuevos. Se amplía a 17 con el porqué de cada uno escrito
   al lado; el barrido de `desanular|borrar|editar…` sigue intacto y sigue verde.
3. **`superficie-de-uso.guardia.test.ts`** — las dos Server Actions nuevas no las importa nadie
   (la pantalla es la tanda 5). Se anotan con `@sin-superficie` y el motivo real. **La anotación
   caduca sola**: ese mismo guard tiene la mitad contraria («ninguna anotación sobrevive a su
   motivo»), así que cuando T5.2/T5.3 monten `PagoMensajeroAcciones`, el guard se pondrá rojo
   hasta que se borren las dos anotaciones. Queda escrito en el propio comentario.

Y el censo money-safe, visto en ROJO **antes** de ampliarlo, por tercera vez en esta feature:

```
 FAIL  tests/unit/guards/liquidacion-money-safe.test.ts > … > el censo de archivos de la feature
       existe entero y cubre sus propios árboles
AssertionError: expected [ 'lib/types/liquidacion-reparto.ts' ] to deeply equal []
 ❯ tests/unit/guards/liquidacion-money-safe.test.ts:164:56
```

---

## HUECO DEL SPEC que hubo que cerrar: de dónde salen los `excluidos` de R36

**R36 obliga a informar de los cierres excluidos por no estar aprobados, y ninguna tarea de la
tanda 2 entregó una lectura capaz de darlos.** `listarCierresImputables` lleva
`estado: "aprobado"` en el WHERE —probado, y con una mutación que lo mata—, así que no puede
servir para lo contrario.

Lo hecho, y por qué así:

- se añade **una** lectura, `listarCierresNoAprobados(mensajeroId)`, con
  `where: { mensajeroId, estado: { not: "aprobado" } }`. Es el **complemento exacto** de la otra:
  hay un test que compara los dos `where` reales y exige que particionen los cierres del mensajero
  (ninguno en las dos listas, ninguno fuera);
- su DTO **no lleva ni un monto** (design §7.2/§10.2): un cierre no aprobado no ha devengado nada
  y la 172 enseña `null` para su pendiente a propósito. Sin montos en la proyección no hay forma
  de que una cifra inventada llegue a la pantalla;
- `not: "aprobado"` y **no** una lista de estados escrita a mano: con una lista, un estado nuevo
  del enum se quedaría fuera del aviso y ese cierre desaparecería en silencio, que es justo lo
  que R36 existe para impedir. Hay un test que lo fija.

**Lo que queda abierto y decide otra persona:** esa lista **no tiene tope ni recorte**. Un
mensajero con dos años de cierres rechazados los recibe todos en la previsualización. El spec no
dice nada de acotarla y cualquier límite (los N últimos, sólo `solicitado`/`vencido`, sólo los del
último mes) es una decisión de negocio, no de implementación. Se implementa la lectura literal de
R36 y **se reporta**.

---

## Decisiones que el spec no fijaba (y que están escritas en el código)

- **El `repartoRepo` va en la posición 6 del constructor, ANTES del reloj y sin default.** Es el
  criterio que el propio archivo fijó para el puerto de la caja: «un puerto que se olvida de
  cablear y degrada en silencio». Con default, un cableado incompleto dejaría el reparto sin su
  `UNIQUE`, que es un doble pago. Coste: 4 sitios de construcción tocados (1 de producción, 3 de
  test), ni un assert cambiado en ninguno.
- **El `tope` va el último, con default desde `lib/config/reparto-mensajero.ts`.** No se escribe
  ningún número en el servicio ni en el composition root (R57: dos números que puedan divergir es
  lo que se prohíbe). Hay un test que lo verifica con 51 cierres y sin inyectar tope.
- **La clave de cada imputación es `<clave del reparto>:<cierreId>`** (§5.1, punto 5). No es la
  barrera —esa es la fila del acto— sino un valor auditable en una columna que ya es `UNIQUE`.
- **Un choque de esa clave derivada revierte el reparto ENTERO** (`ImputacionRepetidaError`), no
  se salta la imputación. Es imposible en teoría; saltarla devolvería `ok` por menos dinero del
  comprometido. **Esta rama nació de una mutación superviviente** (b2, abajo).
- **`ya_registrado` re-DERIVA el `pendienteDespues`** (el pendiente nunca es un valor guardado,
  R6), así que refleja el estado de hoy y no una foto del día del reparto; `"0.00"` es lo que se
  dice de un cierre que ya no es imputable. Y **el orden es `(registradoAt, cierreId)`**: las N
  filas de un reparto nacen en la misma transacción y comparten `created_at`, así que el desempate
  real es el `cierreId`. No reconstruye el orden FIFO original —el diseño no lo pide— pero es
  total y repetible. Los importes por cierre, que es lo que R28 promete, son exactos.
- **`restanteImputable` = lo que queda de la ventana (bajo bloqueo) + Σ de los recortados (lectura
  previa).** Los recortados no están bajo candado y no pueden estarlo (R55): la cifra es
  informativa —«hace falta otro reparto»—, no un límite de lo que se puede pagar.

---

## Cómo se garantiza el ORDEN de los candados (lo que separa esto de un interbloqueo)

1. La ventana se forma con `ordenarCierresFifo(...)` —**la función pura de T0.1**, no un `sort`
   propio del servicio ni el `ORDER BY` del repositorio— y se recorta con `.slice(0, tope)`.
   Hay un test estructural que exige que el servicio llame a `ordenarCierresFifo` y que **no**
   tenga un comparador propio por `solicitadoAt`.
2. Los candados se toman en un **bucle secuencial sobre esa misma ventana**, en su orden. Test
   estructural: dentro de `registrarRepartoMensajero` hay un `for (const … of ventana)` y **no**
   hay `Promise.all/allSettled/race` — pedirlos en paralelo es pedirlos en orden indeterminado, y
   eso no lo notaría ningún test de resultado.
3. Se bloquea **la ventana entera**, no sólo los cierres que reciben dinero. Es lo que hace que el
   recálculo bajo bloqueo pueda mover importe a un cierre posterior sin tocar nada sin candado.
4. **La ventana ENCOGE, nunca se rellena**: `ventanaBajoBloqueo` itera `ventana` y usa la lectura
   fresca como consulta. Test estructural (`for … of ventana` sí, `for … of frescos` no) + test de
   comportamiento (con `tope: 2`, si el segundo cierre se cae, el reparto responde `excede` con el
   disponible del que queda, y el recortado **no** aparece en ninguna llamada).
5. Medido, no prometido: con la lista de entrada **desordenada a propósito**, el log de candados
   sale `c-a, c-b, c-c, c-d, c-e`; dos ejecuciones dan el mismo orden; y el orden de los candados
   coincide fila a fila (como prefijo) con el de las imputaciones.

Las mutaciones a1 (un candado menos), a2 (orden inverso), a3 (en paralelo) y a4 (bloquear al
mensajero) mueren con 8, 6, 1 y 10 rojos.

---

## Mutaciones — el veredicto

Dos runners en scratchpad (uno para el servicio, otro para el borde). Ambos con las **dos
autocomprobaciones obligatorias**: (1) la línea base tiene que ser LEGIBLE —un resumen con forma
de conteo real, `N passed (T)`— y verde, o aborta; (2) una **mutación de CONTROL plantada** tiene
que morir, o aborta antes de reportar un solo veredicto. Cualquier corrida ilegible se marca
`ILEGIBLE`, nunca «sobrevivió». El archivo se restaura siempre y se compara el **hash**.

Líneas base: `Tests 194 passed (194)` (servicio) y `Tests 102 passed (102)` (borde). Controles:
muertos con 22 y 14 rojos.

### El servicio (T3.3/T3.4) — 23/23 muertas

| # | Mutación | Veredicto |
| --- | --- | --- |
| a1 | **(a)** se toma UN candado menos | **muerta** — 8 rojos |
| a2 | **(a)** los candados en ORDEN INVERSO | **muerta** — 6 rojos |
| a3 | **(a)** los candados EN PARALELO (orden indeterminado) | **muerta** — 1 rojo |
| a4 | **(a)** el grano cambia: se bloquea al mensajero | **muerta** — 10 rojos |
| b1 | **(b)** el bucle se traga la excepción: quedan aplicadas las anteriores | **muerta** — 2 rojos |
| b2 | **(b)** la imputación que choca se SALTA en vez de revertir | **muerta** — 1 rojo *(sobrevivió en la 1.ª vuelta, ver abajo)* |
| c1 | **(c)** la clave del acto se DERIVA en vez de venir del cliente | **muerta** — 4 rojos |
| c2 | **(c)** el original se reconstruye por mensajero, no por `reparto_id` | **muerta** — 1 rojo |
| c3 | **(c)** la relectura no comprueba de quién es el reparto releído | **muerta** — 1 rojo |
| d1 | **(d)** la previsualización BLOQUEA (se vuelve una reserva) | **muerta** — 1 rojo |
| e1 | **(e)** previsualizar comprueba el permiso DESPUÉS de leer | **muerta** — 4 rojos |
| e2 | **(e)** registrar comprueba el permiso DENTRO de la transacción | **muerta** — 5 rojos |
| f1 | la ventana SE RELLENA bajo bloqueo (§2.5.5 al revés) | **muerta** — 2 rojos |
| f2 | el tope no recorta: se bloquea y se imputa a todos | **muerta** — 4 rojos |
| f4 | R58: una referencia inventada por cierre | **muerta** — 2 rojos |
| f5 | el cierre saldado ocupa plaza de la ventana | **muerta** — 1 rojo |
| f6 | R24: desaparece la comprobación de dueño del cierre | **muerta** — 1 rojo |
| f7 | `excede` se evalúa antes que `sin_saldo` | **muerta** — 2 rojos |
| f8 | se pierde el FIFO: la ventana se forma sobre la lista tal cual llega | **muerta** — 6 rojos |
| f9 | desaparece el recálculo bajo bloqueo | **muerta** — 5 rojos |
| f10 | el movimiento del libro deja de escribirse | **muerta** — 6 rojos |
| CONTROL | el reparto no escribe ninguna imputación | **muerta** — 22 rojos |

### El borde (T4.1/T4.3) — 9/9 muertas

| # | Mutación | Veredicto |
| --- | --- | --- |
| g1 | el schema del REGISTRO deja de ser `.strict()` | **muerta** — 4 rojos |
| g2 | el schema de la PREVISUALIZACIÓN deja de ser `.strict()` | **muerta** — 2 rojos |
| g3 | el monto se COERCIONA (un `number` pasaría) | **muerta** — 2 rojos |
| g4 | la referencia deja de ser obligatoria en pago electrónico | **muerta** — 2 rojos |
| g5 | el registro REESCRIBE sus campos en vez de reusar los del pago | **muerta** — 7 rojos |
| h1 | la acción valida la FORMA antes de resolver la SESIÓN | **muerta** — 1 rojo |
| h2 | la acción ACUÑA su propia clave de idempotencia | **muerta** — 1 rojo |
| h3 | el composition root cablea SIN el repositorio del acto | **muerta** — 1 rojo *(sobrevivió en la 1.ª vuelta)* |
| CONTROL | el schema acepta cualquier cosa | **muerta** — 14 rojos |

### Los dos supervivientes de la primera vuelta, y qué se hizo

- **b2 — «la imputación que choca se SALTA»: sobrevivió.** La rama de
  `ImputacionRepetidaError` no tenía ni un caso. Es la rama imposible-en-teoría, y precisamente
  por eso nadie la habría mirado nunca: saltarla devuelve `ok` por 7 000 cuando la persona
  comprometió 15 000. Se añadió el caso (`chocarEnPago: 2` ⇒ la llamada rechaza y **cero** filas
  confirmadas) y b2 cae.
- **h3 — «el composition root sin el repositorio del acto»: sobrevivió.** Ningún test pasa por
  `buildService` (todos inyectan `deps.service`), así que el cableado real no lo miraba nadie —y
  sin ese repositorio el reparto se queda sin su `UNIQUE`, que es el doble pago. Se añadió al
  guard un caso estructural sobre `buildService` (construye `new LiquidacionRepartoRepository(prisma)`,
  en la posición correcta, y **no** escribe ningún número: el tope viene de la config). h3 cae.

### Un MUTANTE EQUIVALENTE, declarado como tal en vez de escondido

**f3 — «`excede` informa el imputable TOTAL en vez del de la ventana»: sobrevive, y es
correcto que sobreviva.** No es un hueco de los tests: es que las dos expresiones **valen lo
mismo en ese punto, por construcción**. Al recálculo se le pasa `bajoBloqueo`, que YA es la
ventana (≤ tope), así que no queda nada recortado y `imputableTotal = imputable + 0`. Lo que hace
que el disponible sea el de la ventana no es esa línea: es que el conjunto que se recalcula es la
ventana — y eso sí lo matan f2 (el tope no recorta) y f9 (no hay recálculo). Queda escrito en el
código, junto a la línea, para que nadie lo «arregle» pasando la lista completa al recálculo.

---

## Mapa `R<n> → test` (lo que estas dos tandas cubren)

| Requisito | Test |
| --- | --- |
| R1, R4 | `liquidacion-reparto-service.test.ts` («el permiso ANTES de tocar o leer un dato»: 4 roles × 2 métodos, log VACÍO) |
| R2 | `liquidacion-reparto-actions.test.ts` (sin sesión ⇒ `unauthenticated`; y con sesión ausente + petición inválida gana `unauthenticated`, que es lo que fija el ORDEN) |
| R5, R6, R7 | `liquidacion-reparto-service.test.ts` («qué es imputable, derivado en cada lectura»: saldado fuera y sin ocupar plaza; el pendiente sale de la Σ de VIGENTES) |
| R9 | `liquidacion-reparto-schema.test.ts` (`cierreId` colado ⇒ `unrecognized_keys` que NOMBRA la clave) + `liquidacion-reparto-actions.test.ts` (y el servicio no se entera) |
| R14 | `liquidacion-reparto-service.test.ts` (`excede` con el disponible de la VENTANA, cero escrituras, y la frontera exacta que sí pasa) |
| R15 | ídem (`sin_saldo` sin imputables **y** con todos saldados — no `excede` con `0.00`) |
| R18, R19 | ídem (3 imputaciones ⇒ 3 pagos con SU `cierreId` + 3 movimientos enlazados por `origen_id`) |
| R20 | ídem (revienta la 3.ª ⇒ cero confirmadas; revienta la 1.ª ⇒ ni el acto; choque de clave ⇒ revierte entero) |
| R21, R22 | `liquidacion-reparto-bloqueos.guardia.test.ts` (grano `cierre`, orden FIFO con entrada desordenada, mismo orden en dos ejecuciones, candados antes de la lectura que decide y de toda escritura) |
| R23 | `liquidacion-reparto-service.test.ts` (pendiente cambiado bajo bloqueo ⇒ manda el recalculado; las dos lecturas ocurren DENTRO de la transacción) |
| R24 | ídem (cierre desaprobado bajo bloqueo no recibe; cierre de otro mensajero no recibe ni se bloquea) |
| R25 | ídem (el resultado es el reparto aplicado, con `restanteImputable`) |
| R26 | `liquidacion-reparto-bloqueos.guardia.test.ts` (los 7 métodos de escritura de `cierreDia` a cero + estructural sobre servicio y repositorio) |
| R28, R29, R30 | `liquidacion-reparto-service.test.ts` (clave repetida ⇒ `ya_registrado` reconstruido por `reparto_id`, cero filas; el caso que mata la alternativa §5.2; clave reusada con otro mensajero ⇒ `no_encontrado`; clave nueva ⇒ pago distinto; el acto se INSERTA lo primero, sin `SELECT` previo) |
| R32, R33, R34 | ídem (imputaciones previstas con `parcial` y su resto, todo STRING, sin `number` suelto) |
| R35 | ídem (previsualizar: cero transacciones, cero bloqueos, cero escrituras, lectura fuera de tx) |
| R36 | ídem (excluidos CONTADOS por estado y SIN importe) + `liquidacion-pago-repository.test.ts` (el WHERE `not: aprobado`, el complemento exacto, el `groupBy`, sin montos) — **reescrito por la enmienda del final** |
| R37 | `liquidacion-reparto-service.test.ts` (deuda no imputable con su cifra ya comparada; sin aviso cuando no la hay; nunca negativa) |
| R38 | ídem (`excede: true` + `sobrante` antes de confirmar) |
| R46 | `liquidacion-reparto-schema.test.ts` (montos STRING, `number` rechazado, tope y `.trim()` heredados) + `liquidacion-reparto-actions.test.ts` (ni un `number` en la respuesta) |
| R47 | `liquidacion-reparto-schema.test.ts` (`.strict()` contra 5 claves distintas) |
| R48 | `liquidacion-reparto-schema.test.ts` (los DTO declaran `cierreId` y ningún id de persona) + `liquidacion-reparto-service.test.ts` (la previsualización no contiene el id del mensajero ni el del actor) |
| R50 | `liquidacion-money-safe.test.ts` (censo ampliado, visto en rojo antes) |
| R51 | `liquidacion-service.test.ts` verde **sin tocar un assert** + `liquidacion-reparto-service.test.ts` («un reparto que cae entero en un cierre escribe lo mismo que el pago simple», comparado campo a campo) |
| R52 | `liquidacion-reparto-bloqueos.guardia.test.ts` (servicio, repositorio y acciones) + `liquidacion-action.test.ts` (la lista exacta, 7) |
| R53 | `liquidacion-reparto-service.test.ts` (sin tope inyectado, 51 cierres ⇒ ventana de 50) |
| R54 | ídem (`tope: 2` con 3 y con 5 imputables ⇒ `ok`, nunca rechazo por el tope) |
| R55 | `liquidacion-reparto-bloqueos.guardia.test.ts` (2 candados, 2 pagos, 2 movimientos; los 3 recortados no aparecen en NINGUNA llamada; + control sin tope) |
| R56 | `liquidacion-reparto-service.test.ts` (el recorte con sus tres cifras, separado del aviso de R37; `aplicado: false` cuando la ventana está llena pero no sobra nadie) |
| R57 | ídem (previsualizar y aplicar en el MISMO servicio dan la misma ventana) |
| R58 | ídem (3 pagos con idéntico método, referencia y fecha; 3 descripciones iguales con `origen_id` distinto) |

R3, R39–R45 y R49 no son de estas tandas (UI, enlace profundo y migración).

---

## Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run` (los 5 archivos nuevos/editados de estas tandas) | `Test Files 5 passed (5) · Tests 158 passed (158)` |
| `pnpm exec vitest run tests/unit/guards tests/integration/db tests/unit/services` | `Test Files 290 passed (290) · Tests 4274 passed (4274)` |
| `pnpm exec tsc --noEmit` | `TSC_EXIT=0`, sin salida |
| `pnpm exec vitest run tests/unit tests/integration tests/components` (extra) | `Test Files 1062 passed (1062) · Tests 13293 passed (13293)` |
| `pnpm run lint` (extra) | `0 errors, 58 warnings` — las mismas 58 del baseline de las tandas 1/2; **ninguna en archivos de estas tandas** |

El gate de tanda (`./init.sh --rapido`) y el completo los corre el leader: son suyos, no míos.

---

## Lo que queda para quien siga

1. **Las dos anotaciones `@sin-superficie` de `lib/actions/liquidacion.ts` SE BORRAN en la tanda
   5.** Si se quedan, `superficie-de-uso.guardia.test.ts` se pone rojo por excepción caducada.
2. ~~**La lista de excluidos de R36 no tiene tope** (arriba). Decisión de negocio pendiente.~~
   **CERRADO** — el humano decidió: conteo por estado, no lista. Ver «Enmienda» al final.
3. La migración **sigue sin aplicarse** a ninguna base (tanda 1). Nada de estas dos tandas la
   necesita para correr en verde, pero el reparto no funciona en runtime hasta que se aplique.

---

## Veredicto

Tandas 3 y 4 cerradas: el reparto se aplica en UNA transacción con N candados por cierre tomados
en el orden determinista del FIFO —bucle secuencial, ventana que encoge y nunca se rellena—, la
idempotencia cuelga de la fila del acto insertada la primera, la previsualización corre la misma
función pura sin bloquear ni escribir nada, el borde rechaza el `cierreId` y el `number` antes de
tocar datos, y las 32 mutaciones que se plantaron mueren todas menos una, que está demostrada
equivalente y declarada como tal.

---
---

# ENMIENDA (antes de la tanda 5) — R36 pasa de LISTA a CONTEO POR ESTADO

Cierra el punto 2 de «Lo que queda para quien siga»: la decisión de negocio que quedó reportada
—«la lista de excluidos no tiene tope»— la tomó el humano. **El aviso de R36 informa, no
inventaría**; el inventario vive en `/cierres-admin`, adonde llevará el enlace de la tanda 6.

## Qué cambia, en una línea

`listarCierresNoAprobados(mensajeroId): CierreNoAprobadoDTO[]` (una fila por cierre, sin tope)
pasa a ser `contarCierresNoAprobadosPorEstado(mensajeroId): CierresNoAprobadosPorEstadoDTO[]`
(una fila por ESTADO), y el agregado lo hace **la base**, con un `groupBy`.

```ts
// lib/repositories/LiquidacionPagoRepository.ts
const grupos = await this.prisma.cierreDia.groupBy({
  by: ["estado"],
  where: { mensajeroId, estado: { not: "aprobado" } },
  _count: { _all: true },
  orderBy: { estado: "asc" },
});
return grupos.map((grupo) => ({ estado: grupo.estado, cantidad: grupo._count._all }));
```

**Queda acotado por CONSTRUCCIÓN**: el tamaño depende del número de valores de `CierreEstado` —un
puñado—, no del número de cierres. Por eso no hay `take`, ni recorte, ni tope que pueda quedarse
corto: no hace falta ninguno.

**El `groupBy` no es una optimización, es la mitad del contrato.** Contar en memoria daría el
mismo número y dejaría intacto justo lo que la enmienda cierra: N filas sin tope viajando desde
la base. Lo acotado no es lo que se devuelve, es lo que se LEE — y eso solo se ve en el
repositorio, con el doble de Prisma delante (los tests de servicio usan dobles y no ven SQL).

## La consecuencia asumida, escrita en el código

Con el conteo **se pierde poder nombrar un cierre concreto en el aviso**: hoy viajaba
`solicitadoAt` «para nombrarlo en pantalla» y ya no viaja. Es el precio aceptado de que la
respuesta esté acotada, y está escrito **en los dos docstrings** (`CierresNoAprobadosPorEstadoDTO`
en la interfaz del repositorio y `ExcluidosPorEstadoDTO` en los tipos del borde) con el motivo y
con la frase que importa dentro de seis meses: *devolver otra vez la lista para «poder nombrarlos»
deshace la decisión, no arregla un olvido; quien necesite el detalle abre `/cierres-admin`*.

Y no se queda solo en el comentario: hay **dos tests que se ponen rojos** si alguien lo reintroduce
—uno estructural sobre el módulo de tipos (`ExcluidosPorEstadoDTO` declara exactamente
`estado, cantidad`, sin `cierreId` ni `solicitadoAt`) y uno de comportamiento sobre el servicio
(las claves de cada excluido son exactamente `["cantidad", "estado"]`)—. Es la mutación **f**.

**Sigue SIN MONTOS**, y por el mismo motivo de antes: sin montos en la proyección no hay forma de
que una cifra inventada llegue a la pantalla por descuido. Un conteo no es un monto — `cantidad` es
un CARDINAL, como los tres del recorte, y por eso viaja como `number`.

## Archivos tocados

| Archivo | Qué |
| --- | --- |
| `lib/interfaces/repositories/ILiquidacionPagoRepository.ts` | `CierreNoAprobadoDTO` → `CierresNoAprobadosPorEstadoDTO` (`estado`, `cantidad`); el método pasa a `contarCierresNoAprobadosPorEstado` |
| `lib/repositories/LiquidacionPagoRepository.ts` | la lectura: `findMany` + `select` de 3 columnas → `groupBy` por `estado` con `_count` |
| `lib/types/liquidacion-reparto.ts` | `CierreExcluidoDTO` → `ExcluidosPorEstadoDTO`; `PrevisualizacionRepartoDTO.excluidos` apunta al nuevo tipo |
| `lib/services/LiquidacionService.ts` | ~línea 399: llama al conteo y lo copia grupo a grupo (no expande a filas, no suma un total) |
| `tests/unit/repositories/liquidacion-pago-repository.test.ts` | el `describe` de R36 **reescrito**: 5 casos → 9; `cierreDia.groupBy` entra en el doble junto a `findMany` |
| `tests/unit/services/liquidacion-reparto-service.test.ts` | el caso de R36 reescrito + 3 nuevos (historial largo, una sola llamada al mensajero correcto, lista vacía) |
| `tests/unit/types/liquidacion-reparto-schema.test.ts` | `cantidad` entra en la lista de cardinales + 1 caso estructural nuevo (el aviso es conteo, no lista) |
| `tests/unit/services/liquidacion-service.test.ts` · `liquidacion-anulacion.test.ts` · `caja-cadena-pago-anulacion.test.ts` · `tests/unit/guards/liquidacion-reparto-bloqueos.guardia.test.ts` | SOLO el nombre del método en el doble (ni un assert tocado) |

Ni UI, ni el servicio de aplicación del reparto, ni los candados, ni el borde, ni la migración.

## Mapa `R<n> → test` (lo que la enmienda cambia)

| Requisito | Test |
| --- | --- |
| R36 (el WHERE y el agregado) | `liquidacion-pago-repository.test.ts` → `contarCierresNoAprobadosPorEstado`: el WHERE exacto (`mensajeroId` + `not: aprobado`), **`groupBy` sí y `findMany` ni una vez**, `by: ["estado"]`, el complemento exacto de los imputables, sin `_sum` ni columna de dinero, la forma `{estado, cantidad}`, acotado por el enum real de `CierreEstado`, orden determinista, cero escrituras |
| R36 (lo que llega a la pantalla) | `liquidacion-reparto-service.test.ts` → «9 rechazados, 3 solicitados» con claves exactamente `["cantidad","estado"]`; 900 rechazados ⇒ **una** entrada y ni un `cierreId`/`solicitadoAt`; el conteo se pide UNA vez y al mensajero de la petición; sin excluidos ⇒ `[]` (no un `0` por estado) |
| R36 (que nadie lo revierta) | `liquidacion-reparto-schema.test.ts` → estructural sobre `ExcluidosPorEstadoDTO` (dos campos, sin `cierreId` ni `solicitadoAt`) + `cantidad` fijado como CARDINAL `number` |

## Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run` (los 3 archivos de la enmienda) | `Test Files 3 passed (3) · Tests 130 passed (130)` |
| `pnpm exec vitest run tests/unit/guards tests/unit/services tests/unit/repositories` | `Test Files 282 passed (282) · Tests 4250 passed (4250)` |
| `pnpm exec tsc --noEmit` | `TSC_EXIT=0`, sin salida |
| `pnpm exec vitest run tests/unit/actions tests/unit/types tests/integration/db` (extra) | `Test Files 183 passed (183) · Tests 2433 passed (2433)` |
| `pnpm exec eslint` (los 7 archivos tocados) | sin salida — 0 errores, 0 warnings |

## Mutaciones — 8/8 muertas

Runner en scratchpad con las **dos autocomprobaciones obligatorias**: (1) la línea base tiene que
ser LEGIBLE —un resumen con forma de conteo real, `N passed (T)`— y verde, o aborta; (2) una
mutación de CONTROL plantada tiene que morir, o aborta antes de reportar un solo veredicto.
Además: el ancla de cada mutación tiene que aparecer **exactamente una vez** o aborta, y el
archivo se restaura siempre comparando el **hash**. Una corrida ilegible se marca `ILEGIBLE`,
nunca «sobrevivió».

Línea base: `Tests 130 passed (130)`.

| # | Mutación | Veredicto |
| --- | --- | --- |
| CONTROL | el conteo devuelve SIEMPRE `[]` (nadie queda excluido, jamás) | **muerta** — 2 rojos |
| a | **(a)** el agregado cuenta TAMBIÉN los aprobados (desaparece el `not`) | **muerta** — 2 rojos |
| b | **(b)** agrupa por OTRO campo (`solicitadoAt`): vuelve a salir una fila por cierre | **muerta** — 1 rojo |
| c | **(c)** cuenta EN MEMORIA trayendo las filas (mismo número, N filas sin tope por la red) | **muerta** — 9 rojos |
| d | el `orderBy` del agregado desaparece (dos llamadas iguales pueden pintar distinto) | **muerta** — 1 rojo |
| e | se cuela un MONTO en el agregado (`_sum: { totalPagoMensajero }`) | **muerta** — 1 rojo |
| f | el DTO recupera `solicitadoAt` «para nombrar el cierre»: la lista por la puerta de atrás | **muerta** — 1 rojo |
| g | el servicio cuenta los excluidos de OTRO mensajero | **muerta** — 1 rojo |

La (c) es la que más rojos deja, y es la que importa: sin ella el número sería idéntico y el
problema seguiría ahí.

## Veredicto de la enmienda

El aviso de R36 ya no puede crecer con el historial: la base agrega por estado, la respuesta tiene
tantas filas como estados no aprobados —nunca como cierres—, sigue sin un solo monto, y las tres
formas de deshacerlo (contar los aprobados, agrupar por otra columna, contar en memoria) mueren
con tests que miran el SQL donde se ejecuta.

---

# ADENDA — los dos menores del review (m3 y m2)

Encargo: los dos hallazgos menores de `progress/review_205.md` que tienen arreglo real. `m1` (mapa
de R42) y `m4` (desviación declarada) no entran acá. **No se tocó `specs/` ni `tasks.md`** (otro
agente trabaja en ellos en paralelo) ni ningún archivo de producción: los dos arreglos viven en
tests.

## Archivos modificados (2, los dos de test)

| Archivo | Qué cambió |
| --- | --- |
| `tests/unit/services/liquidacion-reparto-service.test.ts` | el reloj del doble se separa de `fechaPago`; caso nuevo de R58; el tope deja de inyectarse cuando el caso no lo pide |
| `tests/unit/guards/liquidacion-money-safe.test.ts` | `wallet-mensajeros-labels.ts` entra al censo |

## m3 — el reloj y la fecha de pago ya no valen lo mismo

El fixture tenía el reloj en `2026-07-30T15:04:05Z` y `INPUT.fechaPago` en `"2026-07-30"`: el
mismo día. Con eso, fechar los pagos con el RELOJ produce **exactamente** el mismo valor que
fecharlos con la petición, y ningún caso lo nota. R58 seguía verificado; lo que no se medía era de
dónde sale el dato.

Ahora el reloj marca `2026-08-02T15:04:05Z` (constante `RELOJ`) y el pago sigue fechado el
`2026-07-30` (`FECHA_PAGO`): una transferencia hecha el 30 de julio que se captura el 2 de agosto,
que es lo que pasa de verdad. Los `registradoAt` de los dobles —el instante en que la fila nace—
pasaron a `RELOJ`, que es lo coherente. Se añadió un caso propio:

> `R58: esa fecha viene de la PETICIÓN y no del reloj del servidor`

que reparte **dos veces con fechas distintas** (`2026-07-30` y `2026-07-15`, ninguna es el día del
reloj) y exige que las tres filas del documento y las tres del libro SIGAN a la petición. El
segundo envío es lo que impide que una implementación que devolviera la constante `2026-07-30`
pase igual.

### La prueba por mutación

Mutación M4 del reviewer, plantada en `lib/services/LiquidacionService.ts:492`:
`const fechaPago = medianocheUtcDelDia(fechaCalendarioCR(this.ahora()))`.

| Momento | Resultado |
| --- | --- |
| ANTES del arreglo, solo el archivo | `Test Files 1 passed · Tests 60 passed (60)` — **sobrevive** |
| ANTES del arreglo, `tests/unit/services` + actions + `liquidacion-idempotencia` | `Test Files 166 passed · Tests 2779 passed (2779)` — **sobrevive** |
| DESPUÉS del arreglo | `Tests 4 failed / 57 passed (61)` — **muerta** |

Los cuatro rojos, con la cifra que los nombra:

```
× R19: cada pago escribe SU movimiento en el libro, enlazado por `origen_id` al documento
  AssertionError: expected 2026-08-02T00:00:00.000Z to deeply equal 2026-07-30T00:00:00.000Z
× R58: método, referencia y fecha son IDÉNTICOS en las tres, capturados una sola vez
  AssertionError: expected [ '2026-08-02T00:00:00.000Z' ] to deeply equal [ '2026-07-30T00:00:00.000Z' ]
× R58: esa fecha viene de la PETICIÓN y no del reloj del servidor
  AssertionError: expected [ '2026-08-02T00:00:00.000Z', …(2) ] to deeply equal [ '2026-07-30T00:00:00.000Z', …(2) ]
× las filas del documento y del libro coinciden campo a campo   (R51)
```

`lib/services/LiquidacionService.ts` restaurado y comprobado por hash:
`8256cdbe4c4579e4af0376fce9ad3c1e`, idéntico al de antes de la mutación.

## m3-bis — la MISMA familia, encontrada al mirar el resto del fixture: el tope

`buildDobles` construía el servicio con `opciones.tope ?? 50`. El `50` del fixture y el `50` de
`lib/config/reparto-mensajero.ts` valen lo mismo, así que el constructor recibía **siempre** un
número y el default —el único punto de configuración, que es lo que R53 exige— no se ejercitaba
nunca. El caso `R53: sin tope inyectado, el servicio usa el del único punto de configuración (50)`
decía medir justo eso y no lo medía.

Arreglo: el argumento **no se pasa** cuando el caso no pide tope, así que el servicio cae en su
propio default.

| Mutación: el defecto de la config pasa de `50` a `7` | Resultado |
| --- | --- |
| ANTES | `Tests 61 passed (61)` — **sobrevive** |
| DESPUÉS | `Tests 1 failed / 60 passed (61)` — **muerta**: `expected { aplicado: true, tope: 7, …(3) } to deeply equal { aplicado: true, tope: 50, …(3) }` |

`lib/config/reparto-mensajero.ts` restaurado, hash `65ad11db3d339929af11d6671393c0e4`.

## m2 — `wallet-mensajeros-labels.ts` entra al censo money-safe

El archivo ganó con la 205 cinco bloques que formatean dinero (`money(totalImputado)`,
`money(montoFuera)`, `money(pendienteDespues)`, `money(sobrante)`, `money(imputable)`) y estaba
fuera de `ARCHIVOS_DE_LA_FEATURE`, mientras que los tres componentes que lo consumen sí estaban
dentro: la red cubría a los lectores y dejaba fuera el sitio donde se escribe el formateo.

### La prueba de que la entrada NO es cosmética

Se plantó `money(String(Number(pendienteDespues)))` en `REPARTO_APLICADO.quedaPendiente`:

| Momento | Resultado |
| --- | --- |
| Con el archivo FUERA del censo, `tests/unit/guards` | `Test Files 26 passed · Tests 290 passed (290)` — **no lo caza** |
| Con el archivo FUERA, `tests/unit/{guards,utils,services}` | `Test Files 235 passed · Tests 3530 passed (3530)` — **no lo caza** |
| Con el archivo DENTRO | **rojo, y lo nombra** |

```
× ningún archivo de la feature convierte un monto a número
AssertionError: conversión de dinero a número en la feature 172: expected [ Array(1) ] to deeply equal []
+   "app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts: Number("
```

Y como es archivo de CLIENTE, pesan las cuatro aserciones: se plantó además un `.toFixed(2)` y el
barrido también lo caza nombrando la ruta (`…wallet-mensajeros-labels.ts: .toFixed(`).

Archivo restaurado y comprobado por hash: `fb3d88411ba9ca200cfe9102e3b34d82`, idéntico al de antes
de plantar nada.

## Más coincidencias del tipo m3 en los fixtures de la 205 (REPORTADAS, no arregladas)

Dos, las dos medidas con una mutación que **sobrevive**. No se tocaron: viven en tests de
componente, fuera de este encargo.

1. **`imputable === imputableTotal === cuentaPorPagar === "7000.00"`** en los fixtures de
   `tests/components/PagoMensajeroAcciones.test.tsx` y
   `tests/components/RepartoPrevisualizacion.test.tsx`. Son tres campos de significado distinto
   —lo que un pago puede saldar AHORA, el total incluidos los cierres recortados por el tope
   (R56), y la cuenta por pagar entera (R37)— con el mismo valor, así que confundirlos no se ve.
   - `PagoMensajeroAcciones.tsx:88`, `data?.imputable` → `data?.imputableTotal`: **sobrevive**
     `Test Files 4 passed · Tests 43 passed (43)`. Es la cifra que se propone como monto: con el
     tope mordiendo, la pantalla propondría un importe que el servidor rechaza con `excede`.
   - `RepartoPrevisualizacion.tsx:266`, el «como máximo se pueden aplicar» pasa a `imputableTotal`:
     **sobrevive** `Test Files 2 passed · Tests 30 passed (30)`.
   - Se cierra dando a los tres campos valores distintos en el fixture base.
2. **En `RepartoPrevisualizacion.test.tsx`, las cifras del servidor CUADRAN con la aritmética que
   un cliente haría**: `pendienteDespues = pendienteActual − monto` en las tres imputaciones
   (`4000−4000=0`, `5000−3000=2000`, `4000−1234,56=2765,44`) y `sobrante = tecleado − imputable`
   (`9000−7000=2000`). El archivo dice existir para probar que «el navegador no calcula dinero» y
   para el TOTAL sí lo prueba (se teclean 9000 y el servidor reparte 4000+3000), pero para esas dos
   restas no: un cliente que las hiciera pintaría lo mismo. Riesgo hoy cubierto por otra vía —el
   barrido money-safe prohíbe `Number(`/`parseFloat(`/`parseInt(`/`.toFixed(` y las bibliotecas de
   decimales en ese archivo, así que la resta no es expresable— pero cubierto por la guardia
   estructural, **no** por estos casos.

Residuo conocido y NO cerrado (necesita recargar el módulo con el entorno pisado, que es cirugía
mayor que este encargo): con el default del servicio en `= 50` literal en vez de
`repartoMensajeroConfig.MAX_CIERRES_POR_REPARTO` —la «segunda copia» que el propio docstring de
`LiquidacionService` prohíbe— sobreviven `Test Files 211 passed · Tests 3141 passed (3141)` **y**
`tsc --noEmit`. El caso «nadie más escribe el 50» de `reparto-mensajero-config.test.ts:73` no lo
ve: solo barre `lib/utils/reparto-liquidacion-mensajero.ts`. Una aserción estructural de una línea
sobre el default del constructor lo cerraría.

## Verificación

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run` (los 2 archivos tocados) | `Test Files 2 passed (2) · Tests 68 passed (68)` |
| `pnpm exec vitest run tests/unit/guards tests/unit/utils tests/unit/services` | `Test Files 235 passed (235) · Tests 3530 passed (3530)` |
| `pnpm exec tsc --noEmit` | `EXIT=0`, sin salida |
| `pnpm exec eslint` (los 2 archivos tocados) | `EXIT=0`, sin salida |

Los cinco archivos de producción que se mutaron durante el ejercicio quedaron restaurados y
comprobados por hash, uno a uno: `LiquidacionService.ts` (`8256cdbe…`), `reparto-mensajero.ts`
(`65ad11db…`), `wallet-mensajeros-labels.ts` (`fb3d8841…`), `PagoMensajeroAcciones.tsx`
(`ea5f00d5…`), `RepartoPrevisualizacion.tsx` (`1ec77254…`). Gate y mutaciones nunca en paralelo.

**Veredicto:** los dos menores encargados quedan cerrados con la mutación que los prueba muerta,
más una tercera de la misma familia (el tope) que apareció al revisar el fixture; dos coincidencias
más quedan reportadas, medidas y sin tocar.
