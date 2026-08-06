# Feature 186 — analítica financiera: gráfica de líneas en el tablero · requirements (EARS)

> Zona: `frontend`. Complejidad: `low`. `sdd: true`. `depends_on: 180` (**done**, ya mergeada
> en la base de esta rama). Rama `feature/186-tablero-financiero-grafica-lineas`, cortada de
> `dev` @ `d2898c48`.
> Estado: **spec sin aprobar**. La puerta humana son las `Q1..Q5` del final.
> Todo lo de la sección 1 se comprobó **en el árbol de esta rama**, localizando por símbolo y no
> por número de línea (la 180 dejó escrito que sus líneas se habían movido).

---

## 0. Contexto heredado (no se reabre)

- **La 180 es `done` y su DTO ya está en esta rama.** `VistaFinanciera` tiene `granularidad`
  requerida, `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` existe y el servicio publica filas por cubo
  para las siete métricas. Esta feature **consume** ese contrato: no lo amplía, no lo corrige y no
  toca `lib/`.
- **La Q4 de la 180 la cerró el humano el 2026-08-05 con la opción (a):** aquella ficha era **solo
  backend** y el panel de líneas iba en ficha nueva. Esta es esa ficha.
- **El tablero financiero es de dos roles** (`esAccesoTotal`: `maestro` y `admin`), y eso no se
  reabre aquí: R1–R5 de la 132 siguen vigentes palabra por palabra.
- **El tablero decide por la FORMA del DTO, nunca por el nombre de la métrica** (R27 de la 132,
  R22 de la 183). Esta feature no introduce la primera excepción.
- **La región financiera no se rehace.** El hueco está declarado por la 132: en su
  `design.md` **§7, alternativa 6** («Pintar una gráfica de líneas de evolución diaria del recaudo.
  *Descartada por falta de dato, no por gusto*… Queda como Q3 y, si se quiere, como ficha aparte»)
  y en la **Q3 de su `requirements.md`**, cerrada el 2026-08-03 «se acepta sin gráfica de líneas».
  **Corrección de la cita de la ficha:** el §5 del design de la 132 es el *inventario de paneles*
  y no contiene ninguna declaración de hueco; es lo que la Q3 dice que **se verá afectado** cuando
  el dato exista. Quien vaya a §5 buscando el hueco no lo encuentra. (De paso: la Q3 remite a «la
  ficha 179» para el desglose por fecha; ese trabajo aterrizó como la **180**. La 179 es la caché.)

## 1. Hechos verificados en el código de ESTA rama (no supuestos)

| # | Hecho | Dónde se comprobó |
|---|---|---|
| 1 | `VistaFinanciera.granularidad` es **requerida** y su dominio es `dia \| semana \| no_temporal` | `lib/types/analitica-financiera.ts`, símbolos `GranularidadVista` y `VistaFinanciera` |
| 2 | `FilaFinanciera` tiene **solo** `cubo` e `importe`: el DTO **no publica el fin del cubo** | `lib/types/analitica-financiera.ts`, símbolo `FilaFinanciera` |
| 3 | La clave de un cubo es la fecha CR del **primer día incluido**, y el **primero y el último** cubo están **truncados al rango** | `lib/analytics/cubo-temporal.ts`, `trocear` |
| 4 | El servidor garantiza `granularidad = dia` hasta `TOPE_PUNTOS_SERIE` días y `semana` por encima; nunca más de `MAX_PUNTOS_SERIE` puntos | `granularidadDe`; R19/R20 de la 180 |
| 5 | `deCaja`, `deTesoreria` y `deCuentaDeMensajeros` publican hoy `granularidad: granularidadDe(...)` y `filas: serieDensa(...)` | `lib/services/AnaliticaFinancieraService.ts` |
| 6 | Las vistas de `cod_recaudado` y `cuenta_por_pagar_tienda` publican `granularidad: "no_temporal"` | ídem |
| 7 | `esAcumulado` vive en la **cabecera de la métrica**, no en la vista, y es `true` exactamente en las dos cuentas por pagar | `CabeceraFinanciera`, `IDS_FINANCIERAS_ACUMULADAS` |
| 8 | `cuenta_por_pagar_mensajero` es un **saldo al corte**: su repositorio agrega **sin cota inferior** y su serie es un acumulado corrido | `CuentasPorPagarAnaliticaRepository`, ⟨D5⟩ de la 180, `progress/impl_180.md` §4 |
| 9 | `GraficaLineas` **existe** desde la 130, es `"use client"`, no importa recharts (lienzo diferido) y emite alternativa textual | `components/private/analytics/GraficaLineas.tsx`, `SerieTextual.tsx` |
| 10 | `PuntoDato.categoria` viene **ya formateada por el llamador**; el paquete «no sabe de fechas ni de zona horaria» | `components/private/analytics/tipos.ts` |
| 11 | `adaptar.ts` ya sabe convertir importes (`aNumero`), producir series (`serieDeVista`, con sobrecargas por forma del importe) y filas de tabla (`filasDeVista`) | `app/(app)/analitica/_components/financiero/adaptar.ts` |
| 12 | El paquete **lanza** fuera de producción por encima de `MAX_SERIES = 5` series y `MAX_PUNTOS_SERIE = 62` puntos | `components/private/analytics/topes.ts` |
| 13 | El filtro del tablero financiero es la constante `FILTRO_FINANCIERO_POR_DEFECTO = { rango: "mes" }`, ventana móvil de 30 días | `app/(app)/analitica/_components/financiero/rango.ts` |
| 14 | El guardia del tablero **recorre** la carpeta `financiero/` entera: un archivo nuevo entra solo en el censo | `tests/unit/guards/tablero-financiero.guardia.test.ts`, caso «la carpeta financiero se RECORRE» |

### 1.1 Hallazgo H1 — la 180 encendió una tabla de fechas en el tablero, y ningún test se puso rojo

`ContenidoDeVista` (`TableroFinanciero.tsx`) elige el componente así, **en este orden**: vista por
método → donut; vista por tienda → barras + tabla; **`vista.filas.length === 0` → KPI**; cualquier
otra → tabla.

Hasta la 180, las siete métricas del desglose publicaban `filas: []` y caían en la rama del KPI.
**Hoy publican una fila por cubo**, así que caen en la **última** rama: con el rango por defecto
(`mes`, 30 días, granularidad `dia`) el tablero pinta hoy, para cada una de las siete, **una tabla
de ~30 filas de fechas** donde la 132 declaró una tarjeta de KPI (`design.md` §5 de la 132,
paneles 1–4 y 8).

**Por qué no hay ningún test rojo:** los dobles de `tests/components/TableroFinanciero.test.tsx`
siguen construyendo esas vistas con `filas: []` (`vistaSinFilas`), y su propio comentario lo dice
—«el tablero NO la lee (Q4 = (a)…)»—. El caso «el panel de KPI muestra el neto como cifra y el
bruto etiquetado aparte» pasa verde midiendo **un DTO que el servidor ya no publica**.

No es una interpretación: es la consecuencia mecánica de las dos ramas citadas. Qué se hace con
ello es la **Q1**, y es la única pregunta bloqueante de esta spec.

## 2. Alcance

DENTRO:

1. El **panel de líneas** de cada vista financiera que declara granularidad temporal, dentro de la
   sección que esa vista ya tiene.
2. El adaptador **puro** de vista temporal a serie del paquete, incluida la etiqueta de cubo que
   **lee `granularidad`**.
3. La lectura de las siete métricas del desglose como **KPI + línea**, en vez de la tabla de fechas
   de H1 (sujeto a **Q1**).
4. El censo que falta para que la granularidad no se decida en dos sitios, y el mapa de
   trazabilidad.

FUERA, con su razón:

- **Cualquier archivo de `lib/`, `db/` o `components/private/analytics/`.** El dato ya está
  publicado (180) y las gráficas ya existen (130). Esta feature **cablea**.
- **Cablear el rango del tablero financiero a la barra de filtros.** El slot `filtros` es de la
  131 y el filtro financiero sigue siendo `FILTRO_FINANCIERO_POR_DEFECTO`. **Consecuencia que hay
  que decir en voz alta:** con el rango fijo en `mes`, la granularidad `semana` **no es alcanzable
  hoy en producción**; se construye y se prueba con dobles, como seguro para el día que el rango
  sea elegible. Ver **Q4**.
- **Marcar como parcial el cubo en curso.** El DTO no lleva ese marcador: la Q2 de la 180 se cerró
  en (a) y el servicio financiero sigue sin reloj. Inventarlo aquí sería inventar dato.
- **Línea para `cod_recaudado` y `cuenta_por_pagar_tienda`.** No tienen vista temporal: la Q1 de la
  180 las dejó fuera del desglose a propósito, y sus vistas declaran `no_temporal`.
- **Export de la serie (184), caché (179), nombres legibles de tienda (178/181).**
- **E2E.** La Q5 de la 132 lo remitió a la 133 «cuando el tablero tenga su forma definitiva por
  rol». No se declara aquí cobertura E2E que no existe: si el humano la quiere, es **Q5**.

---

## 3. Requisitos

### 3.1 Qué lleva línea y qué no

**R1.** CUANDO el tablero financiero recibe una vista cuya `granularidad` es `dia` o `semana`, el
sistema DEBE renderizar dentro de la sección de esa vista una gráfica de líneas con una serie por
cada campo de importe que esa vista publique.

**R2.** MIENTRAS una vista declare `granularidad: "no_temporal"`, el sistema NO DEBE renderizar
para ella ninguna gráfica de líneas: ni con datos, ni vacía, ni con encabezado que la anuncie.

**R3.** El sistema DEBE decidir si una vista lleva gráfica de líneas leyendo **exclusivamente** su
campo `granularidad`, y NO DEBE decidirlo por el id de la métrica, por el id de la vista, por
`grano` ni por el número de filas.

### 3.2 El eje: la granularidad se lee o se miente

**R4.** CUANDO se pinta una vista temporal, la etiqueta de cada punto DEBE contener literalmente la
clave del cubo tal como el DTO la entrega y DEBE declarar la granularidad de esa vista, de modo que
la etiqueta de **la misma clave** sea distinta cuando la granularidad es `semana` que cuando es
`dia`.

**R5.** La etiqueta de un punto DEBE nombrar **exactamente una** fecha —la clave del cubo— y el
sistema NO DEBE calcular el último día del cubo, ni ninguna otra frontera temporal, ni construir
fechas propias.

### 3.3 Un saldo al corte no es un flujo

**R6.** MIENTRAS el DTO de la métrica declare `esAcumulado: true`, su gráfica de líneas DEBE
mostrar en texto visible que cada punto es el **saldo acumulado al cierre de su cubo** y no el
movimiento ocurrido dentro de él.

**R7.** MIENTRAS el DTO de la métrica declare `esAcumulado: false`, el sistema NO DEBE mostrar ese
texto en su gráfica de líneas.

**R8.** El sistema NO DEBE entregar a una misma gráfica series procedentes de más de una vista:
cada gráfica de líneas DEBE contener exclusivamente los puntos de la vista de su sección.

### 3.4 Fidelidad de la serie

**R9.** El sistema DEBE entregar a la gráfica **un punto por cada fila** de la vista y en el mismo
orden en que el DTO las entrega, sin añadir, quitar, reordenar ni fusionar puntos, y sin agrupar
ninguna cola en una categoría única.

**R10.** El valor de cada punto DEBE proceder literalmente del campo de importe de esa fila; SI la
conversión de ese importe no produce un número finito, ENTONCES el punto DEBE quedar como **dato
ausente** y NO DEBE pintarse como cero.

**R11.** El sistema NO DEBE pasar a la gráfica de líneas ninguna prop cuyo valor sea una función,
en particular `avisoRecorte`.

**R12.** SI una vista temporal llega con cero filas, ENTONCES el sistema DEBE renderizar el estado
vacío de la gráfica con su texto explicativo, y NO DEBE renderizar un lienzo sin texto ni una serie
de ceros.

### 3.5 La lectura que la 180 dejó rota

**R13.** CUANDO una vista declara granularidad temporal, el sistema DEBE seguir mostrando el
`total` de esa vista como tarjeta de KPI y NO DEBE renderizar una tabla con una fila por cubo
temporal. *(Sujeto a **Q1**: si el humano decide que la reparación de H1 es otra ficha, este
requisito sale y R1 se implementa igual.)*

### 3.6 Convenciones que esta feature no puede romper

**R14.** El sistema NO DEBE escribir en la región financiera un símbolo de moneda, un código ISO de
moneda ni un literal de locale, **tampoco para dar formato a una fecha**.

**R15.** Los valores del dominio `GranularidadVista` DEBEN escribirse en **un único módulo** de la
región financiera; ningún otro archivo de la región DEBE escribirlos ni compararlos.

### 3.7 Verificación y trazabilidad

**R16.** El juego de dobles con el que se verifica el tablero DEBE cubrir los **tres** valores de
`GranularidadVista` con al menos una vista cada uno, y NO DEBE declarar `filas: []` en ninguna
vista de granularidad temporal.

**R17.** Cada requisito `R1..R17` DEBE tener al menos un test nombrado por el comportamiento que
verifica, y el mapa `R<n> → test` DEBE quedar escrito en `progress/impl_186.md` citando archivos
que existan en el árbol.

---

## 4. Verificación: qué test cubre cada requisito y qué mutación lo mata

> Los nombres de caso son **el contrato para el implementer**, no una afirmación de que hoy
> existan. La columna «archivo» distingue lo que ya está en el árbol de lo que hay que crear.
> El mapa definitivo, con los nombres tal como queden escritos, va en `progress/impl_186.md` (R17).

| Req | Archivo | Nombre esperado del caso | Mutación que lo mata |
|---|---|---|---|
| R1 | `tests/components/TableroFinanciero.test.tsx` *(existe)* | `una vista con granularidad dia trae su grafica de lineas dentro de su seccion` | no renderizar la gráfica |
| R2 | ídem | `las vistas no_temporal no traen ninguna grafica de lineas, ni vacia` | renderizarla siempre |
| R3 | ídem | `una vista de grano tienda con granularidad dia SI lleva linea, y una de grano fecha con no_temporal NO` | decidir por `grano === "fecha"`, por `filas.length` o por id de métrica |
| R3 | `tests/unit/guards/tablero-financiero.guardia.test.ts` *(existe, se amplía)* | `ningun archivo decide por el id de una metrica financiera` *(caso ya existente, censo (f))* | comparar contra un id suelto |
| R4 | `tests/unit/analytics/tablero-financiero-adaptar.test.ts` *(existe)* | `la etiqueta del MISMO cubo cambia entre dia y semana` | ignorar `granularidad` al etiquetar |
| R4 | `tests/components/TableroFinanciero.test.tsx` | `la alternativa textual de una vista semanal no lee sus puntos como dias` | ídem, medido de punta a punta |
| R5 | `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | `la etiqueta nombra UNA sola fecha: la clave del cubo, y ninguna calculada` | etiquetar con un rango `clave – clave+6` |
| R6 | `tests/components/TableroFinanciero.test.tsx` | `la metrica acumulada dice que cada punto es saldo al cierre de su cubo` | no mostrar el texto |
| R7 | ídem | `las metricas de flujo NO dicen eso en su grafica` | mostrarlo siempre |
| R8 | ídem | `cada grafica de lineas contiene solo los puntos de su propia vista` | fusionar las series de dos vistas en una gráfica |
| R9 | `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | `un punto por fila, en el orden del DTO, sin cola agrupada` | aplicar `agruparCola`; ordenar; perder el último |
| R9 | ídem | `una serie de 62 puntos llega entera y no lanza` | recortar puntos en el tablero |
| R10 | ídem | `un importe ilegible es dato ausente y nunca cero` | `?? 0` en la conversión |
| R11 | `tests/unit/guards/tablero-financiero.guardia.test.ts` | `ningun archivo pasa avisoRecorte ni ninguna otra prop-funcion` *(existe, censo (b))* | pasar `avisoRecorte` a la gráfica |
| R12 | `tests/components/TableroFinanciero.test.tsx` | `una vista temporal sin filas muestra el vacio con su texto, no un lienzo mudo` | pintar la gráfica con una serie de ceros |
| R13 | ídem | `una vista temporal muestra el KPI del total y NINGUNA tabla por cubo` | dejar la caída actual a `PanelTabla` (H1) |
| R14 | `tests/unit/guards/tablero-financiero.guardia.test.ts` | `ningun archivo escribe un simbolo de moneda, un codigo ISO ni un locale` *(existe, censo (c))* | formatear la fecha con `toLocaleDateString("es-CR")` |
| R15 | `tests/unit/guards/tablero-financiero.guardia.test.ts` *(censo nuevo)* | `solo un modulo de la region nombra los valores de granularidad` | comparar `granularidad === "dia"` en un segundo archivo |
| R16 | `tests/components/TableroFinanciero.test.tsx` | `los dobles cubren las TRES granularidades y ninguna temporal viene con filas vacias` | quitar la vista semanal del juego de dobles |
| R17 | `tests/unit/guards/tablero-lineas-trazabilidad.guardia.test.ts` *(nuevo)* | `el mapa R1..R17 esta completo, sin saltos ni repetidos, y cita tests que existen` | citar un archivo que no existe |

Además, y sin sustituir a nada de lo anterior:

- `./init.sh --rapido` por tanda; **`./init.sh` completo antes del PR**, sin excepción.
- `pnpm exec next build` **a mano**, con la salida pegada en `progress/impl_186.md`: es el mismo
  agujero que la 132 declaró en su R11 (la frontera RSC no la ve ningún test) y esta feature monta
  un componente cliente nuevo (`GraficaLineas`) desde un Server Component. **Nunca `pnpm build`**,
  que encadena `migrate deploy` contra una base real.

---

## 5. Preguntas abiertas (puerta humana)

> **Q1 es bloqueante. Q2–Q5 tienen default y se aplicarán tal cual si el humano no dice otra cosa**,
> igual que hizo la 132 con sus seis preguntas. Ninguna se rellena con un supuesto: lo que no está
> decidido está escrito aquí.

**Q1 — BLOQUEANTE. ¿Esta feature repara H1 (la tabla de fechas que la 180 encendió), o eso es otra
ficha?** Los hechos están en §1.1 y son mecánicos: hoy las siete métricas caen en la rama de tabla
de `ContenidoDeVista` y ningún test lo ve porque los dobles siguen diciendo `filas: []`.
Opciones: **(a)** se repara aquí — la vista temporal pasa a KPI + línea (R13), que es exactamente
el inventario que la 132 declaró más la línea que faltaba; **(b)** se abre ficha aparte para la
regresión y esta feature solo **añade** la línea, con lo que durante un tiempo el tablero mostraría
para la misma métrica una tabla de 30 fechas **y** una gráfica de las mismas 30 fechas;
**(c)** se repara aquí y además se conserva la tabla por cubo como detalle plegado bajo la gráfica.
*Recomendación:* **(a)**. Es «se añade, no se rehace» leído en su sentido fuerte: devuelve el panel
al inventario que la 132 escribió y le suma la línea. (b) deja en pantalla dos veces el mismo dato
durante el hueco entre fichas, y (c) es la tabla que R14 de la 132 no necesita: el total ya viaja
en el DTO y la línea ya cuenta la evolución. **Afecta a R13 y al tamaño de la feature.**

**Q2 — no bloqueante. ¿`cuenta_por_pagar_mensajero` lleva línea?** Es la única de las siete que
**no es un flujo**: es un saldo al corte (hecho 8 de §1), y su serie es un acumulado corrido.
Opciones: **(a)** lleva su propia gráfica, en su propia sección —como todas—, con el texto de R6
diciendo que cada punto es un saldo al cierre de su cubo; **(b)** no lleva línea y se queda como
KPI; **(c)** iría en la misma gráfica que las seis de flujo, con otra forma de trazo.
*Recomendación:* **(a)**. La (c) **no es construible sin tocar la 130**: `SerieDato` no lleva forma
ni color (el color lo pone `paleta.ts` por orden), así que «otra forma» no existe en el contrato; y
además seis métricas de flujo más una acumulada son **siete series**, por encima de `MAX_SERIES = 5`,
lo que hace **lanzar** al paquete fuera de producción. La (b) dejaría seis métricas con línea y una
séptima idéntica en todo lo demás sin ella, que es el problema que la 180 evitó al no dejar fuera
`dinero_en_caja` y `ganancia_ordenex`. **Afecta a R6/R7.**

**Q3 — no bloqueante. ¿Cómo se rotula un cubo semanal?** El DTO **no publica el fin del cubo** y
el primero y el último están **truncados al rango** (hechos 2 y 3), así que un rótulo de rango
(`2026-08-10 – 2026-08-16`) sería **falso justo en los dos extremos**, y calcularlo metería una
segunda definición del día CR en el frontend —lo que ⟨D4⟩ de la 180 existe para impedir—.
Opciones: **(a)** prefijo textual más la clave literal (del tipo «Semana del 2026-08-10»), que es
cierto también en los cubos truncados; **(b)** declarar la granularidad solo en el título de la
gráfica y dejar los puntos con la fecha cruda.
*Recomendación:* **(a)**. La (b) deja el **eje** —que es lo que el usuario lee punto a punto, y lo
que `SerieTextual` dicta a un lector de pantalla— diciendo «10 ago» para siete días de dinero: es
literalmente el error que la ficha nombra, con un título correcto encima. **Afecta a R4/R5.**

**Q4 — no bloqueante. ¿Se acepta construir y probar la rama `semana` sabiendo que hoy no es
alcanzable en producción?** El filtro del tablero es la constante `mes` (hecho 13), es decir 30
días, es decir granularidad `dia` **siempre**. Opciones: **(a)** se construye y se prueba con
dobles, como seguro para cuando el rango sea elegible; **(b)** no se construye, y el tablero avisa
en texto si algún día recibe `semana`.
*Recomendación:* **(a)**. Cuesta una rama y una constante de texto, y es exactamente la deuda que
la ficha manda no contraer. La (b) escribe código de aviso que tampoco se puede ejercitar hoy y
deja la mentira del eje esperando a otra feature. **Afecta a R4 y a R16.**

**Q5 — no bloqueante. ¿Se exige E2E?** La Q5 de la 132 lo remitió a la 133 y la 133 ya está
`done` sin haberlo escrito. Esta feature es lectura, no muta dinero, y su gate de rol no cambia.
*Recomendación:* no. Se cubre con tests de componente sobre nombres accesibles y texto (nunca sobre
nodos de recharts, que el guardia del paquete prohíbe) más el `next build` a mano de §4. Si el
humano lo quiere, es una ficha aparte con su propio arranque de harness.
