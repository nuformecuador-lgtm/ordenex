# Medición contra producción para la feature 246 — 2026-08-20

> Hecha por el **leader** vía **MCP de Supabase, solo lectura**, **antes** de llevar las decisiones a
> firma. Es el orden que el spec pedía y que en la 237 no se respetó.

## M1 — ¿a qué hora se asigna de verdad?

| hora (CR) | asignaciones |
| --- | --- |
| 08 · 09 · 10 | 1 · 1 · 1 |
| 12 · 13 | 3 · 4 |
| 15 | 3 |
| **18** | **1** |
| **20** | **1** |

**Denominador: 15 asignaciones en 30 días** (26 en total, sin ventana). ✅ **Autocomprobación: la
suma de la columna da 15**, así que no es «un cero repartido en 24 filas».

**Después de las 18:00 hay 2 de 15 — un 13 %.** Y la más tardía es a las **20:00**, no a las 22:00.

## M2 — la población real del defecto: **CERO**

| medida | valor |
| --- | --- |
| barridas por el corte (`corte_sin_gestionar`), 30 días | **2** |
| barridas **en total**, sin ventana | **2** |
| **de esas, asignadas en las 6 h previas a la corrida** | **0** |
| contexto: filas de historial en total | **612** |

**El defecto no se ha materializado nunca.** El corte ha barrido **2 órdenes en toda la vida de la
base**, y **ninguna** de las dos se había asignado esa misma tarde-noche.

Y hay una razón estructural que el spec ya había encontrado y que esto confirma: **asignar deja la
orden en `por_recoger`, y el corte no barre `por_recoger`** (`ESTADOS_A_BARRER = ["en_reparto",
"ayuda_tienda"]`). Para que el defecto muerda, el mensajero tiene que **haber recogido ya**.

## M3 — ¿se carga la furgoneta de noche? **No**

Recogidas a `en_reparto`, 30 días: **08:00 → 18:00**, y **ninguna después de las 18:00**.
Denominador **26**, y la suma de la columna cuadra.

Concentración en 12:00-15:00 (16 de 26). **Nadie carga de noche**, que es justo la condición que
haría falta para que el corte se llevara una asignación recién hecha.

---

## ⚠️ Lo que estos números NO pueden decidir, y no hay que fingir que sí

Los datos dicen **«no ha pasado»**. Hay **dos lecturas** y la base **no puede distinguirlas**:

1. **El problema es raro.** Se asigna de día, se recoge de día, el corte casi no barre. La ficha
   sería un seguro barato para un caso que no ocurre.
2. **Bodega ya aprendió a no intentarlo.** El pedido humano no fue teórico: *«ya sabemos que por el
   cron, esas asignaciones se van a quitar solas»*. Si bodega **evita** asignar de noche porque sabe
   lo que pasa, entonces el cero **es el síntoma del apaño**, no la prueba de que no haga falta — y
   la ficha no arregla un fallo, **quita una restricción operativa autoimpuesta**.

**La segunda lectura la sostiene un dato que la base no tiene**: la experiencia de quien opera. Yo no
puedo elegir entre las dos con SQL, y **la única persona que puede es la que pidió la ficha.**

Lo que sí dicen los números, sin ambigüedad:

- **No es una urgencia.** No hay nada roto ahora mismo ni una población sufriendo.
- **D5 queda decidida por M3:** nadie carga después de las 18:00, así que el candado al mensajero no
  protege de nada real. **Sin candado.**
- **D6 pierde urgencia:** no hay masa de asignaciones a las 23:00-01:00 (la última es a las 20:00),
  así que el escape del formulario a caballo de la medianoche **se diseña y no se implementa**.

⏳ **Caduca.** Con 15 asignaciones en 30 días, esta base es **pequeña**: un cambio de operación puede
mover estos números en una semana. Re-medir antes de desplegar.

---

## LA LECTURA, ELEGIDA POR EL HUMANO — 2026-08-20

Con los dos ceros delante, el humano eligió la **lectura 2**:

> **Bodega ya evita asignar de noche porque sabe que el cron se lo come.**

Es el dato que la base **no tiene y no puede tener**: la operación real de quien usa la app. Y cambia
qué es esta ficha:

- **No arregla un fallo que esté ocurriendo. Quita una restricción operativa autoimpuesta.** Bodega
  hoy no puede asignar cuando le conviene; tiene que esperar al día siguiente porque el sistema le
  deshace el trabajo. El cero no mide ausencia de problema: mide que **aprendieron a no chocar con
  él**.
- **El valor no se mide en órdenes barridas**, que es lo que M2 cuenta. Se mide en la ventana horaria
  que bodega recupera — y esa no aparece en ninguna tabla, porque lo que no se intenta no deja rastro.
- **Por eso la ficha conserva su prioridad** en vez de irse al fondo de la cola.

⚠️ **Consecuencia para quien la implemente y para quien la mida después:** si tras desplegarla las
asignaciones nocturnas **suben**, eso **no es un efecto secundario, es la confirmación de que la
lectura era correcta**. Y si M2 sigue en cero después, tampoco significa que sobrara: significa que
la reserva está haciendo su trabajo. **Esta ficha no se puede evaluar por el mismo número que la
justificó.**

