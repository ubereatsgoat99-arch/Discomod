/* Copyright (C) 2000  The PARI group.

This file is part of the PARI/GP package.

PARI/GP is free software; you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation. It is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY WHATSOEVER.

Check the License for details. You should have received a copy of it, along
with the package; see the file 'COPYING'. If not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA. */

#include "pari.h"
#include "paripriv.h"

/*****************************************************************/
/*             Program to compute L(chi,s)                       */
/*      for Im(s) large, chi primitive Dirichlet character       */
/*      In the present branch, only Tyagi's method is used      */
/*****************************************************************/
/* In addition, C can also be a polynomial defining an abelian
 * extension of Q. */

/*****************************************************************/
/*                      Character programs                       */
/*****************************************************************/
/* A character, always assumed primitive can be given in the following formats:
 * - omitted or 0: special to zetaRS,
 * - a t_INT: assumed to be a discriminant,
 * - a t_INTMOD: a conrey character,
 * - a pair [G,chi] or [bnr,chi],
 * - [C1,C2,...]~ where the Ci are characters as above with same moduli. */

/* Given a list of linit/ldata for chars of same conductor F, return
 * [Vecan, F, Parities, Gaussums] */
static GEN
mycharinit(GEN C, long bit)
{
  GEN L, LVC, LE, LGA;
  long F = 0, i, j, lc = lg(C), prec;

  bit += 64; prec = nbits2prec(bit);
  L = cgetg(lc, t_VEC);
  LE = cgetg(lc, t_VECSMALL);
  LGA = cgetg(lc, t_VEC);
  for (i = 1; i < lc; i++)
  {
    GEN gv, ga, gm, ro, ldata = gel(C, i);
    long e;
    if (is_linit(ldata)) ldata = linit_get_ldata(ldata);
    gv = ldata_get_gammavec(ldata); e = itou(gel(gv, 1));
    gm = ldata_get_conductor(ldata);
    ro = ldata_get_rootno(ldata);
    if (isintzero(ro)) ro = lfunrootno(ldata, bit);
    ga = gmul(ro, gsqrt(gm, prec)); if (e) ga = mulcxI(ga);
    gel(LGA, i) = ga;
    LE[i] = e;
    if (i == 1) F = itos(gm); /* constant */
    gel(L, i) = lfunan(ldata, F, prec);
  }
  if (lc == 2 && is_vec_t(typ(gmael(L,1,1))))
  { /* multichar */
    LGA = gel(LGA,1); lc = lg(LGA);
    LVC = gel(L,1);
    LE = const_vecsmall(lc-1, LE[1]); /* FIXME: can handle mixed values */
  }
  else
  {
    LVC = cgetg(F + 1, t_VEC);
    for (j = 1; j <= F; j++)
    {
      GEN v = cgetg(lc, t_VEC);
      for (i = 1; i < lc; i++) gel(v, i) = gmael(L, i, j);
      gel(LVC, j) = v;
    }
  }
  return mkvec5(LVC, stoi(F), LE, LGA, grootsof1(2*F, prec));
}

/* n >= 1 and #VC = F, the conductor of the character or multicharacter X.
 * VC contains [X(1),X(2),...X(F)] */
static GEN
mycall(GEN VC, long n)
{
  long F = lg(VC) - 1;
  GEN z = n <= F ? gel(VC, n) : gel(VC, ((n - 1) % F) + 1);
  return gequal0(z)? NULL: z;
}

static GEN get_chivec(GEN VCALL) { return gel(VCALL, 1); }
static long get_modulus(GEN VCALL) { return itos(gel(VCALL, 2)); }
static GEN get_signat(GEN VCALL) { return gel(VCALL, 3); }
static GEN get_gauss(GEN VCALL) { return gel(VCALL, 4); }
static GEN get_chiZ(GEN VCALL) { return gel(VCALL, 5); }

/* (-1)^A[i] * conj(B[i]) */
static GEN
gnegconj(GEN A, GEN B)
{
  long i, l = lg(A);
  GEN W = cgetg(l, t_VEC);
  for (i = 1; i < l; i++)
  { GEN b = gconj(gel(B,i)); gel(W,i) = A[i]? gneg(b): b; }
  return W;
}
/* g(conj(CHI)) */
static GEN
gaussconj(GEN VCALL)
{ return gnegconj(get_signat(VCALL), get_gauss(VCALL)); }

static GEN
myinitconj(GEN VCALL)
{
  GEN CONJ = shallowcopy(VCALL);
  gel(CONJ, 1) = gconj(get_chivec(VCALL));
  gel(CONJ, 4) = gaussconj(VCALL); return CONJ;
}

/********************************************************************/
/*                          Driver Program                          */
/********************************************************************/

/* assume |Im(s)| >> 1, in particular s is not a negative integer */
static GEN
applyfuneq(GEN gau, GEN s, GEN z, long odd, long q, long bitprec)
{
  GEN t, S, rS;
  long prec;
  if (!gequal0(s)) bitprec += maxss(gexpo(s), 0);
  prec = nbits2prec(bitprec);
  if (odd) gau = mulcxmI(gau);
  S = mulcxI(gmul(Pi2n(-1,prec),gsubgs(s, odd)));
  rS = real_i(S);
  if (gsigne(rS) < 0) { S = gneg(S); rS = gneg(rS); }
  if (gcmpgs(rS, bitprec) <= 0)
    S = gadd(S,glog1p(gexp(gmulgs(S,-2),prec),prec));
  t = gexp(gneg(gadd(S, glngamma(s, prec))), prec);
  t = gmul(gpow(gdivgs(Pi2n(1, prec), q), s, prec), t);
  return gmul(gmul(gau, t), z);
}

static GEN RZchi(GEN VCALL, GEN s, long prec);

/* VCALL already initialized */
static GEN
lfunlarge_char(GEN VCALL, GEN s, long bitprec)
{
  pari_sp av = avma;
  GEN sig, tau, z;
  long funeq = 0, ts = typ(s), stau, flconj, q;
  if (!is_real_t(ts) && ts != t_COMPLEX) pari_err_TYPE("lfunlarge_char", s);
  sig = real_i(s); tau = imag_i(s);
  if (gexpo(tau) < 1) pari_err_DOMAIN("lfun","im(s)", "<", gen_2, tau);
  stau = gsigne(tau);
  if (stau < 0) { tau = gneg(tau); VCALL = myinitconj(VCALL); }
  if (gcmp(sig, ghalf) < 0) { funeq = 1; sig = gsubsg(1, sig); }
  flconj = ((stau > 0 && funeq) || (stau < 0 && !funeq));
  q = get_modulus(VCALL); bitprec += gexpo(stoi(q));
  z = RZchi(VCALL, mkcomplex(sig, tau), nbits2prec(bitprec));
  if (flconj) z = gconj(z);
  if (funeq)
  {
    GEN odd = get_signat(VCALL), gau = get_gauss(VCALL), Vz;
    long lC = lg(gau), j;
    Vz = cgetg(lC, t_VEC);
    for (j = 1; j < lC; j++)
      gel(Vz,j) = applyfuneq(gel(gau,j), s, gel(z,j), odd[j], q, bitprec);
    z = Vz;
  }
  return gc_GEN(av, z);
}

static GEN
lfungetchars(GEN pol)
{
  GEN L, F, v, bnf = Buchall(pol_x(1), 0, LOWDEFAULTPREC);
  GEN w, condall, bnr;
  long i, l, lc;
  condall = rnfconductor(bnf, pol); bnr = gel(condall, 2);
  L = bnrchar(bnr, gel(condall, 3), NULL); lc = lg(L);
  F = cgetg(lc, t_VEC);
  for (i = 1; i < lc; i++)
  {
    GEN chi = gel(L, i), cond = bnrconductor_raw(bnr, chi);
    gel(F, i) = gcoeff(gel(cond,1), 1, 1);
  }
  w = vec_equiv(F); l = lg(w); v = cgetg(l, t_COL);
  for (i = 1; i < l; i++)
  {
    GEN wi = gel(w, i), vi;
    long j, li = lg(wi);
    gel(v,i) = vi = cgetg(li, t_VEC);
    if (li == 2 && equali1(gel(F, wi[1]))) /* common conductor is 1 */
      gel(vi,1) = lfunmisc_to_ldata_shallow(gen_1);
    else
    {
      for (j = 1; j < li; j++)
        gel(vi,j) = lfunmisc_to_ldata_shallow(mkvec2(bnr, gel(L, wi[j])));
    }
  }
  return v;
}

/********************************************************************/
/*            NEW RS IMPLEMENTATION FROM SANDEEP TYAGI              */
/********************************************************************/
/* See arXiv:2203.02509v2 */

static long m_n0(GEN sel) { return itos(gel(sel, 1)); }
static GEN m_r0(GEN sel) { return gel(sel, 2); }
static GEN m_al(GEN sel) { return gel(sel, 3); }
static GEN m_aleps(GEN sel) { return gel(sel, 4); }
static GEN m_h(GEN sel) { return gel(sel, 5); }
static GEN m_lin(GEN sel) { return gel(sel, 6); }
static long m_np(GEN sel) { return itou(gel(sel, 7)); }

static GEN
phi_hat(GEN x, long prec)
{
  GEN y;
  if (gsigne(imag_i(x)) > 0)
    y = gneg(gexpm1(gneg(gmul(PiI2(prec), x)), prec));
  else
    y = gexpm1(gmul(PiI2(prec), x), prec);
  return ginv(y);
}

static GEN
phi_hat_h0(GEN sel, long k, long prec)
{
  GEN t = gdiv(gsubsg(m_n0(sel) + k, m_r0(sel)), m_aleps(sel));
  return phi_hat(gdiv(gasinh(t, prec), m_h(sel)), prec);
}

/* v[i] = A[i] * (a + (-1)^E[i] b) */
static GEN
mul_addsub(GEN A, GEN a, GEN b, GEN E)
{
  long i, l = lg(E);
  GEN v = cgetg(l, t_VEC);
  for (i = 1; i < l; i++)
    gel(v,i) = gmul(gel(A,i), E[i]? gsub(a, b): gadd(a, b));
  return v;
}

static GEN
wd(GEN VCALL, GEN xpmd, long prec)
{
  GEN VC = get_chivec(VCALL), E = get_signat(VCALL), Z = get_chiZ(VCALL);
  GEN ex, emx, y = NULL;
  long md = get_modulus(VCALL), N = 2*md, k;
  ex = gexp(mulcxI(xpmd), prec); emx = ginv(ex);
  for (k = 1; k <= (md-1) / 2; k++)
  {
    GEN xc = mycall(VC, k);
    if (xc)
    {
      GEN p3, p2, p1 = gmul(xc, gel(Z, Fl_neg(Fl_sqr(k,N), N) + 1));
      GEN a = gmul(ex, gel(Z, N - k + 1)), b = gmul(emx, gel(Z, k + 1));
      GEN c = gmul(ex, gel(Z, k + 1)), d = gmul(emx, gel(Z, N - k + 1));
      if (odd(md))
      {
        p2 = ginv(mulcxmI(gmul2n(gsub(a,b), -1))); /* 1 / sin(xpmd - kpmd) */
        p3 = ginv(mulcxmI(gmul2n(gsub(c,d), -1))); /* 1 / sin(xpmd + kpmd) */
      }
      else
      {
        p2 = mulcxI(gdiv(gadd(a,b), gsub(a,b))); /* cotan(xpmd - kpmd) */
        p3 = mulcxI(gdiv(gadd(c,d), gsub(c,d))); /* cotan(xpmd + kpmd) */
      }
      p1 = mul_addsub(p1, p2, p3, E);
      y = y ? gadd(y, p1) : p1;
    }
  }
  return mulcxmI(gdivgs(y, N));
}

static GEN
series_h0(long n0, GEN s, GEN VCALL, long fl, long prec)
{
  GEN C = get_modulus(VCALL) == 1? NULL: get_chivec(VCALL);
  GEN R = pardirpowerssumfun(C, n0, gneg(s), fl, prec);
  if (C) return R;
  if (fl) return mkvec2(mkvec(gel(R,1)), mkvec(gel(R,2)));
  return mkvec(R);
}

static GEN
series_residues_h0(GEN sel, GEN s, GEN VCALL, long prec)
{
  long n0 = m_n0(sel), np = m_np(sel), k;
  GEN val = gen_0, VC = get_chivec(VCALL);
  for (k = maxss(1 - np, 1 - n0); k <= 1 + np; k++)
  {
    GEN nk = mycall(VC, n0 + k); /* n0 + k > 0 */
    if (nk) val = gadd(val, gmul(gmul(phi_hat_h0(sel, k, prec), nk),
                                 gpow(stoi(n0 + k), gneg(s), prec)));
  }
  return val;
}

static GEN
integrand_h0(GEN sel, GEN s, GEN VCALL, GEN x, long prec)
{
  pari_sp av = avma;
  long md = get_modulus(VCALL);
  GEN r0 = m_r0(sel), aleps = m_aleps(sel), zn, p1;
  GEN znpmd, pmd = divru(mppi(prec), md), ix = ginv(x);

  zn = gadd(r0, gdivgs(gmul(aleps, gsub(x, ix)), 2));
  znpmd = gmul(pmd, zn);
  p1 = gsub(mulcxI(gmul(znpmd, zn)), gmul(s, glog(zn, prec)));
  p1 = gmul(gexp(p1, prec), gmul(aleps, gadd(x, ix)));
  if (md == 1)
    p1 = gdiv(mkvec(mulcxI(p1)), gmul2n(gsin(znpmd, prec), 2));
  else
    p1 = gdivgs(gmul(p1, wd(VCALL, znpmd, prec)), -2);
  return gc_upto(av, p1);
}

static GEN
integral_h0(GEN sel, GEN s, GEN VCALL, long prec)
{
  GEN lin_grid = m_lin(sel), S = gen_0;
  pari_sp av = avma;
  long j, l = lg(lin_grid);
  for (j = 1; j < l; j++)
  {
    S = gadd(S, integrand_h0(sel, s, VCALL, gel(lin_grid, j), prec));
    if ((j & 0xff) == 0) S = gc_upto(av, S);
  }
  return gc_upto(av, gmul(m_h(sel), S));
}

/* a + log |x|, a t_REAL, low accuracy */
static GEN
addrlogabs(GEN a, GEN x)
{
  long prec = DEFAULTPREC;
  if (gequal0(x)) return real_m2n(64, prec); /* -oo */
  switch(typ(x))
  {
    case t_COMPLEX: return gmul2n(glog(cxnorm(x), prec), -1);
    case t_REAL: break;
    default: x = gtofp(x, prec);
  }
  return addrr(a, logr_abs(x));
}

struct fun_q_t { GEN sel, s, VCALL, B; };
static GEN
fun_q(void *E, GEN x)
{
  struct fun_q_t *S = (struct fun_q_t *)E;
  GEN z = integrand_h0(S->sel,S->s,S->VCALL, gexp(x,DEFAULTPREC), DEFAULTPREC);
  if (typ(z) == t_VEC) z = vecsum(z);
  return addrlogabs(S->B, z);
}
static GEN
brent_q(void *E, GEN (*f)(void*,GEN), GEN q_low, GEN q_hi)
{
  if (gsigne(f(E, q_low)) * gsigne(f(E, q_hi)) >= 0) return NULL;
  return zbrent(E, f, q_low, q_hi, LOWDEFAULTPREC);
}
static GEN
findq(void *E, GEN (*f)(void*,GEN), GEN lq, long prec)
{
  GEN q_low, q_hi, q_right, q_left, q_est = gasinh(lq, LOWDEFAULTPREC);
  q_low = gdivgs(gmulsg(4, q_est), 5);
  q_hi = gdivgs(gmulsg(3, q_est), 2);
  q_right = brent_q(E, f, q_low, q_hi); if (!q_right) q_right = q_est;
  q_left = brent_q(E, f, gneg(q_low), gneg(q_hi)); if (!q_left) q_left = q_est;
  return gprec_w(gmax(q_right, q_left), prec);
}

static GEN
set_q_value(GEN sel, GEN s, GEN VCALL, long prec)
{
  struct fun_q_t E;
  GEN al = m_al(sel), lq;
  long md = get_modulus(VCALL), LD = DEFAULTPREC;
  E.sel = sel; E.s = s; E.VCALL = VCALL, E.B = mulur(prec, mplog2(LD));
  lq = gdiv(gsqrt(gdiv(gmulsg(md, E.B), Pi2n(1, LD)), LD), al);
  return findq((void*)&E, &fun_q, lq, prec);
}

static GEN
setlin_grid_exp(GEN h, long m, long prec)
{
  GEN w, vex = gpowers(gexp(h, prec), (m - 1)/2);
  long i;
  w = cgetg(m+1, t_VEC); gel(w, (m + 1)/2) = gen_1;
  for (i = (m + 3)/2; i <= m; i++)
  {
    GEN t1 = gel(vex, i - ((m - 1)/2));
    gel(w, i) = t1; gel(w, (m + 1) - i) = ginv(t1);
  }
  return w;
}

static long
get_m(GEN q, long prec)
{
  GEN t = divrr(mulur(4 * prec, mplog2(prec)), sqrr(mppi(prec)));
  return 2*itos(gfloor(mulrr(q, t))) + 1;
}

static GEN
RZinit(GEN s, GEN VCALL, GEN numpoles, long prec)
{
  GEN sel, al, aleps, n0, r0, q, h;
  long md = get_modulus(VCALL), m;
  al = gcmpgs(gabs(imag_i(s), prec), 100) < 0 ? ginv(stoi(4)) : gen_1;
  r0 = gsqrt(gdiv(gmulgs(s, md), PiI2(prec)), prec);
  n0 = gfloor(gsub(real_i(r0), imag_i(r0)));
  aleps = gmul(al, gexp(PiI2n(-2, prec), prec));
  sel = mkvecn(7, n0, r0, al, aleps, NULL, NULL, numpoles);
  q = set_q_value(sel, s, VCALL, prec);
  m = get_m(q, prec);
  gel(sel,5) = h = divru(q, (m - 1) >> 1);
  gel(sel,6) = setlin_grid_exp(h, m, prec);
  return sel;
}

static GEN
xpquo_one(GEN s, GEN cs, GEN ga, long odd, long md, long prec)
{
  GEN rho, a = odd? gen_1: gen_0, z = divsr(md, mppi(prec));
  rho = gmul(gdiv(gpow(gen_I(), gdivgs(gneg(a), 2), prec), gsqrt(ga, prec)),
             gpow(stoi(md), ginv(stoi(4)), prec));
  return gmul(gdiv(gconj(gmul(rho, gpow(z, gdivgs(cs, 2), prec))),
                   gmul(rho, gpow(z, gdivgs(s, 2), prec))),
              gexp(gsub(gconj(glngamma(gdivgs(gadd(cs, a), 2), prec)),
                        glngamma(gdivgs(gadd(s, a), 2), prec)), prec));
}

static GEN
xpquo(GEN s, GEN VCALL, long prec)
{
  GEN  ve = get_signat(VCALL), VC = get_chivec(VCALL), Z = get_chiZ(VCALL);
  GEN R, cs, cd = NULL;
  long md = get_modulus(VCALL), lve = lg(ve), n, i;
  if (!gequal0(s)) prec = nbits2prec(prec + maxss(gexpo(s), 0));
  if (md == 1)
    return gmul(gpow(mppi(prec), gsub(s, ghalf), prec),
                gexp(gsub(glngamma(gdivgs(gsubsg(1, s), 2), prec),
                          glngamma(gdivgs(s, 2), prec)), prec));
  for (n = 1; n < md; n++)
  {
    GEN xn = mycall(VC, n);
    if (xn)
    {
      xn = gmul(xn, gel(Z, 2*(md - n) + 1));
      cd = cd ? gadd(cd, xn) : xn;
    }
  }
  cs = gsubsg(1, gconj(s)); R = cgetg(lve, t_VEC);
  for (i = 1; i < lve; i++)
    gel(R, i) = xpquo_one(s, cs, gel(cd, i), ve[i], md, prec);
  if (lve == 2) R = gel(R, 1);
  return R;
}

static GEN
total_value(GEN serh0, GEN sel, GEN s, GEN VCALL, long prec)
{
  return gadd(integral_h0(sel, s, VCALL, prec),
              gsub(serh0, series_residues_h0(sel, s, VCALL, prec)));
}
static GEN
dirichlet_ours(GEN s, GEN VCALL, long prec)
{
  int fl = !gequal(real_i(s), ghalf);
  GEN sel = RZinit(s, VCALL, gen_1, prec);
  GEN S1, S2, serh0 = series_h0(m_n0(sel), s, VCALL, fl, prec);
  if (!fl)
    S2 = S1 = total_value(serh0, sel, s, VCALL, prec);
  else
  {
    S1 = total_value(gel(serh0,1), sel, s, VCALL, prec);
    S2 = total_value(gconj(gel(serh0,2)), sel, gsubsg(1, gconj(s)), VCALL, prec);
  }
  return gadd(S1, vecmul(xpquo(s, VCALL, prec), gconj(S2)));
}

/* assume |Im(s)| > 2^-bitprec */
static GEN
RZchi(GEN VCALL, GEN s, long prec)
{
  long prec2 = prec + EXTRAPREC64;
  return gprec_wtrunc(dirichlet_ours(gprec_w(s, prec2), VCALL, prec2), prec);
}

/********************************************************************/
/*                         Utility Functions                        */
/********************************************************************/
/* lam = 0, return L(s); else Lambda(s) */
static GEN
lfuncharall(GEN VCALL, GEN s, long lam, long bitprec)
{
  GEN ve, P, Q, R, z = lfunlarge_char(VCALL, s, bitprec);
  long l, i, q, prec;
  if (!lam) return z;
  ve = get_signat(VCALL); l = lg(ve);
  q = get_modulus(VCALL); prec = nbits2prec(bitprec);
  R = cgetg(l, t_VEC);
  Q = divur(q, mppi(prec));
  P = (q == 1 || zv_equal0(ve))? NULL: gsqrt(utoipos(q), prec);
  for (i = 1; i < l; i++)
  {
    GEN se = gmul2n(gaddgs(s, ve[i]), -1), r;
    if (lam == 1)
    {
      r = gmul(gpow(Q, se, prec), ggamma(se, prec));
      if (P && ve[i]) r = gdiv(r, P);
    }
    else
    {
      r = gadd(gmul(se, glog(Q, prec)), glngamma(se, prec));
      if (P && ve[i]) r = gsub(r, glog(P, prec));
    }
    gel(R, i) = r;
  }
  return lam == 1 ? vecmul(R, z) : gadd(R, glog(z, prec));
}

static GEN
lfunlargeall_from_chars(GEN v, GEN s, long lam, long bit)
{
  long i, l = lg(v);
  for (i = 1; i < l; i++)
  {
    GEN w = mycharinit(gel(v, i), bit), L = lfuncharall(w, s, lam, bit);
    gel(v, i) = lam==-1 ? vecsum(L): vecprod(L);
  }
  return lam==-1 ? vecsum(v): vecprod(v);
}
static GEN
lfunlargeall(GEN ldata, GEN s, long lam, long bit)
{
  GEN w, an;
  if (lg(ldata) == 2)
  { /* HACK: ldata[1] a t_DESC_PRODUCT from lfunabelianrelinit / Q */
    GEN v = lfunprod_get_fact(linit_get_tech(gel(ldata,1)));
    long i, l;
    v = shallowcopy(gel(v,1)); l = lg(v);
    for (i = 1; i < l; i++) gel(v,i) = mkvec(gel(v,i));
    return lfunlargeall_from_chars(v, s, lam, bit);
  }
  an = gel(ldata_get_an(ldata), 2);
  switch(ldata_get_type(ldata))
  {
    case t_LFUN_NF:
    {
      GEN v = lfungetchars(nf_get_pol(an));
      return lfunlargeall_from_chars(v, s, lam, bit);
    }
    case t_LFUN_CHIGEN:
    {
      GEN chi = gmael(an, 2, 2);
      if (lg(chi) > 1 && is_vec_t(typ(gel(chi,1))))
      { /* multi char */
        w = mycharinit(mkcol(ldata), bit);
        return lfuncharall(w, s, lam, bit);
      }
    }
    default: /* single char */
      w = mycharinit(mkcol(ldata), bit);
      return gel(lfuncharall(w, s, lam, bit), 1);
  }
}

GEN
lfunlarge(GEN CHI, GEN s, long bit)
{ return lfunlargeall(CHI, s, 0, bit); }

GEN
lfunlambdalarge(GEN CHI, GEN s, long bit)
{ return lfunlargeall(CHI, s, 1, bit); }

GEN
lfunloglambdalarge(GEN CHI, GEN s, long bit)
{ return lfunlargeall(CHI, s, -1, bit); }

/********************************************************************/
/*           LERCH RS IMPLEMENTATION FROM SANDEEP TYAGI             */
/********************************************************************/

static GEN
double_exp_residue_pos_h(GEN selsm, long k, long ind, long prec)
{
  long nk = itos(gel(selsm, 1)) + k;
  GEN r = gel(selsm, 2), ale = gel(selsm, 3), aor = gel(selsm, 4);
  GEN h = gel(selsm, 5), t = gen_0;
  switch(ind)
  {
    case 0: t = gaddsg(nk, aor); break;
    case 1: t = gneg(gaddsg(nk, aor)); break;
    case 2: t = gsubsg(nk, aor); break;
  }
  return gdiv(gasinh(gdiv(gsub(t, r), ale), prec), h);
}

static GEN
phi_hat_h(GEN selsm, long m, long ind, long prec)
{ return phi_hat(double_exp_residue_pos_h(selsm, m, ind, prec), prec); }

static long
myex(GEN is) { return gequal0(is) ? 0 : maxss(0, 2 + gexpo(is)); }
static GEN
gaminus(GEN s, long prec)
{
  GEN is = imag_i(s), tmp;
  long prec2;
  if (gcmpgs(is, -5*prec) < 0) return gen_0;
  prec2 = nbits2prec(prec + myex(is));
  tmp = gexp(gsub(glngamma(s, prec2), gmul(PiI2n(-1, prec2), s)), prec2);
  return gprec_w(tmp, prec);
}
static GEN
gaplus(GEN s, long prec)
{
  GEN is = imag_i(s), tmp;
  long prec2;
  if (gcmpgs(is, 5*prec) > 0) return gen_0;
  prec2 = nbits2prec(prec + myex(is));
  tmp = gexp(gadd(glngamma(s, prec2), gmul(PiI2n(-1, prec2), s)), prec2);
  return gprec_w(tmp, prec);
}

GEN
serh_worker(GEN k, GEN z, GEN a, GEN ns, GEN gprec)
{
  long prec = itou(gprec);
  return gmul(gpow(z, k, prec), gpow(gadd(a, k), ns, prec));
}

static void
set_arg(GEN worker, GEN z, GEN a, GEN ns, long prec)
{ gel(worker, 7) = mkvec4(z, a, ns, utoi(prec)); }


static GEN
series_h0l(GEN worker, long n0, GEN s, GEN a, GEN lam, long prec)
{
  GEN z = typ(lam) == t_INT ? gen_1 : gexp(gmul(PiI2(prec), lam), prec);
  set_arg(worker, z, a, gneg(s), prec);
  return parsum(gen_0, utoi(n0), worker);
}

static GEN
series_h1(GEN worker, long n1, GEN s, GEN a, GEN lam, long prec)
{
  GEN mP, pre_factor, z, sn = gsubgs(s, 1);
  GEN ini = gequal0(lam) ? gen_1 : gen_0;
  pre_factor = gaplus(gneg(sn), prec);
  if (gequal0(pre_factor)) return gen_0;
  mP = gneg(PiI2(prec));
  pre_factor = gmul(gmul(pre_factor, gexp(gmul(mP, gmul(a, lam)), prec)),
                    gpow(Pi2n(1, prec), sn, prec));
  z = typ(a) == t_INT ? gen_1 : gexp(gmul(mP, a), prec);
  set_arg(worker, z, lam, sn, prec);
  return gmul(pre_factor,  parsum(ini, stoi(n1 - 1), worker));
}

static GEN
series_h2(GEN worker, long n2, GEN s, GEN a, GEN lam, long prec)
{
  GEN P, pre_factor, z, sn = gsubgs(s, 1);
  pre_factor = gaminus(gneg(sn), prec);
  if (gequal0(pre_factor)) return gen_0;
  P = PiI2(prec);
  pre_factor = gmul(gmul(pre_factor, gexp(gmul(gneg(P), gmul(a, lam)), prec)),
                    gpow(Pi2n(1, prec), sn, prec));
  z = typ(a) == t_INT ? gen_1 : gexp(gmul(P, a), prec);
  set_arg(worker, z, gneg(lam), sn, prec);
  return gmul(pre_factor, parsum(gen_1, stoi(n2), worker));
}

static GEN
series_residues_h0l(long numpoles, GEN selsm0, GEN s, GEN a, GEN lam, long prec)
{
  GEN P, val = gen_0, ra = real_i(a);
  long n0 = m_n0(selsm0), k;
  P = PiI2(prec);
  for (k = -numpoles + 1; k <= numpoles; k++)
    if (gsigne(gaddsg(n0 + k, ra)) > 0)
      val = gadd(val, gmul(gmul(phi_hat_h(selsm0, k, 0, prec),
                                gexp(gmul(P, gmulgs(lam, n0 + k)), prec)),
                           gpow(gaddsg(n0 + k, a), gneg(s), prec)));
  return val;
}

static GEN
series_residues_h1(long numpoles, GEN selsm1, GEN s, GEN a, GEN lam, long prec)
{
  GEN mP, val = gen_0, rlam = real_i(lam), pre_factor, sn = gsubgs(s, 1);
  long n1 = m_n0(selsm1), k;
  pre_factor = gaplus(gneg(sn), prec);
  if (gequal0(pre_factor)) return gen_0;
  mP = gneg(PiI2(prec));
  pre_factor = gmul(gmul(pre_factor, gexp(gmul(mP, gmul(a, lam)), prec)),
                    gpow(Pi2n(1, prec), sn, prec));
  for (k = -numpoles; k <= numpoles - 1; k++)
    if (gsigne(gaddsg(n1 + k, rlam)) > 0)
      val = gadd(val, gmul(gmul(phi_hat_h(selsm1, k, 1, prec),
                                gexp(gmul(mP, gmulgs(a, n1 + k)), prec)),
                           gpow(gaddsg(n1 + k, lam), sn, prec)));
  return gmul(pre_factor, val);
}

static GEN
series_residues_h2(long numpoles, GEN selsm2, GEN s, GEN a, GEN lam, long prec)
{
  GEN P, val = gen_0, rlam = real_i(lam), pre_factor, sn = gsubgs(s, 1);
  long n2 = m_n0(selsm2), k;
  pre_factor = gaminus(gneg(sn), prec);
  if (gequal0(pre_factor)) return gen_0;
  P = PiI2(prec);
  pre_factor = gmul(gmul(pre_factor, gexp(gmul(gneg(P), gmul(a, lam)), prec)),
                    gpow(Pi2n(1, prec), sn, prec));
  for (k = -numpoles + 1; k <= numpoles; k++)
    if (gsigne(gsubsg(n2 + k, rlam)) > 0)
      val = gsub(val, gmul(gmul(phi_hat_h(selsm2, k, 2, prec),
                                gexp(gmul(P, gmulgs(a, n2 + k)), prec)),
                           gpow(gsubsg(n2 + k, lam), sn, prec)));
  return gmul(pre_factor, val);
}

static GEN
integrand_h0l(GEN selsm0, GEN s, GEN alam1, GEN x, long prec)
{
  GEN r0 = gel(selsm0, 2), ale = gel(selsm0, 3), a = gel(selsm0, 4);
  GEN ix = ginv(x), zn = gadd(r0, gmul2n(gmul(ale, gsub(x, ix)), -1));
  GEN P = PiI2n(0, prec), den, num;
  den = gexpm1(gmul(P, gmul2n(gsub(zn,a), 1)), prec);
  num = gexp(gmul(gmul(P, zn), gsub(alam1, zn)), prec);
  num = gmul(gmul(gmul(num, ale), gmul2n(gadd(x, ix), -1)),
             gpow(zn, gneg(s), prec));
  return gdiv(num, den);
}

static GEN
integrand_h12(GEN selsm1, GEN s, GEN alam1, GEN x, long prec)
{
  GEN r1 = gel(selsm1, 2), ale = gel(selsm1, 3), lam = gel(selsm1, 4);
  GEN ix = ginv(x), zn = gadd(r1, gmul2n(gmul(ale, gsub(x, ix)), -1));
  GEN P = PiI2n(0, prec), den, num, y;
  den = gexpm1(gmul(P, gmul2n(gadd(zn,lam), 1)), prec);
  num = gexp(gmul(gmul(P, zn), gadd(alam1, zn)), prec);
  num = gmul(gmul(gmul(num, ale), gmul2n(gadd(x, ix), -1)),
             gpow(zn, gsubgs(s, 1), prec));
  y = gdiv(num, den);
  if (gcmp(garg(zn, prec), Pi2n(-2, prec)) > 0)
    y = gmul(y, gexp(gmul(PiI2(prec), gsubsg(1, s)), prec));
  return y;
}

static GEN
integral_h0l(GEN lin_grid, GEN selsm0, GEN s, GEN a, GEN lam, long prec)
{
  GEN A = gaddgs(gmul2n(gadd(a, lam),1), 1), S = gen_0;
  pari_sp av = avma;
  long j, l = lg(lin_grid);

  for (j = 1; j < l; j++)
  {
    S = gadd(S, integrand_h0l(selsm0, s, A, gel(lin_grid, j), prec));
    if ((j & 0xff) == 0) S = gc_upto(av, S);
  }
  S = gmul(m_h(selsm0), S);
  A = gmul(a, gaddsg(1, gadd(a, gmul2n(lam, 1))));
  return gmul(S, gexp(gneg(gmul(PiI2n(0, prec), A)), prec));
}

/* do not forget a minus sign for index 2 */
static GEN
integral_h12(GEN lin_grid, GEN selsm1, GEN s, GEN a, GEN lam, long prec)
{
  GEN A, E, S = gen_0, ga = gaminus(gsubsg(1, s), prec);
  pari_sp av = avma;
  long j, l = lg(lin_grid);

  if (gequal0(ga)) return S;
  A = gaddgs(gmul2n(gadd(a,lam), 1), 1);
  for (j = 1; j < l; j++)
  {
    S = gadd(S, integrand_h12(selsm1, s, A, gel(lin_grid, j), prec));
    if ((j & 0xff) == 0) S = gc_upto(av, S);
  }
  if (gequal0(S)) return gen_0;
  S = gmul(m_h(selsm1), S);
  E = gexp(gmul(PiI2n(0, prec), gmul(lam, gaddgs(lam, 1))), prec);
  return gmul(gmul(gmul(S, ga), E), gpow(Pi2n(1, prec), gsubgs(s, 1), prec));
}

struct _fun_q0_t { GEN sel, s, alam1, B; };
static GEN
_fun_q0(void *E, GEN x)
{
  struct _fun_q0_t *S = (struct _fun_q0_t*)E;
  GEN z = integrand_h0l(S->sel, S->s, S->alam1, x, DEFAULTPREC);
  return addrlogabs(S->B, z);
}
static GEN
_fun_q12(void *E, GEN x)
{
  struct _fun_q0_t *S = (struct _fun_q0_t*)E;
  GEN z = integrand_h12(S->sel, S->s, S->alam1, x, DEFAULTPREC);
  return addrlogabs(S->B, z);
}

static GEN
RZLERinit(GEN s, GEN a, GEN lam, GEN al, GEN numpoles, long prec)
{
  GEN eps, r0, r1, r2, h, lin_grid, q, q0, q1, q2, sel0, sel1, sel2, lq;
  GEN pinv = ginv(PiI2(prec)), c = gmul2n(gadd(a, lam), -1), n0, n1, n2, c2;
  long m;
  struct _fun_q0_t E;

  if (!al || gequal0(al))
    al = gcmpgs(gabs(imag_i(s), prec), 100) < 0 ? ginv(stoi(4)) : gen_1;
  c2 = gsub(gsqr(c), gmul(s, pinv));
  r0 = gadd(c, gsqrt(c2, prec));
  r1 = gsqrt(gadd(c2, pinv), prec);
  r2 = gsub(r1, c);
  r1 = gneg(gadd(r1, c));
  n0 = gfloor(gsub(gadd(real_i(r0), imag_i(r0)), a));
  n1 = gneg(gfloor(gadd(gsub(real_i(r1), imag_i(r1)), real_i(lam))));
  n2 = gfloor(gadd(gsub(real_i(r2), imag_i(r2)), real_i(lam)));

  E.s = s; E.alam1 = gaddgs(gmul2n(gadd(a, lam), 1), 1);
  E.B = mulur(prec, mplog2(prec));
  lq = gmul(al, sqrtr_abs(mulrr(divsr(prec, Pi2n(1, DEFAULTPREC)),
                                mplog2(DEFAULTPREC))));
  eps = gexp(PiI2n(-2, prec), prec);
  E.sel = sel0 = mkvec5(n0, r0, gdiv(al, eps), a, gen_0);
  q0 = findq(&E, &_fun_q0, lq, prec);

  if (!gequal1(al)) lq = gdiv(lq, gsqr(al));
  E.sel = sel1 = mkvec5(n1, r1, gmul(al, eps), lam, gen_0);
  q1 = findq(&E, &_fun_q12, lq, prec);
  E.sel = sel2 = mkvec5(n2, r2, gmul(al, eps), lam, gen_0);
  q2 = findq(&E, &_fun_q12, lq, prec);
  q = vecmax(mkvec3(q0, q1, q2)); m = get_m(q, prec);
  gel(sel0, 5) = gel(sel1, 5) = gel(sel2, 5) = h = divru(q, (m-1) >> 1);
  lin_grid = setlin_grid_exp(h, m, prec);
  if (!numpoles) numpoles = gen_1;
  return mkvec5(sel0, sel1, sel2, lin_grid, numpoles);
}

static GEN add3(GEN x, GEN y, GEN z) { return gadd(x, gadd(y,z)); }
static GEN addsub(GEN x, GEN y, GEN z) { return gadd(x, gsub(y,z)); }

static GEN
lerch_ours(GEN sel, GEN s, GEN a, GEN lam, long prec)
{
  GEN selsm0 = gel(sel, 1), selsm1 = gel(sel, 2), selsm2 = gel(sel, 3);
  GEN lin_grid = gel(sel, 4), v0, v1, v2;
  long numpoles = itos(gel(sel, 5));
  GEN worker = snm_closure(is_entry("_serh_worker"),
                           mkvec4(NULL, NULL, NULL, NULL));
  v0 = add3(series_h0l(worker, m_n0(selsm0), s, a, lam, prec),
            series_residues_h0l(numpoles, selsm0, s, a, lam, prec),
            integral_h0l(lin_grid, selsm0, s, a, lam, prec));
  v1 = add3(series_h1(worker, m_n0(selsm1), s, a, lam, prec),
            series_residues_h1(numpoles, selsm1, s, a, lam, prec),
            integral_h12(lin_grid, selsm1, s, a, lam, prec));
  v2 = addsub(series_h2(worker, m_n0(selsm2), s, a, lam, prec),
            series_residues_h2(numpoles, selsm2, s, a, lam, prec),
            integral_h12(lin_grid, selsm2, s, a, lam, prec));
  return add3(v0, v1, v2);
}

static GEN
RZlerch_easy(GEN s, GEN a, GEN lam, long prec)
{
  pari_sp av = avma;
  GEN z, y, N;
  N = gdiv(gmulsg(prec + 5, mplog2(LOWDEFAULTPREC)),
           gmul(Pi2n(1, LOWDEFAULTPREC), imag_i(lam)));
  if (gexpo(N) > 40) pari_err_IMPL("precision too large in lerchzeta");
  N = gceil(N); prec += EXTRAPREC64;
  z = typ(lam) == t_INT ? gen_1 : gexp(gmul(PiI2(prec), lam), prec);
  y = parsum(gen_0, N, snm_closure(is_entry("_serh_worker"),
                                   mkvec4(z, a, gneg(s), stoi(prec))));
  return gc_GEN(av, gprec_wtrunc(y, prec));
}

static GEN
mygfrac(GEN z)
{ return typ(z) == t_COMPLEX ? mkcomplex(gfrac(real_i(z)), imag_i(z))
                             : gfrac(z); }

static GEN
lerchlarge(GEN s, GEN a, GEN lam, GEN al, GEN numpoles, long prec)
{
  pari_sp av = avma;
  GEN val, sel, imlam = imag_i(lam);
  long prec2;
  switch(gsigne(imlam))
  {
    case -1: pari_err_IMPL("imag(lam) < 0");
    case  1: if (gexpo(imlam) >= -16) return RZlerch_easy(s, a, lam, prec);
  }
  if (gcmpgs(real_i(a), 1) < 0)
  {
    GEN P = gexp(gmul(PiI2(prec), lam), prec);
    GEN L = lerchlarge(s, gaddgs(a, 1), lam, al, numpoles, prec);
    return gc_upto(av, gadd(gpow(a, gneg(s), prec), gmul(P, L)));
  }
  if (gcmpgs(real_i(a), 2) >= 0)
  {
    GEN L, P = gexp(gneg(gmul(PiI2(prec), lam)), prec);
    a = gsubgs(a, 1); L = lerchlarge(s, a, lam, al, numpoles, prec);
    return gc_upto(av, gmul(P, gsub(L, gpow(a, gneg(s), prec))));
  }
  if (gsigne(imag_i(s)) > 0)
  {
    GEN L;
    lam = mygfrac(gneg(gconj(lam)));
    L = lerchlarge(gconj(s), a, lam, al, numpoles, prec);
    return gc_upto(av, gconj(L));
  }
  prec2 = prec + EXTRAPREC64;
  a = gprec_w(a, prec2);
  s = gprec_w(s, prec2);
  lam = gprec_w(lam, prec2);
  sel = RZLERinit(s, a, lam, al, numpoles, prec2);
  val = lerch_ours(sel, s, a, lam, prec2);
  return gc_GEN(av, gprec_wtrunc(val, prec));
}

GEN
zetahurwitzlarge(GEN s, GEN a, long prec)
{ return lerchlarge(s, a, gen_0, gen_1, gen_1, prec); }

GEN
lerchzetalarge(GEN s, GEN a, GEN lam, long prec)
{ return lerchlarge(s, a, lam, gen_1, gen_1, prec); }
