# Ficha 337 — las gestiones que la tienda resuelve desde novedades ya no entran al cierre del mensajero

> Bitácora de implementación. Worktree aislado `R:/job/singularis/wt-cierres`,
> rama `fix/gestiones-tienda-fuera-del-cierre` desde `origin/dev` (`db4e7511`).
> **Ningún comando git de escritura**: el commit lo hace el leader. `./init.sh` no se corrió.

---

## 0. El defecto, confirmado en el código

Las dos causas que traía la ficha eran exactas. Confirmadas leyendo los archivos, no el grafo:

1. `CierreDiaRepository.findGestionesPendientes` recogía con
   `where: { mensajeroId, cierreId: null, anuladaAt: null }`, sin mirar el origen.
2. `GestionOrdenRepository.reprogramarDesdeDevuelta` y `rechazarDesdeDevuelta` creaban la gestión
   con `cierreId: null` **a propósito**, y sus comentarios lo decían con todas las letras
   (`100/R10`: «entra al proximo cierre pero aporta $0.00»; `240/R18`: «ese NULL es lo que deja que
   la recoja el SIGUIENTE cierre del mensajero»).

**Y había una tercera copia que la ficha no nombraba, que es la que de verdad escribe.** El mismo
`where` estaba escrito **dos veces**, palabra por palabra: en la lectura (línea 432) y en el
`updateMany` de `crearCierre` (línea 755) que es quien pone el `cierre_id`. Arreglar solo la
lectura habría quitado las filas de la pantalla y las habría dejado entrando al documento: el bug
entero, ahora invisible. Por eso el criterio se declara **una sola vez**
(`gestionesDelCierreWhere`) y lo consumen los dos.

---

## 1. Archivos creados / modificados

### Producción (9)

| Archivo | Qué |
| --- | --- |
| `lib/types/orden-historial.ts` | **NUEVA** `ORIGENES_GESTION_FUERA_DEL_CIERRE` = `["rechazo_tienda", "reprogramacion_tienda"]`, con la revocación escrita larga (patrón `specs/332-*/design.md` §0: palabra **revoca**, fecha, motivo, puntero). Ahí vive también la nota del cobro en pausa y el porqué de que `gestion_tienda_ayuda`, `escalado_devuelta_sla` y `rechazo_tope_intentos` se queden DENTRO. Actualizada además la premisa de `ORIGEN_TIPOS_VISITA_REAL`, que citaba a `reprogramacion_tienda` como ejemplo de «entra al cierre por la puerta de atrás». |
| `lib/repositories/CierreDiaRepository.ts` | **NUEVA** `gestionesDelCierreWhere(mensajeroId)`: las 4 condiciones en un solo sitio, consumida por `findGestionesPendientes` **y** por el `updateMany` de `crearCierre`. Plan de la consulta medido y anotado. |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | Contratos de `findGestionesPendientes` y `crearCierre`: qué deja de devolver, que la ayuda sí sigue, y el `null` de `crearCierre` cuando lo único suelto era de escritorio. |
| `lib/repositories/GestionOrdenRepository.ts` | Revocación **junto al `cierreId: null`** de los dos productores. El `NULL` se queda (sigue significando «sin cierre»); lo que se revoca es «y por eso entra al próximo cierre». |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | `240/R18` revocado en su segunda mitad, con la consecuencia de dinero en pausa. `237` **ratificado**: la ayuda sigue dentro. |
| `lib/services/CierreDiaService.ts` | Solo comentario: el hueco declarado del deshacer de `reprogramacion_tienda` **se estrecha** (ya no aparece en la lista del mensajero) pero **cambia de forma** (su ventana ya no se cierra sola al día siguiente). Ver §5. |
| `lib/repositories/OrdenHistorialRepository.ts` | Solo comentario: la sexta condición de `whereIntentosVigentes` **no se retira** y se dice por qué (el escalado del cron sigue entrando; una lista de inclusión no debe apoyarse en que otro filtro exista). |
| `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` | Alcance **C**: el `← se aplicó` y el UUID. |
| `app/(app)/novedades/_components/RechazarNovedadModal.tsx` | **Solo el comentario**, ni una letra del texto visible. Ver §5. |

### Tests (3 nuevos, 3 actualizados)

| Archivo | Qué |
| --- | --- |
| `tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts` | **NUEVO.** El núcleo, contra Postgres real. 4 casos. |
| `tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts` | **NUEVO.** La guardia del conjunto cerrado. 7 casos. |
| `tests/components/CierreTarifaAplicada.test.tsx` | **NUEVO.** Los dos defectos de pantalla. 10 casos. |
| `tests/unit/repositories/cierre-dia-repository.test.ts` | Los **5** `toEqual` literales del `where` (lectura y `updateMany`) ganan la cuarta condición. Son EL CONTRATO, así que se extienden, no se relajan. |
| `tests/components/CierresAdminModule.test.tsx` | La aserción del UUID (`getByText("tar_88")`) se **INVIERTE** a `queryByText(...)).toBeNull()`, con el porqué (convención `decision5-revertida`: la decisión vieja no se borra, se da vuelta). |
| `tests/components/CierreTarifaEspecial.test.tsx` | Un comentario que **afirmaba el defecto** («El de "Flete devuelto" sigue encendido y es correcto») corregido, y un `toBeGreaterThan(0)` apretado a `toHaveLength(1)`. |

---

## 2. Lo que se decidió y por qué (lo que un diff no cuenta)

### 2.1 Lista de EXCLUSIÓN, no de inclusión — y va contra la convención vecina

`ORIGEN_TIPOS_VISITA_REAL` es de inclusión y su comentario dice «jamás de exclusión». Aquí se hace
al revés **a propósito**, y está argumentado en el código: la pertenencia al cierre es hoy
**universal** (toda gestión suelta del mensajero entra). Una lista blanca dejaría fuera **en
silencio** a `escalado_devuelta_sla`, `rechazo_tope_intentos` y a cualquier familia de calle futura
— trabajo que el mensajero sí hizo y que dejaría de pagarse. En este predicado la dirección segura
del error es «ante la duda, entra».

Lo que impide que una familia nueva se cuele **no es la polaridad de la lista**: es la guardia del
alcance B.

### 2.2 La guardia (alcance B): partición declarada, no lista derivada

`origenes-admitidos-en-cierre.guardia.test.ts` escribe **a mano** las 31 familias admitidas y
comprueba `ADMITIDOS ∪ FUERA = enum` y `ADMITIDOS ∩ FUERA = ∅`. Si el enum gana un valor, la unión
deja de cuadrar y hay que decidir en voz alta.

**No se derivó `ADMITIDOS` de `SEED.filter(...)`**: eso sería comparar la lista contra la función
que la genera, siempre verde. Es el error que este repo ya pagó.

La guardia además fija la diferencia entre las **dos** listas de la tienda, que es donde está la
trampa de lectura: `ORIGENES_GESTION_DE_LA_TIENDA` responde «¿quién la registró?» y bloquea el
DESHACER; la nueva responde «¿de quién es el trabajo?» y decide el CIERRE. Se solapan en
`rechazo_tienda` y **no** en las otras dos. Fundirlas saca la ayuda del cierre o devuelve la
reprogramación.

### 2.3 Lo que se dejó DENTRO a sabiendas

- `gestion_tienda_ayuda` (237) — pedido humano textual, «lo que no es ayuda».
- `escalado_devuelta_sla` (99) y `rechazo_tope_intentos` (276) — **también** nacen con
  `cierre_id NULL` sin que el mensajero decida nada, y también entran al cierre. Se quedan porque
  mueven dinero **vivo** por el cierre (`cobroRechazado`, 56): sacarlas sin su vía propia pausaría
  un ingreso que hoy **sí** se emite. Es alcance ajeno, y queda dicho en el código y afirmado por
  la guardia, no en silencio.

### 2.4 El rendimiento, medido

El `none` compila a `NOT EXISTS` correlacionado. `EXPLAIN` sobre la base local (2026-08-31):

```
Nested Loop Anti Join
  ->  Seq Scan on gestion_orden  (filtro mensajero + cierre_id IS NULL + anulada_at IS NULL)
  ->  Materialize
        ->  Seq Scan on orden_historial_estado t0  (filtro origen_tipo IN (...))
```

`Materialize` es la parte que importa: `orden_historial_estado` se recorre **una vez por consulta,
no una por gestión** — no hay N+1. Con `enable_seqscan = off` (la misma técnica con que se midió
`marcarDesdeAyudaTienda` el 2026-08-20) el lado externo entra por el parcial de siempre
`gestion_orden_mensajero_pendiente_idx` y el interno por `orden_historial_actor_origen_created_idx`
(Bitmap Index Scan sobre `origen_tipo`). Los seq scans de arriba son de una tabla de **204 filas**:
con volumen el planificador tiene índice al que ir.

**No se creó ningún índice y no hay migración.** Deliberado: una migración en un hotfix urgente
ampliaría el radio y, con la base local compartida por symlink entre worktrees, pondría roja la
verificación del agente que trabaja en el repo principal. Si algún día la consulta apareciera
lenta, lo que hay que mirar es un índice parcial
`(gestion_orden_id) WHERE origen_tipo IN (...)`; queda escrito en el código.

---

## 3. Alcance C — los dos defectos de pantalla

### (a) El `← se aplicó` que nunca miraba el resultado

Decidía con `esCentral` y el pacto, **nunca** con el resultado, así que en una entrega GAM
encendía a la vez «Valor flete GAM» y «Flete devuelto GAM». La fuente de verdad ya estaba en el
DTO y no hizo falta aritmética nueva: `derivarIngresoOrden` deja `flete` en `null` salvo en
`entregada` y `fleteDevolucion` en `null` salvo en `rechazada`.

Invariante que ahora se afirma: **como mucho UNA fila lleva la marca, y en las que cobran 0,00 no
la lleva ninguna.** Money-safe: se lee la **presencia** del concepto (`!== null`), jamás su
importe — hay un caso que fija que un flete legítimo de `"0.00"` **sí** se marca.

### (b) El UUID crudo

Se retira del panel; `TARIFA_NOTA` («Congelada al solicitar el cierre») se queda. **Un test lo
afirmaba** (`CierresAdminModule.test.tsx`, `getByText("tar_88")`) y se invirtió con su porqué. El
dato sigue viajando en `TarifaSnapshotDTO.tarifaId`: lo que se quitó es su presencia en pantalla.

No se puso fecha de congelación en su lugar porque no está en ese DTO y traerla habría exigido
tocar el repo, el DTO y el prop drilling del módulo — desproporcionado para un hotfix, y la ficha
autorizaba explícitamente quitarlo.

---

## 4. Mapa requisito → test

| Requisito (del encargo) | Test |
| --- | --- |
| **A** — una `rechazo_tienda` NO aparece en el cierre | `tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts` → «`findGestionesPendientes` devuelve la de CALLE y la de AYUDA…» y «`crearCierre` VINCULA solo la de calle y la de ayuda…» |
| **A** — una `reprogramacion_tienda` NO aparece | mismos dos casos (el conjunto exacto es `toEqual`, no `not.toContain`) |
| **A** — una `gestion_tienda_ayuda` **SÍ** aparece (regresión 237) | mismos dos casos + `origenes-admitidos-en-cierre.guardia.test.ts` → «`gestion_tienda_ayuda` esta ADMITIDA» |
| **A** — una gestión de calle (`gestion`) **SÍ** aparece | mismos dos casos + guardia → «`gestion` (la visita de calle) esta ADMITIDA» |
| **A** — el caso Andy Cortes: cierre entero ajeno | `…-escritorio.test.ts` → «un mensajero cuyas UNICAS gestiones sueltas son de escritorio NO recibe cierre (`null`)» |
| **A** — los totales de un cierre solo-de-calle no cambian | `…-escritorio.test.ts` → «un cierre SOLO de calle vincula lo mismo y con los MISMOS totales que antes de la 337» (totales de cabecera + `pago_mensajero` por gestión, STRING escala 2) |
| **A** — el `where` probado donde vive | los 4 casos anteriores corren contra **Postgres real** (`_postgres-real.ts`, transacción revertida). Los 5 `toEqual` de `cierre-dia-repository.test.ts` fijan además la FORMA del predicado en los dos puntos |
| **B** — el conjunto de orígenes admitidos es CERRADO | `tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts` → «ADMITIDOS ∪ FUERA = el enum entero» + «ADMITIDOS ∩ FUERA = ∅» + «las que NO entran son EXACTAMENTE las dos de escritorio» |
| **B** — las otras sintéticas quedan visibles como decisión | guardia → «`escalado_devuelta_sla` y `rechazo_tope_intentos` siguen ADMITIDAS» |
| **C.a** — la marca señala la fila que de verdad se aplicó | `tests/components/CierreTarifaAplicada.test.tsx` → 4 casos entrega/rechazo × GAM/no-GAM, con `toEqual` del conjunto de filas marcadas |
| **C.a** — ninguna marca cuando el resultado no cobra | mismo archivo → «una REPROGRAMADA (cobra 0,00) no marca NINGUNA fila» y «una DEVUELTA (301) tampoco» |
| **C.a** — el pacto especial no se marca de más | mismo archivo → «con pacto especial y ENTREGA…» y «con pacto especial y REPROGRAMADA…» |
| **C.b** — el UUID ya no se imprime | mismo archivo → «el panel ya NO imprime el UUID crudo…» + `CierresAdminModule.test.tsx` (aserción invertida) |

---

## 5. Lo que NO se hizo, y por qué está aquí en vez de en silencio

1. **No se limpiaron los datos de producción.** Fuera de alcance por instrucción: lo hace el leader,
   medido, DESPUÉS del merge. El orden importa y la ficha ya lo dice: limpiar antes no sirve.
2. **No se construyó la vía nueva de cobro a la tienda.** Otra ficha.
3. **No se tocó `feature_list.json` ni `progress/current.md`.** (`feature_list.json` aparece como
   modificado en el worktree; **no fue por mí**, ya venía así.)
4. **No se tocó `CorteDiarioRepository.findMensajerosConActividadSinCierre`.** Sigue seleccionando
   sin restar a nadie, y `crearCierre` decide con su guarda «algo paso» (271/R21-R22, decisión
   documentada). Con el arreglo, un mensajero cuyo único trabajo suelto sea de escritorio entra en
   la lista, `crearCierre` devuelve `null` y no se crea nada — verificado en el tercer caso del
   test contra Postgres. Cambiarlo habría sido rediseñar lo que no está roto.
5. **`RECHAZO_AVISO` no se reescribió**, y esta es la decisión que más conviene revisar. El aviso
   que la tienda ve al rechazar dice: *«Esto le cobra a tu tienda el flete de devolución y no se
   puede deshacer.»* Sigue siendo cierto **en el qué** (el humano quiere que se cobre) y **en la
   irreversibilidad**; lo que cambió es **por qué documento sale**. Decirle a la tienda «esto no te
   cobra nada» sería más falso que no nombrar el mecanismo. Se anotó en el comentario del archivo,
   con un aviso para quien construya la vía propia. **Si el leader prefiere matizar la copia, es
   una decisión de producto, no de esta ficha.**
6. **El hueco del deshacer de `reprogramacion_tienda` sigue abierto** (ya estaba declarado en
   `CierreDiaService`, alcance ajeno), pero **cambia de forma** y hay que saberlo: antes la ventana
   se cerraba sola en cuanto el siguiente cierre recogía la gestión (guarda `cierre_id IS NULL`);
   al no recogerla ya ningún cierre, **esa ventana no se cierra nunca**. Se estrecha por otro lado:
   la gestión ya no aparece en la lista del mensajero, así que la pantalla no le ofrece el botón.
   Queda alcanzable solo por su id. Dinero neutro (`reprogramada` no emite ningún concepto).

---

## 6. Verificación ejecutada

### `pnpm typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\wt-cierres
> tsc --noEmit

EXIT=0
```

### `pnpm lint`

```
✖ 127 problems (0 errors, 127 warnings)
EXIT=0
```

Los 127 son avisos preexistentes de `no-unused-vars` en dobles de test. **Ninguno cae en un
archivo tocado por esta ficha** (comprobado por grep sobre la salida).

### Tests nuevos y dirigidos

```
$ pnpm exec vitest run tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts \
                      tests/components/CierreTarifaAplicada.test.tsx \
                      tests/components/CierreTarifaEspecial.test.tsx
 Test Files  3 passed (3)
      Tests  24 passed (24)

$ pnpm exec vitest run tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts
 Test Files  1 passed (1)
      Tests  4 passed (4)          ← contra Postgres real, no dobles

$ pnpm exec vitest run cierre cierres gestion-desde-ayuda corte-diario
 Test Files  142 passed (142)
      Tests  2010 passed (2010)
```

### 🔴 LA MUTACIÓN — quitar el filtro nuevo y comprobar que enrojece

Mutación aplicada en `lib/repositories/CierreDiaRepository.ts`, quitando la cuarta condición del
predicado. **Autocomprobada en disco antes de correr nada** (el archivo quedó así):

```ts
function gestionesDelCierreWhere(mensajeroId: string): Prisma.GestionOrdenWhereInput {
  return {
    mensajeroId,
    cierreId: null,
    anuladaAt: null,
  };
}
```

Salida REAL contra Postgres, con la mutación puesta:

```
 ❯ tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts (4 tests | 3 failed) 372ms
     × `findGestionesPendientes` devuelve la de CALLE y la de AYUDA, y NINGUNA de escritorio 97ms
     × `crearCierre` VINCULA solo la de calle y la de ayuda; las de escritorio siguen sueltas 48ms
     × un mensajero cuyas UNICAS gestiones sueltas son de escritorio NO recibe cierre (`null`) 18ms

AssertionError: expected [ …(4) ] to deeply equal [ …(2) ]
- Expected
+ Received
  [
+   "07a21df2-e004-4767-804a-213adadbd057"
    "9a4aaac6-dc8e-4617-9ad2-7560a01133b7",
    "e1084db4-fb25-4c98-8527-8fa95607b536",
+   "f368f69b-1ff5-4999-8097-08c769305fa0",
  ]

AssertionError: expected [ …(4) ] to deeply equal [ …(2) ]     ← el cierre se llevó las 4
AssertionError: expected 'ce558116-7f97-4ffd-bc58-9e10a920c989' to be null   ← y creó el cierre ajeno

 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)
```

El cuarto caso (el cierre solo-de-calle) **sigue verde con la mutación, y debe seguirlo**: quitar
el filtro no cambia nada para un mensajero que solo tiene trabajo de calle. Es la comprobación de
que ese caso mide la no-regresión y no el filtro.

Los `toEqual` literales del `where` también enrojecen:

```
$ pnpm exec vitest run tests/unit/repositories/cierre-dia-repository.test.ts   # CON la mutación
     × 67/R13/R14/R15: el WHERE exige `anuladaAt: null` (las gestiones deshechas no se listan)
     × el WHERE del updateMany que VINCULA exige `anuladaAt: null` …
     × R5: no puede haber filas de gestiones anuladas (el updateMany ya solo vincula vigentes)
     × findGestionesPendientes sigue leyendo gestion_orden en vivo, sin tocar cierreDetail
     × R16: el WHERE de la vinculacion NO filtra por `resultado` (el incidente entra solo)
      Tests  5 failed | 99 passed (104)
```

Mutación revertida y verde recuperado:

```
$ pnpm exec vitest run tests/integration/db/cierre-excluye-gestiones-de-escritorio.test.ts \
                      tests/unit/repositories/cierre-dia-repository.test.ts
 Test Files  2 passed (2)
      Tests  108 passed (108)
```

### Suite completa (`pnpm test`)

```
 Test Files  1 failed | 1586 passed (1587)
      Tests  1 failed | 22292 passed | 26 skipped (22319)
   Duration  506.06s
FULL_EXIT=1
```

El **único** rojo de las 22.319 es `superficie-de-uso.guardia.test.ts`, **heredado de `origin/dev`
y ajeno a esta ficha** — la prueba está en §7.

---

## 7. ⚠️ Un rojo que NO es de esta ficha

```
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts
   × ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
   + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```

**Es preexistente en `origin/dev` (`db4e7511`), no lo introduce este cambio.** La prueba:

- `lib/actions/tarifas.ts` **no está en mi diff** (`git status` lo confirma: mis 9 archivos de
  producción no lo incluyen);
- `obtenerTarifa` **no tiene ni un consumidor en todo el árbol** (`grep` sobre `app/`, `lib/`,
  `components/` devuelve solo su propia definición), así que ningún cambio mío pudo quitárselo:
  no había ninguno que quitar;
- mi diff es aditivo (comentarios + una condición en un `where`) y no borra ningún import ni
  ningún archivo.

Queda para el leader: o se le devuelve superficie a `obtenerTarifa`, o se anota
`/** @sin-superficie … */`. No lo toco porque es otra ficha y tocarlo aquí ensuciaría este PR.

---

## 8. 💰 La consecuencia de dinero, declarada y NO resuelta

Hoy el cobro de flete devuelto por un rechazo de escritorio (`rechazo_tienda` → gestión
`resultado = rechazada` → `cobroRechazado` de la 56) **solo se materializaba al aprobar el cierre
del mensajero**. Al sacar esas gestiones del cierre, **ese cobro queda en pausa**.

**No se pierde.** La gestión, su `resultado` y la tarifa congelada de la orden siguen enteras en la
base: cuando exista la vía propia de cobro a la tienda, el cobro se emite desde ahí sin
reconstruir nada. Lo que deja de haber es un documento que lo emita.

Escrito con esas palabras en cuatro sitios del código, para que nadie crea que se perdió:
`lib/types/orden-historial.ts` (la lista), `lib/repositories/CierreDiaRepository.ts` (el predicado
y el `updateMany`), `lib/repositories/GestionOrdenRepository.ts` (junto al `cierreId: null` del
productor) y `lib/interfaces/repositories/IGestionOrdenRepository.ts` (el contrato).

La otra mitad, `reprogramacion_tienda`, es **money-neutral**: una `reprogramada` no emite ningún
concepto, así que sacarla del cierre no pausa nada.

---

## Veredicto

Las gestiones de escritorio ya no entran a ningún cierre —probado contra Postgres en los dos
puntos, lectura y escritura, con la mutación enrojeciendo— la ayuda y el trabajo de calle siguen
intactos con sus totales sin mover, y el cobro del flete devuelto por rechazo de escritorio queda
**en pausa y declarado**, no perdido.

---
---

# 💰 SEGUNDA MITAD — la vía propia de cobro a la tienda (2026-08-31)

> Continuación de la bitácora de arriba, mismo worktree (`R:/job/singularis/wt-cierres`) y misma
> rama. La primera mitad (commit `eea84035`) **sacó** las gestiones de escritorio del cierre del
> mensajero y dejó el cobro **en pausa**; esta mitad le da su **documento propio**.
> **Ningún comando git de escritura**: el commit lo hace el leader. `./init.sh` no se corrió.

---

## 8-bis. Lo que se construyó, en una frase

Cuando la tienda rechaza desde novedades (`rechazo_tienda` → gestión `rechazada`), **en la misma
transacción** nace un **COBRO PENDIENTE** contra esa tienda (`rechazo_tienda_cobro`) con el flete de
devolución y su IVA **congelados** de la tarifa de ese instante. Un administrador (`esAccesoTotal`)
lo **aprueba** desde `/wallet`, y **sólo entonces** nacen los apuntes de dinero: los **mismos** que
hoy emite la aprobación del cierre para una `rechazada`.

Es el **espejo de la ficha 333** (`gasto_fijo_cobro`) —tabla propia con estado, clave única de
idempotencia, decisión atómica con `UPDATE … WHERE estado='pendiente'`, cola en `/wallet`— y **no
su generalización**: aquélla salió a producción hace horas y hacerla genérica con la operación
andando es el riesgo que no toca correr.

---

## 9. ⚠️ LA CORRECCIÓN MÁS IMPORTANTE DE ESTA MITAD: eran DOS cobros, no uno

La bitácora de la primera mitad (§8) y sus cuatro notas en el código decían «el cobro de flete
devuelto por un `rechazo_tienda` (56, `cobroRechazado`) queda en pausa», nombrando **como uno solo
dos conceptos que tienen dueños distintos**. Leído en el archivo real
(`lib/utils/ingreso-bodega.ts` y `lib/utils/ingreso-ordenex.ts`), y ya estaba escrito en
`RechazarNovedadModal.tsx` desde la 240:

| Concepto | De quién es | Estado tras esta mitad |
| --- | --- | --- |
| **`ingreso_flete_devolucion` + su IVA** — lo que paga **la TIENDA**, de su tarifa (`derivarIngresoOrden`) | ingreso de **Ordenex** / débito de la tienda | ✅ **RESUELTO** — es lo que esta ficha construye |
| **`cobroRechazado` / `ingreso_bodega_rechazo`** (56) — de la tarifa **zona+vehículo del mensajero** | ingreso de **la BODEGA** | ⛔ **SIGUE EN PAUSA** |

El segundo se congelaba en el `updateMany` de `crearCierre` (`gestion_orden.ingreso_bodega_rechazo`)
y lo consume el **cierre de BODEGA** (40/56). Sin cierre del mensajero no hay congelado que sumar, y
**esta ficha no lo restaura**: el encargo nombra explícitamente `ingreso_flete_devolucion` + su IVA,
y traerse el ingreso de la bodega exigiría tocar el cierre de bodega, que es alcance ajeno.

**No se pierde** (la gestión y su `resultado = rechazada` siguen enteros), pero **hoy nadie lo
emite**. Las **seis** notas del código que decían «el cobro queda en pausa» se reescribieron para
distinguir los dos, en vez de dejarlas mintiendo a medias:
`lib/types/orden-historial.ts`, `lib/repositories/CierreDiaRepository.ts` (×2),
`lib/interfaces/repositories/ICierreDiaRepository.ts`,
`lib/interfaces/repositories/IGestionOrdenRepository.ts`,
`lib/repositories/GestionOrdenRepository.ts`.

---

## 10. Archivos creados / modificados (segunda mitad)

### Datos (3)

| Archivo | Qué |
| --- | --- |
| `db/migrations/20260831120000_rechazo_tienda_cobro/migration.sql` | **NUEVO.** `CREATE TYPE rechazo_tienda_cobro_estado` (3 valores) + `CREATE TABLE rechazo_tienda_cobro` con sus **2 CHECK**, **5 FK** y **4 índices**, + `ENABLE ROW LEVEL SECURITY`. Cabecera larga: la idempotencia en tres capas con el nombre de cada una, y por qué **no** hay backfill de los 22 rechazos históricos. |
| `…/down.sql` | **NUEVO.** `DROP TABLE` → `DROP TYPE`. Dice en voz alta qué se pierde (la intención de cobrar) y qué no (los apuntes ya escritos, que son inmutables). **No se tocó ningún `down.sql` anterior**: esta migración no amplía ningún enum preexistente, así que no hay lista previa que ninguno tenga que aprender. |
| `db/schema.prisma` | Enum `RechazoTiendaCobroEstado` + modelo `RechazoTiendaCobro` + **5 back-relations** (`GestionOrden.cobroRechazoTienda` 1-1, `Orden.cobrosRechazoTienda`, `Usuario` ×2, `Tarifa`). |

### Producción — la vía nueva (6 nuevos)

| Archivo | Qué |
| --- | --- |
| `lib/types/rechazo-tienda-cobro.ts` | DTO + schemas zod `.strict()` + resultados de servicio y de action. |
| `lib/config/rechazo-tienda-cobro.ts` | El tope de la cola (patrón `lib/config/gasto-fijo.ts`). |
| `lib/interfaces/repositories/IRechazoTiendaCobroRepository.ts` | Contrato del repo. |
| `lib/interfaces/services/IRechazoTiendaCobroService.ts` | Contrato del service + `RechazoTiendaCobroTx` (las **tres** tablas que la transacción toca, y ninguna más) + su runner. |
| `lib/repositories/RechazoTiendaCobroRepository.ts` | Sólo Prisma. `crearPendiente` (idempotente), `obtenerPorId`, `listarPendientes`, `contarPendientes`, `marcarDecidido`. |
| `lib/services/RechazoTiendaCobroService.ts` | `listarPendientes` / `aprobar` / `rechazar`. Guard `esAccesoTotal` en los tres. |
| `lib/actions/rechazo-tienda-cobro.ts` | Las **tres** Server Actions + el composition root. |

### Producción — el productor y sus contratos (6 modificados)

| Archivo | Qué |
| --- | --- |
| `lib/interfaces/repositories/IGestionOrdenRepository.ts` | `RechazarDesdeDevueltaInput` gana `trasCrearGestion?` (hook opcional) + el tipo `GestionTxClient`. |
| `lib/repositories/GestionOrdenRepository.ts` | `transicionarDesdeDevuelta` gana el **paso 3-bis** (el efecto extra, dentro de la tx, antes del append del historial) y `rechazarDesdeDevuelta` lo cablea. |
| `lib/interfaces/repositories/IOrdenRepository.ts` | **NUEVO** `OrdenBaseCobroDevolucionRow` + `findBaseCobroDevolucion`. |
| `lib/repositories/OrdenRepository.ts` | Su implementación: cinco columnas y dos relaciones, `select` explícito. |
| `lib/services/RechazoTiendaService.ts` | Gana `tarifaRepo`, `cobroRepo` y el reloj **en el constructor (obligatorios)**, y el método privado `congelarCobro`. |
| `lib/actions/resolver-novedad.ts` | El composition root pasa los dos repositorios nuevos. |

### Pantalla (4)

| Archivo | Qué |
| --- | --- |
| `app/(app)/wallet/_components/cobro-rechazo-tienda-labels.ts` | **NUEVO.** Vocabulario visible, módulo puro. |
| `app/(app)/wallet/_components/CobrosRechazoTiendaPendientesPanel.tsx` | **NUEVO.** La cola, con `Card`/`Badge`/`DataTable` y **sin lenguaje visual nuevo**. |
| `app/(app)/wallet/_components/WalletModule.tsx` | Monta la sección bajo la de gasto fijo, con **prop propia** `puedeDecidirCobrosRechazo`. |
| `app/(app)/wallet/page.tsx` | Pre-fetch server-side + `esAccesoTotal(actor.rol)` bajado por props. |

### Comentarios corregidos (5) — ver §9

`lib/types/orden-historial.ts`, `lib/repositories/CierreDiaRepository.ts`,
`lib/interfaces/repositories/ICierreDiaRepository.ts`,
`lib/interfaces/repositories/IGestionOrdenRepository.ts`,
`app/(app)/novedades/_components/RechazarNovedadModal.tsx` (**sólo el comentario**: ni una letra del
texto visible; `RECHAZO_AVISO` sigue siendo cierto y ahora con más razón).

### Tests (3 nuevos, 10 actualizados)

| Archivo | Qué |
| --- | --- |
| `tests/integration/db/rechazo-tienda-cobro.int.test.ts` | **NUEVO.** 10 casos **contra Postgres**: la clave única, los CHECK, **cuatro aprobaciones concurrentes reales** y la forma de la tabla en la base. |
| `tests/unit/services/rechazo-tienda-cobro-service.test.ts` | **NUEVO.** 28 casos: guard de rol × 4 roles × 3 métodos, los cuatro apuntes con `toEqual` del array entero, el IVA en cero, el interruptor de la 43, el orden de los pasos. |
| `tests/unit/components/wallet-cobros-rechazo-tienda-panel.test.tsx` | **NUEVO.** 12 casos de pantalla. |
| `tests/unit/services/rechazo-tienda-service.test.ts` | +10 casos del cobro congelado; el `toHaveBeenCalledWith` literal **se extiende** con `trasCrearGestion` y el censo de métodos del repo **se extiende** con `findBaseCobroDevolucion`. |
| `tests/unit/repositories/gestion-orden-rechazar.test.ts` | +4 casos del hook (que se invoca con la gestión creada, que **no** se invoca en la carrera perdida, el orden respecto al historial, y que sin hook nada cambia). |
| `tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` | La tabla nueva se registra `fuera` con su motivo; los cuatro contadores del guardia suben (28→29 archivos, 28→29 instancias, 9→10 exclusiones, 29→30 total). |
| `tests/integration/db/schema-drift-saneamiento.test.ts` | El censo de `updated_at` con DEFAULT pasa de SIETE a OCHO tablas. |
| `tests/unit/components/wallet-page-cobros-pendientes.test.tsx`, `tests/integration/wallet-page.test.tsx`, `tests/components/descarga/WalletDescarga.test.tsx` | Doblan la Server Action nueva / pasan la prop nueva. |
| `tests/unit/services/{bulk-orden-service,bulk-orden-service.carga-api,orden-service,rol-admin-satelite-authz}.test.ts` | Los cuatro dobles completos de `IOrdenRepository` ganan `findBaseCobroDevolucion`. |

---

## 11. Las decisiones que un diff no cuenta

### 11.1 El alta del cobro va **dentro** de la transacción del rechazo, y por eso hay un hook

`rechazarDesdeDevuelta` abre su propia `$transaction`. El cobro **tiene** que nacer ahí: una caída
entre el commit del rechazo y una inserción posterior dejaría un rechazo que **no se cobra nunca y
sin que nada lo diga** — exactamente el fallo mudo que esta ficha vino a cerrar por el otro lado.

Pero `GestionOrdenRepository` **no debe escribir en `rechazo_tienda_cobro`**. La solución es la
forma que ese mismo helper **ya usaba**: `crearGestion` es un callback que aporta el llamador. Se
añade un segundo, `trasCrearGestion(tx, gestionId)`, **opcional**, invocado sólo si la gestión se
creó de verdad. El repositorio presta su transacción; el servicio decide qué se escribe y con qué
repositorio.

**Y el `gestionId` no puede existir antes**: es a la vez la clave única del cobro y el `origen_id`
de los apuntes. Por eso el alta no se puede adelantar.

### 11.2 El importe se congela **fuera** de la transacción, y no es una contradicción

`congelarCobro` lee la orden y resuelve la tarifa **antes** de abrir la transacción. Lo que congela
un importe es **copiarlo**, no el aislamiento; meter dos lecturas más dentro de una transacción que
escribe dinero sólo alarga su bloqueo de fila. Lo que sí entra en la transacción es la **inserción**.

### 11.3 `esAccesoTotal` y no el guard estrecho de la 333 — y **prop propia** en la pantalla

Decisión del humano: la 333 estrechó a `maestro` porque autoriza dinero que **sale** de la caja;
esto es **cobrar** por un servicio ya prestado y es operación diaria. Estrechar aquí pondría la caja
diaria a esperar al maestro.

En la pantalla **no se reusó `puedeDecidirCobros`** aunque hoy el maestro cumpla las dos: son dos
reglas distintas, y una sola prop las ataría — el día que una cambie, cambiaría la otra sin que
nadie lo decida. `page.tsx` calcula la nueva con `esAccesoTotal(actor.rol)`, **el mismo predicado que
aplica el servicio**, y no con un `=== admin || === maestro` escrito a mano: dos copias divergen.

### 11.4 Los dos importes van en **columnas separadas** y no hay total

Sumar flete e IVA para pintar una celda sería **la única operación de dinero de la ficha**, y
existiría sólo para eso. La tabla enseña los dos conceptos como los enseña el detalle del cierre, y
un caso de pantalla afirma que la suma (`₡2.825`) **no** aparece.

### 11.5 Nada que cobrar ⇒ **no se cobra, y el rechazo sigue**

Dos causas legítimas comparten desenlace: (a) la tienda no tiene tarifa vigente para su par
(tienda, zona) — el «gap seguro» de R9 de la 42; (b) la tarifa existe pero el flete de devolución es
`0,00` — un cobro de cero no es un cobro, igual que `agregarIngresosPorConcepto` **omite** los
conceptos en `0.00` (R10). En los dos casos el hook viaja como `undefined` y el repositorio se
comporta **exactamente** como antes de esta ficha. La dirección segura del error aquí es **no
cobrar**: un cobro fantasma contra una tienda es peor que uno que no se emitió.

El **IVA en `0,00` sí se guarda** y el cobro nace: ese cero es un valor real (tarifa con
`iva_flete = 0`). Por eso el CHECK es `monto_flete > 0 AND monto_iva >= 0` y no `> 0` en las dos.

### 11.6 `origen_tipo = 'gestion_orden'` — un valor del enum que **nadie escribía**

Verificado por grep sobre `lib/` y `app/`: ningún escritor usaba ese valor de `wallet_origen_tipo`.
Estrenarlo es lo que hace que **la idempotencia salga gratis**: los dos índices únicos parciales que
ya protegen los libros (`wallet_movimiento_origen_categoria_uq` y su hermano por tienda) cubren
estas filas **sin crear nada**, y no pueden colisionar con la clave de ningún otro escritor.

### 11.7 **No hay columna `movimiento_id`**, a diferencia de la 333

Allí un cobro salda **un** movimiento; aquí son **cuatro** (dos por libro), así que un FK escalar no
podría representarlo y una tabla de enlace sería maquinaria para nada. El vínculo existe y es
consultable: los cuatro apuntes llevan `origen_tipo = 'gestion_orden'` y `origen_id = <gestionId>`.

### 11.8 El interruptor de la 43 **se respeta**

`TIENDA_DEBITA_FLETE_DEVOLUCION` decide si el ledger de la tienda recibe los dos débitos. El feed
del cierre lo respeta; ignorarlo aquí haría que **la misma política de la casa se aplicara por una
vía y no por la otra** — la divergencia silenciosa que la 43 escribió su R28 para impedir. Se inyecta
con default al singleton, y un caso verifica el estado apagado.

---

## 12. Los **22 rechazos que ya existen en producción**

Medidos por la primera mitad el 2026-08-31: **22 gestiones `rechazo_tienda`** dentro de los 6 cierres
pendientes, cuyo cobro quedó en pausa. **La migración NO les crea su pendiente**, y no es un olvido:

- un backfill que **emite dinero** no se cuela dentro de un `migration.sql` — correría en el deploy,
  que nadie mira, y en preview contra otra base;
- los importes saldrían de la tarifa que resuelva **en el momento del deploy** y no en el del
  rechazo, que es justo lo que el resto de la tabla existe para evitar.

**El alta de esos 22 la decide un humano, aparte, con el número medido delante.** Cuando se decida,
la vía es directa y no exige código nuevo: por cada gestión, `derivarIngresoOrden` con la tarifa que
se acuerde y un `INSERT` en `rechazo_tienda_cobro` con `gestion_id` — la clave única impide
duplicarlos aunque el script se corra dos veces. Y quedarán **pendientes**, no cobrados: la
aprobación sigue siendo de un humano.

Queda escrito también en la cabecera de la migración.

---

## 13. Mapa requisito → test (segunda mitad)

| Requisito (del encargo) | Test |
| --- | --- |
| El rechazo crea un **pendiente**, no un movimiento | `rechazo-tienda-service.test.ts` → «el cobro nace DENTRO de la transaccion…» + `rechazo-tienda-cobro-service.test.ts` → «`ya_decidido` … NO escribe en ningún libro» |
| El alta va **dentro** de la transacción del rechazo | `gestion-orden-rechazar.test.ts` → «se invoca con el `tx` y con el id de la gestion RECIEN creada» + «va ANTES del append del historial» |
| Carrera perdida ⇒ **sin cobro** | `gestion-orden-rechazar.test.ts` → «NO se invoca cuando la orden ya salio de `devuelta`» + `rechazo-tienda-service.test.ts` → «la carrera perdida NO deja cobro» |
| **El cálculo no se reescribe** (`derivarIngresoOrden` tal cual) | `rechazo-tienda-service.test.ts` → «el importe es el que produce `derivarIngresoOrden`…», «una orden en zona GAM cobra la columna GAM», «el PACTO ESPECIAL del distrito manda» |
| Importe **congelado**, no recalculado al aprobar | `rechazo-tienda-cobro-service.test.ts` → «los importes son los del COBRO, no unos recalculados» |
| Sin tarifa / flete 0,00 ⇒ no se cobra y el rechazo sigue | `rechazo-tienda-service.test.ts` → dos casos + `rechazo-tienda-cobro.int.test.ts` → «un cobro con `monto_flete = 0` NO entra» |
| Al aprobar, **los mismos apuntes** que el cierre | `rechazo-tienda-cobro-service.test.ts` → «la CAJA … recibe los dos ingresos» + «el LIBRO DE LA TIENDA recibe los dos debitos espejo» (`toEqual` del array entero) |
| El IVA en 0,00 no emite apunte (R10 de la 42) | mismo archivo → «un IVA de 0,00 NO emite su apunte en ninguno de los dos libros» |
| El interruptor de la 43 se respeta | mismo archivo → «el interruptor de la 43 apagado…» |
| **Idempotencia**: clave única por gestión | `rechazo-tienda-cobro.int.test.ts` → «dos altas del MISMO rechazo dejan UNA sola fila», «el segundo intento NO pisa los importes», «un cobro ya RECHAZADO no se puede volver a dar de alta», «el indice unico … es TOTAL (sin `WHERE`)» |
| **Aprobar dos veces no cobra dos veces** (concurrencia real) | `rechazo-tienda-cobro.int.test.ts` → «UNA gana, TRES leen `ya_decidido`, y el dinero se escribe UNA sola vez» |
| **Guard de rol** (`esAccesoTotal`) | `rechazo-tienda-cobro-service.test.ts` → 12 casos (4 roles × aprobar/rechazar/listar) |
| Los CHECK de la base | `rechazo-tienda-cobro.int.test.ts` → 3 casos |
| RLS habilitada | `rechazo-tienda-cobro.int.test.ts` → «tiene RLS habilitada» |
| Enum cerrado de 3 valores | `rechazo-tienda-cobro.int.test.ts` → «el enum del estado tiene EXACTAMENTE tres valores» |
| La cola en `/wallet`, con las primitivas de siempre | `wallet-cobros-rechazo-tienda-panel.test.tsx` → 12 casos |
| El `total` es el del servidor, no `items.length` | mismo archivo → «insignia con el total del SERVIDOR» (2 items, total 7) |
| Ningún importe viaja desde el navegador | mismo archivo → «aprobar manda SOLO el id» |
| Sin permiso: sin botones, pero la cola se ve | mismo archivo → «sin permiso para decidir NO hay botones…» |
| La tabla nueva declara si descarga | `tests/unit/descarga/cobertura-tablas.guardia.test.ts` (se vio ROJA antes de registrarla) |

---

## 14. Verificación ejecutada

### `pnpm typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\wt-cierres
> tsc --noEmit

TYPECHECK_EXIT=0
```

### `pnpm lint`

```
✖ 127 problems (0 errors, 127 warnings)
LINT_EXIT=0
```

Los 127 son avisos preexistentes de `no-unused-vars` en dobles de test — **el mismo número que
reportó la primera mitad**. Ninguno cae en un archivo de esta mitad (comprobado por grep sobre la
salida buscando `rechazo-tienda-cobro`, `RechazoTiendaCobro`, `CobrosRechazoTienda` y
`rechazo_tienda_cobro`: cero coincidencias).

### La base contra la que se migró

```
$ pnpm exec prisma migrate status
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
170 migrations found
Database schema is up to date!

$ pnpm exec prisma migrate deploy
Applying migration `20260831120000_rechazo_tienda_cobro`
All migrations have been successfully applied.
```

**`migrate deploy`, nunca `migrate dev` y sin reset**, como manda el encargo (la base local está
compartida por symlink con el repo principal).

Y el DDL, leído **de la base** y no del `.sql`:

```
CONSTRAINTS: … rechazo_tienda_cobro_decision_registrada (c) | rechazo_tienda_cobro_montos_validos (c)
             rechazo_tienda_cobro_gestion_id_fkey | _orden_id_fkey | _tienda_id_fkey
             | _decidido_por_fkey | _tarifa_id_fkey (f ×5) | _pkey (p)
INDEXES:     rechazo_tienda_cobro_decidido_por_idx | _estado_generado_el_idx | _gestion_uq | _pkey | _tienda_id_idx
RLS:         [ { relrowsecurity: true } ]
ENUM:        [ pendiente, aprobado, rechazado ]
```

### Tests dirigidos

```
$ pnpm exec vitest run tests/unit/services/rechazo-tienda-cobro-service.test.ts
 Test Files  1 passed (1)
      Tests  28 passed (28)

$ pnpm exec vitest run tests/integration/db/rechazo-tienda-cobro.int.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)          ← contra Postgres real, no dobles

$ pnpm exec vitest run tests/unit/components/wallet-cobros-rechazo-tienda-panel.test.tsx
 Test Files  1 passed (1)
      Tests  12 passed (12)

$ pnpm exec vitest run tests/unit/repositories/gestion-orden-rechazar.test.ts \
                      tests/unit/services/rechazo-tienda-service.test.ts
 Test Files  2 passed (2)
      Tests  52 passed (52)
```

### Suites amplias

```
$ pnpm exec vitest run tests/unit/guards tests/unit/descarga tests/unit/services \
                      tests/unit/repositories tests/unit/components
 Test Files  1 failed | 546 passed (547)
      Tests  1 failed | 8782 passed (8783)
     × ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
       + [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]

$ pnpm exec vitest run tests/integration
 Test Files  272 passed (273)   ← tras registrar la tabla en el censo de `updated_at`
      Tests  3157 passed (3158)

$ pnpm exec vitest run tests/components
 Test Files  280 passed (280)
      Tests  3785 passed | 26 skipped (3811)

$ pnpm exec vitest run tests/unit/actions tests/unit/types tests/unit/utils \
                      tests/unit/notificaciones tests/unit/config tests/guards
 Test Files  220 passed (220)
      Tests  3138 passed (3138)
```

En total, **1.320 archivos y ~18.860 casos** corridos sobre lo que esta ficha toca y sus vecinos.
La suite COMPLETA (`pnpm test`, ~8 min) no se corrió: la corre el gate del leader, y el encargo pedía
«los tests dirigidos de lo que toques + los de integración contra Postgres».

**El único rojo es `obtenerTarifa`, el MISMO que la primera mitad documentó en §7**: preexistente en
`origin/dev` (`db4e7511`) y ajeno a esta ficha. Mis **tres** Server Actions nuevas **sí** tienen
superficie —las importan `app/(app)/wallet/page.tsx` y el panel—, y por eso la guardia no las nombra.

---

## 15. 🔴 LAS MUTACIONES, con salida roja REAL

Las cuatro se aplicaron **en disco**, se autocomprobaron con `grep` antes de correr nada, y se
revirtieron comprobando el verde. No se declara ninguna guardia sin verla caer.

### 🔴 M1 — quitar la CLAVE ÚNICA (el doble cobro)

La clave vive en la BASE, así que la mutación honesta es soltar el índice ahí (editar el
`migration.sql` ya aplicado no cambiaría nada):

```
$ DROP INDEX IF EXISTS "rechazo_tienda_cobro_gestion_uq"
drop -> []
```

```
 ❯ tests/integration/db/rechazo-tienda-cobro.int.test.ts (10 tests | 3 failed) 643ms
       × ⭑ dos altas del MISMO rechazo dejan UNA sola fila (la segunda inserta 0) 57ms
       × ⭑ un cobro ya RECHAZADO no se puede volver a dar de alta (el «no» es durable) 17ms
       × ⭑ el indice unico de la idempotencia existe y es TOTAL (sin `WHERE`) 6ms

AssertionError: expected 1 to be +0 // Object.is equality
- Expected
+ Received
- 0
+ 1
 ❯ tests/integration/db/rechazo-tienda-cobro.int.test.ts:152:30
    152|       expect(medido.segunda).toBe(0);

AssertionError: expected [] to have a length of 1 but got +0     ← el índice ya no existe

 Test Files  1 failed (1)
      Tests  3 failed | 7 passed (10)
```

Ese `1` en vez de `0` **es el segundo cobro pendiente** sobre la misma gestión: aprobar los dos le
cobraría dos veces a la tienda. Índice restaurado y verde recuperado (`10 passed`).

### 🔴 M2 — quitar `estado: "pendiente"` del `WHERE` de la transición (aprobar dos veces en paralelo)

```ts
// lib/repositories/RechazoTiendaCobroRepository.ts:194 — mutación en disco, verificada por grep
      where: { id },
```

```
 ❯ tests/integration/db/rechazo-tienda-cobro.int.test.ts (10 tests | 1 failed) 642ms
       × ⭑ UNA gana, TRES leen `ya_decidido`, y el dinero se escribe UNA sola vez 312ms

AssertionError: expected [ { status: 'ok', …(1) }, …(3) ] to have a length of 1 but got 4
- Expected
+ Received
- 1
+ 4
 ❯ tests/integration/db/rechazo-tienda-cobro.int.test.ts:354:21
    354|         expect(oks).toHaveLength(1);
```

**Ese `4` es la prueba de que la concurrencia es real**: cuatro clientes Prisma independientes, cada
uno con su transacción, y las cuatro re-evaluaron el `WHERE` con la fila ya cambiada. Con el término
puesto, exactamente una gana y tres leen `ya_decidido`. Revertida y verde (`10 passed`).

### 🔴 M3 — un rol NO autorizado puede decidir

```ts
// lib/services/RechazoTiendaCobroService.ts — los TRES guards, mutados a la vez
    void esAccesoTotal; // MUTACION: guard de rol retirado
```

```
 ❯ tests/unit/services/rechazo-tienda-cobro-service.test.ts (28 tests | 12 failed) 23ms
     × mensajero NO puede aprobar, y no escribe ni una fila 7ms
     × adminTienda NO puede aprobar, y no escribe ni una fila 1ms
     × adminSatelite NO puede aprobar, y no escribe ni una fila 1ms
     × apiKey NO puede aprobar, y no escribe ni una fila 1ms
     × mensajero NO puede rechazar 1ms
     × adminTienda NO puede rechazar 0ms
     × adminSatelite NO puede rechazar 0ms
     × apiKey NO puede rechazar 1ms
     × mensajero NO puede ni VER la cola 1ms
     × adminTienda NO puede ni VER la cola 1ms
     × adminSatelite NO puede ni VER la cola 0ms
     × apiKey NO puede ni VER la cola 0ms

AssertionError: expected { status: 'ok', …(1) } to deeply equal { status: 'forbidden' }
- Expected
+ Received
  {
-   "status": "forbidden",
+   "status": "ok",
+   "yaEstabaEnElLibro": false,
  }
```

⚠️ Léase el recibido: con el guard fuera, **un `adminTienda` aprueba el cobro de su propia tienda**.
Revertida y verde (`28 passed`).

### 🔴 M4 — el hook deja de cablearse (el cobro que no se emite nunca, en silencio)

Es la familia del «composition root que no inyecta»: sin esta línea, el contrato sigue existiendo,
el servicio sigue construyendo el hook, y **ningún rechazo se cobraría jamás** con la suite de
servicio en verde.

```ts
// lib/repositories/GestionOrdenRepository.ts — dentro de `rechazarDesdeDevuelta`
      // MUTACION: el hook deja de cablearse
```

```
 ❯ tests/unit/repositories/gestion-orden-rechazar.test.ts (21 tests | 2 failed) 21ms
     × ⭑ se invoca con el `tx` y con el id de la gestion RECIEN creada 5ms
     × ⭑ va ANTES del append del historial 2ms

AssertionError: expected [] to have a length of 1 but got +0
 ❯ tests/unit/repositories/gestion-orden-rechazar.test.ts:520:19
    520|     expect(visto).toHaveLength(1);

AssertionError: expected [ 'historial' ] to deeply equal [ 'cobro', 'historial' ]
```

Revertida y verde (`52 passed` con su hermana de servicio).

---

## 16. Lo que NO se hizo, y por qué está aquí en vez de en silencio

1. **El `ingreso_bodega_rechazo` (56) sigue en pausa.** Ver §9. Es otro concepto, con otro dueño y
   otro documento (el cierre de bodega); traerlo exigiría tocar alcance ajeno.
2. **No se dieron de alta los 22 pendientes históricos.** Ver §12: lo decide el humano.
3. **No hay aviso/notificación de «hay N cobros esperando».** La 333 sí lo tiene, y aquí se omitió
   a propósito: añadir un valor a `notificacion_evento` obliga a una migración **propia** por el
   `55P04`, a tocar el inventario cerrado de productores y a elegir una entidad de dedupe que no
   silencie el recordatorio (la trampa que la 262 pagó). Es radio que un hotfix urgente no debe
   ampliar. **La cola sí se ve** en `/wallet` en cuanto hay algo. Queda como follow-up.
4. **No se generalizó nada de la 333.** Instrucción explícita, y se cumplió: los dos dominios
   comparten forma y no comparten ni una línea.
5. **`feature_list.json` aparece como modificado en el worktree; NO fue por mí** (ya venía así desde
   la primera mitad, que lo dejó dicho en su §5.3). Tampoco se tocó `progress/current.md`.
6. **`./init.sh` no se corrió** (lo corre el leader). Aviso para ese momento: este diff toca
   `db/migrations/**`, `db/schema.prisma`, `lib/types/**` y una docena de archivos con nombre de
   dinero, así que **`--rapido` se negará solo** y mandará al completo.
7. **`prisma generate` escribió el cliente en `node_modules` del repo PRINCIPAL** (el worktree lo
   tiene por junction). Quien trabaje allí tendrá un cliente con `rechazoTiendaCobro` dentro y
   **una base local que ya tiene la tabla**: es lo esperado con la base compartida, pero conviene
   saberlo antes de leer un rojo raro.

---

## Veredicto (segunda mitad)

El rechazo desde novedades vuelve a cobrarse —con **aprobación previa**, importe **congelado** en el
instante del rechazo y los **mismos** apuntes que emitía el cierre—, la idempotencia está probada
contra Postgres en sus tres capas y las cuatro mutaciones enrojecieron de verdad; lo que **no** se
restaura es el ingreso de la BODEGA por rechazo, que era el otro cobro que la primera mitad pausó y
que aquí queda declarado, no escondido.

---

## 17. ⚠️ Un rojo que me fabriqué yo con el arnés (y NO es de esta ficha)

Al cerrar, una corrida de fondo de `tests/components` dio **1 rojo**:

```
 ❯ tests/components/PostularRecursoModal.test.tsx (11 tests | 1 failed) 110957ms
     × R5 — los tres desenlaces de fallo tienen texto propio, no vacío y DISTINTO entre sí 20065ms
Error: Test timed out in 20000ms.
```

**No es un fallo del código. Lo provocó mi propia verificación**: lancé DOS suites completas de
`tests/components` solapadas (una en primer plano y otra de fondo), y el archivo entero pasó de
**22,3 s a 111,0 s** — un factor **×5** de contención. El caso que cayó cruzó los 20 s por eso.

Medido, no razonado:

| Comprobación | Resultado |
| --- | --- |
| ¿Está en mi diff? | **No** — no aparece en `git status`; no toqué ese archivo |
| ¿Importa algo de la 337? | **No** — cero referencias a `rechazo-tienda-cobro` / `RechazoTiendaCobro` |
| Aislado | **11/11 verde**, 22,30 s el archivo |
| El caso concreto, aislado y sin carga | **4.110 ms** contra un tope de 20.000 ms → margen **×4,9** |
| Mi corrida de `tests/components` SIN solape (primer plano) | **280/280 archivos, 3.785 casos verdes** |

Es el patrón ya conocido en este repo: *un gate rojo por timeout bajo carga no prueba nada* —igual
que un verde bajo carga tampoco—. Lo que sí deja como aviso para el leader: **no correr dos suites
pesadas en paralelo contra el mismo árbol**, porque el rojo que sale no tiene nada que ver con el
diff que se está juzgando.

**Corrección de mi propia lectura**, para que no quede el error escrito: al ver «22,30 s» de archivo
frente a un tope de 20 s pensé que el caso vivía al filo. **Es falso**: esos 22 s son la suma de los
once casos. El caso que cayó tarda 4,1 s. No hay fragilidad intrínseca que arreglar aquí.
