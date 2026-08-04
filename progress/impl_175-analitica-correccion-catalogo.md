# 175 — Bitacora de implementacion: correccion del catalogo de metricas

> Rama `feature/175-analitica-correccion-catalogo`, worktree `C:/w175`, nacida de `origin/dev`
> @ `e4bbbe4a`. Zona `backend`, complejidad `small`.
> Naturaleza: **no anade funcionalidad ni cifras**. Alinea el contrato de `lib/analytics/metrics.ts`
> con lo que el rollup (124) y los servicios (126/127) sirven de verdad, y deja una guardia por
> divergencia para que no vuelva.

## 1. Puerta de preguntas (T0) — CERRADA antes de escribir codigo

Las siete preguntas se cerraron el **2026-08-03** con ratificacion humana. La decision de Q1/Q2
vive en `progress/decision_175.md` ⟨D11⟩, que es el artefacto **fechado** que la cabecera de
`metrics.ts:5-7` exige para tocar el catalogo. Esa cita esta escrita en las dos entradas que
cambiaron de `estadoProduccion`, y **R14 la exige por test**.

Consecuencia aceptada y medida antes de decidir: tras pasar `incidentes` y `sin_gestionar` a
`producida`, el catalogo se queda **sin ninguna** metrica `declarada`. El guard
`metrics.test.ts:273` (`toBeGreaterThan(0)`) **no se relajo**: se reexpreso sobre particion +
catalogo sintetico (R4). Lo que protegia es que el filtro **particione**, no que exista deuda.

## 2. Archivos tocados

### Produccion (3 archivos; ninguno con cambio de comportamiento de dato)

| Archivo | Que cambio |
| --- | --- |
| `lib/analytics/types.ts` | `DefinicionMetrica` gana **dos campos opcionales**: `universo?: "b2_vivas_mas_cierres_del_dia"` (dominio cerrado de un valor) y `derivadaDe?: TMetricaId` (estrechado: citar un id inexistente **no compila**). Aditivos: las 12 claves de `Metrica` (R3 de la 135) siguen siendo 12, porque van **dentro** de `definicion`. |
| `lib/analytics/metrics.ts` | `incidentes` y `sin_gestionar` pasan a `estadoProduccion: "producida"`, con el comentario reescrito (los dos anteriores afirmaban hechos falsos) y citando ⟨D11⟩; `ordenes_por_estado` gana `universo` y descripcion reescrita; `sin_gestionar` gana `universo` + `derivadaDe: "ordenes_por_estado"` y descripcion reescrita. **No se anadio ni quito ninguna metrica: siguen 23** (15 operativas + 8 financieras). |
| `app/(app)/analitica/_components/operativo/catalogo-paneles.ts` | **SOLO COMENTARIOS.** Citaba `metrics.ts:220` y `:242` como «declarada», que ya es falso. Verificado con `git diff` filtrando las lineas que no son comentario: **cero lineas de codigo**. Sigue sin leer `estadoProduccion`. |

Y una nota de frontera cerrada en `lib/types/analitica-operativa.ts` (comentario del bloque de
`NOTA_SIN_GESTIONAR`), tambien solo comentario.

### Tests (5 archivos, 2 de ellos nuevos)

| Archivo | Que |
| --- | --- |
| `tests/unit/analytics/catalogo-produccion.guardia.test.ts` | **NUEVO.** R1, R2, R3, R13, R14. |
| `tests/unit/analytics/catalogo-universo.guardia.test.ts` | **NUEVO.** R5, R6, R7, R9, R10, R11, R12. |
| `tests/unit/analytics/metrics.test.ts` | R4: el bloque R33 deja de exigir que existan metricas `declarada` y pasa a exigir **particion** + un caso sobre **catalogo sintetico**. Ningun otro caso tocado. |
| `tests/unit/analytics/tablero-catalogo-paneles.test.ts` | El caso de la 131 se reexpresa: ya **no afirma el valor** de `estadoProduccion`; comprueba que la lista de paneles es **independiente** del campo. |
| `tests/unit/analytics/definiciones-catalogo.guardia.test.ts` | **Solo titulos y cabecera** (dos casos decian «diecinueve» mientras afirmaban `toHaveLength(20)`). **Cero assertions tocadas.** |

### Fuera de alcance, respetado
`lib/services/AnaliticaOperativaService.ts`, repositorios y `db/schema.prisma`: **sin tocar**.
Sin migracion, sin RLS, sin endpoint, sin cambio del contrato de salida.

## 3. Mapa `R<n>` → test nombrado → mutacion que lo pone rojo

Todas las mutaciones se **aplicaron de verdad sobre disco**, se midio el rojo y se revirtieron por
edicion inversa (nunca con `git checkout`). Lo que sigue son resultados **medidos**, no previstos.

| R | Test (archivo › caso) | Mutacion aplicada | Medido |
| --- | --- | --- | --- |
| **R1** | `catalogo-produccion.guardia.test.ts` › «`incidentes` declara productor porque tiene columna en el rollup» | `incidentes` → `"declarada"` | ROJO |
| **R2** | idem › «ninguna metrica citada en una `razon` esta `declarada`» — derivado de `definicion.razon`, **sin lista y sin nombrar `incidentes`** | `entregas` → `"declarada"`; y aparte `devoluciones` → `"declarada"` | ROJO en ambas |
| **R3** | idem › «`sin_gestionar` declara productor: la 126 la deriva del embudo» | `sin_gestionar` → `"declarada"` | ROJO |
| **R4** | `metrics.test.ts` › «admite metricas declaradas sin productor y el filtro particiona el catalogo» **+** › «separa los dos estados en un catalogo SINTETICO con metricas de ambos» | borrar `if (filtro.estadoProduccion …) return false;` de `metrics.ts` | ROJO en los dos (particion: `expected 46 to be 23`) |
| **R5** | `catalogo-universo.guardia.test.ts` › «el embudo declara el universo B2» | borrar `universo` del embudo | ROJO |
| **R6** | idem › «la descripcion del embudo remite a las medidas de flujo para el historico de terminales» | (a) quitar la remision a las 4 medidas de flujo; (b) quitar «el rollup NO conserva el archivo historico…» | ROJO en ambas |
| **R7** | idem › «ninguna descripcion del catalogo cuenta estados a mano» (+ autocomprobacion › «la regla detecta el conteo en digitos y en letra») | (a) reintroducir «19 values»; (b) «los 20 values» | ROJO en ambas |
| **R8** | `definiciones-catalogo.guardia.test.ts` › caso preexistente del embudo (`estados` = `ORDER_STATUS_SEED` exacto) | acotar `estados` a los no terminales | ROJO — **caso NO tocado**, solo su titulo |
| **R9** | `catalogo-universo.guardia.test.ts` › «sin_gestionar se declara derivada de ordenes_por_estado» (+ «toda metrica derivada cita un id que existe en el catalogo y no encadena derivaciones») | borrar `derivadaDe` | ROJO |
| **R10** | idem › «sin_gestionar se describe como del dia, no como acumulada» (+ «la nota del contrato sigue codificando las dos nociones que se exigen») | (a) «NO acumuladas» → «acumuladas»; (b) quitar «HOY» | ROJO en ambas |
| **R11** | idem › «analytics_daily no tiene columna sin_gestionar» + «ninguna metrica derivada tiene en realidad columna propia en el rollup» + «toda metrica de ordenes sin columna propia declara de que otra metrica se proyecta» (lee `db/schema.prisma` en crudo) | anadir `sinGestionar Int @map("sin_gestionar")` al modelo `AnalyticsDaily` | ROJO (caen 3 casos) |
| **R12** | idem › «sin_gestionar conserva clase snapshot y fuente rollup» (+ «una metrica derivada se sirve de la misma clase y fuente que su base») | (a) `clase: "live"`; (b) `fuente: { tipo: "tabla_viva", … }` | ROJO en ambas |
| **R13** | `catalogo-produccion.guardia.test.ts` › «nadie fuera del catalogo decide datos por `estadoProduccion`, `universo` ni `derivadaDe`» — **censo del arbol de archivos, no de imports** | anadir `todas.filter(m => m.estadoProduccion === "producida")` en `AnaliticaOperativaService.ts` | ROJO |
| **R14** | idem › «todo cambio de `estadoProduccion` cita una decision humana registrada en `progress/`» — deriva los pares (metrica, decision) de `progress/decision_*.md`, asi que cubre tambien ⟨D8⟩/`egresos` de la 127 | borrar la cita a `progress/decision_175.md` del comentario de `incidentes` | ROJO |

**14 de 14 requisitos con test nombrado y mutacion medida.**

### Anti-vacuidad
Cada caso lleva assert de sanidad que impide que pase por conjunto vacio: R1 exige >10 columnas
parseadas del esquema y ≥4 metricas con columna; R2, ≥1 razon y ≥4 terminos; R3, ≥5 entradas del
mapa `MEDIDA_DE_METRICA` de la 126; R11 tiene un caso propio («el parseo del modelo AnalyticsDaily
encontro columnas reales»); R13 exige >300 archivos censados, presencia de `app/`, `lib/` y
`components/`, ausencia de `node_modules`, mas autocomprobacion del detector con cinco formas de
lectura (`m.estadoProduccion`, `{ estadoProduccion }`, `m["estadoProduccion"]`, …); R14, ≥3 cambios
derivados y ≥2 ficheros de decision distintos; R7 tiene un caso que autoverifica el regex contra 5
positivos y 2 negativos de prosa legitima.

## 4. Verificacion de «ninguna cifra cambio» (T6.3) — el requisito central

**Ninguna correccion movio una cifra.** Comprobado, no supuesto:

1. **Censo de archivos de produccion tocados: tres.** `types.ts` (dos campos opcionales que hoy
   solo leen las guardias), `metrics.ts` (dato del catalogo) y `catalogo-paneles.ts`
   (**solo comentarios**, verificado filtrando el diff).
2. **Tests de la 126 sin editar ni uno** (`git diff --name-only e4bbbe4a HEAD -- tests/` no
   devuelve ninguno suyo) y **verdes**: `pnpm exec vitest run tests/unit/analytics/operativa
   tests/unit/services/analitica-operativa-service.test.ts
   tests/unit/analytics/analytics-daily-contrato.test.ts` → **20 archivos / 131 tests, todos pasan**.
3. **La unica lectura en runtime de `estadoProduccion`** es el filtro opcional de `listarMetricas`
   (`metrics.ts:~620`) y **ningun llamador de produccion lo usa**; R13 lo fija por censo de arbol.
4. `definicion.estados` de las metricas **operativas** no se consume en runtime (los repositorios
   financieros si consumen `definicion.categorias`, y esta feature no toca ninguna financiera).
5. `universo` y `derivadaDe` son campos **nuevos**: no habia consumidor que pudiera cambiar de
   comportamiento. La derivacion real de `sin_gestionar` la hace la 126 y **no consulta el catalogo**
   para hacerla.

**No se encontro ningun camino** por el que estas ediciones alteren una respuesta servida.

## 5. Dos regresiones propias, encontradas solo por la suite ENTERA

Merecen quedar escritas porque **ningun test relacionado por grafo de imports las selecciona**: son
guardias de **censo de arbol**. `pnpm exec vitest related --run` salio verde con las dos vivas.

1. `tests/integration/db/analytics-daily-guards.test.ts` › «en el catalogo de la 135 el literal es
   una DECLARACION de fuente, no una consulta». La descripcion nueva de `sin_gestionar` metio el
   literal `analytics_daily` dentro de un **string**, y ese guard exige que **toda** ocurrencia en
   `metrics.ts` (retirados los comentarios `//`) sea `tablas: ["analytics_daily"]`. **Se reescribio
   la prosa** («el rollup diario»), **no el guard**: la regla ajena es buena. Medido despues: 14
   ocurrencias = 14 declaraciones. De paso, R11 gano un caso que ata el vocabulario nuevo, porque la
   nocion «no tiene medida propia en el rollup» estaba **sin guardar por texto**.
2. `tests/unit/guards/censo-order-status-rename.test.ts`. `catalogo-universo.guardia.test.ts`
   citaba en un **comentario** un value retirado de `order_status`, y el censo de la 155 lo prohibe
   fuera de su allowlist. **Se reformulo el comentario**, no se allowlisteo el archivo: la allowlist
   es para archivos que *necesitan* el literal historico, no para uno que lo citaba de pasada.

## 6. Gates — salida REAL medida en esta rama

| Gate | Resultado |
| --- | --- |
| `pnpm typecheck` | **0 errores** (`tsc --noEmit`, sin salida, exit 0) |
| `pnpm lint` | **0 errores**, 44 warnings — todos `_args` sin usar en tests ajenos, **ninguno en archivos de esta feature** (verificado filtrando la salida). Nota: el encargo hablaba de 27; lo **medido** en esta rama es 44. |
| `pnpm exec vitest run tests/unit/analytics tests/unit/guards tests/integration/db/analytics-daily-guards.test.ts` | **98 archivos / 1056 tests, todos pasan** |
| `pnpm test` (suite completa) **antes** del fix de §5 | **884 archivos** · **10.927 tests** · **3 rojos** · 264 s |
| `pnpm test` (suite completa) **tras** el fix de §5 | ver §6.2 |

El total de **884 archivos** esta por encima de la referencia (~851) y no hubo bloque de `Errors` de
workers: la suite arranco entera y no reporta de menos.

### 6.1 Los 3 rojos de la corrida previa, evaluados uno a uno
- 2 de ellos eran las **regresiones propias** de §5, ya corregidas.
- `tests/components/descarga/ControlDescargaTransversal.test.tsx` › «descargar no altera la pagina,
  la busqueda ni las filas visibles» → **flake de saturacion**, no regresion. Comprobado **en
  aislado**: `1 archivo / 7 tests, todos pasan`. Archivo ajeno a esta feature (modulo de descarga).
- `tests/integration/db/analytics-daily-migration.test.ts` **no fallo**: la suite se corrio con
  `DATABASE_URL` exportada desde el entorno. **No se creo ningun `.env` en el worktree.** Sin esa
  variable sus 3 casos caen por falta de base, y eso no es defecto de esta feature.

### 6.2 Suite completa final (medida en esta rama, HEAD `4ed15448`)

```
 Test Files  2 failed | 882 passed (884)
      Tests  2 failed | 10926 passed (10928)
   Duration  306.72s
```

Mismo total de **884 archivos** que la corrida anterior: la suite arranco entera, sin bloque de
`Errors` de workers, asi que **no reporta de menos**. Se corrio con `DATABASE_URL` exportada desde
el entorno (sin crear `.env` en el worktree), por lo que los 3 casos de
`tests/integration/db/analytics-daily-migration.test.ts` **pasan**.

**Los 2 rojos son flakes de saturacion, no regresiones**, y se comprobo en vez de suponerse:

| Rojo | En aislado | ¿En el grafo de imports de esta feature? |
| --- | --- | --- |
| `tests/components/CuentasPorPagarTable.test.tsx` › «filtra la lista por nombre de mensajero sin tocar montos» | **VERDE** | **No** |
| `tests/components/descarga/ControlDescargaTransversal.test.tsx` › «descargar no altera la pagina, la busqueda ni las filas visibles» | **VERDE** | **No** |

Aislado medido junto: `2 archivos / 13 tests, todos pasan`. La pertenencia al grafo se comprobo con
`pnpm exec vitest related --run` sobre los cuatro archivos de produccion que toca la feature:
ninguno de los dos aparece en la seleccion. Los dos son componentes (cuentas por pagar, descarga),
ajenos a `lib/analytics/`.

**Lo que NO se midio, y se declara como no medido:** no hay baseline de la suite en `origin/dev`
para esta rama. El primer intento de medirlo corrio antes de que el worktree tuviera
`node_modules` y no sirve. La conclusion de «no regresion» se apoya en las dos comprobaciones de
arriba (aislado + grafo de imports), no en una comparacion contra dev.

## 7. Desviaciones respecto al `design.md`, con su motivo

1. **`catalogo-universo.guardia.test.ts` tiene 15 casos, no 7.** El design nombraba un caso por
   requisito; se anadieron casos de sanidad (anti-vacuidad) y **reglas generales** en vez de asserts
   ad hoc sobre `sin_gestionar`: «toda metrica derivada cita un id que existe y no encadena
   derivaciones», «…no tiene columna propia en el rollup», «…comparte clase y fuente con su base».
   Motivo: cubren la regla, no el sintoma, y sin coste de mantenimiento.
2. **R11 gano un caso de texto** («toda metrica derivada dice en su descripcion que no tiene medida
   propia en el rollup»), a raiz de la regresion 1 de §5.
3. **R3 se ata al servicio de la 126**: el caso parsea `MEDIDA_DE_METRICA` de
   `AnaliticaOperativaService.ts` en crudo para demostrar que `sin_gestionar` comparte medida con
   `ordenes_por_estado`, en vez de afirmar el valor del campo a secas. Mas fuerte que lo propuesto.
4. **R12 vive entero en `catalogo-universo.guardia.test.ts`.** El `requirements.md §4` sugeria
   anadir un caso a `operativa-fuente.guardia.test.ts`; se siguio `tasks.md T4.3` y **no se toco**
   ese archivo ajeno. `operativa-fuente.guardia` sigue verde sin edicion.
5. **El caso sintetico de R4 extiende temporalmente el array `METRICAS` y lo restaura en `finally`**,
   con assert posterior de que el catalogo quedo como estaba. Motivo: `listarMetricas` no admite
   inyectar catalogo y **no se cambio su firma publica solo para un test**. Es la desviacion mas
   discutible de la feature y queda declarada como tal, no escondida.
6. **T5.1 partio el caso de la 131 en dos** (presencia de los paneles + independencia del campo). El
   segundo re-importa `catalogo-paneles` con `vi.doMock` del catalogo enmascarado (todo `declarada`)
   y exige que la lista de paneles salga identica. Medido: con la mutacion
   `filter(estadoProduccion === "producida")` aplicada, **rojo** en sus dos formas.
7. **Los commits de T3 y T4 quedaron fundidos** en `a995aef8` (el mensaje solo nombra T3): el
   subagente estageo `metrics.ts` entero. No se reescribio historia por la prohibicion de mover HEAD.

## 8. Avisos heredados, cerrados (T6.2)

- `specs/124-analitica-job-agregacion-diaria/design.md` (aviso «→ 135, de D2→B2»): **cerrado**. Se
  tomo la via de **acotar el universo temporal** (`universo`), no el vocabulario: `estados` sigue
  siendo `ORDER_STATUS_SEED` a proposito, porque B2 **si** incluye los que cerraron ese dia.
- `specs/126-analitica-operativa-servicios/design.md §9` (las tres divergencias heredadas):
  **cerradas** las tres, cada una con su guardia.
- `lib/types/analitica-operativa.ts`, nota de frontera de `NOTA_SIN_GESTIONAR`: **resuelta**. La
  declaracion ya esta tambien en el catalogo. `metrics.ts` **no importa** esa constante a proposito
  (`modulo-puro.guardia.test.ts` prohibe que `lib/analytics/**` dependa de ese modulo): la
  coherencia entre los dos textos se ata **por test**, no por import.

## 9. Pendiente del leader (T6.4)

- Gate `./init.sh` completo antes del PR.
- **Avisar a la sesion de la 131 antes de mergear**: esta feature edita
  `tests/unit/analytics/tablero-catalogo-paneles.test.ts`, que es suyo (Q4 / ⟨D11⟩).
- Aviso vigente a la **133**: `estadoProduccion` dice si hay **productor**, **no** si el panel se
  pinta. Tras esta feature el riesgo desaparece para estas dos metricas, pero la leccion se mantiene.
