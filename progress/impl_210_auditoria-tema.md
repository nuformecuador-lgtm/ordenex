# Auditoría de tema — 2026-08-13

> Nace de un reporte humano: «los cierres tipo factura no están siendo incluidos en el tema
> oscuro, no sé cuántos más elementos y en especial de otros roles tienen el mismo problema».
>
> **Las dos mitades del reporte tienen respuestas opuestas:** la factura es correcta (deliberada y
> medida), y sí había defectos en otros sitios — pero **no en el tema oscuro**.

## 1. La factura: el reporte era exacto y el comportamiento es deliberado

`cierre-factura.tsx` no oscurece porque se fija a claro con la clase `tema-claro`. La feature 208
lo dejó escrito y **medido** (`:85-98`): de los 143 textos de la hoja solo 16 son navy fijo, los
otros ~127 son tokens que giran, y

| Variante | Textos bajo 4,5:1 | Mínimo |
| --- | --- | --- |
| sin tocar nada | 20 | 1,00 |
| solo `bg-white` | **116** | 1,04 |
| con `tema-claro` | 3 | 3,36 (los mismos 3 que ya fallan en claro) |

Cambiar el papel sin cambiar la tinta **mueve el bug de 16 sitios a 116**. Por decisión humana del
mismo día la hoja pasará a oscurecer de todas formas: **ficha 217**, con la regla de que al
imprimir siga blanca.

## 2. Cobertura: la 208 midió 6 rutas de 17

**Medidas por la 208:** `/wallet`, `/dashboard`, `/ordenes`, `/analitica`, `/ranking`,
`/mis-asignaciones`, más el detalle de `/cierres-admin`.

**Esta auditoría añade:** `/cierre-dia`, `/cierres-admin` (lista), `/incidentes`, `/mis-pagos`,
`/monitoreo`, `/recoleccion`, `/wallet/mensajeros`, `/wallet/tiendas`, y una **pasada de hover**
sobre `/mis-asignaciones` y `/wallet`, que la 208 midió solo estáticas.

**Lo que NO se cubrió, y por qué:**

- **maestro, adminTienda y adminSatelite no entran.** El OTP no es por rol: lo dispara un
  **RiskEngine por score**, y las cuentas privilegiadas lo cruzan. El código se guarda **hasheado**
  (`email_otp_challenge.code_hash`), así que no se puede leer de la base. Rotar la contraseña del
  maestro (su seed es aparte del de QA) **no basta**.
- Con eso quedan fuera `/mi-wallet` (tienda), `/recepcion-satelite` (satélite),
  `/configuracion/*` y `/novedades`.
- **El impacto de ese hueco es bajo, y se puede razonar:** los 45 fallos salen todos de
  primitivas COMPARTIDAS (`Button`, `Badge`, el avatar del encabezado, el enlace de descarga), no
  de pantallas de un rol. Otro rol encontraría los mismos cuatro patrones.

## 3. El resultado: el modo oscuro está limpio; el naranja de marca no

~1.200 textos medidos (2 roles × 2 temas × 15 rutas + hover), **0 indeterminados**, 45 bajo AA.
**Todos** de la misma familia, y **todos en tema CLARO**:

| Par | Ratio | Dónde |
| --- | --- | --- |
| `#ffffff` / `#f26419` | **3,18** | botón primario, insignias, avatar, contador |
| `#f26419` / `#f7f8fc` | **2,99** | enlace «Descargar» |
| `#ffffff` / `#f38246` | **2,60** | el primario **en hover** (`bg-primary/80`): empeora |
| `#d4530d` / `#fff0e8` | **3,74** | el «Descargar» en hover |

En **oscuro** solo aparecen dos, y **ninguno es una violación**: el logotipo «Ordenex» (3,18 —
WCAG 1.4.3 exime el texto de una marca) y el separador `|` (1,23 — decorativo). → **ficha 216**.

Matiz que decide el alcance de esa ficha: **3,18 sí cumple el 3:1** de texto grande y de
componentes de interfaz. Lo que incumple es el texto de tamaño normal.

## 4. El defecto que solo existía con el cursor encima

`KpisMensajero` (rol **mensajero**) pinta al hacer hover un `::before` con un degradado
`purple-200 → white` a **opacidad 100**. Dos colores claros encima de una tarjeta cuyo texto, en
oscuro, es claro: la cifra —que es **dinero**— quedaba en ~1,15:1.

La 208 no lo vio porque **midió pantallas estáticas**. Arreglado dando al degradado una variante
oscura (`dark:before:from-white/10 dark:before:to-transparent`): compone `#27364e` bajo el texto
`#e6ecf8` → **10,55:1** medido con el cursor encima. En claro no cambia nada.

## 5. El medidor mintió TRES veces, y siempre igual: rellenando un hueco

Es la parte reutilizable de esta auditoría. Las tres veces el fallo tenía la misma forma —**ante un
dato que no sabía resolver, inventaba uno en vez de abstenerse**— y las tres produjeron números
alarmantes y falsos:

1. **`componer()` devolvía `alpha = 1` siempre.** Dos capas translúcidas (un badge
   `bg-warning/15` dentro de una fila `bg-brand/5`) se daban por opacas y el barrido no llegaba
   nunca al fondo real. → **falso 1,80 sobre «₡3.400,00»** en oscuro.
2. **En la pila de fondos, un color ilegible hacía `continue`.** Se saltaba esa capa y el fondo de
   la **página** pasaba por fondo del botón. → **falso 1,00 y 1,06 sobre «Aplicar»**, que parecía
   el bug más grave de todos: texto del mismo color que el fondo.
3. **La causa raíz de la 2:** Chromium devuelve **`oklab(...)`** para las utilidades de opacidad de
   Tailwind v4 (`bg-primary/80`). No `rgb()` ni `lab()`. Se comprobó **con una sonda al navegador**
   antes de decidir, en vez de suponerlo.

**Lo que las cazó:** una sonda al DOM preguntando quién pintaba el naranja de atrás (`<tr
class="bg-brand/5">`), y la aritmética de la composición hecha a mano. **No las cazó la
autocomprobación**, porque tenía un solo control de composición —de UNA capa—, que pasaba trivial.

**Estado final del medidor:** 17 controles que abortan con `exit 2` si fallan — 4 conversiones
`lab()`, 4 `oklab()`/`oklch()`, 4 ratios WCAG publicados, 3 de composición (incluida **una de dos
capas**, la que faltaba), y un centinela que detecta que el navegador **no supo** parsear un color
en vez de devolver negro en silencio. Un color no resoluble marca la medida **indeterminada**, y
los indeterminados **no se cuentan como aprobados**.

> **La regla, que ya está escrita en este repo y volvió a morder:** un verificador que rellena lo
> que no sabe no es optimista, es **falso**. Toda capa que no se pueda resolver tiene que degradar
> a «no lo sé», nunca a un valor plausible.
