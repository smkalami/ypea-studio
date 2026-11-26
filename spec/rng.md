# The Studio generator

One seedable random generator, shared by the Studio engine (`engine/rng.ts`) and, as an opt-in, by the ypea package. A seeded Python run that uses it draws the same numbers as the app. The reference implementation in Python is `spec/parity/studio_rng.py`, and the shared test cases are `spec/parity/rng.json`.

Change nothing here without changing both implementations and the test cases together.

## Core

The core is Philox2x32-10 (Salmon, Moraes, Dror and Shaw, "Parallel random numbers: as easy as 1, 2, 3", 2011). It maps a 64-bit counter and a 32-bit key to two 32-bit words. It needs only 32-bit arithmetic, so it is fast in JavaScript, and because it is counter based, a whole batch can be computed at once in NumPy.

```
M = 0xD256D193, W = 0x9E3779B9
philox(c0, c1, key):
    repeat 10 times:
        on every round after the first: key = (key + W) mod 2^32
        hi, lo = high and low 32 bits of M * c0
        c0, c1 = hi xor key xor c1, lo
    return c0, c1
```

Both implementations are checked against the published test vectors:

| c0 | c1 | key | result |
| --- | --- | --- | --- |
| 00000000 | 00000000 | 00000000 | ff1dae59 6cd10df2 |
| ffffffff | ffffffff | ffffffff | 2c3f628b ab4fd7ad |
| 243f6a88 | 85a308d3 | 13198a2e | dd7ce038 f62a4c12 |

## Stream

- The seed is a whole number from 0 to 4294967295. It is the key.
- The generator keeps a 64-bit position that starts at 0. `c0` is its low half and `c1` its high half.
- **Uniform.** One uniform uses one position: `(a, b) = philox(position)`, then `u = ((a >> 5) * 2^26 + (b >> 6)) / 2^53`, and the position moves by 1. The value is in [0, 1) with 53 random bits.
- **Batches.** An array is filled in row-major (C) order. Drawing an array is the same as drawing its elements one at a time.
- **Run seeds.** Run `i` of an experiment with base seed `s` uses the seed `philox(c0 = i, c1 = 0xFFFFFFFF, key = s)[0]`. The quick run is run 0.

## Draws

Every draw is built from uniforms `u` taken in order.

| Draw | Uniforms used | Value |
| --- | --- | --- |
| `random()` | 1 | `u` |
| `uniform(low, high)` | 1 | `low + (high - low) * u` |
| `integers(low, high)` | 1 | `low + floor(u * (high - low))`, with `high` excluded |
| `standard_normal()` | 2 | `sqrt(-2 * ln(1 - u1)) * cos2pi(u2)` |
| `standard_cauchy()` | 1 | `-c / s`, where `c, s = cos2pi(u / 2), sin2pi(u / 2)`. This is `tan(pi * (u - 0.5))`. |
| `geometric(p)` | 1 | `floor(ln(1 - u) / ln(1 - p)) + 1`, and 1 when `p` is 1 |
| `choice(n, p)` | 1 | the first index whose running total of `p` exceeds `u`, capped at `n - 1` |
| `permutation(n)` | n | the stable sort order of `n` uniforms |

Notes:

- The normal draw uses only the cosine branch of the Box-Muller transform and keeps no second value, so the stream has no hidden state and batches stay simple.
- In a batch of normals, element `i` uses uniforms `2i` and `2i + 1`.
- `integers` has a bias of at most `(high - low) / 2^53`, which is negligible for the ranges the methods use.
- The running total in `choice` is accumulated in index order.

## ln, cos and sin

The library functions `log`, `cos` and `tan` do not agree to the last digit between JavaScript and NumPy. With them, 5.4% of normal draws and 4.0% of Cauchy draws differed in their last bits (one million draws each, Nov 25, 2026). So the generator defines its own versions from `+ - * /` alone, in a fixed order. IEEE 754 arithmetic gives the same result for these operations everywhere. Both are accurate to about 1e-15.

```
ln(x), for 0 < x <= 1:
    e = 0
    while x < 0.7071067811865476: x = 2 * x, e = e - 1
    s = (x - 1) / (x + 1), z = s * s
    acc = 1 / 25
    for k = 11 down to 0: acc = acc * z + 1 / (2 * k + 1)
    return e * 0.6931471805599453 + 2 * s * acc

cos2pi(u) and sin2pi(u), for 0 <= u < 1:
    q = 8 * u, k = floor(q), t = q - k
    a = 0.7853981633974483 * (1 - t if k is odd, else t), z = a * a
    c = 1, s = 1
    for j = 10 down to 1:
        c = 1 - (z * c) / ((2 * j - 1) * (2 * j))
        s = 1 - (z * s) / (2 * j * (2 * j + 1))
    s = s * a
    if k is 1, 2, 5 or 6: swap c and s
    cos2pi = -c if k is 2, 3, 4 or 5, else c
    sin2pi = -s if k is 4 or more, else s
```

`2 * s * acc` means `(2 * s) * acc`, and `e * LN2 + ...` adds the two products last. In Python, `numpy.frexp` gives the same `x` and `e` as the loop.

## How closely the two sides match

Every draw is built from exact floating-point operations, so all eight match bit for bit. The test cases compare with strict equality. A comparison of one million normal, Cauchy and geometric draws between Node 26 and NumPy 2.4 found no difference.
