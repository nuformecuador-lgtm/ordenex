# Revisión de la ficha 450 — dos rondas

> El `reviewer` no puede escribir archivos: este informe lo escribe el leader con lo que devolvió.
> Fechas: 2026-09-21, sobre la rama `fix/450-tx-una-consulta-a-la-vez`.

## Veredicto final: **OK**, tras dos rechazos y sus dos arreglos

| Ronda | Sobre | Veredicto | Bloqueante |
| --- | --- | --- | --- |
| 1.ª | `f50c89d2`…`8d695882` | RECHAZADO | `tasks.md` con 28 tareas y **ninguna marcada** |
| 2.ª | `83bf0223`, `ad5504e7` | RECHAZADO | la nota de `docs/release.md` quedó **invertida** tras T2.7 |
| cierre | `docs/release.md` reescrito por el leader | — | — |

**Los dos bloqueantes fueron de papeleo, y el segundo tenía consecuencia operativa real:** la entrada
de «Pendiente para la PRÓXIMA release» seguía diciendo que el emisor «sigue sin secuenciar» y fijaba
la lectura «**>0 es lo ESPERADO** / **0 obligaría a volver a medir**». Con T2.7 ya aplicado eso está
al revés: hoy **0 confirma el arreglo** y **>0 significa otro emisor**. Quien mirara los logs el día
7 habría leído el resultado invertido. Reescrito, y de paso ahora apunta al censo del brazo C como
primer sitio donde mirar si aparece un >0.

## Lo que el reviewer verificó EJECUTANDO, no leyendo

Esto es lo que da valor a la revisión, y por eso se deja escrito:

- **Mutación sobre el brazo C de la guardia.** Devolvió al `SNAPSHOT_SELECT` sus cinco relaciones
  hermanas: la guardia se puso **ROJA** en dos casos, nombrando
  `lib/repositories/CierreDiaRepository.ts:1165 (5 hermanas)` y «expected 5 to be less than 3».
  **Era la duda que más me preocupaba** —el implementador había cambiado cuatro aserciones de su
  propia guardia para acomodar su propio arreglo, que es el patrón «aserción contra su propia
  fuente»— y queda descartada por medición: la guardia distingue el antes del después.
- **Los cinco dobles ampliados.** Corrió los tests previos contra el `lib/` nuevo: **36 fallos,
  todos `TypeError: Cannot read properties of undefined (reading 'findMany')`**. Es decir, la
  categoría de fallo era una sola —al doble le falta la tabla— y eso justifica que la autorización
  del humano, dada para dos archivos, se aplicara a cinco. Comparó los valores 1:1 y confirmó
  **cero** líneas `it(` o `expect(` borradas.
- **El snapshot del dinero.** Mutó `cantones` añadiendo `" MUTADO"` y el caso de equivalencia se
  puso rojo con el valor real («Desamparados»). Compara dos caminos independientes, no una función
  contra sí misma.
- **El antes→después del emisor.** «EL ANTES» conserva el literal retirado (`SNAPSHOT_SELECT_DE_ANTES`)
  y midió **5 en vuelo / 4 solapes + el aviso**; «EL DESPUÉS» importa el código REAL del repositorio
  —no una copia— y midió **1 / 0**.
- **El censo declarado == el medido**: «6 lecturas ≥2 hermanas en 4 archivos · máximo 2».

**Trazabilidad: 12/12**, con R11 como «NOMBRADO y SECUENCIADO». El reviewer corrió él mismo R1/R2
(22 ✓), R3/R4/R5/R7 (53 ✓), R8/R9/R10 (23 ✓), R11 (6 ✓) y las cinco suites tocadas (170 ✓).

## Menores aceptados, que NO bloquean

1. La orden sembrada en el test de equivalencia no tiene distrito, así que 2 de los 7 valores
   comparan `null`/`false` en los dos lados; los otros 5 llevan dato real. La rama de distrito con
   id vivo sólo la cubren dobles.
2. El brazo C no ve `select: { zona: true, tienda: true }` (sólo cuenta `clave: true` dentro de
   `include`), y ese límite no está entre los cuatro declarados. **Medido: 0 casos hoy en `lib/`**,
   así que no tapa nada — pero es un hueco con fecha de caducidad.
3. El anti-vacío del brazo C es `>= 4` con 6 lecturas reales: perder 2 de las 6 no lo dispararía.
   Sí lo haría la comprobación «ningún archivo del censo sobra» si cayera un archivo entero.

## Lo que queda vivo después de esta ficha

**6 lecturas que lanzan dos consultas hermanas sobre una transacción**, en `CierreDiaRepository`,
`CierresAdminRepository`, `LiquidacionPagoRepository` y `UserRepository`. **No** disparan el aviso
—hacen falta tres— pero dos consultas compartiendo conexión **sí** son la condición del `25P02` que
originó la 440. Están censadas por el brazo C y quedan **fuera del alcance** de la 450 a propósito.
Es el siguiente escalón si alguien quiere cerrar el hilo del todo.
