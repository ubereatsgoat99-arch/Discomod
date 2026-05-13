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

/*********************************************************************/
/**                                                                 **/
/**                PERIODS OF HYPERELLIPTIC CURVES                  **/
/**               contributed by Pascal Molin (2019)                **/
/**                                                                 **/
/*********************************************************************/

/*********************************************************************/
/*                                                                   */
/*                 Symplectic pairing and basis                      */
/*                                                                   */
/*********************************************************************/

/* compute symplectic homology basis */

/* exchange rows i,j, in place */
static void
row_swap(GEN M, long i, long j)
{
  long k, l = lg(M);
  for (k = 1; k < l; k++) swap(gcoeff(M,i,k), gcoeff(M,j,k));
}

static void
swap_step(GEN P, GEN M, long i, long j)
{
  if (i == j) return;
  swap(gel(P,i), gel(P,j));
  swap(gel(M,i), gel(M,j));
  row_swap(M, i, j);
}

/* M <- U(i,j, [u,v; u1,v1])~ * M. In place */
static void
row_bezout(GEN M, long i, long j, GEN u, GEN v, GEN u1, GEN v1)
{
  long k, l = lg(M);
  for (k = 1; k < l; k++)
  {
    GEN a = gcoeff(M,i,k), b = gcoeff(M,j,k);
    gcoeff(M,i,k) = addii(mulii(u,a), mulii(v,b));
    gcoeff(M,j,k) = addii(mulii(u1,a),mulii(v1,b));
  }
}

/* M <- M * U(i,j, [u,v; u1,v1]). In place */
static void
col_bezout(GEN M, long i, long j, GEN u, GEN v, GEN u1, GEN v1)
{
  GEN Mi = gel(M,i), Mj = gel(M,j);
  gel(M,i) = ZC_lincomb(u,  v,  Mi, Mj);
  gel(M,j) = ZC_lincomb(u1, v1, Mi, Mj);
}

/* P <- P*U(i,j, [u,v;u1,v1]); where U[k,k] = 1 for k != i,j,
 *           U[i,i] = u, U[i,j] = v, U[j,i] = u1, U[j,j] = v1
 * M <- U~ * M * U */
static void
bezout_apply(GEN P, GEN M, long i, long j, GEN u, GEN v, GEN u1, GEN v1)
{
  col_bezout(P, i,j, u,v,u1,v1);
  row_bezout(M, i,j, u,v,u1,v1);
  col_bezout(M, i,j, u,v,u1,v1);
}
/* (i,j) <- (u i + v j, u1 i + v1 j)*/
static void
bezout_step(GEN P, GEN M, long i, long j, GEN a, GEN b)
{
  GEN u, v, d = bezout(a,b,&u,&v);
  if (!is_pm1(d)) { a = diviiexact(a, d); b = diviiexact(b, d); }
  bezout_apply(P,M, i,j, u,v,negi(b),a);
}
/* i <- i + q * j */
static void
transvect_step(GEN P, GEN M, long i, long j, GEN q)
{ bezout_apply(P,M, i,j, gen_1,q,gen_0,gen_1); }

/* index of non-zero element in m[i,]; return 0 if none exist else index
 * of smallest element in absolute value */
static long
row_pivot(GEN m, long i)
{
  long j, jx = 0, l = lg(m);
  GEN x = NULL;
  for (j = 1; j < l; j++)
  {
    GEN z = gcoeff(m,i,j);
    if (signe(z))
    {
      if (is_pm1(z)) return j; /* minimal */
      if (!x || abscmpii(x, z) > 0) { x = z; jx = j; }
    }
  }
  return jx;
}

/* M symplectic in M_2g(Z). Returns P such that P~*M*P = J_g(D), D a ZV */
static GEN
ZM_symplectic_reduction(GEN M, GEN *pD)
{
  long dim, n = lg(M)-1, g = n >> 1; /* n will decrease */
  GEN P = matid(n), D = zerovec(g);
  pari_sp av = avma;

  M = shallowcopy(M);
  /* main loop on symplectic 2-subspace */
  for (dim = 0; dim < g; dim++)
  {
    long j, i = 2 * dim + 1;
    int cleared = 0;
    /* lines 0..2d-1 already cleared */
    while ((j = row_pivot(M, i)) == 0)
    { /* no intersection: move M[,i] to end and decrease n */
      swap_step(P, M, i, n);
      if (--n == 2*dim) goto END;
    }
    if (j != i+1) { swap_step(P, M, j, i+1); j = i+1; }
    if (signe(gcoeff(M,i,j)) < 0) swap_step(P, M, i, j);
    /* now j = i+1 and M[i,j] > 0 */

    while (!cleared)
    { /* clear row i */
      long k;
      for (k = j + 1; k <= n; k++)
        if (signe(gcoeff(M,i,k)))
        {
          GEN r, q = dvmdii(gcoeff(M,i,k), gcoeff(M,i,j), &r);
          if (r == gen_0)
            transvect_step(P, M, k, j, negi(q));
          else
            bezout_step(P, M, j, k, gcoeff(M,i,j), gcoeff(M,i,k));
        }
      cleared = 1;
      /* clear row j */
      for (k = j + 1; k <= n; k++)
        if (signe(gcoeff(M,j,k)))
        {
          GEN r, q = dvmdii(gcoeff(M,j,k), gcoeff(M,i,j), &r);
          if (r == gen_0)
            transvect_step(P, M, k, i, q);
          else
          {
            bezout_step(P, M, i, k, gcoeff(M,j,i), gcoeff(M,j,k));
            cleared = 0; /* M[i,] now contains some ck.cl ! */
          }
        }
    }
    gel(D, dim + 1) = gcoeff(M,i,j);
  }
END:
  if (pD) *pD = D;
  return gc_all(av, pD ? 2: 1, &P, pD);
}

/* below is GP code from Pascal converted to C by Bill. */

static GEN
make_Aprim(GEN A, long ia, long ib)
{
  long i, j = 0, lA = lg(A);
  GEN a = gel(A, ia), b = gel(A, ib), p = gadd(b, a), m = gsub(b, a);
  GEN Aprim = cgetg(lA - 2, t_VEC);
  for (i = 1; i < lA; ++i)
    if (i != ia && i != ib)
      gel(Aprim, ++j) = gdiv(gsub(gmulsg(2, gel(A, i)), p), m);
  return Aprim;
}

static GEN
sqrt_affinereduction(GEN Aprim, GEN z, long prec)
{
  pari_sp av = avma;
  GEN p = gen_1;
  long i, l = lg(Aprim), s = 0;
  for (i = 1; i < l; ++i)
  {
    GEN a = gel(Aprim, i);
    if (signe(real_i(a)) > 0) { s++; a = gsub(a, z); } else a = gsub(z, a);
    p = gmul(p, gsqrt(a, prec));
  }
  return gc_upto(av, gmul(p, powIs(s)));
}

static long
intersection_abbd(GEN A, long ia, long ib, long id, long prec)
{
  pari_sp av = avma;
  long k = lg(A)-1;
  GEN a = gel(A, ia), b = gel(A, ib), d = gel(A, id);
  GEN fbd = gmul(gpowgs(gsqrt(gsub(d, b), prec), k),
                 sqrt_affinereduction(make_Aprim(A, ib, id), gen_m1, prec));
  GEN fab = gmul(gpowgs(gsqrt(gsub(b, a), prec), k),
                 sqrt_affinereduction(make_Aprim(A, ia, ib), gen_1, prec));
  return gc_long(av, signe(imag_i(gdiv(fbd, fab))));
}

static long
intersection_abcb(GEN A, long ia, long ib, long ic, long prec)
{
  pari_sp av = avma;
  long k = lg(A)-1;
  GEN a = gel(A, ia), b = gel(A, ib), c = gel(A, ic), fab, fcb;
  fcb = gmul(gpowgs(gsqrt(gsub(b, c), prec), k),
             sqrt_affinereduction(make_Aprim(A, ic, ib), gen_1, prec));
  fab = gmul(gpowgs(gsqrt(gsub(b, a), prec), k),
             sqrt_affinereduction(make_Aprim(A, ia, ib), gen_1, prec));
  return gc_long(av, signe(imag_i(gdiv(fab, fcb))));
}

static long
intersection_abad(GEN A, long ia, long ib, long id, long prec)
{
  pari_sp av = avma;
  long k = lg(A)-1;
  GEN a = gel(A, ia), b = gel(A, ib), d = gel(A, id), fab, fad;
  fad = gmul(gpowgs(gsqrt(gsub(d, a), prec), k),
             sqrt_affinereduction(make_Aprim(A, ia, id), gen_m1, prec));
  fab = gmul(gpowgs(gsqrt(gsub(b, a), prec), k),
             sqrt_affinereduction(make_Aprim(A, ia, ib), gen_m1, prec));
  return gc_long(av, signe(imag_i(gdiv(fab, fad))));
}

/* inner intersection I[ab].I[cd] */
/* assume different end points */
static long
intersection_inner(GEN A, long ia, long ib, long ic, long id, long prec)
{
  pari_sp av = avma;
  GEN a = gel(A, ia), b = gel(A, ib), c = gel(A, ic), d = gel(A, id);
  GEN xp, fp, xpab, pb, xpcd, fpab, fpcd;
  GEN bpa = gadd(b, a), bma = gsub(b, a), dpc, dmc;
  GEN cprim = gdiv(gsub(gmulsg(2, c), bpa), bma);
  GEN dprim = gdiv(gsub(gmulsg(2, d), bpa), bma);
  GEN imc = imag_i(cprim), imd = imag_i(dprim);
  long k;
  if (signe(imc)*signe(imd) == 1) return 0;
  /* on the same side */
  /* p the intersection */
  xp = imag_i(gmul(gconj(cprim), gsub(dprim, cprim)));
  fp = gsub(imd, imc);
  if (gcmp(gabs(xp, prec), gabs(fp, prec)) >= 0) return 0;
  /* discard if xp not in ]-1,1[ */
  xpab = gdiv(xp, fp); dpc = gadd(d, c); dmc = gsub(d, c);
  pb = gadd(gmul(gdivgs(bma, 2), xpab), gdivgs(bpa, 2));
  xpcd = gdiv(gsub(gmulsg(2, pb), dpc), dmc);
  /* should be in ]-1,1[ */
  k = lg(A)-1;
  fpab = gmul(gpowgs(gsqrt(bma, prec), k),
              sqrt_affinereduction(make_Aprim(A, ia, ib), xpab, prec));
  fpcd = gmul(gpowgs(gsqrt(dmc, prec), k),
              sqrt_affinereduction(make_Aprim(A, ic, id), xpcd, prec));
  return gc_long(av, 2*signe(fp)*signe(real_i(gdiv(fpab, fpcd))));
}

static long
intersection(GEN A, long ia, long ib, long ic, long id, long prec)
{
  if (ia == ib || ic == id) return 0; /* bad entry */
  if (ia == ic && ib == id) return 0; /* self intersection */
  if (ia == id && ib == ic) return 0; /* self intersection */
  if (ia == ic) return intersection_abad(A, ia, ib, id, prec);
  if (ib == ic) return intersection_abbd(A, ia, ib, id, prec);
  if (ia == id) return -intersection_abbd(A, ic, id, ib, prec);
  if (ib == id) return intersection_abcb(A, ia, ib, ic, prec);
  return intersection_inner(A, ia, ib, ic, id, prec);
}

static GEN
intersection_spanning(GEN A, GEN tree, long prec)
{
  long i, j, n = lg(tree)-1;
  GEN res = cgetg(n+1, t_MAT);
  for (i = 1; i <= n; ++i)
    gel(res, i) = cgetg(n+1, t_VECSMALL);
  for (i = 1; i <= n; ++i)
  {
    coeff(res, i, i) = 0;
    for (j = i+1; j <= n; ++j)
    {
      long s = intersection(A, mael(tree, i, 1), mael(tree, i, 2),
                               mael(tree, j, 1), mael(tree, j, 2), prec);
      coeff(res, i, j) = s;
      coeff(res, j, i) = -s;
    }
  }
  return zm_to_ZM(res);
}

static GEN
int_periods_affinereduction(GEN C, GEN edge, long prec)
{
  pari_sp av = avma;
  long g = itos(gel(C, 1)), i1 = edge[1], i2 = edge[2];
  GEN A = gel(C, 2), a = gel(A, i1), b = gel(A, i2);
  GEN h = gel(C, 4), int_points = gel(C, 5);
  GEN F, geom_factor, decprim, Aprim, res;
  long i, j, l = lg(int_points);

  if (gcmp(real_i(a), real_i(b)) > 0) pari_err_BUG("hyperellperiods");
  decprim = gdiv(gadd(b, a), gsub(b, a));
  Aprim = make_Aprim(A, i1, i2);
  res = gpowers0(decprim, g-1, ginv(sqrt_affinereduction(Aprim, gen_0, prec)));
  for (i = 1; i < l; i++)
  {
    GEN x  = gmael(int_points, i, 1), dx = gmael(int_points, i, 2);
    GEN tp = gdiv(dx, sqrt_affinereduction(Aprim, x, prec));
    GEN tm = gdiv(dx, sqrt_affinereduction(Aprim, gneg(x), prec));
    GEN Tp = gpowers0(gadd(decprim,x), g-1, tp);
    GEN Tm = gpowers0(gsub(decprim,x), g-1, tm);
    for (j = 1; j <= g; j++)
      gel(res,j) = gadd(gel(res,j), gadd(gel(Tp,j), gel(Tm,j)));
  }
  geom_factor = gdivgs(gsub(b, a), 2);
  F = gpowers0(geom_factor, g-1,
               gdiv(mulcxI(h), gpowgs(gsqrt(geom_factor, prec), lg(Aprim)-1)));
  for (j = 1; j <= g; j++) gel(res,j) = gmul(gel(res,j), gel(F,j));
  settyp(res, t_COL); return gc_GEN(av, res);
}

static GEN
periods_spanning(GEN C, long prec)
{
  GEN tree = gel(C, 3);
  long k, n = lg(tree)-1;
  GEN res = cgetg(n+1, t_MAT);
  for (k = 1; k <= n; k++)
    gel(res, k) = gmul2n(int_periods_affinereduction(C, gel(tree,k), prec), 1);
  return res;
}

/* tau, lambda are t_REAL */
static GEN
phi_bound(GEN tau, GEN lambda)
{
  GEN lam2 = sqrr(lambda), costau, sintau, Xtau, Ytau2;
  mpsincos(tau, &costau, &sintau);
  Ytau2 = mulrr(lam2, sintau);
  Xtau = divrr(mulrr(costau, sqrtr(subrr(Ytau2, mulrr(lam2, sqrr(sintau))))),
               sintau);
  return addrr(divur(2, mpcos(sqrtr(Ytau2))), invr(mpsinh(Xtau)));
}

/* tau and lambda are t_REAL */
static GEN
integration_parameters(GEN tau, long bit, GEN lambda, long *pnpoints)
{
  GEN h = divrr(mulrr(Pi2n(1, DEFAULTPREC), tau),
                mplog1p(mulrr(shiftr(phi_bound(tau, lambda), 1),
                        gexp(utoi(bit), DEFAULTPREC))));
  GEN t = mpasinh(divrr(addsr(bit, mulur(3,mplog2(DEFAULTPREC))), lambda));
  *pnpoints = itos(gceil(divrr(t, h))); return h;
}

static void
integration_points_thsh(GEN h, long npoints, GEN lambda, long prec, GEN *ph, GEN *pres)
{
  pari_sp av = avma;
  long k;
  GEN eh = gexp(h, prec), eh_inv = ginv(eh), ekh = gen_1, ekh_inv = gen_1;
  GEN res = cgetg(npoints+1, t_VEC);
  for (k = 1; k <= npoints; ++k)
  {
    GEN sh, ch2, esh, esh_inv, chsh2_i, shsh2, thsh;
    ekh = gmul(ekh, eh);
    ekh_inv = gmul(ekh_inv, eh_inv);
    sh = gdivgs(gsub(ekh, ekh_inv), 2);
    ch2 = gadd(ekh, ekh_inv);
    esh = gexp(gmul(lambda, sh), prec);
    esh_inv = ginv(esh);
    chsh2_i = ginv(gadd(esh, esh_inv));
    shsh2 = gsub(esh, esh_inv);
    thsh = gmul(shsh2, chsh2_i);
    gel(res, k) = mkvec2(thsh, gmul(ch2, chsh2_i));
  }
  *ph = gmul(h, lambda);
  *pres = res;
 (void) gc_all(av, 2, ph, pres);
}

static GEN
tau_edge(GEN A, long i, long j, GEN lambda)
{
  GEN tauij = utoipos(4), Aprim = make_Aprim(A, i, j);
  long prec = DEFAULTPREC, l = lg(Aprim), k;
  for (k = 1; k < l; ++k)
  {
    GEN xItau = gasinh(gdiv(gatanh(gel(Aprim,k), prec), lambda), prec);
    tauij = gmin_shallow(tauij, absr(imag_i(xItau)));
  }
  return tauij;
}

static void
max_spanning(GEN A, long nedge, GEN lambda, GEN *ptree, GEN *ptaumin)
{
  pari_sp av = avma;
  GEN real_A, tau_v, tau_c, per, taken, tree, taumin;
  long z, i, j, k, n = lg(A)-1, m = (n*(n-1))>>1;

  tau_v = cgetg(m+1, t_VEC);
  tau_c = cgetg(m+1, t_VEC);
  real_A = real_i(A);
  z = 1;
  for (i = 1; i <= n; ++i)
    for (j = i+1; j <= n; ++j)
    {
      gel(tau_v, z) = tau_edge(A, i, j, lambda);
      if (gcmp(gel(real_A, i), gel(real_A, j)) > 0)
        gel(tau_c, z) = mkvecsmall2(j, i);
      else
        gel(tau_c, z) = mkvecsmall2(i, j);
      z++;
    }
  per = indexsort(tau_v);
  tau_v = vecpermute(tau_v, per);
  tau_c = vecpermute(tau_c, per);
  taken = zero_Flv(n);
  tree = cgetg(nedge+1, t_VEC);
  taken[mael(tau_c, m, 1)] = 1;
  taumin = gel(tau_v, m);
  for (k = 1; k <= nedge; ++k)
  {
    z = m;
    while (taken[mael(tau_c, z, 1)]+taken[mael(tau_c, z, 2)] != 1) z--;
    gel(tree, k) = gel(tau_c, z);
    taumin = gmin_shallow(taumin, gel(tau_v, z));
    taken[mael(tau_c, z, 1)] = taken[mael(tau_c, z, 2)] = 1;
  }
  *ptree = tree;
  *ptaumin = taumin;
  (void)gc_all(av, 2, ptaumin, ptree);
}

static long
hyperellgenus(GEN H)
{ long d = degpol(H); return ((d+1)>>1)-1; }
static GEN
periodmat(GEN P, long prec)
{
  pari_sp av = avma;
  GEN A = roots(P, prec), hc, lambda, tree, tau, h, coh1x_homC, IntC, ABtoC;
  long npoints, g = hyperellgenus(P);

  lambda = Pi2n(-1, DEFAULTPREC);
  max_spanning(A, 2*g, lambda, &tree, &tau);
  h = integration_parameters(tau, prec, lambda, &npoints);
  h = rtor(h, prec);
  lambda = Pi2n(-1,prec);
  hc = mkvec5(stoi(g), A, tree, gen_0, gen_0);
  integration_points_thsh(h, npoints, lambda, prec, &gel(hc, 4), &gel(hc, 5));
  coh1x_homC = periods_spanning(hc, prec);
  IntC = intersection_spanning(A, tree, prec);
  ABtoC = ZM_symplectic_reduction(IntC, NULL);
  return gc_upto(av, gdiv(gmul(coh1x_homC, ABtoC),
                          gmul2n(gsqrt(leading_coeff(P), prec),-1)));
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

static GEN
RgC_round_0(GEN x, long prec)
{ pari_APPLY_type(t_COL, signe(gel(x,i))==0 || expo(gel(x,i))<prec ? gen_0: gel(x,i)) }

static GEN
RgM_round_0(GEN x, long prec)
{ pari_APPLY_same(RgC_round_0(gel(x,i), prec)) }

static GEN
genus2BSDperiod(GEN C, long prec)
{
  pari_sp av = avma;
  forsubset_t iter;
  GEN PQ, P, M, v, B = int2n(prec >> 1);
  long g;
  PQ = hyperellminimalmodel(C, NULL, NULL);
  P = gadd(gmulsg(4, gel(PQ, 1)), gsqr(gel(PQ, 2)));
  g = hyperellgenus(P);
  M = RgM_round_0(real_i(periodmat(P, prec)),-(prec>>1));
  forsubset_init(&iter, mkvec2s(2*g,g));
  while ((v = forsubset_next(&iter)))
  {
    GEN Om = vecpermute(M, v), Dm = det(Om);
    if (signe(Dm) && expo(Dm) > -(prec>>1))
    {
      GEN r, d, Omr = bestappr(gmul(ginv(Om), M), B);
      Omr = Q_remove_denom(Omr, &d);
      r = gmul(Dm, ZM_det_triangular(ZM_hnf(Omr)));
      if (d) r = gdiv(r, gsqr(d));
      return gc_upto(av, gabs(r, prec));
    }
  }
  pari_err_BUG("genus2BSDperiod");
  return NULL; /* LCOV_EXCL_LINE */
}

GEN
hyperellperiods(GEN C, long flag, long prec)
{
  pari_sp av = avma;
  GEN M, H;
  long g;
  if (flag==2) return genus2BSDperiod(C, prec);
  H = check_hyperell(C);
  if (!H) pari_err_TYPE("hyperellperiods", C);
  if (flag<0 || flag>1) pari_err_FLAG("hyperellperiods");
  g = hyperellgenus(H); if (g < 1) pari_err_DOMAIN("hyperellperiods","genus","=",gen_0,C);
  M = periodmat(H, prec);
  if (flag==0) M = gauss(vecslice(M,1,g), vecslice(M,g+1,2*g));
  return gc_upto(av, M);
}
