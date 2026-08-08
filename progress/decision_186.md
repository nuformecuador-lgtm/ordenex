# Decisiones de la puerta humana — feature 186 (gráfica de líneas del tablero financiero)

**Fecha de cierre: 2026-08-06 · Autor: humano · Estado: CERRADA.**

Fuente literal: `specs/186-analitica-financiera-grafica-lineas/requirements.md` §5. Este archivo
existe para que las cinco decisiones se puedan citar sin releer la spec entera, y para que la Q2
—la única que retira funcionalidad visible— lleve sus dos motivos escritos donde la revisión los
busca.

## Las cinco, en una línea cada una

| # | Pregunta | Decisión (2026-08-06) | Dónde aterriza |
|---|---|---|---|
| **Q1** | ¿repara esta feature la tabla de fechas de ⟨H1⟩? | **DISUELTA.** Salió por hotfix (PR #305) y está en producción desde el 2026-08-06 | §1.1 de `requirements.md` pasa a ser contexto heredado. **R14** pide KPI **+** línea sobre el estado actual; no hay transición desde la tabla que programar |
| **Q2** | ¿lleva línea `cuenta_por_pagar_mensajero`? | **(b) NO.** Se queda como KPI, y el motivo se dice **en pantalla** | **R3 / R4**. Los dos motivos, abajo |
| **Q3** | ¿cómo se rotula un cubo semanal? | **(a)** prefijo textual + clave literal del cubo | **R7 / R8**. `etiquetaDeCubo` en `adaptar.ts` |
| **Q4** | ¿se construye la rama `semana` sabiendo que hoy no es alcanzable en producción? | **(a)** sí, probada con dobles y con el límite declarado | **R7**, **R17(c)**. El filtro financiero sigue siendo la constante `mes` (slot de la 131) |
| **Q5** | ¿E2E? | **No** | El arnés **existe** (`@playwright/test`, `test:e2e`, 19 specs) pero **no se ejecuta** (`init.sh` corre `test:rapido`), y la 133 ya escribió `e2e/analitica-roles.spec.ts` para la región financiera por rol |

## Q2, con sus dos motivos — que es lo que hay que poder citar

La recomendación escrita en la spec era **(a)** (darle su propia gráfica con el texto de «saldo al
cierre de cada cubo»). El humano decidió **(b)** con dos motivos que la recomendación no pesó bien:

1. **La 127 lo dejó escrito junto al repositorio.** `lib/repositories/CuentasPorPagarAnaliticaRepository.ts:19`
   declara que el DTO publica `esAcumulado: true` *«para que la 132 no lo grafique como serie»*. No
   es una lectura nueva de esta feature: es una instrucción que llevaba ahí desde antes de que
   existiera el dato que ahora se querría dibujar.
2. **La forma de la línea comunica lo que la cifra no dice.** Un saldo acumulado corrido es
   **monótono por construcción**: solo sube o se mantiene mientras el devengo supere al pago.
   Dibujado como línea, el ojo lee «tendencia al alza» donde solo hay «acumulación». La cifra sería
   correcta y la lectura, falsa.

La variante (c) —misma gráfica que las seis de flujo, con otra forma de trazo— seguía siendo
**inconstruible**, y por dos motivos independientes del criterio: `SerieDato` no lleva forma ni
color (`components/private/analytics/tipos.ts`; lo resuelve `paleta.ts` por orden) y siete series
superan `MAX_SERIES = 5`.

**Consecuencia que esta decisión obliga a programar:** el motivo se dice **EN PANTALLA** (R3), no
solo en este documento. Seis métricas vecinas tienen gráfica y esta no; sin explicación, la
ausencia se lee como «falta un dato» o «se rompió algo». Y el alcance del texto es lo que lo hace
comprobable (R4): aparece donde hay vista temporal **y** `esAcumulado: true`, y **no** en las seis
de flujo ni en `cuenta_por_pagar_tienda` —que también es acumulada, pero cuya vista es
`no_temporal` y cuya ausencia de gráfica no necesita explicación: nunca tuvo serie—.

**Lo que esta decisión NO toca:** el texto de «saldo al corte» que `CabeceraPanel` ya emite por
`esAcumulado` (R18 de la 132). Ese habla del **total**; el nuevo habla de **por qué no hay serie
dibujada**. Son dos afirmaciones distintas y reescribir la primera sería rehacer una feature `done`.

## Nota sobre Q4, escrita porque la diferencia importa

La granularidad `semana` **no es alcanzable hoy en producción**: el filtro del tablero financiero es
la constante `FILTRO_FINANCIERO_POR_DEFECTO = { rango: "mes" }`
(`app/(app)/analitica/_components/financiero/rango.ts`), una ventana móvil de 30 días, y cablearlo a
la barra de filtros es el slot de la 131, fuera del alcance de esta feature. La rama se construye
igual y se prueba con dobles, con ese límite dicho en voz alta en vez de escondido.
