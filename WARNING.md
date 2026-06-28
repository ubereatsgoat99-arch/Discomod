# ⚠️ Warnings

This project is **highly sensitive to structural integrity**. Please read carefully before making any changes.

## 🚨 DO NOT REMOVE OR MODIFY CORE FILES

Removing, renaming, or heavily editing core files in this repository may cause **complete system failure**. Many components are tightly coupled and depend on exact file paths and structures.

If you change something important without understanding its purpose, you will likely break:
- Build process
- Runtime execution
- Module imports
- API integrations
- Internal dependencies

## 🧠 BEFORE YOU EDIT ANYTHING

Ask yourself:
- Do I fully understand what this file does?
- Do I know what depends on it?
- Have I tested this change in isolation?

If the answer is no, **do not proceed**.

## 💥 CONSEQUENCES OF UNAUTHORIZED CHANGES

Improper modifications may result in:
- Application crashes
- Broken modules
- Silent failures (worse than crashes)
- Data corruption
- Loss of functionality across the entire system

## 🔒 CORE PRINCIPLES

- Do not delete files unless explicitly instructed
- Do not rename modules without updating all references
- Do not “clean up” code you don’t understand
- Do not assume something is unused

## 🛠️ SAFE PRACTICE

If you need to change something:
1. Create a backup branch
2. Test changes locally
3. Review all dependencies
4. Proceed only if fully confident

## 📌 FINAL WARNING

This system is **not forgiving** of careless edits.  
Small changes can cause large-scale failures.

Proceed with caution.
