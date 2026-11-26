"""Reference implementation of the Studio generator in Python (specification: spec/rng.md).

It offers the eight numpy.random.Generator methods that ypea's algorithms call, with the
same call signatures, so it can stand in for the Generator of a run. It is the proposed
content of the opt-in generator in ypea, and the source of spec/parity/rng.json.
"""

import numpy as np

M = np.uint64(0xD256D193)
W = np.uint64(0x9E3779B9)
MASK = np.uint64(0xFFFFFFFF)
S32 = np.uint64(32)


def philox(c0, c1, key):
    """Philox2x32-10 on uint64 arrays that hold 32-bit values."""
    key = np.uint64(key)
    for r in range(10):
        if r:
            key = (key + W) & MASK
        p = M * c0
        c0, c1 = (p >> S32) ^ key ^ c1, p & MASK
    return c0, c1


SQRT_HALF = 0.7071067811865476
LN2 = 0.6931471805599453
QUARTER_PI = 0.7853981633974483


def ln_unit(x):
    """ln(x) for 0 < x <= 1, from + - * / in the fixed order of the specification."""
    m, e = np.frexp(np.asarray(x, dtype=float))
    low = m < SQRT_HALF
    m, e = np.where(low, 2 * m, m), e - low
    s = (m - 1) / (m + 1)
    z = s * s
    acc = 1 / 25
    for k in range(11, -1, -1):
        acc = acc * z + 1 / (2 * k + 1)
    return e * LN2 + 2 * s * acc


def cos_sin_2pi(u):
    """cos(2 pi u) and sin(2 pi u) for 0 <= u < 1."""
    q = 8 * np.asarray(u, dtype=float)
    k = np.floor(q).astype(np.int64)
    t = q - k
    a = QUARTER_PI * np.where(k & 1, 1 - t, t)
    z = a * a
    c = s = 1.0
    for j in range(10, 0, -1):
        c = 1 - (z * c) / ((2 * j - 1) * (2 * j))
        s = 1 - (z * s) / (2 * j * (2 * j + 1))
    s = s * a
    swap = ((k + 1) >> 1) & 1
    cos, sin = np.where(swap, s, c), np.where(swap, c, s)
    return np.where(((k + 2) >> 2) & 1, -cos, cos), np.where(k >= 4, -sin, sin)


def derive_seed(base, run_index):
    c0, _ = philox(np.array([run_index], np.uint64), np.array([0xFFFFFFFF], np.uint64), base)
    return int(c0[0])


class StudioRng:
    def __init__(self, seed):
        if not 0 <= int(seed) <= 0xFFFFFFFF:
            raise ValueError("seed must be an integer from 0 to 4294967295")
        self.seed = int(seed)
        self.pos = 0

    def random(self, size=None):
        shape = () if size is None else tuple(np.atleast_1d(size))
        n = int(np.prod(shape))
        counters = np.uint64(self.pos) + np.arange(n, dtype=np.uint64)
        self.pos += n
        a, b = philox(counters & MASK, counters >> S32, self.seed)
        u = ((a >> np.uint64(5)) * np.uint64(67108864) + (b >> np.uint64(6))) / 9007199254740992.0
        return u.reshape(shape) if size is not None else float(u[0])

    def uniform(self, low=0.0, high=1.0, size=None):
        return low + (high - low) * self.random(size)

    def integers(self, low, high=None, size=None):
        if high is None:
            low, high = 0, low
        out = low + np.floor(self.random(size) * (high - low)).astype(np.int64)
        return out if size is not None else int(out)

    def _pairs(self, size):
        # element i uses uniforms 2i and 2i + 1
        shape = () if size is None else tuple(np.atleast_1d(size))
        u = self.random((*shape, 2))
        return u[..., 0], u[..., 1]

    def standard_normal(self, size=None):
        u1, u2 = self._pairs(size)
        z = np.sqrt(-2 * ln_unit(1 - u1)) * cos_sin_2pi(u2)[0]
        return z if size is not None else float(z)

    def standard_cauchy(self, size=None):
        c, s = cos_sin_2pi(self.random(size) / 2)
        with np.errstate(divide="ignore"):
            out = -c / s
        return out if size is not None else float(out)

    def geometric(self, p, size=None):
        u = self.random(size)
        if p >= 1:
            out = np.ones_like(u, dtype=np.int64)
        else:
            out = np.floor(ln_unit(1 - u) / ln_unit(1 - p)).astype(np.int64) + 1
        return out if size is not None else int(out)

    def choice(self, n, size=None, p=None):
        if p is None:
            return self.integers(n, size=size)
        # a sequential running total, to match the TypeScript loop bit for bit
        cdf = np.cumsum(np.asarray(p, dtype=float))
        out = np.minimum(np.searchsorted(cdf, self.random(size), side="right"), n - 1)
        return out if size is not None else int(out)

    def permutation(self, n):
        return np.argsort(self.random(n), kind="stable")
