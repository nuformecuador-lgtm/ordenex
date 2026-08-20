# Medición contra producción para la feature 240 — 2026-08-20

> Hecha por el **leader** vía **MCP de Supabase, solo lectura**, **antes** de llevar las decisiones a
> firma.

## 💰 M3 — la consulta que decide D2: **NO ES CERO**

| medida | valor |
| --- | --- |
| **órdenes que YA pagaron el flete de devolución DOS VECES** | **1** |
| denominador: órdenes con gestión `devuelta`/`rechazada` en cierre aprobado | **16** |
| contexto: gestiones `devuelta` vivas · `rechazada` vivas | 12 · 8 |

**El cobro repetido no es teórico. Ya ocurrió, y tiene nombre:**

| orden | tienda | resultado | cierre aprobado | flete devuelto (GAM) | IVA |
| --- | --- | --- | --- | --- | --- |
| **63050** | **NUFORM** | `devuelta` | **2026-07-22** | 2.200,00 | 13 % |
| **63050** | **NUFORM** | `rechazada` | **2026-07-28** | 2.200,00 | 13 % |

`es_central = true`, así que se usa la columna GAM: **₡2.200 + 13 % = ₡2.486**, cobrados **dos
veces** a la misma tienda por **el mismo paquete**, con **seis días** de diferencia y los **dos
cierres aprobados**.

**Sobrecoste medido: ₡2.486 de más a NUFORM.**

## Qué es y qué no es

- **NO lo introduce la 240.** `derivarIngresoOrden` factura `ingreso_flete_devolucion` para
  `devuelta` **y** para `rechazada`, y el camino `devuelta → rechazada` **lo dispara el cron desde la
  feature 99**. Esta ficha no crea el defecto: **le abre una segunda puerta** —la manual— y por eso
  puede volverlo frecuente.
- **Hoy es 1 de 16.** Con el rechazo manual, cada devolución que la tienda decida rechazar a mano
  puede sumar otro. La ficha **multiplica** un riesgo que ya existía.
- **El importe no es simbólico**: hasta **₡2.600** (₡2.200 en GAM) más IVA por repetición, medido
  sobre las tarifas activas.

## M4 — cuánto cuesta un rechazo, por sus dos dueños

| concepto | dueño | máximo medido |
| --- | --- | --- |
| `cobro_rechazado` | **ingreso de bodega** | **₡1.000** |
| `valor_flete_devuelto` / `_gam` | **débito a la tienda** | **₡2.600 / ₡2.200** + IVA 13 % |

Son **dos importes distintos con dos dueños distintos**, y confundirlos es lo que hizo que la 237
tuviera que corregir una frase de su propio design. El aviso de la 240 tiene que nombrar **el flete
de devolución**, que es lo que la tienda paga — no el `cobroRechazado`.

⏳ **Caduca.** Re-medir antes de desplegar: si el número sube, la ficha aparte deja de ser
«corregir un caso» y pasa a ser «devolver dinero a varias tiendas».

---

## ⚠️ CÓMO LEER ESTOS NÚMEROS — producción es hoy un entorno de PRUEBAS

**Confirmado por el humano el 2026-08-20.** Las mediciones de este archivo salen de la base de
producción, pero **esa base se está usando para probar**, no para operar.

Consecuencia, y es importante para quien lea esto dentro de seis meses:

- Los números **describen fielmente lo que el código hace** — un doble cobro medido es un doble cobro
  real del código, y un `0` con denominador sigue significando que ese camino no se ejerció.
- Lo que **NO** se puede concluir de ellos es **frecuencia operativa**. «Deshacer se usa un 12 %» o
  «el corte sólo barrió 2 órdenes» describen **cómo se ha probado la app**, no cómo la usa la
  operación. Un número bajo puede ser «no pasa» o «nadie lo ha probado aún», y la base no distingue.
- **Los importes cobrados de más no corresponden a dinero real de una tienda real.** Por eso no hay
  devolución que hacer, y por eso el defecto se arregla hacia adelante.

⏳ **El día que producción pase a ser producción de verdad, TODO esto hay que re-medirlo**, y las
conclusiones de frecuencia hay que rehacerlas desde cero.
