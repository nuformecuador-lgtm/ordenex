# impl_396 · BODEGA — la PANTALLA del cierre de bodega (tandas D2 y D3)

## Lo primero, porque cambia cómo se lee todo lo demás

**El dinero está BIEN. Esto es presentación, no una corrección de dinero.** La wallet
(`wallet_tienda_movimiento`) lleva los movimientos **separados por tienda** desde siempre, cada uno
con sus propias cifras: **a nadie se le paga mal**, y esta tanda **no toca ni una fila del ledger,
ni el servidor, ni `lib/`, ni el esquema**. El diff es de **tres archivos de pantalla y tres de
test**.

Lo que faltaba es que la pantalla dijera **de quién es cada parte** de un total que ya era correcto
como total. En bodega el defecto era el peor de los tres: «Para la tienda» agrega **N mensajeros ×
M tiendas** en un solo número, **en sus dos niveles**, y no lo decía en ninguna parte.

## Alcance de ESTA bitácora

Las tandas **D2** y **D3** de `specs/396-desglose-por-tienda-en-cierres/tasks.md`: la mitad de
pantalla del cierre de BODEGA, en sus dos niveles. Es la **última pieza** de la ficha.

**No se tocó `lib/`, ni `db/`, ni el servidor, ni ningún archivo `*descarga-columnas*` (R27), ni
`CierreDiaModule.tsx` (R26), ni `cierre-factura.tsx`, ni `feature_list.json`, ni
`progress/current.md`, ni `tests/baseline-rojos.json`.**

---

## Cómo queda cada uno de los DOS niveles

`/cierres-admin` → pestaña de bodega → abrir un cierre. Dentro del modal:

### Nivel AGREGADO (toda la bodega)

```
┌ Lo que va a la central ────────────────────────────────┐   ← 393, intacta
└────────────────────────────────────────────────────────┘

┌ De quién es el dinero ─────────────────────────────────┐   ← 393, intacta salvo UNA nota
│  Total general                           ₡126.089,17   │
│  − Flete + IVA                            ₡23.000,33   │
│  − Comisión + IVA                          ₡4.134,50   │
│  ══════════════════════════════════════════════════    │
│  Para la tienda                           ₡98.954,34   │
│    · Es el total de las 3 tiendas de este cierre,       │   ← 396 · R1 (LA MARCA)
│      sumadas. Abajo, cuánto le toca a cada una.         │
│  … (la línea puente, el flete por rechazo, el neto)     │
└────────────────────────────────────────────────────────┘

  De qué tienda es cada parte                                ← 396 · EL DESGLOSE
    «Se le paga hoy» y «Gana en total» no son la misma cifra…
    El pago al mensajero y el ingreso de bodega por rechazos       ← R17
    son del cierre completo: no están repartidos entre las tiendas.

    ┌ Tienda Norte ────────────┐ ┌ Tienda Sur ──────────┐ ┌ Tienda Este ─────────┐
    │ Recaudado    ₡76.089,17  │ │ Recaudado  ₡30.000   │ │ Recaudado  ₡20.000   │
    │ Se le paga hoy ₡60.454,59│ │ …          ₡22.499,75│ │ …          ₡16.000   │
    │ Gana en total  ₡59.953,84│ │ …          ₡22.499,75│ │ …          ₡16.000   │
    └──────────────────────────┘ └──────────────────────┘ └──────────────────────┘

┌ Ingreso de Ordenex del cierre de bodega ───────────────┐   ← sin cambios
```

### Nivel POR MENSAJERO (uno por cada `cierre_dia` incluido)

Exactamente lo mismo, **dentro de la sección de ese mensajero** y con **SUS** tiendas: la marca en
su «Para la tienda» y el desglose pegado debajo de su cascada, antes de su panel de ingreso por
concepto. Los nombres accesibles llevan el del mensajero.

**Con una sola tienda en un nivel, ese nivel se queda EXACTAMENTE como estaba** (R2/Q5): ni marca,
ni título, ni notas, ni una cascada. Y **cada nivel decide por su cuenta** (ver las tres trampas).

---

## Las TRES trampas del encargo, y qué se hizo con cada una

### 1 · LOS UMBRALES SON TRES Y SON DISTINTOS

El del nivel-mensajero se evalúa sobre **las tiendas de ESE mensajero** —`cierreDia.partesPorTienda`
(`CierresBodegaAdminModule.tsx:783`)—, y el del agregado sobre las de toda la bodega
(`:554`). **Son dos listas distintas y nunca se cruzan.**

Y no se dejó al cuidado de nadie: la cuenta la hace **una sola función**,
`marcaDeVariasTiendas(partes)`, que vive en el componente compartido y devuelve **la marca o
`null`**. De ahí salen **las dos cosas que tienen que ir juntas**: la nota de la cascada y el
desglose de abajo. Escritas por separado, el primer `>= 2` que alguien tocara dejaría una pantalla
diciendo «es el total de 2 tiendas» sin enseñar ninguna.

El caso que los separa —dos mensajeros con **una tienda cada uno**— tiene su propio bloque de tests
(ningún nivel de mensajero se desglosa, el agregado sí) y su mutación, **M1**, que es la primera del
arnés.

### 2 · EL NOMBRE ACCESIBLE TIENE QUE SER ÚNICO EN EL MODAL

El nombre de la tienda **no basta**, y no es teórico: el servidor agrupa por el `tiendaId` congelado
justamente para que **dos homónimas no se fundan** (R7, con test contra Postgres real). Además, el
modal de bodega monta el desglose **una vez por mensajero más una para el agregado**, así que la
misma tienda sale varias veces a propósito.

El nombre lo construye `nombreAccesibleDeTienda` (en el módulo PURO de textos, R3) con **dos**
discriminantes: la **posición en su nivel** —«Tienda Norte (1 de 3)»— y el **contexto** —«· cierre de
bodega» o «· Ana Mensajera»—. El nombre **visible** no cambia: sigue siendo sólo el de la tienda.

⚠️ **Esto CORRIGE una decisión de la tanda C** (`impl_396_frontend.md`, decisión 5: «dos tiendas
homónimas se leen igual porque se ven igual»). **La decisión de cambiarla es mía**, y el motivo es
que quien navega por landmarks **no las ve**: oye «Mi Tienda» dos veces sin forma de saber cuál trae
₡40.000. Su test **no se debilitó**: se le añadió un caso que afirma **más** (los dos nombres, a
mano, y que son distintos) y su helper de búsqueda pasó a exigir los dos extremos del nombre.

### 3 · EL COMPONENTE COMPARTIDO — decisión mía, y su precio pagado a sabiendas

`DesglosePorTienda` era una **función local** de `CascadasCierreMensajero.tsx`. **Sale a archivo
propio**: `app/(app)/cierres-admin/_components/DesglosePorTienda.tsx` (157 líneas), y con él
`lineasDeTienda` y el umbral.

**Por qué, y no por comodidad:** R22 pide «el mismo componente» en las TRES superficies. Un
componente compartido que vive **dentro de una de ellas** lo cumple de casualidad: el detalle de
bodega renderizaría desde un archivo llamado como otra pantalla, y quien un día editara aquél no
tendría ninguna señal de que está tocando el modal de bodega.

**El precio es el censo de `tests/components/DineroIdentidadesEnPantalla.test.tsx`, y se paga:**
16 → **17**, con su identidad declarada. Ese censo existe para que **una pantalla de dinero nueva se
declare en vez de colarse**; esconder el componente dentro de un archivo ya censado para no tocar el
número sería **usar la guardia al revés**. El número sigue siendo una foto, sólo que de hoy.

**Y la cobertura no se perdió al mudarse:** las dos guardias de fuente que la tanda C tenía sobre
`CascadasCierreMensajero.tsx` (sin `Number(`/`parseFloat(`/`parseInt(`/`.toFixed(`, y sin
`.sort(`/`.reverse(`/`localeCompare(`) **siguen al archivo**, y además se repiten en el test de
bodega sobre el módulo de bodega. La guardia de R26 sobre `CierreDiaModule` gana el nombre nuevo.

---

## ⚠️ HALLAZGO — algo del spec que NO es cierto al mirarlo, y cambia lo que la pantalla puede decir

**En el cierre de bodega NO existe una línea «Gana la tienda», así que el desglose sólo puede marcar
UNA de las dos cifras agregadas.**

El encargo pedía —con razón, y es lo que hizo la tanda C— marcar **las dos**, «porque marcar una
diría por omisión que la otra es de una tienda». En bodega **la otra no está en pantalla**:

- La cascada «De quién es el dinero» del cierre de bodega (ficha 393) es una cadena de tres cuentas
  que termina en «Neto de Ordenex». El `ganaLaTienda` agregado —que **D1 sí emite en los dos
  niveles**— no tiene línea propia.
- Meterla exigiría ponerla **entre «Lo que Ordenex facturó» y sus restas**, donde se leería como si
  esas restas se le aplicaran a ella. Hacerlo bien pediría partir esa cascada en tres, como en el
  detalle del mensajero: **eso es rediseñar una superficie ya entregada**, no el arreglo mínimo que
  esta ficha es. «Arreglar lo evidenciado, no rediseñar.»

**Decisión mía:** la marca va **sólo** en «Para la tienda» —la única cifra en pantalla cuyo rótulo
nombra «la tienda» **en singular** y por tanto la única que, sola, se lee como si fuera de una—. Hay
test de que **«Total general» no se marca**, por el mismo criterio con el que la tanda C no lo marcó.

**Consecuencia medida, y va dicha porque afecta a un test:** la columna «Gana en total» del desglose
suma hacia un agregado que **viaja en el DTO pero no está en el DOM de bodega**. Su test de identidad
(R11) compara la suma de lo pintado contra **el literal escrito a mano** `₡98.453,59` —el contrato
del spec— en vez de contra una cifra leída de la pantalla; queda dicho en el propio test. El campo no
sobra: es lo que hace comprobable R11 en el servidor (test de la tanda D1) y lo que deja la línea
lista si algún día alguien decide partir esa cascada.

### Otras dos cosas menores, dichas por si valen más que el arreglo

1. **`DESGLOSE_NO_REPARTIDO_NOTA` habla de «el ingreso de bodega por rechazos»**, que en la pantalla
   de bodega se rotula **«Gana la bodega satélite»** (la 393 lo renombró ahí a propósito, R25). Se
   reusó tal cual —el encargo prohíbe estrenar vocabulario nuevo para lo mismo, y es la misma frase
   que lee el detalle del mensajero (R22)—, pero la costura existe y alguien puede querer pulirla.
2. **Pre-existente, no introducido aquí:** si un cierre de bodega llevara **dos `cierre_dia` del
   MISMO mensajero**, todos los nombres accesibles de ese nivel colisionarían — las dos cascadas de
   la 393 ya lo hacen, porque el discriminante es `mensajeroNombre`. El desglose hereda la misma
   convención por coherencia (R22) en vez de estrenar otra. Con los cardinales medidos (máx. 2
   mensajeros) no ha pasado; el arreglo sería del nivel entero, no del desglose.

Lo que el spec afirma de la pantalla de bodega **y sí es cierto** (verificado en disco, 2026-09-08):
`CierresBodegaAdminModule` monta `CascadaDinero` dos veces por nivel; `lineasCascadaDueno` es la que
pinta `pagoTienda` con `PARA_LA_TIENDA_LABEL`; y los siete rótulos de la tanda C están en el módulo
PURO y se heredan sin tocar ni uno. Las **líneas** de `tasks.md § D2` (`:666-690` y `:728-751`) ya no
valen tras el merge de D1: hoy son `:735` y `:817`.

---

## Archivos tocados

### Producción (4, una de ellas NUEVA)

| archivo | qué |
| --- | --- |
| **`app/(app)/cierres-admin/_components/DesglosePorTienda.tsx`** (NUEVO) | El desglose, `lineasDeTienda` y `marcaDeVariasTiendas` —el umbral— para las TRES superficies. Sale de `CascadasCierreMensajero.tsx` sin cambiar lo que pinta, salvo el nombre accesible |
| `app/(app)/cierres-admin/_components/cierre-labels.ts` | **Un** añadido: `nombreAccesibleDeTienda`. **Ni un rótulo existente cambia** (R18) |
| `app/(app)/cierres-admin/_components/CascadasCierreMensajero.tsx` | Consume el archivo nuevo; el umbral pasa a ser la función compartida. **Lo que ve el usuario no cambia**, salvo el nombre accesible de cada cascada de tienda |
| `app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx` | D2: `partesPorTienda` en `DetalleAbierto`, la marca en `lineasCascadaDueno` y el desglose en **los dos niveles**, cada uno con SU lista |

### Tests (1 nuevo, 2 tocados)

- **`tests/components/CierreBodegaDesglosePorTienda.test.tsx`** (NUEVO) — **33 casos** (D3).
- `tests/components/CierreMensajeroDesglosePorTienda.test.tsx` — el helper de búsqueda, **un caso
  nuevo** (los nombres accesibles no se repiten), y las dos guardias de fuente siguiendo al archivo.
  32 → **34**. **Ni una aserción se debilitó.**
- `tests/components/DineroIdentidadesEnPantalla.test.tsx` — el censo, 16 → **17**. Ninguna otra
  línea cambia; sus 30 casos siguen siendo los mismos.

**`tests/components/CierreBodegaDetalleCascadas.test.tsx` (393) NO se tocó y pasa igual** (17 casos):
su fixture trae `partesPorTienda: []`, así que su pantalla es la de antes, byte a byte.

### Ni una operación aritmética (R14)

El componente **no suma, no resta, no redondea, no convierte y no reordena**. Las tres cifras de cada
tienda llegan ya derivadas y la lista **ya ordenada por el servidor** (R8). Lo único que se cuenta es
la **longitud** de la lista, que es un cardinal. El único `+ 1` del cambio es el **ordinal de una
frase** y vive en el módulo de textos, no en el componente.

---

## Mapa `R<n>` → test

Todos en `tests/components/CierreBodegaDesglosePorTienda.test.tsx` salvo donde se diga.

| R | Test que lo cubre |
| --- | --- |
| **R1** | «cada nivel dice SU número: tres en la bodega, dos en cada mensajero» · «la marca está pegada a "Para la tienda" y NO a ninguna otra línea» |
| **R2** | «con UNA sola tienda en toda la bodega no aparece NADA nuevo, en ningún nivel» · «las cascadas de esos dos mensajeros quedan EXACTAMENTE como estaban» |
| **R3** | el archivo importa las constantes; los textos se afirman contra **literales escritos a mano**, nunca contra la constante que los genera |
| **R4** | «el AGREGADO trae las TRES tiendas con sus NUEVE cifras, escritas a mano» · «cada MENSAJERO trae SUS tiendas» |
| **R5** | «dentro de la región de cada tienda se leen exactamente tres importes, en los dos niveles» |
| **R8** | «un desglose agregado que llega de menor a mayor se pinta de menor a mayor» + la guardia de fuente `.sort(`/`.reverse(`/`localeCompare(` |
| **R10** | «lo que se le paga a cada tienda suma el "Para la tienda" de toda la bodega» · «y en el nivel de CADA MENSAJERO la suma es la de SU propio agregado» |
| **R11** | «lo que gana cada tienda suma el agregado del contrato, que esta pantalla NO pinta» (ver el hallazgo) |
| **R12** | «lo recaudado por cada tienda suma el "Total general" de toda la bodega» |
| **R14** | las dos guardias de fuente sobre `DesglosePorTienda.tsx` y `CierresBodegaAdminModule.tsx` |
| **R16** | «y esos dos importes NO aparecen dentro de ninguna tienda» |
| **R17** | «las dos notas de cabecera están en los tres desgloses» |
| **R18** | «las dos cascadas de la 393 siguen diciendo lo mismo, en los dos niveles» · y `CierreBodegaDetalleCascadas.test.tsx` pasa **sin tocarse** |
| **R19** | «⚠️ dos mensajeros con UNA tienda cada uno: ninguno se desglosa y el agregado SÍ» · «cada MENSAJERO trae SUS tiendas» · mutación **M1** |
| **R20** | «Norte está en los dos niveles de mensajero y en el agregado es UNA fila» (Q8: tres tiendas, no cuatro filas) |
| **R21** | mutación **M6**: derivar el agregado del desglose de un mensajero pone en rojo diez casos |
| **R22** | «los tres rótulos por tienda son los mismos textos aprobados, también aquí» · «los cinco rótulos que nombran a la tienda son cinco textos distintos» · y el mismo archivo lo montan las tres superficies |
| **R24/R34 (393)** | «con las tres tiendas pintadas, las cinco cifras sueltas siguen sin aparecer» — la guardia de la 393 **nunca había visto** esta pantalla con el desglose puesto |
| **R26** | `CierreMensajeroDesglosePorTienda.test.tsx` › el censo de `CierreDiaModule`, ahora también con el nombre del componente nuevo |
| **R27** | el diff no contiene ningún archivo `*descarga-columnas*` (comprobado) |
| **R9** | cubierto por el MISMO componente en `CierreMensajeroDesglosePorTienda.test.tsx` (negativo con su signo y en tono de atención). No se re-testea aquí: es la misma función, y las mutaciones M3/M4/M8 lo ponen en rojo desde allí. Dicho como es, no contado dos veces |

**Los nombres accesibles** llevan además tres casos propios: ninguna región del modal se anuncia
igual que otra, la misma tienda en dos niveles se anuncia distinto, y dos homónimas **no se funden Y
no comparten nombre**.

---

## Mutaciones — 8 aplicadas, **8 muertas**, más un CONTROL NEGATIVO que SOBREVIVE

Arnés en el scratchpad de la sesión (un solo uso, no va al repo). **Autocomprueba cuatro cosas**
antes de dar un veredicto, porque en este repo ya hubo uno que reportó «9/9 supervivientes» dos veces
sin haber ejecutado un test:

1. el texto a sustituir **existe y aparece exactamente una vez** (si no, aborta);
2. el archivo **cambió en disco** después de escribir (se relee y se compara);
3. vitest **ejecutó tests de verdad** (se lee el contador `Tests  N passed/failed`); sin contador el
   resultado se marca **INVÁLIDO**, nunca «muerta»;
4. el archivo **se restauró** byte a byte, y si no, el arnés **para**.

Cada corrida ejecuta los **mismos 4 archivos · 114 tests** (el nuevo de bodega, el del mensajero, el
de las cascadas de la 393 y el censo de identidades). Línea base medida antes de empezar:
`Test Files 4 passed (4) · Tests 114 passed (114)`.

### Salida real

```
[M1] el umbral del nivel-mensajero se evalua sobre las tiendas de TODA LA BODEGA
     MUERTA  exit=1  Test Files 1 failed | 3 passed (4)  Tests 2 failed | 112 passed (114)
     rojos: «dos mensajeros con UNA tienda cada uno: ninguno se desglosa y el agregado SÍ»
            «cada nivel dice SU número: tres en la bodega, dos en cada mensajero»

[M2] el desglose aparece tambien con UNA sola tienda
     MUERTA  exit=1  Test Files 2 failed | 2 passed (4)  Tests 3 failed | 111 passed (114)
     rojos: «ni el desglose, ni la marca, ni un rótulo por tienda»   ← el del MENSAJERO
            «dos mensajeros con UNA tienda cada uno: ninguno se desglosa y el agregado SÍ»
            «con UNA sola tienda en toda la bodega no aparece NADA nuevo, en ningún nivel»

[M3] las dos cifras de pago por tienda se rotulan IGUAL (confundibles)
     MUERTA  exit=1  Test Files 2 failed | 2 passed (4)  Tests 19 failed | 95 passed (114)
     rojos: «las SEIS cifras se leen tal cual, escritas a mano»
            «en Norte las dos cifras de pago DIFIEREN, y en Sur coinciden: son dos preguntas»
            «lo que se le paga a cada tienda suma el "Pago a tienda" del cierre»
            «lo que gana cada tienda suma el "Gana la tienda" del cierre»

[M4] se pinta SOLO una de las dos cifras de pago por tienda
     MUERTA  exit=1  Test Files 2 failed | 2 passed (4)  Tests 17 failed | 97 passed (114)
     rojos: «dentro de la región de cada tienda se leen exactamente tres importes»
            «las dos cifras de pago SE PINTAN LAS DOS: ninguna tienda enseña una sola»

[M5] dos tiendas homonimas COMPARTEN nombre accesible (se cae el discriminante)
     MUERTA  exit=1  Test Files 2 failed | 2 passed (4)  Tests 34 failed | 80 passed (114)
     rojos: «las dos tiendas salen, cada una en su propia región con nombre accesible»
            «el AGREGADO trae las TRES tiendas con sus NUEVE cifras, escritas a mano (R20)»
            «cada MENSAJERO trae SUS tiendas, y no las del otro ni las del agregado (R19)»

[M6] el desglose AGREGADO se pinta con el del PRIMER mensajero (R21: un nivel derivado de otro)
     MUERTA  exit=1  Test Files 1 failed | 3 passed (4)  Tests 10 failed | 104 passed (114)
     rojos: «el AGREGADO trae las TRES tiendas con sus NUEVE cifras, escritas a mano (R20)»
            «Norte está en los dos niveles de mensajero y en el agregado es UNA fila»
            «lo que se le paga a cada tienda suma el "Para la tienda" de toda la bodega»

[M7] la marca desaparece de la linea «Para la tienda» (R1)
     MUERTA  exit=1  Test Files 1 failed | 3 passed (4)  Tests 3 failed | 111 passed (114)
     rojos: «cada nivel dice SU número: tres en la bodega, dos en cada mensajero»
            «la marca está pegada a "Para la tienda" y NO a ninguna otra línea de la cascada»

[M8] el desglose reusa «Pago a tienda» —el rotulo del AGREGADO— para la cifra de UNA tienda
     MUERTA  exit=1  Test Files 2 failed | 2 passed (4)  Tests 16 failed | 98 passed (114)
     rojos: «las SEIS cifras se leen tal cual, escritas a mano»
            «las dos cifras de pago SE PINTAN LAS DOS: ninguna tienda enseña una sola»
            «salen dos cascadas, cada una con su propio dinero»

[CONTROL] cambia un COMENTARIO (no debe romper nada)
     SOBREVIVIÓ  exit=0  Test Files 4 passed (4)  Tests 114 passed (114)   ← lo correcto
```

**Las cuatro que el encargo pedía nombradas están todas:** M1 (el umbral del nivel-mensajero sobre
las tiendas de la bodega), M2 (el desglose con una sola tienda), M3/M4/M8 (rótulos confundibles, una
sola cifra, y reusar el rótulo del agregado) y M5 (dos homónimas comparten nombre accesible).

**Por qué el control importa:** sin él, «8/8 muertas» podría ser un arnés que dice siempre lo mismo.
El control cambia una línea de **comentario**, corre **los mismos 114 tests** y sale **verde** — o
sea que el rojo de las otras ocho lo produjo el cambio de comportamiento, no el guion.

**Comprobación focalizada de M8:** el arnés recorta la lista de rojos a seis, y el caso NUEVO podía
quedar tapado. Se repitió M8 sólo contra el archivo de bodega, con todos los rojos a la vista:
`Tests 10 failed | 23 passed (33)`, e incluye **«con las tres tiendas pintadas, las cinco cifras
sueltas siguen sin aparecer (R24/R34)»**.

Tras la última mutación el arnés reimprime `git status --short`: el árbol quedó con **exactamente**
los archivos de esta tanda.

---

## Verificación

```
pnpm run typecheck   → verde, sin salida (tsc --noEmit)
pnpm run lint        → 0 errores, 175 warnings — el MISMO número que las tres tandas anteriores.
                       Ninguno en archivos de esta tanda.

pnpm exec vitest run tests/components/CierreBodegaDesglosePorTienda.test.tsx
  → Test Files 1 passed (1) · Tests 33 passed (33)

pnpm exec vitest run tests/components/CierreMensajeroDesglosePorTienda.test.tsx
  → Test Files 1 passed (1) · Tests 34 passed (34)

pnpm exec vitest related --run DesglosePorTienda.tsx CierresBodegaAdminModule.tsx \
      CascadasCierreMensajero.tsx cierre-labels.ts
  → Test Files 112 passed (112) · Tests 1707 passed (1707)
```

### El gate

**`./init.sh --rapido` se negó solo**, como estaba previsto: el diff toca archivos con nombre de
dinero. El log va commiteado entero en `progress/gate_396_bodega_frontend_rapido.log`:

```
✓ feature_list.json: sin ids duplicados (394 fichas), cupo por zona respetado (in_progress=1)…
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    app/(app)/cierres-admin/_components/CascadasCierreMensajero.tsx
    app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx
    app/(app)/cierres-admin/_components/DesglosePorTienda.tsx
    app/(app)/cierres-admin/_components/cierre-labels.ts
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

**`./init.sh` completo — VERDE.** El `INIT_EXIT` está escrito **dentro** del log (no es el exit code
que reporta el shell, que un `echo` puede tapar) y el log se leyó **sin `tail`**:

```
 Test Files  1828 passed (1828)
      Tests  26291 passed | 26 skipped (26317)
   Duration  623.69s

✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1828 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado
                            20260814140000_ruta_parada_tramo
                            20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los `skipped` son 26, que es el número conocido**, y se miraron uno a uno en vez de dar por bueno
el `INIT_EXIT`: `AnaliticaPage.test.tsx` (17, línea 8049) y `AnaliticaShell.test.tsx` (9, línea
9965). **Ni uno solo de `integration/db`** — el `.env` estaba puesto y los tests contra Postgres
corrieron de verdad. Comprobado en el log, línea a línea:

```
línea   442:  ✓ tests/components/CierreBodegaDesglosePorTienda.test.tsx (33 tests) 6893ms
línea  4720:  ✓ tests/components/CierreMensajeroDesglosePorTienda.test.tsx (34 tests) 5781ms
línea  5939:  ✓ tests/components/CierreBodegaDetalleCascadas.test.tsx (17 tests) 4303ms   ← la 393, SIN tocar
línea  8829:  ✓ tests/components/DineroIdentidadesEnPantalla.test.tsx (30 tests) 1815ms   ← el censo, 17
línea  3925:  ✓ tests/components/CierreMensajeroDetalleCascadas.test.tsx (29 tests) 5518ms ← la 395, SIN tocar
línea  8462:  ✓ tests/integration/db/cierre-bodega-desglose-por-tienda-sql-real.test.ts (4 tests) 841ms
línea  9126:  ✓ tests/integration/db/cierre-desglose-por-tienda-sql-real.test.ts (4 tests) 739ms
línea  2075:  ✓ tests/integration/recuperar-contrasena-form.test.tsx (11 tests) 7779ms    ← el frágil, VERDE
```

El aviso de las **tres migraciones sin `down.sql`** es **preexistente y ajeno**: son de las rutas
optimizadas (agosto), y esta tanda **no toca `db/`**.

⚠️ **El log del gate completo NO va commiteado: pesa ~1 MB** (11.880 líneas), frente a los 17 KB de
los precedentes del repo. La evidencia es lo pegado arriba, con el número de línea de donde sale cada
cosa.

### ⚠️ Un rojo intermedio, MEDIDO y descartado: `TableroOperativo.test.tsx`

Hubo **dos** corridas del gate completo, y la **primera salió roja**. Se documenta porque el veredicto
no puede ser «lo corrí hasta que salió verde».

| corrida | árbol | veredicto |
| --- | --- | --- |
| 1 | el final **menos** el caso R24/R34 del archivo de bodega | **ROJO** · 1 test de `tests/components/TableroOperativo.test.tsx` |
| 2 | **el final** | **VERDE** · `TableroOperativo` pasó (50 tests, línea 5928) |

El fallo de la 1 fue `Test timed out in 20000ms` en «el aviso de cobertura declara la penumbra». **No
es mío, y está medido, no razonado:**

- **aislado, 3 de 3 corridas en verde**, 50 tests en **~6,3 s** cada una — contra un tope de 20 s que
  sólo se alcanza bajo saturación;
- **mi diff no toca nada de Analítica**: el archivo lo tocó por última vez la ficha 209, ajena a todo
  esto, y ni él ni el tablero importan nada de cierres;
- en la corrida 2, con el árbol MÁS grande, pasó sin acercarse al tope.

Es la firma exacta del flake de saturación que `tests/baseline-rojos.json` describe. **NO se metió en
`tests/baseline-rojos.json`**: la lista se añade sólo cuando la deuda es de otro, está medida y con su
motivo escrito; un timeout que pasa 4 de 4 veces fuera de la saturación no es deuda de nadie, y
meterlo ahí taparía un rojo real el día que lo hubiera. **El aviso del encargo sobre
`recuperar-contrasena-form.test.tsx` y el conteo de wallet sigue vigente**: los dos salieron verdes
en la corrida final.

---

## Notas para quien siga

1. **La ficha 396 queda entera**: sus tres superficies pintan el desglose con **el mismo componente,
   los mismos siete rótulos y el mismo umbral**, cada una con su lista.
2. **Si algún día se quiere marcar también «lo que gana la tienda» en bodega**, hay que darle línea
   propia, y eso pide partir la cascada de la 393 en tres como en el detalle del mensajero. El dato
   ya viaja (`ganaLaTienda` en los dos niveles, D1): es una decisión de diseño, no de datos.
3. **El umbral vive en `marcaDeVariasTiendas`**, y ahí es donde hay que tocarlo si algún día cambia.
   Está escrito una vez para las tres superficies a propósito.
4. El arnés de mutaciones vive en el scratchpad de la sesión, **no en el repo**: es de un solo uso y
   su evidencia es la salida pegada arriba.

---

## Veredicto

**Hecha la pantalla del cierre de BODEGA en sus DOS niveles: cada uno dice que su «Para la tienda» es
el total de N tiendas —con SU propio número, sobre SUS propias tiendas— y las desglosa con tres
cifras cada una, con una sola tienda no cambia ni un píxel, dos tiendas homónimas ya no se anuncian
igual, y el navegador no suma, ordena ni convierte un solo importe — 8 mutaciones muertas, un control
negativo que sobrevive y el gate completo en verde con `INIT_EXIT=0` leído de dentro del log.**
