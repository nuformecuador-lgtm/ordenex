# Feature 125 — corrida real medida y runbook del backfill

> Evidencia de R35 (T7). Todo lo de aqui se midio el **2026-08-02** en la maquina de desarrollo,
> contra el Postgres local. **Nada esta extrapolado a produccion**, y donde no se sabe, se dice.

## T7.1 — Saneo de la base antes de medir

1. `pnpm db:generate` desde el schema limpio: `✔ Generated Prisma Client (v7.8.0) ... in 636ms`.
   (El cliente generado sobrevive a los cambios de rama y mete tipos fantasma en el typecheck.)
2. `pnpm exec prisma migrate status` contra `localhost:5432/ordenex`:

```
105 migrations found in prisma/migrations
Database schema is up to date!
```

**Sin drift y sin migraciones pendientes.** Si lo hubiera habido, la medicion se habria parado
aqui: una corrida sobre una base a medio migrar no mide el sistema, mide el accidente.

3. Datos en el rango, comprobados antes de correr (conteos por fecha CR):

| Tabla | Fechas con datos |
|---|---|
| `orden` (`created_at`) | 07-17 (37), 07-19 (6), 07-23 (4), 07-27 (6), 07-28 (1), 07-29 (4) |
| `orden_historial_estado` | 07-17 (134), 07-19 (6), 07-20 (11), 07-21 (3), 07-23 (4), 07-27 (34), 07-28 (2), 07-29 (8), 07-30 (13) |
| `gestion_orden` | 07-17 (23), 07-21 (2), 07-27 (6) |
| `analytics_daily` | **0 filas** (la tabla nacio vacia y esta corrida es su primer escritor real) |

**No hay ni una fila de `orden_historial_estado` anterior al 2026-07-17.** Es la confirmacion, con
datos, de por que el horizonte esta donde esta.

## T7.2 — Ensayo SIN escribir

```
$ pnpm exec tsx scripts/backfill-analitica.ts --desde 2026-07-10 --hasta 2026-08-01

Base de destino: localhost:5432/ordenex
Modo: escritura
Rango: 2026-07-10 .. 2026-08-01
Fechas: 23 (no comparables: 3)
Pausa entre fechas: 0 ms
AVISO: 3 fechas son anteriores al horizonte del historial y van a terminar con exito y CERO filas
en TODAS las medidas. No es que esos dias no tuvieran actividad: es que no se puede saber. Se
etiquetan no_comparable.
PLAN: 23 fechas, de 2026-07-10 a 2026-08-01.
Ensayo: no se ha invocado el agregador. Para ejecutar de verdad, repite con
--confirmar "2026-07-10..2026-08-01".
```

El agregador **no se invoco ni una vez** (`analytics_daily` seguia con 0 filas despues del ensayo).
Y el eco no imprime ni el usuario ni la contrasena de la `DATABASE_URL`.

## T7.3 — Corrida real

```
$ pnpm exec tsx scripts/backfill-analitica.ts --desde 2026-07-10 --hasta 2026-08-01 \
    --confirmar "2026-07-10..2026-08-01" --reporte progress/backfill_125_reporte.json
```

| Fecha | filasEscritas | filasRetiradas | ms | clasificacion |
|---|---:|---:|---:|---|
| 2026-07-10 | 0 | 0 | 205 | no_comparable |
| 2026-07-11 | 0 | 0 | 15 | no_comparable |
| 2026-07-12 | 0 | 0 | 12 | no_comparable |
| 2026-07-13 | 0 | 0 | 11 | procesada |
| 2026-07-14 | 0 | 0 | 12 | procesada |
| 2026-07-15 | 0 | 0 | 11 | procesada |
| 2026-07-16 | 0 | 0 | 11 | procesada |
| 2026-07-17 | 18 | 0 | 98 | procesada |
| 2026-07-18 | 11 | 0 | 20 | procesada |
| 2026-07-19 | 13 | 0 | 22 | procesada |
| 2026-07-20 | 14 | 0 | 26 | procesada |
| 2026-07-21 | 14 | 0 | 19 | procesada |
| 2026-07-22 | 13 | 0 | 17 | procesada |
| 2026-07-23 | 16 | 0 | 19 | procesada |
| 2026-07-24 | 16 | 0 | 22 | procesada |
| 2026-07-25 | 16 | 0 | 20 | procesada |
| 2026-07-26 | 16 | 0 | 17 | procesada |
| 2026-07-27 | 24 | 0 | 26 | procesada |
| 2026-07-28 | 19 | 0 | 20 | procesada |
| 2026-07-29 | 22 | 0 | 20 | procesada |
| 2026-07-30 | 22 | 0 | 21 | procesada |
| 2026-07-31 | 22 | 0 | 25 | procesada |
| 2026-08-01 | 22 | 0 | 27 | procesada |

```
Fechas del rango: 23 | procesadas: 23 | fallidas: 0 | no comparables: 3 | sin procesar: 0
Filas escritas: 278 | filas retiradas: 0 | duracion: 698 ms
Codigo de salida: 0
```

- **Pico de una sola fecha: 24 filas** (2026-07-27). Media: ~12 filas/fecha.
- **Pico de duracion de una fecha: 205 ms** (la primera, que paga el arranque del pool); en
  regimen, 11-27 ms por fecha.
- Reporte en `progress/backfill_125_reporte.json` (23 entradas, sin un solo identificador).

**Los cuatro ceros del 13 al 16 NO son un fallo**: no hay ni una transicion de historial anterior
al 17 de julio en esta base, asi que el estatus al corte no existe para ninguna orden y no hay
cubo que escribir. Es la misma causa que hace no comparables al 10, al 11 y al 12; la diferencia
es que a partir del horizonte el cero SI significa «ese dia no hubo nada que agregar».

## T7.4 — Verificacion

```
$ pnpm exec tsx scripts/backfill-analitica.ts --desde 2026-07-10 --hasta 2026-08-01 \
    --confirmar "2026-07-10..2026-08-01" --verificar --contra progress/backfill_125_reporte.json

Fechas del rango: 23 | procesadas: 23 | fallidas: 0 | no comparables: 3 | sin procesar: 0
Filas escritas: 278 | filas retiradas: 0 | duracion: 689 ms
Estables: 20 | cambiadas: 0
Codigo de salida: 0
```

**20 estables + 3 no comparables = 23. Ninguna cambiada, ninguna fallida, codigo 0.** Y
`filasRetiradas = 0` en las 23 fechas: la segunda pasada no retiro ni una fila, que es la forma
observable de la idempotencia de la 124.

## T7.5 — Lo que estos numeros NO dicen

- **No dicen nada del volumen de produccion.** El rango medido tiene 58 ordenes en total. Un
  pico de 24 filas/fecha aqui no autoriza a escribir ningun umbral de produccion: seria inventar
  una cifra con un multiplicador imaginario, que es justo lo que D5 prohibe. Ver la nota de R34
  en `progress/impl_125.md`.
- **No miden la penumbra.** Las ordenes anteriores al 2026-07-17 que nunca volvieron a
  transicionar siguen invisibles tambien DESPUES del horizonte. Esta feature no la mide y no la
  corrige (L1).
- **No miden concurrencia.** La corrida fue la unica escribiendo en esa base.

---

# T7.6 — Runbook: correr el backfill contra produccion

> Modo de fallo principal: **recomputar el rango equivocado**. Lo que lo contiene son el eco y la
> reintroduccion literal del rango, no una lista blanca de hosts: aqui produccion es un destino
> legitimo (D8) y el script NO la bloquea.

1. **Exporta la variable a mano, en la sesion, y solo para esto.**
   ```
   export DATABASE_URL='postgresql://...'   # nunca se escribe en el codigo ni en un archivo
   ```
   El script no lleva ninguna URL dentro y no imprime jamas el usuario ni la contrasena: del eco
   solo sale `host:puerto/base`.

2. **Ensayo SIN `--confirmar`, SIEMPRE primero.**
   ```
   pnpm exec tsx scripts/backfill-analitica.ts --desde YYYY-MM-DD --hasta YYYY-MM-DD
   ```
   No invoca el agregador ni una vez. **Lee el eco entero antes de seguir**, y comprueba las tres
   cosas que mas se equivocan: la base es la que crees, el rango es el que crees, y el numero de
   fechas no comparables es el que esperas. Si aparecen mas no comparables de la cuenta, el rango
   empieza demasiado atras: por debajo del 2026-07-13 el backfill no puede producir nada.

3. **Corrida real.** El rango se reintroduce **literalmente**, con dos puntos:
   ```
   pnpm exec tsx scripts/backfill-analitica.ts --desde YYYY-MM-DD --hasta YYYY-MM-DD \
       --confirmar "YYYY-MM-DD..YYYY-MM-DD" --pausa-ms 250 \
       --reporte progress/backfill_<fecha>_reporte.json
   ```
   - **Pausa recomendada: 200-300 ms.** En local una fecha cuesta 11-27 ms y el rango entero 0,7 s;
     contra produccion no hay medida, y la pausa es lo unico que acota el ritmo al que se le pide
     trabajo a la base. Si el rango es corto (menos de una semana) se puede dejar en 0.
   - **El reporte es obligatorio en la practica**: sin el no se puede verificar despues.

4. **Verificacion, a continuacion.**
   ```
   pnpm exec tsx scripts/backfill-analitica.ts --desde ... --hasta ... \
       --confirmar "..." --verificar --contra progress/backfill_<fecha>_reporte.json
   ```
   **`--verificar` ESCRIBE**: recomputa cada fecha con el agregador de la 124, que es la unica
   forma de saber si lo escrito sigue siendo lo que la fuente viva produce. La escritura es
   idempotente, asi que sobre una base estable no cambia mas que `updated_at`. Todo `estable` o
   `no_comparable` y codigo 0 = la corrida es buena. Una `cambiada` significa que la fuente viva
   se movio entre las dos pasadas (o que alguien escribio esa fecha por otro camino).

5. **Si aparecen fechas fallidas.** El resumen las nombra una a una. La operacion es idempotente y
   la transaccion de la 124 es todo-o-nada por fecha, asi que la fecha fallida quedo EXACTAMENTE
   como estaba: **vuelve a correr solo ese subrango**, no el rango entero, y solo cuando sepas por
   que fallo. Para ver el error completo, `--verboso` (por defecto solo se imprime la fecha, el
   nombre del error y la etapa, para no volcar al log la clave del cubo que
   `PrimerIntentoIncoherenteError` lleva en su mensaje).

6. **Si el script aborta por tres fallos consecutivos.** No es un dia raro: es el entorno. Revisa
   que la base responde y que la `DATABASE_URL` es la que crees ANTES de volver a lanzar. El
   resumen dice cuantas fechas quedaron sin procesar.

7. **Lo que este script NO puede hacer.** No recomputa el dia CR en curso (ese es del job diario de
   la 124, y no hay lock compartido: el ultimo recomputable es ayer CR). No borra un rango: si un
   rango ya no debe existir, recomputarlo no lo vacia, y no queda forma soportada de vaciarlo con
   esta herramienta (D7). No arregla el pasado anterior al 2026-07-13 (L1).
