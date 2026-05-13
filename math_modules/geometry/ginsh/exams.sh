#!/bin/sh

# ginsh executable
: "${GINSH:?GINSH envvar not set}"
if [ ! -x "$GINSH" ]; then
    echo "error: $GINSH not found or not executable" >&2
    exit 1
fi

# Stats variables:
ok=0
fail=0

examginsh() {
    local input=$1   # ginsh command sequence to execute
    local result=$2  # expected output
    local output=$(printf '%s' "$input" | $GINSH)
    if [ "$output" != "$2" ]; then
        printf "FAIL: ginsh input '%s' printed '%s', expected '%s'.\n" \
               "$input" "$output" "$result"
        fail=$((fail + 1))
        return 1
    fi
    ok=$((ok + 1))
}

# Addition '+':
examginsh "17+4;" \
          "21"

# Subtraction '-':
examginsh "47-11;" \
          "36"

# Power '^' and division '/':
examginsh "x=3^123: y=3^124: x/y;" \
          "1/3"

# Factorial '!' and division '/':
examginsh "7!/7/6/5/4/3/2/1;" \
          "1"

# Factorial '!', division, '/', and multiplication '*':
examginsh "7!/(7*6*5*4*3*2);" \
          "1"

# Expansion 'expand()' and a posteriori assignment '=':
examginsh "a=expand((x+y)^23): x=-y: a;" \
          "0"

# Expansion 'expand()' and substitution 'subs()' (Denny Fliegner's test):
examginsh "a=expand((x+y+z)^5): expand(subs(a, x==-y-z));" \
          "0"

# Likewise, but with a posteriori assignment:
examginsh "a=expand((x+y+z)^5): x=-y-z: expand(a);" \
          "0"

# Assignment mixed with a posteriori assignment:
examginsh "a=x+z*x: b=a*y:
           c=b-a*y;" \
          "0"

# Likewise, with a free symbol remaining:
examginsh "a=x+y+z: b=x-y-z: c=a+b-x;" "x"

# Two a posteriori assignments:
examginsh "a=x+y+5: b=2*a-y: c=2*x+z:
           d=c-z: y=19:
           b-d+13;" \
          "42"

# Assignments and a posteriori unassignments 'unassign()':
examginsh "a=3*x^2+1: b=2*a: c=normal(b/a):
           unassign('b'): unassign('a'): c;" \
          "2"

# Ploynomial long division 'divide()':
examginsh "1+divide(x^3-6*x^2+11*x-6,x^2-5*x+6);" \
          "x"

# Polynomial greatest common divisor 'gcd()':
examginsh "a=2*x*y-t*x-2*t*y+x^2: b=x*y+x^2-2*y^2: y=-x/2: gcd(a, b);" \
          "0"

# Polynomial normalization 'normal()':
examginsh "normal((5*x*y+2*x^2+2*y^2)/((x+2*y)*(2*x+y)));" \
          "1"

# Square-free factorization 'sqrfree()':
examginsh "sqrfree((x-1)*(x+1)-x^2+1);" \
          "0"

# Inverse function cancellation:
examginsh "exp(log(x))-cos(acos(x));" \
          "0"

# Special point evaluation:
examginsh "-I*log(-1)/acos(-1);" \
          "1"

# Special function differentiation 'diff()' and normalization 'normal()':
examginsh "normal((1-x)*(1+x)*diff(acos(x), x)^2);" \
          "1"

# Integer 2x2 matrix determinant 'determinant()':
examginsh "determinant([[1,1],[1,3]]);" \
          "2"

# Symbolic 3x3 matrix determinant 'determinant()':
examginsh "determinant([[1,x,y],[x,1+x^2,x*y],[y+x^2,x+x*y+x^3,1+y^2+x^2*y]]);" \
          "1"

# Linear system solving 'lsolve()' and substiution 'subs()':
examginsh "subs(x-2*y, lsolve({2*x+y==5, x-y==1}, {x, y}));" \
          "0"

# Power series expansion 'series()' and elements counting 'nops()':
examginsh "nops(series(sin(x)^2+cos(x)^2, x==0, 23));" \
          "2"

if [ "$fail" -eq 0 ]; then
    printf "PASS: ginsh ($ok exams)\n"
    exit 0
else
    printf "FAIL: ginsh failed $fail out of $((fail + ok)) exams.\n"
    exit 1
fi
