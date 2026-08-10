# Feature 187 — analitica financiera: lectura consistente del total y su desglose · REQUISITOS

> Zona: backend. Complejidad: baja. Depende de: 180 (`specs/180-analitica-financiera-serie-temporal/`).
> Rama: `feature/187-analitica-lectura-consistente`. Worktree: `C:/w187`.

## 1. De donde sale esta feature

De la **nota 3 de `progress/review_180.md`** («las dos consultas no van en la misma transaccion»,
hallazgo `menor`, no bloqueante) y de la **decision ⟨L3⟩ de `progress/impl_180.md`** («el R12 es
cierto en los tests y NO esta garantizado en runtime»).

`deCaja`, `deTesoreria` y `deCuentaDeMensajeros` piden el **total** y las **filas por cubo** con dos
(o tres) consultas independientes lanzadas por `Promise.all`, **sin transaccion ni snapshot
compartido**. Una escritura confirmada en el ledger *entre* esas lecturas deja el total y la Σ de las
filas discrepando — que es exactamente lo que el **R12 de la 180** afirma que no pasa.

**Esto no es un defecto de la 180.** Es un limite suyo, **medido y declarado antes de mergear**
(ficha 187, `status_note`). Lo que esta feature cambia es el runtime, no la afirmacion.

**Impacto real, sin inflarlo ni minimizarlo** (ficha 187): ventana de milisegundos sobre un libro
`append-only`; el sintoma seria un descuadre de centimos en un tablero de consulta, sin corrupcion de
datos. Prioridad **baja de impacto**; alta de honestidad, porque hoy una spec aprobada afirma algo que
el runtime no garantiza.

## 2. Alcance

**Dentro** — las **siete** metricas cuya vista compone `total` y `filas` a partir de dos o mas
lecturas del mismo repositorio, que son exactamente las de
`IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` (`lib/types/analitica-financiera.ts`):
`ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva`, `egresos` (`deCaja`); `dinero_en_caja`,
`ganancia_ordenex` (`deTesoreria`); `cuenta_por_pagar_mensajero` (`deCuentaDeMensajeros`).

La ficha nombra `deCaja` y `deTesoreria`; **`deCuentaDeMensajeros` entra tambien**, y el motivo esta
en la fuente: la nota 3 del review nombra los **tres** metodos. Sus TRES lecturas
(`...AlCorte`, `...AntesDe`, `...PorCubo`) sostienen la invariante **R13 de la 180** (la ultima fila
== el total) por la misma via de dos caminos independientes, y estan expuestas a la misma ventana.
Dejarla fuera arreglaria dos tercios del hallazgo y dejaria el tercero sin nombre.

**Fuera, con motivo escrito** (§ 6 de `design.md` lo desarrolla):

- `deRecaudo` (`cod_recaudado`): dos lecturas, si — pero de **tablas distintas** que producen **dos
  vistas distintas** con `sumableCon: []`. Ninguna spec afirma igualdad entre ellas; no hay invariante
  que defender.
- `deSaldoDeTiendas` (`cuenta_por_pagar_tienda`): **una sola** lectura. Nada que sincronizar.
- `deConciliacion` (`conciliacion_cierres`): si compara dos cifras (snapshot vs ledger) y **emite un
  aviso**, pero su tercera lectura es **secuencial y dependiente** de la segunda y su comparacion
  cruza dos tablas con semantica de auditoria. Cambiar de que foto se calcula un aviso de descuadre
  es una decision de negocio distinta y merece su propia puerta. Queda propuesta como ficha aparte
  (pregunta abierta **Q2**).

**Fuera tambien:** cualquier cambio en el DTO, en la UI, en el catalogo, en el esquema o en las
migraciones. No hay tabla nueva, ni columna nueva, ni RLS que tocar.

## 3. Las dos prohibiciones de la ficha, citadas

Las recojo aqui porque son requisitos negativos y se testean como tales (R5, R6):

1. **NO se arregla derivando el total sumando las filas** (`status_note` de la ficha 187, y ⟨L3⟩ de
   `progress/impl_180.md`): «eso convierte el R12 en una TAUTOLOGIA y destruye lo unico que hoy lo
   hace valioso, que la igualdad se comprueba entre DOS caminos independientes (el total por
   `sumarPorCategoria`, las filas por cubo). El arreglo correcto es de infraestructura de repositorio
   (transaccion de solo lectura), no de calculo».
2. **No es un defecto de la 180**, es un limite suyo declarado. Consecuencia operativa:
   `specs/180-analitica-financiera-serie-temporal/requirements.md` **no se reescribe** (decision D3 de
   `design.md`).

## 4. Requisitos (EARS)

### 4.1 La garantia

**R1.** MIENTRAS el sistema sirve una metrica de
`IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`, TODAS las lecturas que componen su vista —el total y el
desglose por cubo— DEBEN ejecutarse dentro de **una unica lectura consistente**, es decir sobre el
mismo snapshot de la base.

**R2.** El sistema DEBE abrir esa lectura consistente como una **transaccion con nivel de aislamiento
`repeatable read`**, y ese nivel DEBE estar efectivamente activo en la sesion que ejecuta las
consultas (no solo solicitado en el codigo).

**R3.** MIENTRAS una lectura consistente esta abierta, el sistema NO DEBE emitir dentro de ella
ninguna sentencia que no sea de lectura.

**R4.** CUANDO una escritura ajena se confirma en el ledger **entre** la primera y la ultima lectura
de una misma vista, el sistema DEBE devolver una vista en la que la invariante de la 180 se siga
cumpliendo: para las metricas de flujo, Σ de los importes de las filas **exactamente igual** al
`total` campo a campo, comparado como decimal; para la acumulada, el importe de la **ultima** fila
exactamente igual al `total`.

**R5.** El sistema DEBE seguir obteniendo el `total` y el desglose por **consultas separadas**: el
`total` DEBE seguir saliendo de `sumarPorCategoria` / `cuentaPorPagarMensajerosAlCorte` y el desglose
de `sumarPorCuboYCategoria` / `cuentaPorPagarMensajerosPorCubo`, y el numero de lecturas de
repositorio por vista DEBE ser **el mismo que antes de esta feature** (dos en `deCaja` y
`deTesoreria`, tres en `deCuentaDeMensajeros`).

**R6.** El servicio NO DEBE conocer la transaccion ni el nivel de aislamiento: la apertura de la
lectura consistente DEBE vivir en la capa de repositorio, y el servicio NO DEBE mencionar `$transaction`,
`isolationLevel` ni ningun identificador de Prisma.

### 4.2 Lo que no puede degradarse

**R7.** SI la base falla dentro de una lectura consistente, ENTONCES el error DEBE propagarse tal
cual, sin `try`/`catch` en el repositorio y sin ningun importe por defecto.

**R8.** MIENTRAS el sistema sirve una metrica financiera que **no** esta en
`IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` (`cod_recaudado`, `cuenta_por_pagar_tienda`,
`conciliacion_cierres`), NO DEBE abrir ninguna lectura consistente y su comportamiento observable
DEBE ser identico al de antes de esta feature.

**R9.** El contrato de salida (`ResultadoFinanciero` y su arbol) NO DEBE cambiar: ni un campo nuevo,
ni uno retirado, ni un cambio de forma, para ninguna de las diez metricas financieras.

**R10.** Los limites de tiempo de la lectura consistente (espera maxima por una conexion y duracion
maxima de la transaccion) DEBEN resolverse por configuracion en `lib/config/analitica-financiera.ts`,
y NO DEBE escribirse ningun numero de tiempo dentro de los repositorios.

## 5. Como se testea esto sin base real, y donde no alcanza

Un requisito que dice «hay aislamiento» y un test que solo comprueba que se llamo a `$transaction`
**no son lo mismo**. El reparto es explicito y cada nivel dice lo que puede y lo que no:

| Nivel | Que demuestra | Que NO puede demostrar |
|---|---|---|
| **Doble de servicio** (`tests/unit/services/_dobles-analitica-financiera.ts`) | Que las dos/tres lecturas ocurren **dentro** del alcance abierto (el doble registra apertura, cierre y a que lecturas cubre), que siguen siendo dos/tres y que las metricas de fuera NO abren alcance | Nada sobre Postgres |
| **Fake de Prisma** (`tests/unit/analytics/_fake-prisma-dinero.ts`) | Que el repositorio pide `$transaction` con `isolationLevel: "RepeatableRead"`, que **todas** las consultas del alcance salen por el cliente de la transaccion y **ninguna** por el cliente de fuera, y que dentro solo hay lecturas | Que Postgres respete de verdad ese nivel |
| **Integracion I1** (sin escrituras) | Que dentro del alcance `current_setting('transaction_isolation')` vale `repeatable read` y **fuera vale otra cosa** — o sea, que la opcion de Prisma aterriza en la sesion real | Que el snapshot sostenga la invariante frente a una escritura |
| **Integracion I2** (con escritura concurrente confirmada) | **R4 falsado de verdad**: la unica prueba de que la vista cuadra con una escritura confirmada en medio | — |

**Con que se conforma la feature:** R1, R2, R3, R5, R6, R7, R8, R9 y R10 quedan cubiertos por tests
unitarios que corren sin base (el gate normal). **R2 e I1** y **R4 e I2** exigen Postgres real, se
saltan sin `DATABASE_URL` (mismo criterio que
`tests/integration/repositories/financiera-cubo-temporal.integration.test.ts`) y **no** los corre
`./init.sh` en una maquina sin base. Su coste esta declarado en `design.md` §7 y **I2 depende de la
pregunta abierta Q1**: si el humano no autoriza filas comprometidas en la base de desarrollo, R4 se
queda sin falsacion ejecutable y hay que **declararlo como limite** en la bitacora, igual que la 180
declaro el suyo — nunca darlo por hecho.

## 6. Trazabilidad requisito → test

Archivos nuevos marcados `[nuevo]`; el resto ya existen y se **amplian, nunca se relajan** (R31 de la
180 sigue vigente).

| Req | Comportamiento verificado | Test |
|---|---|---|
| **R1** | las siete metricas del conjunto abren **un** alcance y sus lecturas caen dentro | `tests/unit/services/analitica-financiera-lectura-consistente.test.ts` [nuevo] · «las dos lecturas de la caja ocurren dentro del MISMO alcance abierto», «la de mensajeros mete sus TRES lecturas en uno solo», y el caso parametrico sobre `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` |
| **R2** | el repositorio pide `RepeatableRead`, y el nivel esta activo de verdad en la sesion | `tests/unit/analytics/financiera-lectura-consistente.test.ts` [nuevo] · «abre la transaccion con isolationLevel RepeatableRead» + `tests/integration/repositories/financiera-lectura-consistente.integration.test.ts` [nuevo] · **I1** «dentro del alcance la sesion dice `repeatable read`; fuera dice otra cosa» |
| **R3** | dentro del alcance solo hay lecturas | `tests/unit/analytics/financiera-lectura-consistente.test.ts` [nuevo] · «toda operacion registrada dentro del alcance es groupBy o queryRaw de SELECT» (con contra-caso: una escritura sembrada se detecta) |
| **R4** | la invariante resiste una escritura confirmada en medio | `tests/integration/repositories/financiera-lectura-consistente.integration.test.ts` [nuevo] · **I2** «con una escritura confirmada entre las dos lecturas, Σ filas sigue igual al total» + su contra-caso «sin alcance, las mismas dos lecturas discrepan» (la mitad que demuestra que el caso muerde) |
| **R5** | dos caminos independientes, ni una lectura de menos; el total sigue saliendo de su propia consulta | `tests/unit/services/analitica-financiera-service.test.ts` (existente: `sumarPorCategoria` 1 vez, `sumarPorCuboYCategoria` 1 vez, `consultasHechas() === 2`) + `tests/unit/services/analitica-financiera-serie.test.ts` (existente: R15 con material `*PorCubo` distinto del agregado, que muere si alguien deriva el total) + caso nuevo «tres lecturas y no dos» en `analitica-financiera-lectura-consistente.test.ts` [nuevo] |
| **R6** | el servicio no habla Prisma | `tests/unit/services/analitica-financiera-lectura-consistente.test.ts` [nuevo] · censo de texto sobre `lib/services/AnaliticaFinancieraService.ts`: cero `$transaction`, `isolationLevel`, `RepeatableRead`, `prisma.` (con contra-caso sintetico que si cae) |
| **R7** | el error sube tal cual, tambien por el camino nuevo | `tests/unit/analytics/financiera-repositorios.guardia.test.ts` (ampliado: la lista de propagacion pasa de **11 a 13** metodos e incluye los dos alcances; el cliente que siempre falla revienta tambien por `$transaction`) |
| **R8** | las tres de fuera no cambian y no abren alcance | `tests/unit/services/analitica-financiera-lectura-consistente.test.ts` [nuevo] · «`cod_recaudado`, `cuenta_por_pagar_tienda` y `conciliacion_cierres` no abren ningun alcance» + `tests/unit/analytics/financiera-granularidad.test.ts` (existente, sus DTOs escritos a mano) |
| **R9** | el contrato de salida es el mismo | `tests/unit/analytics/financiera-contratos.test.ts` (existente) + `tests/unit/services/analitica-financiera-serie.test.ts`, `analitica-financiera-serie-frontera.test.ts`, `analitica-financiera-derivacion.test.ts` (existentes: pasan **sin editar sus aserciones**, y eso es la evidencia) |
| **R10** | los tiempos salen de configuracion | `tests/unit/analytics/financiera-lectura-consistente.test.ts` [nuevo] · «el timeout que se pasa es el de `lib/config/analitica-financiera.ts`» + censo «ningun literal de milisegundos en los dos repositorios» |

## 7. Preguntas abiertas

> **PUERTA CERRADA POR EL HUMANO — 2026-08-08.** Las cuatro quedan resueltas asi, y las
> respuestas son vinculantes para la implementacion:
>
> - **Q1 → opcion (a), AUTORIZADA.** I2 siembra y **confirma** dos o tres filas propias en
>   `wallet_movimiento` de la base de **desarrollo**, con fechas de 2019 e ids uuid conocidos, desde
>   un segundo cliente, y las borra por id en un `finally`. Precondicion obligatoria: comprobar que
>   la ventana de 2019 esta **vacia** antes de sembrar, y abortar el test si no lo esta. El riesgo
>   declarado (runner muerto a mitad → filas huerfanas de 2019 en un libro `append-only` de
>   desarrollo) queda aceptado a sabiendas. R4 se falsa de verdad; **no** se declara como limite.
> - **Q2 → fuera, ficha aparte.** `deConciliacion` no entra. Al cerrar la feature se da de alta la
>   ficha nueva citando esta spec como precedente.
> - **Q3 → se acepta la propuesta:** `timeout: 15_000`, `maxWait: 5_000`, en constante nueva de
>   `lib/config/analitica-financiera.ts` con el comentario de por que. Son cifras **elegidas, no
>   medidas**, y el comentario debe decirlo con esas palabras — el precedente de lo que cuesta
>   ocultarlo esta en la ficha 174.
> - **Q4 → no se mide antes de aprobar.** El cambio de perfil de latencia (dos conexiones en
>   paralelo → una en serie) se acepta: el pool es `DEFAULT_POOL_MAX = 3` y la analitica es de baja
>   concurrencia. Se **anota en `progress/impl_187.md`** como lo que es, un cambio real de perfil sin
>   medicion, para que quien vea lentitud en el tablero financiero sepa donde mirar.

**Q1 — BLOQUEANTE para R4. ¿Se autoriza que el test de integracion I2 confirme (COMMIT) filas propias
en `wallet_movimiento` de la base de desarrollo y las borre despues?**
Un snapshot solo se puede falsar con una escritura **confirmada por otra conexion** mientras el lector
tiene la transaccion abierta: por definicion, `enTransaccionRevertida` (`tests/integration/db/_postgres-real.ts`)
**no sirve** aqui, porque su transaccion nunca commitea y el lector no la veria.
Opciones: **(a)** I2 siembra dos o tres filas con fechas de **2019** e ids uuid conocidos desde un
segundo cliente, y las borra en un `finally` por id, con precondiciones que comprueben que la ventana
esta vacia antes de empezar; riesgo declarado: si el runner muere a mitad, quedan filas de 2019 en un
libro `append-only` de la base de **desarrollo**. **(b)** No se escribe nada: R4 se queda cubierto
solo por R1+R2+R3 (composicion) y se **declara como limite** en `progress/impl_187.md`, igual que la
180 declaro el suyo. **(c)** Se levanta una base efimera solo para I2 — no hay hoy en el repo ninguna
infraestructura para eso y no la invento.
*Recomendacion:* **(a)**. Sin ella esta feature repite el patron que vino a cerrar: afirmar una
garantia que ningun test ejecuta. Pero es escritura en una base real y la decision es del humano.

**Q2 — no bloqueante. ¿`deConciliacion` entra aqui o en ficha aparte?**
Compara `total_snapshot` contra `total_ledger` y **emite un aviso** por encima del umbral; sus lecturas
tampoco comparten snapshot. La dejo fuera (§2) porque su tercera lectura es dependiente de la segunda
y porque cambia **de que foto se calcula un aviso**, que es semantica de negocio y no infraestructura.
*Recomendacion:* ficha nueva de complejidad `small`, con esta spec como precedente.

**Q3 — no bloqueante. ¿Que valores para el timeout y el `maxWait` del alcance (R10)?**
No hay en `docs/`, `specs/` ni el codigo ninguna medicion de cuanto tardan estas dos consultas contra
un ledger real, asi que **no invento un numero**. Precedentes del repo: el default de Prisma es 5 s
(pensado para una mutacion de una request) y la 124 subio el suyo a `120_000` ms para una agregacion
diaria (`lib/config/analitica-rollup.ts`). Aqui son dos agregados de lectura dentro de una request de
usuario. *Propuesta a confirmar:* `timeout: 15_000`, `maxWait: 5_000`, en una constante nueva de
`lib/config/analitica-financiera.ts` con su comentario de por que.

**Q4 — no bloqueante. ¿Preocupa que el alcance ocupe UNA conexion durante las dos lecturas?**
Hoy las dos consultas van en paralelo (dos conexiones, coste ≈ la mas lenta); dentro de una
transaccion van en serie sobre una sola (coste ≈ la suma, una conexion menos ocupada). El pool es
`DEFAULT_POOL_MAX = 3` por instancia (`lib/db/prisma-client.ts`) y la analitica es de baja
concurrencia, asi que **no** parece un problema — pero es un cambio de perfil de latencia real y no
tengo medicion. Si al humano le importa, se mide antes de aprobar.
