# Feature 186 — analítica financiera: gráfica de líneas en el tablero · requirements (EARS)

> Zona: `frontend`. Complejidad: `low`. `sdd: true`. `depends_on: 180` (**done**).
> Rama `feature/186-tablero-financiero-grafica-lineas`, con `dev` mergeado dentro (incluye el
> hotfix del 2026-08-06, PR #305).
> **Puerta humana CERRADA el 2026-08-06.** Las decisiones están en §5; las preguntas se conservan
> íntegras debajo porque son el rastro del porqué, no una lista pendiente.
> Todo lo de §1 se comprobó **en el árbol de esta rama**, localizando por símbolo.

---

## 0. Contexto heredado (no se reabre)

- **La 180 es `done`.** `VistaFinanciera.granularidad` es requerida, `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`
  existe y el servicio publica una serie densa para las siete métricas. Esta feature **consume**
  ese contrato: no lo amplía y no toca `lib/`.
- **La Q4 de la 180 la cerró el humano el 2026-08-05 con (a):** aquella ficha era solo backend y
  el panel de líneas iba en ficha nueva. Esta es esa ficha.
- **⟨H1⟩ El hotfix del 2026-08-06 (PR #305) ya está en producción.** Ver §1.1. Lo que esta feature
  hereda **no** es un tablero roto: es un tablero reparado al que le falta la línea.
- **El tablero es de dos roles** (`esAccesoTotal`: `maestro` y `admin`). R1–R5 de la 132 siguen
  vigentes palabra por palabra y no se tocan.
- **El tablero decide por la FORMA del DTO, nunca por el nombre de la métrica** (R27 de la 132,
  R22 de la 183). Esta feature no introduce la primera excepción.
- **Dónde está declarado el hueco, con la cita corregida.** La ficha remite al `design.md` §5 de la
  132; ese §5 es el *inventario de paneles* y no declara ningún hueco. El hueco está en su **§7,
  alternativa 6** («Pintar una gráfica de líneas… *Descartada por falta de dato, no por gusto*…
  Queda como Q3 y, si se quiere, como ficha aparte») y en la **Q3 de su `requirements.md`**,
  cerrada el 2026-08-03. §5 es lo que la Q3 anuncia que cambiará. (De paso: esa Q3 remite a «la
  ficha 179» para el desglose por fecha; ese trabajo aterrizó como la **180**. La 179 es la caché.)

## 1. Hechos verificados en el código de ESTA rama (no supuestos)

| # | Hecho | Dónde se comprobó |
|---|---|---|
| 1 | `VistaFinanciera.granularidad` es **requerida**; dominio `dia \| semana \| no_temporal` | `lib/types/analitica-financiera.ts`, `GranularidadVista`, `VistaFinanciera` |
| 2 | `FilaFinanciera` tiene **solo** `cubo` e `importe`: el DTO **no publica el fin del cubo** | ídem, `FilaFinanciera` |
| 3 | La clave del cubo es la fecha CR del **primer día incluido**; el **primero y el último** están **truncados al rango** | `lib/analytics/cubo-temporal.ts`, `trocear` |
| 4 | El servidor decide la granularidad y garantiza no pasar de `MAX_PUNTOS_SERIE` puntos | `granularidadDe`; R19/R20 de la 180 |
| 5 | `esAcumulado` vive en la **cabecera de la métrica**, no en la vista, y es `true` exactamente en las dos cuentas por pagar | `CabeceraFinanciera`, `IDS_FINANCIERAS_ACUMULADAS` |
| 6 | La 127 dejó escrito que `esAcumulado` existe **«para que la 132 no lo grafique como serie»** | `lib/repositories/CuentasPorPagarAnaliticaRepository.ts:19` |
| 7 | `GraficaLineas` **existe** desde la 130, es `"use client"`, no importa recharts (lienzo diferido) y emite alternativa textual `"<serie>, <categoría>: <valor>"` en una `<ul aria-label>` | `components/private/analytics/GraficaLineas.tsx`, `SerieTextual.tsx` |
| 8 | `PuntoDato.categoria` viene **ya formateada por el llamador**; el paquete «no sabe de fechas ni de zona horaria» | `components/private/analytics/tipos.ts` |
| 9 | `SerieDato` es `{ id, etiqueta, puntos }`: **el color no viaja en las props** y no hay forma de trazo | ídem; `paleta.ts` |
| 10 | `adaptar.ts` ya resuelve `string → number` (`aNumero`), la selección de campo por forma del importe y la construcción de serie (`serieDeVista`, con sobrecargas) | `app/(app)/analitica/_components/financiero/adaptar.ts` |
| 11 | El paquete **lanza** fuera de producción por encima de `MAX_SERIES = 5` y `MAX_PUNTOS_SERIE = 62` | `components/private/analytics/topes.ts` |
| 12 | El filtro del tablero financiero es la constante `FILTRO_FINANCIERO_POR_DEFECTO = { rango: "mes" }`, ventana móvil de 30 días | `app/(app)/analitica/_components/financiero/rango.ts` |
| 13 | El guardia del tablero **recorre** la carpeta `financiero/`: un archivo nuevo entra solo en el censo | `tests/unit/guards/tablero-financiero.guardia.test.ts`, caso «la carpeta financiero se RECORRE» |
| 14 | El arnés E2E **existe** (`@playwright/test`, script `test:e2e`, 19 specs) e incluye `e2e/analitica-roles.spec.ts`, que ya cubre la región financiera por rol | `package.json:16`, `e2e/` |
| 15 | Los E2E **no se ejecutan**: `init.sh` corre `test:rapido`, y la revisión de la 133 lo declara —«E2E: escrito, **no ejecutado**», «hay 17 specs de `e2e/` en el mismo estado», decisión humana del 2026-07-30 | `init.sh:121`; `progress/review_133-analitica-recortes-por-rol.md:33,91,209-214` |

### 1.1 ⟨H1⟩ Contexto heredado: el hotfix del 2026-08-06, y por qué media feature existe por él

**Lo que pasó.** Al aterrizar la 180, las siete métricas del desglose dejaron de publicar
`filas: []` y pasaron a traer una serie densa (~30 filas para el rango por defecto). El tablero
elegía panel con `vista.filas.length === 0 → KPI`, así que esas siete cayeron en la rama de tabla:
durante **siete horas** producción pintó **una tabla de 30 fechas** donde va «Dinero en caja».

**Por qué ninguna suite lo vio.** La fixture de `tests/components/TableroFinanciero.test.tsx`
declaraba `filas: []` para esas siete, y la 180 **editó esa fixture** —para añadirle
`granularidad`— sin ver que su premisa ya era falsa. El componente y su prueba compartían un mundo
que el servicio había dejado de producir, y dos piezas que se equivocan igual no se contradicen
nunca.

**Cómo se arregló (PR #305, desplegado READY).** La señal de forma pasó de `filas.length` a
`granularidad`, mediante `esSerieTemporal(vista) { return vista.granularidad !== "no_temporal" }`
—**por la negativa a propósito**, para que un valor futuro del enum no vuelva a caer en la tabla—.
Hoy `esSerieTemporal(vista) || vista.filas.length === 0 → PanelKpi`. Los dobles de
`TableroFinanciero.test.tsx` y `AnaliticaPage.test.tsx` llevan ya la serie densa, y el bloque
`Hotfix — …` del primero ata la fixture al contrato («la fixture declara temporales EXACTAMENTE
las siete que la 180 desglosó por fecha»).

**Qué queda para esta feature.** El KPI está restaurado y no se retira: lo que falta es **añadir
la línea encima de él**. Esta feature **no repara nada**; hereda el arreglo, se apoya en su señal
y extiende su propiedad más frágil —la lectura por la negativa— al panel nuevo (**R5**). La deuda
que el incidente deja sin dueño se responde en **R17** y en `design.md` §7.

## 2. Alcance

DENTRO:

1. El **panel de líneas** de cada vista financiera que declara granularidad temporal **y cuya
   métrica no es un acumulado**, dentro de la sección que esa vista ya tiene.
2. El adaptador **puro** de vista temporal a serie del paquete, con la etiqueta de cubo que **lee
   `granularidad`**.
3. El motivo **en pantalla** de por qué la métrica acumulada no trae gráfica.
4. Los censos y ataduras que faltan para que esto no se desincronice como en ⟨H1⟩.

FUERA, con su razón:

- **`lib/`, `db/` y `components/private/analytics/`.** El dato ya está publicado (180) y las
  gráficas ya existen (130). Esta feature **cablea**.
- **Cablear el rango del tablero financiero a la barra de filtros.** El slot `filtros` es de la
  131 y el filtro financiero sigue siendo la constante `mes`. **Consecuencia dicha en voz alta:**
  la granularidad `semana` **no es alcanzable hoy en producción**; se construye y se prueba con
  dobles (Q4 = (a)).
- **Marcar como parcial el cubo en curso.** El DTO no lleva ese marcador (Q2 de la 180 = (a)).
- **Línea para `cod_recaudado` y `cuenta_por_pagar_tienda`.** No tienen vista temporal.
- **Línea para `cuenta_por_pagar_mensajero`.** Decisión humana del 2026-08-06 (Q2 = (b)); el
  motivo es R3 y se dice en pantalla.
- **Export (184), caché (179), nombres legibles de tienda (178/181).**
- **E2E.** Q5 = no. El arnés existe pero sus specs **no se ejecutan** (hechos 14 y 15) y la 133 ya
  escribió el de la región financiera por rol.
- **El test de contrato general dobles ↔ servicio.** Se propone como ficha en `design.md` §7; lo
  que sí entra aquí es R17.

---

## 3. Requisitos

### 3.1 Qué lleva línea y qué no

**R1.** CUANDO el tablero recibe una vista cuya `granularidad` no es `no_temporal` y cuyo DTO
declara `esAcumulado: false`, el sistema DEBE renderizar dentro de la sección de esa vista una
gráfica de líneas con una serie por cada campo de importe que la vista publique.

**R2.** MIENTRAS una vista declare `granularidad: "no_temporal"`, el sistema NO DEBE renderizar
para ella ninguna gráfica de líneas: ni con datos, ni vacía, ni con encabezado que la anuncie.

**R3.** MIENTRAS el DTO de una métrica declare `esAcumulado: true`, el sistema NO DEBE renderizar
gráfica de líneas para sus vistas temporales, y DEBE mostrar **en pantalla** el motivo: que la
cifra es un saldo acumulado y que una línea de saldo solo puede subir o mantenerse, de modo que se
leería como una tendencia sin serlo.

**R4.** El sistema NO DEBE mostrar ese motivo en las vistas temporales de métricas de flujo ni en
las vistas `no_temporal` de una métrica acumulada.

**R5.** El sistema DEBE decidir que una vista es serie temporal **por la negativa** —negando
`no_temporal`—, de modo que SI llega un valor de `GranularidadVista` que el tablero no conoce,
ENTONCES esa vista DEBE tratarse como serie temporal y NO DEBE caer en el panel de tabla.

**R6.** El sistema DEBE tomar esas decisiones leyendo exclusivamente `granularidad` y `esAcumulado`
del DTO, y NO DEBE tomarlas por el id de la métrica, el id de la vista, el `grano` ni el número de
filas.

### 3.2 El eje: la granularidad se lee o se miente

**R7.** CUANDO se pinta una vista temporal, la etiqueta de cada punto DEBE contener literalmente la
clave del cubo tal como el DTO la entrega y DEBE declarar la granularidad de esa vista, de modo que
la etiqueta de **la misma clave** sea distinta cuando la granularidad es `semana` que cuando es
`dia`.

**R8.** La etiqueta de un punto DEBE nombrar **exactamente una** fecha —la clave del cubo— y el
sistema NO DEBE calcular el fin del cubo, ninguna otra frontera temporal ni ninguna fecha propia.

**R9.** SI la granularidad de una vista temporal no es una de las que el rotulador sabe nombrar,
ENTONCES su etiqueta DEBE conservar la clave y DEBE ser distinguible de la etiqueta diaria; el
sistema NO DEBE rotularla como si fuera un día.

### 3.3 Fidelidad de la serie

**R10.** El sistema DEBE entregar a la gráfica **un punto por cada fila** de la vista y en el mismo
orden en que el DTO las entrega, sin añadir, quitar, reordenar ni fusionar puntos, y sin agrupar
ninguna cola en una categoría única.

**R11.** El valor de cada punto DEBE proceder literalmente del campo de importe de esa fila; SI la
conversión de ese importe no produce un número finito, ENTONCES el punto DEBE quedar como **dato
ausente** y NO DEBE pintarse como cero.

**R12.** El sistema NO DEBE pasar a la gráfica de líneas ninguna prop cuyo valor sea una función,
en particular `avisoRecorte`.

**R13.** SI una vista temporal llega con cero filas, ENTONCES el sistema DEBE renderizar el estado
vacío de la gráfica con su texto explicativo, y NO DEBE renderizar un lienzo sin texto ni una serie
de ceros.

### 3.4 Lo que el hotfix restauró no se retira

**R14.** CUANDO una vista temporal lleva gráfica de líneas, el sistema DEBE seguir mostrando el
`total` de esa vista como tarjeta de KPI en la misma sección, y NO DEBE renderizar una tabla con
una fila por cubo temporal.

### 3.5 Convenciones que esta feature no puede romper

**R15.** El sistema NO DEBE escribir en la región financiera un símbolo de moneda, un código ISO de
moneda ni un literal de locale, **tampoco para dar formato a una fecha**.

**R16.** Los valores del dominio `GranularidadVista` DEBEN escribirse en **un único módulo** de la
región financiera; ningún otro archivo de la región DEBE escribirlos ni compararlos.

### 3.6 Que los dobles no vuelvan a declarar un mundo que no existe

**R17.** El juego de dobles con el que se verifica el tablero DEBE satisfacer los invariantes que
el contrato financiero publica como constante exportada o como regla de tipo, y al menos:

- **(a)** el conjunto de métricas con vista temporal DEBE ser exactamente
  `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` *(ya atado por el hotfix; se conserva, no se reescribe)*;
- **(b)** el conjunto de métricas con `esAcumulado: true` DEBE ser exactamente
  `IDS_FINANCIERAS_ACUMULADAS`;
- **(c)** DEBE existir al menos una vista por cada valor de `GranularidadVista`, **incluida
  `semana`**;
- **(d)** dentro de una misma vista, el `total` y todas sus filas DEBEN publicar la misma `forma`
  de importe (R18 de la 183).

### 3.7 Verificación y trazabilidad

**R18.** Cada requisito `R1..R18` DEBE tener al menos un test nombrado por el comportamiento que
verifica, y el mapa `R<n> → test` DEBE quedar escrito en `progress/impl_186.md` citando archivos
que existan en el árbol.

---

## 4. Verificación: qué test cubre cada requisito y qué mutación lo mata

> Los nombres de caso son **el contrato para el implementer**, no una afirmación de que hoy
> existan; la columna «archivo» distingue lo que ya está en el árbol de lo que hay que crear, y la
> nota «(ya existe)» señala el único caso que **no** hay que volver a escribir. El mapa definitivo,
> con los nombres tal como queden, va en `progress/impl_186.md` (R18).

| Req | Archivo | Nombre esperado del caso | Mutación que lo mata |
|---|---|---|---|
| R1 | `tests/components/TableroFinanciero.test.tsx` *(existe)* | `una vista temporal de metrica de flujo trae su grafica de lineas dentro de su seccion` | no renderizar la gráfica |
| R2 | ídem | `las vistas no_temporal no traen ninguna grafica de lineas, ni vacia` | renderizarla siempre |
| R3 | ídem | `la cuenta por pagar de mensajero NO trae grafica y dice en pantalla por que` | pintarle la línea; o quitarle el motivo |
| R4 | ídem | `el motivo no aparece en las seis de flujo ni en la cuenta por pagar de tienda` | mostrar el motivo en toda métrica acumulada o en todas |
| R5 | ídem | `una granularidad que el tablero no conoce se trata como serie, no como tabla` | escribir la señal en positivo (`=== "dia" \|\| === "semana"`) |
| R6 | ídem | `una vista de grano tienda con granularidad dia SI lleva linea, y una de grano fecha con no_temporal NO` | decidir por `grano`, por `filas.length` o por id de métrica |
| R6 | `tests/unit/guards/tablero-financiero.guardia.test.ts` *(existe)* | `ningun archivo decide por el id de una metrica financiera` *(censo (f), ya existe)* | comparar contra un id suelto |
| R7 | `tests/unit/analytics/tablero-financiero-adaptar.test.ts` *(existe)* | `la etiqueta del MISMO cubo cambia entre dia y semana` | ignorar `granularidad` al etiquetar |
| R7 | `tests/components/TableroFinanciero.test.tsx` | `la alternativa textual de una vista semanal no lee sus puntos como dias` | ídem, medido de punta a punta |
| R8 | `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | `la etiqueta nombra UNA sola fecha: la clave del cubo, y ninguna calculada` | etiquetar con un rango `clave – clave+6` |
| R9 | ídem | `una granularidad desconocida no se rotula como si fuera un dia` | devolver la clave cruda en el caso por defecto |
| R10 | ídem | `un punto por fila, en el orden del DTO, sin cola agrupada` | aplicar `agruparCola`; ordenar; perder el último |
| R10 | ídem | `una serie de 62 puntos llega entera y no lanza` | recortar puntos en el tablero |
| R11 | ídem | `un importe ilegible es dato ausente y nunca cero` | `?? 0` en la conversión |
| R12 | `tests/unit/guards/tablero-financiero.guardia.test.ts` | `ningun archivo pasa avisoRecorte ni ninguna otra prop-funcion` *(censo (b), ya existe)* | pasar `avisoRecorte` a la gráfica |
| R13 | `tests/components/TableroFinanciero.test.tsx` | `una vista temporal sin filas muestra el vacio con su texto, no un lienzo mudo` | pintar la gráfica con una serie de ceros |
| R14 | ídem | `la vista temporal conserva su KPI junto a la linea y sigue sin tabla` | sustituir el KPI por la gráfica |
| R15 | `tests/unit/guards/tablero-financiero.guardia.test.ts` | `ningun archivo escribe un simbolo de moneda, un codigo ISO ni un locale` *(censo (c), ya existe)* | formatear la fecha con `toLocaleDateString("es-CR")` |
| R16 | ídem *(censo nuevo (g))* | `solo un modulo de la region nombra los valores de granularidad` | comparar `granularidad === "dia"` en un segundo archivo |
| R17 (a) | `tests/components/TableroFinanciero.test.tsx` | `la fixture declara temporales EXACTAMENTE las siete que la 180 desgloso por fecha` — **ya existe, no se reescribe** | sacar una métrica de la fixture |
| R17 (b) | ídem | `la fixture declara acumuladas EXACTAMENTE las dos que el contrato acumula` | poner `esAcumulado` a mano y que deje de coincidir |
| R17 (c) | ídem | `los dobles cubren las TRES granularidades, semana incluida` | quitar la vista semanal |
| R17 (d) | ídem | `ninguna vista de la fixture mezcla formas de importe entre su total y sus filas` | mezclar `solo_bruto` con `bruto_y_neto` en una vista |
| R18 | `tests/unit/guards/tablero-lineas-trazabilidad.guardia.test.ts` *(nuevo)* | `el mapa R1..R18 esta completo, sin saltos ni repetidos, y cita tests que existen` | citar un archivo que no existe |

Además, y sin sustituir a nada de lo anterior:

- `./init.sh --rapido` por tanda; **`./init.sh` completo antes del PR**, sin excepción.
- `pnpm exec next build` **a mano**, con la salida pegada en `progress/impl_186.md`: es el agujero
  que la 132 declaró en su R11 (la frontera RSC no la ve ningún test) y esta feature monta un
  Client Component nuevo (`GraficaLineas`) desde un Server Component. **Nunca `pnpm build`**.
- **Los seis casos del bloque `Hotfix — …` deben seguir verdes sin tocarlos.** Es la comprobación
  de que mover `esSerieTemporal` a `adaptar.ts` (⟨D1⟩) no cambia una sola conducta.

---

## 5. Puerta humana — **CERRADA el 2026-08-06**

| Pregunta | Decisión | Efecto |
|---|---|---|
| **Q1** ¿repara esta feature la tabla de fechas? | **DISUELTA**: salió a **hotfix** (PR #305) y está en producción desde el 2026-08-06 | §1.1 pasa a ser **contexto heredado**. R14 pide KPI **+** línea sobre el estado actual, no una transición desde la tabla |
| **Q2** ¿lleva línea `cuenta_por_pagar_mensajero`? | **(b) NO.** Se queda como KPI | R3/R4. Motivo: la 127 dejó escrito que `esAcumulado` existe «para que la 132 no lo grafique como serie» (hecho 6), y un saldo acumulado dibujado como línea **siempre sube o se mantiene**: parece una tendencia sin serlo. **El motivo se dice EN PANTALLA**, con test |
| **Q3** ¿cómo se rotula un cubo semanal? | **(a)** prefijo textual + clave literal | R7/R8 |
| **Q4** ¿se construye la rama `semana` sabiendo que hoy no es alcanzable? | **(a)** sí, probada con dobles y con el límite declarado | R7, R17(c) |
| **Q5** ¿E2E? | **No** | El arnés **existe** pero sus specs **no se ejecutan** (hechos 14 y 15) y la 133 ya escribió `e2e/analitica-roles.spec.ts` para la región financiera por rol. Añadir uno más sería declarar cobertura que nadie corre |

> **Matiz sobre Q5, dicho porque la diferencia importa:** no es cierto que este repo «no tenga
> arnés E2E» —hay `@playwright/test`, script `test:e2e` y 19 specs—. Lo cierto, y peor, es que
> **están escritos y no se ejecutan**: `init.sh` corre `test:rapido`, y la revisión de la 133 lo
> declara con nombre y apellidos. La conclusión no cambia; la razón sí, y escribir la razón falsa
> habría dejado la spec afirmando algo que el árbol desmiente.

### Las preguntas, tal como se plantearon

**Q1 — ¿Esta feature repara H1 o es otra ficha?** Opciones: (a) repararlo aquí; (b) ficha aparte;
(c) repararlo y conservar la tabla como detalle plegado. *Recomendación escrita:* (a).
**Resuelta por los hechos:** el tablero llevaba siete horas pintando tablas de treinta fechas y no
esperó a esta feature.

**Q2 — ¿`cuenta_por_pagar_mensajero` lleva línea?** Opciones: (a) su propia gráfica con el texto de
«saldo al cierre de cada cubo»; (b) sin línea, KPI; (c) en la misma gráfica que las seis de flujo
con otra forma de trazo. *Recomendación escrita:* (a). **Decisión humana: (b)**, con dos motivos
que la recomendación no pesó bien —la 127 lo dejó dicho junto al repositorio, y una línea de saldo
acumulado es monótona por construcción, así que su forma comunica «tendencia» donde solo hay
«acumulación»—. La (c) seguía siendo imposible: `SerieDato` no lleva forma ni color, y siete series
superan `MAX_SERIES = 5`.

**Q3 — ¿Cómo se rotula un cubo semanal?** Opciones: (a) prefijo textual + clave literal;
(b) declararlo solo en el título. *Recomendación:* (a) — el DTO no publica el fin del cubo y el
primero y el último están truncados, así que un rótulo de rango sería falso justo en los extremos.

**Q4 — ¿Se construye la rama `semana`?** Opciones: (a) sí, con dobles; (b) no, y avisar si llega.
*Recomendación:* (a) — cuesta una rama y una constante de texto.

**Q5 — ¿E2E?** *Recomendación:* no. Ver el matiz de arriba.
