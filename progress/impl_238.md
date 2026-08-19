# impl 238 — confirmación física de los paquetes al aprobar el cierre

Rama `feature/238-confirmacion-fisica-cierre`, base `origin/dev` = `fc17148e`.
Spec: `specs/238-confirmacion-fisica-cierre/{requirements,design,tasks}.md` (R1–R42, T0–T6).

---

## T0.1 — Medición contra producción, 2026-08-19

Vía **MCP de Supabase, solo lectura**, contra el proyecto de producción. La consulta de `design.md`
§9 es la primera; las otras dos son la **autocomprobación**, sin la cual los ceros no significan
nada.

### (a) Cierres `solicitado` y cuánto tendría que escanear cada uno

```sql
-- design.md §9, tal cual
WHERE c."estado" = 'solicitado'
```

**Resultado: cero filas.**

⚠️ **Un cero de una cola vacía no dice nada**, así que se midió el universo antes de creérselo:

| medida | valor |
| --- | --- |
| cierres, por estado | **12, TODOS `aprobado`** — ninguno en `solicitado`, `vencido` ni `rechazado` |
| gestiones vivas, por resultado | `entregada` 16 · `devuelta` 12 · `reprogramada` 12 · `rechazada` 8 · `incidente` **2** |
| gestiones que VUELVEN, vivas, con cierre | **32** (12+8+12, cuadra) |
| órdenes vivas | **141** |

O sea: el cero de (a) es **«no hay cola ahora mismo»**, no «no hay datos». Hay 12 cierres reales y
32 gestiones que la feature tendría que hacer escanear.

**Consecuencia, que es la que importa:** nadie se encuentra el botón de aprobar bloqueado de golpe
el día del despliegue, porque no hay ningún cierre esperando aprobación. **D8 (avisar a bodega)
deja de bloquear el despliegue**, aunque sigue siendo buena práctica avisar.

⏳ **Es una foto y caduca.** Un cierre solicitado aparece en cuanto un mensajero cierre su día.
**Re-medir justo antes de desplegar**, no antes de mergear.

### (b) Gestiones que vuelven con `orden.num_guia IS NULL` — el número que decide **D3**

**Cero**, y esta vez con universo detrás: **32** gestiones que vuelven vivas, **0** sin número de
guía; y **141** órdenes vivas, **0** sin número de guía.

**La población de D3 no existe hoy.** El comportamiento seguro de **R13** —bloquear y decirlo, nunca
omitir en silencio— **se mantiene como red**, porque el coste de tenerlo es una rama de código y el
de no tenerlo es un paquete que se aprueba sin escanear.

### (c) Incidentes por cierre — para dimensionar la línea de exclusión

Como la cola está vacía, se dimensionó sobre **los 12 cierres ya aprobados**, que es la carga real
que la feature habría tenido:

| | |
| --- | --- |
| cierres medidos | 12 |
| gestiones a escanear, total | 32 |
| por cierre: mínimo / media / **máximo** | 0 / 2,7 / **14** |
| **cierres SIN nada que escanear** | **3 de 12** |
| incidentes totales | 2, repartidos en 2 cierres |

**Tres cosas que esto le dice al diseño, y ninguna estaba en el spec:**

1. **El caso «sin retornables» no es teórico: es 1 de cada 4.** T2.3 y T4.1 lo tratan como un camino
   de igual rango —se aprueba sin ventana— y la medición lo respalda: en 3 de 12 cierres la pantalla
   nueva **no debe aparecer en absoluto**. Un camino que se ejercita el 25 % de las veces no puede
   quedarse en un `else`.
2. **El techo de la ventana es 14 guías**, no 2 ni 3. La lista agrupada de T4.2 tiene que ser usable
   con catorce filas y con bodega escaneando de pie: eso empuja a que el progreso («faltan N») y el
   motivo del bloqueo se vean **sin desplazar**, no al final de la lista.
3. **Los incidentes existen** (2, en 2 cierres distintos), así que **la línea de exclusión de R34 se
   va a ver de verdad** — no es una rama muerta. Y en esos dos cierres conviven con retornables, que
   es justo el caso que T2.4 pide con claves de error disjuntas.

---

## T0.2 — Decisiones firmadas

**Ya estaban firmadas y escritas** en `specs/238-confirmacion-fisica-cierre/requirements.md`
§«PUERTA HUMANA PASADA — 2026-08-19». Se transcriben aquí para que la bitácora sea autosuficiente,
**sin cambiarlas**:

- **D1 — se persiste una marca por gestión**: `gestion_orden.confirmada_fisica_at`, nullable, escrita
  **solo dentro de la transacción**. La granularidad coincide con el acto, reutiliza una tabla que ya
  tiene RLS y cae donde ya escribe la indemnización. **No** se añade `confirmada_fisica_por`: quién
  confirmó es el `resuelto_por` del mismo cierre, y una copia sería una segunda verdad.
- **D2 — NO se puede aprobar con faltantes declarados**, sin escapatoria. La salida cuando un paquete
  no llegó **ya existe y es la correcta**: rechazar el cierre con motivo, que se lo devuelve al
  mensajero. **Consecuencia aceptada: un solo paquete perdido devuelve el cierre entero**, y es
  deliberado — es la fricción que hace que los paquetes aparezcan.
- **D3 — resuelta por medición**, ver (b): la población no existe, R13 se queda como red.
- **D8 — resuelta por medición**, ver (a): deja de bloquear el despliegue.

**Consecuencia de D2 que el spec exige hacer visible en pantalla**: si bodega no puede aprobar, tiene
que entender **por qué** y **qué guías faltan** sin adivinar. Un bloqueo mudo se lee como una app
rota.

---

## T0.3 — El aviso a bodega

**No bloquea T1, y tras (a) tampoco bloquea el despliegue** (no hay cierres en cola que se encuentren
el gesto cambiado de un día para otro). Queda como **acción del humano antes de desplegar**, no como
tarea de código: a partir del despliegue, aprobar exige tener los paquetes delante.
