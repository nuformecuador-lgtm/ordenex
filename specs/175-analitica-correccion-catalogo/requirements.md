# 175 — Analítica: corregir el catálogo de métricas (`metrics.ts`)

> **Naturaleza de la feature.** No añade funcionalidad ni cifras: **alinea el contrato**
> (`lib/analytics/metrics.ts`) con lo que el rollup (124) y los servicios (126/127) sirven de
> verdad. Todo requisito aquí es de dos mitades: **fijar el estado correcto** y **una guardia que
> vuelva a poner rojo si alguien reintroduce la divergencia**.
>
> **Invariante de alcance (vale para los 14 requisitos):** ninguna corrección debe cambiar una
> cifra que hoy se pinta. Si al implementar aparece una que sí lo haría, es alcance nuevo: se
> declara y se saca (R12 lo vigila).

## 0. Hechos verificados en el código (base de los requisitos)

Los tres los encontró gente leyendo el código; los he releído uno a uno en el worktree `C:/w175`
(rama `feature/175-analitica-correccion-catalogo`, nacida de `origin/dev` @ `e4bbbe4a`):

| # | Divergencia | ¿Se sostiene? | Evidencia leída |
| --- | --- | --- | --- |
| 1 | `incidentes` dice `estadoProduccion: "declarada"` pero tiene columna en el rollup y es el 4.º término del denominador | **Sí** | `lib/analytics/metrics.ts:220` vs. `db/schema.prisma:1891` (`incidentes Int @default(0) // gestiones vigentes 'incidente': 4.o termino de DENOMINADOR_GESTIONES (R18)`) y `lib/analytics/metrics.ts:79` + `lib/services/AnaliticaOperativaService.ts:77-82` |
| 2 | `ordenes_por_estado` promete los 19 estados; la columna real contiene el universo **B2** | **Sí** | `lib/analytics/metrics.ts:118,127` vs. `specs/124-…/requirements.md:234-241` y `specs/124-…/design.md:139-145` |
| 3 | `sin_gestionar` figura como snapshot de rollup pero `analytics_daily` no tiene esa columna; la 126 la deriva del embudo con semántica «HOY» | **Sí** | `lib/analytics/metrics.ts:232-247` vs. `db/schema.prisma:1885-1894` (no existe columna `sin_gestionar`) y `lib/services/AnaliticaOperativaService.ts:88,112-113,316-318,348-362` + `lib/types/analitica-operativa.ts:64-77` |
| 4 | **Hallazgo nuevo:** la descripción de `ordenes_por_estado` dice «los **19** values vigentes» y `ORDER_STATUS_SEED` tiene **20** desde la 157 (`recolectando`) | **Sí** | `lib/analytics/metrics.ts:118` vs. `lib/types/order-status.ts:54-79` (20 entradas) y `tests/unit/analytics/definiciones-catalogo.guardia.test.ts:60-62`, cuyo caso se titula «diecinueve values» pero afirma `toHaveLength(20)` |

Cita textual del universo B2 (no parafraseada), `specs/124-analitica-job-agregacion-diaria/requirements.md:234-237`:

> **R11.** `ordenes_estado_stock` DEBE ser el **stock al corte** del día sobre este universo: órdenes
> **no borradas** cuyo estatus al corte **no** es terminal, **más** las órdenes que llegaron a un
> estado de `ESTADOS_TERMINALES` **durante ese mismo día**. Cada orden del universo aporta
> **exactamente 1** a la fila de su estatus al corte, y **0** a cualquier otra.

Y la semántica de `sin_gestionar`, `lib/types/analitica-operativa.ts:64-75`:

> Es «sin gestionar HOY» —universo B2 de la 124: ordenes vivas en ese estado al corte, mas las que
> llegaron a terminal ese dia— y NO «sin gestionar acumuladas». […] FRONTERA: esta declaracion
> deberia estar TAMBIEN en `lib/analytics/metrics.ts` […] Queda anotada para la **ficha 175**.

**La divergencia 4 se absorbe aquí** (vive dentro del mismo literal que la 2 reescribe); el motivo y
la alternativa «ficha propia» están en `design.md §8`.

## 1. Requisitos (EARS)

### Divergencia 1 — `incidentes` sí tiene productor

**R1.** El sistema DEBE declarar `incidentes.estadoProduccion = "producida"` en el catálogo de
métricas, y su comentario adjunto NO DEBE afirmar que el rollup no la compromete.
*Mutación que debe morir:* volver a `"declarada"` → rojo.

**R2.** El sistema DEBE impedir, por guardia **derivada y no por lista escrita a mano**, que una
métrica citada como `numerador` o dentro del `denominador` de una `razon` del catálogo esté marcada
`estadoProduccion: "declarada"`: si las tres tasas se sirven, sus cuatro términos tienen productor.
*Mutación:* marcar `declarada` cualquiera de `entregas`, `devoluciones`, `rechazos`, `incidentes` →
rojo, sin que la guardia nombre a `incidentes`.

**R3.** SI el humano ratifica Q2 (`sin_gestionar` también pasa a `producida`), ENTONCES el sistema
DEBE declarar `sin_gestionar.estadoProduccion = "producida"`.

**R4.** MIENTRAS el catálogo no contenga ninguna métrica `declarada`, el sistema DEBE seguir
verificando que `listarMetricas({ estadoProduccion })` **particiona** el catálogo (producidas +
declaradas = total) sin exigir que el subconjunto `declarada` sea no vacío: la verificabilidad del
filtro NO DEBE depender de que exista deuda en el catálogo.
*Mutación:* hacer que el filtro ignore `estadoProduccion` → rojo (con catálogo sintético).

### Divergencia 2 — `ordenes_por_estado` promete más de lo que hay

**R5.** El sistema DEBE declarar en `ordenes_por_estado`, de forma **legible por máquina** y con
dominio cerrado, que su universo es el B2 de la 124 («vivas al corte + las que llegaron a terminal
ese día»).
*Mutación:* borrar esa declaración → rojo.

**R6.** El sistema DEBE describir `ordenes_por_estado` diciendo que el rollup **no** conserva el
archivo histórico de estados terminales, y que el histórico de terminales se sirve de las medidas de
flujo (`entregas`, `devoluciones`, `rechazos`, `incidentes`).

**R7.** El sistema NO DEBE afirmar en ninguna `descripcion` del catálogo un **conteo literal** de
estados del catálogo de `order_status` (hoy «19», ya desincronizado con los 20 de
`ORDER_STATUS_SEED`).
*Mutación:* reintroducir «19 values» o «20 values» en cualquier descripción → rojo.

**R8.** El sistema DEBE conservar `ordenes_por_estado.definicion.estados` **exactamente igual** a
`ORDER_STATUS_SEED`: la corrección acota el **universo temporal**, no el vocabulario de estados.
*Mutación:* acotar `estados` a los no terminales → rojo (y sería falso: B2 sí incluye terminales del
día).

### Divergencia 3 — `sin_gestionar` no tiene columna propia

**R9.** El sistema DEBE declarar en `sin_gestionar`, de forma legible por máquina, que **se deriva**
de `ordenes_por_estado` (proyección de la medida `ordenes_estado_stock` sobre el estatus
`sin_gestionar`) y que su universo es el B2.

**R10.** El sistema DEBE describir `sin_gestionar` como «sin gestionar **HOY**» y NO como
acumulado, en el mismo sentido literal que `NOTA_SIN_GESTIONAR`
(`lib/types/analitica-operativa.ts:75`).
*Mutación:* describirla como acumulada, o quitar la palabra del día → rojo.

**R11.** El sistema DEBE verificar, **leyendo `db/schema.prisma`**, que el modelo `AnalyticsDaily`
no tiene columna `sin_gestionar` y que ninguna métrica del catálogo supone una columna propia
inexistente.
*Mutación:* declarar `sin_gestionar` como métrica con columna propia (o añadir la columna sin
actualizar el catálogo) → rojo.

**R12.** El sistema DEBE conservar en `sin_gestionar` `clase: "snapshot"` y
`fuente: { tipo: "rollup", tablas: ["analytics_daily"] }`: se deriva de una columna **de esa tabla**,
así que el invariante `snapshot ⟺ rollup` (R5 de la 135) sigue siendo cierto.
*Mutación:* cambiarla a `live` o a `tabla_viva` → rojo (rompería `operativa-fuente.guardia`).

### Transversales

**R13.** El sistema NO DEBE cambiar ninguna cifra servida: los campos añadidos y los
`estadoProduccion` corregidos NO DEBEN leerse en runtime para decidir datos fuera de
`lib/analytics/metrics.ts`.
*Mutación:* que un servicio, repositorio o componente filtre o calcule por `estadoProduccion`,
`definicion.universo` o `definicion.derivadaDe` → rojo (censo de archivos, no de imports).

**R14.** CUANDO el catálogo cambie el `estadoProduccion` de una métrica, la decisión humana DEBE
quedar registrada, **fechada**, en `progress/` y citada desde la propia entrada del catálogo — mismo
patrón que ⟨D8⟩ de la 127 (`progress/decision_C2_127.md:39`, citado en `metrics.ts:462-465`).
*Mutación:* cambiar un `estadoProduccion` sin decisión registrada → rojo.

## 2. Fuera de alcance (frontera explícita)

- **No se toca** `lib/services/AnaliticaOperativaService.ts` ni ningún repositorio: la 126 ya sirve
  bien las tres métricas; corregir el catálogo no cambia su comportamiento.
- **No se añade ni se quita ninguna métrica** (siguen 23: 15 operativas + 8 financieras).
- **No se toca el rollup ni el esquema**: no hay migración, no hay columna nueva.
- **Frontera con la 176** (modo agregado de tasas y tiempos): la 176 extiende el **contrato de
  lectura** de la 126 (numerador/denominador por cubo) y su ficha dice literalmente *«no anade
  metricas al catalogo»*. La 175 no toca el servicio ni el contrato de salida; la 176 no toca
  `metrics.ts`. Intersección de archivos esperada: **cero**.

## 3. Preguntas abiertas

| # | Pregunta | ¿Bloquea el arranque? | Recomendación |
| --- | --- | --- | --- |
| **Q1** | La cabecera del catálogo dice que su contenido «no es opinión del implementer» y que cambiarlo exige **una decisión humana nueva y fechada** (`metrics.ts:5-7`); el precedente ⟨D8⟩ (egresos) se registró en `progress/decision_C2_127.md`. ¿La aprobación de esta spec cuenta como esa decisión fechada para `incidentes` → `producida`? | **Sí** | Sí: ratificarla al aprobar y registrarla en `progress/decision_175.md` con fecha. Sin ella, R1 no puede escribirse (R14). |
| **Q2** | ¿`sin_gestionar` pasa también a `estadoProduccion: "producida"`? La ficha solo lo pide para `incidentes`, pero la 126 **sí la sirve** (derivada del embudo), así que el segundo agujero de la 133 sigue abierto si se deja `declarada`. Consecuencia medida: el catálogo se quedaría **sin ninguna** métrica `declarada` y `tests/unit/analytics/metrics.test.ts:276` (`toBeGreaterThan(0)`) se pone rojo. | **Sí** | **Sí, pasarla a `producida`** y reexpresar ese caso sobre un catálogo sintético (R4). Es exactamente el mismo defecto que la divergencia 1, y dejarlo vivo obliga a la 133 a conocer una excepción no escrita. |
| **Q3** | ¿Se puede tocar `lib/analytics/types.ts` (archivo de la 135, `done`) para añadir dos campos **opcionales** a `DefinicionMetrica` (`universo`, `derivadaDe`)? | No | Sí: es aditivo, opcional y de dominio cerrado; no rompe ninguna entrada existente ni las 12 claves de R3 de la 135 (van dentro de `definicion`). Si el humano dice que no, el plan B es corregir solo las `descripcion` y R5/R9 pasan a verificarse por subcadena, con mucha menos fuerza (se declara en `design.md §7`). |
| **Q4** | `tests/unit/analytics/tablero-catalogo-paneles.test.ts:43-44` (feature **131**, hoy `in_progress`) afirma literalmente que `incidentes` y `sin_gestionar` son `declarada`. Esta feature lo pone **rojo por diseño**. ¿Lo actualiza la 175 en su propio PR, o espera al merge de la 131? | No | Que lo actualice la **175**, y reexpresándolo: el caso debe seguir matando la mutación del `filter(estadoProduccion === "producida")` **sin afirmar el valor concreto** del campo — que es justo el espíritu de R21 de la 131. Avisar a la sesión de la 131 antes de mergear. |
| **Q5** | ¿Nombres y dominios de los campos nuevos: `universo: "b2_vivas_mas_cierres_del_dia"` y `derivadaDe: MetricaId`? | No | Aceptarlos. `universo` es un dominio cerrado de **un** valor (igual que `criterio` y `atribucionZona`), lo que impide que alguien meta prosa. |
| **Q6** | La divergencia **4** (el literal «19») ¿entra aquí o va a ficha propia? | No | Aquí: vive dentro del mismo string que R6 reescribe, y sacarla obligaría a tocar dos veces la misma línea desde dos ramas. Se declara como hallazgo en `design.md §8`, no se absorbe en silencio. |
| **Q7** | El caso `definiciones-catalogo.guardia.test.ts:60-62` se titula «el catalogo de order_status tiene diecinueve values» pero afirma `toHaveLength(20)`. ¿Se corrige el título aquí? | No | Sí, mismo PR: es la misma mentira del literal «19» y cuesta una línea. |

## 4. Trazabilidad `R<n>` → test (propuesta para el implementer)

| R | Test propuesto |
| --- | --- |
| R1 | `tests/unit/analytics/catalogo-produccion.guardia.test.ts` › «`incidentes` declara productor porque tiene columna en el rollup» |
| R2 | idem › «ninguna métrica citada en una `razon` está `declarada`» (derivado de `METRICAS`, sin lista) |
| R3 | idem › «`sin_gestionar` declara productor: la 126 la deriva del embudo» |
| R4 | `tests/unit/analytics/metrics.test.ts` › «el filtro de `estadoProduccion` particiona el catálogo» (+ caso sintético) |
| R5 | `tests/unit/analytics/catalogo-universo.guardia.test.ts` › «el embudo declara el universo B2» |
| R6 | idem › «la descripción del embudo remite a las medidas de flujo para el histórico de terminales» |
| R7 | idem › «ninguna descripción del catálogo cuenta estados a mano» |
| R8 | `tests/unit/analytics/definiciones-catalogo.guardia.test.ts` (caso existente, `:87-91`) |
| R9 | `catalogo-universo.guardia.test.ts` › «`sin_gestionar` se declara derivada de `ordenes_por_estado`» |
| R10 | idem › «`sin_gestionar` se describe como del día, no como acumulada» |
| R11 | idem › «`analytics_daily` no tiene columna `sin_gestionar` y el catálogo no la supone» (lee `db/schema.prisma`) |
| R12 | `tests/unit/analytics/operativa-fuente.guardia.test.ts` (caso existente) + caso nuevo sobre `sin_gestionar` |
| R13 | `catalogo-produccion.guardia.test.ts` › «nadie fuera del catálogo decide datos por `estadoProduccion`, `universo` ni `derivadaDe`» (censo de árbol) |
| R14 | idem › «todo cambio de `estadoProduccion` cita una decisión humana registrada en `progress/`» |
