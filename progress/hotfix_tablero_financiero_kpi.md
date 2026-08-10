# Hotfix — el tablero financiero pintaba tablas de 30 fechas donde van las cifras

Rama `hotfix/tablero-financiero-kpi`, ramificada de `origin/prod`. Vivo en produccion desde
las 04:09 del 2026-08-06.

## 1. El mecanismo

`app/(app)/analitica/_components/financiero/TableroFinanciero.tsx`, en `ContenidoDeVista`:

```tsx
if (vista.filas.length === 0) return <PanelKpi vista={vista} unidad={unidad} />;
return <PanelTabla titulo={titulo} vista={vista} unidad={unidad} />;
```

La 132 eligio ese `if` como señal de FORMA (R27: se decide por la forma del DTO, nunca por el
nombre de la metrica) y en su momento era una señal valida: el servicio devolvia las siete
vistas de grano `fecha` agregadas sobre la ventana entera y SIN cubo, porque se negaba a
atribuir el agregado a una fecha inventada. «Sin filas» y «cifra de titular» eran lo mismo.

**La feature 180 invalido la señal.** `AnaliticaFinancieraService` construye ahora `serieDensa`
(`lib/services/AnaliticaFinancieraService.ts:182-189`), que emite **una fila por cubo del rango,
incluidos los cubos sin movimiento**. Con el rango por defecto de 30 dias eso son ~30 filas. Las
siete metricas de `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` —las seis de caja mas
`cuenta_por_pagar_mensajero`— pasaron por tanto de `filas: []` a `filas: [30]`, cayeron en
`PanelTabla` y el maestro perdio el numero de titular («Dinero en caja», «Ganancia de Ordenex»,
…) a cambio de una tabla de fechas.

Verificado leyendo los dos archivos, no por el reporte:

- `granularidad` es campo **obligatorio** de `VistaFinanciera` desde la 180
  (`lib/types/analitica-financiera.ts:172`), con dominio `dia | semana | no_temporal`, y el
  contrato obliga a declararlo explicitamente en cada productor: omitirlo no compila.
- las tres vistas que hoy son un DESGLOSE (`cod_recaudado` por metodo y por tienda,
  `cuenta_por_pagar_tienda`) declaran `"no_temporal"` explicitamente
  (`AnaliticaFinancieraService.ts:456, 480, 510`);
- las siete de serie declaran `granularidadDe(consulta.rango)` (`:360, 421, 598`).

O sea: `granularidad` es exactamente la señal de forma que hoy separa «serie temporal» de
«desglose», y es la que `filas.length` dejo de ser.

## 2. Por que la suite no se entero

`tests/components/TableroFinanciero.test.tsx` definia el fixture `vistaSinFilas` con
`grano: "fecha"`, `granularidad: "dia"` y `filas: []` — y lo usaban las SIETE metricas
afectadas, por `dtoKpi`. **Lo toco la propia 180** para añadirle `granularidad`, dejando al lado
el comentario «el tablero NO la lee».

El componente y su prueba compartian una premisa que el servicio ya no cumplia. Dos piezas que
se equivocan igual no se contradicen nunca: por eso el arreglo del componente sin el del fixture
habria dejado el agujero abierto, y por eso el fixture cambia aqui.

## 3. El arreglo

`ContenidoDeVista` decide ahora con las DOS conductas que la 132 declaro, y ninguna tercera:

```tsx
if (esSerieTemporal(vista) || vista.filas.length === 0) {
  return <PanelKpi vista={vista} unidad={unidad} />;
}
```

con

```tsx
function esSerieTemporal(vista: VistaFinanciera): boolean {
  return vista.granularidad !== "no_temporal";
}
```

Dos decisiones que conviene dejar escritas:

- **Se pregunta por la NEGATIVA** («no es `no_temporal`») y no por la lista de granos
  temporales. `GranularidadVista` puede ganar un valor nuevo; con la forma positiva ese valor
  caeria por defecto en la tabla, que es literalmente el defecto que se esta reparando.
  `no_temporal` es el unico valor que AFIRMA «esta vista no se mide en el tiempo».
- **La segunda condicion se conserva.** Una vista no temporal y sin filas sigue siendo un KPI, no
  una tabla con el cartel de vacio. Es la otra conducta previa, tiene su propio caso y su propia
  mutacion.

Sigue sin haber ni una decision por id de metrica: `granularidad` es un campo del DTO. El guardia
estatico (`tests/unit/guards/tablero-financiero.guardia.test.ts`) se actualiza en su
autocomprobacion para cubrir la rama nueva como decision LEGITIMA por forma, y sus dos
descripciones de la frontera pasan a nombrar `granularidad`.

**NO se añade la grafica de lineas.** Eso es la ficha 186, con spec propio y puerta humana. Aqui
solo se restaura lo que la 132 declaro.

## 4. El barrido (punto 3 del encargo)

Censados todos los consumidores de `VistaFinanciera` / `vista.filas` del arbol:

| Sitio | Que hace con `filas` | Veredicto |
|---|---|---|
| `TableroFinanciero.tsx:313` | decidia KPI vs. tabla por `filas.length` | **EL DEFECTO. Arreglado.** |
| `adaptar.ts` · `esVistaConNeto` | `filas.every(f => f.importe.forma === …)` | Sano. Con `filas: []` daba `true` por vacio y decidia solo por el total; con filas reales sigue coincidiendo, porque R18 de la 183 garantiza que una vista no mezcla formas (y lo vigila `financiera-forma-importe.guardia.test.ts`). No cambia de respuesta. |
| `adaptar.ts` · `serieDeVista`, `filasDeVista`, `columnasDeVista` | mapean filas | Sanos: no deciden nada por la CANTIDAD, y solo los alcanzan las vistas de desglose (`PanelTabla` y las dos graficas de `cod_recaudado`). |
| `cargar.ts` | — | No lee `filas` ni `granularidad`. |
| `PanelConciliacion.tsx` | `filasDeConciliacion` sobre `ResultadoConciliacion` | Otro DTO (la union por `tipo`), sin `VistaFinanciera` de por medio. |
| `lib/actions/analitica-financiera.ts`, `lib/config/analitica-cache.ts` | — | No leen `filas`. |
| `components/private/analytics/TablaResumen.tsx:78` | `if (totales && filas.length > 0)` | Sano y ademas inalcanzable desde aqui: el tablero NO pasa `totales` (desviacion declarada de la 132, R14). Es codigo del paquete compartido de la 130. |

Fixtures que fijaban la premisa vieja (`grano: "fecha"` + `granularidad: "dia"` + `filas: []`,
que el servicio ya no produce):

1. `tests/components/TableroFinanciero.test.tsx` — **el que escondia el defecto. Arreglado**:
   `vistaSinFilas` pasa a `vistaTemporal` y lleva la serie densa de 30 cubos derivada del propio
   `RANGO`. Los importes de las filas son ajenos a todos los totales del archivo (terminan en 13
   y 17 centimos) para que ninguna asercion pueda acertar por azar, y cada fila hereda la `forma`
   del total (R18 de la 183: una vista no mezcla formas).
2. `tests/components/AnaliticaPage.test.tsx` — **misma premisa, arreglado**: la pagina renderiza
   `TableroFinanciero`, asi que su comentario «la pagina NO la consume» tambien era falso. Se le
   pone la serie densa. Sus aserciones (R2/R6/R7: para un rol sin acceso no queda rastro del
   dinero) no cambian de sentido; ahora se hacen sobre el DTO que el servicio produce de verdad.
3. `tests/unit/analytics/tablero-financiero-cargar.test.ts:58` — **ANOTADO, NO TOCADO**: `filas: []`
   es inerte ahi. `cargar.ts` no lee `filas` ni `granularidad`, el archivo mide la normalizacion
   de las cuatro respuestas del borde a los tres estados de panel, y su comentario («`cargar.ts`
   no la lee») sigue siendo CIERTO. No es el mismo defecto: no esconde ninguna decision.

Nada mas del arbol decide por `filas.length` ni asume que esas vistas vengan vacias.

## 5. Verificacion por mutacion

Sobre `tests/components/TableroFinanciero.test.tsx` (67 casos).

| # | Mutacion | Resultado | Que casos caen |
|---|---|---|---|
| M1 | Revertir el arreglo: `if (vista.filas.length === 0)` — **el codigo de produccion de hoy** | **ROJO, 23 casos** | los 21 del bloque nuevo del hotfix (`NO pinta ninguna tabla`, `NO pinta las fechas de la serie`, `no pinta el total al pie`, x7 metricas) mas dos preexistentes que el fixture arreglado vuelve discriminantes: R22 (el rango) y R16/R20 (el KPI de `egresos`) |
| M2 | Quitar la segunda condicion: `if (esSerieTemporal(vista))` | **ROJO, 1 caso** | «una vista NO temporal y SIN filas sigue siendo un KPI, no una tabla vacia» |
| M3 | Mandarlo todo a KPI: `… \|\| vista.filas.length >= 0` | **ROJO, 4 casos** | «una vista NO temporal CON filas sigue siendo una tabla» mas tres de la 132/183 sobre la tabla de `cuenta_por_pagar_tienda` |
| M4 | Invertir la señal: `granularidad === "no_temporal"` | **ROJO, 27 casos** | la union de M1 y M3 |

Los casos «`X` pinta la cifra de titular de su KPI» sobreviven a M1 A PROPOSITO y esta escrito en
el test: `TotalDelDto` pinta el mismo numero al pie de la tabla, asi que la cifra sola no
distingue las dos pantallas. Lo que las distingue es la AUSENCIA del `<table>`, de las fechas de
cubo y de la etiqueta «Total bruto». De ahi que el bloque tenga cuatro aserciones y no una.

Contrapesos que impiden que el bloque pase por vacio:

- «la fixture declara temporales EXACTAMENTE las siete que la 180 desgloso por fecha» — compara
  la fixture contra `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`, el registro del contrato. Si una
  metrica entra o sale de ese conjunto, esto se pone rojo y la fixture se actualiza, en vez de
  seguir describiendo el reparto de ayer (que es como nacio este defecto).
- «la serie de la fixture es DENSA: una fila por dia del rango, treinta para treinta dias» — sin
  esto, un `filas: []` de vuelta haria que las vistas cayeran en el KPI por la OTRA condicion y
  todo el bloque quedaria en verde sin medir nada.

Tras restaurar, arbol comprobado **por hash** (`git hash-object`), identico al de antes de las
cuatro mutaciones:

```
514b80d1a6fa9f90f12a63edc4a7375a26f961d0  app/(app)/analitica/_components/financiero/TableroFinanciero.tsx
e34d9f956eec6888c35d21345775b3e0a24a6206  tests/components/TableroFinanciero.test.tsx
13a735fb1333074cc6e40f0879183fa213a522cc  tests/unit/guards/tablero-financiero.guardia.test.ts
```

## 6. Gates corridos

- `pnpm typecheck` — verde.
- `pnpm lint` — 0 errores, 48 avisos, **ninguno en los archivos tocados** (todos preexistentes y
  de `no-unused-vars` en dobles de test ajenos).
- `pnpm exec vitest related --run` sobre los cuatro archivos tocados — 3 archivos, 143 casos,
  verde.
- `pnpm exec vitest --run` sobre los vecinos del dominio (`tablero-financiero-adaptar`,
  `tablero-financiero-cargar`, `financiera-desglose-ids.guardia`,
  `financiera-forma-importe.guardia`) — 4 archivos, 51 casos, verde.

**La suite completa NO se corrio aqui**: la corre el humano, como pide el encargo. No se abrio PR.

## 7. Deuda que este hotfix NO cierra

- El panel de lineas de la serie temporal es la **ficha 186** y sigue pendiente: hoy el maestro
  ve la cifra de titular pero NO puede ver la serie que la 180 ya produce y transporta. El dato
  viaja en el DTO y la pantalla lo ignora.
- Vale la pena una guardia que ate «lo que el servicio produce» con «lo que el fixture del
  tablero declara» mas alla del conjunto de ids —hoy el contrapeso compara qué metricas son
  temporales, no la FORMA completa de sus vistas—. Es lo que habria matado este defecto en la
  180. Queda anotado, no se hace aqui: es alcance de ficha, no de hotfix.
