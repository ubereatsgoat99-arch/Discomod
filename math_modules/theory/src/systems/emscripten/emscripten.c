/* Copyright (C) 2016  The PARI group.

This file is part of the PARI/GP package.

PARI/GP is free software; you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY WHATSOEVER.

Check the License for details. You should have received a copy of it, along
with the package; see the file 'COPYING'. If not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA. */

#include <emscripten/emscripten.h>
#include "pari.h"
#include "../src/graph/rect.h"

void
pari_emscripten_wget(const char *s)
{
  const char *name = stack_sprintf("/gpjs/root/%s",s);
  emscripten_wget(name,s);
}

void
pari_emscripten_help(const char *s, long n)
{
  const char *url = "https://pari.math.u-bordeaux.fr/dochtml";
  char *t;
  (void) n;
#if ((PARI_VERSION_CODE>>PARI_VERSION_SHIFT)&1)
  t = pari_sprintf("%s/help-stable/%s\n",url,s);
#else
  t = pari_sprintf("%s/help/%s\n",url,s);
#endif
  EM_ASM(window.open(UTF8ToString($0)),t);
  pari_free(t);
}

static void
emscripten_draw(PARI_plot *T, GEN w, GEN x, GEN y)
{
  pari_sp av = avma;
  GEN svg = pari_base64(rect2svg(w,x,y,NULL));
  EM_ASM(rawPrint=true);(void)T;
  pari_printf("<img src=\"data:image/svg+xml;charset=utf-8;base64,%Ps\">\n", svg);
  EM_ASM(rawPrint=false);
  set_avma(av);
}

static long plot_width, plot_height;

static void
pari_emscripten_get_plot(PARI_plot *T)
{
  T->width   = plot_width;
  T->height  = plot_height;
  T->hunit   = 3;
  T->vunit   = 3;
  T->fwidth  = 9;
  T->fheight = 12;
  gp_get_ploth_default_sizes(T);
  T->dwidth  = 0;
  T->dheight = 0;
  T->draw = &emscripten_draw;
}

void
pari_emscripten_plot_init(long width, long height)
{
  plot_width  = width;
  plot_height = height;
  pari_set_plot_engine(pari_emscripten_get_plot);
}

void
pari_emscripten_init(long rsize, long vsize)
{
  gp_embedded_init(rsize, vsize);
  cb_pari_long_help = &pari_emscripten_help;
}
