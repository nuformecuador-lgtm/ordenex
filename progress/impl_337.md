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
