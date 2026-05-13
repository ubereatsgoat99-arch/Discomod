#include <stdio.h>
#include <readline/readline.h>
#include <readline/history.h>
#include <setjmp.h>
#include <pari/pari.h>

jmp_buf env;

int gp_is_interactive(void) { return pari_infile == stdin; }
void gp_err_recover(long numerr) { longjmp(env, numerr); }
void gp_quit(long exitcode) { exit(exitcode); }

entree functions_gp[]={
  {"quit",0,(void*)gp_quit,11,"vD0,L,","quit({status = 0}): quit, return to the system with exit status 'status'."},
  {NULL,0,NULL,0,NULL,NULL}};

int main(int argc, char **argv)
{
  pari_init(8000000,500000);
  pari_add_module(functions_gp);
  cb_pari_err_recover = gp_err_recover;
  cb_pari_is_interactive = gp_is_interactive;
  cb_pari_quit = gp_quit;
  sd_colors("lightbg",d_INITRC);
  gp_load_gprc();
  pari_print_version();
  (void)setjmp(env);
  while(1)
  {
    const char *prompt = gp_format_prompt(GP_DATA->prompt);
    char *in = readline(prompt);
    if (!in) break;
    if (!*in) continue;

    add_history(in);
    gp_echo_and_log(prompt,in);
    gp_embedded(in);
    free(in); set_avma(pari_mainstack->top);
  }
  return 0;
}
