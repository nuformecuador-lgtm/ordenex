# impl_396 — «Pago a tienda» dice de quién es cada parte · TANDA DEL CIERRE DE MENSAJERO

## Lo primero, porque cambia cómo se lee todo lo demás

**El dinero está BIEN. Esto es presentación, no una corrección de dinero.**

Verificado antes de tocar nada: `wallet_tienda_movimiento` lleva los movimientos **separados por
tienda** desde siempre, cada uno con sus propias cifras (`cod_recaudado`, `flete`, `comision_cod`,
`iva_flete`, `iva_comision_cod`). **A nadie se le paga mal, y esta tanda no emite, borra ni
corrige ni una fila del ledger.** No hay migración, no hay `down.sql`, no hay cambio de esquema.

Lo que faltaba es que la pantalla dijera **de quién es cada parte** de un total que ya era
correcto como total. El cierre es del **MENSAJERO**, no de la tienda: un mensajero reparte para
quien le toque, así que un cierre puede llevar órdenes de varias tiendas —medido en producción el
2026-09-08: de 56 cierres, 39 tienen UNA y 17 tienen DOS— y «Pago a tienda» era la suma de todas
sin que nada lo indicara.

## Alcance de ESTA bitácora

Sólo la **mitad de servidor del detalle del cierre de MENSAJERO**: tandas **A**, **B** y **C1** de
`specs/396-desglose-por-tienda-en-cierres/tasks.md`.

**NO se tocó nada de bodega** (`CierresBodegaAdminService`, `CierresBodegaAdminRepository`,
`CierresBodegaAdminModule`): otra sesión trabaja en esos archivos. **NO se tocó ningún
componente**: C2/C3/C4 y toda la tanda D quedan pendientes. Los rótulos de `cierre-labels.ts`
tampoco: son de la tanda de pantalla.

---

## Lo que se reusa de la ficha 395, en vez de reinventarlo (T0.1)

Leído en el archivo real antes de diseñar nada. Los **cuatro campos** que la 395 dejó en
`CierreDetalleAdminServiceResult` **siguen intactos y siguen viajando**; ninguno se absorbió ni
cambió de valor:

| de la 395 | qué se hizo con él aquí |
| --- | --- |
| `ganaLaTienda` (`ingreso-ordenex.ts:390`) | **SE DESGLOSA por tienda** (Q7). Se aplica al subconjunto: cero aritmética nueva |
| `cobradoSobreRecaudado` | **no entra** en el desglose (R5: tres cifras, no cuatro). Intacto |
| `netoOrdenex` | es de Ordenex, no de una tienda. Ni se toca ni se reparte |
| `fleteRechazoYaCobradoATienda` | es del cierre entero. No se reparte |

**Rótulos que la 395 dejó para `ganaLaTienda` agregado:** no se buscaron ni se crearon aquí —
`cierre-labels.ts` es de la tanda de pantalla (C2). Queda dicho para quien la haga.

**Toda la aritmética que esta ficha necesita ya existía.** Lo único nuevo es la **partición**.

## T0.2 — los 14 puntos, confirmados en el archivo real

Verificados a mano en disco. Los relevantes a esta tanda (1, 2, 3, 4, 7, 8, 9, 10, 11, 13) son
**ciertos**. Los de bodega (5, 6) y descarga (12, 14) no se comprobaron: fuera de alcance.

**Una cosa resultó distinta de lo escrito, y hay que decirla** (`design.md §3`):

> El diseño dice que `CierreDiaRepository.toPendienteRow` toma `row.orden.tiendaId`. **Esa columna
> NO estaba proyectada**: `WITH_DETALLE` (`CierreDiaRepository.ts:221-233`) seleccionaba
> `tienda: { select: { nombre: true } }` y nada más. Así que A2 necesitó **una segunda línea de
> proyección** que el spec no mencionaba (`tiendaId: true` dentro del `select` de `orden`). El
> «diff de una línea» de A1 sí se cumplió tal cual.

## Archivos tocados

### Producción (6)

| archivo | qué |
| --- | --- |
| `lib/repositories/CierresAdminRepository.ts` | A1: `DETALLE_ADMIN_SELECT` gana `tiendaId: true` (**una línea** + su comentario). A2: `toPendienteRowDesdeSnapshot` mapea `d.tiendaId` — el **congelado** |
| `lib/repositories/CierreDiaRepository.ts` | A2: `WITH_DETALLE` gana `orden.tiendaId`, y `toPendienteRow` mapea `row.orden.tiendaId` — el **vivo** (ahí no hay cierre todavía, no hay snapshot que leer) |
| `lib/interfaces/repositories/ICierreDiaRepository.ts` | A2: `CierreGestionPendienteRow.tiendaId: string`, **requerido**, con el docstring que dice de dónde sale en cada mapper y por qué |
| `lib/utils/ingreso-ordenex.ts` | B1: `ParteDeTienda`, `GestionDeTienda` y **`partesPorTienda`** |
| `lib/services/CierresAdminService.ts` | C1: `verCierreDetalle` emite `partesPorTienda(found.gestiones)` |
| `lib/interfaces/services/ICierresAdminService.ts` | C1: el campo `partesPorTienda: ParteDeTienda[]` en el DTO, con sus invariantes escritas |

**Sin migración (R25).** El diff no toca `db/`. La columna `cierre_detail.tienda_id` existe desde
la feature 69 y está poblada: lo único que faltaba era **leerla**.

**Sin ciclo de imports** (comprobado, `design.md §9.7`): `ingreso-ordenex.ts` ahora importa
`computeTotales` de `cierre-totales.ts`, y ese módulo importa `pago-mensajero`, `ingreso-bodega` y
tipos — **ninguno importa `ingreso-ordenex`**. No hizo falta caer a la alternativa del archivo
propio.

### Tests nuevos (2)

- `tests/unit/utils/partes-por-tienda.test.ts` — **22 casos** del derivador (B2).
- `tests/integration/db/cierre-desglose-por-tienda-sql-real.test.ts` — **4 casos** contra Postgres
  real (B3). **No se salta**: corrió con `.env` y reportó `4 passed`, no `skipped`.

### Tests ampliados (1)

- `tests/unit/services/cierres-admin-service.test.ts` — **7 casos** nuevos de C1, al final del
  archivo, con su propio `describe`.

### Arrastre mecánico, MEDIDO

El diseño estimaba «20 archivos de test tipan `CierreGestionPendienteRow`». Lo real:

- **21** archivos referencian el tipo; **16** construían la fila entera y necesitaron
  `tiendaId: "tienda-1"`. Los otros 5 sólo importan el tipo o usan `Pick<>`.
- La fixture central `tests/fixtures/cierre-pagos.ts` **no absorbió nada**: sólo cubre `pagos`.
- **Y 9 archivos más que el diseño no contaba**: los de `tests/components/` que construyen el DTO
  completo del detalle y necesitaron `partesPorTienda: []` por C1.

**Total de arrastre: 25 archivos de test.** Sin un solo `as`, `any` ni `@ts-expect-error` nuevo —
`tiendaId` se declaró **requerido** justo para que el compilador cazara los 16, y los cazó.

> ⚠️ **AVISO DE SOLAPE CON LA FICHA 397 (bodega), para el merge.** Dos de esos 25 archivos son de
> bodega: `tests/unit/services/cierres-bodega-admin-completo.test.ts` y
> `tests/unit/services/cierres-bodega-admin-service.test.ts`. **No es una intromisión de diseño:**
> son **+2 líneas cada uno** (`tiendaId: "tienda-1"` y su comentario) en el constructor de
> `CierreGestionPendienteRow`, **forzadas por el compilador** al declarar el campo requerido. Sin
> ellas el `typecheck` de todo el repo queda rojo, incluido el de la 397. **Ningún archivo de
> producción de bodega se tocó** (`CierresBodegaAdminService`, `CierresBodegaAdminRepository` y
> `CierresBodegaAdminModule` están intactos). Si la 397 toca esos mismos dos archivos de test, el
> conflicto es trivial y se resuelve conservando las dos partes.

---

## `partesPorTienda` — la estructura y sus claves

```ts
export interface ParteDeTienda {
  tiendaId: string;      // la CLAVE del grupo (cierre_detail.tienda_id, congelado)
  tiendaNombre: string;  // sólo para mostrar; NO agrupa nada
  recaudado: string;     // computeTotales(subconjunto).general
  pagoTienda: string;    // pagoTiendaOrdenex(recaudado, fleteConIva, comisionConIva)
  ganaLaTienda: string;  // ganaLaTienda(recaudado, total)
}

export function partesPorTienda(gestiones: ReadonlyArray<GestionDeTienda>): ParteDeTienda[];
```

**CINCO claves y ni una más (R5).** `fleteConIva` y `comisionConIva` por tienda se calculan
**dentro** —hacen falta para derivar `pagoTienda`— y **no se emiten**. La tercera cifra
(`ganaLaTienda`) entró por **firma explícita del humano del 2026-09-08 (Q7)**, y así está escrito
en el docstring: la cuarta necesitará otra firma.

**Ni una fórmula de dinero nueva (R15).** Particiona por `tiendaId` y llama, sobre cada
subconjunto, a `computeTotales`, `totalesIngresoOrdenex`, `pagoTiendaOrdenex` y `ganaLaTienda` —
las mismas que producen los agregados. Es el patrón que `dinero-por-producto.ts:200-273` ya usó
para partir el mismo importe por producto.

**El dinero viaja como STRING de punta a punta.** Toda la aritmética con `Prisma.Decimal`, y **el
orden también**: la comparación es `Prisma.Decimal.comparedTo`, nunca `Number(a) − Number(b)`.

**El orden lo fija el servidor (R8, Q6):** `pagoTienda` descendente; desempate `tiendaNombre`
ascendente por unidades de código (`<`/`>`, no `localeCompare`), y `tiendaId` como último
desempate, que cierra el orden total.

### El campo del DTO

`CierreDetalleAdminServiceResult.partesPorTienda: ParteDeTienda[]`, **emitido SIEMPRE**, también
con una sola tienda (un elemento cuyas tres cifras son las agregadas). El umbral de Q5 —enseñarlo
sólo con dos o más— es de **presentación** y vive en la pantalla. Un contrato que a veces trae la
lista y a veces no obliga a cada consumidor a distinguir dos formas del mismo dato, que es el
error que la 264 ya documentó.

### Las cuatro identidades

```
R10 ·  Σ parte.pagoTienda    ===  pagoTienda   (el agregado del mismo detalle)
R11 ·  Σ parte.ganaLaTienda  ===  ganaLaTienda
R12 ·  Σ parte.recaudado     ===  cierre.totales.general

y POR TIENDA:
       parte.pagoTienda − parte.ganaLaTienda  ===  flete por rechazo + IVA DE ESA TIENDA
```

La cuarta es la que más protege: **hace imposible derivar una de las dos cifras de pago con el
subconjunto equivocado sin que se note**. Su test usa un cierre donde **una tienda tiene rechazos
(1.695,00) y la otra no (0,00)** — si las dos dieran cero, pasaría sin comprobar nada.

---

## Mapa `R<n>` → test

De los 27 requisitos, **esta tanda cubre 15**. Los otros 12 son de pantalla o de bodega y quedan
para sus tandas; están marcados como tales, no como cubiertos.

| R | Test que lo cubre |
| --- | --- |
| **R4** | `partes-por-tienda.test.ts` › «emite una parte por tienda con recaudado, pagoTienda y ganaLaTienda» · `cierres-admin-service.test.ts` › «R4/R7/R8: una fila por tienda…» |
| **R5** | `partes-por-tienda.test.ts` › «cada parte tiene EXACTAMENTE cinco claves» y «no se filtran `fleteConIva` ni `comisionConIva`…» |
| **R6** | **`cierre-desglose-por-tienda-sql-real.test.ts`** › «R6: la proyección sube el `tienda_id` CONGELADO, no el de la orden viva» (Postgres real) |
| **R7** | `…sql-real.test.ts` › «R6/R7: … NO se funde aunque las dos tiendas se llamen igual» · `partes-por-tienda.test.ts` › «R7: la CLAVE es el id…» |
| **R8** | `partes-por-tienda.test.ts` › «100 / 300 / 200 salen 300, 200, 100», «a igual importe manda el NOMBRE ascendente», «a igual importe Y mismo nombre manda el ID», «el orden es el mismo aunque las gestiones lleguen al revés» |
| **R9** | `partes-por-tienda.test.ts` › bloque «la tienda que sólo trajo RECHAZOS entra igual, y cuenta» (3 casos) |
| **R10** | `partes-por-tienda.test.ts` › «Σ pagoTienda === el "Pago a tienda" del cierre entero» · `cierres-admin-service.test.ts` › «R10/R11/R12…» · `…sql-real.test.ts` › «las identidades se sostienen sobre datos que salieron de Postgres» |
| **R11** | ídem, «Σ ganaLaTienda === …» |
| **R12** | ídem, «Σ recaudado === total general» |
| **R13** | `partes-por-tienda.test.ts` › «una gestión NO entregada con líneas de pago no aporta al recaudado de su tienda» |
| **R14** | `partes-por-tienda.test.ts` › «las tres cifras de cada parte son cadenas con exactamente dos decimales» |
| **R15** | cubierto por las mutaciones **M4** y **M5**: derivar con el subconjunto equivocado pone en rojo la cuarta identidad |
| **R16** | `partes-por-tienda.test.ts` › «R16: no reparte el pago al mensajero ni el ingreso de bodega» · `cierres-admin-service.test.ts` › «R16: … no viajan por tienda» |
| **R18** | `cierres-admin-service.test.ts` › «R18: ni un importe ya visible cambia de valor por añadir el desglose» (los 7 agregados **y los 4 campos de la 395**) |
| **R24** | `cierres-admin-service.test.ts` › «R24: el desglose no se cuela por las puertas de alcance» + los tests de alcance ya existentes de la suite |
| **R25** | el diff no toca `db/`; el gate rápido se negó solo (ver abajo) |

**Pendientes de otra tanda:** R1, R2, R3, R17, R22, R26 (pantalla, C2-C4) · R19, R20, R21 (bodega,
D) · R23 (sin ruta nueva: se cumple por ausencia de código, se verifica con la pantalla) · R27
(descargas: el diff no contiene ningún archivo `*descarga-columnas*`, comprobado).

---

## Mutaciones (E3) — 12 aplicadas, **12 muertas**, con autocomprobación

Arnés en `scratchpad/mutar.py`. **Autocomprueba cuatro cosas** antes de dar un veredicto, porque
en este repo ya hubo uno que reportó «9/9 supervivientes» dos veces sin haber ejecutado un test:

1. el texto a sustituir **existe y aparece exactamente una vez** (si no, aborta);
2. el archivo **cambió en disco** después de escribir (se compara el contenido releído);
3. vitest **ejecutó tests de verdad** (se lee el contador `Tests: N passed/failed` de la salida);
4. el archivo **se restauró** y se verifica que volvió a su contenido original.

Y hay un **CONTROL NEGATIVO** que demuestra que el veredicto depende de la corrida y no del guion.

### Salida real

```
[M1]   agrupa por tiendaNombre en vez de por tiendaId
       exit=1  Test Files: 2 failed (2)  Tests: 12 failed | 14 passed (26)   ✅ MUERTA
       rojos: «R7: la CLAVE es el id y el nombre sólo se muestra — dos tiendas HOMÓNIMAS no se funden»
              «emite una parte por tienda con recaudado, pagoTienda y ganaLaTienda»

[M2]   lee la tienda VIVA de la orden en vez de la congelada
       exit=1  Test Files: 1 failed (1)  Tests: 4 failed (4)                 ✅ MUERTA
       rojos: «R6: la proyección sube el `tienda_id` CONGELADO, no el de la orden viva»
              «CONTROL POSITIVO: el corpus existe — tres gestiones y DOS tiendas congeladas distintas»

[M3]   quita el filtro `entregada` del recaudo por tienda
       exit=1  Test Files: 1 failed (1)  Tests: 1 failed | 21 passed (22)    ✅ MUERTA
       rojo:  «una gestión NO entregada con líneas de pago no aporta al recaudado de su tienda»

[M4]   suma el flete por rechazo al `pagoTienda` de cada tienda
       exit=1  Test Files: 3 failed (3)  Tests: 10 failed | 108 passed (118) ✅ MUERTA
       rojos: «Σ pagoTienda === el "Pago a tienda" del cierre entero, al céntimo»
              «Norte, que SÍ tuvo un rechazo, difiere en exactamente 1.695,00»

[M5]   deriva `ganaLaTienda(t)` con el total AGREGADO en vez del de su tienda
       exit=1  Test Files: 3 failed (3)  Tests: 12 failed | 106 passed (118) ✅ MUERTA
       rojos: «Σ ganaLaTienda === "lo que gana la tienda" del cierre entero, al céntimo»
              «Norte, que SÍ tuvo un rechazo, difiere en exactamente 1.695,00»
              «Sur, que NO tuvo rechazos, no difiere: las dos cifras coinciden»

[M6]   recorta a "0.00" un `ganaLaTienda` negativo
       exit=1  Test Files: 1 failed (1)  Tests: 2 failed | 20 passed (22)    ✅ MUERTA
       rojos: «aparece con recaudado 0,00, pagoTienda 0,00 y ganaLaTienda NEGATIVO con su signo»

[M7]   invierte el orden del array
       exit=1  Test Files: 2 failed (2)  Tests: 4 failed | 110 passed (114)  ✅ MUERTA
       rojos: «100 / 300 / 200 salen 300, 200, 100»
              «R4/R7/R8: una fila por tienda, con sus TRES cifras y ordenadas por lo que se les paga»

[M8]   cambia un céntimo en una parte sin tocar el agregado
       exit=1  Test Files: 3 failed (3)  Tests: 18 failed | 100 passed (118) ✅ MUERTA
       rojos: «Σ pagoTienda === el "Pago a tienda" del cierre entero, al céntimo»
              «con UNA sola tienda hay UNA parte, y sus tres cifras son las agregadas»

[M9]   emite también `fleteConIva` en `ParteDeTienda`
       exit=1  Test Files: 2 failed (2)  Tests: 9 failed | 105 passed (114)  ✅ MUERTA
       rojos: «cada parte tiene EXACTAMENTE cinco claves»
              «no se filtran `fleteConIva` ni `comisionConIva`, que se calculan dentro pero no se emiten»

[M10]  omite del desglose la tienda que no recaudó nada
       exit=1  Test Files: 1 failed (1)  Tests: 3 failed | 19 passed (22)    ✅ MUERTA
       rojos: «CUENTA para el cardinal de tiendas del cierre (es lo que dispara el umbral en pantalla)»

[M11b] mete el UMBRAL de presentación dentro del CONTRATO (lista vacía con una sola tienda)
       exit=1  Test Files: 1 failed (1)  Tests: 1 failed | 91 passed (92)    ✅ MUERTA
       rojo:  «con UNA sola tienda el campo se emite igual, con un elemento (el umbral es de pantalla)»

[M16m] deja de llamar a `partesPorTienda` en el detalle del mensajero
       exit=1  Test Files: 1 failed (1)  Tests: 4 failed | 88 passed (92)    ✅ MUERTA
       rojos: «R4/R7/R8: una fila por tienda…», «R10/R11/R12: la suma de las partes ES cada agregado…»

[CONTROL] cambia un COMENTARIO (no debe romper nada)
       exit=0  Test Files: 3 passed (3)  Tests: 118 passed (118)             ❌ SOBREVIVIÓ  ← lo correcto
```

**Por qué el control importa:** sin él, «12/12 muertas» podría ser un arnés que dice siempre lo
mismo. El control cambia una línea de comentario, corre **los mismos 118 tests** y sale **verde** —
o sea que el rojo de los otros doce lo produjo el cambio de comportamiento, no el guion.

### Mutaciones del spec que NO corresponden a esta tanda

`M11` (el desglose aparece en pantalla con una sola tienda), `M12` (se pinta en la vista del
mensajero) y `M13` (mismo rótulo para las dos cifras) son de **C4, pantalla**. `M14`, `M15` y el
resto de `M16` son de la **tanda D, bodega**. No se corrieron y **no se dan por cubiertas**.

`M11b` es el equivalente de `M11` en la capa de servidor —meter el umbral en el contrato— y sí se
corrió: protege la decisión de `design.md §5.1`, no el requisito negativo de pantalla, que sigue
sin test hasta C4.

---

## Verificación

```
pnpm run typecheck   → verde, sin salida (tsc --noEmit)
pnpm run lint        → 0 errores, 175 warnings (todos preexistentes: `_var` sin usar en dobles
                       de test y dos `eslint-disable` sobrantes; ninguno en archivos de esta tanda)

pnpm exec vitest run tests/unit/utils/partes-por-tienda.test.ts
  → Test Files 1 passed (1) · Tests 22 passed (22)

pnpm exec vitest run tests/integration/db/cierre-desglose-por-tienda-sql-real.test.ts
  → Test Files 1 passed (1) · Tests 4 passed (4)      ← NO «skipped»: corrió contra Postgres

pnpm exec vitest run tests/unit/services/cierres-admin-service.test.ts
  → Test Files 1 passed (1) · Tests 92 passed (92)

pnpm exec vitest related --run lib/repositories/CierresAdminRepository.ts \
      lib/repositories/CierreDiaRepository.ts lib/interfaces/repositories/ICierreDiaRepository.ts
  → Test Files 86 passed (86) · Tests 1290 passed (1290)
```

### El gate

**`./init.sh --rapido` se negó solo**, como estaba previsto — el diff toca archivos con nombre de
dinero y tipos compartidos:

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    lib/interfaces/repositories/ICierreDiaRepository.ts
    lib/interfaces/services/ICierresAdminService.ts
    lib/repositories/CierreDiaRepository.ts
    lib/repositories/CierresAdminRepository.ts
    lib/services/CierresAdminService.ts
    lib/utils/ingreso-ordenex.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

**`./init.sh` completo — VERDE.** El `INIT_EXIT` está escrito **dentro** del log (no es el exit
code que reporta el shell, que un `echo` puede tapar), y el log se leyó entero, sin `tail`:

```
 Test Files  1824 passed (1824)
      Tests  26205 passed | 26 skipped (26231)
   Duration  627.85s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1824 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped` son 26, que es el número conocido**, y se miraron uno a uno en vez de dar por
bueno el `INIT_EXIT`: son `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9). **Ni uno
solo de `integration/db`** — es decir, el `.env` estaba puesto y **B3 corrió de verdad**. Se
comprobó en el log línea a línea:

```
línea 6309:  ✓ tests/unit/utils/partes-por-tienda.test.ts (22 tests) 24ms
línea 9458:  ✓ tests/integration/db/cierre-desglose-por-tienda-sql-real.test.ts (4 tests) 954ms
```

El aviso de las **tres migraciones sin `down.sql`** es **preexistente y ajeno a esta tanda**: son
de las rutas optimizadas (agosto), y esta ficha **no añade ninguna migración**.

`tests/integration/recuperar-contrasena-form.test.tsx` **no salió rojo** en esta corrida.

---

## Notas para quien siga

1. **La tanda de BODEGA (D) no está hecha y no se tocó nada suyo.** El trabajo ahí es pequeño en
   la capa de datos —`CierresBodegaAdminRepository` **ya usa `DETALLE_ADMIN_SELECT` y
   `toPendienteRowDesdeSnapshot`**, así que `tiendaId` **ya le llega gratis**, sin tocar ese
   archivo—. Lo que falta en D1 es: emitir `ganaLaTienda` **agregado** en los dos niveles (hoy el
   DTO de bodega no lo tiene, hallazgo de `design.md §5.2`) y llamar a `partesPorTienda` en los
   dos sitios: `partesPorTienda(cd.gestiones)` y
   `partesPorTienda(found.cierresDia.flatMap((cd) => cd.gestiones))`.
2. **La PANTALLA (C2-C4) no está hecha.** El campo `partesPorTienda` viaja ya en el DTO, ordenado
   y con las cifras derivadas: el componente **no tiene que hacer ni una operación aritmética**, y
   el umbral de «sólo con dos o más» se evalúa ahí con `partesPorTienda.length >= 2`.
3. **La descarga no se tocó (R27, Q3):** el diff no contiene ningún archivo `*descarga-columnas*`.
4. **`tests/integration/recuperar-contrasena-form.test.tsx` es frágil bajo carga** y no tiene nada
   que ver con esta tanda. Si sale rojo en el gate, aislarlo antes de atribuírselo a nadie, y **no
   meterlo en `tests/baseline-rojos.json`**.
5. El arnés de mutaciones vive en el scratchpad de la sesión, **no en el repo**: es de un solo uso
   y su evidencia es la salida pegada arriba.

---

## Veredicto

**Hecha la mitad de servidor del detalle del cierre de MENSAJERO (tandas A, B y C1): el DTO ya
dice de quién es cada parte, con las cuatro identidades atadas por test y 12 mutaciones muertas —
y sin que ni una cifra de dinero cambie de valor.**
