# impl_396 · FRONTEND — la PANTALLA del cierre de MENSAJERO (tandas C2, C3 y C4)

## Lo primero, porque cambia cómo se lee todo lo demás

**El dinero está BIEN. Esto es presentación, no una corrección de dinero.** La wallet
(`wallet_tienda_movimiento`) lleva los movimientos separados por tienda desde siempre, cada uno
con sus propias cifras: **a nadie se le paga mal**, y esta tanda **no toca ni una fila del ledger,
ni el servidor, ni el esquema**. El diff es de **tres archivos de pantalla y un archivo de test**.

Lo que faltaba es que la pantalla dijera **de quién es cada parte** de un total que ya era
correcto como total. El cierre es del **MENSAJERO**, no de la tienda: un mensajero reparte para
quien le toque, así que un cierre puede llevar órdenes de varias —medido el 2026-09-08: de 56
cierres, 39 tienen UNA y 17 tienen DOS— y «Pago a tienda» era la suma de todas sin decirlo.

## Alcance de ESTA bitácora

Sólo la **pantalla del detalle del cierre de MENSAJERO**: tandas **C2**, **C3** y **C4** de
`specs/396-desglose-por-tienda-en-cierres/tasks.md`.

**NO se tocó NADA de bodega.** `CierresBodegaAdminModule.tsx`, `CierresBodegaAdminService` y
`ICierresBodegaAdminService` están intactos: la **tanda D sigue pendiente**. Tampoco se tocó el
servidor (tandas A, B y C1, ya mergeadas en `dev` por el PR #760), ni `lib/`, ni `db/`, ni ningún
archivo `*descarga-columnas*` (R27), ni `CierreDiaModule.tsx` (R26).

---

## ⚠️ UNA COSA DEL SPEC NO ES CIERTA HOY, Y HAY QUE DECIRLA

`design.md §8.1` y `tasks.md § C3` mandan poner la marca y el desglose en
**`cierre-factura.tsx`, dentro del corte `esMensajero` de la línea 1810**.

**Eso ya no es donde vive esta pantalla.** El spec se escribió antes de que la **mitad de pantalla
de la ficha 395 se mergeara**, y esa ficha **sacó las cascadas de dinero de `cierre-factura.tsx`**
a un archivo propio, `CascadasCierreMensajero.tsx`, que monta **sólo** `CierresAdminModule`
(:1210). En `cierre-factura.tsx:1810` hoy queda la **tarjeta** «Pago a tienda» del comprobante, no
la cascada.

**Qué se hizo en su lugar, y por qué es mejor que lo escrito:**

| | Poner el desglose en `cierre-factura.tsx` | Ponerlo en `CascadasCierreMensajero.tsx` (lo hecho) |
|---|---|---|
| R26 (el mensajero no lo ve) | depende de acordarse del `esMensajero` | **cierto por construcción**: `CierreDiaModule` no monta ese componente |
| Coherencia con la 395 | el desglose quedaría lejos de las dos cifras que parte | queda **pegado** a «Pago a tienda» y a «Gana la tienda» |
| Censo de dinero (E2) | — | el archivo **ya está censado** en `DineroIdentidadesEnPantalla`, que así **pasa sin modificarse** |
| Superficie tocada | un archivo de 2.077 líneas que también usa el mensajero | un archivo de 272 líneas que sólo usa el admin |

El resto de lo que el spec afirma del código **sí es cierto**: `CascadaDinero` no hace aritmética
(`:12-18`), los rótulos de la 393/395 viven en `cierre-labels.ts`, y `partesPorTienda` llega en el
DTO ya derivado y ya ordenado.

---

## Cómo queda la pantalla

`/cierres-admin` → abrir un cierre. Dentro del modal, **en este orden**:

```
┌ De quién es el dinero ─────────────────────────────────┐   ← 395, intacta
│  Total general                              ₡285.275   │
│  Lo que Ordenex facturó                  -₡70.946,67   │
│  ══════════════════════════════════════════════════    │
│  Gana la tienda                         ₡214.328,33    │
│    · Lo recaudado menos todo lo que Ordenex le factura… │
│    · Es el total de las 2 tiendas de este cierre,       │   ← 396 · R1 (la MARCA)
│      sumadas. Abajo, cuánto le toca a cada una.         │
└────────────────────────────────────────────────────────┘

┌ Lo que Ordenex le factura a la tienda ─────────────────┐   ← 395, intacta
│  … (la línea puente, el flete por rechazo, lo facturado)│
│  Pago a tienda                          ₡225.176,33    │
│    · Es lo que se le paga de este dinero hoy…           │
│    · Es el total de las 2 tiendas de este cierre,       │   ← 396 · R1 (la MARCA)
│      sumadas. Abajo, cuánto le toca a cada una.         │
└────────────────────────────────────────────────────────┘

  De qué tienda es cada parte                                ← 396 · EL DESGLOSE
    «Se le paga hoy» y «Gana en total» no son la misma cifra: la diferencia
    es el flete por rechazo, que a la tienda se le cobra aparte, contra su saldo.
    El pago al mensajero y el ingreso de bodega por rechazos son del cierre
    completo: no están repartidos entre las tiendas.                    ← R17

    ┌ Tienda Norte ──────────────────────┐  ┌ Tienda Sur ──────────────────────┐
    │ Recaudado de esta tienda ₡180.000  │  │ Recaudado de esta tienda ₡105.275│
    │ ═══════════════════════════════════│  │ ══════════════════════════════════│
    │ Se le paga hoy           ₡144.000  │  │ Se le paga hoy        ₡81.176,33 │
    │ ═══════════════════════════════════│  │ ══════════════════════════════════│
    │ Gana en total            ₡133.152  │  │ Gana en total         ₡81.176,33 │
    └────────────────────────────────────┘  └──────────────────────────────────┘

┌ Lo que le queda a Ordenex ─────────────────────────────┐   ← 395, intacta
└────────────────────────────────────────────────────────┘
```

**Con UNA sola tienda no aparece NADA de lo anterior** (R2/Q5): ni la marca, ni el título, ni las
notas, ni una cascada. La pantalla queda **exactamente** como la dejó la 395.

### Dónde va el desglose, y por qué ahí

**Después** de la cascada que termina en «Pago a tienda» —la cifra que parte— y **antes** de la de
Ordenex, que ya no habla de tiendas. Es la misma decisión que tomó la 395 («la partición primero,
el desglose después»): primero se lee la cuenta que cierra, y sólo después de quién es cada parte.
Hay test del orden real en el documento.

---

## Los rótulos (C2) — y por qué éstos

Todos nuevos en **`app/(app)/cierres-admin/_components/cierre-labels.ts`**, el módulo PURO, que es
de donde tiran las dos pantallas. **Ni un literal de texto dentro de un componente (R3).**

| Constante | Texto | Por qué |
|---|---|---|
| `DESGLOSE_POR_TIENDA_TITULO` | «De qué tienda es cada parte» | Rima con `CASCADA_DUENO_TITULO` («De quién es el dinero»): es la misma pregunta un nivel abajo |
| `TIENDA_RECAUDADO_LABEL` | «Recaudado de esta tienda» | |
| `TIENDA_PAGO_HOY_LABEL` | **«Se le paga hoy»** | |
| `TIENDA_GANA_TOTAL_LABEL` | **«Gana en total»** | |
| `DESGLOSE_POR_TIENDA_NOTA` | «"Se le paga hoy" y "Gana en total" no son la misma cifra: la diferencia es el flete por rechazo, que a la tienda se le cobra aparte, contra su saldo.» | El par `PAGO_TIENDA_HOY_NOTA`/`GANA_LA_TIENDA_NOTA` de la 395, dicho **una vez** para todo el desglose |
| `DESGLOSE_NO_REPARTIDO_NOTA` | «El pago al mensajero y el ingreso de bodega por rechazos son del cierre completo: no están repartidos entre las tiendas.» | R17 |
| `totalDeVariasTiendasNota(n)` | «Es el total de las N tiendas de este cierre, sumadas. Abajo, cuánto le toca a cada una.» | R1: dice que es agregado **y de cuántas** |

**⚠️ LAS DOS CIFRAS DE PAGO TIENEN QUE SER IMPOSIBLES DE CONFUNDIR**, que es el fallo que la 395
acaba de arreglar un nivel más arriba y que aquí **se multiplica por el número de tiendas**. Por
eso los rótulos dicen **«hoy»** y **«en total»** con todas las letras, y por eso la nota que los
separa está siempre que se pinte el desglose.

**NO se reusan `PAGO_TIENDA_LABEL` ni `GANA_LA_TIENDA_LABEL`**: esos nombran los **agregados** del
cierre entero. Darles aquí un segundo significado —el de UNA tienda— haría que la misma etiqueta
valiera dos cifras distintas en la misma pantalla, que es el defecto que la 393 cerró (R24).
Dentro de la cascada de una tienda el sujeto **ya es** esa tienda: el rótulo dice qué se le hace,
no a quién.

**`PAGO_TIENDA_LABEL`, `PAGO_TIENDA_NOTA` y `PARA_LA_TIENDA_LABEL` no se tocaron** (R18).

### Decisiones de redacción que son MÍAS, no del spec

1. **Los siete textos de arriba.** El spec exigía que existieran, salieran de una constante y se
   distinguieran (R1/R3/R17 y el criterio de C2); **qué dicen lo elegí yo**.
2. **`totalDeVariasTiendasNota` es una FUNCIÓN, no una constante.** R1 obliga a decir «de
   cuántas», y el número es parte del texto. Sigue cumpliendo R3 —el texto vive en el módulo puro,
   no tecleado en el componente— con el patrón que `destinoCierre` ya usa en ese mismo archivo.
3. **La marca va junto a las DOS cifras**, «Pago a tienda» y «Gana la tienda». R1 sólo obliga a
   marcar la primera. Marcar una sola diría, por omisión, que la otra sí es de una tienda — y las
   dos son la suma de las mismas tiendas.
4. **La cascada de una tienda NO lleva operadores**: es una lista de tres lecturas, no una resta.
   Para pintarla como resta haría falta una cuarta cifra —lo que Ordenex le factura a ESA tienda—
   y **R5 la prohíbe**. Inventar una resta que no se puede completar sería el defecto de la 395
   otra vez.
5. **Dos tiendas homónimas se leen igual** (mismo `aria-label`) porque **se ven** igual: quien mira
   la pantalla está en la misma situación. Lo que no pasa es que su dinero se funda —el servidor
   agrupa por el id congelado— y hay test que lo comprueba.

---

## Archivos tocados

### Producción (3)

| archivo | qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | C2: los **siete** textos nuevos, con su cabecera. **Ni un rótulo existente cambia** |
| `app/(app)/cierres-admin/_components/CascadasCierreMensajero.tsx` | C3: la prop `partesPorTienda`, el **umbral**, la **marca** en las dos líneas y `DesglosePorTienda` + `lineasDeTienda` |
| `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` | C3: `partesPorTienda` en `DetalleAbierto`, se guarda tal cual del servidor y se pasa a la cascada |

### Tests nuevos (1)

- `tests/components/CierreMensajeroDesglosePorTienda.test.tsx` — **32 casos** (C4).

**Nada más.** No se tocó `cierre-factura.tsx`, ni `cierre-detalle-shared.tsx`, ni `CascadaDinero`,
ni el test de la 395, ni `DineroIdentidadesEnPantalla` (E2: pasa **sin modificarse**), ni
`feature_list.json`, ni `progress/current.md`.

### Por qué el componente NO estrena archivo

Podría haber vivido en un `DesglosePorTiendaCierre.tsx` propio. **Se descartó**: `CascadasCierreMensajero.tsx`
ya está en el **censo de pantallas de dinero** (`DineroIdentidadesEnPantalla`, 16 rutas, número que
es una FOTO a propósito), y estrenar archivo habría obligado a **modificar ese test** — que es
justo lo que la tarea **E2** prohíbe. Y el desglose no es una pantalla nueva: es la misma cuenta
del mismo cierre, un nivel más abajo.

---

## Ni una operación aritmética (R14)

El componente **no suma, no resta, no redondea, no convierte y no reordena**. Las tres cifras de
cada tienda llegan **ya derivadas** y la lista **ya ordenada por el servidor** (R8: por lo que se
le paga, de mayor a menor, con su desempate declarado).

Lo único que se cuenta es **cuántos elementos trae la lista** (`partesPorTienda.length >= 2`), que
es un **cardinal**, no un importe.

Hay **dos guardias de fuente** sobre esto, y la segunda es nueva:

- `Number(`, `parseFloat(`, `parseInt(`, `.toFixed(` — la de siempre, sobre el componente y sobre
  el archivo de rótulos.
- **`.sort(`, `.reverse(`, `localeCompare(`** — ordenar en el navegador exige **comparar
  importes**, y comparar importes en el navegador es exactamente lo que R14 prohíbe.

---

## Mapa `R<n>` → test

De los 27 requisitos, **esta tanda cubre 8** (los de pantalla del detalle del mensajero). Los
demás son de la tanda de servidor —ya cubiertos, ver `progress/impl_396.md`— o de bodega.

| R | Test que lo cubre (todos en `tests/components/CierreMensajeroDesglosePorTienda.test.tsx`) |
| --- | --- |
| **R1** | «está junto a "Pago a tienda" y junto a "Gana la tienda", y dice DOS» · «con TRES tiendas la marca dice tres, no un plural genérico» |
| **R2** | «ni el desglose, ni la marca, ni un rótulo por tienda» · «las tres cascadas de la 395 siguen exactamente como estaban» |
| **R3** | el archivo **importa las constantes**; los textos se afirman contra literales escritos a mano, nunca contra la constante que los genera |
| **R4** | «las dos tiendas salen, cada una en su propia región…» · «las SEIS cifras se leen tal cual, escritas a mano» · «en Norte las dos cifras de pago DIFIEREN, y en Sur coinciden» |
| **R5** | «dentro de la región de cada tienda se leen exactamente tres importes» |
| **R9** | los tres casos del bloque «la tienda que sólo trajo rechazos entra, y cuenta» |
| **R17** | «con dos tiendas, la nota está» · «y esos dos importes siguen agregados, en la cascada de Ordenex» |
| **R26** | «`CierreDiaModule` no monta las cascadas ni nombra un solo rótulo del desglose» |

Y además, aunque el servidor ya los tenga atados, **se comprueban leídos DEL DOM** —que es donde
el humano se confundió—: **R8** (el orden que llega es el que se pinta), **R10/R11/R12** (la suma
de lo pintado por tienda ES el agregado pintado, al céntimo) y **R22/C2** (los cinco rótulos de
dinero de la pantalla son cinco textos distintos).

**Los importes son los de la captura del humano**, partidos en dos tiendas: 285.275,00 ·
70.946,67 · 60.098,67 · 10.848,00 · 225.176,33 · 214.328,33 se reparten entre «Tienda Norte»
(que **sí** tuvo un rechazo) y «Tienda Sur» (que **no**). Deliberado: si las dos tuvieran rechazos,
o ninguna, la diferencia entre «Se le paga hoy» y «Gana en total» sería la misma en las dos y una
derivación con el subconjunto equivocado pasaría desapercibida.

---

## Mutaciones (E3) — 9 aplicadas, **9 muertas**, más un CONTROL NEGATIVO

Arnés en el scratchpad de la sesión (un solo uso, no va al repo). **Autocomprueba cuatro cosas**
antes de dar un veredicto, porque en este repo ya hubo uno que reportó «9/9 supervivientes» dos
veces sin haber ejecutado un test:

1. el texto a sustituir **existe y aparece exactamente una vez** (si no, aborta);
2. el archivo **cambió en disco** después de escribir (se relee y se compara);
3. vitest **ejecutó tests de verdad** (se lee el contador `Tests  N passed/failed` de la salida);
4. el archivo **se restauró**, y si no volvió a su contenido original el arnés **para**.

Cada corrida ejecuta los **tres** archivos de test de esta pantalla: el nuevo, el de la 395 y el
censo de identidades (**91 tests**).

### Salida real

```
[M-A] el desglose aparece tambien con UNA sola tienda (R2)
      MUERTA  exit=1  Test Files 1 failed | 2 passed (3)   Tests 1 failed | 90 passed (91)
      rojo: «R2 — ni el desglose, ni la marca, ni un rótulo por tienda»

[M-B] las dos cifras de pago se rotulan IGUAL (C2/M13)
      MUERTA  exit=1  Test Files 1 failed | 2 passed (3)   Tests 11 failed | 80 passed (91)
      rojos: «las SEIS cifras se leen tal cual, escritas a mano»
             «en Norte las dos cifras de pago DIFIEREN, y en Sur coinciden: son dos preguntas»
             «lo que se le paga a cada tienda suma el "Pago a tienda" del cierre»
             «lo que gana cada tienda suma el "Gana la tienda" del cierre»

[M-C] se pinta SOLO una de las dos cifras de pago por tienda (R4)
      MUERTA  exit=1  Test Files 1 failed | 2 passed (3)   Tests 8 failed | 83 passed (91)
      rojos: «las SEIS cifras se leen tal cual, escritas a mano»
             «R5 — dentro de la región de cada tienda se leen exactamente tres importes»

[M-D] el componente REORDENA en vez de pintar lo que llega (R8)
      MUERTA  exit=1  Test Files 1 failed | 2 passed (3)   Tests 4 failed | 87 passed (91)
      rojos: «un desglose que llega de menor a mayor se pinta de menor a mayor»
             «el componente tampoco ORDENA el desglose: eso lo hizo el servidor»
             «dos tiendas HOMÓNIMAS no se funden en una»

[M-E] el importe pasa por `Number` antes de pintarse (R14)
      MUERTA  exit=1  Test Files 2 failed | 1 passed (3)   Tests 2 failed | 89 passed (91)
      rojos: «396 — CascadasCierreMensajero.tsx no convierte ni un importe a número»
             «395 — CascadasCierreMensajero.tsx no convierte ni un importe a número»

[M-F] «Pago a tienda» deja de decir que es un total de varias tiendas (R1)
      MUERTA  exit=1  Test Files 1 failed | 2 passed (3)   Tests 3 failed | 88 passed (91)
      rojos: «está junto a "Pago a tienda" y junto a "Gana la tienda", y dice DOS»
             «con TRES tiendas la marca dice tres, no un plural genérico»

[M-G] desaparece la nota de lo que NO está repartido (R17)
      MUERTA  exit=1  Test Files 1 failed | 2 passed (3)   Tests 1 failed | 90 passed (91)
      rojo: «R17 — con dos tiendas, la nota está»

[M-H] un `ganaLaTienda` NEGATIVO se recorta a cero (R9)
      MUERTA  exit=1  Test Files 1 failed | 2 passed (3)   Tests 3 failed | 88 passed (91)
      rojos: «aparece con recaudado en cero y lo que gana NEGATIVO, con su signo»
             «el negativo va en el tono de atención, y no como un fallo de la pantalla»

[M-I] las dos cifras de pago se CRUZAN (se pinta lo que gana donde va lo que se le paga)
      MUERTA  exit=1  Test Files 1 failed | 2 passed (3)   Tests 5 failed | 86 passed (91)
      rojos: «las SEIS cifras se leen tal cual, escritas a mano»
             «lo que se le paga a cada tienda suma el "Pago a tienda" del cierre»

[CONTROL] cambia un COMENTARIO (no debe romper nada)
      SOBREVIVIÓ  exit=0  Test Files 3 passed (3)  Tests 91 passed (91)   ← lo correcto
```

**Por qué el control importa:** sin él, «9/9 muertas» podría ser un arnés que dice siempre lo
mismo. El control cambia una línea de comentario, corre **los mismos 91 tests** y sale **verde** —
o sea que el rojo de las otras nueve lo produjo el cambio de comportamiento, no el guion.

**Las cuatro que el encargo pedía nombradas están todas:** M-A (una sola tienda), M-B y M-C
(rótulos confundibles / una sola cifra), M-D (reordenar) y M-E (`Number`).

### Mutaciones del spec que NO corresponden a esta tanda

`M14`, `M15` y `M16` (los tres puntos de llamada) son de la **tanda D, bodega**. No se corrieron y
**no se dan por cubiertas**. `M11`, `M12` y `M13` del spec **sí** están, como M-A, el censo de
`CierreDiaModule` y M-B.

---

## Verificación

```
pnpm run typecheck   → verde, sin salida (tsc --noEmit)
pnpm run lint        → 0 errores, 175 warnings — el MISMO número que la tanda de servidor.
                       Ninguno en los archivos de esta tanda; el único de `CierresAdminModule`
                       (`money` sin usar, línea 71) es PREEXISTENTE: está en HEAD, línea 68, y
                       sólo se movió tres líneas por mis imports.

pnpm exec vitest run tests/components/CierreMensajeroDesglosePorTienda.test.tsx
  → Test Files 1 passed (1) · Tests 32 passed (32)

pnpm exec vitest run tests/components/CierreMensajeroDetalleCascadas.test.tsx \
                     tests/components/DineroIdentidadesEnPantalla.test.tsx
  → Test Files 2 passed (2) · Tests 59 passed (59)   ← los dos, SIN modificar (E2)

pnpm exec vitest related --run CascadasCierreMensajero.tsx cierre-labels.ts CierresAdminModule.tsx
  → Test Files 111 passed (111) · Tests 1673 passed (1673)
```

### El gate

**`./init.sh --rapido` se negó solo**, como estaba previsto: el diff toca archivos con nombre de
dinero. El log va commiteado entero en `progress/gate_396_frontend_rapido.log`:

```
✓ feature_list.json: sin ids duplicados (394 fichas), cupo por zona respetado (in_progress=1)…
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    app/(app)/cierres-admin/_components/CascadasCierreMensajero.tsx
    app/(app)/cierres-admin/_components/CierresAdminModule.tsx
    app/(app)/cierres-admin/_components/cierre-labels.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

**`./init.sh` completo — VERDE.** El `INIT_EXIT` está escrito **dentro** del log (no es el exit
code que reporta el shell, que un `echo` puede tapar) y el log se leyó **sin `tail`**:

```
 Test Files  1825 passed (1825)
      Tests  26237 passed | 26 skipped (26263)
   Duration  631.86s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1825 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped` son 26, que es el número conocido**, y se miraron uno a uno en vez de dar por
bueno el `INIT_EXIT`: `AnaliticaPage.test.tsx` (17, línea 1086) y `AnaliticaShell.test.tsx` (9,
línea 8987). **Ni uno solo de `integration/db`** — el `.env` estaba puesto.

Comprobado en el log, línea a línea:

```
línea  4415:  ✓ tests/components/CierreMensajeroDesglosePorTienda.test.tsx (32 tests) 5449ms
línea  4443:  ✓ tests/components/CierreMensajeroDetalleCascadas.test.tsx (29 tests) 5420ms   ← la 395, sin tocar
línea  7808:  ✓ tests/components/DineroIdentidadesEnPantalla.test.tsx (30 tests) 1923ms      ← E2, sin tocar
línea 10244:  ✓ tests/integration/recuperar-contrasena-form.test.tsx (11 tests) 7916ms       ← el frágil, VERDE
```

El aviso de las **tres migraciones sin `down.sql`** es **preexistente y ajeno**: son de las rutas
optimizadas (agosto), y esta tanda **no toca `db/`**.

⚠️ **El log del gate completo NO va commiteado: pesa 982 KB** (11.950 líneas), frente a los 17 KB
de los precedentes del repo (`gate_279_*.log`). La evidencia es lo pegado arriba, con el número de
línea de donde sale cada cosa.

---

## Notas para quien siga

1. **La tanda D (BODEGA) no está hecha y no se tocó nada suyo.** Lo que necesita de aquí ya está:
   los **siete rótulos** viven en el módulo PURO y `DesglosePorTienda` es una función local de
   `CascadasCierreMensajero.tsx`. Para R22 —mismo componente en las tres superficies— habrá que
   **exportarla** (o sacarla a un archivo propio, y entonces sí tocará el censo de
   `DineroIdentidadesEnPantalla`, que hoy pasa sin modificarse). **Decidirlo ahí, no aquí.**
2. **El umbral de bodega es por NIVEL**, no el mismo que aquí: el del nivel-mensajero se evalúa
   sobre las tiendas **de ese mensajero** (`design.md §8.1`). El de esta pantalla es
   `partesPorTienda.length >= 2` y ya está.
3. **`tests/integration/recuperar-contrasena-form.test.tsx` es frágil bajo carga** y no tiene nada
   que ver con esta tanda. Si sale rojo en el gate, aislarlo antes de atribuírselo a nadie, y **no
   meterlo en `tests/baseline-rojos.json`**.
4. El arnés de mutaciones vive en el scratchpad de la sesión, **no en el repo**: es de un solo uso
   y su evidencia es la salida pegada arriba.

---

## Veredicto

**Hecha la pantalla del detalle del cierre de MENSAJERO: con dos o más tiendas dice que «Pago a
tienda» y «Gana la tienda» son un total de N tiendas y las desglosa con tres cifras cada una, con
una sola no cambia ni un píxel, y sin que el navegador sume, ordene ni convierta un solo importe —
9 mutaciones muertas y un control negativo que sobrevive.**
