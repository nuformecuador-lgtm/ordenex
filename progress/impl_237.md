# impl 237 — la gestión que hace la tienda cuenta como del mensajero

Rama `feature/237-gestion-tienda-ayuda`.
Spec: `specs/237-gestion-tienda-ayuda/{requirements,design,tasks}.md` (R1–R50, T0–Tn).

---

## T0 · Las cuatro mediciones — 2026-08-20, contra producción

Vía **MCP de Supabase, solo lectura**. Cada número con su denominador: un cero sin universo detrás
no dice nada, y en esta pila ya nos ha pasado.

> ⚠️ **Orden en que ocurrió, y hay que decirlo:** el leader llevó **D2, D3 y D6** a firma humana
> **antes** de correr estas consultas, y el spec pedía explícitamente lo contrario («no se firma D1
> ni D3 sin los números delante»). Se midió después. **Los números no contradicen ninguna de las
> tres firmas — y el de M3+M4 refuerza la de D3.** Queda escrito por si algún día uno de estos
> números cambia y hay que releer la decisión sabiendo sobre qué se tomó.

### M1 — la población en ayuda (T0.1)

| medida | valor |
| --- | --- |
| órdenes vivas en `ayuda_tienda` | **0** |
| denominador: órdenes vivas | **141** |

Esperado: la **235** se mergeó en `dev` el 2026-08-19 y **no está desplegada** (producción sale de
`prod`). ⏳ **Caduca**: re-medir antes de desplegar, no antes de mergear.

### M2 — ⚠️ la que decide **D1** (T0.2)

| medida | valor |
| --- | --- |
| cierres en `vencido` | **0** |
| cierres en `rechazado` | **0** |
| denominador: cierres | **12** — y los **12** están `aprobado` |

**La frase que T0.2 exige:** **la ruta exenta es un CASO DE BORDE, no la normalidad.** Ningún cierre
ha estado nunca en `vencido` ni en `rechazado` en producción, así que las dos rutas de re-solicitud
(`vencido → solicitado` y `rechazado → solicitado`) —las que rompen la invariante— **no se han
ejercido jamás**.

**Consecuencia para D1:** «se acepta y se prueba» **se sostiene**. No hace falta hablar de mitigación,
que es lo que T0.2 dejaba condicionado a que fuera la normalidad. **Pero el borde es alcanzable**
—235/R25 deja pedir ayuda estando bloqueado— así que el test de R32 sigue siendo obligatorio: lo que
la medición dice es que hoy no hay volumen, no que sea imposible.

### M3 — cuánto dinero mueve un rechazo (T0.3)

| medida | valor |
| --- | --- |
| `cobro_rechazado` mínimo | **0,00** |
| media | **400,00** |
| **máximo** | **1.000,00** |
| denominador: tarifas | **5** |

**Es el importe que la tienda se cobra a sí misma con un click.** Hasta **₡1.000** por rechazo. Va
literalmente en la conversación de **D3** y en el aviso de **D7**: el texto que le dice a la tienda
«esto cuesta dinero» no es retórica.

### M4 — cuánto se deshace hoy (T0.4)

| medida | valor |
| --- | --- |
| gestiones **anuladas** | **7** |
| denominador: gestiones | **57** |
| gestiones vivas **sin cierre** | **0** |
| de esas, con más de 24 h | **0** |

**«Deshacer» SE USA: 7 de 57, un 12 %.** No es una función dormida — es una de cada ocho gestiones.

**Consecuencia para D3, y refuerza la firma:** si el mensajero pudiera deshacer la gestión de la
tienda, **pasaría de verdad**, no en teoría. Y cada vez que pasara borraría en silencio hasta ₡1.000
que la tienda decidió cobrarse, sin que ella pudiera enterarse porque la orden ya no está en ninguna
de sus pestañas. **Los dos números juntos convierten D3 de precaución en necesidad.**

Los otros dos ceros (0 gestiones sin cierre, 0 de más de 24 h) dan la cota que T0.4 pedía: hoy
**ninguna gestión se queda huérfana de cierre**, así que el escenario de D1 —una gestión que cae en
el cierre siguiente— tampoco tiene precedente en los datos.
