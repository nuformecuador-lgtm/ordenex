# Decisión ⟨D10⟩ — la contradicción C2 (R4 ↔ R23) de la feature 127

**Fecha: 2026-08-02 · Autor: humano · Estado: CERRADA.**

## El problema

`conciliacion_cierres` declara en el catálogo de la 135 (`lib/analytics/metrics.ts`)
`fuente.tablas = ["cierre_dia", "cierre_bodega"]`. R23 obliga a comparar esos snapshots
aprobados contra lo que los **ledgers** registraron con `origen_tipo = cierre_dia`.

Con el catálogo vigente, el repositorio de conciliación **no puede cumplir R4 y R23 a la vez**:
R4 exige que las tablas que consulta sean un subconjunto de las que su métrica declara, y los
tres ledgers no están declarados. El guardia B.3 no lleva exención, así que se pone rojo en
cuanto se escriba C.4 — que es exactamente lo que tenía que pasar.

Lo detectó el agente de las tandas A/B al implementar; está descrito como **C2** en
`progress/impl_127.md §Contradicciones y puntos abiertos encontrados AL IMPLEMENTAR`.

## La decisión

**(a) Se amplía el catálogo de la 135.** `conciliacion_cierres.fuente.tablas` pasa a incluir los
tres ledgers además de los dos cierres:

```
["cierre_dia", "cierre_bodega", "wallet_movimiento", "wallet_tienda_movimiento",
 "pago_mensajero_movimiento"]
```

Motivo: la conciliación que importa es precisamente snapshot aprobado **contra** dinero
realmente movido. La salida (b) —acotar R23 a comparar solo entre niveles de cierre— deja la
métrica ciega al caso principal. La salida (c) —aflojar el guardia B.3— quedó descartada: vuelve
decorativo el guardia justo en la métrica donde más importa.

## Consecuencias, y sus límites

`lib/analytics/metrics.ts` es el **catálogo de la 135, fuente única de trece features**. Esta
autorización cubre **exactamente dos cambios** en ese archivo, y ninguno más:

1. ⟨D8⟩ (2026-08-02) — `egresos.estadoProduccion`: `"declarada"` → `"producida"`. Tarea **D.6**,
   y solo **cuando el productor exista**.
2. ⟨D10⟩ (2026-08-02, esta) — `conciliacion_cierres.fuente.tablas` gana los tres ledgers. Tarea
   **C.4**.

Ni etiqueta, ni grano, ni alcance, ni ninguna otra entrada, ni ninguna otra métrica. El diff
sobre `metrics.ts` al cerrar la feature tiene que poder leerse entero de un vistazo y ser
únicamente estas dos cosas.

**Los dos párrafos anteriores viajan al cuerpo del PR.** Un cambio en el catálogo compartido sin
la autorización fechada a la vista es indistinguible de un retoque de paso.

## Qué tiene que pasar en C.4

- Con el catálogo ampliado, B.3 tiene que quedar **verde por construcción**, no por exención.
- El test que el agente anterior dejó fijado —«el ledger que R23 quiere cruzar NO cabe hoy en lo
  que `conciliacion_cierres` declara»— **ya no dice la verdad** una vez ampliado el catálogo.
  Hay que **darlo vuelta**, no borrarlo: pasa a afirmar que los tres ledgers **sí** están
  declarados y que quitar uno pone rojo a B.3. Borrarlo sin más deja el hueco sin vigilancia.
- El guardia sigue teniendo que morder: añadir al repositorio una tabla que la métrica no declara
  tiene que ponerse rojo igual que antes.

---

# Decisión ⟨D11⟩ — el comentario obsoleto de `egresos` (C6)

**Fecha: 2026-08-02 · Autor: humano · Estado: CERRADA.**

Al aplicar ⟨D8⟩, el comentario que está justo encima de `egresos.estadoProduccion` quedó
obsoleto y **contradice a la línea de abajo**: sigue diciendo «`declarada`: la ficha de la 127
compromete ingresos, cuentas por pagar y conciliación de cierres; los egresos NO aparecen ahí».
El agente de la tanda D **no lo tocó, y obró bien**: la autorización acotaba el diff.

**Decisión: se actualiza el comentario.** Un comentario que le miente al próximo que lea el
catálogo de trece features es peor que un diff de tres líneas en vez de dos. El nuevo texto tiene
que decir que la 127 **sí** produce egresos y citar ⟨D8⟩ (humano, 2026-08-02).

Con esto, la autorización sobre `lib/analytics/metrics.ts` cubre **tres cosas** y ninguna más:
⟨D8⟩ el `estadoProduccion` de `egresos`, ⟨D10⟩ las `fuente.tablas` de `conciliacion_cierres`, y
⟨D11⟩ el comentario que ⟨D8⟩ dejó mintiendo. Sigue sin cubrir ninguna otra entrada, etiqueta,
grano ni alcance. **Los tres viajan al cuerpo del PR.**

*Aplicación: la hace el leader al terminar la TANDA E/F, para no cambiar un archivo ajeno
mientras otro agente corre la suite sobre él.*
