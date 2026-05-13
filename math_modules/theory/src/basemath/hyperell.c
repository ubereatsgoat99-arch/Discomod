/* Copyright (C) 2014  The PARI group.

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
/**                     HYPERELLIPTIC CURVES                       **/
/**                                                                **/
/********************************************************************/
#include "pari.h"
#include "paripriv.h"

#define DEBUGLEVEL DEBUGLEVEL_hyperell

/* Implementation of Kedlaya Algorithm for counting point on hyperelliptic
curves by Bill Allombert based on a GP script by Bernadette Perrin-Riou.

References:
Pierrick Gaudry and Nicolas G\"urel
Counting Points in Medium Characteristic Using Kedlaya's Algorithm
Experiment. Math.  Volume 12, Number 4 (2003), 395-402.
   http://projecteuclid.org/euclid.em/1087568016

Harrison, M. An extension of Kedlaya's algorithm for hyperelliptic
  curves. Journal of Symbolic Computation, 47 (1) (2012), 89-101.
  http://arxiv.org/pdf/1006.4206v3.pdf
*/

/* We use the basis of differentials (x^i*dx/y^k) (i=1 to 2*g-1),
   with k either 1 or 3, depending on p and d, see Harrison paper */

static long
get_basis(long p, long d)
{
  if (odd(d))
    return p < d-1 ? 3 : 1;
  else
    return 2*p <= d-2 ? 3 : 1;
}

static GEN
FpXXQ_red(GEN S, GEN T, GEN p)
{
  pari_sp av = avma;
  long i, dS = degpol(S);
  GEN A, C;
  if (signe(S)==0) return pol_0(varn(T));
  A = cgetg(dS+3, t_POL);
  C = pol_0(varn(T));
  for(i=dS; i>0; i--)
  {
    GEN Si = FpX_add(C, gel(S,i+2), p);
    GEN R, Q = FpX_divrem(Si, T, p, &R);
    gel(A,i+2) = R;
    C = Q;
  }
  gel(A,2) = FpX_add(C, gel(S,2), p);
  A[1] = S[1];
  return gc_GEN(av, FpXX_renormalize(A,dS+3));
}

static GEN
FpXXQ_sqr(GEN x, GEN T, GEN p)
{
  pari_sp av = avma;
  long n = degpol(T);
  GEN z = FpX_red(ZXX_sqr_Kronecker(x, n), p);
  z = Kronecker_to_ZXX(z, n, varn(T));
  return gc_upto(av, FpXXQ_red(z, T, p));
}

static GEN
FpXXQ_mul(GEN x, GEN y, GEN T, GEN p)
{
  pari_sp av = avma;
  long n = degpol(T);
  GEN z = FpX_red(ZXX_mul_Kronecker(x, y, n), p);
  z = Kronecker_to_ZXX(z, n, varn(T));
  return gc_upto(av, FpXXQ_red(z, T, p));
}

static GEN
ZpXXQ_invsqrt(GEN S, GEN T, ulong p, long e)
{
  pari_sp av = avma, av2;
  ulong mask;
  long v = varn(S), n=1;
  GEN a = pol_1(v);
  if (e <= 1) return gc_GEN(av, a);
  mask = quadratic_prec_mask(e);
  av2 = avma;
  for (;mask>1;)
  {
    GEN q, q2, q22, f, fq, afq;
    long n2 = n;
    n<<=1; if (mask & 1) n--;
    mask >>= 1;
    q = powuu(p,n); q2 = powuu(p,n2);
    f = RgX_sub(FpXXQ_mul(FpXX_red(S, q), FpXXQ_sqr(a, T, q), T, q), pol_1(v));
    fq = ZXX_Z_divexact(f, q2);
    q22 = shifti(addiu(q2,1),-1);
    afq = FpXX_Fp_mul(FpXXQ_mul(a, fq, T, q2), q22, q2);
    a = RgX_sub(a, ZXX_Z_mul(afq, q2));
    if (gc_needed(av2,1))
    {
      if(DEBUGMEM>1) pari_warn(warnmem,"ZpXXQ_invsqrt, e = %ld", n);
      a = gc_upto(av2, a);
    }
  }
  return gc_upto(av, a);
}

static GEN
to_ZX(GEN a, long v) { return typ(a)==t_INT? scalarpol(a,v): a; }

static void
is_sing(GEN H, ulong p)
{
  pari_err_DOMAIN("hyperellpadicfrobenius","H","is singular at",utoi(p),H);
}

static void
get_UV(GEN *U, GEN *V, GEN T, ulong p, long e)
{
  GEN q = powuu(p,e), d;
  GEN dT = FpX_deriv(T, q);
  GEN R = polresultantext(T, dT);
  long v = varn(T);
  if (dvdiu(gel(R,3),p)) is_sing(T, p);
  d = Zp_inv(gel(R,3), utoi(p), e);
  *U = FpX_Fp_mul(FpX_red(to_ZX(gel(R,1),v),q),d,q);
  *V = FpX_Fp_mul(FpX_red(to_ZX(gel(R,2),v),q),d,q);
}

static GEN
frac_to_Fp(GEN a, GEN b, GEN p)
{
  GEN d = gcdii(a, b);
  return Fp_div(diviiexact(a, d), diviiexact(b, d), p);
}

static GEN
ZpXXQ_frob(GEN S, GEN U, GEN V, long k, GEN T, ulong p, long e)
{
  pari_sp av = avma, av2;
  long i, pr = degpol(S), dT = degpol(T), vT = varn(T);
  GEN q = powuu(p,e);
  GEN Tp = FpX_deriv(T, q), Tp1 = RgX_shift_shallow(Tp, 1);
  GEN M = to_ZX(gel(S,pr+2),vT), R;
  av2 = avma;
  for(i = pr-1; i>=k; i--)
  {
    GEN A, B, H, Bc;
    ulong v, r;
    H = FpX_divrem(FpX_mul(V,M,q), T, q, &B);
    A = FpX_add(FpX_mul(U,M,q), FpX_mul(H, Tp, q),q);
    v = u_lvalrem(2*i+1,p,&r);
    Bc = ZX_deriv(B);
    Bc = FpX_Fp_mul(ZX_divuexact(Bc,upowuu(p,v)),Fp_divu(gen_2, r, q), q);
    M = FpX_add(to_ZX(gel(S,i+2),vT), FpX_add(A, Bc, q), q);
    if (gc_needed(av2,1))
    {
      if(DEBUGMEM>1) pari_warn(warnmem,"ZpXXQ_frob, step 1, i = %ld", i);
      M = gc_upto(av2, M);
    }
  }
  if (degpol(M)<dT-1)
    return gc_upto(av, M);
  R = RgX_shift_shallow(M,dT-degpol(M)-2);
  av2 = avma;
  for(i = degpol(M)-dT+2; i>=1; i--)
  {
    GEN B, c;
    R = RgX_shift_shallow(R, 1);
    gel(R,2) = gel(M, i+1);
    if (degpol(R) < dT) continue;
    B = FpX_add(FpX_mulu(T, 2*i, q), Tp1, q);
    c = frac_to_Fp(leading_coeff(R), leading_coeff(B), q);
    R = FpX_sub(R, FpX_Fp_mul(B, c, q), q);
    if (gc_needed(av2,1))
    {
      if(DEBUGMEM>1) pari_warn(warnmem,"ZpXXQ_frob, step 2, i = %ld", i);
      R = gc_upto(av2, R);
    }
  }
  if (degpol(R)==dT-1)
  {
    GEN c = frac_to_Fp(leading_coeff(R), leading_coeff(Tp), q);
    R = FpX_sub(R, FpX_Fp_mul(Tp, c, q), q);
    return gc_upto(av, R);
  } else
    return gc_GEN(av, R);
}

static GEN
revdigits(GEN v)
{
  long i, n = lg(v)-1;
  GEN w = cgetg(n+2, t_POL);
  w[1] = evalsigne(1)|evalvarn(0);
  for (i=0; i<n; i++)
    gel(w,i+2) = gel(v,n-i);
  return FpXX_renormalize(w, n+2);
}

static GEN
diff_red(GEN s, GEN A, long m, GEN T, GEN p)
{
  long v, n, vT = varn(T);
  GEN Q, sQ, qS;
  pari_timer ti;
  if (DEBUGLEVEL>1) timer_start(&ti);
  Q = revdigits(FpX_digits(A,T,p));
  n = degpol(Q);
  if (DEBUGLEVEL>1) timer_printf(&ti,"reddigits");
  sQ = FpXXQ_mul(s,Q,T,p);
  if (DEBUGLEVEL>1) timer_printf(&ti,"redmul");
  qS = RgX_shift_shallow(sQ,m-n);
  v = ZX_val(sQ);
  if (n > m + v)
  {
    long i, l = n-m-v;
    GEN rS = cgetg(l+1,t_VEC);
    for (i = l-1; i >=0 ; i--)
      gel(rS,i+1) = to_ZX(gel(sQ, 1+v+l-i), vT);
    rS = FpXV_FpX_fromdigits(rS,T,p);
    gel(qS,2) = FpX_add(FpX_mul(rS, T, p), gel(qS, 2), p);
    if (DEBUGLEVEL>1) timer_printf(&ti,"redadd");
  }
  return qS;
}

static GEN
ZC_to_padic(GEN C, GEN q)
{
  long i, l = lg(C);
  GEN V = cgetg(l,t_COL);
  for(i = 1; i < l; i++)
    gel(V, i) = gadd(gel(C, i), q);
  return V;
}

static GEN
ZM_to_padic(GEN M, GEN q)
{
  long i, l = lg(M);
  GEN V = cgetg(l,t_MAT);
  for(i = 1; i < l; i++)
    gel(V, i) = ZC_to_padic(gel(M, i), q);
  return V;
}

static GEN
ZX_to_padic(GEN P, GEN q)
{
  long i, l = lg(P);
  GEN Q = cgetg(l, t_POL);
  Q[1] = P[1];
  for (i=2; i<l ;i++)
    gel(Q,i) = gadd(gel(P,i), q);
  return normalizepol(Q);
}

static GEN
ZXC_to_padic(GEN x, GEN q)
{ pari_APPLY_type(t_COL, ZX_to_padic(gel(x, i), q)) }

static GEN
ZXM_to_padic(GEN x, GEN q)
{ pari_APPLY_same(ZXC_to_padic(gel(x, i), q)) }

static GEN
ZlX_hyperellpadicfrobenius(GEN H, ulong p, long n)
{
  pari_sp av = avma;
  long k, N, i, d;
  GEN F, s, Q, pN1, U, V;
  pari_timer ti;
  if (typ(H) != t_POL) pari_err_TYPE("hyperellpadicfrobenius",H);
  if (p == 2) is_sing(H, 2);
  d = degpol(H);
  if (d <= 0)
    pari_err_CONSTPOL("hyperellpadicfrobenius");
  if (n < 1)
    pari_err_DOMAIN("hyperellpadicfrobenius","n","<", gen_1, utoi(n));
  k = get_basis(p, d);
  N = n + ulogint(2*n, p) + 1;
  pN1 = powuu(p,N+1);
  Q = RgX_to_FpX(H, pN1);
  if (dvdiu(leading_coeff(Q),p)) is_sing(H, p);
  setvarn(Q,1);
  if (DEBUGLEVEL>1) timer_start(&ti);
  s = revdigits(FpX_digits(RgX_inflate(Q, p), Q, pN1));
  if (DEBUGLEVEL>1) timer_printf(&ti,"s1");
  s = ZpXXQ_invsqrt(s, Q, p, N);
  if (k==3)
    s = FpXXQ_mul(s, FpXXQ_sqr(s, Q, pN1), Q, pN1);
  if (DEBUGLEVEL>1) timer_printf(&ti,"invsqrt");
  get_UV(&U, &V, Q, p, N+1);
  F = cgetg(d, t_MAT);
  for (i = 1; i < d; i++)
  {
    pari_sp av2 = avma;
    GEN M, D;
    D = diff_red(s, monomial(utoipos(p),p*i-1,1),(k*p-1)>>1, Q, pN1);
    if (DEBUGLEVEL>1) timer_printf(&ti,"red");
    M = ZpXXQ_frob(D, U, V, (k-1)>>1, Q, p, N + 1);
    if (DEBUGLEVEL>1) timer_printf(&ti,"frob");
    gel(F, i) = gc_GEN(av2, RgX_to_RgC(M, d-1));
  }
  return gc_upto(av, F);
}

GEN
hyperellpadicfrobenius(GEN H, ulong p, long n)
{
  pari_sp av = avma;
  GEN M = ZlX_hyperellpadicfrobenius(H, p, n);
  GEN q = zeropadic_shallow(utoipos(p),n);
  return gc_upto(av, ZM_to_padic(M, q));
}

INLINE GEN
FpXXX_renormalize(GEN x, long lx)  { return ZXX_renormalize(x,lx); }

static GEN
ZpXQXXQ_red(GEN F, GEN S, GEN T, GEN q, GEN p, long e)
{
  pari_sp av = avma;
  long i, dF = degpol(F);
  GEN A, C;
  if (signe(F)==0) return pol_0(varn(S));
  A = cgetg(dF+3, t_POL);
  C = pol_0(varn(S));
  for(i=dF; i>0; i--)
  {
    GEN Fi = FpXX_add(C, gel(F,i+2), q);
    GEN R, Q = ZpXQX_divrem(Fi, S, T, q, p, e, &R);
    gel(A,i+2) = R;
    C = Q;
  }
  gel(A,2) = FpXX_add(C, gel(F,2), q);
  A[1] = F[1];
  return gc_GEN(av, FpXXX_renormalize(A,dF+3));
}

static GEN
ZpXQXXQ_sqr(GEN x, GEN S, GEN T, GEN q, GEN p, long e)
{
  pari_sp av = avma;
  GEN z, kx;
  long n = degpol(S), vx = varn(S);
  kx = RgXX_to_Kronecker_var(x, n, vx);
  z = Kronecker_to_ZXX(FpXQX_sqr(kx, T, q), n, vx);
  setvarn(z, varn(x));
  return gc_upto(av, ZpXQXXQ_red(z, S, T, q, p, e));
}

static GEN
ZpXQXXQ_mul(GEN x, GEN y, GEN S, GEN T, GEN q, GEN p, long e)
{
  pari_sp av = avma;
  GEN z, kx, ky;
  long n = degpol(S), vx = varn(S);
  kx = RgXX_to_Kronecker_var(x, n, vx);
  ky = RgXX_to_Kronecker_var(y, n, vx);
  z = Kronecker_to_ZXX(FpXQX_mul(ky, kx, T, q), n, vx);
  setvarn(z, varn(x));
  return gc_upto(av, ZpXQXXQ_red(z, S, T, q, p, e));
}

static GEN
FpXXX_red(GEN z, GEN p)
{
  GEN res;
  long i, l = lg(z);
  res = cgetg(l,t_POL); res[1] = z[1];
  for (i=2; i<l; i++)
  {
    GEN zi = gel(z,i);
    if (typ(zi)==t_INT)
      gel(res,i) = modii(zi,p);
    else
     gel(res,i) = FpXX_red(zi,p);
  }
  return FpXXX_renormalize(res,lg(res));
}

static GEN
FpXXX_Fp_mul(GEN z, GEN a, GEN p)
{
  return FpXXX_red(RgX_Rg_mul(z, a), p);
}

static GEN
ZpXQXXQ_invsqrt(GEN F, GEN S, GEN T, ulong p, long e)
{
  pari_sp av = avma, av2, av3;
  ulong mask;
  long v = varn(F), n=1;
  pari_timer ti;
  GEN a = pol_1(v), pp = utoipos(p);
  if (DEBUGLEVEL>1) timer_start(&ti);
  if (e <= 1) return gc_GEN(av, a);
  mask = quadratic_prec_mask(e);
  av2 = avma;
  for (;mask>1;)
  {
    GEN q, q2, q22, f, fq, afq;
    long n2 = n;
    n<<=1; if (mask & 1) n--;
    mask >>= 1;
    q = powuu(p,n); q2 = powuu(p,n2);
    av3 = avma;
    f = RgX_sub(ZpXQXXQ_mul(F, ZpXQXXQ_sqr(a, S, T, q, pp, n), S, T, q, pp, n), pol_1(v));
    fq = gc_upto(av3, RgX_Rg_divexact(f, q2));
    q22 = shifti(addiu(q2,1),-1);
    afq = FpXXX_Fp_mul(ZpXQXXQ_mul(a, fq, S, T, q2, pp, n2), q22, q2);
    a = RgX_sub(a, RgX_Rg_mul(afq, q2));
    if (gc_needed(av2,1))
    {
      if(DEBUGMEM>1) pari_warn(warnmem,"ZpXQXXQ_invsqrt, e = %ld", n);
      a = gc_upto(av2, a);
    }
  }
  return gc_upto(av, a);
}

static GEN
frac_to_Fq(GEN a, GEN b, GEN T, GEN q, GEN p, long e)
{
  GEN d = gcdii(ZX_content(a), ZX_content(b));
  return ZpXQ_div(ZX_Z_divexact(a, d), ZX_Z_divexact(b, d), T, q, p, e);
}

static GEN
ZpXQXXQ_frob(GEN F, GEN U, GEN V, long k, GEN S, GEN T, ulong p, long e)
{
  pari_sp av = avma, av2;
  long i, pr = degpol(F), dS = degpol(S), v = varn(T);
  GEN q = powuu(p,e), pp = utoipos(p);
  GEN Sp = RgX_deriv(S), Sp1 = RgX_shift_shallow(Sp, 1);
  GEN M = gel(F,pr+2), R;
  av2 = avma;
  for(i = pr-1; i>=k; i--)
  {
    GEN A, B, H, Bc;
    ulong v, r;
    H = ZpXQX_divrem(FpXQX_mul(V, M, T, q), S, T, q, utoipos(p), e, &B);
    A = FpXX_add(FpXQX_mul(U, M, T, q), FpXQX_mul(H, Sp, T, q),q);
    v = u_lvalrem(2*i+1,p,&r);
    Bc = RgX_deriv(B);
    Bc = FpXX_Fp_mul(ZXX_Z_divexact(Bc,powuu(p,v)), Fp_divu(gen_2, r, q), q);
    M = FpXX_add(gel(F,i+2), FpXX_add(A, Bc, q), q);
    if (gc_needed(av2,1))
    {
      if(DEBUGMEM>1) pari_warn(warnmem,"ZpXQXXQ_frob, step 1, i = %ld", i);
      M = gc_upto(av2, M);
    }
  }
  if (degpol(M)<dS-1)
    return gc_upto(av, M);
  R = RgX_shift_shallow(M,dS-degpol(M)-2);
  av2 = avma;
  for(i = degpol(M)-dS+2; i>=1; i--)
  {
    GEN B, c;
    R = RgX_shift_shallow(R, 1);
    gel(R,2) = gel(M, i+1);
    if (degpol(R) < dS) continue;
    B = FpXX_add(FpXX_mulu(S, 2*i, q), Sp1, q);
    c = frac_to_Fq(to_ZX(leading_coeff(R),v), to_ZX(leading_coeff(B),v), T, q, pp, e);
    R = FpXX_sub(R, FpXQX_FpXQ_mul(B, c, T, q), q);
    if (gc_needed(av2,1))
    {
      if(DEBUGMEM>1) pari_warn(warnmem,"ZpXXQ_frob, step 2, i = %ld", i);
      R = gc_upto(av2, R);
    }
  }
  if (degpol(R)==dS-1)
  {
    GEN c = frac_to_Fq(to_ZX(leading_coeff(R),v), to_ZX(leading_coeff(Sp),v), T, q, pp, e);
    R = FpXX_sub(R, FpXQX_FpXQ_mul(Sp, c, T, q), q);
    return gc_upto(av, R);
  } else
    return gc_GEN(av, R);
}

static GEN
Fq_diff_red(GEN s, GEN A, long m, GEN S, GEN T, GEN q, GEN p, long e)
{
  long v, n;
  GEN Q, sQ, qS;
  pari_timer ti;
  if (DEBUGLEVEL>1) timer_start(&ti);
  Q = revdigits(ZpXQX_digits(A, S, T, q, p, e));
  n = degpol(Q);
  if (DEBUGLEVEL>1) timer_printf(&ti,"reddigits");
  sQ = ZpXQXXQ_mul(s, Q, S, T, q, p, e);
  if (DEBUGLEVEL>1) timer_printf(&ti,"redmul");
  qS = RgX_shift_shallow(sQ,m-n);
  v = ZX_val(sQ);
  if (n > m + v)
  {
    long i, l = n-m-v;
    GEN rS = cgetg(l+1,t_VEC);
    for (i = l-1; i >=0 ; i--)
      gel(rS,i+1) = gel(sQ, 1+v+l-i);
    rS = FpXQXV_FpXQX_fromdigits(rS, S, T, q);
    gel(qS,2) = FpXX_add(FpXQX_mul(rS, S, T, q), gel(qS, 2), q);
    if (DEBUGLEVEL>1) timer_printf(&ti,"redadd");
  }
  return qS;
}

static void
Fq_get_UV(GEN *U, GEN *V, GEN S, GEN T, ulong p, long e)
{
  GEN q = powuu(p, e), pp = utoipos(p), d;
  GEN dS = RgX_deriv(S), R  = polresultantext(S, dS), C;
  long v = varn(S);
  if (signe(FpX_red(to_ZX(gel(R,3),v), pp))==0) is_sing(S, p);
  C = FpXQ_red(to_ZX(gel(R, 3),v), T, q);
  d = ZpXQ_inv(C, T, pp, e);
  *U = FpXQX_FpXQ_mul(FpXQX_red(to_ZX(gel(R,1),v),T,q),d,T,q);
  *V = FpXQX_FpXQ_mul(FpXQX_red(to_ZX(gel(R,2),v),T,q),d,T,q);
}

static GEN
ZXX_to_FpXC(GEN x, long N, GEN p, long v)
{
  long i, l;
  GEN z;
  l = lg(x)-1; x++;
  if (l > N+1) l = N+1; /* truncate higher degree terms */
  z = cgetg(N+1,t_COL);
  for (i=1; i<l ; i++)
  {
    GEN xi = gel(x, i);
    gel(z,i) = typ(xi)==t_INT? scalarpol(Fp_red(xi, p), v): FpX_red(xi, p);
  }
  for (   ; i<=N ; i++)
    gel(z,i) = pol_0(v);
  return z;
}

GEN
ZlXQX_hyperellpadicfrobenius(GEN H, GEN T, ulong p, long n)
{
  pari_sp av = avma;
  long k, N, i, d, N1, v0;
  GEN xp, F, s, q, Q, pN1, U, V, pp;
  pari_timer ti;
  if (typ(H) != t_POL) pari_err_TYPE("hyperellpadicfrobenius",H);
  if (p == 2) is_sing(H, 2);
  d = degpol(H);
  if (d <= 0) pari_err_CONSTPOL("hyperellpadicfrobenius");
  if (n < 1) pari_err_DOMAIN("hyperellpadicfrobenius","n","<", gen_1, utoi(n));
  k = get_basis(p, d); pp = utoipos(p);
  N = n + ulogint(2*n, p) + 1;
  q = powuu(p,n); N1 = N+1;
  pN1 = powuu(p,N1); T = FpX_get_red(T, pN1);
  Q = RgX_to_FqX(H, T, pN1);
  if (signe(FpX_red(to_ZX(leading_coeff(Q),varn(Q)),pp))==0) is_sing(H, p);
  if (DEBUGLEVEL>1) timer_start(&ti);
  xp = ZpX_Frobenius(T, pp, N1);
  s = RgX_inflate(FpXY_FpXQ_evalx(Q, xp, T, pN1), p);
  v0 = fetch_var_higher();
  s = revdigits(ZpXQX_digits(s, Q, T, pN1, pp, N1));
  setvarn(s, v0);
  if (DEBUGLEVEL>1) timer_printf(&ti,"s1");
  s = ZpXQXXQ_invsqrt(s, Q, T, p, N);
  if (k==3)
    s = ZpXQXXQ_mul(s, ZpXQXXQ_sqr(s, Q, T, pN1, pp, N1), Q, T, pN1, pp, N1);
  if (DEBUGLEVEL>1) timer_printf(&ti,"invsqrt");
  Fq_get_UV(&U, &V, Q, T, p, N+1);
  if (DEBUGLEVEL>1) timer_printf(&ti,"get_UV");
  F = cgetg(d, t_MAT);
  for (i = 1; i < d; i++)
  {
    pari_sp av2 = avma;
    GEN M, D;
    D = Fq_diff_red(s, monomial(pp,p*i-1,0),(k*p-1)>>1, Q, T, pN1, pp, N1);
    if (DEBUGLEVEL>1) timer_printf(&ti,"red");
    M = ZpXQXXQ_frob(D, U, V, (k - 1)>>1, Q, T, p, N1);
    if (DEBUGLEVEL>1) timer_printf(&ti,"frob");
    gel(F, i) = gc_upto(av2, ZXX_to_FpXC(M, d-1, q, varn(T)));
  }
  delete_var();
  return gc_upto(av, F);
}

GEN
nfhyperellpadicfrobenius(GEN H, GEN T, ulong p, long n)
{
  pari_sp av = avma;
  GEN pp = utoipos(p), q = zeropadic_shallow(pp, n);
  GEN M = ZlXQX_hyperellpadicfrobenius(lift_shallow(H),T,p,n);
  GEN MM = ZpXQM_prodFrobenius(M, T, pp, n);
  GEN m = gmul(ZXM_to_padic(MM, q), gmodulo(gen_1, T));
  return gc_upto(av, m);
}

GEN
hyperellpadicfrobenius0(GEN H, GEN Tp, long n)
{
  GEN T, p;
  if (!ff_parse_Tp(Tp, &T,&p,0)) pari_err_TYPE("hyperellpadicfrobenius", Tp);
  if (lgefint(p) > 3) pari_err_IMPL("large prime in hyperellpadicfrobenius");
  return T? nfhyperellpadicfrobenius(H, T, itou(p), n)
          : hyperellpadicfrobenius(H, itou(p), n);
}

static GEN
F2x_genus2charpoly_naive(GEN P, GEN Q)
{
  long a, b = 1, c = 0;
  GEN T = mkvecsmall2(P[1], 7);
  GEN PT = F2x_rem(P, T), QT = F2x_rem(Q, T);
  long q0 = F2x_eval(Q, 0), q1 = F2x_eval(Q, 1);
  long dP = F2x_degree(P), dQ = F2x_degree(Q);
  a= dQ<3 ? 0: dP<=5 ? 1: -1;
  a += (q0? F2x_eval(P, 0)? -1: 1: 0) + (q1? F2x_eval(P, 1)? -1: 1: 0);
  b += q0 + q1;
  if (lgpol(QT))
    c = (F2xq_trace(F2xq_div(PT, F2xq_sqr(QT, T), T), T)==0 ? 1: -1);
  return mkvecsmalln(6, 0UL, 4UL, 2*a, (b+2*c+a*a)>>1, a, 1UL);
}

static GEN
Flx_difftable(GEN P, ulong p)
{
  long i, n = degpol(P);
  GEN V = cgetg(n+2, t_VEC);
  gel(V, n+1) = P;
  for(i = n; i >= 1; i--)
    gel(V, i) = Flx_diff1(gel(V, i+1), p);
  return V;
}

static GEN
FlxV_Fl2_eval_pre(GEN V, GEN x, ulong D, ulong p, ulong pi)
{
  long i, n = lg(V)-1;
  GEN r = cgetg(n+1, t_VEC);
  for (i = 1; i <= n; i++)
    gel(r, i) = Flx_Fl2_eval_pre(gel(V, i), x, D, p, pi);
  return r;
}

static GEN
Fl2V_next(GEN V, ulong p)
{
  long i, n = lg(V)-1;
  GEN r = cgetg(n+1, t_VEC);
  gel(r, 1) = gel(V, 1);
  for (i = 2; i <= n; i++)
    gel(r, i) = Flv_add(gel(V, i), gel(V, i-1), p);
  return r;
}

static GEN
FlxV_constant(GEN x)
{ pari_APPLY_long(Flx_constant(gel(x,i))) }

static GEN
Flx_genus2charpoly_naive(GEN H, ulong p)
{
  pari_sp av = avma, av2;
  ulong pi = get_Fl_red(p);
  ulong i, j, p2 = p>>1, D = 2, e = ((p&2UL) == 0) ? -1 : 1;
  long a, b, c = 0, n = degpol(H);
  GEN t, d, k = const_vecsmall(p, -1);
  k[1] = 0;
  for (i=1, j=1; i < p; i += 2, j = Fl_add(j, i, p)) k[j+1] = 1;
  while (k[1+D] >= 0) D++;
  b = n == 5 ? 0 : 1;
  a = b ? k[1+Flx_lead(H)]: 0;
  t = Flx_difftable(H, p);
  d = FlxV_constant(t);
  av2 = avma;
  for (i=0; i < p; i++)
  {
    ulong v = uel(d,n+1);
    a += k[1+v];
    b += !!v;
    if (n==6)
      uel(d,7) = Fl_add(uel(d,7), uel(d,6), p);
    uel(d,6) = Fl_add(uel(d,6), uel(d,5), p);
    uel(d,5) = Fl_add(uel(d,5), uel(d,4), p);
    uel(d,4) = Fl_add(uel(d,4), uel(d,3), p);
    uel(d,3) = Fl_add(uel(d,3), uel(d,2), p);
    uel(d,2) = Fl_add(uel(d,2), uel(d,1), p);
  }
  for (j=1; j <= p2; j++)
  {
    GEN V = FlxV_Fl2_eval_pre(t, mkvecsmall2(0, j), D, p, pi);
    for (i=0;; i++)
    {
      GEN r2 = gel(V, n+1);
      c += uel(r2,2) ?
        (uel(r2,1) ? uel(k,1+Fl2_norm_pre(r2, D, p, pi)): e)
         : !!uel(r2,1);
      if (i == p-1) break;
      V = Fl2V_next(V, p);
    }
    set_avma(av2);
  }
  set_avma(av);
  return mkvecsmalln(6, 0UL, p*p, a*p, (b+2*c+a*a)>>1, a, 1UL);
}

static GEN
charpoly_funceq(GEN P, GEN q)
{
  long i, l, g = degpol(P)>>1;
  GEN R, Q = gpowers0(q, g-1, q); /* Q[i] = q^i, i <= g */
  R = cgetg_copy(P, &l); R[1] = P[1];
  for (i=0; i<g; i++) gel(R, i+2) = mulii(gel(P, 2*g-i+2), gel(Q, g-i));
  for (; i<=2*g; i++) gel(R, i+2) = icopy(gel(P, i+2));
  return R;
}

static long
hyperell_Weil_bound(GEN q, ulong g, GEN p)
{
  pari_sp av = avma;
  GEN w = mulii(binomialuu(2*g,g),sqrtint(shifti(powiu(q, g),2)));
  return gc_long(av, logint(w,p) + 1);
}

/* return 4P + Q^2 */
static GEN
check_hyperell(GEN PQ)
{
  GEN H;
  if (is_vec_t(typ(PQ)) && lg(PQ)==3)
    H = gadd(gsqr(gel(PQ, 2)), gmul2n(gel(PQ, 1), 2));
  else
    H = gmul2n(PQ, 2);
  return typ(H) == t_POL? H: NULL;
}

static long
hyperellgenus(GEN H)
{ long d = degpol(H); return ((d+1)>>1)-1; }

static void
check_hyperell_Rg(const char *fun, GEN *pW, GEN *pF)
{
  GEN W = *pW, F = check_hyperell(W);
  long v;
  if (!F)
    pari_err_TYPE(fun, W);
  if (degpol(F) <= 0) pari_err_CONSTPOL(fun);
  v = varn(F);
  if (typ(W)==t_POL) W = mkvec2(W, pol_0(v));
  else
  {
    GEN P = gel(W, 1), Q = gel(W, 2);
    long g = hyperellgenus(F);
    if( typ(P)!=t_POL) P = scalarpol(P, v);
    if( typ(Q)!=t_POL) Q = scalarpol(Q, v);
    if (degpol(P) > 2*g+2)
      pari_err_DOMAIN(fun, "poldegree(P)", ">", utoi(2*g+2), P);
    if (degpol(Q) > g+1)
      pari_err_DOMAIN(fun, "poldegree(Q)", ">", utoi(g+1), Q);

    W = mkvec2(P, Q);
  }
  if (pF) *pF = F;
  *pW = W;
}

GEN
hyperellcharpoly(GEN PQ)
{
  pari_sp av = avma;
  GEN M, R, T=NULL, pp=NULL, q;
  long d, n, eps = 0;
  ulong p;
  GEN H = check_hyperell(PQ);
  if (!H || !RgX_is_FpXQX(H, &T, &pp) || !pp)
    pari_err_TYPE("hyperellcharpoly", PQ);
  p = itou(pp);
  if (!T)
  {
    if (p==2 && is_vec_t(typ(PQ)))
    {
      long dP, dQ, v = varn(H);
      GEN P = gel(PQ,1), Q = gel(PQ,2);
      if (typ(P)!=t_POL)  P = scalarpol(P, v);
      if (typ(Q)!=t_POL)  Q = scalarpol(Q, v);
      dP = degpol(P); dQ = degpol(Q);
      if (dP<=6 && dQ <=3 && (dQ==3 || dP>=5))
      {
        GEN P2 = RgX_to_F2x(P), Q2 = RgX_to_F2x(Q);
        GEN D = F2x_add(F2x_mul(P2, F2x_sqr(F2x_deriv(Q2))), F2x_sqr(F2x_deriv(P2)));
        if (F2x_degree(F2x_gcd(D, Q2))) is_sing(PQ, 2);
        if (dP==6 && dQ<3 && F2x_coeff(P2,5)==F2x_coeff(Q2,2))
          is_sing(PQ, 2); /* The curve is singular at infinity */
        R = zx_to_ZX(F2x_genus2charpoly_naive(P2, Q2));
        return gc_upto(av, R);
      }
    }
    H = RgX_to_FpX(H, pp);
    d = degpol(H);
    if (d <= 0) is_sing(H, p);
    if (p > 2 && ((d == 5 && p < 17500) || (d == 6 && p < 24500)))
    {
      GEN Hp = ZX_to_Flx(H, p);
      if (!Flx_is_squarefree(Hp, p)) is_sing(H, p);
      R = zx_to_ZX(Flx_genus2charpoly_naive(Hp, p));
      return gc_upto(av, R);
    }
    n = hyperell_Weil_bound(pp, (d-1)>>1, pp);
    eps = odd(d)? 0: Fp_issquare(leading_coeff(H), pp);
    M = hyperellpadicfrobenius(H, p, n);
    R = centerlift(carberkowitz(M, 0));
    q = pp;
  }
  else
  {
    int fixvar;
    T = typ(T)==t_FFELT? FF_mod(T): RgX_to_FpX(T, pp);
    q = powuu(p, degpol(T));
    fixvar = (varncmp(varn(T),varn(H)) <= 0);
    if (fixvar) setvarn(T, fetch_var());
    H = RgX_to_FpXQX(H, T, pp);
    d = degpol(H);
    if (d <= 0) is_sing(H, p);
    eps = odd(d)? 0: Fq_issquare(leading_coeff(H), T, pp);
    n = hyperell_Weil_bound(q, (d-1)>>1, pp);
    M = nfhyperellpadicfrobenius(H, T, p, n);
    R = simplify_shallow(centerlift(liftpol_shallow(carberkowitz(M, 0))));
    if (fixvar) (void)delete_var();
  }
  if (!odd(d))
  {
    GEN b = get_basis(p, d) == 3 ? gen_1 : q;
    GEN pn = powuu(p, n);
    R = FpX_div_by_X_x(R, eps? b: negi(b), pn, NULL);
    R = FpX_center_i(R, pn, shifti(pn,-1));
  }
  return gc_upto(av, charpoly_funceq(R, q));
}

GEN
hyperellordinate(GEN W, GEN x)
{
  pari_sp av = avma;
  if (typ(W)==t_POL)
  {
    GEN d, y;
    if (typ(x)==t_INFINITY)
    {
      long dW = degpol(W);
      d = odd(dW) ? gen_0: gel(W,dW+2);
    } else
      d = poleval(W,x);
    if (gequal0(d)) { return gc_GEN(av, mkvec(d)); }
    if (!issquareall(d, &y)) retgc_const(av, cgetg(1, t_VEC));
    return gc_GEN(av, mkvec2(y, gneg(y)));
  }
  else
  {
    GEN b, c, d, rd, y, P, Q, F;
    check_hyperell_Rg("hyperellordinate", &W, &F);
    P = gel(W,1); Q = gel(W,2);
    if (typ(x)==t_INFINITY)
    {
      long dP = degpol(P), dQ = degpol(Q), g = hyperellgenus(F);
      c = dP < 2*g+2 ? gen_0: gel(P,dP+2);
      b = dQ < g+1   ? gen_0: gel(Q,dQ+2);
    } else
    { b = poleval(Q, x); c = poleval(P, x); }
    d = gadd(gsqr(b), gmul2n(c, 2));
    if (gequal0(d)) { return gc_GEN(av, mkvec(gmul2n(gneg(b),-1))); }
    if (!issquareall(d, &rd)) retgc_const(av, cgetg(1, t_VEC));
    y = gmul2n(gsub(rd, b), -1);
    return gc_GEN(av, mkvec2(y, gsub(y,rd)));
  }
}

GEN
hyperelldisc(GEN PQ)
{
  pari_sp av = avma;
  GEN D, H = check_hyperell(PQ);
  long g;
  if (!H || signe(H)==0) pari_err_TYPE("hyperelldisc",PQ);
  g = hyperellgenus(H);
  D = gmul2n(RgX_disc(H),-4*(g+1));
  if (odd(degpol(H))) D = gmul(D, gsqr(leading_coeff(H)));
  return gc_upto(av, D);
}

static long
get_ep(GEN W)
{
  GEN P = gel(W,1), Q = gel(W,2);
  if (signe(Q)==0) return ZX_lval(P,2);
  return minss(ZX_lval(P,2), ZX_lval(Q,2));
}

static GEN
algo51(GEN W, GEN M)
{
  GEN P = gel(W,1), Q = gel(W,2);
  for(;;)
  {
    long vP = ZX_lval(P,2);
    long vQ = signe(Q) ? ZX_lval(Q,2): vP+1;
    long r;
    /* 1 */
    if (vQ==0) break;
    /* 2 */
    if (vP==0)
    {
      GEN H, H1;
      /* a */
      RgX_even_odd(FpX_red(P,gen_2),&H, &H1);
      if (signe(H1)) break;
      /* b */
      P = ZX_add(P, ZX_mul(H, ZX_sub(Q, H)));
      Q = ZX_sub(Q, ZX_shifti(H, 1));
      vP = ZX_lval(P,2);
      vQ = signe(Q) ? ZX_lval(Q,2): vP+1;
    }
    /* 2c */
    if (vP==1) break;
    /* 2d */
    r = minss(2*vQ, vP)>>1;
    if (M) gel(M,1) = shifti(gel(M,1), r);
    P = ZX_shifti(P, -2*r);
    Q = ZX_shifti(Q, -r);
  }
  return mkvec2(P,Q);
}

static GEN
algo52(GEN W, GEN c, long *pt_lambda)
{
  long lambda;
  GEN P = gel(W,1), Q = gel(W,2);
  for(;;)
  {
    GEN H, H1;
    /* 1 */
    GEN Pc = ZX_affine(P,gen_2,c), Qc = ZX_affine(Q,gen_2,c);
    long mP = ZX_lval(Pc,2), mQ = signe(Qc) ? ZX_lval(Qc,2): mP+1;
    /* 2 */
    if (2*mQ <= mP) { lambda = 2*mQ; break; }
    /* 3 */
    if (odd(mP)) { lambda = mP; break; }
    /* 4 */
    RgX_even_odd(FpX_red(ZX_shifti(Pc, -mP),gen_2),&H, &H1);
    if (signe(H1)) { lambda = mP; break; }
    /* 5 */
    P = ZX_add(P, ZX_mul(H, ZX_sub(Q, H)));
    Q = ZX_sub(Q, ZX_shifti(H, 1));
  }
  *pt_lambda = lambda;
  return mkvec2(P,Q);
}

static long
test53(long lambda, long ep, long g)
{
  return (lambda <= g+1) || (odd(g) && lambda<g+3 && ep==1);
}

static long
test55(GEN W, long ep, long g)
{
  GEN P = gel(W,1), Q = gel(W,2);
  GEN Pe = FpX_red(ep ? ZX_shifti(P,-1): P, gen_2);
  GEN Qe = FpX_red(ep ? ZX_shifti(Q,-1): Q, gen_2);
  if (ep==0)
  {
    if (signe(Qe)!=0) return ZX_val(Qe) >= (g + 3)>>1;
    else return ZX_val(FpX_deriv(Pe, gen_2)) >= g+1;
  }
  else
    return ZX_val(Qe) >= (g+1)>>1 && ZX_val(Pe) >= g + 1;
}

static GEN
hyperell_reverse(GEN W, long g)
{
  return mkvec2(RgXn_recip_shallow(gel(W,1),2*g+3),
                RgXn_recip_shallow(gel(W,2),g+2));
}

/* [P,Q] -> [P(2x)/4^r, Q(2x)/2^r] */
static GEN
ZX2_unscale(GEN W, long r)
{
  GEN P = ZX_unscale2n(gel(W,1), 1);
  GEN Q = ZX_unscale2n(gel(W,2), 1);
  if (r)
  {
    P = ZX_shifti(P, -2*r);
    Q = ZX_shifti(Q, -r);
  }
  return mkvec2(P,Q);
}
/* [P,Q] -> [P(2x+c)/4^r, Q(2x+c)/2^r] */
static GEN
ZX2_affine_unscale(GEN W, long c, long r)
{
  if (c) W = mkvec2(ZX_Z_translate(gel(W,1), gen_1),
                    ZX_Z_translate(gel(W,2), gen_1));
  return ZX2_unscale(W, r);
}

static GEN
algo56(GEN W, long g)
{
  long ep;
  GEN M = mkvec2(gen_1, matid(2)), Woo;
  W = algo51(W, M);
  Woo = hyperell_reverse(W, g);
  ep = get_ep(Woo);
  if (test55(Woo,ep,g))
  {
    long lambda;
    Woo = algo52(Woo, gen_0, &lambda);
    if (!test53(lambda,ep,g))
    {
      long r = lambda>>1;
      gel(M,1) = shifti(gel(M,1), r);
      gel(M,2) = ZM2_mul(gel(M,2), mkmat22(gen_0, gen_1, gen_2, gen_0));
      W = ZX2_unscale(Woo, r);
    }
  }
  for(;;)
  {
    long j, ep = get_ep(W);
    for (j = 0; j < 2; j++)
      if (test55(ZX2_affine_unscale(W, j, 0), ep, g))
      {
        long lambda;
        GEN c = utoi(j), Wc = algo52(W, c, &lambda);
        if (!test53(lambda,ep,g))
        {
          long r = lambda>>1;
          gel(M,1) = shifti(gel(M,1), r);
          gel(M,2) = ZM2_mul(gel(M,2), mkmat22(gen_2, c, gen_0, gen_1));
          W = ZX2_affine_unscale(Wc, j, r);
          break;
        }
      }
    if (j==2) break;
  }
  return mkvec2(W, M);
}

static GEN
algo56bis(GEN W, long g, long inf, long thr)
{
  pari_sp av = avma;
  GEN vl = cgetg(3,t_VEC);
  long nl = 1;
  W = algo51(W, NULL);
  if (inf)
  {
    GEN Woo = hyperell_reverse(W, g);
    long ep = get_ep(Woo);
    if (test55(ZX2_unscale(Woo, 0), ep, g))
    {
      long lambda;
      Woo = algo52(Woo, gen_0, &lambda);
      if (lambda == thr) gel(vl,nl++) = ZX2_unscale(Woo, lambda>>1);
    }
  }
  {
    long j, ep = get_ep(W);
    for (j = 0; j < 2; j++)
      if (test55(ZX2_affine_unscale(W, j, 0), ep, g))
      {
        long lambda;
        GEN Wc = algo52(W, utoi(j), &lambda);
        if (lambda == thr) gel(vl,nl++) = ZX2_affine_unscale(Wc, j, lambda>>1);
      }
  }
  setlg(vl, nl);
  return gc_GEN(av,vl);
}

/* return the (degree 2) apolar invariant (the nth transvectant of P and P) */
static GEN
ZX_apolar(GEN P, long n)
{
  pari_sp av = avma;
  long d = degpol(P), i;
  GEN s = gen_0, g = cgetg(n+2,t_VEC);
  gel(g,1) = gen_1;
  for (i = 1; i <= n; i++) gel(g,i+1) = muliu(gel(g,i),i); /* g[i+1] = i! */
  for (i = n-d; i <= d; i++)
  {
     GEN a = mulii(mulii(gel(g,i+1),gel(g,n-i+1)),
                   mulii(gel(P,i+2),gel(P,n-i+2)));
     s = odd(i)? subii(s, a): addii(s, a);
  }
  return gc_INT(av,s);
}

static GEN
algo57(GEN F, long g, GEN pr)
{
  long i, l;
  GEN D, C = content(F);
  GEN e = gel(core2(shifti(C,-vali(C))),2);
  GEN M = mkvec2(e, matid(2));
  long minvd = (2*g+1)>>(odd(g) ? 4:2);
  F = ZX_Z_divexact(F, sqri(e));
  D = absi(hyperelldisc(F));
  if (!pr)
  {
    GEN A = gcdii(D, ZX_apolar(F, 2*g+2));
    pr = gel(factor(shifti(A, -vali(A))),1);
  }
  l = lg(pr);
  for (i = 1; i < l; i++)
  {
    long ep;
    GEN p = gel(pr, i), ps2 = shifti(p,-1), Fe;
    if (equaliu(p,2) || Z_pval(D,p) < minvd) continue;
    ep = ZX_pvalrem(F,p, &Fe); Fe = FpX_red(Fe, p);
    if (degpol(Fe) < g+1+ep)
    {
      GEN Fi = ZX_unscale(RgXn_recip_shallow(F,2*g+3), p);
      long lambda = ZX_pval(Fi,p);
      if (!test53(lambda,ep,g))
      {
        GEN ppr = powiu(p,lambda>>1);
        F = ZX_Z_divexact(Fi,sqri(ppr));
        gel(M,1) = mulii(gel(M,1), ppr);
        gel(M,2) = ZM2_mul(gel(M,2), mkmat22(gen_0,gen_1,p,gen_0));
      }
    }
    for(;;)
    {
      GEN Fe, R;
      long j, lR, ep = ZX_pvalrem(F,p, &Fe);
      R = FpX_roots_mult(FpX_red(Fe, p), g+2-ep, p); lR = lg(R);
      for (j = 1; j<lR; j++)
      {
        GEN c = Fp_center(gel(R,j), p, ps2);
        GEN Fi = ZX_affine(F,p,c);
        long lambda = ZX_pval(Fi,p);
        if (!test53(lambda,ep,g))
        {
          GEN ppr = powiu(p,lambda>>1);
          F = ZX_Z_divexact(Fi, sqri(ppr));
          gel(M,1) = mulii(gel(M,1), ppr);
          gel(M,2) = ZM2_mul(gel(M,2), mkmat22(p,c,gen_0,gen_1));
          break;
        }
      }
      if (j==lR) break;
    }
  }
  return mkvec2(F, M);
}

/* if inf=0, ignore point at infinity */
static GEN
algo57bis(GEN F, long g, GEN p, long inf, long thr)
{
  pari_sp av = avma;
  GEN vl = cgetg(3,t_VEC), Fe;
  long nl = 1, ep = ZX_pvalrem(F,p, &Fe);
  Fe = FpX_red(Fe, p);
  {
    GEN R = FpX_roots_mult(Fe, thr-ep, p);
    long j, lR = lg(R);
    for (j = 1; j<lR; j++)
    {
      GEN Fj = ZX_affine(F, p, gel(R,j));
      long lambda = ZX_pvalrem(Fj, p, &Fj);
      if (lambda == thr) gel(vl,nl++) = odd(lambda)? ZX_Z_mul(Fj, p): Fj;
    }
  }
  if (inf==1 && 2*g+2-degpol(Fe) >= thr-ep)
  {
    GEN Fj = ZX_unscale(RgXn_recip_shallow(F,2*g+3), p);
    long lambda = ZX_pvalrem(Fj, p, &Fj);
    if (lambda == thr) gel(vl,nl++) = odd(lambda)? ZX_Z_mul(Fj, p): Fj;
  }
  setlg(vl, nl);
  return gc_GEN(av,vl);
}

static GEN
next_model(GEN G, long g, GEN p, long inf, long thr)
{
  return equaliu(p,2) ? algo56bis(G, g,    inf, thr)
                      : algo57bis(G, g, p, inf, thr);
}

static GEN
get_extremal_even(GEN F, GEN G, long g, GEN p, long *nb)
{
  while (1)
  {
    GEN Wi = next_model(G, g, p, 0, g+2);
    if (lg(Wi)==1) return F;
    F = gel(Wi,1); ++*nb;
    if (DEBUGLEVEL>1) err_printf("model %ld: %Ps\n", *nb, F);
    Wi = next_model(F, g, p, 0, g+1);
    if (lg(Wi)==1) return F;
    G = gel(Wi,1);
  }
}

static GEN
get_extremal_odd(GEN F, long g, GEN p, long *nb)
{
  while (1)
  {
    GEN Wi = next_model(F, g, p, 0, g+2);
    if (lg(Wi)==1) return F;
    F = gel(Wi,1); ++*nb;
    if (DEBUGLEVEL>1) err_printf("model %ld: %Ps\n", *nb, F);
  }
}

static GEN
hyperellextremalmodels_nb(GEN F, long g, GEN p, long *nb)
{
  pari_sp av = avma;
  GEN W, A, B;
  long l;

  *nb = 1;
  if (equaliu(p,2))
  {
    if (get_ep(F) > 0) retmkvec(gcopy(F));
  } else
  {
    F = check_hyperell(F);
    if (ZX_pval(F, p) > 0) return gc_GEN(av, mkvec(F));
  }
  if (DEBUGLEVEL>1) err_printf("model %ld: %Ps\n", *nb, F);
  W = next_model(F, g, p, 1, odd(g)? g+2: g+1);
  l = lg(W); if (l==1) return gc_GEN(av, mkvec(F));
  if (odd(g))
  {
    *nb = l-1;
    A = get_extremal_odd(gel(W,1), g, p, nb);
    B = l==3 ? get_extremal_odd(gel(W,2), g, p, nb) : F;
  }
  else
  {
    A = get_extremal_even(F, gel(W,1), g, p, nb);
    B = l==3 ? get_extremal_even(F, gel(W,2), g, p, nb) : F;
  }
  return gc_GEN(av, A == B? mkvec(A): mkvec2(A, B));
}

static GEN
hyperellextremalmodels_i(GEN F, long g, GEN p)
{
  long nb;
  return hyperellextremalmodels_nb(F, g, p, &nb);
}

GEN
hyperellextremalmodels(GEN PQ, GEN p)
{
  pari_sp av = avma;
  GEN H = check_hyperell(PQ), W, v;
  long g, nb;
  if (!H || signe(H)==0) pari_err_TYPE("hyperellextremalmodels",PQ);
  if (typ(p)!=t_INT || signe(p)<=0) pari_err_TYPE("hyperellextremalmodels",p);
  g = hyperellgenus(H);
  W = hyperellminimalmodel(H,NULL,mkvec(p));
  v = cgetg(3, t_VEC);
  gel(v, 2) = hyperellextremalmodels_nb(W, g, p, &nb);
  gel(v, 1) = stoi(nb);
  return gc_upto(av, v);
}

static GEN
minimalmodel_merge(GEN W2, GEN Modd, long g, long v)
{
  GEN P = gel(W2,1), Q = gel(W2,2);
  GEN e = gel(Modd,1), M = gel(Modd,2);
  GEN A = deg1pol_shallow(gcoeff(M,1,1), gcoeff(M,1,2), v);
  GEN B = deg1pol_shallow(gcoeff(M,2,1), gcoeff(M,2,2), v);
  GEN Bp = gpowers(B, 2*g+2);
  long f = mod4(e)==1 ? 1: -1;
  GEN m = shifti(f > 0 ? subui(1,e): addui(1,e), -2);
  GEN  m24 = subii(shifti(m,1), shifti(sqri(m),2));
  P = RgX_homogenous_evalpow(P, A, Bp, 2*g+2);
  Q = RgX_homogenous_evalpow(Q, A, Bp, g+1);
  P = ZX_Z_divexact(ZX_add(P, ZX_Z_mul(ZX_sqr(Q), m24)),sqri(e));
  if (f < 0) Q = ZX_neg(Q);
  return mkvec2(P,Q);
}

static GEN
hyperell_redQ(GEN W)
{
  GEN P = gel(W,1), Q = gel(W,2);
  GEN Pr, Qr = FpX_red(Q, gen_2);
  Pr = ZX_add(P, ZX_shifti(ZX_mul(ZX_sub(Q, Qr),ZX_add(Q, Qr)),-2));
  return mkvec2(Pr, Qr);
}

static GEN
hyperellisom_finalize(GEN W1, GEN W2, GEN e, GEN M, long g, long v)
{
  GEN Q1 = gel(W1,2), Q2 = gel(W2,2);
  GEN A = deg1pol_shallow(gcoeff(M,1,1), gcoeff(M,1,2), v);
  GEN B = deg1pol_shallow(gcoeff(M,2,1), gcoeff(M,2,2), v);
  GEN Hp = RgX_homogenous_eval(Q1, A, B, g+1);
  GEN H = RgX_mul2n(RgX_sub(RgX_Rg_mul(Q2,e), Hp),-1);
  return mkvec3(e, M, H);
}

static void
check_hyperell_Q(const char *fun, GEN *pW, GEN *pF)
{
  GEN W = *pW, F = check_hyperell(W);
  long v, g;
  if (!F || !signe(F) || !RgX_is_ZX(F)) pari_err_TYPE(fun, W);
  if (!signe(ZX_disc(F))) pari_err_DOMAIN(fun,"disc(W)","==",gen_0,W);
  v = varn(F); g = hyperellgenus(F);
  if (g == 0) pari_err_DOMAIN(fun, "genus", "=", gen_0, gen_0);
  if (typ(W)==t_POL) W = mkvec2(W, pol_0(v));
  else
  {
    GEN P = gel(W, 1), Q = gel(W, 2);
    if (typ(P)!=t_POL) P = scalarpol_shallow(P, v);
    if (typ(Q)!=t_POL) Q = scalarpol_shallow(Q, v);
    if (!RgX_is_ZX(P) || !RgX_is_ZX(Q)) pari_err_TYPE(fun,W);
    if (degpol(P) > 2*g+2) pari_err_DOMAIN(fun, "deg(P)", ">", utoi(2*g+2), P);
    if (degpol(Q) > g+1) pari_err_DOMAIN(fun, "deg(Q)", ">", utoi(g+1), Q);
    W = mkvec2(P, Q);
  }
  *pW = W; *pF = F;
}

GEN
hyperellminimalmodel(GEN W, GEN *pM, GEN pr)
{
  pari_sp av = avma;
  GEN Wr, F, WM2, F2, W2, M2, Modd, Wf, ef, Mf;
  long g, v;
  check_hyperell_Q("hyperellminimalmodel",&W, &F);
  if (pr && (!is_vec_t(typ(pr)) || !RgV_is_ZV(pr)))
    pari_err_TYPE("hyperellminimalmodel",pr);
  g = hyperellgenus(F); v = varn(F);
  Wr = hyperell_redQ(W);
  if (!pr || RgV_isin(pr, gen_2))
  {
    WM2 = algo56(Wr,g); W2 = gel(WM2, 1); M2 = gel(WM2, 2);
    F2 = check_hyperell(W2);
  }
  else
  {
    W2 = Wr; F2 = F; M2 = mkvec2(gen_1, matid(2));
  }
  Modd = gel(algo57(F2, g, pr), 2);
  Wf = hyperell_redQ(minimalmodel_merge(W2, Modd, g, v));
  if (!pM) return gc_GEN(av, Wf);
  ef = mulii(gel(M2,1), gel(Modd,1));
  Mf = ZM2_mul(gel(M2,2), gel(Modd,2));
  *pM = hyperellisom_finalize(W, Wf, ef, Mf, g, v);
  return gc_all(av, 2, &Wf, pM);
}

GEN
hyperellminimaldisc(GEN W, GEN pr)
{
  pari_sp av = avma;
  GEN C = hyperellminimalmodel(W, NULL, pr);
  return gc_INT(av, hyperelldisc(C));
}

static GEN
redqfbsplit(GEN a, GEN b, GEN c, GEN d)
{
  GEN p = subii(d,b), q = shifti(a,1);
  GEN U, Q, u, v, w = bezout(p, q, &u, &v);

  if (!equali1(w)) { p = diviiexact(p, w); q = diviiexact(q, w); }
  U = mkmat22(p, negi(v), q, u);
  Q = qfb3_SL2_apply(mkvec3(a,b,c), U);
  b = gel(Q, 2); c = gel(Q,3);
  if (signe(b) < 0) gel(U,2) = mkcol2(v, negi(u));
  gel(U,2) = ZC_lincomb(gen_1, truedivii(negi(c), d), gel(U,2), gel(U,1));
  return U;
}

static GEN
polreduce(GEN P, GEN M)
{
  long v = varn(P), dP = degpol(P), d = odd(dP) ? dP+1: dP;
  GEN A = deg1pol_shallow(gcoeff(M,1,1), gcoeff(M,1,2), v);
  GEN B = deg1pol_shallow(gcoeff(M,2,1), gcoeff(M,2,2), v);
  return RgX_homogenous_evalpow(P, A, gpowers(B, d), d);
}

/* assume deg(P) > 2 */
static GEN
red_Cremona_Stoll(GEN P, GEN *pM)
{
  GEN q1, q2, q3, M, R;
  long i, prec = nbits2prec(2*gexpo(P)) + EXTRAPRECWORD, d = degpol(P);
  GEN dP = ZX_deriv(P);
  for (;;)
  {
    GEN r = QX_complex_roots(P, prec);
    q1 = gen_0; q2 = gen_0; q3 = gen_0;
    for (i = 1; i <= d; i++)
    {
      GEN ri = gel(r,i);
      GEN s = ginv(gabs(RgX_cxeval(dP,ri,NULL), prec));
      if (d!=4) s = gpow(s, gdivgs(gen_2,d-2), prec);
      q1 = gadd(q1, s);
      q2 = gsub(q2, gmul(real_i(ri), s));
      q3 = gadd(q3, gmul(gnorm(ri), s));
    }
    M = lllgram(mkmat22(q1,q2,q2,q3));
    if (M && lg(M) == 3) break;
    prec = precdbl(prec);
  }
  R = polreduce(P, M);
  *pM = M;
  return R;
}

/* assume deg(P) > 2 */
GEN
ZX_hyperellred(GEN P, GEN *pM)
{
  pari_sp av = avma;
  long d = degpol(P);
  GEN q1, q2, q3, D, vD;
  GEN a = gel(P,d+2), b = gel(P,d+1), c = gel(P, d);
  GEN M, R, M2;

  q1 = muliu(sqri(a), d);
  q2 = shifti(mulii(a,b), 1);
  q3 = subii(sqri(b), shifti(mulii(a,c), 1));
  D = gcdii(gcdii(q1, q2), q3);
  if (!equali1(D))
  {
    q1 = diviiexact(q1, D);
    q2 = diviiexact(q2, D);
    q3 = diviiexact(q3, D);
  }
  D = qfb_disc3(q1, q2, q3);
  if (!signe(D))
    M = mkmat22(gen_1, truedivii(negi(q2),shifti(q1,1)), gen_0, gen_1);
  else if (issquareall(D,&vD))
    M = redqfbsplit(q1, q2, q3, vD);
  else
    M = gel(qfbredsl2(mkqfb(q1,q2,q3,D), NULL), 2);
  R = red_Cremona_Stoll(polreduce(P, M), &M2);
  if (pM) *pM = gmul(M, M2);
  return gc_all(av, pM ? 2: 1, &R, pM);
}

GEN
hyperellred(GEN W, GEN *pM)
{
  pari_sp av = avma;
  long g, v;
  GEN F, M, Wf;
  check_hyperell_Q("hyperellred", &W, &F);
  g = hyperellgenus(F); v = varn(F);
  (void) ZX_hyperellred(F, &M);
  Wf = hyperell_redQ(minimalmodel_merge(W, mkvec2(gen_1, M), g, v));
  if (pM) *pM = hyperellisom_finalize(W, Wf, gen_1, M, g, v);
  return gc_all(av, pM ? 2: 1, &Wf, pM);
}

static void
check_hyperell_vc(const char *fun, GEN C, long v, GEN *e, GEN *M, GEN *H)
{
  if (typ(C) != t_VEC || lg(C) != 4) pari_err_TYPE(fun,C);
  *e = gel(C,1); *M = gel(C,2); *H = gel(C,3);
  if (typ(*M) != t_MAT || lg(*M) != 3 || lgcols(*M) != 3) pari_err_TYPE(fun,C);
  if (typ(*H) != t_POL || varncmp(varn(*H),v) > 0) *H = scalarpol_shallow(*H,v);
  if (varncmp(gvar(*M),v) <= 0) pari_err_PRIORITY(fun,*M,"<=",v);
}

GEN
hyperellchangecurve(GEN W, GEN C)
{
  pari_sp av = avma;
  GEN F, P, Q, A, B, Bp, e, M, H;
  long g, v;

  check_hyperell_Rg("hyperellchangecurve",&W,&F);
  P = gel(W,1); Q = gel(W,2);
  g = hyperellgenus(F); v = varn(F);
  check_hyperell_vc("hyperellchangecurve", C, v, &e, &M, &H);
  A = deg1pol_shallow(gcoeff(M,1,1), gcoeff(M,1,2), v);
  B = deg1pol_shallow(gcoeff(M,2,1), gcoeff(M,2,2), v);
  Bp = gpowers(B, 2*g+2);
  P = RgX_homogenous_evalpow(P, A, Bp, 2*g+2);
  Q = RgX_homogenous_evalpow(Q, A, Bp, g+1);
  P = RgX_Rg_div(RgX_sub(P, RgX_mul(H,RgX_add(Q,H))), gsqr(e));
  Q = RgX_Rg_div(RgX_add(Q, RgX_mul2n(H,1)), e);
  return gc_GEN(av, mkvec2(P,Q));
}

static int
checkhyperellpt_i(GEN pt, GEN *x, GEN *y, GEN *z)
{
  if (typ(pt) != t_VEC || lg(pt)<2 || lg(pt)>4)
    { *x=NULL; *y=NULL; *z=NULL; return 0; }
  if (lg(pt) == 2)
  {
    *x = gen_1; *y = gel(pt,1); *z = gen_0;
  } else
  {
    *x = gel(pt,1); *y = gel(pt,2);
    *z = lg(pt)==3 ? gen_1: gel(pt, 3);
  }
  return 1;
}

static GEN
wprojtoaff(GEN X, GEN Y, GEN Z, GEN pt, long g)
{
  if (lg(pt)==4) return mkvec3(X,Y,Z);
  return gequal0(Z) ? mkvec(gequal0(Y) ? gen_0: gdiv(Y,gpowgs(X,g+1)))
         : mkvec2(gdiv(X,Z),gequal0(Y) ? gen_0: gdiv(Y, gpowgs(Z,g+1)));
}

GEN
hyperellchangepointinv(GEN W, GEN pt, GEN C)
{
  pari_sp av = avma;
  GEN F, e, M, H, x, y, z, X, Y,Z;
  long g, v;

  check_hyperell_Rg("hyperellchangepointinv",&W,&F);
  g = hyperellgenus(F); v = varn(F);
  check_hyperell_vc("hyperellchangepointinv", C, v, &e, &M, &H);
  if (!checkhyperellpt_i(pt,&x,&y,&z))
    pari_err_TYPE("hyperellchangepointinv",pt);
  X = gadd(gmul(gcoeff(M,1,1), x), gmul(gcoeff(M,1,2),z));
  Z = gadd(gmul(gcoeff(M,2,1), x), gmul(gcoeff(M,2,2),z));
  Y = gadd(gmul(e, y), RgX_homogenous_eval(H, x, z, g+1));
  return gc_GEN(av, wprojtoaff(X,Y,Z,pt,g));
}

GEN
hyperellchangepoint(GEN W, GEN pt, GEN C)
{
  pari_sp av = avma;
  GEN F, e, M, H, x, y, z, X, Y, Z;
  GEN a, b, c, d, D;
  long g, v;

  check_hyperell_Rg("hyperellchangepoint",&W,&F);
  g = hyperellgenus(F); v = varn(F);
  check_hyperell_vc("hyperellchangepoint", C, v, &e, &M, &H);
  if (!checkhyperellpt_i(pt,&x,&y,&z))
    pari_err_TYPE("hyperellchangepoint",pt);
  a = gcoeff(M,1,1); b =  gcoeff(M,1,2);
  c = gcoeff(M,2,1); d =  gcoeff(M,2,2);
  Z = gsub(gmul(a, z), gmul(c, x));
  X = gsub(gmul(d, x), gmul(b, z));
  D = gsub(gmul(a, d), gmul(b, c));
  Y = gdiv(gsub(gmul(y, gpowgs(D, g+1)), RgX_homogenous_eval(H,X,Z,g+1)), e);
  return gc_GEN(av, wprojtoaff(X,Y,Z,pt,g));
}

GEN
hyperellchangeinvert(GEN W, GEN C)
{
  pari_sp av = avma;
  GEN F, e, M, H, ei, Mi, Hi, X, Z, Zp;
  long g, v;
  check_hyperell_Rg("hyperellchangeinvert",&W,&F);
  g = hyperellgenus(F); v = varn(F);
  check_hyperell_vc("hyperellchangeinvert", C, v, &e, &M, &H);
  ei = ginv(e);
  Mi = RgM_inv(M);
  X = deg1pol_shallow(gcoeff(Mi,1,1), gcoeff(Mi,1,2), v);
  Z = deg1pol_shallow(gcoeff(Mi,2,1), gcoeff(Mi,2,2), v);
  Zp = gpowers(Z, g+1);
  Hi = gmul(ei, gneg(RgX_homogenous_evalpow(H, X, Zp, g+1)));
  return gc_GEN(av, mkvec3(ei, Mi, Hi));
}

GEN
hyperellchangecompose(GEN W, GEN C1, GEN C2)
{
  pari_sp av = avma;
  GEN F, e1, M1, H1, e2, M2, H2, H, X, Z, Zp;
  long g, v;
  check_hyperell_Rg("hyperellchangecompose",&W,&F);
  g = hyperellgenus(F); v = varn(F);
  check_hyperell_vc("hyperellchangecompose", C1, v, &e1, &M1, &H1);
  check_hyperell_vc("hyperellchangecompose", C2, v, &e2, &M2, &H2);
  X = deg1pol_shallow(gcoeff(M2,1,1), gcoeff(M2,1,2), v);
  Z = deg1pol_shallow(gcoeff(M2,2,1), gcoeff(M2,2,2), v);
  Zp = gpowers(Z, g+1);
  H = gadd(gmul(e1,H2),RgX_homogenous_evalpow(H1, X, Zp, g+1));
  return gc_GEN(av, mkvec3(gmul(e1,e2), gmul(M1, M2), H));
}

int
hyperellisoncurve(GEN W, GEN P)
{
  pari_sp av = avma;
  GEN x, y, z, F;
  long g;
  int res;
  check_hyperell_Rg("hyperellisoncurve",&W,&F);
  g = hyperellgenus(F);
  if (!checkhyperellpt_i(P,&x,&y,&z)) pari_err_TYPE("hyperellisoncurve",P);
  if (typ(W)==t_POL)
    res = gequal(gsqr(y), RgX_homogenous_eval(W,x,z,2*g+2));
  else
  {
    GEN zp;
    if (typ(W)!=t_VEC || lg(W)!=3) pari_err_TYPE("hyperellisoncurve",W);
    zp = gpowers(z, 2*g+2);
    res = gequal(gmul(y, gadd(y,RgX_homogenous_evalpow(gel(W,2), x,zp,g+1))),
          RgX_homogenous_evalpow(gel(W,1),x,zp,2*(g+1)));
  }
  return gc_int(av, res);
}

/****************************************************************************/
/***                                                                      ***/
/***                        genus2charpoly                                ***/
/***                                                                      ***/
/****************************************************************************/

/* Half stable reduction */

static long
Zst_val(GEN P, GEN f, GEN p, long vt, GEN *pR)
{
  pari_sp av = avma;
  long v = varn(P);
  while(1)
  {
    long i, j, dm = LONG_MAX;
    GEN Pm = NULL;
    long dP = degpol(P);
    for (i = 0; i <= minss(dP, dm); i++)
    {
      GEN Py = gel(P, i+2);
      if (signe(Py))
      {
        if (typ(Py)==t_POL)
        {
          long dPy = degpol(Py);
          for (j = 0; j <= minss(dPy, dm-i); j++)
          {
            GEN c = gel(Py, j+2);
            if (signe(c))
            {
                if (i+j < dm)
                {
                  dm = i+j;
                  Pm = monomial(gen_1, dm, v);
                  gel(Pm,dm+2) = gen_0;
                }
                gel(Pm,i+2) = c;
            }
          }
        } else
        {
          if (i < dm)
          {
            dm = i;
            Pm = monomial(Py, dm, v);
          }
          else
            gel(Pm, i+2) = Py;
        }
      }
    }
    Pm = RgX_renormalize(Pm);
    if (ZX_pval(Pm,p)==0)
    {
      *pR = gc_GEN(av, P);
      return dm;
    }
    Pm = RgX_homogenize_deg(Pm, dm, vt);
    P = gadd(gsub(P, Pm), gmul(f, ZXX_Z_divexact(Pm, p)));
  }
}

static long
Zst_normval(GEN P, GEN f, GEN p, long vt, GEN *pR)
{
  long v = Zst_val(P, f, p, vt, pR);
  long e = RgX_val(*pR)>>1;
  if (e > 0)
  {
    v -= 2*e;
    *pR = RgX_shift(*pR, -2*e);
  }
  return v;
}

static GEN
RgXY_swapsafe(GEN P, long v1, long v2)
{
  if (varn(P)==v2)
  {
    P = shallowcopy(P); setvarn(P,v1); return P;
  } else
    return RgXY_swap(P, RgXY_degreex(P), v2);
}

static GEN
Zst_red1(GEN P, GEN f, GEN p, long vt)
{
  pari_sp av = avma;
  GEN r, f1, f2, P1, P2;
  long vs = varn(P);
  long w = Zst_normval(P, f, p, vt, &r), ww = w-odd(w);
  GEN st = monomial(pol_x(vt), 1, vs);
  f1 = gsubst(f, vt, st);
  P1 = gsubst(gdiv(r, monomial(gen_1,ww,vs)),vt,st);
  f2 = gsubst(f, vs, st);
  P2 = gsubst(gdiv(r, monomial(gen_1,ww,vt)),vs,st);
  f2 = RgXY_swapsafe(f2, vs, vt);
  P2 = RgXY_swapsafe(P2, vs, vt);
  return gc_GEN(av, mkvec4(P1, f1, P2, f2));
}

static GEN
Zst_reduce(GEN P, GEN p, long vt, long *pv)
{
  GEN C;
  long v = RgX_val(P);
  *pv = v + ZXX_pvalrem(RgX_shift(P, -v), p, &P);
  C = constant_coeff(P);
  C = typ(C) == t_POL ? C: scalarpol_shallow(C, vt);
  return FpX_red(C, p);
}

static GEN
Zst_red3(GEN C, GEN p, long vt)
{
  while(1)
  {
    GEN P1 = gel(C,1), f1 = gel(C,2), Poo = gel(C,3), foo= gel(C,4);
    long e;
    GEN Qoop = Zst_reduce(Poo, p, vt, &e), Qp, R;
    if (RgX_val(Qoop) >= 3-e)
    {
      C = Zst_red1(Poo, foo, p, vt);
      continue;
    }
    Qp = Zst_reduce(P1, p, vt, &e);
    R = FpX_roots_mult(Qp, 3-e, p);
    if (lg(R) > 1)
    {
      GEN xz = deg1pol_shallow(gen_1, gel(R,1), vt);
      C = Zst_red1(gsubst(P1, vt, xz), gsubst(f1, vt, xz), p, vt);
      continue;
    }
    return Qp;
  }
}

static GEN
genus2_halfstablemodel_i(GEN P, GEN p, long vt)
{
  GEN Qp, R, Poo, Qoop;
  long e = ZX_pvalrem(P, p, &Qp);
  R = FpX_roots_mult(FpX_red(Qp,p), 4-e, p);
  if (lg(R) > 1)
  {
    GEN C = Zst_red1(ZX_Z_translate(P, gel(R,1)), pol_x(vt), p, vt);
    return Zst_red3(C, p, vt);
  }
  Poo = RgXn_recip_shallow(P, 7);
  e = ZX_pvalrem(Poo, p, &Qoop);
  Qoop = FpX_red(Qoop,p);
  if (RgX_val(Qoop)>=4-e)
  {
    GEN C = Zst_red1(Poo, pol_x(vt), p, vt);
    return Zst_red3(C, p, vt);
  }
  return gcopy(P);
}

static GEN
genus2_halfstablemodel(GEN P, GEN p)
{
  pari_sp av = avma;
  long vt = fetch_var(), vs = varn(P);
  GEN S = genus2_halfstablemodel_i(P, p, vt);
  setvarn(S, vs); delete_var();
  return gc_GEN(av, S);
}

/* semi-stable reduction */

static GEN
genus2_redmodel(GEN P, GEN p)
{
  GEN LP, U, F;
  long i, k, r;
  if (degpol(P) < 0) return mkvec2(cgetg(1, t_COL), P);
  F = FpX_factor_squarefree(P, p);
  r = lg(F); U = NULL;
  for (i = k = 1; i < r; i++)
  {
    GEN f = gel(F,i);
    long df = degpol(f);
    if (!df) continue;
    if (odd(i)) U = U? FpX_mul(U, f, p): f;
    if (i > 1) gel(F,k++) = df == 1? mkcol(f): gel(FpX_factor(f, p), 1);
  }
  LP = leading_coeff(P);
  if (!U)
    U = scalarpol_shallow(LP, varn(P));
  else
  {
    GEN LU = leading_coeff(U);
    if (!equalii(LU, LP)) U = FpX_Fp_mul(U, Fp_div(LP, LU, p), p);
  }
  setlg(F,k); if (k > 1) F = shallowconcat1(F);
  return mkvec2(F, U);
}

static GEN
xdminusone(long d)
{
  return gsub(pol_xn(d, 0),gen_1);
}

static GEN
ellfromeqncharpoly(GEN P, GEN Q, GEN p)
{
  long v;
  GEN E, F, t, y;
  v = fetch_var();
  y = pol_x(v);
  F = gsub(gadd(ZX_sqr(y), gmul(y, Q)), P);
  E = ellinit(ellfromeqn(F), p, DEFAULTPREC);
  delete_var();
  t = ellcharpoly(E, p);
  obj_free(E);
  return t;
}

static GEN
nfellcharpoly(GEN e, GEN T, GEN p)
{
  GEN nf, E, t;
  e = shallowcopy(e);
  nf = nfinit(mkvec2(T, mkvec(p)), DEFAULTPREC);
  while(1)
  {
    E = ellinit(e, nf, DEFAULTPREC);
    if (lg(E)!=1) break;
    gel(e,5) = gadd(gel(e,5), p);
  }
  t = elleulerf(E, p);
  obj_free(E);
  return RgX_recip(ginv(t));
}

static GEN
genus2_red5(GEN P, GEN T, GEN p)
{
  long vx = varn(P), vy = varn(T);
  GEN f = shallowcopy(T), pi = shifti(p,-1);
  setvarn(f, vx);
  while(1)
  {
    GEN Pr, R, r, Rs;
    long v = ZXX_pvalrem(P, p, &Pr);
    R = FpXQX_roots_mult(Pr, 2-v, T, p);
    if (lg(R)==1) return P;
    r = FpX_center(gel(R,1), p, pi);
    Pr = RgX_affine(P, p, r);
    setvarn(r, vx);
    f = RgX_Rg_div(gsub(f, r), p);
    Rs = RgX_rem(RgXY_swap(Pr, 3, vy), gsub(f, pol_x(vy)));
    Pr = RgXY_swap(Rs, 3, vy);
    if (ZXX_pvalrem(Pr, sqri(p), &Pr)==0) return P;
    P = Pr;
  }
}

static GEN
genus2_type5(GEN P, GEN p)
{
  GEN E, F, T, a, a2, Q;
  long v;
  if (equaliu(p, 2))
    (void) ZXX_pvalrem(P, sqri(p), &P);
  (void) ZX_pvalrem(P, p, &F);
  F = FpX_red(F, p);
  if (degpol(F) < 1) return NULL;
  F = FpX_factor(F, p);
  if (mael(F,2,1) != 3 || degpol(gmael(F,1,1)) != 2) return NULL;
  T = gmael(F, 1, 1);
  v = fetch_var_higher();
  Q = RgV_to_RgX(ZX_digits(P, T), v);
  Q = genus2_red5(Q, T, p);
  a = gel(Q,5); a2 = ZX_sqr(a);
  E = mkvec5(gen_0, gel(Q,4), gen_0, ZX_mul(gel(Q,3),a), ZX_mul(gel(Q,2),a2));
  delete_var();
  return nfellcharpoly(E, T, p);
}

/* Assume P has semistable reduction at p */
static GEN
genus2_eulerfact_semistable(GEN P, GEN p)
{
  GEN Pp = FpX_red(P, p);
  GEN GU = genus2_redmodel(Pp, p);
  long d = 6-degpol(Pp), v = d/2, w = odd(d);
  GEN abe, tor;
  GEN ki, kp = pol_1(0), kq = pol_1(0);
  GEN F = gel(GU,1), Q = gel(GU,2);
  long dQ = degpol(Q), lF = lg(F)-1;

  abe = dQ >= 5 ? hyperellcharpoly(gmul(Q,gmodulo(gen_1,p)))
      : dQ >= 3 ? ellfromeqncharpoly(Q,gen_0,p)
                : pol_1(0);
  ki = dQ != 0 ? xdminusone(1)
              : Fp_issquare(gel(Q,2),p) ? ZX_sqr(xdminusone(1))
                                        : xdminusone(2);
  if (lF)
  {
    long i;
    for(i=1; i <= lF; i++)
    {
      GEN Fi = gel(F, i);
      long d = degpol(Fi);
      GEN e = FpX_rem(Q, Fi, p);
      GEN kqf = lgpol(e)==0 ? xdminusone(d):
                FpXQ_issquare(e, Fi, p) ? ZX_sqr(xdminusone(d))
                                        : xdminusone(2*d);
      kp = gmul(kp, xdminusone(d));
      kq = gmul(kq, kqf);
    }
  }
  if (v)
  {
    GEN kqoo = w==1 ? xdminusone(1):
               Fp_issquare(leading_coeff(Q), p)? ZX_sqr(xdminusone(1))
                                              : xdminusone(2);
    kp = gmul(kp, xdminusone(1));
    kq = gmul(kq, kqoo);
  }
  tor = RgX_div(ZX_mul(xdminusone(1), kq), ZX_mul(ki, kp));
  return ZX_mul(abe, tor);
}

GEN
genus2_eulerfact(GEN P, GEN p, long ra, long rt)
{
  pari_sp av = avma;
  GEN W, R, E;
  long d = 2*ra+rt;
  if (d == 0) return pol_1(0);
  R = genus2_type5(P, p);
  if (R) return R;
  W = hyperellextremalmodels_i(P, 2, p);
  if (lg(W) < 3)
  {
    GEN F = genus2_eulerfact_semistable(P,p);
    if (degpol(F)!=d)
    {
      GEN S = genus2_halfstablemodel(P, p);
      F = genus2_eulerfact_semistable(S, p);
      if (degpol(F)!=d) pari_err_BUG("genus2charpoly");
    }
    return F;
  }
  E =  gmul(genus2_eulerfact_semistable(gel(W,1),p),
            genus2_eulerfact_semistable(gel(W,2),p));
  return gc_upto(av, E);
}

/*   p = 2  */

static GEN
F2x_genus2_find_trans(GEN P, GEN Q, GEN F)
{
  pari_sp av = avma;
  long i, d = F2x_degree(F), v = P[1];
  GEN M, C, V;
  M = cgetg(d+1, t_MAT);
  for (i=1; i<=d; i++)
  {
    GEN Mi = F2x_rem(F2x_add(F2x_shift(Q,i-1), monomial_F2x(2*i-2,v)), F);
    gel(M,i) = F2x_to_F2v(Mi, d);
  }
  C = F2x_to_F2v(F2x_rem(P, F), d);
  V = F2m_F2c_invimage(M, C);
  return gc_leaf(av, F2v_to_F2x(V, v));
}

static GEN
F2x_genus2_trans(GEN P, GEN Q, GEN H)
{
  return F2x_add(P,F2x_add(F2x_mul(H,Q), F2x_sqr(H)));
}

static GEN
F2x_genus_redoo(GEN P, GEN Q, long k)
{
  if (F2x_degree(P)==2*k)
  {
    long c = F2x_coeff(P,2*k-1), dQ = F2x_degree(Q);
    if ((dQ==k-1 && c==1) || (dQ<k-1 && c==0))
     return F2x_genus2_trans(P, Q, monomial_F2x(k, P[1]));
  }
  return P;
}

static GEN
F2x_pseudodisc(GEN P, GEN Q)
{
  GEN dP = F2x_deriv(P), dQ = F2x_deriv(Q);
  return F2x_gcd(Q, F2x_add(F2x_mul(P, F2x_sqr(dQ)), F2x_sqr(dP)));
}

static GEN
F2x_genus_red(GEN P, GEN Q)
{
  long dP, dQ;
  GEN F, FF;
  P = F2x_genus_redoo(P, Q, 3);
  P = F2x_genus_redoo(P, Q, 2);
  P = F2x_genus_redoo(P, Q, 1);
  dP = F2x_degree(P);
  dQ = F2x_degree(Q);
  FF = F = F2x_pseudodisc(P,Q);
  while(F2x_degree(F)>0)
  {
    GEN M = gel(F2x_factor(F),1);
    long i, l = lg(M);
    for(i=1; i<l; i++)
    {
      GEN R = F2x_sqr(gel(M,i));
      GEN H = F2x_genus2_find_trans(P, Q, R);
      P = F2x_div(F2x_genus2_trans(P, Q, H), R);
      Q = F2x_div(Q, gel(M,i));
    }
    F = F2x_pseudodisc(P, Q);
  }
  return mkvec4(P,Q,FF,mkvecsmall2(dP,dQ));
}

/* Number of solutions of x^2+b*x+c */
static long
F2xqX_quad_nbroots(GEN b, GEN c, GEN T)
{
  if (lgpol(b) > 0)
  {
    GEN d = F2xq_div(c, F2xq_sqr(b, T), T);
    return F2xq_trace(d, T)? 0: 2;
  }
  else
    return 1;
}

static GEN
genus2_eulerfact2_semistable(GEN PQ)
{
  GEN V = F2x_genus_red(ZX_to_F2x(gel(PQ, 1)), ZX_to_F2x(gel(PQ, 2)));
  GEN P = gel(V, 1), Q = gel(V, 2);
  GEN F = gel(V, 3), v = gel(V, 4);
  GEN abe, tor;
  GEN ki, kp = pol_1(0), kq = pol_1(0);
  long dP = F2x_degree(P), dQ = F2x_degree(Q), d = maxss(dP, 2*dQ);
  if (!lgpol(F)) return pol_1(0);
  ki = dQ!=0 || dP>0 ? xdminusone(1):
      dP==-1 ? ZX_sqr(xdminusone(1)): xdminusone(2);
  abe = d>=5? hyperellcharpoly(gmul(PQ,gmodulss(1,2))):
        d>=3? ellfromeqncharpoly(F2x_to_ZX(P), F2x_to_ZX(Q), gen_2):
        pol_1(0);
  if (lgpol(F))
  {
    GEN M = gel(F2x_factor(F), 1);
    long i, lF = lg(M)-1;
    for(i=1; i <= lF; i++)
    {
      GEN Fi = gel(M, i);
      long d = F2x_degree(Fi);
      long nb  = F2xqX_quad_nbroots(F2x_rem(Q, Fi), F2x_rem(P, Fi), Fi);
      GEN kqf = nb==1 ? xdminusone(d):
                nb==2 ? ZX_sqr(xdminusone(d))
                      : xdminusone(2*d);
      kp = gmul(kp, xdminusone(d));
      kq = gmul(kq, kqf);
    }
  }
  if (maxss(v[1],2*v[2])<5)
  {
    GEN kqoo = v[1]>2*v[2] ? xdminusone(1):
               v[1]<2*v[2] ? ZX_sqr(xdminusone(1))
                           : xdminusone(2);
    kp = gmul(kp, xdminusone(1));
    kq = gmul(kq, kqoo);
  }
  tor = RgX_div(ZX_mul(xdminusone(1),kq), ZX_mul(ki, kp));
  return ZX_mul(abe, tor);
}

GEN
genus2_eulerfact2(GEN F, GEN PQ)
{
  pari_sp av = avma;
  GEN W, R = genus2_type5(F, gen_2), E;
  if (R) return R;
  W = hyperellextremalmodels_i(PQ, 2, gen_2);
  if (lg(W) < 3) return genus2_eulerfact2_semistable(PQ);
  E = gmul(genus2_eulerfact2_semistable(gel(W,1)),
           genus2_eulerfact2_semistable(gel(W,2)));
  return gc_upto(av, E);
}

GEN
genus2charpoly(GEN G, GEN p)
{
  pari_sp av = avma;
  GEN gr = genus2red(G, p), F;
  GEN PQ = gel(gr, 3), L = gel(gr, 4), r = gel(L, 4);
  GEN P = gadd(gsqr(gel(PQ, 2)), gmul2n(gel(PQ, 1), 2));
  if (equaliu(p,2))
    F = genus2_eulerfact2(P, PQ);
  else
    F = genus2_eulerfact(P,p, r[1],r[2]);
  return gc_upto(av, F);
}

/****************************************************************************/
/**                                                                        **/
/**                             hyperellisisom                             **/
/**                                                                        **/
/****************************************************************************/

/* Based on a magma script isgl2equiv.m from
   R. Lercier, C. Ritzenthaler & J. Sijsling
   https://github.com/JRSijsling/hyperelliptic/blob/main/magma/toolbox/isgl2equiv.m
   based on the paper
   R. Lercier, C. Ritzenthaler & J. Sijsling
   Fast computation of isomorphisms of hyperelliptic curves and explicit Galois descent.
   ANTS X pages 463-486. Mathematical Sciences Publishers, 2013.
   https://msp.org/obs/2013/1-1/obs-v1-n1-p23-s.pdf
   https://arxiv.org/pdf/1203.5440v1
*/

static long
hyperelldegree(GEN f)
{ long d = degpol(f); return d + odd(d); }

static GEN
hyperellchangevar(GEN P, GEN M, long v)
{
  long d = hyperelldegree(P);
  GEN A = deg1pol_shallow(gcoeff(M,1,1), gcoeff(M,1,2), v);
  GEN B = deg1pol_shallow(gcoeff(M,2,1), gcoeff(M,2,2), v);
  return RgX_homogenous_eval(P, A, B, d);
}

static GEN
checkisom(GEN nf, GEN f, GEN g, GEN s)
{
  GEN fs = gdiv(hyperellchangevar(f, s, varn(f)), g), z;
  if (typ(fs)!=t_POL || degpol(fs)!=0) return NULL;
  if (!nf) return issquareall(gel(fs,2), &z) ? z: NULL;
  return nfissquare(nf, gel(fs,2), &z) ? nf_to_scalar_or_polmod(nf, z):NULL;
}

static GEN
hyperellisisom_M0(GEN nf, GEN f, GEN g)
{
  pari_sp av = avma;
  GEN EQ2, EQ3, PG;
  long d = hyperelldegree(f), d2 = d*d, dg = degpol(g);
  GEN a0 = gel(f, 2), a1 = gel(f, 3), a2 = gel(f, 4), a3 = gel(f, 5);
  GEN bm0 = dg<d ? gen_0: gel(g, d+2), bm1 = gel(g, d+1), bm2 = gel(g, d), bm3 = gel(g, d-1);
  GEN L, R;
  long l, i, k = 1;
  GEN a1_2, a0_2, a0_3, bm0_2, bm0_3;
  if (gequal0(a0))
    return NULL;
  a1_2 = gsqr(a1); a0_2 = gsqr(a0); a0_3 = gmul(a0,a0_2);
  bm0_2 = gsqr(bm0); bm0_3 = gmul(bm0, bm0_2);
  EQ2 = mkpoln(3,
    gmul(bm0_2, gadd(gmulsg(1-d, a1_2), gmul(gmulgs(gmulsg(2, a2), d), a0))),
    gen_0,
    gmul(gneg(a0_2), gadd(gmul(gmulgs(gmulsg(2, bm2), d), bm0),
         gmulsg(1-d, gsqr(bm1)))));
  EQ3 = mkpoln(4,
    gmul(gmulsg(2, bm0_3), gadd(gmul(gadd(gmul(gmulsg(3*d2, a3), a0),
         gmul(gmulsg(6*d-3*d2, a2), a1)), a0), gmulsg(d2-3*d+2, gpowgs(a1, 3)))),
    gmul(gmul(gmul(gadd(gmul(gmulsg(6*d2-12*d, a2), a0),
         gmulsg(-3*d2+9*d-6, a1_2)), a0), bm1), gsqr(bm0)),
    gen_0,
    gmul(gadd(gmul(gmulsg(-6*d2, bm3), gsqr(bm0)), gmulsg(d2-3*d+2, gpowgs(bm1, 3))), a0_3));
  PG = RgX_gcd(EQ2, EQ3);
  if (gequal0(PG)) return NULL;
  if (degpol(PG)==0) retgc_const(av, cgetg(1, t_VEC));
  R = nfroots(nf, PG); l = lg(R);
  L = cgetg(l, t_VEC);
  for (i = 1; i < l; i++)
  {
    GEN B = gel(R, i), D, M;
    if (gequal0(B))
      continue;
    D = gdiv(gsub(gmul(bm1, a0), gmul(gmul(a1, B), bm0)), gmulgs(gmul(bm0, a0), d));
    M = mkmat22(gen_0, B, gen_1, D);
    if (checkisom(nf, f, g, M))
      gel(L, k++) = M;
  }
  setlg(L, k);
  return gc_GEN(av, L);
}

static GEN
RgX_hom_evaly(GEN F, GEN y, long d)
{ return poleval(RgXn_recip_shallow(F, d+1), y); }

#define Dy(a,b,c) RgX_homogenous_derivn(a,b,c)

static GEN
hyperellisisom_gen(GEN nf, GEN f1, GEN f2)
{
  GEN F2 = f2;
  long x = varn(f2);
  GEN Nm2, Nm3, Nm4, EQ1, EQ2, PG;
  GEN M12, bm0, bm2, bm3, F1, dF1, d2F1, d3F1, d4F1, L, R;
  GEN dF1_2, dF1_3, dF1_4;
  GEN dyF1, dyF1_2, dyF1_3, dyF1_4;
  long lR, i, Li = 1;
  long d2 = degpol(f2), d = hyperelldegree(f1);
  M12 = gel(f2, d2+1);
  if (!gequal0(M12))
  {
    M12 = gdiv(gneg(M12), gmulsg(d2, gel(f2, 2+d2)));
    f2 = RgX_Rg_translate(f2, M12);
  }
  bm0 = d2 < d ? gen_0: gel(f2, d + 2);
  bm2 = gel(f2, d);
  bm3 = gel(f2, d - 1);
  F1 = f1;
  dF1  = RgX_deriv(F1); d2F1 = RgX_deriv(dF1); d3F1 = RgX_deriv(d2F1); d4F1 = RgX_deriv(d3F1);
  dF1_2 = gsqr(dF1); dF1_3 = gmul(dF1_2, dF1); dF1_4 = gsqr(dF1_2);
  dyF1 = Dy(F1, 1, d); dyF1_2 = gsqr(dyF1); dyF1_3 = gmul(dyF1_2, dyF1); dyF1_4 = gsqr(dyF1_2);
  Nm2 = gadd(gsub(gmul(d2F1, dyF1_2), gmul(gmul(gmulsg(2, dF1), dyF1), Dy(dF1, 1, d-1))), gmul(Dy(F1, 2, d), dF1_2));
  Nm2 = RgX_div(RgXn_recip_shallow(Nm2, 3*d-4+1), RgXn_recip_shallow(F1, d+1));
  if (d > 3)
  {
    GEN bm4 = gel(f2, d - 2);
    Nm4 = gadd(gsub(gadd(gsub(gmul(d4F1, dyF1_4),
            gmul(gmul(gmulsg(4, Dy(d3F1, 1, d-3)), dyF1_3), dF1)),
            gmul(gmul(gmulsg(6, Dy(d2F1, 2, d-2)), dyF1_2), dF1_2)),
            gmul(gmul(gmulsg(4, Dy(dF1, 3, d-1)), dyF1), dF1_3)),
            gmul(Dy(F1, 4, d), dF1_4));
    Nm4 = RgX_div(RgXn_recip_shallow(Nm4, 5*d - 8+1), RgXn_recip_shallow(F1, d+1));
    EQ1 = gsub(gmul(gmul(gmulsg(6, bm0), bm4), gsqr(Nm2)), gmul(gsqr(bm2), Nm4));
  }
  Nm3 = gadd(gsub(gadd(gmul(gneg(d3F1), dyF1_3),
          gmul(gmul(gmulsg(3, Dy(d2F1, 1, d-2)), dyF1_2), dF1)),
          gmul(gmul(gmulsg(3, Dy(dF1, 2, d-1)), dyF1), dF1_2)),
          gmul(Dy(F1, 3, d), dF1_3));
  Nm3 = RgX_div(RgXn_recip_shallow(Nm3, 4*d - 6+1), RgXn_recip_shallow(F1, d+1));
  EQ2 = gsub(gmul(gmul(gmulsg(9, bm0), gsqr(bm3)), gpowgs(Nm2, 3)),
          gmul(gmulsg(2, gpowgs(bm2, 3)), gsqr(Nm3)));

  PG = d > 3 ? RgX_gcd(EQ1, EQ2): EQ2;
  if (gequal0(PG)) return NULL;
  if (lgpol(PG)==0) return cgetg(1, t_VEC);
  R = nfroots(nf, PG); lR = lg(R);
  L = cgetg(lR, t_VEC);
  for (i = 1; i < lR; i++)
  {
    long j, LRi = 1, k=1, lR, g;
    GEN gU, U, m, Rd;
    GEN degs, LR, g1, m12;
    GEN m21 = gel(R, i), d12 = RgX_hom_evaly(dF1, m21, d - 1), N,  D;
    if (gequal0(d12))
      return NULL;
    m12 = gdiv(RgX_hom_evaly(Dy(F1, 1, d), m21, d - 1), gneg(d12));
    g1 = RgX_homogenous_eval(F1, deg1pol_shallow(gen_1, m12, x), deg1pol_shallow(m21, gen_1, x), d);
    for (j = 1; j < d; j++)
    {
      GEN am1 = gel(g1, j+1), am0 = gel(g1, j+2), ap1 = gel(g1, j+3);
      GEN bm1 = gel(f2, j+1), bm0 = gel(f2, j+2), bp1 = gel(f2, j+3);
      if (!gequal(gmul(gmul(am1, ap1), gsqr(bm0)), gmul(gmul(bm1, bp1), gsqr(am0))))
        break;
    }
    if (j < d) continue;
    degs = cgetg(d, t_VEC);
    for (j = 2; j <= d; ++j)
      if (!gequal0(gel(f2, d-j+2)))
        gel(degs, k++) = stoi(j);
    setlg(degs,k);
    gU = mathnf0(degs, 1);
    g = itos(gmael3(gU,1, 1, 1));
    U = gel(gU, 2); U = vec_to_vecsmall(gel(U, lg(U)-1));
    degs = vec_to_vecsmall(degs);
    for (j = 2; j <= d+2; j++)
      if (gequal0(gel(g1, j)) != gequal0(gel(f2, j)))
        break;
    if (j < d) continue;
    m = gdiv(gel(g1, d+2), gel(f2, d+2));
    N = gen_1; D = gen_1;
    for (j = 1; j < k; ++j)
    {
      long c = 2+d-degs[j];
      N = gmul(N, gpowgs(gmul(m, gel(f2, c)), U[j]));
      D = gmul(D, gpowgs(gel(g1, c), U[j]));
    }
    Rd = nfroots(nf, gsub(gmul(D, pol_xn(g, x)), N)); lR = lg(Rd);
    LR = cgetg(lR, t_VEC);
    for (j = 1; j < lR; j++)
    {
      GEN RL = gel(Rd, j);
      GEN M = mkmat22(gen_1, gsub(gmul(m12,RL),M12), m21, gsub(RL,gmul(M12,m21)));
      if (checkisom(nf, f1, F2, M))
        gel(LR, LRi++) = M;
    }
    setlg(LR, LRi);
    gel(L, Li++) = LR;
  }
  setlg(L,Li);
  return Li>1 ? shallowconcat1(L): cgetg(1,t_VEC);
}

#undef Dy

static GEN
random_SL2(GEN B)
{
  GEN a, b, d, u, v;
  do { a = randomi(B); b = randomi(B); } while (signe(a)==0 && signe(b)==0);
  d = bezout(a,b,&u,&v);
  if(!is_pm1(d)) { a = diviiexact(a,d); b = diviiexact(b,d); }
  return mkmat22(a, b, v, negi(u));
}

static GEN
nfM_primpart(GEN nf, GEN M)
{
  pari_sp av = avma;
  GEN d, id = nfV_idealhnf(nf, RgM_flatten_RgC(M), &d);
  GEN c = gel(idealred(nf, mkvec2(id, gen_1)), 2);
  GEN A = gdiv(M, nf_to_scalar_or_polmod(nf, c));
  return gc_upto(av, d ? gmul(A,d): A);
}

static GEN
nfhyperellisisom(GEN nf, GEN W1, GEN W2)
{
  pari_sp av = avma, av2;
  long i, v, g;
  GEN f1, f2, F1, F2, M1 = NULL, M2 = NULL;
  if (nf)
  {
    GEN u;
    checknf(nf);
    u = gmodulo(gen_1, nf_get_pol(nf));
    W1 = gmul(W1, u);
    W2 = gmul(W2, u);
  }
  check_hyperell_Rg("hyperellisisom", &W1, &F1); f1 = F1;
  check_hyperell_Rg("hyperellisisom", &W2, &F2); f2 = F2;
  g = hyperellgenus(F1); v = varn(F1);
  if (g < 1) pari_err_DOMAIN("hyperellisisom","genus(C1)","<",gen_1,W1);
  if (hyperellgenus(F2) != g) return cgetg(1,t_VEC);
  av2 = avma;
  for (i = 10; ; i++)
  {
    GEN Q0 = hyperellisisom_M0(nf, f1, f2);
    GEN Qp = hyperellisisom_gen(nf, f1, f2);
    if (Q0 && Qp)
    {
      GEN Q = shallowconcat(Q0,Qp);
      long i, l = lg(Q);
      GEN V = cgetg(2*l-1, t_VEC);
      for (i = 1; i < l; i++)
      {
        GEN Mr = !M1 ? gel(Q,i): RgM_mul(RgM_mul(M1, gel(Q, i)), M2);
        GEN M = nf ? nfM_primpart(nf, Mr): Q_primpart(Mr);
        GEN e = checkisom(nf, F1, F2, M);
        gel(V,2*i-1) = hyperellisom_finalize(W1, W2, e, M, g, v);
        gel(V,2*i)   = hyperellisom_finalize(W1, W2, gneg(e), M, g, v);
      }
      return gc_GEN(av, V);
    }
    set_avma(av2);
    M1 = random_SL2(stoi(-i));
    f1 = hyperellchangevar(F1, M1, v);
    M2 = random_SL2(stoi(-i));
    f2 = hyperellchangevar(F2, ginv(M2), v);
  }
}

GEN
hyperellisisom(GEN W1, GEN W2, GEN nf)
{ return nfhyperellisisom(nf, W1, W2); }

GEN
hyperellauto(GEN W, GEN nf)
{ return nfhyperellisisom(nf, W, W); }
