/** @file Gt.h
 *
 *  Interface to GiNaC's elliptic multiple polylogarithms. */

/*
 *  GiNaC Copyright (C) 1999-2026 Johannes Gutenberg University Mainz, Germany
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#ifndef GINAC_EMPL_H
#define GINAC_EMPL_H

#include "archive.h"
#include "basic.h"
#include "ex.h"

namespace GiNaC {

#if !defined(GINAC_LST_H) && !defined(GINAC_REGISTRAR_H)
class lst;
#endif
class numeric;
class matrix;
class G2_SERIAL;
namespace Gt_detail {
	template<typename Type>
	class TransformExpressionWithCache;
};

/** Elliptic Multiple Polylogarithm. */
class Gt : public basic
{
	GINAC_DECLARE_REGISTERED_CLASS(Gt, basic)

public:
	struct kernel
	{
		kernel();
		kernel(size_t ni, ex zi, int deform = 0);
		kernel(lst arg);

		size_t ni;  // weight
		ex zi;      // argument (may be symbolic)
		int deform; // if the argument becomes a pole and the integration contour passes over
		            // it, deform the integration contour towards (zi*exp(i*epsilon*deform))

	private:
		void check();
		friend class Gt;
	};

	// other constructors
public:
	Gt(const ex& args, const ex& z, const ex& tau);
private:
	Gt(std::vector<kernel> args, ex z, ex tau);
	void setArgs(const ex& args);

	// functions overriding virtual functions from base classes
public:
	const ex& getTau() const { return tau; }
	const ex& getZ() const { return z; }
	const std::vector<kernel>& getArgs() const { return args; }
	unsigned precedence() const override {return 45;}
	ex eval() const override;
	ex evalf() const override;

	// We do not support other functions modifying our members, so we set nops=0
	// This breaks certain features though, so we need to re-implement them manually
	size_t nops() const override { return 0; }
	ex subs(const exmap & m, unsigned options = 0) const override;
	unsigned calchash() const override;
	bool has(const ex & other, unsigned options = 0) const override;
	bool match(const ex & pattern, exmap& repl_lst) const override;

	/** Save (a.k.a. serialize) object into archive. */
	void archive(archive_node& n) const override;
	/** Read (a.k.a. deserialize) object from archive. */
	void read_archive(const archive_node& n, lst& syms) override;

	// Functions that operate on a single Gt
	ex zisToFundamental(const ex* points = nullptr) const;
	ex regularise(const ex* points = nullptr) const;
	matrix findMoebiusTransform(const ex* points = nullptr) const;
	ex tauToFundamental(const ex* points = nullptr) const;
	std::vector<ex> decomposeIntegrationPath(const ex* points = nullptr) const;
	ex applyIntegrationPath(const std::vector<ex>& endpoints) const;
	numeric qExpand(const ex* points = nullptr) const;
	numeric evaluate(const ex* points = nullptr) const;

	// Functions that operate on expressions containing Gts
	static ex ex_zisToFundamental(const ex& expr, const ex* points = nullptr);
	static ex ex_regularise(const ex& expr, const ex* points = nullptr);
	static ex ex_tauToFundamental(const ex& expr, const ex* points = nullptr);
	static ex ex_cutIntegrationPath(const ex& expr, const ex* points = nullptr);
	static numeric ex_qExpand(const ex& expr, const ex* points = nullptr);
	static ex ex_prepare(const ex& expr, const ex* points = nullptr);
	static numeric ex_evaluate(const ex& expr, const ex* points = nullptr);
	static lst lst_evaluate(const lst& list, const ex* points = nullptr);
	// Pass replacements by reference, rather than by pointer
	static ex ex_zisToFundamental(const ex& expr, const ex& points);
	static ex ex_regularise(const ex& expr, const ex& points);
	static ex ex_tauToFundamental(const ex& expr, const ex& points);
	static ex ex_cutIntegrationPath(const ex& expr, const ex& points);
	static numeric ex_qExpand(const ex& expr, const ex& points);
	static ex ex_prepare(const ex& expr, const ex& points);
	static numeric ex_evaluate(const ex& expr, const ex& points);
	static lst lst_evaluate(const lst& list, const ex& points);

	// Apply a transformation recursively to every Gt in an expression; use caching for repeated appearances
	static ex apply_function_recursive(const ex& input, const std::function<ex(const Gt&)>& func);

	// Clear global cache of numerical values of regular MPLs
	static void clear_polylog_cache();

protected:
	void do_print(const print_context & c, unsigned level) const;
	void do_print_latex(const print_latex & c, unsigned level) const;

private:
	static numeric to_numeric(const ex& expr, const ex* points = nullptr);
	static long to_integer(const ex& expr, const bool allow_negative);

public:
	// Parameter in (0,0.5) that defines how close the integration path is allowed to get to
	// the boundary of the fundamental domain before being cut.
	// Smaller values result in more Gt terms, but each q-expansion will converge faster.
	// For Gts with many kernels, smaller values might be preferable, as the q-expansion
	// takes up a larger chunk of the runtime for such Gts.
	static double cutIntegrationPath_threshold_real;
	static double cutIntegrationPath_threshold_imag;

	// Minimum order to which q-expansion should be performed. This should never make a difference,
	// as the starting order is estimated based on the properties of the kernels.
	static size_t qExpand_minOrder;

	// Sometimes, a specific individual order of the q-expansion has very little numerical effect.
	// If we just check for the numerical change after each order, we might assume convergence and
	// terminate the expansion prematurely.
	// By expanding multiple orders at each step (i.e. qExpand_stepSize >= 2), we avoid this issue.
	// This also decreases bookkeeping work, in case the initial expansion order was too low.
	static size_t qExpand_stepSize;

	// Clear polylog cache after each call to ex_evaluate
	static bool auto_clear_polylog_cache;

	// Toggle whether to shift tau to its fundamental domain. In certain cases it can be faster to
	// omit this step.
	static bool enable_tauToFundamental;

private:
	size_t nargs;               // number of arguments
	std::vector<kernel> args;   // arguments (ni as integer, zi symbolic)
	ex z, tau;                  // z and tau (symbolic)

	// Global cache for numeric evaluation of MPLs in qExpand
	static Gt_detail::TransformExpressionWithCache<G2_SERIAL> nqexand_transformer;
};
GINAC_DECLARE_UNARCHIVER(Gt);

} // namespace GiNaC

#endif // ndef GINAC_EMPL_H
