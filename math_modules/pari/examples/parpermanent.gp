/*
Copyright (C) 2024 The PARI group

PARI/GP is free software; you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY WHATSOEVER.

Check the License for details. You should have received a copy of it, along
with the package; see the file 'COPYING'. If not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
*/

/* Bill Allombert, 2024 */

/* Parallel algorithm for permanent of integral sparse matrices */

permas(M,t)=
{
  if(#M<=t,matpermanent(M),
    if(hammingweight(M[1,])<hammingweight(M[,1]),
      vecsum(vector(#M,i,if(M[1,i],M[1,i]*self()(M[^1,^i],t)))),
      vecsum(vector(#M,i,if(M[i,1],M[i,1]*self()(M[^i,^1],t))))));
}

parVperma(M,u,m=1)=
{
  if(u==0,[vecsort(vecsort(M)~),m],
    my(L=List());
    if(hammingweight(M[1,])<hammingweight(M[,1]),
      parfor(i=1,#M,if(M[1,i],parVperma(M[^1,^i],u-1,M[1,i]*m)),R,if(M[1,i],listput(~L,R))),
      parfor(i=1,#M,if(M[i,1],parVperma(M[^i,^1],u-1,M[i,1]*m)),R,if(M[i,1],listput(~L,R)))
    );
    if(u>1 && #L,concat(Col(L)),Col(L))
  );
}

export(permas, parVperma);

parmatpermanent(M,t=4,k=6)=
{
  my(permas=permas);
  my(V=Mat(parVperma(M,k)),N, No = #V~);
  if (!No, return(0));
  V = matreduce(V); N =#V~;
  V = parvector(N,i,V[i,2]*permas(V[i,1],t));
  parsum(i=1,#V,V[i]);
}

{
addhelp("parmatpermanent",
"parmatpermanent(M,t=4,k=6): permanent of the sparse integral matrix M."
"the tuning parameter should be set in function of shape of the matrix"
"k: level of first descent"
"t: dimension below that we should use matpermanent.");
}
