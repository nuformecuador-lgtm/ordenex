# 425 — Una orden rechazada por la tienda se queda sin salida para siempre · Requisitos (EARS)

> **Entrada vinculante:** `progress/decisiones_425.md` (D1/D2/D3, firmadas por Carlos Restrepo el
> 2026-09-14) y la ficha 425 de `feature_list.json`. Nada de lo que dice ese archivo se reabre aquí.
> Lo que sigue lo desarrolla; no lo discute.
>
> **Estado: diseño APROBADO por Carlos Restrepo el 2026-09-14.** Sin preguntas abiertas (§5). La vía
> elegida es el vínculo de revisión en tabla propia (`cierre_rechazo_tienda`): el rechazo **se ve** en
> el cierre y su aprobación destraba la orden, **sin entrar en el cálculo del dinero**.

## 0. El defecto, en una frase

Dos decisiones correctas por separado se cruzan mal: la **139** hace que la única salida del estado
`rechazada` sea aprobar un cierre, y la **337** saca del cierre del mensajero toda gestión nacida en
el escritorio de la tienda (`rechazo_tienda`, `reprogramacion_tienda`). Un mensajero cuyas únicas
gestiones sueltas son de escritorio **no llega a tener cierre** (`crearCierre` devuelve `null` por la
guarda «algo pasó»), así que ninguna aprobación libera su orden. Medido contra producción el
2026-09-14: **3 órdenes atascadas**, **46 rechazos de tienda vivos fuera de cierre** repartidos en 6
mensajeros, **43 reprogramaciones** más (que **no** atascan: el cron las libera al llegar su fecha).

## 1. Vocabulario (para que los requisitos no dependan de una implementación)

| Término | Qué significa aquí |
| --- | --- |
| **rechazo de tienda** | Gestión con `resultado = rechazada` cuya fila de historial nació con `origen_tipo = rechazo_tienda` (la tienda rechaza a mano una devolución ya anclada, ficha 240). |
| **gestión propia del mensajero** | Toda gestión que hoy entra en su cierre: calle (`gestion`) y ayuda de tienda (`gestion_tienda_ayuda`), más las sintéticas ya admitidas (`escalado_devuelta_sla`, `rechazo_tope_intentos`). |
| **material de revisión del cierre** | Lo que el documento del cierre muestra a quien lo aprueba. Hoy son las gestiones vinculadas **y** las órdenes barridas a `sin_gestionar` (ficha 264), que ya se muestran sin ser gestiones. |
| **totales del cierre** | Las seis columnas snapshot de `cierre_dia`: `total_efectivo`, `total_simpe`, `total_transferencia`, `total_general`, `total_pago_mensajero`, `total_ingreso_bodega_rechazos`. |

## 2. Alcance

**Dentro:** que un rechazo de tienda llegue al cierre como material de revisión, que la aprobación de
ese cierre devuelva la orden al estado que le toca por zona, y que nada de eso mueva un céntimo.

**Fuera (y se dice, no se omite):**

- **Los 25 rechazos sin `ingreso_bodega_rechazo` congelado** (~₡4.000 al ritmo medido de ₡164 por
  rechazo). El humano decide **después**, con este diseño delante. Esta ficha está obligada a **no
  resolverlo por accidente**: ver `R9`.
- Las **43 gestiones `reprogramacion_tienda`** (D2). Ver `R17`.
- El cobro a la tienda por el flete de devolución, que desde la segunda mitad de la 337 tiene vía
  propia (`rechazo_tienda_cobro`, aprobado en `/wallet`). Esta ficha está obligada a **no volver a
  emitirlo**: ver `R8`.

---

## 3. Requisitos

### 3.1 Pertenencia: el rechazo llega al cierre (D1)

**R1.** CUANDO el sistema cree un cierre del día de un mensajero —lo pida él o lo genere el corte
diario—, el sistema DEBE incorporar a ese cierre, como material de revisión, **todo rechazo de
tienda** atribuido a ese mensajero que esté vigente (no anulado), que no pertenezca a ningún cierre y
que ningún cierre anterior haya incorporado ya.

**R2.** CUANDO un cierre incorpore un rechazo de tienda, el sistema DEBE dejar constancia
**persistente** del vínculo entre ese cierre y esa gestión, de forma que sobreviva a la aprobación
del cierre y a cualquier cambio posterior de la orden.

**R3.** MIENTRAS un rechazo de tienda esté vinculado a un cierre, el sistema DEBE excluirlo de la
incorporación a cualquier cierre posterior, del mismo mensajero o de otro.

**R4.** SI el proceso de creación del cierre se repite sobre el mismo cierre (reintento, segunda
corrida del corte), ENTONCES el sistema DEBE terminar con **un solo** vínculo por par (cierre,
gestión) y sin efecto adicional alguno.

**R5.** SI un mensajero no tiene ninguna gestión propia pendiente pero sí al menos un rechazo de
tienda no incorporado, ENTONCES el sistema DEBE crear igualmente su cierre (hoy devuelve `null` y no
se crea ninguno: es exactamente lo que deja sin salida a la orden).

### 3.2 Dinero: se ve, pero no se paga (la tensión de D1 contra el motivo legítimo de la 337)

**R6.** MIENTRAS un cierre incorpore uno o más rechazos de tienda, el sistema DEBE mantener
`cierre_dia.total_pago_mensajero` **idéntico**, al céntimo, al que ese mismo cierre tendría sin
ellos.

**R7.** MIENTRAS un cierre incorpore uno o más rechazos de tienda, el sistema DEBE mantener las otras
cinco columnas de totales (`total_efectivo`, `total_simpe`, `total_transferencia`, `total_general`,
`total_ingreso_bodega_rechazos`) **idénticas**, al céntimo, a las que ese mismo cierre tendría sin
ellos.

**R8.** CUANDO un administrador apruebe un cierre que incorpore rechazos de tienda, el sistema NO
DEBE emitir, por causa de esos rechazos, ningún apunte en la caja de Ordenex, en el libro de la
tienda ni en el libro de pago del mensajero. En particular NO DEBE emitir `ingreso_flete_devolucion`
ni `ingreso_iva_flete_devolucion` —que la vía propia de la 337 ya emite al aprobar el cobro
pendiente— para esas gestiones.

**R9.** CUANDO un cierre incorpore un rechazo de tienda, el sistema DEBE dejar el
`ingreso_bodega_rechazo` de esa gestión **sin congelar** (`NULL`), tal y como está hoy. La pausa de
la 337 sobre ese concepto sigue en pie y esta ficha no la levanta.

**R10.** CUANDO un administrador apruebe un cierre, el sistema NO DEBE exigir confirmación física de
los paquetes correspondientes a los rechazos de tienda incorporados. (Esos paquetes ya están en la
bodega desde su devolución; la confirmación física de la 238 no tiene puerta de escape y exigirlos
convertiría el atasco actual en un cierre inaprobable.)

### 3.3 Salida de la orden (lo que la ficha viene a arreglar)

**R11.** CUANDO un administrador apruebe el cierre de un mensajero, el sistema DEBE transicionar cada
orden de ese mensajero que esté en `rechazada` al estado que le corresponde **según la zona de la
orden**: `por_devolver_a_tienda` si su bodega responsable es la central, `por_devolver` si es
satélite.

**R12.** CUANDO esa transición ocurra, el sistema DEBE registrarla en el historial de la orden con el
administrador que aprobó como actor, y NO DEBE tocar ni el mensajero asignado, ni la prioridad, ni
ningún importe de la orden.

**R13.** CUANDO se apruebe el primer cierre que incorpore los rechazos históricos, el sistema DEBE
sacar de `rechazada` las **tres** órdenes hoy atascadas —**NA-947** (guía 19301246), **NA-981**
(58980454, tienda Nuform) y **NA-1103** (85696637), las tres de Arnel Guillen Arce, medido el
2026-09-14— **sin ninguna edición manual** sobre la orden ni sobre su gestión.

### 3.4 Lo que ve quien aprueba (D1: «es la manera de enterarse», y D3: «que no parezca un error»)

**R14.** MIENTRAS un cierre tenga rechazos de tienda incorporados, el sistema DEBE mostrarlos en
**todas** las superficies que rinden el comprobante detallado de ese cierre (detalle del mensajero,
detalle del administrador y comprobante imprimible), y NO en solo algunas.

**R15.** El sistema DEBE mostrar, por cada rechazo incorporado, los datos necesarios para **separar
el paquete**: número de guía, número de remisión, destinatario, producto, tienda y **la fecha en que
la tienda lo rechazó**.

**R16.** El sistema DEBE presentar esos rechazos en una sección **separada** de las gestiones del
mensajero, rotulada de modo que se lea que son decisiones de la tienda, que no son trabajo del
mensajero y que no suman a su pago.

### 3.5 No-regresión (lo que NO puede cambiar por accidente)

**R17.** El sistema DEBE mantener las gestiones `reprogramacion_tienda` **fuera de todo cierre**: ni
vinculadas, ni incorporadas como material de revisión, ni listadas en ninguna superficie del cierre
(D2).

**R18.** El sistema DEBE seguir incorporando al cierre del mensajero, con el mismo efecto sobre los
totales que hoy, sus gestiones de calle (`gestion`) y de ayuda de tienda (`gestion_tienda_ayuda`).

**R19.** MIENTRAS un cierre no tenga ningún rechazo de tienda incorporado, el sistema DEBE comportarse
exactamente como antes de esta ficha: mismos totales, mismos vínculos, mismos apuntes y misma
confirmación física.

**R20.** SI un cierre que incorporó rechazos de tienda es **rechazado** por el administrador,
ENTONCES el sistema DEBE conservar esos rechazos vinculados a ese mismo cierre, de modo que al
re-solicitarlo sigan siendo los suyos y no los recoja otro (misma conducta que ya tienen las
gestiones de dinero).

### 3.6 Datos

**R21.** DONDE esta ficha cree almacenamiento nuevo, el sistema DEBE dejarlo **sin ninguna columna de
importe** y con RLS habilitada sin políticas, porque contiene PII (destinatario y guía) y porque la
imposibilidad de mover un total tiene que ser estructural y no una promesa de la capa de arriba.

---

## 4. Lo que hay que MEDIR, no suponer

Trasladado literalmente de `progress/decisiones_425.md` §«Lo que el spec tiene que MEDIR» y ampliado
con lo que apareció al leer el código. Las consultas viven en `design.md` §8 y las tareas en
`tasks.md` (bloque **M**). Ninguna de estas medidas puede sustituirse por un razonamiento:

1. **M1** — El efecto sobre los totales de un cierre **real** de producción, antes y después.
2. **M2** — Que `total_pago_mensajero` no se mueve cuando entra un rechazo de tienda.
3. **M3** — Que la orden sale de `rechazada` y llega al estado que le toca **según su zona**.
4. **M4** — Que las reprogramaciones de tienda siguen fuera, y que no cambió por accidente.
5. **M5** *(añadido)* — ✅ **YA MEDIDO el 2026-09-14 contra producción, no supuesto.** Que **el bloqueo
   que se está arreglando es el único que hay**: el bloque 139 busca las `rechazada` por
   `mensajero_asignado_id`, no por las gestiones del cierre, así que una orden sin mensajero no se
   destrabaría. **Las 3 órdenes atascadas conservan las tres su `mensajero_asignado_id`, y las tres
   son del mismo mensajero — Arnel Guillen Arce**: NA-947 (guía 19301246), NA-981 (58980454) y
   NA-1103 (85696637). El arreglo las destraba. Detalle en `design.md` §1.1.
6. **M6** *(añadido)* — Cuántos de los 46 rechazos tienen ya su `rechazo_tienda_cobro` **aprobado**
   (24 cobros / ₡65.088 medidos): es la evidencia de que la tienda **ya pagó** y de que `R8` no es
   una precaución teórica.
7. **M7** *(añadido)* — A cuántos de los 6 mensajeros les aparecerá un cierre nuevo que hoy no
   existía, y si alguno queda **bloqueado por acumular** (271: N ≥ 2 cierres abiertos) por culpa de
   él. Es consecuencia directa de D1 y hay que decirla antes, no descubrirla.

---

## 5. Preguntas cerradas

> **No queda ninguna pregunta abierta.** Las cinco que este spec planteó se cerraron el **2026-09-14**
> con la aprobación del diseño por Carlos Restrepo. Se conservan aquí con su respuesta para que nadie
> las vuelva a abrir creyendo que no se miraron. Ninguna reabre D1/D2/D3.

**Q1 — Lectura de D1: «entra al cierre» ¿significa `gestion_orden.cierre_id`? → CERRADA: NO.**
Confirmado por el humano: «llegar por un cierre» significa que el rechazo **se ve** en el cierre como
sección de revisión, que quien aprueba **separa el paquete** y que al aprobar la orden **se destraba**
— pero **no entra en el cálculo del dinero**. La forma aprobada es literalmente esta:

```
CIERRE DEL DIA - Arnel Guillen
  Gestiones del mensajero......  17   (paga)
  RECHAZADOS POR LA TIENDA.....   3   (revisar)
    NA-947, NA-981, NA-1103  -> separar para devolucion
  Al aprobar: las 3 pasan a 'por devolver a tienda'
```

El vínculo de revisión en tabla propia (`cierre_rechazo_tienda`, molde de `cierre_sin_gestion`) es la
vía elegida. **No se reabre.** El coste de la lectura contraria queda medido en `design.md` §7.1.

**Q2 — ¿La vista EN VIVO del mensajero lista los rechazos? → CERRADA: NO, solo el comprobante.**
Se aprueba lo que el diseño proponía (`R14`, `design.md` §5.3): en la vista en vivo no hay nada que el
mensajero pueda hacer con ellos, y listarlos ahí reabriría la queja de atribución de la 337.

**Q3 — Rótulo de la sección. → CERRADA.** El aprobado es el de la forma de Q1: **«Rechazados por la
tienda»**, con «separar para devolución» y la frase de efecto «al aprobar pasan a *por devolver a
tienda*». Se acompaña de la nota «no son gestiones del mensajero y no suman a su pago». Sin siglas,
según la convención del repo.

**Q4 — ¿Hay tope de antigüedad? → CERRADA: NO hay tope.** Entran los 46, que es D3 palabra por
palabra. Un tope dejaría a los excluidos exactamente donde están hoy: sin salida.

**Q5 — Los 25 sin `ingreso_bodega_rechazo`. → CERRADA como pregunta de este spec: es un pendiente del
humano, no una decisión de diseño.** Está registrada en §2 «Fuera» y en `progress/decisiones_425.md`;
se decide **después**, con este diseño delante. Lo que esta ficha se compromete a hacer es **no
cerrarla de lado**: `R9` la mantiene abierta por construcción y no toca dinero histórico.
