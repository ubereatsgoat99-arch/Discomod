/* Copyright (C) 2000  The PARI group.

This file is part of the PARI/GP package.

PARI/GP is free software; you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY WHATSOEVER.

Check the License for details. You should have received a copy of it, along
with the package; see the file 'COPYING'. If not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA. */

/********************************************************************/
/**                                                                **/
/**                      GENERIC OPERATIONS                        **/
/**                         (first part)                           **/
/**                                                                **/
/********************************************************************/
#include "pari.h"
#include "paripriv.h"

#define DEBUGLEVEL DEBUGLEVEL_mod

/* assume z[1] was created last */
#define fix_frac_if_int(z) if (equali1(gel(z,2)))\
  z = gc_upto((pari_sp)(z+3), gel(z,1));

/* assume z[1] was created last */
#define fix_frac_if_int_GC(z,tetpil) { if (equali1(gel(z,2)))\
  z = gc_upto((pari_sp)(z+3), gel(z,1));\
else\
  gc_slice_unsafe((pari_sp)z, tetpil, z+1, 2); }

static void
warn_coercion(GEN x, GEN y, GEN z)
{
  if (DEBUGLEVEL)
   pari_warn(warner,"coercing quotient rings; moduli %Ps and %Ps -> %Ps",x,y,z);
}

static long
kro_quad(GEN x, GEN y)
{ pari_sp av=avma; return gc_long(av, kronecker(quad_disc(x), y)); }

/* is -1 not a square in Zp, assume p prime */
INLINE int
Zp_nosquare_m1(GEN p) { return (mod4(p) & 2); /* 2 or 3 mod 4 */ }

static GEN addsub_pp(GEN x, GEN y, GEN(*op)(GEN,GEN));
static GEN mulpp(GEN x, GEN y);
static GEN divpp(GEN x, GEN y);
/* Argument codes for inline routines
 * c: complex, p: padic, q: quad, f: floating point (REAL, some complex)
 * R: without imaginary part (INT, REAL, INTMOD, FRAC, PADIC if -1 not square)
 * T: some type (to be converted to PADIC)
 */
static GEN
addRc(GEN x, GEN y) {
  GEN z = cgetg(3,t_COMPLEX);
  gel(z,1) = gadd(x,gel(y,1));
  gel(z,2) = gcopy(gel(y,2)); return z;
}
static GEN
mulRc(GEN x, GEN y)
{
  GEN a = gel(y,1), b = gel(y,2), z = cgetg(3,t_COMPLEX);
  gel(z,1) = (typ(x) != t_INTMOD && isintzero(a))? gen_0: gmul(x, a);
  gel(z,2) = gmul(x, b); return z;
}
static GEN
divRc(GEN x, GEN y)
{
  GEN a = gel(y,1), b = gel(y,2), z = cgetg(3,t_COMPLEX);
  pari_sp av = avma, av2;
  if (isintzero(a) && typ(x) != t_INTMOD)
  {
    gel(z,1) = gen_0;
    gel(z,2) = gc_upto(av, gdiv(x, gneg(b)));
  }
  else
  {
    GEN t = gdiv(x, cxnorm(y)), mb = gneg(b);
    av2 = avma;
    gel(z,1) = gmul(t, a);
    gel(z,2) = gmul(t, mb);
    gc_slice_unsafe(av, av2, z+1, 2);
  }
  return z;
}
static GEN
divRq(GEN x, GEN y)
{
  pari_sp av = avma;
  return gc_upto(av, gdiv(gmul(x,conj_i(y)), quadnorm(y)));
}
static GEN
divcR(GEN x, GEN y) {
  GEN z = cgetg(3,t_COMPLEX);
  gel(z,1) = isintzero(gel(x,1))? gen_0: gdiv(gel(x,1), y);
  gel(z,2) = gdiv(gel(x,2), y); return z;
}
static GEN
addRq(GEN x, GEN y) {
  GEN z = cgetg(4,t_QUAD);
  gel(z,1) = ZX_copy(gel(y,1));
  gel(z,2) = gadd(x, gel(y,2));
  gel(z,3) = gcopy(gel(y,3)); return z;
}
static GEN
mulRq(GEN x, GEN y) {
  GEN z = cgetg(4,t_QUAD);
  gel(z,1) = ZX_copy(gel(y,1));
  gel(z,2) = gmul(x,gel(y,2));
  gel(z,3) = gmul(x,gel(y,3)); return z;
}
static GEN
addqf(GEN x, GEN y, long prec) { pari_sp av = avma;
  long i = gexpo(x) - gexpo(y);
  if (i > 0) prec += nbits2extraprec(i);
  return gc_upto(av, gadd(y, quadtofp(x, prec)));
}
static GEN
mulrfrac(GEN x, GEN y)
{
  pari_sp av;
  GEN z, a = gel(y,1), b = gel(y,2);
  if (is_pm1(a)) /* frequent special case */
  {
    z = divri(x, b); if (signe(a) < 0) togglesign(z);
    return z;
  }
  av = avma;
  return gc_leaf(av, divri(mulri(x,a), b));
}
static GEN
mulqf(GEN x, GEN y, long prec) { pari_sp av = avma;
  return gc_upto(av, gmul(y, quadtofp(x, prec)));
}
static GEN
divqf(GEN x, GEN y, long prec) { pari_sp av = avma;
  return gc_upto(av, gdiv(quadtofp(x,prec), y));
}
static GEN
divfq(GEN x, GEN y, long prec) { pari_sp av = avma;
  return gc_upto(av, gdiv(x, quadtofp(y,prec)));
}
/* y PADIC, x + y by converting x to padic */
static GEN
addTp(GEN x, GEN y) { pari_sp av = avma; GEN z;

  if (!valp(y)) z = cvtop2(x,y);
  else {
    long l = signe(padic_u(y))? valp(y) + precp(y): valp(y);
    z  = cvtop(x, padic_p(y), l);
  }
  return gc_upto(av, addsub_pp(z, y, addii));
}
/* y PADIC, x * y by converting x to padic */
static GEN
mulTp(GEN x, GEN y) { pari_sp av = avma;
  return gc_upto(av, mulpp(cvtop2(x,y), y));
}
/* y PADIC, non zero x / y by converting x to padic */
static GEN
divTp(GEN x, GEN y) { pari_sp av = avma;
  return gc_upto(av, divpp(cvtop2(x,y), y));
}
/* x PADIC, x / y by converting y to padic. Assume x != 0; otherwise y
 * converted to O(p^e) and division by 0 */
static GEN
divpT(GEN x, GEN y) { pari_sp av = avma;
  return gc_upto(av, divpp(x, cvtop2(y,x)));
}

/* z := Mod(x,X) + Mod(y,X) [ t_INTMOD preallocated ], x,y,X INT, 0 <= x,y < X
 * clean memory from z on */
static GEN
add_intmod_same(GEN z, GEN X, GEN x, GEN y) {
  if (lgefint(X) == 3) {
    ulong u = Fl_add(itou(x),itou(y), X[2]);
    set_avma((pari_sp)z); gel(z,2) = utoi(u);
  }
  else {
    GEN u = addii(x,y); if (cmpii(u, X) >= 0) u = subii(u, X);
    gel(z,2) = gc_INT((pari_sp)z, u);
  }
  gel(z,1) = icopy(X); return z;
}
static GEN
sub_intmod_same(GEN z, GEN X, GEN x, GEN y) {
  if (lgefint(X) == 3) {
    ulong u = Fl_sub(itou(x),itou(y), X[2]);
    set_avma((pari_sp)z); gel(z,2) = utoi(u);
  }
  else {
    GEN u = subii(x,y); if (signe(u) < 0) u = addii(u, X);
    gel(z,2) = gc_INT((pari_sp)z, u);
  }
  gel(z,1) = icopy(X); return z;
}
/* cf add_intmod_same */
static GEN
mul_intmod_same(GEN z, GEN X, GEN x, GEN y) {
  if (lgefint(X) == 3) {
    ulong u = Fl_mul(itou(x),itou(y), X[2]);
    set_avma((pari_sp)z); gel(z,2) = utoi(u);
  }
  else
    gel(z,2) = gc_INT((pari_sp)z, remii(mulii(x,y), X) );
  gel(z,1) = icopy(X); return z;
}
/* cf add_intmod_same */
static GEN
div_intmod_same(GEN z, GEN X, GEN x, GEN y)
{
  if (lgefint(X) == 3) {
    ulong m = uel(X,2), u = Fl_div(itou(x), itou(y), m);
    set_avma((pari_sp)z); gel(z,2) = utoi(u);
  }
  else
    gel(z,2) = gc_INT((pari_sp)z, remii(mulii(x, Fp_inv(y,X)), X) );
  gel(z,1) = icopy(X); return z;
}

/*******************************************************************/
/*                                                                 */
/*        REDUCTION to IRREDUCIBLE TERMS (t_FRAC/t_RFRAC)          */
/*                                                                 */
/* (static routines are not memory clean, but OK for gc_upto) */
/*******************************************************************/
/* Compute the denominator of (1/y) * (n/d) = n/yd, y a "scalar".
 * Sanity check : avoid (1/2) / (Mod(1,2)*x + 1) "=" 1 / (0 * x + 1) */
static GEN
rfrac_denom_mul_scal(GEN d, GEN y)
{
  GEN D = RgX_Rg_mul(d, y);
  if (lg(D) != lg(d))
  { /* try to generate a meaningful diagnostic */
    D = gdiv(leading_coeff(d), y); /* should fail */
    pari_err_INV("gred_rfrac", y); /* better than nothing */
  }
  return D;
}

static int
Leading_is_neg(GEN x)
{
  while (typ(x) == t_POL) x = leading_coeff(x);
  return is_real_t(typ(x))? gsigne(x) < 0: 0;
}

/* x = Rg_get_1(something); shall we use it for base change ?
 * Not if gen_1 (over Z) or t_PADIC (over Zp, padic prec is independent in
 * each coefficient) */
static int
base_change(GEN x) { return x != gen_1 && typ(x) != t_PADIC; }

/* d a t_POL, n a coprime t_POL of same var or "scalar". Not memory clean */
GEN
gred_rfrac_simple(GEN n, GEN d)
{
  GEN _1n, _1d, c, cn, cd, z;
  long dd = degpol(d);

  if (dd <= 0)
  {
    if (dd < 0) pari_err_INV("gred_rfrac_simple", d);
    n = gdiv(n, gel(d,2));
    if (typ(n) != t_POL || varn(n) != varn(d)) n = scalarpol(n, varn(d));
    return n;
  }
  _1n = Rg_get_1(n);
  _1d = Rg_get_1(d);
  if (base_change(_1n) && !gidentical(_1n, _1d)) d = gmul(d, _1n);
  if (base_change(_1d) && !gidentical(_1n, _1d)) n = gmul(n, _1d);
  if (Leading_is_neg(d)) { d = gneg(d); n = gneg(n); }
  cd = content(d);
  while (typ(n) == t_POL && !degpol(n)) n = gel(n,2);
  cn = (typ(n) == t_POL && varn(n) == varn(d))? content(n): n;
  if (!gequal1(cd)) {
    d = RgX_Rg_div(d,cd);
    if (!gequal1(cn))
    {
      if (gequal0(cn)) {
        if (isexactzero(cn)) return scalarpol(cn, varn(d));
        n = (cn != n)? RgX_Rg_div(n,cd): gdiv(n, cd);
        c = gen_1;
      } else {
        n = (cn != n)? RgX_Rg_div(n,cn): gen_1;
        c = gdiv(cn,cd);
      }
    }
    else
      c = ginv(cd);
  } else {
    if (!gequal1(cn))
    {
      if (gequal0(cn)) {
        if (isexactzero(cn)) return scalarpol(cn, varn(d));
        c = gen_1;
      } else {
        n = (cn != n)? RgX_Rg_div(n,cn): gen_1;
        c = cn;
      }
    } else {
      GEN y = cgetg(3,t_RFRAC);
      gel(y,1) = gcopy(n);
      gel(y,2) = RgX_copy(d); return y;
    }
  }

  if (typ(c) == t_POL)
  {
    z = c;
    do { z = content(z); } while (typ(z) == t_POL);
    cd = denom_i(z);
    cn = gmul(c, cd);
  }
  else
  {
    cn = numer_i(c);
    cd = denom_i(c);
  }
  z = cgetg(3,t_RFRAC);
  gel(z,1) = gmul(n, cn);
  gel(z,2) = d = rfrac_denom_mul_scal(d, cd);
  /* can happen: Pol(O(17^-1)) / Pol([Mod(9,23), O(23^-3)]) */
  if (!signe(d)) pari_err_INV("gred_rfrac_simple", d);
  return z;
}

/* in rare cases x may be a t_POL, after 0/x for instance -> pol_0() */
static GEN
fix_rfrac(GEN x, long d)
{
  GEN z, N, D;
  if (!d || typ(x) == t_POL) return x;
  z = cgetg(3, t_RFRAC);
  N = gel(x,1);
  D = gel(x,2);
  if (d > 0) {
    gel(z, 1) = (typ(N)==t_POL && varn(N)==varn(D))? RgX_shift(N,d)
                                                   : monomialcopy(N,d,varn(D));
    gel(z, 2) = RgX_copy(D);
  } else {
    gel(z, 1) = gcopy(N);
    gel(z, 2) = RgX_shift(D, -d);
  }
  return z;
}

/* d a t_POL; simplify the rational function n / d */
static GEN
gred_rfrac(GEN n, GEN d)
{
  GEN y, z, _1n, _1d;
  long v, vd, vn;

  n = simplify_shallow(n);
  if (isintzero(n)) return scalarpol(Rg_get_0(d), varn(d));
  d = simplify_shallow(d);
  if (typ(d) != t_POL) return gdiv(n,d);
  vd = varn(d);
  if (typ(n) != t_POL)
  {
    if (varncmp(vd, gvar(n)) >= 0) return gdiv(n,d);
    if (varncmp(vd, gvar2(n)) < 0) return gred_rfrac_simple(n,d);
    pari_err_BUG("gred_rfrac [incompatible variables]");
  }
  vn = varn(n);
  if (varncmp(vd, vn) < 0) return gred_rfrac_simple(n,d);
  if (varncmp(vd, vn) > 0) return RgX_Rg_div(n,d);
  _1n = Rg_get_1(n);
  _1d = Rg_get_1(d);
  if (base_change(_1n) && !gidentical(_1n, _1d))
  {
    d = gmul(d, _1n);
    if (!signe(d)) pari_err_INV("gdiv",d);
  }
  if (base_change(_1d) && !gidentical(_1n, _1d))
  {
    n = gmul(n, _1d);
    if (!signe(n)) return gdiv(simplify_shallow(n),d);
  }
  /* now n and d are t_POLs in the same variable */
  v = RgX_valrem(n, &n) - RgX_valrem(d, &d);
  if (!degpol(d))
  {
    n = RgX_Rg_div(n,gel(d,2));
    return v? RgX_mulXn(n,v): n;
  }

  /* X does not divide gcd(n,d), deg(d) > 0 */
  if (!isinexact(n) && !isinexact(d))
  {
    y = RgX_divrem(n, d, &z);
    if (!signe(z)) { cgiv(z); return v? RgX_mulXn(y, v): y; }
    z = RgX_gcd(d, z);
    if (degpol(z)) { n = RgX_div(n,z); d = RgX_div(d,z); }
  }
  return fix_rfrac(gred_rfrac_simple(n,d), v);
}

/* x,y t_INT, return x/y in reduced form */
GEN
Qdivii(GEN x, GEN y)
{
  pari_sp av = avma;
  GEN r, q;

  if (lgefint(y) == 3)
  {
    q = Qdiviu(x, y[2]);
    if (signe(y) > 0) return q;
    if (typ(q) == t_INT) togglesign(q); else togglesign_safe(&gel(q,1));
    return q;
  }
  if (is_pm1(y)) return (signe(y) < 0)? negi(x): icopy(x);
  if (equali1(x))
  {
    if (!signe(y)) pari_err_INV("gdiv",y);
    retmkfrac(signe(y) < 0? gen_m1: gen_1, absi(y));
  }
  q = dvmdii(x,y,&r);
  if (r == gen_0) return q; /* gen_0 intended */
  r = gcdii(y, r);
  if (lgefint(r) == 3)
  {
    ulong t = r[2];
    set_avma(av);
    if (t == 1) q = mkfraccopy(x,y);
    else
    {
      q = cgetg(3,t_FRAC);
      gel(q,1) = diviuexact(x,t);
      gel(q,2) = diviuexact(y,t);
    }
  }
  else
  { /* rare: r and q left on stack for efficiency */
    q = cgetg(3,t_FRAC);
    gel(q,1) = diviiexact(x,r);
    gel(q,2) = diviiexact(y,r);
  }
  normalize_frac(q); return q;
}

static GEN
utoi_sign(ulong x, long s) { return s > 0? utoipos(x): utoineg(x); }

/* x t_INT, return x/y in reduced form */
GEN
Qdiviu(GEN x, ulong y)
{
  pari_sp av;
  ulong r, t;
  long s;
  GEN q;

  if (y == 1) return icopy(x);
  if (!y) pari_err_INV("gdiv",gen_0);
  s = signe(x); if (!s) return gen_0;
  if (lgefint(x) == 3)
  {
    ulong xx = uel(x,2), g;
    if (xx == 1) retmkfrac(s > 0? gen_1: gen_m1, utoipos(y));
    g = ugcd(xx, y);
    if (g != 1)
    {
      xx /= g; if (y == g) return utoi_sign(xx, s);
      y /= g;
    }
    retmkfrac(utoi_sign(xx, s), utoipos(y));
  }
  av = avma; q = absdiviu_rem(x,y,&r);
  if (!r)
  {
    if (s < 0) togglesign(q);
    return q;
  }
  t = ugcd(y, r); set_avma(av);
  if (t == 1) retmkfrac(icopy(x), utoipos(y));
  retmkfrac(diviuexact(x,t), utoipos(y / t));
}

/* x t_INT, return x/y in reduced form */
GEN
Qdivis(GEN x, long y)
{
  GEN q;
  if (y >= 0) return Qdiviu(x, y);
  q = Qdiviu(x, -y);
  if (typ(q) == t_INT) togglesign(q); else togglesign_safe(&gel(q,1));
  return q;
}

/*******************************************************************/
/*                                                                 */
/*                          CONJUGATION                            */
/*                                                                 */
/*******************************************************************/
/* lift( conj(Mod(x, y)) ), assuming degpol(y) = 2, degpol(x) < 2 */
static GEN
quad_polmod_conj(GEN x, GEN y)
{
  GEN z, u, v, a, b;
  if (typ(x) != t_POL) return gcopy(x);
  if (varn(x) != varn(y) || degpol(x) <= 0) return RgX_copy(x);
  a = gel(y,4); u = gel(x,3); /*Mod(ux + v, ax^2 + bx + c)*/
  b = gel(y,3); v = gel(x,2);
  z = cgetg(4, t_POL); z[1] = x[1];
  gel(z,2) = gsub(v, gdiv(gmul(u,b), a));
  gel(z,3) = gneg(u); return z;
}
static GEN
quad_polmod_norm(GEN x, GEN y)
{
  GEN z, u, v, a, b, c;
  if (typ(x) != t_POL || varn(x) != varn(y) || degpol(x) <= 0) return gsqr(x);
  a = gel(y,4); u = gel(x,3); /*Mod(ux + v, ax^2 + bx + c)*/
  b = gel(y,3); v = gel(x,2);
  c = gel(y,2);
  z = gmul(u, gsub(gmul(c,u), gmul(b,v)));
  if (!gequal1(a)) z = gdiv(z, a);
  return gadd(z, gsqr(v));
}

GEN
conj_i(GEN x)
{
  switch(typ(x))
  {
    case t_INT: case t_REAL: case t_INTMOD: case t_FRAC: case t_PADIC:
      return x;

    case t_COMPLEX: return mkcomplex(gel(x,1), gneg(gel(x,2)));

    case t_QUAD:
    {
      GEN y = cgetg(4,t_QUAD);
      gel(y,1) = gel(x,1);
      gel(y,2) = gequal0(gmael(x,1,3))? gel(x,2)
                                      : gadd(gel(x,2), gel(x,3));
      gel(y,3) = gneg(gel(x,3)); return y;
    }
    case t_POL: pari_APPLY_pol_normalized(conj_i(gel(x,i)));
    case t_SER: pari_APPLY_ser_normalized(conj_i(gel(x,i)));

    case t_RFRAC:
    case t_VEC:
    case t_COL:
    case t_MAT: pari_APPLY_same(conj_i(gel(x,i)));

    case t_POLMOD:
    {
      GEN X = gel(x,1);
      long d = degpol(X);
      if (d < 2) return x;
      if (d == 2) return mkpolmod(quad_polmod_conj(gel(x,2), X), X);
    }
  }
  pari_err_TYPE("gconj",x);
  return NULL; /* LCOV_EXCL_LINE */
}
GEN
gconj(GEN x)
{ pari_sp av = avma; return gc_GEN(av, conj_i(x)); }

GEN
conjvec(GEN x,long prec)
{
  long lx, s, i;
  GEN z;

  switch(typ(x))
  {
    case t_INT: case t_INTMOD: case t_FRAC:
      return mkcolcopy(x);

    case t_COMPLEX: case t_QUAD:
      z=cgetg(3,t_COL); gel(z,1) = gcopy(x); gel(z,2) = gconj(x); break;

    case t_FFELT:
      return FF_conjvec(x);

    case t_VEC: case t_COL:
      lx = lg(x); z = cgetg(lx,t_MAT);
      if (lx == 1) return z;
      gel(z,1) = conjvec(gel(x,1),prec);
      s = lgcols(z);
      for (i=2; i<lx; i++)
      {
        gel(z,i) = conjvec(gel(x,i),prec);
        if (lg(gel(z,i)) != s) pari_err_OP("conjvec", gel(z,1), gel(z,i));
      }
      break;

    case t_POLMOD: {
      GEN T = gel(x,1), r;
      pari_sp av;

      lx = lg(T);
      if (lx <= 3) return cgetg(1,t_COL);
      x = gel(x,2);
      for (i=2; i<lx; i++)
      {
        GEN c = gel(T,i);
        switch(typ(c)) {
          case t_INTMOD: {
            GEN p = gel(c,1);
            pari_sp av;
            if (typ(x) != t_POL) retconst_col(lx-3, Rg_to_Fp(x, p));
            av = avma;
            T = RgX_to_FpX(T,p);
            x = RgX_to_FpX(x, p);
            if (varn(x) != varn(T)) pari_err_VAR("conjvec",x,T);
            z = FpXQC_to_mod(FpXQ_conjvec(x, T, p), T, p);
            return gc_upto(av, z);
          }
          case t_INT:
          case t_FRAC: break;
          default: pari_err_TYPE("conjvec [not a rational t_POL]",T);
        }
      }
      if (typ(x) != t_POL)
      {
        if (!is_rational_t(typ(x)))
          pari_err_TYPE("conjvec [not a rational t_POL]",x);
        retconst_col(lx-3, gcopy(x));
      }
      RgX_check_QX(x,"conjvec");
      av = avma;
      if (varn(x) != varn(T)) pari_err_VAR("conjvec",x,T);
      r = cleanroots(T,prec);
      z = cgetg(lx-2,t_COL);
      for (i=1; i<=lx-3; i++) gel(z,i) = poleval(x, gel(r,i));
      return gc_upto(av, z);
    }

    default:
      pari_err_TYPE("conjvec",x);
      return NULL; /* LCOV_EXCL_LINE */
  }
  return z;
}

/********************************************************************/
/**                                                                **/
/**                           ADDITION                             **/
/**                                                                **/
/********************************************************************/
static GEN
mkpadic_mod(GEN u, GEN p, GEN pd, long e, long d)
{ retmkpadic(modii(u, pd), icopy(p), icopy(pd), e, d); }

/* x, y compatible PADIC, op = add or sub */
static GEN
addsub_pp(GEN x, GEN y, GEN (*op)(GEN,GEN))
{
  pari_sp av = avma;
  long d, e, r, rx, ry;
  GEN u, z, mod, pdx, pdy, ux, uy, p = padic_p(x);
  int swap;

  e = valp(x);
  r = valp(y); d = r-e;
  if (d < 0) { swap = 1; swap(x,y); e = r; d = -d; } else swap = 0;
  pdx = padic_pd(x); ux = padic_u(x);
  pdy = padic_pd(y); uy = padic_u(y);
  rx = precp(x);
  ry = precp(y);
  if (d) /* v(x) < v(y) */
  {
    r = d+ry; z = powiu(p,d);
    if (r < rx) mod = mulii(z,pdy); else { r = rx; mod = pdx; }
    z = mulii(z, uy);
    u = swap? op(z, ux): op(ux, z);
  }
  else
  {
    long c;
    if (ry < rx) { r=ry; mod = pdy; } else { r=rx; mod = pdx; }
    u = swap? op(uy, ux): op(ux, uy);
    if (!signe(u) || (c = Z_pvalrem(u,p,&u)) >= r)
    {
      set_avma(av); return zeropadic(p, e+r);
    }
    if (c)
    {
      mod = diviiexact(mod, powiu(p,c));
      r -= c;
      e += c;
    }
  }
  return gc_upto(av, mkpadic_mod(u, p, mod, e, r));
}
/* Rg_to_Fp(t_FRAC) without GC */
static GEN
Q_to_Fp(GEN x, GEN p)
{ return mulii(gel(x,1), Fp_inv(gel(x,2),p)); }
/* return x + y, where y t_PADIC and x is a nonzero t_INT or t_FRAC */
static GEN
addQp(GEN x, GEN y)
{
  pari_sp av = avma;
  long d, r, e, vy = valp(y), py = precp(y);
  GEN q, mod, u, p = padic_p(y);

  e = Q_pvalrem(x, p, &x);
  d = vy - e; r = d + py;
  if (r <= 0) { set_avma(av); return gcopy(y); }
  mod = padic_pd(y);
  u   = padic_u(y);
  if (d > 0)
  {
    q = powiu(p,d);
    mod = mulii(mod, q);
    if (typ(x) != t_INT) x = Q_to_Fp(x, mod);
    u = addii(x,  mulii(u, q));
  }
  else if (d < 0)
  {
    q = powiu(p,-d);
    if (typ(x) != t_INT) x = Q_to_Fp(x, mod);
    u = addii(u, mulii(x, q));
    r = py; e = vy;
  }
  else
  {
    long c;
    if (typ(x) != t_INT) x = Q_to_Fp(x, mod);
    u = addii(u, x);
    if (!signe(u) || (c = Z_pvalrem(u,p,&u)) >= r)
    {
      set_avma(av); return zeropadic(p,e+r);
    }
    if (c)
    {
      mod = diviiexact(mod, powiu(p,c));
      r -= c;
      e += c;
    }
  }
  return gc_upto(av, mkpadic_mod(u, p, mod, e, r));
}

/* Mod(x,X) + Mod(y,X) */
#define addsub_polmod_same addsub_polmod_scal
/* Mod(x,X) +/- Mod(y,Y) */
static GEN
addsub_polmod(GEN X, GEN Y, GEN x, GEN y, GEN(*op)(GEN,GEN))
{
  long T[3] = { evaltyp(t_POLMOD) | _evallg(3),0,0 };
  GEN z = cgetg(3,t_POLMOD);
  long vx = varn(X), vy = varn(Y);
  if (vx==vy) {
    pari_sp av;
    gel(z,1) = RgX_gcd(X,Y); av = avma;
    warn_coercion(X,Y,gel(z,1));
    gel(z,2) = gc_upto(av, gmod(op(x, y), gel(z,1))); return z;
  }
  if (varncmp(vx, vy) < 0)
  { gel(z,1) = RgX_copy(X); gel(T,1) = Y; gel(T,2) = y; y = T; }
  else
  { gel(z,1) = RgX_copy(Y); gel(T,1) = X; gel(T,2) = x; x = T; }
  gel(z,2) = op(x, y); return z;
}
/* Mod(y, Y) +/- x,  x scalar or polynomial in same var and reduced degree */
static GEN
addsub_polmod_scal(GEN Y, GEN y, GEN x, GEN(*op)(GEN,GEN))
{ retmkpolmod(degpol(Y)? op(y, x): gen_0, RgX_copy(Y)); }

/* typ(y) == t_SER, x "scalar" [e.g object in lower variable] */
static GEN
add_ser_scal(GEN y, GEN x)
{
  long i, v, ly, vy;
  GEN z;

  if (isrationalzero(x)) return gcopy(y);
  ly = lg(y);
  v = valser(y);
  if (v < 3-ly) return gcopy(y);
  /* v + ly >= 3 */
  if (v < 0)
  {
    z = cgetg(ly,t_SER); z[1] = y[1];
    for (i = 2; i <= 1-v; i++) gel(z,i) = gcopy(gel(y,i));
    gel(z,i) = gadd(x,gel(y,i)); i++;
    for (     ; i < ly; i++)   gel(z,i) = gcopy(gel(y,i));
    return normalizeser(z);
  }
  vy = varn(y);
  if (v > 0)
  {
    if (ser_isexactzero(y))
      return scalarser(ly == 2? x: gadd(x,gel(y,2)), vy, v);
    y -= v; ly += v;
    z = cgetg(ly,t_SER);
    x = gcopy(x);
    for (i=3; i<=v+1; i++) gel(z,i) = gen_0;
  }
  else if (ser_isexactzero(y)) return gcopy(y);
  else
  { /* v = 0, ly >= 3 */
    z = cgetg(ly,t_SER);
    x = gadd(x, gel(y,2));
    i = 3;
  }
  for (; i<ly; i++) gel(z,i) = gcopy(gel(y,i));
  gel(z,2) = x;
  z[1] = evalsigne(1) | _evalvalser(0) | evalvarn(vy);
  return gequal0(x)? normalizeser(z): z;
}
static long
_serprec(GEN x) { return ser_isexactzero(x)? 2: lg(x); }
/* x,y t_SER in the same variable: x+y */
static GEN
ser_add(GEN x, GEN y)
{
  long i, lx,ly, n = valser(y) - valser(x);
  GEN z;
  if (n < 0) { n = -n; swap(x,y); }
  /* valser(x) <= valser(y) */
  lx = _serprec(x);
  if (lx == 2) /* don't lose type information */
  {
    z = scalarser(gadd(Rg_get_0(x), Rg_get_0(y)), varn(x), 1);
    setvalser(z, valser(x)); return z;
  }
  ly = _serprec(y) + n; if (lx < ly) ly = lx;
  if (n)
  {
    if (n+2 > lx) return gcopy(x);
    z = cgetg(ly,t_SER);
    for (i=2; i<=n+1; i++) gel(z,i) = gcopy(gel(x,i));
    for (   ; i < ly; i++) gel(z,i) = gadd(gel(x,i),gel(y,i-n));
  } else {
    z = cgetg(ly,t_SER);
    for (i=2; i < ly; i++) gel(z,i) = gadd(gel(x,i),gel(y,i));
  }
  z[1] = x[1]; return normalizeser(z);
}
/* typ(y) == RFRAC, x polynomial in same variable or "scalar" */
static GEN
add_rfrac_scal(GEN y, GEN x)
{
  pari_sp av;
  GEN n;

  if (isintzero(x)) return gcopy(y); /* frequent special case */
  av = avma; n = gadd(gmul(x, gel(y,2)), gel(y,1));
  return gc_upto(av, gred_rfrac_simple(n, gel(y,2)));
}

/* x "scalar", ty != t_MAT and nonscalar */
static GEN
add_scal(GEN y, GEN x, long ty)
{
  switch(ty)
  {
    case t_POL: return RgX_Rg_add(y, x);
    case t_SER: return add_ser_scal(y, x);
    case t_RFRAC: return add_rfrac_scal(y, x);
    case t_COL: return RgC_Rg_add(y, x);
    case t_VEC:
      if (isintzero(x)) return gcopy(y);
      break;
  }
  pari_err_TYPE2("+",x,y);
  return NULL; /* LCOV_EXCL_LINE */
}

/* assumes z = cget(3, t_FRAC) comes first in stack, then a, then b */
static GEN
setfrac(GEN z, GEN a, GEN b)
{
  gel(z,1) = icopy_avma(a, (pari_sp)z);
  gel(z,2) = icopy_avma(b, (pari_sp)gel(z,1));
  set_avma((pari_sp)gel(z,2)); return z;
}
/* z <- a / (b*Q), (Q,a) = 1 */
static GEN
addsub_frac_i(GEN z, GEN Q, GEN a, GEN b)
{
  GEN q = Qdivii(a, b); /* != 0 */
  if (typ(q) == t_INT)
  {
    gel(z,1) = gc_INT((pari_sp)Q, q);
    gel(z,2) = Q; return z;
  }
  return setfrac(z, gel(q,1), mulii(gel(q,2), Q));
}
static GEN
addsub_frac(GEN x, GEN y, GEN (*op)(GEN,GEN))
{
  GEN x1 = gel(x,1), x2 = gel(x,2);
  GEN y1 = gel(y,1), y2 = gel(y,2), z, Q, q, r, n, delta;
  int s = cmpii(x2, y2);

  /* common denominator: (x1 op y1) / x2 */
  if (!s)
  {
    pari_sp av = avma;
    return gc_upto(av, Qdivii(op(x1, y1), x2));
  }
  z = cgetg(3, t_FRAC);
  if (s < 0)
  {
    Q = dvmdii(y2, x2, &r);
    /* y2 = Q x2: 1/x2 . (Q x1 op y1)/Q, where latter is in coprime form */
    if (r == gen_0) return addsub_frac_i(z, Q, op(mulii(Q,x1), y1), x2);
    delta = gcdii(x2,r);
  }
  else
  {
    Q = dvmdii(x2, y2, &r);
    /* x2 = Q y2: 1/y2 . (x1 op Q y1)/Q, where latter is in coprime form */
    if (r == gen_0) return addsub_frac_i(z, Q, op(x1, mulii(Q,y1)), y2);
    delta = gcdii(y2,r);
  }
  /* delta = gcd(x2,y2) */
  if (equali1(delta))
  { /* numerator is nonzero */
    gel(z,1) = gc_INT((pari_sp)z, op(mulii(x1,y2), mulii(y1,x2)));
    gel(z,2) = mulii(x2,y2); return z;
  }
  x2 = diviiexact(x2,delta);
  y2 = diviiexact(y2,delta);
  n = op(mulii(x1,y2), mulii(y1,x2)); /* != 0 */
  q = dvmdii(n, delta, &r);
  if (r == gen_0) return setfrac(z, q, mulii(x2, y2));
  r = gcdii(delta, r);
  if (!equali1(r)) { n = diviiexact(n, r); delta = diviiexact(delta, r); }
  return setfrac(z, n, mulii(mulii(x2, y2), delta));
}

/* assume x2, y2 are t_POLs in the same variable */
static GEN
add_rfrac(GEN x, GEN y)
{
  pari_sp av = avma;
  GEN x1 = gel(x,1), x2 = gel(x,2);
  GEN y1 = gel(y,1), y2 = gel(y,2), q, r, n, d, delta;

  delta = RgX_gcd(x2,y2);
  if (!degpol(delta))
  {
    n = simplify_shallow( gadd(gmul(x1,y2), gmul(y1,x2)) );
    d = RgX_mul(x2, y2);
    return gc_upto(av, gred_rfrac_simple(n, d));
  }
  x2 = RgX_div(x2,delta);
  y2 = RgX_div(y2,delta);
  n = gadd(gmul(x1,y2), gmul(y1,x2));
  if (!signe(n))
  {
    n = simplify_shallow(n);
    if (isexactzero(n))
    {
      if (isrationalzero(n)) { set_avma(av); return zeropol(varn(x2)); }
      return gc_upto(av, scalarpol(n, varn(x2)));
    }
    return gc_GEN(av, mkrfrac(n, RgX_mul(gel(x,2),y2)));
  }
  if (degpol(n) == 0)
    return gc_upto(av, gred_rfrac_simple(gel(n,2), RgX_mul(gel(x,2),y2)));
  q = RgX_divrem(n, delta, &r); /* we want gcd(n,delta) */
  if (isexactzero(r))
  {
    GEN z;
    d = RgX_mul(x2, y2);
    /* "constant" denominator ? */
    z = lg(d) == 3? RgX_Rg_div(q, gel(d,2)): gred_rfrac_simple(q, d);
    return gc_upto(av, z);
  }
  r = RgX_gcd(delta, r);
  if (degpol(r))
  {
    n = RgX_div(n, r);
    d = RgX_mul(RgX_mul(x2,y2), RgX_div(delta, r));
  }
  else
    d = RgX_mul(gel(x,2), y2);
  return gc_upto(av, gred_rfrac_simple(n, d));
}

GEN
gadd(GEN x, GEN y)
{
  long tx = typ(x), ty = typ(y), vx, vy, lx, i, l;
  pari_sp av;
  GEN z, p1;

  if (tx == ty) switch(tx) /* shortcut to generic case */
  {
    case t_INT: return addii(x,y);
    case t_REAL: return addrr(x,y);
    case t_INTMOD:  { GEN X = gel(x,1), Y = gel(y,1);
      z = cgetg(3,t_INTMOD);
      if (X==Y || equalii(X,Y))
        return add_intmod_same(z, X, gel(x,2), gel(y,2));
      gel(z,1) = gcdii(X,Y);
      warn_coercion(X,Y,gel(z,1));
      av = avma; p1 = addii(gel(x,2),gel(y,2));
      gel(z,2) = gc_INT(av, remii(p1, gel(z,1))); return z;
    }
    case t_FRAC: return addsub_frac(x,y,addii);
    case t_COMPLEX: z = cgetg(3,t_COMPLEX);
      gel(z,2) = gadd(gel(x,2),gel(y,2));
      if (isintzero(gel(z,2)))
      {
        set_avma((pari_sp)(z+3));
        return gadd(gel(x,1),gel(y,1));
      }
      gel(z,1) = gadd(gel(x,1),gel(y,1));
      return z;
    case t_PADIC:
      if (!equalii(padic_p(x), padic_p(y))) pari_err_OP("+",x,y);
      return addsub_pp(x,y, addii);
    case t_QUAD: z = cgetg(4,t_QUAD);
      if (!ZX_equal(gel(x,1),gel(y,1))) pari_err_OP("+",x,y);
      gel(z,1) = ZX_copy(gel(x,1));
      gel(z,2) = gadd(gel(x,2),gel(y,2));
      gel(z,3) = gadd(gel(x,3),gel(y,3)); return z;
    case t_POLMOD:
      if (RgX_equal_var(gel(x,1), gel(y,1)))
        return addsub_polmod_same(gel(x,1), gel(x,2), gel(y,2), &gadd);
      return addsub_polmod(gel(x,1), gel(y,1), gel(x,2), gel(y,2), &gadd);
    case t_FFELT: return FF_add(x,y);
    case t_POL:
      vx = varn(x);
      vy = varn(y);
      if (vx != vy) {
        if (varncmp(vx, vy) < 0) return RgX_Rg_add(x, y);
        else                     return RgX_Rg_add(y, x);
      }
      return RgX_add(x, y);
    case t_SER:
      vx = varn(x);
      vy = varn(y);
      if (vx != vy) {
        if (varncmp(vx, vy) < 0) return add_ser_scal(x, y);
        else                     return add_ser_scal(y, x);
      }
      return ser_add(x, y);
    case t_RFRAC:
      vx = varn(gel(x,2));
      vy = varn(gel(y,2));
      if (vx != vy) {
        if (varncmp(vx, vy) < 0) return add_rfrac_scal(x, y);
        else                     return add_rfrac_scal(y, x);
      }
      return add_rfrac(x,y);
    case t_VEC:
      if (lg(y) != lg(x)) pari_err_OP("+",x,y);
      return RgV_add(x,y);
    case t_COL:
      if (lg(y) != lg(x)) pari_err_OP("+",x,y);
      return RgC_add(x,y);
    case t_MAT:
      lx = lg(x);
      if (lg(y) != lx) pari_err_OP("+",x,y);
      if (lx == 1) return cgetg(1, t_MAT);
      if (lgcols(y) != lgcols(x)) pari_err_OP("+",x,y);
      return RgM_add(x,y);

    default: pari_err_TYPE2("+",x,y);
  }
  /* tx != ty */
  if (tx > ty) { swap(x,y); lswap(tx,ty); }

  if (is_const_t(ty)) switch(tx) /* tx < ty, is_const_t(tx) && is_const_t(ty) */
  {
    case t_INT:
      switch(ty)
      {
        case t_REAL: return addir(x,y);
        case t_INTMOD:
          z = cgetg(3, t_INTMOD);
          return add_intmod_same(z, gel(y,1), gel(y,2), modii(x, gel(y,1)));
        case t_FRAC: z = cgetg(3,t_FRAC);
          gel(z,1) = gc_INT((pari_sp)z, addii(gel(y,1), mulii(gel(y,2),x)));
          gel(z,2) = icopy(gel(y,2)); return z;
        case t_COMPLEX: return addRc(x, y);
        case t_PADIC:
          if (!signe(x)) return gcopy(y);
          return addQp(x,y);
        case t_QUAD: return addRq(x, y);
        case t_FFELT: return FF_Z_add(y,x);
      }

    case t_REAL:
      switch(ty)
      {
        case t_FRAC:
          if (!signe(gel(y,1))) return rcopy(x);
          if (!signe(x))
          {
            lx = expi(gel(y,1)) - expi(gel(y,2)) - expo(x);
            return lx <= 0? rcopy(x): fractor(y, nbits2prec(lx));
          }
          av = avma; z = addir(gel(y,1), mulir(gel(y,2),x));
          return gc_leaf(av, divri(z,gel(y,2)));
        case t_COMPLEX: return addRc(x, y);
        case t_QUAD: return gequal0(y)? rcopy(x): addqf(y, x, realprec(x));

        default: pari_err_TYPE2("+",x,y);
      }

    case t_INTMOD:
      switch(ty)
      {
        case t_FRAC: { GEN X = gel(x,1);
          z = cgetg(3, t_INTMOD);
          p1 = Fp_div(gel(y,1), gel(y,2), X);
          return add_intmod_same(z, X, p1, gel(x,2));
        }
        case t_FFELT:
          if (!equalii(gel(x,1),FF_p_i(y)))
            pari_err_OP("+",x,y);
          return FF_Z_add(y,gel(x,2));
        case t_COMPLEX: return addRc(x, y);
        case t_PADIC: { GEN X = gel(x,1);
          z = cgetg(3, t_INTMOD);
          return add_intmod_same(z, X, gel(x,2), padic_to_Fp(y, X));
        }
        case t_QUAD: return addRq(x, y);
      }

    case t_FRAC:
      switch (ty)
      {
        case t_COMPLEX: return addRc(x, y);
        case t_PADIC:
          if (!signe(gel(x,1))) return gcopy(y);
          return addQp(x,y);
        case t_QUAD: return addRq(x, y);
        case t_FFELT: return FF_Q_add(y, x);
      }

    case t_FFELT:
      pari_err_TYPE2("+",x,y);

    case t_COMPLEX:
      switch(ty)
      {
        case t_PADIC:
          return Zp_nosquare_m1(padic_p(y))? addRc(y, x): addTp(x, y);
        case t_QUAD:
          lx = precision(x); if (!lx) pari_err_OP("+",x,y);
          return gequal0(y)? gcopy(x): addqf(y, x, lx);
      }

    case t_PADIC: /* ty == t_QUAD */
      return (kro_quad(y, padic_p(x)) == -1)? addRq(x, y): addTp(y, x);
  }
  /* tx < ty, !is_const_t(y) */
  switch(ty)
  {
    case t_MAT:
      if (is_matvec_t(tx)) pari_err_TYPE2("+",x,y);
      if (isrationalzero(x)) return gcopy(y);
      return RgM_Rg_add(y, x);
    case t_COL:
      if (tx == t_VEC) pari_err_TYPE2("+",x,y);
      return RgC_Rg_add(y, x);
    case t_POLMOD: /* is_const_t(tx) in this case */
      return addsub_polmod_scal(gel(y,1), gel(y,2), x, &gadd);
  }
  if (is_scalar_t(tx))  {
    if (tx == t_POLMOD)
    {
      vx = varn(gel(x,1));
      vy = gvar(y);
      if (vx == vy) y = gmod(y, gel(x,1)); /* error if ty == t_SER */
      else
        if (varncmp(vx,vy) > 0) return add_scal(y, x, ty);
      return addsub_polmod_scal(gel(x,1), gel(x,2), y, &gadd);
    }
    return add_scal(y, x, ty);
  }
  /* x and y are not scalars, ty != t_MAT */
  vx = gvar(x);
  vy = gvar(y);
  if (vx != vy) { /* x or y is treated as a scalar */
    if (is_vec_t(tx) || is_vec_t(ty)) pari_err_TYPE2("+",x,y);
    return (varncmp(vx, vy) < 0)? add_scal(x, y, tx)
                                : add_scal(y, x, ty);
  }
  /* vx = vy */
  switch(tx)
  {
    case t_POL:
      switch (ty)
      {
        case t_SER:
          if (lg(x) == 2) return gcopy(y);
          i = RgX_val(x); if (i == LONG_MAX) i = 0; /* e.g. x = Mod(0,3)*x^0 */
          i = lg(y) + valser(y) - i;
          if (i < 3) return gcopy(y);
          p1 = RgX_to_ser(x,i); y = ser_add(p1,y);
          settyp(p1, t_VECSMALL); /* p1 left on stack */
          return y;

        case t_RFRAC: return add_rfrac_scal(y, x);
      }
      break;

    case t_SER:
      if (ty == t_RFRAC)
      {
        long vn, vd;
        av = avma;
        vn = gval(gel(y,1), vy);
        vd = RgX_valrem_inexact(gel(y,2), NULL);
        if (vd == LONG_MAX) pari_err_INV("gadd", gel(y,2));

        l = lg(x) + valser(x) - (vn - vd);
        if (l < 3) { set_avma(av); return gcopy(x); }
        return gc_upto(av, gadd(x, rfrac_to_ser_i(y, l)));
      }
      break;
  }
  pari_err_TYPE2("+",x,y);
  return NULL; /* LCOV_EXCL_LINE */
}

GEN
gaddsg(long x, GEN y)
{
  long ty = typ(y);
  GEN z;

  switch(ty)
  {
    case t_INT:  return addsi(x,y);
    case t_REAL: return addsr(x,y);
    case t_INTMOD:
      z = cgetg(3, t_INTMOD);
      return add_intmod_same(z, gel(y,1), gel(y,2), modsi(x, gel(y,1)));
    case t_FRAC: z = cgetg(3,t_FRAC);
      gel(z,1) = gc_INT((pari_sp)z, addii(gel(y,1), mulis(gel(y,2),x)));
      gel(z,2) = icopy(gel(y,2)); return z;
    case t_COMPLEX:
      z = cgetg(3, t_COMPLEX);
      gel(z,1) = gaddsg(x, gel(y,1));
      gel(z,2) = gcopy(gel(y,2)); return z;

    default: return gadd(stoi(x), y);
  }
}

GEN
gsubsg(long x, GEN y)
{
  GEN z, a, b;
  pari_sp av;

  switch(typ(y))
  {
    case t_INT:  return subsi(x,y);
    case t_REAL: return subsr(x,y);
    case t_INTMOD:
      z = cgetg(3, t_INTMOD); a = gel(y,1); b = gel(y,2);
      return add_intmod_same(z, a, Fp_neg(b,a), modsi(x, a));
    case t_FRAC: z = cgetg(3,t_FRAC); a = gel(y,1); b = gel(y,2);
      gel(z,1) = gc_INT((pari_sp)z, subii(mulis(b,x), a));
      gel(z,2) = icopy(gel(y,2)); return z;
    case t_COMPLEX:
      z = cgetg(3, t_COMPLEX);
      gel(z,1) = gsubsg(x, gel(y,1));
      gel(z,2) = gneg(gel(y,2)); return z;
  }
  av = avma;
  return gc_upto(av, gadd(stoi(x), gneg_i(y)));
}

/********************************************************************/
/**                                                                **/
/**                          SUBTRACTION                           **/
/**                                                                **/
/********************************************************************/

GEN
gsub(GEN x, GEN y)
{
  long tx = typ(x), ty = typ(y);
  pari_sp av;
  GEN z;
  if (tx == ty) switch(tx) /* shortcut to generic case */
  {
    case t_INT: return subii(x,y);
    case t_REAL: return subrr(x,y);
    case t_INTMOD:  { GEN p1, X = gel(x,1), Y = gel(y,1);
      z = cgetg(3,t_INTMOD);
      if (X==Y || equalii(X,Y))
        return sub_intmod_same(z, X, gel(x,2), gel(y,2));
      gel(z,1) = gcdii(X,Y);
      warn_coercion(X,Y,gel(z,1));
      av = avma; p1 = subii(gel(x,2),gel(y,2));
      gel(z,2) = gc_INT(av, modii(p1, gel(z,1))); return z;
    }
    case t_FRAC: return addsub_frac(x,y, subii);
    case t_COMPLEX: z = cgetg(3,t_COMPLEX);
      gel(z,2) = gsub(gel(x,2),gel(y,2));
      if (isintzero(gel(z,2)))
      {
        set_avma((pari_sp)(z+3));
        return gsub(gel(x,1),gel(y,1));
      }
      gel(z,1) = gsub(gel(x,1),gel(y,1));
      return z;
    case t_PADIC:
      if (!equalii(padic_p(x), padic_p(y))) pari_err_OP("+",x,y);
      return addsub_pp(x,y, subii);
    case t_QUAD: z = cgetg(4,t_QUAD);
      if (!ZX_equal(gel(x,1),gel(y,1))) pari_err_OP("+",x,y);
      gel(z,1) = ZX_copy(gel(x,1));
      gel(z,2) = gsub(gel(x,2),gel(y,2));
      gel(z,3) = gsub(gel(x,3),gel(y,3)); return z;
    case t_POLMOD:
      if (RgX_equal_var(gel(x,1), gel(y,1)))
        return addsub_polmod_same(gel(x,1), gel(x,2), gel(y,2), &gsub);
      return addsub_polmod(gel(x,1), gel(y,1), gel(x,2), gel(y,2), &gsub);
    case t_FFELT: return FF_sub(x,y);
    case t_POL: {
      long vx = varn(x);
      long vy = varn(y);
      if (vx != vy) {
        if (varncmp(vx, vy) < 0) return RgX_Rg_sub(x, y);
        else                     return Rg_RgX_sub(x, y);
      }
      return RgX_sub(x, y);
    }
    case t_VEC:
      if (lg(y) != lg(x)) pari_err_OP("+",x,y);
      return RgV_sub(x,y);
    case t_COL:
      if (lg(y) != lg(x)) pari_err_OP("+",x,y);
      return RgC_sub(x,y);
    case t_MAT: {
      long lx = lg(x);
      if (lg(y) != lx) pari_err_OP("+",x,y);
      if (lx == 1) return cgetg(1, t_MAT);
      if (lgcols(y) != lgcols(x)) pari_err_OP("+",x,y);
      return RgM_sub(x,y);
    }
    case t_RFRAC: case t_SER: break;

    default: pari_err_TYPE2("+",x,y);
  }
  av = avma;
  return gc_upto(av, gadd(x,gneg_i(y)));
}

/********************************************************************/
/**                                                                **/
/**                        MULTIPLICATION                          **/
/**                                                                **/
/********************************************************************/
static GEN
mul_ser_scal(GEN x, GEN t)
{
  if (isexactzero(t)) return gmul(Rg_get_0(x), t);
  if (isint1(t)) return gcopy(x);
  if (ser_isexactzero(x))
  {
    GEN z = scalarser(lg(x) == 2? Rg_get_0(t): gmul(gel(x,2), t), varn(x), 1);
    setvalser(z, valser(x)); return z;
  }
  pari_APPLY_ser(gmul(gel(x,i), t));
}
/* (n/d) * x, x "scalar" or polynomial in the same variable as d
 * [n/d a valid RFRAC]  */
static GEN
mul_rfrac_scal(GEN n, GEN d, GEN x)
{
  pari_sp av = avma;
  GEN z;

  switch(typ(x))
  {
    case t_PADIC:
      n = gmul(n, x);
      d = gcvtop(d, padic_p(x), signe(padic_u(x))? precp(x): 1);
      return gc_upto(av, gdiv(n,d));

    case t_INTMOD: case t_POLMOD:
      n = gmul(n, x);
      d = gmul(d, gmodulo(gen_1, gel(x,1)));
      return gc_upto(av, gdiv(n,d));
  }
  z = gred_rfrac(x, d);
  n = simplify_shallow(n);
  if (typ(z) == t_RFRAC)
  {
    n = gmul(gel(z,1), n);
    d = gel(z,2);
    if (typ(n) == t_POL && varncmp(varn(n), varn(d)) < 0)
      z = RgX_Rg_div(n, d);
    else
      z = gred_rfrac_simple(n, d);
  }
  else
    z = gmul(z, n);
  return gc_upto(av, z);
}
static GEN
mul_scal(GEN y, GEN x, long ty)
{
  switch(ty)
  {
    case t_POL:
      if (lg(y) == 2) return scalarpol(gmul(gen_0,x), varn(y));
      return RgX_Rg_mul(y, x);
    case t_SER: return mul_ser_scal(y, x);
    case t_RFRAC: return mul_rfrac_scal(gel(y,1),gel(y,2), x);
    case t_QFB:
      if (typ(x) == t_INT && gequal1(x)) return gcopy(y); /* fall through */
  }
  pari_err_TYPE2("*",x,y);
  return NULL; /* LCOV_EXCL_LINE */
}
static GEN
mul_self_scal(GEN x, GEN y)
{ pari_APPLY_same(gmul(y,gel(x,i))); }

static GEN
mul_gen_rfrac(GEN X, GEN Y)
{
  GEN y1 = gel(Y,1), y2 = gel(Y,2);
  long vx = gvar(X), vy = varn(y2);
  return (varncmp(vx, vy) <= 0)? mul_scal(Y, X, typ(Y)):
                                 gred_rfrac_simple(gmul(y1,X), y2);
}
/* (x1/x2) * (y1/y2) */
static GEN
mul_rfrac(GEN x1, GEN x2, GEN y1, GEN y2)
{
  GEN z, X, Y;
  pari_sp av = avma;

  X = gred_rfrac(x1, y2);
  Y = gred_rfrac(y1, x2);
  if (typ(X) == t_RFRAC)
  {
    if (typ(Y) == t_RFRAC) {
      x1 = gel(X,1);
      x2 = gel(X,2);
      y1 = gel(Y,1);
      y2 = gel(Y,2);
      z = gred_rfrac_simple(gmul(x1,y1), gmul(x2,y2));
    } else
      z = mul_gen_rfrac(Y, X);
  }
  else if (typ(Y) == t_RFRAC)
    z = mul_gen_rfrac(X, Y);
  else
    z = gmul(X, Y);
  return gc_upto(av, z);
}
/* (x1/x2) /y2, x2 and y2 are t_POL in the same variable */
static GEN
div_rfrac_pol(GEN x1, GEN x2, GEN y2)
{
  pari_sp av = avma;
  GEN X = gred_rfrac(x1, y2);
  if (typ(X) == t_RFRAC && varn(gel(X,2)) == varn(x2))
  {
    x2 = RgX_mul(gel(X,2), x2);
    x1 = gel(X,1);
  }
  else
    x1 = X;
  return gc_upto(av, gred_rfrac_simple(x1, x2));
}

/* Mod(y, Y) * x,  assuming x scalar */
static GEN
mul_polmod_scal(GEN Y, GEN y, GEN x)
{ retmkpolmod(isrationalzero(x)? gen_0: gmul(x,y), RgX_copy(Y)); }

/* cf mulqq */
static GEN
quad_polmod_mul(GEN T, GEN x, GEN y)
{
  GEN b = gel(T,3), c = gel(T,2);
  GEN ux = gel(x,2), vx = gel(x,3), uy = gel(y,2), vy = gel(y,3);
  GEN z, s, U, V, E, F;
  pari_sp av, av2;
  z = cgetg(4, t_POL); z[1] = x[1]; av = avma;
  U = gmul(ux, uy);
  V = gmul(vx, vy); s = gmul(c, V);
  E = gmul(gadd(ux, vx), gadd(uy, vy));
  if (typ(b) != t_INT) F = gadd(U, gmul(gaddgs(b, 1), V)); /* = U + (b+1) V */
  else
  { /* minor optimization */
    if (!signe(b)) F = gadd(U, V); /* b = 0 */
    else if (is_pm1(b)) /* b = 1 or -1 */
      F = signe(b) < 0? U: gadd(U, gmul2n(V,1));
    else /* |b| > 1 */
      F = gadd(U, gmul(addis(b, 1), V));
  }
  av2 = avma;
  gel(z,2) = gsub(U, s);
  gel(z,3) = gsub(E, F);
  gc_slice_unsafe(av, av2, z+2, 2);
  return normalizepol_lg(z,4);
}
/* Mod(x,T) * Mod(y,T) */
static GEN
mul_polmod_same(GEN T, GEN x, GEN y)
{
  GEN z = cgetg(3,t_POLMOD), a;
  long v = varn(T), lx = lg(x), ly = lg(y);
  gel(z,1) = RgX_copy(T);
  /* x * y mod T optimised */
  if (typ(x) != t_POL || varn(x) != v || lx <= 3
   || typ(y) != t_POL || varn(y) != v || ly <= 3)
    a = gmul(x, y);
  else
  {
    if (lg(T) == 5 && isint1(gel(T,4))) /* quadratic fields */
      a = quad_polmod_mul(T, x, y);
    else
      a = RgXQ_mul(x, y, gel(z,1));
  }
  gel(z,2) = a; return z;
}
static GEN
sqr_polmod(GEN T, GEN x)
{
  GEN a, z = cgetg(3,t_POLMOD);
  gel(z,1) = RgX_copy(T);
  if (typ(x) != t_POL || varn(x) != varn(T) || lg(x) <= 3)
    a = gsqr(x);
  else
  {
    pari_sp av = avma;
    a = RgXQ_sqr(x, gel(z,1));
    a = gc_upto(av, a);
  }
  gel(z,2) = a; return z;
}
/* Mod(x,X) * Mod(y,Y) */
static GEN
mul_polmod(GEN X, GEN Y, GEN x, GEN y)
{
  long T[3] = { evaltyp(t_POLMOD) | _evallg(3),0,0 };
  long vx = varn(X), vy = varn(Y);
  GEN z = cgetg(3,t_POLMOD);

  if (vx==vy) {
    pari_sp av;
    gel(z,1) = RgX_gcd(X,Y); av = avma;
    warn_coercion(X,Y,gel(z,1));
    gel(z,2) = gc_upto(av, gmod(gmul(x, y), gel(z,1)));
    return z;
  }
  if (varncmp(vx, vy) < 0)
  { gel(z,1) = RgX_copy(X); gel(T,1) = Y; gel(T,2) = y; y = T; }
  else
  { gel(z,1) = RgX_copy(Y); gel(T,1) = X; gel(T,2) = x; x = T; }
  gel(z,2) = gmul(x, y); return z;
}

#if 0 /* used by 3M only */
/* set z = x+y and return 1 if x,y have the same sign
 * set z = x-y and return 0 otherwise */
static int
did_add(GEN x, GEN y, GEN *z)
{
  long tx = typ(x), ty = typ(y);
  if (tx == ty) switch(tx)
  {
    case t_INT: *z = addii(x,y); return 1;
    case t_FRAC: *z = addsub_frac(x,y,addii); return 1;
    case t_REAL:
      if (signe(x) == -signe(y))
      { *z = subrr(x,y); return 0; }
      else
      { *z = addrr(x,y); return 1; }
  }
  if (tx == t_REAL) switch(ty)
  {
    case t_INT:
      if (signe(x) == -signe(y))
      { *z = subri(x,y); return 0; }
      else
      { *z = addri(x,y); return 1; }
    case t_FRAC:
      if (signe(x) == -signe(gel(y,1)))
      { *z = gsub(x,y); return 0; }
      else
      { *z = gadd(x,y); return 1; }
  }
  else if (ty == t_REAL) switch(tx)
  {
    case t_INT:
      if (signe(x) == -signe(y))
      { *z = subir(x,y); return 0; }
      else
      { *z = addir(x,y); return 1; }
    case t_FRAC:
      if (signe(gel(x,1)) == -signe(y))
      { *z = gsub(x,y); return 0; }
      else
      { *z = gadd(x,y); return 1; }
  }
  *z = gadd(x,y); return 1;
}
#endif
/* x * I * y, x t_COMPLEX with non-intzero real part, y non-intzero "scalar" */
static GEN
mulcIR(GEN x, GEN y)
{
  GEN z = cgetg(3,t_COMPLEX);
  pari_sp av = avma;
  gel(z,1) = gc_upto(av, gneg(gmul(y,gel(x,2))));
  gel(z,2) = gmul(y, gel(x,1));
  return z;

}
/* x,y COMPLEX */
static GEN
mulcc(GEN x, GEN y)
{
  GEN xr = gel(x,1), xi = gel(x,2);
  GEN yr = gel(y,1), yi = gel(y,2);
  GEN p1, p2, p3, p4, z;
  pari_sp tetpil, av;

  if (isintzero(xr))
  {
    if (isintzero(yr)) {
      av = avma;
      return gc_upto(av, gneg(gmul(xi,yi)));
    }
    return mulcIR(y, xi);
  }
  if (isintzero(yr)) return mulcIR(x, yi);

  z = cgetg(3,t_COMPLEX); av = avma;
#if 0
  /* 3M method avoiding catastrophic cancellation, BUT loses accuracy due to
   * e.g. xr + xi if exponents differ */
  if (did_add(xr, xi, &p3))
  {
    if (did_add(yr, yi, &p4)) {
    /* R = xr*yr - xi*yi
     * I = (xr+xi)(yr+yi) - xr*yr - xi*yi */
      p1 = gmul(xr,yr);
      p2 = gmul(xi,yi); p2 = gneg(p2);
      p3 = gmul(p3, p4);
      p4 = gsub(p2, p1);
    } else {
    /* R = (xr + xi) * (yr - yi) + (xr * yi - xi * yr)
     * I = xr*yi + xi*yr */
      p1 = gmul(p3,p4);
      p3 = gmul(xr,yi);
      p4 = gmul(xi,yr);
      p2 = gsub(p3, p4);
    }
  } else {
    if (did_add(yr, yi, &p4)) {
     /* R = (xr - xi) * (yr + yi) + (xi * yr - xr * yi)
      * I = xr*yi +xi*yr */
      p1 = gmul(p3,p4);
      p3 = gmul(xr,yi);
      p4 = gmul(xi,yr);
      p2 = gsub(p4, p3);
    } else {
    /* R = xr*yr - xi*yi
     * I = -(xr-xi)(yr-yi) + xr*yr + xi*yi */
      p3 = gneg( gmul(p3, p4) );
      p1 = gmul(xr,yr);
      p2 = gmul(xi,yi);
      p4 = gadd(p1, p2);

      p2 = gneg(p2);
    }
  }
  tetpil = avma;
  gel(z,1) = gadd(p1,p2);
  gel(z,2) = gadd(p3,p4);
#else
  if (typ(xr)==t_INT && typ(yr)==t_INT && typ(xi)==t_INT && typ(yi)==t_INT)
  { /* 3M formula */
    p3 = addii(xr,xi);
    p4 = addii(yr,yi);
    p1 = mulii(xr,yr);
    p2 = mulii(xi,yi);
    p3 = mulii(p3,p4);
    p4 = addii(p2,p1);
    tetpil = avma;
    gel(z,1) = subii(p1,p2);
    gel(z,2) = subii(p3,p4);
    if (!signe(gel(z,2)))
      return gc_INT((pari_sp)(z+3), gel(z,1));
  }
  else
  { /* naive 4M formula: avoid all loss of accuracy */
    p1 = gmul(xr,yr);
    p2 = gmul(xi,yi);
    p3 = gmul(xr,yi);
    p4 = gmul(xi,yr);
    tetpil = avma;
    gel(z,1) = gsub(p1,p2);
    gel(z,2) = gadd(p3,p4);
    if (isintzero(gel(z,2)))
    {
      cgiv(gel(z,2));
      return gc_upto((pari_sp)(z+3), gel(z,1));
    }
  }
#endif

  gc_slice_unsafe(av,tetpil, z+1,2); return z;
}
/* x,y PADIC */
static GEN
mulpp(GEN x, GEN y) {
  GEN pd, p = padic_p(x), ux = padic_u(x), uy = padic_u(y);
  long e = valp(x) + valp(y), dx, dy;

  if (!equalii(p, padic_p(y))) pari_err_OP("*",x,y);
  if (!signe(ux) || !signe(uy)) return zeropadic(p, e);
  dx = precp(x); dy = precp(y);
  if (dx > dy) { pd = padic_pd(y); dx = dy; } else pd = padic_pd(x);
  retmkpadic(Fp_mul(ux, uy, pd), icopy(p), icopy(pd), e, dx);
}
/* x,y QUAD, w^2 = - b w - c, where b = 0 or -1
 * (ux + vx w)(uy + vy w) = ux uy - c vx vy + (ux vy + uy vx - b vx vy) w */
static GEN
mulqq(GEN x, GEN y)
{
  GEN T = gel(x,1), b = gel(T,3), c = gel(T,2);
  GEN ux = gel(x,2), vx = gel(x,3), uy = gel(y,2), vy = gel(y,3);
  GEN z, s, U, V, E, F;
  pari_sp av, av2;
  z = cgetg(4, t_QUAD), gel(z,1) = ZX_copy(T); av = avma;
  U = gmul(ux, uy);
  V = gmul(vx, vy); s = gmul(c, V);
  E = gmul(gadd(ux, vx), gadd(uy, vy));
  F = signe(b)? U: gadd(U, V);
  /* E - F = ux vy + uy vx - b vx vy */
  av2 = avma;
  gel(z,2) = gsub(U, s);
  gel(z,3) = gsub(E, F);
  gc_slice_unsafe(av, av2, z+2, 2); return z;
}

GEN
mulcxI(GEN x)
{
  GEN z;
  switch(typ(x))
  {
    case t_INT:
      if (!signe(x)) return gen_0;
    case t_REAL: case t_FRAC:
      return mkcomplex(gen_0, x);
    case t_COMPLEX:
      if (isintzero(gel(x,1))) return gneg(gel(x,2));
      z = cgetg(3,t_COMPLEX);
      gel(z,1) = gneg(gel(x,2));
      gel(z,2) = gel(x,1); return z;
    default:
      return gmul(gen_I(), x);
  }
}
GEN
mulcxmI(GEN x)
{
  GEN z;
  switch(typ(x))
  {
    case t_INT:
      if (!signe(x)) return gen_0;
    case t_REAL: case t_FRAC:
      return mkcomplex(gen_0, gneg(x));
    case t_COMPLEX:
      if (isintzero(gel(x,1))) return gel(x,2);
      z = cgetg(3,t_COMPLEX);
      gel(z,1) = gel(x,2);
      gel(z,2) = gneg(gel(x,1)); return z;
    default:
      return gmul(mkcomplex(gen_0, gen_m1), x);
  }
}
/* x * I^k */
GEN
mulcxpowIs(GEN x, long k)
{
  switch (k & 3)
  {
    case 1: return mulcxI(x);
    case 2: return gneg(x);
    case 3: return mulcxmI(x);
  }
  return x;
}

/* Convert t_POL y to t_SER of length l and valuation e then normalize. Must
 * not be called when y is an exact zero carrying type information, see comment
 * in gmul(t_SER, t_SER): the valuation may incorrectly be altered by
 * normalizeser in this case. Variant of RgX_to_ser_i with a different
 * meaning for e. */
static GEN
pol2ser(GEN y, long l, long e)
{
  long i, ly = lg(y);
  GEN z = cgetg(l, t_SER);
  z[1] = evalvalser(e) | evalvarn(varn(y)) | evalsigne(1);
  if (ly >= l) {
    for (i = 2; i < l; i++) gel(z,i) = gel(y,i);
  } else {
    for (i = 2; i < ly; i++) gel(z,i) = gel(y,i);
    for (     ; i < l;  i++) gel(z,i) = gen_0;
  }
  return normalizeser(z);
}
/* assume typ(x) = t_VEC */
static int
is_ext_qfr(GEN x)
{ return lg(x) == 3 && typ(gel(x,1)) == t_QFB && !qfb_is_qfi(gel(x,1))
                    && typ(gel(x,2)) == t_REAL; }

GEN
gmul(GEN x, GEN y)
{
  long tx, ty, lx, ly, vx, vy, i, l;
  pari_sp av, tetpil;
  GEN z, p1;

  if (x == y) return gsqr(x);
  tx = typ(x); ty = typ(y);
  if (tx == ty) switch(tx)
  {
    case t_INT: return mulii(x,y);
    case t_REAL: return mulrr(x,y);
    case t_INTMOD: { GEN X = gel(x,1), Y = gel(y,1);
      z = cgetg(3,t_INTMOD);
      if (X==Y || equalii(X,Y))
        return mul_intmod_same(z, X, gel(x,2), gel(y,2));
      gel(z,1) = gcdii(X,Y);
      warn_coercion(X,Y,gel(z,1));
      av = avma; p1 = mulii(gel(x,2),gel(y,2));
      gel(z,2) = gc_INT(av, remii(p1, gel(z,1))); return z;
    }
    case t_FRAC:
    {
      GEN x1 = gel(x,1), x2 = gel(x,2);
      GEN y1 = gel(y,1), y2 = gel(y,2);
      z=cgetg(3,t_FRAC);
      p1 = gcdii(x1, y2);
      if (!equali1(p1)) { x1 = diviiexact(x1,p1); y2 = diviiexact(y2,p1); }
      p1 = gcdii(x2, y1);
      if (!equali1(p1)) { x2 = diviiexact(x2,p1); y1 = diviiexact(y1,p1); }
      tetpil = avma;
      gel(z,2) = mulii(x2,y2);
      gel(z,1) = mulii(x1,y1);
      fix_frac_if_int_GC(z,tetpil); return z;
    }
    case t_COMPLEX: return mulcc(x, y);
    case t_PADIC: return mulpp(x, y);
    case t_QUAD:
      if (!ZX_equal(gel(x,1), gel(y,1))) pari_err_OP("*",x,y);
      return mulqq(x, y);
    case t_FFELT: return FF_mul(x, y);
    case t_POLMOD:
      if (RgX_equal_var(gel(x,1), gel(y,1)))
        return mul_polmod_same(gel(x,1), gel(x,2), gel(y,2));
      return mul_polmod(gel(x,1), gel(y,1), gel(x,2), gel(y,2));
    case t_POL:
      vx = varn(x);
      vy = varn(y);
      if (vx != vy) {
        if (varncmp(vx, vy) < 0) return RgX_Rg_mul(x, y);
        else                     return RgX_Rg_mul(y, x);
      }
      return RgX_mul(x, y);

    case t_SER:
    {
      long e;
      vx = varn(x);
      vy = varn(y);
      if (vx != vy) {
        if (varncmp(vx, vy) < 0) return mul_ser_scal(x, y);
        return mul_ser_scal(y, x);
      }
      e = valser(x) + valser(y);
      lx = minss(lg(x), lg(y));
      if (lx == 2) return zeroser(vx, e);
      /* Must handle the case of exact zeros here. If x or y is t^e (z+O(t))
       * where z is an exact zero giving type information, then its valser is
       * v+1 and their product has the same shape but we mustn't call
       * normalizeser() since the result is already normalized (see "dangerous
       * case" there). It would add 1 to the valuation again.
       *
       * But x,y may be zero divisors, Mod(2,4) + O(t) say, and the
       * product again has the above shape but this time we must normalize.
       * There is no way to distinguish between the two situations in
       * pol2ser() from the product of the polynomial parts only */
      if (lx == 3)
      {
        long s;
        GEN c;
        z = cgetg(3, t_SER); c = gmul(gel(x,2), gel(y,2));
        s = !gequal0(c);
        if (!s && signe(x) && signe(y) && isexactzero(c)) e++;
        z[1] = evalsigne(s) | evalvarn(vx) | evalvalser(e);
        gel(z,2) = c; return z;
      }
      av = avma;
      x = ser2pol_i(x, lx);
      y = ser2pol_i(y, lx);
      y = RgXn_mul(x, y, lx-2);
      return gc_GEN(av, pol2ser(y, lx, e));
    }
    case t_VEC:
      if (!is_ext_qfr(x) || !is_ext_qfr(y)) pari_err_TYPE2("*",x,y);
    /* fall through, handle extended t_QFB */
    case t_QFB: return qfbcomp(x,y);
    case t_RFRAC: return mul_rfrac(gel(x,1),gel(x,2), gel(y,1),gel(y,2));
    case t_MAT: return RgM_mul(x, y);

    case t_VECSMALL: /* multiply as permutation. cf perm_mul */
      z = cgetg_copy(x, &l);
      if (l != lg(y)) break;
      for (i=1; i<l; i++)
      {
        long yi = y[i];
        if (yi < 1 || yi >= l) pari_err_TYPE2("*",x,y);
        z[i] = x[yi];
      }
      return z;

    default:
      pari_err_TYPE2("*",x,y);
  }
  /* tx != ty */
  if (is_const_t(ty) && is_const_t(tx))  {
    if (tx > ty) { swap(x,y); lswap(tx,ty); }
    switch(tx) {
    case t_INT:
      switch(ty)
      {
        case t_REAL: return signe(x)? mulir(x,y): gen_0;
        case t_INTMOD:
          z = cgetg(3, t_INTMOD);
          return mul_intmod_same(z, gel(y,1), gel(y,2), modii(x, gel(y,1)));
        case t_FRAC:
          if (!signe(x)) return gen_0;
          z=cgetg(3,t_FRAC);
          p1 = gcdii(x,gel(y,2));
          if (equali1(p1))
          {
            set_avma((pari_sp)z);
            gel(z,2) = icopy(gel(y,2));
            gel(z,1) = mulii(gel(y,1), x);
          }
          else
          {
            x = diviiexact(x,p1); tetpil = avma;
            gel(z,2) = diviiexact(gel(y,2), p1);
            gel(z,1) = mulii(gel(y,1), x);
            fix_frac_if_int_GC(z,tetpil);
          }
          return z;
        case t_COMPLEX: return signe(x)? mulRc(x, y): gen_0;
        case t_PADIC: return signe(x)? mulTp(x, y): gen_0;
        case t_QUAD: return mulRq(x,y);
        case t_FFELT: return FF_Z_mul(y,x);
      }

    case t_REAL:
      switch(ty)
      {
        case t_FRAC: return mulrfrac(x, y);
        case t_COMPLEX: return mulRc(x, y);
        case t_QUAD: return mulqf(y, x, realprec(x));
        default: pari_err_TYPE2("*",x,y);
      }

    case t_INTMOD:
      switch(ty)
      {
        case t_FRAC: { GEN X = gel(x,1);
          z = cgetg(3, t_INTMOD); p1 = Fp_mul(gel(y,1), gel(x,2), X);
          return div_intmod_same(z, X, p1, remii(gel(y,2), X));
        }
        case t_COMPLEX: return mulRc(x,y);
        case t_PADIC: { GEN X = gel(x,1);
          z = cgetg(3, t_INTMOD);
          return mul_intmod_same(z, X, gel(x,2), padic_to_Fp(y, X));
        }
        case t_QUAD: return mulRq(x, y);
        case t_FFELT:
          if (!equalii(gel(x,1),FF_p_i(y)))
            pari_err_OP("*",x,y);
          return FF_Z_mul(y,gel(x,2));
      }

    case t_FRAC:
      switch(ty)
      {
        case t_COMPLEX: return mulRc(x, y);
        case t_PADIC: return signe(gel(x,1))? mulTp(x, y): gen_0;
        case t_QUAD:  return mulRq(x, y);
        case t_FFELT: return FF_Z_Z_muldiv(y, gel(x,1),gel(x,2));
      }

    case t_FFELT:
      pari_err_TYPE2("*",x,y);

    case t_COMPLEX:
      switch(ty)
      {
        case t_PADIC:
          return Zp_nosquare_m1(padic_p(y))? mulRc(y, x): mulTp(x, y);
        case t_QUAD:
          lx = precision(x); if (!lx) pari_err_OP("*",x,y);
          return mulqf(y, x, lx);
      }

    case t_PADIC: /* ty == t_QUAD */
      return (kro_quad(y,padic_p(x))== -1)? mulRq(x, y): mulTp(y, x);
    }
  }

  if (is_matvec_t(ty)) switch(tx)
  {
    case t_VEC:
      switch(ty) {
        case t_COL: return RgV_RgC_mul(x,y);
        case t_MAT: return RgV_RgM_mul(x,y);
      }
      break;
    case t_COL:
      switch(ty) {
        case t_VEC: return RgC_RgV_mul(x,y);
        case t_MAT: return RgC_RgM_mul(x,y);
      }
      break;
    case t_MAT:
      switch(ty) {
        case t_VEC: return RgM_RgV_mul(x,y);
        case t_COL: return RgM_RgC_mul(x,y);
      }
    default:
      if (is_noncalc_t(tx)) pari_err_TYPE2( "*",x,y); /* necessary if ly = 1 */
      return mul_self_scal(y, x);
  }
  if (is_matvec_t(tx))
  {
    if (is_noncalc_t(ty)) pari_err_TYPE2( "*",x,y); /* necessary if lx = 1 */
    return mul_self_scal(x, y);
  }
  if (tx > ty) { swap(x,y); lswap(tx,ty); }
  /* tx < ty, !ismatvec(x and y) */

  if (ty == t_POLMOD) /* is_const_t(tx) in this case */
    return mul_polmod_scal(gel(y,1), gel(y,2), x);
  if (is_scalar_t(tx)) {
    if (tx == t_POLMOD) {
      vx = varn(gel(x,1));
      vy = gvar(y);
      if (vx != vy) {
        if (varncmp(vx,vy) > 0) return mul_scal(y, x, ty);
        return mul_polmod_scal(gel(x,1), gel(x,2), y);
      }
      /* error if ty == t_SER */
      av = avma; y = gmod(y, gel(x,1));
      return gc_upto(av, mul_polmod_same(gel(x,1), gel(x,2), y));
    }
    return mul_scal(y, x, ty);
  }

  /* x and y are not scalars, nor matvec */
  vx = gvar(x);
  vy = gvar(y);
  if (vx != vy) /* x or y is treated as a scalar */
    return (varncmp(vx, vy) < 0)? mul_scal(x, y, tx)
                                : mul_scal(y, x, ty);
  /* vx = vy */
  switch(tx)
  {
    case t_POL:
      switch (ty)
      {
        case t_SER:
        {
          long e, E;
          av = avma; e = RgX_valrem(x, &x);
          if (e == LONG_MAX)
            return gc_upto(av, gmul(Rg_get_0(x), Rg_get_0(y)));
          ly = lg(y); E = e + valser(y);
          if (ly == 2) { set_avma(av); return zeroser(vx, E); }
          if (ly == 3)
          {
            long s;
            GEN c;
            z = cgetg(3, t_SER); c = gmul(gel(x,2), gel(y,2));
            s = !gequal0(c);
            if (!s && signe(x) && signe(y) && isexactzero(c)) E++;
            z[1] = evalsigne(s) | evalvarn(vx) | evalvalser(E);
            gel(z,2) = c; return gc_upto(av, z);
          }
          if (degpol(x))
          {
            x = RgXn_mul(x, ser2pol_i(y, ly), ly-2);
            return gc_GEN(av, pol2ser(x, ly, E));
          }
          /* take advantage of x = c*t^e */
          set_avma(av); y = mul_ser_scal(y, gel(x,2));
          setvalser(y, e + valser(y)); return y;
        }

        case t_RFRAC: return mul_rfrac_scal(gel(y,1),gel(y,2), x);
      }
      break;

    case t_SER:
      switch (ty)
      {
        case t_RFRAC:
          av = avma;
          return gc_upto(av, gdiv(gmul(gel(y,1),x), gel(y,2)));
      }
      break;
  }
  pari_err_TYPE2("*",x,y);
  return NULL; /* LCOV_EXCL_LINE */
}

/* return a nonnormalized result */
GEN
sqr_ser_part(GEN x, long l1, long l2)
{
  long i, j, l;
  pari_sp av;
  GEN Z, z, p1, p2;
  long mi;
  if (l2 < l1) return zeroser(varn(x), 2*valser(x));
  p2 = cgetg(l2+2, t_VECSMALL)+1; /* left on stack on exit */
  Z = cgetg(l2-l1+3, t_SER);
  Z[1] = evalvalser(2*valser(x)) | evalvarn(varn(x));
  z = Z + 2-l1;
  x += 2; mi = 0;
  for (i=0; i<l1; i++)
  {
    p2[i] = !isrationalzero(gel(x,i)); if (p2[i]) mi = i;
  }

  for (i=l1; i<=l2; i++)
  {
    p2[i] = !isrationalzero(gel(x,i)); if (p2[i]) mi = i;
    p1=gen_0; av=avma; l=((i+1)>>1) - 1;
    for (j=i-mi; j<=minss(l,mi); j++)
      if (p2[j] && p2[i-j]) p1 = gadd(p1, gmul(gel(x,j),gel(x,i-j)));
    p1 = gshift(p1,1);
    if ((i&1) == 0 && p2[i>>1])
      p1 = gadd(p1, gsqr(gel(x,i>>1)));
    gel(z,i) = gc_upto(av,p1);
  }
  return Z;
}

/* (u + v X)^2 mod (X^2 + bX + c), b = 0 or -1
 * = u^2 - c v^2 + (2uv - b v^2) X */
static GEN
sqrq(GEN x)
{
  GEN T = gel(x,1), c = gel(T,2), b = gel(T,3);
  GEN u = gel(x,2), v = gel(x,3), U, V, E, F, s, z;
  pari_sp av, av2;

  z = cgetg(4, t_QUAD), gel(z,1) = ZX_copy(T); av = avma;
  U = gsqr(u);
  V = gsqr(v); s = gmul(c, V);
  E = gmul(u, v);
  F = signe(b)? gadd(E, V): E; /* u v - b v^2 */
  av2 = avma;
  gel(z,2) = gsub(U, s);
  gel(z,3) = gadd(E, F);
  gc_slice_unsafe(av, av2, z+2, 2); return z;
}

GEN
gsqr(GEN x)
{
  long i, lx;
  pari_sp av, tetpil;
  GEN z, p1, p2, p3;

  switch(typ(x))
  {
    case t_INT: return sqri(x);
    case t_REAL: return sqrr(x);
    case t_INTMOD: { GEN X = gel(x,1);
      z = cgetg(3,t_INTMOD);
      gel(z,2) = gc_INT((pari_sp)z, remii(sqri(gel(x,2)), X));
      gel(z,1) = icopy(X); return z;
    }
    case t_FRAC: return sqrfrac(x);

    case t_COMPLEX:
      if (isintzero(gel(x,1))) {
        av = avma;
        return gc_upto(av, gneg(gsqr(gel(x,2))));
      }
      z = cgetg(3,t_COMPLEX); av = avma;
      p1 = gadd(gel(x,1),gel(x,2));
      p2 = gsub(gel(x,1), gel(x,2));
      p3 = gmul(gel(x,1),gel(x,2));
      tetpil = avma;
      gel(z,1) = gmul(p1,p2);
      gel(z,2) = gshift(p3,1); gc_slice_unsafe(av,tetpil,z+1,2); return z;

    case t_PADIC:
    {
      GEN u = padic_u(x), p = padic_p(x), pd = padic_pd(x);
      long v2 = 2*valp(x), d = precp(x);
      if (!signe(u)) { x = gcopy(x); setvalp(x, v2); return x; }
      if (!absequaliu(p, 2))
        retmkpadic(Fp_sqr(u, pd), icopy(p), icopy(pd), v2, d);
      /* p = 2*/
      if (d == 1) /* (1 + O(2))^2 = 1 + O(2^3) */
        retmkpadic(gen_1, gen_2, utoipos(8), v2, 3);
      retmkpadic(remi2n(sqri(u), d + 1), gen_2, int2n(d + 1), v2, d + 1);
    }
    case t_QUAD: return sqrq(x);

    case t_POLMOD: return sqr_polmod(gel(x,1), gel(x,2));

    case t_FFELT: return FF_sqr(x);

    case t_POL: return RgX_sqr(x);

    case t_SER:
      lx = lg(x);
      if (ser_isexactzero(x)) {
        GEN z = gcopy(x);
        setvalser(z, 2*valser(x));
        return z;
      }
      if (lx < 40)
        return normalizeser( sqr_ser_part(x, 0, lx-3) );
      else
      {
        pari_sp av = avma;
        long v = 2 * valser(x);
        x = ser2pol_i(x, lx);
        x = RgXn_sqr(x, lx-2);
        return gc_GEN(av, pol2ser(x, lx, v));
      }

    case t_RFRAC: z = cgetg(3,t_RFRAC);
      gel(z,1) = gsqr(gel(x,1));
      gel(z,2) = gsqr(gel(x,2)); return z;

    case t_MAT: return RgM_sqr(x);
    case t_VEC: if (!is_ext_qfr(x)) pari_err_TYPE2("*",x,x);
    /* fall through handle extended t_QFB */
    case t_QFB: return qfbsqr(x);
    case t_VECSMALL:
      z = cgetg_copy(x, &lx);
      for (i=1; i<lx; i++)
      {
        long xi = x[i];
        if (xi < 1 || xi >= lx) pari_err_TYPE2("*",x,x);
        z[i] = x[xi];
      }
      return z;
  }
  pari_err_TYPE2("*",x,x);
  return NULL; /* LCOV_EXCL_LINE */
}

/********************************************************************/
/**                                                                **/
/**                           DIVISION                             **/
/**                                                                **/
/********************************************************************/
static GEN
div_rfrac_scal(GEN x, GEN y)
{
  pari_sp av = avma;
  GEN d = rfrac_denom_mul_scal(gel(x,2), y);
  return gc_upto(av, gred_rfrac_simple(gel(x,1), d));
}
static GEN
div_scal_rfrac(GEN x, GEN y)
{
  GEN y1 = gel(y,1), y2 = gel(y,2);
  if (typ(y1) == t_POL && varn(y2) == varn(y1))
  {
    if (degpol(y1))
    {
      pari_sp av = avma;
      GEN _1 = Rg_get_1(x);
      if (base_change(_1)) y1 = gmul(y1, _1);
      return gc_upto(av, gred_rfrac_simple(gmul(x, y2), y1));
    }
    y1 = gel(y1,2);
  }
  return RgX_Rg_mul(y2, gdiv(x,y1));
}
static GEN
div_rfrac(GEN x, GEN y)
{ return mul_rfrac(gel(x,1),gel(x,2), gel(y,2),gel(y,1)); }

/* x != 0 */
static GEN
div_ser_scal(GEN x, GEN t)
{
  if (ser_isexactzero(x))
  {
    GEN z = scalarser(lg(x) == 2? Rg_get_0(t): gdiv(gel(x,2), t), varn(x), 1);
    setvalser(z, valser(x)); return z;
  }
  pari_APPLY_ser(gdiv(gel(x,i), t));
}
GEN
ser_normalize(GEN x)
{
  long i, lx = lg(x);
  GEN c, z;
  if (lx == 2) return x;
  c = gel(x,2); if (gequal1(c)) return x;
  z = cgetg(lx, t_SER); z[1] = x[1]; gel(z,2) = gen_1;
  for (i=3; i<lx; i++) gel(z,i) = gdiv(gel(x,i),c);
  return z;
}

/* y != 0 */
static GEN
div_T_scal(GEN x, GEN y, long tx) {
  switch(tx)
  {
    case t_POL: return RgX_Rg_div(x, y);
    case t_SER: return div_ser_scal(x, y);
    case t_RFRAC: return div_rfrac_scal(x,y);
  }
  pari_err_TYPE2("/",x,y);
  return NULL; /* LCOV_EXCL_LINE */
}

static GEN
div_scal_pol(GEN x, GEN y) {
  long ly = lg(y);
  pari_sp av;
  GEN _1;
  if (ly == 3) return scalarpol(gdiv(x,gel(y,2)), varn(y));
  if (isrationalzero(x)) return zeropol(varn(y));
  av = avma;
  _1 = Rg_get_1(x); if (base_change(_1)) y = gmul(y, _1);
  return gc_upto(av, gred_rfrac_simple(x,y));
}
static GEN
div_scal_ser(GEN x, GEN y)
{
  pari_sp av = avma;
  GEN _1 = Rg_get_1(x);
  if (base_change(_1)) y = gmul(y, _1);
  return gc_upto(av, gmul(x, ser_inv(y)));
}
static GEN
div_scal_T(GEN x, GEN y, long ty) {
  switch(ty)
  {
    case t_POL: return div_scal_pol(x, y);
    case t_SER: return div_scal_ser(x, y);
    case t_RFRAC: return div_scal_rfrac(x, y);
  }
  pari_err_TYPE2("/",x,y);
  return NULL; /* LCOV_EXCL_LINE */
}

/* assume tx = ty = t_SER, same variable vx */
static GEN
div_ser(GEN x, GEN y, long vx)
{
  long e, v = valser(x) - valser(y), lx = lg(x), ly = lg(y);
  GEN y0 = y, z;
  pari_sp av = avma;

  if (!signe(y)) pari_err_INV("div_ser", y);
  if (ser_isexactzero(x))
  {
    if (lx == 2) return zeroser(vx, v);
    z = scalarser(gmul(gel(x,2),Rg_get_0(y)), varn(x), 1);
    setvalser(z, v); return z;
  }
  if (lx < ly) ly = lx;
  y = ser2pol_i_normalize(y, ly, &e);
  if (e)
  {
    pari_warn(warner,"normalizing a series with 0 leading term");
    ly -= e; v -= e; if (ly <= 2) pari_err_INV("div_ser", y0);
  }
  if (ly == 3)
  {
    z = cgetg(3, t_SER);
    z[1] = evalsigne(1) | evalvalser(v) | evalvarn(vx);
    gel(z,2) = gdiv(gel(x,2), gel(y,2));
    if (gequal0(gel(z,2))) setsigne(z, 0); /* can happen: Mod(1,2)/Mod(1,3) */
    return gc_upto(av, z);
  }
  x = ser2pol_i(x, ly);
  y = RgXn_div_i(x, y, ly-2);
  return gc_GEN(av, pol2ser(y, ly, v));
}
/* x,y compatible PADIC */
static GEN
divpp(GEN x, GEN y)
{
  GEN M, ux = padic_u(x), uy = padic_u(y), p = padic_p(x);
  long a = precp(x), b = precp(y), v = valp(x) - valp(y);

  if (!signe(uy)) pari_err_INV("divpp",y);
  if (!signe(ux)) return zeropadic(p, v);
  if (a > b) M = padic_pd(y); else { M = padic_pd(x); b = a; }
  retmkpadic(Fp_div(ux, uy, M), icopy(padic_p(x)), icopy(M), v, b);
}
static GEN
div_polmod_same(GEN T, GEN x, GEN y)
{
  long v = varn(T);
  GEN a, z = cgetg(3, t_POLMOD);
  gel(z,1) = RgX_copy(T);
  if (typ(y) != t_POL || varn(y) != v || lg(y) <= 3)
    a = gdiv(x, y);
  else if (typ(x) != t_POL || varn(x) != v || lg(x) <= 3)
  {
    pari_sp av = avma;
    a = gc_upto(av, gmul(x, RgXQ_inv(y, T)));
  }
  else if (degpol(T) == 2 && isint1(gel(T,4))) /* quadratic fields */
  {
    pari_sp av = avma;
    a = quad_polmod_mul(T, x, quad_polmod_conj(y, T));
    a = RgX_Rg_div(a, quad_polmod_norm(y, T));
    a = gc_upto(av, a);
  }
  else
  {
    pari_sp av = avma;
    a = RgXQ_mul(x, ginvmod(y, gel(z,1)), gel(z,1));
    a = gc_upto(av, a);
  }
  gel(z,2) = a; return z;
}
GEN
gdiv(GEN x, GEN y)
{
  long tx = typ(x), ty = typ(y), lx, ly, vx, vy, i;
  pari_sp av, tetpil;
  GEN z, p1;

  if (tx == ty) switch(tx)
  {
    case t_INT:
      return Qdivii(x,y);

    case t_REAL: return divrr(x,y);
    case t_INTMOD: { GEN X = gel(x,1), Y = gel(y,1);
      z = cgetg(3,t_INTMOD);
      if (X==Y || equalii(X,Y))
        return div_intmod_same(z, X, gel(x,2), gel(y,2));
      gel(z,1) = gcdii(X,Y);
      warn_coercion(X,Y,gel(z,1));
      av = avma; p1 = mulii(gel(x,2), Fp_inv(gel(y,2), gel(z,1)));
      gel(z,2) = gc_INT(av, remii(p1, gel(z,1))); return z;
    }
    case t_FRAC: {
      GEN x1 = gel(x,1), x2 = gel(x,2);
      GEN y1 = gel(y,1), y2 = gel(y,2);
      z = cgetg(3, t_FRAC);
      p1 = gcdii(x1, y1);
      if (!equali1(p1)) { x1 = diviiexact(x1,p1); y1 = diviiexact(y1,p1); }
      p1 = gcdii(x2, y2);
      if (!equali1(p1)) { x2 = diviiexact(x2,p1); y2 = diviiexact(y2,p1); }
      tetpil = avma;
      gel(z,2) = mulii(x2,y1);
      gel(z,1) = mulii(x1,y2);
      normalize_frac(z);
      fix_frac_if_int_GC(z,tetpil);
      return z;
    }
    case t_COMPLEX:
      if (isintzero(gel(y,1)))
      {
        y = gel(y,2);
        if (isintzero(gel(x,1))) return gdiv(gel(x,2), y);
        z = cgetg(3,t_COMPLEX);
        gel(z,1) = gdiv(gel(x,2), y);
        av = avma;
        gel(z,2) = gc_upto(av, gneg(gdiv(gel(x,1), y)));
        return z;
      }
      av = avma;
      return gc_upto(av, gdiv(mulcc(x, conj_i(y)), cxnorm(y)));

    case t_PADIC:
      if (!equalii(padic_p(x), padic_p(y))) pari_err_OP("/",x,y);
      return divpp(x, y);

    case t_QUAD:
      if (!ZX_equal(gel(x,1),gel(y,1))) pari_err_OP("/",x,y);
      av = avma;
      return gc_upto(av, gdiv(mulqq(x, conj_i(y)), quadnorm(y)));

    case t_FFELT: return FF_div(x,y);

    case t_POLMOD:
      if (RgX_equal_var(gel(x,1), gel(y,1)))
        z = div_polmod_same(gel(x,1), gel(x,2), gel(y,2));
      else {
        av = avma;
        z = gc_upto(av, gmul(x, ginv(y)));
      }
      return z;

    case t_POL:
      vx = varn(x);
      vy = varn(y);
      if (vx != vy) {
        if (varncmp(vx, vy) < 0) return RgX_Rg_div(x, y);
                            else return div_scal_pol(x, y);
      }
      if (!signe(y)) pari_err_INV("gdiv",y);
      if (lg(y) == 3) return RgX_Rg_div(x,gel(y,2));
      av = avma;
      return gc_upto(av, gred_rfrac(x,y));

    case t_SER:
      vx = varn(x);
      vy = varn(y);
      if (vx != vy) {
        if (varncmp(vx, vy) < 0)
        {
          if (!signe(y)) pari_err_INV("gdiv",y);
          return div_ser_scal(x, y);
        }
        return div_scal_ser(x, y);
      }
      return div_ser(x, y, vx);
    case t_RFRAC:
      vx = varn(gel(x,2));
      vy = varn(gel(y,2));
      if (vx != vy) {
        if (varncmp(vx, vy) < 0) return div_rfrac_scal(x, y);
                            else return div_scal_rfrac(x, y);
      }
      return div_rfrac(x,y);

    case t_VEC: /* handle extended t_QFB */
    case t_QFB: av = avma; return gc_upto(av, qfbcomp(x, ginv(y)));

    case t_MAT:
      p1 = RgM_div(x,y);
      if (!p1) pari_err_INV("gdiv",y);
      return p1;

    default: pari_err_TYPE2("/",x,y);
  }

  if (tx==t_INT && is_const_t(ty)) /* optimized for speed */
  {
    long s = signe(x);
    if (!s) {
      if (gequal0(y)) pari_err_INV("gdiv",y);
      switch (ty)
      {
      default: return gen_0;
      case t_INTMOD:
        z = cgetg(3,t_INTMOD);
        gel(z,1) = icopy(gel(y,1));
        gel(z,2) = gen_0; return z;
      case t_FFELT: return FF_zero(y);
      }
    }
    if (is_pm1(x)) {
      if (s > 0) return ginv(y);
      av = avma; return gc_upto(av, ginv(gneg(y)));
    }
    switch(ty)
    {
      case t_REAL: return divir(x,y);
      case t_INTMOD:
        z = cgetg(3, t_INTMOD);
        return div_intmod_same(z, gel(y,1), modii(x, gel(y,1)), gel(y,2));
      case t_FRAC:
        z = cgetg(3,t_FRAC); p1 = gcdii(x,gel(y,1));
        if (equali1(p1))
        {
          set_avma((pari_sp)z);
          gel(z,2) = icopy(gel(y,1));
          gel(z,1) = mulii(gel(y,2), x);
          normalize_frac(z);
          fix_frac_if_int(z);
        }
        else
        {
          x = diviiexact(x,p1); tetpil = avma;
          gel(z,2) = diviiexact(gel(y,1), p1);
          gel(z,1) = mulii(gel(y,2), x);
          normalize_frac(z);
          fix_frac_if_int_GC(z,tetpil);
        }
        return z;

      case t_FFELT: return Z_FF_div(x,y);
      case t_COMPLEX: return divRc(x,y);
      case t_PADIC: return divTp(x, y);
      case t_QUAD: return divRq(x,y);
    }
  }
  if (gequal0(y))
  {
    if (is_matvec_t(tx) && lg(x) == 1) return gcopy(x);
    if (ty != t_MAT) pari_err_INV("gdiv",y);
  }

  if (is_const_t(tx) && is_const_t(ty)) switch(tx)
  {
    case t_REAL:
      switch(ty)
      {
        case t_INT: return divri(x,y);
        case t_FRAC:
          av = avma; z = divri(mulri(x,gel(y,2)), gel(y,1));
          return gc_leaf(av, z);
        case t_COMPLEX: return divRc(x, y);
        case t_QUAD: return divfq(x, y, realprec(x));
        default: pari_err_TYPE2("/",x,y);
      }

    case t_INTMOD:
      switch(ty)
      {
        case t_INT:
          z = cgetg(3, t_INTMOD);
          return div_intmod_same(z, gel(x,1), gel(x,2), modii(y, gel(x,1)));
        case t_FRAC: { GEN X = gel(x,1);
          z = cgetg(3,t_INTMOD); p1 = remii(mulii(gel(y,2), gel(x,2)), X);
          return div_intmod_same(z, X, p1, modii(gel(y,1), X));
        }
        case t_FFELT:
          if (!equalii(gel(x,1),FF_p_i(y)))
            pari_err_OP("/",x,y);
          return Z_FF_div(gel(x,2),y);

        case t_COMPLEX: return divRc(x,y);
        case t_QUAD: return divRq(x,y);

        case t_PADIC: { GEN X = gel(x,1);
          z = cgetg(3, t_INTMOD);
          return div_intmod_same(z, X, gel(x,2), padic_to_Fp(y, X));
        }
        case t_REAL: pari_err_TYPE2("/",x,y);
      }

    case t_FRAC:
      switch(ty)
      {
        case t_INT: z = cgetg(3, t_FRAC);
        p1 = gcdii(y,gel(x,1));
        if (equali1(p1))
        {
          set_avma((pari_sp)z); tetpil = 0;
          gel(z,1) = icopy(gel(x,1));
        }
        else
        {
          y = diviiexact(y,p1); tetpil = avma;
          gel(z,1) = diviiexact(gel(x,1), p1);
        }
        gel(z,2) = mulii(gel(x,2),y);
        normalize_frac(z);
        if (tetpil) fix_frac_if_int_GC(z,tetpil);
        return z;

        case t_REAL:
          av = avma;
          return gc_leaf(av, divir(gel(x,1), mulri(y,gel(x,2))));

        case t_INTMOD: { GEN Y = gel(y,1);
          z = cgetg(3,t_INTMOD); p1 = remii(mulii(gel(y,2),gel(x,2)), Y);
          return div_intmod_same(z, Y, modii(gel(x,1), Y), p1);
        }

        case t_FFELT: av=avma;
          return gc_upto(av,Z_FF_div(gel(x,1),FF_Z_mul(y,gel(x,2))));

        case t_COMPLEX: return divRc(x, y);

        case t_PADIC:
          if (!signe(gel(x,1))) return gen_0;
          return divTp(x, y);

        case t_QUAD: return divRq(x, y);
      }

    case t_FFELT:
      switch (ty)
      {
        case t_INT: return FF_Z_Z_muldiv(x,gen_1,y);
        case t_FRAC: return FF_Z_Z_muldiv(x,gel(y,2),gel(y,1));
        case t_INTMOD:
          if (!equalii(gel(y,1),FF_p_i(x)))
            pari_err_OP("/",x,y);
          return FF_Z_Z_muldiv(x,gen_1,gel(y,2));
        default:
        pari_err_TYPE2("/",x,y);
      }
      break;

    case t_COMPLEX:
      switch(ty)
      {
        case t_INT: case t_REAL: case t_FRAC: return divcR(x,y);
        case t_INTMOD: return mulRc(ginv(y), x);
        case t_PADIC:
          return Zp_nosquare_m1(padic_p(y))? divcR(x,y): divTp(x, y);
        case t_QUAD:
          lx = precision(x); if (!lx) pari_err_OP("/",x,y);
          return divfq(x, y, lx);
      }

    case t_PADIC:
      switch(ty)
      {
        case t_INT: case t_FRAC: { GEN p = padic_p(x);
          return signe(padic_u(x))? divpT(x, y)
                                  : zeropadic(p, valp(x) - Q_pval(y,p));
        }
        case t_INTMOD: { GEN Y = gel(y,1);
          z = cgetg(3, t_INTMOD);
          return div_intmod_same(z, Y, padic_to_Fp(x, Y), gel(y,2));
        }
        case t_COMPLEX: return divRc(x,y);
        case t_QUAD: return divRq(x,y);
        case t_REAL: pari_err_TYPE2("/",x,y);
      }

    case t_QUAD:
      switch (ty)
      {
        case t_INT: case t_INTMOD: case t_FRAC:
          z = cgetg(4,t_QUAD);
          gel(z,1) = ZX_copy(gel(x,1));
          gel(z,2) = gdiv(gel(x,2), y);
          gel(z,3) = gdiv(gel(x,3), y); return z;
        case t_REAL: return divqf(x, y, realprec(y));
        case t_PADIC: return divTp(x, y);
        case t_COMPLEX:
          ly = precision(y); if (!ly) pari_err_OP("/",x,y);
          return divqf(x, y, ly);
      }
  }
  switch(ty) {
    case t_REAL: case t_INTMOD: case t_PADIC: case t_POLMOD:
      av = avma; return gc_upto(av, gmul(x, ginv(y)));
    case t_MAT:
      av = avma; p1 = RgM_inv(y);
      if (!p1) pari_err_INV("gdiv",y);
      return gc_upto(av, gmul(x, p1));
    case t_VEC: case t_COL:
    case t_LIST: case t_STR: case t_VECSMALL: case t_CLOSURE:
      pari_err_TYPE2("/",x,y);
  }
  switch(tx) {
    case t_VEC: case t_COL: case t_MAT:
      pari_APPLY_same(gdiv(gel(x,i),y));
    case t_LIST: case t_STR: case t_VECSMALL: case t_CLOSURE:
      pari_err_TYPE2("/",x,y);
  }

  vy = gvar(y);
  if (tx == t_POLMOD) { GEN X = gel(x,1);
    vx = varn(X);
    if (vx != vy) {
      if (varncmp(vx, vy) > 0) return div_scal_T(x, y, ty);
      retmkpolmod(gdiv(gel(x,2), y), RgX_copy(X));
    }
    /* y is POL, SER or RFRAC */
    av = avma;
    switch(ty)
    {
      case t_RFRAC: y = gmod(ginv(y), X); break;
      default: y = ginvmod(gmod(y,X), X);
    }
    return gc_upto(av, mul_polmod_same(X, gel(x,2), y));
  }
  /* x and y are not both is_scalar_t. If one of them is scalar, it's not a
   * POLMOD (done already), hence its variable is NO_VARIABLE. If the other has
   * variable NO_VARIABLE, then the operation is incorrect */
  vx = gvar(x);
  if (vx != vy) { /* includes cases where one is scalar */
    if (varncmp(vx, vy) < 0) return div_T_scal(x, y, tx);
                        else return div_scal_T(x, y, ty);
  }
  switch(tx)
  {
    case t_POL:
      switch(ty)
      {
        case t_SER:
        {
          GEN y0 = y;
          long v;
          av = avma; v = RgX_valrem(x, &x);
          if (v == LONG_MAX) return gc_upto(av, Rg_get_0(x));
          v -= valser(y); ly = lg(y); /* > 2 */
          y = ser2pol_i_normalize(y, ly, &i);
          if (i)
          {
            pari_warn(warner,"normalizing a series with 0 leading term");
            ly -= i; v -= i; if (ly <= 2) pari_err_INV("gdiv", y0);
          }
          x = RgXn_div(x, y, ly-2);
          return gc_GEN(av, pol2ser(x, ly, v));
        }

        case t_RFRAC:
        {
          GEN y1 = gel(y,1), y2 = gel(y,2);
          if (typ(y1) == t_POL && varn(y1) == vx)
            return mul_rfrac_scal(y2, y1, x);
          av = avma;
          return gc_upto(av, RgX_Rg_div(RgX_mul(y2, x), y1));
        }
      }
      break;

    case t_SER:
      switch(ty)
      {
        case t_POL:
        {
          long e = valser(x);
          lx = lg(x);
          if (lx == 2) return zeroser(vx, e - RgX_val(y));
          av = avma; e -= RgX_valrem_inexact(y, &y);
          if (lx == 3)
          {
            GEN c;
            z = cgetg(3, t_SER); c = gdiv(gel(x,2), gel(y,2));
            z[1] = evalsigne(!gequal0(c)) | evalvarn(vx) | evalvalser(e);
            gel(z,2) = c; return z;
          }
          x = ser2pol_i(x, lx);
          x = RgXn_div(x, y, lx - 2);
          return gc_GEN(av, pol2ser(x, lx, e));
        }
        case t_RFRAC:
          av = avma;
          return gc_upto(av, gdiv(gmul(x,gel(y,2)), gel(y,1)));
      }
      break;

    case t_RFRAC:
      switch(ty)
      {
        case t_POL: return div_rfrac_pol(gel(x,1),gel(x,2), y);
        case t_SER:
          av = avma;
          return gc_upto(av, gdiv(gel(x,1), gmul(gel(x,2), y)));
      }
      break;
  }
  pari_err_TYPE2("/",x,y);
  return NULL; /* LCOV_EXCL_LINE */
}

/********************************************************************/
/**                                                                **/
/**                     SIMPLE MULTIPLICATION                      **/
/**                                                                **/
/********************************************************************/
GEN
gmulsg(long s, GEN x)
{
  pari_sp av;
  long i;
  GEN z;

  switch(typ(x))
  {
    case t_INT:  return mulsi(s,x);
    case t_REAL: return s? mulsr(s,x): gen_0; /* gmul semantic */
    case t_INTMOD: { GEN p = gel(x,1);
      z = cgetg(3,t_INTMOD);
      gel(z,2) = gc_INT((pari_sp)z, modii(mulsi(s,gel(x,2)), p));
      gel(z,1) = icopy(p); return z;
    }
    case t_FFELT: return FF_Z_mul(x,stoi(s));
    case t_FRAC:
      if (!s) return gen_0;
      z = cgetg(3,t_FRAC);
      i = labs(s); i = ugcdiu(gel(x,2), i);
      if (i == 1)
      {
        gel(z,2) = icopy(gel(x,2));
        gel(z,1) = mulis(gel(x,1), s);
      }
      else
      {
        gel(z,2) = diviuexact(gel(x,2), (ulong)i);
        gel(z,1) = mulis(gel(x,1), s/i);
        fix_frac_if_int(z);
      }
      return z;

    case t_COMPLEX:
      if (!s) return gen_0;
      z = cgetg(3, t_COMPLEX);
      gel(z,1) = gmulsg(s,gel(x,1));
      gel(z,2) = gmulsg(s,gel(x,2)); return z;

    case t_PADIC:
      if (!s) return gen_0;
      av = avma; return gc_upto(av, mulpp(cvtop2(stoi(s),x), x));

    case t_QUAD: z = cgetg(4, t_QUAD);
      gel(z,1) = ZX_copy(gel(x,1));
      gel(z,2) = gmulsg(s,gel(x,2));
      gel(z,3) = gmulsg(s,gel(x,3)); return z;

    case t_POLMOD:
      retmkpolmod(gmulsg(s,gel(x,2)), RgX_copy(gel(x,1)));

    case t_POL:
      if (!signe(x)) return RgX_copy(x);
      if (!s) return scalarpol(Rg_get_0(x), varn(x));
      pari_APPLY_pol(gmulsg(s,gel(x,i)));

    case t_SER:
      if (ser_isexactzero(x)) return gcopy(x);
      if (!s) return Rg_get_0(x);
      pari_APPLY_ser(gmulsg(s,gel(x,i)));

    case t_RFRAC:
      if (!s) return zeropol(varn(gel(x,2)));
      if (s == 1) return gcopy(x);
      if (s == -1) return gneg(x);
      return mul_rfrac_scal(gel(x,1), gel(x,2), stoi(s));

    case t_VEC: case t_COL: case t_MAT:
      pari_APPLY_same(gmulsg(s,gel(x,i)));
  }
  pari_err_TYPE("gmulsg",x);
  return NULL; /* LCOV_EXCL_LINE */
}

GEN
gmulug(ulong s, GEN x)
{
  pari_sp av;
  long i;
  GEN z;

  switch(typ(x))
  {
    case t_INT:  return mului(s,x);
    case t_REAL: return s? mulur(s,x): gen_0; /* gmul semantic */
    case t_INTMOD: { GEN p = gel(x,1);
      z = cgetg(3,t_INTMOD);
      gel(z,2) = gc_INT((pari_sp)z, modii(mului(s,gel(x,2)), p));
      gel(z,1) = icopy(p); return z;
    }
    case t_FFELT: return FF_Z_mul(x,utoi(s));
    case t_FRAC:
      if (!s) return gen_0;
      z = cgetg(3,t_FRAC);
      i = ugcdiu(gel(x,2), s);
      if (i == 1)
      {
        gel(z,2) = icopy(gel(x,2));
        gel(z,1) = muliu(gel(x,1), s);
      }
      else
      {
        gel(z,2) = diviuexact(gel(x,2), i);
        gel(z,1) = muliu(gel(x,1), s/i);
        fix_frac_if_int(z);
      }
      return z;

    case t_COMPLEX:
      if (!s) return gen_0;
      z = cgetg(3, t_COMPLEX);
      gel(z,1) = gmulug(s,gel(x,1));
      gel(z,2) = gmulug(s,gel(x,2)); return z;

    case t_PADIC:
      if (!s) return gen_0;
      av = avma; return gc_upto(av, mulpp(cvtop2(utoi(s),x), x));

    case t_QUAD: z = cgetg(4, t_QUAD);
      gel(z,1) = ZX_copy(gel(x,1));
      gel(z,2) = gmulug(s,gel(x,2));
      gel(z,3) = gmulug(s,gel(x,3)); return z;

    case t_POLMOD:
      retmkpolmod(gmulug(s,gel(x,2)), RgX_copy(gel(x,1)));

    case t_POL:
      if (!signe(x)) return RgX_copy(x);
      if (!s) return scalarpol(Rg_get_0(x), varn(x));
      pari_APPLY_pol(gmulug(s,gel(x,i)));

    case t_SER:
      if (ser_isexactzero(x)) return gcopy(x);
      if (!s) return Rg_get_0(x);
      pari_APPLY_ser(gmulug(s,gel(x,i)));

    case t_RFRAC:
      if (!s) return zeropol(varn(gel(x,2)));
      if (s == 1) return gcopy(x);
      return mul_rfrac_scal(gel(x,1), gel(x,2), utoi(s));

    case t_VEC: case t_COL: case t_MAT:
      pari_APPLY_same(gmulug(s,gel(x,i)));
  }
  pari_err_TYPE("gmulsg",x);
  return NULL; /* LCOV_EXCL_LINE */
}

/********************************************************************/
/**                                                                **/
/**                       SIMPLE DIVISION                          **/
/**                                                                **/
/********************************************************************/

GEN
gdivgs(GEN x, long s)
{
  long tx = typ(x), i;
  pari_sp av;
  GEN z;

  if (!s)
  {
    if (is_matvec_t(tx) && lg(x) == 1) return gcopy(x);
    pari_err_INV("gdivgs",gen_0);
  }
  switch(tx)
  {
    case t_INT: return Qdivis(x, s);
    case t_REAL: return divrs(x,s);

    case t_INTMOD:
      z = cgetg(3, t_INTMOD);
      return div_intmod_same(z, gel(x,1), gel(x,2), modsi(s, gel(x,1)));

    case t_FFELT: return FF_Z_Z_muldiv(x,gen_1,stoi(s));

    case t_FRAC: z = cgetg(3, t_FRAC);
      i = ugcdiu(gel(x,1), labs(s));
      if (i == 1)
      {
        gel(z,2) = mulsi(s, gel(x,2));
        gel(z,1) = icopy(gel(x,1));
      }
      else
      {
        gel(z,2) = mulsi(s/i, gel(x,2));
        gel(z,1) = divis(gel(x,1), i);
      }
      normalize_frac(z);
      fix_frac_if_int(z); return z;

    case t_COMPLEX: z = cgetg(3, t_COMPLEX);
      gel(z,1) = gdivgs(gel(x,1),s);
      gel(z,2) = gdivgs(gel(x,2),s); return z;

    case t_PADIC: /* divpT */
    {
      GEN p = padic_p(x);
      if (!signe(padic_u(x))) return zeropadic(p, valp(x) - u_pval(s,p));
      av = avma;
      return gc_upto(av, divpp(x, cvtop2(stoi(s),x)));
    }

    case t_QUAD: z = cgetg(4, t_QUAD);
      gel(z,1) = ZX_copy(gel(x,1));
      gel(z,2) = gdivgs(gel(x,2),s);
      gel(z,3) = gdivgs(gel(x,3),s); return z;

    case t_POLMOD:
      retmkpolmod(gdivgs(gel(x,2),s), RgX_copy(gel(x,1)));

    case t_RFRAC:
      if (s == 1) return gcopy(x);
      else if (s == -1) return gneg(x);
      return div_rfrac_scal(x, stoi(s));

    case t_POL: pari_APPLY_pol_normalized(gdivgs(gel(x,i),s));
    case t_SER: pari_APPLY_ser_normalized(gdivgs(gel(x,i),s));
    case t_VEC:
    case t_COL:
    case t_MAT: pari_APPLY_same(gdivgs(gel(x,i),s));
  }
  pari_err_TYPE2("/",x, stoi(s));
  return NULL; /* LCOV_EXCL_LINE */
}

GEN
gdivgu(GEN x, ulong s)
{
  long tx = typ(x), i;
  pari_sp av;
  GEN z;

  if (!s)
  {
    if (is_matvec_t(tx) && lg(x) == 1) return gcopy(x);
    pari_err_INV("gdivgu",gen_0);
  }
  switch(tx)
  {
    case t_INT: return Qdiviu(x, s);
    case t_REAL: return divru(x,s);

    case t_INTMOD:
      z = cgetg(3, t_INTMOD); s = umodui(s, gel(x,1));
      return div_intmod_same(z, gel(x,1), gel(x,2), utoi(s));

    case t_FFELT: return FF_Z_Z_muldiv(x,gen_1,utoi(s));

    case t_FRAC: z = cgetg(3, t_FRAC);
      i = ugcdiu(gel(x,1), s);
      if (i == 1)
      {
        gel(z,2) = mului(s, gel(x,2));
        gel(z,1) = icopy(gel(x,1));
      }
      else
      {
        gel(z,2) = mului(s/i, gel(x,2));
        gel(z,1) = divis(gel(x,1), i);
      }
      normalize_frac(z);
      fix_frac_if_int(z); return z;

    case t_COMPLEX: z = cgetg(3, t_COMPLEX);
      gel(z,1) = gdivgu(gel(x,1),s);
      gel(z,2) = gdivgu(gel(x,2),s); return z;

    case t_PADIC: /* divpT */
    {
      GEN p = padic_p(x);
      if (!signe(padic_u(x))) return zeropadic(p, valp(x) - u_pval(s,p));
      av = avma;
      return gc_upto(av, divpp(x, cvtop2(utoi(s),x)));
    }

    case t_QUAD: z = cgetg(4, t_QUAD);
      gel(z,1) = ZX_copy(gel(x,1));
      gel(z,2) = gdivgu(gel(x,2),s);
      gel(z,3) = gdivgu(gel(x,3),s); return z;

    case t_POLMOD:
      retmkpolmod(gdivgu(gel(x,2),s), RgX_copy(gel(x,1)));

    case t_RFRAC:
      if (s == 1) return gcopy(x);
      return div_rfrac_scal(x, utoi(s));

    case t_POL: pari_APPLY_pol_normalized(gdivgu(gel(x,i),s));
    case t_SER: pari_APPLY_ser_normalized(gdivgu(gel(x,i),s));
    case t_VEC:
    case t_COL:
    case t_MAT: pari_APPLY_same(gdivgu(gel(x,i),s));
  }
  pari_err_TYPE2("/",x, utoi(s));
  return NULL; /* LCOV_EXCL_LINE */
}

/* x / (i*(i+1)) */
GEN
divrunextu(GEN x, ulong i)
{
  if (i & HIGHMASK) /* i(i+1) >= 2^BITS_IN_LONG*/
    return divri(x, muluu(i, i+1));
  else
    return divru(x, i*(i+1));
}
/* x / (i*(i+1)) */
GEN
gdivgunextu(GEN x, ulong i)
{
  if (i & HIGHMASK) /* i(i+1) >= 2^BITS_IN_LONG*/
    return gdivgu(x, i*(i+1));
  else
    return gdiv(x, muluu(i, i+1));
}

/* True shift (exact multiplication by 2^n) */
GEN
gmul2n(GEN x, long n)
{
  GEN z, a, b;
  long k, l;

  switch(typ(x))
  {
    case t_INT:
      if (n>=0) return shifti(x,n);
      if (!signe(x)) return gen_0;
      l = vali(x); n = -n;
      if (n<=l) return shifti(x,-n);
      z = cgetg(3,t_FRAC);
      gel(z,1) = shifti(x,-l);
      gel(z,2) = int2n(n-l); return z;

    case t_REAL:
      return shiftr(x,n);

    case t_INTMOD: b = gel(x,1); a = gel(x,2);
      z = cgetg(3,t_INTMOD);
      if (n <= 0) return div_intmod_same(z, b, a, modii(int2n(-n), b));
      gel(z,2) = gc_INT((pari_sp)z, modii(shifti(a,n), b));
      gel(z,1) = icopy(b); return z;

    case t_FFELT: return FF_mul2n(x,n);

    case t_FRAC: a = gel(x,1); b = gel(x,2);
      l = vali(a);
      k = vali(b);
      if (n+l >= k)
      {
        if (expi(b) == k) return shifti(a,n-k); /* b power of 2 */
        l = n-k; k = -k;
      }
      else
      {
        k = -(l+n); l = -l;
      }
      z = cgetg(3,t_FRAC);
      gel(z,1) = shifti(a,l);
      gel(z,2) = shifti(b,k); return z;

    case t_COMPLEX: z = cgetg(3,t_COMPLEX);
      gel(z,1) = gmul2n(gel(x,1),n);
      gel(z,2) = gmul2n(gel(x,2),n); return z;

    case t_QUAD: z = cgetg(4,t_QUAD);
      gel(z,1) = ZX_copy(gel(x,1));
      gel(z,2) = gmul2n(gel(x,2),n);
      gel(z,3) = gmul2n(gel(x,3),n); return z;

    case t_POLMOD:
      retmkpolmod(gmul2n(gel(x,2),n), RgX_copy(gel(x,1)));

    case t_POL:
      pari_APPLY_pol(gmul2n(gel(x,i),n));
    case t_SER:
      if (ser_isexactzero(x)) return gcopy(x);
      pari_APPLY_ser(gmul2n(gel(x,i),n));
    case t_VEC: case t_COL: case t_MAT:
      pari_APPLY_same(gmul2n(gel(x,i),n));

    case t_RFRAC: /* int2n wrong if n < 0 */
      return mul_rfrac_scal(gel(x,1),gel(x,2), gmul2n(gen_1,n));

    case t_PADIC: /* int2n wrong if n < 0 */
      return gmul(gmul2n(gen_1,n),x);
  }
  pari_err_TYPE("gmul2n",x);
  return NULL; /* LCOV_EXCL_LINE */
}

/*******************************************************************/
/*                                                                 */
/*                              INVERSE                            */
/*                                                                 */
/*******************************************************************/
static GEN
inv_polmod(GEN T, GEN x)
{
  GEN z = cgetg(3,t_POLMOD), a;
  gel(z,1) = RgX_copy(T);
  if (typ(x) != t_POL || varn(x) != varn(T) || lg(x) <= 3)
    a = ginv(x);
  else
  {
    if (lg(T) == 5) /* quadratic fields */
      a = RgX_Rg_div(quad_polmod_conj(x,T), quad_polmod_norm(x,T));
    else
      a = RgXQ_inv(x, T);
  }
  gel(z,2) = a; return z;
}

GEN
ginv(GEN x)
{
  long s;
  pari_sp av;
  GEN z, y;

  switch(typ(x))
  {
    case t_INT:
      if (is_pm1(x)) return icopy(x);
      s = signe(x); if (!s) pari_err_INV("ginv",gen_0);
      z = cgetg(3,t_FRAC);
      gel(z,1) = s<0? gen_m1: gen_1;
      gel(z,2) = absi(x); return z;

    case t_REAL: return invr(x);

    case t_INTMOD: z=cgetg(3,t_INTMOD);
      gel(z,1) = icopy(gel(x,1));
      gel(z,2) = Fp_inv(gel(x,2),gel(x,1)); return z;

    case t_FRAC: {
      GEN a = gel(x,1), b = gel(x,2);
      s = signe(a);
      if (is_pm1(a)) return s > 0? icopy(b): negi(b);
      z = cgetg(3,t_FRAC);
      gel(z,1) = icopy(b);
      gel(z,2) = icopy(a);
      normalize_frac(z); return z;
    }
    case t_COMPLEX:
      av = avma;
      return gc_upto(av, divcR(conj_i(x), cxnorm(x)));

    case t_QUAD:
      av = avma;
      return gc_upto(av, gdiv(conj_i(x), quadnorm(x)));

    case t_PADIC:
    {
      GEN p = padic_p(x), pd = padic_pd(x), u = padic_u(x);
      long d = precp(x);
      if (!signe(u)) pari_err_INV("ginv",x);
      retmkpadic(Zp_inv(u, p, d), icopy(p), icopy(pd), -valp(x), d);
    }

    case t_POLMOD: return inv_polmod(gel(x,1), gel(x,2));
    case t_FFELT: return FF_inv(x);
    case t_POL: return gred_rfrac_simple(gen_1,x);
    case t_SER: return ser_inv(x);
    case t_RFRAC:
    {
      GEN n = gel(x,1), d = gel(x,2);
      pari_sp av = avma, ltop;
      if (gequal0(n)) pari_err_INV("ginv",x);

      n = simplify_shallow(n);
      if (typ(n) != t_POL || varn(n) != varn(d))
      {
        if (gequal1(n)) { set_avma(av); return RgX_copy(d); }
        ltop = avma;
        z = RgX_Rg_div(d,n);
      } else {
        ltop = avma;
        z = cgetg(3,t_RFRAC);
        gel(z,1) = RgX_copy(d);
        gel(z,2) = RgX_copy(n);
      }
      stackdummy(av, ltop);
      return z;
    }

    case t_VEC: if (!is_ext_qfr(x)) break;
    case t_QFB:
      return qfbpow(x, gen_m1);
    case t_MAT:
      y = RgM_inv(x);
      if (!y) pari_err_INV("ginv",x);
      return y;
    case t_VECSMALL:
    {
      long i, lx = lg(x)-1;
      y = zero_zv(lx);
      for (i=1; i<=lx; i++)
      {
        long xi = x[i];
        if (xi<1 || xi>lx || y[xi])
          pari_err_TYPE("ginv [not a permutation]", x);
        y[xi] = i;
      }
      return y;
    }
  }
  pari_err_TYPE("inverse",x);
  return NULL; /* LCOV_EXCL_LINE */
}
