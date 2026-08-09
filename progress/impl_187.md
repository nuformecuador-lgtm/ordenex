# Feature 187 — lectura consistente del total y su desglose · BITÁCORA DE IMPLEMENTACIÓN

> Rama `feature/187-analitica-lectura-consistente`, nacida de `origin/dev` (`80aa3721`).
> Worktree `C:/w187`. Spec en `specs/187-analitica-lectura-consistente/`.

## 1. Qué se hizo, en una frase

`deCaja`, `deTesoreria` y `deCuentaDeMensajeros` pedían el total y las filas por cubo con dos (o
tres) consultas independientes por `Promise.all`, sin snapshot compartido. Ahora esas lecturas se
emiten dentro de un **alcance de lectura** (`enLecturaConsistente`) que los repositorios abren como
transacción `repeatable read`. El R12 de la 180 —«Σ filas == total»— pasa de ser cierto solo en los
tests a serlo también en runtime.

## 2. Archivos tocados

**Producción**

| Archivo | Qué cambió |
|---|---|
| `lib/interfaces/repositories/IIngresosAnaliticaRepository.ts` | + `enLecturaConsistente<T>(fn)` con su prosa (qué garantiza, qué no, y por qué el total sigue siendo consulta aparte) |
| `lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository.ts` | ídem |
| `lib/repositories/IngresosAnaliticaRepository.ts` | implementación del alcance + `$transaction` **opcional** en el tipo del cliente mínimo |
| `lib/repositories/CuentasPorPagarAnaliticaRepository.ts` | gemelo exacto |
| `lib/config/analitica-financiera.ts` | + `TIMEOUT_LECTURA_CONSISTENTE_MS` (15 s) y `MAX_WAIT_LECTURA_CONSISTENTE_MS` (5 s) |
| `lib/services/AnaliticaFinancieraService.ts` | **solo** los tres bloques de lectura y un comentario |

**Tests**

`tests/unit/analytics/financiera-lectura-consistente.test.ts` [nuevo],
`tests/unit/services/analitica-financiera-lectura-consistente.test.ts` [nuevo],
`tests/integration/repositories/financiera-lectura-consistente.integration.test.ts` [nuevo],
`tests/unit/analytics/_fake-prisma-dinero.ts` (aprende `$transaction`),
`tests/unit/services/_dobles-analitica-financiera.ts` (aprende el alcance y registra apertura/cierre),
`tests/unit/analytics/financiera-repositorios.guardia.test.ts` (la lista de propagación pasa de 11 a
13), `tests/unit/analytics/financiera-contratos.test.ts` (un stub gana el método; **ni una aserción
cambia**).

**`specs/180-**` NO aparece en el diff**, que es la condición D3 del diseño.

## 3. Mapa `R<n> → test`

| Req | Test que lo cierra | Verde |
|---|---|---|
| R1 | `analitica-financiera-lectura-consistente.test.ts` · «las DOS lecturas de la caja ocurren dentro del MISMO alcance abierto», «la de mensajeros mete sus TRES en uno solo», y el caso paramétrico sobre `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA` | sí |
| R2 | `financiera-lectura-consistente.test.ts` · «abre la transacción con `isolationLevel: RepeatableRead`» **+ I1** contra Postgres | sí |
| R3 | `financiera-lectura-consistente.test.ts` · censo de operaciones dentro del alcance, con escritura sembrada como contra-caso | sí |
| R4 | **I2** · «con una escritura confirmada entre las dos lecturas, Σ filas sigue igual al total» **+ I2b**, el contra-caso sin alcance | sí |
| R5 | `analitica-financiera-service.test.ts` (`consultasHechas() === 2`), `analitica-financiera-serie.test.ts` (R15), y «la caja hace DOS lecturas, ni una menos» | sí |
| R6 | censo de texto sobre el servicio: cero `$transaction` / `isolationLevel` / `prisma.` | sí |
| R7 | `financiera-repositorios.guardia.test.ts`, lista de propagación de 11 → 13 métodos | sí |
| R8 | «`cod_recaudado`, `cuenta_por_pagar_tienda` y `conciliacion_cierres` no abren ningún alcance» | sí |
| R9 | las suites de la 180 y la 127 pasan **sin editar ni una aserción** | sí |
| R10 | «el timeout que se pasa es el de la config» + censo de literales de milisegundos | sí |

## 4. Evidencia de mutación

No basta con que los tests pasen: hay que ver que **mueren** cuando el comportamiento se rompe. Dos
mutaciones aplicadas al servicio y revertidas después (el archivo quedó idéntico, comprobado con
`git diff`).

**Mutación 1 — se quita el alcance de `deCaja`** (vuelta a `Promise.all` suelto). Mueren **3**
casos:

```
× las DOS lecturas de la caja ocurren dentro del MISMO alcance abierto
    AssertionError: expected +0 to be 1
× y el alcance se CIERRA: no queda abierto despues de servir la vista
    AssertionError: expected [] to have a length of 1 but got +0
× LAS SIETE del conjunto con desglose abren UN alcance y no leen nada fuera de el
    AssertionError: ingreso_flete: expected +0 to be 1
```

**Mutación 2 — el total se deriva del desglose** (`sumarPorCategoria` deja de llamarse; las dos
lecturas pasan a ser la misma). Mueren **5** casos, repartidos entre la feature nueva y las suites
heredadas de la 180 — que es exactamente lo que hace caro derivar el total:

```
× la caja hace DOS lecturas, ni una menos: el total no se deriva de las filas
    AssertionError: expected [ 'sumarPorCuboYCategoria', …(1) ] to deeply equal [ 'sumarPorCategoria', …(1) ]
× una `egreso_indemnizacion` en el rango entra en la cifra
    AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
× R15 · las ONCE vistas publican EXACTAMENTE el total escrito, con serie de por medio
× R15 · y tampoco se mueve al cambiar de granularidad: el total no depende del troceo
    AssertionError: expected '0.00' to be '750.00'
```

## 5. Lo que ningún test cubre, dicho con todas las letras

1. **Que el snapshot aguante bajo carga real de producción.** No se promete y no se mide. Lo que
   está medido es que el nivel de aislamiento aterriza en la sesión (I1) y que la invariante resiste
   una escritura confirmada en medio (I2), las dos contra la base de **desarrollo**.
2. **El cambio de perfil de latencia (Q4), aceptado sin medir.** Antes las dos consultas iban en
   paralelo por dos conexiones del pool (coste ≈ la más lenta); ahora van en **serie** sobre una
   sola (coste ≈ la suma, una conexión menos ocupada). Se aceptó sin medición porque el pool es
   `DEFAULT_POOL_MAX = 3` y la analítica es de baja concurrencia — **pero es un cambio real**. Si
   algún día el tablero financiero se percibe lento, este es el primer sitio donde mirar.
3. **Los tiempos del alcance (15 s / 5 s) son cifras ELEGIDAS, NO MEDIDAS.** No hay en el repo
   ninguna medición de cuánto tardan estas consultas contra un ledger real. Están escritas así en el
   comentario de la constante a propósito: la ficha 174 existe precisamente porque un umbral
   provisional sin etiquetar se convierte en dogma.
4. **`deConciliacion` sigue sin snapshot compartido.** Queda fuera por decisión (Q2), no por olvido:
   compara dos cifras de tablas distintas para emitir un aviso, y cambiar de qué foto se calcula un
   aviso de descuadre es semántica de negocio. **Alta pendiente al cerrar esta feature.**

## 6. Riesgo declarado del test de integración

I2 e I2b **escriben y confirman** filas en `wallet_movimiento` de la base de desarrollo — es la
única forma de falsar R4, porque `enTransaccionRevertida` nunca commitea y un lector no vería su
escritura. Autorizado por el humano el 2026-08-08 (Q1, opción (a)). Condiciones que el archivo
cumple: fechas de **2019**, precondición de ventana vacía, ids fijos y borrado por id en un
`finally`.

**Si el runner muere entre el INSERT y el `finally`**, quedan hasta tres filas huérfanas. Se borran
así:

```sql
DELETE FROM wallet_movimiento WHERE id IN (
  'f187aaaa-0000-4000-8000-000000000001',
  'f187aaaa-0000-4000-8000-000000000002',
  'f187aaaa-0000-4000-8000-000000000003'
);
```

## 7. Terreno movedizo: la 181

La feature **181** está viva en otra sesión (worktree `C:/w181`, sin mergear a `dev`) y toca el
mismo `AnaliticaFinancieraService.ts` para añadir la etiqueta de tienda a `FilaFinanciera`. El
conflicto textual al mergear es **esperable** y está acotado a tres bloques de tres líneas: la forma
del diseño (el peso vive en los repositorios y las interfaces, que la 181 no toca) se eligió por
esto. Quien mergee segundo resuelve tres conflictos pequeños; no hay conflicto semántico.

## 8. Verificación

| Comando | Resultado |
|---|---|
| `pnpm run typecheck` | verde |
| `pnpm run lint` | 0 errores (50 warnings preexistentes de `_var` sin usar, ajenos) |
| `pnpm run test:guardias` | 1017/1018 · el rojo es el **timeout** del guard `no-embalaje` bajo carga; en aislado pasa en 1,19 s. Flake conocido (ficha 135), no regresión |
| tests nuevos + tocados (unitarios) | 97/97 |
| suites heredadas 180/127 | 99/99, **sin editar aserciones** |
| integración contra Postgres | 3/3 (I1, I2, I2b) |
| `./init.sh` completo | ver §9 |

## 9. Gate completo — **NO está verde, y no es por esta feature**

`./init.sh` (suite entera, 989 archivos / 12.304 tests) termina en **14 rojos repartidos en 3
archivos**:

| Archivo | Veredicto |
|---|---|
| `tests/unit/components/filter-component.test.tsx` | **Flake de saturación.** Un debounce que emite 2 veces en vez de 1 bajo carga. **Pasa en aislado.** |
| `tests/integration/db/busqueda-comportamiento.test.ts` | **Baseline de `dev`.** 12 rojos entre los dos: la columna generada `busqueda_texto` de la base local incluye el producto y el normalizador de Node no. |
| `tests/integration/db/busqueda-normalizacion-paridad.test.ts` | ídem |

**Por qué consta que no son de la 187, y no es una corazonada.** Esta rama es `origin/dev`
(`80aa3721`) **más 18 archivos**, todos listados en §2, y **ninguno** toca la búsqueda. Los dos
ficheros de `busqueda-*` tienen en esta rama exactamente el mismo contenido que en `dev`, así que
fallan igual ahí. Se comprobó además que corren verdes en el checkout de `ux` — pero **esa
comparación no vale y se deja anotada para que nadie la repita**: `ux` tiene una versión distinta de
esos dos archivos de test (55 casos frente a 54), así que no mide lo mismo.

La corrida previa dio **20 rojos en 11 archivos** y esta **14 en 3**, con los mismos cambios: la
diferencia son flakes por saturación de la máquina, no regresiones. El guard `no-embalaje` cayó por
**timeout** en la primera y pasó en la segunda; en aislado tarda 1,19 s.

**Consecuencia honesta:** el criterio «gate verde antes del PR» **no se cumple**, y no puede
cumplirse mientras `dev` arrastre esos 12 rojos de búsqueda. Lo que sí se cumple, medido: todo lo
que esta feature toca está verde (97 unitarios nuevos/tocados, 99 heredados sin editar aserciones,
3 de integración, 1017 guardias).
