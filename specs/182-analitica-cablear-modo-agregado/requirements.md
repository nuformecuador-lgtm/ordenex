# 182 — analitica: cablear el modo agregado al tablero operativo · requirements

> Zona: `frontend` · complexity: `medium` · `depends_on: [176]` · branch `feature/182-analitica-cablear-modo-agregado`
> Origen: decision **D5** de la 176 (`specs/176-.../requirements.md §4`) y el hueco declarado en
> `specs/131-analitica-tablero-operativo/requirements.md §6.1`.
> **Puerta T0 CERRADA el 2026-08-05** (§6). Los requisitos de abajo ya incorporan sus respuestas.

## 0. El problema, en una frase

El backend ya sabe sumar antes de dividir sobre varios dias (`consultarAgregadoOperativo`, 176), y
el tablero sigue sin usarlo: por encima de 62 fechas distintas un panel de `porcentaje` o
`segundos` no pinta **ni serie ni cifra**, y en cualquier rango no pinta **cifra total**.

### Hechos VERIFICADOS en este arbol (no citados de nadie)

Todo lo que sigue se comprobo leyendo `C:/w182`.

1. **El contrato de la 176 esta vivo y es aditivo.** `lib/types/analitica-operativa.ts:143-208`
   declara `CuboAgregado { fecha, desdeFecha, hastaFecha, dimension?, numerador, denominador,
   valor, parcial?, corteAt? }`, `GranoAgregado = "periodo" | "semana"`, `AgregadoOperativo
   { metricaId, unidad, unidadDeConteo, grano, rango, cubos, cobertura }` y `ResultadoAgregado`
   con los mismos cuatro estados que `ResultadoOperativo`. `PuntoSerie`/`SerieOperativa` **no
   cambiaron**.
2. **La puerta es una Server Action propia.** `consultarAgregadoOperativo(entrada:
   EntradaOperativa & { grano?: GranoAgregado }, deps)` en `lib/actions/analitica-operativa.ts:155-193`.
   Recorre los mismos cuatro pasos que la lectura de serie y reusa `denegar()` y
   `sondeaIdentidadDeMensajero`.
3. **NO existe grano `dia` en el modo agregado.** Solo `periodo` y `semana`
   (`lib/types/analitica-operativa.ts:172`). El agregado **no puede** servir la serie diaria que
   hoy se pinta por debajo del techo.
4. **El modo agregado RECHAZA `conteo`.** `UNIDADES_AGREGABLES = ["porcentaje", "segundos"]`
   (`:200`); el borde responde `validation_error` con `ERROR_UNIDAD_NO_AGREGABLE` antes de tocar
   la base (`lib/actions/analitica-operativa.ts:180-185`) y el servicio ademas lanza
   (`lib/services/AnaliticaOperativaService.ts:225-227`).
5. **Hoy `porcentaje`/`segundos` NUNCA pasan por la agregacion semanal del cliente.**
   `prepararPanel` corta antes: `if (excedeTecho && !esAgregableTemporal(unidad)) return { modo:
   "rango_excedido", ... }` (`app/(app)/analitica/_components/operativo/agregacion.ts:310-323`), y
   `esAgregableTemporal(u) === (u === "conteo")` (`:238-240`). Es decir: **`lunesDeLaSemana`
   (`:80-88`) solo se ejecuta hoy para `conteo`**, via `agregarPorSemana` (`:99-133`). La «doble
   definicion de semana» que la 176 anticipo era un riesgo, no un hecho consumado.
6. **`lunesDeLaSemana` NO puede retirarse.** Es el unico camino de los **conteos** por encima del
   techo (R16 de la 131) y el modo agregado los rechaza (hecho 4). Retirarla dejaria sin serie a
   `ordenes_creadas`, `sin_gestionar` y al panel de gestiones en rangos largos.
7. **El techo es 62 fechas distintas.** `MAX_PUNTOS_SERIE = 62`
   (`components/private/analytics/topes.ts:32`), aplicado sobre `fechasDistintas(crudos)`
   (`agregacion.ts:310`).
8. **El total se anula hoy para toda unidad distinta de `conteo`, en TODO rango.**
   `total: esAgregableTemporal(unidad) ? totalizarPuntos(puntos) : null` (`agregacion.ts:347, 371`).
9. **NO existe panel de `aging_por_estado` en el tablero.** `PANELES_OPERATIVOS`
   (`catalogo-paneles.ts:63-108`) tiene **seis** paneles: `ordenes-creadas`, `ordenes-por-estado`,
   `resultado-gestiones`, `sin-gestionar`, `tasa-entrega`, `tiempo-ciclo`. De ellos, los de unidad
   `porcentaje`/`segundos` son **exactamente dos**: `tasa_entrega` y `tiempo_ciclo`. `aging_por_estado`,
   `tasa_devolucion`, `tasa_rechazo` y `primer_intento_ok` **no tienen panel**.
10. **El presupuesto de paneles esta afirmado por un test de LATENCIA.**
    `tests/components/TableroOperativoLatencia.test.tsx:106` afirma
    `PANELES_OPERATIVOS.length <= 6`, y `:101,107` afirman **una invocacion por metrica declarada
    y ni una mas**.
11. **Los dos tests de componente mockean el modulo del borde con factoria explicita**
    (`vi.mock("@/lib/actions/analitica-operativa", () => ({ consultarAnaliticaOperativa: vi.fn() }))`,
    `TableroOperativo.test.tsx:27-29` y `TableroOperativoLatencia.test.tsx:33-35`). En cuanto
    `PanelOperativo.tsx` importe `consultarAgregadoOperativo`, **esos dos archivos se ponen rojos**
    hasta que la factoria exporte tambien el nuevo simbolo. No es opcional.
12. **El guardia de frontera del subarbol esta vivo y acota lo que se puede escribir.**
    `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` prohibe en
    `app/(app)/analitica/**`: importar el servicio, cualquier `AnaliticaOperativa*Repository`,
    `@/lib/db`, `@prisma/client` (import de valor), `getPrismaClient`, los modulos de alcance e
    identidad, `resolverAlcance`, `seudonimizar*`; y en el subarbol operativo ademas
    `esAccesoTotal`, `analitica-financiera`, `from "@/lib/analytics/metrics"` y el literal
    `"financiera"`. **Todo lo que esta feature escriba tiene que caber ahi dentro.**
13. **El catalogo real no se puede importar desde el subarbol** (hecho 12), y el vinculo con el se
    mantiene **por test**: `tests/unit/analytics/tablero-catalogo-paneles.test.ts` corre en Node y
    si puede leer `getMetrica()` (`catalogo-paneles.ts:25-30`).
14. **El aging agregado ya se sirve, con forma propia.** `cubosVivosAgregados`
    (`AnaliticaOperativaService.ts:306-349`): sin `desagregacion` devuelve **un unico cubo** al
    corte, siempre `parcial: true`; con `desagregacion: "estatus"` devuelve **un cubo por estatus**
    y **ningun cubo total**. *(Queda para su propia ficha — Q1 de §6.)*
15. **`KpiCard` ya sabe pintar `porcentaje` y `segundos`.** `formatearValor`
    (`components/private/analytics/formato.ts:64-76`) formatea la razon cruda como `%` y los
    segundos con `Intl` por magnitud; `null` se pinta como `SIN_MONTO`, nunca como `0`.
16. **El modo `rango_excedido` tiene HOY cuatro aserciones vivas** que hay que reescribir o retirar
    en este mismo PR (Q7): `tests/unit/analytics/tablero-agregacion.test.ts:205` y `:216`
    (`expect(preparado.modo).toBe("rango_excedido")`), y
    `tests/components/TableroOperativo.test.tsx:321-322` (afirma el titulo) y `:342` (afirma su
    **ausencia** en el panel de conteos — se queda vacua si la constante desaparece).

---

## 1. Alcance

**Entra:** cablear `consultarAgregadoOperativo` a los paneles de `porcentaje` y `segundos` del
tablero operativo, para (a) pintar la **serie por cubos semanales del servidor** por encima del
techo y (b) mostrar la **cifra total del cubo `periodo`** en todo rango; acotar y **vigilar** la
agregacion semanal del cliente; retirar el modo `rango_excedido`, que queda muerto.

**No entra:** `aging_por_estado` y su panel (**ficha aparte**, Q1); metricas nuevas en el catalogo
(`lib/analytics/metrics.ts`); cambios en `lib/actions/**`, `lib/services/**`, `lib/types/**` ni en
el paquete de graficas (`components/private/analytics/**`); el tablero financiero y
`AnaliticaShell.tsx`; migraciones; cualquier ruta de `app/api`; los recortes por rol; la cache.

---

## 2. Requisitos (EARS)

> Cada requisito lleva **test nombrado + mutacion** en §3. Un requisito sin mutacion concreta no
> esta especificado.

### La serie por encima del techo

- **R1** — MIENTRAS un panel cuya metrica sea de `unidad: "porcentaje"` o `"segundos"` este por
  encima del techo de puntos, el sistema DEBE pintar su serie con los **cubos de grano `semana`
  servidos por `consultarAgregadoOperativo`**, y NO DEBE mostrar el aviso de «reduce el rango» ni
  dejar el panel sin serie.

- **R2** — CUANDO el sistema pinte una serie a partir de cubos agregados, las categorias del eje
  DEBEN salir de la `fecha` que trae cada cubo y los valores del `valor` de cada cubo. El sistema
  NO DEBE recalcular la semana en el cliente ni recomponer el valor a partir de los puntos diarios.

- **R3** — El sistema NO DEBE cubetear en el cliente puntos de `unidad: "porcentaje"` o
  `"segundos"`. SI se le entregan puntos diarios de esas unidades por encima del techo **sin**
  cubos del servidor, ENTONCES DEBE **fallar ruidosamente** en vez de agregarlos por semana.

### La cifra total

- **R4** — El sistema DEBE mostrar, en todo panel de `unidad: "porcentaje"` o `"segundos"` y en
  **cualquier** rango (por debajo y por encima del techo), la **cifra total del periodo**, tomada
  del `valor` del cubo de grano `periodo`.

- **R5** — La cifra total DEBE ser exactamente la que el servidor calculo sumando antes de dividir,
  y NO DEBE ser la media de los valores diarios ni una razon recompuesta en la UI.
  *(Requisito central. Su prueba usa dias de volumen **DESIGUAL** y **afirma las dos cosas**: el
  valor correcto **y** que no es el de la media de medias. Con volumenes iguales las dos formulas
  coinciden y el test no probaria nada — la leccion de la 176.)*

- **R6** — CUANDO el cubo `periodo` venga `parcial: true`, el sistema DEBE anunciar el total como
  parcial con su `corteAt`; MIENTRAS el cubo no venga parcial, NO DEBE anunciarlo como parcial.

- **R7** — SI el cubo `periodo` trae `valor: null` con `denominador: 0`, ENTONCES el sistema NO
  DEBE pintar `0` como cifra total y DEBE declarar que **no hubo gestiones en el periodo**, con un
  texto distinto del vacio de la metrica.
  *(Es el valor que D2 de la 176 anadio al contrato: con el denominador delante, «no hubo
  gestiones» y «no hay dato» dejan de ser el mismo pixel. Desperdiciarlo en la UI seria devolver
  el `null` a secas de la 126.)*

### Que se pide, a quien y cuando

- **R8** — El sistema NO DEBE invocar `consultarAgregadoOperativo` para metricas de
  `unidad: "conteo"`.
  *(El borde responderia `validation_error` (hecho 4): seria una llamada que solo puede fallar.)*

- **R9** — El catalogo de paneles DEBE declarar la `unidad` de cada metrica que consulta, y esa
  unidad DEBE coincidir con la que el catalogo de metricas del servidor declara para ese
  `metricaId`.
  *(El subarbol no puede importar `lib/analytics/metrics` (hecho 12), asi que la unidad se declara
  y el vinculo se ancla POR TEST, igual que R21 de la 131.)*

- **R10** — CUANDO cambie el filtro del tablero, el sistema DEBE volver a consultar el agregado con
  el filtro nuevo, y NO DEBE dejar en pantalla la cifra total del filtro anterior.

- **R11** — CUANDO se cargue el tablero, el sistema DEBE disparar **todas** sus consultas —serie y
  los **dos** granos agregados— **solapadas en una sola oleada**, no encadenadas, y el numero total
  de invocaciones DEBE ser el declarado por el catalogo de paneles y su unidad (**Q2 = A**).

### Honestidad y frontera

- **R12** — El tablero DEBE obtener toda cifra agregada de `consultarAgregadoOperativo` y de
  ninguna otra puerta, y NO DEBE recomponer en el subarbol ninguna formula de negocio (ni el
  denominador de gestiones, ni los acumuladores de ciclo, ni una division de componentes propia).

- **R13** — CUANDO la respuesta agregada de un panel no sea `ok`, el sistema DEBE reducirla con la
  **misma precedencia** que ya aplica a las respuestas de serie (`unauthenticated` > `forbidden` >
  `validation_error` > `ok`) y NO DEBE presentar un denegado como «sin datos» ni como ausencia de
  total.

- **R14** — MIENTRAS un panel pinte cubos semanales, el sistema DEBE anunciar el grano usado.

### Lo que queda vigilado despues de la limpieza *(nuevos, salen de Q4 y Q7)*

- **R15** — El sistema DEBE mantener la agregacion semanal del cliente
  (`agregarPorSemana`/`lunesDeLaSemana`) **acotada a `unidad: "conteo"`**, y DEBE existir una
  guardia que **afirme el acotamiento**: que ninguna ruta de `porcentaje` o `segundos` la invoca.
  Comprobar solo que la funcion existe NO cumple este requisito.
  *(**Condicion explicita del humano al cerrar Q4.** Conservarla sin vigilarla deja viva una
  segunda definicion de semana —justo lo que la ficha queria evitar— con la diferencia de que
  ahora nadie la esta mirando. El acotamiento es lo que se prueba, no la existencia.)*

- **R16** — El sistema NO DEBE conservar el modo `rango_excedido` ni sus textos
  (`TEXTO_RANGO_EXCEDIDO`, `TITULO_RANGO_EXCEDIDO`) en el subarbol operativo, y las cuatro
  aserciones vivas que hoy los afirman (hecho 16) DEBEN reescribirse o retirarse **en este mismo
  PR**.
  *(Borrar codigo no lo mata ningun test por si solo: sin este requisito, la rama muerta podria
  reaparecer y nadie se enteraria. Y una rama inalcanzable con su propio texto de UI es
  exactamente lo que un guardia futuro puede acabar censando creyendo que vigila algo vivo — el
  patron muerto que `export-csv-frontera.guardia.test.ts:210-227` documenta como leccion.)*

---

## 3. Trazabilidad `R<n>` -> test nombrado -> **mutacion que lo pone ROJO**

> Un requisito no esta cubierto porque exista un test verde: lo esta porque **esta mutacion
> concreta del codigo de produccion pone rojo ese test nombrado**. El implementer aplica cada
> mutacion, comprueba el rojo, la revierte y lo anota en `progress/impl_182.md`.
>
> **Anclaje:** cada fila nombra el caso que cae, no el archivo. Si bajo la mutacion cae un caso
> *hermano* y no el nombrado, la fila esta mal escrita (paso en la 125, la 126 y la 131).

| R | Test (archivo › nombre del caso) | Mutacion que DEBE ponerlo ROJO |
|---|---|---|
| **R1** | `tests/components/TableroOperativo.test.tsx` › «un panel de tasa con 90 dias pinta la serie por cubos semanales del servidor y ya no pide reducir el rango» | En `PanelOperativo.tsx`, ignorar el resultado agregado y volver a devolver el panel de aviso cuando se excede el techo |
| **R2** | `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «las categorias de la serie semanal son las `fecha` de los cubos del servidor, no una semana recalculada en el cliente» | Construir la serie con `agregarPorSemana(puntos diarios)` en vez de con los cubos (el fixture ancla los cubos en una fecha que NO es el lunes ISO de sus puntos diarios, asi que las etiquetas y los valores difieren) |
| **R3** | `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «una tasa larga sin cubos del servidor falla ruidosamente en vez de cubetearse en el cliente» | Sustituir el fallo por `agregarPorSemana(puntos)` (la mutacion que reintroduce la media de medias por la puerta de la UI) |
| **R4** | `tests/components/TableroOperativo.test.tsx` › «el panel de tasa muestra su cifra total del periodo tambien con el rango corto» | Restaurar `total: esAgregableTemporal(unidad) ? … : null` para las unidades no `conteo` |
| **R5** | `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «con dias de volumen desigual la cifra total es la del cubo periodo (2/11) y NO la media de los valores diarios (0,55)» | Calcular el total como la media aritmetica de los `valor` de los puntos diarios (o de los cubos semanales) en vez de leer el `valor` del cubo `periodo` |
| **R6** | `tests/components/TableroOperativo.test.tsx` › «un total de periodo que incluye el dia en curso se anuncia parcial con su hora de corte» | Descartar `parcial`/`corteAt` del cubo `periodo` al construir el total |
| **R7** | `tests/components/TableroOperativo.test.tsx` › «un periodo con denominador cero dice que no hubo gestiones y no pinta un cero» | Sustituir el valor del total por `cubo.valor ?? 0` |
| **R8** | `tests/components/TableroOperativoLatencia.test.tsx` › «ninguna metrica de conteo invoca la Server Action agregada» | Invocar el agregado para todas las metricas del panel sin mirar su unidad declarada |
| **R9** | `tests/unit/analytics/tablero-catalogo-paneles.test.ts` › «la unidad declarada por cada metrica del catalogo de paneles es la que declara el catalogo de metricas» | Declarar `unidad: "conteo"` en la metrica `tasa_entrega` del catalogo de paneles |
| **R10** | `tests/components/TableroOperativo.test.tsx` › «al cambiar el filtro la cifra total se vuelve a pedir con el filtro nuevo» | Sacar el filtro (o el grano) de la clave SWR de la consulta agregada |
| **R11** | `tests/components/TableroOperativoLatencia.test.tsx` › «una carga del tablero dispara la serie y los dos granos agregados SOLAPADOS, y ni una invocacion mas de las declaradas» | Encadenar el agregado tras la serie (`await` de la serie antes de pedir el agregado): la dispersion de arranques pasa de ~0 a ~L |
| **R12** | `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` › «el subarbol operativo no recompone ninguna formula de negocio ni pide el agregado por otra puerta» | Escribir en un archivo del subarbol una recomposicion propia (`const den = entregas + devoluciones + rechazos + incidentes`) o una llamada al servicio en vez de a la Server Action |
| **R13** | `tests/components/TableroOperativo.test.tsx` › «si el agregado responde `forbidden` el panel dice prohibido y no pinta ninguna cifra» | Ignorar el resultado agregado en la reduccion de estado (dejar que el panel pinte la serie y omita el total en silencio) |
| **R14** | `tests/components/TableroOperativo.test.tsx` › «el panel de tasa por cubos semanales anuncia el grano usado» | No renderizar el texto de grano cuando la serie viene de cubos |
| **R15** | `tests/unit/analytics/tablero-agregado-cableado.test.ts` › «`agregarPorSemana` rechaza toda unidad que no sea conteo: la semana del cliente no toca tasas ni tiempos» **y** `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` › «`lunesDeLaSemana` tiene UN solo llamador en el subarbol y es la agregacion de conteos» | **Invocar `agregarPorSemana` (o `lunesDeLaSemana`) desde la ruta de `porcentaje`/`segundos`**: cae el caso de comportamiento; y por separado, quitar la comprobacion de unidad o anadir un segundo llamador hace caer el caso del guardia |
| **R16** | `tests/unit/analytics/tablero-agregado-frontera.guardia.test.ts` › «el subarbol no conserva el modo `rango_excedido` ni sus dos textos» | Reponer `TITULO_RANGO_EXCEDIDO`/`TEXTO_RANGO_EXCEDIDO` en `textos.ts` (o la rama `modo: "rango_excedido"` en `agregacion.ts`) |

**E2E:** no. `CHECKPOINTS.md` exige Playwright solo para flujos criticos (auth, pagos, recaudo,
ingesta, webhooks). Este tablero es de **solo lectura** y no es ninguno; la 131 ya lo declaro asi.
Se escribe aqui para que nadie lo de por olvidado.

### Dos trampas que esta trazabilidad vigila explicitamente

1. **Datos equilibrados que no prueban nada.** R5 es la misma aritmetica que la 176: con volumenes
   iguales, sumar-antes-de-dividir y media-de-medias **dan el mismo numero**. El fixture de R5 es
   `dia1: num 1 / den 1` (valor 1,0) y `dia2: num 1 / den 10` (valor 0,1); el cubo `periodo` trae
   `num 2 / den 11` = **0,1818…**, y la media de los valores diarios es **0,55**. El caso afirma
   las dos cosas: `≈ 2/11` **y** `not ≈ 0,55`. Un test que solo afirmase «hay una cifra» pasaria
   con la formula mala.
2. **Anclaje silencioso.** Las mutaciones de R1, R4 y R14 se parecen entre si; cada una nombra un
   caso distinto a proposito. El implementer debe comprobar que cae **el caso nombrado**, no otro
   del mismo archivo, y anotarlo asi.

---

## 4. Decisiones de esta spec (con su motivo, no solo la eleccion)

| # | Decision | Motivo | Alternativa descartada |
|---|---|---|---|
| **D1** | Por debajo del techo, la serie **sigue viniendo de la 126** con grano dia; el agregado solo aporta el **total** | No es una preferencia: **no existe grano `dia`** en `GranoAgregado` (hecho 3). Pedirle al agregado la serie corta obligaria a ampliar el contrato de una feature ya cerrada | «Todo por el agregado, un solo camino»: hoy es **imposible** sin tocar `lib/types` y `lib/services`, que estan fuera de alcance |
| **D2** | El total sale **del cubo `periodo`**, no de sumar `numerador`/`denominador` de los cubos semanales en la UI | Una sola fuente para la cifra, y la UI **no divide**. Recomponerla —aunque seria aritmeticamente exacta— pone en el cliente una division que la pantalla tendria que volver a justificar cada vez que alguien la lea | (B) `Σnum/Σden` en el cliente: exacta, pero reintroduce aritmetica de negocio en la UI, que es justo lo que R27 de la 131 se nego a hacer |
| **D3** | La respuesta agregada entra en la **misma precedencia de estados** que la serie | Las dos lecturas pasan por `prepararConsultaAnalitica` con el mismo actor y el mismo filtro: una discrepancia de permisos entre ambas es una anomalia, y presentar la mitad de un panel denegado seria peor que negarlo entero | (B) tratar el agregado aparte y omitir el total en silencio: convierte un denegado en «no hay cifra», que es el pecado que R2 de la 131 persigue |
| **D4** | La `unidad` se **declara** en `catalogo-paneles.ts` y se ancla al catalogo real **por test** | El guardia prohibe importar `lib/analytics/metrics` en el subarbol (hecho 12): es dato de servidor. El patron ya existe en la 131 (`catalogo-paneles.ts:25-30`) | (B) deducir la unidad de la respuesta de serie: obliga a **encadenar** la llamada agregada tras la serie y rompe R11 |
| **D5** | **`lunesDeLaSemana` NO se retira**: se acota a `conteo` y se **vigila** con R15 | Es el unico camino de los conteos por encima del techo y el modo agregado los **rechaza** (hechos 4 y 6). Retirarla dejaria sin serie a tres paneles en rangos largos. Lo que desaparece es la posibilidad de que se aplique a `porcentaje`/`segundos`, y eso **se afirma en un test**, no se confia | (B) retirarla del todo: rompe R16 de la 131 sin sustituto. (C) conservarla sin guardia: deja una segunda definicion de semana viva y sin vigilar |
| **D6** | El CSV del panel (134) **sigue exportando la serie diaria** de la 126, tambien por encima del techo | El 134 promete «mismo dato para el mismo alcance y el mismo filtro», **no la misma foto** (`ExportarOperativoPanel.tsx:27-30`). Las filas diarias son estrictamente **mas** informacion que los cubos semanales | (B) exportar los cubos: degrada el archivo y duplicaria el generador |
| **D7** | `aging_por_estado` **queda fuera** y sale **ficha aparte** | El tope de 6 paneles no es arbitrario: lo defiende un test de **latencia** (hecho 10) y la 131 **ya pago por el** —su D4 tiro `motivos_devolucion` «para no pasar de SEIS paneles»—. Un septimo panel reabriria esa decision **de pasada**, dentro de una feature que va de otra cosa, y dejaria a `motivos_devolucion` cortado por un tope que ya no regiria. Ademas, por D3 de la 176, el aging **nunca tuvo cifra en NINGUN rango**: no es el hueco que esta feature viene a cerrar | (A) anadir el septimo panel aqui; (C) sustituir un panel vivo por el de aging |

---

## 5. Consecuencias declaradas (no son requisitos, pero nadie debe descubrirlas por sorpresa)

1. **El modo `rango_excedido` queda inalcanzable y se retira** (R16). Solo se entraba con
   `excedeTecho && !esAgregableTemporal(unidad)` (hecho 5), y esta feature cubre exactamente ese caso.
2. **Cuatro aserciones vivas cambian de significado** (hecho 16): las dos de
   `tablero-agregacion.test.ts` y las dos de `TableroOperativo.test.tsx`. Se **reescriben**, no se
   borran: la propiedad que protegian —nunca media de medias— sigue viva, solo cambia como se cumple.
   La de `:342` (ausencia del titulo en el panel de conteos) queda **vacua** al desaparecer la
   constante y hay que retirarla explicitamente.
3. **Los dos `vi.mock` del borde se ponen rojos** en cuanto `PanelOperativo.tsx` importe el nuevo
   simbolo (hecho 11).
4. **El control de descarga aparece ahora en rangos largos** para esos paneles, porque el panel
   deja de cortar antes de renderizar (D6 explica que exporta).
5. **`aging_por_estado`, `tasa_devolucion`, `tasa_rechazo` y `primer_intento_ok` siguen sin panel**
   (hecho 9). El aging tiene ficha propia pendiente (D7); los otros tres son decision de producto
   que esta feature no toma.

### 5.1 Ficha que sale de D7 — **la da de alta el humano**; esta spec NO toca `feature_list.json`

- **name (propuesto):** `analitica: panel de aging por estado con su KPI al corte`
- **zone:** `frontend` · **depends_on:** `176` · **sdd:** `true`
- **Lo que haria falta, escrito para que no se improvise:**
  1. **Panel propio** en `catalogo-paneles.ts` (hoy no existe: hecho 9).
  2. **Presupuesto de latencia** revisado a conciencia: subir el tope de 6 paneles es reabrir la D4
     de la 131 y hay que decidir tambien que pasa con `motivos_devolucion`, que se cayo por ese tope.
  3. **Agregacion por DIMENSION, no temporal**: es un stock instantaneo; su cubo unico al corte ya
     existe en el servicio (hecho 14) y siempre viaja `parcial: true`. «El aging medio de agosto»
     no significa nada.

---

## 6. Puerta T0 — **CERRADA el 2026-08-05**

Las siete preguntas fueron respondidas por el humano. Quedan aqui con su respuesta y su motivo,
para que quien lea esto despues encuentre el porque y no una excepcion sin explicacion.
**Ninguna esta abierta.**

| # | Pregunta | Respuesta | Motivo (del humano) | Donde vive |
|---|---|---|---|---|
| **Q1** | ¿Se crea panel para `aging_por_estado`? | **(B) NO. Queda fuera y sale ficha aparte** | El tope de 6 paneles lo defiende un test de **latencia** (hecho 10) y la 131 ya pago por el tirando `motivos_devolucion`. Un septimo panel reabre esa decision de pasada, en una feature que va de otra cosa, y deja a `motivos_devolucion` cortado por un tope que ya no regiria. Y por D3 de la 176 el aging **nunca tuvo cifra en ningun rango**: no es el hueco que esta feature cierra | **D7** · §5.1 · el antiguo R14 (aging) **queda RETIRADO** |
| **Q2** | ¿Una oleada o dos? | **(A) una sola oleada**: `periodo` + `semana` siempre, en paralelo con la serie | (B) obliga a **reimplementar en el cliente la resolucion del rango** que ya hace el servidor, y **dos definiciones del techo se desincronizan solas** | **R11** · `design.md §5` |
| **Q3** | ¿De donde sale el total del aging? | **DECAE**: dependia de Q1 = (A) | Sin panel de aging no hay cifra de aging que ubicar. Se deja constancia en vez de borrarla: la pregunta **vuelve a estar viva** el dia que se especifique la ficha de §5.1, y alli habra que responderla | §5.1, punto 3 |
| **Q4** | ¿Se retira `lunesDeLaSemana`? | **(A) se conserva ACOTADA a `conteo`, con guardia** — y el guardia **afirma el acotamiento**, no la existencia | Un guardia que solo comprueba que la funcion existe deja **una segunda definicion de semana viva y sin vigilar**, que es justo lo que la ficha queria evitar. El acotamiento es lo que se prueba | **R15** (nuevo) · **D5** |
| **Q5** | ¿Se acepta la asimetria por debajo del techo? | **(A) si**: la serie corta sigue viniendo de la 126 | No hay grano `dia` en el agregado (hecho 3), y la coherencia entre ambas fuentes es **estructural**: las dos lecturas piden los mismos cubos al mismo metodo con la misma clave de cache (anclaje R8 de la 176) | **D1** |
| **Q6** | ¿Quien reescribe R27 de la 131? | **(A)** esta feature deja **nota fechada** en `specs/131/**` (solo prosa) | Dejar R27 afirmando un hueco que ya no existe es **como se cita una limitacion muerta seis meses despues** | `design.md §1.3` · **T5.2** |
| **Q7** | ¿Se retira `rango_excedido` y sus textos? | **(A) se retiran** | Es **codigo muerto que un guardia futuro puede censar creyendo que vigila algo vivo** — el patron muerto que acaba de aparecer en el guardia de la 134. Y como borrar codigo no lo mata ningun test, la retirada **necesita requisito con mutacion propia** | **R16** (nuevo) · hecho 16 · **T1.2/T4.3** |

---

## Preguntas abiertas

**Ninguna.** Las siete de la puerta T0 estan respondidas (§6). Lo unico que queda vivo hacia
adelante es la **ficha de §5.1** (aging), que la da de alta el humano y no bloquea esta feature.
