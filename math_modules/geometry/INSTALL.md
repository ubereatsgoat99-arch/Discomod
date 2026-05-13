# Installation

## Prerequisites

GiNaC requires the CLN library version 1.2.2 or higher installed. Get it from
<https://www.ginac.de/CLN/>.

You will also need a decent C++ compiler (C++-17 or higher). We recommend a
recent C++ compiler from the GNU compiler collection or from the LLVM
project. If you have a different compiler, you are on your own. Note that you
may have to use the same compiler you compiled CLN with for compatibility.

You also need GNU `make` for invoking the compiler with the right options.

The `pkgconf` utility is required for detecting installed dependencies and
setting up compiler and linker flags.

## Optional Dependencies

Some other software packages are optional and it is possible to build the
GiNaC library without them installed. Which software packages are needed
depends on whether you are building from git or from a tarball. None of these
package should be too old – we do not track exact minimal version numbers.

| Dependency            | Required for                | from git / tarball   |
| --------------------- | --------------------------- | -------------------- |
| Texinfo               | building info pages         | from git + tarball   |
| Doxygen               | doc/reference/*             | from git + tarball   |
| LaTeX                 | doc/*.pdf                   | from git + tarball   |
| libreadline-dev       | ginsh command line editing  | from git + tarball   |
| Flex                  | building ginsh              | from git only        |
| Bison                 | building ginsh              | form git only        |
| Automake              | building libginac           | from git only        |
| Autoconf              | building libginac           | from git only        |
| Libtool               | building libginac           | from git only        |
| Python                | building libginac           | from git only        |

## Installation From Tarball

To install from an unpacked release source tarball:
```sh
# Configure the software to your system:
./configure
# Build it:
make -j `nproc`
# Run the test suite (recommended):
make -j `nproc` check
# Install everything (library, headers, ginsh, viewgar, info) system-wide:
sudo make install
```

To build the GiNaC tutorial and reference manual in HTML or PDF formats, use

```sh
make html
make pdf
```

The `configure` script accepts a number of options to enable and disable
various features. For a complete list, type:

```sh
./configure --help
```

A few of the more important ones:


- `--prefix=PREFIX`     install architecture-independent files in PREFIX
                        [defaults to `/usr/local`]
- `--exec-prefix=EPREFIX` install architecture-dependent files in EPREFIX
                        [defaults to the value given to `--prefix`]
- `--disable-shared`    suppress the creation of a shared library
- `--disable-static`    suppress the creation of a static library

More detailed installation instructions can be found in the documentation,
in the `doc/` directory.

## Installation From Repository Snapshot

To install from a repository snapshot or from a git clone:
```sh
# Create missing standard auxiliary files of the GNU build system:
autoreconf -i
```
Then proceed as when installing from unpacked release tarball (see above).
