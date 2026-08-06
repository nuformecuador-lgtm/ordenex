# Feature 186 — analítica financiera: gráfica de líneas en el tablero · design

> Lee primero `requirements.md`; su §5 es la puerta humana, **cerrada el 2026-08-06**. Las
> decisiones `⟨D1⟩..⟨D8⟩` de aquí son la respuesta técnica a esos requisitos.
>
> Feature de **presentación**: no crea tablas, columnas, índices, migraciones ni políticas RLS.
> Ver §5.
>
> **Escrito contra el árbol de esta rama, que ya tiene `dev` mergeado con el hotfix (PR #305).**
> El `TableroFinanciero.tsx` que este diseño describe es el de después del hotfix, no el de antes.

---

## 1. Punto de partida: qué se leyó y qué hubo que corregir al leerlo

**C1 — El hueco de la 132 no está en su `design.md` §5.** §5 es el *inventario de paneles*. El
hueco está en su **§7, alternativa 6** y en la **Q3 de su `requirements.md`**. §5 es lo que la Q3
anuncia que cambiará — que es ahora. La cita de la ficha apunta al efecto, no a la declaración.

**C2 — La Q3 de la 132 remite a «la ficha 179» para el desglose por fecha.** Aterrizó como la
**180**; la 179 es la caché. Mismo desfase de numeración que la propia 132 documentó en su §1.

**C3 — El adaptador da hecho más de lo que parece.** `adaptar.ts` resuelve la frontera
`string → number` (`aNumero`, con `null` para lo no finito), la selección de campo por **forma** del
importe (`cifraDeImporte`, `esVistaConNeto`) y la construcción de una serie del paquete
(`serieDeVista`, con sobrecargas que impiden pedir el `neto` de una vista que no lo publica). Esta
feature **no reescribe nada de eso**: añade una función hermana que delega y solo sustituye la
etiqueta de cada punto (⟨D4⟩).

**C4 — El E2E: la afirmación cómoda era falsa.** El arnés **existe** (`@playwright/test`, script
`test:e2e`, 19 specs, uno de ellos `e2e/analitica-roles.spec.ts` de la 133, que ya cubre la región
financiera por rol). Lo que ocurre —y es peor— es que **no se ejecutan**: `init.sh` corre
`test:rapido`, y la revisión de la 133 lo declara («E2E: escrito, **no ejecutado**»; «hay 17 specs
de `e2e/` en el mismo estado»; decisión humana del 2026-07-30). La conclusión de Q5 no cambia; la
razón sí.

## 2. El hotfix del 2026-08-06, y qué hereda esta feature

`ContenidoDeVista` elige hoy así:

```
vista.id === VISTA_COD_RECAUDADO_POR_METODO      → donut
vista.id === VISTA_COD_RECAUDADO_POR_TIENDA      → barras + tabla
esSerieTemporal(vista) || vista.filas.length===0 → PanelKpi
                                                 → PanelTabla
```

con `esSerieTemporal(vista) { return vista.granularidad !== "no_temporal" }`, local a
`TableroFinanciero.tsx`.

**Lo que hay que entender de ese arreglo, porque esta feature se apoya en ello:**

1. **La señal es la granularidad, no las filas.** `filas.length` dejó de separar nada cuando la 180
   hizo densa la serie. Volver a apoyarse en él sería repetir el incidente con otro signo.
2. **Se pregunta por la NEGATIVA.** `no_temporal` es el único valor que *afirma* «esta vista no se
   mide en el tiempo». Con la forma positiva (`=== "dia" || === "semana"`), un valor nuevo del enum
   caería en la tabla — exactamente el defecto reparado. Esta feature **extiende** esa propiedad al
   panel nuevo y le pone test propio (**R5**), que el hotfix no tiene: sus casos solo ejercitan
   `dia` y `no_temporal`.
3. **La segunda condición sigue viva.** `filas.length === 0` cubre la vista **no temporal** sin
   filas (una tabla vacía donde va una cifra), y tiene su caso propio. No se toca.
4. **La fixture quedó atada al contrato** por «la fixture declara temporales EXACTAMENTE las siete
   que la 180 desglosó por fecha». **Ese caso ya existe y no se reescribe**; R17 lo cita como (a) y
   añade tres ataduras más.

**Lo que esta feature añade:** la línea encima del KPI restaurado, para las vistas temporales de
métricas **de flujo**. Nada más, y nada de lo anterior se deshace.

## 3. Decisiones

### ⟨D1⟩ La señal sube a `adaptar.ts`, se convierte en predicado de tipo, y sigue siendo por la negativa

`esSerieTemporal` se **mueve** de `TableroFinanciero.tsx` a `adaptar.ts` como
`esVistaTemporal(v): v is VistaTemporal`, conservando su comentario y su forma negativa.

Tres razones, y una advertencia:

- **R16 lo exige.** Si `adaptar.ts` va a nombrar `"dia"` y `"semana"` para rotular, y
  `TableroFinanciero.tsx` sigue nombrando `"no_temporal"`, hay **dos** archivos de la región
  hablando el vocabulario de la granularidad. Es la forma exacta en que «día» y «semana» acaban
  siendo el mismo píxel en un segundo sitio.
- **Hace falta que ESTRECHE el tipo.** `serieTemporalDeVista` debe poder exigir una `VistaTemporal`;
  un `boolean` no estrecha nada. El repo ya tiene el patrón al lado: `esVistaConNeto` es
  exactamente esto para la otra dimensión del DTO.
- **`adaptar.ts` es el módulo puro de la región**, testeable sin renderizar, que es donde debe vivir
  una decisión de forma.

**Advertencia declarada:** esto toca código que acaba de salir a producción en un hotfix. Es un
**movimiento puro más un estrechamiento de tipo**, sin cambio de conducta, y el criterio de hecho es
que **los seis casos del bloque `Hotfix — …` sigan verdes sin tocarlos**. Si alguno cambia, el
movimiento no fue puro y hay que parar.

### ⟨D2⟩ Una gráfica por vista. No hay gráfica combinada, y no es una omisión

Cada vista tiene ya su `<section aria-label>` (`SeccionVista`); la línea vive dentro. No se
construye ningún panel que junte métricas.

Tres razones independientes:

1. **El techo del paquete.** Seis métricas de flujo son seis series —más, contando `bruto` y `neto`
   donde el importe los trae—. `MAX_SERIES = 5` y `aplicarTopeSeries` **lanza** fuera de producción.
   Una gráfica combinada revienta en el primer test.
2. **No son comparables sin más.** El DTO no declara sumabilidad entre métricas, solo entre vistas.
3. **La acumulada no se lee igual** — y por ⟨D3⟩ ni siquiera se dibuja.

Esto hace que «ninguna gráfica mezcla vistas» sea cierto **por construcción**, no por vigilancia.

### ⟨D3⟩ `cuenta_por_pagar_mensajero` NO lleva línea, y el motivo se dice en pantalla

Decisión humana del 2026-08-06 (Q2 = **(b)**). Dos motivos, y el segundo es el que decide:

1. **La 127 lo dejó escrito junto al repositorio**, en la cabecera de
   `CuentasPorPagarAnaliticaRepository.ts:19`: el DTO declara `esAcumulado: true` *«para que la 132
   no lo grafique como serie»*. No es una lectura nueva; es una instrucción que llevaba ahí desde
   antes de que existiera el dato.
2. **La forma comunica lo que la cifra no dice.** Un saldo acumulado corrido es **monótono por
   construcción**: solo sube o se mantiene mientras el devengo supere al pago. Dibujado como línea,
   el ojo lee «tendencia al alza» donde solo hay «acumulación». Es el mismo error de categoría que
   el repositorio evita al no ponerle cota inferior: la cifra es correcta y la lectura, falsa.

**Y el motivo se dice EN PANTALLA (R3), no solo aquí.** Seis métricas vecinas tendrán gráfica y
esta no; sin explicación, la ausencia se lee como «falta un dato» o «se rompió algo». Es la misma
política que la 132 aplicó a los identificadores de tienda: la limitación se escribe en la pantalla
en vez de esconderla.

**Alcance exacto del texto, que es lo que hace el test discriminante:** aparece donde hay vista
temporal **y** `esAcumulado: true` —hoy, solo `cuenta_por_pagar_mensajero`— y **no** aparece ni en
las seis de flujo ni en `cuenta_por_pagar_tienda`, que también es acumulada pero cuya vista es
`no_temporal` y cuya ausencia de gráfica no necesita explicación (nunca tuvo serie). R4 lo fija.

**Lo que NO se toca:** el texto de «saldo al corte» que `CabeceraPanel` ya emite por `esAcumulado`
(R18 de la 132). Ese habla del **total**; el nuevo habla de **por qué no hay serie dibujada**. Son
dos afirmaciones distintas y reescribir la primera sería rehacer una feature `done`.

### ⟨D4⟩ La etiqueta del punto es prefijo textual + la clave literal del cubo

`etiquetaDeCubo(clave, granularidad, textos)`, función **pura**: sin `Date`, sin zona horaria, sin
aritmética de calendario.

Por qué no un rango (`2026-08-10 – 2026-08-16`), que es lo primero que apetece:

- **El DTO no publica el fin del cubo.** `FilaFinanciera` es `{ cubo, importe }`.
- **El primero y el último cubo están truncados al rango** (`trocear`). Un rango calculado sería
  **falso justo en los dos extremos**, que es donde se mira para saber si el período está completo.
- **Calcularlo sería una segunda definición del día CR en el frontend**, contra lo que ⟨D4⟩ de la
  180 está escrito: el off-by-one de seis horas por la puerta de atrás, en una capa donde ningún
  guardia de `lib/analytics` mira.

«Semana del `<clave>`» es cierto en **todos** los cubos, truncados incluidos: el cubo empieza donde
dice su clave, siempre. Y conserva la clave literal, que es lo que R24 de la 132 exige.

El texto lo pone el **llamador** por parámetro, no el módulo puro: mismo patrón y misma razón que
`agruparCola(puntos, tope, etiquetaOtros)` en el archivo de al lado.

### ⟨D5⟩ Las dos preguntas sobre la granularidad tienen defaults OPUESTOS, y es a propósito

Es la sutileza de esta feature y conviene leerla despacio:

| Pregunta | Forma | Valor desconocido cae en | Por qué |
|---|---|---|---|
| ¿Es serie temporal? (`esVistaTemporal`) | **negativa** (`!== "no_temporal"`) | **serie** | Caer en «tabla» es el defecto que el hotfix reparó: treinta fechas donde va una cifra (**R5**) |
| ¿Cómo se rotula? (`etiquetaDeCubo`) | **positiva** (`case "dia"`, `case "semana"`, `default`) | **grano no declarado** | Caer en «día» es afirmar un grano que no sabemos: la mentira exacta que la ficha nombra (**R9**) |

En los dos casos el default es **la respuesta segura de esa pregunta**, y son distintas porque las
preguntas lo son. Un `switch` exhaustivo con `never` en el rotulador daría seguridad en compilación
pero ninguna en ejecución si el DTO llegara con un valor nuevo desde una caché o una versión
desplegada antes; la rama `default` es la que responde eso, y por eso el caso de R9 la ejercita con
un `as` en el test, dejando dicho por qué el `as` está ahí.

### ⟨D6⟩ La serie temporal **delega** en `serieDeVista` y solo reemplaza la categoría

```
serieTemporalDeVista(vista, campo, textos)
  = serieDeVista(vista, campo)  →  { ...serie, puntos: puntos.map(relabel) }
```

Así la conversión de importes, el tratamiento del ausente y las sobrecargas por forma siguen en
**un solo sitio**. Una segunda función que leyera `fila.importe` por su cuenta duplicaría la
frontera `string → number`, que es el punto exacto del archivo donde una feature de dinero puede
mentir sin que se note.

Límite declarado: `serieDeVista` sigue siendo invocable sobre una vista temporal y devolvería las
claves crudas. El tipo no lo impide sin romper a sus llamadores actuales. Lo cubren el censo de R16
y el test de R7, no el compilador.

### ⟨D7⟩ El tablero **no** recorta puntos, y eso es una decisión

`agruparCola` **no** se aplica a una serie temporal: fundir fechas en «Otros» no significa nada en
un eje de tiempo y se comería el final de la serie, que es lo que se mira.

El techo lo garantiza el **servidor**: R19 de la 180 afirma que ningún rango admisible produce más
de `TOPE_PUNTOS_SERIE` filas, y R20 ata ese número a `MAX_PUNTOS_SERIE` con un test que lee las dos
fuentes. Recortar aquí sería recortar dos veces y, peor, **esconder el día en que esa garantía se
rompa**: si el servidor mandara 63 puntos, lo correcto es que `aplicarTopePuntos` lance fuera de
producción, que es para lo que está escrito. Por eso el test de R10 incluye el caso de **62 puntos
exactos**: fija la frontera por el lado bueno.

### ⟨D8⟩ Dónde se inserta la rama, y los nombres accesibles

En `ContenidoDeVista`, dentro de la rama del KPI que el hotfix dejó, sin reordenar las dos de
`cod_recaudado`:

```
if (esVistaTemporal(vista) || vista.filas.length === 0) {
  return <PanelKpi/>  +  (esVistaTemporal(vista) && !esAcumulado ? <GraficaLineas/> : null)
                      +  (esVistaTemporal(vista) &&  esAcumulado ? <MotivoSinSerie/> : null)
}
```

Se **añade dentro** de la rama existente en vez de crear una quinta rama: así la conducta del
hotfix (toda vista temporal es KPI) se conserva literalmente y lo nuevo cuelga de ella. `esAcumulado`
vive en la cabecera de la métrica, así que `ContenidoDeVista` recibe una prop más desde
`SeccionVista`, que ya la tiene.

`GraficaMarco` emite su propia `<section aria-label={titulo}>`: el título de la gráfica lleva el
sufijo de pieza (`${titulo} · ${TEXTOS.<pieza>}`) como ya hacen `Distribución`, `Comparativa por
categoría` y `Detalle por categoría`. Dos regiones con el mismo nombre son indistinguibles para un
lector de pantalla.

---

## 4. Contratos

### 4.1 `adaptar.ts` — lo que se añade y lo que se muda (módulo PURO)

```ts
/** ⟨D1⟩ MUDADA desde TableroFinanciero.tsx (hotfix 2026-08-06). Sigue siendo POR LA NEGATIVA. */
export type VistaTemporal = Omit<VistaFinanciera, "granularidad"> & {
  readonly granularidad: Exclude<GranularidadVista, "no_temporal">;
};
export function esVistaTemporal(v: VistaFinanciera): v is VistaTemporal;

/** Textos de UI que pone el llamador, como `etiquetaOtros` en `agruparCola`. */
export interface TextosCubo {
  readonly dia: string;          // puede ser "": la clave se lee sola
  readonly semana: string;       // prefijo; la clave se concatena LITERAL
  readonly granoNoDeclarado: string;   // ⟨D5⟩ rama por defecto
}

/** ⟨D4⟩/⟨D5⟩ Pura: sin `Date`, sin zona, sin aritmética. `switch` con `default`. */
export function etiquetaDeCubo(
  clave: string,
  granularidad: VistaTemporal["granularidad"],
  textos: TextosCubo,
): string;

/** ⟨D6⟩ `serieDeVista` + reetiquetado. Mismas sobrecargas por forma del importe. */
export function serieTemporalDeVista(v: VistaTemporal & VistaConNeto, campo: CampoImporte, textos: TextosCubo): SerieDato;
export function serieTemporalDeVista(v: VistaTemporal, campo: "bruto", textos: TextosCubo): SerieDato;
```

Las sobrecargas replican las de `serieDeVista`: de una vista sin `neto` solo se puede pedir el
`"bruto"`, y pedir el otro **no compila**. Mecanismo de la 183, reutilizado sin inventar otro.

### 4.2 `TableroFinanciero.tsx` — lo que se añade y lo que se va

- **Se va:** `esSerieTemporal` (⟨D1⟩), sustituida por el import de `esVistaTemporal`. Su comentario
  viaja con ella; el archivo no vuelve a nombrar ningún valor de granularidad.
- **Entradas nuevas en `TEXTOS`:** nombre de la pieza para el título de la gráfica, prefijo de cubo
  semanal, marcador de grano no declarado, y el motivo de R3.
- **`PanelLineas` / `MotivoSinSerie`** locales, colgando de la rama del KPI (⟨D8⟩).
- **`<GraficaLineas>`** recibe `titulo`, `series`, `unidad` y `vacio`. **No recibe `avisoRecorte`**
  (R12): una función no cruza la frontera RSC y falla en render, no en compilación. Es la misma
  abstinencia que el archivo ya practica y declara en su cabecera.
- Las series se componen con `esVistaConNeto` igual que `seriesComparativas`: dos donde el importe
  trae los dos campos, una donde no.

### 4.3 Lo que NO cambia

`cargar.ts`, `rango.ts`, `PanelConciliacion.tsx`, `AnaliticaShell.tsx` y `page.tsx` **no se tocan**.
No cambia qué se consulta, con qué rango, ni quién lo ve. El diff de producción cabe en dos
archivos.

---

## 5. Modelo de datos

**Ninguna migración. Ninguna tabla, columna o índice nuevo. Ningún cambio de RLS. Ningún
`down.sql`.** Esta feature no lee la base: consume un DTO que ya cruza el borde de la 122/127 con su
alcance por rol aplicado, desde el mismo Server Component y el mismo Server Action que la 132 dejó
cableados.

Frontera de seguridad: no cambia. La región la ven exactamente los roles que `esAccesoTotal` acepta,
el gate sigue en `page.tsx` y la defensa real sigue siendo el `forbidden` del borde. La serie no
introduce ninguna dimensión de entidad —cada clave de cubo es una fecha (R24/R28 de la 180)—, así
que **no hay ningún identificador de persona que pudiera filtrarse por esta vía**.

---

## 6. La guardia de censo del tablero: qué cubre de verdad

La ficha avisa de que `listasDeIdsAMano` solo marca arrays de dos o más ids. **Es cierto y hay que
matizarlo, porque la conclusión práctica es la contraria de la que sugiere.**

**Lo cierto:** `listasDeIdsAMano` (censo (d)) exige `presentes.length >= 2`, y su autocomprobación
lo fija («detecta una lista de ids a mano y **no un id suelto**»). Deuda real, aún sin dueño.

**Lo que la ficha no dice:** el **mismo archivo** tiene el censo (f), `decisionesPorIdDeMetrica`,
que la 183 añadió justamente para esto y que marca **un id suelto** en cinco formas —comparación en
los dos órdenes, `case`, pertenencia y literal de array **con uno solo basta**—, con
autocomprobación al lado. Para los archivos que ese guardia censa, una decisión por id suelto **no**
pasa verde.

**Por qué la medición de la 180 no lo contradice:** su mutación 18 sembró
`consulta.metrica.id === "egresos"` en `lib/services/AnaliticaFinancieraService.ts`, que **no está
en el censo del guardia del tablero** (recorre `app/(app)/analitica/_components/financiero/` más
`AnaliticaShell.tsx` y `page.tsx`). Pasó 24/24 porque **no miraba ese archivo**, no porque su
detector sea ciego.

**Conclusión, en dos mitades:**

1. **No hace falta censo propio para «decisión por id de métrica».** El censo (f) cubre los dos
   archivos que esta feature toca, y la carpeta se **recorre**, así que un archivo nuevo entra solo.
2. **Sí hace falta un censo nuevo, y es otro:** ningún guardia mira hoy los valores de
   `GranularidadVista`. Tras el hotfix el vocabulario está en `TableroFinanciero.tsx`, y esta
   feature lo muda a `adaptar.ts` (⟨D1⟩); el censo **(g)** es lo que impide que vuelva a haber dos.
   Se **añade** al guardia existente, importando el dominio en vez de reescribirlo —misma técnica
   que el censo (e) con `RolValue`— y con su autocomprobación sobre texto prohibido y texto limpio.

**Regla para el implementer:** al ampliar ese archivo **no se retira ni se relaja ninguna
aserción**, y las cuentas ancladas se conservan.

**Límite declarado:** el censo cubre `app/(app)/analitica/`. Si el código de la región se moviera
fuera, saldría del censo sin que nada se ponga rojo. Es el mismo límite que el guardia ya tenía.

---

## 7. La deuda que deja ⟨H1⟩: qué se ata aquí y qué necesita ficha

El incidente no fue «faltaba un censo de granularidad». Fue que **la fixture del tablero declaraba
una premisa que el servicio ya no cumplía** —`filas: []`— y nadie ató las dos cosas; la 180 llegó a
**editar esa fixture** sin ver que la invalidaba.

### 7.1 Lo que ya está atado (por el hotfix, no por esta feature)

- «la fixture declara temporales EXACTAMENTE las siete que la 180 desglosó por fecha», contra
  `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`;
- «la serie de la fixture es DENSA: una fila por día del rango, treinta para treinta días».

**Estos dos casos no se reescriben.** R17(a) los cita para que nadie los borre por duplicidad.

### 7.2 Lo que ata esta feature (R17 b, c, d)

Los otros invariantes que el contrato **publica** como constante exportada o como regla de tipo, y
que hoy nadie comprueba sobre los dobles:

- **(b)** las métricas con `esAcumulado: true` de la fixture ≡ `IDS_FINANCIERAS_ACUMULADAS`;
- **(c)** hay al menos una vista por cada valor de `GranularidadVista` — **hoy no existe ninguna
  `semana` en los dobles**, así que sin esto la rama semanal de esta feature se probaría sola en el
  adaptador y nunca de punta a punta;
- **(d)** una vista no mezcla formas de importe entre su `total` y sus filas (R18 de la 183).

Los tres se comprueban contra constantes en runtime, dentro del propio archivo de test, sin
ejecutar el servicio y sin mover fixtures de sitio.

### 7.3 Lo que NO se puede atar aquí, y su ficha

Todo lo anterior compara la fixture con **constantes publicadas**. Sigue sin comparar la fixture con
**lo que el servicio produce de verdad**: si mañana `serieDensa` pasara a emitir cubos semanales
para un rango de 30 días, los dobles seguirían declarando 30 cubos diarios y **los casos del
hotfix seguirían verdes**, porque comparan la fixture con una constante derivada del mismo rango,
no con la salida del servicio. Es un espejo bien construido, y un espejo no contradice.

**Lo que cerraría de verdad la clase entera** es un test de contrato que ejecute el servicio real
con los dobles de repositorio que ya existen (`tests/unit/services/_dobles-analitica-financiera.ts`),
extraiga un **perfil de forma** por métrica —`{ tipo, nº de vistas, granularidad de cada una, si
trae filas, forma del importe, esAcumulado }`— y lo compare contra el perfil que declaran los dobles
del tablero.

**Por qué no entra en esta feature, dicho sin adorno:** exige **extraer los dobles del tablero** de
`tests/components/TableroFinanciero.test.tsx` (y de `AnaliticaPage.test.tsx`) a un módulo compartido,
y **construir una `ConsultaAnalitica` real** en un test de la zona frontend. Es una reforma de
arquitectura de pruebas que cruza las dos zonas, choca con la **187** (que está tocando
`deCaja`/`deTesoreria`) y convertiría una feature `low` de presentación en otra cosa. Hacerlo con
prisa dentro de esta es exactamente cómo nació ⟨H1⟩.

**Ficha propuesta** (para que el leader la registre; no la escribo yo en `feature_list.json`):

> **«tests: perfil de forma del DTO financiero, compartido entre el servicio y el tablero»** —
> zona `fullstack`, complejidad `medium`, `depends_on: [180, 186, 187]`.
> Extraer los dobles de DTO del tablero a `tests/fixtures/analitica-financiera-dtos.ts`, derivar un
> *perfil de forma* por métrica de la salida real del servicio con los dobles de repositorio ya
> existentes, y ponerlos rojos cuando divergen. Motivo: el 2026-08-05 la 180 cambió la forma del DTO,
> editó la fixture del tablero para que compilara y la suite entera siguió verde mientras producción
> pintaba una tabla de treinta fechas (⟨H1⟩, hotfix PR #305). Hoy la fixture se compara contra
> constantes publicadas, nunca contra lo que el servicio produce.

---

## 8. Alternativas descartadas

1. **Dibujar `cuenta_por_pagar_mensajero` como línea.** *Descartada por decisión humana (Q2 = (b)),
   con dos motivos:* la 127 dejó escrito que `esAcumulado` existe «para que la 132 no lo grafique
   como serie» (`CuentasPorPagarAnaliticaRepository.ts:19`), y un saldo acumulado corrido es
   **monótono por construcción**, así que la forma de la línea comunica «tendencia» donde solo hay
   «acumulación». La variante «misma gráfica, otra forma de trazo» era además **inconstruible**:
   `SerieDato` no lleva forma ni color —lo pone `paleta.ts` por orden— y siete series superan
   `MAX_SERIES = 5`. Ver ⟨D3⟩.

2. **Una sola gráfica con las seis métricas de flujo juntas.** *Descartada:* seis series (más, con
   `bruto` y `neto`) superan `MAX_SERIES` y `aplicarTopeSeries` **lanza** fuera de producción; el
   DTO no declara sumabilidad entre métricas; y obligaría a inventar un panel que no pertenece a
   ninguna. Ver ⟨D2⟩.

3. **Rotular el cubo semanal con su rango de fechas.** *Descartada:* el DTO no publica el fin del
   cubo y el primero y el último están **truncados al rango**, así que sería falso justo en los dos
   extremos; y calcularlo metería una segunda definición del día CR en el frontend, contra ⟨D4⟩ de
   la 180. Ver ⟨D4⟩.

4. **Decidir la línea por `grano === "fecha"`, por `filas.length > 0` o por
   `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` / `tieneDesglosePorFecha`.** *Descartada:* `grano` es la
   dimensión y no el grano temporal; `filas.length` es literalmente lo que produjo ⟨H1⟩; y la lista
   de ids es decidir por el nombre del catálogo, que R27 de la 132 y R22 de la 183 prohíben y el
   censo (f) detecta.

5. **Escribir la señal en positivo (`=== "dia" || === "semana"`) ahora que hay que enumerarlas para
   rotular.** *Descartada, y es la trampa más fácil de esta feature:* el rotulador **sí** enumera
   (⟨D5⟩), y de ahí a «pues enumeremos también en el predicado» hay un paso. Con la forma positiva,
   un valor futuro del enum vuelve a caer en la tabla — el defecto de ⟨H1⟩, reintroducido por
   simetría estética. R5 existe para que esa mutación muera.

6. **Aplicar `agruparCola` a la serie temporal «por si acaso».** *Descartada:* «Otros» no significa
   nada en un eje de tiempo, se comería el final de la serie y **escondería** el día en que la
   garantía del servidor (R19/R20 de la 180) se rompa. Ver ⟨D7⟩.

7. **Declarar la granularidad solo en el título de la gráfica.** *Descartada:* el eje X y la
   alternativa textual (`SerieTextual` dicta `"<serie>, <categoría>: <valor>"`) son lo que se lee
   **punto a punto**. Un título correcto sobre un eje que dice «2026-08-10» para siete días de
   dinero sigue siendo la mentira que la ficha nombra, mejor presentada.

8. **Formatear la fecha con `toLocaleDateString(...)` o `Intl.DateTimeFormat("es-CR", …)`.**
   *Descartada por dos motivos independientes:* pondría **rojo** el censo (c) del guardia (literal
   de locale), y el repo no tiene formateador de fechas de UI que reutilizar. La clave `YYYY-MM-DD`
   es la que el DTO publica y R24 de la 132 pide pintar el identificador del cubo tal cual.

9. **Dejar `esSerieTemporal` donde el hotfix la puso.** *Descartada:* dejaría dos archivos de la
   región hablando el vocabulario de la granularidad (R16) y un `boolean` que no estrecha el tipo,
   con lo que `serieTemporalDeVista` no podría exigir una `VistaTemporal`. Se muda con el criterio
   de hecho de que los seis casos del hotfix sigan verdes sin tocarlos. Ver ⟨D1⟩.

10. **Escribir un censo propio para «decisión por id suelto», calcado del de la 180.** *Descartada
    tras medirlo:* el censo (f) ya lo cubre para los archivos de esta región, y duplicarlo daría dos
    censos con el mismo nombre y detectores distintos. Ver §6.

11. **Cerrar aquí la deuda de ⟨H1⟩ con un test de contrato dobles ↔ servicio.** *Descartada por
    tamaño y por zona,* con ficha propuesta en §7.3.

---

## 9. Impacto en lo que ya está verde

| Artefacto | Impacto | Acción |
|---|---|---|
| `tests/components/TableroFinanciero.test.tsx` | Bloque `Hotfix — …` (6 casos) **debe seguir verde sin tocarse**: es el criterio de que ⟨D1⟩ fue un movimiento puro | Ampliar con los casos de R1–R6, R13, R14, R17(b)(c)(d). Añadir un doble con `granularidad: "semana"` |
| `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | Verde; se le **añaden** los casos del adaptador temporal | R7–R11 |
| `tests/unit/guards/tablero-financiero.guardia.test.ts` | Verde; gana el censo (g) | Ampliar sin retirar ninguna aserción |
| `tests/components/AnaliticaPage.test.tsx` | Sus dobles ya llevan la serie densa (hotfix). Esta feature no cambia el gate ni el pre-fetch | Sin cambios previstos; si alguno se pone rojo, se explica antes de tocarlo |
| `tests/unit/components/analytics-paquete-guard.test.ts` | **No se toca y debe seguir verde.** Prohíbe consultar nodos de recharts en tests cuyo nombre case `Analytics\|analytics-`, y exige que los tres lienzos sean los únicos que hablan recharts | Afirmar sobre nombres accesibles y texto; doblar `LineasLienzo` como ya se doblan `BarrasLienzo` y `DonutLienzo` |
| `tests/unit/analytics/tablero-financiero-cargar.test.ts`, `-rango.test.ts` | Sin relación: esos archivos no se tocan | Sin cambios |

**Riesgo que ningún test del repo cubre:** la frontera RSC. Mismo que la 132 declaró en su R11, y
esta feature monta un Client Component nuevo desde un Server Component. Se cubre con los censos
(a)/(b) **más** un `pnpm exec next build` a mano cuya salida se pega en `progress/impl_186.md`.
**Nunca `pnpm build`.**

---

## 10. Interacciones declaradas con las fichas vivas

| Ficha | Estado | Interacción |
|---|---|---|
| **180** | done | Se consume su DTO tal cual. Esta feature es la que su Q4 = (a) mandó abrir. ⟨H1⟩ fue colateral suyo y ya está reparado en producción. |
| **hotfix #305** | en producción | Base de esta feature. Su señal se muda de archivo (⟨D1⟩) y su propiedad más frágil —la lectura por la negativa— gana test propio (R5). |
| **187** | pending | Envuelve las dos lecturas de `deCaja`/`deTesoreria` en una transacción (⟨L3⟩ de la 180). Sin intersección de archivos. **Consecuencia que no se tapa:** mientras no aterrice, el `total` del KPI y la Σ de los puntos de la línea pueden discrepar en centavos por una escritura entre ambas consultas. Esta feature **no debe** derivar el total de los puntos para cuadrarlo: eso convertiría el R12 de la 180 en una tautología. |
| **179** | pending | Caché. No se añade ni se retira ningún `cacheTag`. |
| **184** | pending | Export. Consumirá la misma serie; la etiqueta de ⟨D4⟩ es de **presentación** y el export debe llevar la clave cruda, no el rótulo. Declarado para que no se copie la función. |
| **131 / 133** | done | El slot `filtros` y el recorte por rol no se tocan; el filtro financiero sigue siendo `mes` (Q4). La 133 ya escribió `e2e/analitica-roles.spec.ts`. |
| **ficha propuesta §7.3** | por registrar | Cierra la clase entera de ⟨H1⟩. Depende de esta y de la 187. |

---

## 11. Verificación

Además de la tabla `R<n> → test` de `requirements.md` §4:

- **Tests puros del adaptador** para todo lo que puede mentir sin renderizar: la etiqueta que
  ignora la granularidad, la que inventa una segunda fecha, la que trata un valor desconocido como
  un día, el punto que se pierde o se agrupa, el importe ilegible convertido en cero.
- **Tests de componente** sobre **nombres accesibles y texto**, nunca sobre nodos de recharts: la
  alternativa textual emite `"<serie>, <categoría>: <valor>"` en una `<ul aria-label>`, que es donde
  se comprueba que el eje dice lo que debe.
- **Ataduras de la fixture** (R17): tres nuevas, y las dos del hotfix conservadas.
- **`pnpm exec next build`** a mano, con la salida en la bitácora.
- `./init.sh --rapido` por tanda; **`./init.sh` completo antes del PR**.
