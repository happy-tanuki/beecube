//! Trial: "touching (sprite)?" in wasm, ported from src/engine/collision.ts
//! (KindGrid, shapesIntersect, GJK) to compare speed with the JS version.
//! See docs/vm-design.md 14.3. Not used by the engine.
//!
//! The entity columns live in this module's memory; JS writes them through
//! typed-array views at the addresses `column` returns.

use std::ptr::addr_of_mut;

const BASE_SIZE: f64 = 40.0;
const HALF_PER_PERCENT: f64 = BASE_SIZE / 200.0;
const DEG: f64 = std::f64::consts::PI / 180.0;
const CUBE: u8 = 0;
const SPHERE: u8 = 1;
const CYLINDER: u8 = 3;
const BOUNDING: [f64; 4] = [1.7320508075688772, 1.0, std::f64::consts::SQRT_2, std::f64::consts::SQRT_2];
const F_ALIVE: u8 = 1;
const F_VISIBLE: u8 = 2;
const F_DYING: u8 = 16;
const DIRECT_LIMIT: usize = 16;

/// Float columns, in this order.
const X: usize = 0;
const Y: usize = 1;
const Z: usize = 2;
const PX: usize = 3;
const PY: usize = 4;
const PZ: usize = 5;
const SIZE: usize = 6;
const DIRECTION: usize = 7;
const PITCH: usize = 8;
const ROLL: usize = 9;
const FLOAT_COLUMNS: usize = 10;

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Direct,
    Dense,
    Hashed,
}

struct Grid {
    mode: Mode,
    cell: f64,
    x0: i32,
    y0: i32,
    z0: i32,
    nx: i32,
    ny: i32,
    nz: i32,
    mask: i32,
    buckets: usize,
    start: Vec<i32>,
    entries: Vec<i32>,
    large: Vec<i32>,
    max_r: f64,
    speed: f64,
    built_tick: f64,
    found: Vec<i32>,
}

impl Grid {
    const fn new() -> Grid {
        Grid {
            mode: Mode::Direct,
            cell: 1.0,
            x0: 0,
            y0: 0,
            z0: 0,
            nx: 1,
            ny: 1,
            nz: 1,
            mask: 0,
            buckets: 0,
            start: Vec::new(),
            entries: Vec::new(),
            large: Vec::new(),
            max_r: 0.0,
            speed: 0.0,
            built_tick: -1.0,
            found: Vec::new(),
        }
    }
}

/// Entity columns indexed by slot.
struct State {
    floats: Vec<Vec<f64>>,
    shape: Vec<u8>,
    flags: Vec<u8>,
}

/// Scratch for passing slot lists in and results out.
struct Scratch {
    slots: Vec<i32>,
    out: Vec<u8>,
}

static mut STATE: State = State { floats: Vec::new(), shape: Vec::new(), flags: Vec::new() };
static mut SCRATCH: Scratch = Scratch { slots: Vec::new(), out: Vec::new() };
static mut GRIDS: Vec<Grid> = Vec::new();

// Single-threaded module, and JS calls one export at a time, so these never alias.
fn state() -> &'static mut State {
    unsafe { &mut *addr_of_mut!(STATE) }
}
fn scratch() -> &'static mut Scratch {
    unsafe { &mut *addr_of_mut!(SCRATCH) }
}
fn grids() -> &'static mut Vec<Grid> {
    unsafe { &mut *addr_of_mut!(GRIDS) }
}

/// Makes room for `capacity` slots and `count` grids. Moves the columns: JS must take new views.
///
/// Also grows memory by enough spare room that building grids and querying
/// them later allocate from it: memory must not grow during a tick, since
/// that would invalidate JS's views of the columns.
#[no_mangle]
pub extern "C" fn reserve(capacity: usize, count: usize) {
    let s = state();
    s.floats = (0..FLOAT_COLUMNS).map(|_| vec![0.0; capacity]).collect();
    s.shape = vec![0; capacity];
    s.flags = vec![0; capacity];
    let t = scratch();
    t.slots = vec![0; capacity];
    t.out = vec![0; capacity];
    let g = grids();
    while g.len() < count {
        g.push(Grid::new());
    }
    // Freed again at once; the allocator keeps it for later.
    drop(vec![0u8; 128 * capacity + (4 << 20)]);
}

/// Address of a column: 0–9 the float columns, 10 shape, 11 flags, 12 slots (i32), 13 out (u8).
#[no_mangle]
pub extern "C" fn column(k: usize) -> usize {
    let s = state();
    match k {
        0..=9 => s.floats[k].as_ptr() as usize,
        10 => s.shape.as_ptr() as usize,
        11 => s.flags.as_ptr() as usize,
        12 => scratch().slots.as_ptr() as usize,
        _ => scratch().out.as_ptr() as usize,
    }
}

#[inline(always)]
fn sign(v: f64) -> f64 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        0.0
    }
}

#[inline(always)]
fn touchable(flags: &[u8], i: usize) -> bool {
    flags[i] & (F_ALIVE | F_VISIBLE | F_DYING) == F_ALIVE | F_VISIBLE
}

#[inline(always)]
fn bounding_radius(s: &State, i: usize) -> f64 {
    s.floats[SIZE][i] * HALF_PER_PERCENT * BOUNDING[s.shape[i] as usize]
}

// ---- shapes and GJK ---------------------------------------------------------------

type V = [f64; 3];

#[inline(always)]
fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
#[inline(always)]
fn sub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
#[inline(always)]
fn neg(a: V) -> V {
    [-a[0], -a[1], -a[2]]
}
#[inline(always)]
fn cross(a: V, b: V) -> V {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
#[inline(always)]
fn triple(a: V, b: V) -> V {
    cross(cross(a, b), a)
}
#[inline(always)]
fn is_zero(a: V) -> bool {
    dot(a, a) < 1e-18
}

/// Center, half size, shape and local axes in world space.
struct Shape {
    c: V,
    h: f64,
    kind: u8,
    ax: V,
    ay: V,
    az: V,
}

fn shape_of(s: &State, i: usize) -> Shape {
    let f = &s.floats;
    let kind = s.shape[i];
    let mut shape = Shape {
        c: [f[X][i], f[Y][i], f[Z][i]],
        h: f[SIZE][i] * HALF_PER_PERCENT,
        kind,
        ax: [0.0; 3],
        ay: [0.0; 3],
        az: [0.0; 3],
    };
    if kind == SPHERE {
        return shape;
    }
    let yaw = (90.0 - f[DIRECTION][i]) * DEG;
    let p = f[PITCH][i] * DEG;
    let roll = f[ROLL][i] * DEG;
    let (sy, cy) = yaw.sin_cos();
    let (sp, cp) = p.sin_cos();
    let (sr, cr) = roll.sin_cos();
    let (y0, y1, y2) = (-sy, cy, 0.0);
    let (z0, z1, z2) = (-cy * sp, -sy * sp, cp);
    shape.ax = [cy * cp, sy * cp, sp];
    shape.ay = [cr * y0 + sr * z0, cr * y1 + sr * z1, cr * y2 + sr * z2];
    shape.az = [cr * z0 - sr * y0, cr * z1 - sr * y1, cr * z2 - sr * y2];
    shape
}

fn support(s: &Shape, d: V) -> V {
    let h = s.h;
    if s.kind == SPHERE {
        let mut len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len == 0.0 {
            len = 1.0;
        }
        return [s.c[0] + d[0] / len * h, s.c[1] + d[1] / len * h, s.c[2] + d[2] / len * h];
    }
    let l0 = dot(d, s.ax);
    let l1 = dot(d, s.ay);
    let l2 = dot(d, s.az);
    let (p0, p1, p2);
    if s.kind == CUBE {
        p0 = sign(l0) * h;
        p1 = sign(l1) * h;
        p2 = sign(l2) * h;
    } else {
        let r = l0.hypot(l1);
        let rim0 = if r > 1e-12 { l0 / r * h } else { 0.0 };
        let rim1 = if r > 1e-12 { l1 / r * h } else { 0.0 };
        if s.kind == CYLINDER {
            p0 = rim0;
            p1 = rim1;
            p2 = sign(l2) * h;
        } else {
            let apex = l2 * h;
            let base = l0 * rim0 + l1 * rim1 - l2 * h;
            if apex >= base {
                p0 = 0.0;
                p1 = 0.0;
                p2 = h;
            } else {
                p0 = rim0;
                p1 = rim1;
                p2 = -h;
            }
        }
    }
    [
        s.c[0] + s.ax[0] * p0 + s.ay[0] * p1 + s.az[0] * p2,
        s.c[1] + s.ax[1] * p0 + s.ay[1] * p1 + s.az[1] * p2,
        s.c[2] + s.ax[2] * p0 + s.ay[2] * p1 + s.az[2] * p2,
    ]
}

fn minkowski(a: &Shape, b: &Shape, d: V) -> V {
    sub(support(a, d), support(b, neg(d)))
}

fn gjk(sa: &Shape, sb: &Shape) -> bool {
    let mut dir = sub(sb.c, sa.c);
    if is_zero(dir) {
        return true;
    }
    let mut c = minkowski(sa, sb, dir);
    dir = neg(c);
    let mut b = minkowski(sa, sb, dir);
    if dot(b, dir) < 0.0 {
        return false;
    }
    let t2 = sub(c, b);
    let mut ao = neg(b);
    dir = triple(t2, ao);
    if is_zero(dir) {
        ao = [1.0, 0.0, 0.0];
        dir = cross(t2, ao);
        if is_zero(dir) {
            ao = [0.0, 0.0, -1.0];
            dir = cross(t2, ao);
        }
    }
    let mut d: V = [0.0; 3];
    let mut dim = 2;
    for _ in 0..64 {
        let a = minkowski(sa, sb, dir);
        if dot(a, dir) < 0.0 {
            return false;
        }
        dim += 1;
        let ao = neg(a);
        if dim == 3 {
            let ab = sub(b, a);
            let ac = sub(c, a);
            let n = cross(ab, ac);
            if dot(cross(ab, n), ao) > 0.0 {
                c = a;
                dir = triple(ab, ao);
                dim = 2;
                continue;
            }
            if dot(cross(n, ac), ao) > 0.0 {
                b = a;
                dir = triple(ac, ao);
                dim = 2;
                continue;
            }
            if dot(n, ao) > 0.0 {
                d = c;
                c = b;
                b = a;
                dir = n;
            } else {
                d = b;
                b = a;
                dir = neg(n);
            }
            if is_zero(dir) {
                return true;
            }
            continue;
        }
        let ab = sub(b, a);
        let ac = sub(c, a);
        let ad = sub(d, a);
        let abc = cross(ab, ac);
        let acd = cross(ac, ad);
        let adb = cross(ad, ab);
        dim = 3;
        if dot(abc, ao) > 0.0 {
            d = c;
            c = b;
            b = a;
            dir = abc;
            continue;
        }
        if dot(acd, ao) > 0.0 {
            b = a;
            dir = acd;
            continue;
        }
        if dot(adb, ao) > 0.0 {
            c = d;
            d = b;
            b = a;
            dir = adb;
            continue;
        }
        return true;
    }
    true
}

fn axis_aligned(s: &State, i: usize) -> bool {
    let f = &s.floats;
    f[PITCH][i] == 0.0 && f[ROLL][i] == 0.0 && f[DIRECTION][i] % 90.0 == 0.0
}

/// Whether a sphere of radius r touches an axis-aligned cube of half size h, centers (dx, dy, dz) apart.
fn sphere_touches_box(dx: f64, dy: f64, dz: f64, r: f64, h: f64) -> bool {
    let ox = (dx.abs() - h).max(0.0);
    let oy = (dy.abs() - h).max(0.0);
    let oz = (dz.abs() - h).max(0.0);
    ox * ox + oy * oy + oz * oz <= r * r
}

fn shapes_intersect(s: &State, a: usize, b: usize) -> bool {
    let f = &s.floats;
    let dx = f[X][b] - f[X][a];
    let dy = f[Y][b] - f[Y][a];
    let dz = f[Z][b] - f[Z][a];
    let ha = f[SIZE][a] * HALF_PER_PERCENT;
    let hb = f[SIZE][b] * HALF_PER_PERCENT;
    let (sa, sb) = (s.shape[a], s.shape[b]);
    let reach = ha * BOUNDING[sa as usize] + hb * BOUNDING[sb as usize];
    let d2 = dx * dx + dy * dy + dz * dz;
    if d2 > reach * reach {
        return false;
    }
    if sa == SPHERE && sb == SPHERE {
        return d2 <= (ha + hb) * (ha + hb);
    }
    if sa == CUBE && sb == CUBE && axis_aligned(s, a) && axis_aligned(s, b) {
        let r = ha + hb;
        return dx.abs() <= r && dy.abs() <= r && dz.abs() <= r;
    }
    if sa == SPHERE && sb == CUBE && axis_aligned(s, b) {
        return sphere_touches_box(dx, dy, dz, ha, hb);
    }
    if sa == CUBE && sb == SPHERE && axis_aligned(s, a) {
        return sphere_touches_box(dx, dy, dz, hb, ha);
    }
    gjk(&shape_of(s, a), &shape_of(s, b))
}

// ---- spatial grid ----------------------------------------------------------------

fn bucket(g: &Grid, ix: i32, iy: i32, iz: i32) -> usize {
    if g.mode == Mode::Dense {
        return (ix - g.x0 + g.nx * (iy - g.y0 + g.ny * (iz - g.z0))) as usize;
    }
    ((ix.wrapping_mul(73856093) ^ iy.wrapping_mul(19349663) ^ iz.wrapping_mul(83492791)) & g.mask) as usize
}

fn bucket_of(g: &Grid, x: f64, y: f64, z: f64) -> usize {
    let c = g.cell;
    bucket(g, (x / c).floor() as i32, (y / c).floor() as i32, (z / c).floor() as i32)
}

/// Builds grid `id` over the `n` member slots in the slots scratch.
#[no_mangle]
pub extern "C" fn grid_build(id: usize, n: usize, tick: f64) {
    let g = grids();
    while g.len() <= id {
        g.push(Grid::new());
    }
    let members = &scratch().slots[..n];
    build(&mut grids()[id], state(), members, tick);
}

fn build(g: &mut Grid, s: &State, members: &[i32], tick: f64) {
    let f = &s.floats;
    g.built_tick = tick;
    g.large.clear();
    let mut speed: f64 = 0.0;
    let mut sum_r = 0.0;
    let mut m = 0usize;
    for &i in members {
        let i = i as usize;
        let d = (f[X][i] - f[PX][i]).abs() + (f[Y][i] - f[PY][i]).abs() + (f[Z][i] - f[PZ][i]).abs();
        if d > speed {
            speed = d;
        }
        if !touchable(&s.flags, i) {
            continue;
        }
        sum_r += bounding_radius(s, i);
        m += 1;
    }
    g.speed = speed;
    if m <= DIRECT_LIMIT {
        g.mode = Mode::Direct;
        for &i in members {
            if touchable(&s.flags, i as usize) {
                g.large.push(i);
            }
        }
        return;
    }
    let cell = (3.0 * sum_r / m as f64).max(1.0);
    g.cell = cell;
    let limit = cell / 2.0;
    let (mut x0, mut y0, mut z0) = (i32::MAX, i32::MAX, i32::MAX);
    let (mut x1, mut y1, mut z1) = (i32::MIN, i32::MIN, i32::MIN);
    g.max_r = 0.0;
    for &i in members {
        let i = i as usize;
        if !touchable(&s.flags, i) {
            continue;
        }
        let r = bounding_radius(s, i);
        if r > limit {
            g.large.push(i as i32);
            continue;
        }
        if r > g.max_r {
            g.max_r = r;
        }
        let cx = (f[X][i] / cell).floor() as i32;
        let cy = (f[Y][i] / cell).floor() as i32;
        let cz = (f[Z][i] / cell).floor() as i32;
        x0 = x0.min(cx);
        x1 = x1.max(cx);
        y0 = y0.min(cy);
        y1 = y1.max(cy);
        z0 = z0.min(cz);
        z1 = z1.max(cz);
    }
    let in_grid = m - g.large.len();
    let dense = if in_grid > 0 { ((x1 - x0 + 1) as i64) * ((y1 - y0 + 1) as i64) * ((z1 - z0 + 1) as i64) } else { 0 };
    if dense <= (64.max(4 * in_grid)) as i64 {
        g.mode = Mode::Dense;
        g.x0 = x0;
        g.y0 = y0;
        g.z0 = z0;
        g.nx = x1 - x0 + 1;
        g.ny = y1 - y0 + 1;
        g.nz = z1 - z0 + 1;
        g.buckets = dense.max(0) as usize;
    } else {
        g.mode = Mode::Hashed;
        let mut size = 16;
        while size < 2 * in_grid {
            size *= 2;
        }
        g.mask = size as i32 - 1;
        g.buckets = size;
    }
    let b = g.buckets;
    g.start.clear();
    g.start.resize(b + 1, 0);
    g.entries.clear();
    g.entries.resize(in_grid, 0);
    for &i in members {
        let i = i as usize;
        if !touchable(&s.flags, i) || bounding_radius(s, i) > limit {
            continue;
        }
        let k = bucket_of(g, f[X][i], f[Y][i], f[Z][i]);
        g.start[k + 1] += 1;
    }
    for i in 0..b {
        g.start[i + 1] += g.start[i];
    }
    for &i in members {
        let i = i as usize;
        if !touchable(&s.flags, i) || bounding_radius(s, i) > limit {
            continue;
        }
        let k = bucket_of(g, f[X][i], f[Y][i], f[Z][i]);
        let at = g.start[k] as usize;
        g.entries[at] = i as i32;
        g.start[k] += 1;
    }
    for i in (1..=b).rev() {
        g.start[i] = g.start[i - 1];
    }
    g.start[0] = 0;
}

fn query(g: &mut Grid, s: &State, i: usize, tick: f64) {
    g.found.clear();
    g.found.extend_from_slice(&g.large);
    if g.mode == Mode::Direct || g.buckets == 0 {
        return;
    }
    let f = &s.floats;
    let (x, y, z) = (f[X][i], f[Y][i], f[Z][i]);
    let r = bounding_radius(s, i);
    let margin = if tick == g.built_tick { 2.0 * g.speed + 1.0 } else { 1e-6 };
    let reach = r + g.max_r + margin;
    let c = g.cell;
    let (mut x0, mut x1) = (((x - reach) / c).floor() as i32, ((x + reach) / c).floor() as i32);
    let (mut y0, mut y1) = (((y - reach) / c).floor() as i32, ((y + reach) / c).floor() as i32);
    let (mut z0, mut z1) = (((z - reach) / c).floor() as i32, ((z + reach) / c).floor() as i32);
    if g.mode == Mode::Dense {
        x0 = x0.max(g.x0);
        y0 = y0.max(g.y0);
        z0 = z0.max(g.z0);
        x1 = x1.min(g.x0 + g.nx - 1);
        y1 = y1.min(g.y0 + g.ny - 1);
        z1 = z1.min(g.z0 + g.nz - 1);
    } else if ((x1 - x0 + 1) as i64) * ((y1 - y0 + 1) as i64) * ((z1 - z0 + 1) as i64) > g.buckets as i64 {
        let end = g.start[g.buckets] as usize;
        g.found.extend_from_slice(&g.entries[..end]);
        return;
    }
    for iz in z0..=z1 {
        for iy in y0..=y1 {
            for ix in x0..=x1 {
                let b = bucket(g, ix, iy, iz);
                let (from, to) = (g.start[b] as usize, g.start[b + 1] as usize);
                g.found.extend_from_slice(&g.entries[from..to]);
            }
        }
    }
}

fn touching_one(g: &mut Grid, s: &State, i: usize, tick: f64) -> bool {
    if !touchable(&s.flags, i) {
        return false;
    }
    query(g, s, i, tick);
    for &o in &g.found {
        let o = o as usize;
        if o != i && touchable(&s.flags, o) && shapes_intersect(s, i, o) {
            return true;
        }
    }
    false
}

/// "Touching (kind of grid `id`)?" for one entity.
#[no_mangle]
pub extern "C" fn touching(id: usize, i: usize, tick: f64) -> u32 {
    touching_one(&mut grids()[id], state(), i, tick) as u32
}

/// The same for the `n` slots in the slots scratch; results go to the out scratch.
#[no_mangle]
pub extern "C" fn touching_batch(id: usize, n: usize, tick: f64) {
    let g = &mut grids()[id];
    let s = state();
    let t = scratch();
    for k in 0..n {
        t.out[k] = touching_one(g, s, t.slots[k] as usize, tick) as u8;
    }
}
