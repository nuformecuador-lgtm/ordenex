# Feature 180 — analitica financiera: desglose por fecha · tasks

> `[P]` = paralelizable con las tareas de su misma tanda. Cada tarea lleva su criterio de **hecho**.
> Ninguna tanda posterior empieza sin la anterior cerrada. Gate por tanda: `./init.sh --rapido`.
> Gate final antes del PR: `./init.sh` completo, sin excepcion.

---

## T0 — Puerta humana (bloquea TODO lo demas)

**T0.1 — Cerrar Q1..Q6 de `requirements.md`.**
Dependencias: ninguna. **Hecho:** las seis respuestas quedan escritas (con fecha) en
`progress/decision_180.md`, y `requirements.md` §2 y R2/R18/R26 se ajustan a lo decidido. Si el
humano ordena continuar sin responder, se aplica la recomendacion escrita y se marca
**pendiente de ratificacion**, citando cual seria el coste de revertir cada una.

**T0.2 — Fijar el orden de aterrizaje respecto de la 182 (Q5).**
Dependencias: T0.1. **Hecho:** `progress/decision_180.md` dice si la 180 espera a la 182; si la
180 va primero, se anota en la ficha 182 de `feature_list.json` (`status_note`) que su alcance
incluye ademas las filas por fecha.

---

## T1 — El troceo temporal (modulo puro, sin dinero)

**T1.1 — `lib/analytics/cubo-temporal.ts` con `GranularidadTemporal`, `CuboTemporal`,
`granularidadDe()` y `trocear()`.**
Dependencias: T0.1. **Hecho:** el modulo no importa Prisma, ni repositorios, ni servicios, ni
`next/headers`; todas sus fronteras salen de `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`;
`modulo-puro.guardia.test.ts` sigue verde con el archivo nuevo dado de alta en su lista de modulos.

**T1.2 [P] — Declarar el tope de puntos del servidor en `lib/analytics/types.ts`.**
Dependencias: T0.1. **Hecho:** existe una constante unica (junto a `RANGO_TOPE_DIAS`), ningun
literal `62` aparece en `lib/analytics/cubo-temporal.ts`, y `lib/` no importa nada de
`components/`.

**T1.3 — Tests del modulo puro.**
Dependencias: T1.1, T1.2. **Hecho:** cubren R10, R11, R18, R19, R21 y R29 —incluidos 1, 62, 63, 365
y 366 dias, el primer cubo recortado que no empieza en lunes, y que ninguna salida supera el tope—
y el guardia de igualdad `tope del servidor == MAX_PUNTOS_SERIE` (R20) esta escrito y verde.

---

## T2 — La capa de datos

**T2.1 — Ampliar `IIngresosAnaliticaRepository` con `sumarPorCuboYCategoria` + su tipo de fila.**
Dependencias: T1.1. **Hecho:** la firma recibe `ConsultaAnalitica` y `readonly CuboTemporal[]`;
ningun parametro suelto de fecha, tienda, zona o mensajero; compila en `strict`.

**T2.2 [P] — Ampliar `ICuentasPorPagarAnaliticaRepository` con `...PorCubo` y `...AntesDe`.**
Dependencias: T1.1. **Hecho:** idem T2.1; `...AntesDe` documenta que su unica cota es
`fecha_movimiento < rango.desde` y que NO lleva cota inferior.

**T2.3 — Implementar los tres metodos en los repositorios (SQL parametrizado, ⟨D4⟩/§5.1).**
Dependencias: T2.1, T2.2. **Hecho:** ninguna consulta contiene un nombre de zona horaria ni un
desfase horario; los limites llegan como parametros; sin `try`/`catch`; sin `.sub(`/`.toNumber()`/
`parseFloat`; sin el literal `"0.00"`; los importes salen como cadena de escala 2 desde
`Prisma.Decimal`; se actualiza la prosa de cabecera que decia «ni un `$queryRaw`» explicando la
desviacion y por que (Q6).

**T2.4 — Test de integracion de la frontera de dia CR y del saldo anterior.**
Dependencias: T2.3. **Hecho:** contra la base de test, `T05:59:59.999Z` y `T06:00:00.000Z` caen en
cubos distintos y con las claves esperadas (R11); el saldo anterior al rango incluye un movimiento
de tres meses antes (R14). Si `width_bucket` no esta disponible en la version de Postgres del
entorno, queda escrito en `progress/impl_180.md` y se usa la variante `CASE` de §5.1.

**T2.5 [P] — Tests unitarios de los repositorios con doble de Prisma.**
Dependencias: T2.3. **Hecho:** verifican el `where` (ventana + categorias del catalogo), el orden
estable y que un fallo de base se propaga tal cual (R25).

---

## T3 — El servicio

**T3.1 — `granularidad` obligatoria en `VistaFinanciera` y `IDS_FINANCIERAS_CON_DESGLOSE_POR_FECHA`.**
Dependencias: T0.1, T1.1. **Hecho:** el campo es requerido; las cinco vistas actuales lo declaran
(`no_temporal` donde corresponde); la constante nueva es subconjunto comprobado de
`IDS_FINANCIERAS_SERVIDAS` (R2); el typecheck obliga a completarlo en todo productor.

**T3.2 — Serie de las metricas de caja en `deCaja` y `deTesoreria`.**
Dependencias: T2.3, T3.1. **Hecho:** una fila por cubo, densa y ordenada (R6-R8); cada fila usa
`derivarBalance` / `derivarCaja` y el mismo `importe(...)` del total (R17, R27); el `total` no cambia
respecto de la 127 (R15); `Σ filas == total` en decimal exacto (R12).

**T3.3 — Serie acumulada corrida en `deCuentaDeMensajeros` (⟨D5⟩).**
Dependencias: T2.3, T3.1. **Hecho:** cada fila es el saldo al cierre del cubo (R14); un cubo sin
movimiento repite el saldo anterior y no vale cero (R9); la ultima fila es igual al total (R13); no
hay ni una resta de dinero escrita en el servicio (R17).

**T3.4 [P] — Metricas fuera del conjunto: DTO intacto.**
Dependencias: T3.1. **Hecho:** test de regresion estructural que compara el DTO de las metricas no
incluidas contra el actual, salvo el campo `granularidad` (R3).

**T3.5 — Tests unitarios del servicio con dobles.**
Dependencias: T3.2, T3.3, T3.4. **Hecho:** cubren R1, R3, R6-R15, R17, R26 y R27; los dobles usan
filas coherentes con el CHECK `categoria ↔ tipo` (§7 del design: no se copian los dos dobles que
esperan a la 182).

---

## T4 — Seguridad y determinismo

**T4.1 — Test de alcance sobre la via nueva.**
Dependencias: T3.5. **Hecho:** un rol prohibido recibe `forbidden` sin que ningun metodo nuevo de
repositorio llegue a invocarse (espia sobre el doble); ningun campo de la salida contiene un id de
persona (R24), verificado con un barrido de identidad como el de la tarea E.4 de la 127.

**T4.2 [P] — Test de determinismo.**
Dependencias: T3.5. **Hecho:** dos ejecuciones con la misma consulta y los mismos datos producen
DTOs identicos; ningun `Date.now()` nuevo en el arbol de la feature (R26).

**T4.3 [P] — Test de coherencia cubos ↔ consulta.**
Dependencias: T3.5. **Hecho:** los cubos que el servicio pasa al repositorio son exactamente
`trocear(consulta.rango)`; el servicio no puede pasar una ventana propia sin ponerlo rojo.

---

## T5 — Guardias, regresion y cierre

**T5.1 — Ampliar `financiera-repositorios.guardia.test.ts` de 8 a 11 metodos.**
Dependencias: T2.3. **Hecho:** los tres metodos nuevos estan en la lista de propagacion de errores y
el conteo explicito se actualiza (R31).

**T5.2 [P] — Actualizar los censos de la 127 con los archivos nuevos.**
Dependencias: T2.3, T3.2. **Hecho:** `financiera-fuente.guardia.test.ts`,
`financiera-trazabilidad.guardia.test.ts` y `alcance-obligatorio.guardia.test.ts` incluyen los
archivos nuevos y siguen verdes (R22, R23).

**T5.3 [P] — Comprobar que `cache-financiera.guardia.test.ts` sigue verde sin tocarlo.**
Dependencias: T3.2. **Hecho:** el guardia R15 de la 128 pasa sin modificaciones (R30) y se anota en
`progress/impl_180.md` que la interaccion con la 179 queda declarada, no resuelta.

**T5.4 — Actualizar los fixtures del tablero de la 132.**
Dependencias: T3.1. **Hecho:** `tests/unit/analytics/tablero-financiero-*.test.ts` y
`tests/unit/guards/tablero-financiero.guardia.test.ts` compilan y pasan con el campo nuevo; el
tablero **no** gana panel de lineas en esta feature (Q4 = (a)).

**T5.5 — Mapa de trazabilidad `R<n> → test`.**
Dependencias: todas las anteriores. **Hecho:** `progress/impl_180.md` contiene el mapa completo de
R1..R32, sin huecos, con el nombre exacto de cada test.

**T5.6 — Cierre.**
Dependencias: T5.5. **Hecho:** `./init.sh` completo en verde con el delta de rojos declarado contra
el baseline medido en la propia rama (no citado de una bitacora vieja); `progress/impl_180.md`
recoge la salida; PR abierto.

---

## Grafo de dependencias (resumen)

```
T0.1 ─┬─ T0.2
      ├─ T1.1 ─┬─ T1.3        (con T1.2)
      │        ├─ T2.1 ─┐
      │        └─ T2.2 ─┴─ T2.3 ─┬─ T2.4
      │                          ├─ T2.5 [P]
      │                          └─ T5.1 [P]
      └─ T1.2 [P] ── T1.3

T3.1 ─┬─ T3.2 ─┐
      ├─ T3.3 ─┼─ T3.5 ─┬─ T4.1
      ├─ T3.4 ─┘        ├─ T4.2 [P]
      └─ T5.4 [P]       └─ T4.3 [P]

T5.2 [P], T5.3 [P] ── T5.5 ── T5.6
```

## Riesgos con dueno

- **`width_bucket` / cast de `timestamp(3)`** (T2.3, T2.4): se descubre con la base real, no con
  dobles. Por eso T2.4 es de integracion y no opcional.
- **`pago_mensajero_movimiento` sin indice por fecha** (design §4): no se arregla aqui; si el test de
  integracion muestra un plan malo, se abre ficha con su migracion up/down.
- **Colision con la 182** (T0.2): el mismo DTO tocado por dos features vivas.
- **Baseline de rojos**: la rama nace de un `dev` con rojos conocidos (ver memoria del proyecto);
  medirlo en la propia rama antes de afirmar cualquier delta.
