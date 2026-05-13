/** @file Gt.cpp
 *
 *  Implementation of GiNaC's elliptic multiple polylogarithms. */

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

#include <type_traits>
#include <sstream>
#include <limits>
#include <cln/cln.h>
#include "add.h"
#include "mul.h"
#include "power.h"
#include "lst.h"
#include "matrix.h"
#include "symbol.h"
#include "numeric.h"
#include "inifcns.h"
#include "operators.h"
#include "relational.h"
#include "utils_multi_iterator.h"
#include "hash_seed.h"
#include "constant.h"
#include "Gt.h"
#include "Gt_helpers.h"

#define DEBUG_GT 0
// 0: no debugging output
// 1: print each call to a transformation function (zisToFundamental, regularise, ...)
// 2: also output entire expression, just before q-expansion
// 3: also output entire expression after each group of transformation function
// 4: output entire expression after each individual transformation function
// 5: print intermediate results of transformation functions

namespace GiNaC {


GINAC_IMPLEMENT_REGISTERED_CLASS_OPT(Gt, basic,
  print_func<print_dflt>(&Gt::do_print).
  print_func<print_python>(&Gt::do_print).
  print_func<print_latex>(&Gt::do_print_latex))


Gt::kernel::kernel() : kernel(-1,0,0) {}

Gt::kernel::kernel(size_t ni, ex zi, int deform)
	: ni(ni), zi(zi), deform(deform)
{
	check();
}

Gt::kernel::kernel(lst arg)
{
	if (arg.nops() != 2 && arg.nops() != 3)
		throw std::invalid_argument("Gt: first argument must be a list of tuples");
	ni = to_integer(arg.op(0), false);
	zi = arg.op(1);
	deform = (arg.nops() == 3) ? to_integer(arg.op(2), true) : 0;

	check();
}

void Gt::kernel::check()
{
	if (ni == 0) {
		zi = 0;
		deform = 0;
	}
	else {
		if (zi.evalf().is_zero())
			zi = 0;
		if (std::abs(deform) > 1)
			deform /= std::abs(deform);
	}
}


//////////
// default constructor
//////////

Gt::Gt() :
	z(dynallocate<numeric>()),
	tau(dynallocate<numeric>())
{}

//////////
// other constructors
//////////

// public
Gt::Gt(const ex& args_, const ex& z_, const ex& tau_) : z(z_), tau(tau_)
{
	setArgs(args_);

	if (is_a<numeric>(tau.evalf()) && !ex_to<numeric>(tau.evalf()).imag().is_positive())
		throw std::runtime_error("Gt: Im(tau) needs to be greater than 0 b");
	if (nargs >= 64)
		throw std::runtime_error("Gt: Too many kernels");
}

Gt::Gt(std::vector<kernel> args_, ex z_, ex tau_)
	: nargs(args_.size()), args(args_), z(z_), tau(tau_)
{

	if (args.empty())
		throw std::invalid_argument("Gt: first argument must be a non-empty list");
	for (kernel& k : args)
		k.check();
	if (is_a<numeric>(tau.evalf()) && !ex_to<numeric>(tau.evalf()).imag().is_positive())
		throw std::runtime_error("Gt: Im(tau) needs to be greater than 0 a");

	if (nargs >= 64)
		throw std::runtime_error("Gt: Too many kernels");
}

void Gt::setArgs(const ex& new_args)
{
	if (!is_a<lst>(new_args))
		throw std::invalid_argument("Gt: first argument must be a list");

	nargs = new_args.nops();
	if (nargs == 0)
		throw std::invalid_argument("Gt: first argument must be a non-empty list");

	args.clear();
	args.reserve(nargs);
	for (size_t i = 0; i < nargs; i++) {
		if (is_a<lst>(new_args.op(i)))
			args.emplace_back(ex_to<lst>(new_args.op(i)));
		else
			throw std::invalid_argument("Gt: first argument must be a list of tuples");
	}
}

//////////
// archiving
//////////

void Gt::read_archive(const archive_node& n, lst& sym_lst)
{
	inherited::read_archive(n, sym_lst);
	ex args;
	n.find_ex("args", args, sym_lst);
	n.find_ex("z", z, sym_lst);
	n.find_ex("tau", tau, sym_lst);
	setArgs(args);
}

void Gt::archive(archive_node & n) const
{
	inherited::archive(n);
	lst lst_args;
	for (size_t i = 0; i < nargs; i++)
		lst_args.append(lst{args[i].ni, args[i].zi, args[i].deform});
	n.add_ex("args", lst_args);
	n.add_ex("z", z);
	n.add_ex("tau", tau);
}

//////////
// functions overriding virtual functions from base classes
//////////

void Gt::do_print(const print_context & c, unsigned level) const
{
	c.s << "Gt({";
	for (size_t i = 0; i < nargs; i++) {
		c.s << (i?",":"") << "{" << args[i].ni << "," << args[i].zi;
		if (args[i].deform)
			c.s << "," << args[i].deform;
		c.s << "}";
	}
	c.s << "}," << z << "," << tau << ")";
}

void Gt::do_print_latex(const print_latex & c, unsigned level) const
{
	c.s << "Gt({";
	for (size_t i = 0; i < nargs; i++)
		c.s << "\\begin{matrix}" << args[i].ni << "\\\\" << args[i].zi << "\\end{matrix}";
	c.s << ";" << z << "," << tau << "\\right)";
}

int Gt::compare_same_type(const basic& other) const
{
	GINAC_ASSERT(is_exactly_a<Gt>(other));

	// Compare (in this order): nargs, kernels (ni, zi, deform), z, tau
	const Gt& o = static_cast<const Gt&>(other);
	if (nargs > o.nargs) return +1;
	if (nargs < o.nargs) return -1;
	for (size_t i = 0; i < nargs; i++) {
		if (args[i].ni > o.args[i].ni) return +1;
		if (args[i].ni < o.args[i].ni) return -1;
		const int cmp = args[i].zi.compare(o.args[i].zi);
		if (cmp > 0) return +1;
		if (cmp < 0) return -1;
		if (args[i].deform > o.args[i].deform) return +1;
		if (args[i].deform < o.args[i].deform) return -1;
	}
	const int cmp = z.compare(o.z);
	if (cmp > 0) return +1;
	if (cmp < 0) return -1;
	return tau.compare(o.tau);
}

ex Gt::eval() const
{
	if (flags & status_flags::evaluated)
		return *this;

	// Check if all kernels are {0,0}
	for (size_t i = 0; i < nargs; i++)
		if (args[i].ni != 0)
			break;
		else if (i == nargs-1)
			return pow(z,nargs) / factorial(nargs);

	// Check if all kernels are equal
	if (nargs > 1) {
		bool all_kernels_equal = true;
		for (size_t i = 1; i < nargs && all_kernels_equal; i++)
			all_kernels_equal &= args[i].ni == args[0].ni && args[i].zi == args[0].zi;
		if (all_kernels_equal)
			return pow(Gt(std::vector<kernel>(1,args[0]),z,tau),nargs) / factorial(nargs);
	}

	return this->hold();
}

ex Gt::evalf() const
{
	// If all arguments are numeric, evaluate Gt
	bool all_numeric = is_a<numeric>(z) && is_a<numeric>(tau);
	for (const kernel& k : args)
		all_numeric &= is_a<numeric>(k.zi);
	if (all_numeric)
		return evaluate();

	// Otherwise, evaluate arguments, as much as possible
	bool already_evaluated = true;
	std::vector<kernel> new_args;
	new_args.reserve(nargs);
	for (const kernel& k : args) {
		new_args.emplace_back(k.ni, k.zi.evalf(), k.deform);
		already_evaluated &= are_ex_trivially_equal(k.zi, new_args.back().zi);
	}
	const ex nz = z.evalf();
	const ex ntau = tau.evalf();
	already_evaluated &= are_ex_trivially_equal(z, nz);
	already_evaluated &= are_ex_trivially_equal(tau, ntau);

	if (already_evaluated)
		return *this;
	return dynallocate<Gt>(new_args, nz, ntau);
}

ex Gt::subs(const exmap & m, unsigned options) const
{
	std::vector<kernel> args_subs;
	args_subs.reserve(nargs);
	for (const kernel& k : args)
		args_subs.emplace_back(k.ni, k.zi.subs(m, options), k.deform);
	return Gt(args_subs, z.subs(m, options), tau.subs(m, options));
}


unsigned Gt::calchash() const
{
	// adapted from basic::calchash()
	unsigned v = make_hash_seed(typeid(*this));
	for (const kernel& k : args) {
		v = rotate_left(v) ^ numeric{k.ni}.gethash();
		v = rotate_left(v) ^ k.zi.gethash();
		v = rotate_left(v) ^ numeric{k.deform}.gethash();
	}
	v = rotate_left(v) ^ z.gethash();
	v = rotate_left(v) ^ tau.gethash();

	if (flags & status_flags::evaluated) {
		setflag(status_flags::hash_calculated);
		hashvalue = v;
	}

	return v;
}

bool Gt::has(const ex & other, unsigned options) const
{
	for (const kernel& k : args)
		if (k.zi.has(other, options))
			return true;
	return tau.has(other, options) || z.has(other, options);
}

bool Gt::match(const ex & pattern, exmap& repl_lst) const
{
	if (typeid(*this) != typeid(ex_to<basic>(pattern)))
		return false;
	throw std::logic_error("Gt::match not implemented\n");
}


// Shift the zi by 1 and/or tau, such that they lay in the fundamental domain
ex Gt::zisToFundamental(const ex* points) const
{
	if (DEBUG_GT) std::cout << "zisToFundamental " << *this << std::endl;

	// When its z argument gets shifted by tau, each integration kernel turns into a linear combination of kernels
	//   g^(n)(z + a*tau, tau) = sum_{k=0}^n (-2pi i a)^k g^(n-k)(z,tau);  a ∈ Z

	// First, we loop over all the integrations and build a list of the terms in this sum
	// Then we construct Gt corresponding to all possible combinations of terms from these lists

	// Step 1:
	// For each integration, we need to
	//  a) Shift zi, to the fundemantal domain
	//  b) Depending on this shift express the kernel as a linear combination of shifted kernels

	std::vector<ex> zis_shifted;
	zis_shifted.reserve(nargs);
	const numeric ntau = to_numeric(tau, points);

	// Shifted kernels
	// This is a vector (for each integration) of vectors (for each term) of shifted kernels
	// A shifted kernel is represented by its prefactor and ni
	// We do not need zi, as it is identical for all shifted kernels of a given integration
	std::vector<std::vector<std::pair<ex, size_t>>> shifted_kernels;
	shifted_kernels.reserve(nargs);

	size_t nterms = 1;
	for (size_t i = 0; i < nargs; i++) {
		// a) Each zi can be written as a linear combination of 1 and tau, with Im(tau) > 0
		const numeric& nzi = to_numeric(args[i].zi, points);
		// zi = A-round(B)*Re(tau) + i B Im(tau), A,B ∈ R
		// we want to shift A,B ∈ [-0.5,0.5)
		// For this, we need to shift A and B by -floor(A+0.5) and -floor(B+0.5) respectively, where floor(..) rounds towards negative infinity
		const numeric B = nzi.imag() / ntau.imag();
		const cln::cl_I shiftB = -cln::floor1(cln::realpart((B + 0.5).to_cl_N()));
		const numeric A = nzi.real() + numeric{shiftB}*ntau.real();
		const cln::cl_I shiftA = -cln::floor1(cln::realpart((A + 0.5).to_cl_N()));
		const ex zi_shifted = args[i].zi + numeric{shiftA} + numeric{shiftB}*tau;
		if (to_numeric(zi_shifted, points).is_zero())
			zis_shifted.push_back(0);
		else
			zis_shifted.push_back(zi_shifted.normal());

		// b) List of shifted kernels resulting from current integration
		shifted_kernels.emplace_back();
		std::vector<std::pair<ex, size_t>>& shifted_kernels_i = shifted_kernels.back();

		// no shift in tau -> kernel stays unchanged
		if (cln::zerop(shiftB)) {
			shifted_kernels_i.reserve(1);
			shifted_kernels_i.emplace_back(1, args[i].ni);
			continue;
		}

		// shift in tau -> use formula from above
		shifted_kernels_i.reserve(args[i].ni + 1);
		for (size_t k = 0; k <= args[i].ni; k++)
			shifted_kernels_i.emplace_back(pow(-2*Pi*I*numeric{shiftB},k)/factorial(k), args[i].ni-k);
		nterms *= args[i].ni + 1;
	}

	// Step 2:
	// Take all possible combinations of exactly one shifted kernel from each integration and build Gts out of them
	// Use a recursive lambda function to implement this nargs-dimensional outer product
	std::vector<ex> result;
	result.reserve(nterms);
	std::function<void(size_t,ex,std::vector<kernel>&)> build_Gts = [&](size_t i, ex factor, std::vector<kernel>& new_args) -> void {
		if (i < nargs) {
			// If we have not yet considered all integrations, call this function recursively with all possible shifted kernels from the current integration added to the list of arguments
			new_args.emplace_back(-1, zis_shifted[i], args[i].deform);
			for (size_t k = 0; k < shifted_kernels[i].size(); k++) {
				new_args.back().ni = shifted_kernels[i][k].second;
				build_Gts(i+1, factor * shifted_kernels[i][k].first, new_args);
			}
			new_args.pop_back();
		}
		else {
			// Once we have considered all the integrations, build the Gt and add it to the output
			result.emplace_back(factor * Gt(new_args, z, tau));

			const numeric nz = to_numeric(z, points);
			for (const kernel& k : new_args)
				if (k.ni == 1 && to_numeric(k.zi, points) == nz)
					throw std::logic_error((std::stringstream{} << "Gt: pole coincides with endpoint: " << Gt(new_args, z, tau)).str());
		}
	};
	// Start looping over the first integration
	std::vector<kernel> new_args;
	new_args.reserve(nargs);
	build_Gts(0, ex{1}, new_args);

	return add(result);
}

// Use shuffle regularisation to isolate Gt({{1,0}},z,tau)
ex Gt::regularise(const ex* points) const
{
	if (DEBUG_GT) std::cout << "regularise " << *this << std::endl;

	// No need to regularise
	if (nargs == 1)
		return *this;

	size_t n; // number of {1,0} kernels at the end of the argument list
	for (n = 0; n < nargs; n++)
		if (args[nargs-1-n].ni != 1 || !to_numeric(args[nargs-1-n].zi, points).is_zero())
			break;

	// No regularisation necessary
	if (n == 0)
		return *this;

	// Special case where all letters need regularisation
	const Gt singular{std::vector<kernel>(1,kernel{1,0}),z,tau};
	if (n == nargs)
		return pow(singular,nargs)/factorial(nargs);

	// Special case where all but one letter need regularisation
	if (n == nargs-1) {
		std::vector<ex> result;
		result.reserve(nargs);
		for (size_t i = 0; i < nargs; i++) {
			std::vector<kernel> new_args;
			new_args.reserve(i+1);
			for (size_t j = 0; j < i; j++)
				new_args.emplace_back(1,0);
			new_args.emplace_back(args[0].ni, args[0].zi);
			result.emplace_back(pow(-1,i) * Gt(new_args,z,tau) * pow(singular,n-i)/factorial(n-i));
		}
		return add(result);
	}

	// General case
	// let      w = a b c
	// where    a .. any combination of letters
	//          b .. a single letter that should not be regularised
	//          c .. a combination of n letters that should be regularised
	// then (lemma 3.2.5 of arXiv:1506.07243)
	//          w = sum_{i=0}^n (-1)^i shuffle( shuffle( a, c_i .. c_1 ) b, c_{i+1} .. c_n )
	// in the present case, c_i = {1,0}, such that this formula simplifies to
	//          w = sum_{i=0}^n (-1)^i Gt[shuffle( a, {1,0}^i ) b] * Gt[{1,0}]^(n-i)/(n-i)!

	const size_t na = nargs-n-1;
	const std::vector<kernel> a(args.begin(), args.begin() + na);
	const kernel& b = args[na];
	std::vector<kernel> ci; // ci = {1,0}^i
	ci.reserve(n + 1);
	std::vector<ex> result;
	for (size_t i = 0; i <= n; i++) {
		if (i)
			ci.emplace_back(1,0);

		multi_iterator_shuffle<kernel> shuffle{a, ci};
		for (shuffle.init(); !shuffle.overflow(); shuffle++) {
			std::vector<kernel> new_args;
			new_args.reserve(na + i);
			for (const kernel& k : shuffle.get_vector())
				new_args.emplace_back(k);
			new_args.emplace_back(b);
			result.emplace_back(pow(-1,i) * Gt(new_args,z,tau) * pow(singular,n-i)/factorial(n-i));
		}
	}

	return add(result);
}

// Find moebius tranform that shifts tau to fundamental domain
matrix Gt::findMoebiusTransform(const ex* points) const
{
	numeric ntau = to_numeric(tau, points);
	if (!ntau.imag().is_positive())
		throw std::runtime_error("Gt: Im(tau) <= 0");
	matrix transform{{1,0},{0,1}};

	bool loop;
	do {
		loop = false;

		// if |Re(tau)| > 0.5, shift tau by -round(Re(tau)), where round(..) rounds to the nearest integer
		const cln::cl_I shift{-round1(cln::realpart(ntau.to_cl_N()))};
		if (!cln::zerop(shift)) {
			transform = matrix{{1,numeric{shift}},{0,1}}.mul(transform);
			ntau += numeric{shift};
			loop = true;
		}

		// Mirror tau on unit circle
		// Slightly deviate from definition in paper, to avoid introducing extra terms without improving convergence
		// (abs(ntau) < 1 || (abs(ntau) == 1 && !ntau.real().is_positive()))
		if (abs(ntau) < 1) {
			ntau = -1/ntau;
			transform = matrix{{0,-1},{1,0}}.mul(transform);
			loop = true;
		}
	} while (loop);

	return transform;
}

// Apply moebius transform to shift tau
ex Gt::tauToFundamental(const ex* points) const
{
	if (DEBUG_GT) std::cout << "tauToFundamental " << *this << std::endl;

	// Find the Moebius transform that moves tau to the fundamental domain
	// The zis and z are transformed with the inverse transformation matrix
	const matrix transform = findMoebiusTransform(points);
	if (DEBUG_GT>=5) std::cout << "transform " << transform << std::endl;
	const ex& a = transform(0,0), b = transform(0,1), c = transform(1,0), d = transform(1,1);
	const ex& ci = -c, di = a; // parameters of the inverse transformation (det=1)
	const ex newTau = ((a*tau+b)/(c*tau+d)).normal(), newTau1 = (ci*newTau+di).normal();

	if (nargs == 1 && args[0].ni == 1 && to_numeric(args[0].zi, points).is_zero())
		return Gt(std::vector<kernel>(1,kernel{1,0}), z*newTau1, newTau) - log(newTau1) + I*Pi*ci/newTau1 * pow(z*newTau1,2);

	// Helper classes for integrating Gts
	struct integration_result {
		ex prefactor;             // independent of integration variable
		size_t power;             // power of integration variable
		std::vector<kernel> args; // Gt args; to not store z or tau, as they come from context

		integration_result(ex prefactor, size_t power, std::vector<kernel> args)
			: prefactor(prefactor), power(power), args(args) {}

		ex evaluate(const ex upper_bound, const ex& tau) {
			return prefactor * pow(upper_bound, power) * (args.empty() ? ex{1} : Gt(std::move(args), upper_bound, tau));
		}
	};
	struct integrand_term {
		ex prefactor;             // independent of integration variable
		size_t power;             // power of integration variable
		kernel kern;              // unintegrated kernel
		std::vector<kernel> args; // Gt args; to not store z or tau, as they come from context

		integrand_term(ex prefactor, size_t power, kernel kern, std::vector<kernel> args)
			: prefactor(prefactor), power(power), kern(kern), args(args) {}

		void integrate(std::vector<integration_result>& result) { // append result to vector
			if (args.empty() && kern.ni==0) // Neither Gt nor kernel -> integrate monomial
				result.emplace_back(prefactor/(power+1), power+1, std::vector<kernel>{});
			else {
				args.reserve(args.size() + 1 + power);
				args.emplace(args.begin(), kern); // New args: append kernel or {0,0} to previous arglist
				result.emplace_back(prefactor,power,args);
				while (power > 0) { // Integration by parts -> iterate the above
					prefactor *= -int(power--);
					args.emplace(args.begin(), kernel{0,0});
					result.emplace_back(prefactor,power,args);
				}
			}
		};
	};

	std::vector<integration_result> result{1,integration_result{1,0,std::vector<kernel>{}}}; // = 1
	for (size_t i = 0; i < nargs; i++) {
		// Loop over integration kernels (starting from innermost integration)
		const size_t ni = args[nargs - i - 1].ni;
		const ex zi_scaled = args[nargs - i - 1].zi * newTau1;
		// Build integrand, consisting of transformation of current kernel and of result from previous integration
		size_t num_terms = 0;
		std::vector<integrand_term> integrand;
		if (ci == 0) {
			// Special case where c=0 -> only k=0 term remains -> replace ci^k by 1
			for (const integration_result& prev_result : result) {
				const kernel kern{ni, zi_scaled, args[nargs - i - 1].deform};
				integrand.emplace_back(prev_result.prefactor/newTau1, prev_result.power, kern, prev_result.args);
				num_terms += 1 + prev_result.power * (kern.ni && !prev_result.args.empty());
			}
		}
		else {
			// General case:
			// g^(n)(z, tau) = sum_{k=0}^n (2PiI c z (c*newTau+d))^k (c*newTau+d)^(n-k) g^(n-k)(z (c*newTau+d), newTau) / k!
			// Note: we have an additional (c*newTau+d)^-1, from the jacobian of the change of variables dw -> dw'
			integrand.reserve(result.size()*(ni+1)*(ni+2)/2);
			for (size_t k = 0; k <= ni; k++) {
				const kernel kern{ni - k, zi_scaled, args[nargs - i - 1].deform};
				for (size_t j = 0; j <= k; j++) {
					const ex prefactor = pow(2*Pi*I*ci,k)*binomial(k,j)*((zi_scaled.is_zero()&&j==0)?1:pow(-zi_scaled,j))*pow(newTau1,int(ni-k)-1)/factorial(k);
					const size_t power = k-j;
					for (const integration_result& prev_result : result) {
						integrand.emplace_back(prev_result.prefactor*prefactor, prev_result.power+power, kern, prev_result.args);
						num_terms += 1 + (prev_result.power+power) * (kern.ni && !prev_result.args.empty());
					}
				}
			}
		}
		// Do the integration
		result.clear();
		result.reserve(num_terms);
		for (integrand_term& term : integrand)
			term.integrate(result);
	}

	std::vector<ex> result_ex;
	result_ex.reserve(result.size());
	for (integration_result& term : result)
		result_ex.emplace_back(term.evaluate(newTau1*z, newTau));
	return add(result_ex);
}

// Cut integration path into equidistant segements, such that end points are in fundamental domain
std::vector<ex> Gt::decomposeIntegrationPath(const ex* points) const
{
	if (DEBUG_GT) std::cout << "cutIntegrationPath " << *this << std::endl;

	const numeric nz = to_numeric(z, points);
	const numeric ntau = to_numeric(tau, points);

	// z = A + i B Im(tau), A,B ∈ R
	const numeric A = nz.real();
	const numeric B = nz.imag() / ntau.imag();

	const double nA = A.to_double();
	const double nB = B.to_double();

	// How close to the boundaries of the fundamental domain (at 0.5) to do the cut
	const double max_A = cutIntegrationPath_threshold_real;
	const double max_B = cutIntegrationPath_threshold_imag;

	// Test if number differs by any of the zis by an integer multiple of 1 or tau
	auto coincidesWithZi = [&](const ex& e) {
		for (const kernel& k : args) {
			const numeric diff = to_numeric(k.zi - e, points);
			// z = A + B tau;  A,B ∈ R
			const numeric B = diff.imag() / ntau.imag();
			const numeric A = diff.real() - ntau.real()*B;
			if (B.is_integer() && A.is_integer())
				return true;
		}
		return false;
	};

	// Distribute cuts evenly along the path of integration
	std::vector<ex> cuts;
	size_t nCuts = std::max<size_t>(std::abs(nA) / max_A, std::abs(nB) / max_B);
	while (true) {
		cuts.reserve(nCuts + 2);
		cuts.emplace_back(ex{0});
		for (size_t i = 1; i < nCuts+1; i++) {
			cuts.emplace_back(i*z/(nCuts+1));
			if (coincidesWithZi(cuts.back())) {
				// If any of the cut boundaries coincides with any of the zis,
				// increase number of cuts and try again (should be very rare)
				nCuts++;
				cuts.clear();
				break;
			}
		}
		if (cuts.empty())
			continue;
		cuts.emplace_back(z);
		break;
	}

	return cuts;
}

// Write as combination of eMPLs wit straight integration paths
ex Gt::applyIntegrationPath(const std::vector<ex>& endpoints) const
{
	return Gt_detail::deconcatenate_path<kernel>(args, endpoints, [this](std::vector<kernel>& new_args, const ex& start, const ex& end) -> ex {
		for (kernel& k: new_args)
			k.zi -= start;
		return Gt(new_args, end - start, tau);
	});
}

// Variable transformation z -> w, keep track of intergration path, expand kernels
numeric Gt::qExpand(const ex* points) const
{
	if (DEBUG_GT) std::cout << "qExpand " << *this << std::endl;

	const numeric nz = to_numeric(z, points);
	const numeric ntau = to_numeric(tau, points);
	std::vector<numeric> nzis, nqis;
	nzis.reserve(nargs);
	nqis.reserve(nargs);
	for (size_t i = 0; i < nargs; i++) {
		nzis.emplace_back(to_numeric(args[i].zi, points));
		nqis.emplace_back(to_numeric(exp(2*Pi*I*nzis.back())));
	}
	const numeric qtau = to_numeric(exp(2*Pi*I*ntau));
	const numeric qz = to_numeric(exp(2*Pi*I*nz));

	if (!ntau.imag().is_positive())
		throw std::runtime_error("Gt: Cannot perform q-expansion if Im(tau) <= 0");

	// Special case of Gt({{1,0}},z,tau)
	const bool singular = (nargs == 1 && args[0].ni == 1 && args[0].zi.is_zero());

	std::vector<std::pair<numeric,int>> path;
	path.reserve(nargs);

	// Original integration path is 0->z. Need to ensure that we pass on correct side of poles
	// For every pole of the integrand, zi, find where the integration path passes it and add
	// a node to the path
	// Afterwards, integration path is 0->path[0]->path[1]->...->z (which is still a straight line)
	if (nz.real().is_positive()) {
		for (size_t i = 0; i < nargs; i++) {
			if (args[i].ni != 1) continue; // kernel not singular
			if (nzis[i].real() <= 0 || nzis[i].real() >= nz.real()) continue; // Re(zi) outside integration path
			const numeric n1 = nzis[i].imag()*nz.real(), n2 = nzis[i].real()*nz.imag();

			// wi is on the contour -> find out in which direction to deform contour
			if (abs(n1-n2) < abs(n1+n2)*pow(10,-Digits)) { // Fuzzy compare to account for floating point errors
				if (args[i].deform >= 0) // add node only if shifting outward (deform=0 defaults to +1 -> include node)
					path.emplace_back(nzis[i].real(), -1);
				continue;
			}

			// wi would be outside of the contour -> ignore this pole, as we integrate along the correct side by default
			if (n1 < n2)
				continue;

			// wi is strictly inside the contour -> add a node to the contour
			if (n1 > n2)
				path.emplace_back(nzis[i].real(), 0);
		}
		std::sort(path.begin(), path.end());  // regular sort
		path.erase(std::unique(path.begin(), path.end()), path.end());  // delete duplicates
	}
	else if (nz.real().is_negative()) {
		for (size_t i = 0; i < nargs; i++) {
			if (args[i].ni != 1) continue; // kernel not singular
			if (nzis[i].real() <= nz.real() || 0 <= nzis[i].real()) continue; // Re(zi) outside integration path
			const numeric n1 = nzis[i].imag()*nz.real(), n2 = nzis[i].real()*nz.imag();

			// wi is on the contour -> find out in which direction to deform contour
			if (abs(n1-n2) < abs(n1+n2)*pow(10,-Digits)) { // Fuzzy compare to account for floating point errors
				if (args[i].deform < 0) // add node only if shifting outward (deform=0 defaults to +1 -> omit node)
					path.emplace_back(nzis[i].real(), -1);
				continue;
			}

			// wi would be outside of the contour -> ignore this pole, as we integrate along the correct side by default
			if (n1 > n2)
				continue;

			// wi is strictly inside the contour -> add a node to the contour
			if (n1 < n2)
				path.emplace_back(nzis[i].real(), 0);
		}
		std::sort(path.rbegin(), path.rend());  // reverse sort
		path.erase(std::unique(path.begin(), path.end()), path.end());  // delete duplicates
	}

	// Change of variables: z -> w=exp(2*Pi*I*z)
	// -> integration path changes from 0->z to 1->w
	std::vector<ex> wpath;
	wpath.reserve(path.size() + 2);
	wpath.emplace_back(1);
	for (size_t i = 0; i < path.size(); i++)
		wpath.emplace_back(pow(qz,path[i].first/nz.real()));
	wpath.emplace_back(qz);

	// Handle poles on the integration contour by deforming contour inward or outward
	for (size_t i = 0; i < path.size(); i++) {
		if (path[i].second == 0) // Not on integration path
			continue;
		if (path[i].second > 0) // This does not happen, as we omit the node in this case
			// If we want to integrate closer to the origin, half the imaginary part of the node.
			wpath[i+1] -= I*ex_to<numeric>(wpath[i+1].evalf()).imag()/2;
		else if (path[i].second < 0) {
			// If we want to integrate further away from the origin, move the contour in positive imaginary direction.
			// The maximum value we can move depends on the previous and following fixed points and the poles in between.
			// Shifting only the imaginary part ensures that the order along the real axis remains unchanged.
			const numeric prev_fix_point = ex_to<numeric>(wpath[i].evalf());
			const numeric current_point  = ex_to<numeric>(wpath[i+1].evalf());
			const numeric next_fix_point = ex_to<numeric>(wpath[i+2].evalf());
			numeric shift = current_point.imag();

			// Iterate over all poles; if they are inbetween the current and an adjacent fixed point, they constrain
			// the maximum shift that is allowed without crossing a pole
			for (size_t j = 0; j < nargs; j++) {
				if (args[j].ni != 1)
					continue;
				const numeric q = nqis[j];
				if (nz.real().is_positive() && q.imag().is_negative()) continue;
				if (nz.real().is_negative() && q.imag().is_positive()) continue;
				if (abs(q.real()-current_point.real()) < abs(q.real()+current_point.real())*pow(10,-Digits)) // fuzzy compare
					continue; // ignore current node
				if (q.real() < std::min(prev_fix_point.real(), next_fix_point.real()) || q.real() > std::max(prev_fix_point.real(), next_fix_point.real()))
					continue; // find poles in-between current node and adjacent nodes
				// Construct straight line through adjacent nodes and pole under consideration. The point where it intersects the vertical line passing through the current node,
				// is the furthest point to which we may shift the node.
				if (nz.real().is_positive()) {
					if (q.real() < current_point.real())
						shift = std::min(shift, (next_fix_point.imag()-current_point.imag()) + (next_fix_point.real()-current_point.real()) / (q.real()-current_point.real()) * (q.imag()-current_point.imag()));
					else
						shift = std::min(shift, (prev_fix_point.imag()-current_point.imag()) + (prev_fix_point.real()-current_point.real()) / (q.real()-current_point.real()) * (q.imag()-current_point.imag()));
				}
				else if (nz.real().is_negative()) {
					if (q.real() < current_point.real())
						shift = std::max(shift, (next_fix_point.imag()-current_point.imag()) + (next_fix_point.real()-current_point.real()) / (q.real()-current_point.real()) * (q.imag()-current_point.imag()));
					else
						shift = std::max(shift, (prev_fix_point.imag()-current_point.imag()) + (prev_fix_point.real()-current_point.real()) / (q.real()-current_point.real()) * (q.imag()-current_point.imag()));
				}
			}
			// Shift by half the maximum allowed value
			wpath[i+1] += I*shift/2;
		}
	}

	// To do the expansion, we pick which kernel(s) we want to expand and how many orders we want to add.
	// We start with the innermost kernel that gets new orders. The construct the new terms and store them
	// in the expansion variable. We multiply those terms by the result of the previous integration. This gives
	// us the new terms in the integrand.
	// We then integrate those terms and add them to the corresponding result variable. We take only the terms
	// we just added and multiply them by all the expansion terms of the next kernel (and possibly by new terms
	// added to that expansion). This gives us the integrand of the next integration.
	// We iterate until the outermost integration. At this point we have updated all variables and also obtain
	// all the terms that arise from the current expansion step (they can be used to test for convergence).
	using Term = Gt_detail::pathintegral_term;        // a single term that can be integrated
	using Terms = Gt_detail::pathintegral_term_list;  // a sum of terms
	std::vector<size_t> orders(nargs,0);   // For each kernel, how many orders of q-expansion have been performed
	std::vector<Terms> expansion(nargs);   // For each kernel, the terms of its q-expansion
	std::vector<Terms> results(nargs+1);   // For each integration, the intermediate integration result (nargs+1 to have a starting value before innermost integration)
	results.rbegin()->add(1,0);            // Initialise the input of the innermost integration to 1

	// Evaluate integration result numerically; apply global factor (2*Pi*I)^(-nargs) (from Jacobian of z->w)
	const numeric norm = to_numeric(pow(2*Pi*I, nargs).evalf());
	auto evaluate_numeric = [&](const Terms& terms) -> numeric {
		numeric result = 0;
		for (const Term& term : terms)
			result += to_numeric(nqexand_transformer(term.evaluate(qz, wpath)));
		return result / norm;
	};

	// Helper function to compute sum_{n=1}^inf q^n n^k = Li(-k,q)
	auto LiNegIntOrd = [](const ex& q, const size_t k) -> ex {
		if (k == 0)
			return q / (1 - q);
		std::vector<ex> result;
		result.reserve(k);
		for (size_t i = 1; i <= k; i++) {
			std::vector<ex> en;
			en.reserve(i);
			for (size_t j = 0; j < i; j++)
				en.emplace_back(pow(-1, j) * binomial(k + 1, j) * pow(i - j, k));
			result.emplace_back(pow(q,i) * add(en));
		}
		return add(result) / pow(1 - q, k + 1);
	};

	// Perform or refine the q-expansion of a given kernel, by adding one or mode additional orders in q
	// Perform all subsequent integrations of the new terms and update intermediate data structures
	// Return the numerical difference to the final integration result that resulted from the additional expansion
	constexpr size_t ALL_KERNELS = std::numeric_limits<size_t>::max(); // special argument to simultaneously expand all kernels
	auto expand_and_integrate_kernel = [&](const size_t kernel_index, const size_t num_extra_orders) -> numeric {
		Terms new_result; // New terms added to previous integration (initially none)
		// Start iterating from the innermost integration that receives new expansion terms
		for (size_t i = (kernel_index==ALL_KERNELS ? 0 : kernel_index); i < nargs; i++) {
			const size_t idx = nargs - 1 - i; // Innermost integration comes last in lists

			Terms new_terms; // New terms of expansion of current kernel
			if (kernel_index == ALL_KERNELS || kernel_index == i) { // further expand current kernel
				const size_t ni = args[idx].ni;
				const ex& zi = nzis[idx];
				const ex& qi = nqis[idx];
				const size_t order_min = (orders[idx] + 1) - 1;
				const size_t order_max = (orders[idx] += num_extra_orders) - 1;

				if (ni == 0) {
					if (order_min == 0)
						new_terms.add(1, 0);
				} else {
					if (order_min == 0) {
						if (ni == 1) {
							new_terms.add(I*Pi, 0);
							if (!singular) // In case of {1,0} kernel, add -2*Pi*I/(w-1) -> effectively omit this term
								new_terms.add(2*Pi*I*qi, 0, std::vector<ex>{}, qi);
						}
						if (ni%2 == 0)
							new_terms.add(-2*zeta(ni), 0);
					}

					const int sign = ni%2 == 0 ? 1 : -1;
					const ex factor = -pow(2*Pi*I, ni)/factorial(ni-1);
					for (size_t i = std::max((size_t)1,order_min); i <= order_max; i++) {
						const ex gSum = LiNegIntOrd(pow(qtau,i), ni-1).evalf();
						new_terms.add(factor * gSum / pow(qi, i),        +i);
						new_terms.add(factor * gSum * pow(qi, i) * sign, -i);
					}
				}
			}

			Terms new_integrand; // New terms in integrand of current integration
			// If the previous integration has added new terms, add to the integrand is product of
			for (const Term& new_integration_result : new_result)        // new terms from previous integration
				for (const Term& expansion_term : expansion[idx])        // existing terms of expansion of current kernel
					new_integrand.add(expansion_term, new_integration_result, -1);
			// If we further expanded the current kernel, add to the integrand the product of
			for (const Term& new_expansion_term : new_terms)             // new terms of expansion of current kernel
				for (const Term& integration_result : results[idx+1])    // previous integration result
					new_integrand.add(integration_result, new_expansion_term, -1);
			// All of the above terms are divided by the integration variable, which is the Jacobian of the transformation z->w

			// Store expansion terms for future iterations
			if (!new_terms.empty() && i) // no need to keep track of innermost expansion
				expansion[idx].add(new_terms);

			// Do the integration and store results for future iterations
			new_result.clear();
			// Integrate terms one at a time. In case new integrands arise from partial integration or partial fractioning,
			// they are put back into the list of integrand terms, rather than integrating them directly. As a result we can
			// combine these terms with existing terms in the integrand, such that we only have to integrate each structure
			// once. Terms are ordered such that more complicated terms come first.
			while (!new_integrand.empty())
				new_integrand.pop().integrate(wpath[0], new_integrand, new_result);
			results[idx].add(new_result);
		}

		return evaluate_numeric(new_result);
	};

	// Step 1: Expand all kernels to some starting order
	// The starting order is estimated for each kernel based on tau, z, and zi
	const double dz = nz.imag().to_double();
	for (size_t i = 0; i < nargs; i++) {
		const size_t idx = nargs - 1 - i; // Innermost integration comes last in lists
		if (args[idx].ni == 0) {
			// For {0,0} kernel, expansion has only one term
			//expand_and_integrate_kernel(i, std::max((size_t)1,qExpand_minOrder));
			expand_and_integrate_kernel(i, 1);
			continue;
		}
		// Expansion parameter is exp(-2*Pi*Im(tau))
		// Convergence is hindered by the imaginary parts of z,zi or z-zi being close to Im(tau)
		// -> effective expansion parameter is x = exp(-2*Pi*(Im(tau)-max(abs(Im(z)),abs(Im(zi)),abs(Im(z-zi)))))
		// => Need approximately log_x(10^-Digits) orders in expansion
		const double dzi = nzis[idx].imag().to_double();
		const double conv = std::max({std::abs(dz),std::abs(dzi),std::abs(dz-dzi)});
		const size_t estimate = (size_t)to_numeric((-Digits*log(10)/(-2*Pi*(ntau.imag()-conv))).evalf()).to_double();
		expand_and_integrate_kernel(i, std::max(estimate,qExpand_minOrder));
	}

	// Step 2: Expand all kernels alternatingly. If the impact of a single kernel's expansion is
	// smaller than the target accuracy, stop its expansion and continue with remaining kernels.
	const numeric accuracy_goal = abs(evaluate_numeric(results[0]))*pow(numeric{10},-numeric{Digits});
	uint64_t iterating = (uint64_t(1) << nargs) - uint64_t(1); // i-th bit represents whether i-th kernel is still being expanded
	do {
		for (size_t i = 0; i < nargs; i++) {
			if (iterating & (1 << i)) {
				const numeric delta = abs(expand_and_integrate_kernel(i, qExpand_stepSize));
				iterating ^= (delta < accuracy_goal) << i; // if accuracy reached, turn off corresponding bit
			}
		}
	} while (iterating);

	// Step 3: Expand all kernels together, until the change is smaller than the target accuracy.
	// This is for the rare case that the expansion of each individual kernel has a small impact,
	// but the sum of all expansions is larger.
	numeric delta;
	do {
		delta = abs(expand_and_integrate_kernel(ALL_KERNELS, qExpand_stepSize));
	} while (delta > accuracy_goal);

	if (DEBUG_GT>=5) {
		std::cout << "qExpand order:";
		for (size_t i = 0; i < nargs; i++)
			std::cout << " " << orders[i];
		std::cout << std::endl;
	}

	if (singular) // In case of {1,0} kernel, add log(1-w)-log(w)
		return evaluate_numeric(results[0]) + to_numeric(log(1 - qz).evalf() - 2*Pi*I*z, points);

	return evaluate_numeric(results[0]);
}

numeric Gt::evaluate(const ex* points) const
{
	return ex_evaluate(*this, points);
}


ex Gt::ex_zisToFundamental(const ex& expr, const ex* points)
{
	return apply_function_recursive(expr, [&points](const Gt& Gt) -> ex {
		return Gt.zisToFundamental(points);
	});
}
ex Gt::ex_regularise(const ex& expr, const ex* points)
{
	return apply_function_recursive(expr, [&points](const Gt& Gt) -> ex {
		return Gt.regularise(points);
	});
}
ex Gt::ex_tauToFundamental(const ex& expr, const ex* points)
{
	return apply_function_recursive(expr, [&points](const Gt& Gt) -> ex {
		return Gt.tauToFundamental(points);
	});
}
ex Gt::ex_cutIntegrationPath(const ex& expr, const ex* points)
{
	return apply_function_recursive(expr, [&points](const Gt& Gt) -> ex {
		return Gt.applyIntegrationPath(Gt.decomposeIntegrationPath(points));
	});
}
numeric Gt::ex_qExpand(const ex& expr, const ex* points)
{
	return to_numeric(apply_function_recursive(expr, [&points](const Gt& Gt) -> numeric {
		return Gt.qExpand(points);
	}), points);
}

// All preparation steps, output is ready for q-expansion
ex Gt::ex_prepare(const ex& expr, const ex* points)
{
	// Move zis to fundamental domain
	ex result = ex_zisToFundamental(expr, points);
	if (DEBUG_GT>=3) std::cout << "step1: " << result << std::endl;

	// Apply regularisation, such that innermost kernel is not {1,0}
	result = ex_regularise(result, points);
	if (DEBUG_GT>=3) std::cout << "step2: " << result << std::endl;

	// Move tau to its fundamental domain
	// This shifts the zi -> redo zi shifts and regularisation
	if (enable_tauToFundamental) {
		result = ex_tauToFundamental(result, points);
		if (DEBUG_GT>=4) std::cout << "step3a: " << result << std::endl;
		result = ex_zisToFundamental(result, points);
		if (DEBUG_GT>=4) std::cout << "step3b: " << result << std::endl;
		result = ex_regularise(result, points);
		if (DEBUG_GT>=3) std::cout << "step3: " << result << std::endl;
	} else
		if (DEBUG_GT>=2) std::cout << "(tauToFundamental skipped)" << std::endl;

	// Cuts integration path and shift z/zis, such that z is in its fundamental domain
	// This shifts the zi (but not to 0) -> redo zi shifts
	result = ex_cutIntegrationPath(result, points);
	if (DEBUG_GT>=4) std::cout << "step4a: " << result << std::endl;
	result = ex_zisToFundamental(result, points);

	if (DEBUG_GT>=2) std::cout << "prepared: " << result << std::endl;

	return result;
}

// Full numerical evaluation
numeric Gt::ex_evaluate(const ex& expr, const ex* points)
{
	if (DEBUG_GT>=4) {
		std::cout << "input: " << expr;
		if (points)
			std::cout << "; points=" << *points;
		std::cout << std::endl;
	}
	const ex prepared = ex_prepare(expr, points);
	const numeric result = to_numeric(ex_qExpand(prepared, points));
	if (DEBUG_GT>=4) std::cout << "evaluated: " << result << std::endl;
	if (auto_clear_polylog_cache)
		clear_polylog_cache();
	return result;
}
lst Gt::lst_evaluate(const lst& list, const ex* points)
{
	if (DEBUG_GT>=4) {
		std::cout << "input: " << list;
		if (points)
			std::cout << "; points=" << *points;
		std::cout << std::endl;
	}
	const lst prepared = ex_to<lst>(ex_prepare(list, points));
	lst result;
	for (size_t i = 0; i < prepared.nops(); i++)
		result.append(to_numeric(ex_qExpand(prepared.op(i), points)));
	if (DEBUG_GT>=4) std::cout << "evaluated: " << result << std::endl;
	if (auto_clear_polylog_cache)
		clear_polylog_cache();
	return result;
}


// Convenience wrappers that take references instead of pointers
ex Gt::ex_zisToFundamental(const ex& expr, const ex& points) {return ex_zisToFundamental(expr, &points); };
ex Gt::ex_regularise(const ex& expr, const ex& points) {return ex_regularise(expr, &points); };
ex Gt::ex_tauToFundamental(const ex& expr, const ex& points) {return ex_tauToFundamental(expr, &points); };
ex Gt::ex_cutIntegrationPath(const ex& expr, const ex& points) {return ex_cutIntegrationPath(expr, &points); };
numeric Gt::ex_qExpand(const ex& expr, const ex& points) {return ex_qExpand(expr, &points); };
ex Gt::ex_prepare(const ex& expr, const ex& points) {return ex_prepare(expr, &points); };
numeric Gt::ex_evaluate(const ex& expr, const ex& points) { return ex_evaluate(expr, &points); }
lst Gt::lst_evaluate(const lst& list, const ex& points) { return lst_evaluate(list, &points); }


// Apply function to every Gt in an expression
ex Gt::apply_function_recursive(const ex& input, const std::function<ex(const Gt&)>& func)
{
	return Gt_detail::TransformExpressionWithCache<Gt>([&func](const ex& expr) -> ex { return func(ex_to<Gt>(expr)); })(input);
}

void Gt::clear_polylog_cache()
{
	nqexand_transformer.clear_cache();
}


// Evaluate expression numerically, throw error if not possible
// Optionally take a list of replacement rules
numeric Gt::to_numeric(const ex& expr, const ex* points)
{
	// Substitute points twice, in case some of the zis are given in terms of tau
	const ex replaced = (points ? expr.subs(*points).subs(*points) : expr).evalf();

	if (is_a<numeric>(replaced))
		return ex_to<numeric>(replaced);

	throw std::invalid_argument((std::stringstream{} << "Gt: argument '" << expr << "' is not numeric, evaluated to '" << replaced << "'").str());
}
long Gt::to_integer(const ex& expr, const bool allow_negative)
{
	if (is_a<numeric>(expr)) {
		const numeric n = ex_to<numeric>(expr);
		if (allow_negative ? n.is_integer() : n.is_nonneg_integer())
			return n.to_long();
	}

	throw std::invalid_argument((std::stringstream{} << "Gt: argument '" << expr << "' is not " << (allow_negative ? "an" : "a non-negative") << " integer").str());
}

double Gt::cutIntegrationPath_threshold_real = 0.4;
double Gt::cutIntegrationPath_threshold_imag = 0.4;
size_t Gt::qExpand_minOrder = 4;
size_t Gt::qExpand_stepSize = 4;
bool Gt::auto_clear_polylog_cache = false;
bool Gt::enable_tauToFundamental = true;
Gt_detail::TransformExpressionWithCache<G2_SERIAL> Gt::nqexand_transformer = []()
{
	// Clear cache when precision target increases
	Digits.add_callback([](long change) -> void {
		if (change>0)Gt::clear_polylog_cache();
	});
	return Gt_detail::TransformExpressionWithCache<G2_SERIAL>{
		[](const ex& obj) {return obj.evalf();}, // evaluate polylogs (cached)
		[](const ex& obj) {return obj.evalf();}  // evaluate other objects
	};
}();


GINAC_BIND_UNARCHIVER(Gt);
} // namespace GiNaC
