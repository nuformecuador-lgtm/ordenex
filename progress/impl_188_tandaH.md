# 184 — Tanda H: guardia, retirada del adaptador y barrido de lo que quedó sin consumidor

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: BACKEND_DEV
>
> Alcance entregado: **H.1** (la guardia R31/R32), **H.2** (retirada de `filasDelConjuntoCompleto`)
> y la decisión escrita sobre las cuatro relecturas sin consumidor y las dos deudas anotadas.
> **H.3** (mapa completo R1..R34 verificado caso a caso) y **H.4** (gate + PR) siguen abiertas.
>
> **Veredicto en una línea: la deuda queda cerrada con candado —el adaptador que la sostenía ya no
> existe y una guardia de 11 casos impide que vuelva por cualquiera de sus cuatro vías—, con 17
> mutaciones ejecutadas, 16 rojas y una verde a propósito, que es la contraprueba; y las cuatro
> relecturas sin consumidor se CONSERVAN, con el precio de borrarlas medido y escrito junto al
> código, no solo aquí.**

---

## 1. La guardia (H.1 · R31/R32)

`tests/unit/descarga/adaptador-conjunto.guardia.test.ts`, **11 casos**, seleccionada por
`pnpm exec vitest run guard` sin estar registrada en ninguna lista (el archivo lleva `guardia` en
el nombre, y el filtro posicional de vitest es por ruta). Medido: la corrida pasa de **61 archivos
/ 830 tests** a **62 / 841**.

### Qué vigila, y por qué no bastaban los dos censos

| Caso | Requisito | Qué afirma |
| --- | --- | --- |
| «el detector distingue una LLAMADA de una mención en prosa, en las dos direcciones» | — | auto-test del detector (§1.2) |
| «el recorrido del árbol lee archivos de verdad, y de los dos tipos» | — | ídem, sobre el recorrido |
| «no queda ninguna llamada al adaptador de relectura bajo app/» | **R32** | cero `filasDelConjuntoCompleto(` en `app/` + `components/` |
| «CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador al que migraron los trece» | **R32** | anti-vacuidad: ≥13 archivos con `filasDesdeResultado(` |
| «el adaptador de relectura ya no existe: no se puede llamar ni por descuido» | **R32** | el export no vuelve; control positivo sobre los dos que sí viven |
| «las tres relecturas que llegaron a cero consumidores siguen en cero» | **R32** | §3 |
| «CONTROL POSITIVO: las lecturas DEDICADAS que las sustituyeron sí se llaman» | **R32** | anti-vacuidad de la anterior |
| «`listarIncidentes` NO está en esa lista, y su consumidor sigue vivo» | **R32** | el aviso de la tanda F, hecho ejecutable |
| «el detector de casos apagados reconoce las formas de apagarlos, y solo esas» | — | auto-test, 10 formas + 5 contraejemplos |
| «los dos censos de adaptador no tienen casos deshabilitados ni pendientes» | **R31** | `.skip`/`.todo`/`.only`/`.skipIf`/`xit` + anclas + nº de casos |
| «los dos censos conservan la MITAD NEGATIVA» | **R31** | no se relaja quitando la mitad que T0.2 añadió |

**Lo que la guardia añade sobre los censos, que era el hueco real:** los dos censos preguntan
**listado por listado**, por los trece que conocen. Una pantalla NUEVA —o una que no esté en el
Anexo III— podía volver al adaptador viejo sin que ningún censo la mirara. La guardia pregunta al
revés: recorre `app/` entero y exige cero, conozca o no la pantalla.

### 1.2 «Verifica que tu guardia REALMENTE corre casos»

El encargo pone delante dos precedentes: el parser que murió en la 172 ante la mutación que
existía para cazar, y las **siete corridas de la tanda F que no arrancaron por un `--reporter`
inexistente y parecían ejecutadas**. Los dos se atendieron, y cada uno con su mecanismo:

1. **El runner no pasa `--reporter`** (usa el default) y **aborta el resumen** si la salida no
   trae un recuento de tests: imprime `!!! SIN RECUENTO: la corrida NO arrancó — NO cuenta como
   mutación`. Se disparó de verdad en la primera pasada, por otro motivo: `subprocess` en Windows
   decodificaba la salida en `cp1252` y reventaba con `UnicodeDecodeError`. Se arregló
   (`encoding="utf-8"`) y se repitió el lote entero. **Ninguna mutación de esta bitácora se cuenta
   sin su recuento pegado.**
2. **Cada detector de la guardia se prueba contra un texto sintético con la respuesta conocida, en
   las dos direcciones**, y cada escaneo del árbol lleva su control positivo. No es adorno: bajo
   **MH9, MH10 y MH11** —las tres mutaciones que rompen el detector, la regex de llamada y el
   recorrido del árbol— el caso principal de R32 **PASA VERDE**, porque no encuentra el patrón por
   no encontrar nada. Lo que las mata son exactamente los auto-tests y los controles positivos.
   Sin ellos, esta guardia habría sido un adorno permanente y no lo habría dicho nadie.
3. **Se comprobó que los 11 casos corren y con qué nombre**, no solo que «pasa»:

```
$ pnpm exec vitest run tests/unit/descarga/adaptador-conjunto.guardia.test.ts --reporter=verbose
 ✓ … > el detector distingue una LLAMADA de una mención en prosa, en las dos direcciones 1ms
 ✓ … > el recorrido del árbol lee archivos de verdad, y de los dos tipos 32ms
 ✓ … > no queda ninguna llamada al adaptador de relectura bajo app/ 36ms
 ✓ … > CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador al que migraron los trece 30ms
 ✓ … > las tres relecturas que llegaron a cero consumidores siguen en cero 81ms
 ✓ … > CONTROL POSITIVO: las lecturas DEDICADAS que las sustituyeron sí se llaman 102ms
 ✓ … > `listarIncidentes` NO está en esa lista, y su consumidor sigue vivo 25ms
 ✓ … > el detector de casos apagados reconoce las formas de apagarlos, y solo esas 1ms
 ✓ … > los dos censos de adaptador no tienen casos deshabilitados ni pendientes 2ms
 ✓ … > los dos censos conservan la MITAD NEGATIVA: el adaptador declarado es el ÚNICO que se usa 1ms
 Test Files  1 passed (1) · Tests  10 passed (10)      # 11 tras H.2
```

---

## 2. Las 17 mutaciones, con su salida

Higiene: se rompe el código de verdad, se corre, y **se restaura desde una copia en memoria
verificada por hash SHA-256** (seis reintentos; el proceso aborta si no cuadra). Nunca
`git checkout`/`restore`/`stash`, nunca `--amend`. Tras cada mutación el runner imprime
`git status --porcelain` sobre mis ocho rutas: salió `[]` las **17** veces.
Guiones: `scratchpad/tandaH_mutar.py` y `scratchpad/tandaH2_mutar.py`.

### Lote R32 — la deuda vuelve, y la contraprueba (4)

```
=== MH1 (H.1/R32) una pantalla vuelve al adaptador de RELECTURA
  × no queda ninguna llamada al adaptador de relectura bajo app/ 44ms
  × CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador al que migraron los trece 31ms
  × las tres relecturas que llegaron a cero consumidores siguen en cero 83ms
  × CONTROL POSITIVO: las lecturas DEDICADAS que las sustituyeron sí se llaman 102ms
  Tests  4 failed | 6 passed (10)

=== MH2 (H.1/R32 CONTRAPRUEBA) uso LEGÍTIMO: prosa que nombra el adaptador viejo CON FORMA DE
    LLAMADA, en bloque y en línea, sobre una pantalla que sigue usando el dedicado
  Test Files  1 passed (1)
  Tests  10 passed (10)          ← VERDE A PROPÓSITO

=== MH3 (H.1/R32) una pantalla vuelve a cablear la relectura SIN CONSUMIDOR (listarCierresBodegaAdmin)
  × las tres relecturas que llegaron a cero consumidores siguen en cero 33ms
  × CONTROL POSITIVO: las lecturas DEDICADAS que las sustituyeron sí se llaman 54ms
  Tests  2 failed | 8 passed (10)

=== MH4 (H.1/R32) `listarIncidentes` pierde su ÚLTIMO consumidor de producción
  × `listarIncidentes` NO está en esa lista, y su consumidor sigue vivo 31ms
  Tests  1 failed | 9 passed (10)
```

**MH1 es la mutación que el encargo pide y su ejecución es la mitad que da sentido a la guardia:**
`SaldosTiendasTable` —la última pantalla que migró— vuelve a
`filasDelConjuntoCompleto(listarSaldosTiendasAction()…)`, y la guardia se pone roja por **cuatro
sitios a la vez**: la llamada aparece, el dedicado desaparece de esa pantalla, la relectura sin
consumidor vuelve y su sustituta deja de llamarse.

**MH2 es la otra mitad, y sin ella no sabría si discrimina o solo grita.** Es el uso legítimo más
peligroso para una guardia estática: **la prosa**. En este repo cada pantalla migrada explica en su
comentario de qué relectura salía, y la tanda G dejó `filasDelConjuntoCompleto` escrito en tres
archivos de test. La mutación mete el nombre **con forma de llamada** en un bloque `/** */` y en un
`//`, sobre una pantalla que sigue usando el adaptador dedicado. La guardia sigue **verde**, y el
caso que lo garantiza es el auto-test del detector.

**MH4 es el aviso de la tanda F convertido en propiedad.** Aquella escribió «`listarIncidentes` NO
cae en este barrido; no la borréis por analogía con la tanda E». Escrito, eso dura hasta que
alguien no lea la bitácora. Ahora, si su último consumidor desaparece, la guardia lo dice y obliga a
decidir aquí qué pasa con ella.

### Lote R31 — apagar, dejar pendiente y relajar el censo (4)

```
=== MH5 (H.1/R31) el censo transversal apaga su caso con `.skip`
  × los dos censos de adaptador no tienen casos deshabilitados ni pendientes 21ms
  Tests  1 failed | 9 passed (10)

=== MH6 (H.1/R31) el SEGUNDO censo deja su caso `.todo`
  × los dos censos de adaptador no tienen casos deshabilitados ni pendientes 21ms
  Tests  1 failed | 9 passed (10)

=== MH7 (H.1/R31) el censo transversal marca OTRO caso con `.only`: el censo no corre
  × los dos censos de adaptador no tienen casos deshabilitados ni pendientes 23ms
  Tests  1 failed | 9 passed (10)

=== MH8 (H.1/R31) el SEGUNDO censo pierde la MITAD NEGATIVA (el adaptador contrario)
  × los dos censos conservan la MITAD NEGATIVA: el adaptador declarado es el ÚNICO que se usa 6ms
  Tests  1 failed | 9 passed (10)
```

**MH7 es la que justifica que `.only` entre en la lista.** No apaga el caso que marca: apaga todos
los demás del archivo —incluido el censo— y la suite sigue verde con un `✓` por delante. Es la
forma de desactivar un censo que menos se parece a desactivarlo.

**MH8 es la tercera forma que R31 nombra** («sustituyendo una afirmación por otra más débil») en su
versión más plausible: dejar el censo encendido y quitarle la mitad negativa que T0.2 añadió. Con
solo la positiva, la **media migración** —una pantalla que llame a los dos adaptadores— pasa verde
con cualquiera de las dos declaraciones.

### Lote anti-vacuidad — el detector se rompe (4)

```
=== MH9 (H.1/anti-vacuidad) `sinComentarios` se rompe y devuelve VACÍO: todo escaneo mira la nada
  × el detector distingue una LLAMADA de una mención en prosa, en las dos direcciones 6ms
  × el recorrido del árbol lee archivos de verdad, y de los dos tipos 42ms
  × CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador al que migraron los trece 27ms
  × CONTROL POSITIVO: las lecturas DEDICADAS que las sustituyeron sí se llaman 25ms
  × `listarIncidentes` NO está en esa lista, y su consumidor sigue vivo 26ms
  × los dos censos de adaptador no tienen casos deshabilitados ni pendientes 1ms
  × los dos censos conservan la MITAD NEGATIVA … 1ms
  Tests  7 failed | 3 passed (10)

=== MH10 (H.1/anti-vacuidad) `llamadaA` deja de casar NUNCA: cero llamadas siempre
  × el detector distingue una LLAMADA de una mención en prosa … 7ms
  × CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador … 35ms
  × CONTROL POSITIVO: las lecturas DEDICADAS … 32ms
  × `listarIncidentes` NO está en esa lista … 32ms
  Tests  4 failed | 6 passed (10)

=== MH11 (H.1/anti-vacuidad) el recorrido del árbol devuelve LISTA VACÍA
  × el recorrido del árbol lee archivos de verdad, y de los dos tipos 3ms
  × CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador … 1ms
  × CONTROL POSITIVO: las lecturas DEDICADAS … 2ms
  × `listarIncidentes` NO está en esa lista … 2ms
  Tests  4 failed | 6 passed (10)

=== MH12 (H.1/anti-vacuidad) el detector de casos apagados deja de reconocer `.skip`
    (aplicada JUNTO con un `.skip` real en el censo)
  × el detector de casos apagados reconoce las formas de apagarlos, y solo esas 5ms
  × los dos censos de adaptador no tienen casos deshabilitados ni pendientes 18ms
  Tests  2 failed | 8 passed (10)

=== MH13 (H.1/R31) un censo pierde un caso: se relaja BORRÁNDOLO, sin apagar nada
  × los dos censos de adaptador no tienen casos deshabilitados ni pendientes 17ms
  Tests  1 failed | 9 passed (10)
```

**Estas cuatro son el precedente de la 172 atendido, y hay que leer lo que NO se pone rojo.** En
MH9, MH10 y MH11 el caso principal de R32 —«no queda ninguna llamada»— **pasa VERDE**: encuentra
cero llamadas porque no encuentra nada. Si la guardia fuera solo ese caso, romperle el detector la
dejaría verde para siempre y con la deuda dentro. Los rojos salen de los auto-tests y de los
controles positivos, que es exactamente para lo que están.

**MH12 destapó una redundancia que no estaba planeada y conviene anotar:** con la regex de marcas
mutilada, el `.skip` real del censo lo caza **también** el conteo de casos, porque `it.skip(` deja
de casar con `/\bit\s*\(/` y el censo pasa de 9 casos a 8. Dos afirmaciones independientes cubren
el mismo defecto por vías distintas. **MH13** mide esa segunda por su cuenta: borrar un caso del
censo, sin apagar nada, también es rojo.

### Lote H.2 — el adaptador resucita (4)

```
=== MH14 (H.2/R32) el adaptador RETIRADO vuelve a exportarse (nadie lo llama aún)
  × el adaptador de relectura ya no existe: no se puede llamar ni por descuido (T H.2) 4ms
  Tests  1 failed | 10 passed (11)

=== MH15 (H.2/R32) resucita Y una pantalla lo cablea: la deuda entera, de vuelta
  × no queda ninguna llamada al adaptador de relectura bajo app/ 46ms
  × el adaptador de relectura ya no existe … 1ms
  × CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador … 32ms
  × las tres relecturas que llegaron a cero consumidores siguen en cero 87ms
  × CONTROL POSITIVO: las lecturas DEDICADAS … 108ms
  × ninguna tabla se salta el tope: el resultado lo arman los dos adaptadores comunes 6ms
  Test Files  2 failed (2)
  Tests  6 failed | 12 passed (18)

=== MH16 (H.2/control positivo) el módulo pierde `filasDesdeResultado`
  × el adaptador de relectura ya no existe … 5ms
  Tests  1 failed | 10 passed (11)

=== MH17 (H.2) se borra el motivo escrito de la retirada
  × el adaptador de relectura ya no existe … 9ms
  Tests  1 failed | 10 passed (11)
```

**MH14 es la forma en que la deuda podría reabrirse sin que ninguna pantalla cambie**: el export
vuelve y nadie lo llama todavía. La caza el caso nuevo de H.2.

**MH15 aporta el dato que justifica el retoque de `ControlDescargaTransversal`:** con el adaptador
resucitado y cableado, ese archivo —que no es mío y no habla de esta feature— también se pone rojo
(«ninguna tabla se salta el tope»). Es la prueba de que sacarlo de la alternancia dejó esa
afirmación **estrictamente más fuerte** y no solo cosmética.

**MH16 es el control positivo del caso nuevo:** si el módulo de adaptadores perdiera uno de los dos
que sí viven, «el retirado no está» dejaría de significar nada.

**Resultado: 17 mutaciones, 16 rojas y 1 verde A PROPÓSITO (MH2, la contraprueba).** Ninguna
sobrevivió por sorpresa, así que no hay código propio inalcanzable que retirar (la tanda A sí tuvo
uno, `SIN_FILAS`) ni mutante equivalente que declarar (la tanda E sí, `toResumen`).

---

## 3. Retirar `filasDelConjuntoCompleto` (H.2), y qué pasa con los tres tests que lo nombran

**Retirado**, y no solo porque no tenga consumidores: retirarlo **mata por construcción el único
modo de fallo que la tanda G midió como superviviente**. Es la **media migración** (MG3/MG11): una
pantalla que llama a la acción nueva —el censo positivo pasa, el conteo de llamadas pasa, el xlsx
sale idéntico— y aun así pasa el resultado por el adaptador viejo, o sea **evalúa el tope en el
cliente**. El adaptador viejo no sabe leer `limite_excedido` (no es un `ActionError`), así que el
aviso sale sin el total ni el tope y deja de ser accionable (R6). Sin el export, eso no es un
defecto vigilado: es imposible.

Su propio test unitario (`tests/unit/components/descarga-resultado.test.ts`) **nunca lo cubrió**:
prueba las familias A y B. Verificado antes de borrar, no supuesto.

### Los tres tests que lo nombraban como patrón negativo, uno a uno

| Archivo | Decisión | Motivo |
| --- | --- | --- |
| `tests/components/descarga/ControlDescargaTransversal.test.tsx` | **sale de las dos alternancias** | Ahí era una vía **POSITIVA** aceptada («toda descarga pasa por un adaptador común», y la de proveedores). Quitarlo deja **una vía aceptada menos**: la afirmación queda estrictamente **más fuerte**, no más débil, y las 26 tablas siguen verdes porque ninguna lo usaba. Medido con **MH15**, que la pone roja cuando el adaptador vuelve y se cablea. Es lo que `tasks.md` H.2 pedía. |
| `tests/components/paginacion/paginacion-transversal.test.tsx` (censo 1) | **se conserva tal cual** | Ahí es la mitad **NEGATIVA** de los trece (`.not.toMatch(ADAPTADOR[CONTRARIO[…]])`). Una afirmación negativa sobre algo que no existe es precisamente lo que impide que vuelva: si alguien rescata el adaptador del historial, este censo dice **CUÁL** de los trece se cableó a él; la guardia solo diría «alguien, en algún archivo». Cuesta una línea. |
| `tests/components/descarga/WalletPropsDescarga.test.tsx` (censo 2) | **se conserva tal cual** | Mismo motivo, sobre los tres módulos de wallet. |

Esto **responde la pregunta abierta que dejó la tanda G** («hay que decidir si el censo conserva el
campo `adaptador` o si el patrón pasa a ser “ninguno de los trece contiene una llamada al adaptador
retirado”»): **se conserva el campo**, y la razón por la que no queda vacuo es que la guardia
afirma aparte que el export sigue retirado (caso de H.2, killers MH14/MH16/MH17). Los dos motivos
quedan escritos **en los dos censos**, no solo aquí.

---

## 4. Las cuatro relecturas sin consumidor: decisión, una por una

**Las cuatro se CONSERVAN.** No porque no sean deuda —lo son: superficie pública viva que ya no
sirve a ninguna pantalla— sino porque el precio de pagarla hoy son **medidas vivas**, y el
sustituto de esas medidas sería sintético. La regla del encargo aplicada al pie: *lo que no vale es
borrar y que algo deje de medirse en silencio*. Aquí el silencio se rompe de tres formas: el motivo
va **junto al código**, la guardia afirma que conservarlas **no las devuelve a la capa de
pantallas**, y esta sección dice qué costaría exactamente retirarlas.

Antes de decidir se verificó contra el árbol de hoy que las tres primeras están, en efecto, en
cero: bajo `app/` solo quedan **menciones en prosa**, ni una llamada.

### 4.1 `listarCierresBodegaAdmin` — la acción y el servicio · **CONSERVAR**

Tres medidas mueren si se borra, y ninguna tiene sustituto no sintético:

1. **La anti-vacuidad de R1 de la tanda E.** `cierres-bodega-admin-completo.test.ts` la ejecuta y
   afirma `llamadas === ["findCierresBodega"]` y `filasLeidas === [7]` — frente a las 5 y 2 de las
   lecturas dedicadas. Es **el único caso que mata M8**, la mutación insignia de aquella tanda, que
   dejaba **43 de 44** en verde. Sin ese lado, los `toEqual(["findHistoricoCompleto"])` los pasa
   igual un servicio que no lea nada. **Rehacerlo exigiría inventar un testigo que lea 7 filas; no
   queda ninguno en el sistema que lo haga.**
2. **La contraprueba de R44 de la 170.** `cierres-bodega-admin-historico-paginado.test.ts` y
   `cierres-bodega-pendientes-paginado.test.ts` la usan para afirmar que el listado paginado y el
   sin paginar coinciden. Es una garantía de otra feature, y no es mía para desmontarla.
3. **El doble VIVO de la mitad de cliente.** `CierresDescarga.test.tsx` la invoca al final
   (`const compuesto = await listarCierresBodegaAdmin()`) y comprueba que devuelve las dos mitades,
   para que los cuatro `not.toHaveBeenCalled()` signifiquen «la pantalla decidió no llamarla» y no
   «el mock estaba muerto». Son los `expect` cuyos killers son ME1/ME3/ME9/ME11.

**Contra qué se pesó:** una Server Action exportada en un módulo `"use server"` que el grafo de
cliente alcanza es un endpoint direccionable, aunque ninguna pantalla la importe. Eso es real. Pero
está guardada por `esAccesoTotal`, de modo que quien puede llamarla ya podía ver esos datos por sus
dos lecturas dedicadas: **el riesgo marginal es cero y el coste de retirarla no lo es.**

### 4.2 `findCierresBodega` — el método de repositorio · **CONSERVAR**

Es el caso más claro de los cuatro. `historicos-paginados-where.test.ts` lo ejecuta contra el
repositorio **real** y afirma que su consulta **no lleva `where` en absoluto**
(`expect(argsCompuesto.where).toBeUndefined()`). Esa es la evidencia de que
`findHistoricoCompleto`/`findColaCompleta` tenían que existir (R1/R14): «el compuesto no corta por
estado» solo se puede afirmar preguntándoselo al compuesto. Borrarlo deja el caso con la mitad
dedicada y sin el término de comparación — es decir, deja de justificar los dos métodos nuevos.

### 4.3 `listarPlantillasAction` y `listarSaldosTiendasAction` · **CONSERVAR**

Estas dos tienen un motivo **propio y más fuerte** que las de bodega, y viene de que la tanda G
midió que sus dos listados no ahorran ni una consulta: **las dos lecturas devuelven las mismas
filas y el xlsx sale idéntico celda por celda**. Contar llamadas es, literalmente, lo único que
separa los dos caminos —lo dice el comentario del propio caso: «este `expect` es lo único que
impide que la relectura vuelva sin que nada falle»—. `WalletPropsDescarga.test.tsx` afirma que no
se llaman **y** las invoca al final para probar que el doble está vivo y responde el conjunto
entero. Retirarlas deja R1 de los listados 11 y 12 **sin discriminador de conducta**: solo con la
mitad estática del censo.

Coste adicional medido: retirarlas obliga además a borrar sus casos de borde
(`gasto-fijo-plantilla-actions.test.ts`, `wallet-tienda-actions.test.ts`) y a tocar los `vi.mock`
de **ocho** archivos.

### 4.4 `listarIncidentes` · **NO CAE, y ahora está afirmado**

Verificado contra el árbol: `app/(app)/incidentes/page.tsx:40` la sigue llamando, para el guard de
la pantalla y para el booleano `sinZona`, que no viaja por ninguna otra vía. **No se toca.** Lo que
esta tanda añade es que ya no depende de que nadie lea la bitácora de la F: el caso
«`listarIncidentes` NO está en esa lista, y su consumidor sigue vivo» se pone rojo si ese consumidor
desaparece (killer **MH4**).

---

## 5. Las dos deudas anotadas: **ninguna entra**, con su motivo

### 5.1 `incidentes/page.tsx` lee el alcance entero para obtener un booleano (tanda F) — **NO entra**

Cuatro razones, en orden de peso:

1. **Es `app/**`, fuera del alcance de BACKEND_DEV.** Cerrarla exige cambiar el Server Component,
   que es trabajo de FRONTEND_DEV; hacer solo la mitad de `lib/**` deja una lectura nueva sin
   consumidor, que es exactamente el problema que esta tanda está decidiendo no crear.
2. **Es un cambio de contrato, y esta spec ya decidió qué hacer con esos.** Tiene la misma forma
   que **Q1 (Q-K6)** —«qué contrato queda para `listarRecepcionSatelite()`»—, cuyo default escrito
   es *«fuera de esta feature, como ticket propio inmediatamente posterior»*, con el motivo de que
   *«meterlo dentro mezclaría un cambio de contrato con una migración de doce pantallas»*. Meterlo
   en la tanda de **cierre** es peor todavía: mezcla un cambio de contrato con el gate final.
3. **Ningún requisito de la 184 lo necesita.** R8 prohíbe que las consultas por render **aumenten**;
   ésta no aumentó — es un coste preexistente que la feature no tocó.
4. **Y tiene un efecto secundario que hay que decidir, no arrastrar:** cerrarla deja
   `listarIncidentes` en **cero consumidores**, es decir, la pone en la misma situación que las tres
   de §4 — y su caso de R1 en `incidentes-completo.test.ts` también se apoya en ejecutarla y contar
   sus **7 filas**. O sea: no es «una lectura menos», es «una lectura menos y un testigo que
   rehacer». Quien la haga tendrá que venir a la guardia (§4.4 lo fuerza) y decidirlo.

### 5.2 El listado 12 se sirve por el paginado y no por `listarSaldosTodasTiendas()` (tanda G) — **NO entra, y NO se debe**

La decisión de la tanda G es correcta y está medida con **M9**. Lo que quedaba anotado es que el
método base sigue devolviendo las filas **sin orden**. Se miró el código antes de decidir:

- **No es un defecto vivo.** `listarSaldosTodasTiendas()` tiene hoy dos consumidores:
  `listarSaldosTiendasPaginado` —que **ordena encima**, y ahí vive el orden una sola vez— y
  `WalletTiendaService.listarSaldosTiendas`, que es la relectura de §4.3 y no la lee ninguna
  pantalla. **Ningún camino de producción observa hoy un resultado sin ordenar.** Está declarado en
  el propio bloque de documentación del método y en `progress/impl_170-fase2-tanda-i.md`.
- **Y «arreglarlo» tendría un coste concreto:** mover el `sort` dentro de
  `listarSaldosTodasTiendas` convertiría **M9 en un mutante equivalente** —servir el archivo desde
  ahí produciría el orden correcto— y **R5 del listado 12 se quedaría sin ningún killer**. Sería
  cambiar una propiedad medida por una propiedad afirmada.

---

## 6. Archivos

**Producción (4)**

- `components/shared/descarga-resultado.ts` — **retirado** `filasDelConjuntoCompleto` (y el import
  de `ActionError`, que solo él usaba). En su sitio queda el bloque que explica qué era, por qué
  existió, por qué se va y **qué lo sigue vigilando**.
- `lib/actions/cierre-bodega.ts`, `lib/actions/wallet-tienda.ts`,
  `lib/actions/gasto-fijo-plantilla.ts` — **solo comentarios**: el motivo de conservar cada
  relectura, junto al código. Ni una línea ejecutable.

**Tests (4)**

- `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` — **nuevo**, 11 casos.
- `tests/components/descarga/ControlDescargaTransversal.test.tsx` — el adaptador retirado sale de
  las dos alternancias positivas (§3).
- `tests/components/paginacion/paginacion-transversal.test.tsx` y
  `tests/components/descarga/WalletPropsDescarga.test.tsx` — **solo comentarios**: la decisión de
  conservar su mitad negativa, escrita donde se lee.

**Cero** cambios en `db/migrations/`, RLS, esquema, `feature_list.json`, en la configuración de
`useSWR` de ninguna pantalla (**R33**) y en ninguna pantalla de `app/**`.

---

## 7. Mapa `R<n>` → archivo + nombre del caso

### 7.1 R31 y R32 — los míos, verificados leyendo el caso

| R | Archivo | Caso | Killers |
| --- | --- | --- | --- |
| **R31** | `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` | **«los dos censos de adaptador no tienen casos deshabilitados ni pendientes»** — `.skip`/`.todo`/`.only`/`.skipIf`/`.runIf`/`xit`/`xdescribe` sobre el TEXTO de los dos censos, + sus anclas (`ANEXO_III`, `PENDIENTES_184`, `ANEXO_IV`; los tres módulos de wallet), + el nº de casos como mínimo | **MH5** (`.skip`), **MH6** (`.todo`), **MH7** (`.only`), **MH13** (borrar un caso) |
| **R31** | ídem | **«los dos censos conservan la MITAD NEGATIVA: el adaptador declarado es el ÚNICO que se usa»** — la tercera forma que R31 nombra: relajar sin apagar | **MH8** |
| **R31** | ídem | «el detector de casos apagados reconoce las formas de apagarlos, y solo esas» — auto-test, 10 formas + 5 contraejemplos | **MH12** |
| **R32** | ídem | **«no queda ninguna llamada al adaptador de relectura bajo app/»** — `app/` + `components/` enteros, sin comentarios | **MH1**, **MH15** |
| **R32** | ídem | **«el adaptador de relectura ya no existe: no se puede llamar ni por descuido (T H.2)»** — el export no vuelve; control positivo sobre `filasDesdeResultado` y `filasLocales` | **MH14**, **MH16**, **MH17** |
| **R32** | ídem | «las tres relecturas que llegaron a cero consumidores siguen en cero» + «CONTROL POSITIVO: las lecturas DEDICADAS que las sustituyeron sí se llaman» | **MH1**, **MH3** |
| **R32** | ídem | «`listarIncidentes` NO está en esa lista, y su consumidor sigue vivo» | **MH4** |
| **R32** | ídem | «CONTROL POSITIVO: el mismo escaneo SÍ ve el adaptador al que migraron los trece» + los dos auto-tests del detector — la anti-vacuidad de todo lo anterior | **MH9**, **MH10**, **MH11** |

**La contraprueba, que no es un caso sino una propiedad de los tres primeros: MH2 los deja VERDES.**
Prosa que nombra el adaptador viejo con forma de llamada, en bloque y en línea, sobre una pantalla
que sigue usando el dedicado.

### 7.2 R1..R34 — índice, no verificación

`tasks.md` H.3 pide el mapa completo verificado caso a caso; **eso NO se hizo aquí** y queda
abierto. Lo que sigue es un **índice** de dónde vive cada requisito según las siete bitácoras,
para que H.3 no empiece de cero. Está marcado como índice a propósito: transcribirlo no es
verificarlo, y el encargo de esta tanda no incluía re-leer 34 requisitos en ~40 archivos.

| R | Cerrado en | Bitácora con el caso nombrado |
| --- | --- | --- |
| R1, R2, R3, R7, R8 | tandas A–G (mitad de servidor + mitad de pantalla) | las 14 bitácoras, sección «Mapa» |
| R4, R6, R17 | servicio y borde de cada tanda | `impl_188_tanda{A..G}_backend.md` |
| R5, R14, R15, R16 | los tres `*-where.test.ts` + `wallet-tienda-movimiento-repository` | ídem |
| R9 | tanda C (+ extendido en F) | `impl_188_tandaC_backend.md §7`, `impl_188_tandaF_backend.md §6` |
| R10 | tanda B | `impl_188_tandaB_backend.md §5` |
| R11 | tanda A | `impl_188_tandaA_backend.md §5` |
| R12, R13 | sin cambios / censo | `ControlDescargaTransversal`, `paginacion-transversal` |
| R18–R28 | tanda A (poda de la satélite) | `impl_188_tandaA_frontend.md §6` |
| R29, R30 | los dos censos | `impl_188_tandaG_frontend.md §9` |
| **R31, R32** | **tanda H** | **§7.1 de este archivo** |
| R33 | ninguna tanda tocó `useSWR` | las 14 bitácoras |
| R34 | las 15 bitácoras | pendiente de consolidar en **H.3** |

**Comprobación de sanidad hecha, y es lo único que aquí no es transcripción:** se verificó por
script que **16 títulos de caso** citados en las siete bitácoras existen literalmente en el árbol de
hoy (R1 de E, R1 de F, R1 de G, R2, R5 del 12, R6, R9, R10, R11, R17, R18, R26, R29/R30, R31, R32,
R33). Los 16, presentes. No sustituye a H.3 —no comprueba que el caso afirme lo que dice afirmar—
pero descarta la forma más barata de que el mapa mienta: nombres de caso que ya no existen.

---

## 8. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm exec eslint <mis 8 archivos>
(sin salida: 0 errores, 0 warnings)

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)          # AJENAS y preexistentes; delta propio: CERO

$ pnpm exec vitest run guard                    # ANTES de la tanda H
 Test Files  61 passed (61)
      Tests  830 passed (830)

$ pnpm exec vitest run guard                    # DESPUÉS
 Test Files  62 passed (62)
      Tests  841 passed (841)
   Duration  6.30s

$ pnpm exec vitest run tests/unit/descarga/adaptador-conjunto.guardia.test.ts --reporter=verbose
 Test Files  1 passed (1) · Tests  11 passed (11)      # los 11, con su nombre (§1.2)

$ pnpm exec vitest related --run components/shared/descarga-resultado.ts
 Test Files  70 passed (70)
      Tests  879 passed (879)

$ pnpm exec vitest run tests/unit/descarga tests/components/descarga tests/components/paginacion \
    tests/unit/actions tests/unit/components/descarga-resultado.test.ts \
    tests/integration/descarga-170-volumen.test.ts
 Test Files  78 passed (78)
      Tests  839 passed (839)

$ pnpm exec vitest run <los 4 testigos de anti-vacuidad + tests/integration/actions>
 Test Files  30 passed (30)
      Tests  381 passed (381)
```

**Rojos: cero, ni propios ni ajenos.** Las **44 warnings** de lint son el mismo número que midieron
`chore_deuda_170.md §6` (2026-08-03) y las siete tandas anteriores sobre el árbol limpio.

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

### 8.1 ¿Necesita esta tanda el gate completo antes de cerrar? **Sí, y por un motivo concreto**

No por incertidumbre general —`typecheck` está en 0 y se verificó por `grep` que **no queda ni una
referencia de código** al símbolo retirado, solo prosa y las dos regex negativas de los censos—,
sino porque esta tanda **retira un export de `components/shared/descarga-resultado.ts`, el módulo
que comparten las 26 tablas de descarga**, y ése es exactamente el tipo de cambio que un
`vitest related` puede no cubrir: `related` sigue el grafo de imports y no ve a los tests que
escanean el árbol **como texto**. En este repo hay cinco de ésos y se corrieron los cinco, pero la
familia existe y ha crecido cada feature.

Además `tasks.md` H.4 lo exige antes del PR sin excepción, y la memoria del repo tiene el caso de
mergear por estado de PR y meter un guard cruzado rojo en `dev`.

---

## 9. Qué queda abierto

| Tarea | Qué falta |
| --- | --- |
| **H.3** | El mapa `R1..R34` verificado **caso a caso** (§7.2 deja el índice y la comprobación de que los 16 títulos citados existen). `tasks.md` avisa: no vale contar `R<n>` en títulos — aquí ya produjo un falso «68/68». |
| **H.4** | `./init.sh` completo en verde, entrada en `progress/history.md`, y la feature a `done` **solo tras el merge** (lo lleva el LEADER). |
| Deuda del `sinZona` de incidentes | §5.1 — fuera, con motivo. Cerrarla deja `listarIncidentes` en cero consumidores y obliga a rehacer su testigo de R1; la guardia lo fuerza a pasar por aquí. |
| Q1 (Q-K6) | Sigue donde la spec la dejó: fuera de esta feature. Tras la tanda A, `listarRecepcionSatelite()` tiene un solo consumidor de producción y la rama B está desbloqueada. |
| Las cuatro relecturas de §4 | Conservadas **con motivo escrito junto al código**. Si algún día se retiran, el trabajo no es borrar: es rehacer tres testigos de anti-vacuidad y tocar ~10 archivos de test. |

---

## 10. Nota de proceso

Único agente en el worktree, y aun así la higiene entera: **ninguna orden de git sin ruta
explícita**, ningún `--amend`, ningún `stash`, ningún `checkout -- .`. Los dos runners de mutación
restauran **desde copia en memoria** y **verifican por hash SHA-256** (seis reintentos, abortan si
no cuadra — el incidente de la tanda D, un `writeFileSync` que falló por un lock de Windows y dejó
la mutación aplicada, está cubierto). `git status --porcelain` sobre mis ocho rutas salió `[]` las
17 veces, y el árbol quedó limpio al terminar.

Los guiones llevan el nombre de la tanda dentro (`tandaH_mutar.py`, `tandaH2_mutar.py`), por lo que
la tanda B aprendió sobre el scratchpad compartido.

**Un incidente propio, y la lección es la de la tanda F con otra cara:** la primera pasada del
runner reventó con `UnicodeDecodeError` porque `subprocess` decodificaba la salida de vitest en
`cp1252`. Falló ruidosamente —bien— pero llegó a ejecutar y restaurar MH1 sin poder leer su
resultado. El guardarraíl que ya llevaba puesto (`!!! SIN RECUENTO … NO cuenta como mutación`) es lo
que garantiza que una corrida sin salida no se pueda leer como una mutación que «no mató a nadie».
Se arregló el `encoding` y se repitió el lote entero desde MH1.

**Cuatro commits**, con `git add` de rutas explícitas:

| Commit | Qué |
| --- | --- |
| `8316dec6` | la guardia (H.1) |
| `7617b678` | la retirada del adaptador y los tres tests que lo nombraban (H.2) |
| `fa60b0ce` | el motivo de conservar las tres relecturas, junto al código |
| (este) | la bitácora |
