# GiNaC

**Symbolic Computation in C++**

License: [GPL-2.0-or-later](COPYING)

## About

GiNaC (which stands for "GiNaC is Not a CAS" (computer algebra system)) is a
C++ library for symbolic mathematical calculations.  It is designed to allow
the creation of integrated systems that embed symbolic manipulations together
with more established areas of computer science (like computation-intense
numeric applications, graphical interfaces, etc.) under one roof.

The official web site is <https://www.ginac.de/>.

There's a mailing list <ginac-list@ginac.de> for general discussion and
another one <ginac-devel@ginac.de> for developers. You need to be subscribed
to be able to post to the lists. To subscribe, please follow the instructions
on <https://lists.ginac.de/mailman3/lists/ginac-list.ginac.de/> and
<https://lists.ginac.de/mailman3/lists/ginac-devel.ginac.de/>.

See <https://www.ginac.de/Lists.html> for the list policy.

## Prerequisites

- A C++14 compiler
- The installed [CLN](https://www.ginac.de/CLN/) library

## Installation

On Linux:
```sh
# Clone this repo on Codeberg:
git clone https://codeberg.org/ginac/ginac.git
cd ginac
# Create missing standard auxiliary files of the GNU build system:
autoreconf -i
# Configure the software to your system:
./configure
# Build it:
make -j `nproc`
# Run the test suite (recommended):
make -j `nproc` check
# Install everything (library, headers, ginsh, viewgar, info) system-wide:
sudo make install
```

For more details, see the file [INSTALL](INSTALL.md).

## Reporting Bugs

If you have identified a bug in GiNaC, you are welcome to report a bug in our
issue tracker at <https://codeberg.org/ginac/ginac/issues>. Alternatively,
write to <ginac-list@ginac.de>.

Please include information about your operating system and version (as
reported by `uname -a`), your C++ compiler and version (reported by `g++
--version` or similar), and anything else you think is relevant.  Ideally,
append the file `config.log`. It captures all this information.

If it is a systematical bug in the library, a _short_ test program together
with the output you get and the output you expect will help us to reproduce it
quickly.

Patches are most welcome.  If possible please make them with `diff -c` and
include a ChangeLog entry.
