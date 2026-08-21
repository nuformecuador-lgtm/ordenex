# review 237 — la gestión que hace la tienda cuenta como del mensajero

> **Acta INCREMENTAL.** Se escribe según se mide, empezando por el veredicto provisional, para que
> una caída no se lleve lo comprobado. La última línea del archivo manda.

**Rama:** `feature/237-gestion-tienda-ayuda` · **base:** `origin/dev` = `dc352f56`
**Estado del árbol:** el trabajo está **SIN COMMIT** (working tree sucio: 82 modificados + 21 sin
seguimiento). Lo revisado es el árbol de trabajo, no un commit.
**Gate:** NO lo corro (lo corrió el leader: EXIT 0, 1230 archivos / 16.050 tests).

---

## VEREDICTO — RECHAZADO

**Un solo bloqueante (`B1`): `T9.1` está marcada `[x]` y el recorrido se detuvo en el paso 6 de 9.
Faltan los dos pasos donde el dinero aterriza. Detalle y remedio al final del acta.**
Todo lo demás pasó, y con mutaciones propias detrás.

---

## Bitácora de la revisión

(se va llenando)

### [1] Trazabilidad — los archivos citados EXISTEN (contra 4 fichas anteriores)

`test -f` propio sobre los **31** archivos que el mapa `R<n> → test` de `progress/impl_237.md` y el de
`progress/impl_237_frontend.md` citan: **31/31 existen**. Ninguna cita a ciegas. ✔
(La 236 fue rechazada justo por esto; aquí no se reproduce.)

### [2] 💰 R3 — la mutación del `mensajero_id`, corrida POR MÍ

`lib/repositories/GestionOrdenRepository.ts:695`, dentro de `crearGestionDesdeAyuda`:
`input.mensajeroId` → `input.actorUsuarioId` (la tienda).

```
sha256 ANTES:    ff76a425aaaba3bc35b728445d7e0a3b6b17928690269796825532d223bee4ea
sha256 MUTADO:   04f2e543d4f7f6babc8d40c78f279017a75506d292aa8d16c2bcc0928ada8fcd
sha256 DESPUÉS:  ff76a425aaaba3bc35b728445d7e0a3b6b17928690269796825532d223bee4ea   ← idéntico
```

> El sha del mutado coincide **byte a byte** con el que `impl_237.md` reporta en T8.1: la mutación que
> corrió el implementer es exactamente ésta.

Salida real (`npx vitest run` de las tres suites del dinero):

```
     × 💰 end-to-end: la tienda gestiona -> `crearCierre` la vincula al cierre DEL MENSAJERO 8ms
     × 💰 end-to-end: el `cobroRechazado` se congela EN LA FILA que registro la tienda 1ms
     × 💰 R3: `mensajero_id` es EL MENSAJERO de la orden, NO el actor que la registro 5ms
     × R2: `rechazada` produce la MISMA forma de fila que la del mensajero para ese resultado 4ms
 Test Files  2 failed | 1 passed (3)
      Tests  4 failed | 45 passed (49)
```

Y los mensajes, que es lo que dice si el rojo mide algo:

```
AssertionError: expected null not to be null            ← `crearCierre` no crea NINGÚN cierre
AssertionError: expected 'tienda-1' to be 'mensajero-1'
AssertionError: expected { ordenId: 'o1', …(13) } to match object { ordenId: 'o1', …(3) }
```

**Veredicto del punto:** R3 está protegido por dos casos **end-to-end** que arrancan en
`crearGestionDesdeAyuda` (no sobre una fila ya sembrada) y mueren con la mutación. El propio
`impl_237.md` declara que **la primera versión de T6.1/T6.2 SOBREVIVÍA** y que por eso se añadieron
los dos e2e — declaración honesta y **comprobada cierta**: son exactamente los dos que caen. ✔

### [3] `ORIGEN_TIPOS_VISITA_REAL` — los seis sitios, y no hay un séptimo

Censo propio (`grep -rn`) del literal fijado por igualdad:

| # | Archivo:línea | Forma |
| --- | --- | --- |
| 1 | `tests/unit/types/orden-historial-types.test.ts:134` | `toEqual(["gestion", "gestion_tienda_ayuda"])` literal |
| 2 | `tests/unit/types/criterio-intento-entrega.test.ts:100` | ídem |
| 3 | `tests/integration/db/ayuda-tienda-migration.test.ts:351` | ídem |
| 4 | `tests/integration/db/anclaje-devolucion-migration.test.ts:235` | ídem |
| 5 | `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts:190` | ídem |
| 6 | `tests/unit/repositories/orden-historial-repository.test.ts:608` | literal **dentro del `where` real** |

**Ninguno se sustituyó por una derivación de su propia fuente.** Los seis escriben los dos strings a
mano y llevan nota fechada. **No hay un séptimo:** el único `[...ORIGEN_TIPOS_VISITA_REAL]` que
aparece en un `toEqual` es `criterio-intento-entrega.test.ts:130`, y **no afirma el contenido de la
lista** sino que *el predicado la usa* (`where.…origenTipo` = `{ in: <la lista> }`) — es otra
aserción, y su contenido lo fija el literal #2 dos casos más arriba. Correcto. ✔

### [4] 💰 «¿de verdad ningún feed filtra por mensajero, origen o actor?» — censo propio, uno por uno

Censo con `grep` de **todas** las lecturas de `gestion_orden` en `lib/` (34 sitios) y de **todos** los
consumidores de `orden_historial_estado.origen_tipo`. Resultado, feed por feed:

| Consumidor | `where` REAL leído en el árbol | ¿mensajero / origen / actor? |
| --- | --- | --- |
| `WalletFeedService` `:41-44` | `{ cierreId }` | **No** |
| `WalletTiendaFeedService` `:73-76` | `{ cierreId }` | **No** |
| `WalletIndemnizacionFeedService` `:29-31` | `{ cierreId, resultado: "incidente" }` | por **resultado** (nuestra fila nunca lo es) |
| `CajaCodFeedService` | deriva del ledger (`origenTipo: "cierre_dia"` es del **movimiento**, no de la gestión) | **No** |
| snapshot de aprobación `CierreDiaRepository:629` | `{ cierreId: cierre.id }` | **No** |
| `CierresAdminRepository:1012/1018/1184` | `{ cierreId }` / `{ cierreId, anuladaAt: null }` | **No** |
| `findGestionesRetornablesDelCierre` `:786-793` | `{ cierreId, resultado IN RESULTADOS_QUE_VUELVEN, anuladaAt: null }` | por **resultado** ⇒ R35 se cumple |
| confirmación física `:1492-1500` | `{ id IN, cierreId, resultado IN RESULTADOS_QUE_VUELVEN }` | **No** |
| anclaje 239 `:1551/:1571` | `{ cierreId, resultado: "devuelta", … }` | por **resultado** ⇒ nunca alcanza esta familia |
| `crearCierre` (vinculación) `:573-575` | `{ mensajeroId, cierreId: null, anuladaAt: null }` | por **mensajero** ⇒ **es lo que R3 sostiene** |
| `findGestionesPendientes` `:364` | ídem | ídem |

**Consumidores que SÍ filtran por `origen_tipo` (censo completo de `lib/`):**
`emitir.ts:169` (el aviso de rechazo — la exclusión firmada en D4/R44) ·
`OrdenHistorialRepository:199` (`whereIntentosVigentes`, que **incluye** la familia nueva — R6) ·
`CierresAdminRepository:189` y `:577` y `OrdenRepository:3315` (rótulos, `escalado_devuelta_sla`) ·
`DevolucionSlaRepository:80` (`anclaje_devolucion`) · `OrdenRepository:3254` (`solicitud_ayuda_tienda`,
la 236) · `webhook-estado-encolado.ts:128` (emisión pública — R43/R46) ·
`CierreDiaRepository:346` y `:802` (los dos lectores nuevos de esta ficha).

**Ninguno de ellos mueve dinero de un cierre.** La afirmación del spec —«los cinco feeds leen por
`cierre_id`»— es **cierta y verificada en el árbol**, no recitada. ✔

### [5] D3 — la novena guardia: dónde está, y si deja una segunda vía

**Dónde:** `lib/services/CierreDiaService.ts:601`, como **3-bis** — después de la guardia de propiedad
(`:576`) y **antes** de las guardias 4-8. Las dos razones están escritas en el código y las dos son
correctas: antes de la 3 no se sabe que la gestión sea suya y el mensaje filtraría datos de una orden
ajena; después de las 4-8 el motivo devuelto **mentiría** («ya está en un cierre», «la movió la bodega»).

**¿Segunda vía?** Censo propio: la **única** escritura de `anulada_at` en todo `lib/` es
`CierreDiaRepository.anularGestionYDevolverAGestion:848`, y su **único** llamador es
`CierreDiaService.deshacerGestion:635` — el mismo método que ahora lleva la 3-bis. La Server Action
`lib/actions/cierre-dia.ts:231` delega ahí y en ningún otro sitio. **No hay segunda puerta.** ✔

**¿La derivación puede decir `false` cuando la respuesta es «no lo sé»?** El predicado es
`desdeAyudaTienda: deLaTienda !== null` (`CierreDiaRepository:818`). La premisa que lo hace honesto
—la fila de historial nace en la **misma transacción** que la gestión, por el choke point— la comprobé
en `crearGestionDesdeAyuda`: el `appendCambioEstado` está **dentro** de la misma
`prisma.$transaction`, y el `ordenId` que escribe es el mismo `input.ordenId` de la gestión, así que
el `where` (`ordenId` + `gestionOrdenId` + familia) no puede fallar por desalineación. Las gestiones
legadas sin historial dan `false`, y `false` es **cierto** para ellas (son anteriores a `ayuda_tienda`).
El razonamiento vive en `lib/utils/gestion-tienda-ayuda-flag.ts` con la frase que lo hace auditable:
*si esa premisa deja de valer, la respuesta honesta sería un tercer valor, no un `false`*. ✔

**Dos mutaciones propias, que NINGUNO de los dos implementers corrió:**

```
sha256 ANTES:   3f5647a4749361123fbef0c8e9b71f3e4fe57f4951fd7bea79c5f6f512d1228b  CierreDiaRepository.ts

M-A  `desdeAyudaTienda: deLaTienda !== null` -> `false`  (la derivación miente: todo se puede deshacer)
     mutado: bf61570bc3052161c4c72132dadea2740f2611544f78039f3ba446674018bef0
       x con una fila de esa familia -> `desdeAyudaTienda: true` 8ms
      Tests  1 failed | 205 passed (206)

M-B  quitar `origenTipo: "gestion_tienda_ayuda"` del `where` (cualquier historial bloquearía el deshacer)
     mutado: bb364d8dba6ed3e8cb7aeb844066af3253162f4293391649cf14f0d7d28bd371
       x el `where` filtra por la orden, por LA GESTION y por la familia `gestion_tienda_ayuda` 9ms
      Tests  1 failed | 193 passed (194)

sha256 DESPUÉS: 3f5647a4749361123fbef0c8e9b71f3e4fe57f4951fd7bea79c5f6f512d1228b   <- idéntico
```

Las dos mueren, y mueren **en el repositorio, que es donde vive el `WHERE`** — no en los tests de
servicio, que usan un doble y no lo verían. ✔

### [6] D1 / R32 — el test existe, corre, y ejerce LAS DOS rutas

`tests/unit/services/gestion-desde-ayuda-cierre-aprobacion.test.ts:67-102`: un `it.each` con **dos**
casos —`vencido -> solicitado` y `rechazado -> solicitado`— sobre el **`CierreDiaService` real** (doble
sólo del repositorio). Cada caso afirma cuatro cosas, positivas y negativas:

```
expect(r).toEqual({ status: "ok", via });                              <- la ruta se TOMÓ
expect(repo[metodo]).toHaveBeenCalledTimes(1);
expect(repo.contarOrdenesPendientesGestion).not.toHaveBeenCalled();    <- la exención, ejercida
expect(repo.crearCierre).not.toHaveBeenCalled();
expect(repo.findGestionesPendientes).not.toHaveBeenCalled();
```

**No pasa por vacuidad:** las dos primeras son afirmaciones positivas que caerían si la ruta no se
recorriera. Hay además el **contraste obligatorio** (`:126`): la ruta de **creación** SÍ consulta
pendientes, y el orden (`iPendientes > iRechazado > iVencido`) se lee del código real, no del spec.

La otra mitad —(a) el cierre en curso no la contiene, (b) sus totales no cambian, (c) el siguiente sí,
y **sólo** el siguiente— vive en `tests/unit/repositories/gestion-desde-ayuda-cierre.test.ts:415-457`,
dos casos sobre el almacén con `crearCierre` real.

⚠️ **Hallazgo `menor`, y lo digo porque el spec pedía otra cosa:** T6.3 pedía «**dos casos, uno por
ruta**, que afirman las tres cosas (a)(b)(c)». Lo entregado son **dos casos por ruta** que afirman la
exención **más dos casos sin ruta** que afirman (a)(b)(c). La costura —«tras la ruta exenta, la gestión
posterior cae en el siguiente cierre»— queda **argumentada** (si la ruta exenta no llama a `crearCierre`
ni re-vincula nada, la gestión posterior es indistinguible del caso ya probado) pero **no ejercida en un
solo test**. Las dos rutas SÍ se ejercen y ninguna aserción es vacua ⇒ **no bloqueante**.

### [7] El flag `desdeAyudaTienda` — obligatorio de verdad, y los productores lo derivan

- **Obligatorio, sin `?`:** `ICierreDiaRepository.ts:86` y `:187`, `ICierreDiaService.ts:79` →
  `desdeAyudaTienda: boolean;`. TypeScript obliga a cada camino a decidir. ✔
- **Productores en producción — todos derivando:**
  - `CierreDiaRepository.toPendienteRow(r, deLaTienda.has(r.id))` en sus **dos** call-sites (`:369`
    `findGestionesPendientes` y `:732` el detalle del cierre propio), alimentado por
    `marcarDesdeAyudaTienda` (una consulta en lote, con `ordenId` delante).
  - `CierresAdminRepository.toPendienteRowDesdeSnapshot:331` →
    `esGestionDesdeAyudaTienda(g.historialEstados)`, que consume **también**
    `CierresBodegaAdminRepository:352` reusando el mismo mapper.
  - `CierreDiaService.toDetalleDTO:705` — passthrough puro, sin re-derivar.
- **`grep "desdeAyudaTienda: false"` sobre `lib/` y `app/`: CERO.** Ningún productor lo cablea. Los
  `false` del diff son **fixtures de test** (35 líneas en 29 archivos): entrada de datos, no derivación.

**Mutación propia sobre el productor de admin** (T8.7 mutó el `where`; ésta muta el **mapper**):

```
sha256 ANTES:   d5bbbc0e680bdd783a27da27fd4ab31617d7a668852d411ca0fcb354d6ab9658  CierresAdminRepository.ts
MUTADO:         7b0502e9b62ada1346a717add6b9a4005bcacbc98dc23d2101da0f848554f536
   `desdeAyudaTienda: esGestionDesdeAyudaTienda(g.historialEstados)` -> `false`
     x caso emparejado sobre el mapper de admin: mismas filas, banderas distintas 7ms
      Tests  1 failed | 118 passed (119)
sha256 DESPUÉS: d5bbbc0e680bdd783a27da27fd4ab31617d7a668852d411ca0fcb354d6ab9658   <- idéntico
```

Cae por el **caso emparejado** (dos filas en la misma lectura, una `true` y otra `false`), que es la
única forma de que una bandera que siempre vale lo mismo no pase en verde. ✔

### [8] T10.3 — los tres comentarios, comprobados uno a uno (el punto que NO estaba verificado)

| Archivo | Estado |
| --- | --- |
| `lib/types/order-status-transiciones.ts` (bloque `ayuda_tienda`) | ✔ **Reescrito.** Lleva `⏳ 2026-08-20 — AQUI DECIA, y ya no es cierto:` con la frase vieja **citada literal**, explica que la 237 trajo **dos de las cinco** y por qué las **otras tres** (`entregada`, `devolucion_por_confirmar`, `incidente`) siguen sin declararse. Declara `#65`/`#66` con su productor. |
| `lib/types/orden-historial.ts` (bloque `gestion_tienda_ayuda`) | ✔ **Reescrito.** «aqui decia: gestion_tienda_ayuda NO se declara… esta es la ficha 237 y este es el commit de su productor». Incluye el argumento de §7.3 (por qué SÍ es visita real cuando `reprogramacion_tienda` no) y por qué NO entra en `ORIGEN_TIPOS_CON_GESTION`. |
| `app/(app)/novedades/_components/novedad-acciones-catalogo.ts` (`ACCIONES_POR_GRUPO`) | ✔ **Reescrito.** Cita la frase vieja entera, dice qué cambió y —esto es lo que lo salva— deja escrito que **su motivo sigue siendo cierto de las acciones de la devolución**, que es exactamente por qué las claves nuevas son otras. |

**Ninguno de los tres describe un mundo que ya no existe.** ✔
⚠️ Pero la casilla **T10.3 sigue `[ ]`** en `tasks.md:400`: el trabajo está hecho, la marca no.

### [9] Trazabilidad completa R1-R50 — mapeada, existente y VERDE

Los dos mapas (`impl_237.md` + `impl_237_frontend.md`) cubren los **50** requisitos. Corrí yo las
suites, sobre el árbol **restaurado**:

```
$ npx vitest run <las 18 suites del mapa de la 237>
 Test Files  18 passed (18)
      Tests  370 passed (370)

$ npx vitest run guard + transiciones + webhook-eventos + cierre-dia-* + cierres-admin-repository
                     + mis-asignaciones-evidencias
 Test Files  129 passed (129)
      Tests  2082 passed (2082)
```

Spot-checks de **no-vacuidad** sobre los requisitos más fáciles de fingir:

- **R6/R7/R39** (`intentos-entrega-criterio-unico.test.ts:370-455`): 7 casos en `it.each` con sus
  **contrastes negativos** —cierre `solicitado` ⇒ 0, sin cierre ⇒ 0, anulada ⇒ 0— y el par decisivo:
  «pedir ayuda + resolver la tienda = **1**, no 2» **junto a** «sin la familia del desenlace la MISMA
  gestión no contaría = **0**». El segundo es lo que hace que el primero diga algo.
- **R19/R20/R21/R22** (`gestion-desde-ayuda-service.test.ts:194-258`): R20 tiene su **caso de
  contraste** («el mensajero SÍ pasa la puerta del hilo»), sin el cual el paso 2 parecería decorativo;
  R22 compara tienda ajena / orden inexistente / orden borrada y exige que devuelvan **lo mismo**.
  Leí `autorizarSobreHilo`: la pertenencia sale **del actor**, nunca del input. ✔
- **R12/R13/R14** (`gestion-desde-ayuda-schema.test.ts`): 23 casos, incluida la asimetría firmada en
  D2 («REPROGRAMAR tampoco parsea sin foto») y el día inexistente `2027-02-31`.
- **R10** (`gestion-desde-ayuda-repository.test.ts:404-427`): tres casos testigo —`usuario.update` no
  se llama, `orden.update` por PK tampoco, no se encola reoptimización—.
- **R35**: verificado en el código, no sólo en el test — `RETORNA_A_BODEGA` (`gestion-retorno.ts:33`)
  tiene `reprogramada: true` y `rechazada: true`, y `RESULTADOS_QUE_VUELVEN` se **deriva** de ese
  `Record`, así que la gestión de la tienda entra en la ventana del 238.
- **R44/D4**: la ausencia está escrita **en `emitir.ts`**, con su porqué y con el «si el humano lo
  quiere, hace falta texto propio» — decisión, no olvido. ✔

### [10] Los centinelas: 15 suites que NO se podían tocar, y no se tocaron

`git status` sobre cada una devuelve **vacío**:

```
cierres-admin-caja-cod · cierres-admin-confirmacion-fisica · cierres-admin-anclaje-devolucion
cierres-admin-indemnizacion · deriva-primer-intento · rastreo-hitos-exhaustivo (R42)
novedad-acciones-una-tabla · gestion-ubicacion-solo-escritura (R18) · hilo-ventana-alcanzable
webhook-eventos (R43/R46) · ordenes-columnas-money-safe · dinero-sin-centimos (R11)
habilitar-novedad-service · RepartoAyuda.test.tsx · orden-repository.novedades (R49)
```

Las **dos** guardias que sí aparecen modificadas, diffeadas por mí:
- `anclaje-vs-intentos.guardia.test.ts`: **una** línea — el literal del censo, con nota fechada. Su
  aserción de fondo (`anclaje_devolucion` NO está en la lista) queda **intacta**. No es una fusión de
  criterios. ✔
- `pagos-aritmetica-decimal.guardia.test.ts`: **una** línea de **fixture** (`desdeAyudaTienda: false`).
  No estaba censada en ninguna de las dos bitácoras, pero cae dentro de las «35 líneas en 29 archivos».

### [11] Checkpoints, uno por uno

| Checkpoint | Estado |
| --- | --- |
| `requirements.md` EARS numerados | ✔ R1-R50 |
| `design.md` con alternativa descartada y su porqué | ✔ **seis** (§13 A-F) |
| `tasks.md` con **todas** marcadas `[x]` | ⚠️ **NO**: `T0.1`, `T10.3` y `T10.4` siguen `[ ]` |
| Cada `R<n>` mapea a un test concreto | ✔ 50/50, comprobado con `test -f` propio |
| `progress/impl_237.md` contiene el mapa | ⚠️ parcial: R27/R40/R41 figuran como `⏳ T7` y su mapa real vive en `impl_237_frontend.md` |
| typecheck / lint / tests | ✔ (corridos por los implementers y por el leader; yo corrí 147 archivos / 2.452 tests verdes) |
| E2E Playwright para flujo crítico | ⚠️ **no hay harness E2E en este repo** (deuda de la pila). El control compensatorio es **el recorrido T9.1** — y ahí está el bloqueante de abajo |
| RLS en tablas nuevas | ✔ **no hay tablas nuevas ni columnas nuevas**; la migración es `ALTER TYPE … ADD VALUE`, aditiva, y lo dice |
| Migración reversible con `down.sql` | ✔ `down.sql` recrea el tipo con los **29** valores previos, contados uno a uno por mí; round-trip real contra `localhost:5432` en la bitácora. **Ningún `down.sql` histórico se tocó** (`git status` sobre `db/migrations/` sólo muestra el directorio nuevo) |
| Sin secretos hardcodeados | ✔ `grep` de `api_key|secret|password|token=|service_role|bearer` sobre los 7 archivos nuevos: **cero** |
| Webhooks con firma e idempotencia | n/a — esta ficha **no crea webhook**; el evento público sale por el emisor existente sin ampliar vocabulario (R43/R46, test verde sin tocarse) |
| Controller sin queries ni negocio | ✔ `lib/actions/gestion-desde-ayuda.ts` es composition root + `FormData` → schema → servicio |
| Service sin HTTP | ✔ `GestionDesdeAyudaService` recibe **todo por interfaz**; ni `next/*` ni Prisma |
| Repository sólo Prisma | ✔ `crearGestionDesdeAyuda` es una `$transaction` con `updateMany` + helper compartido + choke point |
| Interfaces en `lib/interfaces/` por categoría | ✔ `IGestionDesdeAyudaService`, `IGestionOrdenRepository`, `ICierreDiaRepository/Service` |
| Mutaciones internas por Server Action | ✔ |
| Sin hardcode de país/moneda/cuenta | ✔ las únicas menciones a CR / ₡ son **comentarios**; la fecha usa `mananaCalendarioCR` compartido |
| `./init.sh` verde | ✔ lo corrió el leader (EXIT 0, 1230 archivos / 16.050 tests). **Yo no lo corrí, por encargo** |
| `progress/review_237.md` con veredicto | este archivo |
| Entrada en `progress/history.md` | ⚠️ **falta** (cierre del leader) |

### [12] Idempotencia, carreras y money-safety — leídos, no recitados

- **R24/R28 por construcción:** la guarda viaja **en el `where` del `updateMany`**
  (`{ id, estatusId: ayuda, deletedAt: null }`) y el `data` toca **únicamente** `estatusId`. Un
  segundo envío encuentra `count === 0` ⇒ `null` sin gestión, sin evidencias y sin historial. No hay
  un segundo mecanismo de idempotencia que pueda divergir del primero. ✔
- **R11:** `grep` de `parseFloat|Number(|toFixed` sobre los 7 archivos nuevos: **cero**. La fila no
  escribe ni un importe. ✔
- **R15/R16:** la subida va **antes** de la transacción y el `catch` compensa y **propaga**; el
  `null` del repo compensa y devuelve `conflict`. Los tres caminos tienen su caso. ✔
- **R50:** `grep "console\."` sobre los archivos nuevos: **cero**. El único `throw` con interpolación
  usa `shape.code` (un valor del enum de errores). ✔

---

## HALLAZGOS

### BLOQUEANTE — 1

**B1 · T9.1 está marcada `[x]` y el recorrido NO está completo: faltan los pasos 7, 8 y 9, que son
donde el dinero aterriza.**

`tasks.md` T9.1 enumera **nueve** pasos y dice «Recorrido completo». `progress/recorrido_237.md`
llega hasta el **6** y se detiene ahí — con buen motivo, porque el 6 destapó un defecto real (el
botón «Devolver a gestión» siempre habilitado detrás de un modal que mentía) y hubo que arreglarlo.
Pero el recorrido **no se reanudó**. Quedan sin andar:

- **Paso 7** — solicitar cierre como mensajero, aprobarlo como admin y **comprobar que la ventana de
  confirmación física (238) pide ESE paquete**. Es exactamente el riesgo #3 de `design.md` §15
  —«una gestión de la tienda **puede bloquear la aprobación de un cierre** si el paquete no
  aparece»— y ese riesgo tiene escrita su mitigación con estas palabras: *«se recorre en T9»*.
- **Paso 8** — aprobar y **comprobar el `cobroRechazado` en la billetera de la tienda y el intento
  sumado**. Es la promesa central de la ficha —«mueve el dinero igual»— vista donde el usuario la ve.
- **Paso 9** — repetir con **reprogramar** y una fecha, y comprobar que **la fecha de hoy se rechaza**
  en la app (el schema y el modal lo prueban; la pantalla real no se recorrió).

**Por qué es bloqueante y no menor, con tres razones y ninguna retórica:**

1. **En este repo el recorrido ES el control compensatorio del checkpoint de E2E.** No hay harness
   Playwright; CHECKPOINTS exige E2E «si la feature toca pagos o recaudo», y ésta los toca. Si el
   recorrido se queda a mitad, ese checkpoint queda sin descargar **justo en los pasos de dinero**.
2. **En ESTA MISMA ficha el recorrido ya encontró lo que 16.050 tests no.** El defecto del paso 6 era
   de superficie, y los pasos 7 y 8 estrenan **dos superficies más que nadie ha mirado**: la ventana
   de confirmación física con un paquete que viene de una gestión de la tienda, y el ledger de la
   tienda. La probabilidad de otro defecto de superficie ahí no es despreciable, y ahí sí es dinero.
3. **La marca `[x]` afirma algo que no ocurrió.** Es precisamente el modo de fallo que este arnés
   existe para cazar, y el que costó el rechazo de la 236.

**Qué falta para cumplirlo (y es barato):** la base local **ya está en el sitio exacto** —el propio
recorrido lo dice: `QA-R-0001` quedó `rechazada` por una gestión real de la tienda, con `cierre_id`
NULL, esperando al siguiente `crearCierre`—. Son los tres pasos que faltan sobre ese estado, con lo
leído del navegador pegado en `progress/recorrido_237.md`. **Alternativa admisible:** si el humano
decide que la evidencia estructural basta, entonces **T9.1 se desmarca y se declara el recorte por
escrito** con lo que se acepta no haber visto; lo que no puede quedarse es el `[x]` sobre nueve pasos
de los que se anduvieron seis.

### menores — 6

**m1 · `tasks.md` tiene tres casillas en `[ ]`.**
`T10.3` está **hecha de verdad** (los tres comentarios reescritos; lo verifiqué uno a uno, sección
[8]) y sólo le falta la marca. `T0.1` está declarada como bloqueante **del despliegue, no del merge**.
`T10.4` es del leader. El checkpoint «todas marcadas `[x]`» falla en literal.

**m2 · El mapa `R<n> → test` de `progress/impl_237.md` está desactualizado en tres filas.**
R27, R40 y R41 siguen diciendo `⏳ T7 (pantalla)`; su mapa real vive en `impl_237_frontend.md`. Quien
lea sólo el archivo que CHECKPOINTS nombra ve tres requisitos sin test. Se cierra con tres líneas.

**m3 · R32/D1: la costura entre la ruta exenta y «cae en el siguiente cierre» está argumentada, no
ejercida en un solo test.** Detalle en la sección [6]. Las dos rutas SÍ se ejercen y nada es vacuo.

**m4 · El «archivo publica lo que la pantalla enseña» (236/D3) queda desalineado.** La pantalla del
cierre del día ya marca «La tienda», y ni `toGestionDescargaDTO` (230) ni
`cierre-dia-descarga-columnas.ts` publican `desdeAyudaTienda`. El frontend lo declara como «aditivo y
no pedido» y el DTO ya lo permite en los tres productores. Queda como deuda **declarada**.

**m5 · Duplicación declarada de un literal money-adjacent.** `DESHACER_BLOQUEO_TIENDA` (cliente)
repite `MSG_GESTION_DE_LA_TIENDA` (servidor, no exportado para no arrastrar Prisma al navegador). Está
dicho en el comentario del código y el riesgo es bajo con el botón apagado, pero son dos verdades
sobre el mismo texto.

**m6 · Dos deudas heredadas siguen abiertas, y las dos están declaradas con dueño.**
`IncidenteAdminService` conserva su copia de la subida compensada (D5-a) y `motivoSchema` sigue sin
tope (D8), ahora compartido por dos vías. Ninguna nace aquí; las dos están escritas en el código.

### observaciones (no cuentan como hallazgo)

- **El trabajo está SIN COMMIT.** Los 82 modificados y 21 sin seguimiento viven sólo en el árbol. El
  `./init.sh` verde del leader y esta acta describen un árbol que **todavía no está en git**; el blob
  commiteado hay que verificarlo después de commitear (`verificar-el-blob-commiteado`).
- `GESTION_ADMIN_SELECT` usa `take: 2` sobre `historialEstados` para dos familias. Hoy no puede
  tapar una con otra (`escalado_devuelta_sla` sólo aplica a `devuelta`, y desde ayuda no se devuelve),
  y el comentario explica por qué no es `take: 1`. Si alguna vez una gestión pudiera tener dos filas
  de la misma familia, ahí hay un tope que mirar.
- **Las mediciones T0 se corrieron DESPUÉS de llevar D2/D3/D6 a firma**, cuando el spec pedía lo
  contrario. La bitácora lo confiesa por escrito y los números **no contradicen** ninguna de las tres
  (M3+M4 refuerzan D3). Queda anotado, no penalizado.

---

## VEREDICTO FINAL — RECHAZADO

**Un solo bloqueante, y barato de cerrar: `B1` — T9.1 marcada `[x]` con el recorrido detenido en el
paso 6 de 9; faltan los dos pasos donde el dinero aterriza (la ventana de confirmación física del 238
con ese paquete, y el `cobroRechazado` en la billetera de la tienda con el intento sumado) y el
tercero de la fecha al reprogramar.**

**Todo lo demás está bien, y lo digo con lo medido delante, no de palabra:**

- 💰 **R3 sobrevive a su mutación con cuatro rojos**, dos de ellos **end-to-end** que arrancan en
  `crearGestionDesdeAyuda`. El sha del archivo mutado coincide byte a byte con el que reportó el
  implementer. Árbol restaurado y verificado por sha256.
- 💰 **Ningún feed de dinero filtra por mensajero, origen ni actor.** Censo propio de los 34 sitios de
  lectura de `gestion_orden` y de los 11 consumidores de `origen_tipo` en `lib/`. La única lectura
  que filtra por mensajero es la que **debe** hacerlo (`crearCierre`), y es exactamente lo que R3
  sostiene.
- **D1/R32 ejerce las DOS rutas exentas**, con afirmaciones positivas y su contraste. No es vacuo.
- **D3 no deja segunda vía:** un único escritor de `anulada_at`, un único llamador, y la 9.ª guardia
  bien colocada. Sus **dos** mutaciones —que ningún implementer corrió— mueren en el repositorio,
  que es donde vive el `WHERE`.
- **`desdeAyudaTienda` es obligatorio de verdad** y los tres caminos lo derivan: `grep` de
  `desdeAyudaTienda: false` sobre `lib/` y `app/` devuelve **cero**.
- **T10.3 está hecha**: los tres comentarios reescritos, ninguno describe un mundo que ya no existe.
- **`ORIGEN_TIPOS_VISITA_REAL` está en los seis sitios como literal**, ninguno derivado de su propia
  fuente, y **no hay un séptimo**.
- **50/50 requisitos mapean a tests que existen y corren.** Corrí **147 archivos / 2.452 tests**: cero
  fallos. Y los **15 centinelas** que no se podían tocar están intactos.

### Árbol, al cerrar el acta

Cinco mutaciones propias, **una a la vez y restaurada antes de la siguiente**. `git status` al cerrar
es idéntico al de apertura y los tres archivos mutados vuelven a su sha original:

```
ff76a425aaaba3bc35b728445d7e0a3b6b17928690269796825532d223bee4ea  lib/repositories/GestionOrdenRepository.ts
3f5647a4749361123fbef0c8e9b71f3e4fe57f4951fd7bea79c5f6f512d1228b  lib/repositories/CierreDiaRepository.ts
d5bbbc0e680bdd783a27da27fd4ab31617d7a668852d411ca0fcb354d6ab9658  lib/repositories/CierresAdminRepository.ts
```

Sin `.bak` en el árbol. **El gate del leader sigue valiendo.**

---
---

# ADENDA — segunda revisión, tras el cierre de B1 (2026-08-20)

> **El acta del rechazo de arriba NO se toca.** Esto se añade debajo, que es como se lee la
> secuencia: hubo un bloqueante, se cerró, y aquí está lo que comprobé **yo** de ese cierre.

## 1 · B1 — verificado contra Postgres, no contra el acta del recorrido

El leader dice que hizo los §7-§9. **No lo doy por bueno por escrito**: consulté la base local en
**solo lectura** (script de un solo uso, borrado al terminar; `git status` sin rastros). Las **dos**
gestiones que existen con historial `gestion_tienda_ayuda` —las dos únicas de la tienda en la base—:

```
QA-R-0002  rechazada  cierre: solicitado  | ingBodega: 1000.00 | confFisica: no
QA-R-0001  rechazada  cierre: aprobado    | ingBodega:    0.00 | confFisica: SI
```

Y en las **dos**, las tres propiedades que sostienen la ficha:

| Propiedad medida | QA-R-0001 | QA-R-0002 |
| --- | --- | --- |
| `gestion.mensajero_id` == mensajero **de la orden** (R3) | **true** | **true** |
| `gestion.mensajero_id` == mensajero **del cierre** (R29) | **true** | **true** |
| actor del historial **≠** el mensajero (R4: la registró la tienda) | **true** | **true** |

**Paso 7 — CERRADO Y MEDIDO.** `QA-R-0001` está en un cierre **`aprobado`** con
`confirmada_fisica_at` **puesto**, sobre una gestión cuyo historial dice `gestion_tienda_ayuda`. Es
decir: la ventana de la 238 pidió el paquete de **la tienda**, se confirmó, y el cierre se aprobó.
El riesgo nº 3 de `design.md` §15 —«una gestión de la tienda puede bloquear la aprobación»— queda
**recorrido**, que era su mitigación escrita. ✔

**Paso 8 — CERRADO.** `QA-R-0002` lleva `ingreso_bodega_rechazo = 1000.00` **en la fila que registró
la tienda**, dentro del cierre **de su mensajero**, y el `total_ingreso_bodega_rechazos` del cierre
es **1000.00**. La promesa central de la ficha, vista en la base. ✔

**Paso 9 — verificado en el código**, que es donde se puede afirmar:
`GestionarDesdeAyudaModal.tsx:331` lleva `min={mananaCalendarioCR()}` y `:184` arranca el valor en
mañana. El `min="2026-08-21"` que el leader leyó en pantalla es exactamente eso. ✔

**B1 queda CERRADO.**

## 2 · 💰 La frase de la billetera — la juzgo, con la medición delante

El leader pidió no cerrar esto con una suposición. **No hace falta suponer: lo medí.** La respuesta
tiene tres capas, y la tercera **corrige** su conclusión.

### (a) Tiene razón en lo que afirma: el `cobroRechazado` NUNCA toca la billetera de la tienda

Comprobado siguiendo el dinero, no de memoria:

- `ingresoBodegaPorResultado` (`lib/utils/ingreso-bodega.ts:18`) produce el `cobroRechazado` y se
  congela en `gestion_orden.ingreso_bodega_rechazo` + `cierre_dia.total_ingreso_bodega_rechazos`.
- **Sus únicos consumidores** (censo `grep` completo) son la cadena del **cierre de bodega**:
  `CierreBodegaRepository` y `CierreBodegaService` (features 56/59). **Ningún `walletTiendaMovimiento`
  nace de esa columna.**
- Y de forma independiente: `cobroRechazado` **no está** en `WALLET_INGRESO_CONCEPTO_SEED`
  (`lib/types/wallet.ts:88-95`), que es la lista cerrada de los seis conceptos que el ledger de la
  tienda puede debitar.

Y sí miró la pantalla correcta: `/mi-wallet` es el ledger **de la tienda** (`wallet-tienda`, sólo
`adminTienda`), no el del mensajero.

⇒ **No hay ningún apunte que debiera existir y no exista por ese concepto.** Su lectura es correcta.

### (b) Pero la imprecisión NO está sólo en `tasks.md`: `design.md` §7.1 dice algo FALSO

> «`rechazada` → **`cobroRechazado` de la tarifa** …, que es **dinero real** atribuido a la bodega
> **y debitado a la tienda**.» — `design.md` §7.1

**La última cláusula es falsa.** El `cobroRechazado` se atribuye a la bodega y **no** se debita a la
tienda por ninguna vía. Hay que corregir **las dos** frases (design §7.1 y tasks T9.1 paso 8), no
sólo la de tasks: la de `design.md` es la que otra ficha va a heredar como doctrina.

### (c) ⚠️ Y lo que NO se puede escribir: «un rechazo no deja apunte en la billetera de la tienda»

**Eso sí sería falso**, y es la parte que corrijo. Un `rechazada` **sí debita a la tienda** dos
conceptos —`ingreso_flete_devolucion` y su IVA— vía `derivarIngresoOrden`
(`lib/utils/ingreso-ordenex.ts:86-94`), consumidos por `WalletTiendaFeedService:112-130`. El
interruptor Q3 que podría apagarlos (`TIENDA_DEBITA_FLETE_DEVOLUCION`) **está en `true`**: medí el
entorno local, la variable **está ausente** y su default es `true`.

**Por qué no apareció, medido y no supuesto.** La tarifa **congelada en `cierre_detail`** de esos
cierres es:

```
tarifaId: presente | esCentral: true | valorFleteDevuelto: 1000.00
                                     | valorFleteDevueltoGam: 0.00   <-- la que se usa
                                     | ivaFlete: 13.00
```

`derivarIngresoOrden` elige la columna **GAM** cuando `esCentral === true`, y esa está en **0.00** ⇒
los dos conceptos dan 0.00 ⇒ el feed los **omite** (R11: no emite movimientos en cero). Coherente con
el censo del ledger local, que no tiene ni uno de esos dos:

```
comision_cod=3  iva_comision_cod=3  iva_flete=3  flete=3  cod_recaudado=3
```

⇒ **Es un hueco de datos local, de la MISMA clase que el `0` del primer intento — pero en OTRA
tabla.** Se arregló `tarifa_zona_mensajero.cobro_rechazado` (la tarifa del **mensajero**, que alimenta
el ingreso de bodega); el débito de la tienda sale de la **tarifa vigente por tienda** congelada en
`cierre_detail`. **Nada de esto es un defecto de la 237**: el feed lee por `cierreId` + `resultado` y
no mira quién registró, así que una gestión de la tienda produce exactamente los mismos débitos que
una del mensajero (R30, probado).

**Redacción que sí es cierta**, para el recorrido §8:

> El `cobroRechazado` es **ingreso de bodega**: se congela en la fila de la gestión y en el total del
> cierre, y lo consume la cadena del cierre de bodega. **No es un cargo a la tienda y nunca aparece
> en su billetera.** Lo que sí le debita un rechazo es el **flete de devolución + IVA**, otro concepto
> y otra tarifa; aquí no apareció porque la tarifa congelada tiene `valorFleteDevueltoGam = 0.00` y la
> zona es central. No es un defecto: es un hueco de datos de la base local.

### (d) Un matiz del §8 que conviene dejar escrito, y no es bloqueante

Los **₡1.000 se midieron sobre un cierre `solicitado`**, no aprobado — y es **correcto**, porque ese
importe se congela al **SOLICITAR** (`derivarIngresoBodega` dentro de `solicitarCierre`), no al
aprobar. Pero el cierre que sí se **aprobó** (`QA-R-0001`) llevaba `0.00`. O sea: **todavía nadie ha
aprobado un cierre con una gestión de la tienda que mueva un importe distinto de cero.** Para la 237
no cambia nada —los feeds no miran quién registró y R30 lo prueba con los dos resultados— y **no
vuelvo a bloquear por esto**. Si el leader quisiera verlo, haría falta poner
`valor_flete_devuelto_gam` en la tarifa de la tienda (la zona es central) y aprobar el cierre de
`QA-R-0002`; es teatro de datos locales, no verificación de esta ficha.

## 3 · Los seis menores — qué espero antes del PR y qué sale con la ficha

### Antes del PR (tres, y las tres son de minutos)

| # | Qué | Por qué antes |
| --- | --- | --- |
| **m2** | El mapa de `progress/impl_237.md`: R27, R40 y R41 siguen diciendo `⏳ T7`. Apuntarlos a sus tests (o a `impl_237_frontend.md`). | Es **el archivo que CHECKPOINTS nombra**. Quien lo lea ve tres requisitos sin test. Es la clase exacta de cosa que costó el rechazo de la 236. Tres líneas. |
| **m7** *(nuevo, de esta adenda)* | Corregir la frase del dinero en **`design.md` §7.1** («y debitado a la tienda») y en **`tasks.md` T9.1 paso 8**, y dejar en `recorrido_237.md` §8 la redacción de (c). | Es **doctrina money-critical que otra ficha va a heredar**. Una frase que dice mal dónde vive el dinero es peor que ninguna. |
| **m1** | Las casillas. T10.1/T10.2/T10.3 ya marcadas. Queda **T0.1**: dejarla `[ ]` **a propósito** y decir en una línea que es deliberado y qué la desbloquea (re-medir antes de desplegar); T10.4 la marca el leader al cerrar. | El checkpoint pide todas `[x]`. Con la razón escrita al lado, el hueco es una decisión legible y no un olvido. |

### Salen con la ficha, como deuda declarada (cuatro)

- **m3** — la costura de R32: las dos rutas se ejercen y nada es vacuo. Sale.
- **m4** — las descargas sin `desdeAyudaTienda`: ya declarada como aditiva, el DTO lo permite. Sale.
- **m5** — el literal de D3 duplicado cliente/servidor: declarado en el código, riesgo bajo con el
  botón apagado. Sale.
- **m6** — D5-a (`IncidenteAdminService`) y D8 (`motivoSchema` sin tope): **deudas heredadas con
  dueño**, ninguna nace aquí. Salen.

## 4 · Árbol, al cerrar la adenda

Consultas de **solo lectura** sobre la base local; **ninguna escritura**. Los dos scripts de un solo
uso se borraron y `git status` no tiene rastro de ellos. Los tres archivos que muté en la primera
vuelta siguen en su sha original:

```
ff76a425aaaba3bc35b728445d7e0a3b6b17928690269796825532d223bee4ea  lib/repositories/GestionOrdenRepository.ts
3f5647a4749361123fbef0c8e9b71f3e4fe57f4951fd7bea79c5f6f512d1228b  lib/repositories/CierreDiaRepository.ts
d5bbbc0e680bdd783a27da27fd4ab31617d7a668852d411ca0fcb354d6ab9658  lib/repositories/CierresAdminRepository.ts
```

---

## VEREDICTO FINAL (adenda) — OK

**Sin bloqueantes.** `B1` cerrado y **verificado por mí contra Postgres**: el paso 7 dejó
`confirmada_fisica_at` puesto sobre una gestión de la tienda en un cierre **aprobado**, y el paso 8
dejó **₡1.000** de ingreso de bodega en la fila que registró la tienda, dentro del cierre de **su**
mensajero. En las dos gestiones reales de la base, `mensajero_id` es el del mensajero **y** el del
cierre, y el actor del historial **no** es el mensajero: **R3, R4 y R29 medidos en datos**, no en
dobles.

**Queda fuera, y con qué remite:**

1. **`m2`, `m7` y `m1` antes del PR** — el mapa de `impl_237.md`; la frase del dinero en `design.md`
   §7.1 + `tasks.md` T9 paso 8 + `recorrido_237.md` §8; y la línea que explica por qué T0.1 sigue
   abierta. Son minutos y **no requieren otra revisión**: es documentación, no conducta.
2. **`T0.1`** — re-medir la población en ayuda **antes de desplegar**. Bloquea el despliegue, no el
   merge. Remite: la consulta M1 de `design.md` §16.
3. **Nadie ha aprobado aún un cierre de la tienda con importe ≠ 0** (§2-d). No es de esta ficha y no
   bloquea; queda escrito por si algún día se busca ese rastro y no aparece.
4. **`m3`-`m6`** — deuda declarada con dueño, sale con la ficha.
5. **El trabajo sigue SIN COMMIT.** Tras commitear, **verificar el blob** antes del PR: ni el gate ni
   esta acta distinguen «lo commiteé» de «alguien lo revirtió».
6. **Entrada en `progress/history.md`** — sigue faltando; es el cierre del leader.
