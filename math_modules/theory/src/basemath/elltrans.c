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
/**               ELLIPTIC and MODULAR FUNCTIONS                   **/
/**              (as complex or p-adic functions)                   **/
/**                                                                **/
/********************************************************************/
#include "pari.h"
#include "paripriv.h"

#define DEBUGLEVEL DEBUGLEVEL_ell

/* add3, add4, mul3, mul4 and these 2 should be exported as convenience
 * functions (cf dirichlet.c, lfunlarge.c, hypergeom.c) */
static GEN
gadd3(GEN a, GEN b, GEN c) { return gadd(gadd(a, b), c); }
static GEN
gmul3(GEN a, GEN b, GEN c) { return gmul(gmul(a, b), c); }
static GEN
gmul4(GEN a, GEN b, GEN c, GEN d) { return gmul(gmul(a, b), gmul(c,d)); }

/********************************************************************/
/**        exp(I*Pi*x) with attention to rational arguments        **/
/********************************************************************/

/* sqrt(3)/2 */
static GEN
sqrt32(long prec) { GEN z = sqrtr_abs(utor(3,prec)); setexpo(z, -1); return z; }
/* exp(i k pi/12)  */
static GEN
e12(ulong k, long prec)
{
  int s, sPi, sPiov2;
  GEN z, t;
  k %= 24;
  if (!k) return gen_1;
  if (k == 12) return gen_m1;
  if (k >12) { s = 1; k = 24 - k; } else s = 0; /* x -> 2pi - x */
  if (k > 6) { sPi = 1; k = 12 - k; } else sPi = 0; /* x -> pi  - x */
  if (k > 3) { sPiov2 = 1; k = 6 - k; } else sPiov2 = 0; /* x -> pi/2 - x */
  z = cgetg(3, t_COMPLEX);
  switch(k)
  {
    case 0: gel(z,1) = icopy(gen_1); gel(z,2) = gen_0; break;
    case 1: t = gmul2n(addrs(sqrt32(prec), 1), -1);
      gel(z,1) = sqrtr(t);
      gel(z,2) = gmul2n(invr(gel(z,1)), -2); break;

    case 2: gel(z,1) = sqrt32(prec);
            gel(z,2) = real2n(-1, prec); break;

    case 3: gel(z,1) = sqrtr_abs(real2n(-1,prec));
            gel(z,2) = rcopy(gel(z,1)); break;
  }
  if (sPiov2) swap(gel(z,1), gel(z,2));
  if (sPi) togglesign(gel(z,1));
  if (s)   togglesign(gel(z,2));
  return z;
}
/* z a t_FRAC */
static GEN
expIPifrac(GEN z, long prec)
{
  GEN n = gel(z,1), d = gel(z,2);
  ulong r, q = uabsdivui_rem(12, d, &r);
  if (!r) return e12(q * umodiu(n, 24), prec); /* d | 12 */
  n = centermodii(n, shifti(d,1), d);
  return expIr(divri(mulri(mppi(prec), n), d));
}
/* exp(i Pi z), z a t_INT or t_FRAC */
GEN
expIPiQ(GEN z, long prec)
{
  if (typ(z) == t_INT) return mpodd(z)? gen_m1: gen_1;
  return expIPifrac(z, prec);
}

/* convert power of 2 t_REAL to rational */
static GEN
real2nQ(GEN x)
{
  long e = expo(x);
  GEN z;
  if (e < 0)
    z = mkfrac(signe(x) < 0? gen_m1: gen_1, int2n(-e));
  else
  {
    z = int2n(e);
    if (signe(x) < 0) togglesign_safe(&z);
  }
  return z;
}
/* x a real number */
GEN
expIPiR(GEN x, long prec)
{
  if (typ(x) == t_REAL && absrnz_equal2n(x)) x = real2nQ(x);
  switch(typ(x))
  {
    case t_INT:  return mpodd(x)? gen_m1: gen_1;
    case t_FRAC: return expIPifrac(x, prec);
  }
  return expIr(mulrr(mppi(prec), x));
}
/* z a t_COMPLEX */
GEN
expIPiC(GEN z, long prec)
{
  GEN pi, r, x, y;
  if (typ(z) != t_COMPLEX) return expIPiR(z, prec);
  x = gel(z,1);
  y = gel(z,2); if (gequal0(y)) return expIPiR(x, prec);
  pi = mppi(prec);
  r = gmul(pi, y); togglesign(r); r = mpexp(r); /* exp(-pi y) */
  if (typ(x) == t_REAL && absrnz_equal2n(x)) x = real2nQ(x);
  switch(typ(x))
  {
    case t_INT: if (mpodd(x)) togglesign(r);
                return r;
    case t_FRAC: return gmul(r, expIPifrac(x, prec));
  }
  return gmul(r, expIr(mulrr(pi, x)));
}
/* exp(I x y), more efficient for x in R, y pure imaginary */
GEN
expIxy(GEN x, GEN y, long prec) { return gexp(gmul(x, mulcxI(y)), prec); }

/********************************************************************/
/**                       PERIODS                                  **/
/********************************************************************/
/* The complex AGM, periods of elliptic curves over C and complex elliptic
 * logarithms; John E. Cremona, Thotsaphon Thongjunthug, arXiv:1011.0914 */

static GEN
ellomega_agm(GEN a, GEN b, GEN c, long prec)
{
  GEN pi = mppi(prec), mIpi = mkcomplex(gen_0, negr(pi));
  GEN Mac = agm(a,c,prec), Mbc = agm(b,c,prec);
  retmkvec2(gdiv(pi, Mac), gdiv(mIpi, Mbc));
}

static GEN
ellomega_cx(GEN E, long prec)
{
  pari_sp av = avma;
  GEN roots = ellR_roots(E, prec + EXTRAPREC64);
  GEN d1=gel(roots,4), d2=gel(roots,5), d3=gel(roots,6);
  GEN a = gsqrt(d3,prec), b = gsqrt(d1,prec), c = gsqrt(d2,prec);
  return gc_upto(av, ellomega_agm(a,b,c,prec));
}

/* return [w1,w2] for E / R; w1 > 0 is real.
 * If e.disc > 0, w2 = -I r; else w2 = w1/2 - I r, for some real r > 0.
 * => tau = w1/w2 is in upper half plane */
static GEN
doellR_omega(GEN E, long prec)
{
  pari_sp av = avma;
  GEN roots, d2, z, a, b, c;
  if (ellR_get_sign(E) >= 0) return ellomega_cx(E,prec);
  roots = ellR_roots(E,prec + EXTRAPREC64);
  d2 = gel(roots,5);
  z = gsqrt(d2,prec); /* imag(e1-e3) > 0, so that b > 0*/
  a = gel(z,1); /* >= 0 */
  b = gel(z,2);
  c = gabs(z, prec);
  z = ellomega_agm(a,b,c,prec);
  return gc_GEN(av, mkvec2(gel(z,1),gmul2n(gadd(gel(z,1),gel(z,2)),-1)));
}
static GEN
doellR_eta(GEN E, long prec)
{ GEN w = ellR_omega(E, prec + EXTRAPREC64); return elleta(w, prec); }

GEN
ellR_omega(GEN E, long prec)
{ return obj_checkbuild_realprec(E, R_PERIODS, &doellR_omega, prec); }
GEN
ellR_eta(GEN E, long prec)
{ return obj_checkbuild_realprec(E, R_ETA, &doellR_eta, prec); }

/* P = [x,0] is 2-torsion on y^2 = g(x). Return w1/2, (w1+w2)/2, or w2/2
 * depending on whether x is closest to e1,e2, or e3, the 3 complex root of g */
static GEN
zell_closest_0(GEN om, GEN x, GEN ro)
{
  GEN e1 = gel(ro,1), e2 = gel(ro,2), e3 = gel(ro,3);
  GEN d1 = gnorm(gsub(x,e1));
  GEN d2 = gnorm(gsub(x,e2));
  GEN d3 = gnorm(gsub(x,e3));
  GEN z = gel(om,2);
  if (gcmp(d1, d2) <= 0)
  { if (gcmp(d1, d3) <= 0) z = gel(om,1); }
  else
  { if (gcmp(d2, d3)<=0) z = gadd(gel(om,1),gel(om,2)); }
  return gmul2n(z, -1);
}

static GEN
zellcx(GEN E, GEN P, long prec)
{
  GEN R = ellR_roots(E, prec+EXTRAPREC64);
  GEN x0 = gel(P,1), y0 = ec_dmFdy_evalQ(E,P);
  if (gequal0(y0))
    return zell_closest_0(ellomega_cx(E,prec),x0,R);
  else
  {
    GEN e2 = gel(R,2), e3 = gel(R,3), d2 = gel(R,5), d3 = gel(R,6);
    GEN a = gsqrt(d2,prec), b = gsqrt(d3,prec);
    GEN r = gsqrt(gdiv(gsub(x0,e3), gsub(x0,e2)),prec);
    GEN t = gdiv(gneg(y0), gmul2n(gmul(r,gsub(x0,e2)),1));
    GEN ar = real_i(a), br = real_i(b), ai = imag_i(a), bi = imag_i(b);
    /* |a+b| < |a-b| */
    if (gcmp(gmul(ar,br), gneg(gmul(ai,bi))) < 0) b = gneg(b);
    return zellagmcx(a,b,r,t,prec);
  }
}

/* Assume E/R, disc E < 0, and P \in E(R) ==> z \in R */
static GEN
zellrealneg(GEN E, GEN P, long prec)
{
  GEN x0 = gel(P,1), y0 = ec_dmFdy_evalQ(E,P);
  if (gequal0(y0)) return gmul2n(gel(ellR_omega(E,prec),1),-1);
  else
  {
    GEN R = ellR_roots(E, prec+EXTRAPREC64);
    GEN d2 = gel(R,5), e3 = gel(R,3);
    GEN a = gsqrt(d2,prec);
    GEN z = gsqrt(gsub(x0,e3), prec);
    GEN ar = real_i(a), zr = real_i(z), ai = imag_i(a), zi = imag_i(z);
    GEN t = gdiv(gneg(y0), gmul2n(gnorm(z),1));
    GEN r2 = ginv(gsqrt(gaddsg(1,gdiv(gmul(ai,zi),gmul(ar,zr))),prec));
    return zellagmcx(ar,gabs(a,prec),r2,gmul(t,r2),prec);
  }
}

/* Assume E/R, disc E > 0, and P \in E(R) */
static GEN
zellrealpos(GEN E, GEN P, long prec)
{
  GEN R = ellR_roots(E, prec+EXTRAPREC64);
  GEN d2,d3,e1,e2,e3, a,b, x0 = gel(P,1), y0 = ec_dmFdy_evalQ(E,P);
  if (gequal0(y0)) return zell_closest_0(ellR_omega(E,prec), x0,R);
  e1 = gel(R,1);
  e2 = gel(R,2);
  e3 = gel(R,3);
  d2 = gel(R,5);
  d3 = gel(R,6);
  a = gsqrt(d2,prec);
  b = gsqrt(d3,prec);
  if (gcmp(x0,e1)>0) {
    GEN r = gsqrt(gdiv(gsub(x0,e3), gsub(x0,e2)),prec);
    GEN t = gdiv(gneg(y0), gmul2n(gmul(r,gsub(x0,e2)),1));
    return zellagmcx(a,b,r,t,prec);
  } else {
    GEN om = ellR_omega(E,prec);
    GEN r = gdiv(a,gsqrt(gsub(e1,x0),prec));
    GEN t = gdiv(gmul(r,y0),gmul2n(gsub(x0,e3),1));
    return gsub(zellagmcx(a,b,r,t,prec),gmul2n(gel(om,2),-1));
  }
}

static void
ellQp_P2t_err(GEN E, GEN z)
{
  if (typ(ellQp_u(E,1)) == t_POLMOD)
    pari_err_IMPL("ellpointtoz when u not in Qp");
  pari_err_DOMAIN("ellpointtoz", "point", "not on", strtoGENstr("E"),z);
}
static GEN
get_r0(GEN E, long prec)
{
  GEN b2 = ell_get_b2(E), e1 = ellQp_root(E, prec);
  return gadd(e1,gmul2n(b2,-2));
}
static GEN
ellQp_P2t(GEN E, GEN P, long prec)
{
  pari_sp av = avma;
  GEN a, b, ab, c0, r0, ar, r, x, delta, x1, y1, t, u, q;
  long vq, vt, Q, R;
  if (ell_is_inf(P)) return gen_1;
  ab = ellQp_ab(E, prec); a = gel(ab,1); b = gel(ab,2);
  u = ellQp_u(E, prec);
  q = ellQp_q(E, prec);
  x = gel(P,1);
  r0 = get_r0(E, prec);
  c0 = gadd(x, gmul2n(r0,-1));
  if (typ(c0) != t_PADIC || !is_scalar_t(typ(gel(P,2))))
    pari_err_TYPE("ellpointtoz",P);
  r = gsub(a,b);
  ar = gmul(a, r);
  if (gequal0(c0))
  {
    x1 = Qp_sqrt(gneg(ar));
    if (!x1) ellQp_P2t_err(E,P);
  }
  else
  {
    delta = gdiv(ar, gsqr(c0));
    t = Qp_sqrt(gsubsg(1,gmul2n(delta,2)));
    if (!t) ellQp_P2t_err(E,P);
    x1 = gmul(gmul2n(c0,-1), gaddsg(1,t));
  }
  y1 = gsubsg(1, gdiv(ar, gsqr(x1)));
  if (gequal0(y1))
  {
    y1 = Qp_sqrt(gmul(x1, gmul(gadd(x1, a), gadd(x1, r))));
    if (!y1) ellQp_P2t_err(E,P);
  }
  else
    y1 = gdiv(gmul2n(ec_dmFdy_evalQ(E,P), -1), y1);
  Qp_descending_Landen(ellQp_AGM(E,prec), &x1,&y1);

  t = gmul(u, gmul2n(y1,1)); /* 2u y_oo */
  t = gdiv(gsub(t, x1), gadd(t, x1));
  /* Reduce mod q^Z: we want 0 <= v(t) < v(q) */
  if (typ(t) == t_PADIC)
    vt = valp(t);
  else
    vt = valp(gnorm(t)) / 2; /* v(t) = v(Nt) / (e*f) */
  vq = valp(q); /* > 0 */
  Q = vt / vq; R = vt % vq; if (R < 0) Q--;
  if (Q) t = gdiv(t, gpowgs(q,Q));
  if (padicprec_relative(t) > prec) t = gprec(t, prec);
  return gc_upto(av, t);
}

static GEN
ellQp_t2P(GEN E, GEN t, long prec)
{
  pari_sp av = avma;
  GEN AB, A, R, x0,x1, y0,y1, u, u2, r0, s0, ar;
  long v;
  if (gequal1(t)) return ellinf();

  AB = ellQp_AGM(E,prec); A = gel(AB,1); R = gel(AB,3); v = itos(gel(AB,4));
  u = ellQp_u(E,prec);
  u2= ellQp_u2(E,prec);
  x1 = gdiv(t, gmul(u2, gsqr(gsubsg(1,t))));
  y1 = gdiv(gmul(x1,gaddsg(1,t)), gmul(gmul2n(u,1),gsubsg(1,t)));
  Qp_ascending_Landen(AB, &x1,&y1);
  r0 = get_r0(E, prec);

  ar = gmul(gel(A,1), gel(R,1)); setvalp(ar, valp(ar)+v);
  x0 = gsub(gadd(x1, gdiv(ar, x1)), gmul2n(r0,-1));
  s0 = gmul2n(ec_h_evalx(E, x0), -1);
  y0 = gsub(gmul(y1, gsubsg(1, gdiv(ar,gsqr(x1)))), s0);
  return gc_GEN(av, mkvec2(x0,y0));
}

static GEN
zell_i(GEN e, GEN z, long prec)
{
  GEN t;
  long s;
  (void)ellR_omega(e, prec); /* type checking */
  if (ell_is_inf(z)) return gen_0;
  s = ellR_get_sign(e);
  if (s && typ(gel(z,1))!=t_COMPLEX && typ(gel(z,2))!=t_COMPLEX)
    t = (s < 0)? zellrealneg(e,z,prec): zellrealpos(e,z,prec);
  else
    t = zellcx(e,z,prec);
  return t;
}

GEN
zell(GEN E, GEN P, long prec)
{
  pari_sp av = avma;
  checkell(E);
  if (!checkellpt_i(P)) pari_err_TYPE("ellpointtoz", P);
  switch(ell_get_type(E))
  {
    case t_ELL_Qp:
      prec = minss(ellQp_get_prec(E), padicprec_relative(P));
      return ellQp_P2t(E, P, prec);
    case t_ELL_NF:
    {
      GEN Ee = ellnfembed(E, prec), Pe = ellpointnfembed(E, P, prec);
      long i, l = lg(Pe);
      for (i = 1; i < l; i++) gel(Pe,i) = zell_i(gel(Ee,i), gel(Pe,i), prec);
      ellnfembed_free(Ee); return gc_GEN(av, Pe);
    }
    case t_ELL_Q: break;
    case t_ELL_Rg: break;
    default: pari_err_TYPE("ellpointtoz", E);
  }
  return gc_upto(av, zell_i(E, P, prec));
}

/********************************************************************/
/**                COMPLEX ELLIPTIC FUNCTIONS                      **/
/********************************************************************/

enum period_type { t_PER_W, t_PER_WETA, t_PER_ELL };
/* normalization / argument reduction for elliptic functions */
typedef struct {
  enum period_type type;
  GEN in; /* original input */
  GEN w1,w2,tau; /* original basis for L = <w1,w2> = w2 <1,tau> */
  GEN W1,W2,Tau; /* new basis for L = <W1,W2> = W2 <1,tau> */
  GEN ETA; /* quasi-periods for [W1,W2] or NULL */
  GEN a,b,c,d; /* t_INT; tau in F = h/Sl2, tau = g.t, g=[a,b;c,d] in SL(2,Z) */
  GEN z,Z; /* z/w2 defined mod <1,tau>, Z = z/w2 + x*tau+y reduced mod <1,tau>*/
  GEN x,y; /* t_INT */
  int swap; /* 1 if we swapped w1 and w2 */
  int some_q_is_real; /* exp(2iPi g.tau) for some g \in SL(2,Z) */
  int some_z_is_real; /* z + xw1 + yw2 is real for some x,y \in Z */
  int some_z_is_pure_imag; /* z + xw1 + yw2 in i*R */
  int q_is_real; /* exp(2iPi tau) \in R */
  int abs_u_is_1; /* |exp(2iPi Z)| = 1 */
  long prec; /* precision(Z) */
  long prec0; /* required precision for result */
} ellred_t;

/* compute g in SL_2(Z), g.t is in the usual
   fundamental domain. Internal function no check, no garbage. */
static void
set_gamma(GEN *pt, GEN *pa, GEN *pb, GEN *pc, GEN *pd)
{
  GEN a, b, c, d, t, t0 = *pt, run = dbltor(1. - 1e-8);
  long e = gexpo(gel(t0,2));
  if (e < 0) t0 = gprec_wensure(t0, precision(t0)+nbits2extraprec(-e));
  t = t0;
  a = d = gen_1;
  b = c = gen_0;
  for(;;)
  {
    GEN m, n = ground(gel(t,1));
    if (signe(n))
    { /* apply T^n */
      t = gsub(t,n);
      a = subii(a, mulii(n,c));
      b = subii(b, mulii(n,d));
    }
    m = cxnorm(t); if (gcmp(m,run) > 0) break;
    t = gneg_i(gdiv(conj_i(t), m)); /* apply S */
    togglesign_safe(&c); swap(a,c);
    togglesign_safe(&d); swap(b,d);
  }
  if (e < 0 && (signe(b) || signe(c))) *pt = t0;
  *pa = a; *pb = b; *pc = c; *pd = d;
}
/* Im z > 0. Return U.z in PSl2(Z)'s standard fundamental domain.
 * Set *pU to U. */
GEN
cxredsl2_i(GEN z, GEN *pU, GEN *czd)
{
  GEN a,b,c,d;
  set_gamma(&z, &a, &b, &c, &d);
  *pU = mkmat2(mkcol2(a,c), mkcol2(b,d));
  *czd = gadd(gmul(c,z), d);
  return gdiv(gadd(gmul(a,z), b), *czd);
}
GEN
cxredsl2(GEN t, GEN *pU)
{
  pari_sp av = avma;
  GEN czd;
  t = cxredsl2_i(t, pU, &czd);
  return gc_all(av, 2, &t, pU);
}

/* swap w1, w2 so that Im(t := w1/w2) > 0. Set tau = representative of t in
 * the standard fundamental domain, and g in Sl_2, such that tau = g.t */
static void
red_modSL2(ellred_t *T, long prec)
{
  long s, p;
  T->tau = gdiv(T->w1,T->w2);
  if (isintzero(real_i(T->tau))) T->some_q_is_real = 1;
  s = gsigne(imag_i(T->tau));
  if (!s) pari_err_DOMAIN("elliptic function", "det(w1,w2)", "=", gen_0,
                          mkvec2(T->w1,T->w2));
  T->swap = (s < 0);
  if (T->swap) { swap(T->w1, T->w2); T->tau = ginv(T->tau); }
  p = precision(T->tau); T->prec0 = p? p: prec;
  if (T->type == t_PER_WETA)
  {
    T->a = T->d = gen_1; T->W1 = T->w1;
    T->b = T->c = gen_0; T->W2 = T->w2; T->Tau = T->tau;
  }
  else
  {
    set_gamma(&T->tau, &T->a, &T->b, &T->c, &T->d);
    /* update lattice */
    p = precision(T->tau);
    if (p)
    {
      T->w1 = gprec_wensure(T->w1, p);
      T->w2 = gprec_wensure(T->w2, p);
    }
    T->W1 = gadd(gmul(T->a,T->w1), gmul(T->b,T->w2));
    T->W2 = gadd(gmul(T->c,T->w1), gmul(T->d,T->w2));
    T->Tau = gdiv(T->W1, T->W2);
  }
  if (isintzero(real_i(T->Tau))) T->some_q_is_real = T->q_is_real = 1;
  p = precision(T->Tau); T->prec = p? p: prec;
}
/* is z real or pure imaginary ? */
static void
check_complex(GEN z, int *real, int *imag)
{
  if (typ(z) != t_COMPLEX)      { *real = 1; *imag = 0; }
  else if (isintzero(gel(z,1))) { *real = 0; *imag = 1; }
  else *real = *imag = 0;
}
static void
reduce_z(GEN z, ellred_t *T)
{
  GEN x, Z;
  long p, e;
  switch(typ(z))
  {
    case t_INT: case t_REAL: case t_FRAC: case t_COMPLEX: break;
    case t_QUAD:
      z = isexactzero(gel(z,2))? gel(z,1): quadtofp(z, T->prec);
      break;
    default: pari_err_TYPE("reduction mod 2-dim lattice (reduce_z)", z);
  }
  Z = gdiv(z, T->W2);
  T->z = z;
  x = gdiv(imag_i(Z), imag_i(T->Tau));
  T->x = grndtoi(x, &e); /* |Im(Z - x*Tau)| <= Im(Tau)/2 */
  /* Avoid Im(Z) << 0; take 0 <= Im(Z - x*Tau) < Im(Tau) instead.
   * Leave round when Im(Z - x*Tau) ~ 0 to allow detecting Z in <1,Tau>
   * at the end */
  if (e > -10) T->x = gfloor(x);
  if (signe(T->x)) Z = gsub(Z, gmul(T->x,T->Tau));
  T->y = ground(real_i(Z));/* |Re(Z - y)| <= 1/2 */
  if (signe(T->y)) Z = gsub(Z, T->y);
  T->abs_u_is_1 = (typ(Z) != t_COMPLEX);
  /* Z = - y - x tau + z/W2, x,y integers */
  check_complex(z, &(T->some_z_is_real), &(T->some_z_is_pure_imag));
  if (!T->some_z_is_real && !T->some_z_is_pure_imag)
  {
    int W2real, W2imag;
    check_complex(T->W2,&W2real,&W2imag);
    if (W2real)
      check_complex(Z, &(T->some_z_is_real), &(T->some_z_is_pure_imag));
    else if (W2imag)
      check_complex(Z, &(T->some_z_is_pure_imag), &(T->some_z_is_real));
  }
  p = precision(Z);
  if (gequal0(Z) || (p && gexpo(Z) < 5 - p)) Z = NULL; /*z in L*/
  if (p && p < T->prec) T->prec = p;
  T->Z = Z;
}
/* return x.eta1 + y.eta2 */
static GEN
_period(ellred_t *T, GEN eta)
{
  GEN y1 = NULL, y2 = NULL;
  if (signe(T->x)) y1 = gmul(T->x, gel(eta,1));
  if (signe(T->y)) y2 = gmul(T->y, gel(eta,2));
  if (!y1) return y2? y2: gen_0;
  return y2? gadd(y1, y2): y1;
}
/* e is either
 * - [w1,w2]
 * - [[w1,w2],[eta1,eta2]]
 * - an ellinit structure */
static void
compute_periods(ellred_t *T, GEN z, long prec)
{
  GEN w, e;
  T->ETA = NULL;
  T->q_is_real = 0;
  T->some_q_is_real = 0;
  switch(T->type)
  {
    case t_PER_ELL:
    {
      long pr, p = prec;
      if (z && (pr = precision(z))) p = pr;
      e = T->in;
      w = ellR_omega(e, p);
      T->some_q_is_real = T->q_is_real = 1;
      break;
    }
    case t_PER_W:
      w = T->in; break;
    default: /*t_PER_WETA*/
      w = gel(T->in,1);
      T->ETA = gel(T->in, 2); break;
  }
  T->w1 = gel(w,1);
  T->w2 = gel(w,2);
  red_modSL2(T, prec);
  if (z) reduce_z(z, T);
}
static int
ispair(GEN w) { return typ(w) == t_VEC && lg(w) == 3; }
static int
check_periods(GEN e, ellred_t *T)
{
  if (typ(e) != t_VEC) return 0;
  T->in = e;
  switch(lg(e))
  {
    case 17:
      T->type = t_PER_ELL;
      break;
    case 3:
      if (!ispair(gel(e,1)))
        T->type = t_PER_W;
      else
      {
        if (!ispair(gel(e,2))) return 0;
        T->type = t_PER_WETA;
      }
      break;
    default: return 0;
  }
  return 1;
}
static int
get_periods(GEN e, GEN z, ellred_t *T, long prec)
{
  if (!check_periods(e, T)) return 0;
  compute_periods(T, z, prec); return 1;
}

/* pi^2/3 */
static GEN
pi23(long prec) { return divru(sqrr(mppi(prec)), 3); }
/* 2iPi/x, more efficient when x pure imaginary (rectangular lattice) */
static GEN
PiI2div(GEN x, long prec) { return gdiv(Pi2n(1, prec), mulcxmI(x)); }
/* 2iPi/x)^2 = -4pi^2 / x */
static GEN
PiI2div_sqr(GEN x, long prec)
{
  GEN p = sqrr(Pi2n(1, prec)); setsigne(p, -1);
  return gdiv(p, gsqr(x));
}

static void
elleisnum_testk(long k)
{
  if (k<=0) pari_err_DOMAIN("elleisnum", "k", "<=", gen_0, stoi(k));
  if (k&1) pari_err_DOMAIN("elleisnum", "k % 2", "!=", gen_0, stoi(k));
}

/* quasi-periods eta1, eta2 attached to [W1,W2] = W2 [Tau, 1] */
static GEN
elleta_W(ellred_t *T)
{
  long prec;
  GEN e, E2;

  if (T->ETA) return T->ETA;
  prec = precision(T->W2)? T->prec: T->prec + EXTRAPREC64;
  E2 = cxEk(T->Tau, 2, prec);
  e = cxtoreal(gdiv(gmul(E2, pi23(prec)), gsqr(T->W2)));
  /* y2 Tau - y1 = 2i pi/W2 => y2 W1 - y1 W2 = 2i pi */
  return mkvec2(gsub(gmul(T->W1, e), PiI2div(T->W2, prec)), gmul(T->W2, e));
}

GEN
ellperiods(GEN w, long flag, long prec)
{
  pari_sp av = avma;
  ellred_t T;
  GEN W;
  if (!get_periods(w, NULL, &T, prec)) pari_err_TYPE("ellperiods",w);
  W = mkvec2(T.W1, T.W2);
  switch(flag)
  {
    case 1: W = mkvec2(W, elleta_W(&T)); /* fall through */
    case 0: break;
    default: pari_err_FLAG("ellperiods");
  }
  return gc_GEN(av, W);
}

/* quasi-periods eta1, eta2 attached to [w1, w2] = w2 [tau, 1] */
/* warning: w1*eta2 - w2*eta1 = sign(imag(tau))*2*Pi*I */

GEN
elleta(GEN om, long prec)
{
  pari_sp av = avma;
  GEN y1, y2, E2, pi;
  ellred_t T;

  if (!check_periods(om, &T))
  {
    pari_err_TYPE("elleta",om);
    return NULL;/*LCOV_EXCL_LINE*/
  }
  if (T.type == t_PER_ELL) return ellR_eta(om, prec);

  compute_periods(&T, NULL, prec);
  prec = T.prec;
  pi = mppi(prec);
  E2 = cxEk(T.Tau, 2, prec); /* E_2(Tau) */
  if (signe(T.c))
  {
    GEN u = gdiv(T.w2, T.W2);
    /* E2 := u^2 E2 + 6iuc/pi = E_2(tau) */
    E2 = gadd(gmul(gsqr(u), E2), mulcxI(gdiv(gmul(mului(6,T.c), u), pi)));
  }
  y2 = gdiv(gmul(E2, sqrr(pi)), gmulsg(3, T.w2));
  if (T.swap)
  {
    y1 = y2;
    y2 = gsub(gmul(T.tau,y1), PiI2div(T.w2, prec));
  }
  else
    y1 = gsub(gmul(T.tau,y2), PiI2div(T.w2, prec));
  if (is_real_t(typ(T.w1))) y1 = real_i(y1);
  return gc_GEN(av, mkvec2(y1,y2));
}

/********************************************************************/
/**                     Jacobi sine theta                          **/
/********************************************************************/

/* check |q| < 1 */
static GEN
check_unit_disc(const char *fun, GEN q, long prec)
{
  GEN Q = gtofp(q, prec), Qlow;
  Qlow = (prec > LOWDEFAULTPREC)? gtofp(Q,LOWDEFAULTPREC): Q;
  if (gcmp(gnorm(Qlow), gen_1) >= 0)
    pari_err_DOMAIN(fun, "abs(q)", ">=", gen_1, q);
  return Q;
}

GEN
thetanullk(GEN q, long k, long prec)
{
  long l, n;
  pari_sp av = avma;
  GEN p1, ps, qn, y, ps2;

  if (k < 0)
    pari_err_DOMAIN("thetanullk", "k", "<", gen_0, stoi(k));
  l = precision(q);
  if (l) prec = l;
  q = check_unit_disc("thetanullk", q, prec);

  if (!odd(k)) { set_avma(av); return gen_0; }
  qn = gen_1;
  ps2 = gsqr(q);
  ps = gneg_i(ps2);
  y = gen_1;
  for (n = 3;; n += 2)
  {
    GEN t;
    qn = gmul(qn,ps);
    ps = gmul(ps,ps2);
    t = gmul(qn, powuu(n, k)); y = gadd(y, t);
    if (gexpo(t) < -prec2nbits(prec)) break;
  }
  p1 = gmul2n(gsqrt(gsqrt(q,prec),prec),1);
  if (k&2) y = gneg_i(y);
  return gc_upto(av, gmul(p1, y));
}

/* q2 = q^2 */
static GEN
vecthetanullk_loop(GEN q2, long k, long prec)
{
  GEN ps, qn = gen_1, y = const_vec(k, gen_1);
  pari_sp av = avma;
  const long bit = prec2nbits(prec);
  long i, n;

  if (gexpo(q2) < -2*bit) return y;
  ps = gneg_i(q2);
  for (n = 3;; n += 2)
  {
    GEN t = NULL/*-Wall*/, P = utoipos(n), N2 = sqru(n);
    qn = gmul(qn,ps);
    ps = gmul(ps,q2);
    for (i = 1; i <= k; i++)
    {
      t = gmul(qn, P); gel(y,i) = gadd(gel(y,i), t);
      P = mulii(P, N2);
    }
    if (gexpo(t) < -bit) return y;
    if (gc_needed(av,2))
    {
      if (DEBUGMEM>1) pari_warn(warnmem,"vecthetanullk_loop, n = %ld",n);
      (void)gc_all(av, 3, &qn, &ps, &y);
    }
  }
}
/* [d^i theta/dz^i(q, 0), i = 1, 3, .., 2*k - 1] */
GEN
vecthetanullk(GEN q, long k, long prec)
{
  long i, l = precision(q);
  pari_sp av = avma;
  GEN p1, y;

  if (l) prec = l;
  q = check_unit_disc("vecthetanullk", q, prec);
  y = vecthetanullk_loop(gsqr(q), k, prec);
  p1 = gmul2n(gsqrt(gsqrt(q,prec),prec),1);
  for (i = 2; i <= k; i += 2) gel(y,i) = gneg_i(gel(y,i));
  return gc_upto(av, gmul(p1, y));
}

/* [d^i theta/dz^i(q, 0), i = 1, 3, .., 2*k - 1], q = exp(2iPi tau) */
GEN
vecthetanullk_tau(GEN tau, long k, long prec)
{
  long i, l = precision(tau);
  pari_sp av = avma;
  GEN q4, y;

  if (l) prec = l;
  if (typ(tau) != t_COMPLEX || gsigne(gel(tau,2)) <= 0)
    pari_err_DOMAIN("vecthetanullk_tau", "imag(tau)", "<=", gen_0, tau);
  q4 = expIPiC(gmul2n(tau,-1), prec); /* q^(1/4) */
  y = vecthetanullk_loop(gpowgs(q4,8), k, prec);
  for (i = 2; i <= k; i += 2) gel(y,i) = gneg_i(gel(y,i));
  return gc_upto(av, gmul(gmul2n(q4,1), y));
}

/********************************************************************/
/*   Riemann-Jacobi 1-variable theta functions, does not use AGM    */
/********************************************************************/
/* theta(z,tau,0) should be identical to riemann_theta([z]~, Mat(tau))
 * from Jean Kieffer. */

static long
equali01(GEN x)
{
  if (!signe(x)) return 0;
  if (!equali1(x)) pari_err_FLAG("theta");
  return 1;
}

static long
thetaflag(GEN v)
{
  long v1, v2;
  if (!v) return 0;
  switch(typ(v))
  {
    case t_INT:
      if (signe(v) < 0 || cmpis(v, 4) > 0) pari_err_FLAG("theta");
      return itou(v);
    case t_VEC:
      if (RgV_is_ZV(v) && lg(v) == 3) break;
    default: pari_err_FLAG("theta");
  }
  v1 = equali01(gel(v,1));
  v2 = equali01(gel(v,2)); return v1? (v2? -1: 2): (v2? 4: 3);
}

/* Automorphy factor for bringing tau towards standard fundamental domain
 * (we stop when im(tau) >= 1/2, no need to go all the way to sqrt(3)/2).
 * At z = 0 if NULL */
static GEN
autojtau(GEN *pz, GEN *ptau, long *psumr, long *pct, long prec)
{
  GEN S = gen_1, z = *pz, tau = *ptau;
  long ct = 0, sumr = 0;
  if (z && gequal0(z)) z = NULL;
  while (gexpo(imag_i(tau)) < -1)
  {
    GEN r = ground(real_i(tau)), taup;
    tau = gsub(tau, r); taup = gneg(ginv(tau));
    S = gdiv(S, gsqrt(mulcxmI(tau), prec));
    if (z)
    {
      S = gmul(S, expIPiC(gmul(taup, gsqr(z)), prec));
      z = gneg(gmul(z, taup));
    }
    ct++; tau = taup; sumr = (sumr + Mod8(r)) & 7;
  }
  if (pct) *pct = ct;
  *psumr = sumr; *pz = z; *ptau = tau; return S;
}

/* At 0 if z = NULL. Real(tau) = n is an integer; 4 | n if fl = 1 or 2 */
static void
clearim(GEN *v, GEN z, long fl)
{
  if (!z || gequal0(imag_i(z)) || (fl != 1 && gequal0(real_i(z))))
    *v = real_i(*v);
}

static GEN
clearimall(GEN z, GEN n, GEN VS)
{
  long nmod4 = Mod4(n);
  clearim(&gel(VS,1), z, 3);
  clearim(&gel(VS,2), z, 4);
  if (!nmod4)
  {
    clearim(&gel(VS,3), z, 2);
    clearim(&gel(VS,4), z, 1);
  }
  return VS;
}

/* Implementation of all 4 theta functions */

/* If z = NULL, we are at 0 */
static long
thetaprec(GEN z, GEN tau, long prec)
{
  long l = precision(tau);
  if (z)
  {
    long n = precision(z);
    if (n && n < l) l = n;
  }
  return l? l: prec;
}

static GEN
redmod2Z(GEN z)
{
  GEN k = ground(gmul2n(real_i(z), -1));
  if (typ(k) != t_INT) pari_err_TYPE("theta", z);
  if (signe(k)) z = gsub(z, shifti(k, 1));
  return z;
}

/* Return theta[0,0], theta[0,1], theta[1,0] and theta[1,1] at (z,tau).
 * If pT0 != NULL, assume z != NULL and set *pT0 to
 *  theta[0,0], theta[0,1], theta[1,0] and theta[1,1]' at (0,tau).
 * Note that theta[1,1](0, tau) is identically 0, hence the derivative.
 * If z = NULL, return theta[1,1]'(0) */
static GEN
thetaall(GEN z, GEN tau, GEN *pT0, long prec)
{
  pari_sp av;
  GEN zold, tauold, k, u, un, q, q2, qd, qn;
  GEN S, Skeep, S00, S01, S10, S11, u2, ui2, uin;
  GEN Z00 = gen_1, Z01 = gen_1, Z10 = gen_0, Z11 = gen_0;
  long n, ct, eS, B, sumr, precold = prec;
  int theta1p = !z;

  if (z) z = redmod2Z(z);
  tau = upper_to_cx(tau, &prec);
  prec = thetaprec(z, tau, prec);
  z = zold = z? gtofp(z, prec): NULL;
  tau = tauold = gtofp(tau, prec);
  S = autojtau(&z, &tau, &sumr, &ct, prec);
  Skeep = S;
  k = gen_0; S00 = S01 = gen_1; S10 = S11 = gen_0;
  if (z)
  {
    GEN y = imag_i(z);
    if (!gequal0(y)) k = roundr(divrr(y, gneg(imag_i(tau))));
    if (signe(k))
    {
      GEN Sz = expIPiC(gadd(gmul(sqri(k), tau), gmul(shifti(k,1), z)), prec);
      S = gmul(S, Sz);
      z = gadd(z, gmul(tau, k));
    }
  }
  if ((eS = gexpo(S)) > 0)
  {
    prec = nbits2prec(eS + prec2nbits(prec));
    if (z) z = gprec_w(z, prec);
    tau = gprec_w(tau, prec);
  }
  q = expIPiC(gmul2n(tau,-2), prec); q2 = gsqr(q); qn = gen_1;
  if (!z) u = u2 = ui2 = un = uin = NULL; /* constant, equal to 1 */
  else
  {
    u = expIPiC(z, prec); u2 = gsqr(u); ui2 = ginv(u2);
    un = uin = gen_1;
  }
  qd = q; B = prec2nbits(prec);
  av = avma;
  for (n = 1;; n++)
  { /* qd = q^(4n-3), qn = q^(4(n-1)^2), un = u^(2n-2), uin = 1/un */
    long e = 0, eqn, prec2;
    GEN tmp;
    if (u) uin = gmul(uin, ui2);
    qn = gmul(qn, qd); /* q^((2n-1)^2) */
    tmp = u? gmul(qn, gadd(un, uin)): gmul2n(qn, 1);
    S10 = gadd(S10, tmp);
    if (pT0) Z10 = gadd(Z10, gmul2n(qn, 1));
    if (z)
    {
      tmp = gmul(qn, gsub(un, uin));
      S11 = odd(n)? gsub(S11, tmp): gadd(S11, tmp);
      e = maxss(0, gexpo(un)); un = gmul(un, u2);
      e = maxss(e, gexpo(un));
    }
    else if (theta1p) /* theta'[1,1] at 0 */
    {
      tmp = gmulsg(2*n-1, tmp);
      S11 = odd(n)? gsub(S11, tmp): gadd(S11, tmp);
    }
    if (pT0)
    {
      tmp = gmulsg(4*n-2, qn);
      Z11 = odd(n)? gsub(Z11, tmp): gadd(Z11, tmp);
    }
    qd = gmul(qd, q2); qn = gmul(qn, qd); /* q^(4n^2) */
    tmp = u? gmul(qn, gadd(un, uin)): gmul2n(qn, 1);
    S00 = gadd(S00, tmp);
    S01 = odd(n)? gsub(S01, tmp): gadd(S01, tmp);
    if (pT0)
    {
      tmp = gmul2n(qn, 1); Z00 = gadd(Z00, tmp);
      Z01 = odd(n)? gsub(Z01, tmp): gadd(Z01, tmp);
    }
    eqn = gexpo(qn) + e; if (eqn < -B) break;
    qd = gmul(qd, q2);
    prec2 = minss(prec, nbits2prec(eqn + B + 64));
    qn = gprec_w(qn, prec2); qd = gprec_w(qd, prec2);
    if (u) { un = gprec_w(un, prec2); uin = gprec_w(uin, prec2); }
    if (gc_needed(av, 1))
    {
      if(DEBUGMEM>1) pari_warn(warnmem,"theta");
      gc_all(av, pT0? 12: (u? 8: 6), &qd, &qn, &S00,&S01,&S10,&S11, &un,&uin,
             &Z00,&Z01,&Z10,&Z11);
    }
  }
  if (u)
  {
    S10 = gmul(u, S10);
    S11 = gmul(u, S11);
  }
  /* automorphic factor
   *   theta[1,1]: I^ct
   *   theta[1,0]: exp(-I*Pi/4*sumr)
   *   theta[0,1]: (-1)^k
   *   theta[1,1]: (-1)^k exp(-I*Pi/4*sumr) */
  if (!theta1p && mpodd(k)) { S01 = gneg(S01); S11 = gneg(S11); }
  S11 = z? mulcxpowIs(S11, ct + 3): gmul(mppi(prec), S11);
  if (pT0) Z11 = gmul(mppi(prec), Z11);
  if (ct&1L) { swap(S10, S01); if (pT0) swap(Z10, Z01); }
  if (sumr & 7)
  {
    GEN zet = e12(sumr * 3, prec); /* exp(I Pi sumr / 4) */
    if (odd(sumr)) { swap(S01, S00); if (pT0) swap(Z01, Z00); }
    S10 = gmul(S10, zet); S11 = gmul(S11, zet);
    if (pT0) { Z10 = gmul(Z10, zet); Z11 = gmul(Z11, zet); }
  }
  if (theta1p) S11 = gmul(gsqr(S), S11);
  if (pT0) Z11 = gmul(gsqr(Skeep), Z11);
  S = gmul(S, mkvec4(S00, S01, S10, S11));
  if (precold < prec) S = gprec_wtrunc(S, precold);
  if (pT0)
  {
    *pT0 = gmul(Skeep, mkvec4(Z00, Z01, Z10, Z11));
    if (precold < prec) *pT0 = gprec_wtrunc(*pT0, precold);
  }
  if (isint(real_i(tauold), &k))
  {
    S = clearimall(zold, k, S);
    if (pT0) *pT0 = clearimall(NULL, k, *pT0);
  }
  return S;
}

static GEN
thetanull_i(GEN tau, long prec) { return thetaall(NULL, tau, NULL, prec); }

GEN
theta(GEN z, GEN tau, GEN flag, long prec)
{
  pari_sp av = avma;
  GEN T;
  if (!flag)
  { /* backward compatibility: sine theta */
    GEN pi = mppi(prec), q = z; z = tau; /* input (q = exp(i pi tau), Pi*z) */
    prec = thetaprec(z, tau, prec);
    q = check_unit_disc("theta", q, prec);
    z = gdiv(gtofp(z, prec), pi);
    tau = gdiv(mulcxmI(glog(q, prec)), pi);
    flag = gen_1;
  }
  T = thetaall(z, tau, NULL, prec);
  switch (thetaflag(flag))
  {
    case -1: T = gel(T,4); break;
    case 0: break;
    case 1: T = gneg(gel(T,4)); break;
    case 2: T = gel(T,3); break;
    case 3: T = gel(T,1); break;
    case 4: T = gel(T,2); break;
    default: pari_err_FLAG("theta");
  }
  return gc_GEN(av, T);
}

/* Same as 2*Pi*eta(tau,1)^3 = - thetanull_i(tau)[4], faster than both. */
static GEN
thetanull11(GEN tau, long prec)
{
  GEN z = NULL, tauold, q, q8, qd, qn, S, S11;
  long n, eS, B, sumr, precold = prec;

  tau = upper_to_cx(tau, &prec);
  tau = tauold = gtofp(tau, prec);
  S = autojtau(&z, &tau, &sumr, NULL, prec);
  S11 = gen_1; ;
  if ((eS = gexpo(S)) > 0)
  {
    prec += nbits2extraprec(eS);
    tau = gprec_w(tau, prec);
  }
  q8 = expIPiC(gmul2n(tau,-2), prec); q = gpowgs(q8, 8);
  qn = gen_1; qd = q; B = prec2nbits(prec);
  for (n = 1;; n++)
  { /* qd = q^n, qn = q^((n^2-n)/2) */
    long eqn, prec2;
    GEN tmp;
    qn = gmul(qn, qd); tmp = gmulsg(2*n+1, qn); eqn = gexpo(tmp);
    S11 = odd(n)? gsub(S11, tmp): gadd(S11, tmp);
    if (eqn < -B) break;
    qd = gmul(qd, q);
    prec2 = minss(prec, nbits2prec(eqn + B + 32));
    qn = gprec_w(qn, prec2); qd = gprec_w(qd, prec2);
  }
  if (precold < prec) prec = precold;
  S11 = gmul3(S11, q8, e12(3*sumr, prec));
  S11 = gmul3(Pi2n(1, prec), gpowgs(S, 3), S11);
  if (isint(real_i(tauold), &q) && !Mod4(q)) clearim(&S11, z, 1);
  return S11;
}

GEN
thetanull(GEN tau, GEN flag, long prec)
{
  pari_sp av = avma;
  long fl = thetaflag(flag);
  GEN T0;
  if (fl == 1) T0 = thetanull11(tau, prec);
  else if (fl == -1) T0 = gneg(thetanull11(tau, prec));
  else
  {
    T0 = thetanull_i(tau, prec);
    switch (fl)
    {
      case 0: break;
      case 2: T0 = gel(T0,3); break;
      case 3: T0 = gel(T0,1); break;
      case 4: T0 = gel(T0,2); break;
      default: pari_err_FLAG("thetanull");
    }
  }
  return gc_GEN(av, T0);
}

static GEN
autojtauprime(GEN *pz, GEN *ptau, GEN *pmat, long *psumr, long *pct, long prec)
{
  GEN S = gen_1, z = *pz, tau = *ptau, M = matid(2);
  long ct = 0, sumr = 0;
  while (gexpo(imag_i(tau)) < -1)
  {
    GEN r = ground(real_i(tau)), taup;
    tau = gsub(tau, r); taup = gneg(ginv(tau));
    S = gdiv(S, gsqrt(mulcxmI(tau), prec));
    S = gmul(S, expIPiC(gmul(taup, gsqr(z)), prec));
    M = gmul(mkmat22(gen_1, gen_0, gmul(z, PiI2n(1, prec)), tau), M);
    z = gneg(gmul(z, taup));
    ct++; tau = taup; sumr = (sumr + Mod8(r)) & 7;
  }
  if (pct) *pct = ct;
  *pmat = M; *psumr = sumr; *pz = z; *ptau = tau; return S;
}

/* computes theta_{1,1} and theta'_{1,1} together */

static GEN
theta11prime(GEN z, GEN tau, long prec)
{
  pari_sp av = avma;
  GEN zold, tauold, k, u, un, q, q2, qd, qn;
  GEN S, S11, S11prime, S11all, u2, ui2, uin;
  GEN y, mat;
  long n, ct, eS, B, sumr, precold = prec;

  if (z) z = redmod2Z(z);
  if (!z || gequal0(z)) pari_err(e_MISC, "z even integer in theta11prime");
  tau = upper_to_cx(tau, &prec);
  prec = thetaprec(z, tau, prec);
  z = zold = z? gtofp(z, prec): NULL;
  tau = tauold = gtofp(tau, prec);
  S = autojtauprime(&z, &tau, &mat, &sumr, &ct, prec);
  k = gen_0; S11 = gen_0; S11prime = gen_0;
  y = imag_i(z);
  if (!gequal0(y)) k = roundr(divrr(y, gneg(imag_i(tau))));
  if (signe(k))
  {
    GEN Sz = expIPiC(gadd(gmul(sqri(k), tau), gmul(shifti(k,1), z)), prec);
    mat = gmul(mkmat22(gen_1, gen_0, gneg(gmul(k, PiI2n(1, prec))), gen_1), mat);
    S = gmul(S, Sz);
    z = gadd(z, gmul(tau, k));
  }
  if ((eS = gexpo(S)) > 0)
  {
    prec = nbits2prec(eS + prec2nbits(prec));
    z = gprec_w(z, prec);
    tau = gprec_w(tau, prec);
  }
  q = expIPiC(gmul2n(tau,-2), prec); q2 = gsqr(q); qn = gen_1;
  u = expIPiC(z, prec); u2 = gsqr(u); ui2 = ginv(u2);
  un = uin = gen_1;
  qd = q; B = prec2nbits(prec);
  for (n = 1;; n++)
  { /* qd = q^(4n-3), qn = q^(4(n-1)^2), un = u^(2n-2), uin = 1/un */
    long e = 0, eqn, prec2;
    GEN tmp, tmpprime;
    uin = gmul(uin, ui2);
    qn = gmul(qn, qd); /* q^((2n-1)^2) */
    tmp = gmul(qn, gsub(un, uin));
    tmpprime = gmulsg(2*n - 1, gmul(qn, gadd(un, uin)));
    S11 = odd(n)? gsub(S11, tmp): gadd(S11, tmp);
    S11prime = odd(n)? gsub(S11prime, tmpprime): gadd(S11prime, tmpprime);
    e = maxss(0, gexpo(un)); un = gmul(un, u2); e = maxss(e, gexpo(un));
    qd = gmul(qd, q2); qn = gmul(qn, qd); /* q^(4n^2) */
    eqn = gexpo(qn) + e; if (eqn < -B) break;
    qd = gmul(qd, q2);
    prec2 = minss(prec, nbits2prec(eqn + B + 64));
    qn = gprec_w(qn, prec2); qd = gprec_w(qd, prec2);
    un = gprec_w(un, prec2); uin = gprec_w(uin, prec2);
  }
  S11prime = gmul(S11prime, PiI2n(0, prec));
  S11all = gmul(u, mkcol2(S11, S11prime));
  S11all = mulcxpowIs(S11all, ct + 3);
  if (sumr & 7) S11all = gmul(e12(sumr * 3, prec), S11all);
  if (mpodd(k)) S11all = gneg(S11all);
  if (precold < prec) S11all = gprec_w(S11all, precold);
  return gc_upto(av, gmul(S, gmul(ginv(mat), S11all)));
}

/* is q = exp(2ipi tau) a real number ? */
static int
isqreal(GEN tau) { return gequal0(gfrac(gmul2n(real_i(tau), 1))); }
static void
cxE4E6(GEN tau, GEN *pE4, GEN *pE6, long prec)
{
  GEN z2, z3, z4, T0 = thetanull_i(tau, prec);
  int fl = isqreal(tau);
  z3 = gpowgs(gel(T0, 1), 4);
  z4 = gpowgs(gel(T0, 2), 4);
  z2 = gpowgs(gel(T0, 3), 4);
  if (pE4)
  {
    GEN e = gadd3(gsqr(z2), gsqr(z3), gsqr(z4));
    *pE4 = gmul2n(fl? real_i(e): e, -1); /* N.B. g2 = (2ipi)^4 E4 / 12 */
  }
  if (pE6)
  { /* the roots (e1,e2,e3) of 4x^3 - g2x - g3 are z3+z4, -(z2+z3), z2-z4 */
    GEN e = gmul3(gadd(z3, z4), gadd(z2, z3), gsub(z4, z2));
    *pE6 = gmul2n(fl? real_i(e): e, -1); /* N.B. g3 = (2ipi)^6 E6 / -216 */
  }
}

/* Weierstrass elliptic data in terms of thetas */
/* tau,z reduced */
static GEN
ellwp_cx(GEN tau, GEN z, GEN *pyp, long prec)
{
  GEN P, T0, T = thetaall(z, tau, &T0, prec);
  GEN z1 = gel(T0, 1), z3 = gel(T0, 3), t2 = gel(T, 2), t4 = gel(T, 4);
  P = gmul(pi23(prec), gsub(gmulgs(gsqr(gdiv(gmul3(z1, z3, t2), t4)), 3),
                            gadd(gpowgs(z1, 4), gpowgs(z3, 4))));
  if (pyp)
  {
    GEN t1 = gel(T, 1), t3 = gel(T, 3);
    GEN c = gmul(Pi2n(1, prec), gsqr(gel(T0, 4)));
    *pyp = gdiv(gmul4(c, t1, t2, t3), gpowgs(t4, 3));
  }
  return P;
}

/* computes the numerical value of wp(z | L), L = om1 Z + om2 Z
 * return NULL if z in L.  If flall=1, compute also wp' */
static GEN
ellwpnum_all(GEN e, GEN z, long flall, long prec)
{
  pari_sp av = avma;
  GEN yp = NULL, y, u1;
  ellred_t T;

  if (!get_periods(e, z, &T, prec)) pari_err_TYPE("ellwp",e);
  if (!T.Z) return NULL;
  prec = T.prec;

  /* Now L,Z normalized to <1,tau>. Z in fund. domain of <1, tau> */
  y = ellwp_cx(T.Tau, T.Z, flall? &yp: NULL, prec);
  u1 = gsqr(T.W2); y = gdiv(y, u1);
  if (yp) yp = gdiv(yp, gmul(u1, T.W2));
  if (T.some_q_is_real && (T.some_z_is_real || T.some_z_is_pure_imag))
    y = real_i(y);
  if (yp)
  {
    if (T.some_q_is_real)
    {
      if (T.some_z_is_real) yp = real_i(yp);
      else if (T.some_z_is_pure_imag) yp = mkcomplex(gen_0, imag_i(yp));
    }
    y = mkvec2(y, yp);
  }
  return gc_GEN(av, gprec_wtrunc(y, T.prec0));
}
static GEN
ellwpseries_aux(GEN c4, GEN c6, long v, long PRECDL)
{
  long i, k, l;
  pari_sp av;
  GEN _1, t, res = cgetg(PRECDL+2,t_SER), *P = (GEN*)(res + 2);

  res[1] = evalsigne(1) | _evalvalser(-2) | evalvarn(v);
  if (!PRECDL) { setsigne(res,0); return res; }

  for (i=1; i<PRECDL; i+=2) P[i]= gen_0;
  _1 = Rg_get_1(c4);
  switch(PRECDL)
  {
    default:P[6] = gdivgu(c6,6048);
    case 6:
    case 5: P[4] = gdivgu(c4, 240);
    case 4:
    case 3: P[2] = gmul(_1,gen_0);
    case 2:
    case 1: P[0] = _1;
  }
  if (PRECDL <= 8) return res;
  av = avma;
  P[8] = gc_upto(av, gdivgu(gsqr(P[4]), 3));
  for (k=5; (k<<1) < PRECDL; k++)
  {
    av = avma;
    t = gmul(P[4], P[(k-2)<<1]);
    for (l=3; (l<<1) < k; l++) t = gadd(t, gmul(P[l<<1], P[(k-l)<<1]));
    t = gmul2n(t, 1);
    if ((k & 1) == 0) t = gadd(gsqr(P[k]), t);
    if (k % 3 == 2)
      t = gdivgu(gmulsg(3, t), (k-3)*(2*k+1));
    else /* same value, more efficient */
      t = gdivgu(t, ((k-3)*(2*k+1)) / 3);
    P[k<<1] = gc_upto(av, t);
  }
  return res;
}

static int
get_c4c6(GEN w, GEN *c4, GEN *c6, long prec)
{
  if (typ(w) == t_VEC) switch(lg(w))
  {
    case 17:
      *c4 = ell_get_c4(w);
      *c6 = ell_get_c6(w); return 1;
    case 3:
    {
      GEN E4, E6, a2, a;
      ellred_t T;
      if (!get_periods(w,NULL,&T, prec)) break;
      a = gdiv(pi23(T.prec + EXTRAPREC64), gsqr(T.W2));
      cxE4E6(T.Tau, &E4, &E6, prec); a2 = gsqr(a);
      *c4 = gmul(gmulgs(E4, 144), a2);
      *c6 = gmul(gmulgs(E6, 1728), gmul(a2,a)); return 1;
    }
  }
  *c4 = *c6 = NULL;
  return 0;
}

GEN
ellwpseries(GEN e, long v, long PRECDL)
{
  GEN c4, c6;
  checkell(e);
  c4 = ell_get_c4(e);
  c6 = ell_get_c6(e); return ellwpseries_aux(c4,c6,v,PRECDL);
}

GEN
ellwp(GEN w, GEN z, long prec)
{ return ellwp0(w,z,0,prec); }

GEN
ellwp0(GEN w, GEN z, long flag, long prec)
{
  pari_sp av = avma;
  GEN y;

  if (flag && flag != 1) pari_err_FLAG("ellwp");
  if (!z) z = pol_x(0);
  y = toser_i(z);
  if (y)
  {
    long vy = varn(y), v = valser(y);
    GEN P, Q, c4,c6;
    if (!get_c4c6(w,&c4,&c6,prec)) pari_err_TYPE("ellwp",w);
    if (v <= 0) pari_err(e_IMPL,"ellwp(t_SER) away from 0");
    if (gequal0(y)) {
      set_avma(av);
      if (!flag) return zeroser(vy, -2*v);
      retmkvec2(zeroser(vy, -2*v), zeroser(vy, -3*v));
    }
    P = ellwpseries_aux(c4,c6, vy, lg(y)-2);
    Q = gsubst(P, varn(P), y);
    if (!flag)
      return gc_upto(av, Q);
    else
    {
      GEN R = mkvec2(Q, gdiv(derivser(Q), derivser(y)));
      return gc_GEN(av, R);
    }
  }
  y = ellwpnum_all(w,z,flag,prec);
  if (!y) pari_err_DOMAIN("ellwp", "argument","=", gen_0,z);
  return gc_upto(av, y);
}

static GEN
ellzeta_cx(ellred_t *T)
{
  GEN e, y, TALL = theta11prime(T->Z, T->Tau, T->prec), ETA = elleta_W(T);
  y = gadd(gmul(T->Z, gel(ETA,2)),
           gdiv(gel(TALL,2), gmul(gel(TALL,1), T->W2)));
  e = _period(T, ETA);
  if (T->some_q_is_real)
  {
    if (T->some_z_is_real)
    {
      if (e == gen_0 || typ(e) != t_COMPLEX) y = real_i(y);
    }
    else if (T->some_z_is_pure_imag)
    {
      if (e == gen_0 || (typ(e) == t_COMPLEX && isintzero(gel(e,1))))
        gel(y,1) = gen_0;
    }
  }
  return gprec_wtrunc(e != gen_0? gadd(y, e): y, T->prec0);
}
GEN
ellzeta(GEN w, GEN z, long prec0)
{
  pari_sp av = avma;
  ellred_t T;
  GEN y;

  if (!z) z = pol_x(0);
  y = toser_i(z);
  if (y)
  {
    long vy = varn(y), v = valser(y);
    GEN P, Q, c4,c6;
    if (!get_c4c6(w,&c4,&c6,prec0)) pari_err_TYPE("ellzeta",w);
    if (v <= 0) pari_err(e_IMPL,"ellzeta(t_SER) away from 0");
    if (gequal0(y)) { set_avma(av); return zeroser(vy, -v); }
    P = ellwpseries_aux(c4,c6, vy, lg(y)-2);
    P = integser(gneg(P)); /* \zeta' = - \wp*/
    Q = gsubst(P, varn(P), y);
    return gc_upto(av, Q);
  }
  if (!get_periods(w, z, &T, prec0)) pari_err_TYPE("ellzeta", w);
  if (!T.Z) pari_err_DOMAIN("ellzeta", "z", "=", gen_0, z);
  return gc_GEN(av, ellzeta_cx(&T));
}

static GEN
ellsigma_cx(ellred_t *T, long flag)
{
  long prec = T->prec;
  GEN t0, t = thetaall(T->Z, T->Tau, &t0, prec), ETA = elleta_W(T);
  GEN y1, y = gmul(T->W2, gdiv(gel(t, 4), gel(t0, 4)));

  /* y = W2 theta_1(q, Z) / theta_1'(q, 0)
   *   = sigma([W1, W2], W2 Z) * exp(-eta2 W2 Z^2/2)
   * We have z/W2 = Z + x Tau + y, so
   * sigma([W1,W2], z) = (-1)^(x+y+xy) sigma([W1,W2], W2 Z) exp(W2 y1) where
   *   y1 = eta2 Z^2/2 + (x eta1 + y eta2)(Z + (x Tau + y)/2) */

  y1 = gadd(T->Z, gmul2n(_period(T, mkvec2(T->Tau,gen_1)), -1));
  y1 = gadd(gmul(_period(T, ETA), y1),
            gmul2n(gmul(gsqr(T->Z),gel(ETA,2)), -1));
  if (flag)
  {
    y = gadd(gmul(T->W2,y1), glog(y,prec));
    if (mpodd(T->x) || mpodd(T->y)) y = gadd(y, PiI2n(0, prec));
    /* log(real number): im(y) = 0 or Pi */
    if (T->some_q_is_real && isintzero(imag_i(T->z)) && gexpo(imag_i(y)) < 1)
      y = real_i(y);
  }
  else
  {
    y = gmul(y, gexp(gmul(T->W2, y1), prec));
    if (mpodd(T->x) || mpodd(T->y)) y = gneg_i(y);
    if (T->some_q_is_real)
    {
      int re, cx;
      check_complex(T->z,&re,&cx);
      if (re) y = real_i(y);
      else if (cx && typ(y) == t_COMPLEX) gel(y,1) = gen_0;
    }
  }
  return gprec_wtrunc(y, T->prec0);
}
/* if flag=0, return ellsigma, otherwise return log(ellsigma) */
GEN
ellsigma(GEN w, GEN z, long flag, long prec0)
{
  pari_sp av = avma;
  ellred_t T;
  GEN y;

  if (flag < 0 || flag > 1) pari_err_FLAG("ellsigma");
  if (!z) z = pol_x(0);
  y = toser_i(z);
  if (y)
  {
    long vy = varn(y), v = valser(y);
    GEN P, Q, c4,c6;
    if (!get_c4c6(w,&c4,&c6,prec0)) pari_err_TYPE("ellsigma",w);
    if (v <= 0) pari_err_IMPL("ellsigma(t_SER) away from 0");
    if (flag) pari_err_TYPE("log(ellsigma)",y);
    if (gequal0(y)) { set_avma(av); return zeroser(vy, -v); }
    P = ellwpseries_aux(c4,c6, vy, lg(y)-2);
    P = integser(gneg(P)); /* \zeta' = - \wp*/
    /* (log \sigma)' = \zeta; remove log-singularity first */
    P = integser(serchop0(P));
    P = gexp(P, prec0);
    setvalser(P, valser(P)+1);
    Q = gsubst(P, varn(P), y);
    return gc_upto(av, Q);
  }
  if (!get_periods(w, z, &T, prec0)) pari_err_TYPE("ellsigma",w);
  if (!T.Z)
  {
    if (!flag) return gen_0;
    pari_err_DOMAIN("log(ellsigma)", "argument","=",gen_0,z);
  }
  return gc_GEN(av, ellsigma_cx(&T, flag));
}

GEN
pointell(GEN e, GEN z, long prec)
{
  pari_sp av = avma;
  GEN v;

  checkell(e);
  if (ell_get_type(e) == t_ELL_Qp)
  {
    prec = minss(ellQp_get_prec(e), padicprec_relative(z));
    return ellQp_t2P(e, z, prec);
  }
  v = ellwpnum_all(e,z,1,prec);
  if (!v) { set_avma(av); return ellinf(); }
  gel(v,1) = gsub(gel(v,1), gdivgu(ell_get_b2(e),12));
  gel(v,2) = gmul2n(gsub(gel(v,2), ec_h_evalx(e,gel(v,1))),-1);
  return gc_GEN(av, v);
}

/********************************************************************/
/**              Eisenstein series of level 1                      **/
/********************************************************************/

GEN
upper_to_cx(GEN x, long *prec)
{
  long tx = typ(x), l;
  if (tx == t_QUAD) { x = quadtofp(x, *prec); tx = typ(x); }
  switch(tx)
  {
    case t_COMPLEX:
      if (gsigne(gel(x,2)) > 0) break; /*fall through*/
    case t_REAL: case t_INT: case t_FRAC:
      pari_err_DOMAIN("modular function", "Im(argument)", "<=", gen_0, x);
    default:
      pari_err_TYPE("modular function", x);
  }
  l = precision(x); if (l) *prec = l;
  return x;
}

static GEN
qq(GEN x, long prec)
{
  long tx = typ(x);
  GEN y;

  if (is_scalar_t(tx))
  {
    if (tx == t_PADIC) return x;
    x = upper_to_cx(x, &prec);
    return cxtoreal(expIPiC(gmul2n(x,1), prec)); /* e(x) */
  }
  if (! ( y = toser_i(x)) ) pari_err_TYPE("modular function", x);
  return y;
}

/* P = ellwpseries_aux(E4, E6, 0, kmax), where kmax >= k+2. Beware we use
 * E4,E6 instead of c4,c6: coeffs rescale to (k-1) G_k / (2pi)^k */
static GEN
Ek_from_wp(GEN P, long k)
{ /* P[k+2] = Ek * (k-1) * 2 zeta(k) / (2pi)^k = Ek * (k-1) * |B_k| / k! */
  return gdiv(gmul(gel(P, k + 2), muliu(mpfact(k-2), k)),
              absfrac_shallow(bernfrac(k)));
}
/* P = ellwpseries(e, kmax), where kmax >= k+2 */
static GEN
elleis_from_wp(GEN P, long k)
{ return gneg(gmul(gel(P, k + 2), gdiv(muliu(mpfact(k-2), k), bernfrac(k)))); }

/* k > 0 even, tau reduced (in particular Im tau > 0). Return
 * E_k(tau) = 1 + 2/zeta(1-k) * sum_n n^(k-1) q^n/(1-q^n) */
GEN
cxEk(GEN tau, long k, long prec)
{
  pari_sp av = avma;
  GEN P, y, E4 = NULL, E6 = NULL;
  long b;

  if ((b = precision(tau))) prec = b;
  if (gcmpgs(imag_i(tau), (M_LN2 / (2*M_PI)) * (prec2nbits(prec)+1+10)) > 0)
    return real_1(prec);
  if (k == 2)
  { /* -theta^(3)(tau/2) / theta^(1)(tau/2) */
    y = vecthetanullk_loop(qq(tau,prec), 2, prec);
    return gdiv(gel(y,2), gel(y,1));
  }
  if (k > 8) cxE4E6(tau, &E4, &E6, k < 16? prec: prec + EXTRAPREC64);
  switch (k)
  {
    case 4:  cxE4E6(tau, &E4, NULL, prec); return gc_GEN(av, E4);
    case 6:  cxE4E6(tau, NULL, &E6, prec); return gc_GEN(av, E6);
    case 8:  cxE4E6(tau, &E4, NULL, prec); return gc_upto(av, gsqr(E4));
    case 10: return gc_upto(av, gmul(E4, E6));
    case 12:
    {
      GEN e = gadd(gmulsg(441, gpowgs(E4,3)), gmulsg(250, gsqr(E6)));
      return gc_upto(av, gdivgs(e, 691));
    }
    case 14: return gc_upto(av, gmul(gsqr(E4), E6));
  }
  P = ellwpseries_aux(E4, E6, 0, k + 2);
  return gc_GEN(av, gprec_wtrunc(Ek_from_wp(P, k), prec));
}

static GEN
E2_correction(ellred_t *T)
{ return gmul(mului(12, T->c), PiI2div(gmul(T->W2,T->w2), T->prec)); }

/* Return y = (2iPi)^k E_k(L) = (2iPi/w2)^k E_k(tau), L = <w1,w2>, k > 0 even.
 * Let G_k(L) = sum' 1/l^k = 2 zeta(k) E_k(L) =  - y * B_k / k! then
 *   z^2 wp(L,z) = 1 + sum_{k > 1} (k-1)G_k z^k */
GEN
elleisnum(GEN om, long k, long prec)
{
  pari_sp av = avma;
  GEN y, w, Ek;
  ellred_t T;

  elleisnum_testk(k);
  if (checkell_i(om)) switch(k)
  {
    case 2:
      y = ellR_eta(om, prec);
      w = ellR_omega(om, prec);
      return gc_upto(av, gdiv(gmulgs(gel(y,2), -12), gel(w,2)));
    case 4: return gcopy(ell_get_c4(om));
    case 6: return gneg(ell_get_c6(om));
    default:
      y = ellwpseries(om, 0, k + 2);
      return gc_upto(av, elleis_from_wp(y, k));
  }
  if (!get_periods(om, NULL, &T, prec)) pari_err_TYPE("elleisnum",om);
  Ek = cxEk(T.Tau, k, T.prec);
  y = cxtoreal( gmul(Ek, gpowgs(PiI2div_sqr(T.W2, T.prec), k/2)));
  if (k==2 && signe(T.c)) y = gsub(y, E2_correction(&T));
  return gc_GEN(av, gprec_wtrunc(y, T.prec0));
}

GEN
elleisnum0(GEN om, GEN k, long prec)
{
  pari_sp av = avma;
  GEN iW2, W, E4, E6, vG, P = NULL;
  long i, l, kmax;
  ellred_t T;

  if (typ(k) == t_INT) return elleisnum(om, itos(k), prec);
  if (typ(k) != t_VEC || !RgV_is_ZV(k)) pari_err_TYPE("elleisnum",k);
  l = lg(k); if (l == 2) retmkvec(elleisnum(om, itos(gel(k,1)), prec));
  k = ZV_to_zv(k); kmax = 0;
  for (i = 1; i < l; i++)
  {
    elleisnum_testk(k[i]);
    if (k[i] > kmax) kmax = k[i];
  }
  if (checkell_i(om))
  {
    if (l == 1) { set_avma(av); return cgetg(1, t_VEC); }
    P = ellwpseries(om, 0, kmax + 2);
    vG = cgetg(l, t_VEC);
    for (i = 1; i < l; i++)
    {
      long ki = k[i];
      gel(vG, i) = (ki == 2)? elleisnum(om, 2, prec) : elleis_from_wp(P, ki);
    }
    return gc_GEN(av, vG);
  }
  if (!get_periods(om, NULL, &T, prec)) pari_err_TYPE("elleisnum",om);
  if (l == 1) { set_avma(av); return cgetg(1, t_VEC); }
  cxE4E6(T.tau, &E4, &E6, kmax < 16? prec: prec + EXTRAPREC64);
  if (kmax > 10) P = ellwpseries_aux(E4, E6, 0, kmax+2);
  iW2 = PiI2div_sqr(T.W2, prec); /* (2iPi / W2)^2 */
  W = gpowers0(iW2, kmax/2, iW2); /* .[k] = (2ipi/W2)^(2k) */
  vG = cgetg(l, t_VEC);
  for (i = 1; i < l; i++)
  {
    long ki = k[i];
    GEN e, G;
    switch(ki)
    {
      case 2: e = cxEk(T.Tau, 2, prec); break;
      case 4: e = E4; break;
      case 6: e = E6; break;
      case 8: e = gsqr(E4); break;
      case 10:e = gmul(E4, E6); break;
      default: e = Ek_from_wp(P, ki);
    }
    G = cxtoreal( gmul(e, gel(W, ki/2)) ); /* (2iPi/W2)^ki E_k(W1/W2) */
    if (ki == 2 && signe(T.c)) G = gsub(G, E2_correction(&T));
    gel(vG, i) = gprec_wtrunc(G, T.prec0);
  }
  return gc_GEN(av, vG);
}

/********************************************************************/
/**                 Eta function(s) and j-invariant                **/
/********************************************************************/

/* return (y * X^d) + x. Assume d > 0, x != 0, valser(x) = 0 */
static GEN
ser_addmulXn(GEN y, GEN x, long d)
{
  long i, lx, ly, l = valser(y) + d; /* > 0 */
  GEN z;

  lx = lg(x);
  ly = lg(y) + l; if (lx < ly) ly = lx;
  if (l > lx-2) return gcopy(x);
  z = cgetg(ly,t_SER);
  for (i=2; i<=l+1; i++) gel(z,i) = gel(x,i);
  for (   ; i < ly; i++) gel(z,i) = gadd(gel(x,i),gel(y,i-l));
  z[1] = x[1]; return z;
}

/* q a t_POL s.t. q(0) != 0, v > 0, Q = x^v*q; return \prod_i (1-Q^i) */
static GEN
RgXn_eta(GEN q, long v, long lim)
{
  pari_sp av = avma;
  GEN qn, ps, y;
  ulong vps, vqn, n;

  if (!degpol(q) && isint1(gel(q,2))) return eta_ZXn(v, lim+v);
  y = qn = ps = pol_1(0);
  vps = vqn = 0;
  for(n = 0;; n++)
  { /* qn = q^n,  ps = (-1)^n q^(n(3n+1)/2),
     * vps, vqn valuation of ps, qn HERE */
    pari_sp av2 = avma;
    ulong vt = vps + 2*vqn + v; /* valuation of t at END of loop body */
    long k1, k2;
    GEN t;
    vqn += v; vps = vt + vqn; /* valuation of qn, ps at END of body */
    k1 = lim + v - vt + 1;
    k2 = k1 - vqn; /* = lim + v - vps + 1 */
    if (k1 <= 0) break;
    t = RgX_mul(q, RgX_sqr(qn));
    t = RgXn_red_shallow(t, k1);
    t = RgX_mul(ps,t);
    t = RgXn_red_shallow(t, k1);
    t = RgX_neg(t); /* t = (-1)^(n+1) q^(n(3n+1)/2 + 2n+1) */
    t = gc_upto(av2, t);
    y = RgX_addmulXn_shallow(t, y, vt);
    if (k2 <= 0) break;

    qn = RgX_mul(qn,q);
    ps = RgX_mul(t,qn);
    ps = RgXn_red_shallow(ps, k2);
    y = RgX_addmulXn_shallow(ps, y, vps);

    if (gc_needed(av,1))
    {
      if(DEBUGMEM>1) pari_warn(warnmem,"eta, n = %ld", n);
      (void)gc_all(av, 3, &y, &qn, &ps);
    }
  }
  return y;
}

static GEN
inteta(GEN q)
{
  long tx = typ(q);
  GEN ps, qn, y;

  y = gen_1; qn = gen_1; ps = gen_1;
  if (tx==t_PADIC)
  {
    if (valp(q) <= 0) pari_err_DOMAIN("eta", "v_p(q)", "<=",gen_0,q);
    for(;;)
    {
      GEN t = gneg_i(gmul(ps,gmul(q,gsqr(qn))));
      y = gadd(y,t); qn = gmul(qn,q); ps = gmul(t,qn);
      t = y;
      y = gadd(y,ps); if (gequal(t,y)) return y;
    }
  }

  if (tx == t_SER)
  {
    ulong vps, vqn;
    long l = lg(q), v, n;
    pari_sp av;

    v = valser(q); /* handle valuation separately to avoid overflow */
    if (v <= 0) pari_err_DOMAIN("eta", "v_p(q)", "<=",gen_0,q);
    y = ser2pol_i(q, l); /* t_SER inefficient when input has low degree */
    n = degpol(y);
    if (n <= (l>>2))
    {
      GEN z = RgXn_eta(y, v, l-2);
      setvarn(z, varn(y)); return RgX_to_ser(z, l+v);
    }
    q = leafcopy(q); av = avma;
    setvalser(q, 0);
    y = scalarser(gen_1, varn(q), l+v);
    vps = vqn = 0;
    for(n = 0;; n++)
    { /* qn = q^n,  ps = (-1)^n q^(n(3n+1)/2) */
      ulong vt = vps + 2*vqn + v;
      long k;
      GEN t;
      t = gneg_i(gmul(ps,gmul(q,gsqr(qn))));
      /* t = (-1)^(n+1) q^(n(3n+1)/2 + 2n+1) */
      y = ser_addmulXn(t, y, vt);
      vqn += v; vps = vt + vqn;
      k = l+v - vps; if (k <= 2) return y;

      qn = gmul(qn,q); ps = gmul(t,qn);
      y = ser_addmulXn(ps, y, vps);
      setlg(q, k);
      setlg(qn, k);
      setlg(ps, k);
      if (gc_needed(av,3))
      {
        if(DEBUGMEM>1) pari_warn(warnmem,"eta");
        (void)gc_all(av, 3, &y, &qn, &ps);
      }
    }
  }
  {
    long l = -prec2nbits(precision(q));
    pari_sp av = avma;

    for(;;)
    {
      GEN t = gneg_i(gmul(ps,gmul(q,gsqr(qn))));
      /* qn = q^n
       * ps = (-1)^n q^(n(3n+1)/2)
       * t = (-1)^(n+1) q^(n(3n+1)/2 + 2n+1) */
      y = gadd(y,t); qn = gmul(qn,q); ps = gmul(t,qn);
      y = gadd(y,ps);
      if (gexpo(ps)-gexpo(y) < l) return y;
      if (gc_needed(av,3))
      {
        if(DEBUGMEM>1) pari_warn(warnmem,"eta");
        (void)gc_all(av, 3, &y, &qn, &ps);
      }
    }
  }
}

GEN
eta(GEN x, long prec)
{
  pari_sp av = avma;
  GEN z = inteta( qq(x,prec) );
  if (typ(z) == t_SER) return gc_GEN(av, z);
  return gc_upto(av, z);
}

/* s(h,k) = sum(n = 1, k-1, (n/k)*(frac(h*n/k) - 1/2))
 * Knuth's algorithm. h integer, k integer > 0, (h,k) = 1 */
GEN
sumdedekind_coprime(GEN h, GEN k)
{
  pari_sp av = avma;
  GEN s2, s1, p, pp;
  long s;
  if (lgefint(k) == 3 && uel(k,2) <= (2*(ulong)LONG_MAX) / 3)
  {
    ulong kk = k[2], hh = umodiu(h, kk);
    long s1, s2;
    GEN v;
    if (signe(k) < 0) { k = negi(k); hh = Fl_neg(hh, kk); }
    v = u_sumdedekind_coprime(hh, kk);
    s1 = v[1]; s2 = v[2];
    return gc_upto(av, gdiv(addis(mulis(k,s1), s2), muluu(12, kk)));
  }
  s = 1;
  s1 = gen_0; p = gen_1; pp = gen_0;
  s2 = h = modii(h, k);
  while (signe(h)) {
    GEN r, nexth, a = dvmdii(k, h, &nexth);
    if (is_pm1(h)) s2 = s == 1? addii(s2, p): subii(s2, p);
    s1 = s == 1? addii(s1, a): subii(s1, a);
    s = -s;
    k = h; h = nexth;
    r = addii(mulii(a,p), pp); pp = p; p = r;
  }
  /* at this point p = original k */
  if (s == -1) s1 = subiu(s1, 3);
  return gc_upto(av, gdiv(addii(mulii(p,s1), s2), muliu(p,12)));
}
/* as above, for ulong arguments.
 * k integer > 0, 0 <= h < k, (h,k) = 1. Returns [s1,s2] such that
 * s(h,k) = (s2 + k s1) / (12k). Requires max(h + k/2, k) < LONG_MAX
 * to avoid overflow, in particular k <= LONG_MAX * 2/3 is fine */
GEN
u_sumdedekind_coprime(long h, long k)
{
  long s = 1, s1 = 0, s2 = h, p = 1, pp = 0;
  while (h) {
    long r, nexth = k % h, a = k / h; /* a >= 1, a >= 2 if h = 1 */
    if (h == 1) s2 += p * s; /* occurs exactly once, last step */
    s1 += a * s;
    s = -s;
    k = h; h = nexth;
    r = a*p + pp; pp = p; p = r; /* p >= pp >= 0 */
  }
  /* in the above computation, p increases from 1 to original k,
   * -k/2 <= s2 <= h + k/2, and |s1| <= k */
  if (s < 0) s1 -= 3; /* |s1| <= k+3 ? */
  /* But in fact, |s2 + p s1| <= k^2 + 1/2 - 3k; if (s < 0), we have
   * |s2| <= k/2 and it follows that |s1| < k here as well */
  /* p = k; s(h,k) = (s2 + p s1)/12p. */
  return mkvecsmall2(s1, s2);
}
GEN
sumdedekind(GEN h, GEN k)
{
  pari_sp av = avma;
  GEN d;
  if (typ(h) != t_INT) pari_err_TYPE("sumdedekind",h);
  if (typ(k) != t_INT) pari_err_TYPE("sumdedekind",k);
  d = gcdii(h,k);
  if (!is_pm1(d))
  {
    h = diviiexact(h, d);
    k = diviiexact(k, d);
  }
  return gc_upto(av, sumdedekind_coprime(h,k));
}

/* eta(x); assume Im x >> 0 (e.g. x in SL2's standard fundamental domain) */
static GEN
eta_reduced(GEN x, long prec)
{
  GEN z = expIPiC(gdivgu(x, 12), prec); /* e(x/24) */
  if (24 * gexpo(z) >= -prec2nbits(prec))
    z = gmul(z, inteta( gpowgs(z,24) ));
  return z;
}

/* x = U.z (flag = 1), or x = U^(-1).z (flag = 0)
 * Return [s,t] such that eta(z) = eta(x) * sqrt(s) * exp(I Pi t) */
static GEN
eta_correction(GEN x, GEN U, long flag)
{
  GEN a,b,c,d, s,t;
  long sc;
  a = gcoeff(U,1,1);
  b = gcoeff(U,1,2);
  c = gcoeff(U,2,1);
  d = gcoeff(U,2,2);
  /* replace U by U^(-1) */
  if (flag) {
    swap(a,d);
    togglesign_safe(&b);
    togglesign_safe(&c);
  }
  sc = signe(c);
  if (!sc) {
    if (signe(d) < 0) togglesign_safe(&b);
    s = gen_1;
    t = uutoQ(umodiu(b, 24), 12);
  } else {
    if (sc < 0) {
      togglesign_safe(&a);
      togglesign_safe(&b);
      togglesign_safe(&c);
      togglesign_safe(&d);
    } /* now c > 0 */
    s = mulcxmI(gadd(gmul(c,x), d));
    t = gadd(gdiv(addii(a,d),muliu(c,12)), sumdedekind_coprime(negi(d),c));
    /* correction : exp(I Pi (((a+d)/12c) + s(-d,c)) ) sqrt(-i(cx+d))  */
  }
  return mkvec2(s, t);
}

/* returns the true value of eta(x) for Im(x) > 0, using reduction to
 * standard fundamental domain */
GEN
trueeta(GEN x, long prec)
{
  pari_sp av = avma;
  GEN U, st, s, t;

  if (!is_scalar_t(typ(x))) pari_err_TYPE("trueeta",x);
  x = upper_to_cx(x, &prec);
  x = cxredsl2(x, &U);
  st = eta_correction(x, U, 1);
  x = eta_reduced(x, prec);
  s = gel(st, 1);
  t = gel(st, 2);
  x = gmul(x, expIPiQ(t, prec));
  if (s != gen_1) x = gmul(x, gsqrt(s, prec));
  return gc_upto(av, x);
}

GEN
eta0(GEN x, long flag,long prec)
{ return flag? trueeta(x,prec): eta(x,prec); }

/* eta(q) = 1 + \sum_{n>0} (-1)^n * (q^(n(3n-1)/2) + q^(n(3n+1)/2)) */
static GEN
ser_eta(long prec)
{
  GEN e = cgetg(prec+2, t_SER), ed = e+2;
  long n, j;
  e[1] = evalsigne(1)|_evalvalser(0)|evalvarn(0);
  gel(ed,0) = gen_1;
  for (n = 1; n < prec; n++) gel(ed,n) = gen_0;
  for (n = 1, j = 0; n < prec; n++)
  {
    GEN s;
    j += 3*n-2; /* = n*(3*n-1) / 2 */;
    if (j >= prec) break;
    s = odd(n)? gen_m1: gen_1;
    gel(ed, j) = s;
    if (j+n >= prec) break;
    gel(ed, j+n) = s;
  }
  return e;
}

static GEN
coeffEu(GEN fa)
{
  pari_sp av = avma;
  return gc_INT(av, mului(65520, usumdivk_fact(fa,11)));
}
/* E12 = 1 + q*E/691 */
static GEN
ser_E(long prec)
{
  GEN e = cgetg(prec+2, t_SER), ed = e+2;
  GEN F = vecfactoru_i(2, prec); /* F[n] = factoru(n+1) */
  long n;
  e[1] = evalsigne(1)|_evalvalser(0)|evalvarn(0);
  gel(ed,0) = utoipos(65520);
  for (n = 1; n < prec; n++) gel(ed,n) = coeffEu(gel(F,n));
  return e;
}
/* j = E12/Delta + 432000/691, E12 = 1 + q*E/691 */
static GEN
ser_j2(long prec, long v)
{
  pari_sp av = avma;
  GEN iD = gpowgs(ginv(ser_eta(prec)), 24); /* q/Delta */
  GEN J = gmul(ser_E(prec), iD);
  setvalser(iD,-1); /* now 1/Delta */
  J = gadd(gdivgu(J, 691), iD);
  J = gc_upto(av, J);
  if (prec > 1) gel(J,3) = utoipos(744);
  setvarn(J,v); return J;
}

/* j(q) = \sum_{n >= -1} c(n)q^n,
 * \sum_{n = -1}^{N-1} c(n) (-10n \sigma_3(N-n) + 21 \sigma_5(N-n))
 * = c(N) (N+1)/24 */
static GEN
ser_j(long prec, long v)
{
  GEN j, J, S3, S5, F;
  long i, n;
  if (prec > 64) return ser_j2(prec, v);
  S3 = cgetg(prec+1, t_VEC);
  S5 = cgetg(prec+1,t_VEC);
  F = vecfactoru_i(1, prec);
  for (n = 1; n <= prec; n++)
  {
    GEN fa = gel(F,n);
    gel(S3,n) = mului(10, usumdivk_fact(fa,3));
    gel(S5,n) = mului(21, usumdivk_fact(fa,5));
  }
  J = cgetg(prec+2, t_SER),
  J[1] = evalvarn(v)|evalsigne(1)|evalvalser(-1);
  j = J+3;
  gel(j,-1) = gen_1;
  gel(j,0) = utoipos(744);
  gel(j,1) = utoipos(196884);
  for (n = 2; n < prec; n++)
  {
    pari_sp av = avma;
    GEN c, s3 = gel(S3,n+1), s5 = gel(S5,n+1);
    c = addii(s3, s5);
    for (i = 0; i < n; i++)
    {
      s3 = gel(S3,n-i); s5 = gel(S5,n-i);
      c = addii(c, mulii(gel(j,i), subii(s5, mului(i,s3))));
    }
    gel(j,n) = gc_INT(av, diviuexact(muliu(c,24), n+1));
  }
  return J;
}

GEN
jell(GEN x, long prec)
{
  long tx = typ(x);
  pari_sp av = avma;
  GEN q, h, U;

  if (!is_scalar_t(tx))
  {
    long v;
    if (gequalX(x)) return ser_j(precdl, varn(x));
    q = toser_i(x); if (!q) pari_err_TYPE("ellj",x);
    v = fetch_var_higher();
    h = ser_j(lg(q)-2, v);
    h = gsubst(h, v, q);
    delete_var(); return gc_upto(av, h);
  }
  if (tx == t_PADIC)
  {
    GEN p2, p1 = gdiv(inteta(gsqr(x)), inteta(x));
    p1 = gmul2n(gsqr(p1),1);
    p1 = gmul(x,gpowgs(p1,12));
    p2 = gaddsg(768,gadd(gsqr(p1),gdivsg(4096,p1)));
    p1 = gmulsg(48,p1);
    return gc_upto(av, gadd(p2,p1));
  }
  /* Let h = Delta(2x) / Delta(x), then j(x) = (1 + 256h)^3 / h */
  x = upper_to_cx(x, &prec);
  x = cxredsl2(x, &U); /* forget about Ua : j has weight 0 */
  { /* cf eta_reduced, raised to power 24
     * Compute
     *   t = (inteta(q(2x)) / inteta(q(x))) ^ 24;
     * then
     *   h = t * (q(2x) / q(x) = t * q(x);
     * but inteta(q) costly and useless if expo(q) << 1  => inteta(q) = 1.
     * log_2 ( exp(-2Pi Im tau) ) < -prec2nbits(prec)
     * <=> Im tau > prec2nbits(prec) * log(2) / 2Pi */
    long C = (long)prec2nbits_mul(prec, M_LN2/(2*M_PI));
    q = expIPiC(gmul2n(x,1), prec); /* e(x) */
    if (gcmpgs(gel(x,2), C) > 0) /* eta(q(x)) = 1 : no need to compute q(2x) */
      h = q;
    else
    {
      GEN t = gdiv(inteta(gsqr(q)), inteta(q));
      h = gmul(q, gpowgs(t, 24));
    }
  }
  /* real_1 important ! gaddgs(, 1) could increase the accuracy ! */
  return gc_upto(av, gdiv(gpowgs(gadd(gmul2n(h,8), real_1(prec)), 3), h));
}

static GEN
to_form(GEN a, GEN w, GEN C, GEN D)
{ return mkqfb(a, w, diviiexact(C, a), D); }
static GEN
form_to_quad(GEN f, GEN sqrtD)
{
  long a = itos(gel(f,1)), a2 = a << 1;
  GEN b = gel(f,2);
  return mkcomplex(gdivgs(b, -a2), gdivgs(sqrtD, a2));
}
static GEN
eta_form(GEN f, GEN sqrtD, GEN *s_t, long prec)
{
  GEN U, t = form_to_quad(redimagsl2(f, &U), sqrtD);
  *s_t = eta_correction(t, U, 0);
  return eta_reduced(t, prec);
}

/* eta(t/p)eta(t/q) / (eta(t)eta(t/pq)), t = (-w + sqrt(D)) / 2a */
GEN
double_eta_quotient(GEN a, GEN w, GEN D, long p, long q, GEN pq, GEN sqrtD)
{
  GEN C = shifti(subii(sqri(w), D), -2);
  GEN d, t, z, zp, zq, zpq, s_t, s_tp, s_tpq, s, sp, spq;
  long prec = realprec(sqrtD);

  z = eta_form(to_form(a, w, C, D), sqrtD, &s_t, prec);
  s = gel(s_t, 1);
  zp = eta_form(to_form(mului(p, a), w, C, D), sqrtD, &s_tp, prec);
  sp = gel(s_tp, 1);
  zpq = eta_form(to_form(mulii(pq, a), w, C, D), sqrtD, &s_tpq, prec);
  spq = gel(s_tpq, 1);
  if (p == q) {
    z = gdiv(gsqr(zp), gmul(z, zpq));
    t = gsub(gmul2n(gel(s_tp,2), 1),
             gadd(gel(s_t,2), gel(s_tpq,2)));
    if (sp != gen_1) z = gmul(z, sp);
  } else {
    GEN s_tq, sq;
    zq = eta_form(to_form(mului(q, a), w, C, D), sqrtD, &s_tq, prec);
    sq = gel(s_tq, 1);
    z = gdiv(gmul(zp, zq), gmul(z, zpq));
    t = gsub(gadd(gel(s_tp,2), gel(s_tq,2)),
             gadd(gel(s_t,2), gel(s_tpq,2)));
    if (sp != gen_1) z = gmul(z, gsqrt(sp, prec));
    if (sq != gen_1) z = gmul(z, gsqrt(sq, prec));
  }
  d = NULL;
  if (s != gen_1) d = gsqrt(s, prec);
  if (spq != gen_1) {
    GEN x = gsqrt(spq, prec);
    d = d? gmul(d, x): x;
  }
  if (d) z = gdiv(z, d);
  return gmul(z, expIPiQ(t, prec));
}

typedef struct { GEN u; long v, t; } cxanalyze_t;

/* Check whether a t_COMPLEX, t_REAL or t_INT z != 0 can be written as
 * z = u * 2^(v/2) * exp(I Pi/4 t), u > 0, v = 0,1 and -3 <= t <= 4.
 * Allow z t_INT/t_REAL to simplify handling of eta_correction() output */
static int
cxanalyze(cxanalyze_t *T, GEN z)
{
  GEN a, b;
  long ta, tb;

  T->u = z;
  T->v = 0;
  if (is_intreal_t(typ(z)))
  {
    T->u = mpabs_shallow(z);
    T->t = signe(z) < 0? 4: 0;
    return 1;
  }
  a = gel(z,1); ta = typ(a);
  b = gel(z,2); tb = typ(b);

  T->t = 0;
  if (ta == t_INT && !signe(a))
  {
    T->u = R_abs_shallow(b);
    T->t = gsigne(b) < 0? -2: 2;
    return 1;
  }
  if (tb == t_INT && !signe(b))
  {
    T->u = R_abs_shallow(a);
    T->t = gsigne(a) < 0? 4: 0;
    return 1;
  }
  if (ta != tb || ta == t_REAL) return 0;
  /* a,b both non zero, both t_INT or t_FRAC */
  if (ta == t_INT)
  {
    if (!absequalii(a, b)) return 0;
    T->u = absi_shallow(a);
    T->v = 1;
    if (signe(a) == signe(b))
    { T->t = signe(a) < 0? -3: 1; }
    else
    { T->t = signe(a) < 0? 3: -1; }
  }
  else
  {
    if (!absequalii(gel(a,2), gel(b,2)) || !absequalii(gel(a,1),gel(b,1)))
      return 0;
    T->u = absfrac_shallow(a);
    T->v = 1;
    a = gel(a,1);
    b = gel(b,1);
    if (signe(a) == signe(b))
    { T->t = signe(a) < 0? -3: 1; }
    else
    { T->t = signe(a) < 0? 3: -1; }
  }
  return 1;
}

/* z * sqrt(st_b) / sqrt(st_a) exp(I Pi (t + t0)). Assume that
 * sqrt2 = gsqrt(gen_2, prec) or NULL */
static GEN
apply_eta_correction(GEN z, GEN st_a, GEN st_b, GEN t0, GEN sqrt2, long prec)
{
  GEN t, s_a = gel(st_a, 1), s_b = gel(st_b, 1);
  cxanalyze_t Ta, Tb;
  int ca, cb;

  t = gsub(gel(st_b,2), gel(st_a,2));
  if (t0 != gen_0) t = gadd(t, t0);
  ca = cxanalyze(&Ta, s_a);
  cb = cxanalyze(&Tb, s_b);
  if (ca || cb)
  { /* compute sqrt(s_b) / sqrt(s_a) in a more efficient way:
     * sb = ub sqrt(2)^vb exp(i Pi/4 tb) */
    GEN u = gdiv(Tb.u,Ta.u);
    switch(Tb.v - Ta.v)
    {
      case -1: u = gmul2n(u,-1); /* fall through: write 1/sqrt2 = sqrt2/2 */
      case 1: u = gmul(u, sqrt2? sqrt2: sqrtr_abs(real2n(1, prec)));
    }
    if (!isint1(u)) z = gmul(z, gsqrt(u, prec));
    t = gadd(t, gmul2n(stoi(Tb.t - Ta.t), -3));
  }
  else
  {
    z = gmul(z, gsqrt(s_b, prec));
    z = gdiv(z, gsqrt(s_a, prec));
  }
  return gmul(z, expIPiQ(t, prec));
}

/* sqrt(2) eta(2x) / eta(x) */
GEN
weberf2(GEN x, long prec)
{
  pari_sp av = avma;
  GEN z, sqrt2, a,b, Ua,Ub, st_a,st_b;

  x = upper_to_cx(x, &prec);
  a = cxredsl2(x, &Ua);
  b = cxredsl2(gmul2n(x,1), &Ub);
  if (gequal(a,b)) /* not infrequent */
    z = gen_1;
  else
    z = gdiv(eta_reduced(b,prec), eta_reduced(a,prec));
  st_a = eta_correction(a, Ua, 1);
  st_b = eta_correction(b, Ub, 1);
  sqrt2 = sqrtr_abs(real2n(1, prec));
  z = apply_eta_correction(z, st_a, st_b, gen_0, sqrt2, prec);
  return gc_upto(av, gmul(z, sqrt2));
}

/* eta(x/2) / eta(x) */
GEN
weberf1(GEN x, long prec)
{
  pari_sp av = avma;
  GEN z, a,b, Ua,Ub, st_a,st_b;

  x = upper_to_cx(x, &prec);
  a = cxredsl2(x, &Ua);
  b = cxredsl2(gmul2n(x,-1), &Ub);
  if (gequal(a,b)) /* not infrequent */
    z = gen_1;
  else
    z = gdiv(eta_reduced(b,prec), eta_reduced(a,prec));
  st_a = eta_correction(a, Ua, 1);
  st_b = eta_correction(b, Ub, 1);
  z = apply_eta_correction(z, st_a, st_b, gen_0, NULL, prec);
  return gc_upto(av, z);
}
/* exp(-I*Pi/24) * eta((x+1)/2) / eta(x) */
GEN
weberf(GEN x, long prec)
{
  pari_sp av = avma;
  GEN z, t0, a,b, Ua,Ub, st_a,st_b;
  x = upper_to_cx(x, &prec);
  a = cxredsl2(x, &Ua);
  b = cxredsl2(gmul2n(gaddgs(x,1),-1), &Ub);
  if (gequal(a,b)) /* not infrequent */
    z = gen_1;
  else
    z = gdiv(eta_reduced(b,prec), eta_reduced(a,prec));
  st_a = eta_correction(a, Ua, 1);
  st_b = eta_correction(b, Ub, 1);
  t0 = mkfrac(gen_m1, utoipos(24));
  z = apply_eta_correction(z, st_a, st_b, t0, NULL, prec);
  if (typ(z) == t_COMPLEX && isexactzero(real_i(x)))
    z = gc_GEN(av, gel(z,1));
  else
    z = gc_upto(av, z);
  return z;
}
GEN
weber0(GEN x, long flag,long prec)
{
  switch(flag)
  {
    case 0: return weberf(x,prec);
    case 1: return weberf1(x,prec);
    case 2: return weberf2(x,prec);
    default: pari_err_FLAG("weber");
  }
  return NULL; /* LCOV_EXCL_LINE */
}

/********************************************************************/
/**                     Jacobi sn, cn, dn                          **/
/********************************************************************/

static GEN
elljacobi_cx(GEN z, GEN k, long prec)
{
  GEN K = ellK(k, prec), Kp = ellK(gsqrt(gsubsg(1, gsqr(k)), prec), prec);
  GEN zet = gdiv(gmul2n(z, -1), K), tau = mulcxI(gdiv(Kp, K));
  GEN T0, T = thetaall(zet, tau, &T0, prec);
  GEN t1 = gneg(gel(T,4)), t2 = gel(T,3), t3 = gel(T,1), t4 = gel(T,2);
  GEN z2 = gel(T0,3), z3 = gel(T0,1), z4 = gel(T0,2), z2t4 = gmul(z2, t4);
  GEN SN, CN, DN;
  SN = gdiv(gmul(z3, t1), z2t4);
  CN = gdiv(gmul(z4, t2), z2t4);
  DN = gdiv(gmul(z4, t3), gmul(z3, t4));
  return mkvec3(SN, CN, DN);
}

/* N >= 1 */
static GEN
elljacobi_pol(long N, GEN k)
{
  GEN S = cgetg(N, t_VEC), C = cgetg(N+1, t_VEC), D = cgetg(N+1, t_VEC);
  GEN SS, SC, SD, F, P, k2 = gsqr(k);
  long n, j;
  if (N == 1)
  {
    SS = cgetg(2, t_SER); SS[1] = evalsigne(0) | _evalvalser(1);
    SC = cgetg(4, t_SER); SC[1] = evalsigne(1) | _evalvalser(0);
    SD = cgetg(4, t_SER); SD[1] = evalsigne(1) | _evalvalser(0);
    gel(SC, 2) = gel(SD, 2) = gen_1;
    gel(SC, 3) = gel(SD, 3) = gen_0; return mkvec3(SS, SC, SD);
  }
  /* N > 1 */
  gel(C,1) = gel(D,1) = gel(S,1) = gen_1;
  P = matqpascal(2*N-1, NULL);
  for (n = 1; n < N; n++)
  {
    GEN TD, TC, TS;
    TC = gmulgs(gel(D, n), 2*n-1);
    TD = gmulgs(gel(C, n), 2*n-1); /* j = 0 */
    for (j = 1; j < n; j++)
    {
      GEN a  = gmul(gcoeff(P, 1 + 2*n-1, 1 + 2*j+1), gel(S, j+1));
      TC = gadd(TC, gmul(a, gel(D, n-j)));
      TD = gadd(TD, gmul(a, gel(C, n-j)));
    }
    gel(C, n+1) = TC;
    gel(D, n+1) = gmul(TD, k2);
    if (n+1 == N) break;
    TS = gadd(gel(C, n+1), gel(D, n+1)); /* j = 0 and n */
    for (j = 1; j < n; j++)
      TS = gadd(TS, gmul3(gcoeff(P, 1+2*n, 1+2*j), gel(C,j+1), gel(D,n+1-j)));
    gel(S, n+1) = TS;
  }
  F = cgetg(2*N, t_VEC); gel(F,1) = gen_1;
  for (j = 2; j < 2*N; j++) gel(F,j) = mulis(gel(F,j-1), odd(j)? j: -j);
  SS = cgetg(2*N, t_SER);   SS[1] = evalsigne(1) | _evalvalser(1);
  SC = cgetg(2*N+2, t_SER); SC[1] = evalsigne(1) | _evalvalser(0);
  SD = cgetg(2*N+2, t_SER); SD[1] = evalsigne(1) | _evalvalser(0);
  gel(SC, 2) = gel(SD, 2) = gel(SS, 2) = gen_1;
  gel(SC, 3) = gel(SD, 3) = gel(SS, 3) = gen_0;
  for (j = 2; j <= N; j++)
  {
    GEN q = gel(F, 2*j-2); /* (-1)^(j-1) (2j-2)! */
    gel(SC, 2*j) = gdiv(gel(C,j), q);
    gel(SD, 2*j) = gdiv(gel(D,j), q);
    gel(SC, 2*j+1) = gen_0;
    gel(SD, 2*j+1) = gen_0;
    if (j < N)
    {
      q = gel(F, 2*j-1); /* (-1)^(j-1) (2j-1)! */
      gel(SS, 2*j) = gdiv(gel(S,j), q);
      gel(SS, 2*j+1) = gen_0;
    }
  }
  return mkvec3(SS, SC, SD);
}

GEN
elljacobi(GEN z, GEN k, long prec)
{
  pari_sp av = avma;
  long N = (precdl + 3) >> 1;
  if (!z) z = pol_x(0);
  switch (typ(z))
  {
    case t_QUAD: z = gtofp(z, prec); /* fall through */
    case t_INT: case t_REAL: case t_FRAC: case t_COMPLEX:
      return gc_GEN(av, elljacobi_cx(z, k, prec)); break;
    case t_POL:
      if (lg(z) > 2 && !gequal0(gel(z,2)))
        pari_err(e_IMPL, "elljacobi(t_SER) away from 0");
      break;
    case t_RFRAC:
    {
      GEN b = gel(z,2);
      if (gequal0(gel(b,2)) || !gequal0(gsubst(gel(z,1), varn(b), gen_0)))
        pari_err(e_IMPL, "elljacobi(t_SER) away from 0");
      break;
    }
    case t_SER:
      if (valser(z) <= 0)
        pari_err(e_IMPL, "elljacobi(t_SER) away from 0");
      N = lg(z) - 1; break;
    default: pari_err_TYPE("elljacobi", z);
      return NULL; /* LCOV_EXCL_LINE */
  }
  return gc_upto(av, gsubst(elljacobi_pol(N, k), 0, z));
}
